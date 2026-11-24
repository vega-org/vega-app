package com.vega

import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.nio.ByteBuffer
import kotlin.math.min

internal object HlsSegmentSanitizer {
    /** Some HLS CDNs prepend a complete PNG to MPEG-TS data. Strip only a
     * verified PNG wrapper with a TS payload; ordinary images/media stay intact.
     * Run before remuxing so retries also repair already cached segments.
     */
    fun unwrapPlaylist(playlist: File) {
        val directory = playlist.canonicalFile.parentFile ?: return
        playlist.forEachLine { line ->
            val name = line.trim()
            if (name.isNotEmpty() && !name.startsWith("#")) {
                val segment = File(directory, name).canonicalFile
                require(segment.parentFile == directory) { "Invalid local HLS segment path" }
                if (segment.isFile) unwrapSegment(segment)
            }
        }
    }

    fun unwrapSegment(segment: File) {
        FileInputStream(segment).use { input ->
            val prefix = ByteArray(min(segment.length(), 65536L).toInt())
            var size = 0
            while (size < prefix.size) {
                val count = input.read(prefix, size, prefix.size - size)
                if (count < 0) break
                size += count
            }
            val signature = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
            if (size < 8 || !prefix.copyOfRange(0, 8).contentEquals(signature)) return
            var offset = 8
            while (offset + 12 <= size) {
                val length = ByteBuffer.wrap(prefix, offset, 4).int
                if (length < 0 || length > size - offset - 12) return
                val isEnd = prefix[offset + 4] == 0x49.toByte() &&
                    prefix[offset + 5] == 0x45.toByte() &&
                    prefix[offset + 6] == 0x4e.toByte() && prefix[offset + 7] == 0x44.toByte()
                offset += length + 12
                if (isEnd) {
                    // Confirm multiple TS packets rather than trusting the MIME type.
                    val hasTransportStream = (offset until size - 188 * 4).any { start ->
                        (0..4).all { packet -> prefix[start + packet * 188] == 0x47.toByte() }
                    }
                    if (!hasTransportStream) return
                    val repaired = File("${segment.path}.unwrap")
                    try {
                        FileInputStream(segment).channel.use { source ->
                            FileOutputStream(repaired).channel.use { target ->
                                source.position(offset.toLong())
                                val buffer = ByteBuffer.allocate(64 * 1024)
                                while (source.read(buffer) != -1) {
                                    buffer.flip()
                                    while (buffer.hasRemaining()) target.write(buffer)
                                    buffer.clear()
                                }
                            }
                        }
                        if (!repaired.renameTo(segment)) throw IOException("Unable to unwrap HLS segment")
                    } finally { repaired.delete() }
                    return
                }
            }
        }
    }
}
