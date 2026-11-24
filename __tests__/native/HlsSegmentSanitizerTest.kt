package com.vega

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.io.File
import java.nio.file.Files

/** Standalone checks; accepts optional live PNG-wrapped TS files as arguments. */
fun main(args: Array<String>) {
    val directory = Files.createTempDirectory("vega-hls-sanitizer").toFile()
    val signature = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    fun chunk(type: String, data: ByteArray = byteArrayOf()): ByteArray {
        val bytes = ByteArrayOutputStream()
        DataOutputStream(bytes).use {
            it.writeInt(data.size)
            it.writeBytes(type)
            it.write(data)
            it.writeInt(0) // CRC is irrelevant to locating the wrapper boundary.
        }
        return bytes.toByteArray()
    }
    val png = signature + chunk("IHDR", ByteArray(13)) + chunk("IDAT", ByteArray(13)) + chunk("IEND")
    val transportStream = ByteArray(188 * 8) { index -> if (index % 188 == 0) 0x47 else 0x11 }
    val segment = File(directory, "video_0.ts")
    val playlist = File(directory, "video.m3u8")
    playlist.writeText("#EXTM3U\n#EXTINF:4.004,\nvideo_0.ts\n#EXT-X-ENDLIST\n")
    fun unchanged(bytes: ByteArray) {
        segment.writeBytes(bytes)
        HlsSegmentSanitizer.unwrapPlaylist(playlist)
        check(segment.readBytes().contentEquals(bytes)) { "Non-wrapped media was modified" }
    }
    try {
        unchanged(transportStream)
        unchanged(png)
        unchanged(png + byteArrayOf(1, 2, 3))
        unchanged(byteArrayOf())
        unchanged(signature + byteArrayOf(0, 0, 0))
        unchanged(signature + chunk("IHDR") + byteArrayOf(0x7f, -1, -1, -1, 73, 69, 78, 68, 0, 0, 0, 0))
        // A PNG with no IEND must never be stripped, even if TS-like data follows.
        unchanged(signature + chunk("IHDR", ByteArray(13)) + transportStream)
        // An occasional 0x47 byte after IEND is not enough to identify MPEG-TS.
        unchanged(png + ByteArray(1000) { if (it == 500) 0x47 else 0 })
        for (payload in listOf(transportStream, byteArrayOf(0, 1, 2) + transportStream)) {
            segment.writeBytes(png + payload)
            HlsSegmentSanitizer.unwrapPlaylist(playlist)
            check(segment.readBytes().contentEquals(payload)) { "Wrapped segment was not repaired" }
            HlsSegmentSanitizer.unwrapPlaylist(playlist)
            check(segment.readBytes().contentEquals(payload)) { "Retry changed repaired media" }
            check(!File("${segment.path}.unwrap").exists())
        }
        playlist.writeText("#EXTM3U\n../outside.ts\n")
        check(runCatching { HlsSegmentSanitizer.unwrapPlaylist(playlist) }.isFailure)
        for (path in args) {
            val source = File(path).readBytes()
            check(source.take(8).toByteArray().contentEquals(signature))
            segment.writeBytes(source)
            HlsSegmentSanitizer.unwrapSegment(segment)
            val repaired = segment.readBytes()
            check(repaired.size < source.size)
            check(source.takeLast(repaired.size).toByteArray().contentEquals(repaired))
            segment.copyTo(File("$path.sanitized.ts"), overwrite = true)
        }
        println("HLS sanitizer checks passed: PNG-wrapped TS, cached retry, unchanged media, malformed data, path traversal, and ${args.size} live segments")
    } finally { directory.deleteRecursively() }
}
