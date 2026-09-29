package com.rafaam11.multicliwork.mobile.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairUriTest {
    @Test
    fun parsesTheDesktopQr() {
        assertEquals(
            PairRequest(address = "100.101.102.103:47821", hostName = "내 PC & 노트북", code = "ABCDEFGH", hostId = "host-1"),
            PairUri.parse("mcw://pair?host=100.101.102.103:47821&name=%EB%82%B4%20PC%20%26%20%EB%85%B8%ED%8A%B8%EB%B6%81&code=ABCDEFGH&fp=host-1"),
        )
    }

    @Test
    fun defaultsTheNameAndTrimsWhitespace() {
        assertEquals("PC", PairUri.parse("  mcw://pair?host=100.64.0.1:47821&code=ABCDEFGH&fp=h  ")?.hostName)
    }

    @Test
    fun rejectsAnythingThatIsNotATailnetPairingQr() {
        listOf(
            "https://example.com",
            "mcw://other?host=100.64.0.1:47821&code=ABCDEFGH&fp=h",
            "mcw://pair?host=192.168.0.10:47821&code=ABCDEFGH&fp=h",
            "mcw://pair?host=100.128.0.1:47821&code=ABCDEFGH&fp=h",
            "mcw://pair?host=100.64.0.1:80&code=ABCDEFGH&fp=h",
            "mcw://pair?host=100.64.0.1&code=ABCDEFGH&fp=h",
            "mcw://pair?host=100.64.0.1:47821&code=&fp=h",
            "mcw://pair?host=100.64.0.1:47821&code=ABCDEFGH",
            "mcw://pair?host=100.64.0.1:47821&code=AB/../CD&fp=h",
            "not a uri at all %%%",
            "mcw://pair?host=100.64.010.1:47821&code=ABCDEFGH&fp=h",
            "mcw://pair?host=100.64.0.01:47821&code=ABCDEFGH&fp=h",
            "mcw://pair?host=100.64.0.1:%2B47821&code=ABCDEFGH&fp=h",
            "mcw://pair?host=100.64.0.1:047821&code=ABCDEFGH&fp=h",
            "mcw://pair?host=100.64.0.1:1023&code=ABCDEFGH&fp=h",
            "mcw://pair?host=100.64.0.1:65536&code=ABCDEFGH&fp=h",
            "mcw://pair?host=100.64.0.256:47821&code=ABCDEFGH&fp=h",
        ).forEach { assertNull(it, PairUri.parse(it)) }
    }

    @Test
    fun acceptsTheRangeBoundaries() {
        assertEquals("100.64.0.1:1024", PairUri.parse("mcw://pair?host=100.64.0.1:1024&code=ABCDEFGH&fp=h")?.address)
        assertEquals("100.127.255.255:65535", PairUri.parse("mcw://pair?host=100.127.255.255:65535&code=ABCDEFGH&fp=h")?.address)
    }
}
