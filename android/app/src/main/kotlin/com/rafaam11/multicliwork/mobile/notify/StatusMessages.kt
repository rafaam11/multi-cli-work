package com.rafaam11.multicliwork.mobile.notify

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/** 세션 목록에서 알림에 필요한 것만. 호스트의 RemoteSessionSummary에서 골라 읽는다. */
data class SessionSummary(val id: String, val label: String, val status: String)

/** 상태 연결이 쓰는 호스트 메시지(src/shared/remote-types.ts의 RemoteServerMessage 일부). */
sealed interface StatusMessage {
    data class Welcome(val hostName: String) : StatusMessage
    data class Sessions(val sessions: List<SessionSummary>) : StatusMessage
    /** presence는 v1.37.0 호스트부터 온다. 없으면 null. */
    data class Status(val sessionId: String, val status: String, val presence: String?) : StatusMessage
    data class Title(val sessionId: String, val title: String) : StatusMessage
    data class Exit(val sessionId: String) : StatusMessage
    data class Created(val session: SessionSummary) : StatusMessage
    data class Removed(val sessionId: String) : StatusMessage
}

/**
 * 호스트 메시지 해석. 서버 메시지는 추가만 되므로(remote-types.ts의 버전 규칙) 모르는 type과 필드는
 * 버린다. 쓰지 않는 메시지(터미널 출력 등)와 깨진 메시지는 null이다.
 */
object StatusMessages {
    private val json = Json { ignoreUnknownKeys = true }

    fun parse(raw: String): StatusMessage? {
        val value = runCatching { json.parseToJsonElement(raw) }.getOrNull() as? JsonObject ?: return null
        return when (value.text("type")) {
            "welcome" -> value.text("hostName")?.let(StatusMessage::Welcome)
            "sessions" -> (value["sessions"] as? JsonArray)?.let { list ->
                StatusMessage.Sessions(list.mapNotNull { (it as? JsonObject)?.let(::summary) })
            }
            "status" -> {
                val sessionId = value.text("sessionId") ?: return null
                val status = value.text("status") ?: return null
                StatusMessage.Status(sessionId, status, value.text("presence"))
            }
            "title" -> {
                val sessionId = value.text("sessionId") ?: return null
                StatusMessage.Title(sessionId, value.text("title") ?: return null)
            }
            "exit" -> value.text("sessionId")?.let(StatusMessage::Exit)
            "created" -> (value["session"] as? JsonObject)?.let(::summary)?.let(StatusMessage::Created)
            "removed" -> value.text("sessionId")?.let(StatusMessage::Removed)
            else -> null
        }
    }

    private fun summary(value: JsonObject): SessionSummary? {
        val id = value.text("id") ?: return null
        return SessionSummary(id, value.text("label") ?: "세션", value.text("status") ?: return null)
    }

    private fun JsonObject.text(key: String): String? {
        val element: JsonElement = this[key] ?: return null
        val primitive = element as? JsonPrimitive ?: return null
        return if (primitive.isString && primitive.content.isNotEmpty()) primitive.content else null
    }
}
