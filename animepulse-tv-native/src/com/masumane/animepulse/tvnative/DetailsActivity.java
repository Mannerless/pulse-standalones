package com.masumane.animepulse.tvnative;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.Html;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public class DetailsActivity extends Activity {
    static final int BG = 0xFF0B1020;
    static final int PANEL = 0xFF141A2E;
    static final int TEXT = 0xFFFFFFFF;
    static final int MUTED = 0xFFB8C0D4;
    static final int CYAN = 0xFF1CF0FF;
    static final int ACCENT = 0xFF7B2FF7;
    static final String EXTRA_ID = "animeId";
    static final String EXTRA_TITLE = "title";

    int animeId;
    String fallbackTitle;
    ApiClient api;
    ImageView banner;
    TextView titleView;
    TextView metaView;
    TextView synopsisView;
    TextView statusView;
    LinearLayout episodeRow;
    final Set<Integer> cachedEps = new HashSet<Integer>();
    int episodeCount = 0;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        hideSystemUi();

        animeId = getIntent().getIntExtra(EXTRA_ID, 0);
        fallbackTitle = getIntent().getStringExtra(EXTRA_TITLE);
        if (fallbackTitle == null) fallbackTitle = "Anime Pulse";

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);

        banner = new ImageView(this);
        banner.setScaleType(ImageView.ScaleType.CENTER_CROP);
        banner.setBackgroundColor(PANEL);
        root.addView(banner, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(180)));

        int pad = dp(20);
        ScrollView scroll = new ScrollView(this);
        LinearLayout body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(pad, dp(14), pad, pad);

        titleView = new TextView(this);
        titleView.setText(fallbackTitle);
        titleView.setTextColor(TEXT);
        titleView.setTypeface(Typeface.DEFAULT_BOLD);
        titleView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        body.addView(titleView);

        metaView = new TextView(this);
        metaView.setTextColor(MUTED);
        metaView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        metaView.setPadding(0, dp(6), 0, dp(10));
        body.addView(metaView);

        statusView = new TextView(this);
        statusView.setTextColor(MUTED);
        statusView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        statusView.setText("Loading details…");
        body.addView(statusView);

        TextView epLabel = new TextView(this);
        epLabel.setText("Episodes");
        epLabel.setTextColor(TEXT);
        epLabel.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        epLabel.setPadding(0, dp(12), 0, dp(8));
        body.addView(epLabel);

        HorizontalScrollView hsv = new HorizontalScrollView(this);
        hsv.setHorizontalScrollBarEnabled(false);
        episodeRow = new LinearLayout(this);
        episodeRow.setOrientation(LinearLayout.HORIZONTAL);
        hsv.addView(episodeRow);
        body.addView(hsv);

        synopsisView = new TextView(this);
        synopsisView.setTextColor(TEXT);
        synopsisView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        synopsisView.setPadding(0, dp(16), 0, 0);
        synopsisView.setLineSpacing(0, 1.15f);
        body.addView(synopsisView);

        scroll.addView(body);
        root.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        api = new ApiClient(TokenStore.read(this));
        if (!api.hasToken() || animeId <= 0) {
            statusView.setText("Missing token or anime id.");
            return;
        }
        load();
    }

    void load() {
        new Thread(new Runnable() {
            public void run() {
                try {
                    JSONObject details = api.getDetails(animeId, 1);
                    JSONObject anime = details.optJSONObject("anime");
                    if (anime == null) throw new Exception("No anime in details");
                    final String title = Show.pickTitle(anime.optJSONObject("title"));
                    String descRaw = anime.optString("description", "");
                    final String desc = stripHtml(descRaw);
                    final int eps = anime.optInt("episodes");
                    final int score = anime.optInt("averageScore");
                    final String format = anime.optString("format", "");
                    final String status = anime.optString("status", "");
                    JSONArray genres = anime.optJSONArray("genres");
                    StringBuilder g = new StringBuilder();
                    if (genres != null) {
                        for (int i = 0; i < genres.length(); i++) {
                            if (g.length() > 0) g.append("  ·  ");
                            g.append(genres.optString(i));
                        }
                    }
                    final String genreLine = g.toString();
                    JSONObject cover = anime.optJSONObject("coverImage");
                    String bannerUrl = anime.optString("bannerImage", "");
                    if (bannerUrl == null || !bannerUrl.startsWith("http")) {
                        bannerUrl = cover != null ? Show.firstUrl(cover, "extraLarge", "large", "medium") : "";
                    }
                    final String art = bannerUrl;
                    final int coverW = getResources().getDisplayMetrics().widthPixels;

                    final Set<Integer> cached = new HashSet<Integer>();
                    try {
                        JSONObject lib = api.getLibrary();
                        JSONArray items = lib.optJSONArray("library");
                        if (items != null) {
                            String idStr = String.valueOf(animeId);
                            for (int i = 0; i < items.length(); i++) {
                                JSONObject it = items.optJSONObject(i);
                                if (it != null && idStr.equals(String.valueOf(it.opt("animeId")))) {
                                    cached.add(it.optInt("episode"));
                                }
                            }
                        }
                    } catch (Exception ignored) {}

                    runOnUiThread(new Runnable() {
                        public void run() {
                            titleView.setText(title.length() > 0 ? title : fallbackTitle);
                            String meta = (score > 0 ? score + "%  ·  " : "")
                                    + (format.length() > 0 ? format + "  ·  " : "")
                                    + (eps > 0 ? eps + " episodes  ·  " : "")
                                    + status;
                            if (genreLine.length() > 0) meta += "\n" + genreLine;
                            metaView.setText(meta);
                            synopsisView.setText(desc);
                            episodeCount = eps;
                            cachedEps.clear();
                            cachedEps.addAll(cached);
                            if (!cached.isEmpty()) {
                                statusView.setText(cached.size() + " cached episode"
                                        + (cached.size() == 1 ? "" : "s") + " ready to play");
                            } else if (eps > 0) {
                                statusView.setText("No cached episodes on the server for this title yet.");
                            } else {
                                statusView.setText("Episode count unknown.");
                            }
                            if (art != null && art.startsWith("http")) {
                                ImageLoader.get(DetailsActivity.this).bind(banner, art, coverW);
                            }
                            populateEpisodes();
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        public void run() {
                            statusView.setText("Failed to load details: " + MainActivity.safeMessage(e));
                        }
                    });
                }
            }
        }, "ap-details").start();
    }

    void populateEpisodes() {
        episodeRow.removeAllViews();
        List<Integer> list = new ArrayList<Integer>();
        if (episodeCount > 0) {
            int max = Math.min(episodeCount, 48);
            for (int i = 1; i <= max; i++) list.add(i);
        } else {
            list.addAll(cachedEps);
        }
        if (list.isEmpty()) {
            TextView none = new TextView(this);
            none.setText("No episode list available.");
            none.setTextColor(MUTED);
            episodeRow.addView(none);
            return;
        }
        for (int i = 0; i < list.size(); i++) {
            final int ep = list.get(i);
            boolean cached = cachedEps.contains(ep);
            Button b = new Button(this);
            b.setText(cached ? "Ep " + ep + "  cached" : "Ep " + ep);
            b.setAllCaps(false);
            b.setTextColor(TEXT);
            b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            b.setMinHeight(dp(44));
            b.setMinWidth(dp(88));
            b.setPadding(dp(14), dp(6), dp(14), dp(6));
            GradientDrawable bg = new GradientDrawable();
            bg.setCornerRadius(dp(8));
            bg.setColor(cached ? ACCENT : PANEL);
            b.setBackground(bg);
            b.setFocusable(true);
            final boolean canPlay = cached;
            b.setOnFocusChangeListener(new View.OnFocusChangeListener() {
                public void onFocusChange(View v, boolean hasFocus) {
                    GradientDrawable d = new GradientDrawable();
                    d.setCornerRadius(dp(8));
                    d.setColor(canPlay ? ACCENT : PANEL);
                    d.setStroke(dp(3), hasFocus ? CYAN : 0x00000000);
                    v.setBackground(d);
                }
            });
            b.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) {
                    if (!canPlay) {
                        statusView.setText("Episode " + ep + " is not cached on the server.");
                        return;
                    }
                    Intent i = new Intent(DetailsActivity.this, PlayerActivity.class);
                    i.putExtra(PlayerActivity.EXTRA_ID, animeId);
                    i.putExtra(PlayerActivity.EXTRA_EPISODE, ep);
                    i.putExtra(PlayerActivity.EXTRA_TITLE, titleView.getText().toString());
                    startActivity(i);
                }
            });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, dp(48));
            lp.rightMargin = dp(10);
            episodeRow.addView(b, lp);
        }
        if (episodeRow.getChildCount() > 0) episodeRow.getChildAt(0).requestFocus();
    }

    static String stripHtml(String raw) {
        if (raw == null) return "";
        String s = raw.replaceAll("(?i)<br */?>", "\n").replaceAll("(?i)</p>", "\n");
        if (android.os.Build.VERSION.SDK_INT >= 24) {
            s = Html.fromHtml(s, Html.FROM_HTML_MODE_LEGACY).toString();
        } else {
            s = Html.fromHtml(s).toString();
        }
        return s.trim();
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
