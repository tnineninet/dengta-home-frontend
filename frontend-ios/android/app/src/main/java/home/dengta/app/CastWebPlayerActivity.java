package home.dengta.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;

/**
 * Bilibili 等网页播放器的本地回退页。
 *
 * 原生 ExoPlayer 对 B 站 DASH（视频/音频分离）容器不兼容时，保留一个纯 WebView
 * 播放页，至少让用户在 DengTa 放映厅里看完整页面，而不是只得到容器错误。
 */
public final class CastWebPlayerActivity extends AppCompatActivity {
    public static final String EXTRA_URL = "extra_web_player_url";
    public static final String EXTRA_TITLE = "extra_web_player_title";

    private WebView webView;

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        );
        Intent intent = getIntent();
        String url = intent != null ? intent.getStringExtra(EXTRA_URL) : "";
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : "";
        if (url == null || url.isEmpty()) {
            finish();
            return;
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);

        webView = new WebView(this);
        configureWebView(webView);
        root.addView(webView, new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.loadUrl(url);

        TextView back = new TextView(this);
        back.setText("‹ 返回");
        back.setTextColor(Color.WHITE);
        back.setTextSize(15);
        back.setGravity(Gravity.CENTER);
        back.setPadding(dp(14), dp(8), dp(14), dp(8));
        back.setBackgroundColor(0x66000000);
        back.setOnClickListener(view -> finish());
        FrameLayout.LayoutParams backParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        backParams.gravity = Gravity.TOP | Gravity.START;
        backParams.setMargins(dp(12), dp(34), 0, 0);
        root.addView(back, backParams);

        TextView label = new TextView(this);
        label.setText(title == null ? "" : title);
        label.setTextColor(Color.WHITE);
        label.setTextSize(13);
        label.setMaxLines(1);
        label.setEllipsize(android.text.TextUtils.TruncateAt.END);
        label.setGravity(Gravity.CENTER_VERTICAL);
        label.setPadding(dp(10), dp(6), dp(10), dp(6));
        label.setBackgroundColor(0x55000000);
        FrameLayout.LayoutParams labelParams = new FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        labelParams.gravity = Gravity.TOP;
        labelParams.setMargins(dp(100), dp(34), dp(16), 0);
        root.addView(label, labelParams);

        setContentView(root);
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView(WebView view) {
        WebSettings settings = view.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUserAgentString(
            "Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 "
                + "(KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true);
        view.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView webView, String url) {
                super.onPageFinished(webView, url);
                // Bilibili's embed ignores danmaku=0 on some player builds and
                // paints flying text over the system status bar / our header.
                webView.evaluateJavascript(
                    "(function(){try{var s=document.createElement('style');"
                        + "s.textContent='.bpx-player-dm-wrap,.bpx-player-dm-layer,.danmaku,"
                        + ".bilibili-player-video-danmaku,[class*=\"dm-\"],[class*=\"danmaku\"],"
                        + "[class*=\"danmu\"]{display:none!important}';"
                        + "(document.head||document.documentElement).appendChild(s);}catch(e){}})();",
                    null
                );
            }
        });
        view.setWebChromeClient(new WebChromeClient());
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.loadUrl("about:blank");
            webView.removeAllViews();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
