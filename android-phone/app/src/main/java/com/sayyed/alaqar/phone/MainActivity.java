package com.sayyed.alaqar.phone;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

/**
 * يعرض وحدة تحكم الهاتف (صفحة اللعب) من خادم سيد العقار داخل WebView.
 * من هنا ينشئ اللاعب الغرفة أو ينضم إليها ويلعب من هاتفه.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "sayyed";
    private static final String KEY_URL = "server_url";

    private WebView web;
    private SharedPreferences prefs;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private long lastBack = 0;
    private boolean failed = false;

    private final Runnable retry = new Runnable() {
        @Override public void run() { if (failed) loadGame(); }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0B1220"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // لتشغيل المؤثرات الصوتية دون لمس
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setTextZoom(100);

        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                if (!failed) handler.removeCallbacks(retry);
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) showOffline();
            }
        });

        String url = serverUrl();
        if (url.isEmpty()) askUrl(true); else loadGame();
    }

    private String serverUrl() {
        String saved = prefs.getString(KEY_URL, "");
        String u = (saved != null && !saved.isEmpty()) ? saved : BuildConfig.SERVER_URL;
        u = u == null ? "" : u.trim();
        if (u.isEmpty()) return "";
        if (!u.startsWith("http://") && !u.startsWith("https://")) u = "http://" + u;
        while (u.endsWith("/")) u = u.substring(0, u.length() - 1);
        return u;
    }

    private void loadGame() {
        failed = false;
        String u = serverUrl();
        if (u.isEmpty()) { askUrl(true); return; }
        web.loadUrl(u + "/play/");
    }

    private void showOffline() {
        failed = true;
        String html = "<html><body style='margin:0;background:#0b1220;color:#e9eef7;font-family:sans-serif;"
                + "display:flex;align-items:center;justify-content:center;height:100vh;text-align:center' dir='rtl'>"
                + "<div><h1 style='color:#e2b24f;font-size:56px'>سيد العقار</h1>"
                + "<p style='font-size:30px'>تعذر الاتصال بالخادم</p>"
                + "<p style='font-size:22px;color:#9aa7bd'>" + serverUrl() + "<br>تتم إعادة المحاولة تلقائياً. اضغط زر القائمة لتغيير العنوان.</p></div></body></html>";
        web.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
        handler.removeCallbacks(retry);
        handler.postDelayed(retry, 5000);
    }

    private void askUrl(final boolean firstRun) {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setText(serverUrl());
        input.setHint("https://example.com أو http://192.168.1.10:3000");
        input.setTextDirection(View.TEXT_DIRECTION_LTR);
        new AlertDialog.Builder(this)
                .setTitle("عنوان خادم سيد العقار")
                .setView(input)
                .setCancelable(!firstRun)
                .setPositiveButton("حفظ", (d, w) -> {
                    String v = input.getText().toString().trim();
                    if (v.isEmpty()) { Toast.makeText(this, "العنوان فارغ", Toast.LENGTH_SHORT).show(); if (firstRun) askUrl(true); return; }
                    prefs.edit().putString(KEY_URL, v).apply();
                    loadGame();
                })
                .setNegativeButton("إلغاء", (d, w) -> { if (firstRun) finish(); })
                .show();
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_MENU || keyCode == KeyEvent.KEYCODE_SETTINGS) { askUrl(false); return true; }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onBackPressed() {
        long now = System.currentTimeMillis();
        if (now - lastBack < 2000) { super.onBackPressed(); return; }
        lastBack = now;
        Toast.makeText(this, "اضغط رجوع مرة أخرى للخروج", Toast.LENGTH_SHORT).show();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
    }

    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onPause() { web.onPause(); super.onPause(); }
    @Override protected void onDestroy() { handler.removeCallbacks(retry); web.destroy(); super.onDestroy(); }
}
