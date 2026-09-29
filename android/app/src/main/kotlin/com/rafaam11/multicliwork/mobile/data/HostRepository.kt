package com.rafaam11.multicliwork.mobile.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json

data class Host(val hostId: String, val name: String, val address: String, val deviceId: String, val token: String)

interface KeyValueStore {
    fun get(key: String): String?
    fun put(key: String, value: String?)
}

interface TokenSealer {
    fun seal(plain: String): String
    fun open(sealed: String): String
}

@Serializable
private data class StoredHost(val hostId: String, val name: String, val address: String, val deviceId: String, val sealedToken: String)

/**
 * 페어링한 PC들. 토큰은 봉인해서만 저장한다. 봉인을 못 여는 항목(기기 초기화·백업 복원으로 Keystore
 * 키가 사라진 경우)은 목록에서 빠지고, 사용자는 그 PC를 다시 페어링한다.
 */
class HostRepository(private val store: KeyValueStore, private val sealer: TokenSealer) {
    private val json = Json { ignoreUnknownKeys = true }
    private val serializer = ListSerializer(StoredHost.serializer())

    fun list(): List<Host> = stored().mapNotNull { entry ->
        runCatching { Host(entry.hostId, entry.name, entry.address, entry.deviceId, sealer.open(entry.sealedToken)) }.getOrNull()
    }

    fun get(hostId: String): Host? = list().firstOrNull { it.hostId == hostId }

    fun save(host: Host) {
        val entry = StoredHost(host.hostId, host.name, host.address, host.deviceId, sealer.seal(host.token))
        write(stored().filterNot { it.hostId == host.hostId } + entry)
    }

    fun remove(hostId: String) = write(stored().filterNot { it.hostId == hostId })

    private fun stored(): List<StoredHost> =
        store.get(KEY)?.let { raw -> runCatching { json.decodeFromString(serializer, raw) }.getOrNull() } ?: emptyList()

    private fun write(entries: List<StoredHost>) = store.put(KEY, json.encodeToString(serializer, entries))

    private companion object {
        const val KEY = "hosts"
    }
}
