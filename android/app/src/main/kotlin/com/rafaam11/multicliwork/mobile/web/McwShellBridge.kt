package com.rafaam11.multicliwork.mobile.web

import android.webkit.JavascriptInterface
import com.rafaam11.multicliwork.mobile.data.Host
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/** 모바일 웹 UI(src/renderer/src/mobile/shell-bridge.ts)가 `window.McwShell`로 부르는 것. */
class McwShellBridge(
    private val host: Host,
    private val onUnpaired: () -> Unit,
    private val onBack: () -> Unit,
    private val foreground: () -> Boolean = { false },
    private val onViewing: (String, Long?) -> Unit = { _, _ -> },
) {
    @JavascriptInterface
    fun bridgeVersion(): Int = BRIDGE_VERSION

    @JavascriptInterface
    fun pairingJson(): String = buildJsonObject {
        put("token", host.token)
        put("deviceId", host.deviceId)
        put("hostName", host.name)
    }.toString()

    @JavascriptInterface
    fun unpaired() = onUnpaired()

    @JavascriptInterface
    fun backToHosts() = onBack()

    @JavascriptInterface
    fun isForeground(): Boolean = foreground()

    @JavascriptInterface
    fun viewingSession(sessionId: String, generation: Long) = onViewing(sessionId, generation.takeIf { it >= 0 })

    companion object {
        const val BRIDGE_VERSION = 2
    }
}
