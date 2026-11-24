package com.vega

import android.content.Context
import android.os.PowerManager
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.net.wifi.WifiManager
import android.util.Log
import androidx.mediarouter.media.MediaRouter
import com.facebook.react.bridge.Arguments
import com.google.android.gms.cast.framework.CastContext
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import fi.iki.elonen.NanoHTTPD
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response as OkHttpResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.net.Inet4Address
import java.net.NetworkInterface
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import java.util.concurrent.TimeUnit

class RemoteDeliveryModule(
    private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "VegaRemoteDelivery"
        private const val TAG = "RemoteDeliveryModule"
        private var instance: RemoteDeliveryModule? = null

        fun sendMediaAction(action: String, value: Double? = null) {
            instance?.emitMediaAction(action, value)
        }
    }

    init {
        instance = this
    }

    override fun invalidate() {
        super.invalidate()
        if (instance == this) {
            instance = null
        }
    }

    fun emitMediaAction(action: String, value: Double? = null) {
        try {
            val map = Arguments.createMap().apply {
                putString("action", action)
                if (value != null) putDouble("value", value)
            }
            if (reactContext.hasActiveReactInstance()) {
                reactContext
                    .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit("onVegaRemoteMediaAction", map)
            }
        } catch (e: Exception) {
            VegaLog.w(TAG, "Failed to emit media action: ${e.message}")
        }
    }

    override fun getName(): String = NAME

    @Volatile private var server: RemoteHttpServer? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    data class MediaSession(
        val sessionId: String,
        val sourceUrl: String,
        val isLocal: Boolean,
        val headers: Map<String, String>,
        val audioTrackIndex: Int,
        val mode: String, // "ffmpeg", "hls", "progressive" or "proxy"
        val mimeType: String,
        val timelineOffsetUs: Long = 0L,
        @Volatile var activeStreamOffsetUs: Long? = null,
        val ffmpegPackager: FFmpegMp4Packager? = null,
        val hlsPackager: HlsSegmentPackager? = null,
        val hlsSegmentPrefixes: ConcurrentHashMap<String, Int> = ConcurrentHashMap()
    )

    private val sessions = ConcurrentHashMap<String, MediaSession>()
    private val sessionErrors = ConcurrentHashMap<String, String>()
    private val retireAfterReady = ConcurrentHashMap<String, MutableSet<String>>()

    private fun retireReadySessions(nextId: String) {
        if (sessions[nextId]?.ffmpegPackager?.hasMedia != true) return
        val previous = retireAfterReady.remove(nextId) ?: return
        Thread {
            previous.forEach { id -> sessions[id]?.ffmpegPackager?.retire() }
        }.apply { isDaemon = true; name = "cast-handover"; start() }
    }

    @ReactMethod
    fun retireSessionWhenReady(previousId: String, nextId: String, promise: Promise) {
        if (previousId != nextId && sessions[nextId]?.ffmpegPackager != null) {
            retireAfterReady.computeIfAbsent(nextId) { ConcurrentHashMap.newKeySet<String>() }.add(previousId)
            retireReadySessions(nextId)
        }
        promise.resolve(true)
    }
    // Only requested tracks are extracted. A failed track is shared/cached briefly,
    // including Kodi's VTT/SRT alternatives, instead of being retried on every seek.
    private val subtitleCache = RemoteMetadataCache<List<MkvCueIndex.SubtitleLine>>(
        maxEntries = 4, ttlMs = 24 * 60 * 60_000L, failureTtlMs = 30_000L
    )
    private val hlsDurations = RemoteMetadataCache<Double>()
    private val vodHlsSources = ConcurrentHashMap.newKeySet<String>()
    private fun metadataKey(source: String, headers: Map<String, String>) =
        source + "\n" + headers.entries.sortedBy { it.key.lowercase() }.joinToString("\n") { "${it.key.lowercase()}:${it.value}" }
    // Video keyframe times per source (empty when the source has no usable Cues).
    private val keyframeCache = ConcurrentHashMap<String, LongArray>()

    /**
     * FFmpeg's input -ss with stream copy starts at the keyframe at or before the
     * target, and that keyframe becomes time 0. Snap to it so the timeline offset
     * matches what the receiver actually plays.
     */
    private fun snapToKeyframe(
        sourceUrl: String,
        isLocal: Boolean,
        headers: Map<String, String>,
        seconds: Double
    ): Double {
        if (seconds <= 0.05) return 0.0
        // Successful arrays are reused; failed MKV metadata reads expire quickly.
        val isRemoteHls = !isLocal && sourceUrl.contains(".m3u8", ignoreCase = true)
        val cacheKey = metadataKey(sourceUrl, headers)
        val keyframes = keyframeCache[cacheKey]?.takeIf { !isRemoteHls || vodHlsSources.contains(sourceUrl) } ?: try {
            // HLS segments start on keyframes, so segment starts serve as the index.
            // Without a snap, the copied video starts at an earlier keyframe than the
            // trimmed audio: silence at the start and subtitles offset by the gap.
            (if (isRemoteHls) hlsSegmentStartsUs(sourceUrl, headers)
            else MkvCueIndex.videoKeyframesUs(reactContext, sourceUrl, isLocal, headers))
                ?.also { if (!isRemoteHls || vodHlsSources.contains(sourceUrl)) keyframeCache[cacheKey] = it }
        } catch (e: Exception) {
            VegaLog.w(TAG, "Keyframe index unavailable: ${e.message}")
            null
        }
        val targetUs = (seconds * 1_000_000.0).toLong()
        val snapped = keyframes?.lastOrNull { it <= targetUs }
        if (snapped == null) {
            VegaLog.w(TAG, "No keyframe index; subtitles may be offset by up to one GOP at ${seconds}s")
            return seconds
        }
        VegaLog.i(TAG, "Snapped start ${seconds}s to keyframe ${snapped / 1_000_000.0}s")
        return snapped / 1_000_000.0
    }


    @ReactMethod
    fun startServer(promise: Promise) {
        try {
            if (server == null) {
                val newServer = RemoteHttpServer(0)
                newServer.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
                server = newServer
            }
            RemoteDeliveryService.retainDelivery(this)

            try {
                if (wakeLock == null) {
                    val pm = reactContext.applicationContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
                    wakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Vega:RemoteDeliveryWakeLock")?.apply {
                        setReferenceCounted(false)
                        acquire(12 * 60 * 60 * 1000L)
                    }
                }
                if (wifiLock == null) {
                    val wm = reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                    wifiLock = wm?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Vega:RemoteDeliveryWifiLock")?.apply {
                        setReferenceCounted(false)
                        acquire()
                    }
                }
            } catch (lockEx: Exception) {
                VegaLog.w(TAG, "Failed to acquire wake/wifi locks: ${lockEx.message}")
            }

            val port = server!!.listeningPort
            val lanIp = getLocalIpAddress()
            if (lanIp == "127.0.0.1") {
                throw IllegalStateException("Connect the phone and receiver to the same Wi-Fi network")
            }
            val baseUrl = "http://$lanIp:$port"
            VegaLog.i(TAG, "Remote delivery server listening at $baseUrl")

            try {
                RemoteDeliveryService.start(
                    context = reactContext.applicationContext,
                    title = "Vega Cast Server",
                    subtitle = "Server active at $baseUrl",
                    isPlaying = true
                )
            } catch (serviceEx: Exception) {
                VegaLog.w(TAG, "Failed to start RemoteDeliveryService: ${serviceEx.message}")
            }

            val map = Arguments.createMap()
            map.putInt("port", port)
            map.putString("lanIp", lanIp)
            map.putString("baseUrl", baseUrl)
            promise.resolve(map)
        } catch (e: Exception) {
            VegaLog.e(TAG, "Failed to start local delivery server", e)
            promise.reject("SERVER_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopServer(promise: Promise) {
        try {
            closeDelivery()
            RemoteDeliveryService.stop(reactContext.applicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SERVER_STOP_ERROR", e.message, e)
        }
    }

    /** Native service can release delivery even after the React bridge is gone. */
    fun closeDelivery() {
            server?.stop()
            server = null
            sessions.values.forEach {
                it.ffmpegPackager?.close()
                it.hlsPackager?.close()
            }
            sessions.clear()
            retireAfterReady.clear()
            RemoteDeliveryService.releaseDelivery(this)
            sessionErrors.clear()
            subtitleCache.clear()
            keyframeCache.clear()
            hlsDurations.clear()
            vodHlsSources.clear()
            MkvCueIndex.clearCache()
            VegaLog.i(TAG, "Cast traffic: ${RemoteSourceFailures.trafficSummary()}")

            try {
                wakeLock?.release()
            } catch (_: Exception) {}
            wakeLock = null

            try {
                wifiLock?.release()
            } catch (_: Exception) {}
            wifiLock = null

    }

    @ReactMethod
    fun startForegroundService(params: ReadableMap?, promise: Promise) {
        try {
            val title = if (params?.hasKey("title") == true) params.getString("title") else null
            val subtitle = if (params?.hasKey("subtitle") == true) params.getString("subtitle") else null
            val artwork = if (params?.hasKey("artwork") == true) params.getString("artwork") else null
            val isPlaying = if (params?.hasKey("isPlaying") == true) params.getBoolean("isPlaying") else true
            val position = if (params?.hasKey("position") == true) params.getDouble("position") else 0.0
            val duration = if (params?.hasKey("duration") == true) params.getDouble("duration") else 0.0

            RemoteDeliveryService.start(
                context = reactContext.applicationContext,
                title = title,
                subtitle = subtitle,
                artwork = artwork,
                isPlaying = isPlaying,
                positionSeconds = position,
                durationSeconds = duration
            )
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("START_SERVICE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun updateMediaPlayback(params: ReadableMap?, promise: Promise) {
        try {
            val title = if (params?.hasKey("title") == true) params.getString("title") else null
            val subtitle = if (params?.hasKey("subtitle") == true) params.getString("subtitle") else null
            val artwork = if (params?.hasKey("artwork") == true) params.getString("artwork") else null
            val isPlaying = if (params?.hasKey("isPlaying") == true) params.getBoolean("isPlaying") else null
            val position = if (params?.hasKey("position") == true) params.getDouble("position") else null
            val duration = if (params?.hasKey("duration") == true) params.getDouble("duration") else null

            RemoteDeliveryService.update(
                context = reactContext.applicationContext,
                title = title,
                subtitle = subtitle,
                artwork = artwork,
                isPlaying = isPlaying,
                positionSeconds = position,
                durationSeconds = duration
            )
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("UPDATE_PLAYBACK_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun stopForegroundService(promise: Promise) {
        try {
            RemoteDeliveryService.stop(reactContext.applicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("STOP_SERVICE_ERROR", e.message, e)
        }
    }

    // OkHttp with the app's DoH resolver. FFmpeg uses system DNS, which fails for
    // some CDN hosts, so it reads HLS through handleHlsProxy instead.
    /** Total seconds of an HLS stream; a master playlist is followed to its first variant. Returns 0.0 on failure. */
    private fun hlsPlaylistDuration(url: String, headers: Map<String, String>): Double =
        hlsSegmentDurations(url, headers)?.sum() ?: 0.0

    private fun hlsSegmentStartsUs(url: String, headers: Map<String, String>): LongArray? {
        val durations = hlsSegmentDurations(url, headers)?.takeIf { it.isNotEmpty() } ?: return null
        var start = 0.0
        return LongArray(durations.size) { i -> (start * 1_000_000.0).toLong().also { start += durations[i] } }
    }

    /** EXTINF durations of the media playlist; a master playlist resolves to its first variant. */
    private fun hlsSegmentDurations(url: String, headers: Map<String, String>, depth: Int = 0): List<Double>? {
        return try {
            RemoteSourceFailures.check(url)
            val req = Request.Builder().url(url).apply { headers.forEach { (k, v) -> header(k, v) } }.build()
            RemoteSourceFailures.noteMetadataRead()
            val text = hlsClient.newCall(req).execute().use { res ->
                RemoteSourceFailures.record(url, res.code, res.header("Retry-After"))
                RemoteSourceFailures.check(url)
                if (!res.isSuccessful) return null
                res.body?.string().orEmpty()
            }
            val lines = text.lines().map { it.trim() }
            val variantIndex = lines.indexOfFirst { it.startsWith("#EXT-X-STREAM-INF") }
            if (variantIndex >= 0 && depth < 2) {
                val variant = lines.drop(variantIndex + 1).firstOrNull { it.isNotEmpty() && !it.startsWith("#") }
                    ?: return null
                val resolved = java.net.URI(url).resolve(variant).toString()
                val durations = hlsSegmentDurations(resolved, headers, depth + 1)
                if (vodHlsSources.contains(resolved)) vodHlsSources.add(url) else vodHlsSources.remove(url)
                return durations
            }
            if (lines.any { it == "#EXT-X-ENDLIST" }) vodHlsSources.add(url) else vodHlsSources.remove(url)
            lines.filter { it.startsWith("#EXTINF:") }
                .map { it.removePrefix("#EXTINF:").substringBefore(',').trim().toDoubleOrNull() ?: 0.0 }
        } catch (e: Exception) {
            VegaLog.w(TAG, "HLS playlist probe failed: ${e.message}")
            null
        }
    }

    private fun executeMediaRequest(client: OkHttpClient, request: Request): OkHttpResponse {
        try {
            return client.newCall(request).execute()
        } catch (error: java.net.ProtocolException) {
            if (!error.message.orEmpty().contains("Unexpected status line", ignoreCase = true)) throw error
            // Do not reuse a possibly desynchronized HTTP/1 connection. Only
            // replay a GET/HEAD before headers/body have reached the receiver.
            if (request.method !in listOf("GET", "HEAD")) throw error
            val fresh = client.newBuilder()
                .connectionPool(okhttp3.ConnectionPool(0, 1, TimeUnit.SECONDS))
                .build()
            return fresh.newCall(request.newBuilder().header("Connection", "close").build()).execute()
        }
    }

    private val hlsClient: OkHttpClient by lazy {
        (DohOkHttpFactory.instance?.createNewNetworkModuleClient() ?: OkHttpClient())
            .newBuilder()
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    private fun hlsProxyUrl(sessionId: String, url: String, playlist: Boolean): String {
        val encoded = android.util.Base64.encodeToString(
            url.toByteArray(Charsets.UTF_8),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING
        )
        val port = server?.listeningPort ?: 0
        // Browser receivers need LAN URLs for every rendition, segment and key.
        // Internal FFmpeg inputs keep their existing loopback delivery path.
        val host = if (sessions[sessionId]?.mode == "proxy") getLocalIpAddress() else "127.0.0.1"
        return "http://$host:$port/hls/$sessionId/$encoded/" + if (playlist) "index.m3u8" else "seg.ts"
    }

    private fun rewritePlaylist(sessionId: String, body: String, base: okhttp3.HttpUrl): String {
        val uriAttr = Regex("""URI="([^"]+)"""")
        val out = StringBuilder()
        var nextIsPlaylist = false
        for (raw in body.lines()) {
            val line = raw.trim()
            when {
                line.isEmpty() -> out.append(raw)
                line.startsWith("#") -> {
                    if (line.startsWith("#EXT-X-STREAM-INF")) nextIsPlaylist = true
                    out.append(uriAttr.replace(raw) { m ->
                        val abs = base.resolve(m.groupValues[1])?.toString() ?: m.groupValues[1]
                        val isPlaylist = line.startsWith("#EXT-X-MEDIA") || line.startsWith("#EXT-X-I-FRAME-STREAM-INF")
                        "URI=\"${hlsProxyUrl(sessionId, abs, isPlaylist)}\""
                    })
                }
                else -> {
                    val abs = base.resolve(line)?.toString() ?: line
                    val isPlaylist = nextIsPlaylist || abs.substringBefore('?').endsWith(".m3u8", ignoreCase = true)
                    out.append(hlsProxyUrl(sessionId, abs, isPlaylist))
                    nextIsPlaylist = false
                }
            }
            out.append("\n")
        }
        return out.toString()
    }

    private fun addCors(response: NanoHTTPD.Response, headers: Map<String, String>): NanoHTTPD.Response {
        headers.forEach { (k, v) -> response.addHeader(k, v) }
        return response
    }

    private fun handleHlsProxy(
        session: MediaSession,
        encoded: String?,
        rangeHeader: String?,
        method: NanoHTTPD.Method,
        corsHeaders: Map<String, String>
    ): NanoHTTPD.Response {
        val target = encoded?.let {
            try {
                String(android.util.Base64.decode(it, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING), Charsets.UTF_8)
            } catch (_: Exception) { null }
        } ?: return addCors(NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.BAD_REQUEST, NanoHTTPD.MIME_PLAINTEXT, "Bad URL"), corsHeaders)

        RemoteSourceFailures.check(target)
        val builder = Request.Builder().url(target)
        session.headers.forEach { (k, v) -> builder.header(k, v) }
        if (rangeHeader != null) builder.header("Range", HlsSegmentPrefix.upstreamRange(
            rangeHeader, session.hlsSegmentPrefixes[target] ?: 0
        ))
        RemoteSourceFailures.noteHlsRead()
        val upstream = executeMediaRequest(hlsClient, builder.build())
        if (!upstream.isSuccessful) {
            RemoteSourceFailures.record(target, upstream.code, upstream.header("Retry-After"))
            val retryAfter = upstream.header("Retry-After")
            VegaLog.w(TAG, "HLS proxy upstream ${upstream.code} for $target")
            upstream.close()
            return addCors(NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.lookup(upstream.code) ?: NanoHTTPD.Response.Status.INTERNAL_ERROR, NanoHTTPD.MIME_PLAINTEXT, "Upstream ${upstream.code}"), corsHeaders).apply {
                if (retryAfter != null) addHeader("Retry-After", retryAfter)
            }
        }
        val body = upstream.body!!
        val contentType = body.contentType()?.toString().orEmpty()
        val looksPlaylist = target.substringBefore('?').endsWith(".m3u8", ignoreCase = true) ||
            contentType.contains("mpegurl", ignoreCase = true)
        // Some hosts label binary TS as text/vnd.trolltech.linguist. Decoding and
        // re-encoding that body as UTF-8 corrupts it; only decode actual playlists.
        val disguisedPlaylist = !looksPlaylist && contentType.startsWith("text") &&
            upstream.peekBody(256).string().trimStart().startsWith("#EXTM3U")
        if (looksPlaylist || disguisedPlaylist) {
            val text = body.string()
            if (text.trimStart().startsWith("#EXTM3U")) {
                val rewritten = rewritePlaylist(session.sessionId, text, upstream.request.url)
                return addCors(NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.OK, "application/vnd.apple.mpegurl", rewritten), corsHeaders)
            }
            return addCors(NanoHTTPD.newFixedLengthResponse(NanoHTTPD.Response.Status.OK, contentType.ifEmpty { "application/octet-stream" }, text), corsHeaders)
        }
        val status = if (upstream.code == 206) NanoHTTPD.Response.Status.PARTIAL_CONTENT else NanoHTTPD.Response.Status.OK
        val startsAtZero = upstream.code == 200 ||
            upstream.header("Content-Range")?.startsWith("bytes 0-") == true
        val normalized = try {
            if (method != NanoHTTPD.Method.HEAD && startsAtZero) {
                HlsSegmentPrefix.open(body.byteStream())
            } else HlsSegmentPrefix.Result(body.byteStream(), 0)
        } catch (error: Exception) {
            upstream.close()
            throw error
        }
        if (normalized.skipped > 0) session.hlsSegmentPrefixes[target] = normalized.skipped
        val length = body.contentLength().let { if (it >= 0) it - normalized.skipped else it }
        val resp = if (method == NanoHTTPD.Method.HEAD) {
            body.close()
            NanoHTTPD.newFixedLengthResponse(status, "video/mp2t", ByteArrayInputStream(ByteArray(0)), 0L)
        } else if (length >= 0) {
            NanoHTTPD.newFixedLengthResponse(status, "video/mp2t", normalized.stream, length)
        } else {
            NanoHTTPD.newChunkedResponse(status, "video/mp2t", normalized.stream)
        }
        upstream.header("Content-Range")?.let {
            resp.addHeader("Content-Range", HlsSegmentPrefix.downstreamContentRange(
                it, session.hlsSegmentPrefixes[target] ?: 0
            ))
        }
        return addCors(resp, corsHeaders)
    }

    @ReactMethod
    fun registerSession(
        sessionId: String,
        sourceUrl: String,
        isLocal: Boolean,
        headersMap: ReadableMap?,
        audioTrackIndex: Int,
        mode: String,
        mimeType: String,
        startPositionSeconds: Double,
        audioCodec: String?,
        durationSeconds: Double,
        totalSizeBytes: Double,
        audioUrl: String?,
        audioDelayMs: Int,
        promise: Promise
    ) {
        Thread {
        try {
            val headers = mutableMapOf<String, String>()
            headersMap?.toHashMap()?.forEach { (k, v) ->
                if (v != null) headers[k] = v.toString()
            }
            if (!isLocal && !sourceUrl.startsWith("file://") && !sourceUrl.startsWith("content://")) {
                try {
                    val cookie = android.webkit.CookieManager.getInstance().getCookie(sourceUrl)
                    if (!cookie.isNullOrBlank() && !headers.keys.any { it.equals("cookie", ignoreCase = true) }) {
                        headers["Cookie"] = cookie
                        VegaLog.i(TAG, "Injected Android CookieManager cookies for $sourceUrl")
                    }
                } catch (e: Exception) {
                    VegaLog.w(TAG, "Failed to read native cookies for $sourceUrl: ${e.message}")
                }
            }
            VegaLog.i(TAG, "Registered session $sessionId with headers: ${headers.keys}")
            RemoteSourceFailures.check(sourceUrl)

            val ffmpegStart = if (mode == "ffmpeg") {
                snapToKeyframe(sourceUrl, isLocal, headers, startPositionSeconds)
            } else startPositionSeconds

            val isRemoteHls = !isLocal && sourceUrl.contains(".m3u8", ignoreCase = true)
            // HLS has no container duration; sum the media playlist's #EXTINF values.
            // Probe even when JS passed a duration: it may be a stale store value.
            val resolvedDuration = if (isRemoteHls && mode != "proxy") {
                val durationKey = metadataKey(sourceUrl, headers)
                val probed = if (vodHlsSources.contains(sourceUrl)) {
                    hlsDurations.get(durationKey) { hlsPlaylistDuration(sourceUrl, headers) }
                } else {
                    val fresh = hlsPlaylistDuration(sourceUrl, headers)
                    if (vodHlsSources.contains(sourceUrl)) hlsDurations.get(durationKey) { fresh }
                    fresh
                }
                VegaLog.i(TAG, "HLS duration: probed=$probed passed=$durationSeconds")
                if (probed > 0.0) probed else durationSeconds
            } else durationSeconds

            val ffmpegPackager: FFmpegMp4Packager? = if (mode == "ffmpeg") {
                FFmpegMp4Packager(
                    context = reactContext,
                    sourceUrl = sourceUrl,
                    isLocal = isLocal,
                    headers = headers,
                    audioTrackIndex = audioTrackIndex,
                    diagnosticId = sessionId,
                    audioCodec = audioCodec,
                    durationSeconds = resolvedDuration,
                    totalSizeBytes = totalSizeBytes.toLong(),
                    inputUrl = if (isRemoteHls && server != null) {
                        hlsProxyUrl(sessionId, sourceUrl, playlist = true)
                    } else sourceUrl,
                    audioInputUrl = audioUrl?.takeIf { it.isNotBlank() }?.let {
                        if (isRemoteHls && server != null) hlsProxyUrl(sessionId, it, playlist = true) else it
                    },
                    audioDelayMs = audioDelayMs,
                    onError = { message -> sessionErrors[sessionId] = message },
                    onMediaReady = { sessionErrors.remove(sessionId); retireReadySessions(sessionId) }
                )
            } else null

            // HLS output covers the whole film on the source clock, so the receiver
            // seeks by itself. It needs a keyframe index and a duration; without
            // them registration fails and JS falls back to the MP4 route.
            val hlsPackager: HlsSegmentPackager? = if (mode == "hls") {
                if (isRemoteHls) throw IllegalStateException("HLS output is not used for HLS sources")
                val cacheKey = metadataKey(sourceUrl, headers)
                val keyframes = keyframeCache[cacheKey] ?: try {
                    MkvCueIndex.videoKeyframesUs(reactContext, sourceUrl, isLocal, headers)
                        ?.also { keyframeCache[cacheKey] = it }
                } catch (e: Exception) {
                    VegaLog.w(TAG, "Keyframe index unavailable for HLS output: ${e.message}")
                    null
                } ?: throw IllegalStateException("No keyframe index for HLS output")
                HlsSegmentPackager(reactContext, sourceUrl, isLocal, headers, audioTrackIndex, resolvedDuration, keyframes, audioDelayMs)
            } else null

            val timelineOffsetUs = if (mode == "ffmpeg") (ffmpegStart * 1_000_000.0).toLong() else 0L

            val session = MediaSession(
                sessionId = sessionId,
                sourceUrl = sourceUrl,
                isLocal = isLocal,
                headers = headers,
                audioTrackIndex = audioTrackIndex,
                mode = mode,
                mimeType = when {
                    mode == "ffmpeg" -> "video/mp4"
                    mode == "hls" -> "application/x-mpegurl"
                    mimeType.isNotBlank() -> mimeType
                    else -> "video/mp4"
                },
                timelineOffsetUs = timelineOffsetUs,
                ffmpegPackager = ffmpegPackager,
                hlsPackager = hlsPackager
            )
            val lanIp = getLocalIpAddress()
            val port = server?.listeningPort ?: 0
            if (port <= 0 || lanIp == "127.0.0.1" || server == null) {
                ffmpegPackager?.close()
                hlsPackager?.close()
                throw IllegalStateException("Cast delivery server stopped while preparing media")
            }
            sessions[sessionId] = session
            // Embedded subtitles are loaded only when the receiver requests a track.
            sessionErrors.remove(sessionId)

            val streamUrl = when (mode) {
                "ffmpeg" -> if (ffmpegStart > 0.0) {
                    "http://$lanIp:$port/ffmpeg/$sessionId/stream.mp4?start=$ffmpegStart"
                } else {
                    "http://$lanIp:$port/ffmpeg/$sessionId/stream.mp4"
                }
                "hls" -> "http://$lanIp:$port/hlsout/$sessionId/index.m3u8"
                "progressive" -> "http://$lanIp:$port/dlna/$sessionId/stream.mp4"
                "proxy" -> if (isRemoteHls || mimeType.contains("mpegurl", ignoreCase = true)) {
                    hlsProxyUrl(sessionId, sourceUrl, playlist = true)
                } else "http://$lanIp:$port/proxy/$sessionId/stream"
                else -> "http://$lanIp:$port/proxy/$sessionId/stream"
            }
            // Full URL for manual testing: adb logcat -s RemoteDeliveryModule
            VegaLog.i(TAG, "Registered $mode delivery: $streamUrl")

            val timelineOffset = if (mode == "ffmpeg") ffmpegStart else 0.0
            val dur = if (resolvedDuration > 0.0) resolvedDuration else 0.0

            val result = Arguments.createMap()
            result.putString("sessionId", sessionId)
            result.putString("streamUrl", streamUrl)
            result.putString("baseUrl", "http://$lanIp:$port")
            result.putString("mimeType", session.mimeType)
            result.putDouble("timelineOffsetSeconds", timelineOffset)
            result.putDouble("durationSeconds", dur)
            result.putBoolean("byteRangeSeek", mode == "hls")
            reactContext.runOnUiQueueThread { promise.resolve(result) }
        } catch (e: Exception) {
            reactContext.runOnUiQueueThread { promise.reject("SESSION_REG_ERROR", e.message, e) }
        }
        }.start()
    }

    private var castScanCallback: MediaRouter.Callback? = null

    /**
     * react-native-google-cast registers its route callback without active scan on
     * Android, so a custom device list stays empty unless the Cast button is on screen.
     * An active-scan callback here makes the library's own callback receive the routes.
     */
    @ReactMethod
    fun startCastDiscovery(promise: Promise) {
        reactContext.runOnUiQueueThread {
            try {
                if (castScanCallback == null) {
                    @Suppress("DEPRECATION")
                    val selector = CastContext.getSharedInstance(reactContext.applicationContext).mergedSelector
                        ?: throw IllegalStateException("Google Cast is not initialised")
                    val callback = object : MediaRouter.Callback() {}
                    MediaRouter.getInstance(reactContext).addCallback(
                        selector,
                        callback,
                        MediaRouter.CALLBACK_FLAG_PERFORM_ACTIVE_SCAN or MediaRouter.CALLBACK_FLAG_REQUEST_DISCOVERY
                    )
                    castScanCallback = callback
                }
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("CAST_DISCOVERY_ERROR", e.message, e)
            }
        }
    }

    @ReactMethod
    fun stopCastDiscovery(promise: Promise) {
        reactContext.runOnUiQueueThread {
            castScanCallback?.let { MediaRouter.getInstance(reactContext).removeCallback(it) }
            castScanCallback = null
            promise.resolve(true)
        }
    }

    @ReactMethod
    fun unregisterSession(sessionId: String, promise: Promise) {
        VegaLog.i(TAG, "Delivery unregister requested session=$sessionId graceMs=8000")
        Thread {
            try {
                Thread.sleep(8_000)
            } catch (_: Exception) {}
            val s = sessions.remove(sessionId)
            retireAfterReady.remove(sessionId)
            retireAfterReady.values.forEach { it.remove(sessionId) }
            s?.ffmpegPackager?.close()
            s?.hlsPackager?.close()
            sessionErrors.remove(sessionId)
        }.start()
        promise.resolve(true)
    }

    @ReactMethod
    fun prepareSubtitle(url: String, promise: Promise) {
        val currentServer = server
        if (currentServer == null) {
            promise.reject("SUBTITLE_PREPARATION_FAILED", "Cast delivery server is not running")
            return
        }
        Thread {
            try {
                currentServer.prepareSubtitle(url)
                if (server !== currentServer) throw java.io.IOException("Subtitle preparation canceled")
                promise.resolve(true)
            } catch (error: Exception) {
                val cause = generateSequence<Throwable>(error) { it.cause }.last()
                VegaLog.w(TAG, "Selected subtitle failed: ${cause.javaClass.simpleName}: ${cause.message}")
                promise.reject("SUBTITLE_PREPARATION_FAILED", cause.message ?: "Unable to prepare subtitles", error)
            }
        }.apply { name = "cast-subtitle-prepare"; start() }
    }

    @ReactMethod
    fun getSessionError(sessionId: String, promise: Promise) {
        promise.resolve(sessionErrors[sessionId])
    }

    private data class Vint(val value: Long, val length: Int)

    private fun readVint(bytes: ByteArray, offset: Int): Vint? {
        if (offset < 0 || offset >= bytes.size) return null
        val firstByte = bytes[offset].toInt() and 0xFF
        if (firstByte == 0) return null
        var mask = 0x80
        var len = 1
        while ((firstByte and mask) == 0 && len <= 8) {
            mask = mask ushr 1
            len++
        }
        if (len > 8 || len > bytes.size - offset) return null
        var rawVal = 0L
        for (i in 0 until len) {
            rawVal = (rawVal shl 8) or ((bytes[offset + i].toInt() and 0xFF).toLong())
        }
        return Vint(rawVal, len)
    }

    private fun readVintDataSize(bytes: ByteArray, offset: Int): Vint? {
        if (offset < 0 || offset >= bytes.size) return null
        val firstByte = bytes[offset].toInt() and 0xFF
        if (firstByte == 0) return null
        var mask = 0x80
        var len = 1
        while ((firstByte and mask) == 0 && len <= 8) {
            mask = mask ushr 1
            len++
        }
        if (len > 8 || len > bytes.size - offset) return null
        var valNoMask = (firstByte and mask.inv()).toLong()
        for (i in 1 until len) {
            valNoMask = (valNoMask shl 8) or ((bytes[offset + i].toInt() and 0xFF).toLong())
        }
        return Vint(valNoMask, len)
    }

    private fun readUint(bytes: ByteArray, offset: Int, length: Int): Long {
        var result = 0L
        for (i in 0 until length) {
            if (offset + i < bytes.size) {
                result = (result shl 8) or ((bytes[offset + i].toInt() and 0xFF).toLong())
            }
        }
        return result
    }

    private fun formatLanguageName(code: String, fallbackIdx: Int, fallbackLabel: String = "Track"): String {
        return when (code.lowercase().trim()) {
            "hin", "hi" -> "Hindi"
            "eng", "en" -> "English"
            "twi", "tw" -> "Twi"
            "jpn", "ja" -> "Japanese"
            "spa", "es" -> "Spanish"
            "fre", "fra", "fr" -> "French"
            "ger", "deu", "de" -> "German"
            "ita", "it" -> "Italian"
            "kor", "ko" -> "Korean"
            "chi", "zho", "zh" -> "Chinese"
            "rus", "ru" -> "Russian"
            "por", "pt" -> "Portuguese"
            "tam", "ta" -> "Tamil"
            "tel", "te" -> "Telugu"
            "mal", "ml" -> "Malayalam"
            "kan", "kn" -> "Kannada"
            "ben", "bn" -> "Bengali"
            "pan", "pa" -> "Punjabi"
            "mar", "mr" -> "Marathi"
            "guj", "gu" -> "Gujarati"
            "urd", "ur" -> "Urdu"
            "ara", "ar" -> "Arabic"
            else -> if (code.isNotBlank() && code != "und") code.uppercase() else "$fallbackLabel $fallbackIdx"
        }
    }

    private fun readFloat(bytes: ByteArray, offset: Int, length: Int): Double {
        return try {
            val buffer = java.nio.ByteBuffer.wrap(bytes, offset, length).order(java.nio.ByteOrder.BIG_ENDIAN)
            if (length == 4) buffer.float.toDouble()
            else if (length == 8) buffer.double
            else 0.0
        } catch (_: Exception) {
            0.0
        }
    }

    private data class RawTrack(
        var number: Int = 0,
        var type: Int = 0,
        var codec: String = "",
        // Null when the track has no Language element; Matroska then means English.
        var language: String? = null,
        var name: String = "",
        var width: Int = 0,
        var height: Int = 0,
        var channels: Int = 2
    )

    private fun parseEbmlTracks(bytes: ByteArray): WritableMap? {
        var durationSeconds = 0.0
        val infoId = byteArrayOf(0x15.toByte(), 0x49.toByte(), 0xA9.toByte(), 0x66.toByte())
        for (i in 0..bytes.size - 4) {
            if (bytes[i] == infoId[0] &&
                bytes[i + 1] == infoId[1] &&
                bytes[i + 2] == infoId[2] &&
                bytes[i + 3] == infoId[3]
            ) {
                var iOff = i + 4
                val sizeInfo = readVintDataSize(bytes, iOff)
                if (sizeInfo != null) {
                    iOff += sizeInfo.length
                    val infoEnd = EbmlBounds.end(iOff, sizeInfo.value, bytes.size)
                    var timecodeScale = 1_000_000L
                    var rawDuration = 0.0
                    while (iOff < infoEnd) {
                        val elemId = readVint(bytes, iOff) ?: break
                        iOff += elemId.length
                        val elemSize = readVintDataSize(bytes, iOff) ?: break
                        iOff += elemSize.length
                        val dataLen = EbmlBounds.end(iOff, elemSize.value, infoEnd) - iOff
                        if (elemId.value == 0x2AD7B1L) {
                            timecodeScale = readUint(bytes, iOff, dataLen).takeIf { it > 0 } ?: 1_000_000L
                        } else if (elemId.value == 0x4489L) {
                            rawDuration = readFloat(bytes, iOff, dataLen)
                        }
                        iOff = EbmlBounds.end(iOff, elemSize.value, infoEnd)
                    }
                    if (rawDuration > 0.0) {
                        durationSeconds = (rawDuration * timecodeScale) / 1_000_000_000.0
                    }
                }
                break
            }
        }

        val tracksId = byteArrayOf(0x16.toByte(), 0x54.toByte(), 0xAE.toByte(), 0x6B.toByte())
        var tracksOffset = -1
        for (i in 0..bytes.size - 4) {
            if (bytes[i] == tracksId[0] &&
                bytes[i + 1] == tracksId[1] &&
                bytes[i + 2] == tracksId[2] &&
                bytes[i + 3] == tracksId[3]
            ) {
                if (i > 100) {
                    tracksOffset = i
                    break
                }
            }
        }
        if (tracksOffset == -1) {
            for (i in 0..bytes.size - 4) {
                if (bytes[i] == tracksId[0] &&
                    bytes[i + 1] == tracksId[1] &&
                    bytes[i + 2] == tracksId[2] &&
                    bytes[i + 3] == tracksId[3]
                ) {
                    tracksOffset = i
                    break
                }
            }
        }
        if (tracksOffset == -1) return null

        var offset = tracksOffset + 4
        val sizeInfo = readVintDataSize(bytes, offset) ?: return null
        offset += sizeInfo.length
        val tracksEnd = EbmlBounds.end(offset, sizeInfo.value, bytes.size)

        val rawTracks = mutableListOf<RawTrack>()

        while (offset < tracksEnd) {
            val elemId = readVint(bytes, offset) ?: break
            offset += elemId.length
            val elemSize = readVintDataSize(bytes, offset) ?: break
            offset += elemSize.length
            val nextElem = EbmlBounds.end(offset, elemSize.value, tracksEnd)

            if (elemId.value == 0xAEL) { // TrackEntry
                val track = RawTrack()
                var entryOff = offset
                while (entryOff < nextElem && entryOff < bytes.size) {
                    val subId = readVint(bytes, entryOff) ?: break
                    entryOff += subId.length
                    val subSize = readVintDataSize(bytes, entryOff) ?: break
                    entryOff += subSize.length
                    val dataLen = EbmlBounds.end(entryOff, subSize.value, nextElem) - entryOff
                    // A scalar/string extending beyond this prefix is not a complete value.
                    if (subSize.value > dataLen && subId.value != 0xE0L && subId.value != 0xE1L) break

                    when (subId.value) {
                        0xD7L -> track.number = readUint(bytes, entryOff, dataLen).toInt()
                        0x83L -> track.type = readUint(bytes, entryOff, dataLen).toInt()
                        0x86L -> track.codec = String(bytes, entryOff, dataLen, Charsets.UTF_8).trim().replace("\u0000", "")
                        0x22B59CL -> track.language = String(bytes, entryOff, dataLen, Charsets.UTF_8).trim().replace("\u0000", "")
                        0x536EL -> track.name = String(bytes, entryOff, dataLen, Charsets.UTF_8).trim().replace("\u0000", "")
                        0xE0L -> {
                            var vOff = entryOff
                            val vEnd = entryOff + dataLen
                            while (vOff < vEnd) {
                                val vId = readVint(bytes, vOff) ?: break
                                vOff += vId.length
                                val vSize = readVintDataSize(bytes, vOff) ?: break
                                vOff += vSize.length
                                val vdLen = EbmlBounds.end(vOff, vSize.value, vEnd) - vOff
                                if (vId.value == 0xB0L) track.width = readUint(bytes, vOff, vdLen).toInt()
                                if (vId.value == 0xBAL) track.height = readUint(bytes, vOff, vdLen).toInt()
                                vOff += vdLen
                            }
                        }
                        0xE1L -> {
                            var aOff = entryOff
                            val aEnd = entryOff + dataLen
                            while (aOff < aEnd) {
                                val aId = readVint(bytes, aOff) ?: break
                                aOff += aId.length
                                val aSize = readVintDataSize(bytes, aOff) ?: break
                                aOff += aSize.length
                                val adLen = EbmlBounds.end(aOff, aSize.value, aEnd) - aOff
                                if (aId.value == 0x9FL) track.channels = readUint(bytes, aOff, adLen).toInt()
                                aOff += adLen
                            }
                        }
                    }
                    entryOff += dataLen
                }
                rawTracks.add(track)
            }
            offset = nextElem
        }

        val audioTracks = Arguments.createArray()
        val subtitleTracks = Arguments.createArray()
        val videoQualities = Arguments.createArray()
        var hasVideo = false
        var rawAudioCount = 0
        var rawSubCount = 0

        for (t in rawTracks) {
            when (t.type) {
                1 -> {
                    hasVideo = true
                    if (t.height > 0) {
                        val qMap = Arguments.createMap()
                        qMap.putString("id", "${t.height}p")
                        qMap.putString("label", "${t.height}p")
                        qMap.putInt("height", t.height)
                        if (t.width > 0) qMap.putInt("width", t.width)
                        videoQualities.pushMap(qMap)
                    }
                }
                2 -> {
                    val aMap = Arguments.createMap()
                    val trackIdx = rawAudioCount
                    aMap.putInt("index", trackIdx)
                    aMap.putString("id", "audio_${t.number.takeIf { it > 0 } ?: rawAudioCount}")

                    val langCode = (t.language ?: "").lowercase().trim()
                    aMap.putString("language", langCode.ifEmpty { "und" })

                    val codecName = when {
                        t.codec.contains("EAC3", ignoreCase = true) || t.codec.contains("E-AC-3", ignoreCase = true) -> "E-AC-3"
                        t.codec.contains("AAC", ignoreCase = true) -> "AAC"
                        t.codec.contains("AC3", ignoreCase = true) -> "AC-3"
                        t.codec.contains("DTS", ignoreCase = true) -> "DTS"
                        t.codec.contains("OPUS", ignoreCase = true) -> "Opus"
                        else -> t.codec.removePrefix("A_")
                    }
                    aMap.putString("codec", codecName)
                    aMap.putInt("channels", t.channels)

                    val langDisplay = formatLanguageName(langCode, rawAudioCount + 1)
                    val channelLabel = when (t.channels) {
                        6 -> "5.1"
                        8 -> "7.1"
                        1 -> "1.0"
                        else -> "2.0"
                    }
                    val title = if (codecName == "E-AC-3") "$langDisplay ($channelLabel EAC-3)" else "$langDisplay ($channelLabel)"
                    aMap.putString("title", title)
                    audioTracks.pushMap(aMap)
                    rawAudioCount++
                }
                17 -> {
                    val sMap = Arguments.createMap()
                    val language = t.language ?: "eng"
                    // Ordinal among subtitle tracks; the /subtitle endpoint resolves the same ordinal.
                    sMap.putInt("index", rawSubCount)
                    sMap.putString("id", "sub_${t.number.takeIf { it > 0 } ?: rawSubCount}")

                    val langCode = language.lowercase().trim()
                    sMap.putString("language", langCode.ifEmpty { "und" })

                    val hasLanguage = langCode.isNotEmpty() && langCode != "und"
                    val langDisplay = formatLanguageName(langCode, rawSubCount + 1, "Subtitle")
                    sMap.putString("title", if (hasLanguage) "$langDisplay (Embedded)" else langDisplay)
                    sMap.putBoolean("isEmbedded", true)
                    subtitleTracks.pushMap(sMap)
                    rawSubCount++
                }
            }
        }

        val result = Arguments.createMap()
        result.putArray("audioTracks", audioTracks)
        result.putArray("subtitleTracks", subtitleTracks)
        result.putArray("videoQualities", videoQualities)
        result.putDouble("durationSeconds", durationSeconds)
        result.putBoolean("hasVideo", hasVideo)
        return result
    }

    private fun tryInspectMkvTracks(
        trimmedUrl: String,
        isLocal: Boolean,
        headers: Map<String, String>
    ): WritableMap? {
        return try {
            val bytes: ByteArray? = when {
                trimmedUrl.startsWith("content://") -> {
                    val uri = Uri.parse(trimmedUrl)
                    reactContext.contentResolver.openInputStream(uri)?.use { input ->
                        val buf = ByteArray(65536)
                        val read = input.read(buf)
                        if (read > 0) buf.copyOf(read) else null
                    }
                }
                isLocal || trimmedUrl.startsWith("file://") || trimmedUrl.startsWith("/") -> {
                    val cleanPath = if (trimmedUrl.startsWith("file://")) trimmedUrl.removePrefix("file://") else trimmedUrl
                    val file = File(cleanPath)
                    if (file.exists()) {
                        FileInputStream(file).use { input ->
                            val buf = ByteArray(65536)
                            val read = input.read(buf)
                            if (read > 0) buf.copyOf(read) else null
                        }
                    } else null
                }
                else -> {
                    val reqBuilder = Request.Builder()
                        .url(trimmedUrl)
                        .header("Range", "bytes=0-65535")
                    headers.forEach { (k, v) -> reqBuilder.header(k, v) }
                    httpClient.newCall(reqBuilder.build()).execute().use { res ->
                        if (res.isSuccessful || res.code == 206) {
                            res.body?.byteStream()?.use { input ->
                                val buffer = ByteArray(65536)
                                var total = 0
                                while (total < buffer.size) {
                                    val count = input.read(buffer, total, buffer.size - total)
                                    if (count <= 0) break
                                    total += count
                                }
                                if (total > 0) buffer.copyOf(total) else null
                            }
                        } else null
                    }
                }
            }

            if (bytes == null || bytes.size < 64) null else parseEbmlTracks(bytes)
        } catch (e: Exception) {
            VegaLog.w(TAG, "MKV inspection fallback: ${e.javaClass.simpleName}: ${e.message?.take(160)}")
            null
        }
    }

    private fun extractDurationWithRetriever(
        trimmedUrl: String,
        isLocal: Boolean,
        headers: Map<String, String>
    ): Double {
        val retriever = MediaMetadataRetriever()
        return try {
            when {
                trimmedUrl.startsWith("content://") -> {
                    val uri = Uri.parse(trimmedUrl)
                    retriever.setDataSource(reactContext, uri)
                }
                isLocal || trimmedUrl.startsWith("file://") || trimmedUrl.startsWith("/") -> {
                    val cleanPath = if (trimmedUrl.startsWith("file://")) trimmedUrl.removePrefix("file://") else trimmedUrl
                    retriever.setDataSource(cleanPath)
                }
                else -> {
                    retriever.setDataSource(trimmedUrl, headers)
                }
            }
            val durStr = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
            val durMs = durStr?.toLongOrNull() ?: 0L
            if (durMs > 0L) durMs / 1000.0 else 0.0
        } catch (e: Exception) {
            VegaLog.w(TAG, "MediaMetadataRetriever duration fallback failed: ${e.message}")
            0.0
        } finally {
            try {
                retriever.release()
            } catch (_: Exception) {}
        }
    }

    @ReactMethod
    fun inspectMediaTracks(sourceUrl: String, isLocal: Boolean, headersMap: ReadableMap?, promise: Promise) {
        Thread {
            try {
                val headers = mutableMapOf<String, String>()
                headersMap?.toHashMap()?.forEach { (k, v) ->
                    if (v != null) headers[k] = v.toString()
                }

                val trimmedUrl = sourceUrl.trim()
                if (!isLocal && !trimmedUrl.startsWith("file://") && !trimmedUrl.startsWith("content://")) {
                    try {
                        val cookie = android.webkit.CookieManager.getInstance().getCookie(trimmedUrl)
                        if (!cookie.isNullOrBlank() && !headers.keys.any { it.equals("cookie", ignoreCase = true) }) {
                            headers["Cookie"] = cookie
                        }
                    } catch (_: Exception) {}
                }
                val isMkv = trimmedUrl.contains(".mkv", ignoreCase = true) ||
                    trimmedUrl.contains("matroska", ignoreCase = true)

                if (isMkv) {
                    val mkvResult = tryInspectMkvTracks(trimmedUrl, isLocal, headers)
                    if (mkvResult != null && (mkvResult.getArray("audioTracks")?.size() ?: 0) > 0) {
                        val durSec = if (mkvResult.hasKey("durationSeconds")) mkvResult.getDouble("durationSeconds") else 0.0
                        if (durSec <= 0.0) {
                            val fallbackDur = extractDurationWithRetriever(trimmedUrl, isLocal, headers)
                            if (fallbackDur > 0.0) {
                                mkvResult.putDouble("durationSeconds", fallbackDur)
                            }
                        }
                        reactContext.runOnUiQueueThread {
                            promise.resolve(mkvResult)
                        }
                        return@Thread
                    }
                }

                val extractor = MediaExtractor()
                try {
                    if (isLocal || trimmedUrl.startsWith("content://") || trimmedUrl.startsWith("file://") || trimmedUrl.startsWith("/")) {
                        if (trimmedUrl.startsWith("content://")) {
                            val uri = Uri.parse(trimmedUrl)
                            val pfd = reactContext.contentResolver.openFileDescriptor(uri, "r")
                            if (pfd != null) {
                                extractor.setDataSource(pfd.fileDescriptor)
                                pfd.close()
                            } else {
                                extractor.setDataSource(trimmedUrl, headers)
                            }
                        } else {
                            val cleanPath = if (trimmedUrl.startsWith("file://")) trimmedUrl.removePrefix("file://") else trimmedUrl
                            extractor.setDataSource(File(cleanPath).absolutePath)
                        }
                    } else {
                        extractor.setDataSource(trimmedUrl, headers)
                    }

                    val trackCount = extractor.trackCount
                    val audioTracks = Arguments.createArray()
                    val subtitleTracks = Arguments.createArray()
                    var subtitleOrdinal = 0
                    val videoQualities = Arguments.createArray()
                    var videoTrackFound = false
                    var durationUs: Long = 0

                    for (i in 0 until trackCount) {
                        val format = extractor.getTrackFormat(i)
                        val mime = format.getString(MediaFormat.KEY_MIME) ?: ""

                        if (format.containsKey(MediaFormat.KEY_DURATION)) {
                            durationUs = Math.max(durationUs, format.getLong(MediaFormat.KEY_DURATION))
                        }

                        if (mime.startsWith("video/")) {
                            videoTrackFound = true
                            val h = if (format.containsKey(MediaFormat.KEY_HEIGHT)) format.getInteger(MediaFormat.KEY_HEIGHT) else 0
                            val w = if (format.containsKey(MediaFormat.KEY_WIDTH)) format.getInteger(MediaFormat.KEY_WIDTH) else 0
                            if (h > 0) {
                                val qMap = Arguments.createMap()
                                qMap.putString("id", "${h}p")
                                qMap.putString("label", "${h}p")
                                qMap.putInt("height", h)
                                qMap.putInt("width", w)
                                videoQualities.pushMap(qMap)
                            }
                        } else if (mime.startsWith("audio/")) {
                            val trackMap = Arguments.createMap()
                            trackMap.putInt("index", audioTracks.size())
                            trackMap.putString("id", "audio_$i")
                            val lang = if (format.containsKey(MediaFormat.KEY_LANGUAGE)) {
                                format.getString(MediaFormat.KEY_LANGUAGE) ?: "und"
                            } else "und"
                            trackMap.putString("language", lang)
                            trackMap.putString("codec", mime.removePrefix("audio/"))
                            val channels = if (format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                                format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                            } else 2
                            trackMap.putInt("channels", channels)

                            val displayLang = try {
                                if (lang != "und" && lang.isNotBlank()) {
                                    java.util.Locale(lang).displayLanguage.replaceFirstChar { it.uppercase() }
                                } else ""
                            } catch (_: Exception) { "" }

                            val title = if (format.containsKey("title")) {
                                format.getString("title")
                            } else null

                            val finalTitle = title ?: if (displayLang.isNotBlank()) displayLang else "Track ${i + 1}"
                            trackMap.putString("title", finalTitle)
                            audioTracks.pushMap(trackMap)
                        } else {
                            if (EmbeddedSubtitleVtt.isSubtitleMime(mime)) {
                                val subMap = Arguments.createMap()
                                subMap.putInt("index", subtitleOrdinal++)
                                subMap.putString("id", "sub_$i")
                                val lang = if (format.containsKey(MediaFormat.KEY_LANGUAGE)) {
                                    format.getString(MediaFormat.KEY_LANGUAGE) ?: "und"
                                } else "und"
                                subMap.putString("language", lang)

                                val displayLang = try {
                                    if (lang != "und" && lang.isNotBlank()) {
                                        java.util.Locale(lang).displayLanguage.replaceFirstChar { it.uppercase() }
                                    } else ""
                                } catch (_: Exception) { "" }

                                val title = if (format.containsKey("title")) {
                                    format.getString("title")
                                } else null

                                val finalTitle = title ?: if (displayLang.isNotBlank()) displayLang else "Subtitle ${i + 1}"
                                subMap.putString("title", finalTitle)
                                subMap.putBoolean("isEmbedded", true)
                                subtitleTracks.pushMap(subMap)
                            }
                        }
                    }

                    if (durationUs <= 0L) {
                        val fallbackDur = extractDurationWithRetriever(trimmedUrl, isLocal, headers)
                        if (fallbackDur > 0.0) {
                            durationUs = (fallbackDur * 1_000_000.0).toLong()
                        }
                    }

                    val response = Arguments.createMap()
                    response.putArray("audioTracks", audioTracks)
                    response.putArray("subtitleTracks", subtitleTracks)
                    response.putArray("videoQualities", videoQualities)
                    response.putDouble("durationSeconds", durationUs / 1_000_000.0)
                    response.putBoolean("hasVideo", videoTrackFound)

                    reactContext.runOnUiQueueThread {
                        promise.resolve(response)
                    }
                } finally {
                    try {
                        extractor.release()
                    } catch (_: Exception) {}
                }
            } catch (e: Exception) {
                VegaLog.w(TAG, "Media inspection failed: ${e.message}")
                // MediaExtractor rejects some remote files (signed URLs, odd moov layouts).
                // FFprobe goes through the same network stack as the remux, so try it first.
                val probed = try {
                    inspectWithFfprobe(sourceUrl.trim(), headersMap)
                } catch (pe: Exception) {
                    VegaLog.w(TAG, "FFprobe inspection failed: ${pe.message}")
                    null
                }
                reactContext.runOnUiQueueThread {
                    if (probed != null) promise.resolve(probed)
                    else promise.reject("INSPECT_ERROR", e.message, e)
                }
            }
        }.start()
    }

    private fun inspectWithFfprobe(url: String, headersMap: ReadableMap?): WritableMap? {
        fun quote(v: String) = "\"" + v.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
        val cmd = StringBuilder("-v error -hide_banner -print_format json -show_format -show_streams")
        val headerLines = StringBuilder()
        headersMap?.toHashMap()?.forEach { (k, v) ->
            if (v == null) return@forEach
            when {
                k.equals("user-agent", true) -> cmd.append(" -user_agent ").append(quote(v.toString()))
                else -> headerLines.append(k).append(": ").append(v.toString()).append("\r\n")
            }
        }
        if (headerLines.isNotEmpty()) cmd.append(" -headers ").append(quote(headerLines.toString()))
        cmd.append(" -i ").append(quote(url))

        val info = com.arthenica.ffmpegkit.FFprobeKit.getMediaInformationFromCommand(cmd.toString())
            ?.mediaInformation ?: return null
        val streams = info.streams ?: return null

        val audioTracks = Arguments.createArray()
        val subtitleTracks = Arguments.createArray()
        val videoQualities = Arguments.createArray()
        var hasVideo = false
        var audioOrdinal = 0
        var subOrdinal = 0
        for (st in streams) {
            val tags = st.tags
            val lang = tags?.optString("language")?.takeIf { it.isNotBlank() } ?: "und"
            val title = tags?.optString("title")?.takeIf { it.isNotBlank() }
            val displayLang = try {
                if (lang != "und") Locale(lang).displayLanguage.replaceFirstChar { it.uppercase() } else ""
            } catch (_: Exception) { "" }
            when (st.type) {
                "video" -> {
                    // Skip cover art; it is reported as a video stream.
                    if (st.allProperties?.optJSONObject("disposition")?.optInt("attached_pic") == 1) continue
                    hasVideo = true
                    val h = st.height?.toInt() ?: 0
                    if (h > 0) {
                        val q = Arguments.createMap()
                        q.putString("id", "${h}p")
                        q.putString("label", "${h}p")
                        q.putInt("height", h)
                        q.putInt("width", st.width?.toInt() ?: 0)
                        videoQualities.pushMap(q)
                    }
                }
                "audio" -> {
                    val m = Arguments.createMap()
                    m.putInt("index", audioOrdinal)
                    m.putString("id", "audio_${st.index}")
                    m.putString("language", lang)
                    m.putString("codec", st.codec ?: "")
                    m.putInt("channels", st.getNumberProperty("channels")?.toInt() ?: 2)
                    m.putString("title", title ?: displayLang.ifBlank { "Track ${audioOrdinal + 1}" })
                    audioTracks.pushMap(m)
                    audioOrdinal++
                }
                "subtitle" -> {
                    val m = Arguments.createMap()
                    m.putInt("index", subOrdinal)
                    m.putString("id", "sub_${st.index}")
                    m.putString("language", lang)
                    m.putString("title", title ?: displayLang.ifBlank { "Subtitle ${subOrdinal + 1}" })
                    m.putBoolean("isEmbedded", true)
                    subtitleTracks.pushMap(m)
                    subOrdinal++
                }
            }
        }
        if (!hasVideo && audioOrdinal == 0) return null

        val format = info.format?.lowercase() ?: ""
        val response = Arguments.createMap()
        response.putArray("audioTracks", audioTracks)
        response.putArray("subtitleTracks", subtitleTracks)
        response.putArray("videoQualities", videoQualities)
        response.putDouble("durationSeconds", info.duration?.toDoubleOrNull() ?: 0.0)
        response.putBoolean("hasVideo", hasVideo)
        if (format.contains("matroska")) response.putString("container", "matroska")
        else if (format.contains("mp4")) response.putString("container", "mp4")
        return response
    }

    private fun getLocalIpAddress(): String {
        try {
            val interfaces = NetworkInterface.getNetworkInterfaces().toList()
            val ordered = interfaces.sortedBy { iface ->
                when {
                    iface.name.startsWith("wlan") || iface.name.startsWith("wifi") -> 0
                    iface.name.startsWith("eth") -> 1
                    else -> 2
                }
            }
            for (iface in ordered) {
                if (iface.isLoopback || iface.isPointToPoint || !iface.isUp) continue

                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    if (addr is Inet4Address && !addr.isLoopbackAddress) {
                        val host = addr.hostAddress ?: ""
                        if (host.isNotBlank() && !host.startsWith("127.") && !host.startsWith("169.254.")) {
                            return host
                        }
                    }
                }
            }
        } catch (e: Exception) {
            VegaLog.e(TAG, "Error obtaining LAN IP", e)
        }
        return "127.0.0.1"
    }

    private inner class RemoteHttpServer(port: Int) : NanoHTTPD(port) {

        override fun serve(session: IHTTPSession): Response {
            val uri = session.uri
            val method = session.method
            val rangeHeader = session.headers["range"]

            VegaLog.d(TAG, "Serve HTTP $method: $uri, Range: $rangeHeader")

            val corsHeaders = mapOf(
                "Access-Control-Allow-Origin" to "*",
                "Access-Control-Allow-Methods" to "GET, HEAD, OPTIONS",
                "Access-Control-Allow-Headers" to "Range, Origin, Accept, Content-Type",
                "Access-Control-Expose-Headers" to "Content-Length, Content-Range, Accept-Ranges"
            )

            if (method == Method.OPTIONS) {
                val resp = newFixedLengthResponse(Response.Status.OK, MIME_PLAINTEXT, "")
                corsHeaders.forEach { (k, v) -> resp.addHeader(k, v) }
                return resp
            }

            val parts = uri.trimStart('/').split("/")
            if (parts.size < 2) {
                return addCors(newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not found"), corsHeaders)
            }

            val endpoint = parts[0]
            val sessionId = parts[1]
            val mediaSession = sessions[sessionId]

            if (mediaSession == null) {
                return addCors(newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Session expired or invalid"), corsHeaders)
            }

            return try {
                when (endpoint) {
                    "proxy" -> handleProxy(mediaSession, rangeHeader, method, corsHeaders)
                    "dlna" -> handleDlnaProgressive(mediaSession, rangeHeader, method, corsHeaders)
                    "hlsout" -> handleHlsOutput(mediaSession, parts.getOrNull(2), method, corsHeaders)
                    "ffmpeg" -> handleFFmpegStream(mediaSession, session.parms, rangeHeader, session.headers, method, corsHeaders)
                    "subtitle" -> handleSubtitle(mediaSession, parts.getOrNull(2), session.parms, session.headers, corsHeaders)
                    "hls" -> handleHlsProxy(mediaSession, parts.getOrNull(2), rangeHeader, method, corsHeaders)
                    "extsub" -> handleSubtitle(mediaSession, parts.getOrNull(2), session.parms, session.headers, corsHeaders, external = true)
                    else -> addCors(newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Unknown endpoint"), corsHeaders)
                }
            } catch (e: Exception) {
                if (e is RemoteSourceFailures.Denied) {
                    if (endpoint != "subtitle" && endpoint != "extsub") sessionErrors[sessionId] = e.message.orEmpty()
                    addCors(newFixedLengthResponse(Response.Status.lookup(e.status) ?: Response.Status.INTERNAL_ERROR,
                        MIME_PLAINTEXT, e.message.orEmpty()), corsHeaders).apply {
                        addHeader("Retry-After", e.retrySeconds.toString())
                    }
                } else if (endpoint == "subtitle" || endpoint == "extsub") {
                    // A missing/unextractable subtitle must not become a video playback error.
                    VegaLog.w(TAG, "Subtitle unavailable: ${e.message}")
                    addCors(newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT,
                        "Subtitle unavailable for this stream"), corsHeaders)
                } else if (e is java.net.SocketException ||
                    e is java.io.InterruptedIOException ||
                    e.message?.contains("Broken pipe") == true ||
                    e.message?.contains("Connection reset") == true ||
                    e.message?.contains("Stream Closed") == true ||
                    e.message?.contains("interrupted by close") == true
                ) {
                    VegaLog.d(TAG, "Client aborted or superseded connection for $uri: ${e.message}")
                    addCors(newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, "Aborted"), corsHeaders)
                } else {
                    VegaLog.e(TAG, "Error handling request for $uri", e)
                    sessionErrors[sessionId] = "${e.javaClass.simpleName}: ${e.message.orEmpty().replace(Regex("https?://\\S+"), "[media URL]").take(180)}"
                    addCors(newFixedLengthResponse(Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, sessionErrors[sessionId] ?: "Media delivery failed"), corsHeaders)
                }
            }
        }

        private fun addCors(response: Response, headers: Map<String, String>): Response {
            headers.forEach { (k, v) -> response.addHeader(k, v) }
            return response
        }

        private fun parseDlnaNpt(header: String): Double? {
            val npt = header.substringAfter("npt=").substringBefore("-").trim()
            val parts = npt.split(":")
            return when (parts.size) {
                1 -> parts[0].toDoubleOrNull()
                2 -> {
                    val m = parts[0].toDoubleOrNull() ?: 0.0
                    val s = parts[1].toDoubleOrNull() ?: 0.0
                    m * 60.0 + s
                }
                3 -> {
                    val h = parts[0].toDoubleOrNull() ?: 0.0
                    val m = parts[1].toDoubleOrNull() ?: 0.0
                    val s = parts[2].toDoubleOrNull() ?: 0.0
                    h * 3600.0 + m * 60.0 + s
                }
                else -> null
            }
        }

        private fun formatDlnaNpt(seconds: Double): String {
            val totalSec = seconds.toLong()
            val h = totalSec / 3600
            val m = (totalSec % 3600) / 60
            val s = totalSec % 60
            val ms = ((seconds - totalSec) * 1000).toInt()
            return String.format(Locale.US, "%02d:%02d:%02d.%03d", h, m, s, ms)
        }

        private fun handleFFmpegStream(
            session: MediaSession,
            parms: Map<String, String>?,
            rangeHeader: String?,
            reqHeaders: Map<String, String>,
            method: Method,
            corsHeaders: Map<String, String>
        ): Response {
            val packager = session.ffmpegPackager
                ?: return addCors(newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "FFmpeg session unavailable"), corsHeaders)

            if (method == Method.HEAD) {
                // Fixed length 0: NanoHTTPD writes "Content-Length: -1" for a chunked HEAD,
                // which curl-based players (Kodi) reject as a weird server reply.
                val resp = newFixedLengthResponse(Response.Status.OK, "video/mp4", ByteArrayInputStream(ByteArray(0)), 0L)
                resp.addHeader("Accept-Ranges", "none")
                resp.addHeader("Cache-Control", "no-store")
                return addCors(resp, corsHeaders)
            }

            val baseOffset = session.timelineOffsetUs / 1_000_000.0
            val dlnaTimeSeek = reqHeaders["timeseekrange.dlna.org"] ?: reqHeaders["timeseekrange"]
            val dlnaNpt = if (dlnaTimeSeek != null) parseDlnaNpt(dlnaTimeSeek) else null
            val actualStart = when {
                dlnaNpt != null -> snapToKeyframe(
                    session.sourceUrl, session.isLocal, session.headers, baseOffset + dlnaNpt
                )
                parms?.containsKey("start") == true -> parms["start"]?.toDoubleOrNull() ?: baseOffset
                parms?.containsKey("t") == true -> parms["t"]?.toDoubleOrNull() ?: baseOffset
                else -> baseOffset
            }

            // Receivers reconnect with "Range: bytes=N-"; resume there from the ring
            // buffer. Byte 0 of a new position starts a new remux.
            val rangeStart = rangeHeader
                ?.let { Regex("""bytes=(\d+)-""").find(it)?.groupValues?.get(1)?.toLongOrNull() }
                ?: 0L
            session.activeStreamOffsetUs = (actualStart * 1_000_000.0).toLong()
            val inputStream = packager.openReader(actualStart, rangeStart)
                ?: return addCors(
                    newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, MIME_PLAINTEXT, "Byte $rangeStart is no longer buffered"),
                    corsHeaders
                ).apply { addHeader("Content-Range", "bytes */*") }

            val response = newChunkedResponse(
                if (rangeStart > 0) Response.Status.PARTIAL_CONTENT else Response.Status.OK,
                "video/mp4",
                inputStream
            )
            if (rangeStart > 0) {
                // The remux length is unknown while FFmpeg still writes. Claim no total and
                // no near end: "bytes N-N/(N+1)" made strict receivers stop after one byte.
                val total = packager.totalSizeBytes
                response.addHeader(
                    "Content-Range",
                    if (total > rangeStart) "bytes $rangeStart-${total - 1}/*"
                    else "bytes $rangeStart-${Long.MAX_VALUE - 1}/*"
                )
            }
            response.addHeader("Accept-Ranges", "none")
            response.addHeader("Cache-Control", "no-store")

            if (dlnaTimeSeek != null && dlnaNpt != null) {
                val nptStart = formatDlnaNpt(dlnaNpt)
                val streamRemaining = if (packager.durationSeconds > baseOffset) packager.durationSeconds - baseOffset else 0.0
                val nptDuration = if (streamRemaining > 0.0) formatDlnaNpt(streamRemaining) else "*"
                response.addHeader("TimeSeekRange.dlna.org", "npt=$nptStart-$nptDuration/$nptDuration")
                response.addHeader("Transfer-Mode.dlna.org", "Streaming")
            } else {
                response.addHeader("transferMode.dlna.org", "Streaming")
                response.addHeader("contentFeatures.dlna.org", "DLNA.ORG_OP=10;DLNA.ORG_CI=1;DLNA.ORG_FLAGS=01500000000000000000000000000000")
            }

            return addCors(response, corsHeaders)
        }

        // The server is reachable from the LAN, so local files are limited to the
        // app cache, where the document picker puts its copies.
        private fun cachedSubtitleFile(url: String): File? {
            if (!url.startsWith("file://")) return null
            val path = Uri.parse(url).path ?: return null
            val file = File(path).canonicalFile
            val cacheDir = reactContext.cacheDir.canonicalFile
            return file.takeIf { it.isFile && it.path.startsWith(cacheDir.path + File.separator) }
        }

        private fun loadExternalSubtitle(url: String, headers: Map<String, String>): String {
            if (url.startsWith("file://")) {
                val file = cachedSubtitleFile(url) ?: throw java.io.IOException("Subtitle file is unavailable")
                return file.readText()
            }
            val request = Request.Builder().url(url).apply {
                headers.forEach { (k, v) -> header(k, v) }
            }.build()
            return hlsClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw java.io.IOException("Subtitle HTTP ${response.code}")
                response.body?.string().orEmpty()
            }
        }

        private fun handleSubtitle(
            session: MediaSession,
            ordinalPath: String?,
            parms: Map<String, String>?,
            reqHeaders: Map<String, String>,
            corsHeaders: Map<String, String>,
            external: Boolean = false
        ): Response {
            val isSrt = ordinalPath?.endsWith(".srt", ignoreCase = true) == true
            val ordinal = ordinalPath?.removeSuffix(".vtt")?.removeSuffix(".srt")?.removeSuffix(".ttml")?.toIntOrNull()
                ?: return addCors(newFixedLengthResponse(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "Invalid subtitle track"), corsHeaders)
            // External files are fetched and rebased too: the stream's 0 is the session start.
            val externalUrl = if (external) {
                parms?.get("u")?.takeIf {
                    it.startsWith("http://") || it.startsWith("https://") || cachedSubtitleFile(it) != null
                }
                    ?: return addCors(newFixedLengthResponse(Response.Status.BAD_REQUEST, MIME_PLAINTEXT, "Invalid subtitle URL"), corsHeaders)
            } else null
            // Preserve TTML documents: SRT/ASS/VTT are normalized below.
            if (externalUrl != null && ordinalPath?.endsWith(".ttml") == true) {
                val body = loadExternalSubtitle(externalUrl, session.headers)
                return addCors(newFixedLengthResponse(Response.Status.OK, "application/ttml+xml; charset=utf-8", body), corsHeaders).apply {
                    addHeader("Cache-Control", "no-cache, no-store, must-revalidate")
                }
            }
            val lines = loadSubtitleLines(session, ordinal, externalUrl)
            val baseOffset = session.timelineOffsetUs / 1_000_000.0
            val dlnaTimeSeek = reqHeaders["timeseekrange.dlna.org"] ?: reqHeaders["timeseekrange"]
            val dlnaNpt = if (dlnaTimeSeek != null) parseDlnaNpt(dlnaTimeSeek) else null
            val paramOffset = when {
                dlnaNpt != null -> baseOffset + dlnaNpt
                parms?.containsKey("start") == true -> parms["start"]?.toDoubleOrNull()
                parms?.containsKey("t") == true -> parms["t"]?.toDoubleOrNull()
                else -> null
            }
            // User subtitle delay in milliseconds; positive shows each cue later.
            val delayUs = (parms?.get("delay")?.toLongOrNull() ?: 0L) * 1000L
            val offsetUs = (if (paramOffset != null) {
                (paramOffset * 1_000_000.0).toLong()
            } else {
                session.activeStreamOffsetUs ?: session.timelineOffsetUs
            }) - delayUs
            val mimeType = if (isSrt) "text/plain; charset=utf-8" else "text/vtt; charset=utf-8"
            val body = if (isSrt) EmbeddedSubtitleVtt.toSrt(lines, offsetUs) else EmbeddedSubtitleVtt.toVtt(lines, offsetUs)
            return addCors(newFixedLengthResponse(Response.Status.OK, mimeType, body), corsHeaders).apply {
                addHeader("Cache-Control", "no-cache, no-store, must-revalidate")
            }
        }

        /** Called through the bridge: no HTTP client/renderer timeout while
         * hundreds of indexed subtitle blocks are being read. */
        fun prepareSubtitle(url: String) {
            val uri = Uri.parse(url)
            val parts = uri.pathSegments
            require(parts.size == 3 && parts[0] in listOf("subtitle", "extsub")) { "Invalid subtitle URL" }
            val session = sessions[parts[1]] ?: throw java.io.IOException("Cast session expired")
            val ordinal = parts[2].substringBeforeLast('.').toIntOrNull()
                ?.takeIf { it >= 0 } ?: throw IllegalArgumentException("Invalid subtitle track")
            val externalUrl = if (parts[0] == "extsub") {
                uri.getQueryParameter("u")?.takeIf {
                    it.startsWith("http://") || it.startsWith("https://") || cachedSubtitleFile(it) != null
                } ?: throw IllegalArgumentException("Invalid subtitle URL")
            } else null
            VegaLog.i(TAG, "Preparing selected subtitle: ordinal=$ordinal external=${externalUrl != null}")
            if (externalUrl != null && parts[2].endsWith(".ttml")) {
                loadExternalSubtitle(externalUrl, session.headers)
            } else {
                val lines = loadSubtitleLines(session, ordinal, externalUrl)
                VegaLog.i(TAG, "Selected subtitle ready: ordinal=$ordinal cues=${lines.size}")
            }
            if (sessions[session.sessionId] !== session) throw java.io.IOException("Cast session expired")
        }

        private fun loadSubtitleLines(
            session: MediaSession, ordinal: Int, externalUrl: String?
        ): List<MkvCueIndex.SubtitleLine> {
            // Keyed by source, not session: an audio switch makes a new session for the same file.
            val key = metadataKey(externalUrl?.let { "ext#$it" } ?: "${session.sourceUrl}#$ordinal", session.headers)
            return subtitleCache.get(key) {
                if (externalUrl != null) {
                    val body = loadExternalSubtitle(externalUrl, session.headers)
                    EmbeddedSubtitleVtt.parseText(body)
                } else {
                    EmbeddedSubtitleVtt.loadLines(
                        reactContext, session.sourceUrl, session.isLocal, session.headers, ordinal
                    )
                }
            }
        }

        /** VOD playlist and MPEG-TS segments of the HLS output. */
        private fun handleHlsOutput(
            session: MediaSession,
            name: String?,
            method: Method,
            corsHeaders: Map<String, String>
        ): Response {
            val packager = session.hlsPackager
                ?: return addCors(newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "HLS session unavailable"), corsHeaders)
            if (name == null || name == "index.m3u8") {
                val body = packager.playlist().toByteArray()
                val stream = ByteArrayInputStream(if (method == Method.HEAD) ByteArray(0) else body)
                return addCors(newFixedLengthResponse(Response.Status.OK, "application/x-mpegurl", stream, body.size.toLong()), corsHeaders).apply {
                    addHeader("Cache-Control", "no-store")
                }
            }
            val index = Regex("^seg(\\d+)\\.ts$").find(name)?.groupValues?.get(1)?.toIntOrNull()
                ?: return addCors(newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Unknown segment"), corsHeaders)
            val segment = packager.segment(index)
                ?: return addCors(newFixedLengthResponse(Response.Status.SERVICE_UNAVAILABLE, MIME_PLAINTEXT, "Segment not ready"), corsHeaders)
            val body = if (method == Method.HEAD) {
                segment.stream.close()
                ByteArrayInputStream(ByteArray(0))
            } else segment.stream
            return addCors(newFixedLengthResponse(Response.Status.OK, "video/mp2t", body, segment.length), corsHeaders).apply {
                addHeader("Cache-Control", "no-store")
            }
        }

        private fun handleProxy(
            session: MediaSession,
            rangeHeader: String?,
            method: Method,
            corsHeaders: Map<String, String>
        ): Response {
            val source = session.sourceUrl.trim()
            if (session.isLocal || source.startsWith("content://") || source.startsWith("file://") || source.startsWith("/")) {
                return serveLocalSource(source, session.mimeType, rangeHeader, corsHeaders)
            }

            val requestBuilder = Request.Builder().url(session.sourceUrl)
            session.headers.forEach { (k, v) -> requestBuilder.header(k, v) }
            if (!session.headers.keys.any { it.equals("user-agent", ignoreCase = true) }) {
                requestBuilder.header("User-Agent", "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36")
            }
            if (method == Method.HEAD) requestBuilder.head()

            if (!rangeHeader.isNullOrBlank()) {
                requestBuilder.header("Range", rangeHeader)
            }

            val okResponse = executeMediaRequest(httpClient, requestBuilder.build())
            val responseStatus = Response.Status.lookup(okResponse.code) ?: Response.Status.INTERNAL_ERROR
            val body = okResponse.body
            val inputStream = body?.byteStream() ?: ByteArrayInputStream(ByteArray(0))
            val contentLength = body?.contentLength() ?: -1L
            val contentType = okResponse.header("Content-Type") ?: session.mimeType

            val response = if (contentLength >= 0)
                newFixedLengthResponse(responseStatus, contentType, inputStream, contentLength)
            else newChunkedResponse(responseStatus, contentType, inputStream)
            response.addHeader("Accept-Ranges", "bytes")
            okResponse.header("Content-Range")?.let { response.addHeader("Content-Range", it) }
            corsHeaders.forEach { (k, v) -> response.addHeader(k, v) }
            return response
        }

        private fun handleDlnaProgressive(
            session: MediaSession,
            rangeHeader: String?,
            method: Method,
            corsHeaders: Map<String, String>
        ): Response {
            val source = session.sourceUrl.trim()
            val response = if (session.isLocal || source.startsWith("content://") || source.startsWith("file://") || source.startsWith("/")) {
                serveLocalSource(source, session.mimeType, rangeHeader, corsHeaders)
            } else {
                handleProxy(session, rangeHeader, method, corsHeaders)
            }

            // DLNA 1.5 byte-seek headers. No ORG_PN: the source profile is not known here,
            // and strict renderers reject a profile that does not match the stream.
            response.addHeader("contentFeatures.dlna.org", "DLNA.ORG_OP=01;DLNA.ORG_CI=0;DLNA.ORG_FLAGS=01500000000000000000000000000000")
            response.addHeader("transferMode.dlna.org", "Streaming")
            response.addHeader("realTimeInfo.dlna.org", "DLNA.ORG_TLAG=*")
            return response
        }

        private fun serveLocalSource(
            sourceUrl: String,
            mimeType: String,
            rangeHeader: String?,
            corsHeaders: Map<String, String>
        ): Response {
            val trimmed = sourceUrl.trim()
            if (trimmed.startsWith("content://")) {
                val uri = Uri.parse(trimmed)
                val pfd = try {
                    reactContext.contentResolver.openFileDescriptor(uri, "r")
                } catch (e: Exception) {
                    null
                } ?: return addCors(newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Content file not found"), corsHeaders)

                val fileLength = pfd.statSize
                pfd.close()

                if (rangeHeader.isNullOrBlank()) {
                    val stream = reactContext.contentResolver.openInputStream(uri)
                        ?: return addCors(newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Cannot open stream"), corsHeaders)
                    val resp = newFixedLengthResponse(Response.Status.OK, mimeType, stream, fileLength)
                    resp.addHeader("Accept-Ranges", "bytes")
                    return addCors(resp, corsHeaders)
                }

                var start: Long = 0
                var end: Long = fileLength - 1
                try {
                    val rangeValue = rangeHeader.removePrefix("bytes=").trim()
                    val parts = rangeValue.split("-")
                    start = parts[0].toLongOrNull() ?: 0
                    if (parts.size > 1 && parts[1].isNotBlank()) {
                        end = parts[1].toLongOrNull() ?: (fileLength - 1)
                    }
                } catch (_: Exception) {}

                if (start > end || (fileLength > 0 && start >= fileLength)) {
                    val resp = newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, MIME_PLAINTEXT, "")
                    resp.addHeader("Content-Range", "bytes */$fileLength")
                    return addCors(resp, corsHeaders)
                }

                val contentLength = end - start + 1
                val stream = reactContext.contentResolver.openInputStream(uri)
                    ?: return addCors(newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Cannot open stream"), corsHeaders)
                try {
                    stream.skip(start)
                } catch (_: Exception) {}

                val resp = newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, mimeType, stream, contentLength)
                resp.addHeader("Accept-Ranges", "bytes")
                resp.addHeader("Content-Range", "bytes $start-$end/$fileLength")
                return addCors(resp, corsHeaders)
            }

            val file = File(trimmed.removePrefix("file://"))
            return serveLocalFile(file, mimeType, rangeHeader, corsHeaders)
        }

        private fun serveLocalFile(
            file: File,
            mimeType: String,
            rangeHeader: String?,
            corsHeaders: Map<String, String>
        ): Response {
            if (!file.exists() || !file.canRead()) {
                return addCors(newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Local file not found"), corsHeaders)
            }

            val fileLength = file.length()
            if (rangeHeader.isNullOrBlank()) {
                val fis = FileInputStream(file)
                val resp = newFixedLengthResponse(Response.Status.OK, mimeType, fis, fileLength)
                resp.addHeader("Accept-Ranges", "bytes")
                return addCors(resp, corsHeaders)
            }

            // Parse range: bytes=start-end
            var start: Long = 0
            var end: Long = fileLength - 1
            try {
                val rangeValue = rangeHeader.removePrefix("bytes=").trim()
                val parts = rangeValue.split("-")
                start = parts[0].toLongOrNull() ?: 0
                if (parts.size > 1 && parts[1].isNotBlank()) {
                    end = parts[1].toLongOrNull() ?: (fileLength - 1)
                }
            } catch (_: Exception) {}

            if (start > end || start >= fileLength) {
                val resp = newFixedLengthResponse(Response.Status.RANGE_NOT_SATISFIABLE, MIME_PLAINTEXT, "")
                resp.addHeader("Content-Range", "bytes */$fileLength")
                return addCors(resp, corsHeaders)
            }

            val contentLength = end - start + 1
            val fis = FileInputStream(file)
            fis.skip(start)

            val resp = newFixedLengthResponse(Response.Status.PARTIAL_CONTENT, mimeType, fis, contentLength)
            resp.addHeader("Accept-Ranges", "bytes")
            resp.addHeader("Content-Range", "bytes $start-$end/$fileLength")
            return addCors(resp, corsHeaders)
        }
    }
}
