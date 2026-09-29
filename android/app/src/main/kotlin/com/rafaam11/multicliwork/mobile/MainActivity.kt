package com.rafaam11.multicliwork.mobile

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
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
import com.rafaam11.multicliwork.mobile.update.ApkInstaller
import com.rafaam11.multicliwork.mobile.update.ApkVerifier
import com.rafaam11.multicliwork.mobile.update.Candidate
import com.rafaam11.multicliwork.mobile.update.UpdateCheck
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class MainActivity : ComponentActivity() {
    private var hosts by mutableStateOf(emptyList<Host>())
    private var pending by mutableStateOf<PairRequest?>(null)
    private var pairBusy by mutableStateOf(false)
    private var pairError by mutableStateOf<String?>(null)
    internal var update by mutableStateOf<UpdateBanner?>(null)
    private var candidate: Candidate? = null
    private var updating = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) handlePairIntent(intent)
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
                    onUpdate = ::runUpdate,
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
        checkForUpdate()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handlePairIntent(intent)
    }

    private fun reload() {
        hosts = ShellGraph.hosts(this).list()
    }


    private fun checkForUpdate() {
        val known = ShellGraph.hosts(this).list()
        lifecycleScope.launch {
            val found = withContext(Dispatchers.IO) { UpdateCheck(ShellGraph.api::shellRelease).find(BuildConfig.VERSION_CODE, known) }
            if (updating) return@launch
            candidate = found
            update = found?.let { UpdateBanner(it.release, busy = false, message = null) }
        }
    }

    private fun runUpdate() {
        if (updating) return
        val found = candidate ?: return
        if (!packageManager.canRequestPackageInstalls()) {
            update = update?.copy(message = "먼저 '이 출처의 앱 설치 허용'을 켜 주세요")
            startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:$packageName")))
            return
        }
        updating = true
        update = update?.copy(busy = true, message = null)
        lifecycleScope.launch {
            // 시도마다 고유한 임시 파일 — 겹친 실행이 검증과 설치 사이의 파일을 덮어쓰지 못하게 한다.
            val apk = File.createTempFile("shell-update", ".apk", cacheDir)
            try {
                val problem = withContext(Dispatchers.IO) {
                    ShellGraph.api.downloadApk(found.host.address, apk)
                    when {
                        !ApkVerifier.sha256Matches(apk, found.release.sha256) -> "파일이 손상됐습니다(sha256 불일치)"
                        !ApkVerifier.sameSigner(this@MainActivity, apk) -> "서명이 설치본과 달라 설치하지 않습니다"
                        else -> {
                            ApkInstaller.install(this@MainActivity, apk)
                            null
                        }
                    }
                }
                if (problem != null) apk.delete()
                update = update?.copy(busy = false, message = problem ?: "설치를 시작했습니다")
            } catch (error: CancellationException) {
                apk.delete()
                throw error
            } catch (error: Exception) {
                apk.delete()
                update = update?.copy(busy = false, message = "업데이트에 실패했습니다: ${error.message ?: error.javaClass.simpleName}")
            } finally {
                updating = false
            }
        }
    }

    private fun handlePairIntent(intent: Intent?) {
        val data = intent?.data ?: return
        // 한 번 쓴 페어링 코드가 액티비티 재생성 때 다시 열리지 않도록 소비한 인텐트의 data를 지운다.
        setIntent(Intent(intent).setData(null))
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
