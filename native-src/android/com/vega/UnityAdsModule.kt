package com.vega

import android.app.Activity
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import com.unity3d.mediation.LevelPlay
import com.unity3d.mediation.LevelPlayAdError
import com.unity3d.mediation.LevelPlayAdInfo
import com.unity3d.mediation.LevelPlayConfiguration
import com.unity3d.mediation.LevelPlayInitError
import com.unity3d.mediation.LevelPlayInitListener
import com.unity3d.mediation.LevelPlayInitRequest
import com.unity3d.mediation.interstitial.LevelPlayInterstitialAd
import com.unity3d.mediation.interstitial.LevelPlayInterstitialAdListener
import com.unity3d.mediation.rewarded.LevelPlayReward
import com.unity3d.mediation.rewarded.LevelPlayRewardedAd
import com.unity3d.mediation.rewarded.LevelPlayRewardedAdListener

/**
 * Thin bridge over the Unity LevelPlay (ironSource) Android SDK. Supports one
 * interstitial and one rewarded ad unit.
 *
 * Every method resolves its promise exactly once and never throws into JS, so
 * an ad failure can never break playback or downloads. All state is touched on
 * the main thread only (the SDK also calls its listeners there).
 */
class UnityAdsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val main = Handler(Looper.getMainLooper())

    private var initialized = false
    private var initializing = false
    private var debug = false
    private var debugToastsLeft = 4
    private val initWaiters = ArrayList<(Boolean) -> Unit>()
    private val slots = HashMap<String, Slot>()

    override fun getName() = "VegaUnityAds"

    /** One ad object (interstitial or rewarded) plus who is waiting on it. */
    private class Slot {
        val loadWaiters = ArrayList<(Boolean) -> Unit>()
        var showWaiter: ((String) -> Unit)? = null
        var rewarded = false
        var isReady: () -> Boolean = { false }
        var load: () -> Unit = {}
        var show: (Activity) -> Unit = {}

        fun finishLoad(ok: Boolean) {
            val waiters = ArrayList(loadWaiters)
            loadWaiters.clear()
            waiters.forEach { it(ok) }
        }

        fun finishShow(result: String) {
            val waiter = showWaiter
            showWaiter = null
            waiter?.invoke(result)
        }
    }

    /** Resolves a promise at most once, so a late callback or timeout is harmless. */
    private class Once(private val promise: Promise) {
        private var done = false

        fun resolve(value: Any) {
            if (done) return
            done = true
            promise.resolve(value)
        }
    }

    /** Short on-screen message (debug builds only) saying why an ad failed. */
    private fun debugToast(message: String) {
        if (!debug || debugToastsLeft <= 0) return
        debugToastsLeft -= 1
        try {
            Toast.makeText(reactContext.applicationContext, message, Toast.LENGTH_LONG).show()
        } catch (e: Throwable) {
            // A toast problem must never affect the app.
        }
    }

    private fun finishInit(ok: Boolean) {
        initializing = false
        initialized = ok
        val waiters = ArrayList(initWaiters)
        initWaiters.clear()
        waiters.forEach { it(ok) }
    }

    @ReactMethod
    fun initialize(appKey: String, debug: Boolean, promise: Promise) {
        main.post {
            try {
                this.debug = debug
                if (initialized) {
                    promise.resolve(true)
                    return@post
                }
                val once = Once(promise)
                initWaiters.add { ok -> once.resolve(ok) }
                main.postDelayed({ once.resolve(false) }, INIT_TIMEOUT_MS)
                if (initializing) return@post
                initializing = true
                val request = LevelPlayInitRequest.Builder(appKey).build()
                LevelPlay.init(
                    reactContext.currentActivity ?: reactContext.applicationContext,
                    request,
                    object : LevelPlayInitListener {
                        override fun onInitSuccess(configuration: LevelPlayConfiguration) {
                            finishInit(true)
                        }

                        override fun onInitFailed(error: LevelPlayInitError) {
                            debugToast("Ads init failed: ${error.errorCode} ${error.errorMessage}")
                            finishInit(false)
                        }
                    },
                )
            } catch (e: Throwable) {
                finishInit(false)
            }
        }
    }

    private fun slotFor(kind: String, adUnitId: String): Slot? {
        val key = "$kind:$adUnitId"
        slots[key]?.let { return it }
        val slot = Slot()
        when (kind) {
            "interstitial" -> {
                val ad = LevelPlayInterstitialAd(adUnitId)
                ad.setListener(
                    object : LevelPlayInterstitialAdListener {
                        override fun onAdLoaded(adInfo: LevelPlayAdInfo) {
                            slot.finishLoad(true)
                        }

                        override fun onAdLoadFailed(error: LevelPlayAdError) {
                            debugToast("$kind ad load failed: ${error.errorCode} ${error.errorMessage}")
                            slot.finishLoad(false)
                        }

                        override fun onAdDisplayed(adInfo: LevelPlayAdInfo) {}

                        override fun onAdDisplayFailed(
                            error: LevelPlayAdError,
                            adInfo: LevelPlayAdInfo,
                        ) {
                            debugToast("$kind ad show failed: ${error.errorCode} ${error.errorMessage}")
                            slot.finishShow("failed")
                        }

                        override fun onAdClicked(adInfo: LevelPlayAdInfo) {}

                        override fun onAdClosed(adInfo: LevelPlayAdInfo) {
                            slot.finishShow("completed")
                        }

                        override fun onAdInfoChanged(adInfo: LevelPlayAdInfo) {}
                    },
                )
                slot.isReady = { ad.isAdReady() }
                slot.load = { ad.loadAd() }
                slot.show = { activity -> ad.showAd(activity) }
            }
            "rewarded" -> {
                val ad = LevelPlayRewardedAd(adUnitId)
                ad.setListener(
                    object : LevelPlayRewardedAdListener {
                        override fun onAdLoaded(adInfo: LevelPlayAdInfo) {
                            slot.finishLoad(true)
                        }

                        override fun onAdLoadFailed(error: LevelPlayAdError) {
                            debugToast("$kind ad load failed: ${error.errorCode} ${error.errorMessage}")
                            slot.finishLoad(false)
                        }

                        override fun onAdDisplayed(adInfo: LevelPlayAdInfo) {}

                        override fun onAdRewarded(reward: LevelPlayReward, adInfo: LevelPlayAdInfo) {
                            slot.rewarded = true
                        }

                        override fun onAdDisplayFailed(
                            error: LevelPlayAdError,
                            adInfo: LevelPlayAdInfo,
                        ) {
                            debugToast("$kind ad show failed: ${error.errorCode} ${error.errorMessage}")
                            slot.finishShow("failed")
                        }

                        override fun onAdClicked(adInfo: LevelPlayAdInfo) {}

                        override fun onAdClosed(adInfo: LevelPlayAdInfo) {
                            slot.finishShow(if (slot.rewarded) "completed" else "skipped")
                        }

                        override fun onAdInfoChanged(adInfo: LevelPlayAdInfo) {}
                    },
                )
                slot.isReady = { ad.isAdReady() }
                slot.load = { ad.loadAd() }
                slot.show = { activity -> ad.showAd(activity) }
            }
            else -> return null
        }
        slots[key] = slot
        return slot
    }

    /** kind is "interstitial" or "rewarded". Resolves true once an ad is ready. */
    @ReactMethod
    fun load(kind: String, adUnitId: String, promise: Promise) {
        main.post {
            try {
                if (!initialized) {
                    promise.resolve(false)
                    return@post
                }
                val slot = slotFor(kind, adUnitId)
                if (slot == null) {
                    promise.resolve(false)
                    return@post
                }
                if (slot.isReady()) {
                    promise.resolve(true)
                    return@post
                }
                val once = Once(promise)
                val waiter: (Boolean) -> Unit = { ok -> once.resolve(ok) }
                val first = slot.loadWaiters.isEmpty()
                slot.loadWaiters.add(waiter)
                // A load that never calls back must not block later loads.
                main.postDelayed(
                    {
                        slot.loadWaiters.remove(waiter)
                        once.resolve(false)
                    },
                    LOAD_TIMEOUT_MS,
                )
                if (first) slot.load()
            } catch (e: Throwable) {
                promise.resolve(false)
            }
        }
    }

    /** Resolves "completed", "skipped" (rewarded ad closed early) or "failed". */
    @ReactMethod
    fun show(kind: String, adUnitId: String, promise: Promise) {
        main.post {
            try {
                val activity = reactContext.currentActivity
                val slot = if (initialized) slots["$kind:$adUnitId"] else null
                if (activity == null || slot == null || slot.showWaiter != null || !slot.isReady()) {
                    promise.resolve("failed")
                    return@post
                }
                val once = Once(promise)
                val waiter: (String) -> Unit = { result -> once.resolve(result) }
                slot.rewarded = false
                slot.showWaiter = waiter
                main.postDelayed(
                    {
                        if (slot.showWaiter === waiter) slot.showWaiter = null
                        once.resolve("failed")
                    },
                    SHOW_TIMEOUT_MS,
                )
                slot.show(activity)
            } catch (e: Throwable) {
                promise.resolve("failed")
            }
        }
    }

    private companion object {
        const val INIT_TIMEOUT_MS = 20_000L
        const val LOAD_TIMEOUT_MS = 30_000L
        const val SHOW_TIMEOUT_MS = 5 * 60_000L
    }
}

class UnityAdsPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(UnityAdsModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}

