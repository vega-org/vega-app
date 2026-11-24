package com.vega

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.ReturnCode
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.facebook.react.modules.network.OkHttpClientProvider
import okhttp3.Call
import okhttp3.CookieJar
import okhttp3.Request
import okhttp3.Response
import java.io.EOFException
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.max
import kotlin.math.min

private class DownloadCancelledException : IOException("Download cancelled")

private data class HttpDownloadJob(
    val id: String,
    val url: String,
    val destinationUri: Uri,
    val headers: Map<String, String>,
    val connections: Int,
    val completion: Promise,
) {
    @Volatile var cancelled = false
    @Volatile var userPaused = false
    val calls: MutableSet<Call> = ConcurrentHashMap.newKeySet()
    @Volatile var cancelPromise: Promise? = null
    @Volatile var deleteOnCancel = false
    val monitor = Object()

    fun cancelCalls() {
        calls.forEach { it.cancel() }
    }
}

/** A byte range [pos, end) still to download. Guarded by the owning transfer's lock. */
private class Segment(var pos: Long, var end: Long) {
    var owned = false
    var notBefore = 0L
    var receivedSinceReport = 0L
    val remaining: Long get() = end - pos
}

/**
 * Streams HTTP response bodies directly into an SAF document. The document is
 * intentionally kept when the network disappears or the process is stopped;
 * the next start resumes the missing byte ranges with a validated Range.
 *
 * When the server supports byte ranges the file is fetched over several
 * connections at once, the way IDM does it: one connection starts at the first
 * missing byte, and every free connection takes the second half of the largest
 * range still downloading. Many servers limit speed per connection, so this
 * multiplies the speed. Rate limits (429, 503, refused connections) lower the
 * connection count instead of failing the download.
 */
class HttpDownloadModule(
    private val reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    companion object {
        private const val PROGRESS_EVENT = "VegaHttpDownloadProgress"
        private const val STATE_EVENT = "VegaHttpDownloadState"
        private const val PROGRESS_INTERVAL_MS = 500L
        private const val INITIAL_RETRY_DELAY_MS = 1_000L
        private const val MAX_RETRY_DELAY_MS = 30_000L
        private const val BUFFER_SIZE = 512 * 1024

        private const val MAX_CONNECTIONS = 16
        // A range is split only when both halves get at least this much. Must stay above
        // BUFFER_SIZE: a split point then always lies past the bytes a worker is writing.
        private const val MIN_SPLIT_BYTES = 2L * 1024 * 1024
        // Long requests keep the request count low; the cap limits what a dropped
        // connection costs on servers that cut long transfers.
        private const val MAX_REQUEST_BYTES = 256L * 1024 * 1024
        private const val PERSIST_INTERVAL_MS = 2_000L
        private const val CONNECTION_GROW_INTERVAL_MS = 30_000L
        private const val SEGMENT_RETRY_DELAY_MS = 1_000L
        private const val MAX_RETRY_AFTER_MS = 60_000L
        // A rate limit this long after the previous wait counts as a new one.
        private const val RATE_LIMIT_RESET_MS = 10_000L
        private const val STALL_TIMEOUT_MS = 20_000L
        private const val WORKER_STOP_TIMEOUT_MS = 10_000L

        private val jobs = ConcurrentHashMap<String, HttpDownloadJob>()
        // Open fetchToFile calls by tag, so one HLS download can cancel its own.
        private val fileCalls = ConcurrentHashMap<String, MutableSet<Call>>()
        private val executor = Executors.newCachedThreadPool()
    }

    private val metadata by lazy {
        reactContext.getSharedPreferences("vega_http_downloads", Context.MODE_PRIVATE)
    }

    private val connectivityManager by lazy {
        reactContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            wakeJobsWhenNetworkReturns()
        }

        override fun onCapabilitiesChanged(
            network: Network,
            networkCapabilities: NetworkCapabilities,
        ) {
            if (hasUsableInternet(networkCapabilities)) {
                wakeJobsWhenNetworkReturns()
            } else {
                pauseJobsForNetworkLoss()
            }
        }

        override fun onLost(network: Network) {
            pauseJobsForNetworkLoss()
        }
    }

    init {
        runCatching { connectivityManager.registerDefaultNetworkCallback(networkCallback) }
    }

    private val client by lazy {
        OkHttpClientProvider.getOkHttpClient()
            .newBuilder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .writeTimeout(0, TimeUnit.MILLISECONDS)
            .retryOnConnectionFailure(true)
            .build()
    }

    // Sends only the cookies given in the headers; the shared cookie store is left out.
    private val fileClient by lazy {
        client.newBuilder()
            .readTimeout(30, TimeUnit.SECONDS)
            .cookieJar(CookieJar.NO_COOKIES)
            .build()
    }

    override fun getName(): String = "HttpDownloadModule"

    override fun invalidate() {
        runCatching { connectivityManager.unregisterNetworkCallback(networkCallback) }
        super.invalidate()
    }

    @ReactMethod
    fun start(
        downloadId: String,
        url: String,
        destinationUri: String,
        headers: ReadableMap?,
        connections: Double,
        promise: Promise,
    ) {
        if (jobs.containsKey(downloadId)) {
            promise.reject("DOWNLOAD_ACTIVE", "Download is already active")
            return
        }

        val job = HttpDownloadJob(
            id = downloadId,
            url = url,
            destinationUri = Uri.parse(destinationUri),
            headers = readableHeaders(headers),
            connections = connections.toInt().coerceIn(1, MAX_CONNECTIONS),
            completion = promise,
        )
        jobs[downloadId] = job
        executor.execute { runJob(job) }
    }

    /**
     * Lets the video player switch slow progressive streams to parallel range requests. Lives
     * here because the player shares this module's segmented transfer approach.
     */
    @ReactMethod
    fun setParallelStreaming(enabled: Boolean) {
        com.brentvatne.exoplayer.ParallelDataSource.setEnabled(enabled)
    }

    @ReactMethod
    fun pause(downloadId: String, promise: Promise) {
        val job = jobs[downloadId]
        if (job == null || job.cancelled) {
            promise.reject("DOWNLOAD_NOT_ACTIVE", "Download is not active")
            return
        }
        job.userPaused = true
        job.cancelCalls()
        emitState(job.id, "paused")
        promise.resolve(null)
    }

    @ReactMethod
    fun resume(downloadId: String, promise: Promise) {
        val job = jobs[downloadId]
        if (job == null || job.cancelled) {
            promise.reject("DOWNLOAD_NOT_ACTIVE", "Download is not active")
            return
        }
        synchronized(job.monitor) {
            job.userPaused = false
            job.monitor.notifyAll()
        }
        if (hasNetwork()) {
            emitState(job.id, "connecting")
        } else {
            emitState(job.id, "waitingForNetwork", "Waiting for network connection")
        }
        promise.resolve(null)
    }

    @ReactMethod
    fun cancel(downloadId: String, deleteDestination: Boolean, promise: Promise) {
        val job = jobs[downloadId]
        if (job != null) {
            job.cancelPromise = promise
            job.deleteOnCancel = deleteDestination
            job.cancelled = true
            job.cancelCalls()
            synchronized(job.monitor) {
                job.userPaused = false
                job.monitor.notifyAll()
            }
        } else {
            promise.resolve(null)
        }
    }

    /**
     * Downloads one small file, such as an HLS segment, through the app's OkHttp client so
     * DNS over HTTPS, WARP and ByeDPI apply to it. Resolves with the HTTP status; the file is
     * written only for a 2xx response.
     */
    @ReactMethod
    fun fetchToFile(
        tag: String,
        url: String,
        path: String,
        headers: ReadableMap?,
        promise: Promise,
    ) {
        executor.execute {
            val calls = fileCalls.getOrPut(tag) { ConcurrentHashMap.newKeySet() }
            try {
                val builder = Request.Builder().url(url)
                readableHeaders(headers).forEach { (name, value) -> builder.header(name, value) }
                val call = fileClient.newCall(builder.build())
                calls.add(call)
                try {
                    call.execute().use { response ->
                        if (response.isSuccessful) {
                            val target = File(path)
                            val partial = File("$path.part")
                            response.body?.byteStream()?.use { input ->
                                FileOutputStream(partial).use { output -> input.copyTo(output, BUFFER_SIZE) }
                            } ?: throw IOException("Empty response body")
                            if (target.exists()) target.delete()
                            if (!partial.renameTo(target)) {
                                partial.delete()
                                throw IOException("Unable to save $path")
                            }
                        }
                        val result = Arguments.createMap()
                        result.putInt("statusCode", response.code)
                        promise.resolve(result)
                    }
                } finally {
                    calls.remove(call)
                }
            } catch (error: Exception) {
                File("$path.part").delete()
                promise.reject("FETCH_FAILED", error.message ?: error.toString(), error)
            }
        }
    }

    @ReactMethod
    fun cancelFetches(tag: String) {
        fileCalls.remove(tag)?.forEach { it.cancel() }
    }

    /**
     * Joins a downloaded HLS video track and its separate audio rendition into
     * one MP4 without re-encoding. Sites that serve audio as its own playlist
     * would otherwise give a silent file.
     */
    @ReactMethod
    fun muxAudioVideo(videoPath: String, audioPath: String, outputPath: String, promise: Promise) {
        Thread {
            try {
                File(outputPath).delete()
                val session = FFmpegKit.executeWithArguments(arrayOf(
                    "-hide_banner", "-loglevel", "error", "-y",
                    "-i", videoPath,
                    "-i", audioPath,
                    "-map", "0:v:0", "-map", "1:a:0",
                    "-c", "copy",
                    // The output name ends in .part, so the format is given.
                    "-f", "mp4", "-movflags", "+faststart",
                    outputPath,
                ))
                if (ReturnCode.isSuccess(session.returnCode)) {
                    promise.resolve(null)
                } else {
                    File(outputPath).delete()
                    val log = session.allLogsAsString?.takeLast(400)?.trim().orEmpty()
                    promise.reject("MUX_FAILED", "Could not join video and audio: $log")
                }
            } catch (error: Exception) {
                File(outputPath).delete()
                promise.reject("MUX_FAILED", error.message ?: error.toString(), error)
            } catch (error: Error) {
                if (error is VirtualMachineError || error is ThreadDeath) throw error
                File(outputPath).delete()
                promise.reject("MUX_NATIVE_UNAVAILABLE",
                    "Video finalization is unavailable on this device. Update Vega to a build with matching FFmpeg libraries.", error)
            }
        }.apply { isDaemon = true }.start()
    }

    /** Remuxes complete local HLS tracks into one seekable MP4, without re-encoding. */
    @ReactMethod
    fun finalizeHls(videoPlaylistPath: String, audioPlaylistPath: String?, outputPath: String, promise: Promise) {
        Thread {
            val output = File(outputPath)
            try {
                output.delete()
                val args = mutableListOf("-hide_banner", "-loglevel", "error", "-y")
                fun input(path: String) {
                    require(File(path).isFile) { "Downloaded HLS playlist is missing" }
                    HlsSegmentSanitizer.unwrapPlaylist(File(path))
                    args.addAll(listOf("-protocol_whitelist", "file,crypto,data", "-allowed_extensions", "ALL", "-i", path))
                }
                input(videoPlaylistPath)
                if (audioPlaylistPath != null) input(audioPlaylistPath)
                args.addAll(listOf("-map", "0:v:0", "-map", if (audioPlaylistPath != null) "1:a:0" else "0:a:0?",
                    "-c", "copy", "-movflags", "+faststart", "-f", "mp4", outputPath))
                val session = FFmpegKit.executeWithArguments(args.toTypedArray())
                if (!ReturnCode.isSuccess(session.returnCode) || !output.isFile || output.length() == 0L) {
                    throw IOException("Could not finalize HLS: ${session.allLogsAsString?.takeLast(400)?.trim().orEmpty()}")
                }
                val metadata = android.media.MediaMetadataRetriever()
                val durationMs = try {
                    metadata.setDataSource(outputPath)
                    metadata.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
                } finally { metadata.release() }
                require(durationMs > 0) { "Finalized HLS file has no valid duration" }
                promise.resolve(Arguments.createMap().apply { putDouble("duration", durationMs / 1000.0) })
            } catch (error: Exception) {
                output.delete()
                promise.reject("HLS_FINALIZE_FAILED", error.message ?: error.toString(), error)
            } catch (error: Error) {
                // FFmpegKit wraps native linker failures in java.lang.Error;
                // subsequent calls can also throw NoClassDefFoundError.
                if (error is VirtualMachineError || error is ThreadDeath) throw error
                output.delete()
                promise.reject("HLS_NATIVE_UNAVAILABLE",
                    "Video finalization is unavailable on this device. Update Vega to a build with matching FFmpeg libraries.", error)
            }
        }.apply { isDaemon = true }.start()
    }

    @ReactMethod
    fun uriExists(uriString: String, promise: Promise) {
        try {
            val descriptor = reactContext.contentResolver.openFileDescriptor(Uri.parse(uriString), "r")
            if (descriptor == null) {
                promise.resolve(false)
            } else {
                descriptor.close()
                promise.resolve(true)
            }
        } catch (error: java.io.FileNotFoundException) {
            promise.resolve(false)
        } catch (error: IllegalArgumentException) {
            // ExternalStorageProvider performs a tree-child check before opening.
            // Deleted descendants throw IllegalArgumentException wrapping ENOENT,
            // rather than the FileNotFoundException declared by openFileDescriptor.
            val missing = generateSequence<Throwable>(error) { it.cause }
                .any { it is java.io.FileNotFoundException ||
                    (it.message.orEmpty().contains("java.io.FileNotFoundException: Missing file for ")) }
            if (missing) promise.resolve(false)
            else promise.reject("SAF_EXISTS_FAILED", error.message, error)
        } catch (error: Exception) {
            // Permission/provider failures are not evidence of deletion.
            promise.reject("SAF_EXISTS_FAILED", error.message, error)
        }
    }

    @ReactMethod
    fun getUriSize(uriString: String, promise: Promise) {
        try {
            reactContext.contentResolver.openFileDescriptor(Uri.parse(uriString), "r")?.use { pfd ->
                FileInputStream(pfd.fileDescriptor).channel.use { channel ->
                    promise.resolve(channel.size().toDouble())
                }
            } ?: throw IOException("Unable to open SAF document")
        } catch (error: Exception) {
            promise.reject("SAF_SIZE_FAILED", error.message, error)
        }
    }

    // Required by NativeEventEmitter.
    @ReactMethod fun addListener(eventName: String) = Unit
    @ReactMethod fun removeListeners(count: Double) = Unit

    private fun runJob(job: HttpDownloadJob) {
        var retryDelay = INITIAL_RETRY_DELAY_MS
        try {
            while (!job.cancelled) {
                waitWhilePaused(job)
                if (job.cancelled) throw DownloadCancelledException()

                if (!hasNetwork()) {
                    emitState(job.id, "waitingForNetwork", "Waiting for network connection")
                    waitForRetry(job, 0L)
                    continue
                }

                try {
                    emitState(job.id, "connecting")
                    val result = transfer(job)
                    clearMetadata(job.id)
                    emitProgress(job.id, result.first, result.second, 0.0)
                    emitState(job.id, "completed")
                    job.completion.resolve(Arguments.createMap().apply {
                        putDouble("downloadedBytes", result.first.toDouble())
                        putDouble("totalBytes", result.second.toDouble())
                        putString("destinationUri", job.destinationUri.toString())
                    })
                    return
                } catch (error: Exception) {
                    if (job.cancelled) throw DownloadCancelledException()
                    if (job.userPaused) continue
                    if (!isRetryable(error)) throw error

                    emitState(job.id, "waitingForNetwork", error.message)
                    waitForRetry(job, retryDelay)
                    retryDelay = min(retryDelay * 2, MAX_RETRY_DELAY_MS)
                } finally {
                    job.calls.clear()
                }
            }
            throw DownloadCancelledException()
        } catch (error: DownloadCancelledException) {
            emitState(job.id, "cancelled")
            job.completion.reject("DOWNLOAD_CANCELLED", error.message, error)
        } catch (error: Exception) {
            emitState(job.id, "failed", error.message)
            job.completion.reject("DOWNLOAD_FAILED", error.message, error)
        } finally {
            jobs.remove(job.id, job)
            if (job.cancelled && job.deleteOnCancel) {
                runCatching {
                    reactContext.contentResolver.delete(job.destinationUri, null, null)
                }
                clearMetadata(job.id)
            }
            job.cancelPromise?.resolve(null)
        }
    }

    private fun transfer(job: HttpDownloadJob): Pair<Long, Long> {
        val resolver = reactContext.contentResolver
        val openedDescriptor = try {
            resolver.openFileDescriptor(job.destinationUri, "rw")
        } catch (error: Exception) {
            throw DestinationException("Unable to open the SAF destination", error)
        }
        openedDescriptor?.use { descriptor ->
            FileOutputStream(descriptor.fileDescriptor).use { output ->
                val channel = output.channel
                val fileSize = try {
                    channel.size().coerceAtLeast(0L)
                } catch (error: Exception) {
                    throw DestinationException("SAF destination does not support seeking", error)
                }

                val storedUrl = metadata.getString(metaKey(job.id, "url"), null)
                val storedUri = metadata.getString(metaKey(job.id, "uri"), null)
                val canUseValidator = storedUrl == job.url && storedUri == job.destinationUri.toString()
                val validator = if (canUseValidator) {
                    metadata.getString(metaKey(job.id, "etag"), null)
                        ?: metadata.getString(metaKey(job.id, "lastModified"), null)
                } else {
                    null
                }

                // Ranges still missing from an earlier parallel run. Without them the file is
                // contiguous from byte 0 (a fresh download, or one from a single-connection version).
                val savedTotal = if (canUseValidator) metadata.getLong(metaKey(job.id, "total"), -1L) else -1L
                var savedRanges = if (canUseValidator && savedTotal > 0L) {
                    parseRanges(metadata.getString(metaKey(job.id, "remaining"), null))
                } else {
                    null
                }
                if (savedRanges != null && fileSize == 0L && savedRanges.sumOf { it.remaining } < savedTotal) {
                    // The partial file was removed; the saved ranges no longer describe it.
                    savedRanges = null
                }
                if (savedRanges != null && savedRanges.isEmpty() && fileSize >= savedTotal) {
                    return savedTotal to savedTotal
                }

                val probeStart = savedRanges?.firstOrNull()?.pos ?: fileSize
                val call = client.newCall(
                    buildRequest(job, probeStart, null, if (probeStart > 0L || savedRanges != null) validator else null),
                )
                job.calls.add(call)
                val response = call.execute()
                var handedOff = false
                try {
                    if (response.code == 416) {
                        val expectedTotal = parseContentRangeTotal(response.header("Content-Range"))
                        if (savedRanges == null && expectedTotal >= 0L && fileSize == expectedTotal) {
                            return fileSize to expectedTotal
                        }
                        resetDestination(job, channel)
                        throw IOException("Server rejected the saved byte range; restarting")
                    }
                    if (!response.isSuccessful) {
                        throw HttpStatusException(response.code, parseRetryAfterMs(response))
                    }

                    val segments = mutableListOf<Segment>()
                    val totalBytes: Long
                    val splittable: Boolean
                    if (response.code == 206) {
                        val rangeStart = parseContentRangeStart(response.header("Content-Range"))
                        val rangeTotal = parseContentRangeTotal(response.header("Content-Range"))
                        if (rangeStart != probeStart ||
                            (savedRanges != null && rangeTotal != savedTotal)) {
                            resetDestination(job, channel)
                            throw IOException("Server returned an invalid byte range; restarting")
                        }
                        if (rangeTotal > 0L) {
                            totalBytes = rangeTotal
                            splittable = true
                            savedRanges?.let { segments.addAll(it) }
                                ?: segments.add(Segment(probeStart, rangeTotal))
                        } else {
                            // Size unknown: keep one connection and read to the end.
                            totalBytes = 0L
                            splittable = false
                            segments.add(Segment(probeStart, Long.MAX_VALUE))
                        }
                    } else {
                        // The server ignored Range or the validator changed. Never append a full
                        // response to a partial file because that silently corrupts the video.
                        if (probeStart > 0L || savedRanges != null) {
                            try {
                                channel.truncate(0L)
                            } catch (error: Exception) {
                                throw DestinationException("Unable to reset the SAF destination", error)
                            }
                        }
                        val length = response.body?.contentLength() ?: -1L
                        totalBytes = length.coerceAtLeast(0L)
                        splittable = false
                        segments.add(Segment(0L, if (length > 0L) length else Long.MAX_VALUE))
                    }

                    saveMetadata(job, response, totalBytes)
                    val responseValidator = response.header("ETag") ?: response.header("Last-Modified")
                    val transfer = SegmentedTransfer(
                        job, channel, segments, totalBytes, splittable,
                        validator = if (splittable) responseValidator ?: validator else null,
                    )
                    handedOff = true
                    val result = try {
                        transfer.run(response, call)
                    } catch (error: RangeResetException) {
                        resetDestination(job, channel)
                        throw IOException(error.message)
                    }
                    try {
                        output.flush()
                        descriptor.fileDescriptor.sync()
                    } catch (error: Exception) {
                        throw DestinationException("Unable to flush the SAF destination", error)
                    }
                    return result
                } finally {
                    if (!handedOff) {
                        response.close()
                        job.calls.remove(call)
                    }
                }
            }
        }
        throw IOException("Unable to open the SAF destination")
    }

    /**
     * Downloads [segments] into [channel] over up to [HttpDownloadJob.connections] connections.
     * Workers write with positional writes, so they never share a file position.
     */
    private inner class SegmentedTransfer(
        private val job: HttpDownloadJob,
        private val channel: FileChannel,
        private val segments: MutableList<Segment>,
        private val totalBytes: Long,
        private val splittable: Boolean,
        private val validator: String?,
    ) {
        private val lock = Object()
        private var active = 0
        private val connectionLimit = if (splittable) job.connections else 1
        private var maxConnections = connectionLimit
        private var cooldownUntil = 0L
        private var growAt = Long.MAX_VALUE
        private var rateLimitStreak = 0
        // Connections currently receiving data: what the server accepts right now.
        private var streaming = 0
        private var fatal: Exception? = null
        private var lastError: Exception? = null
        @Volatile private var lastProgressAt = System.currentTimeMillis()
        private val downloaded = AtomicLong(
            if (totalBytes > 0L) totalBytes - segments.sumOf { it.remaining } else segments.first().pos,
        )

        fun run(probe: Response, probeCall: Call): Pair<Long, Long> {
            var previousBytes = downloaded.get()
            var previousTime = System.currentTimeMillis()
            var lastPersist = previousTime
            try {
                synchronized(lock) { startWorker(segments.first(), probe, probeCall) }
                while (true) {
                    synchronized(lock) {
                        fatal?.let { throw it }
                        if (segments.isEmpty() && active == 0) {
                            return downloaded.get() to if (totalBytes > 0L) totalBytes else downloaded.get()
                        }
                        // Connections keep failing: hand the error to runJob, which waits for
                        // the network or backs off, then resumes from the saved ranges.
                        val error = lastError
                        val stalled = System.currentTimeMillis() - lastProgressAt >= STALL_TIMEOUT_MS
                        if (error != null && (!hasNetwork() || stalled)) throw error
                        schedule()
                        lock.wait(250L)
                    }
                    if (job.cancelled) throw DownloadCancelledException()
                    if (job.userPaused) throw IOException("Download paused")

                    val now = System.currentTimeMillis()
                    val elapsed = now - previousTime
                    if (elapsed >= PROGRESS_INTERVAL_MS) {
                        val bytes = downloaded.get()
                        emitProgress(
                            job.id, bytes, totalBytes, ((bytes - previousBytes) * 1000.0) / elapsed,
                            connectionDetails(elapsed),
                        )
                        previousBytes = bytes
                        previousTime = now
                    }
                    if (now - lastPersist >= PERSIST_INTERVAL_MS) {
                        persistRemaining()
                        lastPersist = now
                    }
                }
            } finally {
                job.cancelCalls()
                synchronized(lock) {
                    val deadline = System.currentTimeMillis() + WORKER_STOP_TIMEOUT_MS
                    while (active > 0 && System.currentTimeMillis() < deadline) {
                        lock.wait(100L)
                    }
                }
                persistRemaining()
            }
        }

        /**
         * Ranges still downloading, for the download details view. Each entry is
         * [pos, end, bytes per second, 1 when a connection is on it].
         */
        private fun connectionDetails(elapsedMs: Long): com.facebook.react.bridge.WritableMap {
            val ranges = Arguments.createArray()
            synchronized(lock) {
                segments.forEach { segment ->
                    if (segment.remaining <= 0L || segment.end == Long.MAX_VALUE) return@forEach
                    ranges.pushArray(Arguments.createArray().apply {
                        pushDouble(segment.pos.toDouble())
                        pushDouble(segment.end.toDouble())
                        pushDouble(segment.receivedSinceReport * 1000.0 / max(1L, elapsedMs))
                        pushInt(if (segment.owned) 1 else 0)
                    })
                    segment.receivedSinceReport = 0L
                }
                return Arguments.createMap().apply {
                    putArray("ranges", ranges)
                    putInt("connections", streaming)
                    putInt("connectionLimit", maxConnections)
                }
            }
        }

        /** Fills free connection slots. Caller holds [lock]. */
        private fun schedule() {
            val now = System.currentTimeMillis()
            if (now >= growAt && maxConnections < connectionLimit) {
                maxConnections++
                growAt = if (maxConnections < connectionLimit) now + CONNECTION_GROW_INTERVAL_MS else Long.MAX_VALUE
            }
            if (now < cooldownUntil) return
            while (active < maxConnections) {
                val waiting = segments.firstOrNull { !it.owned && it.remaining > 0L && it.notBefore <= now }
                if (waiting != null) {
                    startWorker(waiting, null, null)
                    continue
                }
                if (!splittable) return
                val largest = segments.filter { it.owned }.maxByOrNull { it.remaining } ?: return
                if (largest.remaining < MIN_SPLIT_BYTES * 2) return
                val middle = largest.pos + largest.remaining / 2
                val second = Segment(middle, largest.end)
                largest.end = middle
                segments.add(segments.indexOf(largest) + 1, second)
                startWorker(second, null, null)
            }
        }

        private fun startWorker(segment: Segment, response: Response?, call: Call?) {
            segment.owned = true
            active++
            executor.execute { work(segment, response, call) }
        }

        private fun work(segment: Segment, initialResponse: Response?, initialCall: Call?) {
            var response = initialResponse
            var call = initialCall
            try {
                while (true) {
                    val pos: Long
                    val end: Long
                    synchronized(lock) {
                        pos = segment.pos
                        end = segment.end
                    }
                    if (pos >= end) break
                    if (response == null) {
                        val lastByte = if (end == Long.MAX_VALUE) null else min(end, pos + MAX_REQUEST_BYTES) - 1
                        val request = buildRequest(job, pos, lastByte, validator)
                        call = client.newCall(request).also { job.calls.add(it) }
                        response = call.execute()
                        checkRangeResponse(response, pos)
                    }
                    synchronized(lock) { streaming++ }
                    val reachedEnd = try {
                        response.use { readInto(segment, it) }
                    } finally {
                        synchronized(lock) { streaming-- }
                    }
                    call?.let { job.calls.remove(it) }
                    response = null
                    call = null
                    if (reachedEnd) continue
                    // The body ended before the segment did.
                    if (end == Long.MAX_VALUE) {
                        synchronized(lock) { segment.end = segment.pos }
                    } else if (!splittable || synchronized(lock) { segment.pos } == pos) {
                        throw EOFException("Connection ended before the file was complete")
                    }
                }
                synchronized(lock) {
                    segments.remove(segment)
                    lastError = null
                }
            } catch (error: Exception) {
                onWorkerError(segment, error)
            } finally {
                response?.close()
                call?.let { job.calls.remove(it) }
                synchronized(lock) {
                    segment.owned = false
                    active--
                    lock.notifyAll()
                }
            }
        }

        private fun checkRangeResponse(response: Response, pos: Long) {
            if (!response.isSuccessful) {
                val status = response.code
                val retryAfter = parseRetryAfterMs(response)
                response.close()
                throw HttpStatusException(status, retryAfter)
            }
            val contentRange = response.header("Content-Range")
            if (response.code != 206 || parseContentRangeStart(contentRange) != pos ||
                (totalBytes > 0L && parseContentRangeTotal(contentRange) != totalBytes)) {
                response.close()
                throw RangeResetException("The file changed on the server; restarting")
            }
        }

        /** Returns true when the segment end was reached, false when the body ended first. */
        private fun readInto(segment: Segment, response: Response): Boolean {
            val body = response.body ?: throw IOException("Empty response body")
            val buffer = ByteArray(BUFFER_SIZE)
            body.byteStream().use { input ->
                while (true) {
                    if (job.cancelled) throw DownloadCancelledException()
                    if (job.userPaused) throw IOException("Download paused")
                    val read = input.read(buffer)
                    if (read < 0) return false
                    val writePos: Long
                    val count: Int
                    synchronized(lock) {
                        writePos = segment.pos
                        count = min(read.toLong(), segment.end - segment.pos).toInt()
                    }
                    if (count > 0) {
                        val byteBuffer = ByteBuffer.wrap(buffer, 0, count)
                        try {
                            var position = writePos
                            while (byteBuffer.hasRemaining()) {
                                position += channel.write(byteBuffer, position)
                            }
                        } catch (error: Exception) {
                            throw DestinationException("Unable to write to the SAF destination", error)
                        }
                        downloaded.addAndGet(count.toLong())
                        lastProgressAt = System.currentTimeMillis()
                    }
                    synchronized(lock) {
                        segment.pos += count
                        segment.receivedSinceReport += count
                        if (segment.pos >= segment.end) return true
                    }
                }
            }
        }

        private fun onWorkerError(segment: Segment, error: Exception) {
            synchronized(lock) {
                if (job.cancelled || job.userPaused) return
                val now = System.currentTimeMillis()
                when {
                    error is DestinationException || error is RangeResetException -> fatal = error
                    error is HttpStatusException && isConnectionLimit(error) -> {
                        // The server refuses this many connections. Keep the ones it accepts,
                        // wait, and let the count grow back slowly. Errors from a burst of new
                        // connections count as one rate limit.
                        if (now >= cooldownUntil) {
                            if (now >= cooldownUntil + RATE_LIMIT_RESET_MS) rateLimitStreak = 0
                            val backoff = min(
                                INITIAL_RETRY_DELAY_MS shl min(rateLimitStreak, 5),
                                MAX_RETRY_DELAY_MS,
                            )
                            rateLimitStreak++
                            cooldownUntil = now + if (error.retryAfterMs > 0L) error.retryAfterMs else backoff
                        }
                        maxConnections = min(maxConnections, max(1, streaming))
                        growAt = cooldownUntil + CONNECTION_GROW_INTERVAL_MS
                        segment.notBefore = cooldownUntil
                        lastError = error
                    }
                    error is HttpStatusException && !isRetryable(error) -> {
                        // With other connections working, an error here is most likely a
                        // per-connection limit; only a single connection's error is final.
                        if (streaming == 0) {
                            fatal = error
                        } else {
                            maxConnections = min(maxConnections, streaming)
                            growAt = now + CONNECTION_GROW_INTERVAL_MS
                            segment.notBefore = now + SEGMENT_RETRY_DELAY_MS
                            lastError = error
                        }
                    }
                    else -> {
                        segment.notBefore = now + SEGMENT_RETRY_DELAY_MS
                        lastError = error
                    }
                }
                lock.notifyAll()
            }
        }

        private fun isConnectionLimit(error: HttpStatusException): Boolean =
            error.status == 429 || error.status == 503

        private fun persistRemaining() {
            if (totalBytes <= 0L) return
            val ranges = synchronized(lock) {
                segments.filter { it.remaining > 0L }.joinToString(",") { "${it.pos}-${it.end}" }
            }
            metadata.edit()
                .putLong(metaKey(job.id, "total"), totalBytes)
                .putString(metaKey(job.id, "remaining"), ranges)
                .apply()
        }
    }

    private fun buildRequest(job: HttpDownloadJob, start: Long, lastByte: Long?, validator: String?): Request {
        val requestBuilder = Request.Builder().url(job.url)
        var hasAcceptEncoding = false
        job.headers.forEach { (name, value) ->
            if (name.equals("accept-encoding", ignoreCase = true)) {
                hasAcceptEncoding = true
            }
            if (!name.equals("range", ignoreCase = true) &&
                !name.equals("if-range", ignoreCase = true)) {
                requestBuilder.header(name, value)
            }
        }
        if (!hasAcceptEncoding) {
            requestBuilder.header("Accept-Encoding", "identity")
        }
        requestBuilder.header("Range", if (lastByte != null) "bytes=$start-$lastByte" else "bytes=$start-")
        validator?.let { requestBuilder.header("If-Range", it) }
        return requestBuilder.build()
    }

    private fun resetDestination(job: HttpDownloadJob, channel: FileChannel) {
        try {
            channel.truncate(0L)
        } catch (error: Exception) {
            throw DestinationException("Unable to reset the SAF destination", error)
        }
        clearMetadata(job.id)
    }

    private fun waitWhilePaused(job: HttpDownloadJob) {
        synchronized(job.monitor) {
            while (job.userPaused && !job.cancelled) {
                job.monitor.wait()
            }
        }
    }

    private fun waitForRetry(job: HttpDownloadJob, delayMs: Long) {
        var waited = 0L
        while (!job.cancelled && !job.userPaused) {
            if (hasNetwork() && waited >= delayMs) return
            synchronized(job.monitor) { job.monitor.wait(1_000L) }
            waited += 1_000L
        }
    }

    private fun pauseJobsForNetworkLoss() {
        if (hasNetwork()) return
        jobs.values.forEach { job ->
            if (!job.cancelled && !job.userPaused) {
                emitState(job.id, "waitingForNetwork", "Waiting for network connection")
                // Interrupt blocked OkHttp reads immediately instead of waiting for their timeout.
                job.cancelCalls()
                synchronized(job.monitor) { job.monitor.notifyAll() }
            }
        }
    }

    private fun wakeJobsWhenNetworkReturns() {
        if (!hasNetwork()) return
        jobs.values.forEach { job ->
            if (!job.cancelled && !job.userPaused) {
                synchronized(job.monitor) { job.monitor.notifyAll() }
            }
        }
    }

    private fun hasUsableInternet(capabilities: NetworkCapabilities): Boolean =
        capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)

    private fun hasNetwork(): Boolean {
        val network = connectivityManager.activeNetwork ?: return false
        val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
        return hasUsableInternet(capabilities)
    }

    private fun isRetryable(error: Exception): Boolean = when (error) {
        is DownloadCancelledException -> false
        is DestinationException -> false
        is HttpStatusException -> error.status == 408 || error.status == 429 || error.status >= 500
        is IOException -> true
        else -> false
    }

    private fun saveMetadata(job: HttpDownloadJob, response: Response, totalBytes: Long) {
        metadata.edit()
            .putString(metaKey(job.id, "url"), job.url)
            .putString(metaKey(job.id, "uri"), job.destinationUri.toString())
            .remove(metaKey(job.id, "etag"))
            .remove(metaKey(job.id, "lastModified"))
            .apply {
                response.header("ETag")?.let { putString(metaKey(job.id, "etag"), it) }
                response.header("Last-Modified")?.let {
                    putString(metaKey(job.id, "lastModified"), it)
                }
                if (response.code != 206 || totalBytes <= 0L) {
                    remove(metaKey(job.id, "total"))
                    remove(metaKey(job.id, "remaining"))
                }
            }
            .apply()
    }

    private fun clearMetadata(downloadId: String) {
        metadata.edit()
            .remove(metaKey(downloadId, "url"))
            .remove(metaKey(downloadId, "uri"))
            .remove(metaKey(downloadId, "etag"))
            .remove(metaKey(downloadId, "lastModified"))
            .remove(metaKey(downloadId, "total"))
            .remove(metaKey(downloadId, "remaining"))
            .apply()
    }

    private fun metaKey(downloadId: String, field: String) = "$downloadId:$field"

    private fun emitProgress(
        downloadId: String,
        downloaded: Long,
        total: Long,
        speed: Double,
        details: com.facebook.react.bridge.WritableMap? = null,
    ) {
        emit(PROGRESS_EVENT, Arguments.createMap().apply {
            putString("downloadId", downloadId)
            details?.let { putMap("details", it) }
            putDouble("downloadedBytes", downloaded.toDouble())
            putDouble("totalBytes", total.toDouble())
            putDouble("speed", speed)
        })
    }

    private fun emitState(downloadId: String, state: String, message: String? = null) {
        emit(STATE_EVENT, Arguments.createMap().apply {
            putString("downloadId", downloadId)
            putString("state", state)
            message?.let { putString("message", it) }
        })
    }

    private fun emit(eventName: String, payload: Any) {
        if (reactContext.hasActiveReactInstance()) {
            reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                .emit(eventName, payload)
        }
    }

    private fun readableHeaders(headers: ReadableMap?): Map<String, String> {
        if (headers == null) return emptyMap()
        val result = mutableMapOf<String, String>()
        val iterator = headers.keySetIterator()
        while (iterator.hasNextKey()) {
            val key = iterator.nextKey()
            headers.getString(key)?.let { result[key] = it }
        }
        return result
    }

    private fun parseRanges(value: String?): MutableList<Segment>? {
        if (value == null) return null
        if (value.isEmpty()) return mutableListOf()
        return value.split(",").map { part ->
            val bounds = part.split("-")
            val start = bounds.getOrNull(0)?.toLongOrNull() ?: return null
            val end = bounds.getOrNull(1)?.toLongOrNull() ?: return null
            if (start < 0L || end <= start) return null
            Segment(start, end)
        }.sortedBy { it.pos }.toMutableList()
    }

    private fun parseRetryAfterMs(response: Response): Long {
        val seconds = response.header("Retry-After")?.trim()?.toLongOrNull() ?: return 0L
        return (seconds * 1000L).coerceIn(0L, MAX_RETRY_AFTER_MS)
    }

    private fun parseContentRangeStart(value: String?): Long {
        return Regex("bytes\\s+(\\d+)-", RegexOption.IGNORE_CASE)
            .find(value ?: "")?.groupValues?.getOrNull(1)?.toLongOrNull() ?: -1L
    }

    private fun parseContentRangeTotal(value: String?): Long {
        return Regex("/(\\d+)$").find(value ?: "")
            ?.groupValues?.getOrNull(1)?.toLongOrNull() ?: -1L
    }
}

private class HttpStatusException(val status: Int, val retryAfterMs: Long = 0L) : IOException("HTTP $status")
// Keeps the cause text (such as ENOSPC for a full disk) so JavaScript can tell
// why the write failed.
private class DestinationException(message: String, cause: Throwable) :
    IOException(cause.message?.let { "$message: $it" } ?: message, cause)
private class RangeResetException(message: String) : IOException(message)
