package com.rafaam11.multicliwork.mobile.notify

/** Activity and WebView must agree on the exact exposed session. */
object ForegroundTracker {
    @Volatile
    var viewingHostId: String? = null
    @Volatile var viewingSessionId: String? = null
    var onViewed: ((String, String, Long?) -> Unit)? = null
    var onLegacyViewed: ((String, String, String) -> Unit)? = null
    fun clear(hostId: String?) {
        if (viewingHostId == hostId) { viewingHostId = null; viewingSessionId = null }
    }
}
