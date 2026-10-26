package com.rafaam11.multicliwork.mobile.notify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StatusTrackerTest {
    @Test fun endedNoticeUsesOrdinaryBudgetAndSurvivesTheFollowingExitEvent() {
        val tracker = tracker(SessionSummary("s1", "종료 테스트", "working"))
        val notice = tracker.receive(StatusMessage.Status("s1", "exited", null, Attention(1, 0)), always)!!
        assertEquals(true, notice.audible)
        tracker.posted(notice)
        tracker.receive(StatusMessage.Exit("s1"), always)
        assertEquals(emptyList<String>(), tracker.resolved)
        assertEquals(false, tracker.receive(StatusMessage.Status("s1", "error", null, Attention(2, 0)), always)?.audible)
    }
    private val always: (String, String?) -> Boolean = { _, _ -> true }

    private fun tracker(vararg sessions: SessionSummary) = StatusTracker().apply {
        receive(StatusMessage.Sessions(sessions.toList()), always)
    }

    @Test
    fun doesNotNotifyForSessionsAlreadyWaitingWhenItConnects() {
        val tracker = StatusTracker()
        assertNull(tracker.receive(StatusMessage.Sessions(listOf(SessionSummary("s1", "리팩터", "awaiting-input"))), always))
        assertEquals(1, tracker.awaiting)
    }

    @Test
    fun notifiesWhenASessionStartsWaiting() {
        val tracker = tracker(SessionSummary("s1", "리팩터", "working"))
        assertEquals(
            SessionNotice("s1", "리팩터", "awaiting-input"),
            tracker.receive(StatusMessage.Status("s1", "awaiting-input", null), always),
        )
        assertEquals(1, tracker.awaiting)
    }

    @Test
    fun updatesSilentlyAcrossWorkAndRearmsOnlyAfterViewing() {
        val tracker = tracker(SessionSummary("s1", "리팩터", "working"))
        tracker.posted(tracker.receive(StatusMessage.Status("s1", "awaiting-input", null), always)!!)
        assertEquals(false, tracker.receive(StatusMessage.Status("s1", "awaiting-input", null), always)?.audible)
        tracker.receive(StatusMessage.Status("s1", "working", null), always)
        assertEquals(listOf("s1"), tracker.resolved)
        assertEquals(false, tracker.receive(StatusMessage.Status("s1", "awaiting-input", null), always)?.audible)
        tracker.viewed("s1", null)
        assertNull(tracker.receive(StatusMessage.Status("s1", "awaiting-input", null), always))
        tracker.receive(StatusMessage.Status("s1", "working", null), always)
        assertEquals(
            SessionNotice("s1", "리팩터", "awaiting-input"),
            tracker.receive(StatusMessage.Status("s1", "awaiting-input", null), always),
        )
    }

    @Test
    fun aSkippedNoticeDoesNotCountAsShown() {
        val tracker = tracker(SessionSummary("s1", "리팩터", "working"))
        assertNull(tracker.receive(StatusMessage.Status("s1", "awaiting-input", "focused")) { _, presence -> presence != "focused" })
        assertEquals(
            SessionNotice("s1", "리팩터", "awaiting-input"),
            tracker.receive(StatusMessage.Status("s1", "awaiting-input", "away"), always),
        )
    }

    @Test
    fun followsTitleChangesForTheLabel() {
        val tracker = tracker(SessionSummary("s1", "리팩터", "working"))
        tracker.receive(StatusMessage.Title("s1", "테스트 작성"), always)
        assertEquals("테스트 작성", tracker.receive(StatusMessage.Status("s1", "awaiting-approval", null), always)?.label)
    }

    @Test
    fun forgetsRemovedSessionsSoAReusedIdNotifiesAgain() {
        val tracker = tracker(SessionSummary("s1", "리팩터", "working"))
        tracker.receive(StatusMessage.Status("s1", "awaiting-input", null), always)
        tracker.receive(StatusMessage.Removed("s1"), always)
        tracker.receive(StatusMessage.Created(SessionSummary("s1", "리팩터", "working")), always)
        assertEquals(
            SessionNotice("s1", "리팩터", "awaiting-input"),
            tracker.receive(StatusMessage.Status("s1", "awaiting-input", null), always),
        )
    }

    @Test
    fun forgetsTheListWhileDisconnected() {
        val tracker = tracker(SessionSummary("s1", "리팩터", "awaiting-input"))
        tracker.disconnected()
        assertEquals(0, tracker.awaiting)
    }

    @Test fun snapshotAndSeenCancelOnlyTheObservedWait() {
        val tracker = tracker(SessionSummary("s1", "리팩터", "working", attention = Attention(0, 0)))
        tracker.posted(tracker.receive(StatusMessage.Status("s1", "awaiting-input", null, Attention(1, 0)), always)!!)
        tracker.receive(StatusMessage.Status("s1", "awaiting-input", null, Attention(2, 0)), always)
        tracker.receive(StatusMessage.Seen("s1", Attention(2, 1)), always)
        assertEquals(emptyList<String>(), tracker.resolved)
        tracker.disconnected()
        assertNull(tracker.receive(StatusMessage.Sessions(listOf(SessionSummary("s1", "리팩터", "awaiting-input", attention = Attention(2, 2)))), always))
        assertEquals(listOf("s1"), tracker.resolved)
    }
}
