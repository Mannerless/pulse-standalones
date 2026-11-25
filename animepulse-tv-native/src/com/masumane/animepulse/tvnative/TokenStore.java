package com.masumane.animepulse.tvnative;

import android.content.Context;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStreamReader;
import java.nio.charset.Charset;

/** Reads the share token from app-private storage. Never log the value. */
public final class TokenStore {
    private TokenStore() {}

    public static String read(Context ctx) {
        File f = new File(ctx.getFilesDir(), "share_token");
        if (!f.isFile()) return null;
        BufferedReader r = null;
        try {
            r = new BufferedReader(new InputStreamReader(new FileInputStream(f), Charset.forName("UTF-8")));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = r.readLine()) != null) {
                if (sb.length() > 0) sb.append('\n');
                sb.append(line);
            }
            String s = sb.toString().trim();
            return s.length() == 0 ? null : s;
        } catch (Exception e) {
            return null;
        } finally {
            try { if (r != null) r.close(); } catch (Exception ignored) {}
        }
    }
}
