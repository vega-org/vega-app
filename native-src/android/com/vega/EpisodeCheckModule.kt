package com.vega

import android.Manifest
import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
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
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.TimeUnit

private const val EPISODE_CHECK_WORK_NAME = "vega_episode_check"
private const val EPISODE_CHECK_CUSTOM_WORK_NAME = "vega_episode_check_custom"
private const val EPISODE_CHECK_HEADLESS_TASK = "VegaEpisodeCheck"
private const val BACKGROUND_SANDBOX_EVENT = "VegaBackgroundSandboxMessage"
private const val BACKGROUND_SANDBOX_RELOAD_EVENT = "VegaBackgroundSandboxReload"
private const val TAG = "EpisodeCheck"

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

    private fun emitBackgroundEvent(event: String, data: String) {
        if (!reactContext.hasActiveReactInstance()) return
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(event, data)
    }

    @ReactMethod
    fun schedule(intervalHours: Int, wifiOnly: Boolean, promise: Promise) {
        try {
            val workManager = WorkManager.getInstance(reactContext.applicationContext)
            workManager.cancelUniqueWork(EPISODE_CHECK_CUSTOM_WORK_NAME)

            val request = PeriodicWorkRequestBuilder<EpisodeCheckWorker>(
                intervalHours.coerceAtLeast(1).toLong(),
                TimeUnit.HOURS,
            )
                .setConstraints(buildConstraints(wifiOnly))
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
                .build()

            val result = workManager
                .enqueueUniquePeriodicWork(
                    EPISODE_CHECK_WORK_NAME,
                    ExistingPeriodicWorkPolicy.UPDATE,
                    request,
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
    fun scheduleAt(nextAt: Double, wifiOnly: Boolean, promise: Promise) {
        try {
            val workManager = WorkManager.getInstance(reactContext.applicationContext)
            workManager.cancelUniqueWork(EPISODE_CHECK_WORK_NAME)

            val delayMs = (nextAt.toLong() - System.currentTimeMillis()).coerceAtLeast(0L)
            val request = OneTimeWorkRequestBuilder<EpisodeCheckWorker>()
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .setConstraints(buildConstraints(wifiOnly))
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.MINUTES)
                .build()

            val result = workManager
                .enqueueUniqueWork(
                    EPISODE_CHECK_CUSTOM_WORK_NAME,
                    ExistingWorkPolicy.REPLACE,
                    request,
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

    private fun buildConstraints(wifiOnly: Boolean): Constraints =
        Constraints.Builder()
            .setRequiredNetworkType(
                if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED
            )
            .build()

    @ReactMethod
    fun cancel(promise: Promise) {
        try {
            val workManager = WorkManager.getInstance(reactContext.applicationContext)
            workManager.cancelUniqueWork(EPISODE_CHECK_WORK_NAME)
            workManager.cancelUniqueWork(EPISODE_CHECK_CUSTOM_WORK_NAME)
            promise.resolve(true)
        } catch (error: Throwable) {
            promise.reject("EPISODE_CHECK_CANCEL_ERROR", error.message, error)
        }
    }

    @ReactMethod
    fun isIgnoringBatteryOptimizations(promise: Promise) {
        try {
            val pm =
                reactContext.applicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
            val ignoring = pm?.isIgnoringBatteryOptimizations(reactContext.packageName) ?: false
            promise.resolve(ignoring)
        } catch (error: Throwable) {
            promise.reject("BATTERY_OPTIMIZATION_CHECK_ERROR", error.message, error)
        }
    }

    @SuppressLint("BatteryLife")
    @ReactMethod
    fun requestIgnoreBatteryOptimizations(promise: Promise) {
        mainHandler.post {
            try {
                val pkg = reactContext.packageName
                val pm =
                    reactContext.applicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
                val alreadyIgnoring = pm?.isIgnoringBatteryOptimizations(pkg) == true
                val hasDirectPermission =
                    ContextCompat.checkSelfPermission(
                        reactContext,
                        Manifest.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    ) == PackageManager.PERMISSION_GRANTED

                val intents = mutableListOf<Intent>()
                if (!alreadyIgnoring && hasDirectPermission) {
                    intents.add(
                        Intent(
                            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                            Uri.parse("package:$pkg"),
                        ),
                    )
                }
                intents.add(
                    Intent(
                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                        Uri.parse("package:$pkg"),
                    ),
                )
                intents.add(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))

                val activity = reactContext.currentActivity
                var launched = false
                for (intent in intents) {
                    try {
                        if (activity != null) {
                            activity.startActivity(intent)
                        } else {
                            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            reactContext.applicationContext.startActivity(intent)
                        }
                        launched = true
                        break
                    } catch (_: ActivityNotFoundException) {
                    } catch (_: SecurityException) {
                    }
                }
                promise.resolve(launched)
            } catch (error: Throwable) {
                promise.reject("BATTERY_OPTIMIZATION_REQUEST_ERROR", error.message, error)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "NewApi")
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
                    webChromeClient = object : WebChromeClient() {
                        override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                            val level = consoleMessage?.messageLevel()
                            if (
                                level == ConsoleMessage.MessageLevel.ERROR ||
                                level == ConsoleMessage.MessageLevel.WARNING
                            ) {
                                VegaLog.w(
                                    TAG,
                                    "Background sandbox console [$level]: ${consoleMessage.message()}",
                                )
                            }
                            return false
                        }
                    }
                    webViewClient = object : WebViewClient() {
                        override fun shouldOverrideUrlLoading(
                            view: WebView?,
                            request: WebResourceRequest?,
                        ): Boolean {
                            val target = request?.url?.toString() ?: return true
                            return target != baseUrl && target != "about:blank"
                        }

                        override fun onReceivedError(
                            view: WebView?,
                            request: WebResourceRequest?,
                            error: WebResourceError?,
                        ) {
                            if (request?.isForMainFrame == true) {
                                VegaLog.w(
                                    TAG,
                                    "Background sandbox load error (${error?.errorCode}): ${error?.description}",
                                )
                            }
                        }

                        override fun onRenderProcessGone(
                            view: WebView?,
                            detail: RenderProcessGoneDetail?,
                        ): Boolean {
                            val crashed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                detail?.didCrash() == true
                            } else {
                                false
                            }
                            VegaLog.w(
                                TAG,
                                "Background sandbox render process gone (didCrash=$crashed)",
                            )
                            if (view === backgroundWebView) {
                                destroyWebViewOnMain()
                            }
                            emitBackgroundEvent(
                                BACKGROUND_SANDBOX_RELOAD_EVENT,
                                "render-process-gone",
                            )
                            return true
                        }
                    }
                    if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                        WebViewCompat.addWebMessageListener(
                            this,
                            "ReactNativeWebView",
                            setOf("*"),
                        ) { _, message, _, _, _ ->
                            val data = message.data ?: return@addWebMessageListener
                            emitBackgroundEvent(BACKGROUND_SANDBOX_EVENT, data)
                        }
                    } else {
                        addJavascriptInterface(
                            BackgroundSandboxBridge(reactContext),
                            "ReactNativeWebView",
                        )
                    }
                }
                backgroundWebView = webView
                webView.onResume()
                webView.resumeTimers()
                webView.loadDataWithBaseURL(baseUrl, html, "text/html", "utf-8", null)
                promise.resolve(true)
            } catch (error: Throwable) {
                destroyWebViewOnMain()
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
        runCatching { current.stopLoading() }
        runCatching {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                WebViewCompat.removeWebMessageListener(current, "ReactNativeWebView")
            } else {
                current.removeJavascriptInterface("ReactNativeWebView")
            }
        }
        runCatching { current.loadUrl("about:blank") }
        runCatching { current.destroy() }
    }

    class BackgroundSandboxBridge(
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
                300_000L,
                true,
            )
            taskId = headlessContext.startTask(config)
        }

        try {
            withTimeoutOrNull(310_000L) { finished.await() }
        } finally {
            withContext(NonCancellable + Dispatchers.Main) {
                headlessContext.removeTaskEventListener(taskListener)
            }
        }

        return Result.success()
    }
}
