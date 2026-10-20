package home.dengta.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppUpdates")
public final class AppUpdatesPlugin extends Plugin {
    private boolean pendingLaunch = false;
    private void capture(Intent intent) {
        if (intent != null && intent.getBooleanExtra(AppUpdateWorker.OPEN_UPDATE, false)) {
            pendingLaunch = true;
            intent.removeExtra(AppUpdateWorker.OPEN_UPDATE);
        }
    }
    @Override public void load() { capture(getActivity().getIntent()); }
    @Override protected void handleOnNewIntent(Intent intent) { capture(intent); }
    @PluginMethod public void consumeLaunch(PluginCall call) {
        boolean available = pendingLaunch;
        pendingLaunch = false;
        call.resolve(new JSObject().put("available", available));
    }
    @PluginMethod public void schedule(PluginCall call) {
        AppUpdateWorker.schedule(getContext());
        call.resolve(new JSObject().put("enabled", AppUpdateWorker.preferences(getContext()).getBoolean("enabled", true)));
    }
    @PluginMethod public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        AppUpdateWorker.setEnabled(getContext(), enabled);
        call.resolve(new JSObject().put("enabled", enabled));
    }
    @PluginMethod public void openDownload(PluginCall call) {
        String url = call.getString("url", "");
        if (!AppUpdatePolicy.validDownload(url)) { call.reject("更新下载地址无效。", "app_update_manifest_invalid"); return; }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settings);
            } catch (Exception ignored) {}
            call.reject("请允许 DengTa 安装应用后，再点一次更新。", "app_update_install_permission_required");
            return;
        }
        call.resolve(new JSObject().put("started", true));
        new Thread(() -> {
            File target = new File(getContext().getCacheDir(), "dengta-update.apk");
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(url).openConnection();
                connection.setConnectTimeout(20000);
                connection.setReadTimeout(60000);
                connection.setInstanceFollowRedirects(true);
                connection.setRequestProperty("User-Agent", "DengTa-Android");
                int status = connection.getResponseCode();
                if (status < 200 || status >= 300) throw new IllegalStateException("HTTP " + status);
                long length = connection.getContentLengthLong();
                if (length > 120L * 1024 * 1024) throw new IllegalStateException("apk too large");
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(target)) {
                    byte[] buffer = new byte[64 * 1024];
                    int read;
                    long total = 0;
                    int lastPercent = -1;
                    while ((read = input.read(buffer)) != -1) {
                        total += read;
                        if (total > 120L * 1024 * 1024) throw new IllegalStateException("apk too large");
                        output.write(buffer, 0, read);
                        if (length > 0) {
                            int percent = (int) Math.min(100, total * 100 / length);
                            if (percent >= lastPercent + 5) {
                                lastPercent = percent;
                                int shown = percent;
                                getActivity().runOnUiThread(() -> notifyListeners("downloadProgress", new JSObject().put("percent", shown)));
                            }
                        }
                    }
                }
                if (!target.isFile() || target.length() <= 0) throw new IllegalStateException("empty apk");
                getActivity().runOnUiThread(() -> {
                    notifyListeners("downloadComplete", new JSObject().put("installing", true));
                    installApk(target);
                });
            } catch (Exception error) {
                if (target.exists()) target.delete();
                getActivity().runOnUiThread(() -> notifyListeners("downloadFailed", new JSObject().put("message", "更新包下载失败，请检查网络后重试。")));
            } finally {
                if (connection != null) connection.disconnect();
            }
        }, "dengta-apk-download").start();
    }

    private void installApk(File file) {
        try {
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, "application/vnd.android.package-archive");
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getActivity().startActivity(intent);
        } catch (Exception error) {
            // 安装器不可用时保留已下载文件，用户可再点更新重试。
        }
    }
}
