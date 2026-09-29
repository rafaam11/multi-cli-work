package com.rafaam11.multicliwork.mobile.update

import com.rafaam11.multicliwork.mobile.core.ShellRelease
import com.rafaam11.multicliwork.mobile.data.Host
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

class UpdateCheckTest {
    private fun host(id: String, address: String) = Host(id, id, address, "d", "t")
    private fun release(code: Int) = ShellRelease(code, "0.$code.0", "a".repeat(64))

    @Test
    fun picksTheHostWithTheNewestShell() {
        val releases = mapOf("100.64.0.1:1" to release(2), "100.64.0.2:1" to release(3), "100.64.0.3:1" to null)
        val check = UpdateCheck { releases[it] }
        val hosts = listOf(host("a", "100.64.0.1:1"), host("b", "100.64.0.2:1"), host("c", "100.64.0.3:1"))
        assertEquals(Candidate(hosts[1], release(3)), check.find(installedVersionCode = 1, hosts = hosts))
    }

    @Test
    fun nothingWhenInstalledIsCurrentOrNoHostHasAShell() {
        val hosts = listOf(host("a", "x"))
        assertNull(UpdateCheck { release(2) }.find(2, hosts))
        assertNull(UpdateCheck { null }.find(1, hosts))
        assertNull(UpdateCheck { release(9) }.find(1, emptyList()))
    }

    @Test
    fun sha256MismatchIsRejected() {
        val apk = File.createTempFile("shell", ".apk").apply { writeText("abc") }
        assertTrue(ApkVerifier.sha256Matches(apk, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"))
        assertFalse(ApkVerifier.sha256Matches(apk, "b".repeat(64)))
    }
}
