package com.swupl.orps;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.text.InputType;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.view.Gravity;
import android.view.KeyEvent;

/**
 * 海安预警 - WebView 壳
 * 首次启动可填写/修改服务器地址（SharedPreferences 记忆），
 * 之后启动直达系统全屏页面。
 */
public class MainActivity extends Activity {

    private static final String PREFS = "orps_prefs";
    private static final String KEY_URL = "server_url";
    private static final String DEFAULT_URL = "https://eiwye.github.io/overseas-interest-protection-platform/";

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Window w = getWindow();
        w.setFlags(WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS);
        w.setStatusBarColor(Color.parseColor("#070B14"));
        w.setNavigationBarColor(Color.parseColor("#070B14"));

        String url = getPrefs().getString(KEY_URL, DEFAULT_URL);
        showWeb(url);
    }

    private SharedPreferences getPrefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private void showWeb(String url) {
        webView = new WebView(this);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage 必需（登录态/数据缓存）
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        webView.setWebViewClient(new WebViewClient() {  // 内部跳转不弹浏览器
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                // 加载失败（地址错/服务器没开）→ 直接弹地址设置，不让用户卡死
                showUrlDialog();
            }
        });
        webView.setBackgroundColor(Color.parseColor("#070B14"));
        setContentView(webView);
        webView.loadUrl(url);
    }

    /** 长按屏幕 2 秒弹出服务器地址设置（现场换地址不用重装） */
    @Override
    public boolean onKeyLongPress(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            showUrlDialog();
            return true;
        }
        return super.onKeyLongPress(keyCode, event);
    }

    private void showUrlDialog() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(getPrefs().getString(KEY_URL, DEFAULT_URL));
        input.setTextColor(Color.WHITE);
        int pad = (int) (20 * getResources().getDisplayMetrics().density);
        input.setPadding(pad, pad, pad, pad);
        new AlertDialog.Builder(this)
                .setTitle("服务器地址")
                .setView(input)
                .setPositiveButton("保存并连接", (d, which) -> {
                    String u = input.getText().toString().trim();
                    if (!u.startsWith("http")) u = "https://" + u;
                    getPrefs().edit().putString(KEY_URL, u).apply();
                    webView.loadUrl(u);
                })
                .setNegativeButton("取消", null)
                .show();
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
