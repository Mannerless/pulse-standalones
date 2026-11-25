package com.masumane.animepulse.tvnative;

import android.app.Activity;
import android.graphics.Color;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.KeyEvent;
import android.graphics.SurfaceTexture;
import android.view.Surface;
import android.view.TextureView;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;

import java.util.HashMap;
import java.util.Map;

/**
 * Plays a cached episode from /api/download/stream using MediaPlayer.
 * Token is sent as a request header only and is never logged.
 */
public class PlayerActivity extends Activity implements TextureView.SurfaceTextureListener,
        MediaPlayer.OnPreparedListener, MediaPlayer.OnErrorListener,
        MediaPlayer.OnCompletionListener, MediaPlayer.OnInfoListener {
    static final String EXTRA_ID = "animeId";
    static final String EXTRA_EPISODE = "episode";
    static final String EXTRA_TITLE = "title";

    int animeId;
    int episode;
    String title;
    String token;
    TextureView texture;
    Surface surface;
    MediaPlayer player;
    TextView status;
    boolean surfaceReady;
    boolean prepared;
    boolean playWhenReady = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
        hideSystemUi();
        setVolumeControlStream(AudioManager.STREAM_MUSIC);

        animeId = getIntent().getIntExtra(EXTRA_ID, 0);
        episode = getIntent().getIntExtra(EXTRA_EPISODE, 1);
        title = getIntent().getStringExtra(EXTRA_TITLE);
        if (title == null) title = "Episode " + episode;
        token = TokenStore.read(this);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        texture = new TextureView(this);
        texture.setSurfaceTextureListener(this);
        root.addView(texture, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        status = new TextView(this);
        status.setTextColor(Color.WHITE);
        status.setTextSize(18);
        status.setPadding(dp(20), dp(16), dp(20), dp(16));
        status.setGravity(Gravity.CENTER);
        root.addView(status, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.CENTER));
        setContentView(root);

        if (token == null || token.length() == 0) {
            status.setText("Share token is not in app storage.");
            return;
        }
        if (animeId <= 0) {
            status.setText("Missing anime id.");
            return;
        }
        status.setText("Loading " + title + "  ·  episode " + episode);
        preparePlayer();
    }

    void preparePlayer() {
        releasePlayer();
        prepared = false;
        try {
            player = new MediaPlayer();
            player.setAudioStreamType(AudioManager.STREAM_MUSIC);
            player.setOnPreparedListener(this);
            player.setOnErrorListener(this);
            player.setOnCompletionListener(this);
            player.setOnInfoListener(this);
            player.setScreenOnWhilePlaying(true);
            Uri uri = Uri.parse(ApiClient.streamUrl(animeId, episode));
            Map<String, String> headers = new HashMap<String, String>();
            headers.put(ApiClient.HEADER_TOKEN, token);
            player.setDataSource(this, uri, headers);
            if (surfaceReady && surface != null) player.setSurface(surface);
            player.prepareAsync();
        } catch (Exception e) {
            status.setText("Could not start playback: " + MainActivity.safeMessage(e));
        }
    }

    public void onSurfaceTextureAvailable(SurfaceTexture st, int width, int height) {
        surfaceReady = true;
        surface = new Surface(st);
        if (player != null) {
            player.setSurface(surface);
            if (prepared && playWhenReady) {
                player.start();
                status.setVisibility(View.GONE);
            }
        }
    }

    public void onSurfaceTextureSizeChanged(SurfaceTexture st, int width, int height) {}

    public boolean onSurfaceTextureDestroyed(SurfaceTexture st) {
        surfaceReady = false;
        if (player != null) {
            try { player.setSurface(null); } catch (Exception ignored) {}
        }
        if (surface != null) {
            surface.release();
            surface = null;
        }
        return true;
    }

    public void onSurfaceTextureUpdated(SurfaceTexture st) {}

    public void onPrepared(MediaPlayer mp) {
        prepared = true;
        if (surfaceReady && surface != null) mp.setSurface(surface);
        if (playWhenReady) {
            mp.start();
            status.setVisibility(View.GONE);
        } else {
            status.setText("Paused");
        }
    }

    public boolean onError(MediaPlayer mp, int what, int extra) {
        status.setVisibility(View.VISIBLE);
        status.setText("Playback error (" + what + "/" + extra + "). Is the episode cached on the server?");
        return true;
    }

    public void onCompletion(MediaPlayer mp) {
        status.setVisibility(View.VISIBLE);
        status.setText("Finished  ·  press Back to return");
    }

    public boolean onInfo(MediaPlayer mp, int what, int extra) {
        if (what == MediaPlayer.MEDIA_INFO_BUFFERING_START) {
            status.setVisibility(View.VISIBLE);
            status.setText("Buffering…");
        } else if (what == MediaPlayer.MEDIA_INFO_BUFFERING_END) {
            status.setVisibility(View.GONE);
        }
        return false;
    }

    void togglePlay() {
        if (player == null || !prepared) return;
        if (player.isPlaying()) {
            player.pause();
            playWhenReady = false;
            status.setVisibility(View.VISIBLE);
            status.setText("Paused");
        } else {
            player.start();
            playWhenReady = true;
            status.setVisibility(View.GONE);
        }
    }

    void releasePlayer() {
        if (player != null) {
            try { player.reset(); } catch (Exception ignored) {}
            try { player.release(); } catch (Exception ignored) {}
            player = null;
        }
        prepared = false;
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_DPAD_CENTER || keyCode == KeyEvent.KEYCODE_ENTER
                || keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) {
            togglePlay();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PLAY) {
            if (player != null && prepared && !player.isPlaying()) togglePlay();
            return true;
        }
        if (keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE) {
            if (player != null && prepared && player.isPlaying()) togglePlay();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public void onBackPressed() {
        releasePlayer();
        super.onBackPressed();
    }

    @Override
    protected void onPause() {
        if (player != null && prepared && player.isPlaying()) {
            player.pause();
            playWhenReady = true;
        }
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        releasePlayer();
        super.onDestroy();
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
