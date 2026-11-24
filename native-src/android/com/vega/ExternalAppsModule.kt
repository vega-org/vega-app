package com.vega

import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.util.Base64
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.*
import com.facebook.react.uimanager.ViewManager
import java.io.ByteArrayOutputStream

class ExternalAppsModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "ExternalApps"
    private fun intent(url: String, mime: String?): Intent = Intent(Intent.ACTION_VIEW).apply {
        if (mime == null) data = Uri.parse(url) else setDataAndType(Uri.parse(url), mime)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    @ReactMethod fun list(kind: String, promise: Promise) {
        try {
            val pm = context.packageManager
            val queries = if (kind == "player") listOf(intent("https://example.com/video.mp4", "video/*"), intent("content://media/external/video/media/1", "video/*"))
                else listOf(intent("https://example.com/file", "application/octet-stream"), intent("magnet:?xt=urn:btih:0000000000000000000000000000000000000000", null))
            val apps = queries.flatMap { pm.queryIntentActivities(it, PackageManager.MATCH_DEFAULT_ONLY) }
                .filter { it.activityInfo.packageName != context.packageName }.distinctBy { it.activityInfo.packageName }
                .sortedBy { it.loadLabel(pm).toString().lowercase() }
            val result = Arguments.createArray()
            for (app in apps) {
                val entry = Arguments.createMap()
                entry.putString("packageName", app.activityInfo.packageName)
                entry.putString("name", app.loadLabel(pm).toString())
                try {
                    val drawable = app.loadIcon(pm)
                    val bitmap = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888)
                    drawable.setBounds(0, 0, 64, 64); drawable.draw(Canvas(bitmap))
                    val bytes = ByteArrayOutputStream(); bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes); bitmap.recycle()
                    entry.putString("icon", "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP))
                } catch (_: Exception) {}
                result.pushMap(entry)
            }
            promise.resolve(result)
        } catch (error: Exception) { promise.reject("EXTERNAL_APPS", error.message, error) }
    }
    @ReactMethod fun open(url: String, mime: String?, target: String, headers: ReadableMap?, title: String?, promise: Promise) {
        UiThreadUtil.runOnUiThread {
            try {
                val request = intent(url, mime)
                if (target != "ask" && target != "none") request.setPackage(target)
                if (title != null) { request.putExtra("title", title); request.putExtra(Intent.EXTRA_TITLE, title) }
                if (headers != null) {
                    val bundle = android.os.Bundle()
                    val flattened = ArrayList<String>()
                    val keys = headers.keySetIterator()
                    while (keys.hasNextKey()) {
                        val key = keys.nextKey(); val value = headers.getString(key) ?: continue
                        bundle.putString(key, value); request.putExtra(key, value)
                        flattened.add(key); flattened.add(value)
                    }
                    request.putExtra("android.media.intent.extra.HTTP_HEADERS", bundle)
                    request.putExtra("headers", bundle)
                    request.putExtra("headers_array", flattened.toTypedArray())
                }
                val launch = if (target == "ask" || target == "none") Intent.createChooser(request, "Choose app") else request
                val activity = context.currentActivity
                if (activity != null) activity.startActivity(launch)
                else { launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK); context.startActivity(launch) }
                promise.resolve(null)
            } catch (error: Exception) { promise.reject("EXTERNAL_APP_UNAVAILABLE", "Selected app cannot open this link. Choose another app in Settings.", error) }
        }
    }
}
class ExternalAppsPackage : ReactPackage {
    override fun createNativeModules(context: ReactApplicationContext): List<NativeModule> = listOf(ExternalAppsModule(context))
    override fun createViewManagers(context: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
