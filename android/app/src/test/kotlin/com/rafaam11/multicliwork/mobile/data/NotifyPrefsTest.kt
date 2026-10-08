package com.rafaam11.multicliwork.mobile.data

import org.junit.Assert.assertEquals
import org.junit.Test

class NotifyPrefsTest {
    private class MemoryStore : KeyValueStore {
        val values = mutableMapOf<String, String>()
        override fun get(key: String) = values[key]
        override fun put(key: String, value: String?) {
            if (value == null) values.remove(key) else values[key] = value
        }
    }

    @Test
    fun startsWithTheDefaults() {
        assertEquals(NotifySettings(), NotifyPrefs(MemoryStore()).load())
    }

    @Test
    fun keepsWhatWasSaved() {
        val store = MemoryStore()
        val saved = NotifySettings(enabled = false, skipWhenAtPc = false, includeEnded = true, mutedHosts = setOf("h1", "h2"))
        NotifyPrefs(store).save(saved)
        assertEquals(saved, NotifyPrefs(store).load())
    }

    @Test
    fun fallsBackToTheDefaultsWhenTheStoredValueIsBroken() {
        val store = MemoryStore()
        store.values["notify"] = "{broken"
        assertEquals(NotifySettings(), NotifyPrefs(store).load())
    }
}
