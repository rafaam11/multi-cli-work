package com.rafaam11.multicliwork.mobile.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.rafaam11.multicliwork.mobile.data.NotifySettings

/** 폰 알림 상태: 저장된 설정과, 실제로 알림이 닿는 데 걸림돌이 있는지. */
data class NotifyState(
    val settings: NotifySettings,
    /** 알림 권한이 없거나 앱 알림이 꺼져 있다. */
    val blocked: Boolean,
    /** 배터리 최적화 대상이다 — 제조사에 따라 잠금 중 연결이 끊길 수 있다. */
    val batteryRestricted: Boolean,
)

@Composable
fun NotifyCard(
    state: NotifyState,
    onChange: (NotifySettings) -> Unit,
    onFixPermission: () -> Unit,
    onBatterySettings: () -> Unit,
) {
    val settings = state.settings
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            SwitchRow("잠금 중에도 세션 알림 받기", settings.enabled) { onChange(settings.copy(enabled = it)) }
            if (settings.enabled) {
                SwitchRow("PC 앞에 있으면 생략", settings.skipWhenAtPc) { onChange(settings.copy(skipWhenAtPc = it)) }
                SwitchRow("종료·오류도 알림", settings.includeEnded) { onChange(settings.copy(includeEnded = it)) }
                if (state.blocked) {
                    Hint("알림이 꺼져 있어 받을 수 없습니다.", "알림 허용", onFixPermission)
                }
                if (state.batteryRestricted) {
                    Hint("배터리 최적화 때문에 잠금 중 연결이 끊길 수 있습니다.", "설정 열기", onBatterySettings)
                }
            }
        }
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        Switch(checked = checked, onCheckedChange = onChange)
    }
}

@Composable
private fun Hint(text: String, action: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(text, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
        TextButton(onClick = onClick) { Text(action) }
    }
}
