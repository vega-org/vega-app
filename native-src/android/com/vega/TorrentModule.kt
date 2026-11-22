package com.vega

import android.util.Log
import com.facebook.react.bridge.*
import org.libtorrent4j.*
import org.libtorrent4j.alerts.*
import org.libtorrent4j.swig.settings_pack
import java.io.File
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class TorrentModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "TorrentModule"
        private const val STREAM_STARTUP_BYTES = 8L * 1024L * 1024L
        // When resuming, only the container header is needed from the start of the file.
        private const val RESUME_HEADER_BYTES = 2L * 1024L * 1024L
        // MKV Cues and a trailing MP4 moov live here; players read them before playing.
        private const val STREAM_TAIL_BYTES = 2L * 1024L * 1024L
        // Many magnets from providers carry no trackers, which leaves peer discovery to
        // the DHT alone. These public trackers find peers in a few seconds.
        private val PUBLIC_TRACKERS = listOf(
            "udp://tracker.opentrackr.org:1337/announce",
            "udp://open.demonii.com:1337/announce",
            "udp://open.stealth.si:80/announce",
            "udp://tracker.torrent.eu.org:451/announce",
            "udp://exodus.desync.com:6969/announce",
            "udp://explodie.org:6969/announce",
            "udp://tracker.tiny-vps.com:6969/announce",
            "udp://tracker.openbittorrent.com:6969/announce"
        )
        private var sessionManager: SessionManager? = null
        private var streamServer: TorrentStreamServer? = null
        private val torrentHandles = mutableMapOf<String, TorrentHandle>()
        private val torrentSavePaths = ConcurrentHashMap<String, String>()
        private val torrentOutputPaths = mutableMapOf<String, String>()
    }

    override fun getName(): String = "TorrentModule"

    private fun streamCacheDir(): File = File(reactApplicationContext.cacheDir, "torrents")

    private fun legacyStreamDir(): File = File(reactApplicationContext.filesDir, "torrents")

    private fun hasActiveTorrentIn(dir: File): Boolean {
        val dirPath = try { dir.canonicalPath } catch (_: Exception) { dir.absolutePath }
        val prefix = dirPath + File.separator
        return torrentSavePaths.values.any { saved ->
            val savedPath = try { File(saved).canonicalPath } catch (_: Exception) { saved }
            savedPath == dirPath || savedPath.startsWith(prefix)
        }
    }

    private fun cleanupStaleStreamDirs() {
        for (dir in listOf(legacyStreamDir(), streamCacheDir())) {
            if (dir.exists() && !hasActiveTorrentIn(dir)) {
                try {
                    dir.deleteRecursively()
                } catch (e: Exception) {
                    VegaLog.w(TAG, "Failed to clean stale torrent dir ${dir.absolutePath}", e)
                }
            }
        }
    }

    private fun ensureSession(): SessionManager {
        sessionManager?.let { if (it.isRunning) return it }

        val sm = SessionManager(false)
        val sp = SettingsPack()
        sp.setEnableDht(true)
        sp.setEnableLsd(true)
        sp.listenInterfaces("0.0.0.0:6881,0.0.0.0:6891")
        sp.setDhtBootstrapNodes("router.bittorrent.com:6881,dht.transmissionbt.com:6881,router.utorrent.com:6881,dht.aelitis.com:6881")
        // Streaming waits on single pieces, so a slow peer must not hold a block for
        // libtorrent's default 20 s (piece) or 60 s (request) before it is re-requested.
        sp.setInteger(settings_pack.int_types.piece_timeout.swigValue(), 6)
        sp.setInteger(settings_pack.int_types.request_timeout.swigValue(), 12)
        sp.setInteger(settings_pack.int_types.peer_connect_timeout.swigValue(), 7)
        // Connect to more peers right after adding, so the first pieces arrive sooner.
        sp.setInteger(settings_pack.int_types.torrent_connect_boost.swigValue(), 60)
        sp.setInteger(settings_pack.int_types.connection_speed.swigValue(), 60)
        sp.setBoolean(settings_pack.bool_types.strict_end_game_mode.swigValue(), false)
        sp.setBoolean(settings_pack.bool_types.announce_to_all_trackers.swigValue(), true)
        sp.setBoolean(settings_pack.bool_types.announce_to_all_tiers.swigValue(), true)
        
        sm.start(SessionParams(sp))
        sessionManager = sm
        cleanupStaleStreamDirs()
        VegaLog.d(TAG, "SessionManager started, running=${sm.isRunning}")
        return sm
    }

    private fun ensureServer(): TorrentStreamServer {
        streamServer?.let { return it }
        val server = TorrentStreamServer()
        server.sessionManager = ensureSession()
        server.start()
        streamServer = server
        VegaLog.d(TAG, "Stream server started on port ${server.listeningPort}")
        return server
    }

    private fun withPublicTrackers(magnet: String): String {
        val builder = StringBuilder(magnet)
        for (tracker in PUBLIC_TRACKERS) {
            val encoded = java.net.URLEncoder.encode(tracker, "UTF-8")
            if (!magnet.contains(encoded) && !magnet.contains(tracker)) {
                builder.append("&tr=").append(encoded)
            }
        }
        return builder.toString()
    }

    @ReactMethod
    fun initEngine(promise: Promise) {
        try {
            val sm = ensureSession()
            val server = ensureServer()
            val result = WritableNativeMap().apply {
                putBoolean("running", sm.isRunning)
                putInt("streamPort", server.listeningPort)
            }
            promise.resolve(result)
        } catch (e: Exception) {
            VegaLog.e(TAG, "initEngine failed", e)
            promise.reject("INIT_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun addTorrent(magnetOrUrl: String, outputFolder: String?, fileName: String?, promise: Promise) {
        Thread {
            try {
                val expectedHash = if (magnetOrUrl.startsWith("magnet:")) {
                    Regex("btih:([a-fA-F0-9]{40})", RegexOption.IGNORE_CASE)
                        .find(magnetOrUrl)?.groupValues?.get(1)?.lowercase()
                } else null

                val sm = ensureSession()
                val server = ensureServer()
                val downloadDir = outputFolder ?: streamCacheDir().absolutePath
                File(downloadDir).mkdirs()

                // Check both our Map and the actual C++ session manager
                var existing = if (expectedHash != null) torrentHandles[expectedHash] else null
                if (existing == null && expectedHash != null) {
                    existing = sm.find(Sha1Hash.parseHex(expectedHash))
                    if (existing != null && existing.isValid) {
                        torrentHandles[expectedHash] = existing
                        torrentSavePaths[expectedHash] = downloadDir
                    }
                }

                if (existing != null && existing.isValid) {
                    try {
                        if (existing.status().hasMetadata()) {
                            server.registerTorrent(expectedHash!!, File(downloadDir))
                            promise.resolve(buildTorrentInfo(existing))
                            return@Thread
                        }
                    } catch (e: Exception) {
                        torrentHandles.remove(expectedHash!!)
                        torrentSavePaths.remove(expectedHash)
                    }
                }

                var addError: String? = null
                val metadataLatch = CountDownLatch(1)

                val listener = object : AlertListener {
                    override fun types(): IntArray? = null
                    override fun alert(alert: Alert<*>) {
                        when (alert) {
                            is AddTorrentAlert -> {
                                if (alert.error().isError) {
                                    addError = alert.error().toString()
                                    metadataLatch.countDown()
                                    return
                                }
                                val th = alert.handle()
                                val alertHash = try { th.infoHash().toHex() } catch(_: Exception) { return }
                                if (expectedHash != null && alertHash != expectedHash) return
                                VegaLog.d(TAG, "Alert: AddTorrentAlert for $alertHash")

                                try {
                                    torrentHandles[alertHash] = th
                                    torrentSavePaths[alertHash] = downloadDir
                                    if (th.status().hasMetadata()) {
                                        metadataLatch.countDown()
                                    }
                                } catch(_: Exception) {}
                            }
                            is MetadataReceivedAlert -> {
                                val alertHash = try { alert.handle().infoHash().toHex() } catch(_: Exception) { return }
                                if (expectedHash != null && alertHash != expectedHash) return
                                VegaLog.d(TAG, "Alert: MetadataReceivedAlert for $alertHash")
                                metadataLatch.countDown()
                            }
                            is MetadataFailedAlert -> {
                                val alertHash = try { alert.handle().infoHash().toHex() } catch(_: Exception) { return }
                                if (expectedHash != null && alertHash != expectedHash) return
                                VegaLog.d(TAG, "Alert: MetadataFailedAlert for $alertHash")
                                addError = "Failed to fetch magnet metadata"
                                metadataLatch.countDown()
                            }
                            is TorrentErrorAlert -> {
                                val alertHash = try { alert.handle().infoHash().toHex() } catch(_: Exception) { return }
                                if (expectedHash != null && alertHash == expectedHash) {
                                    VegaLog.e(TAG, "Alert: TorrentErrorAlert for $alertHash - ${alert.error().message}")
                                }
                            }
                            is TorrentRemovedAlert -> {
                                val alertHash = try { alert.handle().infoHash().toHex() } catch(_: Exception) { return }
                                if (expectedHash != null && alertHash == expectedHash) {
                                    VegaLog.d(TAG, "Alert: TorrentRemovedAlert for $alertHash")
                                }
                            }
                        }
                    }
                }

                sm.addListener(listener)

                VegaLog.d(TAG, "Starting download: $magnetOrUrl -> $downloadDir")
                if (magnetOrUrl.startsWith("magnet:") ||
                    magnetOrUrl.startsWith("http://") ||
                    magnetOrUrl.startsWith("https://")) {
                    val source = if (magnetOrUrl.startsWith("magnet:")) withPublicTrackers(magnetOrUrl) else magnetOrUrl
                    sm.download(source, File(downloadDir), TorrentFlags.AUTO_MANAGED)
                } else {
                    val ti = TorrentInfo(File(magnetOrUrl))
                    sm.download(ti, File(downloadDir))
                }

                VegaLog.d(TAG, "Waiting for metadata (45s timeout)...")
                val gotMetadata = metadataLatch.await(45, TimeUnit.SECONDS)
                VegaLog.d(TAG, "Metadata wait done: gotMetadata=$gotMetadata, addError=$addError")
                sm.removeListener(listener)

                if (addError != null) {
                    promise.reject("ADD_ERROR", addError)
                    return@Thread
                }

                if (!gotMetadata) {
                    promise.reject("TIMEOUT", "Timed out waiting for torrent metadata")
                    return@Thread
                }

                val finalHashHex = expectedHash ?: return@Thread promise.reject("INVALID_HANDLE", "Could not determine infoHash")
                
                val th = sm.find(Sha1Hash.parseHex(finalHashHex))
                VegaLog.d(TAG, "Found handle for $finalHashHex: valid=${th?.isValid}, hasMetadata=${try { th?.status()?.hasMetadata() } catch(_:Exception) { "error" }}")
                if (th == null || !th.isValid) {
                    promise.reject("INVALID_HANDLE", "Torrent handle became invalid after addition")
                    return@Thread
                }
                
                try {
                    torrentHandles[finalHashHex] = th
                    torrentSavePaths[finalHashHex] = downloadDir
                    if (th.status().hasMetadata()) {
                        if (fileName != null) {
                            try {
                                val ti = th.torrentFile()
                                if (ti != null) {
                                    var maxIdx = 0
                                    var maxSize = 0L
                                    val fs = ti.files()
                                    for (i in 0 until fs.numFiles()) {
                                        val size = fs.fileSize(i)
                                        if (size > maxSize) {
                                            maxSize = size
                                            maxIdx = i
                                        }
                                    }
                                    if (maxSize > 0) {
                                        val originalPath = fs.filePath(maxIdx)
                                        val ext = File(originalPath).extension
                                        val newName = if (ext.isNotEmpty()) "$fileName.$ext" else fileName
                                        th.renameFile(maxIdx, newName)
                                        torrentOutputPaths[finalHashHex] = File(downloadDir, newName).absolutePath
                                        VegaLog.d(TAG, "Renamed torrent file $originalPath to $newName")
                                    }
                                }
                            } catch (e: Exception) {
                                VegaLog.e(TAG, "Failed to rename torrent file", e)
                            }
                        }
                        
                        server.registerTorrent(finalHashHex, File(downloadDir))
                        VegaLog.d(TAG, "Registered torrent with stream server: $finalHashHex")
                    }
                    promise.resolve(buildTorrentInfo(th))
                } catch(e: Exception) {
                    promise.reject("INVALID_HANDLE", "Torrent handle error: ${e.message}")
                }

            } catch (e: Exception) {
                VegaLog.e(TAG, "addTorrent failed", e)
                promise.reject("ADD_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun getStats(infoHash: String, promise: Promise) {
        try {
            val th = try { ensureSession().find(Sha1Hash.parseHex(infoHash)) } catch(e: Exception) { null }
            if (th == null || !th.isValid) {
                promise.reject("NOT_FOUND", "Torrent handle not found or invalid")
                return
            }
            
            val status = try { th.status() } catch(e: Exception) {
                promise.reject("INVALID_HANDLE", "Torrent handle is no longer valid")
                return
            }
            
            val result = WritableNativeMap().apply {
                putString("state", mapState(status.state()))
                putDouble("progress", status.progress().toDouble())
                putDouble("downloadRate", status.downloadRate().toDouble())
                putDouble("uploadRate", status.uploadRate().toDouble())
                putInt("numPeers", status.numPeers())
                putInt("numSeeds", status.numSeeds())
                putDouble("totalDone", status.totalDone().toDouble())
                putDouble("totalWanted", status.totalWanted().toDouble())
                putBoolean("hasMetadata", status.hasMetadata())
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("STATS_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun getStreamUrl(infoHash: String, fileIndex: Int, promise: Promise) {
        try {
            val server = ensureServer()
            var filename = "video.mp4"
            val th = try { ensureSession().find(Sha1Hash.parseHex(infoHash)) } catch(e: Exception) { null }
            if (th != null && th.isValid) {
                try {
                    val ti = th.torrentFile()
                    filename = ti.files().fileName(fileIndex)
                } catch(e: Exception) {}
            }
            val encodedFilename = java.net.URLEncoder.encode(filename, "UTF-8").replace("+", "%20")
            val url = "http://127.0.0.1:${server.listeningPort}/stream/$infoHash/$fileIndex/$encodedFilename"
            promise.resolve(url)
        } catch (e: Exception) {
            promise.reject("STREAM_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun prepareVideoFile(
        infoHash: String,
        fileIndex: Int,
        resuming: Boolean,
        fullDownload: Boolean,
        promise: Promise
    ) {
        Thread {
            try {
                VegaLog.d(TAG, "prepareVideoFile: infoHash=$infoHash, fileIndex=$fileIndex")
                val sm = ensureSession()
                val th = sm.find(Sha1Hash.parseHex(infoHash))
                if (th == null || !th.isValid) {
                    promise.reject("NOT_FOUND", "Torrent handle not found or invalid")
                    return@Thread
                }
                
                if (!th.status().hasMetadata()) {
                    promise.reject("NO_METADATA", "No metadata yet")
                    return@Thread
                }
                
                val ti = try { th.torrentFile() } catch(e: Exception) { null }
                if (ti == null) {
                    promise.reject("INVALID_HANDLE", "Torrent handle invalid")
                    return@Thread
                }
                
                val fs = ti.files()
                if (fileIndex >= fs.numFiles() || fileIndex < 0) {
                    promise.reject("INVALID_INDEX", "File index out of bounds")
                    return@Thread
                }
                
                val fileOffset = fs.fileOffset(fileIndex)
                val fileSize = fs.fileSize(fileIndex)
                val pieceLength = ti.pieceLength().toLong()
                val startPiece = (fileOffset / pieceLength).toInt()
                // A resumed video starts mid-file, so fetching the opening minutes first
                // would only compete with the header, the index and the resume point.
                val startupBytes = minOf(fileSize, if (resuming) RESUME_HEADER_BYTES else STREAM_STARTUP_BYTES)
                val startupEndOffset = fileOffset + startupBytes - 1L
                val startupEndPiece = (startupEndOffset / pieceLength).toInt()

                th.unsetFlags(TorrentFlags.SEQUENTIAL_DOWNLOAD)
                // The video file stays at normal priority: a file set to IGNORE has its
                // pieces stored in libtorrent's part file, not the real file the stream
                // server reads. Full download also skips the other files; limited download
                // leaves file priorities alone and skips pieces instead.
                streamServer?.setFullDownload(infoHash, fullDownload)
                val filePriorities = if (fullDownload) {
                    Priority.array(Priority.IGNORE, fs.numFiles())
                } else {
                    th.filePriorities()
                }
                filePriorities[fileIndex] = Priority.DEFAULT
                applyFilePriorities(th, filePriorities)
                if (!fullDownload) {
                    // Only the pieces marked below and by the stream server download.
                    th.prioritizePieces(Priority.array(Priority.IGNORE, ti.numPieces()))
                }

                for (pieceIndex in startPiece..startupEndPiece) {
                    if (!th.havePiece(pieceIndex)) {
                        th.piecePriority(pieceIndex, Priority.TOP_PRIORITY)
                        th.setPieceDeadline(pieceIndex, 1000 + (pieceIndex - startPiece) * 250)
                    }
                }

                val endPiece = ((fileOffset + fileSize - 1L) / pieceLength).toInt()
                val tailStartPiece = maxOf(
                    startupEndPiece + 1,
                    ((fileOffset + maxOf(0L, fileSize - STREAM_TAIL_BYTES)) / pieceLength).toInt()
                )
                for (pieceIndex in tailStartPiece..endPiece) {
                    if (!th.havePiece(pieceIndex)) {
                        th.piecePriority(pieceIndex, Priority.TOP_PRIORITY)
                        th.setPieceDeadline(pieceIndex, 2000)
                    }
                }

                VegaLog.d(
                    TAG,
                    "prepareVideoFile: file=$fileIndex, pieces=$startPiece-$startupEndPiece, startupBytes=$startupBytes, resuming=$resuming, fullDownload=$fullDownload"
                )

                var waitCount = 0
                while (th.isValid && waitCount < 3000) {
                    if (th.havePiece(startPiece)) {
                        promise.resolve(true)
                        return@Thread
                    }
                    Thread.sleep(100)
                    waitCount++
                }

                if (!th.isValid) {
                    promise.reject("INVALID_HANDLE", "Torrent handle became invalid while preparing video")
                } else {
                    promise.reject("TIMEOUT", "Timed out waiting for the first video piece")
                }
            } catch (e: Exception) {
                promise.reject("PREPARE_ERROR", e.message, e)
            }
        }.start()
    }

    @ReactMethod
    fun getFiles(infoHash: String, promise: Promise) {
        try {
            val th = try { ensureSession().find(Sha1Hash.parseHex(infoHash)) } catch(e: Exception) { null }
            if (th == null || !th.isValid) {
                promise.reject("NOT_FOUND", "Torrent handle not found or invalid")
                return
            }

            val status = try { th.status() } catch(e: Exception) {
                promise.reject("INVALID_HANDLE", "Torrent handle is no longer valid")
                return
            }

            if (!status.hasMetadata()) {
                promise.reject("NO_METADATA", "Torrent metadata not available")
                return
            }

            val ti = try { th.torrentFile() } catch(e: Exception) { null }
            if (ti == null) {
                promise.reject("INVALID_HANDLE", "Torrent handle invalid")
                return
            }
            val files = WritableNativeArray()
            val fs = ti.files()
            for (i in 0 until fs.numFiles()) {
                val file = WritableNativeMap().apply {
                    putInt("index", i)
                    putString("name", fs.fileName(i))
                    putString("path", fs.filePath(i))
                    putDouble("size", fs.fileSize(i).toDouble())
                }
                files.pushMap(file)
            }
            promise.resolve(files)
        } catch (e: Exception) {
            promise.reject("FILES_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun pauseTorrent(infoHash: String, promise: Promise) {
        try {
            val th = try { ensureSession().find(Sha1Hash.parseHex(infoHash)) } catch(e: Exception) { null }
            th?.pause()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("PAUSE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun resumeTorrent(infoHash: String, promise: Promise) {
        try {
            val th = try { ensureSession().find(Sha1Hash.parseHex(infoHash)) } catch(e: Exception) { null }
            th?.resume()
            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("RESUME_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun completeTorrent(infoHash: String, promise: Promise) {
        try {
            val outputPath = torrentOutputPaths[infoHash]
            if (outputPath == null) {
                promise.reject("OUTPUT_NOT_FOUND", "Torrent output path is unavailable")
                return
            }
            val outputFile = File(outputPath)
            if (!outputFile.exists() || outputFile.length() <= 0L) {
                promise.reject("OUTPUT_NOT_FOUND", "Torrent output file is missing")
                return
            }
            val result = WritableNativeMap().apply {
                putBoolean("success", true)
                putString("outputPath", outputFile.absolutePath)
                putString("fileName", outputFile.name)
                putDouble("size", outputFile.length().toDouble())
            }
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("COMPLETE_ERROR", e.message, e)
        }
    }

    // libtorrent applies file priorities on its disk thread and then recomputes every
    // piece priority from them, so piece priorities set before that finishes are lost.
    private fun applyFilePriorities(th: TorrentHandle, priorities: Array<Priority>) {
        if (th.filePriorities().contentEquals(priorities)) return
        th.prioritizeFiles(priorities)
        var waitCount = 0
        while (waitCount < 30 && !th.filePriorities().contentEquals(priorities)) {
            Thread.sleep(100)
            waitCount++
        }
    }

    @ReactMethod
    fun setStreamDuration(infoHash: String, durationSeconds: Double, promise: Promise) {
        streamServer?.setDuration(infoHash, durationSeconds)
        promise.resolve(true)
    }

    @ReactMethod
    fun deleteTorrent(infoHash: String, deleteFiles: Boolean, promise: Promise) {
        VegaLog.e(TAG, "deleteTorrent called for infoHash: $infoHash, deleteFiles: $deleteFiles")
        try {
            val sm = ensureSession()
            val th = try { sm.find(Sha1Hash.parseHex(infoHash)) } catch(e: Exception) { null }
            
            val pathsToDelete = mutableListOf<String>()
            val savePath = torrentSavePaths[infoHash]
            torrentOutputPaths[infoHash]?.let { pathsToDelete.add(it) }
            if (deleteFiles && th != null && savePath != null) {
                try {
                    val ti = th.torrentFile()
                    if (ti != null) {
                        val fs = ti.files()
                        for (i in 0 until fs.numFiles()) {
                            // If we renamed the file, we can't easily query th for the new name without extra bindings.
                            // But libtorrent's session remove(th) might not delete files.
                            // We will delete the original file paths.
                            pathsToDelete.add(File(savePath, fs.filePath(i)).absolutePath)
                        }
                    }
                } catch (_: Exception) {}
            }
            
            if (th != null && sm != null) {
                try { th.pause() } catch (_: Exception) {}
                try { sm.remove(th) } catch (_: Exception) {}
            }
            
            streamServer?.unregisterTorrent(infoHash)
            torrentHandles.remove(infoHash)
            torrentSavePaths.remove(infoHash)
            torrentOutputPaths.remove(infoHash)

            val saveRoot = savePath?.let { path ->
                try { File(path).canonicalFile } catch (_: Exception) { File(path) }
            }
            for (path in pathsToDelete) {
                try { 
                    val f = File(path)
                    f.delete()
                    var parent = f.parentFile
                    while (parent != null) {
                        val canonicalParent = try { parent.canonicalFile } catch (_: Exception) { parent }
                        if (saveRoot != null && canonicalParent == saveRoot) break
                        if (parent.list()?.isEmpty() != true) break
                        if (!parent.delete()) break
                        parent = parent.parentFile
                    }
                } catch (_: Exception) {}
            }

            promise.resolve(null)
        } catch (e: Exception) {
            promise.reject("DELETE_ERROR", e.message, e)
        }
    }

    @ReactMethod
    fun clearStreamCache(promise: Promise) {
        Thread {
            try {
                cleanupStaleStreamDirs()
                promise.resolve(true)
            } catch (e: Exception) {
                promise.reject("CLEANUP_ERROR", e.message, e)
            }
        }.start()
    }

    private fun buildTorrentInfo(th: TorrentHandle): WritableMap {
        val hasMeta = try { th.status().hasMetadata() } catch(e: Exception) { false }
        val infoHash = try { th.infoHash().toHex() } catch(e: Exception) { "" }
        
        val result = WritableNativeMap().apply {
            putString("infoHash", infoHash)
            putBoolean("hasMetadata", hasMeta)
        }

        if (hasMeta) {
            try {
                val ti = th.torrentFile()
                if (ti != null) {
                    result.putString("name", ti.name())
                    result.putDouble("totalSize", ti.totalSize().toDouble())
        
                    val files = WritableNativeArray()
                    val fs = ti.files()
                    for (i in 0 until fs.numFiles()) {
                        val file = WritableNativeMap().apply {
                            putInt("index", i)
                            putString("name", fs.fileName(i))
                            putString("path", fs.filePath(i))
                            putDouble("size", fs.fileSize(i).toDouble())
                        }
                        files.pushMap(file)
                    }
                    result.putArray("files", files)
                }
            } catch(e: Exception) {}
        }
        return result
    }

    private fun mapState(state: TorrentStatus.State): String {
        return when (state) {
            TorrentStatus.State.CHECKING_FILES -> "checking"
            TorrentStatus.State.DOWNLOADING_METADATA -> "metadata"
            TorrentStatus.State.DOWNLOADING -> "downloading"
            TorrentStatus.State.FINISHED -> "finished"
            TorrentStatus.State.SEEDING -> "seeding"
            TorrentStatus.State.CHECKING_RESUME_DATA -> "checking"
            else -> "unknown"
        }
    }
}
