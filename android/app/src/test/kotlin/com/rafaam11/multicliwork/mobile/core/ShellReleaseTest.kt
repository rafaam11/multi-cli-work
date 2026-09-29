package com.rafaam11.multicliwork.mobile.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ShellReleaseTest {
    private fun release(code: Int) = ShellRelease(code, "0.$code.0", "a".repeat(64))

    @Test
    fun picksTheNewestAcrossHostsAndIgnoresUnreachableOnes() {
        assertEquals(release(3), ShellReleases.newest(listOf(release(2), null, release(3), release(1))))
        assertNull(ShellReleases.newest(listOf(null, null)))
    }

    @Test
    fun offersAnUpdateOnlyWhenNewerThanInstalled() {
        assertEquals(release(3), ShellReleases.updateFor(2, listOf(release(3))))
        assertNull(ShellReleases.updateFor(3, listOf(release(3))))
        assertNull(ShellReleases.updateFor(4, listOf(release(3))))
    }
}
