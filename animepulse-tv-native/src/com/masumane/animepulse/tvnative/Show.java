package com.masumane.animepulse.tvnative;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

public class Show {
    public int id;
    public String title;
    public String description;
    public String coverUrl;
    public String bannerUrl;
    public int episodes;
    public int score;
    public String format;
    public String status;
    public List<String> genres = new ArrayList<String>();

    public static String pickTitle(JSONObject title) {
        if (title == null) return "Untitled";
        String e = title.optString("english", "");
        if (e.length() > 0 && !"null".equals(e)) return e;
        String r = title.optString("romaji", "");
        if (r.length() > 0 && !"null".equals(r)) return r;
        String n = title.optString("native", "");
        if (n.length() > 0 && !"null".equals(n)) return n;
        return "Untitled";
    }

    public static Show fromFeedItem(JSONObject item) {
        Show s = new Show();
        s.id = item.optInt("id");
        s.title = pickTitle(item.optJSONObject("title"));
        s.description = item.optString("description", "");
        JSONObject cover = item.optJSONObject("coverImage");
        if (cover != null) {
            s.coverUrl = firstUrl(cover, "extraLarge", "large", "medium");
        }
        s.bannerUrl = item.optString("bannerImage", "");
        if ("null".equals(s.bannerUrl)) s.bannerUrl = "";
        s.episodes = item.optInt("episodes");
        s.score = item.optInt("averageScore");
        s.format = item.optString("format", "");
        s.status = item.optString("status", "");
        JSONArray g = item.optJSONArray("genres");
        if (g != null) {
            for (int i = 0; i < g.length(); i++) s.genres.add(g.optString(i));
        }
        return s;
    }

    static String firstUrl(JSONObject o, String... keys) {
        for (int i = 0; i < keys.length; i++) {
            String v = o.optString(keys[i], "");
            if (v.length() > 0 && v.startsWith("http")) return v;
        }
        return "";
    }
}
