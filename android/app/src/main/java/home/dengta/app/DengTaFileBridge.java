package home.dengta.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * 导出文件桥：前端把导出内容以 base64 交给原生写入 App 导出目录，
 * 避免 WebView 无法可靠触发文件下载的问题。
 */
public final class DengTaFileBridge {
    private static final String TAG = "DengTaFileBridge";

    private final Context context;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    public DengTaFileBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    @JavascriptInterface
    public void saveExport(String dataUrl, String filename) {
        if (dataUrl == null || filename == null || filename.trim().isEmpty()) {
            toast("导出失败：缺少文件内容或文件名。");
            return;
        }
        String safeName = filename.trim().replaceAll("[^A-Za-z0-9._\\-\u4e00-\u9fa5]", "_");
        if (safeName.length() > 120) safeName = safeName.substring(safeName.length() - 120);
        try {
            String base64 = dataUrl;
            int comma = dataUrl.indexOf(',');
            if (comma >= 0) base64 = dataUrl.substring(comma + 1);
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            File dir = new File(context.getFilesDir(), "export");
            if (!dir.exists() && !dir.mkdirs()) {
                toast("导出失败：无法创建导出目录。");
                return;
            }
            File target = new File(dir, safeName);
            try (FileOutputStream out = new FileOutputStream(target)) {
                out.write(bytes);
            }
            Log.i(TAG, "saved export: " + target.getAbsolutePath() + " (" + bytes.length + " bytes)");
            toast("已导出：" + safeName + "（" + (bytes.length / 1024) + " KB）\n位置：App 文件夹 files/export/，可用文件管理器查看。");
        } catch (Exception error) {
            Log.e(TAG, "save export failed", error);
            toast("导出失败：" + (error.getMessage() != null ? error.getMessage() : "未知原因"));
        }
    }

    @JavascriptInterface
    public boolean saveImageToGallery(String dataUrl, String filename) {
        if (dataUrl == null || dataUrl.trim().isEmpty()) {
            toast("保存失败：二维码图片数据为空。");
            return false;
        }
        String safeName = (filename == null || filename.trim().isEmpty() ? "dengta-qr.png" : filename.trim())
            .replaceAll("[^A-Za-z0-9._\\-\u4e00-\u9fa5]", "_");
        if (!safeName.toLowerCase().endsWith(".png") && !safeName.toLowerCase().endsWith(".jpg")) {
            safeName = safeName + ".png";
        }
        try {
            String base64 = dataUrl;
            int comma = dataUrl.indexOf(',');
            if (comma >= 0) base64 = dataUrl.substring(comma + 1);
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            String mime = safeName.toLowerCase().endsWith(".jpg") ? "image/jpeg" : "image/png";
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentResolver resolver = context.getContentResolver();
                ContentValues values = new ContentValues();
                values.put(MediaStore.Images.Media.DISPLAY_NAME, safeName);
                values.put(MediaStore.Images.Media.MIME_TYPE, mime);
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/DengTa");
                values.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values);
                if (uri == null) {
                    toast("保存失败：无法写入系统相册。");
                    return false;
                }
                try (OutputStream out = resolver.openOutputStream(uri)) {
                    if (out == null) throw new IllegalStateException("openOutputStream returned null");
                    out.write(bytes);
                }
                values.clear();
                values.put(MediaStore.Images.Media.IS_PENDING, 0);
                resolver.update(uri, values, null, null);
                toast("二维码已保存到相册（Pictures/DengTa），打开网易云扫一扫相册即可。");
                return true;
            }
            File dir = new File(context.getFilesDir(), "export");
            if (!dir.exists()) dir.mkdirs();
            File target = new File(dir, safeName);
            try (FileOutputStream out = new FileOutputStream(target)) {
                out.write(bytes);
            }
            toast("二维码已保存：" + safeName);
            return true;
        } catch (Exception error) {
            Log.e(TAG, "saveImageToGallery failed", error);
            toast("保存二维码失败：" + (error.getMessage() != null ? error.getMessage() : "未知原因"));
            return false;
        }
    }

    @JavascriptInterface
    public boolean openNeteaseApp() {
        try {
            Intent launch = context.getPackageManager().getLaunchIntentForPackage("com.netease.cloudmusic");
            if (launch == null) {
                launch = new Intent(Intent.ACTION_VIEW, Uri.parse("orpheus://"));
                launch.setPackage("com.netease.cloudmusic");
            }
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(launch);
            return true;
        } catch (Exception error) {
            toast("未检测到网易云音乐 App，请手动打开并扫码。");
            return false;
        }
    }

    private void toast(final String message) {
        mainHandler.post(() -> Toast.makeText(context, message, Toast.LENGTH_LONG).show());
    }
}
