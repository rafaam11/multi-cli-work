package com.rafaam11.multicliwork.mobile.notify

import com.rafaam11.multicliwork.mobile.data.NotifySettings
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotifyPolicyTest {
    private val defaults = NotifySettings()

    private fun allowed(
        status: String,
        presence: String? = null,
        settings: NotifySettings = defaults,
        hostId: String = "h1",
        viewingHostId: String? = null,
    ) = NotifyPolicy.allowed(settings, hostId, status, presence, viewingHostId)

    @Test
    fun notifiesWaitingSessionsByDefaultButNotEndedOnes() {
        assertTrue(allowed("awaiting-input"))
        assertTrue(allowed("awaiting-approval"))
        assertFalse(allowed("exited"))
        assertFalse(allowed("error"))
        assertTrue(allowed("exited", settings = defaults.copy(includeEnded = true)))
        assertTrue(allowed("error", settings = defaults.copy(includeEnded = true)))
    }

    @Test
    fun skipsOnlyWhenSomeoneIsInFrontOfTheHostApp() {
        assertFalse(allowed("awaiting-input", presence = "focused"))
        assertTrue(allowed("awaiting-input", presence = "active"))
        assertTrue(allowed("awaiting-input", presence = "away"))
        assertTrue(allowed("awaiting-input", presence = "focused", settings = defaults.copy(skipWhenAtPc = false)))
    }

    @Test
    fun skipsWhatTheUserTurnedOffOrIsLookingAt() {
        assertFalse(allowed("awaiting-input", settings = defaults.copy(enabled = false)))
        assertFalse(allowed("awaiting-input", settings = defaults.copy(mutedHosts = setOf("h1"))))
        assertTrue(allowed("awaiting-input", settings = defaults.copy(mutedHosts = setOf("h2"))))
        assertFalse(allowed("awaiting-input", viewingHostId = "h1"))
        assertTrue(allowed("awaiting-input", viewingHostId = "h2"))
    }
}
