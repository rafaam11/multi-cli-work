package com.rafaam11.multicliwork.mobile.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * 재부팅과 셸 자가 업데이트 뒤에 상태 서비스를 다시 띄운다. 업데이트는 프로세스를 죽이므로, 이게 없으면
 * 사용자가 앱을 한 번 열 때까지 알림이 오지 않는다.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED || intent.action == Intent.ACTION_MY_PACKAGE_REPLACED) {
            StatusService.refresh(context)
        }
    }
}
