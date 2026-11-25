package com.masumane.animepulse.tvnative;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.util.ArrayList;
import java.util.List;

/**
 * HttpURLConnection client for the Anime Pulse API.
 * Auth is the X-AnimePulse-Token header only. Never log the token or a tokened URL.
 */
public class ApiClient {
    public static final String BASE_URL = "http://100.118.77.78:7888";
    public static final String HEADER_TOKEN = "X-AnimePulse-Token";

    private final String token;

    public ApiClient(String token) {
        this.token = token;
    }

    public boolean hasToken() {
        return token != null && token.length() > 0;
    }

    public JSONObject getHealth() throws Exception {
        return getJson("/api/health");
    }

    public List<Show> getFeed(String mode, int page) throws Exception {
        String m = mode == null || mode.length() == 0 ? "trending" : mode;
        JSONObject json = getJson("/api/feed?mode=" + enc(m) + "&page=" + page);
        List<Show> out = new ArrayList<Show>();
        JSONArray media = json.optJSONArray("media");
        if (media == null) return out;
        for (int i = 0; i < media.length(); i++) {
            JSONObject item = media.optJSONObject(i);
            if (item != null) out.add(Show.fromFeedItem(item));
        }
        return out;
    }

    public JSONObject getDetails(int id, int ep) throws Exception {
        return getJson("/api/details?id=" + id + "&ep=" + Math.max(1, ep));
    }

    public JSONObject getLibrary() throws Exception {
        return getJson("/api/download/library");
    }

    public static String streamUrl(int animeId, int episode) {
        return BASE_URL + "/api/download/stream?animeId=" + animeId + "&episode=" + episode;
    }

    public String token() {
        return token;
    }

    JSONObject getJson(String path) throws Exception {
        HttpURLConnection conn = null;
        InputStream in = null;
        try {
            conn = open(BASE_URL + path);
            int code = conn.getResponseCode();
            in = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            String body = readAll(in);
            if (code < 200 || code >= 300) {
                throw new Exception("HTTP " + code + " for " + safePath(path));
            }
            return new JSONObject(body);
        } finally {
            try { if (in != null) in.close(); } catch (Exception ignored) {}
            if (conn != null) conn.disconnect();
        }
    }

    HttpURLConnection open(String url) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setConnectTimeout(12000);
        conn.setReadTimeout(20000);
        conn.setRequestMethod("GET");
        conn.setRequestProperty("Accept", "application/json");
        if (token != null && token.length() > 0) {
            conn.setRequestProperty(HEADER_TOKEN, token);
        }
        conn.setInstanceFollowRedirects(true);
        return conn;
    }

    static String readAll(InputStream in) throws Exception {
        if (in == null) return "";
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
        return new String(out.toByteArray(), Charset.forName("UTF-8"));
    }

    static String enc(String s) {
        try {
            return java.net.URLEncoder.encode(s, "UTF-8");
        } catch (Exception e) {
            return s;
        }
    }

    static String safePath(String path) {
        int q = path.indexOf('?');
        return q < 0 ? path : path.substring(0, q);
    }
}
