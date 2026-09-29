package com.rafaam11.multicliwork.mobile.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.rafaam11.multicliwork.mobile.core.PairRequest

@Composable
fun PairDialog(
    request: PairRequest,
    defaultDeviceName: String,
    busy: Boolean,
    error: String?,
    onConfirm: (deviceName: String) -> Unit,
    onDismiss: () -> Unit,
) {
    var deviceName by remember { mutableStateOf(defaultDeviceName) }
    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("${request.hostName}와 연결") },
        text = {
            Column {
                Text("주소 ${request.address}")
                Spacer(Modifier.height(12.dp))
                OutlinedTextField(value = deviceName, onValueChange = { deviceName = it }, label = { Text("이 기기 이름") }, singleLine = true)
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(error)
                }
            }
        },
        confirmButton = { TextButton(enabled = !busy && deviceName.isNotBlank(), onClick = { onConfirm(deviceName.trim()) }) { Text(if (busy) "연결 중…" else "연결") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("취소") } },
    )
}
