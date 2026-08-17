package home.dengta.app;

import android.app.AppOpsManager;
import android.app.Notification;
import android.app.usage.UsageEvents;
import android.os.Bundle;
import android.graphics.drawable.Icon;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import org.json.JSONObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@CapacitorPlugin(name = "DeviceActivity")
public final class DeviceActivityPlugin extends Plugin {
    private static final String PREFERENCES = "dengta_device_activity";
    private MediaController cachedNowPlayingController = null;
    private static final String ENABLED_KEY = "enabled";
    private static final int DEFAULT_WINDOW_MINUTES = 30;
    private static final int MAX_APPS = 6;

    private static final String[] PRIVATE_APP_MARKERS = {
        "bank", "banking", "pay", "payment", "wallet", "finance",
        "credit", "password", "passwd", "authenticator",
        "keychain", "vault", "token", "otp", "银行", "支付", "钱包",
        "密码", "验证器", "认证器", "令牌"
    };

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(buildState());
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        Boolean enabled = call.getBoolean("enabled");
        if (enabled == null) {
            call.reject("缺少活动感知开关状态。");
            return;
        }
        preferences().edit().putBoolean(ENABLED_KEY, enabled).apply();
        call.resolve(buildState());
    }

    @PluginMethod
    public void openUsageAccessSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve(buildState());
        } catch (Exception directSettingsError) {
            try {
                Intent fallback = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve(buildState());
            } catch (Exception error) {
                call.reject("无法打开系统使用情况访问授权页。");
            }
        }
    }

    @PluginMethod
    public void getRecentSummary(PluginCall call) {
        JSObject state = buildState();
        if (!state.getBoolean("supported", false)) {
            call.reject("当前 Android 版本不支持活动摘要。");
            return;
        }
        if (!state.getBoolean("enabled", false)) {
            call.reject("活动感知尚未开启。");
            return;
        }
        if (!state.getBoolean("permissionGranted", false)) {
            call.reject("尚未授予使用情况访问权限。");
            return;
        }

        int windowMinutes = boundedWindow(call.getInt("windowMinutes"));
        long endTime = System.currentTimeMillis();
        long startTime = endTime - windowMinutes * 60_000L;
        try {
            UsageStatsManager manager = (UsageStatsManager) getContext()
                .getSystemService(Context.USAGE_STATS_SERVICE);
            if (manager == null) {
                call.reject("系统没有提供活动统计服务。");
                return;
            }

            Map<String, ActivityRecord> records = new HashMap<>();
            UsageEvents events = manager.queryEvents(startTime, endTime);
            UsageEvents.Event event = new UsageEvents.Event();
            while (events != null && events.hasNextEvent()) {
                events.getNextEvent(event);
                String packageName = cleanPackageName(event.getPackageName());
                if (packageName.isEmpty() || isAlwaysExcluded(packageName)) continue;

                int eventType = event.getEventType();
                long eventTime = Math.max(startTime, Math.min(endTime, event.getTimeStamp()));
                ActivityRecord record = records.computeIfAbsent(
                    packageName,
                    ignored -> new ActivityRecord(packageName)
                );
                if (eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
                    if (record.activeSince < 0L) {
                        record.activeSince = eventTime;
                        record.launchCount += 1;
                    }
                } else if (
                    eventType == UsageEvents.Event.ACTIVITY_PAUSED ||
                    eventType == UsageEvents.Event.ACTIVITY_STOPPED
                ) {
                    record.finish(eventTime);
                }
            }
            for (ActivityRecord record : records.values()) {
                record.finish(endTime);
            }

            Map<String, UsageStats> aggregate = manager.queryAndAggregateUsageStats(
                startTime,
                endTime
            );
            if (aggregate != null) {
                for (Map.Entry<String, UsageStats> item : aggregate.entrySet()) {
                    String packageName = cleanPackageName(item.getKey());
                    if (packageName.isEmpty() || isAlwaysExcluded(packageName)) continue;
                    UsageStats usage = item.getValue();
                    if (usage == null || usage.getTotalTimeInForeground() <= 0L) continue;
                    ActivityRecord record = records.computeIfAbsent(
                        packageName,
                        ignored -> new ActivityRecord(packageName)
                    );
                    record.foregroundMillis = Math.max(
                        record.foregroundMillis,
                        Math.min(
                            endTime - startTime,
                            usage.getTotalTimeInForeground()
                        )
                    );
                }
            }

            List<ActivityRecord> visible = new ArrayList<>();
            for (ActivityRecord record : records.values()) {
                record.name = applicationName(record.packageName);
                if (
                    record.foregroundMillis <= 0L ||
                    isPrivateApp(record.packageName, record.name)
                ) {
                    continue;
                }
                visible.add(record);
            }
            visible.sort(
                Comparator.comparingLong((ActivityRecord item) -> item.foregroundMillis)
                    .reversed()
                    .thenComparing(
                        Comparator.comparingInt((ActivityRecord item) -> item.launchCount)
                            .reversed()
                    )
            );

            JSArray apps = new JSArray();
            for (int index = 0; index < Math.min(MAX_APPS, visible.size()); index += 1) {
                ActivityRecord record = visible.get(index);
                JSObject app = new JSObject();
                app.put("name", record.name);
                app.put("launchCount", Math.min(100, Math.max(0, record.launchCount)));
                app.put(
                    "foregroundSeconds",
                    Math.min(
                        windowMinutes * 60,
                        Math.max(0L, Math.round(record.foregroundMillis / 1000.0))
                    )
                );
                apps.put(app);
            }

            JSObject result = new JSObject();
            result.put("capturedAt", isoTimestamp(endTime));
            result.put("windowMinutes", windowMinutes);
            result.put("apps", apps);
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject("使用情况访问权限已经失效，请重新授权。");
        } catch (Exception error) {
            call.reject("暂时无法读取活动摘要。");
        }
    }

    @PluginMethod
    public void clear(PluginCall call) {
        preferences().edit().clear().apply();
        call.resolve(buildState());
    }

    private JSObject buildState() {
        JSObject state = new JSObject();
        state.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP);
        state.put("enabled", preferences().getBoolean(ENABLED_KEY, false));
        state.put("permissionGranted", hasUsageAccess());
        return state;
    }

    /**
     * 当前前台应用（活动感知增强）：读取最近 5 分钟使用记录里最后一条
     * ACTIVITY_RESUMED 事件，返回正在使用的应用名与开始时间。
     */
    @PluginMethod
    public void getCurrentApp(PluginCall call) {
        JSObject state = buildState();
        if (!state.getBoolean("supported", false)) {
            call.reject("当前 Android 版本不支持活动感知。");
            return;
        }
        if (!state.getBoolean("enabled", false)) {
            call.reject("活动感知尚未开启。");
            return;
        }
        if (!state.getBoolean("permissionGranted", false)) {
            call.reject("尚未授予使用情况访问权限。");
            return;
        }

        long now = System.currentTimeMillis();
        long startTime = now - 5 * 60_000L;
        try {
            UsageStatsManager manager = (UsageStatsManager) getContext()
                .getSystemService(Context.USAGE_STATS_SERVICE);
            if (manager == null) {
                call.reject("系统没有提供活动统计服务。");
                return;
            }
            long latestTime = -1L;
            String latestPackage = "";
            UsageEvents events = manager.queryEvents(startTime, now);
            UsageEvents.Event event = new UsageEvents.Event();
            while (events != null && events.hasNextEvent()) {
                events.getNextEvent(event);
                if (event.getEventType() != UsageEvents.Event.ACTIVITY_RESUMED) continue;
                String packageName = cleanPackageName(event.getPackageName());
                if (packageName.isEmpty() || isAlwaysExcluded(packageName)) continue;
                if (event.getTimeStamp() > latestTime) {
                    latestTime = event.getTimeStamp();
                    latestPackage = packageName;
                }
            }
            JSObject result = new JSObject();
            if (latestPackage.isEmpty() || isPrivateApp(latestPackage, applicationName(latestPackage))) {
                result.put("currentApp", JSONObject.NULL);
                call.resolve(result);
                return;
            }
            JSObject currentApp = new JSObject();
            currentApp.put("packageName", latestPackage);
            currentApp.put("name", applicationName(latestPackage));
            currentApp.put("sinceSeconds", Math.min(300L, Math.max(0L, (now - latestTime) / 1000L)));
            result.put("currentApp", currentApp);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("读取当前应用失败：" + truncate(String.valueOf(error.getMessage()), 120));
        }
    }


    /**
     * 当前正在播放的歌曲（活动感知-音乐识别）：读取系统 MediaSessionManager
     * 的活动媒体会话，返回标题/歌手/专辑/时长/进度/播放状态/封面（缩略图）。
     * 无论用户在网易云、QQ 音乐、系统播放器还是本 App 内放歌都能识别，
     * 不依赖"使用情况访问"授权（系统媒体会话是只读公开信息）。
     */
    @PluginMethod
    public void getNowPlaying(PluginCall call) {
        // 1) 优先读取通知监听缓存（Android 13+ 媒体会话可见性受限，通知是最可靠的来源）
        JSObject fromNotification = buildNowPlayingFromNotification();
        if (fromNotification != null) {
            call.resolve(fromNotification);
            return;
        }
        // 2) 回退：尝试 MediaSessionManager（部分旧系统或同 App 会话可用）
        try {
            MediaSessionManager manager = (MediaSessionManager) getContext()
                .getSystemService(Context.MEDIA_SESSION_SERVICE);
            if (manager != null) {
                java.util.List<MediaController> controllers = manager.getActiveSessions(null);
                MediaController best = null;
                long bestActive = -1L;
                if (controllers != null) {
                    for (MediaController controller : controllers) {
                        if (controller == null) continue;
                        // 只认音乐播放器：跳过视频类 App（B站/腾讯视频/抖音等）的媒体会话
                        String sessionPkg = controller.getPackageName() == null
                            ? "" : controller.getPackageName().toLowerCase();
                        if (isVideoPackage(sessionPkg)) continue;
                        PlaybackState state = controller.getPlaybackState();
                        if (state == null) continue;
                        long lastActive = state.getLastPositionUpdateTime();
                        boolean playing = state.getState() == PlaybackState.STATE_PLAYING;
                        boolean buffering = state.getState() == PlaybackState.STATE_BUFFERING;
                        if (playing || buffering) {
                            best = controller;
                            break;
                        }
                        if (lastActive > bestActive) {
                            bestActive = lastActive;
                            best = controller;
                        }
                    }
                }
                cachedNowPlayingController = best;
                if (best != null) {
                    call.resolve(buildNowPlaying(best));
                    return;
                }
            }
        } catch (Exception ignored) {
            // 回退失败则返回空
        }
        call.resolve(buildNowPlaying(null));
    }

    private static final String[] VIDEO_PACKAGE_MARKERS = {
        "bilibili", "youku", "iqiyi", "qiyi", "tencent.video", "qqvideo",
        "douyin", "kuaishou", "huya", "douyu", "mgtv", "sohu.video",
        "weishi", "quanmin", "soul", "youtube", "twitch", "video"
    };

    private boolean isVideoPackage(String pkg) {
        if (pkg == null || pkg.isEmpty()) return false;
        for (String marker : VIDEO_PACKAGE_MARKERS) {
            if (pkg.contains(marker)) return true;
        }
        return false;
    }

    /** 从通知监听缓存构建 nowPlaying（标题/歌手/封面/播放状态）。 */
    private JSObject buildNowPlayingFromNotification() {
        try {
            android.service.notification.StatusBarNotification sbn =
                NowPlayingListenerService.getCachedMediaNotification();
            if (sbn == null) return null;
            Notification notification = sbn.getNotification();
            if (notification == null) return null;
            Bundle extras = notification.extras;
            if (extras == null) return null;
            CharSequence titleCs = extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence textCs = extras.getCharSequence(Notification.EXTRA_TEXT);
            String title = titleCs == null ? "" : String.valueOf(titleCs).trim();
            String text = textCs == null ? "" : String.valueOf(textCs).trim();
            if (title.isEmpty() && text.isEmpty()) return null;

            JSObject song = new JSObject();
            song.put("title", truncate(title, 120));
            song.put("artist", truncate(text, 120));
            song.put("album", "");
            song.put("packageName", truncate(sbn.getPackageName() == null ? "" : sbn.getPackageName(), 80));
            // 播放状态：网易云等媒体通知通常带媒体会话；无法直接判断时默认 true（有媒体通知=在播）
            song.put("isPlaying", true);
            song.put("duration", 0L);
            song.put("position", 0L);

            String cover = "";
            try {
                Icon largeIcon = notification.getLargeIcon();
                if (largeIcon == null) {
                    // 尝试从 extras 拿封面位图
                    Bitmap artwork = extras.getParcelable(Notification.EXTRA_PICTURE);
                    if (artwork == null) {
                        artwork = extras.getParcelable(Notification.EXTRA_LARGE_ICON);
                    }
                    if (artwork != null) {
                        cover = bitmapToDataUrl(artwork);
                    }
                } else {
                    cover = iconToDataUrl(largeIcon);
                }
            } catch (Exception ignored) {
                cover = "";
            }
            song.put("cover", cover);
            JSObject result = new JSObject();
            result.put("nowPlaying", song);
            return result;
        } catch (Exception ignored) {
            return null;
        }
    }

    private String bitmapToDataUrl(Bitmap bitmap) {
        try {
            if (bitmap == null) return "";
            int width = bitmap.getWidth();
            int height = bitmap.getHeight();
            if (width > 96 || height > 96) {
                float scale = Math.min(96f / width, 96f / height);
                int newWidth = Math.max(1, Math.round(width * scale));
                int newHeight = Math.max(1, Math.round(height * scale));
                Bitmap scaled = Bitmap.createScaledBitmap(bitmap, newWidth, newHeight, true);
                if (scaled != bitmap) bitmap.recycle();
                bitmap = scaled;
            }
            java.io.ByteArrayOutputStream stream = new java.io.ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream);
            String data = "data:image/png;base64," +
                android.util.Base64.encodeToString(stream.toByteArray(), android.util.Base64.NO_WRAP);
            stream.close();
            bitmap.recycle();
            return data;
        } catch (Exception ignored) {
            return "";
        }
    }

    private String iconToDataUrl(Icon icon) {
        try {
            if (icon == null) return "";
            android.graphics.drawable.Drawable drawable = icon.loadDrawable(getContext());
            if (drawable instanceof android.graphics.drawable.BitmapDrawable) {
                Bitmap bitmap = ((android.graphics.drawable.BitmapDrawable) drawable).getBitmap();
                return bitmapToDataUrl(bitmap);
            }
            return "";
        } catch (Exception ignored) {
            return "";
        }
    }

    /** 通知使用权是否已授权。 */
    @PluginMethod
    public void getNotificationAccessState(PluginCall call) {
        JSObject state = new JSObject();
        try {
            String flat = Settings.Secure.getString(getContext().getContentResolver(),
                "enabled_notification_listeners");
            String ownComponent = getContext().getPackageName() + "/" +
                NowPlayingListenerService.class.getName();
            state.put("granted", flat != null && flat.contains(ownComponent));
        } catch (Exception ignored) {
            state.put("granted", false);
        }
        call.resolve(state);
    }

    /** 打开系统"通知使用权"设置页。 */
    @PluginMethod
    public void openNotificationAccessSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("无法打开通知使用权设置。");
        }
    }

    private JSObject buildNowPlaying(MediaController controller) {
        JSObject result = new JSObject();
        if (controller == null) {
            result.put("nowPlaying", JSONObject.NULL);
            return result;
        }
        MediaMetadata metadata = controller.getMetadata();
        PlaybackState state = controller.getPlaybackState();
        JSObject song = new JSObject();
        String title = metadata == null ? null : metadata.getString(MediaMetadata.METADATA_KEY_TITLE);
        String artist = metadata == null ? null : metadata.getString(MediaMetadata.METADATA_KEY_ARTIST);
        String album = metadata == null ? null : metadata.getString(MediaMetadata.METADATA_KEY_ALBUM);
        song.put("title", truncate(title == null ? "" : title, 120));
        song.put("artist", truncate(artist == null ? "" : artist, 120));
        song.put("album", truncate(album == null ? "" : album, 120));
        song.put("packageName", truncate(controller.getPackageName() == null ? "" : controller.getPackageName(), 80));
        song.put("isPlaying", state != null && state.getState() == PlaybackState.STATE_PLAYING);
        // PlaybackState 没有 getDuration；时长从元数据取（毫秒）。
        long durationMs = 0L;
        if (metadata != null) {
            durationMs = Math.max(0L, metadata.getLong(MediaMetadata.METADATA_KEY_DURATION));
        }
        song.put("duration", durationMs);
        song.put("position", state == null ? 0L : Math.max(0L, state.getPosition()));
        // 封面缩略图（base64 PNG，控制在 ~96px 内）
        String cover = "";
        try {
            Bitmap artwork = metadata == null ? null : metadata.getBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART);
            if (artwork == null && metadata != null) {
                artwork = metadata.getBitmap(MediaMetadata.METADATA_KEY_DISPLAY_ICON);
            }
            if (artwork != null) {
                int width = artwork.getWidth();
                int height = artwork.getHeight();
                if (width > 96 || height > 96) {
                    float scale = Math.min(96f / width, 96f / height);
                    int newWidth = Math.max(1, Math.round(width * scale));
                    int newHeight = Math.max(1, Math.round(height * scale));
                    Bitmap scaled = Bitmap.createScaledBitmap(artwork, newWidth, newHeight, true);
                    if (scaled != artwork) artwork.recycle();
                    artwork = scaled;
                }
                java.io.ByteArrayOutputStream stream = new java.io.ByteArrayOutputStream();
                artwork.compress(Bitmap.CompressFormat.PNG, 100, stream);
                cover = "data:image/png;base64," +
                    android.util.Base64.encodeToString(stream.toByteArray(), android.util.Base64.NO_WRAP);
                stream.close();
                artwork.recycle();
            }
        } catch (Exception ignored) {
            cover = "";
        }
        song.put("cover", cover);
        result.put("nowPlaying", song);
        return result;
    }


    /**
     * 控制当前播放（播放/暂停/下一首）：通过缓存的系统 MediaController 下发
     * transportControls 指令。部分第三方 App 可能拒绝外部控制，失败时返回 false，
     * 前端保持乐观 UI 即可。
     */
    @PluginMethod
    public void controlNowPlaying(PluginCall call) {
        String action = call.getString("action", "toggle");
        try {
            if (cachedNowPlayingController == null) {
                // 重新探测一次，避免轮询间隙 controller 丢失
                MediaSessionManager manager = (MediaSessionManager) getContext()
                    .getSystemService(Context.MEDIA_SESSION_SERVICE);
                if (manager != null) {
                    java.util.List<MediaController> controllers = manager.getActiveSessions(null);
                    if (!controllers.isEmpty()) {
                        cachedNowPlayingController = controllers.get(0);
                    }
                }
            }
            if (cachedNowPlayingController == null) {
                call.resolve(new JSObject().put("controlled", false));
                return;
            }
            MediaController.TransportControls controls = cachedNowPlayingController.getTransportControls();
            if (controls == null) {
                call.resolve(new JSObject().put("controlled", false));
                return;
            }
            boolean controlled = true;
            if ("play".equals(action)) {
                controls.play();
            } else if ("pause".equals(action)) {
                controls.pause();
            } else if ("toggle".equals(action)) {
                PlaybackState state = cachedNowPlayingController.getPlaybackState();
                if (state != null && state.getState() == PlaybackState.STATE_PLAYING) {
                    controls.pause();
                } else {
                    controls.play();
                }
            } else if ("next".equals(action)) {
                controls.skipToNext();
            } else {
                controlled = false;
            }
            call.resolve(new JSObject().put("controlled", controlled));
        } catch (Exception error) {
            call.resolve(new JSObject().put("controlled", false));
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    private boolean hasUsageAccess() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP) return false;
        AppOpsManager manager = (AppOpsManager) getContext()
            .getSystemService(Context.APP_OPS_SERVICE);
        if (manager == null) return false;
        int mode;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            mode = manager.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                getContext().getPackageName()
            );
        } else {
            mode = manager.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                android.os.Process.myUid(),
                getContext().getPackageName()
            );
        }
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    private static int boundedWindow(Integer value) {
        int requested = value == null ? DEFAULT_WINDOW_MINUTES : value;
        return Math.min(120, Math.max(5, requested));
    }

    private String applicationName(String packageName) {
        try {
            PackageManager manager = getContext().getPackageManager();
            ApplicationInfo info = manager.getApplicationInfo(packageName, 0);
            String label = String.valueOf(manager.getApplicationLabel(info)).trim();
            if (!label.isEmpty()) return truncate(label, 40);
        } catch (Exception ignored) {
            // Package visibility differs across Android vendors; use a neutral name.
        }
        return "其他应用";
    }

    private boolean isAlwaysExcluded(String packageName) {
        String ownPackage = getContext().getPackageName();
        String value = packageName.toLowerCase(Locale.ROOT);
        return packageName.equals(ownPackage) ||
            value.equals("com.android.systemui") ||
            value.contains("launcher") ||
            value.contains("permissioncontroller") ||
            value.contains("packageinstaller");
    }

    private static boolean isPrivateApp(String packageName, String label) {
        String value = (packageName + " " + label).toLowerCase(Locale.ROOT);
        for (String marker : PRIVATE_APP_MARKERS) {
            if (value.contains(marker)) return true;
        }
        return false;
    }

    private static String cleanPackageName(String value) {
        if (value == null) return "";
        return truncate(value.trim(), 200);
    }

    private static String truncate(String value, int maxLength) {
        if (value.length() <= maxLength) return value;
        return value.substring(0, maxLength);
    }

    private static String isoTimestamp(long value) {
        java.text.SimpleDateFormat formatter = new java.text.SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            Locale.US
        );
        formatter.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
        return formatter.format(new java.util.Date(value));
    }

    private static final class ActivityRecord {
        final String packageName;
        String name = "其他应用";
        long activeSince = -1L;
        long foregroundMillis = 0L;
        int launchCount = 0;

        ActivityRecord(String packageName) {
            this.packageName = packageName;
        }

        void finish(long endTime) {
            if (activeSince < 0L) return;
            foregroundMillis += Math.max(0L, endTime - activeSince);
            activeSince = -1L;
        }
    }
}
