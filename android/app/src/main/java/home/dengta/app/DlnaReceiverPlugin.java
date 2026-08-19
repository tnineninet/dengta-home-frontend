package home.dengta.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * DLNA 接收端 Capacitor 插件。
 *
 * 方法：
 *   start()          — 启动 DLNA 接收服务（前台服务，在局域网注册为 MediaRenderer）
 *   stop()           — 停止接收
 *   getState()       — 查询状态（active/port/transportState/currentUri/pendingUri/pendingTitle）
 *   clearPending()   — 清空待处理媒体信息
 *
 * 事件：
 *   mediaReceived    — 视频 App 投屏到了一个媒体 URL → { uri, title, metaJson }
 *   stateChanged     — 服务启停状态变化 → { state: "running"|"stopped" }
 */
@CapacitorPlugin(name = "DlnaReceiver")
public final class DlnaReceiverPlugin extends Plugin {

    private static final String EVENT_MEDIA_RECEIVED = "mediaReceived";
    private static final String EVENT_STATE_CHANGED = "stateChanged";

    private DlnaStateReceiver stateReceiver;
    private boolean broadcastRegistered = false;

    @Override
    public void load() {
        super.load();
        registerBroadcastReceivers();
        // 默认开启 DLNA 投屏接收，自动启动前台服务
        // 用户可以在设置中手动关闭（ENABLED_KEY 会记录关闭状态）
        try {
            DlnaReceiverService.ensureEnabledByDefault(getContext());
            ContextCompat.startForegroundService(
                getContext(),
                DlnaReceiverService.startIntent(getContext())
            );
            Log.i("DlnaReceiverPlugin", "auto-start: default enabled, foreground service started");
        } catch (Exception e) {
            Log.w("DlnaReceiverPlugin", "auto-start failed: " + e.getMessage());
        }
    }

    @Override
    protected void handleOnDestroy() {
        unregisterBroadcastReceivers();
        super.handleOnDestroy();
    }

    // ---------------------------------------------------------------- 插件方法

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject state = DlnaReceiverService.buildState(getContext());
        call.resolve(state);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (DlnaReceiverService.isRunning()) {
            call.resolve(DlnaReceiverService.buildState(getContext()));
            return;
        }
        ContextCompat.startForegroundService(
            getContext(),
            DlnaReceiverService.startIntent(getContext())
        );
        call.resolve(DlnaReceiverService.buildState(getContext()));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (!DlnaReceiverService.isRunning()) {
            call.resolve(DlnaReceiverService.buildState(getContext()));
            return;
        }
        ContextCompat.startForegroundService(
            getContext(),
            DlnaReceiverService.stopIntent(getContext())
        );
        call.resolve(DlnaReceiverService.buildState(getContext()));
    }

    @PluginMethod
    public void clearPending(PluginCall call) {
        DlnaReceiverService.clearPending(getContext());
        call.resolve();
    }

    // ---------------------------------------------------------------- 广播接收器

    private void registerBroadcastReceivers() {
        if (broadcastRegistered) return;
        try {
            IntentFilter filter = new IntentFilter();
            filter.addAction(DlnaReceiverService.MEDIA_RECEIVED_ACTION);
            filter.addAction(DlnaReceiverService.ACTION_STATE);
            stateReceiver = new DlnaStateReceiver();
            getContext().registerReceiver(stateReceiver, filter,
                Context.RECEIVER_EXPORTED);
            broadcastRegistered = true;
        } catch (Exception ignored) {
        }
    }

    private void unregisterBroadcastReceivers() {
        if (!broadcastRegistered || stateReceiver == null) return;
        try {
            getContext().unregisterReceiver(stateReceiver);
        } catch (Exception ignored) {
        }
        broadcastRegistered = false;
        stateReceiver = null;
    }

    private class DlnaStateReceiver extends BroadcastReceiver {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null) return;
            String action = intent.getAction();
            if (DlnaReceiverService.MEDIA_RECEIVED_ACTION.equals(action)) {
                JSObject payload = new JSObject();
                payload.put("uri", intent.getStringExtra(DlnaReceiverService.EXTRA_URI));
                payload.put("title", intent.getStringExtra(DlnaReceiverService.EXTRA_TITLE));
                payload.put("metaJson",
                    intent.getStringExtra(DlnaReceiverService.EXTRA_META_JSON));
                notifyListeners(EVENT_MEDIA_RECEIVED, payload);
            } else if (DlnaReceiverService.ACTION_STATE.equals(action)) {
                JSObject payload = new JSObject();
                payload.put("state",
                    intent.getStringExtra(DlnaReceiverService.EXTRA_STATE));
                notifyListeners(EVENT_STATE_CHANGED, payload);
            }
        }
    }
}