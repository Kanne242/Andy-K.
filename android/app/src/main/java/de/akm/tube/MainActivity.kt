package de.akm.tube

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader

/**
 * Dünne Hülle um die Web-App (assets = Ordner /web).
 * Die App wird über https://appassets.androidplatform.net geladen, damit der
 * offizielle YouTube-Player eine gültige Herkunft (Origin/Referer) bekommt.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private lateinit var root: FrameLayout
    private var fullscreenView: View? = null
    private var fullscreenCallback: WebChromeClient.CustomViewCallback? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        root = FrameLayout(this)
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(-1, -1))
        setContentView(root)

        val isTv = packageManager.hasSystemFeature("android.software.leanback") ||
            packageManager.hasSystemFeature("amazon.hardware.fire_tv")

        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            loadWithOverviewMode = true
            useWideViewPort = true
            userAgentString = userAgentString + (if (isTv) " AKMTube-TV" else " AKMTube-App")
        }
        web.isFocusable = true
        web.isFocusableInTouchMode = true

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == "appassets.androidplatform.net") return false
                // Externe Links (nicht der eingebettete Player) im Browser öffnen
                if (request.isForMainFrame) {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, url)) }
                    return true
                }
                return false
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                fullscreenView = view; fullscreenCallback = callback
                root.addView(view, FrameLayout.LayoutParams(-1, -1))
                web.visibility = View.GONE
            }
            // Dateiauswahl für "Dateien vom Gerät" (eigene Audio-/Videodateien)
            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                val pick = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("audio/*", "video/*", "application/json"))
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                }
                return try {
                    startActivityForResult(Intent.createChooser(pick, "Datei wählen"), REQ_FILE); true
                } catch (e: Exception) {
                    fileCallback = null; false
                }
            }
            override fun onHideCustomView() {
                fullscreenView?.let { root.removeView(it) }
                fullscreenView = null
                fullscreenCallback?.onCustomViewHidden()
                web.visibility = View.VISIBLE
            }
        }

        web.loadUrl(startUrl(intent))
        web.requestFocus()
    }

    private fun startUrl(i: Intent?): String {
        val base = "https://appassets.androidplatform.net/index.html"
        val shared = i?.takeIf { it.action == Intent.ACTION_SEND }?.getStringExtra(Intent.EXTRA_TEXT)
        return if (shared != null) "$base?url=" + Uri.encode(shared) else base
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == Intent.ACTION_SEND) web.loadUrl(startUrl(intent))
    }

    @Deprecated("Fire OS / ältere Android-Versionen nutzen weiterhin onBackPressed")
    override fun onBackPressed() {
        if (fullscreenView != null) { web.webChromeClient?.onHideCustomView(); return }
        web.evaluateJavascript("(window.akmBack && window.akmBack()) ? '1' : '0'") { handled ->
            if (handled?.contains("1") != true) {
                @Suppress("DEPRECATION") super.onBackPressed()
            }
        }
    }

    @Deprecated("Activity-Result-API ist für diese schlanke Hülle nicht nötig")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_FILE) return
        val uris = mutableListOf<Uri>()
        if (resultCode == RESULT_OK && data != null) {
            data.clipData?.let { c -> for (i in 0 until c.itemCount) uris.add(c.getItemAt(i).uri) }
            if (uris.isEmpty()) data.data?.let { uris.add(it) }
        }
        fileCallback?.onReceiveValue(if (uris.isEmpty()) null else uris.toTypedArray())
        fileCallback = null
    }

    companion object { private const val REQ_FILE = 4711 }

    override fun onPause() { super.onPause(); web.onPause() }
    override fun onResume() { super.onResume(); web.onResume() }
    override fun onDestroy() { web.destroy(); super.onDestroy() }
}
