package com.rafaam11.multicliwork.mobile.notify

/** 띄울 세션 알림 하나. */
data class SessionNotice(val sessionId: String, val label: String, val status: String)

private val NOTIFIABLE = setOf("awaiting-input", "awaiting-approval", "exited", "error")
private val WAITING = setOf("awaiting-input", "awaiting-approval")

fun isWaiting(status: String) = status in WAITING

/**
 * 호스트 하나의 세션 목록과 알림 판단. 데스크톱의 HostStatusLink(src/main/remote-client/host-status-link.ts)와
 * 같은 규칙이다.
 * - 상태가 바뀌는 메시지에서만 알린다. 연결할 때 받는 목록에 이미 기다리는 세션이 있어도 알리지 않는다 —
 *   재연결할 때마다 알림이 쏟아지지 않게.
 * - 같은 세션의 같은 상태는 한 번만 알린다. 기다림이 풀리면 다음 기다림은 새 알림이다.
 * - 지금 알릴 수 없어 건너뛴 것은 알린 것으로 치지 않는다.
 */
class StatusTracker {
    private var sessions: List<SessionSummary> = emptyList()
    private val lastNotified = mutableMapOf<String, String>()

    /** 지금 입력·승인을 기다리는 세션 수. */
    val awaiting: Int get() = sessions.count { isWaiting(it.status) }

    /**
     * 메시지를 반영하고, 띄울 알림이 있으면 돌려준다. [allowed]는 (상태, presence)로 지금 알려도 되는지 답한다.
     */
    fun receive(message: StatusMessage, allowed: (status: String, presence: String?) -> Boolean): SessionNotice? {
        // 목록에 반영하기 전에 판단한다 — 라벨은 그 세션이 알려진 이름이다.
        val notice = (message as? StatusMessage.Status)?.let { statusChanged(it, allowed) }
        val before = sessions
        sessions = apply(before, message)
        if (message is StatusMessage.Sessions || message is StatusMessage.Removed) {
            val known = sessions.mapTo(HashSet()) { it.id }
            for (session in before) if (session.id !in known) lastNotified.remove(session.id)
        }
        return notice
    }

    /** 끊긴 동안의 일은 모른다. 다시 붙으면 호스트가 목록을 새로 준다. */
    fun disconnected() {
        sessions = emptyList()
    }

    private fun statusChanged(message: StatusMessage.Status, allowed: (String, String?) -> Boolean): SessionNotice? {
        if (message.status !in NOTIFIABLE) {
            lastNotified.remove(message.sessionId)
            return null
        }
        if (!allowed(message.status, message.presence)) return null
        if (lastNotified[message.sessionId] == message.status) return null
        lastNotified[message.sessionId] = message.status
        val label = sessions.firstOrNull { it.id == message.sessionId }?.label ?: "세션"
        return SessionNotice(message.sessionId, label, message.status)
    }

    private fun apply(sessions: List<SessionSummary>, message: StatusMessage): List<SessionSummary> = when (message) {
        is StatusMessage.Sessions -> message.sessions
        is StatusMessage.Created ->
            if (sessions.any { it.id == message.session.id }) sessions.map { if (it.id == message.session.id) message.session else it }
            else sessions + message.session
        is StatusMessage.Removed -> sessions.filterNot { it.id == message.sessionId }
        is StatusMessage.Status -> sessions.map { if (it.id == message.sessionId) it.copy(status = message.status) else it }
        is StatusMessage.Title -> sessions.map { if (it.id == message.sessionId) it.copy(label = message.title) else it }
        is StatusMessage.Exit -> sessions.map { if (it.id == message.sessionId) it.copy(status = "exited") else it }
        is StatusMessage.Welcome -> sessions
    }
}
