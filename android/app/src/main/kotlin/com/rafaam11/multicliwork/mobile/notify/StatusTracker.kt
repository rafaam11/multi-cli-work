package com.rafaam11.multicliwork.mobile.notify

import com.rafaam11.multicliwork.mobile.data.KeyValueStore

data class SessionNotice(val sessionId: String, val label: String, val status: String,
    val audible: Boolean = true, val projectName: String? = null, val cwd: String? = null,
    val kind: String? = null, val worktreeBranch: String? = null)

private val NOTIFIABLE = setOf("awaiting-input", "awaiting-approval", "exited", "error")
fun isWaiting(status: String) = status == "awaiting-input" || status == "awaiting-approval"

private class MemoryStore : KeyValueStore {
    private val values = mutableMapOf<String, String>()
    override fun get(key: String) = values[key]
    override fun put(key: String, value: String?) { if (value == null) values.remove(key) else values[key] = value }
}

/** Snapshots synchronize seen state without alerting backlog. Posting success consumes sound. */
class StatusTracker(private val ledger: AttentionLedger = AttentionLedger(MemoryStore(), "test")) {
    private var sessions: List<SessionSummary> = emptyList()
    val resolved = mutableListOf<String>()
    val awaiting: Int get() = sessions.count { isWaiting(it.status) }
    fun receive(message: StatusMessage, allowed: (status: String, presence: String?) -> Boolean): SessionNotice? {
        resolved.clear()
        when (message) {
            is StatusMessage.Sessions -> {
                val known = message.sessions.map { it.id }.toSet()
                sessions.filter { it.id !in known }.forEach { ledger.remove(it.id); resolved.add(it.id) }
                sessions = message.sessions
                sessions.forEach { session ->
                    ledger.observe(session.id, session.status, session.attention)
                    if (ledger.isSeen(session.id) || session.status !in NOTIFIABLE) resolved.add(session.id)
                }
            }
            is StatusMessage.Created -> {
                sessions = sessions.filterNot { it.id == message.session.id } + message.session
                ledger.observe(message.session.id, message.session.status, message.session.attention)
            }
            is StatusMessage.Removed -> {
                sessions = sessions.filterNot { it.id == message.sessionId }
                ledger.remove(message.sessionId)
                resolved.add(message.sessionId)
            }
            is StatusMessage.Seen -> {
                ledger.sync(message.sessionId, message.attention)
                if (ledger.isSeen(message.sessionId)) resolved.add(message.sessionId)
            }
            is StatusMessage.Status -> {
                ledger.observe(message.sessionId, message.status, message.attention)
                sessions = sessions.map { if (it.id == message.sessionId) it.copy(status = message.status, attention = message.attention ?: it.attention) else it }
                if (message.status !in NOTIFIABLE || ledger.isSeen(message.sessionId)) {
                    resolved.add(message.sessionId)
                    return null
                }
                if (!allowed(message.status, message.presence)) {
                    if (!isWaiting(message.status)) resolved.add(message.sessionId)
                    return null
                }
                val session = sessions.firstOrNull { it.id == message.sessionId }
                return SessionNotice(message.sessionId, session?.label ?: "세션", message.status,
                    ledger.audible(message.sessionId, message.status), session?.projectName, session?.cwd, session?.kind, session?.worktreeBranch)
            }
            is StatusMessage.Title -> sessions = sessions.map { if (it.id == message.sessionId) it.copy(label = message.title) else it }
            is StatusMessage.Exit -> {
                if (sessions.firstOrNull { it.id == message.sessionId }?.status !in setOf("exited", "error")) resolved.add(message.sessionId)
                sessions = sessions.map { if (it.id == message.sessionId) it.copy(status = "exited") else it }
            }
            is StatusMessage.Welcome -> Unit
        }
        return null
    }
    fun posted(notice: SessionNotice) { if (notice.audible) ledger.posted(notice.sessionId, notice.status) }
    fun viewed(sessionId: String, generation: Long?): Boolean {
        ledger.localSeen(sessionId, generation)
        return ledger.isSeen(sessionId)
    }
    fun viewedLegacy(sessionId: String, status: String): Boolean = ledger.legacySeen(sessionId, status)
    fun disconnected() { sessions = emptyList() }
}
