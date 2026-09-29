package com.rafaam11.multicliwork.mobile

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.rafaam11.multicliwork.mobile.core.PairRequest
import com.rafaam11.multicliwork.mobile.core.PairUri
import com.rafaam11.multicliwork.mobile.data.Host
import com.rafaam11.multicliwork.mobile.net.PairingException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * 페어링 상태와 네트워크 호출을 액티비티 밖(viewModelScope)에 둔다 — 화면 회전 같은 재생성이 진행 중인
 * 페어링을 끊어 "PC는 코드를 소비했는데 폰은 호스트를 저장하지 못한" 상태를 만들지 않도록.
 */
class PairViewModel(app: Application) : AndroidViewModel(app) {
    var pending by mutableStateOf<PairRequest?>(null)
        private set
    var busy by mutableStateOf(false)
        private set
    var error by mutableStateOf<String?>(null)
        private set

    /** 페어링이 끝나 열어야 하는 호스트(액티비티가 화면에 있을 때 한 번 소비한다). */
    var completedHostId by mutableStateOf<String?>(null)
        private set

    /** 프로세스 재생성 뒤 확인 창을 되살리기 위한 원본 URI 텍스트. */
    var pendingRaw: String? = null
        private set

    fun accept(text: String): Boolean {
        val request = PairUri.parse(text) ?: return false
        error = null
        pending = request
        pendingRaw = text
        return true
    }

    fun dismiss() {
        pending = null
        pendingRaw = null
        error = null
    }

    fun consumeCompleted() {
        completedHostId = null
    }

    fun pair(request: PairRequest, deviceName: String) {
        if (busy) return
        busy = true
        error = null
        viewModelScope.launch {
            try {
                val response = withContext(Dispatchers.IO) { ShellGraph.api.pair(request.address, request.code, deviceName) }
                if (response.hostId != request.hostId) {
                    error = "QR의 PC와 응답한 PC가 다릅니다"
                    return@launch
                }
                ShellGraph.hosts(getApplication()).save(
                    Host(response.hostId, response.hostName, request.address, response.deviceId, response.token),
                )
                pending = null
                pendingRaw = null
                completedHostId = response.hostId
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: PairingException) {
                error = failure.message
            } catch (failure: Exception) {
                error = "PC에 연결하지 못했습니다. PC와 폰의 Tailscale이 켜져 있는지 확인하세요."
            } finally {
                busy = false
            }
        }
    }
}
