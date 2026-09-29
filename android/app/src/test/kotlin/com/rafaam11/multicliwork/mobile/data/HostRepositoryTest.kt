package com.rafaam11.multicliwork.mobile.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test

class HostRepositoryTest {
    private class MemoryStore : KeyValueStore {
        val values = mutableMapOf<String, String>()
        override fun get(key: String) = values[key]
        override fun put(key: String, value: String?) {
            if (value == null) values.remove(key) else values[key] = value
        }
    }

    private class ReversingSealer : TokenSealer {
        var broken = false
        override fun seal(plain: String) = "sealed:" + plain.reversed()
        override fun open(sealed: String): String {
            check(!broken) { "key is gone" }
            return sealed.removePrefix("sealed:").reversed()
        }
    }

    private fun host(id: String, token: String = "tok-$id") = Host(id, "PC $id", "100.64.0.1:47821", "dev-$id", token)

    @Test
    fun savesListsAndRemovesHosts() {
        val repo = HostRepository(MemoryStore(), ReversingSealer())
        repo.save(host("a"))
        repo.save(host("b"))
        assertEquals(listOf(host("a"), host("b")), repo.list())
        assertEquals(host("b"), repo.get("b"))
        repo.remove("a")
        assertEquals(listOf(host("b")), repo.list())
        assertNull(repo.get("a"))
    }

    @Test
    fun saveReplacesTheSameHostId() {
        val repo = HostRepository(MemoryStore(), ReversingSealer())
        repo.save(host("a", token = "old"))
        repo.save(host("a", token = "new"))
        assertEquals(listOf(host("a", token = "new")), repo.list())
    }

    @Test
    fun neverStoresTheTokenInPlainText() {
        val store = MemoryStore()
        HostRepository(store, ReversingSealer()).save(host("a", token = "supersecret"))
        assertFalse(store.values.values.any { it.contains("supersecret") })
    }

    @Test
    fun dropsHostsWhoseTokenCannotBeOpened() {
        val store = MemoryStore()
        val sealer = ReversingSealer()
        HostRepository(store, sealer).save(host("a"))
        sealer.broken = true
        assertEquals(emptyList<Host>(), HostRepository(store, sealer).list())
    }

    @Test
    fun survivesAGarbledStore() {
        val store = MemoryStore().apply { values["hosts"] = "{not json" }
        assertEquals(emptyList<Host>(), HostRepository(store, ReversingSealer()).list())
    }
}
