package home.dengta.app;

import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import androidx.webkit.ProfileStore;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Pattern;

final class BrowserSessionSupport {
    static final BrowserAccountScope ACCOUNTS = new BrowserAccountScope();
    static final String REQUEST_TICKET = "dengta_internal_browser_ticket";
    static final String RESTORE_TICKET = "dengta_internal_browser_restore_ticket";
    enum LoginDecision { READY, REQUIRED, WAIT, NOT_READY }
    private static final ExecutorService COOKIE_WRITER = Executors.newSingleThreadExecutor(task -> {
        Thread thread = new Thread(task, "dengta-cookie-save");
        thread.setDaemon(true);
        return thread;
    });
    private static final Pattern AUTH_COOKIE = Pattern.compile("(?:^|;\\s*)(?:SID|USERID|TOKEN)\\s*=\\s*[^;\\s]+");
    private static final Pattern TAOBAO_SESSION_COOKIE = Pattern.compile("(?:^|;\\s*)cookie2\\s*=\\s*[^;\\s]+");
    private static final Pattern TAOBAO_USER_COOKIE = Pattern.compile("(?:^|;\\s*)unb\\s*=\\s*[^;\\s]+");

    private BrowserSessionSupport() {}

    static void useDeviceUserAgent(WebView webView) {
        webView.getSettings().setUserAgentString(WebSettings.getDefaultUserAgent(webView.getContext()));
    }

    static boolean supportsAccountProfiles() {
        return WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE);
    }

    static void requireAccountProfiles() {
        if (!supportsAccountProfiles()) throw new IllegalStateException("browser_account_isolation_unavailable");
    }

    static CookieManager accountCookies(BrowserAccountScope.Binding binding) {
        ACCOUNTS.requireCurrent(binding);
        requireAccountProfiles();
        return ProfileStore.getInstance().getOrCreateProfile(binding.profile).getCookieManager();
    }

    static CookieManager attachAccount(WebView webView, BrowserAccountScope.Binding binding) {
        ACCOUNTS.requireCurrent(binding);
        requireAccountProfiles();
        WebViewCompat.setProfile(webView, binding.profile);
        return WebViewCompat.getProfile(webView).getCookieManager();
    }

    static void persistCookies(CookieManager manager) {
        if (manager == null) return;
        // CookieManager.flush can perform blocking disk I/O; keep that work off the UI thread.
        COOKIE_WRITER.execute(() -> {
            try { manager.flush(); } catch (RuntimeException ignored) {}
        });
    }

    /**
     * 页面即将停止或返回时同步落盘一次登录 Cookie。
     * 后台队列在进程被系统回收时可能来不及写盘，这正是"隔天掉登录"的常见原因之一；
     * 这里只在 onStop / 返回灯塔这种非交互时刻调用，避免滚动或点击卡顿。
     */
    static void persistCookiesNow(CookieManager manager) {
        if (manager == null) return;
        try { manager.flush(); } catch (RuntimeException ignored) {}
    }

    /** WebView 渲染进程被系统回收后，最多自动重建两次，避免一次内存回收就把点餐页判死。 */
    static boolean canRecoverRenderer(int attempts) {
        return attempts >= 0 && attempts < 2;
    }

    /** 主文档网络失败只自动重试一次，随后交给用户，避免无限刷新。 */
    static boolean canRetryNavigation(int attempts) {
        return attempts >= 0 && attempts < 1;
    }

    static String accountErrorCode(Throwable error) {
        String code = error == null ? "" : error.getMessage();
        if ("browser_account_required".equals(code) || "browser_account_changed".equals(code) || "browser_account_restore_required".equals(code)
            || "browser_account_isolation_unavailable".equals(code) || "browser_site_invalid".equals(code)) return code;
        return "browser_account_binding_failed";
    }

    static String accountErrorMessage(String code) {
        if ("browser_account_restore_required".equals(code)) return "网页被系统重建，当前页面会话无法恢复。请返回灯塔重新打开；已保存的登录资料未被清除。";
        if ("browser_account_isolation_unavailable".equals(code)) return "当前系统 WebView 不支持账号独立登录。请更新 Android System WebView；也可在系统浏览器或外卖 App 手动操作，本次未读取旧账号登录态。";
        if ("browser_account_required".equals(code)) return "请回到灯塔登录账号，再从应用内打开网页；外部链接不能读取灯塔账号的登录态。";
        if ("browser_account_changed".equals(code)) return "灯塔账号已变化，本次网页自动操作已停止。请回到当前账号重新打开；原账号登录数据仍保留。";
        if ("browser_site_invalid".equals(code)) return "站点标识无效，未读取登录态。请从应用内重新打开。";
        return "无法绑定当前灯塔账号的浏览器，请返回后重新打开；未使用共享登录态。";
    }

    static boolean mayOpenExternalNavigation(boolean userGesture, boolean mainFrame) {
        return userGesture && mainFrame;
    }

    static boolean isCurrentNavigationFailure(String failedUrl, String currentUrl, boolean mainFrame) {
        return mainFrame && failedUrl != null && !failedUrl.isEmpty() && failedUrl.equals(currentUrl);
    }

    static String publicTakeoutSearchErrorCode(String status, String code) {
        if (!"error".equals(status) || code == null) return "";
        switch (code) {
            case "browser_account_required": case "browser_account_changed": case "browser_account_restore_required":
            case "browser_account_isolation_unavailable": case "browser_account_binding_failed":
            case "takeout_page_not_ready": case "takeout_page_touch_unavailable": case "takeout_page_init_failed":
            case "takeout_page_renderer_failed": case "takeout_page_load_failed": case "takeout_page_interrupted": return code;
            case "takeout_manual_review_required": case "takeout_cart_unverified": case "takeout_quantity_unverified":
            case "takeout_menu_unavailable": case "takeout_note_review_required": return code;
            default: return "";
        }
    }

    static boolean hasAuthenticationCookie(String cookie) {
        return cookie != null && (AUTH_COOKIE.matcher(cookie).find()
            || TAOBAO_SESSION_COOKIE.matcher(cookie).find() && TAOBAO_USER_COOKIE.matcher(cookie).find());
    }

    static LoginDecision loginDecision(String state, int attempt) {
        if ("login_required".equals(state)) return LoginDecision.REQUIRED;
        if ("ready".equals(state)) return LoginDecision.READY;
        return attempt < 6 ? LoginDecision.WAIT : LoginDecision.NOT_READY;
    }

    static float[] nativeTouchPoint(double x, double y, double viewportWidth, double viewportHeight, int viewWidth, int viewHeight) {
        if (!Double.isFinite(x) || !Double.isFinite(y) || !Double.isFinite(viewportWidth) || !Double.isFinite(viewportHeight)
            || viewportWidth < 1 || viewportHeight < 1 || viewportWidth > 32768 || viewportHeight > 32768
            || viewWidth < 1 || viewHeight < 1 || viewWidth > 32768 || viewHeight > 32768
            || x < 0 || y < 0 || x >= viewportWidth || y >= viewportHeight) return null;
        double scaleX = viewWidth / viewportWidth, scaleY = viewHeight / viewportHeight;
        if (scaleX < 0.1 || scaleX > 16 || scaleY < 0.1 || scaleY > 16) return null;
        return new float[]{(float) Math.min(viewWidth - 1, x * scaleX), (float) Math.min(viewHeight - 1, y * scaleY)};
    }

    static String browserErrorMessage(String code) {
        if (code != null && code.startsWith("browser_account_")) return accountErrorMessage(code);
        if ("browser_page_init_failed".equals(code)) return "浏览器初始化失败，页面没有被自动关闭。请重试打开。";
        if ("browser_page_renderer_failed".equals(code)) return "网页渲染进程已退出，登录信息仍保存在本机。请重新打开网页。";
        if ("browser_page_load_failed".equals(code)) return "网页加载失败，请检查网络后重新打开。";
        return "网页暂时不可用，请重新打开。";
    }

    static final String LOGIN_STATE_SCRIPT = "(function(){"
        + "function visible(e){if(!e||!e.getBoundingClientRect)return false;var r=e.getBoundingClientRect();"
        + "var s=window.getComputedStyle(e);return r.width>1&&r.height>1&&s.display!=='none'&&s.visibility!=='hidden';}"
        + "var t=(document.body&&document.body.innerText)||'';"
        + "var path=String(window.location&&window.location.pathname||''),host=String(window.location&&window.location.hostname||'');"
        + "if(/(?:^|\\/)(?:login|signin)(?:[.\\/]|$)/i.test(path)||/^(?:login(?:\\.m)?|passport|auth)\\.(?:taobao\\.com|ele\\.me|tmall\\.com)$/i.test(host))return {state:'login_required'};"
        + "var inputs=[].slice.call(document.querySelectorAll('input[type=tel],input[type=password],input[autocomplete=username],input[autocomplete=one-time-code]'));"
        + "var form=inputs.some(visible);"
        + "var prompt=/请先登录|请登录后|手机号登录|短信验证码登录|扫码登录|登录淘宝/.test(t);"
        + "var frames=[].slice.call(document.querySelectorAll('iframe[src*=\"login\"],iframe[src*=\"passport\"]'));"
        + "if((form&&prompt)||frames.some(visible))return {state:'login_required'};"
        + "if(/起送|月售|收货地址|加入购物车|选规格/.test(t))return {state:'ready'};"
        + "return {state:'unknown'};"
        + "})();";
}
