package com.rafaam11.multicliwork.mobile.notify

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StatusMessagesTest {
    @Test
    fun readsTheMessagesTheStatusLinkNeeds() {
        assertEquals(
            StatusMessage.Sessions(listOf(SessionSummary("s1", "리팩터", "working", projectName = "A", kind = "claude"))),
            StatusMessages.parse(
                """{"type":"sessions","sessions":[{"id":"s1","projectId":"p","projectName":"A","kind":"claude","label":"리팩터","status":"working","updatedAt":"1"}]}""",
            ),
        )
        assertEquals(
            StatusMessage.Status("s1", "awaiting-input", "focused"),
            StatusMessages.parse("""{"type":"status","sessionId":"s1","status":"awaiting-input","presence":"focused"}"""),
        )
        assertEquals(StatusMessage.Title("s1", "새 제목"), StatusMessages.parse("""{"type":"title","sessionId":"s1","title":"새 제목"}"""))
        assertEquals(StatusMessage.Exit("s1"), StatusMessages.parse("""{"type":"exit","sessionId":"s1","exitCode":0}"""))
        assertEquals(StatusMessage.Removed("s1"), StatusMessages.parse("""{"type":"removed","sessionId":"s1"}"""))
        assertEquals(
            StatusMessage.Created(SessionSummary("s2", "새 세션", "starting")),
            StatusMessages.parse("""{"type":"created","session":{"id":"s2","label":"새 세션","status":"starting"}}"""),
        )
        assertEquals(
            StatusMessage.Welcome("회사PC"),
            StatusMessages.parse("""{"type":"welcome","hostId":"h","hostName":"회사PC","deviceId":"d","protocolVersion":1,"shellLatest":null}"""),
        )
    }

    @Test
    fun treatsAMissingPresenceAsUnknown() {
        // v1.36 이하 호스트는 presence를 싣지 않는다.
        assertEquals(
            StatusMessage.Status("s1", "awaiting-approval", null),
            StatusMessages.parse("""{"type":"status","sessionId":"s1","status":"awaiting-approval"}"""),
        )
    }

    @Test fun readsOptionalContextAndSeenSyncWithoutAcceptingInvalidClocks() {
        assertEquals(StatusMessage.Welcome("PC", true), StatusMessages.parse("""{"type":"welcome","hostName":"PC","capabilities":["session-seen-v1"]}"""))
        assertEquals(StatusMessage.Seen("s", Attention(4, 3)), StatusMessages.parse("""{"type":"seen","sessionId":"s","attention":{"generation":4,"seenThrough":3}}"""))
        assertNull(StatusMessages.parse("""{"type":"seen","sessionId":"s","attention":{"generation":1,"seenThrough":2}}"""))
        val workspace = StatusMessages.parse("""{"type":"workspace","session":{"id":"s","label":"제목","status":"working","projectName":"P","cwd":"/repo/feature","kind":"codex","worktreeBranch":"feat/x","attention":{"generation":4,"seenThrough":3}}}""") as StatusMessage.Created
        assertEquals("/repo/feature", workspace.session.cwd)
        assertEquals("feat/x", workspace.session.worktreeBranch)
        assertEquals(Attention(4, 3), workspace.session.attention)
    }

    @Test
    fun ignoresWhatItDoesNotUse() {
        assertNull(StatusMessages.parse("""{"type":"data","sessionId":"s1","data":"x","sequence":1}"""))
        assertNull(StatusMessages.parse("""{"type":"someday"}"""))
        assertNull(StatusMessages.parse("""{"type":"status","sessionId":"s1"}"""))
        assertNull(StatusMessages.parse("not json"))
        assertNull(StatusMessages.parse("[1,2]"))
    }
}
