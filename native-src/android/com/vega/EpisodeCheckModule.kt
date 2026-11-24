package com.vega

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.uimanager.ViewManager
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.TimeUnit

private const val EPISODE_CHECK_WORK_NAME = "vega_episode_check"
private const val EPISODE_CHECK_HEADLESS_TASK = "VegaEpisodeCheck"
private const val BACKGROUND_SANDBOX_EVENT = "VegaBackgroundSandboxMessage"

class EpisodeCheckPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(EpisodeCheckModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
        emptyList()
}

class EpisodeCheckModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var backgroundWebView: WebView? = null

    override fun getName(): String = "EpisodeCheck"

    @ReactMethod
    fun schedule(intervalHours: Int, wifiOnly: Boolean, promise: Promise) =
        scheduleCheck(intervalHours.coerceAtLeast(1).toLong(), null, wifiOnly, promise)

    @ReactMethod
    fun scheduleAt(nextAt: Double, wifiOnly: Boolean, promise: Promise) =
        scheduleCheck(24, nextAt.toLong(), wifiOnly, promise)

    private fun scheduleCheck(intervalHours: Long, nextAt: Long?, wifiOnly: Boolean, promise: Promise) {
        try {
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(
                    if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED
                )
                .build()

            val builder = PeriodicWorkRequestBuilder<EpisodeCheckWorker>(intervalHours, TimeUnit.HOURS)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
            if (nextAt == null) {
                builder.clearNextScheduleTimeOverride()
            } else {
                builder.setNextScheduleTimeOverride(nextAt)
            }

            val result = WorkManager.getInstance(reactContext.applicationContext)
                .enqueueUniquePeriodicWork(
                    EPISODE_CHECK_WORK_NAME,
                    ExistingPeriodicWorkPolicy.UPDATE,
                    builder.build(),
                )
                .result
            result.addListener({
                try {
                    result.get()
                    promise.resolve(true)
                } catch (error: Exception) {
                    promise.reject("EPISODE_CHECK_SCHEDULE_ERROR", error.message, error)
                }
            }, reactContext.mainExecutor)
        } catch (error: Throwable) {
            promise.reject("EPISODE_CHECK_SCHEDULE_ERROR", error.message, error)
        }
    }

    @ReactMethod
    fun cancel(promise: Promise) {
        try {
            WorkManager.getInstance(reactContext.applicationContext)
                .cancelUniqueWork(EPISODE_CHECK_WORK_NAME)
            promise.resolve(true)
        } catch (error: Throwable) {
            promise.reject("EPISODE_CHECK_CANCEL_ERROR", error.message, error)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @ReactMethod
    fun startBackgroundSandbox(html: String, baseUrl: String, promise: Promise) {
        mainHandler.post {
            try {
                destroyWebViewOnMain()
                val webView = WebView(reactContext.applicationContext).apply {
                    settings.javaScriptEnabled = true
                    settings.domStorageEnabled = false
                    settings.allowFileAccess = false
                    settings.allowContentAccess = false
                    settings.cacheMode = WebSettings.LOAD_NO_CACHE
                    settings.setSupportMultipleWindows(false)
                    settings.javaScriptCanOpenWindowsAutomatically = false
                    settings.mediaPlaybackRequiresUserGesture = true
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView?,
                            request: WebResourceRequest?,
                        ): Boolean {
                            val target = request?.url?.toString() ?: return true
                            return target != baseUrl && target != "about:blank"
                        }
                    }
                    addJavascriptInterface(
                        BackgroundSandboxBridge(reactContext),
                        "ReactNativeWebView",
                    )
                    loadDataWithBaseURL(baseUrl, html, "text/html", "utf-8", null)
                }
                backgroundWebView = webView
                promise.resolve(true)
            } catch (error: Throwable) {
                promise.reject("BACKGROUND_SANDBOX_START_ERROR", error.message, error)
            }
        }
    }

    @ReactMethod
    fun injectBackgroundSandbox(script: String) {
        mainHandler.post {
            backgroundWebView?.evaluateJavascript(script, null)
        }
    }

    @ReactMethod
    fun stopBackgroundSandbox(promise: Promise) {
        mainHandler.post {
            try {
                destroyWebViewOnMain()
                promise.resolve(true)
            } catch (error: Throwable) {
                promise.reject("BACKGROUND_SANDBOX_STOP_ERROR", error.message, error)
            }
        }
    }

    override fun invalidate() {
        mainHandler.post {
            destroyWebViewOnMain()
        }
        super.invalidate()
    }

    private fun destroyWebViewOnMain() {
        val current = backgroundWebView ?: return
        backgroundWebView = null
        try {
            current.stopLoading()
            current.removeJavascriptInterface("ReactNativeWebView")
            current.loadUrl("about:blank")
            current.destroy()
        } catch (_: Throwable) {
        }
    }

    private class BackgroundSandboxBridge(
        private val context: ReactApplicationContext,
    ) {
        @JavascriptInterface
        fun postMessage(data: String) {
            if (!context.hasActiveReactInstance()) return
            context
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(BACKGROUND_SANDBOX_EVENT, data)
        }
    }
}

class EpisodeCheckWorker(
    appContext: Context,
    params: WorkerParameters,
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val reactApp = applicationContext as? ReactApplication ?: return Result.failure()
        val reactHost = reactApp.reactHost ?: return Result.failure()

        var reactContext = reactHost.currentReactContext
        if (reactContext == null) {
            val ready = CompletableDeferred<ReactContext?>()
            val listener = object : ReactInstanceEventListener {
                override fun onReactContextInitialized(context: ReactContext) {
                    reactHost.removeReactInstanceEventListener(this)
                    ready.complete(context)
                }
            }
            withContext(Dispatchers.Main) {
                reactHost.addReactInstanceEventListener(listener)
                reactHost.start()
                reactHost.currentReactContext?.let { existing ->
                    reactHost.removeReactInstanceEventListener(listener)
                    ready.complete(existing)
                }
            }
            reactContext = withTimeoutOrNull(25_000L) { ready.await() }
            if (reactContext == null) {
                withContext(Dispatchers.Main) {
                    reactHost.removeReactInstanceEventListener(listener)
                }
                return Result.retry()
            }
        }

        val finished = CompletableDeferred<Unit>()
        var taskId = -1
        val headlessContext = HeadlessJsTaskContext.getInstance(reactContext)
        val taskListener = object : HeadlessJsTaskEventListener {
            override fun onHeadlessJsTaskStart(id: Int) {}
            override fun onHeadlessJsTaskFinish(id: Int) {
                if (id == taskId) {
                    finished.complete(Unit)
                }
            }
        }

        withContext(Dispatchers.Main) {
            headlessContext.addTaskEventListener(taskListener)
            val config = HeadlessJsTaskConfig(
                EPISODE_CHECK_HEADLESS_TASK,
                Arguments.createMap(),
                120_000L,
                true,
            )
            taskId = headlessContext.startTask(config)
        }

        try {
            withTimeoutOrNull(130_000L) { finished.await() }
        } finally {
            withContext(Dispatchers.Main) {
                headlessContext.removeTaskEventListener(taskListener)
            }
        }

        return Result.success()
    }
}
