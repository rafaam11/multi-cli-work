package com.rafaam11.multicliwork.mobile.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.rafaam11.multicliwork.mobile.core.ShellRelease
import com.rafaam11.multicliwork.mobile.data.Host

data class UpdateBanner(val release: ShellRelease, val busy: Boolean, val message: String?)

@Composable
fun HostListScreen(
    versionName: String,
    hosts: List<Host>,
    update: UpdateBanner?,
    onOpen: (Host) -> Unit,
    onRemove: (Host) -> Unit,
    onScan: () -> Unit,
    onPaste: (String) -> Unit,
    onUpdate: () -> Unit,
) {
    var pasting by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<Host?>(null) }
    Column(Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("멀티 터미널", style = MaterialTheme.typography.headlineSmall)
        if (update != null) {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("새 버전 v${update.release.versionName}이 있습니다 (지금 v$versionName)")
                    if (update.message != null) Text(update.message)
                    Button(enabled = !update.busy, onClick = onUpdate) { Text(if (update.busy) "받는 중…" else "업데이트") }
                }
            }
        }
        if (hosts.isEmpty()) Text("등록된 PC가 없습니다. PC의 설정 ▸ 모바일 ▸ 기기 추가 QR을 찍으세요.")
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(hosts, key = { it.hostId }) { host ->
                Card(Modifier.fillMaxWidth().clickable { onOpen(host) }) {
                    Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(host.name, style = MaterialTheme.typography.titleMedium)
                            Text(host.address, style = MaterialTheme.typography.bodySmall)
                        }
                        TextButton(onClick = { removing = host }) { Text("삭제") }
                    }
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = onScan) { Text("QR로 PC 추가") }
            OutlinedButton(onClick = { pasting = true }) { Text("주소 붙여넣기") }
        }
        Text("v$versionName", style = MaterialTheme.typography.bodySmall)
    }
    if (pasting) {
        var text by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { pasting = false },
            title = { Text("페어링 주소") },
            text = { OutlinedTextField(value = text, onValueChange = { text = it }, label = { Text("mcw://pair?…") }) },
            confirmButton = { TextButton(onClick = { pasting = false; onPaste(text) }) { Text("확인") } },
            dismissButton = { TextButton(onClick = { pasting = false }) { Text("취소") } },
        )
    }
    removing?.let { host ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text("${host.name} 삭제") },
            text = { Text("이 폰에서만 지웁니다. PC 쪽 기기 목록에서도 연결 해제하세요.") },
            confirmButton = { TextButton(onClick = { removing = null; onRemove(host) }) { Text("삭제") } },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("취소") } },
        )
    }
}
