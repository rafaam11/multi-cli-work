package com.rafaam11.multicliwork.mobile.notify

import com.rafaam11.multicliwork.mobile.data.KeyValueStore
import org.junit.Assert.*
import org.junit.Test

class AttentionLedgerTest {
    @Test fun legacyViewingRequiresTheDisplayedStatusAndRearmsFutureWaits() {
        val ledger = AttentionLedger(Memory(), "old-host")
        ledger.observe("s", "awaiting-input", null)
        ledger.posted("s", "awaiting-input")
        ledger.observe("s", "awaiting-approval", null)
        assertFalse(ledger.legacySeen("s", "awaiting-input"))
        assertTrue(ledger.audible("s", "awaiting-approval"))
        assertTrue(ledger.legacySeen("s", "awaiting-approval"))
        assertFalse(ledger.audible("s", "awaiting-approval"))
        ledger.observe("s", "working", null)
        ledger.observe("s", "awaiting-input", null)
        assertTrue(ledger.audible("s", "awaiting-input"))
    }
    @Test fun approvalFirstConsumesBothLevelsUntilSeenAndLegacyPhoneViewsPersist() {
        val storage = Memory()
        val ledger = AttentionLedger(storage, "legacy")
        ledger.observe("s", "awaiting-approval", null)
        ledger.posted("s", "awaiting-approval")
        ledger.observe("s", "awaiting-input", null)
        assertFalse(ledger.audible("s", "awaiting-input"))
        ledger.observe("s", "awaiting-approval", null)
        assertFalse(ledger.audible("s", "awaiting-approval"))
        ledger.localSeen("s", null)
        val restarted = AttentionLedger(storage, "legacy")
        restarted.observe("s", "awaiting-approval", null)
        assertFalse(restarted.audible("s", "awaiting-approval"))
        restarted.observe("s", "working", null)
        restarted.observe("s", "awaiting-input", null)
        assertTrue(restarted.audible("s", "awaiting-input"))
    }
    private class Memory : KeyValueStore {
        val values = mutableMapOf<String, String>()
        override fun get(key: String) = values[key]
        override fun put(key: String, value: String?) { if (value == null) values.remove(key) else values[key] = value }
    }
    @Test fun inputOnceApprovalEscalatesAndWorkingDoesNotRearmAcrossRestart() {
        val storage = Memory()
        val ledger = AttentionLedger(storage, "h")
        ledger.observe("s", "awaiting-input", Attention(1, 0))
        assertTrue(ledger.audible("s", "awaiting-input"))
        ledger.posted("s", "awaiting-input")
        ledger.observe("s", "working", Attention(1, 0))
        val restarted = AttentionLedger(storage, "h")
        restarted.observe("s", "awaiting-input", Attention(2, 0))
        assertFalse(restarted.audible("s", "awaiting-input"))
        assertTrue(restarted.audible("s", "awaiting-approval"))
        restarted.posted("s", "awaiting-approval")
        assertFalse(restarted.audible("s", "awaiting-approval"))
        assertFalse(restarted.audible("s", "error"))
    }
    @Test fun staleSeenCannotCancelOrRearmANewerWaitButCurrentSeenRearmsFutureOnly() {
        val ledger = AttentionLedger(Memory(), "h")
        ledger.observe("s", "awaiting-input", Attention(1, 0))
        ledger.posted("s", "awaiting-input")
        ledger.observe("s", "awaiting-input", Attention(2, 0))
        ledger.sync("s", Attention(2, 1))
        assertFalse(ledger.isSeen("s"))
        assertFalse(ledger.audible("s", "awaiting-input"))
        ledger.sync("s", Attention(2, 2))
        assertTrue(ledger.isSeen("s"))
        assertFalse(ledger.audible("s", "awaiting-input"))
        ledger.observe("s", "awaiting-input", Attention(3, 2))
        assertTrue(ledger.audible("s", "awaiting-input"))
    }
    @Test fun offlinePcSeenRearmsAndHostsStayIsolatedAndUnpostedNoticesDoNotConsumeBudget() {
        val storage = Memory()
        val first = AttentionLedger(storage, "h1")
        first.observe("s", "awaiting-approval", Attention(1, 0))
        first.posted("s", "awaiting-approval")
        val second = AttentionLedger(storage, "h2")
        second.observe("s", "awaiting-input", Attention(1, 0))
        assertTrue(second.audible("s", "awaiting-input"))
        assertTrue(second.audible("s", "awaiting-input"))
        val restarted = AttentionLedger(storage, "h1")
        restarted.observe("s", "awaiting-input", Attention(4, 3))
        assertTrue(restarted.audible("s", "awaiting-input"))
    }
}
