package com.rafaam11.multicliwork.mobile

import android.content.Context
import com.rafaam11.multicliwork.mobile.data.HostRepository
import com.rafaam11.multicliwork.mobile.data.KeystoreTokenSealer
import com.rafaam11.multicliwork.mobile.data.NotifyPrefs
import com.rafaam11.multicliwork.mobile.data.PrefsStore
import com.rafaam11.multicliwork.mobile.net.HostApi

/** 앱 전역에서 하나씩만 쓰는 것들. */
object ShellGraph {
    val api = HostApi()
    private val sealer = KeystoreTokenSealer()
    fun hosts(context: Context) = HostRepository(PrefsStore(context), sealer)
    fun notifyPrefs(context: Context) = NotifyPrefs(PrefsStore(context, "mcw-notify"))
}
