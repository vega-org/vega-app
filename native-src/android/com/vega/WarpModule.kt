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
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.ServerSocket
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.SecureRandom
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit

private const val TAG = "WarpModule"

/** How to reach Cloudflare, tried in order until traffic passes. */
private data class TunnelMode(val label: String, val args: List<String>)

private val TUNNEL_MODES = listOf(
    TunnelMode("HTTP/3", emptyList()),
    // Networks that block QUIC (UDP 443) usually still allow TCP 443.
    TunnelMode("HTTP/2", listOf("--http2")),
    // Last resort for an endpoint whose certificate does not match the pinned key.
    TunnelMode("HTTP/3 without certificate pinning", listOf("--insecure")),
)

private const val TRACE_URL = "https://www.cloudflare.com/cdn-cgi/trace"

class WarpModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    init {
        reactContext.addLifecycleEventListener(this)
    }

    override fun getName(): String = "WarpModule"

    @Volatile
    private var warpProcess: Process? = null

    @Volatile
    private var currentPort: Int? = null

    private fun getBinaryFile(): File {
        val nativeLib = File(reactApplicationContext.applicationInfo.nativeLibraryDir, "libusque.so")
        if (nativeLib.exists()) {
            if (!nativeLib.canExecute()) {
                nativeLib.setExecutable(true, false)
            }
            return nativeLib
        }

        // Older builds extracted an arm64-only copy to the files root; it can never run on 32-bit devices.
        val legacyCopy = File(reactApplicationContext.filesDir, "libusque.so")
        if (legacyCopy.exists() && !legacyCopy.delete()) {
            VegaLog.w(TAG, "Failed to delete legacy libusque.so copy at ${legacyCopy.absolutePath}")
        }

        try {
            val apkPath = reactApplicationContext.applicationInfo.sourceDir
            if (apkPath != null) {
                val apkFile = File(apkPath)
                if (apkFile.exists()) {
                    java.util.zip.ZipFile(apkFile).use { zip ->
                        // Only consider ABIs the device lists, in preference order.
                        for (abi in android.os.Build.SUPPORTED_ABIS) {
                            val entry = zip.getEntry("lib/$abi/libusque.so") ?: continue
                            val fallback = File(File(File(reactApplicationContext.filesDir, "native"), abi), "libusque.so")
                            val stale = !fallback.exists() ||
                                fallback.length() == 0L ||
                                (entry.size >= 0L && fallback.length() != entry.size)
                            if (stale) {
                                fallback.parentFile?.mkdirs()
                                val temp = File(fallback.parentFile, "libusque.so.tmp")
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
                                VegaLog.i(TAG, "Extracted libusque.so ($abi) from APK to ${fallback.absolutePath}")
                            }
                            fallback.setExecutable(true, false)
                            VegaLog.i(TAG, "Using libusque.so for ABI $abi")
                            return fallback
                        }
                        VegaLog.w(TAG, "APK has no libusque.so for supported ABIs ${android.os.Build.SUPPORTED_ABIS.joinToString()}")
                    }
                }
            }
        } catch (e: Exception) {
            VegaLog.w(TAG, "Failed to extract libusque.so fallback from APK: ${e.message}")
        }

        return nativeLib
    }

    private fun getWarpDir(): File {
        val dir = File(reactApplicationContext.filesDir, "warp")
        if (!dir.exists()) {
            dir.mkdirs()
        }
        return dir
    }

    private fun getConfigFile(): File {
        return File(getWarpDir(), "config.json")
    }

    private fun flushConnections() {
        try {
            DohOkHttpFactory.instance?.evictConnections()
            OkHttpClientProvider.getOkHttpClient().connectionPool.evictAll()
        } catch (e: Exception) {
            VegaLog.w(TAG, "Failed to evict connection pool: ${e.message}")
        }
    }

    private fun killOrphanProcesses() {
        try {
            Runtime.getRuntime().exec(arrayOf("killall", "libusque.so")).waitFor(500, TimeUnit.MILLISECONDS)
        } catch (_: Exception) {}
    }

    private fun stopInternal() {
        try {
            val proc = warpProcess
            if (proc != null && proc.isAlive) {
                proc.destroy()
                proc.waitFor(2, TimeUnit.SECONDS)
                if (proc.isAlive) {
                    proc.destroyForcibly()
                }
            }
        } catch (e: Exception) {
            VegaLog.w(TAG, "Error stopping WARP process: ${e.message}")
        } finally {
            warpProcess = null
            currentPort = null
            DohOkHttpFactory.instance?.warpProxyPort = null
            flushConnections()
            killOrphanProcesses()
        }
    }

    private fun generateEcKeyPair(): KeyPair {
        val kpg = KeyPairGenerator.getInstance("EC")
        kpg.initialize(ECGenParameterSpec("prime256v1"))
        return kpg.generateKeyPair()
    }

    private fun toFixedByteArray(bi: java.math.BigInteger, targetLen: Int): ByteArray {
        val raw = bi.toByteArray()
        if (raw.size == targetLen) return raw
        val out = ByteArray(targetLen)
        if (raw.size > targetLen) {
            System.arraycopy(raw, raw.size - targetLen, out, 0, targetLen)
        } else {
            System.arraycopy(raw, 0, out, targetLen - raw.size, raw.size)
        }
        return out
    }

    private fun encodeSec1PrivateKey(keyPair: KeyPair): String {
        val privKey = keyPair.private as ECPrivateKey
        val pubKey = keyPair.public as ECPublicKey

        val dBytes = toFixedByteArray(privKey.s, 32)
        val xBytes = toFixedByteArray(pubKey.w.affineX, 32)
        val yBytes = toFixedByteArray(pubKey.w.affineY, 32)

        val uncompressed = byteArrayOf(0x04) + xBytes + yBytes
        val sec1 = byteArrayOf(
            0x30.toByte(), 0x77.toByte(),
            0x02.toByte(), 0x01.toByte(), 0x01.toByte(),
            0x04.toByte(), 0x20.toByte()
        ) + dBytes + byteArrayOf(
            0xa0.toByte(), 0x0a.toByte(),
            0x06.toByte(), 0x08.toByte(),
            0x2a.toByte(), 0x86.toByte(), 0x48.toByte(), 0xce.toByte(), 0x3d.toByte(), 0x03.toByte(), 0x01.toByte(), 0x07.toByte(),
            0xa1.toByte(), 0x44.toByte(),
            0x03.toByte(), 0x42.toByte(), 0x00.toByte()
        ) + uncompressed

        return android.util.Base64.encodeToString(sec1, android.util.Base64.NO_WRAP)
    }

    private fun registerCloudflare(configFile: File) {
        val keyPair = generateEcKeyPair()
        val sec1PrivKeyBase64 = encodeSec1PrivateKey(keyPair)
        val masquePubKeyBase64 = android.util.Base64.encodeToString(keyPair.public.encoded, android.util.Base64.NO_WRAP)

        val secureRandom = SecureRandom()
        val wgRandom = ByteArray(32)
        secureRandom.nextBytes(wgRandom)
        val wgKeyBase64 = android.util.Base64.encodeToString(wgRandom, android.util.Base64.NO_WRAP)

        val serialBytes = ByteArray(8)
        secureRandom.nextBytes(serialBytes)
        val serialHex = serialBytes.joinToString("") { "%02x".format(it) }

        val sdf = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US)
        sdf.timeZone = TimeZone.getTimeZone("UTC")
        val tos = sdf.format(Date())

        val client = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()

        val jsonMediaType = "application/json; charset=UTF-8".toMediaType()

        // 1. POST /v0a4471/reg
        val regBodyJson = JSONObject().apply {
            put("key", wgKeyBase64)
            put("install_id", "")
            put("fcm_token", "")
            put("tos", tos)
            put("model", "PC")
            put("serial_number", serialHex)
            put("os_version", "")
            put("key_type", "curve25519")
            put("tunnel_type", "wireguard")
            put("locale", "en_US")
        }

        val regRequest = Request.Builder()
            .url("https://api.cloudflareclient.com/v0a4471/reg")
            .post(regBodyJson.toString().toRequestBody(jsonMediaType))
            .header("User-Agent", "WARP for Android")
            .header("CF-Client-Version", "a-6.35-4471")
            .header("Content-Type", "application/json; charset=UTF-8")
            .header("Connection", "Keep-Alive")
            .build()

        val (accountId, token) = client.newCall(regRequest).execute().use { response ->
            val respStr = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw IOException("WARP registration failed (HTTP ${response.code}): $respStr")
            }
            val json = JSONObject(respStr)
            val resObj = if (json.has("result") && !json.isNull("result")) json.getJSONObject("result") else json
            Pair(resObj.getString("id"), resObj.getString("token"))
        }

        // 2. PATCH /v0a4471/reg/{id}
        val patchBodyJson = JSONObject().apply {
            put("key", masquePubKeyBase64)
            put("key_type", "secp256r1")
            put("tunnel_type", "masque")
        }

        val patchRequest = Request.Builder()
            .url("https://api.cloudflareclient.com/v0a4471/reg/$accountId")
            .patch(patchBodyJson.toString().toRequestBody(jsonMediaType))
            .header("User-Agent", "WARP for Android")
            .header("CF-Client-Version", "a-6.35-4471")
            .header("Content-Type", "application/json; charset=UTF-8")
            .header("Connection", "Keep-Alive")
            .header("Authorization", "Bearer $token")
            .build()

        client.newCall(patchRequest).execute().use { response ->
            val respStr = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw IOException("MASQUE key enrollment failed (HTTP ${response.code}): $respStr")
            }
            val json = JSONObject(respStr)
            val resObj = if (json.has("result") && !json.isNull("result")) json.getJSONObject("result") else json
            val configObj = resObj.getJSONObject("config")
            val peerObj = configObj.getJSONArray("peers").getJSONObject(0)
            val endpointObj = peerObj.getJSONObject("endpoint")

            val endpointV4 = endpointObj.getString("v4").removeSuffix(":0")
            val endpointV6 = endpointObj.getString("v6").removePrefix("[").removeSuffix("]:0")
            val peerPubKey = peerObj.getString("public_key")

            val interfaceObj = configObj.getJSONObject("interface")
            val addressesObj = interfaceObj.getJSONObject("addresses")
            val ipv4 = addressesObj.getString("v4")
            val ipv6 = addressesObj.getString("v6")

            val finalConfig = JSONObject().apply {
                put("private_key", sec1PrivKeyBase64)
                put("endpoint_v4", endpointV4)
                put("endpoint_v6", endpointV6)
                put("endpoint_h2_v4", "162.159.198.2")
                put("endpoint_h2_v6", "")
                put("endpoint_pub_key", peerPubKey)
                put("id", resObj.getString("id"))
                put("access_token", token)
                put("ipv4", ipv4)
                put("ipv6", ipv6)
            }

            configFile.parentFile?.mkdirs()
            configFile.writeText(finalConfig.toString(2))
            VegaLog.i(TAG, "WARP config.json written successfully")
        }
    }

    /**
     * Starts the proxy and waits until it listens. Uses http-proxy, not l4-http-proxy: the L4
     * mode looks up site names with plain DNS outside the tunnel, where an ISP that poisons DNS
     * returns its block page address; http-proxy resolves names inside the tunnel.
     */
    private fun launchProxy(binary: File, configFile: File, port: Int, extraArgs: List<String>): Process? {
        val command = mutableListOf(
            binary.absolutePath,
            "-c", configFile.absolutePath,
            "http-proxy",
            "-b", "127.0.0.1",
            "-p", port.toString(),
            "-d", "1.1.1.1",
            "-d", "8.8.8.8",
        )
        command.addAll(extraArgs)
        val pb = ProcessBuilder(command)
        pb.directory(getWarpDir())
        pb.redirectErrorStream(true)
        val proc = pb.start()

        val listening = java.util.concurrent.atomic.AtomicBoolean(false)
        Thread {
            try {
                proc.inputStream.bufferedReader().forEachLine { line ->
                    VegaLog.d("WarpProcess", line)
                    if (line.contains("listening on", ignoreCase = true)) {
                        listening.set(true)
                    }
                }
            } catch (_: Exception) {}
        }.start()

        var waitedMs = 0
        while (waitedMs < 3000 && proc.isAlive && !listening.get()) {
            Thread.sleep(100)
            waitedMs += 100
        }
        return if (proc.isAlive) proc else null
    }

    /** True when a request through the proxy reaches Cloudflare with WARP on. */
    private fun tunnelWorks(port: Int): Boolean {
        val client = OkHttpClient.Builder()
            .proxy(java.net.Proxy(java.net.Proxy.Type.HTTP, java.net.InetSocketAddress("127.0.0.1", port)))
            .connectTimeout(8, TimeUnit.SECONDS)
            .readTimeout(8, TimeUnit.SECONDS)
            .callTimeout(10, TimeUnit.SECONDS)
            .build()
        return try {
            client.newCall(Request.Builder().url(TRACE_URL).build()).execute().use { response ->
                val body = response.body?.string().orEmpty()
                response.isSuccessful &&
                    (body.contains("warp=on") || body.contains("warp=plus"))
            }
        } catch (e: Exception) {
            VegaLog.w(TAG, "WARP check through port $port failed: ${e.message}")
            false
        }
    }

    @ReactMethod
    fun startWarp(promise: Promise) {
        Thread {
            try {
                if (warpProcess?.isAlive == true && currentPort != null) {
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
                    promise.reject("WARP_BINARY_NOT_FOUND", "libusque.so not found at ${binary.absolutePath}")
                    return@Thread
                }

                val configFile = getConfigFile()
                if (!configFile.exists() || configFile.length() == 0L) {
                    VegaLog.i(TAG, "Registering Cloudflare WARP account via HTTPS...")
                    try {
                        registerCloudflare(configFile)
                    } catch (e: Exception) {
                        VegaLog.e(TAG, "WARP registration error: ${e.message}", e)
                        promise.reject("WARP_REGISTRATION_FAILED", "Failed to register WARP client: ${e.message}", e)
                        return@Thread
                    }
                }

                val failures = mutableListOf<String>()
                for (mode in TUNNEL_MODES) {
                    val port = try {
                        ServerSocket(0).use { it.localPort }
                    } catch (e: Exception) {
                        8086
                    }
                    val proc = launchProxy(binary, configFile, port, mode.args)
                    if (proc == null) {
                        failures.add("${mode.label}: proxy exited")
                        continue
                    }
                    if (!tunnelWorks(port)) {
                        failures.add("${mode.label}: no traffic through Cloudflare")
                        proc.destroy()
                        proc.waitFor(2, TimeUnit.SECONDS)
                        if (proc.isAlive) proc.destroyForcibly()
                        continue
                    }

                    warpProcess = proc
                    currentPort = port
                    // Clears the routing when the proxy dies, so requests stop pointing at a
                    // dead port.
                    Thread {
                        try {
                            proc.waitFor()
                        } catch (_: Exception) {}
                        if (warpProcess == proc) {
                            VegaLog.i(TAG, "WARP proxy process terminated unexpectedly")
                            stopInternal()
                        }
                    }.start()

                    DohOkHttpFactory.instance?.warpProxyPort = port
                    flushConnections()
                    VegaLog.i(TAG, "WARP connected over ${mode.label} on port $port")

                    val result = Arguments.createMap().apply {
                        putBoolean("running", true)
                        putInt("port", port)
                        putString("transport", mode.label)
                    }
                    promise.resolve(result)
                    return@Thread
                }

                stopInternal()
                promise.reject(
                    "WARP_TUNNEL_FAILED",
                    "Could not connect to Cloudflare WARP. ${failures.joinToString("; ")}"
                )
            } catch (e: Exception) {
                stopInternal()
                promise.reject("WARP_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun stopWarp(promise: Promise) {
        Thread {
            try {
                stopInternal()
                val result = Arguments.createMap().apply {
                    putBoolean("running", false)
                }
                promise.resolve(result)
            } catch (e: Exception) {
                promise.reject("WARP_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun getStatus(promise: Promise) {
        val isRunning = warpProcess?.isAlive == true
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

class WarpPackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(WarpModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
        return emptyList()
    }
}
