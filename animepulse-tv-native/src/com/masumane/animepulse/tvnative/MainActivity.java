package com.masumane.animepulse.tvnative;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.ArrayAdapter;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    static final int BG = 0xFF0B1020;
    static final int TEXT = 0xFFFFFFFF;
    static final int MUTED = 0xFFB8C0D4;
    static final int CYAN = 0xFF1CF0FF;

    TextView titleView;
    TextView statusView;
    ListView listView;
    ApiClient api;
    final List<String> rows = new ArrayList<String>();
    ArrayAdapter<String> adapter;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        hideSystemUi();

        int pad = dp(20);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setPadding(pad, dp(16), pad, pad);

        titleView = new TextView(this);
        titleView.setText("Anime Pulse");
        titleView.setTextColor(TEXT);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 28);
        root.addView(titleView);

        statusView = new TextView(this);
        statusView.setTextColor(MUTED);
        statusView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        statusView.setText("Connecting…");
        statusView.setPadding(0, dp(6), 0, dp(12));
        root.addView(statusView);

        listView = new ListView(this);
        listView.setDivider(null);
        listView.setSelector(focusSelector());
        adapter = new ArrayAdapter<String>(this, android.R.layout.simple_list_item_1, rows) {
            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                TextView tv = (TextView) super.getView(position, convertView, parent);
                tv.setTextColor(TEXT);
                tv.setTextSize(TypedValue.COMPLEX_UNIT_SP, 18);
                tv.setPadding(dp(16), dp(14), dp(16), dp(14));
                tv.setMinHeight(dp(48));
                return tv;
            }
        };
        listView.setAdapter(adapter);
        root.addView(listView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        String token = TokenStore.read(this);
        api = new ApiClient(token);
        if (!api.hasToken()) {
            statusView.setText("Share token is not in app storage yet. Run scripts/install-token.sh.");
            return;
        }
        loadFeed();
    }

    void loadFeed() {
        statusView.setText("Loading /api/health and /api/feed…");
        new Thread(new Runnable() {
            public void run() {
                try {
                    JSONObject health = api.getHealth();
                    final boolean ok = health.optBoolean("ok");
                    final long up = health.optLong("uptimeSec");
                    final List<Show> shows = api.getFeed("trending", 1);
                    final List<String> lines = new ArrayList<String>();
                    for (int i = 0; i < shows.size(); i++) {
                        Show s = shows.get(i);
                        lines.add(s.title);
                    }
                    final String status = (ok ? "API healthy" : "API not ok")
                            + "  ·  uptime " + up + "s  ·  " + lines.size() + " trending titles";
                    runOnUiThread(new Runnable() {
                        public void run() {
                            statusView.setText(status);
                            rows.clear();
                            rows.addAll(lines);
                            adapter.notifyDataSetChanged();
                            if (listView.getChildCount() >= 0) listView.requestFocus();
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        public void run() {
                            statusView.setText("Failed to load feed: " + safeMessage(e));
                        }
                    });
                }
            }
        }, "ap-feed").start();
    }

    static String safeMessage(Exception e) {
        String m = e.getMessage();
        if (m == null) return e.getClass().getSimpleName();
        // never surface a query string that might contain a token
        int q = m.indexOf("token=");
        if (q >= 0) return m.substring(0, q) + "token=REDACTED";
        return m;
    }

    GradientDrawable focusSelector() {
        GradientDrawable d = new GradientDrawable();
        d.setColor(0x00000000);
        d.setStroke(dp(3), CYAN);
        d.setCornerRadius(dp(6));
        return d;
    }

    int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
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

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }
}
