package com.vega

import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.decoder.DecoderException
import androidx.media3.decoder.DecoderInputBuffer
import androidx.media3.decoder.SimpleDecoder
import androidx.media3.decoder.VideoDecoderOutputBuffer
import androidx.media3.exoplayer.mediacodec.MediaCodecUtil
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.Locale

class FfmpegVideoDecoderException(message: String, cause: Throwable? = null) : DecoderException(message, cause)

@Suppress("UNCHECKED_CAST")
@OptIn(UnstableApi::class)
@UnstableApi
class FfmpegVideoDecoder(
    nativeLibDir: String,
    format: Format,
    threads: Int = Runtime.getRuntime().availableProcessors().coerceIn(2, 6),
) : SimpleDecoder<DecoderInputBuffer, VideoDecoderOutputBuffer, FfmpegVideoDecoderException>(
    arrayOfNulls<DecoderInputBuffer>(4) as Array<DecoderInputBuffer>,
    arrayOfNulls<VideoDecoderOutputBuffer>(4) as Array<VideoDecoderOutputBuffer>,
) {
    @Volatile
    var outputMode: Int = C.VIDEO_OUTPUT_MODE_SURFACE_YUV

    private var nativeHandle: Long = 0L
    private val decodeResult = LongArray(5)

    init {
        ensureNativeLoaded()
        val extraData = mergeInitializationData(format.initializationData)
        val mime = resolveEffectiveMime(format)
            ?: throw FfmpegVideoDecoderException(
                "Unsupported video MIME type: ${format.sampleMimeType} (${format.codecs})",
            )
        nativeHandle = nativeCreateDecoder(
            nativeLibDir,
            mime,
            extraData,
            format.width,
            format.height,
            threads,
        )
        if (nativeHandle == 0L) {
            throw FfmpegVideoDecoderException("Unable to initialize FFmpeg decoder for $mime")
        }
        setInitialInputBufferSize(512 * 1024)
    }

    override fun getName(): String = "FfmpegVideoDecoder"

    override fun createInputBuffer(): DecoderInputBuffer =
        DecoderInputBuffer(DecoderInputBuffer.BUFFER_REPLACEMENT_MODE_DIRECT)

    override fun createOutputBuffer(): VideoDecoderOutputBuffer =
        VideoDecoderOutputBuffer { buffer -> releaseOutputBuffer(buffer) }

    override fun releaseOutputBuffer(outputBuffer: VideoDecoderOutputBuffer) {
        val frameHandle = outputBuffer.decoderPrivate
        if (frameHandle != 0L) {
            outputBuffer.decoderPrivate = 0L
            nativeReleaseFrame(frameHandle)
        }
        super.releaseOutputBuffer(outputBuffer)
    }

    override fun createUnexpectedDecodeException(error: Throwable): FfmpegVideoDecoderException =
        FfmpegVideoDecoderException("Unexpected FFmpeg decode error", error)

    override fun decode(
        inputBuffer: DecoderInputBuffer,
        outputBuffer: VideoDecoderOutputBuffer,
        reset: Boolean,
    ): FfmpegVideoDecoderException? {
        if (reset && nativeHandle != 0L) {
            nativeFlushDecoder(nativeHandle)
        }
        val data = inputBuffer.data ?: run {
            outputBuffer.shouldBeSkipped = true
            return null
        }
        val size = data.remaining()
        if (size <= 0) {
            outputBuffer.shouldBeSkipped = true
            return null
        }
        nativeDecode(nativeHandle, data, data.position(), size, inputBuffer.timeUs, decodeResult)
        val status = decodeResult[0]
        if (status < 0L) {
            return FfmpegVideoDecoderException("FFmpeg video decode failed")
        }
        if (status == 0L) {
            outputBuffer.shouldBeSkipped = true
            return null
        }
        val frameHandle = decodeResult[1]
        val width = decodeResult[2].toInt()
        val height = decodeResult[3].toInt()
        val ptsUs = decodeResult[4]
        if (!isAtLeastOutputStartTimeUs(ptsUs)) {
            if (frameHandle != 0L) {
                nativeReleaseFrame(frameHandle)
            }
            outputBuffer.shouldBeSkipped = true
            return null
        }
        outputBuffer.init(ptsUs, outputMode, null)
        outputBuffer.width = width
        outputBuffer.height = height
        outputBuffer.decoderPrivate = frameHandle
        return null
    }

    override fun release() {
        super.release()
        val handle = nativeHandle
        if (handle != 0L) {
            nativeHandle = 0L
            nativeDestroyDecoder(handle)
        }
    }

    companion object {
        @Volatile
        private var nativeLoaded = false

        @Synchronized
        fun ensureNativeLoaded() {
            if (!nativeLoaded) {
                System.loadLibrary("vegaffmpegvideo")
                nativeLoaded = true
            }
        }

        fun resolveEffectiveMime(format: Format): String? {
            val mime = format.sampleMimeType ?: return null
            if (mime == MimeTypes.VIDEO_DOLBY_VISION || mime == "video/mv-hevc") {
                val altMime = MediaCodecUtil.getAlternativeCodecMimeType(format)
                if (altMime != null) {
                    return altMime
                }
                if (mime == MimeTypes.VIDEO_DOLBY_VISION) {
                    val codecs = format.codecs?.lowercase(Locale.ROOT)
                    if (codecs != null && (codecs.startsWith("dvhe.07") || codecs.startsWith("dvh1.07"))) {
                        return MimeTypes.VIDEO_H265
                    }
                }
                return null
            }
            return mime
        }

        fun isFormatSupported(nativeLibDir: String, format: Format): Boolean {
            if (format.drmInitData != null) return false
            val mime = resolveEffectiveMime(format) ?: return false
            return isCodecAvailable(nativeLibDir, mime)
        }

        fun isCodecAvailable(nativeLibDir: String, mimeType: String): Boolean {
            ensureNativeLoaded()
            return nativeIsCodecAvailable(nativeLibDir, mimeType)
        }

        private fun mergeInitializationData(initData: List<ByteArray>): ByteArray? {
            if (initData.isEmpty()) return null
            val out = ByteArrayOutputStream()
            for (chunk in initData) {
                if (chunk.isNotEmpty()) out.write(chunk)
            }
            val bytes = out.toByteArray()
            return if (bytes.isEmpty()) null else bytes
        }

        @JvmStatic
        external fun nativeIsCodecAvailable(nativeLibDir: String, mimeType: String): Boolean

        @JvmStatic
        external fun nativeCreateDecoder(
            nativeLibDir: String,
            mimeType: String,
            extraData: ByteArray?,
            width: Int,
            height: Int,
            threads: Int,
        ): Long

        @JvmStatic
        external fun nativeFlushDecoder(handle: Long)

        @JvmStatic
        external fun nativeDecode(
            handle: Long,
            inputBuf: ByteBuffer,
            offset: Int,
            size: Int,
            timeUs: Long,
            outMeta: LongArray,
        )

        @JvmStatic
        external fun nativeReleaseFrame(frameHandle: Long)

        @JvmStatic
        external fun nativeDestroyDecoder(handle: Long)

        @JvmStatic
        external fun nativeCreateRenderer(): Long

        @JvmStatic
        external fun nativeRenderFrame(renderHandle: Long, frameHandle: Long, surface: android.view.Surface): Boolean

        @JvmStatic
        external fun nativeDetachSurface(renderHandle: Long)

        @JvmStatic
        external fun nativeDestroyRenderer(renderHandle: Long)
    }
}
