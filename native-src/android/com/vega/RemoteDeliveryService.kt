package com.vega

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadata
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

class RemoteDeliveryService : Service() {

    companion object {
        private const val TAG = "RemoteDeliveryService"
        private const val NOTIFICATION_ID = 40191
        private const val CHANNEL_ID = "vega_cast_playback_channel"
        // Own the delivery runtime for the lifetime of casting, even if the
        // activity/React bridge is destroyed when its task is swiped away.
        @Volatile private var deliveryRuntime: RemoteDeliveryModule? = null
        @Volatile private var deliveryGeneration = 0L
        @Volatile private var running = false

        fun retainDelivery(runtime: RemoteDeliveryModule, generation: Long = 0L) {
            deliveryRuntime = runtime
            deliveryGeneration = generation
        }

        fun releaseDelivery(runtime: RemoteDeliveryModule, expectedGeneration: Long? = null) {
            if (deliveryRuntime === runtime && (expectedGeneration == null || expectedGeneration == deliveryGeneration)) {
                deliveryRuntime = null
            }
        }

        const val ACTION_START = "com.vega.ACTION_START_REMOTE_DELIVERY"
        const val ACTION_STOP = "com.vega.ACTION_STOP_REMOTE_DELIVERY"
        const val ACTION_UPDATE = "com.vega.ACTION_UPDATE_REMOTE_PLAYBACK"

        const val ACTION_PLAY = "com.vega.ACTION_PLAY"
        const val ACTION_PAUSE = "com.vega.ACTION_PAUSE"
        const val ACTION_REWIND = "com.vega.ACTION_REWIND"
        const val ACTION_FORWARD = "com.vega.ACTION_FORWARD"
        private const val CUSTOM_REWIND = "com.vega.CUSTOM_REWIND_10"
        private const val CUSTOM_FORWARD = "com.vega.CUSTOM_FORWARD_10"
        private const val SKIP_DEBOUNCE_MS = 700L
        const val ACTION_STOP_CAST = "com.vega.ACTION_STOP_CAST"

        fun start(
            context: Context,
            title: String? = null,
            subtitle: String? = null,
            artwork: String? = null,
            isPlaying: Boolean = true,
            positionSeconds: Double = 0.0,
            durationSeconds: Double = 0.0,
            generation: Long = 0L
        ) {
            val intent = Intent(context, RemoteDeliveryService::class.java).apply {
                action = ACTION_START
                if (title != null) putExtra("title", title)
                if (subtitle != null) putExtra("subtitle", subtitle)
                if (artwork != null) putExtra("artwork", artwork)
                putExtra("isPlaying", isPlaying)
                putExtra("position", positionSeconds)
                putExtra("duration", durationSeconds)
                if (generation > 0L) putExtra("generation", generation)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {
                VegaLog.e(TAG, "Failed to start RemoteDeliveryService: ${e.message}", e)
            }
        }

        fun update(
            context: Context,
            title: String? = null,
            subtitle: String? = null,
            artwork: String? = null,
            isPlaying: Boolean? = null,
            positionSeconds: Double? = null,
            durationSeconds: Double? = null
        ) {
            if (!running) return
            val intent = Intent(context, RemoteDeliveryService::class.java).apply {
                action = ACTION_UPDATE
                if (title != null) putExtra("title", title)
                if (subtitle != null) putExtra("subtitle", subtitle)
                if (artwork != null) putExtra("artwork", artwork)
                if (isPlaying != null) putExtra("isPlaying", isPlaying)
                if (positionSeconds != null) putExtra("position", positionSeconds)
                if (durationSeconds != null) putExtra("duration", durationSeconds)
            }
            try {
                context.startService(intent)
            } catch (e: Exception) {
                VegaLog.w(TAG, "Failed to update RemoteDeliveryService: ${e.message}")
            }
        }

        fun stop(context: Context) {
            try {
                context.stopService(Intent(context, RemoteDeliveryService::class.java))
            } catch (e: Exception) {
                VegaLog.w(TAG, "Failed to stop RemoteDeliveryService: ${e.message}")
            }
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var mediaSession: MediaSession? = null
    private var notificationManager: NotificationManager? = null

    private var currentTitle = "Vega Cast"
    private var currentSubtitle = "Casting media"
    private var currentArtworkUrl: String? = null
    private var currentArtworkBitmap: Bitmap? = null
    private var isPlaying = true
    private var currentPositionMs = 0L
    private var currentDurationMs = 0L

    // Skip taps are merged here instead of in JS: React Native pauses JS timers
    // while the activity is in the background, so a JS debounce would only fire
    // once the app is reopened.
    private val mainHandler = Handler(Looper.getMainLooper())
    private var activeGeneration = 0L
    private val taskRemovedStopRunnable = Runnable { stopForegroundService() }
    private var pendingSkipSeconds = 0.0
    private val flushSkip = Runnable {
        val delta = pendingSkipSeconds
        pendingSkipSeconds = 0.0
        if (delta != 0.0) RemoteDeliveryModule.sendMediaAction("skip", delta)
    }

    private fun queueSkip(seconds: Double) {
        pendingSkipSeconds += seconds
        val target = (currentPositionMs + (seconds * 1000).toLong()).coerceAtLeast(0L)
        currentPositionMs = if (currentDurationMs > 0) target.coerceAtMost(currentDurationMs) else target
        updatePlaybackState()
        mainHandler.removeCallbacks(flushSkip)
        mainHandler.postDelayed(flushSkip, SKIP_DEBOUNCE_MS)
    }

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        running = true
        notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager

        createNotificationChannel()
        acquireLocks()
        initMediaSession()
    }

    private fun acquireLocks() {
        try {
            if (wakeLock == null) {
                val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
                wakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Vega:RemoteDeliveryWakeLock")?.apply {
                    setReferenceCounted(false)
                    acquire(24 * 60 * 60 * 1000L)
                }
            }
        } catch (e: Exception) {
            VegaLog.w(TAG, "Failed to acquire wakeLock: ${e.message}")
        }

        try {
            if (wifiLock == null) {
                val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                wifiLock = wm?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Vega:RemoteDeliveryWifiLock")?.apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
        } catch (e: Exception) {
            VegaLog.w(TAG, "Failed to acquire wifiLock: ${e.message}")
        }
    }

    private fun releaseLocks() {
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {}
        wakeLock = null

        try {
            wifiLock?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {}
        wifiLock = null
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Casting & Media Playback",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Controls and background delivery for active cast sessions"
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            }
            notificationManager?.createNotificationChannel(channel)
        }
    }

    private fun initMediaSession() {
        try {
            mediaSession = MediaSession(this, "VegaRemotePlaybackSession").apply {
                @Suppress("DEPRECATION")
                setFlags(
                    MediaSession.FLAG_HANDLES_MEDIA_BUTTONS or
                    MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS
                )
                setCallback(object : MediaSession.Callback() {
                    override fun onPlay() {
                        isPlaying = true
                        updatePlaybackState()
                        updateNotification()
                        RemoteDeliveryModule.sendMediaAction("play")
                    }

                    override fun onPause() {
                        isPlaying = false
                        updatePlaybackState()
                        updateNotification()
                        RemoteDeliveryModule.sendMediaAction("pause")
                    }

                    override fun onSkipToPrevious() = queueSkip(-10.0)

                    override fun onSkipToNext() = queueSkip(10.0)

                    override fun onFastForward() = queueSkip(10.0)

                    override fun onRewind() = queueSkip(-10.0)

                    override fun onCustomAction(action: String, extras: android.os.Bundle?) {
                        when (action) {
                            CUSTOM_REWIND -> queueSkip(-10.0)
                            CUSTOM_FORWARD -> queueSkip(10.0)
                        }
                    }

                    override fun onSeekTo(pos: Long) {
                        mainHandler.removeCallbacks(flushSkip)
                        pendingSkipSeconds = 0.0
                        currentPositionMs = pos
                        updatePlaybackState()
                        RemoteDeliveryModule.sendMediaAction("seek", pos / 1000.0)
                    }

                    override fun onStop() {
                        RemoteDeliveryModule.sendMediaAction("stop")
                        stopForegroundService()
                    }
                })
                isActive = true
            }
        } catch (e: Exception) {
            VegaLog.e(TAG, "Failed to initialize MediaSession: ${e.message}", e)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent == null && deliveryRuntime == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        acquireLocks()
        // Also covers a service recreation or notification action arriving
        // before another ACTION_START, without waiting for JavaScript.
        if (intent?.action != ACTION_STOP && intent?.action != ACTION_STOP_CAST) {
            startInForeground()
        }
        when (intent?.action) {
            ACTION_START -> {
                mainHandler.removeCallbacks(taskRemovedStopRunnable)
                val gen = intent.getLongExtra("generation", 0L)
                if (gen > 0L) {
                    activeGeneration = gen
                } else if (activeGeneration == 0L) {
                    activeGeneration = deliveryGeneration
                }
                intent.getStringExtra("title")?.let { currentTitle = it }
                intent.getStringExtra("subtitle")?.let { currentSubtitle = it }
                val art = intent.getStringExtra("artwork")
                if (!art.isNullOrBlank() && art != currentArtworkUrl) {
                    currentArtworkUrl = art
                    loadArtworkAsync(art)
                }
                if (intent.hasExtra("isPlaying")) {
                    isPlaying = intent.getBooleanExtra("isPlaying", true)
                }
                if (intent.hasExtra("position")) {
                    currentPositionMs = (intent.getDoubleExtra("position", 0.0) * 1000).toLong()
                }
                if (intent.hasExtra("duration")) {
                    currentDurationMs = (intent.getDoubleExtra("duration", 0.0) * 1000).toLong()
                }
                updatePlaybackState()
                updateMediaSessionMetadata()
                startInForeground()
            }
            ACTION_UPDATE -> {
                if (activeGeneration == 0L) {
                    activeGeneration = deliveryGeneration
                }
                var metaChanged = false
                var playChanged = false
                intent.getStringExtra("title")?.let {
                    if (it != currentTitle) { currentTitle = it; metaChanged = true }
                }
                intent.getStringExtra("subtitle")?.let {
                    if (it != currentSubtitle) { currentSubtitle = it; metaChanged = true }
                }
                val art = intent.getStringExtra("artwork")
                if (!art.isNullOrBlank() && art != currentArtworkUrl) {
                    currentArtworkUrl = art
                    loadArtworkAsync(art)
                }
                if (intent.hasExtra("isPlaying")) {
                    val p = intent.getBooleanExtra("isPlaying", true)
                    if (p != isPlaying) {
                        isPlaying = p
                        playChanged = true
                    }
                }
                if (intent.hasExtra("position")) {
                    currentPositionMs = (intent.getDoubleExtra("position", 0.0) * 1000).toLong()
                }
                if (intent.hasExtra("duration")) {
                    currentDurationMs = (intent.getDoubleExtra("duration", 0.0) * 1000).toLong()
                }

                updatePlaybackState()
                if (metaChanged) {
                    updateMediaSessionMetadata()
                }
                if (metaChanged || playChanged) {
                    updateNotification()
                }
            }
            ACTION_PLAY -> {
                isPlaying = true
                updatePlaybackState()
                updateNotification()
                RemoteDeliveryModule.sendMediaAction("play")
            }
            ACTION_PAUSE -> {
                isPlaying = false
                updatePlaybackState()
                updateNotification()
                RemoteDeliveryModule.sendMediaAction("pause")
            }
            ACTION_REWIND -> queueSkip(-10.0)
            ACTION_FORWARD -> queueSkip(10.0)
            ACTION_STOP_CAST -> {
                RemoteDeliveryModule.sendMediaAction("stop")
                stopForegroundService()
            }
            ACTION_STOP -> {
                stopForegroundService()
            }
        }
        return if (intent?.action == ACTION_STOP || intent?.action == ACTION_STOP_CAST) {
            START_NOT_STICKY
        } else {
            START_STICKY
        }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Casting survives background and screen lock, but swiping the app away
        // from recents ends it. JS gets a moment to stop the receiver before the
        // server and service shut down.
        super.onTaskRemoved(rootIntent)
        mainHandler.removeCallbacks(flushSkip)
        mainHandler.removeCallbacks(taskRemovedStopRunnable)
        RemoteDeliveryModule.sendMediaAction("stop")
        mainHandler.postDelayed(taskRemovedStopRunnable, 2000L)
    }

    private fun startInForeground() {
        val notification = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: Exception) {
            VegaLog.e(TAG, "startForeground error: ${e.message}", e)
        }
    }

    private fun updateNotification() {
        try {
            val notification = buildNotification()
            notificationManager?.notify(NOTIFICATION_ID, notification)
        } catch (e: Exception) {
            VegaLog.w(TAG, "updateNotification error: ${e.message}")
        }
    }

    private fun updatePlaybackState() {
        try {
            val stateBuilder = PlaybackState.Builder()
                .setActions(
                    PlaybackState.ACTION_PLAY or
                    PlaybackState.ACTION_PAUSE or
                    PlaybackState.ACTION_PLAY_PAUSE or
                    PlaybackState.ACTION_STOP or
                    PlaybackState.ACTION_SEEK_TO or
                    PlaybackState.ACTION_FAST_FORWARD or
                    PlaybackState.ACTION_REWIND
                )
                // Android 13+ builds media controls from these custom actions;
                // next/previous are left out so the system shows them instead.
                .addCustomAction(
                    PlaybackState.CustomAction.Builder(CUSTOM_REWIND, "Rewind 10s", android.R.drawable.ic_media_rew).build()
                )
                .addCustomAction(
                    PlaybackState.CustomAction.Builder(CUSTOM_FORWARD, "Forward 10s", android.R.drawable.ic_media_ff).build()
                )
                .setState(
                    if (isPlaying) PlaybackState.STATE_PLAYING else PlaybackState.STATE_PAUSED,
                    currentPositionMs,
                    if (isPlaying) 1.0f else 0.0f
                )
            mediaSession?.setPlaybackState(stateBuilder.build())
        } catch (e: Exception) {
            VegaLog.w(TAG, "updatePlaybackState error: ${e.message}")
        }
    }

    private fun updateMediaSessionMetadata() {
        try {
            val metaBuilder = MediaMetadata.Builder()
                .putString(MediaMetadata.METADATA_KEY_TITLE, currentTitle)
                .putString(MediaMetadata.METADATA_KEY_ARTIST, currentSubtitle)
                .putLong(MediaMetadata.METADATA_KEY_DURATION, currentDurationMs)

            currentArtworkBitmap?.let {
                metaBuilder.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, it)
                metaBuilder.putBitmap(MediaMetadata.METADATA_KEY_ART, it)
            }
            mediaSession?.setMetadata(metaBuilder.build())
        } catch (e: Exception) {
            VegaLog.w(TAG, "updateMediaSessionMetadata error: ${e.message}")
        }
    }

    private fun loadArtworkAsync(url: String?) {
        if (url.isNullOrBlank()) {
            currentArtworkBitmap = null
            updateMediaSessionMetadata()
            updateNotification()
            return
        }
        Thread {
            try {
                val bitmap: Bitmap? = when {
                    url.startsWith("http://") || url.startsWith("https://") -> {
                        val req = Request.Builder().url(url).build()
                        httpClient.newCall(req).execute().use { resp ->
                            if (resp.isSuccessful) {
                                resp.body?.byteStream()?.let { BitmapFactory.decodeStream(it) }
                            } else null
                        }
                    }
                    url.startsWith("file://") -> {
                        BitmapFactory.decodeFile(Uri.parse(url).path)
                    }
                    url.startsWith("/") -> {
                        BitmapFactory.decodeFile(url)
                    }
                    else -> null
                }

                if (bitmap != null) {
                    currentArtworkBitmap = bitmap
                    updateMediaSessionMetadata()
                    updateNotification()
                }
            } catch (e: Exception) {
                VegaLog.w(TAG, "Artwork load failed: ${e.message}")
            }
        }.start()
    }

    private fun resolveNotificationIcon(): Int {
        val resId = resources.getIdentifier("ic_notification", "drawable", packageName)
        if (resId != 0) return resId
        return applicationInfo.icon
    }

    private fun buildNotification(): Notification {
        val iconRes = resolveNotificationIcon()
        val piFlags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }

        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)?.apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val contentPendingIntent = PendingIntent.getActivity(this, 0, launchIntent, piFlags)

        val playPauseIntent = Intent(this, RemoteDeliveryService::class.java).apply {
            action = if (isPlaying) ACTION_PAUSE else ACTION_PLAY
        }
        val playPausePendingIntent = PendingIntent.getService(this, 1, playPauseIntent, piFlags)

        val rewindIntent = Intent(this, RemoteDeliveryService::class.java).apply {
            action = ACTION_REWIND
        }
        val rewindPendingIntent = PendingIntent.getService(this, 2, rewindIntent, piFlags)

        val forwardIntent = Intent(this, RemoteDeliveryService::class.java).apply {
            action = ACTION_FORWARD
        }
        val forwardPendingIntent = PendingIntent.getService(this, 3, forwardIntent, piFlags)

        val stopIntent = Intent(this, RemoteDeliveryService::class.java).apply {
            action = ACTION_STOP_CAST
        }
        val stopPendingIntent = PendingIntent.getService(this, 4, stopIntent, piFlags)

        val playPauseAction = Notification.Action.Builder(
            if (isPlaying) android.R.drawable.ic_media_pause else android.R.drawable.ic_media_play,
            if (isPlaying) "Pause" else "Play",
            playPausePendingIntent
        ).build()

        val rewindAction = Notification.Action.Builder(
            android.R.drawable.ic_media_rew,
            "Rewind",
            rewindPendingIntent
        ).build()

        val forwardAction = Notification.Action.Builder(
            android.R.drawable.ic_media_ff,
            "Forward",
            forwardPendingIntent
        ).build()

        val stopAction = Notification.Action.Builder(
            android.R.drawable.ic_menu_close_clear_cancel,
            "Stop",
            stopPendingIntent
        ).build()

        val mediaStyle = Notification.MediaStyle()
            .setMediaSession(mediaSession?.sessionToken)
            .setShowActionsInCompactView(0, 1, 2)

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL_ID)
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
        }

        builder.setStyle(mediaStyle)
            .setSmallIcon(iconRes)
            .setContentTitle(if (currentTitle.isNotBlank()) currentTitle else "Vega Media")
            .setContentText(if (currentSubtitle.isNotBlank()) currentSubtitle else "Casting")
            .setContentIntent(contentPendingIntent)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setOngoing(isPlaying)
            .addAction(rewindAction)
            .addAction(playPauseAction)
            .addAction(forwardAction)
            .addAction(stopAction)

        currentArtworkBitmap?.let {
            builder.setLargeIcon(it)
        }

        return builder.build()
    }

    private fun stopForegroundService() {
        deliveryRuntime?.closeDelivery(activeGeneration.takeIf { it > 0L })
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE)
            } else {
                @Suppress("DEPRECATION")
                stopForeground(true)
            }
        } catch (e: Exception) {
            VegaLog.w(TAG, "stopForeground error: ${e.message}")
        }
        stopSelf()
    }

    override fun onDestroy() {
        super.onDestroy()
        mainHandler.removeCallbacksAndMessages(null)
        running = false
        deliveryRuntime?.closeDelivery(activeGeneration.takeIf { it > 0L })
        releaseLocks()

        try {
            mediaSession?.isActive = false
            mediaSession?.release()
        } catch (_: Exception) {}
        mediaSession = null
    }
}
