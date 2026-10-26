package com.rafaam11.multicliwork.mobile.notify

import com.rafaam11.multicliwork.mobile.data.KeyValueStore
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@Serializable
data class Attention(val generation: Long, val seenThrough: Long)

@Serializable
private data class AlertState(val generation: Long = 0, val seenThrough: Long = -1, val severity: Int = 0, val status: String = "")

/** Durable budget; working/dismissal/disconnect are deliberately not acknowledgments. */
class AttentionLedger(private val store: KeyValueStore, hostId: String) {
    private val key = "attention/$hostId"
    private val json = Json { ignoreUnknownKeys = true }
    private var entries: Map<String, AlertState> = store.get(key)?.let { json.decodeFromString<Map<String, AlertState>>(it) } ?: emptyMap()
    private fun save(id: String, state: AlertState) {
        entries = entries + (id to state)
        store.put(key, json.encodeToString(entries))
    }
    fun observe(id: String, status: String, attention: Attention?) {
        if (attention != null) sync(id, attention)
        val previous = entries[id] ?: AlertState()
        val generation = if (attention == null && status != previous.status && severity(status) > 0) previous.generation + 1 else previous.generation
        save(id, previous.copy(generation = generation, status = status))
    }
    fun sync(id: String, attention: Attention) {
        val previous = entries[id] ?: AlertState()
        if (attention.generation < previous.generation) return
        val seen = maxOf(previous.seenThrough, attention.seenThrough)
        // A snapshot may contain a PC view followed by newer work while this phone was offline.
        // A late ack for an already-observed newer wait cannot reset that wait's budget.
        val reset = seen > previous.seenThrough && seen >= previous.generation
        save(id, previous.copy(generation = attention.generation, seenThrough = seen, severity = if (reset) 0 else previous.severity))
    }
    fun localSeen(id: String, observed: Long?) {
        val previous = entries[id] ?: return
        val generation = observed ?: previous.generation
        if (generation > previous.generation || generation < 0) return
        sync(id, Attention(previous.generation, generation))
    }
    fun legacySeen(id: String, displayedStatus: String): Boolean {
        if (entries[id]?.status != displayedStatus) return false
        localSeen(id, null)
        return isSeen(id)
    }
    fun isSeen(id: String): Boolean = entries[id]?.let { it.seenThrough >= it.generation } ?: false
    fun audible(id: String, status: String): Boolean = !isSeen(id) && severity(status) > (entries[id]?.severity ?: 0)
    fun posted(id: String, status: String) {
        val previous = entries[id] ?: return
        save(id, previous.copy(severity = maxOf(previous.severity, severity(status))))
    }
    fun remove(id: String) { entries = entries - id; store.put(key, json.encodeToString(entries)) }
    private fun severity(status: String) = when (status) {
        "awaiting-approval" -> 2
        "awaiting-input", "exited", "error" -> 1
        else -> 0
    }
}
