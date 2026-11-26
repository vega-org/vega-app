package com.vega

import android.content.Context
import android.net.Uri
import android.util.Log
import com.arthenica.ffmpegkit.FFmpegKit
import com.arthenica.ffmpegkit.FFmpegKitConfig
import com.arthenica.ffmpegkit.FFmpegSession
import com.arthenica.ffmpegkit.ReturnCode
import java.io.File
import java.util.Locale
import java.util.UUID

/**
 * Serves a source as a VOD HLS playlist of MPEG-TS segments, so a Cast receiver
 * knows the whole timeline and seeks by itself instead of asking the phone to
 * rebuild the stream.
 *
 * Segment boundaries come from the source's keyframe index, so every segment is
 * cut where stream copy can start. The playlist is written before any media
 * exists. One FFmpeg run writes consecutive segments from a start index into its
 * own directory; a request outside what that run will reach soon replaces it
 * with a run from the requested segment. Source timestamps are kept, so segments
 * from different runs line up on the same clock as the playlist.
 */
class HlsSegmentPackager(
    private val context: Context,
    private val inputUrl: String,
    private val isLocal: Boolean,
    private val headers: Map<String, String>,
    private val audioTrackIndex: Int,
    private val durationSeconds: Double,
    keyframesUs: LongArray,
    // Shifts the sound against the picture; positive plays it later.
    private val audioDelayMs: Int = 0,
    private val onError: (String) -> Unit = {}
) {
    companion object {
        private const val TAG = "HlsSegmentPackager"
        private const val TARGET_SEGMENT_SECONDS = 6.0
        // A run may produce this many segments past the last request before it pauses.
        private const val MAX_AHEAD = 8
        // Segments this far behind the last request are deleted.
        private const val KEEP_BEHIND = 3
        // A request this many segments past the run's position waits instead of restarting.
        private const val WAIT_AHEAD = 3
        private const val SEGMENT_WAIT_MS = 45_000L
        // Cache directories left by a crash are removed once they are this old.
        private const val STALE_DIR_MS = 60 * 60 * 1000L

        /** Segment starts in seconds, or null when the index cannot describe the source. */
        fun buildBoundaries(keyframesUs: LongArray, durationSeconds: Double): DoubleArray? {
            if (durationSeconds <= 0.0 || keyframesUs.size < 2) return null
            val boundaries = ArrayList<Double>()
            boundaries.add(0.0)
            // Cut at the first keyframe at or after each 6 s step from the last cut.
            for (us in keyframesUs) {
                val seconds = us / 1_000_000.0
                if (seconds >= durationSeconds) break
                if (seconds - boundaries.last() >= TARGET_SEGMENT_SECONDS) boundaries.add(seconds)
            }
            return boundaries.toDoubleArray()
        }

        private fun deleteStaleDirs(cacheDir: File) {
            val now = System.currentTimeMillis()
            cacheDir.listFiles { f -> f.isDirectory && f.name.startsWith("hls_") }?.forEach { dir ->
                val newest = dir.walkTopDown().maxOfOrNull { it.lastModified() } ?: dir.lastModified()
                if (now - newest > STALE_DIR_MS) dir.deleteRecursively()
            }
        }
    }

    private val keyframesSeconds = keyframesUs.map { it / 1_000_000.0 }.sorted()
    private val starts: DoubleArray = buildBoundaries(keyframesUs.sortedArray(), durationSeconds)
        ?: throw IllegalArgumentException("No usable keyframe index for HLS segments")
    private val dir: File
    private val lock = Object()
    private var run: Run? = null
    private var lastRequested = 0
    @Volatile private var closed = false

    init {
        deleteStaleDirs(context.cacheDir)
        dir = File(context.cacheDir, "hls_${UUID.randomUUID()}").apply { mkdirs() }
    }

    val segmentCount: Int get() = starts.size

    private class Run(val startIndex: Int, val dir: File) {
        @Volatile var session: FFmpegSession? = null
        @Volatile var ended = false
        @Volatile var canceled = false
        @Volatile var succeeded = false
        @Volatile var processExited = false
    }

    private fun segmentEnd(index: Int) =
        if (index + 1 < starts.size) starts[index + 1] else durationSeconds

    private fun segmentFile(run: Run, index: Int) = File(run.dir, "seg$index.ts")

    fun playlist(): String {
        val sb = StringBuilder()
        val maxDuration = starts.indices.maxOf { segmentEnd(it) - starts[it] }
        sb.append("#EXTM3U\n#EXT-X-VERSION:3\n")
        sb.append("#EXT-X-PLAYLIST-TYPE:VOD\n")
        sb.append("#EXT-X-TARGETDURATION:${Math.ceil(maxDuration).toInt()}\n")
        sb.append("#EXT-X-MEDIA-SEQUENCE:0\n")
        for (i in starts.indices) {
            sb.append(String.format(Locale.US, "#EXTINF:%.3f,\n", segmentEnd(i) - starts[i]))
            sb.append("seg$i.ts\n")
        }
        sb.append("#EXT-X-ENDLIST\n")
        return sb.toString()
    }

    /**
     * The finished file for a segment, or null. A segment is finished once its
     * run has opened the next one, or the run ended normally. The last file of a
     * canceled or failed run may be partial and never counts.
     */
    private fun finishedFileLocked(index: Int): File? {
        val current = run ?: return null
        if (index < current.startIndex) return null
        val file = segmentFile(current, index)
        if (!file.exists()) return null
        if (segmentFile(current, index + 1).exists()) return file
        return if (current.ended && current.succeeded) file else null
    }

    /** Highest segment the run has started writing, or startIndex - 1 before the first. */
    private fun producedLocked(current: Run): Int {
        var highest = current.startIndex - 1
        current.dir.listFiles()?.forEach { file ->
            val n = file.name.removePrefix("seg").removeSuffix(".ts").toIntOrNull() ?: return@forEach
            if (n > highest) highest = n
        }
        return highest
    }

    private fun reachableLocked(index: Int): Boolean {
        val current = run ?: return false
        return !current.ended && index >= current.startIndex && index <= producedLocked(current) + WAIT_AHEAD
    }

    /** An opened segment; a run replaced later deletes the file but not the open handle. */
    class Segment(val stream: java.io.InputStream, val length: Long)

    /** Opens the finished segment, waiting for FFmpeg to write it. */
    fun segment(index: Int): Segment? {
        if (index !in starts.indices || closed) return null
        val deadline = System.currentTimeMillis() + SEGMENT_WAIT_MS
        var retried = false
        var expectedRun: Run?
        synchronized(lock) {
            if (finishedFileLocked(index) != null || reachableLocked(index)) {
                lastRequested = maxOf(lastRequested, index)
            } else {
                lastRequested = index
                startRunLocked(index)
            }
            pruneLocked(index)
            expectedRun = run
        }
        while (System.currentTimeMillis() < deadline && !closed) {
            synchronized(lock) {
                finishedFileLocked(index)?.let { file ->
                    try {
                        return Segment(java.io.FileInputStream(file), file.length())
                    } catch (_: java.io.FileNotFoundException) {
                        if (closed) return null
                    }
                }
                if (!reachableLocked(index)) {
                    // A newer request moved the run elsewhere: this one is stale, so
                    // it must not pull the run back.
                    if (run !== expectedRun || lastRequested > index + KEEP_BEHIND || lastRequested < index - WAIT_AHEAD) return null
                    // The run ended without this segment; try once more from here.
                    if (retried) return null
                    retried = true
                    lastRequested = maxOf(lastRequested, index)
                    startRunLocked(index)
                    expectedRun = run
                }
            }
            try { Thread.sleep(150) } catch (_: InterruptedException) { return null }
        }
        return null
    }

    private fun pruneLocked(index: Int) {
        val current = run ?: return
        current.dir.listFiles()?.forEach { file ->
            val n = file.name.removePrefix("seg").removeSuffix(".ts").toIntOrNull() ?: return@forEach
            if (n < index - KEEP_BEHIND) file.delete()
        }
    }

    private fun startRunLocked(index: Int) {
        run?.let { previous ->
            stopRunLocked(previous)
            if (previous.processExited) {
                try { previous.dir.deleteRecursively() } catch (_: Exception) {}
            }
        }
        val created = Run(index, File(dir, "run_${UUID.randomUUID()}").apply { mkdirs() })
        run = created
        val args = try {
            buildArgs(index, created.dir)
        } catch (e: Exception) {
            VegaLog.w(TAG, "Cannot start HLS run: ${e.message}")
            created.ended = true
            created.processExited = true
            try { created.dir.deleteRecursively() } catch (_: Exception) {}
            return
        }
        VegaLog.i(TAG, "Starting HLS run at segment $index (${starts[index]}s)")
        created.session = FFmpegKit.executeWithArgumentsAsync(
            args.toTypedArray(),
            { done ->
                val failedMessage: String?
                synchronized(lock) {
                    val ok = !created.canceled && ReturnCode.isSuccess(done.returnCode)
                    created.succeeded = ok
                    created.ended = true
                    created.processExited = true
                    failedMessage = if (!ok && !created.canceled && !ReturnCode.isCancel(done.returnCode) && !closed) {
                        "Video processing failed. Refresh the link or try another server."
                    } else null
                    if (run !== created || closed) {
                        try { created.dir.deleteRecursively() } catch (_: Exception) {}
                        if (closed && dir.list()?.isEmpty() != false) {
                            try { dir.deleteRecursively() } catch (_: Exception) {}
                        }
                    }
                }
                VegaLog.i(TAG, "HLS run from segment $index ended: ${done.returnCode}")
                failedMessage?.let { onError(it) }
            },
            { log ->
                val status = Regex("HTTP error (403|429)").find(log.message)?.groupValues?.get(1)?.toIntOrNull()
                if (status != null) {
                    RemoteSourceFailures.record(inputUrl, status)
                    val message = if (status == 429) {
                        "Video server rate limited requests (HTTP 429). Wait before retrying."
                    } else {
                        "Video server denied access (HTTP 403). Refresh the link or try another server."
                    }
                    onError(message)
                }
                VegaLog.w(TAG, "[FFmpeg] ${log.message.replace(Regex("https?://[^\\s]+"), "[media URL]").take(1200)}")
            },
            null
        )
        watchAhead(created)
    }

    private fun stopRunLocked(current: Run) {
        current.canceled = true
        if (!current.ended) {
            current.succeeded = false
            current.ended = true
        }
        try { current.session?.cancel() } catch (_: Exception) {}
    }

    /** Pauses a run that is far ahead of the receiver; a later request restarts it. */
    private fun watchAhead(current: Run) {
        Thread {
            while (!closed && !current.ended) {
                synchronized(lock) {
                    if (run === current && producedLocked(current) > lastRequested + MAX_AHEAD) {
                        VegaLog.i(TAG, "Pausing HLS run at segment ${producedLocked(current)}")
                        stopRunLocked(current)
                    }
                }
                try { Thread.sleep(1000) } catch (_: InterruptedException) { return@Thread }
            }
        }.apply { isDaemon = true }.start()
    }

    private fun buildArgs(index: Int, outDir: File): List<String> {
        val args = mutableListOf("-hide_banner", "-loglevel", "warning")
        val start = starts[index]
        if (start > 0.0) {
            // Aim just past the cut so the demuxer lands on that keyframe and not the
            // one before, but never as far as the next keyframe.
            val next = keyframesSeconds.firstOrNull { it > start + 0.0005 }
            val pad = if (next != null) minOf(0.2, (next - start) / 2) else 0.2
            args += listOf("-ss", String.format(Locale.US, "%.6f", start + pad), "-noaccurate_seek")
        }
        if (!isLocal && !inputUrl.startsWith("file://") && !inputUrl.startsWith("content://")) {
            val ua = headers.entries.firstOrNull { it.key.equals("user-agent", true) }?.value
                ?: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
            args += listOf("-user_agent", ua)
            headers.entries.firstOrNull { it.key.equals("referer", true) }?.value
                ?.takeIf { it.isNotBlank() }?.let { args += listOf("-referer", it) }
            args += listOf("-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5")
            val extra = headers.filterKeys { !it.equals("user-agent", true) && !it.equals("referer", true) }
                .entries.joinToString("") { (k, v) -> "$k: ${v.replace("\r", "").replace("\n", "").trim()}\r\n" }
            if (extra.isNotEmpty()) args += listOf("-headers", extra)
        }
        args += "-copyts"
        args += listOf("-i", if (inputUrl.startsWith("content://")) {
            FFmpegKitConfig.getSafParameterForRead(context, Uri.parse(inputUrl))
                ?: throw IllegalArgumentException("Cannot open SAF source")
        } else inputUrl)

        args += listOf("-map", "0:v:0", "-map", "0:a:$audioTrackIndex?", "-c:v", "copy")
        FFmpegMp4Packager.audioDelayFilter(audioDelayMs)?.let { args += listOf("-af", it) }
        // Same audio as the MP4 route: receivers cannot play AC3, EAC3 or DTS.
        args += listOf("-c:a", "aac", "-b:a", "192k", "-ac", "2")
        args += listOf("-sn", "-dn", "-map_chapters", "-1")

        // The muxer cuts at the first keyframe at or after each time. It measures
        // times from the first packet of the run, not on the source clock, so they
        // are relative to this run's start. Half a millisecond early keeps rounding
        // from pushing a cut past its keyframe.
        val cuts = (index + 1 until starts.size)
            .joinToString(",") { String.format(Locale.US, "%.6f", starts[it] - start - 0.0005) }
        args += listOf("-f", "segment", "-segment_format", "mpegts")
        if (cuts.isNotEmpty()) args += listOf("-segment_times", cuts)
        args += listOf(
            "-segment_start_number", index.toString(),
            "-segment_format_options", "mpegts_copyts=1",
            "-muxdelay", "0", "-muxpreload", "0",
            "-avoid_negative_ts", "disabled",
            "-y", File(outDir, "seg%d.ts").absolutePath
        )
        return args
    }

    fun close() {
        synchronized(lock) {
            closed = true
            run?.let { stopRunLocked(it) }
            run = null
            try { dir.deleteRecursively() } catch (_: Exception) {}
        }
    }
}
