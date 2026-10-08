package com.rafaam11.multicliwork.mobile.notify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StatusTrackerTest {
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
    fun notifiesOnceUntilTheWaitEnds() {
        val tracker = tracker(SessionSummary("s1", "리팩터", "working"))
        tracker.receive(StatusMessage.Status("s1", "awaiting-input", null), always)
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
}
