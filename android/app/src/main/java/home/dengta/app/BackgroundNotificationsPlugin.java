package home.dengta.app;

import android.content.Intent;
import android.provider.Settings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BackgroundNotifications")
public final class BackgroundNotificationsPlugin extends Plugin {
    private JSObject pendingLaunchTarget;
    private String pendingLaunchUrl = "";

    @Override
    public void load() {
        captureLaunchTarget(getActivity().getIntent(), false);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        captureLaunchTarget(intent, true);
    }

    @PluginMethod
    public void consumeLaunchTarget(PluginCall call) {
        JSObject target = pendingLaunchTarget;
        pendingLaunchTarget = null;
        if (target == null) {
            target = new JSObject();
            target.put("available", false);
        }
        // 冷启动/单实例复用时，把深链 intent 的数据 URI 一并交给 Web 层
        // （@capacitor/app 的 appUrlOpen 对首个 intent 可能不触发）。
        if (!pendingLaunchUrl.isEmpty()) {
            target.put("url", pendingLaunchUrl);
            pendingLaunchUrl = "";
        }
        call.resolve(target);
    }

    @PluginMethod
    public void configure(PluginCall call) {
        String installationToken = clean(
            call.getString("installationToken"),
            8192
        );
        Long expiresAtValue = call.getLong("expiresAt");
        long expiresAt = expiresAtValue == null
            ? 0L
            : expiresAtValue;
        String deviceId = clean(call.getString("deviceId"), 80);
        String userId = clean(call.getString("userId"), 80);
        String companionId = clean(call.getString("companionId"), 80);
        if (
            installationToken.isEmpty() ||
            expiresAt <= 0L ||
            deviceId.isEmpty() ||
            userId.isEmpty() ||
            companionId.isEmpty()
        ) {
            call.reject("登录身份或伴侣作用域不完整。");
            return;
        }
        try {
            String nextScope = userId + ":" + companionId;
            boolean scopeChanged = !nextScope.equals(
                BackgroundNotificationCredentials.currentScopeKey(
                    getContext()
                )
            );
            if (scopeChanged) {
                stopScreenGlanceAndClearCache();
            }
            BackgroundNotificationCredentials.store(
                getContext(),
                installationToken,
                expiresAt,
                deviceId,
                userId,
                companionId
            );
            PushNotificationWorker.configure(
                getContext(),
                scopeChanged
            );
            JSObject result = new JSObject();
            result.put("configured", true);
            result.put("scopeChanged", scopeChanged);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法安全保存后台通知登录状态。");
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        stopScreenGlanceAndClearCache();
        BackgroundNotificationCredentials.clear(getContext());
        PushNotificationWorker.clear(getContext());
        JSObject result = new JSObject();
        result.put("configured", false);
        call.resolve(result);
    }

    @PluginMethod
    public void openReminderChannelSettings(PluginCall call) {
        PushNotificationWorker.ensureNotificationChannel(getContext());
        Intent intent = new Intent(
            Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS
        )
            .putExtra(
                Settings.EXTRA_APP_PACKAGE,
                getContext().getPackageName()
            )
            .putExtra(
                Settings.EXTRA_CHANNEL_ID,
                PushNotificationWorker.CHANNEL_ID
            )
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            getContext().startActivity(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("无法打开手机通知设置。");
        }
    }

    private void stopScreenGlanceAndClearCache() {
        ScreenGlanceService.sendAction(
            getContext(),
            ScreenGlanceService.ACTION_STOP
        );
        ScreenGlanceService.deleteLatestCapture(getContext());
        ScreenGlanceService.deleteCoWatchPreview(getContext());
    }

    private void captureLaunchTarget(Intent intent, boolean notify) {
        if (intent == null) return;
        // 深链 URI（dengta://room/join?code=...、https://dengtahome.com/room/join?...、
        // dengta://auth#...）：通知 extra 缺失时也视为有效启动目标。
        if (Intent.ACTION_VIEW.equals(intent.getAction()) && intent.getData() != null) {
            pendingLaunchUrl = clean(intent.getData().toString(), 2048);
            JSObject target = new JSObject();
            target.put("available", true);
            target.put("url", pendingLaunchUrl);
            pendingLaunchTarget = target;
            if (notify) notifyListeners("notificationTarget", target, true);
            return;
        }
        String view = clean(intent.getStringExtra("dengta_view"), 40);
        String sessionId = clean(
            intent.getStringExtra("dengta_session_id"),
            100
        );
        if (view.isEmpty() && sessionId.isEmpty()) return;
        JSObject target = new JSObject();
        target.put("available", true);
        target.put("view", view);
        target.put("sessionId", sessionId);
        pendingLaunchTarget = target;
        intent.removeExtra("dengta_view");
        intent.removeExtra("dengta_session_id");
        if (notify) notifyListeners("notificationTarget", target, true);
    }

    private static String clean(String value, int maxLength) {
        if (value == null) return "";
        String normalized = value.trim();
        if (normalized.length() <= maxLength) return normalized;
        return normalized.substring(0, maxLength);
    }
}
