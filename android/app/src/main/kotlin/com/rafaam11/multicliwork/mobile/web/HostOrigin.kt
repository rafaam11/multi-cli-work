package com.rafaam11.multicliwork.mobile.web

import java.net.URI

object HostOrigin {
    fun startUrl(address: String) = "http://$address/mobile/"

    /** 토큰을 가진 브리지가 붙은 WebView는 그 PC의 origin 밖으로 나가지 않는다. */
    fun isInside(address: String, url: String): Boolean {
        val uri = runCatching { URI(url) }.getOrNull() ?: return false
        if (uri.scheme != "http" || uri.rawAuthority == null) return false
        return uri.rawAuthority == address
    }
}
