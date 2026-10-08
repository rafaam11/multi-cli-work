package com.rafaam11.multicliwork.mobile.notify

import com.rafaam11.multicliwork.mobile.data.NotifySettings

object NotifyPolicy {
    /**
     * 이 상태 변화를 지금 폰에 알려도 되는지.
     * - presence가 focused(호스트 앱 창에 포커스 + 2분 내 입력)면 PC 앞에 있으니 생략한다. 구 호스트는
     *   presence가 없고, 그때는 알린다.
     * - 그 PC의 세션 화면을 보고 있는 중이면([viewingHostId]) 생략한다.
     */
    fun allowed(settings: NotifySettings, hostId: String, status: String, presence: String?, viewingHostId: String?): Boolean {
        if (!settings.enabled || hostId in settings.mutedHosts) return false
        if (!isWaiting(status) && !settings.includeEnded) return false
        if (settings.skipWhenAtPc && presence == "focused") return false
        return viewingHostId != hostId
    }
}
