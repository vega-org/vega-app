package com.vega

import android.content.Context
import android.util.Log
import android.net.Uri
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFmpegKitConfig
import com.arthenica.ffmpegkit.FFmpegSession
import com.arthenica.ffmpegkit.ReturnCode
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.util.Locale
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/**
 * On-demand remuxer using minimal FFmpegKit.
 *
 * Remuxes a remote MKV, HLS, or MP4 stream into a fragmented MP4 stream
 * without converting the whole file upfront.
 *
 * One FFmpeg run per start position feeds a LiveOutput: a 64 MB ring buffer on
 * disk. Every HTTP request for that start reads from it, so a receiver that
 * reconnects with "Range: bytes=N-" resumes at byte N instead of getting the
 * stream from its beginning again, which breaks the player's clock.
 */
class FFmpegMp4Packager(
    private val context: Context,
    private val sourceUrl: String,
    private val isLocal: Boolean,
    private val headers: Map<String, String>,
    private val audioTrackIndex: Int,
    private val audioCodec: String? = null,
    val durationSeconds: Double = 0.0,
    val totalSizeBytes: Long = 0L,
    // HLS goes through the local proxy, which resolves hosts with the app's DNS.
    private val inputUrl: String = sourceUrl,
    // Separate HLS audio rendition, added as a second input when set.
    private val audioInputUrl: String? = null,
    // Shifts the sound against the picture; positive plays it later.
    private val audioDelayMs: Int = 0,
    private val onError: (String) -> Unit = {},
    private val onMediaReady: () -> Unit = {},
    private val diagnosticId: String = java.util.UUID.randomUUID().toString().take(8)
) {
    companion object {
        private const val TAG = "FFmpegMp4Packager"

        /**
         * Audio filter for a user audio delay, or null for none. The video is
         * copied, so only the audio can move:
         * - Later: adelay puts silence in front, so each sound comes later.
         * - Earlier: timestamps move back and the part before zero is cut, so
         *   each sound comes sooner.
         */
        fun audioDelayFilter(delayMs: Int): String? = when {
            delayMs > 0 -> "adelay=delays=$delayMs:all=1"
            delayMs < 0 -> String.format(
                java.util.Locale.US, "asetpts=PTS-%.3f/TB,atrim=start=0", -delayMs / 1000.0
            )
            else -> null
        }
        private const val RING_BYTES = 64L * 1024 * 1024
        private const val CHUNK = 64 * 1024
        // How far past the produced data a reconnect may ask and still wait for it.
        private const val MAX_FORWARD_BYTES = 8L * 1024 * 1024
        private const val IDLE_CLOSE_MS = 60_000L
    }

    private val outputs = CopyOnWriteArrayList<LiveOutput>()
    @Volatile private var retired = false
    @Volatile var hasMedia = false
        private set

    /** Keep buffered bytes/URLs for the receiver handover, but stop fetching the source. */
    fun retire() {
        retired = true
        outputs.forEach { it.retire() }
        cancelAllActiveStreams()
    }

    /**
     * Returns a reader positioned at byte [offset] of the stream that starts at
     * [startSeconds], or null when that byte is no longer (or not yet) available.
     */
    @Synchronized
    fun openReader(startSeconds: Double, offset: Long): InputStream? {
        if (closed.get()) throw IllegalStateException("FFmpegMp4Packager is closed")
        outputs.filter { it.isClosed() }.forEach { outputs.remove(it) }
        val existing = outputs.firstOrNull { Math.abs(it.startSeconds - startSeconds) < 0.01 }
        if (existing != null) {
            if (existing.isFailed()) {
                existing.recentFailure()?.let { throw it }
                existing.close()
                outputs.remove(existing)
            } else existing.reader(offset)?.let { return it }
            if (offset > 0) return null
        } else if (offset > 0) {
            return null
        }
        if (retired) return null
        // A new position is a seek: the old outputs will not be read again.
        outputs.forEach { it.close() }
        outputs.clear()
        // FFmpeg opens in the pump thread: a slow start (a seek deep into a remote
        // file) does not hold this request, and a receiver retry joins the same run
        // instead of cancelling it and starting over.
        val output = LiveOutput(startSeconds) { openStream(startSeconds) }
        outputs.add(output)
        return output.reader(0)
    }

    /**
     * One FFmpeg run written into a ring buffer on disk. Readers at different byte
     * positions share it; the pump stops when it would overwrite unread bytes.
     */
    private inner class LiveOutput(val startSeconds: Double, private val openSource: () -> InputStream) {
        @Volatile private var source: InputStream? = null
        private val lock = Object()
        private val file = File.createTempFile("remux", ".ring", context.cacheDir)
        private val ring = java.io.RandomAccessFile(file, "rw")
        private val readerPositions = HashMap<Int, Long>()
        private var nextReaderId = 0
        private var written = 0L
        private var floor = 0L
        private var finished = false
        private var failure: java.io.IOException? = null
        private var failedAt = 0L
        private var mediaReady = false
        @Volatile private var retiredOutput = false
        private var closed = false
        private var idleSince = System.currentTimeMillis()

        init {
            Thread({ pump() }, "remux-pump").apply { isDaemon = true; start() }
        }

        fun isClosed() = synchronized(lock) { closed }
        fun isFailed() = synchronized(lock) { finished && failure != null }
        fun recentFailure() = synchronized(lock) {
            failure?.takeIf { System.currentTimeMillis() - failedAt < 5_000L }
        }

        fun retire() {
            retiredOutput = true
            synchronized(lock) { finished = true; lock.notifyAll() }
            try { source?.close() } catch (_: Exception) {}
        }

        private fun pump() {
            val buffer = ByteArray(CHUNK)
            val media = Mp4MediaProbe()
            try {
                val opened = openSource()
                synchronized(lock) {
                    if (closed || retiredOutput) { try { opened.close() } catch (_: Exception) {}; return }
                    source = opened
                }
                while (true) {
                    synchronized(lock) {
                        while (!closed && !retiredOutput && written + CHUNK - floor > RING_BYTES) {
                            if (readerPositions.isEmpty() &&
                                System.currentTimeMillis() - idleSince > IDLE_CLOSE_MS
                            ) {
                                VegaLog.i(TAG, "No reader for ${IDLE_CLOSE_MS / 1000}s; stopping remux at ${startSeconds}s")
                                closeLocked()
                            } else {
                                lock.wait(1_000)
                            }
                        }
                        if (closed) return
                    }
                    if (retiredOutput) break
                    val count = opened.read(buffer)
                    if (count < 0) break
                    media.accept(buffer, count)
                    val notifyReady = media.hasMedia && !hasMedia
                    synchronized(lock) {
                        if (closed) return
                        writeRing(written, buffer, count)
                        written += count
                        mediaReady = media.hasMedia
                        lock.notifyAll()
                    }
                    if (notifyReady) { hasMedia = true; onMediaReady() }
                }
                if (!media.hasMedia && !retiredOutput && !isClosed()) {
                    throw java.io.IOException("Video server returned no playable media data. Refresh the link or try another server.")
                }
            } catch (e: Exception) {
                if (!isClosed() && !retiredOutput) {
                    synchronized(lock) {
                        failure = java.io.IOException(e.message ?: "Media delivery failed", e)
                        failedAt = System.currentTimeMillis()
                    }
                    onError(e.message ?: "Media delivery failed")
                    VegaLog.w(TAG, "Remux output ended: ${e.message}")
                }
            } finally {
                try { source?.close() } catch (_: Exception) {}
            }
            synchronized(lock) {
                finished = true
                lock.notifyAll()
            }
        }

        private fun writeRing(position: Long, data: ByteArray, count: Int) {
            val at = position % RING_BYTES
            val first = minOf(count.toLong(), RING_BYTES - at).toInt()
            ring.seek(at)
            ring.write(data, 0, first)
            if (first < count) {
                ring.seek(0)
                ring.write(data, first, count - first)
            }
        }

        private fun updateFloorLocked() {
            floor = readerPositions.values.minOrNull() ?: maxOf(floor, written - RING_BYTES)
            if (readerPositions.isEmpty()) idleSince = System.currentTimeMillis()
            lock.notifyAll()
        }

        fun reader(offset: Long): InputStream? = synchronized(lock) {
            if (closed || offset < written - RING_BYTES || offset > written + MAX_FORWARD_BYTES) return null
            val id = nextReaderId++
            readerPositions[id] = offset
            updateFloorLocked()
            object : InputStream() {
                private var position = offset
                private var done = false

                override fun read(): Int {
                    val one = ByteArray(1)
                    return if (read(one, 0, 1) < 0) -1 else one[0].toInt() and 0xFF
                }

                override fun read(b: ByteArray, off: Int, len: Int): Int {
                    if (len == 0) return 0
                    synchronized(lock) {
                        while (!closed && !done && (position >= written || !mediaReady) && !finished) lock.wait(1_000)
                        if (closed || done) throw java.io.IOException("Stream Closed")
                        if (finished && !mediaReady) {
                            failure?.let { throw it }
                            return -1
                        }
                        if (position >= written) {
                            failure?.let { throw it }
                            return -1
                        }
                        if (position < written - RING_BYTES) {
                            throw java.io.IOException("Reader fell behind the remux buffer")
                        }
                        val at = position % RING_BYTES
                        val count = minOf(len.toLong(), written - position, RING_BYTES - at).toInt()
                        ring.seek(at)
                        ring.readFully(b, off, count)
                        position += count
                        readerPositions[id] = position
                        updateFloorLocked()
                        return count
                    }
                }

                override fun close() {
                    synchronized(lock) {
                        if (done) return
                        VegaLog.i(TAG, "Remux reader closed id=$diagnosticId reader=$id startSeconds=$startSeconds rangeStart=$offset bytesServed=${position - offset} bytesProduced=$written appClosed=$closed retired=$retiredOutput finished=$finished")
                        done = true
                        readerPositions.remove(id)
                        updateFloorLocked()
                    }
                }
            }
        }

        fun close() = synchronized(lock) { closeLocked() }

        private fun closeLocked() {
            if (closed) return
            closed = true
            lock.notifyAll()
            try { source?.close() } catch (_: Exception) {}
            try { ring.close() } catch (_: Exception) {}
            file.delete()
        }
    }

    private data class ActiveStream(
        val sessionId: Long,
        val pipePath: String,
        val session: FFmpegSession,
        val fileStream: FileInputStream,
        val startSeconds: Double,
        val failure: AtomicReference<String?>,
        val completion: CompletableFuture<Unit>
    )

    private val activeStreams = CopyOnWriteArrayList<ActiveStream>()
    private val closed = AtomicBoolean(false)

    /**
     * Starts an FFmpeg remuxing process producing fragmented MP4 to a named pipe,
     * and returns an [InputStream] reading from that pipe.
     *
     * @param startSeconds Keyframe seek position in seconds (0.0 for start).
     */
    private fun openStream(startSeconds: Double = 0.0): InputStream {
        if (closed.get() || retired) throw IllegalStateException("FFmpegMp4Packager is closed")
        RemoteSourceFailures.check(sourceUrl)
        RemoteSourceFailures.noteRemuxStart()

        // Cancel existing streams that belong to a significantly DIFFERENT playback timestamp (seek)
        for (active in activeStreams) {
            if (Math.abs(active.startSeconds - startSeconds) > 2.0) {
                cleanupStream(active)
            }
        }
        // Prevent unbounded accumulation if receiver opens multiple probe connections
        while (activeStreams.size >= 3) {
            val oldest = activeStreams.firstOrNull() ?: break
            cleanupStream(oldest)
        }

        val pipePath = FFmpegKitConfig.registerNewFFmpegPipe(context)
            ?: throw IllegalStateException("Failed to register FFmpeg pipe")

        val args = mutableListOf<String>()

        args.add("-hide_banner")
        args.add("-loglevel")
        args.add("warning")

        // Per-input options (seek, headers, HLS flags) must precede each "-i".
        fun addInput(target: MutableList<String>, url: String) {
            // Fast keyframe seek before input. For video with B-frames FFmpeg seeks to
            // 3/23 s before -ss, so a start exactly on a Cue keyframe lands on the previous
            // keyframe, seconds early: video then begins before audio and before the
            // subtitle offset. Aim just past the keyframe so FFmpeg lands on it.
            if (startSeconds > 0.05) {
                target.add("-ss")
                target.add(String.format(Locale.US, "%.3f", startSeconds + 0.2))
            }

            // Remote streaming reconnect options
            if (!isLocal && !sourceUrl.startsWith("file://") && !sourceUrl.startsWith("content://")) {
                val ua = headers.entries.firstOrNull { it.key.equals("user-agent", ignoreCase = true) }?.value
                    ?: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
                target.add("-user_agent")
                target.add(ua)

                val ref = headers.entries.firstOrNull { it.key.equals("referer", ignoreCase = true) }?.value
                if (!ref.isNullOrBlank()) {
                    target.add("-referer")
                    target.add(ref)
                }

                VegaLog.i(TAG, "FFmpeg remux forwarding headers: ${headers.keys}")

                target.add("-reconnect")
                target.add("1")
                target.add("-reconnect_streamed")
                target.add("1")
                target.add("-reconnect_delay_max")
                target.add("5")
                // HLS-demuxer option only: FFmpeg rejects it for a plain MP4/MKV input.
                if (sourceUrl.contains(".m3u8", ignoreCase = true)) {
                    target.add("-seg_max_retry")
                    target.add("5")
                }

                val headerBuilder = StringBuilder()
                headers.forEach { (k, v) ->
                    if (!k.equals("user-agent", ignoreCase = true) && !k.equals("referer", ignoreCase = true)) {
                        val cleanVal = v.replace("\r", "").replace("\n", "").trim()
                        headerBuilder.append("$k: $cleanVal\r\n")
                    }
                }
                if (headerBuilder.isNotEmpty()) {
                    target.add("-headers")
                    target.add(headerBuilder.toString())
                }
            }

            // HLS hosts often disguise segments as .js/.png/.jpg; FFmpeg's HLS demuxer
            // rejects those unless the extension checks are turned off.
            if (sourceUrl.contains(".m3u8", ignoreCase = true) || url.contains(".m3u8", ignoreCase = true)) {
                target.add("-allowed_extensions")
                target.add("ALL")
                target.add("-allowed_segment_extensions")
                target.add("ALL")
                target.add("-extension_picky")
                target.add("0")
            }
            target.add("-i")
            target.add(if (url.startsWith("content://")) {
                FFmpegKitConfig.getSafParameterForRead(context, Uri.parse(url))
                    ?: throw IllegalArgumentException("Cannot open SAF source")
            } else url)
        }

        // A separate HLS audio rendition shares the video's MPEG-TS clock. FFmpeg
        // normally rebases each input to its own start, and the two playlists seek to
        // different segment boundaries, so audio drifts off the video. Keep the source
        // timestamps instead; -avoid_negative_ts make_zero shifts both streams together.
        if (audioInputUrl != null) args.add("-copyts")
        addInput(args, inputUrl)
        audioInputUrl?.let { addInput(args, it) }

        // Video stream selection & copy (0% CPU)
        args.add("-map")
        args.add("0:v:0")
        args.add("-c:v")
        args.add("copy")

        // Audio stream selection & transcode strategy.
        // Always transcode to stereo AAC 192k: Cast and browsers cannot play AC3, EAC3
        // or DTS, and one output format keeps receivers predictable. 5.1 is downmixed.
        args.add("-map")
        args.add(if (audioInputUrl != null) "1:a:0" else "0:a:$audioTrackIndex?")
        audioDelayFilter(audioDelayMs)?.let {
            args.add("-af")
            args.add(it)
        }
        args.add("-c:a")
        args.add("aac")
        args.add("-b:a")
        args.add("192k")
        args.add("-ac")
        args.add("2")

        // Exclude subtitles, data streams, and chapters from the output MP4
        args.add("-sn")
        args.add("-dn")
        args.add("-map_chapters")
        args.add("-1")

        // Output format: fragmented MP4 suitable for chunked streaming
        args.add("-f")
        args.add("mp4")
        args.add("-movflags")
        args.add("frag_keyframe+empty_moov+default_base_moof")
        // Also cut a fragment every second. Keyframes alone can be 10s apart, so
        // FFmpeg would hold 10s of video while audio ran ahead in the byte stream,
        // and receivers froze the picture with the audio still playing.
        args.add("-frag_duration")
        args.add("1000000")
        args.add("-avoid_negative_ts")
        args.add("make_zero")

        // Output to named pipe
        args.add("-y")
        args.add(pipePath)

        VegaLog.i(TAG, "Remux start id=$diagnosticId startSeconds=$startSeconds audioTrack=$audioTrackIndex sourceDuration=$durationSeconds audio=transcode-aac")

        val prematureEndWarning = AtomicBoolean(false)
        val failure = AtomicReference<String?>(null)
        val completion = CompletableFuture<Unit>()
        val session = FFmpegKit.executeWithArgumentsAsync(
            args.toTypedArray(),
            { completedSession ->
                val returnCode = completedSession.returnCode
                VegaLog.i(TAG, "Remux result id=$diagnosticId startSeconds=$startSeconds code=$returnCode appClosed=${closed.get()} retired=$retired mediaReady=$hasMedia outputTimeMs=${completedSession.lastReceivedStatistics?.time}")
                // FFmpeg can recover from an EOF warning while probing the MKV tail.
                // Judge truncation after processing ends, never while bytes still flow.
                if (ReturnCode.isSuccess(returnCode) && RemuxCompletionPolicy.endedEarly(
                        prematureEndWarning.get(), (durationSeconds - startSeconds) * 1000.0,
                        completedSession.lastReceivedStatistics?.time)) {
                    failure.compareAndSet(null, "Video stream ended unexpectedly. Refresh the link or try another server.")
                }
                if (ReturnCode.isSuccess(returnCode) && failure.get() == null) {
                    VegaLog.i(TAG, "FFmpeg remux session completed successfully")
                } else if (ReturnCode.isSuccess(returnCode)) {
                    VegaLog.w(TAG, "FFmpeg ended with a delivery failure: ${failure.get()}")
                } else if (ReturnCode.isCancel(returnCode)) {
                    VegaLog.i(TAG, "FFmpeg remux cancelled id=$diagnosticId appClosed=${closed.get()} retired=$retired")
                } else {
                    failure.compareAndSet(null, "Video processing failed. Refresh the link or try another server.")
                    VegaLog.w(TAG, "FFmpeg remux session failed with code $returnCode: ${completedSession.failStackTrace}")
                    VegaLog.w(TAG, "FFmpeg session output id=$diagnosticId: ${completedSession.allLogsAsString?.replace(Regex("https?://[^\\s]+"), "[media URL]")?.takeLast(4000)}")
                    // Unblock any waiting reader in background daemon so this thread never blocks
                    unblockPipeAsync(pipePath)
                }
                completion.complete(Unit)
            },
            { log ->
                val status = Regex("HTTP error (403|429)").find(log.message)?.groupValues?.get(1)?.toIntOrNull()
                if (status != null) {
                    RemoteSourceFailures.record(sourceUrl, status)
                    val message = if (status == 429) "Video server rate limited requests (HTTP 429). Wait before retrying."
                        else "Video server denied access (HTTP 403). Refresh the link or try another server."
                    failure.set(message)
                } else if (log.message.contains("File ended prematurely", ignoreCase = true)) {
                    prematureEndWarning.set(true)
                }
                VegaLog.w(TAG, "[FFmpeg id=$diagnosticId] ${log.message.replace(Regex("https?://[^\\s]+"), "[media URL]").take(1200)}")
            },
            null
        )

        // Open pipe for reading. CompletableFuture with timeout prevents hanging if FFmpeg fails to launch.
        val future = CompletableFuture.supplyAsync {
            FileInputStream(File(pipePath))
        }
        val fileStream = try {
            future.get(25, TimeUnit.SECONDS)
        } catch (e: Exception) {
            future.cancel(true)
            session.cancel()
            // Asynchronously unblock worker thread so this thread never blocks on FIFO open
            unblockPipeAsync(pipePath)
            try {
                FFmpegKitConfig.closeFFmpegPipe(pipePath)
            } catch (_: Exception) {}
            throw java.io.IOException("Failed or timed out connecting to FFmpeg pipe: ${e.message}", e)
        }
        val activeStream = ActiveStream(session.sessionId, pipePath, session, fileStream, startSeconds, failure, completion)
        activeStreams.add(activeStream)
        if (closed.get() || retired) {
            cleanupStream(activeStream)
            throw java.io.IOException("Stream Closed")
        }

        return createPatchedInputStream(activeStream, startSeconds)
    }

    private fun createPatchedInputStream(
        activeStream: ActiveStream,
        startSeconds: Double
    ): InputStream {
        val remainingSeconds = if (durationSeconds > 0.0) {
            (durationSeconds - startSeconds).coerceAtLeast(1.0)
        } else {
            0.0
        }

        val fileStream = activeStream.fileStream
        val streamClosed = AtomicBoolean(false)

        fun checkedRead(count: Int): Int {
            if (count < 0) {
                // EOF can precede FFmpeg's completion callback by a few milliseconds.
                try { activeStream.completion.get(2, TimeUnit.SECONDS) } catch (_: Exception) {}
            }
            activeStream.failure.get()?.let { throw java.io.IOException(it) }
            return count
        }

        return object : InputStream() {
            private var headerBuf: ByteArray? = null
            private var headerPos = 0
            private var initialized = false

            @Synchronized
            private fun initHeaderIfNeeded() {
                if (initialized) return
                initialized = true

                if (remainingSeconds <= 0.0) return

                try {
                    val bos = ByteArrayOutputStream()
                    val header8 = ByteArray(8)
                    var foundMoov = false

                    // Read top-level boxes until we complete the 'moov' box
                    while (!foundMoov && bos.size() < 100_000) {
                        if (!readFully(fileStream, header8)) break
                        bos.write(header8)
                        val boxSize = readInt(header8, 0).toLong() and 0xffffffffL
                        val boxType = String(header8, 4, 4, Charsets.US_ASCII)

                        if (boxSize < 8L || boxSize > 5_000_000L) {
                            // Invalid box header, stop intercepting
                            break
                        }

                        val restSize = (boxSize - 8L).toInt()
                        val rest = ByteArray(restSize)
                        if (!readFully(fileStream, rest)) break
                        bos.write(rest)

                        if (boxType == "moov") {
                            foundMoov = true
                            break
                        }
                    }

                    val rawHeader = bos.toByteArray()
                    if (foundMoov) {
                        patchMoovDuration(rawHeader, remainingSeconds)
                    }
                    if (rawHeader.isNotEmpty()) {
                        headerBuf = rawHeader
                    }
                } catch (e: Exception) {
                    VegaLog.w(TAG, "Error intercepting initial MP4 header: ${e.message}")
                }
            }

            @Synchronized
            override fun read(): Int {
                initHeaderIfNeeded()
                val buf = headerBuf
                if (buf != null && headerPos < buf.size) {
                    val b = buf[headerPos].toInt() and 0xFF
                    headerPos++
                    if (headerPos >= buf.size) {
                        headerBuf = null
                    }
                    return b
                }
                return checkedRead(fileStream.read())
            }

            override fun read(b: ByteArray): Int {
                return read(b, 0, b.size)
            }

            @Synchronized
            override fun read(b: ByteArray, off: Int, len: Int): Int {
                if (len == 0) return 0
                initHeaderIfNeeded()
                val buf = headerBuf
                if (buf != null && headerPos < buf.size) {
                    val available = buf.size - headerPos
                    val toCopy = Math.min(len, available)
                    System.arraycopy(buf, headerPos, b, off, toCopy)
                    headerPos += toCopy
                    if (headerPos >= buf.size) {
                        headerBuf = null
                    }
                    return toCopy
                }
                return checkedRead(fileStream.read(b, off, len))
            }

            @Synchronized
            override fun available(): Int {
                initHeaderIfNeeded()
                val buf = headerBuf
                val fromBuf = if (buf != null && headerPos < buf.size) buf.size - headerPos else 0
                return fromBuf + fileStream.available()
            }

            override fun close() {
                if (streamClosed.compareAndSet(false, true)) {
                    cleanupStream(activeStream)
                }
            }
        }
    }

    private fun patchMoovDuration(headerBytes: ByteArray, remainingSeconds: Double) {
        if (remainingSeconds <= 0.0) return

        var movieTimescale = 1000L

        // 1. Locate mvhd to determine movie timescale and patch mvhd duration
        for (offset in 0 until headerBytes.size - 32) {
            if (headerBytes[offset + 4] == 'm'.code.toByte() &&
                headerBytes[offset + 5] == 'v'.code.toByte() &&
                headerBytes[offset + 6] == 'h'.code.toByte() &&
                headerBytes[offset + 7] == 'd'.code.toByte()
            ) {
                val version = headerBytes[offset + 8].toInt() and 0xFF
                if (version == 0) {
                    val scale = readInt(headerBytes, offset + 20).toLong() and 0xffffffffL
                    if (scale > 0L) movieTimescale = scale
                    val durTicks = (remainingSeconds * movieTimescale).toLong().coerceIn(0L, 0xffffffffL).toInt()
                    putInt(headerBytes, offset + 24, durTicks)
                } else if (version == 1) {
                    val scale = readInt(headerBytes, offset + 28).toLong() and 0xffffffffL
                    if (scale > 0L) movieTimescale = scale
                    val durTicks = (remainingSeconds * movieTimescale).toLong()
                    putLong(headerBytes, offset + 32, durTicks)
                }
                break
            }
        }

        // 2. Patch tkhd, mdhd, and mehd (if present)
        for (offset in 0 until headerBytes.size - 32) {
            val b4 = headerBytes[offset + 4]
            val b5 = headerBytes[offset + 5]
            val b6 = headerBytes[offset + 6]
            val b7 = headerBytes[offset + 7]
            val version = headerBytes[offset + 8].toInt() and 0xFF

            if (b4 == 't'.code.toByte() && b5 == 'k'.code.toByte() && b6 == 'h'.code.toByte() && b7 == 'd'.code.toByte()) {
                if (version == 0) {
                    val durTicks = (remainingSeconds * movieTimescale).toLong().coerceIn(0L, 0xffffffffL).toInt()
                    putInt(headerBytes, offset + 28, durTicks)
                } else if (version == 1) {
                    val durTicks = (remainingSeconds * movieTimescale).toLong()
                    putLong(headerBytes, offset + 36, durTicks)
                }
            } else if (b4 == 'm'.code.toByte() && b5 == 'd'.code.toByte() && b6 == 'h'.code.toByte() && b7 == 'd'.code.toByte()) {
                if (version == 0) {
                    val scale = (readInt(headerBytes, offset + 20).toLong() and 0xffffffffL).coerceAtLeast(1L)
                    val durTicks = (remainingSeconds * scale).toLong().coerceIn(0L, 0xffffffffL).toInt()
                    putInt(headerBytes, offset + 24, durTicks)
                } else if (version == 1) {
                    val scale = (readInt(headerBytes, offset + 28).toLong() and 0xffffffffL).coerceAtLeast(1L)
                    val durTicks = (remainingSeconds * scale).toLong()
                    putLong(headerBytes, offset + 32, durTicks)
                }
            } else if (b4 == 'm'.code.toByte() && b5 == 'e'.code.toByte() && b6 == 'h'.code.toByte() && b7 == 'd'.code.toByte()) {
                if (version == 0) {
                    val durTicks = (remainingSeconds * movieTimescale).toLong().coerceIn(0L, 0xffffffffL).toInt()
                    putInt(headerBytes, offset + 12, durTicks)
                } else if (version == 1) {
                    val durTicks = (remainingSeconds * movieTimescale).toLong()
                    putLong(headerBytes, offset + 12, durTicks)
                }
            }
        }
        VegaLog.i(TAG, "Patched MP4 header duration to ${remainingSeconds}s (timescale: $movieTimescale)")
    }

    private fun readInt(b: ByteArray, offset: Int): Int =
        ((b[offset].toInt() and 0xFF) shl 24) or
        ((b[offset + 1].toInt() and 0xFF) shl 16) or
        ((b[offset + 2].toInt() and 0xFF) shl 8) or
        (b[offset + 3].toInt() and 0xFF)

    private fun putInt(b: ByteArray, offset: Int, v: Int) {
        b[offset] = (v ushr 24).toByte()
        b[offset + 1] = (v ushr 16).toByte()
        b[offset + 2] = (v ushr 8).toByte()
        b[offset + 3] = v.toByte()
    }

    private fun putLong(b: ByteArray, offset: Int, v: Long) {
        putInt(b, offset, (v ushr 32).toInt())
        putInt(b, offset + 4, v.toInt())
    }

    private fun readFully(input: InputStream, b: ByteArray): Boolean {
        var readTotal = 0
        while (readTotal < b.size) {
            val r = input.read(b, readTotal, b.size - readTotal)
            if (r < 0) return false
            readTotal += r
        }
        return true
    }

    private fun cleanupStream(stream: ActiveStream) {
        try {
            stream.fileStream.close()
        } catch (_: Exception) {}

        try {
            if (!stream.session.state.name.equals("COMPLETED", ignoreCase = true) &&
                !stream.session.state.name.equals("FAILED", ignoreCase = true)
            ) {
                stream.session.cancel()
            }
        } catch (e: Exception) {
            VegaLog.w(TAG, "Error cancelling FFmpeg session: ${e.message}")
        }

        try {
            FFmpegKitConfig.closeFFmpegPipe(stream.pipePath)
        } catch (e: Exception) {
            VegaLog.w(TAG, "Error closing FFmpeg pipe: ${e.message}")
        }

        activeStreams.remove(stream)
    }

    private fun cancelAllActiveStreams() {
        for (stream in activeStreams) {
            cleanupStream(stream)
        }
    }

    private fun unblockPipeAsync(pipePath: String) {
        Thread {
            try {
                java.io.RandomAccessFile(File(pipePath), "rw").use { }
            } catch (_: Exception) {
                try {
                    java.io.FileOutputStream(File(pipePath)).close()
                } catch (_: Exception) {}
            }
        }.apply {
            isDaemon = true
            name = "fifo-unblock"
            start()
        }
    }

    @Synchronized
    fun close() {
        if (closed.compareAndSet(false, true)) {
            VegaLog.i(TAG, "Remux close requested id=$diagnosticId outputs=${outputs.size} activeStreams=${activeStreams.size}")
            outputs.forEach { it.close() }
            outputs.clear()
            cancelAllActiveStreams()
        }
    }
}
