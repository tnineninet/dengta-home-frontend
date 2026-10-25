package home.dengta.app;

import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import android.window.OnBackInvokedDispatcher;
import androidx.annotation.RequiresApi;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "DengTaMainActivity";
    private static volatile boolean webBackReady = false;
    private boolean rendererRecoveryScheduled = false;

    static void setWebBackReady(boolean ready) {
        webBackReady = ready;
    }

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundNotificationsPlugin.class);
        registerPlugin(DeviceActivityPlugin.class);
        registerPlugin(DeviceSignalsPlugin.class);
        registerPlugin(WhereaboutsPlugin.class);
        registerPlugin(NeteaseCookiePlugin.class);
        registerPlugin(ScreenGlancePlugin.class);
        registerPlugin(NeteasePlaybackPlugin.class);
        registerPlugin(OrderBrowserPlugin.class);
        registerPlugin(BrowserLauncherPlugin.class);
        registerPlugin(DlnaReceiverPlugin.class);
        registerPlugin(VideoExtractorPlugin.class);
        registerPlugin(DeviceTtsPlugin.class);
        registerPlugin(AppNavigationPlugin.class);
        registerPlugin(AppUpdatesPlugin.class);
        super.onCreate(savedInstanceState);
        configureStableWebView();
        PushNotificationWorker.ensureNotificationChannel(this);
        PushNotificationWorker.schedule(this);
        AppUpdateWorker.schedule(this);
        PushNotificationWorker.markAppVisible(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            try {
                registerPredictiveBack();
            } catch (Exception ignored) {
                // Some OEM back dispatchers reject direct registration; onBackPressed still covers the gesture.
            }
        }
    }

    @RequiresApi(Build.VERSION_CODES.TIRAMISU)
    private void registerPredictiveBack() {
        // Android 13+ 的侧边返回可能绕过 BridgeActivity.onBackPressed：直接注册系统回调，
        // 把返回交给网页的返回栈（键盘、弹层、页面、二次退出），而不是立即结束 Activity。
        getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
            OnBackInvokedDispatcher.PRIORITY_DEFAULT,
            this::dispatchBackToWeb
        );
    }

    private void dispatchBackToWeb() {
        if (webBackReady && getBridge() != null) {
            getBridge().triggerWindowJSEvent("dengta:native-back");
            return;
        }
        finish();
    }

    @Override
    public void onBackPressed() {
        dispatchBackToWeb();
    }

    private void configureStableWebView() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }

        WebView webView = getBridge().getWebView();
        webView.setLayerType(View.LAYER_TYPE_NONE, null);
        applyViewportCompatibility();
        // 安卓密码保险箱/系统自动填充会在登录输入框抢焦点：输入一个字符就收键盘，
        // 再弹出旧密码快捷栏。App 内只有登录需要输密码，这里关闭 WebView 自动填充。
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            webView.setImportantForAutofill(View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS);
        }
        // 启动随机播放等场景允许无手势自动播放（内置播放器/后台音乐）。
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        webView.addJavascriptInterface(new DengTaFileBridge(this), "DengTaFileBridge");
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView crashedView, RenderProcessGoneDetail detail) {
                Log.e(
                    TAG,
                    "WebView renderer exited; scheduling a safe activity restart. didCrash="
                        + detail.didCrash()
                );
                if (!rendererRecoveryScheduled) {
                    rendererRecoveryScheduled = true;
                    crashedView.post(() -> {
                        if (!isFinishing() && !isDestroyed()) {
                            recreate();
                        }
                    });
                }
                return true;
            }
        });
    }

    /**
     * OEM WebViews differ in font scale, dark-mode forcing and zoom defaults.
     * Keep the page on a 1:1 viewport on every Android device instead of
     * relying on one vendor's defaults. Safe to call repeatedly.
     */
    private void applyViewportCompatibility() {
        if (getBridge() == null || getBridge().getWebView() == null) return;
        WebView webView = getBridge().getWebView();
        android.webkit.WebSettings settings = webView.getSettings();
        try {
            settings.setTextZoom(100);
            settings.setLayoutAlgorithm(android.webkit.WebSettings.LayoutAlgorithm.NORMAL);
            settings.setMinimumFontSize(1);
            settings.setMinimumLogicalFontSize(1);
            settings.setDefaultFontSize(16);
            settings.setDefaultFixedFontSize(13);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            settings.setSupportZoom(false);
            settings.setBuiltInZoomControls(false);
            settings.setDisplayZoomControls(false);
            settings.setSupportMultipleWindows(false);
            settings.setJavaScriptCanOpenWindowsAutomatically(false);
            settings.setMediaPlaybackRequiresUserGesture(false);
            // Samsung/Xiaomi/OPPO/vivo force-dark can invert a light WebView
            // and leave transparent overlays with unreadable or misleading
            // paint. The app already has its own night appearance.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    settings.setForceDark(android.webkit.WebSettings.FORCE_DARK_OFF);
                } catch (Throwable ignored) {
                }
            }
            if (Build.VERSION.SDK_INT >= 33) {
                try {
                    settings.setAlgorithmicDarkeningAllowed(false);
                } catch (Throwable ignored) {
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                try {
                    webView.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, true);
                } catch (Throwable ignored) {
                }
            }
            webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
            webView.setHorizontalScrollBarEnabled(false);
            webView.setVerticalScrollBarEnabled(false);
            webView.setFocusable(true);
            webView.setFocusableInTouchMode(true);
            webView.requestFocus(View.FOCUS_DOWN);
        } catch (Throwable error) {
            Log.w(TAG, "WebView viewport adaptation skipped: " + error.getClass().getSimpleName());
        }
    }

    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        applyViewportCompatibility();
    }

    @Override
    public void onResume() {
        super.onResume();
        PushNotificationWorker.markAppVisible(this);
        // OEMs can reset zoom/text settings around configuration changes while
        // the app is backgrounded. Re-apply the viewport policy on resume.
        applyViewportCompatibility();
        try {
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public void onPause() {
        PushNotificationWorker.markAppVisible(this);
        super.onPause();
    }
}