package com.rafaam11.multicliwork.mobile

import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.rafaam11.multicliwork.mobile.core.PairRequest
import com.rafaam11.multicliwork.mobile.core.PairUri
import com.rafaam11.multicliwork.mobile.data.Host
import com.rafaam11.multicliwork.mobile.net.PairingException
import com.rafaam11.multicliwork.mobile.ui.HostListScreen
import com.rafaam11.multicliwork.mobile.ui.PairDialog
import com.rafaam11.multicliwork.mobile.ui.UpdateBanner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {
    private var hosts by mutableStateOf(emptyList<Host>())
    private var pending by mutableStateOf<PairRequest?>(null)
    private var pairBusy by mutableStateOf(false)
    private var pairError by mutableStateOf<String?>(null)
    internal var update by mutableStateOf<UpdateBanner?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        handlePairIntent(intent)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                HostListScreen(
                    versionName = BuildConfig.VERSION_NAME,
                    hosts = hosts,
                    update = update,
                    onOpen = { startActivity(SessionActivity.intent(this, it.hostId)) },
                    onRemove = { ShellGraph.hosts(this).remove(it.hostId); reload() },
                    onScan = ::scan,
                    onPaste = ::acceptPairText,
                    onUpdate = { },
                )
                pending?.let { request ->
                    PairDialog(
                        request = request,
                        defaultDeviceName = Build.MODEL ?: "내 폰",
                        busy = pairBusy,
                        error = pairError,
                        onConfirm = { name -> pair(request, name) },
                        onDismiss = { pending = null; pairError = null },
                    )
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        reload()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handlePairIntent(intent)
    }

    private fun reload() {
        hosts = ShellGraph.hosts(this).list()
    }

    private fun handlePairIntent(intent: Intent?) {
        val data = intent?.data ?: return
        acceptPairText(data.toString())
    }

    private fun acceptPairText(text: String) {
        val request = PairUri.parse(text)
        if (request == null) {
            Toast.makeText(this, "멀티 터미널 페어링 QR이 아닙니다", Toast.LENGTH_SHORT).show()
            return
        }
        pairError = null
        pending = request
    }

    private fun scan() {
        GmsBarcodeScanning.getClient(this).startScan()
            .addOnSuccessListener { barcode -> barcode.rawValue?.let(::acceptPairText) }
            .addOnFailureListener { Toast.makeText(this, "스캐너를 열지 못했습니다: ${it.message}", Toast.LENGTH_SHORT).show() }
    }

    private fun pair(request: PairRequest, deviceName: String) {
        pairBusy = true
        pairError = null
        lifecycleScope.launch {
            try {
                val response = withContext(Dispatchers.IO) { ShellGraph.api.pair(request.address, request.code, deviceName) }
                ShellGraph.hosts(this@MainActivity).save(
                    Host(response.hostId, response.hostName, request.address, response.deviceId, response.token),
                )
                pending = null
                reload()
                startActivity(SessionActivity.intent(this@MainActivity, response.hostId))
            } catch (error: PairingException) {
                pairError = error.message
            } catch (error: Exception) {
                pairError = "PC에 연결하지 못했습니다. PC와 폰의 Tailscale이 켜져 있는지 확인하세요."
            } finally {
                pairBusy = false
            }
        }
    }
}
