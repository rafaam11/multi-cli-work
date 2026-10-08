package com.rafaam11.multicliwork.mobile.notify

import android.os.Handler
import com.rafaam11.multicliwork.mobile.data.Host
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener

/** 호스트가 쓰는 WS close 코드(src/shared/remote-types.ts의 REMOTE_CLOSE). */
private const val CLOSE_PROTOCOL = 4400
private const val CLOSE_UNAUTHORIZED = 4401
private const val CLOSE_REVOKED = 4403

/** 상태 연결이 보내는 hello 버전. 앱이 올라가도 올리지 않는다 — 구버전 호스트에도 붙어야 한다. */
private const val STATUS_PROTOCOL_VERSION = 1

/**
 * PC(호스트) 하나와 유지하는 상태 전용 연결. 데스크톱의 HostStatusLink처럼 hello만 하고 어떤 세션에도
 * 붙지 않는다 — 호스트는 세션 목록과 상태 변화를 인증된 모든 연결에 보내고 터미널 출력은 붙은 세션에만
 * 보내므로, 출력 없이 상태만 받는다. 상태와 콜백은 모두 [handler]의 스레드에서 다룬다.
 */
class HostLink(
    val host: Host,
    private val client: OkHttpClient,
    private val handler: Handler,
    private val listener: Listener,
) {
    interface Listener {
        fun allowed(host: Host, status: String, presence: String?): Boolean
        fun onNotice(host: Host, notice: SessionNotice)
        /** 그 세션이 더 기다리지 않는다(풀렸거나 지워졌다) — 떠 있는 알림을 내린다. */
        fun onResolved(host: Host, sessionId: String)
        fun onChanged()
        /** 호스트가 이 기기의 토큰을 거절했다(연결 해제). 더 붙지 않는다. */
        fun onRevoked(host: Host)
    }

    enum class State { CONNECTING, OPEN, RETRYING, STOPPED }

    var state = State.CONNECTING
        private set
    val awaiting: Int get() = if (state == State.OPEN) tracker.awaiting else 0

    private val tracker = StatusTracker()
    private val backoff = Backoff()
    private var socket: WebSocket? = null
    private var stopped = false
    /** 소켓마다 올린다 — 이미 버린 소켓의 늦은 콜백을 무시하려고. */
    private var generation = 0
    private val retry = Runnable { connect() }

    fun start() = connect()

    fun stop() {
        stopped = true
        generation++
        handler.removeCallbacks(retry)
        socket?.close(1000, null)
        socket = null
        state = State.STOPPED
    }

    /** 네트워크(Tailscale 포함)가 다시 잡혔다. 기다리던 재연결을 당겨 바로 붙는다. */
    fun networkAvailable() {
        if (state != State.RETRYING) return
        handler.removeCallbacks(retry)
        backoff.reset()
        connect()
    }

    private fun connect() {
        if (stopped) return
        val current = ++generation
        setState(State.CONNECTING)
        val request = Request.Builder().url("ws://${host.address}/ws").build()
        socket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send(
                    buildJsonObject {
                        put("type", "hello")
                        put("token", host.token)
                        put("protocolVersion", STATUS_PROTOCOL_VERSION)
                        put("mode", "ui")
                    }.toString(),
                )
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handler.post { if (current == generation) receive(text) }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
                handler.post { if (current == generation) closed(code) }
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                handler.post { if (current == generation) closed(code) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                handler.post { if (current == generation) closed(null) }
            }
        })
    }

    private fun receive(text: String) {
        val message = StatusMessages.parse(text) ?: return
        if (message is StatusMessage.Welcome) {
            backoff.reset()
            state = State.OPEN
        }
        val notice = tracker.receive(message) { status, presence -> listener.allowed(host, status, presence) }
        when {
            notice != null -> listener.onNotice(host, notice)
            message is StatusMessage.Status && !isWaiting(message.status) -> listener.onResolved(host, message.sessionId)
            message is StatusMessage.Removed -> listener.onResolved(host, message.sessionId)
        }
        listener.onChanged()
    }

    private fun closed(code: Int?) {
        // 같은 소켓의 onClosing·onClosed가 둘 다 와도 한 번만 처리한다.
        generation++
        socket = null
        tracker.disconnected()
        when (code) {
            CLOSE_UNAUTHORIZED, CLOSE_REVOKED -> {
                stopped = true
                setState(State.STOPPED)
                listener.onRevoked(host)
            }
            // 이 셸이 모르는 프로토콜의 호스트다. 셸을 업데이트할 때까지 두드리지 않는다.
            CLOSE_PROTOCOL -> {
                stopped = true
                setState(State.STOPPED)
            }
            else -> {
                setState(State.RETRYING)
                handler.postDelayed(retry, backoff.next())
            }
        }
    }

    private fun setState(next: State) {
        state = next
        listener.onChanged()
    }
}
