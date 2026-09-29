package com.rafaam11.multicliwork.mobile.update

import com.rafaam11.multicliwork.mobile.core.ShellRelease
import com.rafaam11.multicliwork.mobile.data.Host

data class Candidate(val host: Host, val release: ShellRelease)

/** 등록된 PC들이 동봉한 셸 중 가장 새 것을, 설치본보다 새로울 때만 고른다(스펙 §8.3-1). */
class UpdateCheck(private val fetch: (address: String) -> ShellRelease?) {
    fun find(installedVersionCode: Int, hosts: List<Host>): Candidate? =
        hosts.mapNotNull { host -> fetch(host.address)?.let { Candidate(host, it) } }
            .maxByOrNull { it.release.versionCode }
            ?.takeIf { it.release.versionCode > installedVersionCode }
}
