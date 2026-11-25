package com.masumane.animepulse.tvnative;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.GridView;
import android.widget.HorizontalScrollView;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    static final int BG = 0xFF0B1020;
    static final int PANEL = 0xFF141A2E;
    static final int TEXT = 0xFFFFFFFF;
    static final int MUTED = 0xFFB8C0D4;
    static final int CYAN = 0xFF1CF0FF;
    static final int ACCENT = 0xFF7B2FF7;
    static final String[] MODES = {"trending", "popular", "airing", "top", "cached"};
    static final String[] MODE_LABELS = {"Trending", "Popular", "Airing", "Top Rated", "Cached"};

    TextView statusView;
    LinearLayout modeRow;
    GridView grid;
    PosterAdapter adapter;
    ApiClient api;
    String mode = "trending";
    final List<Show> shows = new ArrayList<Show>();
    int itemWidth;
    int itemHeight;
    final List<Button> modeButtons = new ArrayList<Button>();

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        hideSystemUi();

        int screenW = getResources().getDisplayMetrics().widthPixels;
        int hPad = dp(20);
        int cols = 5;
        int gap = dp(12);
        itemWidth = (screenW - hPad * 2 - gap * (cols - 1)) / cols;
        itemHeight = Math.round(itemWidth * 1.42f);

        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(BG);
        root.setPadding(hPad, dp(12), hPad, dp(12));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        TextView title = new TextView(this);
        title.setText("Anime Pulse");
        title.setTextColor(TEXT);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        header.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        statusView = new TextView(this);
        statusView.setTextColor(MUTED);
        statusView.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        statusView.setText("Connecting…");
        header.addView(statusView);
        root.addView(header);

        HorizontalScrollView scroller = new HorizontalScrollView(this);
        scroller.setHorizontalScrollBarEnabled(false);
        scroller.setPadding(0, dp(10), 0, dp(10));
        modeRow = new LinearLayout(this);
        modeRow.setOrientation(LinearLayout.HORIZONTAL);
        for (int i = 0; i < MODES.length; i++) {
            final String m = MODES[i];
            Button b = modeButton(MODE_LABELS[i], i == 0);
            b.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) {
                    selectMode(m);
                }
            });
            modeButtons.add(b);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.WRAP_CONTENT, dp(44));
            lp.rightMargin = dp(10);
            modeRow.addView(b, lp);
        }
        scroller.addView(modeRow);
        root.addView(scroller, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        grid = new GridView(this);
        grid.setNumColumns(cols);
        grid.setHorizontalSpacing(gap);
        grid.setVerticalSpacing(gap);
        grid.setStretchMode(GridView.STRETCH_COLUMN_WIDTH);
        grid.setSelector(android.R.color.transparent);
        grid.setClipToPadding(false);
        adapter = new PosterAdapter();
        grid.setAdapter(adapter);
        root.addView(grid, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        setContentView(root);

        String token = TokenStore.read(this);
        api = new ApiClient(token);
        if (!api.hasToken()) {
            statusView.setText("Share token is not in app storage yet.");
            return;
        }
        loadFeed();
    }

    void selectMode(String m) {
        mode = m;
        for (int i = 0; i < modeButtons.size(); i++) {
            styleModeButton(modeButtons.get(i), MODES[i].equals(mode));
        }
        loadFeed();
    }

    Button modeButton(String label, boolean selected) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        b.setMinHeight(dp(44));
        b.setPadding(dp(16), dp(6), dp(16), dp(6));
        styleModeButton(b, selected);
        return b;
    }

    void styleModeButton(Button b, boolean selected) {
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(22));
        if (selected) {
            bg.setColor(ACCENT);
            b.setTextColor(TEXT);
        } else {
            bg.setColor(PANEL);
            b.setTextColor(MUTED);
        }
        bg.setStroke(dp(2), selected ? ACCENT : 0x00000000);
        b.setBackground(focusAware(bg));
    }

    GradientDrawable focusAware(GradientDrawable base) {
        return base;
    }

    void loadFeed() {
        statusView.setText("Loading " + mode + "…");
        final String requested = mode;
        new Thread(new Runnable() {
            public void run() {
                try {
                    JSONObject health = api.getHealth();
                    final boolean ok = health.optBoolean("ok");
                    final List<Show> list = "cached".equals(requested)
                            ? loadCachedShows() : api.getFeed(requested, 1);
                    runOnUiThread(new Runnable() {
                        public void run() {
                            if (!requested.equals(mode)) return;
                            shows.clear();
                            shows.addAll(list);
                            adapter.notifyDataSetChanged();
                            statusView.setText((ok ? "API healthy" : "API not ok")
                                    + "  ·  " + list.size() + " titles");
                            if (grid.getChildCount() >= 0) grid.requestFocus();
                        }
                    });
                } catch (final Exception e) {
                    runOnUiThread(new Runnable() {
                        public void run() {
                            statusView.setText("Failed to load: " + safeMessage(e));
                        }
                    });
                }
            }
        }, "ap-feed").start();
    }


    void openDetails(Show show) {
        if (show == null || show.id <= 0) return;
        Intent i = new Intent(this, DetailsActivity.class);
        i.putExtra(DetailsActivity.EXTRA_ID, show.id);
        i.putExtra(DetailsActivity.EXTRA_TITLE, show.title);
        startActivity(i);
    }

    List<Show> loadCachedShows() throws Exception {
        org.json.JSONObject lib = api.getLibrary();
        org.json.JSONArray items = lib.optJSONArray("library");
        List<Show> out = new ArrayList<Show>();
        if (items == null) return out;
        java.util.Set<Integer> seen = new java.util.HashSet<Integer>();
        for (int i = 0; i < items.length(); i++) {
            org.json.JSONObject it = items.optJSONObject(i);
            if (it == null) continue;
            int id;
            try { id = Integer.parseInt(String.valueOf(it.opt("animeId"))); }
            catch (Exception e) { continue; }
            if (id <= 0 || seen.contains(id)) continue;
            seen.add(id);
            Show s = new Show();
            s.id = id;
            s.title = it.optString("title", "Cached title");
            s.episodes = it.optInt("episode");
            try {
                org.json.JSONObject details = api.getDetails(id, Math.max(1, s.episodes));
                org.json.JSONObject anime = details.optJSONObject("anime");
                if (anime != null) {
                    String t = Show.pickTitle(anime.optJSONObject("title"));
                    if (t != null && t.length() > 0) s.title = t;
                    org.json.JSONObject cover = anime.optJSONObject("coverImage");
                    if (cover != null) s.coverUrl = Show.firstUrl(cover, "extraLarge", "large", "medium");
                    s.bannerUrl = anime.optString("bannerImage", "");
                    s.description = anime.optString("description", "");
                }
            } catch (Exception ignored) {}
            out.add(s);
        }
        return out;
    }

    class PosterAdapter extends BaseAdapter {
        public int getCount() { return shows.size(); }
        public Object getItem(int position) { return shows.get(position); }
        public long getItemId(int position) { return shows.get(position).id; }

        public View getView(int position, View convertView, ViewGroup parent) {
            FrameLayout card;
            ImageView art;
            TextView caption;
            if (convertView instanceof FrameLayout) {
                card = (FrameLayout) convertView;
                art = (ImageView) card.getChildAt(0);
                caption = (TextView) card.getChildAt(1);
            } else {
                card = new FrameLayout(MainActivity.this);
                art = new ImageView(MainActivity.this);
                art.setScaleType(ImageView.ScaleType.CENTER_CROP);
                art.setBackgroundColor(PANEL);
                card.addView(art, new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                caption = new TextView(MainActivity.this);
                caption.setTextColor(TEXT);
                caption.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
                caption.setMaxLines(2);
                caption.setPadding(dp(8), dp(6), dp(8), dp(8));
                caption.setBackgroundColor(0xCC0B1020);
                FrameLayout.LayoutParams capLp = new FrameLayout.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
                capLp.gravity = Gravity.BOTTOM;
                card.addView(caption, capLp);
            }
            Show s = shows.get(position);
            caption.setText(s.title);
            art.setImageBitmap(null);
            art.setBackgroundColor(PANEL);
            ImageLoader.get(MainActivity.this).bind(art, s.coverUrl, itemWidth);
            card.setPadding(dp(3), dp(3), dp(3), dp(3));
            card.setBackground(cardBackground(false));
            card.setLayoutParams(new GridView.LayoutParams(itemWidth, itemHeight));
            card.setFocusable(true);
            card.setFocusableInTouchMode(true);
            final FrameLayout target = card;
            card.setOnFocusChangeListener(new View.OnFocusChangeListener() {
                public void onFocusChange(View v, boolean hasFocus) {
                    target.setBackground(cardBackground(hasFocus));
                    target.setPadding(dp(3), dp(3), dp(3), dp(3));
                }
            });
            final Show show = s;
            card.setOnClickListener(new View.OnClickListener() {
                public void onClick(View v) {
                    openDetails(show);
                }
            });
            return card;
        }
    }

    GradientDrawable cardBackground(boolean focused) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(PANEL);
        d.setCornerRadius(dp(8));
        d.setStroke(dp(3), focused ? CYAN : 0x00000000);
        return d;
    }

    static String safeMessage(Exception e) {
        String m = e.getMessage();
        if (m == null) return e.getClass().getSimpleName();
        int q = m.indexOf("token=");
        if (q >= 0) return m.substring(0, q) + "token=REDACTED";
        return m;
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
