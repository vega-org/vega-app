package com.vega

import android.os.Handler
import android.view.Surface
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.decoder.CryptoConfig
import androidx.media3.decoder.VideoDecoderOutputBuffer
import androidx.media3.exoplayer.RendererCapabilities
import androidx.media3.exoplayer.video.DecoderVideoRenderer
import androidx.media3.exoplayer.video.VideoRendererEventListener

@OptIn(UnstableApi::class)
@UnstableApi
class FfmpegVideoRenderer(
    private val nativeLibDir: String,
    allowedVideoJoiningTimeMs: Long,
    eventHandler: Handler?,
    eventListener: VideoRendererEventListener?,
    maxDroppedFramesToNotify: Int,
) : DecoderVideoRenderer(allowedVideoJoiningTimeMs, eventHandler, eventListener, maxDroppedFramesToNotify) {

    private var nativeRendererHandle: Long = 0L
    private var activeDecoder: FfmpegVideoDecoder? = null
    private var outputMode: Int = C.VIDEO_OUTPUT_MODE_SURFACE_YUV

    override fun getName(): String = "FfmpegVideoRenderer"

    override fun supportsFormat(format: Format): Int {
        val mime = format.sampleMimeType ?: return RendererCapabilities.create(C.FORMAT_UNSUPPORTED_TYPE)
        if (!MimeTypes.isVideo(mime)) return RendererCapabilities.create(C.FORMAT_UNSUPPORTED_TYPE)
        if (format.drmInitData != null) return RendererCapabilities.create(C.FORMAT_UNSUPPORTED_DRM)
        if (!FfmpegVideoDecoder.isCodecAvailable(nativeLibDir, mime)) {
            return RendererCapabilities.create(C.FORMAT_UNSUPPORTED_SUBTYPE)
        }
        return RendererCapabilities.create(
            C.FORMAT_HANDLED,
            RendererCapabilities.ADAPTIVE_SEAMLESS,
            RendererCapabilities.TUNNELING_NOT_SUPPORTED,
        )
    }

    override fun createDecoder(format: Format, cryptoConfig: CryptoConfig?): FfmpegVideoDecoder {
        return FfmpegVideoDecoder(nativeLibDir, format).also {
            it.outputMode = outputMode
            activeDecoder = it
        }
    }

    override fun setDecoderOutputMode(outputMode: Int) {
        this.outputMode = outputMode
        activeDecoder?.outputMode = outputMode
    }

    override fun renderOutputBufferToSurface(
        outputBuffer: VideoDecoderOutputBuffer,
        surface: Surface,
    ) {
        try {
            FfmpegVideoDecoder.ensureNativeLoaded()
            if (nativeRendererHandle == 0L) {
                nativeRendererHandle = FfmpegVideoDecoder.nativeCreateRenderer()
            }
            if (nativeRendererHandle == 0L ||
                !FfmpegVideoDecoder.nativeRenderFrame(
                    nativeRendererHandle,
                    outputBuffer.decoderPrivate,
                    surface,
                )
            ) {
                throw FfmpegVideoDecoderException("Failed to render FFmpeg frame to surface")
            }
        } finally {
            outputBuffer.release()
        }
    }

    override fun onDisabled() {
        activeDecoder = null
        val handle = nativeRendererHandle
        if (handle != 0L) {
            nativeRendererHandle = 0L
            FfmpegVideoDecoder.nativeDestroyRenderer(handle)
        }
        super.onDisabled()
    }
}
