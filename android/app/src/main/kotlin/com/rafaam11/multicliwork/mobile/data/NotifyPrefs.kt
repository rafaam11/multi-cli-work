package com.rafaam11.multicliwork.mobile.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** 폰 알림 설정. 기본은 입력·승인 대기만 알리고, PC 앞에 있으면 생략한다. */
@Serializable
data class NotifySettings(
    val enabled: Boolean = true,
    val skipWhenAtPc: Boolean = true,
    /** 종료·오류도 알린다. 데스크톱 기본값처럼 꺼 둔다. */
    val includeEnded: Boolean = false,
    /** 알림을 끈 PC의 hostId. */
    val mutedHosts: Set<String> = emptySet(),
)

/** 토큰과 섞이지 않게 호스트 목록과 다른 저장소에 둔다. */
class NotifyPrefs(private val store: KeyValueStore) {
    private val json = Json { ignoreUnknownKeys = true }

    fun load(): NotifySettings =
        store.get(KEY)?.let { raw -> runCatching { json.decodeFromString(NotifySettings.serializer(), raw) }.getOrNull() }
            ?: NotifySettings()

    fun save(settings: NotifySettings) = store.put(KEY, json.encodeToString(NotifySettings.serializer(), settings))

    private companion object {
        const val KEY = "notify"
    }
}
