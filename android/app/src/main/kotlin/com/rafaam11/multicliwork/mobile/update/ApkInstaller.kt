package com.rafaam11.multicliwork.mobile.update

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import java.io.File

object ApkInstaller {
    const val ACTION_RESULT = "com.rafaam11.multicliwork.mobile.INSTALL_RESULT"

    /**
     * PackageInstaller 세션으로 자기 자신을 업데이트한다. 이 앱이 직전 설치자이면 Android 12+는
     * 확인 없이 설치할 수 있고, 아니면 시스템 확인 화면이 한 번 뜬다(InstallResultReceiver가 띄운다).
     */
    fun install(context: Context, apk: File) {
        val installer = context.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(context.packageName)
            setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
        }
        val sessionId = installer.createSession(params)
        val session = installer.openSession(sessionId)
        try {
            session.openWrite("shell.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val intent = Intent(context, InstallResultReceiver::class.java).setAction(ACTION_RESULT)
            val pending = PendingIntent.getBroadcast(
                context,
                sessionId,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
            )
            session.commit(pending.intentSender)
        } catch (error: Throwable) {
            runCatching { session.abandon() }
            throw error
        } finally {
            session.close()
        }
    }
}
