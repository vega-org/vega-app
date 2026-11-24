package com.vega

import android.animation.ValueAnimator
import android.app.Activity
import android.app.Application
import android.app.Dialog
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.Animatable2
import android.graphics.drawable.AnimatedVectorDrawable
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.ContextThemeWrapper
import android.view.Gravity
import android.view.View
import android.view.ViewTreeObserver.OnPreDrawListener
import android.view.WindowManager
import android.view.animation.AccelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import androidx.annotation.RequiresApi
import androidx.annotation.StyleRes
import androidx.core.content.ContextCompat
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import com.zoontek.rnbootsplash.R as BootSplashR

/**
 * Plays the API 31+ animated splash vector in a full-screen Dialog after the
 * launcher transition completes, then fades out once both the animation and JS
 * hide request have completed.
 */
internal object AnimatedSplashHandoff {
    private const val DRAW_DURATION_MS = 1100L
    private const val ENTER_ANIMATION_FALLBACK_MS = 650L
    private const val ANIMATION_END_BUFFER_MS = 300L
    private const val FADE_OUT_DURATION_MS = 200L
    private const val HARD_CAP_MS = 3500L

    private val mainHandler = Handler(Looper.getMainLooper())
    private val pendingPromises = mutableListOf<Promise>()

    private var active = false
    private var currentActivity: Activity? = null
    private var lifecycleCallbacks: Application.ActivityLifecycleCallbacks? = null
    private var dialog: AnimatedSplashDialog? = null
    private var container: FrameLayout? = null
    private var animatedDrawable: AnimatedVectorDrawable? = null
    private var animationCallback: Animatable2.AnimationCallback? = null

    private var dialogShown = false
    private var enterAnimationCompleted = false
    private var animationStarted = false
    private var animationFinished = false
    private var hideRequested = false
    private var hideFade = true
    private var hiding = false

    private val enterFallbackRunnable = Runnable {
        if (active && !animationStarted) {
            startAnimationIfReady()
        }
    }

    private val animationEndFallbackRunnable = Runnable {
        onAnimationFinished()
    }

    private val hardCapRunnable = Runnable {
        if (!active) return@Runnable
        animationFinished = true
        hideRequested = true
        maybeDismiss()
    }

    fun install(activity: Activity, @StyleRes bootTheme: Int): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
        if (!ValueAnimator.areAnimatorsEnabled()) return false

        val avd = loadAnimatedDrawable(activity, bootTheme) ?: return false
        val backgroundColor = resolveBackgroundColor(activity, bootTheme)

        finishAndCleanup()

        applyPostBootSplashTheme(activity)
        setupSplashExit(activity)

        active = true
        currentActivity = activity
        animatedDrawable = avd
        dialogShown = false
        enterAnimationCompleted = false
        animationStarted = false
        animationFinished = false
        hideRequested = false
        hideFade = true
        hiding = false

        holdFirstFrameUntilDialogShown(activity)
        registerDestroyCleanup(activity)

        val splashContainer = createSplashContainer(activity, backgroundColor, avd)
        val splashDialog = AnimatedSplashDialog(activity, bootTheme, splashContainer)
        container = splashContainer
        dialog = splashDialog

        mainHandler.post {
            if (!active || activity.isFinishing || activity.isDestroyed) {
                finishAndCleanup()
                return@post
            }
            splashDialog.showWithCallback {
                if (!active) return@showWithCallback
                dialogShown = true
                mainHandler.postDelayed(enterFallbackRunnable, ENTER_ANIMATION_FALLBACK_MS)
                mainHandler.postDelayed(hardCapRunnable, HARD_CAP_MS)
                if (enterAnimationCompleted) {
                    startAnimationIfReady()
                }
            }
        }

        return true
    }

    fun onEnterAnimationComplete(activity: Activity) {
        mainHandler.post {
            if (!active || activity !== currentActivity) return@post
            enterAnimationCompleted = true
            startAnimationIfReady()
        }
    }

    fun requestHide(fade: Boolean, promise: Promise? = null) {
        mainHandler.post {
            if (!active) {
                promise?.resolve(true)
                return@post
            }
            if (promise != null) {
                pendingPromises.add(promise)
            }
            if (!hideRequested) {
                hideFade = fade
            } else if (!fade) {
                hideFade = false
            }
            hideRequested = true
            maybeDismiss()
        }
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun setupSplashExit(activity: Activity) {
        val splash = activity.splashScreen
        splash.setOnExitAnimationListener { view ->
            view.remove()
            splash.clearOnExitAnimationListener()
        }
    }

    private fun applyPostBootSplashTheme(activity: Activity) {
        val typedValue = TypedValue()
        if (activity.theme.resolveAttribute(BootSplashR.attr.postBootSplashTheme, typedValue, true)) {
            if (typedValue.resourceId != 0) {
                activity.setTheme(typedValue.resourceId)
            }
        }
    }

    private fun resolveBackgroundColor(activity: Activity, @StyleRes bootTheme: Int): Int {
        val themed = ContextThemeWrapper(activity, bootTheme)
        val typedValue = TypedValue()
        if (themed.theme.resolveAttribute(BootSplashR.attr.bootSplashBackground, typedValue, true)) {
            if (typedValue.type in TypedValue.TYPE_FIRST_COLOR_INT..TypedValue.TYPE_LAST_COLOR_INT) {
                return typedValue.data
            }
            if (typedValue.resourceId != 0) {
                return ContextCompat.getColor(themed, typedValue.resourceId)
            }
        }
        return ContextCompat.getColor(activity, R.color.bootsplash_background)
    }

    private fun loadAnimatedDrawable(
        activity: Activity,
        @StyleRes bootTheme: Int,
    ): AnimatedVectorDrawable? {
        val drawableRes = when (bootTheme) {
            R.style.BootTheme_Tomato -> R.drawable.bootsplash_animated_tomato
            R.style.BootTheme_Gray -> R.drawable.bootsplash_animated_gray
            R.style.BootTheme_Blue -> R.drawable.bootsplash_animated_blue
            R.style.BootTheme_Lavender -> R.drawable.bootsplash_animated_lavender
            else -> R.drawable.bootsplash_animated_white
        }
        return ContextCompat.getDrawable(activity, drawableRes)?.mutate() as? AnimatedVectorDrawable
    }

    private fun createSplashContainer(
        activity: Activity,
        backgroundColor: Int,
        avd: AnimatedVectorDrawable,
    ): FrameLayout {
        val imageView = ImageView(activity).apply {
            setImageDrawable(avd)
            scaleType = ImageView.ScaleType.CENTER
        }
        val logoParams = FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.CENTER,
        )
        return FrameLayout(activity).apply {
            setBackgroundColor(backgroundColor)
            addView(imageView, logoParams)
        }
    }

    private fun holdFirstFrameUntilDialogShown(activity: Activity) {
        val contentView = activity.findViewById<View>(android.R.id.content) ?: return
        contentView.viewTreeObserver.addOnPreDrawListener(object : OnPreDrawListener {
            override fun onPreDraw(): Boolean {
                if (active && !dialogShown) {
                    return false
                }
                contentView.viewTreeObserver.removeOnPreDrawListener(this)
                return true
            }
        })
    }

    private fun registerDestroyCleanup(activity: Activity) {
        val callbacks = object : Application.ActivityLifecycleCallbacks {
            override fun onActivityDestroyed(destroyed: Activity) {
                if (destroyed === currentActivity) {
                    finishAndCleanup()
                }
            }
            override fun onActivityCreated(a: Activity, s: Bundle?) = Unit
            override fun onActivityStarted(a: Activity) = Unit
            override fun onActivityResumed(a: Activity) = Unit
            override fun onActivityPaused(a: Activity) = Unit
            override fun onActivityStopped(a: Activity) = Unit
            override fun onActivitySaveInstanceState(a: Activity, outState: Bundle) = Unit
        }
        lifecycleCallbacks = callbacks
        activity.application.registerActivityLifecycleCallbacks(callbacks)
    }

    private fun startAnimationIfReady() {
        if (!active || !dialogShown || animationStarted) return
        val avd = animatedDrawable ?: run {
            onAnimationFinished()
            return
        }
        animationStarted = true
        mainHandler.removeCallbacks(enterFallbackRunnable)

        val callback = object : Animatable2.AnimationCallback() {
            override fun onAnimationEnd(drawable: Drawable?) {
                mainHandler.post { onAnimationFinished() }
            }
        }
        animationCallback = callback
        avd.registerAnimationCallback(callback)
        mainHandler.postDelayed(animationEndFallbackRunnable, DRAW_DURATION_MS + ANIMATION_END_BUFFER_MS)
        avd.start()
    }

    private fun onAnimationFinished() {
        if (!active || animationFinished) return
        animationFinished = true
        mainHandler.removeCallbacks(animationEndFallbackRunnable)
        maybeDismiss()
    }

    private fun maybeDismiss() {
        if (!active || hiding || !animationFinished || !hideRequested) return
        hiding = true
        mainHandler.removeCallbacks(hardCapRunnable)

        val splashContainer = container
        if (hideFade && splashContainer != null) {
            splashContainer
                .animate()
                .alpha(0f)
                .setDuration(FADE_OUT_DURATION_MS)
                .setInterpolator(AccelerateInterpolator())
                .withLayer()
                .withEndAction { finishAndCleanup() }
                .start()
        } else {
            finishAndCleanup()
        }
    }

    private fun finishAndCleanup() {
        mainHandler.removeCallbacks(enterFallbackRunnable)
        mainHandler.removeCallbacks(animationEndFallbackRunnable)
        mainHandler.removeCallbacks(hardCapRunnable)

        animatedDrawable?.let { avd ->
            animationCallback?.let { avd.unregisterAnimationCallback(it) }
            if (avd.isRunning) {
                avd.stop()
            }
        }
        animationCallback = null
        animatedDrawable = null

        container?.animate()?.cancel()
        container = null

        dialog?.let { splashDialog ->
            if (splashDialog.isShowing) {
                runCatching { splashDialog.dismiss() }
            }
        }
        dialog = null

        val activity = currentActivity
        val callbacks = lifecycleCallbacks
        if (activity != null && callbacks != null) {
            activity.application.unregisterActivityLifecycleCallbacks(callbacks)
        }
        lifecycleCallbacks = null
        currentActivity = null

        active = false
        hiding = false
        dialogShown = false
        enterAnimationCompleted = false
        animationStarted = false
        animationFinished = false
        hideRequested = false
        hideFade = true

        if (pendingPromises.isNotEmpty()) {
            val toResolve = pendingPromises.toList()
            pendingPromises.clear()
            for (promise in toResolve) {
                promise.resolve(true)
            }
        }
    }
}

private class AnimatedSplashDialog(
    activity: Activity,
    @StyleRes themeResId: Int,
    private val splashContent: View,
) : Dialog(activity, themeResId) {
    init {
        setOwnerActivity(activity)
        setCancelable(false)
        setCanceledOnTouchOutside(false)
    }

    @Deprecated("Deprecated in favor of OnBackPressedCallback")
    override fun onBackPressed() {
        ownerActivity?.moveTaskToBack(true)
    }

    fun showWithCallback(onShown: () -> Unit) {
        if (!isShowing) {
            setOnShowListener { onShown() }
            runCatching { super.show() }.onFailure { onShown() }
        } else {
            onShown()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        window?.apply {
            setFormat(PixelFormat.TRANSLUCENT)
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            setLayout(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
            )
            setWindowAnimations(BootSplashR.style.BootSplashNoAnimation)
        }
        super.onCreate(savedInstanceState)
        setContentView(
            splashContent,
            WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
            ),
        )
    }
}

class AnimatedSplashModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    override fun getName(): String = "AnimatedSplash"

    @ReactMethod
    fun hide(fade: Boolean, promise: Promise) {
        AnimatedSplashHandoff.requestHide(fade, promise)
    }
}

class AnimatedSplashPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(AnimatedSplashModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
