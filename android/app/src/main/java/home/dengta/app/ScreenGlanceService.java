package home.dengta.app;

import android.app.KeyguardManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.app.usage.UsageEvents;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.PixelFormat;
import android.graphics.Rect;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.Image;
import android.media.ImageReader;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Base64;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import android.view.WindowMetrics;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.ByteBuffer;
import java.text.SimpleDateFormat;
import java.text.ParseException;
import java.util.Date;
import java.util.Locale;
import java.util.Random;
import java.util.TimeZone;

public final class ScreenGlanceService extends Service {
    static final String ACTION_START = "home.dengta.app.screen_glance.START";
    static final String ACTION_CAPTURE = "home.dengta.app.screen_glance.CAPTURE";
    static final String ACTION_PAUSE = "home.dengta.app.screen_glance.PAUSE";
    static final String ACTION_RESUME = "home.dengta.app.screen_glance.RESUME";
    static final String ACTION_STOP = "home.dengta.app.screen_glance.STOP";
    static final String ACTION_CONFIGURE = "home.dengta.app.screen_glance.CONFIGURE";

    private static final String EXTRA_RESULT_CODE = "projection_result_code";
    private static final String EXTRA_RESULT_DATA = "projection_result_data";
    private static final String CHANNEL_ID = "dengta-screen-glance-v1";
    private static final int NOTIFICATION_ID = 9427;
    private static final String PREFS_NAME = "dengta_screen_glance";
    private static final String RANDOM_ENABLED_KEY = "random_enabled";
    private static final String MINIMUM_MINUTES_KEY = "minimum_minutes";
    private static final String MAXIMUM_MINUTES_KEY = "maximum_minutes";
    private static final String WIFI_ONLY_KEY = "wifi_only";
    private static final String CHARGING_ONLY_KEY = "charging_only";
    private static final String CAPTURED_AT_KEY = "captured_at";
    private static final String CAPTURE_WIDTH_KEY = "capture_width";
    private static final String CAPTURE_HEIGHT_KEY = "capture_height";
    private static final String NEXT_CAPTURE_AT_KEY = "next_capture_at";
    private static final String LAST_ERROR_KEY = "last_error";
    private static final long CAPTURE_TTL_MS = 6L * 60L * 60L * 1000L;
    private static final long RETRY_DELAY_MS = 5L * 60L * 1000L;
    private static final long FOREGROUND_EVENT_LOOKBACK_MS =
        24L * 60L * 60L * 1000L;
    private static final int MAX_CAPTURE_EDGE = 1280;
    private static final int MAX_CAPTURE_BYTES = 1_400_000;
    private static final String[] PRIVATE_APP_MARKERS = {
        "bank", "banking", "pay", "payment", "wallet", "finance",
        "credit", "password", "passwd", "authenticator", "keychain",
        "vault", "token", "otp", "银行", "支付", "钱包", "密码",
        "验证器", "认证器", "令牌"
    };

    private static volatile ScreenGlanceService activeInstance;

    private final Handler mainHandler = new Handler(android.os.Looper.getMainLooper());
    private final Random random = new Random();
    private MediaProjection mediaProjection;
    private VirtualDisplay virtualDisplay;
    private ImageReader imageReader;
    private HandlerThread captureThread;
    private Handler captureHandler;
    private boolean paused = false;
    private boolean captureRequested = false;
    private boolean randomCaptureRequested = false;
    private boolean stopping = false;
    private long nextCaptureAt = 0L;

    private final Runnable randomCaptureRunnable = new Runnable() {
        @Override
        public void run() {
            nextCaptureAt = 0L;
            preferences(ScreenGlanceService.this)
                .edit()
                .remove(NEXT_CAPTURE_AT_KEY)
                .apply();
            if (!isSessionActive() || !randomEnabled()) return;
            String blockedReason = captureBlockedReason(true);
            if (blockedReason.isEmpty()) {
                requestFrame(true);
                scheduleNextRandomCapture();
            } else {
                recordError(blockedReason);
                scheduleRandomCapture(RETRY_DELAY_MS);
            }
        }
    };

    private final MediaProjection.Callback projectionCallback =
        new MediaProjection.Callback() {
            @Override
            public void onStop() {
                mainHandler.post(() -> stopProjection(false));
            }
        };

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        ensureNotificationChannel(this);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? "" : String.valueOf(intent.getAction());
        if (ACTION_STOP.equals(action)) {
            stopProjection(true);
            return START_NOT_STICKY;
        }
        if (ACTION_PAUSE.equals(action)) {
            paused = true;
            captureRequested = false;
            randomCaptureRequested = false;
            updateNotification("已暂停，不会读取新的画面");
            return START_NOT_STICKY;
        }
        if (ACTION_RESUME.equals(action)) {
            paused = false;
            updateNotification("共享进行中，只有获准时才会看一眼");
            scheduleNextRandomCapture();
            return START_NOT_STICKY;
        }
        if (ACTION_CAPTURE.equals(action)) {
            updateNotification("正在确认当前画面是否适合查看…");
            mainHandler.postDelayed(() -> requestFrame(false), 1_200L);
            return START_NOT_STICKY;
        }
        if (ACTION_CONFIGURE.equals(action)) {
            scheduleNextRandomCapture();
            updateNotification(notificationText());
            return START_NOT_STICKY;
        }
        if (ACTION_START.equals(action)) {
            startProjection(intent);
            return START_NOT_STICKY;
        }
        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        stopProjection(false);
        if (activeInstance == this) activeInstance = null;
        super.onDestroy();
    }

    static Intent startIntent(Context context, int resultCode, Intent resultData) {
        return new Intent(context, ScreenGlanceService.class)
            .setAction(ACTION_START)
            .putExtra(EXTRA_RESULT_CODE, resultCode)
            .putExtra(EXTRA_RESULT_DATA, resultData);
    }

    static void sendAction(Context context, String action) {
        Intent intent = new Intent(context, ScreenGlanceService.class).setAction(action);
        if (activeInstance == null) {
            if (ACTION_STOP.equals(action)) deleteLatestCapture(context);
            return;
        }
        try {
            context.startService(intent);
        } catch (Exception ignored) {
            if (ACTION_STOP.equals(action)) deleteLatestCapture(context);
        }
    }

    static boolean requestCapture(boolean randomRequest) {
        ScreenGlanceService service = activeInstance;
        if (service == null || !service.isSessionActive() || service.paused) return false;
        return service.requestFrame(randomRequest);
    }

    static void storeConfig(
        Context context,
        boolean randomEnabled,
        int minimumMinutes,
        int maximumMinutes,
        boolean wifiOnly,
        boolean chargingOnly
    ) {
        preferences(context)
            .edit()
            .putBoolean(RANDOM_ENABLED_KEY, randomEnabled)
            .putInt(MINIMUM_MINUTES_KEY, boundedMinutes(minimumMinutes))
            .putInt(
                MAXIMUM_MINUTES_KEY,
                Math.max(boundedMinutes(minimumMinutes), boundedMinutes(maximumMinutes))
            )
            .putBoolean(WIFI_ONLY_KEY, wifiOnly)
            .putBoolean(CHARGING_ONLY_KEY, chargingOnly)
            .apply();
    }

    static JSObject buildState(Context context) {
        cleanupExpiredCapture(context);
        SharedPreferences prefs = preferences(context);
        ScreenGlanceService service = activeInstance;
        boolean active = service != null && service.isSessionActive();
        JSObject state = new JSObject();
        state.put("supported", Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP);
        state.put("active", active);
        state.put("paused", active && service.paused);
        state.put("randomEnabled", prefs.getBoolean(RANDOM_ENABLED_KEY, false));
        state.put("minimumMinutes", prefs.getInt(MINIMUM_MINUTES_KEY, 60));
        state.put("maximumMinutes", prefs.getInt(MAXIMUM_MINUTES_KEY, 180));
        state.put("wifiOnly", prefs.getBoolean(WIFI_ONLY_KEY, true));
        state.put("chargingOnly", prefs.getBoolean(CHARGING_ONLY_KEY, false));
        state.put("pendingCapture", latestCaptureFile(context).isFile());
        state.put("capturedAt", prefs.getString(CAPTURED_AT_KEY, ""));
        long next = active && service.nextCaptureAt > 0L
            ? service.nextCaptureAt
            : prefs.getLong(NEXT_CAPTURE_AT_KEY, 0L);
        state.put("nextCaptureAt", next > 0L ? isoTimestamp(next) : "");
        state.put("lastError", prefs.getString(LAST_ERROR_KEY, ""));
        return state;
    }

    static JSObject consumeLatestCapture(Context context) throws Exception {
        cleanupExpiredCapture(context);
        File file = latestCaptureFile(context);
        if (!file.isFile()) return null;
        byte[] bytes = java.nio.file.Files.readAllBytes(file.toPath());
        SharedPreferences prefs = preferences(context);
        String capturedAt = prefs.getString(CAPTURED_AT_KEY, "");
        int width = prefs.getInt(CAPTURE_WIDTH_KEY, 0);
        int height = prefs.getInt(CAPTURE_HEIGHT_KEY, 0);
        deleteLatestCapture(context);
        if (bytes.length == 0 || bytes.length > MAX_CAPTURE_BYTES) {
            throw new IllegalStateException("capture_size_invalid");
        }
        JSObject result = new JSObject();
        result.put("mimeType", "image/jpeg");
        result.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
        result.put("capturedAt", capturedAt);
        result.put("width", width);
        result.put("height", height);
        return result;
    }

    static void deleteLatestCapture(Context context) {
        File capture = latestCaptureFile(context);
        File temporary = temporaryCaptureFile(context);
        if (capture.exists()) capture.delete();
        if (temporary.exists()) temporary.delete();
        preferences(context)
            .edit()
            .remove(CAPTURED_AT_KEY)
            .remove(CAPTURE_WIDTH_KEY)
            .remove(CAPTURE_HEIGHT_KEY)
            .apply();
    }

    private void startProjection(Intent intent) {
        if (isSessionActive()) {
            updateNotification(notificationText());
            return;
        }
        startForegroundCompat(buildNotification("正在建立系统屏幕共享…"));
        int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
        Intent resultData = readResultData(intent);
        if (resultCode == 0 || resultData == null) {
            recordError("系统授权结果已经失效，请重新开始共享。");
            stopProjection(true);
            return;
        }
        try {
            MediaProjectionManager manager = (MediaProjectionManager)
                getSystemService(Context.MEDIA_PROJECTION_SERVICE);
            if (manager == null) throw new IllegalStateException("projection_manager_missing");
            mediaProjection = manager.getMediaProjection(resultCode, resultData);
            if (mediaProjection == null) throw new IllegalStateException("projection_missing");
            mediaProjection.registerCallback(projectionCallback, mainHandler);
            createVirtualDisplay();
            paused = false;
            stopping = false;
            recordError("");
            updateNotification(notificationText());
            scheduleNextRandomCapture();
        } catch (Exception error) {
            recordError("屏幕共享没有成功建立，请重新授权。");
            stopProjection(true);
        }
    }

    @SuppressWarnings("deprecation")
    private static Intent readResultData(Intent intent) {
        if (Build.VERSION.SDK_INT >= 33) {
            return intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class);
        }
        return intent.getParcelableExtra(EXTRA_RESULT_DATA);
    }

    private void createVirtualDisplay() {
        CaptureSize size = captureSize();
        captureThread = new HandlerThread("DengTaScreenGlance");
        captureThread.start();
        captureHandler = new Handler(captureThread.getLooper());
        imageReader = ImageReader.newInstance(
            size.width,
            size.height,
            PixelFormat.RGBA_8888,
            2
        );
        imageReader.setOnImageAvailableListener(this::onImageAvailable, captureHandler);
        virtualDisplay = mediaProjection.createVirtualDisplay(
            "DengTaScreenGlance",
            size.width,
            size.height,
            size.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            imageReader.getSurface(),
            null,
            captureHandler
        );
    }

    private boolean requestFrame(boolean randomRequest) {
        if (!isSessionActive() || paused) return false;
        String blockedReason = captureBlockedReason(randomRequest);
        if (!blockedReason.isEmpty()) {
            recordError(blockedReason);
            updateNotification(blockedReason);
            return false;
        }
        captureRequested = true;
        randomCaptureRequested = randomRequest;
        updateNotification("正在读取一帧，原图只保留在本机…");
        return true;
    }

    private void onImageAvailable(ImageReader reader) {
        Image image = null;
        try {
            image = reader.acquireLatestImage();
            if (image == null || !captureRequested || paused || stopping) return;
            captureRequested = false;
            boolean wasRandom = randomCaptureRequested;
            randomCaptureRequested = false;
            Bitmap bitmap = bitmapFromImage(image);
            if (bitmap == null) throw new IllegalStateException("bitmap_missing");
            byte[] encoded = encodeCapture(bitmap);
            int width = bitmap.getWidth();
            int height = bitmap.getHeight();
            bitmap.recycle();
            saveCapture(encoded, width, height);
            recordError("");
            mainHandler.post(() -> updateNotification(
                wasRandom
                    ? "小灯刚刚看了一眼，回到 DengTa 看祂想说什么"
                    : "画面已准备好，回到 DengTa 让小灯回应"
            ));
        } catch (Exception error) {
            recordError("这次没有取得清晰画面，稍后可以再试。");
            mainHandler.post(() -> updateNotification(notificationText()));
        } finally {
            if (image != null) image.close();
        }
    }

    private static Bitmap bitmapFromImage(Image image) {
        Image.Plane[] planes = image.getPlanes();
        if (planes.length == 0) return null;
        Image.Plane plane = planes[0];
        ByteBuffer buffer = plane.getBuffer();
        int width = image.getWidth();
        int height = image.getHeight();
        int pixelStride = plane.getPixelStride();
        int rowStride = plane.getRowStride();
        int rowPadding = Math.max(0, rowStride - pixelStride * width);
        int paddedWidth = width + rowPadding / Math.max(1, pixelStride);
        Bitmap padded = Bitmap.createBitmap(
            paddedWidth,
            height,
            Bitmap.Config.ARGB_8888
        );
        buffer.rewind();
        padded.copyPixelsFromBuffer(buffer);
        if (paddedWidth == width) return padded;
        Bitmap cropped = Bitmap.createBitmap(padded, 0, 0, width, height);
        padded.recycle();
        return cropped;
    }

    private static byte[] encodeCapture(Bitmap bitmap) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 68, output)) {
            throw new IllegalStateException("jpeg_encode_failed");
        }
        byte[] result = output.toByteArray();
        if (result.length <= MAX_CAPTURE_BYTES) return result;
        output.reset();
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 48, output)) {
            throw new IllegalStateException("jpeg_encode_failed");
        }
        result = output.toByteArray();
        if (result.length == 0 || result.length > MAX_CAPTURE_BYTES) {
            throw new IllegalStateException("capture_too_large");
        }
        return result;
    }

    private void saveCapture(byte[] value, int width, int height) throws Exception {
        File directory = captureDirectory(this);
        if (!directory.exists() && !directory.mkdirs()) {
            throw new IllegalStateException("capture_directory_failed");
        }
        File temporary = temporaryCaptureFile(this);
        try (FileOutputStream output = new FileOutputStream(temporary, false)) {
            output.write(value);
            output.flush();
        }
        File destination = latestCaptureFile(this);
        if (destination.exists() && !destination.delete()) {
            throw new IllegalStateException("old_capture_delete_failed");
        }
        if (!temporary.renameTo(destination)) {
            throw new IllegalStateException("capture_commit_failed");
        }
        preferences(this)
            .edit()
            .putString(CAPTURED_AT_KEY, isoTimestamp(System.currentTimeMillis()))
            .putInt(CAPTURE_WIDTH_KEY, width)
            .putInt(CAPTURE_HEIGHT_KEY, height)
            .apply();
    }

    private void scheduleNextRandomCapture() {
        mainHandler.removeCallbacks(randomCaptureRunnable);
        nextCaptureAt = 0L;
        preferences(this).edit().remove(NEXT_CAPTURE_AT_KEY).apply();
        if (!isSessionActive() || paused || !randomEnabled()) return;
        SharedPreferences prefs = preferences(this);
        int minimum = boundedMinutes(prefs.getInt(MINIMUM_MINUTES_KEY, 60));
        int maximum = Math.max(
            minimum,
            boundedMinutes(prefs.getInt(MAXIMUM_MINUTES_KEY, 180))
        );
        long spread = maximum - minimum;
        long minutes = minimum + (spread == 0 ? 0 : nextLong(spread + 1));
        scheduleRandomCapture(minutes * 60_000L);
    }

    private void scheduleRandomCapture(long delayMs) {
        mainHandler.removeCallbacks(randomCaptureRunnable);
        long boundedDelay = Math.max(60_000L, delayMs);
        nextCaptureAt = System.currentTimeMillis() + boundedDelay;
        preferences(this)
            .edit()
            .putLong(NEXT_CAPTURE_AT_KEY, nextCaptureAt)
            .apply();
        mainHandler.postDelayed(randomCaptureRunnable, boundedDelay);
    }

    private long nextLong(long bound) {
        if (bound <= 1L) return 0L;
        long value = random.nextLong();
        if (value == Long.MIN_VALUE) value = 0L;
        return Math.abs(value) % bound;
    }

    private String captureBlockedReason(boolean randomRequest) {
        PowerManager power = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (power == null || !power.isInteractive()) {
            return "屏幕熄灭时不会随机查看。";
        }
        KeyguardManager keyguard = (KeyguardManager) getSystemService(
            Context.KEYGUARD_SERVICE
        );
        if (keyguard != null && keyguard.isKeyguardLocked()) {
            return "锁屏时不会随机查看。";
        }
        String packageName = foregroundPackage();
        if (packageName.isEmpty()) {
            return "无法确认当前前台 App 是否安全，已跳过这次查看。";
        }
        String normalizedPackage = packageName.toLowerCase(Locale.ROOT);
        if (
            packageName.equals(getPackageName()) ||
            normalizedPackage.equals("com.android.systemui") ||
            normalizedPackage.contains("launcher")
        ) {
            return "当前画面不需要查看，已跳过这次捕获。";
        }
        if (isPrivateApp(packageName, applicationName(packageName))) {
            return "当前可能是账号、支付或密码类 App，已跳过这次查看。";
        }
        if (randomRequest) {
            SharedPreferences prefs = preferences(this);
            if (prefs.getBoolean(WIFI_ONLY_KEY, true) && !isOnWifi()) {
                return "当前不是 Wi-Fi，已跳过随机查看。";
            }
            if (prefs.getBoolean(CHARGING_ONLY_KEY, false) && !isCharging()) {
                return "当前没有充电，已跳过随机查看。";
            }
        }
        return "";
    }

    private boolean isOnWifi() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(
            Context.CONNECTIVITY_SERVICE
        );
        if (manager == null) return false;
        Network active = manager.getActiveNetwork();
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(active);
        return capabilities != null && capabilities.hasTransport(
            NetworkCapabilities.TRANSPORT_WIFI
        );
    }

    private boolean isCharging() {
        Intent battery = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
        if (battery == null) return false;
        int status = battery.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
        return status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL;
    }

    private String foregroundPackage() {
        UsageStatsManager manager = (UsageStatsManager) getSystemService(
            Context.USAGE_STATS_SERVICE
        );
        if (manager == null) return "";
        long end = System.currentTimeMillis();
        UsageEvents events = manager.queryEvents(
            end - FOREGROUND_EVENT_LOOKBACK_MS,
            end
        );
        UsageEvents.Event event = new UsageEvents.Event();
        String foreground = "";
        while (events != null && events.hasNextEvent()) {
            events.getNextEvent(event);
            if (event.getEventType() == UsageEvents.Event.ACTIVITY_RESUMED) {
                foreground = String.valueOf(event.getPackageName());
            }
        }
        return foreground.trim();
    }

    private String applicationName(String packageName) {
        try {
            PackageManager manager = getPackageManager();
            ApplicationInfo info = manager.getApplicationInfo(packageName, 0);
            return String.valueOf(manager.getApplicationLabel(info));
        } catch (Exception ignored) {
            return "";
        }
    }

    private static boolean isPrivateApp(String packageName, String label) {
        String value = (packageName + " " + label).toLowerCase(Locale.ROOT);
        if (
            value.contains("permissioncontroller") ||
            value.contains("packageinstaller") ||
            value.contains("settings")
        ) {
            return true;
        }
        for (String marker : PRIVATE_APP_MARKERS) {
            if (value.contains(marker)) return true;
        }
        return false;
    }

    private CaptureSize captureSize() {
        WindowManager manager = (WindowManager) getSystemService(Context.WINDOW_SERVICE);
        int width = 720;
        int height = 1280;
        if (manager != null) {
            WindowMetrics metrics = manager.getMaximumWindowMetrics();
            Rect bounds = metrics.getBounds();
            width = Math.max(1, bounds.width());
            height = Math.max(1, bounds.height());
        }
        double scale = Math.min(1.0, MAX_CAPTURE_EDGE / (double) Math.max(width, height));
        width = Math.max(2, (int) Math.round(width * scale));
        height = Math.max(2, (int) Math.round(height * scale));
        DisplayMetrics metrics = getResources().getDisplayMetrics();
        int density = Math.max(DisplayMetrics.DENSITY_LOW, metrics.densityDpi);
        return new CaptureSize(width, height, density);
    }

    private boolean randomEnabled() {
        return preferences(this).getBoolean(RANDOM_ENABLED_KEY, false);
    }

    private boolean isSessionActive() {
        return mediaProjection != null && virtualDisplay != null && imageReader != null;
    }

    private void stopProjection(boolean clearCapture) {
        if (stopping) return;
        stopping = true;
        mainHandler.removeCallbacks(randomCaptureRunnable);
        nextCaptureAt = 0L;
        preferences(this).edit().remove(NEXT_CAPTURE_AT_KEY).apply();
        VirtualDisplay display = virtualDisplay;
        virtualDisplay = null;
        if (display != null) display.release();
        ImageReader reader = imageReader;
        imageReader = null;
        if (reader != null) reader.close();
        MediaProjection projection = mediaProjection;
        mediaProjection = null;
        if (projection != null) {
            try {
                projection.unregisterCallback(projectionCallback);
                projection.stop();
            } catch (Exception ignored) {
                // The system can stop a projection before the app releases it.
            }
        }
        if (captureThread != null) {
            captureThread.quitSafely();
            captureThread = null;
            captureHandler = null;
        }
        captureRequested = false;
        randomCaptureRequested = false;
        paused = false;
        if (clearCapture) deleteLatestCapture(this);
        if (activeInstance == this) activeInstance = null;
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void updateNotification(String text) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.notify(NOTIFICATION_ID, buildNotification(text));
    }

    private Notification buildNotification(String text) {
        Intent openApp = new Intent(this, MainActivity.class)
            .setFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            610,
            openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle("DengTa 屏幕共看")
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setSilent(true)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setContentIntent(contentIntent)
            .addAction(
                0,
                "看一眼",
                serviceAction(ACTION_CAPTURE, 611)
            )
            .addAction(
                0,
                paused ? "继续" : "暂停",
                serviceAction(paused ? ACTION_RESUME : ACTION_PAUSE, 612)
            )
            .addAction(0, "结束", serviceAction(ACTION_STOP, 613));
        return builder.build();
    }

    private PendingIntent serviceAction(String action, int requestCode) {
        Intent intent = new Intent(this, ScreenGlanceService.class).setAction(action);
        return PendingIntent.getService(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private String notificationText() {
        if (paused) return "已暂停，不会读取新的画面";
        if (randomEnabled()) return "随机查看已获准；可随时暂停或结束";
        return "共享进行中；点“看一眼”才读取单帧";
    }

    private void recordError(String message) {
        preferences(this)
            .edit()
            .putString(LAST_ERROR_KEY, cleanText(message, 160))
            .apply();
    }

    private static void ensureNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "DengTa 屏幕共看",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("显示正在进行的系统屏幕共享，并提供暂停和结束入口");
        channel.setSound(null, null);
        manager.createNotificationChannel(channel);
    }

    private static void cleanupExpiredCapture(Context context) {
        String value = preferences(context).getString(CAPTURED_AT_KEY, "");
        long capturedAt = parseIsoTimestamp(value);
        if (
            capturedAt <= 0L ||
            System.currentTimeMillis() - capturedAt > CAPTURE_TTL_MS
        ) {
            deleteLatestCapture(context);
        }
    }

    private static File captureDirectory(Context context) {
        return new File(context.getCacheDir(), "screen-glance");
    }

    private static File latestCaptureFile(Context context) {
        return new File(captureDirectory(context), "latest.jpg");
    }

    private static File temporaryCaptureFile(Context context) {
        return new File(captureDirectory(context), "latest.tmp");
    }

    private static SharedPreferences preferences(Context context) {
        return context.getApplicationContext().getSharedPreferences(
            PREFS_NAME,
            Context.MODE_PRIVATE
        );
    }

    private static int boundedMinutes(int value) {
        return Math.min(600, Math.max(1, value));
    }

    private static String cleanText(String value, int limit) {
        String normalized = String.valueOf(value == null ? "" : value)
            .replaceAll("[\\p{Cntrl}&&[^\\r\\n\\t]]", "")
            .replaceAll("\\s+", " ")
            .trim();
        int end = normalized.offsetByCodePoints(
            0,
            Math.min(limit, normalized.codePointCount(0, normalized.length()))
        );
        return normalized.substring(0, end);
    }

    private static String isoTimestamp(long value) {
        SimpleDateFormat formatter = new SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            Locale.US
        );
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new Date(value));
    }

    private static long parseIsoTimestamp(String value) {
        if (value == null || value.isEmpty()) return 0L;
        SimpleDateFormat formatter = new SimpleDateFormat(
            "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
            Locale.US
        );
        formatter.setLenient(false);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        try {
            Date parsed = formatter.parse(value);
            return parsed == null ? 0L : parsed.getTime();
        } catch (ParseException ignored) {
            return 0L;
        }
    }

    private static final class CaptureSize {
        final int width;
        final int height;
        final int densityDpi;

        CaptureSize(int width, int height, int densityDpi) {
            this.width = width;
            this.height = height;
            this.densityDpi = densityDpi;
        }
    }
}
