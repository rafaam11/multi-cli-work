package com.rafaam11.multicliwork.mobile.net

import com.rafaam11.multicliwork.mobile.core.ShellRelease
import com.sun.net.httpserver.HttpServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.net.InetSocketAddress

class HostApiTest {
    private lateinit var server: HttpServer
    private lateinit var address: String
    private var lastPairBody = ""

    @Before
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/pair") { exchange ->
            lastPairBody = exchange.requestBody.bufferedReader().readText()
            val (status, body) = when {
                lastPairBody.contains("\"GOOD\"") -> 200 to """{"token":"t","deviceId":"d","hostId":"h","hostName":"PC","extra":1}"""
                lastPairBody.contains("\"BUSY\"") -> 429 to "busy"
                else -> 401 to "nope"
            }
            val bytes = body.toByteArray()
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.createContext("/shell.json") { exchange ->
            val bytes = """{"versionCode":2,"versionName":"0.2.0","sha256":"${"a".repeat(64)}"}""".toByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.createContext("/shell.apk") { exchange ->
            val bytes = "APK".toByteArray()
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.start()
        address = "127.0.0.1:${server.address.port}"
    }

    @After
    fun stop() = server.stop(0)

    @Test
    fun pairsAndIgnoresUnknownFields() {
        assertEquals(PairResponse("t", "d", "h", "PC"), HostApi().pair(address, "GOOD", "내 폰"))
        assertTrue(lastPairBody.contains("\"deviceName\":\"내 폰\""))
    }

    @Test
    fun explainsPairingFailuresInKorean() {
        assertEquals("코드가 맞지 않거나 만료되었습니다", assertThrows(PairingException::class.java) { HostApi().pair(address, "BAD", "x") }.message)
        assertEquals("시도가 너무 많습니다. 잠시 후 다시 시도하세요", assertThrows(PairingException::class.java) { HostApi().pair(address, "BUSY", "x") }.message)
    }

    @Test
    fun readsTheShellReleaseAndDownloadsTheApk() {
        assertEquals(ShellRelease(2, "0.2.0", "a".repeat(64)), HostApi().shellRelease(address))
        val dest = File.createTempFile("shell", ".apk")
        HostApi().downloadApk(address, dest)
        assertEquals("APK", dest.readText())
    }

    @Test
    fun shellReleaseReturnsNullOn404OrUnreachable() {
        server.removeContext("/shell.json")
        assertNull(HostApi().shellRelease(address))
        assertNull(HostApi(timeoutMs = 500).shellRelease("127.0.0.1:1"))
    }
}
