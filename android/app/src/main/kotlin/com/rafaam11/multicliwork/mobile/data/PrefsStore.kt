package com.rafaam11.multicliwork.mobile.data

import android.content.Context

class PrefsStore(context: Context, name: String = "mcw-hosts", private val durable: Boolean = false) : KeyValueStore {
    private val prefs = context.applicationContext.getSharedPreferences(name, Context.MODE_PRIVATE)

    override fun get(key: String): String? = prefs.getString(key, null)

    override fun put(key: String, value: String?) {
        val edit = prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }
        if (durable) check(edit.commit()) { "알림 상태를 저장하지 못했습니다" } else edit.apply()
    }
}
