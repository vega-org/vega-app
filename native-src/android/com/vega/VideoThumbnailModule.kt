package com.vega

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.os.Build
import android.os.SystemClock
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.SeekParameters
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.effect.Presentation
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.uimanager.ViewManager
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest
import java.util.concurrent.CancellationException
import java.util.concurrent.CompletableFuture
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong

class VideoThumbnailModule(
    reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
    private val executor = Executors.newSingleThreadExecutor()
    private val previewExecutor = Executors.newSingleThreadExecutor()
    private val backgroundDecoder = DecoderSession()
    private val previewDecoder = DecoderSession()
    private val previewOwner = AtomicReference<String?>(null)
    @Volatile private var invalidated = false
    private var lastCacheTrimMs = 0L

    override fun getName(): String = "VideoThumbnailModule"

    @ReactMethod
    fun getThumbnail(
        source: String,
        timestampMs: Double,
        requestHeaders: ReadableMap?,
        options: ReadableMap?,
        promise: Promise,
    ) {
        if (source.isBlank()) {
            promise.reject("VIDEO_THUMBNAIL_INVALID_SOURCE", "A video source is required")
            return
        }
        if (!timestampMs.isFinite() || timestampMs < 0) {
            promise.reject(
                "VIDEO_THUMBNAIL_INVALID_TIMESTAMP",
                "timestampMs must be a finite number greater than or equal to zero",
            )
            return
        }

        val headers = requestHeaders.toStringMap()
        val quality = options.intOr("quality", 85).coerceIn(0, 100)
        val maxWidth = options.intOr("maxWidth", 0).coerceAtLeast(0)
        val maxHeight = options.intOr("maxHeight", 0).coerceAtLeast(0)
        val cropBlackBars = options.booleanOr("cropBlackBars", false)
        val useCache = options.booleanOr("cache", true)
        val requestedTimestampMs = timestampMs.roundToLong()

        if (invalidated) {
            promise.reject("VIDEO_THUMBNAIL_CLOSED", "The thumbnail module is closed")
            return
        }
        val owner = options.stringOrNull("previewSession")
        val worker = if (owner != null) previewExecutor else executor
        val decoder = if (owner != null) previewDecoder else backgroundDecoder
        if (owner != null) previewOwner.set(owner)
        val isCurrent = { !invalidated && (owner == null || previewOwner.get() == owner) }

        worker.execute {
            var frame: Bitmap? = null
            var outputBitmap: Bitmap? = null
            try {
                if (!isCurrent()) throw CancellationException("Preview is no longer needed")
                val outputDirectory = File(reactApplicationContext.cacheDir, "video-thumbnails")
                if (!outputDirectory.exists() && !outputDirectory.mkdirs()) {
                    throw IllegalStateException("Unable to create the video thumbnail cache")
                }

                val cacheKey = buildCacheKey(
                    source,
                    requestedTimestampMs,
                    headers,
                    quality,
                    maxWidth,
                    maxHeight,
                    cropBlackBars,
                )
                val outputFile = File(outputDirectory, "$cacheKey.jpg")
                if (useCache && outputFile.isFile && outputFile.length() > 0) {
                    val cachedBounds = android.graphics.BitmapFactory.Options().apply {
                        inJustDecodeBounds = true
                    }
                    android.graphics.BitmapFactory.decodeFile(outputFile.absolutePath, cachedBounds)
                    if (cachedBounds.outWidth > 0 && cachedBounds.outHeight > 0) {
                        outputFile.setLastModified(System.currentTimeMillis())
                        promise.resolve(
                            createResult(
                                outputFile,
                                cachedBounds.outWidth,
                                cachedBounds.outHeight,
                                requestedTimestampMs,
                                true,
                            ),
                        )
                        return@execute
                    }
                    outputFile.delete()
                }

                val extractedFrame = if (isRemoteSource(source)) {
                    decoder.releaseRetriever()
                    // A remote metadata retriever can return the opening frame for every seek.
                    // Fail this preview promptly instead of falling back to an incorrect frame.
                    decoder.extractRemoteFrame(source, requestedTimestampMs, headers, maxWidth, maxHeight, owner, isCurrent)
                } else {
                    decoder.extractWithMetadataRetriever(source, requestedTimestampMs, headers, maxWidth, maxHeight, owner != null)
                }
                frame = extractedFrame
                if (!isCurrent()) throw CancellationException("Preview is no longer needed")

                val scaledFrame = scaleBitmap(extractedFrame, maxWidth, maxHeight)
                val bitmapToWrite = if (cropBlackBars) trimLetterbox(scaledFrame) else scaledFrame
                if (scaledFrame !== extractedFrame && scaledFrame !== bitmapToWrite) scaledFrame.recycle()
                outputBitmap = bitmapToWrite
                val temporaryFile = File.createTempFile(cacheKey, ".tmp", outputDirectory)
                try {
                    FileOutputStream(temporaryFile).use { output ->
                        if (!bitmapToWrite.compress(Bitmap.CompressFormat.JPEG, quality, output)) {
                            throw IllegalStateException("Unable to encode the video thumbnail")
                        }
                    }
                    if (!isCurrent()) throw CancellationException("Preview is no longer needed")
                    if (!temporaryFile.renameTo(outputFile)) {
                        throw IllegalStateException("Unable to save the video thumbnail")
                    }
                } finally {
                    temporaryFile.delete()
                }
                trimCache(outputDirectory)

                promise.resolve(
                    createResult(
                        outputFile,
                        bitmapToWrite.width,
                        bitmapToWrite.height,
                        requestedTimestampMs,
                        false,
                    ),
                )
            } catch (error: Throwable) {
                decoder.releaseRetriever()
                promise.reject(
                    if (error is CancellationException) "VIDEO_THUMBNAIL_CANCELLED" else "VIDEO_THUMBNAIL_ERROR",
                    error.message ?: "Unable to generate the video thumbnail",
                    error,
                )
            } finally {
                if (outputBitmap !== frame) {
                    outputBitmap?.recycle()
                }
                frame?.recycle()
            }
        }
    }

    @ReactMethod
    fun clearCache(promise: Promise) {
        executor.execute {
            try {
                val directory = File(reactApplicationContext.cacheDir, "video-thumbnails")
                val deleted = !directory.exists() || directory.deleteRecursively()
                if (!deleted) {
                    throw IllegalStateException("Unable to clear the video thumbnail cache")
                }
                promise.resolve(null)
            } catch (error: Throwable) {
                promise.reject(
                    "VIDEO_THUMBNAIL_CACHE_ERROR",
                    error.message ?: "Unable to clear the video thumbnail cache",
                    error,
                )
            }
        }
    }

    @ReactMethod
    fun cancelPreview(owner: String) {
        if (previewOwner.compareAndSet(owner, null)) previewDecoder.cancel(owner)
    }

    override fun invalidate() {
        invalidated = true
        previewOwner.set(null)
        previewDecoder.close()
        backgroundDecoder.close()
        executor.execute { backgroundDecoder.releaseRetriever() }
        previewExecutor.execute { previewDecoder.releaseRetriever() }
        executor.shutdown()
        previewExecutor.shutdown()
        super.invalidate()
    }

    /** Each worker owns its retriever and one reusable Media3 application thread. */
    private inner class DecoderSession {
        private var activeRetriever: MediaMetadataRetriever? = null
        private var activeSourceKey: String? = null
        private var thread: HandlerThread? = null
        private var handler: Handler? = null
        // The following fields are accessed only on the Media3 application thread.
        private var extractor: ThumbnailFrameExtractor? = null
        private var remoteKey: String? = null
        private var remoteOwner: String? = null
        private var activeResult: CompletableFuture<Bitmap>? = null
        private val idleRelease = Runnable { releaseRemote() }

        @Synchronized
        private fun frameHandler(): Handler {
            check(!invalidated) { "Thumbnail module is closed" }
            return handler ?: HandlerThread("vega-thumbnail-extractor").let {
                it.start()
                thread = it
                Handler(it.looper).also { created -> handler = created }
            }
        }

        private fun getRetriever(
            source: String,
            headers: Map<String, String>,
        ): MediaMetadataRetriever {
            val sourceKey = buildString {
                append(source)
                headers.toSortedMap(String.CASE_INSENSITIVE_ORDER).forEach { (name, value) ->
                    append('|').append(name.lowercase()).append(':').append(value)
                }
            }
            activeRetriever?.let { retriever ->
                if (activeSourceKey == sourceKey) return retriever
            }

            releaseRetriever()
            handler?.post {
                if (activeResult == null) releaseRemote()
            }
            val retriever = MediaMetadataRetriever()
            try {
                setDataSource(retriever, source, headers)
            } catch (error: Throwable) {
                try {
                    retriever.release()
                } catch (_: Throwable) {
                    // Preserve the original data-source error.
                }
                throw error
            }
            activeRetriever = retriever
            activeSourceKey = sourceKey
            return retriever
        }

        fun extractWithMetadataRetriever(
            source: String,
            timestampMs: Long,
            headers: Map<String, String>,
            maxWidth: Int,
            maxHeight: Int,
            preview: Boolean,
        ): Bitmap {
            val retriever = getRetriever(source, headers)
            val timestampUs = timestampMs * 1_000L
            if (preview && Build.VERSION.SDK_INT >= 27 && maxWidth > 0 && maxHeight > 0) {
                retriever.getScaledFrameAtTime(
                    timestampUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, maxWidth, maxHeight,
                )?.let { return it }
            }
            return retriever.getFrameAtTime(
                timestampUs,
                if (preview) MediaMetadataRetriever.OPTION_CLOSEST_SYNC else MediaMetadataRetriever.OPTION_CLOSEST,
            ) ?: retriever.getFrameAtTime(
                timestampUs,
                MediaMetadataRetriever.OPTION_CLOSEST_SYNC,
            ) ?: throw IllegalStateException(
                "The video decoder did not return a frame at ${timestampMs}ms",
            )
        }


        @UnstableApi
        fun extractRemoteFrame(
            source: String,
            timestampMs: Long,
            headers: Map<String, String>,
            maxWidth: Int,
            maxHeight: Int,
            owner: String?,
            isCurrent: () -> Boolean,
        ): Bitmap {
            val handler = frameHandler()
            val result = CompletableFuture<Bitmap>()
            handler.post {
                if (result.isDone) return@post
                if (!isCurrent()) {
                    result.completeExceptionally(CancellationException("Preview is no longer needed"))
                    return@post
                }
                handler.removeCallbacks(idleRelease)
                try {
                    val key = buildCacheKey(source, 0, headers, 0, maxWidth, maxHeight, false)
                    if (remoteKey != key) {
                        releaseRemote()
                        val http = DefaultHttpDataSource.Factory()
                            .setDefaultRequestProperties(headers)
                            .setAllowCrossProtocolRedirects(true)
                            .setConnectTimeoutMs(4_000)
                            .setReadTimeoutMs(4_000)
                        val mediaSource = DefaultMediaSourceFactory(
                            DefaultDataSource.Factory(reactApplicationContext, http),
                        )
                        val config = ThumbnailFrameExtractor.Configuration.Builder()
                            .setSeekParameters(SeekParameters.CLOSEST_SYNC)
                            .setMediaCodecSelector(MediaCodecSelector.DEFAULT)
                            .build()
                        extractor = ThumbnailFrameExtractor(
                            reactApplicationContext, config, mediaSource,
                            if (maxWidth > 0) maxWidth else Int.MAX_VALUE,
                            if (maxHeight > 0) maxHeight else Int.MAX_VALUE,
                        )
                        val effects = if (maxWidth > 0 && maxHeight > 0) listOf(
                            Presentation.createForWidthAndHeight(maxWidth, maxHeight, Presentation.LAYOUT_SCALE_TO_FIT),
                        ) else emptyList()
                        extractor!!.setMediaItem(MediaItem.fromUri(source), effects)
                        remoteKey = key
                    }
                    remoteOwner = owner
                    activeResult = result
                    val future = extractor!!.getFrame(timestampMs)
                    future.addListener({
                        // A released or timed-out request must never publish a late bitmap.
                        if (activeResult === result && !result.isDone) {
                            try {
                                // Media3 may return its last frame again. Its bitmap stays owned
                                // by the extractor, so cache encoding must use a separate copy.
                                val bitmap = future.get().bitmap.copy(Bitmap.Config.ARGB_8888, false)
                                if (!result.complete(bitmap)) bitmap.recycle()
                            } catch (error: Throwable) {
                                releaseRemote()
                                result.completeExceptionally(error.cause ?: error)
                            } finally {
                                activeResult = null
                                handler.postDelayed(idleRelease, 15_000)
                            }
                        }
                    }, { task -> handler.post(task) })
                } catch (error: Throwable) {
                    releaseRemote()
                    result.completeExceptionally(error)
                }
            }

            return try {
                result.get(if (owner == null) 10L else 5L, TimeUnit.SECONDS)
            } catch (error: Throwable) {
                result.completeExceptionally(error.cause ?: error)
                handler.post {
                    if (activeResult === result) {
                        activeResult = null
                        releaseRemote()
                    }
                }
                throw (error.cause ?: error)
            }
        }

        fun cancel(owner: String) {
            synchronized(this) {
                handler?.post {
                    if (remoteOwner == owner) {
                        val pending = activeResult
                        activeResult = null
                        // Idle extractors stay warm briefly between scrubs. In-flight requests
                        // are released so switching sources or leaving cannot waste bandwidth.
                        if (pending != null) releaseRemote()
                        else handler?.postDelayed(idleRelease, 15_000)
                        pending?.completeExceptionally(CancellationException("Preview cancelled"))
                    }
                }
            }
        }

        @Synchronized
        fun close() {
            handler?.post {
                val pending = activeResult
                activeResult = null
                releaseRemote()
                pending?.completeExceptionally(CancellationException("Thumbnail module closed"))
                thread?.quitSafely()
            }
        }

        private fun releaseRemote() {
            handler?.removeCallbacks(idleRelease)
            try {
                extractor?.release()
            } catch (_: Exception) {
                // Device codecs may already be torn down after an extraction error.
            } finally {
                extractor = null
                remoteKey = null
                remoteOwner = null
            }
        }

        fun releaseRetriever() {
            val retriever = activeRetriever
            activeRetriever = null
            activeSourceKey = null
            try {
                retriever?.release()
            } catch (_: Throwable) {
                // Some device codecs throw after a decode failure.
            }
        }
    }

    @Synchronized
    private fun trimCache(directory: File) {
        val now = SystemClock.elapsedRealtime()
        if (lastCacheTrimMs != 0L && now - lastCacheTrimMs < 60_000) return
        lastCacheTrimMs = now
        val files = directory.listFiles()?.filter { it.extension == "jpg" }?.sortedBy { it.lastModified() } ?: return
        var bytes = files.sumOf { it.length() }
        var count = files.size
        for (file in files) {
            if (bytes <= 32L * 1024 * 1024 && count <= 256) break
            val size = file.length()
            if (file.delete()) {
                bytes -= size
                count--
            }
        }
    }

    private fun isRemoteSource(source: String): Boolean =
        when (Uri.parse(source).scheme?.lowercase()) {
            "http", "https" -> true
            else -> false
        }

    private fun setDataSource(
        retriever: MediaMetadataRetriever,
        source: String,
        headers: Map<String, String>,
    ) {
        val uri = Uri.parse(source)
        when (uri.scheme?.lowercase()) {
            "http", "https" -> retriever.setDataSource(source, headers)
            "content", "android.resource" ->
                retriever.setDataSource(reactApplicationContext, uri)
            "file" -> {
                val path = uri.path ?: throw IllegalArgumentException("Invalid file URI")
                retriever.setDataSource(path)
            }
            null -> retriever.setDataSource(source)
            else -> retriever.setDataSource(reactApplicationContext, uri)
        }
    }

    private fun scaleBitmap(bitmap: Bitmap, maxWidth: Int, maxHeight: Int): Bitmap {
        if (maxWidth <= 0 && maxHeight <= 0) return bitmap

        val widthScale = if (maxWidth > 0) maxWidth.toDouble() / bitmap.width else 1.0
        val heightScale = if (maxHeight > 0) maxHeight.toDouble() / bitmap.height else 1.0
        val scale = min(1.0, min(widthScale, heightScale))
        if (scale >= 1.0) return bitmap

        return Bitmap.createScaledBitmap(
            bitmap,
            (bitmap.width * scale).roundToInt().coerceAtLeast(1),
            (bitmap.height * scale).roundToInt().coerceAtLeast(1),
            true,
        )
    }

    private fun trimLetterbox(bitmap: Bitmap): Bitmap {
        val limit = bitmap.height / 4
        if (limit < 3 || bitmap.width < 32) return bitmap
        fun isBlackRow(y: Int): Boolean {
            var black = 0
            for (sample in 0 until 32) {
                val x = ((sample + 1) * bitmap.width / 33).coerceAtMost(bitmap.width - 1)
                val pixel = bitmap.getPixel(x, y)
                if (((pixel shr 16) and 255) <= 16 && ((pixel shr 8) and 255) <= 16 && (pixel and 255) <= 16) black++
            }
            return black >= 31
        }
        var top = 0
        var bottom = 0
        while (top < limit && isBlackRow(top)) top++
        while (bottom < limit && isBlackRow(bitmap.height - 1 - bottom)) bottom++
        // Only trim matched letterboxing; preserve uniformly dark frames.
        if (top < 2 || bottom < 2 || top == limit || bottom == limit || kotlin.math.abs(top - bottom) > 3) return bitmap
        return Bitmap.createBitmap(bitmap, 0, top, bitmap.width, bitmap.height - top - bottom)
    }

    private fun createResult(
        file: File,
        width: Int,
        height: Int,
        timestampMs: Long,
        cached: Boolean,
    ) = Arguments.createMap().apply {
        putString("uri", Uri.fromFile(file).toString())
        putString("path", file.absolutePath)
        putInt("width", width)
        putInt("height", height)
        putDouble("timestampMs", timestampMs.toDouble())
        putBoolean("cached", cached)
    }

    private fun buildCacheKey(
        source: String,
        timestampMs: Long,
        headers: Map<String, String>,
        quality: Int,
        maxWidth: Int,
        maxHeight: Int,
        cropBlackBars: Boolean,
    ): String {
        val value = buildString {
            append("media3-frame-extractor-v2|")
            append("crop-bars=").append(cropBlackBars).append('|')
            append(source)
            append('|').append(timestampMs)
            append('|').append(quality)
            append('|').append(maxWidth).append('x').append(maxHeight)
            headers.toSortedMap(String.CASE_INSENSITIVE_ORDER).forEach { (name, headerValue) ->
                append('|').append(name.lowercase()).append(':').append(headerValue)
            }
        }
        return MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { byte -> "%02x".format(byte) }
    }
}

private fun ReadableMap?.toStringMap(): Map<String, String> {
    if (this == null) return emptyMap()
    val result = linkedMapOf<String, String>()
    val iterator = keySetIterator()
    while (iterator.hasNextKey()) {
        val key = iterator.nextKey()
        val value = when (getType(key)) {
            ReadableType.String -> getString(key)
            ReadableType.Number -> getDouble(key).toString()
            ReadableType.Boolean -> getBoolean(key).toString()
            else -> null
        }
        if (value != null) result[key] = value
    }
    return result
}

private fun ReadableMap?.stringOrNull(key: String): String? =
    if (this != null && hasKey(key) && !isNull(key) && getType(key) == ReadableType.String) getString(key) else null

private fun ReadableMap?.intOr(key: String, fallback: Int): Int {
    if (this == null || !hasKey(key) || isNull(key)) return fallback
    return when (getType(key)) {
        ReadableType.Number -> getDouble(key).roundToInt()
        else -> fallback
    }
}

private fun ReadableMap?.booleanOr(key: String, fallback: Boolean): Boolean {
    if (this == null || !hasKey(key) || isNull(key)) return fallback
    return when (getType(key)) {
        ReadableType.Boolean -> getBoolean(key)
        else -> fallback
    }
}

class VideoThumbnailPackage : com.facebook.react.ReactPackage {
    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> = listOf(VideoThumbnailModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> = emptyList()
}
