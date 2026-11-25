package com.masumane.animepulse.tvwrapper;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.util.DisplayMetrics;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URLEncoder;
import java.nio.charset.Charset;

/**
 * Fullscreen Fire TV WebView for Anime Pulse.
 * Token is read from app-private files/share_token (injected after install).
 * Never log the token or the tokened URL.
 */
public class MainActivity extends Activity {
    static final String BASE_URL = "http://100.118.77.78:7888/";
    static final int LAYOUT_WIDTH_CSS = 1920;

    WebView webView;
    FrameLayout root;
    FrameLayout videoContainer;
    View customView;
    WebChromeClient.CustomViewCallback customViewCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        hideSystemUi();

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        webView = new WebView(this);
        videoContainer = new FrameLayout(this);
        videoContainer.setBackgroundColor(Color.BLACK);
        videoContainer.setVisibility(View.GONE);
        root.addView(webView, matchParent());
        root.addView(videoContainer, matchParent());
        setContentView(root);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setDefaultTextEncodingName("utf-8");
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        DisplayMetrics dm = getResources().getDisplayMetrics();
        float cssWidth = dm.widthPixels / dm.density;
        int initial = Math.round(100f * cssWidth / (float) LAYOUT_WIDTH_CSS);
        if (initial < 1) initial = 1;
        webView.setInitialScale(initial);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(webView, true);

        webView.setBackgroundColor(Color.BLACK);
        webView.setFocusable(true);
        webView.setFocusableInTouchMode(true);
        webView.requestFocus();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(view, url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                if (req == null || req.getUrl() == null) return true;
                return handleUrl(view, req.getUrl().toString());
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                injectViewport(view);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                webView.setVisibility(View.GONE);
                videoContainer.setVisibility(View.VISIBLE);
                videoContainer.addView(view, matchParent());
                hideSystemUi();
            }

            @Override
            public void onHideCustomView() {
                exitCustomView();
            }
        });

        String token = readToken();
        String url = BASE_URL;
        if (token != null && token.length() > 0) {
            try {
                url = BASE_URL + "?token=" + URLEncoder.encode(token, "UTF-8");
            } catch (Exception ignored) {
                url = BASE_URL;
            }
        }
        webView.loadUrl(url);
    }

    boolean handleUrl(WebView view, String url) {
        if (url == null) return true;
        if (url.startsWith("http://100.118.77.78:7888")
                || url.startsWith("http://10.146.65.53:7888")
                || url.startsWith("http://127.0.0.1:7888")
                || url.startsWith("blob:")
                || url.startsWith("data:")) {
            return false;
        }
        return true;
    }

    void injectViewport(WebView view) {
        view.evaluateJavascript(
                "(function(){"
                        + "var m=document.querySelector('meta[name=viewport]');"
                        + "if(!m){m=document.createElement('meta');m.setAttribute('name','viewport');"
                        + "if(document.head)document.head.appendChild(m);}"
                        + "m.setAttribute('content','width=1920, user-scalable=no');"
                        + "document.documentElement.classList.add('tv-mode');"
                        + "if(document.body)document.body.classList.add('tv-mode');"
                        + "})();",
                null);
    }

    String readToken() {
        File f = new File(getFilesDir(), "share_token");
        String fromFile = readStream(openFile(f));
        if (fromFile != null && fromFile.length() > 0) return fromFile;
        // Optional fallback used only if scripts/bake-token.sh was invoked.
        try {
            return readStream(getAssets().open("share_token"));
        } catch (Exception e) {
            return null;
        }
    }

    InputStream openFile(File f) {
        try {
            if (f.isFile()) return new FileInputStream(f);
        } catch (Exception ignored) {}
        return null;
    }

    String readStream(InputStream in) {
        if (in == null) return null;
        BufferedReader r = null;
        try {
            r = new BufferedReader(new InputStreamReader(in, Charset.forName("UTF-8")));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) {
                if (sb.length() > 0) sb.append('\n');
                sb.append(line);
            }
            return sb.toString().trim();
        } catch (Exception e) {
            return null;
        } finally {
            try { if (r != null) r.close(); } catch (Exception ignored) {}
            try { in.close(); } catch (Exception ignored) {}
        }
    }

    void exitCustomView() {
        if (customView == null) return;
        videoContainer.removeAllViews();
        videoContainer.setVisibility(View.GONE);
        customView = null;
        if (customViewCallback != null) {
            customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
        webView.setVisibility(View.VISIBLE);
        webView.requestFocus();
        hideSystemUi();
    }

    void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
    }

    static FrameLayout.LayoutParams matchParent() {
        return new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    public void onBackPressed() {
        if (customView != null) {
            exitCustomView();
            return;
        }
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        // Let D-pad arrows and SELECT reach the page (tv.js spatial nav).
        // Only intercept BACK here so fullscreen video and history work.
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK
                && event.getAction() == KeyEvent.ACTION_UP) {
            onBackPressed();
            return true;
        }
        if (event.getKeyCode() == KeyEvent.KEYCODE_BACK) {
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemUi();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            root.removeView(webView);
            webView.stopLoading();
            webView.setWebChromeClient(null);
            webView.setWebViewClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
