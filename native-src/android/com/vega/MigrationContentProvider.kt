package com.vega

import android.content.ContentProvider
import android.content.ContentValues
import android.content.pm.PackageManager
import android.database.Cursor
import android.net.Uri
import android.os.Binder
import android.os.ParcelFileDescriptor
import android.os.Process
import java.io.File
import java.io.FileNotFoundException

class MigrationContentProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    override fun getType(uri: Uri): String? =
        if (uri.path == BACKUP_PATH) "application/json" else null

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") {
            throw SecurityException("Read-only migration provider")
        }
        val ctx = context ?: throw FileNotFoundException("Migration context unavailable")
        val callingUid = Binder.getCallingUid()
        if (callingUid != Process.myUid() &&
            ctx.packageManager.checkSignatures(Process.myUid(), callingUid) != PackageManager.SIGNATURE_MATCH
        ) {
            throw SecurityException("Caller signature does not match")
        }
        if (uri.path != BACKUP_PATH) {
            throw FileNotFoundException("Unknown migration path")
        }
        val file = File(ctx.filesDir, SNAPSHOT_FILE_NAME)
        if (!file.isFile || file.length() <= 0L) {
            throw FileNotFoundException("No migration snapshot available")
        }
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? {
        throw UnsupportedOperationException("Migration provider is read-only")
    }

    override fun update(
        uri: Uri,
        values: ContentValues?,
        selection: String?,
        selectionArgs: Array<out String>?,
    ): Int {
        throw UnsupportedOperationException("Migration provider is read-only")
    }

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int {
        throw UnsupportedOperationException("Migration provider is read-only")
    }

    companion object {
        const val SNAPSHOT_FILE_NAME = "vega_migration_snapshot.json"
        const val BACKUP_PATH = "/backup"
    }
}
