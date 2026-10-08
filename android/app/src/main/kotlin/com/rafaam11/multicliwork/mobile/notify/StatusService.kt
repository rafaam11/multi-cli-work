package com.rafaam11.multicliwork.mobile.notify

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.rafaam11.multicliwork.mobile.ShellGraph
import com.rafaam11.multicliwork.mobile.data.Host
import okhttp3.OkHttpClient
import java.util.concurrent.TimeUnit

/**
 * 폰이 잠겨 있어도 PC 세션의 입력·승인 대기를 알리는 포그라운드 서비스. 등록된 PC마다 상태 연결
 * ([HostLink]) 하나를 유지한다. 알림이 꺼졌거나 등록된 PC가 없으면 스스로 멈춘다.
 *
 * 서비스 타입은 specialUse다. dataSync는 Android 15부터 하루 6시간으로 제한되어 상시 연결에 쓸 수 없고,
 * 이 앱은 Play 스토어가 아니라 PC 설치본이 나눠 주는 APK라 심사 대상도 아니다.
 */
class StatusService : Service(), HostLink.Listener {
    private val handler = Handler(Looper.getMainLooper())
    private val links = mutableMapOf<String, HostLink>()
    private lateinit var client: OkHttpClient
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var ongoingText: String? = null

    override fun onCreate() {
        super.onCreate()
        Notifications.ensureChannels(this)
        // 호스트도 30초마다 ping한다. 이쪽 ping은 Doze 뒤처럼 조용히 죽은 연결을 알아채려는 것이다.
        client = OkHttpClient.Builder().pingInterval(45, TimeUnit.SECONDS).readTimeout(0, TimeUnit.MILLISECONDS).build()
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                handler.post { links.values.forEach(HostLink::networkAvailable) }
            }
        }
        getSystemService(ConnectivityManager::class.java).registerDefaultNetworkCallback(callback)
        networkCallback = callback
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // startForegroundService 뒤에는 곧바로 startForeground를 불러야 한다 — 멈출 때도 먼저 부른다.
        val text = summary()
        ongoingText = text
        ServiceCompat.startForeground(
            this,
            Notifications.ONGOING_ID,
            Notifications.ongoing(this, text),
            // specialUse는 Android 14에 생긴 타입이다. 그 전에는 매니페스트에 적힌 타입을 그대로 쓴다.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            } else {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MANIFEST
            },
        )
        sync()
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        links.values.forEach(HostLink::stop)
        links.clear()
        networkCallback?.let { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) }
        networkCallback = null
        client.dispatcher.executorService.shutdown()
        super.onDestroy()
    }

    /** 저장된 PC 목록과 설정에 연결을 맞춘다. 페어링·삭제·설정 변경 뒤 [refresh]가 다시 부른다. */
    private fun sync() {
        val settings = ShellGraph.notifyPrefs(this).load()
        val hosts = if (settings.enabled) ShellGraph.hosts(this).list().associateBy { it.hostId } else emptyMap()
        if (hosts.isEmpty()) {
            stopSelf()
            return
        }
        // 지워졌거나 다시 페어링해 주소·토큰이 바뀐 PC는 연결을 새로 만든다.
        for ((hostId, link) in links.toMap()) {
            if (hosts[hostId] != link.host) {
                link.stop()
                links.remove(hostId)
            }
        }
        for ((hostId, host) in hosts) {
            if (hostId !in links) links[hostId] = HostLink(host, client, handler, this).also(HostLink::start)
        }
        onChanged()
    }

    private fun summary(): String {
        if (links.isEmpty()) return "PC에 연결하는 중…"
        val open = links.values.count { it.state == HostLink.State.OPEN }
        val awaiting = links.values.sumOf { it.awaiting }
        val connected = if (open == 0) "PC에 연결하는 중…" else "PC ${open}대 연결됨"
        return if (awaiting > 0) "$connected · 대기 $awaiting" else connected
    }

    override fun allowed(host: Host, status: String, presence: String?): Boolean =
        NotifyPolicy.allowed(ShellGraph.notifyPrefs(this).load(), host.hostId, status, presence, ForegroundTracker.viewingHostId)

    override fun onNotice(host: Host, notice: SessionNotice) = Notifications.session(this, host, notice)

    override fun onResolved(host: Host, sessionId: String) = Notifications.resolve(this, host, sessionId)

    override fun onChanged() {
        val text = summary()
        if (text == ongoingText) return
        ongoingText = text
        Notifications.updateOngoing(this, text)
    }

    override fun onRevoked(host: Host) = Notifications.revoked(this, host)

    companion object {
        /** 알림이 켜져 있고 등록된 PC가 있으면 서비스를 띄우거나 다시 맞추고, 아니면 멈춘다. */
        fun refresh(context: Context) {
            val intent = Intent(context, StatusService::class.java)
            val wanted = ShellGraph.notifyPrefs(context).load().enabled && ShellGraph.hosts(context).list().isNotEmpty()
            if (!wanted) {
                context.stopService(intent)
                return
            }
            try {
                ContextCompat.startForegroundService(context, intent)
            } catch (_: IllegalStateException) {
                // 백그라운드에서 시작이 막혔다(ForegroundServiceStartNotAllowedException). 앱을 열면 다시 시도한다.
            }
        }
    }
}
