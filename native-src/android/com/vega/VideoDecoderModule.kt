package com.vega

import android.content.Context
import android.os.Handler
import android.view.View
import android.view.ViewGroup
import androidx.media3.common.Format
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.video.VideoRendererEventListener
import com.brentvatne.exoplayer.DelayRenderersFactory
import com.brentvatne.exoplayer.ReactExoplayerView
import com.brentvatne.exoplayer.SoftwareVideoRendererProvider
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewManager

class VideoDecoderModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "VideoDecoder"
    private fun findVideo(view: View?): ReactExoplayerView? {
        if (view is ReactExoplayerView) return view
        if (view is ViewGroup) for (i in 0 until view.childCount) findVideo(view.getChildAt(i))?.let { return it }
        return null
    }
    private fun video(tag: Int) = findVideo(UIManagerHelper.getUIManagerForReactTag(reactApplicationContext, tag)?.resolveView(tag))
    @ReactMethod fun getStatus(tag: Int, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            try { promise.resolve(video(tag)?.videoDecoderStatus) }
            catch (error: Exception) { promise.reject("DECODER_STATUS", error.message, error) }
        }
    }
    @ReactMethod fun setMode(tag: Int, mode: String, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            try {
                val view = video(tag) ?: throw IllegalStateException("Video player is unavailable")
                val restarting = view.setVideoDecoderMode(mode)
                val status = view.videoDecoderStatus
                status.putBoolean("restarting", restarting)
                promise.resolve(status)
            } catch (error: Exception) { promise.reject("DECODER_UNAVAILABLE", error.message, error) }
        }
    }
}

class VideoDecoderPackage : ReactPackage {
    @androidx.annotation.OptIn(markerClass = [androidx.media3.common.util.UnstableApi::class])
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> {
        DelayRenderersFactory.setSoftwareVideoRendererProvider(
            FfmpegSoftwareVideoRendererProvider(context.applicationContext),
        )
        return listOf(VideoDecoderModule(context))
    }

    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}

@androidx.media3.common.util.UnstableApi
private class FfmpegSoftwareVideoRendererProvider(
    context: Context,
) : SoftwareVideoRendererProvider {
    private val nativeLibDir: String = context.applicationInfo.nativeLibraryDir ?: ""

    override fun supports(format: Format): Boolean =
        FfmpegVideoDecoder.isFormatSupported(nativeLibDir, format)

    override fun supportsMime(mimeType: String): Boolean =
        FfmpegVideoDecoder.isCodecAvailable(nativeLibDir, mimeType)

    override fun createRenderer(
        allowedVideoJoiningTimeMs: Long,
        eventHandler: Handler,
        eventListener: VideoRendererEventListener,
        maxDroppedFramesToNotify: Int,
    ): Renderer = FfmpegVideoRenderer(
        nativeLibDir,
        allowedVideoJoiningTimeMs,
        eventHandler,
        eventListener,
        maxDroppedFramesToNotify,
    )
}
