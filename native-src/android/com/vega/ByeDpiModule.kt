package com.vega

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.ReactPackage
import com.facebook.react.uimanager.ViewManager
import com.facebook.react.modules.network.OkHttpClientProvider
import java.io.File
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.TimeUnit

private const val TAG = "ByeDpiModule"

class ByeDpiModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    init {
        reactContext.addLifecycleEventListener(this)
    }

    override fun getName(): String = "ByeDpiModule"

    @Volatile
    private var byeDpiProcess: Process? = null

    @Volatile
    private var currentPort: Int? = null

    private fun getBinaryFile(): File {
        val nativeLib = File(reactApplicationContext.applicationInfo.nativeLibraryDir, "libciadpi.so")
        if (nativeLib.exists()) {
            if (!nativeLib.canExecute()) {
                nativeLib.setExecutable(true, false)
            }
            return nativeLib
        }

        // Older builds extracted an arm64-only copy to the files root; it can never run on 32-bit devices.
        val legacyCopy = File(reactApplicationContext.filesDir, "libciadpi.so")
        if (legacyCopy.exists() && !legacyCopy.delete()) {
            VegaLog.w(TAG, "Failed to delete legacy libciadpi.so copy at ${legacyCopy.absolutePath}")
        }

        try {
            val apkPath = reactApplicationContext.applicationInfo.sourceDir
            if (apkPath != null) {
                val apkFile = File(apkPath)
                if (apkFile.exists()) {
                    java.util.zip.ZipFile(apkFile).use { zip ->
                        // Only consider ABIs the device lists, in preference order.
                        for (abi in android.os.Build.SUPPORTED_ABIS) {
                            val entry = zip.getEntry("lib/$abi/libciadpi.so") ?: continue
                            val fallback = File(File(File(reactApplicationContext.filesDir, "native"), abi), "libciadpi.so")
                            val stale = !fallback.exists() ||
                                fallback.length() == 0L ||
                                (entry.size >= 0L && fallback.length() != entry.size)
                            if (stale) {
                                fallback.parentFile?.mkdirs()
                                val temp = File(fallback.parentFile, "libciadpi.so.tmp")
                                zip.getInputStream(entry).use { input ->
                                    temp.outputStream().use { output ->
                                        input.copyTo(output)
                                    }
                                }
                                if (fallback.exists()) fallback.delete()
                                if (!temp.renameTo(fallback)) {
                                    temp.delete()
                                    throw java.io.IOException("Cannot move extracted binary to ${fallback.absolutePath}")
                                }
                                VegaLog.i(TAG, "Extracted libciadpi.so ($abi) from APK to ${fallback.absolutePath}")
                            }
                            fallback.setExecutable(true, false)
                            VegaLog.i(TAG, "Using libciadpi.so for ABI $abi")
                            return fallback
                        }
                        VegaLog.w(TAG, "APK has no libciadpi.so for supported ABIs ${android.os.Build.SUPPORTED_ABIS.joinToString()}")
                    }
                }
            }
        } catch (e: Exception) {
            VegaLog.w(TAG, "Failed to extract libciadpi.so fallback from APK: ${e.message}")
        }

        return nativeLib
    }

    private fun flushConnections() {
        try {
            DohOkHttpFactory.instance?.evictConnections()
            OkHttpClientProvider.getOkHttpClient().connectionPool.evictAll()
        } catch (e: Exception) {
            VegaLog.w(TAG, "Failed to evict connection pool: ${e.message}")
        }
        try {
            com.facebook.drawee.backends.pipeline.Fresco.getImagePipeline().clearMemoryCaches()
        } catch (_: Exception) {
            // Fresco may not be initialized yet
        }
    }

    private fun killOrphanProcesses() {
        try {
            Runtime.getRuntime().exec(arrayOf("killall", "libciadpi.so")).waitFor(500, TimeUnit.MILLISECONDS)
        } catch (_: Exception) {}
    }

    private fun stopInternal() {
        try {
            val proc = byeDpiProcess
            if (proc != null && proc.isAlive) {
                proc.destroy()
                proc.waitFor(2, TimeUnit.SECONDS)
                if (proc.isAlive) {
                    proc.destroyForcibly()
                }
            }
        } catch (e: Exception) {
            VegaLog.w(TAG, "Error stopping ByeDPI process: ${e.message}")
        } finally {
            byeDpiProcess = null
            currentPort = null
            DohOkHttpFactory.instance?.byeDpiProxyPort = null
            flushConnections()
            killOrphanProcesses()
        }
    }

    @ReactMethod
    fun startByeDpi(customArgs: String?, promise: Promise) {
        Thread {
            try {
                if (byeDpiProcess?.isAlive == true && currentPort != null) {
                    val result = Arguments.createMap().apply {
                        putBoolean("running", true)
                        putInt("port", currentPort!!)
                    }
                    promise.resolve(result)
                    return@Thread
                }

                killOrphanProcesses()

                val binary = getBinaryFile()
                if (!binary.exists()) {
                    promise.reject("BYEDPI_BINARY_NOT_FOUND", "libciadpi.so not found at ${binary.absolutePath}")
                    return@Thread
                }

                val port = try {
                    ServerSocket(0).use { it.localPort }
                } catch (e: Exception) {
                    1080
                }

                // No -I: binding outgoing connections to 0.0.0.0 made every IPv6 site fail,
                // and on IPv6-first networks blocked sites are often reachable only over IPv6.
                val cmdList = mutableListOf(
                    binary.absolutePath,
                    "-i", "127.0.0.1",
                    "-p", port.toString()
                )

                val userTokens = if (!customArgs.isNullOrBlank()) {
                    customArgs.trim().split("\\s+".toRegex()).filter { it.isNotEmpty() }
                } else {
                    listOf("--split", "1", "--disorder", "1", "--auto=torst")
                }

                var hasDebug = false
                var skipNext = false
                for (token in userTokens) {
                    if (skipNext) {
                        skipNext = false
                        continue
                    }
                    if (token == "-i" || token == "--ip" || token == "-p" || token == "--port" ||
                        token == "-I" || token == "--conn-ip") {
                        skipNext = true
                        continue
                    }
                    if (token.startsWith("-i=") || token.startsWith("--ip=") ||
                        token.startsWith("-p=") || token.startsWith("--port=") ||
                        token.startsWith("-I=") || token.startsWith("--conn-ip=")) {
                        continue
                    }
                    if (token == "-x" || token == "--debug" || token.startsWith("-x=") || token.startsWith("--debug=")) {
                        hasDebug = true
                    }
                    cmdList.add(token)
                }

                if (!hasDebug) {
                    cmdList.add("-x")
                    cmdList.add("1")
                }

                VegaLog.i(TAG, "Starting ByeDPI with args: ${cmdList.joinToString(" ")}")

                val pb = ProcessBuilder(cmdList)
                pb.directory(reactApplicationContext.filesDir)
                pb.redirectErrorStream(true)
                val proc = pb.start()
                byeDpiProcess = proc
                currentPort = port

                val logLines = StringBuilder()
                Thread {
                    try {
                        proc.inputStream.bufferedReader().forEachLine { line ->
                            VegaLog.d("ByeDpiProcess", line)
                            logLines.append(line).append("\n")
                        }
                    } catch (_: Exception) {}
                }.start()

                // Monitor process liveness in background
                Thread {
                    try {
                        proc.waitFor()
                    } catch (_: Exception) {}
                    if (byeDpiProcess == proc) {
                        VegaLog.i(TAG, "ByeDPI process terminated unexpectedly")
                        stopInternal()
                    }
                }.start()

                var isListening = false
                val deadline = System.currentTimeMillis() + 3000
                while (System.currentTimeMillis() < deadline && proc.isAlive) {
                    try {
                        Socket().use { socket ->
                            socket.connect(InetSocketAddress("127.0.0.1", port), 200)
                            isListening = true
                        }
                        break
                    } catch (_: Exception) {
                        Thread.sleep(100)
                    }
                }

                if (!proc.isAlive || !isListening) {
                    stopInternal()
                    promise.reject("BYEDPI_START_FAILED", "ByeDPI failed to start or listen on port $port: $logLines")
                    return@Thread
                }

                DohOkHttpFactory.instance?.byeDpiProxyPort = port
                flushConnections()

                val result = Arguments.createMap().apply {
                    putBoolean("running", true)
                    putInt("port", port)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                stopInternal()
                promise.reject("BYEDPI_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun stopByeDpi(promise: Promise) {
        Thread {
            try {
                stopInternal()
                val result = Arguments.createMap().apply {
                    putBoolean("running", false)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("BYEDPI_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun getStatus(promise: Promise) {
        val isRunning = byeDpiProcess?.isAlive == true
        val result = Arguments.createMap().apply {
            putBoolean("running", isRunning)
            currentPort?.let { putInt("port", it) }
        }
        promise.resolve(result)
    }

    override fun onHostResume() {}

    override fun onHostPause() {}

    override fun onHostDestroy() {
        stopInternal()
    }

    override fun onCatalystInstanceDestroy() {
        stopInternal()
    }
}

class ByeDpiPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(ByeDpiModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
