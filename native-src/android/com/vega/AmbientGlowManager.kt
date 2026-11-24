package com.vega

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.RuntimeShader
import android.os.Build
import android.graphics.Shader
import android.view.Choreographer
import android.view.View
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.roundToInt

/** A single opaque color field: target changes never reset its displayed colors. */
class AmbientGlowView(context: ThemedReactContext) : View(context), Choreographer.FrameCallback {
    private val current = FloatArray(12)
    private val target = FloatArray(12)
    // A single filtered field shared by every bar prevents panel/corner seams.
    private val field = Bitmap.createBitmap(32, 24, Bitmap.Config.ARGB_8888)
    private val pixels = IntArray(32 * 24)
    private val fieldShader = BitmapShader(field, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP)
    private val fieldMatrix = Matrix()
    private val fieldPaint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.DITHER_FLAG).apply { shader = fieldShader }
    // Compute the gradient continuously instead of magnifying quantized dark texels.
    private val smoothField = if (Build.VERSION.SDK_INT >= 33) runCatching { RuntimeShader("""
        uniform float2 viewport;
        uniform float4 bars;
        uniform float spread;
        uniform float strength;
        uniform float3 tl;
        uniform float3 tr;
        uniform float3 bl;
        uniform float3 br;
        half4 main(float2 p) {
            float2 uv = clamp(p / viewport, 0.0, 1.0);
            float vertical = max(max((bars.x - p.y) / max(bars.x, 1.0),
                (p.y - viewport.y + bars.y) / max(bars.y, 1.0)), 0.0);
            float horizontal = max(max((bars.z - p.x) / max(bars.z, 1.0),
                (p.x - viewport.x + bars.w) / max(bars.w, 1.0)), 0.0);
            float fade = clamp(1.0 - max(vertical, horizontal) / spread, 0.0, 1.0);
            float3 color = mix(mix(tl, tr, uv.x), mix(bl, br, uv.x), uv.y) * strength * fade;
            // Stable sub-level dithering avoids dark gradient bands without flicker.
            float noise = fract(52.9829189 * fract(dot(floor(p), float2(0.06711056, 0.00583715)))) - 0.5;
            color = clamp(color + noise / 255.0, 0.0, 1.0);
            return half4(color, 1.0);
        }
    """.trimIndent()) }.getOrNull() else null
    private val rectangles = Array(4) { RectF() }
    private val drawnColors = IntArray(4) { Color.BLACK }
    private val cachedColors = IntArray(4) { -1 }
    private val bounds = FloatArray(4)
    private var shadersDirty = true
    private var queued = false
    private var lastFrame = 0L
    var responseMs = 220f
        set(value) { field = if (value.isFinite()) value.coerceIn(16f, 1000f) else 220f }
    var spread = 1f
        set(value) { field = if (value.isFinite()) value.coerceIn(0.1f, 3f) else 1f; geometry() }
    var strength = 0.35f
        set(value) { field = value.coerceIn(0f, 1f); invalidate() }

    init {
        if (Build.VERSION.SDK_INT >= 33) fieldShader.setFilterMode(BitmapShader.FILTER_MODE_LINEAR)
        smoothField?.let { fieldPaint.shader = it }
        isFocusable = false
        isClickable = false
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    fun palette(values: ReadableArray?) {
        if (values == null || values.size() != 4) return
        val parsed = try { IntArray(4) { Color.parseColor(values.getString(it)) } } catch (_: Exception) { return }
        for (i in 0..3) {
            val channels = intArrayOf(Color.red(parsed[i]), Color.green(parsed[i]), Color.blue(parsed[i]))
            for (channel in 0..2) {
                val index = i * 3 + channel
                // Ignore tiny compression/noise changes instead of chasing them.
                if (abs(target[index] - channels[channel]) > 2f) target[index] = channels[channel].toFloat()
            }
        }
        schedule()
    }

    fun bars(values: ReadableMap?) {
        if (values == null) return
        val density = resources.displayMetrics.density
        val names = arrayOf("top", "bottom", "left", "right")
        // Recover exact physical pixel boundaries after the dp bridge round trip.
        for (i in names.indices) bounds[i] = (values.getDouble(names[i]) * density).roundToInt().coerceAtLeast(0).toFloat()
        geometry()
    }

    private fun schedule() {
        if (!queued && isAttachedToWindow && windowVisibility == VISIBLE) {
            queued = true
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    override fun doFrame(time: Long) {
        queued = false
        val elapsedMs = if (lastFrame == 0L) 16.7f else ((time - lastFrame) / 1_000_000f).coerceIn(0f, 64f)
        lastFrame = time
        // Time-based smoothing remains continuous across interruptions and scene cuts.
        val weight = (1.0 - exp(-elapsedMs / responseMs.toDouble())).toFloat()
        var moving = false
        for (i in current.indices) {
            val difference = target[i] - current[i]
            if (abs(difference) > 0.6f) {
                current[i] += difference * weight
                moving = true
            } else current[i] = target[i]
        }
        invalidate()
        if (moving) schedule() else lastFrame = 0L
    }

    override fun onAttachedToWindow() { super.onAttachedToWindow(); schedule() }
    override fun onDetachedFromWindow() {
        Choreographer.getInstance().removeFrameCallback(this)
        queued = false
        lastFrame = 0L
        super.onDetachedFromWindow()
    }
    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        if (visibility == VISIBLE) schedule() else {
            Choreographer.getInstance().removeFrameCallback(this)
            queued = false
            lastFrame = 0L
        }
    }
    override fun onSizeChanged(w: Int, h: Int, oldW: Int, oldH: Int) { geometry() }

    private fun geometry() {
        val w = width.toFloat(); val h = height.toFloat()
        val top = bounds[0].coerceAtMost(h / 2)
        val bottom = bounds[1].coerceAtMost(h / 2)
        val left = bounds[2].coerceAtMost(w / 2)
        val right = bounds[3].coerceAtMost(w / 2)
        // Clip drawing to the bars; extend only the fade beyond the screen above 100%.
        val coverage = spread.coerceAtMost(1f)
        rectangles[0].set(0f, top * (1f - coverage), w, top)
        rectangles[1].set(0f, h - bottom, w, h - bottom + bottom * coverage)
        rectangles[2].set(left * (1f - coverage), 0f, left, h)
        rectangles[3].set(w - right, 0f, w - right + right * coverage, h)
        fieldMatrix.setScale(w / 32f, h / 24f)
        fieldShader.setLocalMatrix(fieldMatrix)
        shadersDirty = true
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        if (strength <= 0f) return
        if (Build.VERSION.SDK_INT >= 33 && smoothField != null && width > 0 && height > 0) {
            smoothField.setFloatUniform("viewport", width.toFloat(), height.toFloat())
            smoothField.setFloatUniform("bars", bounds[0], bounds[1], bounds[2], bounds[3])
            smoothField.setFloatUniform("spread", spread)
            smoothField.setFloatUniform("strength", strength)
            smoothField.setFloatUniform("tl", current[0] / 255f, current[1] / 255f, current[2] / 255f)
            smoothField.setFloatUniform("tr", current[3] / 255f, current[4] / 255f, current[5] / 255f)
            smoothField.setFloatUniform("bl", current[6] / 255f, current[7] / 255f, current[8] / 255f)
            smoothField.setFloatUniform("br", current[9] / 255f, current[10] / 255f, current[11] / 255f)
            for (r in rectangles) if (!r.isEmpty) canvas.drawRect(r, fieldPaint)
            return
        }
        var changed = shadersDirty
        for (i in 0..3) {
            // Blend into black in RGB, avoiding independently fading layers.
            drawnColors[i] = Color.rgb((current[i * 3] * strength).toInt(),
                (current[i * 3 + 1] * strength).toInt(), (current[i * 3 + 2] * strength).toInt())
            if (drawnColors[i] != cachedColors[i]) changed = true
        }
        if (changed && width > 0 && height > 0) {
            val w = width.toFloat(); val h = height.toFloat()
            val top = bounds[0].coerceAtMost(h / 2)
            val bottom = bounds[1].coerceAtMost(h / 2)
            val left = bounds[2].coerceAtMost(w / 2)
            val right = bounds[3].coerceAtMost(w / 2)
            for (y in 0 until 24) {
                val fy = (y + 0.5f) / 24f
                val py = fy * h
                val vertical = when {
                    py < top && top > 0f -> (top - py) / top
                    py > h - bottom && bottom > 0f -> (py - h + bottom) / bottom
                    else -> 0f
                }
                for (x in 0 until 32) {
                    val fx = (x + 0.5f) / 32f
                    val px = fx * w
                    val horizontal = when {
                        px < left && left > 0f -> (left - px) / left
                        px > w - right && right > 0f -> (px - w + right) / right
                        else -> 0f
                    }
                    val brightness = (1f - maxOf(horizontal, vertical) / spread).coerceIn(0f, 1f)
                    var color = -0x1000000
                    for (channel in 0..2) {
                        val shift = (2 - channel) * 8
                        fun component(index: Int) = (drawnColors[index] shr shift) and 255
                        val upper = component(0) * (1f - fx) + component(1) * fx
                        val lower = component(2) * (1f - fx) + component(3) * fx
                        val value = ((upper * (1f - fy) + lower * fy) * brightness).roundToInt().coerceIn(0, 255)
                        color = color or (value shl shift)
                    }
                    pixels[y * 32 + x] = color
                }
            }
            field.setPixels(pixels, 0, 32, 0, 0, 32, 24)
        }
        for (r in rectangles) {
            if (!r.isEmpty) canvas.drawRect(r, fieldPaint)
        }
        drawnColors.copyInto(cachedColors)
        shadersDirty = false
    }
}

class AmbientGlowManager : SimpleViewManager<AmbientGlowView>() {
    override fun getName() = "VegaAmbientGlow"
    override fun createViewInstance(context: ThemedReactContext) = AmbientGlowView(context)
    @ReactProp(name = "palette") fun palette(view: AmbientGlowView, colors: ReadableArray?) { view.palette(colors) }
    @ReactProp(name = "bars") fun bars(view: AmbientGlowView, bars: ReadableMap?) { view.bars(bars) }
    @ReactProp(name = "intensity", defaultFloat = 0.35f) fun intensity(view: AmbientGlowView, intensity: Float) { view.strength = intensity }
    @ReactProp(name = "spread", defaultFloat = 1f) fun spread(view: AmbientGlowView, spread: Float) { view.spread = spread }
    @ReactProp(name = "responseMs", defaultFloat = 220f) fun responseMs(view: AmbientGlowView, responseMs: Float) { view.responseMs = responseMs }
    override fun onDropViewInstance(view: AmbientGlowView) {
        view.visibility = View.GONE
        super.onDropViewInstance(view)
    }
}
