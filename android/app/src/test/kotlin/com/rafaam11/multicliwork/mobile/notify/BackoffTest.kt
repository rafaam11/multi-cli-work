package com.rafaam11.multicliwork.mobile.notify

import org.junit.Assert.assertEquals
import org.junit.Test

class BackoffTest {
    @Test
    fun waitsLongerEachTimeUpToAMinuteAndStartsOverAfterReset() {
        val backoff = Backoff()
        assertEquals(listOf(1_000L, 2_000L, 5_000L, 10_000L, 30_000L, 60_000L, 60_000L), List(7) { backoff.next() })
        backoff.reset()
        assertEquals(1_000L, backoff.next())
    }
}
