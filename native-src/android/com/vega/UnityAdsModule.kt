package com.vega

import android.os.Handler
import android.os.Looper
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager
import com.unity3d.ads.IUnityAdsInitializationListener
import com.unity3d.ads.IUnityAdsLoadListener
import com.unity3d.ads.IUnityAdsShowListener
import com.unity3d.ads.UnityAds
import com.unity3d.ads.UnityAdsShowOptions

/**
 * Thin bridge over the Unity Ads Android SDK (interstitial/video only).
 *
 * Every method resolves its promise exactly once and never throws into JS, so
 * an ad failure can never break playback or downloads.
 */
class UnityAdsModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val main = Handler(Looper.getMainLooper())

    override fun getName() = "VegaUnityAds"

    @ReactMethod
    fun initialize(gameId: String, testMode: Boolean, promise: Promise) {
        main.post {
            try {
                if (UnityAds.isInitialized()) {
                    promise.resolve(true)
                    return@post
                }
                UnityAds.initialize(
                    reactContext.applicationContext,
                    gameId,
                    testMode,
                    object : IUnityAdsInitializationListener {
                        override fun onInitializationComplete() {
                            promise.resolve(true)
                        }

                        override fun onInitializationFailed(
                            error: UnityAds.UnityAdsInitializationError?,
                            message: String?,
                        ) {
                            promise.resolve(false)
                        }
                    },
                )
            } catch (e: Throwable) {
                promise.resolve(false)
            }
        }
    }

    @ReactMethod
    fun load(placementId: String, promise: Promise) {
        main.post {
            try {
                if (!UnityAds.isInitialized()) {
                    promise.resolve(false)
                    return@post
                }
                UnityAds.load(
                    placementId,
                    object : IUnityAdsLoadListener {
                        override fun onUnityAdsAdLoaded(placementId: String?) {
                            promise.resolve(true)
                        }

                        override fun onUnityAdsFailedToLoad(
                            placementId: String?,
                            error: UnityAds.UnityAdsLoadError?,
                            message: String?,
                        ) {
                            promise.resolve(false)
                        }
                    },
                )
            } catch (e: Throwable) {
                promise.resolve(false)
            }
        }
    }

    /** Resolves "completed", "skipped", "clicked" is folded into completion, or "failed". */
    @ReactMethod
    fun show(placementId: String, promise: Promise) {
        main.post {
            try {
                val activity = reactContext.currentActivity
                if (activity == null || !UnityAds.isInitialized()) {
                    promise.resolve("failed")
                    return@post
                }
                UnityAds.show(
                    activity,
                    placementId,
                    UnityAdsShowOptions(),
                    object : IUnityAdsShowListener {
                        override fun onUnityAdsShowFailure(
                            placementId: String?,
                            error: UnityAds.UnityAdsShowError?,
                            message: String?,
                        ) {
                            promise.resolve("failed")
                        }

                        override fun onUnityAdsShowStart(placementId: String?) {}

                        override fun onUnityAdsShowClick(placementId: String?) {}

                        override fun onUnityAdsShowComplete(
                            placementId: String?,
                            state: UnityAds.UnityAdsShowCompletionState?,
                        ) {
                            promise.resolve(
                                if (state == UnityAds.UnityAdsShowCompletionState.COMPLETED) "completed"
                                else "skipped",
                            )
                        }
                    },
                )
            } catch (e: Throwable) {
                promise.resolve("failed")
            }
        }
    }
}

class UnityAdsPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(UnityAdsModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}
