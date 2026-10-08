package com.rafaam11.multicliwork.mobile.web

import java.net.URI
import java.net.URLEncoder

object HostOrigin {
    fun startUrl(address: String) = "http://$address/mobile/"

    /**
     * 세션 하나를 여는 주소. 웹 UI는 `#session=`을 읽는다(wide-layout.ts의 sessionIdFromHash). [nonce]는
     * 같은 세션 알림을 다시 눌러도 해시가 달라져 hashchange가 나게 한다.
     */
    fun sessionUrl(address: String, sessionId: String, nonce: Long) =
        "${startUrl(address)}#session=${URLEncoder.encode(sessionId, "UTF-8").replace("+", "%20")}&n=$nonce"

    /** 토큰을 가진 브리지가 붙은 WebView는 그 PC의 origin 밖으로 나가지 않는다. */
    fun isInside(address: String, url: String): Boolean {
        val uri = runCatching { URI(url) }.getOrNull() ?: return false
        if (uri.scheme != "http" || uri.rawAuthority == null) return false
        return uri.rawAuthority == address
    }
}
