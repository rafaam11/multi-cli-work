package com.rafaam11.multicliwork.mobile.data

import android.content.Context

class PrefsStore(context: Context) : KeyValueStore {
    private val prefs = context.applicationContext.getSharedPreferences("mcw-hosts", Context.MODE_PRIVATE)

    override fun get(key: String): String? = prefs.getString(key, null)

    override fun put(key: String, value: String?) {
        prefs.edit().apply { if (value == null) remove(key) else putString(key, value) }.apply()
    }
}
