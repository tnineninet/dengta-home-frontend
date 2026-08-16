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

import org.json.JSONObject;

public class OrderWebActivity extends Activity {
    private WebView webView;
    private String mode;
    private String configJson;
    private int orderStep = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        try {
            onCreateGuarded(savedInstanceState);
        } catch (Throwable error) {
            // 页面创建失败时优雅结束,不让整个 App 进程崩溃。
            finish();
        }
    }

    private void onCreateGuarded(Bundle savedInstanceState) {
        String url = getIntent().getStringExtra("url");
        mode = getIntent().getStringExtra("mode");
        configJson = getIntent().getStringExtra("config");
        String title = getIntent().getStringExtra("title");

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        TextView header = new TextView(this);
        header.setText(title + "（付款请在此页面人工确认）");
        header.setPadding(24, 24, 24, 12);
        root.addView(header, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUserAgentString(settings.getUserAgentString() + " DengTaOrder/1.0");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setWebChromeClient(new WebChromeClient());
        webView.addJavascriptInterface(new OrderBridge(this), "DengTaOrderBridge");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                // 渲染进程崩溃时结束本页面,避免整个 App 进程被杀。
                finish();
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String finishedUrl) {
                super.onPageFinished(view, finishedUrl);
                injectGeolocation(view);
                if ("search".equals(mode)) {
                    view.postDelayed(() -> runSearchStep(view), 2500);
                } else if ("order".equals(mode)) {
                    if (orderStep == 0) {
                        view.postDelayed(() -> runOrderStep(view), 2500);
                    } else if (orderStep == 1) {
                        view.postDelayed(() -> addProductStep(view), 3000);
                    }
                    // orderStep>=2：购物车/结算页，交给用户人工付款
                }
            }
        });
        root.addView(webView, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, 1f));

        Button done = new Button(this);
        done.setText("完成后点这里返回");
        done.setOnClickListener(v -> finishWithResult("{\"status\":\"awaiting_payment\",\"note\":\"用户已在页面确认\"}"));
        root.addView(done, new LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        setContentView(root);
        webView.loadUrl(url);
    }

    private void injectGeolocation(WebView view) {
        try {
            LocationManager manager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            Location last = null;
            for (String provider : new String[]{LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER}) {
                try {
                    Location candidate = manager.getLastKnownLocation(provider);
                    if (candidate != null) { last = candidate; break; }
                } catch (Exception ignored) {}
            }
            if (last == null) return;
            double lat = last.getLatitude();
            double lng = last.getLongitude();
            double acc = last.hasAccuracy() ? last.getAccuracy() : 60;
            String js = "try{window.__dengtaGeo={lat:" + lat + ",lng:" + lng + ",acc:" + acc + "};"
                + "navigator.geolocation.getCurrentPosition=function(s,e){s({coords:{latitude:" + lat + ",longitude:" + lng + ",accuracy:" + acc + "},timestamp:Date.now()});};"
                + "navigator.geolocation.watchPosition=function(s,e){s({coords:{latitude:" + lat + ",longitude:" + lng + ",accuracy:" + acc + "},timestamp:Date.now()});return 1;};}catch(err){}";
            view.evaluateJavascript(js, null);
        } catch (Exception ignored) {}
    }

    private void runSearchStep(WebView view) {
        String js = "(function(){"
            + "function txt(e){return (e.innerText||'').replace(/\\n+/g,' | ').replace(/\\s+/g,' ').trim();}"
            + "var cards=[].slice.call(document.querySelectorAll('[class*=\"card\" i],[class*=\"item\" i]'))"
            + ".map(function(e){return {t:txt(e),e:e};}).filter(function(x){return /起送¥/.test(x.t)&&x.t.length<300;})"
            + ".slice(0,20).map(function(x){var m=x.t.match(/([^|]{2,40})\\s*\\|\\s*([\\d.]+)\\s*\\|\\s*分/);"
            + "return {name:m?m[1].trim():x.t.slice(0,40),meta:x.t.slice(0,200)};});"
            + "return {shops:cards};"
            + "})();";
        view.evaluateJavascript(js, value -> finishWithResult(value));
    }

    private void runOrderStep(WebView view) {
        try {
            JSONObject config = new JSONObject(configJson);
            String shopName = config.optString("shop_name", "");
            String product = config.optString("product", "");
            String js = "(function(){"
                + "var shop=" + JSONObject.quote(shopName) + ";"
                + "function txt(e){return (e.innerText||'').replace(/\\n+/g,' ').replace(/\\s+/g,' ').trim();}"
                + "var cards=[].slice.call(document.querySelectorAll('[class*=\"card\" i],[class*=\"item\" i]'))"
                + ".map(function(e){return {t:txt(e),e:e};}).filter(function(x){return /起送¥/.test(x.t)&&x.t.length<300;});"
                + "var target=null;"
                + "for(var i=0;i<cards.length;i++){if(cards[i].t.indexOf(shop)>=0||(shop.length>4&&shop.indexOf(cards[i].t.slice(0,6))>=0)){target=cards[i].e;break;}}"
                + "if(!target&&cards.length){target=cards[0].e;}"
                + "if(!target){return {status:'shop_not_found'};}"
                + "target.setAttribute('data-dengta-pick','1');"
                + "document.querySelector('[data-dengta-pick=\"1\"]').click();"
                + "return {status:'opening_shop',shop:(target.innerText||'').replace(/\\n+/g,' ').slice(0,80)};"
                + "})();";
            orderStep = 1;
            view.evaluateJavascript(js, null);
        } catch (Exception error) {
            finishWithResult("{\"status\":\"error\",\"error\":\"参数解析失败\"}");
        }
    }

    private void addProductStep(WebView view) {
        try {
            JSONObject config = new JSONObject(configJson);
            String product = config.optString("product", "");
            orderStep = 2;
            String js = "(function(){"
                + "var p=" + JSONObject.quote(product) + ";"
                + "function txt(e){return (e.innerText||'').replace(/\\n+/g,' ').replace(/\\s+/g,' ').trim();}"
                + "var items=[].slice.call(document.querySelectorAll('[class*=\"menuItem\" i],[class*=\"menu-item\" i]'))"
                + ".map(function(e){return {t:txt(e),e:e};}).filter(function(x){return x.t.length>3&&x.t.length<200;});"
                + "var target=null;"
                + "for(var i=0;i<items.length;i++){if(items[i].t.indexOf(p)>=0||(p.length>4&&p.indexOf(items[i].t.slice(0,4))>=0)){target=items[i].e;break;}}"
                + "if(!target&&items.length){target=items[0].e;}"
                + "if(!target){return {status:'product_not_found'};}"
                + "target.setAttribute('data-dengta-product','1');"
                + "document.querySelector('[data-dengta-product=\"1\"]').click();"
                + "return {status:'opening_product'};"
                + "})();";
            view.evaluateJavascript(js, value -> {
                view.postDelayed(() -> {
                    String addJs = "(function(){"
                        + "var btn=[].slice.call(document.querySelectorAll('*')).find(function(e){return e.innerText&&e.innerText.trim().indexOf('加入购物车')>=0;});"
                        + "if(btn){btn.click();return {ok:'clicked_add'};}"
                        + "return {ok:'no_add_button'};"
                        + "})();";
                    view.evaluateJavascript(addJs, addValue -> {
                        view.postDelayed(() -> {
                            String skuJs = "(function(){"
                                + "var sku=document.querySelector('.sku__button');"
                                + "if(sku){sku.click();return {ok:'sku_clicked'};}"
                                + "return {ok:'no_sku'};"
                                + "})();";
                            view.evaluateJavascript(skuJs, skuValue -> {
                                // 进入购物车/结算页（不自动付款）
                                view.postDelayed(() -> {
                                    try { view.loadUrl("https://h5.ele.me/msite/cart"); } catch (Exception ignored) {}
                                }, 1500);
                            });
                        }, 1500);
                    });
                }, 3000);
            });
        } catch (Exception error) {
            finishWithResult("{\"status\":\"error\",\"error\":\"选品失败\"}");
        }
    }

    private void finishWithResult(String resultJson) {
        Intent data = new Intent();
        data.putExtra("result", resultJson);
        setResult(Activity.RESULT_OK, data);
        finish();
    }

    @Override
    public void onBackPressed() {
        Intent data = new Intent();
        data.putExtra("message", "用户关闭了点餐页面。");
        setResult(Activity.RESULT_CANCELED, data);
        super.onBackPressed();
    }

    private static final class OrderBridge {
        private final OrderWebActivity activity;
        OrderBridge(OrderWebActivity activity) { this.activity = activity; }
        @JavascriptInterface
        public void postResult(String json) {
            activity.runOnUiThread(() -> activity.finishWithResult(json));
        }
    }
}
