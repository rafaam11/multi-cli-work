package com.rafaam11.multicliwork.mobile.core

import java.net.URI
import java.net.URLDecoder

data class PairRequest(val address: String, val hostName: String, val code: String, val hostId: String)

/**
 * 데스크톱 설정 ▸ 원격 ▸ 기기 추가의 QR(`mcw://pair?host=&name=&code=&fp=`). 셸이 받는 주소는
 * Tailscale 대역(100.64.0.0/10)뿐이다 — 다른 QR로 엉뚱한 서버에 토큰을 받으러 가지 않게.
 */
object PairUri {
    private val TAILNET_IPV4 = Regex("""^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$""")
    private val PORT = Regex("""^[1-9]\d{3,4}$""")
    private val CODE = Regex("""^[A-Za-z0-9-]{8,9}$""")

    fun parse(raw: String): PairRequest? {
        val uri = runCatching { URI(raw.trim()) }.getOrNull() ?: return null
        if (uri.scheme != "mcw" || uri.host != "pair") return null
        val params = (uri.rawQuery ?: return null).split("&").mapNotNull { part ->
            val index = part.indexOf('=')
            if (index <= 0) null
            else part.substring(0, index) to runCatching { URLDecoder.decode(part.substring(index + 1), "UTF-8") }.getOrNull()
        }.filter { it.second != null }.associate { it.first to it.second!! }

        val address = params["host"] ?: return null
        val parts = address.split(":")
        if (parts.size != 2) return null
        val match = TAILNET_IPV4.matchEntire(parts[0]) ?: return null
        if (match.groupValues.drop(2).any { it.toInt() > 255 }) return null
        if (!PORT.matches(parts[1])) return null
        val port = parts[1].toIntOrNull() ?: return null
        if (port !in 1024..65535) return null

        val code = params["code"]?.takeIf { CODE.matches(it) } ?: return null
        val hostId = params["fp"]?.takeIf { it.isNotBlank() } ?: return null
        val hostName = params["name"]?.trim()?.takeIf { it.isNotEmpty() } ?: "PC"
        return PairRequest(address = address, hostName = hostName, code = code, hostId = hostId)
    }
}
