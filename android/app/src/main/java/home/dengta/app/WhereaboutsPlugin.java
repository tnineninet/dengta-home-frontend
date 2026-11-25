package home.dengta.app;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 原生手机定位插件（whereabouts-mcp + 灯塔邮局探索增强版）：
 * - 同时兼容 Android 12+ 精确定位 (ACCESS_FINE_LOCATION) 与大致定位 (ACCESS_COARSE_LOCATION)
 * - 并发监听 FUSED / GPS / NETWORK 提供器，解决室内单等 GPS 15 秒超时的问题
 * - 支持 fresh=true 强制跳过旧缓存（用于灯塔邮局藏信/拆信实时核验）
 * - 支持主动开启/停止「边走边探」实时步行监听（startExplorationWatch / stopExplorationWatch）
 * - 支持一键跳转系统定位/应用权限设置（openLocationSettings）
 */
@CapacitorPlugin(
    name = "Whereabouts",
    permissions = {
        @Permission(alias = "location", strings = {
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        })
    }
)
public final class WhereaboutsPlugin extends Plugin {

    private static final long LOCATION_TIMEOUT_MS = 14_000L;
    private static final long SAFE_CACHE_MAX_AGE_MS = 45_000L;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean locating = new AtomicBoolean(false);
    private LocationListener explorationWatcher = null;

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        call.resolve(buildPermissionSnapshot());
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (hasAnyLocationPermission()) {
            call.resolve(buildPermissionSnapshot());
            return;
        }
        requestPermissionForAlias("location", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        call.resolve(buildPermissionSnapshot());
    }

    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        try {
            Context ctx = getContext();
            Intent intent;
            if (!isLocationServiceEnabled()) {
                intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.fromParts("package", ctx.getPackageName(), null));
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(intent);
            JSObject ok = new JSObject();
            ok.put("opened", true);
            call.resolve(ok);
        } catch (Exception e) {
            JSObject fail = new JSObject();
            fail.put("opened", false);
            call.resolve(fail);
        }
    }

    private boolean hasFineLocationPermission() {
        return ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasCoarseLocationPermission() {
        return ActivityCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_COARSE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasAnyLocationPermission() {
        return hasFineLocationPermission() || hasCoarseLocationPermission();
    }

    private boolean isLocationServiceEnabled() {
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) return false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            return manager.isLocationEnabled();
        }
        return manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
                || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }

    private JSObject buildPermissionSnapshot() {
        JSObject result = new JSObject();
        boolean fine = hasFineLocationPermission();
        boolean coarse = hasCoarseLocationPermission();
        boolean granted = fine || coarse;
        result.put("granted", granted);
        result.put("fineGranted", fine);
        result.put("coarseGranted", coarse);
        result.put("locationEnabled", isLocationServiceEnabled());
        result.put("state", granted ? "granted" : "prompt");
        return result;
    }

    @PluginMethod
    public void getBatterySnapshot(PluginCall call) {
        call.resolve(batterySnapshot());
    }

    private List<String> availableProviders(LocationManager manager) {
        List<String> providers = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                if (manager.isProviderEnabled(LocationManager.FUSED_PROVIDER)) {
                    providers.add(LocationManager.FUSED_PROVIDER);
                }
            } catch (Exception ignored) {}
        }
        try {
            if (hasFineLocationPermission() && manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                providers.add(LocationManager.GPS_PROVIDER);
            }
        } catch (Exception ignored) {}
        try {
            if (manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                providers.add(LocationManager.NETWORK_PROVIDER);
            }
        } catch (Exception ignored) {}
        return providers;
    }

    private Location bestRecentLastKnown(LocationManager manager, long maxAgeMs) {
        long now = System.currentTimeMillis();
        Location best = null;
        String[] candidates = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? new String[]{ LocationManager.FUSED_PROVIDER, LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER }
            : new String[]{ LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER };
        for (String provider : candidates) {
            try {
                Location loc = manager.getLastKnownLocation(provider);
                if (loc == null) continue;
                if (now - loc.getTime() > maxAgeMs) continue;
                if (best == null || loc.getTime() > best.getTime()
                        || (Math.abs(loc.getTime() - best.getTime()) < 5_000L && loc.getAccuracy() < best.getAccuracy())) {
                    best = loc;
                }
            } catch (Exception ignored) {}
        }
        return best;
    }

    /**
     * 获取当前位置 + 电量。
     * 参数 fresh=true 时强制跳过旧缓存，保证灯塔邮局拆信/藏信时效新鲜。
     */
    @PluginMethod
    public void getLocation(PluginCall call) {
        if (!hasAnyLocationPermission()) {
            JSObject result = new JSObject();
            result.put("granted", false);
            result.put("error", "location_permission_required");
            call.resolve(result);
            return;
        }
        if (!locating.compareAndSet(false, true)) {
            JSObject busy = new JSObject();
            busy.put("error", "locating_in_progress");
            call.resolve(busy);
            return;
        }

        final LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) {
            locating.set(false);
            JSObject result = new JSObject();
            result.put("error", "location_service_unavailable");
            call.resolve(result);
            return;
        }

        boolean requireFresh = Boolean.TRUE.equals(call.getBoolean("fresh", false));
        long maxCacheAge = requireFresh ? 10_000L : SAFE_CACHE_MAX_AGE_MS;
        Location cached = bestRecentLastKnown(manager, maxCacheAge);
        if (cached != null && (!requireFresh || (cached.hasAccuracy() && cached.getAccuracy() <= 60f))) {
            locating.set(false);
            call.resolve(serializeLocation(cached));
            return;
        }

        final AtomicBoolean finished = new AtomicBoolean(false);
        final Location[] bestSoFar = new Location[1];
        final LocationListener listener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                if (location == null || finished.get()) return;
                if (bestSoFar[0] == null || location.getAccuracy() <= bestSoFar[0].getAccuracy()) {
                    bestSoFar[0] = location;
                }
                // Accept immediately if accurate enough or if we only have coarse permission
                if (!hasFineLocationPermission() || !location.hasAccuracy() || location.getAccuracy() <= 65f) {
                    if (finished.compareAndSet(false, true)) {
                        cleanup(this);
                        locating.set(false);
                        call.resolve(serializeLocation(location));
                    }
                }
            }

            @Override
            public void onStatusChanged(String provider, int status, Bundle extras) {}

            @Override
            public void onProviderEnabled(String provider) {}

            @Override
            public void onProviderDisabled(String provider) {}

            private void cleanup(LocationListener self) {
                handler.removeCallbacksAndMessages(null);
                try {
                    manager.removeUpdates(self);
                } catch (Exception ignored) {}
            }
        };

        List<String> providers = availableProviders(manager);
        boolean requested = false;
        for (String provider : providers) {
            try {
                manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper());
                requested = true;
            } catch (Exception ignored) {}
        }

        if (!requested) {
            locating.set(false);
            Location fallback = bestRecentLastKnown(manager, 90_000L);
            if (fallback != null) {
                call.resolve(serializeLocation(fallback));
                return;
            }
            JSObject result = new JSObject();
            result.put("error", isLocationServiceEnabled() ? "location_provider_failed" : "location_disabled");
            call.resolve(result);
            return;
        }

        handler.postDelayed(() -> {
            if (!finished.compareAndSet(false, true)) return;
            locating.set(false);
            try {
                manager.removeUpdates(listener);
            } catch (Exception ignored) {}
            Location chosen = bestSoFar[0] != null ? bestSoFar[0] : bestRecentLastKnown(manager, 90_000L);
            if (chosen != null) {
                call.resolve(serializeLocation(chosen));
            } else {
                JSObject result = new JSObject();
                result.put("error", "location_timeout");
                call.resolve(result);
            }
        }, LOCATION_TIMEOUT_MS);
    }

    /**
     * 仅在用户在灯塔邮局主动开启「边走边探」时启动实时步行位置广播，关闭页面或开关时自动停止。
     */
    @PluginMethod
    public void startExplorationWatch(PluginCall call) {
        if (!hasAnyLocationPermission()) {
            JSObject res = new JSObject();
            res.put("watching", false);
            res.put("error", "location_permission_required");
            call.resolve(res);
            return;
        }
        stopWatchInternal();
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (manager == null) {
            JSObject res = new JSObject();
            res.put("watching", false);
            res.put("error", "location_service_unavailable");
            call.resolve(res);
            return;
        }

        explorationWatcher = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                if (location != null) {
                    notifyListeners("explorationLocation", serializeLocation(location));
                }
            }
            @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
            @Override public void onProviderEnabled(String provider) {}
            @Override public void onProviderDisabled(String provider) {}
        };

        boolean started = false;
        for (String provider : availableProviders(manager)) {
            try {
                manager.requestLocationUpdates(provider, 3_500L, 4f, explorationWatcher, Looper.getMainLooper());
                started = true;
            } catch (Exception ignored) {}
        }
        JSObject res = new JSObject();
        res.put("watching", started);
        call.resolve(res);
    }

    @PluginMethod
    public void stopExplorationWatch(PluginCall call) {
        stopWatchInternal();
        JSObject res = new JSObject();
        res.put("watching", false);
        call.resolve(res);
    }

    private void stopWatchInternal() {
        if (explorationWatcher == null) return;
        try {
            LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            if (manager != null) {
                manager.removeUpdates(explorationWatcher);
            }
        } catch (Exception ignored) {}
        explorationWatcher = null;
    }

    @Override
    protected void handleOnDestroy() {
        stopWatchInternal();
        super.handleOnDestroy();
    }

    private JSObject serializeLocation(Location location) {
        JSObject result = new JSObject();
        result.put("granted", true);
        result.put("latitude", location.getLatitude());
        result.put("longitude", location.getLongitude());
        result.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : null);
        result.put("bearing", location.hasBearing() ? location.getBearing() : null);
        result.put("speed", location.hasSpeed() ? location.getSpeed() : null);
        result.put("provider", location.getProvider());
        result.put("timestamp", new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", java.util.Locale.US)
                .format(new java.util.Date(location.getTime())));
        JSObject battery = batterySnapshot();
        result.put("batteryLevel", battery.optInt("batteryLevel", 0));
        result.put("charging", battery.optBoolean("charging", false));
        return result;
    }

    private JSObject batterySnapshot() {
        JSObject result = new JSObject();
        try {
            Intent sticky = getContext().registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            int level = sticky == null ? -1 : sticky.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
            int scale = sticky == null ? 100 : sticky.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int status = sticky == null ? -1 : sticky.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
            result.put("batteryLevel", level >= 0 && scale > 0 ? Math.round(level * 100f / scale) : null);
            result.put("charging", status == BatteryManager.BATTERY_STATUS_CHARGING
                    || status == BatteryManager.BATTERY_STATUS_FULL);
        } catch (Exception ignored) {
            result.put("batteryLevel", null);
            result.put("charging", false);
        }
        return result;
    }
}
