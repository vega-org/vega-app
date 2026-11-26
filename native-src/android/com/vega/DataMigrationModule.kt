package com.vega

import android.net.Uri
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.Executors

class DataMigrationModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {
    private val ioExecutor = Executors.newSingleThreadExecutor()

    override fun getName() = "VegaDataMigration"

    override fun getConstants(): Map<String, Any> = mapOf(
        "packageName" to context.packageName,
        "legacyPackageName" to LEGACY_PACKAGE_NAME,
    )

    @ReactMethod
    fun writeMigrationSnapshot(content: String, promise: Promise) {
        ioExecutor.execute {
            val target = File(context.filesDir, MigrationContentProvider.SNAPSHOT_FILE_NAME)
            val temp = File(context.filesDir, "${MigrationContentProvider.SNAPSHOT_FILE_NAME}.tmp")
            try {
                val bytes = content.toByteArray(Charsets.UTF_8)
                FileOutputStream(temp).use { output ->
                    output.write(bytes)
                    output.flush()
                    output.fd.sync()
                }
                if (!temp.renameTo(target)) {
                    if (target.exists()) {
                        target.delete()
                    }
                    if (!temp.renameTo(target)) {
                        throw IOException("Unable to finalize migration snapshot")
                    }
                }
                promise.resolve(true)
            } catch (error: Exception) {
                temp.delete()
                promise.reject("MIGRATION_WRITE_FAILED", "Failed to write migration snapshot", error)
            }
        }
    }

    @ReactMethod
    fun clearMigrationSnapshot(promise: Promise) {
        ioExecutor.execute {
            try {
                val target = File(context.filesDir, MigrationContentProvider.SNAPSHOT_FILE_NAME)
                val temp = File(context.filesDir, "${MigrationContentProvider.SNAPSHOT_FILE_NAME}.tmp")
                if (target.exists() && !target.delete()) {
                    throw IOException("Unable to delete migration snapshot")
                }
                if (temp.exists()) {
                    temp.delete()
                }
                promise.resolve(true)
            } catch (error: Exception) {
                promise.reject("MIGRATION_CLEAR_FAILED", "Failed to clear migration snapshot", error)
            }
        }
    }

    @ReactMethod
    fun hasLegacyMigrationSnapshot(promise: Promise) {
        ioExecutor.execute {
            if (context.packageName == LEGACY_PACKAGE_NAME) {
                promise.resolve(false)
                return@execute
            }
            try {
                val pfd = context.contentResolver.openFileDescriptor(LEGACY_BACKUP_URI, "r")
                if (pfd != null) {
                    pfd.use {
                        promise.resolve(it.statSize != 0L)
                    }
                } else {
                    promise.resolve(false)
                }
            } catch (_: Exception) {
                promise.resolve(false)
            }
        }
    }

    @ReactMethod
    fun readLegacyMigrationSnapshot(promise: Promise) {
        ioExecutor.execute {
            if (context.packageName == LEGACY_PACKAGE_NAME) {
                promise.resolve(null)
                return@execute
            }
            try {
                val stream = context.contentResolver.openInputStream(LEGACY_BACKUP_URI)
                if (stream == null) {
                    promise.resolve(null)
                    return@execute
                }
                val content = stream.use { input ->
                    val buffer = ByteArrayOutputStream()
                    val chunk = ByteArray(16 * 1024)
                    var totalBytes = 0
                    while (true) {
                        val read = input.read(chunk)
                        if (read < 0) break
                        totalBytes += read
                        if (totalBytes > MAX_SNAPSHOT_BYTES) {
                            throw IOException("Migration snapshot exceeds size limit")
                        }
                        buffer.write(chunk, 0, read)
                    }
                    buffer.toString(Charsets.UTF_8.name())
                }
                promise.resolve(content.takeIf { it.isNotBlank() })
            } catch (_: FileNotFoundException) {
                promise.resolve(null)
            } catch (_: SecurityException) {
                promise.resolve(null)
            } catch (_: IllegalArgumentException) {
                promise.resolve(null)
            } catch (error: Exception) {
                promise.reject("MIGRATION_READ_FAILED", "Failed to read migration snapshot", error)
            }
        }
    }

    override fun invalidate() {
        ioExecutor.shutdown()
        super.invalidate()
    }

    companion object {
        private const val LEGACY_PACKAGE_NAME = "com.vega"
        private const val LEGACY_AUTHORITY = "com.vega.migration"
        private val LEGACY_BACKUP_URI: Uri =
            Uri.parse("content://$LEGACY_AUTHORITY${MigrationContentProvider.BACKUP_PATH}")
        private const val MAX_SNAPSHOT_BYTES = 50 * 1024 * 1024
    }
}
