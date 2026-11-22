package home.dengta.app;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.location.Location;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
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
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;
import org.json.JSONArray;
import java.util.UUID;

/**
 * 外卖执行器（多用户手机版）：
 * - openLogin：打开外卖 H5 让用户扫码登录（Cookie 存本机 WebView，二次免扫码）；
 * - searchShops：搜索店铺并提取结构化列表；
 * - orderProduct：按店名+商品名加购并进入购物车/结算页，用户在页面上人工确认付款。
 */
@CapacitorPlugin(name = "OrderBrowser")
public final class OrderBrowserPlugin extends Plugin {
    static final String SEARCH_RESULT_ACTION = "home.dengta.app.ORDER_SEARCH_RESULT";
    static final String CANCEL_ACTION = "home.dengta.app.ORDER_CANCEL_AUTOMATION";
    private final OrderSearchRequests searchRequests = new OrderSearchRequests();
    private final Handler searchHandler = new Handler(Looper.getMainLooper());
    private final BroadcastReceiver searchReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (!SEARCH_RESULT_ACTION.equals(intent.getAction())) return;
            searchRequests.finish(intent.getStringExtra("request_id"), intent.getStringExtra("result"), intent.getStringExtra("error"));
        }
    };

    @Override public void load() {
        ContextCompat.registerReceiver(getContext(), searchReceiver, new IntentFilter(SEARCH_RESULT_ACTION), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    static void publishSearchResult(Context context, String id, String result, String error) {
        Intent receipt = new Intent(SEARCH_RESULT_ACTION).setPackage(context.getPackageName());
        receipt.putExtra("request_id", id);
        receipt.putExtra("result", result);
        receipt.putExtra("error", error);
        context.sendBroadcast(receipt);
    }

    @PluginMethod public void cancelSearch(PluginCall call) {
        String scope = call.getString("scope", "");
        searchRequests.cancelScope(scope);
        getContext().sendBroadcast(new Intent(CANCEL_ACTION).setPackage(getContext().getPackageName()).putExtra("scope", scope));
        call.resolve();
    }

    static String technicalErrorMessage(String code) {
        if (code != null && code.startsWith("browser_account_")) return BrowserSessionSupport.accountErrorMessage(code);
        if ("takeout_page_init_failed".equals(code)) return "外卖页面初始化失败，自动操作已停止。请手动返回后重试。";
        if ("takeout_page_renderer_failed".equals(code)) return "外卖页面渲染进程已退出，自动操作已停止。请手动返回后重试。";
        if ("takeout_page_load_failed".equals(code)) return "当前外卖网页未能加载，自动操作已停止。可以恢复网页并手动核对网络、登录和购物车。";
        if ("takeout_page_interrupted".equals(code)) return "外卖页面已重新打开，自动操作已停止。请先手动核对，再返回重试。";
        return null;
    }

    private void withAccount(PluginCall call, java.util.function.Consumer<BrowserAccountScope.Binding> action) {
        getActivity().runOnUiThread(() -> {
            try {
                BrowserAccountScope.Binding binding = BrowserSessionSupport.ACCOUNTS.capture(call.getString("accountScope", ""));
                BrowserSessionSupport.requireAccountProfiles();
                action.accept(binding);
            } catch (RuntimeException error) {
                String code = BrowserSessionSupport.accountErrorCode(error);
                call.reject(BrowserSessionSupport.accountErrorMessage(code), code);
            }
        });
    }

    private JSObject searchReceipt(String raw) throws Exception {
        JSONObject parsed = new JSONObject(raw);
        String status = parsed.optString("status", "done");
        if (!java.util.Arrays.asList("done", "verification", "logged_out", "error", "shop_not_found").contains(status)) status = "error";
        JSObject result = new JSObject().put("status", status).put("loading", parsed.optBoolean("loading", false));
        String code = BrowserSessionSupport.publicTakeoutSearchErrorCode(status, parsed.optString("code", ""));
        if (!code.isEmpty()) result.put("code", code);
        JSONArray shops = new JSONArray();
        JSONArray incoming = parsed.optJSONArray("shops");
        if (incoming != null) for (int index = 0; index < Math.min(20, incoming.length()); index++) {
            JSONObject shop = incoming.optJSONObject(index);
            if (shop == null) continue;
            String name = shop.optString("name", ""), meta = shop.optString("meta", "");
            shops.put(new JSONObject().put("name", name.substring(0, Math.min(40, name.length()))).put("meta", meta.substring(0, Math.min(240, meta.length()))));
        }
        result.put("shops", shops);
        JSONArray products = new JSONArray();
        JSONArray incomingProducts = parsed.optJSONArray("products");
        if (incomingProducts != null) for (int index = 0; index < Math.min(30, incomingProducts.length()); index++) {
            JSONObject product = incomingProducts.optJSONObject(index);
            if (product == null) continue;
            String name = product.optString("name", "").trim();
            if (name.isEmpty()) continue;
            double price = product.optDouble("price", Double.NaN);
            Object available = product.opt("available");
            products.put(new JSONObject().put("name", name.substring(0, Math.min(80, name.length())))
                .put("price", Double.isFinite(price) && price >= 0 ? price : JSONObject.NULL)
                .put("available", available instanceof Boolean ? available : JSONObject.NULL));
        }
        result.put("products", products);
        return result;
    }

    private JSObject orderReceipt(String raw) throws Exception {
        JSONObject parsed = new JSONObject(raw);
        String status = parsed.optString("status", "error");
        if (!java.util.Arrays.asList("ready_for_payment", "manual_review", "verification", "logged_out", "error", "shop_not_found", "product_not_found", "over_limit").contains(status)) status = "error";
        JSObject result = new JSObject().put("status", status);
        String code = BrowserSessionSupport.publicTakeoutSearchErrorCode("error", parsed.optString("code", ""));
        if (!code.isEmpty()) result.put("code", code);
        double total = parsed.optDouble("total", Double.NaN);
        if (Double.isFinite(total) && total >= 0) result.put("total", total);
        result.put("items", Math.max(0, parsed.optInt("items", 0)));
        JSONArray lines = new JSONArray();
        JSONArray incomingLines = parsed.optJSONArray("lines");
        if (incomingLines != null) for (int index = 0; index < Math.min(20, incomingLines.length()); index++) {
            JSONObject line = incomingLines.optJSONObject(index);
            if (line == null) continue;
            String name = line.optString("name", "").trim();
            int quantity = line.optInt("quantity", 0);
            if (!name.isEmpty() && name.length() <= 80 && quantity > 0 && quantity <= 20) lines.put(new JSONObject().put("name", name).put("quantity", quantity));
        }
        result.put("lines", lines);
        // 换店/换菜时把页面看到的候选名字带回去，AI 只能在这些真实商品里重新选择。
        JSONArray candidates = new JSONArray();
        JSONArray incomingCandidates = parsed.optJSONArray("candidates");
        if (incomingCandidates != null) for (int index = 0; index < Math.min(10, incomingCandidates.length()); index++) {
            String name = incomingCandidates.optString(index, "").trim();
            if (!name.isEmpty()) candidates.put(name.substring(0, Math.min(80, name.length())));
        }
        result.put("candidates", candidates);
        result.put("paymentSubmitted", false);
        return result;
    }

    private void openRequest(PluginCall call, String url, String mode, String config, String title, long timeoutMs) {
        withAccount(call, binding -> {
            String id = UUID.randomUUID().toString();
            Runnable timeout = () -> {
                if (searchRequests.finish(id, null, "timeout")) getContext().sendBroadcast(new Intent(CANCEL_ACTION)
                    .setPackage(getContext().getPackageName()).putExtra("request_id", id));
            };
            getBridge().saveCall(call);
            searchRequests.begin(id, call.getString("scope", ""), (result, error) -> {
                searchHandler.removeCallbacks(timeout);
                try { BrowserSessionSupport.ACCOUNTS.requireCurrent(binding); }
                catch (RuntimeException changed) {
                    String code = BrowserSessionSupport.accountErrorCode(changed);
                    call.reject(BrowserSessionSupport.accountErrorMessage(code), code);
                    getBridge().releaseCall(call);
                    return;
                }
                if ("timeout".equals(error)) call.resolve(new JSObject().put("status", "error").put("code", "takeout_page_not_ready").put("loading", true));
                else if ("launch_failed".equals(error)) call.reject("外卖页面暂时无法打开。", "takeout_search_open_failed");
                else if (technicalErrorMessage(error) != null) call.reject(technicalErrorMessage(error), error);
                else if (error != null) call.reject("外卖自动操作已暂停，页面保留供你核对。", "takeout_automation_paused");
                else {
                    try { call.resolve("order".equals(mode) ? orderReceipt(result) : searchReceipt(result)); }
                    catch (Exception invalid) { call.reject("外卖页面返回了无效结果，请在页面中核对。", "takeout_search_result_invalid"); }
                }
                getBridge().releaseCall(call);
            });
            try {
                Intent intent = new Intent(getActivity(), OrderWebActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                intent.putExtra("url", url).putExtra("mode", mode).putExtra("config", config).putExtra("title", title)
                    .putExtra("request_id", id).putExtra("scope", call.getString("scope", ""));
                intent.putExtra(BrowserSessionSupport.REQUEST_TICKET, BrowserSessionSupport.ACCOUNTS.issue(binding));
                getActivity().startActivity(intent);
                searchHandler.postDelayed(timeout, timeoutMs);
            } catch (Exception error) { searchRequests.finish(id, null, "launch_failed"); }
        });
    }

    @Override protected void handleOnDestroy() {
        searchRequests.cancelAll();
        getContext().sendBroadcast(new Intent(CANCEL_ACTION).setPackage(getContext().getPackageName()).putExtra("cancel_all", true));
        searchHandler.removeCallbacksAndMessages(null);
        try { getContext().unregisterReceiver(searchReceiver); } catch (Exception ignored) {}
    }

    // 外卖平台登录状态：读 WebView CookieStore 里的饿了么登录 Cookie。
    @PluginMethod
    public void getLoginState(PluginCall call) {
        withAccount(call, binding -> {
            CookieManager cookies = BrowserSessionSupport.accountCookies(binding);
            String cookie = cookies.getCookie("https://h5.ele.me");
            String taobaoCookie = cookies.getCookie("https://h5.m.taobao.com");
            boolean hasCookie = cookie != null && !cookie.isEmpty() || taobaoCookie != null && !taobaoCookie.isEmpty();
            // Presence is only a local credential hint, never proof the platform still accepts the session.
            boolean loggedIn = BrowserSessionSupport.hasAuthenticationCookie(cookie) || BrowserSessionSupport.hasAuthenticationCookie(taobaoCookie);
            BrowserSessionSupport.persistCookies(cookies);
            JSObject out = new JSObject();
            out.put("loggedIn", loggedIn);
            out.put("hasCookie", hasCookie);
            call.resolve(out);
        });
    }

    @PluginMethod
    public void openLogin(PluginCall call) {
        String url = call.getString("url", "https://h5.ele.me/msite/");
        // 改用登录态长住的内置浏览器：扫码登录一次后 Cookie 持久化，
        // 之后的搜索/点单页自动带登录态（同一个 WebView CookieStore）。
        // 注意：必须同任务内启动（startActivityForResult），
        // NEW_TASK + context.startActivity 在新任务中会被 vivo 秒杀（"跳转1秒被取消"）。
        withAccount(call, binding -> { try {
            Intent browser = new Intent(getContext(), PersistentBrowserActivity.class);
            browser.putExtra("url", url);
            browser.putExtra("title", "外卖平台登录");
            browser.putExtra("site", "eleme");
            browser.putExtra("desktop", false);
            browser.putExtra(BrowserSessionSupport.REQUEST_TICKET, BrowserSessionSupport.ACCOUNTS.issue(binding));
            startActivityForResult(call, browser, "browserLoginResult");
        } catch (Exception error) {
            call.reject("无法打开外卖登录页。");
        } });
    }

    @ActivityCallback
    private void browserLoginResult(PluginCall call, ActivityResult result) {
        try { BrowserSessionSupport.ACCOUNTS.capture(call.getString("accountScope", "")); }
        catch (RuntimeException error) { String code = BrowserSessionSupport.accountErrorCode(error); call.reject(BrowserSessionSupport.accountErrorMessage(code), code); return; }
        if (result.getData() != null && result.getData().hasExtra("code")) {
            String code = result.getData().getStringExtra("code");
            String message = code != null && code.startsWith("browser_account_")
                ? BrowserSessionSupport.accountErrorMessage(code) : BrowserSessionSupport.browserErrorMessage(code);
            call.reject(message, code); return;
        }
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
        openRequest(call, url, "search", "{}", "搜索：" + keyword.trim(), 45_000);
    }

    @PluginMethod public void inspectMenu(PluginCall call) {
        String shopName = call.getString("shopName", "").trim();
        if (shopName.isEmpty()) { call.reject("缺少准确店名。", "takeout_command_invalid"); return; }
        JSONObject config = new JSONObject();
        try { config.put("shop_name", shopName); } catch (Exception ignored) {}
        String url = "https://h5.ele.me/minisearch/result?keyword=" + android.net.Uri.encode(shopName) + "&from=mobile.default";
        openRequest(call, url, "menu", config.toString(), "查看菜单：" + shopName, 90_000);
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
            Double maxAmount = call.getDouble("maxAmount");
            if (maxAmount != null && Double.isFinite(maxAmount) && maxAmount > 0) config.put("max_amount", maxAmount);
            config.put("note", call.getString("note", "").trim());
        } catch (Exception ignored) {}
        String url = "https://h5.ele.me/minisearch/result?keyword="
            + android.net.Uri.encode(shopName.trim()) + "&from=mobile.default";
        openRequest(call, url, "order", config.toString(), "点单：" + product.trim(), 120_000);
    }

    /**
     * 把已经打开的外卖页面调回前台，让用户核对地址和付款。
     * 只发一次新的账号票据、不重载页面、不触发任何自动点击。
     */
    @PluginMethod
    public void resumePage(PluginCall call) {
        String requested = call.getString("url", "");
        String url = requested != null && (requested.startsWith("https://h5.ele.me") || requested.startsWith("https://h5.m.taobao.com"))
            ? requested : "https://h5.ele.me/msite/cart";
        withAccount(call, binding -> {
            try {
                Intent intent = new Intent(getActivity(), OrderWebActivity.class);
                intent.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                intent.putExtra("url", url).putExtra("mode", "review").putExtra("config", "{}")
                    .putExtra("title", "核对与付款").putExtra("request_id", "").putExtra("scope", call.getString("scope", ""));
                intent.putExtra(BrowserSessionSupport.REQUEST_TICKET, BrowserSessionSupport.ACCOUNTS.issue(binding));
                getActivity().startActivity(intent);
                call.resolve(new JSObject().put("opened", true));
            } catch (Exception error) {
                call.reject("暂时无法切回外卖页面，请从最近任务里找回。", "takeout_page_resume_failed");
            }
        });
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

}
