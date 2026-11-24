package com.vega

import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class WebViewDataModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = "WebViewDataModule"

    @ReactMethod
    fun clearAll(promise: Promise) {
        Handler(Looper.getMainLooper()).post {
            try {
                try {
                    val cookieManager = CookieManager.getInstance()
                    cookieManager.removeAllCookies(null)
                    cookieManager.flush()
                } catch (e: Exception) {
                    VegaLog.w("WebViewDataModule", "Failed to clear WebView cookies", e)
                }

                try {
                    WebStorage.getInstance().deleteAllData()
                } catch (e: Exception) {
                    VegaLog.w("WebViewDataModule", "Failed to clear WebStorage", e)
                }

                try {
                    val webView = WebView(reactApplicationContext)
                    webView.clearCache(true)
                    webView.clearFormData()
                    webView.clearHistory()
                    webView.destroy()
                } catch (e: Exception) {
                    VegaLog.w("WebViewDataModule", "Failed to clear WebView cache", e)
                }

                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("WEBVIEW_CLEAR_ERROR", e.message, e)
            }
        }
    }
}
