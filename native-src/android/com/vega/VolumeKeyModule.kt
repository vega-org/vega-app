package com.vega

import android.app.Activity
import android.view.KeyEvent
import android.view.Window
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Sends the hardware volume keys to JS instead of the phone volume while
 * capture is on. Works only while a Vega activity is in the foreground,
 * because only the focused window receives key events.
 */
class VolumeKeyModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    @Volatile
    private var capturing = false

    private inner class VolumeKeyCallback(val original: Window.Callback) : Window.Callback by original {
        override fun dispatchKeyEvent(event: KeyEvent): Boolean {
            val direction = when (event.keyCode) {
                KeyEvent.KEYCODE_VOLUME_UP -> 1
                KeyEvent.KEYCODE_VOLUME_DOWN -> -1
                else -> 0
            }
            if (!capturing || direction == 0) return original.dispatchKeyEvent(event)
            // Consume both down and up so the phone volume panel never shows.
            if (event.action == KeyEvent.ACTION_DOWN && reactApplicationContext.hasActiveReactInstance()) {
                val params = Arguments.createMap().apply { putInt("direction", direction) }
                reactApplicationContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("onVegaVolumeKey", params)
            }
            return true
        }
    }

    init {
        reactContext.addLifecycleEventListener(this)
    }

    override fun getName(): String = "VegaVolumeKeys"

    @ReactMethod
    fun setCaptureEnabled(enabled: Boolean) {
        capturing = enabled
        if (enabled) reactApplicationContext.currentActivity?.let { activity ->
            activity.runOnUiThread { install(activity) }
        }
    }

    @ReactMethod
    fun addListener(eventName: String) {}

    @ReactMethod
    fun removeListeners(count: Int) {}

    private fun install(activity: Activity) {
        val window = activity.window ?: return
        val current = window.callback ?: return
        if (current is VolumeKeyCallback) return
        window.callback = VolumeKeyCallback(current)
    }

    override fun onHostResume() {
        if (capturing) reactApplicationContext.currentActivity?.let(::install)
    }

    override fun onHostPause() {}

    override fun onHostDestroy() {}
}
