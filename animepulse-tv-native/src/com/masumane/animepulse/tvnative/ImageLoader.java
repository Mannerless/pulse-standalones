package com.masumane.animepulse.tvnative;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.os.Handler;
import android.os.Looper;
import android.util.LruCache;
import android.widget.ImageView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Simple cover loader with memory + disk cache. Never logs URLs that might carry a token. */
public class ImageLoader {
    private static ImageLoader instance;
    private final LruCache<String, Bitmap> memory;
    private final File diskDir;
    private final ExecutorService exec = Executors.newFixedThreadPool(3);
    private final Handler main = new Handler(Looper.getMainLooper());

    public static synchronized ImageLoader get(Context ctx) {
        if (instance == null) instance = new ImageLoader(ctx.getApplicationContext());
        return instance;
    }

    ImageLoader(Context ctx) {
        int kb = (int) (Runtime.getRuntime().maxMemory() / 1024 / 8);
        memory = new LruCache<String, Bitmap>(Math.max(2048, kb)) {
            @Override
            protected int sizeOf(String key, Bitmap value) {
                return value.getByteCount() / 1024;
            }
        };
        diskDir = new File(ctx.getCacheDir(), "covers");
        diskDir.mkdirs();
    }

    public void bind(final ImageView view, final String url, final int targetW) {
        view.setTag(url);
        if (url == null || url.length() == 0) {
            view.setImageBitmap(null);
            return;
        }
        Bitmap hit = memory.get(url);
        if (hit != null) {
            view.setImageBitmap(hit);
            return;
        }
        view.setImageBitmap(null);
        exec.execute(new Runnable() {
            public void run() {
                final Bitmap bmp = load(url, targetW);
                if (bmp == null) return;
                memory.put(url, bmp);
                main.post(new Runnable() {
                    public void run() {
                        Object tag = view.getTag();
                        if (url.equals(tag)) view.setImageBitmap(bmp);
                    }
                });
            }
        });
    }

    Bitmap load(String url, int targetW) {
        Bitmap bmp = loadOnce(url, targetW);
        if (bmp != null) return bmp;
        try { Thread.sleep(400); } catch (InterruptedException ignored) {}
        bmp = loadOnce(url, targetW);
        if (bmp != null) return bmp;
        try { Thread.sleep(800); } catch (InterruptedException ignored) {}
        return loadOnce(url, targetW);
    }

    Bitmap loadOnce(String url, int targetW) {
        File disk = new File(diskDir, hash(url) + ".jpg");
        Bitmap fromDisk = decodeFile(disk.getAbsolutePath(), targetW);
        if (fromDisk != null) return fromDisk;
        if (disk.isFile()) disk.delete();
        HttpURLConnection conn = null;
        InputStream in = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setConnectTimeout(10000);
            conn.setReadTimeout(15000);
            conn.setInstanceFollowRedirects(true);
            int code = conn.getResponseCode();
            if (code < 200 || code >= 300) return null;
            in = conn.getInputStream();
            File tmp = new File(disk.getAbsolutePath() + ".part");
            FileOutputStream out = new FileOutputStream(tmp);
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) >= 0) out.write(buf, 0, n);
            out.close();
            if (!tmp.renameTo(disk)) {
                disk.delete();
                tmp.renameTo(disk);
            }
            return decodeFile(disk.getAbsolutePath(), targetW);
        } catch (Exception e) {
            return null;
        } finally {
            try { if (in != null) in.close(); } catch (Exception ignored) {}
            if (conn != null) conn.disconnect();
        }
    }

    static Bitmap decodeFile(String path, int targetW) {
        File f = new File(path);
        if (!f.isFile() || f.length() == 0) return null;
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(path, bounds);
        int sample = 1;
        if (targetW > 0 && bounds.outWidth > targetW) {
            sample = Math.max(1, bounds.outWidth / targetW);
        }
        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = sample;
        opts.inPreferredConfig = Bitmap.Config.RGB_565;
        return BitmapFactory.decodeFile(path, opts);
    }

    static String hash(String url) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] d = md.digest(url.getBytes("UTF-8"));
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < 16; i++) sb.append(String.format("%02x", d[i]));
            return sb.toString();
        } catch (Exception e) {
            return String.valueOf(url.hashCode());
        }
    }
}
