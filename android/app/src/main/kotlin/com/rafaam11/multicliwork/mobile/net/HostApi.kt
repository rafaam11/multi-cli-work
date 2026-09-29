package com.rafaam11.multicliwork.mobile.net

import com.rafaam11.multicliwork.mobile.core.ShellRelease
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

@Serializable
data class PairResponse(val token: String, val deviceId: String, val hostId: String, val hostName: String)

class PairingException(message: String) : Exception(message)

/**
 * PC(데스크톱 multi-cli-work)의 인증 없는 HTTP 경로들. 세션 데이터는 WebView 안의 WS로만 흐르고,
 * 여기는 페어링과 셸 업데이트만 다룬다. 모두 블로킹이므로 IO 디스패처에서 부른다.
 */
class HostApi(private val timeoutMs: Int = 5_000) {
    private val json = Json { ignoreUnknownKeys = true }

    fun pair(address: String, code: String, deviceName: String): PairResponse {
        val connection = open("http://$address/pair")
        try {
            connection.requestMethod = "POST"
            connection.doOutput = true
            connection.setRequestProperty("content-type", "application/json")
            val body = buildJsonObject {
                put("code", code)
                put("deviceName", deviceName)
            }.toString()
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            return when (val status = connection.responseCode) {
                200 -> json.decodeFromString<PairResponse>(connection.inputStream.bufferedReader().readText())
                401 -> throw PairingException("코드가 맞지 않거나 만료되었습니다")
                429 -> throw PairingException("시도가 너무 많습니다. 잠시 후 다시 시도하세요")
                else -> throw PairingException("페어링에 실패했습니다 ($status)")
            }
        } finally {
            connection.disconnect()
        }
    }

    /** 동봉된 셸이 없거나 PC에 닿지 않으면 null — 업데이트 확인은 그 PC를 건너뛴다. */
    fun shellRelease(address: String): ShellRelease? = runCatching {
        val connection = open("http://$address/shell.json")
        try {
            if (connection.responseCode != 200) null
            else json.decodeFromString<ShellRelease>(connection.inputStream.bufferedReader().readText())
        } finally {
            connection.disconnect()
        }
    }.getOrNull()

    fun downloadApk(address: String, dest: File) {
        val connection = open("http://$address/shell.apk", readTimeoutMs = 60_000)
        try {
            if (connection.responseCode != 200) throw IOException("셸 APK를 받지 못했습니다 (${connection.responseCode})")
            connection.inputStream.use { input -> dest.outputStream().use { input.copyTo(it) } }
        } finally {
            connection.disconnect()
        }
    }

    private fun open(url: String, readTimeoutMs: Int = timeoutMs): HttpURLConnection =
        (URI(url).toURL().openConnection() as HttpURLConnection).apply {
            connectTimeout = timeoutMs
            readTimeout = readTimeoutMs
        }
}
