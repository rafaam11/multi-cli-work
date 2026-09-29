package com.rafaam11.multicliwork.mobile.core

import kotlinx.serialization.Serializable

/** PC가 /shell.json으로 알려주는 동봉 셸 APK. */
@Serializable
data class ShellRelease(val versionCode: Int, val versionName: String, val sha256: String)

object ShellReleases {
    fun newest(releases: List<ShellRelease?>): ShellRelease? = releases.filterNotNull().maxByOrNull { it.versionCode }

    fun updateFor(installedVersionCode: Int, releases: List<ShellRelease?>): ShellRelease? =
        newest(releases)?.takeIf { it.versionCode > installedVersionCode }
}
