package com.vega

import android.content.Context
import android.net.Uri
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.util.concurrent.TimeUnit

/** Reads only Matroska metadata and the blocks it points at. The film itself is never downloaded here. */
internal object MkvCueIndex {
    private const val CUES = 0x1C53BB6B
    private const val SEGMENT = 0x18538067
    private const val CLUSTER = 0x1F43B675
    private const val SEEK_HEAD = 0x114D9B74
    private const val INFO = 0x1549A966
    private const val TRACKS = 0x1654AE6B
    private const val MAX_CUES = 4 * 1024 * 1024
    private const val HEADER_BYTES = 128 * 1024
    // A text subtitle block is a few hundred bytes; this window covers it plus the
    // unknown cluster-header length (4-byte id + 1..8-byte size) in front of it.
    private const val BLOCK_WINDOW = 2 * 1024
    private const val MERGE_GAP = 32 * 1024
    private val metadata = RemoteMetadataCache<Parsed?>(maxEntries = 2, ttlMs = 5 * 60_000L)
    private val readGeneration = java.util.concurrent.atomic.AtomicInteger()
    fun clearCache() {
        readGeneration.incrementAndGet()
        metadata.clear()
    }

    private data class Element(val id: Int, val start: Int, val body: Int, val end: Int, val size: Long)
    private data class RangeData(val bytes: ByteArray, val total: Long)

    /**
     * [boundariesUs] are segment edges (first 0, last the duration). [sourceOffsets]
     * holds the source byte position of each edge when every Cue has a cluster
     * position; it bounds how many bytes each segment can occupy after remuxing.
     */
    class Index(val boundariesUs: LongArray, val sourceOffsets: LongArray?)

    class SubtitleLine(val startUs: Long, val endUs: Long?, val text: String)

    private class Track(val number: Long, val type: Long, val codec: String)

    /** One CueTrackPositions entry: where a track's block at [ticks] is stored. */
    private class CueEntry(
        val ticks: Long,
        val track: Long,
        val clusterPosition: Long,
        val relativePosition: Long,
        val durationTicks: Long
    )

    private class Parsed(
        val segmentBody: Long,
        val scaleNs: Long,
        val total: Long,
        val tracks: List<Track>,
        val cues: List<CueEntry>
    )

    private val client: OkHttpClient by lazy {
        (DohOkHttpFactory.instance?.createNewNetworkModuleClient() ?: OkHttpClient())
            .newBuilder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(12, TimeUnit.SECONDS)
        .build()
    }

    /** Random-access reads over a local file, a content:// URI, or HTTP ranges. */
    private class Source(
        context: Context,
        private val source: String,
        local: Boolean,
        private val headers: Map<String, String>
    ) : AutoCloseable {
        private val generation = readGeneration.get()
        @Volatile private var canceled = false
        private val calls = java.util.concurrent.ConcurrentHashMap.newKeySet<okhttp3.Call>()

        private fun checkActive() {
            if (canceled || generation != readGeneration.get() || Thread.currentThread().isInterrupted) {
                throw java.io.InterruptedIOException("Cast metadata read canceled")
            }
        }

        fun cancel() {
            canceled = true
            calls.forEach { it.cancel() }
        }
        val cacheKey = if (!local && (source.startsWith("http://") || source.startsWith("https://")))
            source + "\n" + headers.entries.sortedBy { it.key.lowercase() }.joinToString("\n") { "${it.key.lowercase()}:${it.value}" }
            else null
        private val file = if (!source.startsWith("content://") && (local || source.startsWith("/") || source.startsWith("file://")))
            File(source.removePrefix("file://")) else null
        private val descriptor = if (source.startsWith("content://"))
            context.contentResolver.openFileDescriptor(Uri.parse(source), "r") else null

        fun range(start: Long, count: Int): RangeData? {
            checkActive()
            if (start < 0 || count < 1 || count > MAX_CUES + 16) return null
            val localSize = file?.length() ?: descriptor?.statSize ?: -1L
            if (localSize >= 0) {
                if (start >= localSize) return null
                val size = minOf(count.toLong(), localSize - start).toInt()
                val bytes = ByteArray(size)
                if (file == null) {
                    // pread leaves the shared descriptor position unchanged for parallel subtitle reads.
                    var read = 0
                    while (read < size) {
                        checkActive()
                        val countRead = android.system.Os.pread(
                            descriptor!!.fileDescriptor, bytes, read, size - read, start + read
                        )
                        if (countRead <= 0) return null
                        read += countRead
                    }
                    return RangeData(bytes, localSize)
                }
                val input = FileInputStream(file)
                input.use {
                    val channel = it.channel
                    channel.position(start)
                    val buffer = ByteBuffer.wrap(bytes)
                    while (buffer.hasRemaining()) {
                        checkActive()
                        if (channel.read(buffer) <= 0) return null
                    }
                }
                return RangeData(bytes, localSize)
            }
            RemoteSourceFailures.check(source)
            val request = Request.Builder().url(source).apply {
                headers.forEach { (k, v) -> header(k, v) }
                header("Range", "bytes=$start-${start + count - 1}")
            }.build()
            RemoteSourceFailures.noteMetadataRead()
            val call = client.newCall(request)
            calls.add(call)
            try {
                checkActive()
                call.execute().use { response ->
                    RemoteSourceFailures.record(source, response.code, response.header("Retry-After"))
                    RemoteSourceFailures.check(source)
                    // Only a real partial response is accepted: a 200 would be the whole film.
                    if (response.code != 206) return null
                    val contentRange = response.header("Content-Range") ?: return null
                    val match = Regex("bytes (\\d+)-(\\d+)/(\\d+)", RegexOption.IGNORE_CASE).matchEntire(contentRange) ?: return null
                    if (match.groupValues[1].toLong() != start) return null
                    val total = match.groupValues[3].toLong()
                    val declared = match.groupValues[2].toLong() - start + 1
                    if (declared > count) return null
                    val bytes = ByteArray(declared.toInt())
                    val stream = response.body?.byteStream() ?: return null
                    var read = 0
                    while (read < bytes.size) {
                        checkActive()
                        val countRead = stream.read(bytes, read, bytes.size - read)
                        if (countRead <= 0) break
                        read += countRead
                    }
                    if (read != bytes.size) return null
                    return RangeData(bytes, total)
                }
            } finally { calls.remove(call) }
        }

        override fun close() {
            cancel()
            descriptor?.close()
        }
    }

    /** Video segment edges from the Cue index, or null when it is missing or unusable. */
    fun read(
        context: Context,
        source: String,
        local: Boolean,
        headers: Map<String, String>,
        durationUs: Long
    ): Index? = Source(context, source, local, headers).use { src ->
        val parsed = parse(src) ?: return null
        val videoTrack = parsed.tracks.firstOrNull { it.type == 1L }?.number ?: return null
        // Cue time -> absolute source byte offset of its cluster (-1 when absent).
        val cuePoints = sortedMapOf<Long, Long>()
        for (cue in parsed.cues) {
            if (cue.track != videoTrack || cue.ticks > Long.MAX_VALUE / parsed.scaleNs) continue
            val timeUs = cue.ticks * parsed.scaleNs / 1_000
            if (timeUs !in 0 until durationUs) continue
            val position = if (cue.clusterPosition >= 0) parsed.segmentBody + cue.clusterPosition else -1L
            val previous = cuePoints[timeUs]
            cuePoints[timeUs] = if (previous == null || previous < 0) position
                else if (position < 0) previous else minOf(previous, position)
        }
        if (0L !in cuePoints) cuePoints[0L] = parsed.segmentBody
        val ordered = cuePoints.keys.toList() + durationUs
        if (ordered.size < 3 || !ordered.zipWithNext().all { (a, b) -> b - a in 1..30_000_000L }) return null
        val offsets = (cuePoints.values.toList() + parsed.total).toLongArray()
        val offsetsUsable = parsed.total > 0 &&
            offsets.all { it >= 0 } &&
            offsets.toList().zipWithNext().all { (a, b) -> b > a }
        Index(ordered.toLongArray(), if (offsetsUsable) offsets else null)
    }

    /**
     * Every indexed video keyframe time, sorted. FFmpeg's Matroska seek lands on
     * one of these, so snapping to them tells us where a remux really starts.
     */
    fun videoKeyframesUs(
        context: Context,
        source: String,
        local: Boolean,
        headers: Map<String, String>
    ): LongArray? = Source(context, source, local, headers).use { src ->
        val parsed = parse(src) ?: return null
        val videoTrack = parsed.tracks.firstOrNull { it.type == 1L }?.number ?: return null
        parsed.cues
            .filter { it.track == videoTrack && it.ticks >= 0 && it.ticks <= Long.MAX_VALUE / parsed.scaleNs }
            .map { it.ticks * parsed.scaleNs / 1_000 }
            .distinct()
            .sorted()
            .toLongArray()
            .takeIf { it.isNotEmpty() }
    }

    /** Number of subtitle tracks (any codec), or 0 when the header cannot be read. */
    fun subtitleTrackCount(
        context: Context,
        source: String,
        local: Boolean,
        headers: Map<String, String>
    ): Int = Source(context, source, local, headers).use { src ->
        parse(src)?.tracks?.count { it.type == 17L } ?: 0
    }

    /**
     * Text subtitles for the [ordinal]-th subtitle track, fetched block by block
     * through the Cue index (muxers such as mkvmerge index every subtitle block).
     * Returns null when the track has no such index; the caller must then not
     * fall back to reading the whole remote file.
     */
    fun readSubtitleLines(
        context: Context,
        source: String,
        local: Boolean,
        headers: Map<String, String>,
        ordinal: Int
    ): List<SubtitleLine>? = Source(context, source, local, headers).use { src ->
        val parsed = parse(src) ?: return null
        val track = parsed.tracks.filter { it.type == 17L }.getOrNull(ordinal) ?: return null
        require(track.codec.startsWith("S_TEXT", ignoreCase = true)) {
            "Subtitle track ${ordinal + 1} is ${track.codec}; only text subtitles can be sent to the TV"
        }
        val entries = parsed.cues
            .filter { it.track == track.number && it.clusterPosition >= 0 && it.relativePosition >= 0 }
            .distinctBy { it.ticks }
            .sortedBy { it.clusterPosition + it.relativePosition }
        if (entries.isEmpty()) return null

        // Earliest byte where each block can start: cluster + minimal 5-byte header + relative position.
        fun earliest(entry: CueEntry) = parsed.segmentBody + entry.clusterPosition + entry.relativePosition + 5
        val groups = ArrayList<List<CueEntry>>()
        var current = ArrayList<CueEntry>()
        for (entry in entries) {
            if (current.isNotEmpty() && earliest(entry) - earliest(current.first()) > MERGE_GAP) {
                groups.add(current)
                current = ArrayList()
            }
            current.add(entry)
        }
        if (current.isNotEmpty()) groups.add(current)

        VegaLog.i("MkvCueIndex", "Subtitle extraction: ${entries.size} cues, ${groups.size} indexed reads, concurrency=${SubtitleReadBatch.MAX_PARALLELISM}")
        val results = SubtitleReadBatch.read(groups, onFailure = { src.cancel() }) { group ->
            val start = earliest(group.first())
            val length = (earliest(group.last()) - start + BLOCK_WINDOW).toInt()
            val window = src.range(start, length)
                ?: throw IllegalStateException("Subtitle block could not be read")
            group.mapNotNull { entry ->
                val text = blockText(window.bytes, (earliest(entry) - start).toInt(), track)
                    ?: return@mapNotNull null
                val startUs = entry.ticks * parsed.scaleNs / 1_000
                val durationTicks = text.second.takeIf { it > 0 } ?: entry.durationTicks
                val endUs = if (durationTicks > 0) startUs + durationTicks * parsed.scaleNs / 1_000 else null
                SubtitleLine(startUs, endUs, text.first)
            }
        }
        return results.flatten().sortedBy { it.startUs }
    }

    /**
     * Finds the SimpleBlock (0xA3) or BlockGroup (0xA0) for [track] within the first
     * 8 bytes after [offset] (the unknown cluster-header length) and returns its
     * payload text and BlockDuration in ticks (0 when absent).
     */
    private fun blockText(window: ByteArray, offset: Int, track: Track): Pair<String, Long>? {
        for (shift in 0..7) {
            val at = offset + shift
            val e = element(window, at) ?: continue
            // element() clips to the window; a block cut off by the window is not a match.
            if (e.size > window.size - e.body) continue
            when (e.id) {
                0xA3 -> blockPayload(window, e.body, e.end, track.number)?.let { return decode(it, track) to 0L }
                0xA0 -> {
                    var payload: ByteArray? = null
                    var duration = 0L
                    for (child in children(window, e)) {
                        if (child.id == 0xA1) payload = blockPayload(window, child.body, child.end, track.number)
                        if (child.id == 0x9B) duration = unsigned(window, child)
                    }
                    payload?.let { return decode(it, track) to duration }
                }
            }
        }
        return null
    }

    /** Block body: track-number vint, 16-bit relative timecode, flags, then data (no lacing). */
    private fun blockPayload(bytes: ByteArray, body: Int, end: Int, trackNumber: Long): ByteArray? {
        val length = leadingLength(bytes[body]) ?: return null
        var number = (bytes[body].toInt() and (255 ushr length)).toLong()
        for (i in 1 until length) number = (number shl 8) or (bytes[body + i].toInt() and 255).toLong()
        if (number != trackNumber) return null
        val dataStart = body + length + 3
        if (dataStart > end) return null
        if (bytes[body + length + 2].toInt() and 0x06 != 0) return null // laced: not used for text
        return bytes.copyOfRange(dataStart, end)
    }

    /** SSA/ASS blocks store "ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text". */
    private fun decode(payload: ByteArray, track: Track): String {
        val text = String(payload, Charsets.UTF_8)
        val isSsa = track.codec.equals("S_TEXT/ASS", true) || track.codec.equals("S_TEXT/SSA", true)
        return if (isSsa) text.split(',', limit = 9).getOrNull(8) ?: text else text
    }

    private fun parse(src: Source): Parsed? {
        val key = src.cacheKey ?: return parseUncached(src)
        return metadata.get(key) { parseUncached(src) }
    }

    private fun parseUncached(src: Source): Parsed? {
        val head = src.range(0, HEADER_BYTES) ?: return null
        var segmentBody = -1L
        var seekOffset: Long? = null
        var cueOffset: Long? = null
        var scaleNs = 1_000_000L
        val tracks = ArrayList<Track>()
        var cursor = 0
        while (cursor < head.bytes.size) {
            val e = element(head.bytes, cursor) ?: break
            if (e.id == SEGMENT) { segmentBody = e.body.toLong(); cursor = e.body; break }
            cursor = e.end
        }
        if (segmentBody < 0) return null
        while (cursor < head.bytes.size) {
            val e = element(head.bytes, cursor) ?: break
            if (e.id == CLUSTER) break
            when (e.id) {
                SEEK_HEAD -> children(head.bytes, e).forEach { seek ->
                    if (seek.id == 0x4DBB) {
                        var id = 0L
                        var pos = -1L
                        children(head.bytes, seek).forEach { child ->
                            if (child.id == 0x53AB) id = unsigned(head.bytes, child)
                            if (child.id == 0x53AC) pos = unsigned(head.bytes, child)
                        }
                        if (id == CUES.toLong() && pos >= 0) seekOffset = segmentBody + pos
                    }
                }
                INFO -> children(head.bytes, e).forEach { if (it.id == 0x2AD7B1) scaleNs = unsigned(head.bytes, it) }
                TRACKS -> children(head.bytes, e).forEach { entry ->
                    if (entry.id == 0xAE) {
                        var number = -1L
                        var type = -1L
                        var codec = ""
                        children(head.bytes, entry).forEach {
                            if (it.id == 0xD7) number = unsigned(head.bytes, it)
                            if (it.id == 0x83) type = unsigned(head.bytes, it)
                            if (it.id == 0x86) codec = String(head.bytes, it.body, it.end - it.body, Charsets.US_ASCII).trim('\u0000')
                        }
                        if (number >= 0) tracks.add(Track(number, type, codec))
                    }
                }
                CUES -> cueOffset = e.start.toLong()
            }
            cursor = e.end
        }
        if (scaleNs < 1 || tracks.isEmpty()) return null
        val positions = mutableListOf<Long>()
        cueOffset?.let { positions.add(it) }
        seekOffset?.let { if (it !in positions) positions.add(it) }
        // SeekHead may be absent. A bounded tail lookup is safe because every
        // CuePoint is validated by the caller before it is used.
        if (positions.isEmpty()) {
            val start = (head.total - MAX_CUES).coerceAtLeast(0)
            val tail = src.range(start, minOf(MAX_CUES.toLong(), head.total - start).toInt()) ?: return null
            val marker = byteArrayOf(0x1C, 0x53, 0xBB.toByte(), 0x6B)
            for (i in 0..tail.bytes.size - marker.size) {
                if (marker.indices.all { tail.bytes[i + it] == marker[it] }) positions.add(start + i)
            }
        }
        for (position in positions) {
            val header = src.range(position, 16)?.bytes ?: continue
            val cue = element(header, 0) ?: continue
            if (cue.id != CUES) continue
            val size = cue.body.toLong() + cue.size
            if (size > MAX_CUES || size < 8) continue
            val data = src.range(position, size.toInt())?.bytes ?: continue
            val root = element(data, 0) ?: continue
            val cues = ArrayList<CueEntry>()
            for (point in children(data, root)) {
                if (point.id != 0xBB) continue
                var ticks = -1L
                val trackPositions = ArrayList<Element>()
                for (part in children(data, point)) {
                    if (part.id == 0xB3) ticks = unsigned(data, part)
                    if (part.id == 0xB7) trackPositions.add(part)
                }
                if (ticks < 0) continue
                for (part in trackPositions) {
                    var track = -1L
                    var cluster = -1L
                    var relative = -1L
                    var duration = 0L
                    for (field in children(data, part)) {
                        when (field.id) {
                            0xF7 -> track = unsigned(data, field)
                            0xF1 -> cluster = unsigned(data, field)
                            0xF0 -> relative = unsigned(data, field)
                            0xB2 -> duration = unsigned(data, field)
                        }
                    }
                    if (track >= 0) cues.add(CueEntry(ticks, track, cluster, relative, duration))
                }
            }
            if (cues.isNotEmpty()) return Parsed(segmentBody, scaleNs, head.total, tracks, cues)
        }
        return null
    }

    private fun element(bytes: ByteArray, start: Int): Element? {
        if (start !in bytes.indices) return null
        val idLength = leadingLength(bytes[start]) ?: return null
        if (idLength > 4 || start + idLength >= bytes.size) return null
        var id = 0
        repeat(idLength) { id = (id shl 8) or (bytes[start + it].toInt() and 255) }
        val sizeStart = start + idLength
        val sizeLength = leadingLength(bytes[sizeStart]) ?: return null
        if (sizeStart + sizeLength > bytes.size) return null
        var size = (bytes[sizeStart].toInt() and (255 ushr sizeLength)).toLong()
        for (i in 1 until sizeLength) size = (size shl 8) or (bytes[sizeStart + i].toInt() and 255).toLong()
        val body = sizeStart + sizeLength
        val end = if (size > bytes.size - body) bytes.size else body + size.toInt()
        if (end < body) return null
        return Element(id, start, body, end, size)
    }

    private fun children(bytes: ByteArray, parent: Element): List<Element> {
        val result = ArrayList<Element>()
        var cursor = parent.body
        while (cursor < parent.end) {
            val e = element(bytes, cursor) ?: break
            if (e.end > parent.end || e.end <= cursor || e.size > parent.end - e.body) break
            result.add(e)
            cursor = e.end
        }
        return result
    }

    private fun unsigned(bytes: ByteArray, e: Element): Long {
        if (e.end - e.body !in 1..8) return -1
        var value = 0L
        for (i in e.body until e.end) value = (value shl 8) or (bytes[i].toInt() and 255).toLong()
        return value
    }

    private fun leadingLength(byte: Byte): Int? {
        var mask = 0x80
        for (length in 1..8) {
            if (byte.toInt() and mask != 0) return length
            mask = mask ushr 1
        }
        return null
    }
}
