package home.dengta.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.location.LocationManager;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * 外卖执行器（多用户手机版）：
 * - openLogin：打开外卖 H5 让用户扫码登录（Cookie 存本机 WebView，二次免扫码）；
 * - searchShops：搜索店铺并提取结构化列表；
 * - orderProduct：按店名+商品名加购并进入购物车/结算页，用户在页面上人工确认付款。
 */
@CapacitorPlugin(name = "OrderBrowser")
public final class OrderBrowserPlugin extends Plugin {

    @PluginMethod
    public void openLogin(PluginCall call) {
        String url = call.getString("url", "https://h5.ele.me/msite/");
        startOrderActivity(null, url, "login", "{}", "扫码登录外卖平台");
        JSObject out = new JSObject();
        out.put("opened", true);
        call.resolve(out);
    }

    @PluginMethod
    public void searchShops(PluginCall call) {
        String keyword = call.getString("keyword", "");
        if (keyword.trim().isEmpty()) {
            call.reject("缺少搜索关键词。");
            return;
        }
        String url = "https://h5.ele.me/minisearch/result?keyword="
            + android.net.Uri.encode(keyword.trim()) + "&from=mobile.default";
        startOrderActivity(call, url, "search", "{}", "搜索：" + keyword.trim());
    }

    @PluginMethod
    public void orderProduct(PluginCall call) {
        String shopName = call.getString("shopName", "");
        String product = call.getString("product", "");
        if (shopName.trim().isEmpty() || product.trim().isEmpty()) {
            call.reject("缺少店名或商品名。");
            return;
        }
        JSONObject config = new JSONObject();
        try {
            config.put("shop_name", shopName.trim());
            config.put("product", product.trim());
            config.put("quantity", Math.max(1, Math.min(20, call.getInt("quantity", 1))));
        } catch (Exception ignored) {}
        String url = "https://h5.ele.me/minisearch/result?keyword="
            + android.net.Uri.encode(shopName.trim()) + "&from=mobile.default";
        startOrderActivity(call, url, "order", config.toString(), "点单：" + product.trim());
    }

    @PluginMethod
    public void getLocation(PluginCall call) {
        JSObject out = new JSObject();
        try {
            LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            Location last = null;
            for (String provider : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
                try {
                    Location candidate = manager.getLastKnownLocation(provider);
                    if (candidate != null) { last = candidate; break; }
                } catch (Exception ignored) {}
            }
            if (last != null) {
                out.put("latitude", last.getLatitude());
                out.put("longitude", last.getLongitude());
                out.put("accuracy", last.hasAccuracy() ? last.getAccuracy() : 60);
            } else {
                out.put("latitude", JSONObject.NULL);
                out.put("longitude", JSONObject.NULL);
            }
        } catch (Exception ignored) {
            out.put("latitude", JSONObject.NULL);
            out.put("longitude", JSONObject.NULL);
        }
        call.resolve(out);
    }

    private void startOrderActivity(PluginCall call, String url, String mode, String config, String title) {
        try {
            Intent intent = new Intent(getContext(), OrderWebActivity.class);
            intent.putExtra("url", url);
            intent.putExtra("mode", mode);
            intent.putExtra("config", config);
            intent.putExtra("title", title);
            if (call != null) {
                // 必须同任务内启动：带 FLAG_ACTIVITY_NEW_TASK 时
                // startActivityForResult 会立即返回 RESULT_CANCELED，
                // 导致"外卖搜索被取消"的假失败（页面其实还开着）。
                startActivityForResult(call, intent, "orderResult");
            } else {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
            }
        } catch (Exception error) {
            // 页面打不开时不要崩掉整个 App,直接按失败回给调用方。
            if (call != null) {
                call.reject("外卖页面暂时无法打开。");
            }
        }
    }

    @ActivityCallback
    private void orderResult(PluginCall call, ActivityResult result) {
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            String resultJson = result.getData().getStringExtra("result");
            try {
                call.resolve(new JSObject(resultJson));
            } catch (Exception error) {
                call.reject("执行结果格式不正确。");
            }
        } else if (result.getResultCode() == Activity.RESULT_CANCELED) {
            String message = result.getData() != null ? result.getData().getStringExtra("message") : null;
            call.reject(message != null ? message : "用户取消了操作。");
        } else {
            call.reject("执行失败。");
        }
    }
}
