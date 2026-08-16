package home.dengta.app;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.drawable.Icon;
import android.media.session.MediaSessionManager;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * 现在播放识别（活动感知-音乐）：监听系统媒体通知（网易云/QQ音乐/系统播放器等
 * 播放时都会发通知），从中提取歌曲标题/歌手/专辑/封面。
 * 相比 MediaSessionManager.getActiveSessions，通知监听在 Android 13+ 不需要
 * 特殊权限（仅需用户在系统设置中授权"通知使用权"）。
 */
public final class NowPlayingListenerService extends NotificationListenerService {
    private static final String TAG = "NowPlaying";
    // 缓存的最近一条媒体通知
    private static volatile StatusBarNotification cachedMediaNotification = null;
    private static volatile long cachedAt = 0L;

    // 媒体通知的包名黑名单（明显不是音乐的）
    private static final String[] NON_MEDIA_MARKERS = {
        "weixin", "wechat", "qq.", "taobao", "jd.", "meituan", "ele.me",
        "dianping", "zhihu", "douyin", "kuaishou", "dingtalk", "telegram",
        "whatsapp", "facebook", "instagram", "youtube"
    };

    public static StatusBarNotification getCachedMediaNotification() {
        return cachedMediaNotification;
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        try {
            Notification notification = sbn.getNotification();
            if (notification == null) return;
            if (!isMediaNotification(sbn, notification)) return;
            cachedMediaNotification = sbn;
            cachedAt = System.currentTimeMillis();
        } catch (Exception ignored) {
            // 解析失败不影响
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {
        try {
            if (cachedMediaNotification != null &&
                cachedMediaNotification.getKey().equals(sbn.getKey())) {
                cachedMediaNotification = null;
                cachedAt = 0L;
            }
        } catch (Exception ignored) {
        }
    }

    private boolean isMediaNotification(StatusBarNotification sbn, Notification notification) {
        // 1) 有媒体样式（MediaStyle）的通知
        if (notification.extras != null) {
            String template = String.valueOf(notification.extras.getString(Notification.EXTRA_TEMPLATE));
            if (template != null && template.contains("MediaStyle")) return true;
        }
        // 2) 有标题 + 文本，且包名不是明显非媒体应用
        String pkg = sbn.getPackageName() == null ? "" : sbn.getPackageName().toLowerCase();
        for (String marker : NON_MEDIA_MARKERS) {
            if (pkg.contains(marker)) return false;
        }
        if (notification.extras != null) {
            CharSequence title = notification.extras.getCharSequence(Notification.EXTRA_TITLE);
            CharSequence text = notification.extras.getCharSequence(Notification.EXTRA_TEXT);
            if (title != null && title.length() > 0 && text != null && text.length() > 0) {
                return true;
            }
        }
        return false;
    }
}
