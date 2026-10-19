package home.dengta.app;

import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "DengTaMainActivity";
    private boolean rendererRecoveryScheduled = false;

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
        registerPlugin(AppNavigationPlugin.class);
        registerPlugin(AppUpdatesPlugin.class);
        super.onCreate(savedInstanceState);
        configureStableWebView();
        PushNotificationWorker.ensureNotificationChannel(this);
        PushNotificationWorker.schedule(this);
        AppUpdateWorker.schedule(this);
        PushNotificationWorker.markAppVisible(this);
    }

    private void configureStableWebView() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }

        WebView webView = getBridge().getWebView();
        webView.setLayerType(View.LAYER_TYPE_NONE, null);
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

    @Override
    public void onResume() {
        super.onResume();
        PushNotificationWorker.markAppVisible(this);
        // 启动随机播放等场景需要无手势自动播放；Capacitor 可能在初始化时重设设置，这里再强调一次。
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
