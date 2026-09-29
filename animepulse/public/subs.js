// AnimePulse subtitle controller.
// - Exactly ONE text track is ever active on the player (any other track is disabled).
// - Dub-aware default: an English dub with FULL dialogue captions starts with subtitles OFF, because those
//   captions are written from the sub script (different wording and timing than the spoken dub).
//   Signs/songs-only files and subbed episodes start ON.
// - Per-episode CC mode (auto / on / off) and timing offset are saved in localStorage.
(function () {
  'use strict';

  const FULL_DIALOGUE_MIN_CUES = 120; // a signs/songs file has ~10-60 cues, a full dialogue file 250+
  const OFFSET_STEP = 0.5;
  const OFFSET_LIMIT = 60;

  function readPref(key) {
    const base = { mode: 'auto', offset: 0 };
    try {
      const raw = JSON.parse(localStorage.getItem(key) || '{}');
      const mode = ['auto', 'on', 'off'].includes(raw.mode) ? raw.mode : 'auto';
      const offset = Number.isFinite(raw.offset) ? Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, raw.offset)) : 0;
      return { mode, offset };
    } catch (e) {
      return base;
    }
  }

  function writePref(key, pref) {
    try { localStorage.setItem(key, JSON.stringify(pref)); } catch (e) { /* storage unavailable: session-only */ }
  }

  // video: <video> element; subUrl: VTT url; storageKey: per-episode key; onChange(state): UI refresh hook.
  function attach(video, subUrl, storageKey, onChange) {
    const pref = readPref(storageKey);
    const original = new Map(); // cue -> [startTime, endTime] as delivered by the file
    const state = { mode: pref.mode, offset: pref.offset, showing: false, cues: null, isDub: null, loaded: false };

    const trackEl = document.createElement('track');
    trackEl.kind = 'subtitles';
    trackEl.srclang = 'en';
    trackEl.label = 'English';
    trackEl.default = false;
    const tt = trackEl.track;
    tt.mode = 'hidden'; // hidden still loads the cues, but shows nothing until we decide

    function disableOtherTracks() {
      for (const t of Array.from(video.textTracks)) {
        if (t !== tt && t.mode !== 'disabled') t.mode = 'disabled';
      }
    }

    function captureOriginals() {
      if (original.size || !tt.cues || !tt.cues.length) return;
      for (const c of Array.from(tt.cues)) original.set(c, [c.startTime, c.endTime]);
      state.cues = tt.cues.length;
      state.loaded = true;
    }

    function apply() {
      disableOtherTracks();
      captureOriginals();
      for (const [cue, [s, e]] of original) {
        cue.startTime = Math.max(0, s + pref.offset);
        cue.endTime = Math.max(0.05, e + pref.offset);
      }
      const fullDialogue = (state.cues || 0) > FULL_DIALOGUE_MIN_CUES;
      const wantOn = pref.mode === 'on' || (pref.mode === 'auto' && !(state.isDub === true && fullDialogue));
      tt.mode = wantOn ? 'showing' : 'hidden';
      state.mode = pref.mode;
      state.offset = pref.offset;
      state.showing = tt.mode === 'showing';
      if (typeof onChange === 'function') onChange({ ...state });
    }

    trackEl.addEventListener('load', apply);
    trackEl.addEventListener('error', () => { state.loaded = false; if (typeof onChange === 'function') onChange({ ...state }); });
    trackEl.src = subUrl;
    video.appendChild(trackEl);
    apply();

    return {
      state: () => ({ ...state }),
      // isDub arrives asynchronously from the download status; re-evaluate the default when it does.
      setDub(isDub) { state.isDub = !!isDub; apply(); },
      cycleMode() {
        pref.mode = pref.mode === 'auto' ? 'on' : pref.mode === 'on' ? 'off' : 'auto';
        writePref(storageKey, pref);
        apply();
      },
      nudge(deltaSeconds) {
        const next = Math.round((pref.offset + deltaSeconds) * 10) / 10;
        pref.offset = Math.max(-OFFSET_LIMIT, Math.min(OFFSET_LIMIT, next));
        writePref(storageKey, pref);
        apply();
      },
      resetOffset() {
        pref.offset = 0;
        writePref(storageKey, pref);
        apply();
      },
      step: OFFSET_STEP,
    };
  }

  window.APSubs = { attach, FULL_DIALOGUE_MIN_CUES };
})();
