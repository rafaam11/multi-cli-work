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
import androidx.activity.viewModels
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.rafaam11.multicliwork.mobile.data.Host
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
    private val pairing: PairViewModel by viewModels()
    internal var update by mutableStateOf<UpdateBanner?>(null)
    private var candidate: Candidate? = null
    private var updating = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (savedInstanceState == null) {
            handlePairIntent(intent)
        } else if (pairing.pending == null) {
            // 프로세스가 죽었다 살아난 경우 — 저장해 둔 페어링 요청을 다시 확인 창으로 띄운다.
            savedInstanceState.getString(STATE_PENDING_PAIR)?.let(pairing::accept)
        }
        // 페어링은 ViewModel에서 끝난다 — 화면이 보일 때 완료된 호스트를 한 번만 연다.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.RESUMED) {
                snapshotFlow { pairing.completedHostId }.collect { hostId ->
                    if (hostId != null) {
                        pairing.consumeCompleted()
                        reload()
                        startActivity(SessionActivity.intent(this@MainActivity, hostId))
                    }
                }
            }
        }
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
                pairing.pending?.let { request ->
                    PairDialog(
                        request = request,
                        defaultDeviceName = Build.MODEL ?: "내 폰",
                        busy = pairing.busy,
                        error = pairing.error,
                        onConfirm = { name -> pairing.pair(request, name) },
                        onDismiss = pairing::dismiss,
                    )
                }
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        pairing.pendingRaw?.let { outState.putString(STATE_PENDING_PAIR, it) }
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
            var apk: File? = null
            try {
                // 시도마다 고유한 임시 파일 — 겹친 실행이 검증과 설치 사이의 파일을 덮어쓰지 못하게 한다.
                // 만들기 자체가 실패(디스크 가득)해도 앱이 죽지 않도록 try 안에서 만든다.
                val file = File.createTempFile("shell-update", ".apk", cacheDir)
                apk = file
                val problem = withContext(Dispatchers.IO) {
                    ShellGraph.api.downloadApk(found.host.address, file)
                    val archiveVersion = ApkVerifier.archiveVersionCode(this@MainActivity, file)
                    when {
                        !ApkVerifier.sha256Matches(file, found.release.sha256) -> "파일이 손상됐습니다(sha256 불일치)"
                        !ApkVerifier.sameSigner(this@MainActivity, file) -> "서명이 설치본과 달라 설치하지 않습니다"
                        archiveVersion == null ||
                            !ApkVerifier.versionAcceptable(archiveVersion, found.release.versionCode, BuildConfig.VERSION_CODE) ->
                            "PC가 알린 버전과 파일 버전이 다릅니다"
                        else -> {
                            ApkInstaller.install(this@MainActivity, file)
                            null
                        }
                    }
                }
                if (problem != null) file.delete()
                update = update?.copy(busy = false, message = problem ?: "설치를 시작했습니다")
            } catch (error: CancellationException) {
                apk?.delete()
                throw error
            } catch (error: Exception) {
                apk?.delete()
                update = update?.copy(busy = false, message = "업데이트에 실패했습니다: ${error.message ?: error.javaClass.simpleName}")
            } finally {
                updating = false
            }
        }
    }

    private fun handlePairIntent(intent: Intent?) {
        // Recents에서 다시 열린 태스크는 최초 인텐트(이미 쓴 mcw://pair)를 되풀이한다 — 무시한다.
        if (intent != null && (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return
        val data = intent?.data ?: return
        // 한 번 쓴 페어링 코드가 액티비티 재생성 때 다시 열리지 않도록 소비한 인텐트의 data를 지운다.
        setIntent(Intent(intent).setData(null))
        acceptPairText(data.toString())
    }

    private fun acceptPairText(text: String) {
        if (!pairing.accept(text)) {
            Toast.makeText(this, "멀티 터미널 페어링 QR이 아닙니다", Toast.LENGTH_SHORT).show()
        }
    }

    private fun scan() {
        GmsBarcodeScanning.getClient(this).startScan()
            .addOnSuccessListener { barcode -> barcode.rawValue?.let(::acceptPairText) }
            .addOnFailureListener { Toast.makeText(this, "스캐너를 열지 못했습니다: ${it.message}", Toast.LENGTH_SHORT).show() }
    }

    private companion object {
        const val STATE_PENDING_PAIR = "pendingPair"
    }
}
