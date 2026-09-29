package com.rafaam11.multicliwork.mobile.update

import android.content.Context
import android.content.pm.PackageManager
import com.rafaam11.multicliwork.mobile.core.Sha256
import java.io.File

object ApkVerifier {
    fun sha256Matches(apk: File, expected: String): Boolean =
        apk.inputStream().use { Sha256.hex(it) }.equals(expected, ignoreCase = true)

    /** 받은 파일의 versionCode가 PC가 알린 값과 같고, 설치본보다 새로울 때만 true. */
    fun versionAcceptable(archive: Long, advertised: Int, installed: Int): Boolean =
        archive == advertised.toLong() && archive > installed.toLong()

    /** 받은 APK 파일 안의 versionCode(읽지 못하면 null). */
    fun archiveVersionCode(context: Context, apk: File): Long? =
        context.packageManager.getPackageArchiveInfo(apk.path, 0)?.longVersionCode

    /** 받은 APK가 같은 패키지이고, 지금 설치된 셸과 같은 인증서로 서명됐는지. */
    @Suppress("DEPRECATION")
    fun sameSigner(context: Context, apk: File): Boolean {
        val pm = context.packageManager
        val archive = pm.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNING_CERTIFICATES) ?: return false
        if (archive.packageName != context.packageName) return false
        val installed = pm.getPackageInfo(context.packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        val theirs = archive.signingInfo?.apkContentsSigners?.toSet() ?: return false
        val ours = installed.signingInfo?.apkContentsSigners?.toSet() ?: return false
        return theirs.isNotEmpty() && theirs == ours
    }
}
