package com.rafaam11.multicliwork.mobile

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.rafaam11.multicliwork.mobile.web.HostOrigin
import com.rafaam11.multicliwork.mobile.web.McwShellBridge

/**
 * 한 PC의 모바일 UI. 화면은 PC가 서빙하므로(데스크톱 버전을 따라간다) 여기는 WebView와 브리지뿐이다.
 */
class SessionActivity : ComponentActivity() {
    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val hostId = intent.getStringExtra(EXTRA_HOST_ID)
        val host = hostId?.let { ShellGraph.hosts(this).get(it) }
        if (host == null) {
            Toast.makeText(this, "이 PC를 다시 페어링하세요", Toast.LENGTH_SHORT).show()
            finish()
            return
        }
        enableEdgeToEdge()
        webView = WebView(this)
        // edge-to-edge(targetSdk 35+)에서 상태바·내비게이션바·키보드 아래로 웹 화면이 깔리지 않게 한다.
        // 여백은 WebView가 아니라 감싸는 틀에 준다 — WebView는 자기 padding으로는 뷰포트를 줄이지 않아,
        // 키보드가 올라와도 페이지가 그대로 있고 입력창이 가려진다. 틀이 줄면 WebView 높이가 실제로 줄어든다.
        val container = FrameLayout(this).apply { setBackgroundColor(Color.parseColor("#101214")) }
        container.addView(webView, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        ViewCompat.setOnApplyWindowInsetsListener(container) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.addJavascriptInterface(
            McwShellBridge(
                host = host,
                onUnpaired = {
                    runOnUiThread {
                        ShellGraph.hosts(this).remove(host.hostId)
                        Toast.makeText(this, "${host.name}에서 이 기기를 해제했습니다. 다시 페어링하세요.", Toast.LENGTH_LONG).show()
                        finish()
                    }
                },
                onBack = { runOnUiThread { finish() } },
            ),
            "McwShell",
        )
        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !HostOrigin.isInside(host.address, request.url.toString())
        }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
        setContentView(container)
        webView.loadUrl(HostOrigin.startUrl(host.address))
    }

    override fun onDestroy() {
        if (::webView.isInitialized) webView.destroy()
        super.onDestroy()
    }

    companion object {
        const val EXTRA_HOST_ID = "hostId"
        fun intent(context: Context, hostId: String) = Intent(context, SessionActivity::class.java).putExtra(EXTRA_HOST_ID, hostId)
    }
}
