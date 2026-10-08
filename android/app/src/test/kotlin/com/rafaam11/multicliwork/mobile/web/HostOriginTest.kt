package com.rafaam11.multicliwork.mobile.web

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HostOriginTest {
    @Test
    fun keepsTheWebViewOnTheHost() {
        val address = "100.64.0.1:47821"
        assertEquals("http://100.64.0.1:47821/mobile/", HostOrigin.startUrl(address))
        assertTrue(HostOrigin.isInside(address, "http://100.64.0.1:47821/mobile/"))
        assertTrue(HostOrigin.isInside(address, "http://100.64.0.1:47821/install"))
        assertFalse(HostOrigin.isInside(address, "http://100.64.0.1:47822/mobile/"))
        assertFalse(HostOrigin.isInside(address, "http://100.64.0.1:47821.evil.example/"))
        assertFalse(HostOrigin.isInside(address, "https://github.com/"))
        assertFalse(HostOrigin.isInside(address, "javascript:alert(1)"))
    }

    @Test
    fun linksToOneSessionSoATappedNotificationOpensIt() {
        assertEquals(
            "http://100.64.0.1:47821/mobile/#session=s%201&n=7",
            HostOrigin.sessionUrl("100.64.0.1:47821", "s 1", 7),
        )
    }
}
