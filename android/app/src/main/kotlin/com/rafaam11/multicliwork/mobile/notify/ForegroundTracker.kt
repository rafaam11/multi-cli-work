package com.rafaam11.multicliwork.mobile.notify

/** 지금 화면에 떠 있는 세션 화면의 PC. 보고 있는 PC의 알림은 띄우지 않는다. */
object ForegroundTracker {
    @Volatile
    var viewingHostId: String? = null
}
