package com.rafaam11.multicliwork.mobile.notify

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.rafaam11.multicliwork.mobile.MainActivity
import com.rafaam11.multicliwork.mobile.R
import com.rafaam11.multicliwork.mobile.SessionActivity
import com.rafaam11.multicliwork.mobile.data.Host

/** 셸이 띄우는 알림들. 문구는 데스크톱 알림(runtime.ts의 NOTIFICATION_BODY)과 같다. */
object Notifications {
    private const val CHANNEL_LINK = "status-link"
    private const val CHANNEL_SESSIONS = "sessions"
    const val ONGOING_ID = 1

    private val BODY = mapOf(
        "awaiting-input" to "입력을 기다리는 중입니다",
        "awaiting-approval" to "승인이 필요합니다",
        "exited" to "세션이 종료되었습니다",
        "error" to "세션이 오류로 중단되었습니다",
    )

    fun ensureChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_LINK, "연결 상태", NotificationManager.IMPORTANCE_MIN).apply {
                description = "PC의 세션 상태를 받는 동안 떠 있는 알림"
                setShowBadge(false)
            },
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_SESSIONS, "세션 알림", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "PC의 세션이 입력·승인을 기다리거나 끝났을 때"
            },
        )
    }

    /** 포그라운드 서비스의 상주 알림. */
    fun ongoing(context: Context, text: String): Notification =
        NotificationCompat.Builder(context, CHANNEL_LINK)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("멀티 터미널")
            .setContentText(text)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_MIN)
            .setContentIntent(openHosts(context))
            .build()

    fun updateOngoing(context: Context, text: String) = post(context, ONGOING_ID, ongoing(context, text))

    fun session(context: Context, host: Host, notice: SessionNotice) {
        val id = sessionNotificationId(host.hostId, notice.sessionId)
        val open = PendingIntent.getActivity(
            context,
            id,
            SessionActivity.intent(context, host.hostId, notice.sessionId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = NotificationCompat.Builder(context, CHANNEL_SESSIONS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("${host.name} · ${notice.label}")
            .setContentText(BODY[notice.status] ?: notice.status)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
        post(context, id, notification)
    }

    fun resolve(context: Context, host: Host, sessionId: String) {
        NotificationManagerCompat.from(context).cancel(sessionNotificationId(host.hostId, sessionId))
    }

    fun revoked(context: Context, host: Host) {
        val notification = NotificationCompat.Builder(context, CHANNEL_SESSIONS)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("${host.name}에서 연결이 해제됨")
            .setContentText("이 PC의 알림을 받으려면 다시 페어링하세요.")
            .setAutoCancel(true)
            .setContentIntent(openHosts(context))
            .build()
        post(context, "revoked/${host.hostId}".hashCode(), notification)
    }

    /** 알림 권한(Android 13+)이 없거나 사용자가 앱 알림을 껐다. */
    fun blocked(context: Context): Boolean {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            return true
        }
        return !NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    private fun post(context: Context, id: Int, notification: Notification) {
        if (blocked(context)) return
        try {
            NotificationManagerCompat.from(context).notify(id, notification)
        } catch (_: SecurityException) {
            // 확인과 게시 사이에 권한이 회수됐다.
        }
    }

    private fun sessionNotificationId(hostId: String, sessionId: String) = "$hostId/$sessionId".hashCode()

    private fun openHosts(context: Context): PendingIntent = PendingIntent.getActivity(
        context,
        0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
}
