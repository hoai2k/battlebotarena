// Background music player, shared by v1 (src/main.js) and v2 (v2/src/game/music.js).
//
// Uses HTMLAudioElement rather than WebAudio buffers: the tracks are multi-MB
// MP3s that stream progressively, so playback starts immediately instead of
// waiting on a full decode. Volume is faded manually on a timer, which keeps
// the module independent of any AudioContext (v1 and v2 each own their own).
//
// Two cues: "countdown" during the pre-fight countdown, "battle" once fighting
// starts. Tracks are picked at random within a cue, avoiding an immediate
// repeat, and battle tracks loop until the round ends.

const DEFAULT_TRACKS = {
  countdown: ["Steel Countdown.mp3", "Steel Countdown 2.mp3"],
  battle: ["Iron Circuit Rush.mp3", "Iron Circuit Rush 2.mp3", "Steel Arena.mp3", "Steel Arena 2.mp3"],
};

const FADE_INTERVAL_MS = 50;

/**
 * @param {object} options
 * @param {string} options.basePath  URL prefix for the music directory.
 * @param {number} [options.volume]  Peak volume for music (0..1).
 * @param {() => boolean} options.isEnabled  Gate checked before playing.
 */
export function createMusicPlayer({ basePath, volume = 0.55, isEnabled = () => true, tracks = DEFAULT_TRACKS } = {}) {
  let current = null; // { audio, cue, fadeTimer }
  let lastTrackByCue = {};
  let peakVolume = volume;

  function urlFor(cue) {
    const list = tracks[cue] || [];
    if (!list.length) return null;
    const candidates = list.length > 1 ? list.filter((name) => name !== lastTrackByCue[cue]) : list;
    const name = candidates[Math.floor(Math.random() * candidates.length)];
    lastTrackByCue[cue] = name;
    return basePath + encodeURIComponent(name);
  }

  function clearFade(entry) {
    if (entry?.fadeTimer) {
      clearInterval(entry.fadeTimer);
      entry.fadeTimer = null;
    }
  }

  function fade(entry, target, seconds, onDone) {
    if (!entry?.audio) return;
    clearFade(entry);
    const steps = Math.max(1, Math.round((seconds * 1000) / FADE_INTERVAL_MS));
    const start = entry.audio.volume;
    let step = 0;
    entry.fadeTimer = setInterval(() => {
      step += 1;
      const t = Math.min(1, step / steps);
      // Equal-power-ish curve so crossfades don't dip in the middle.
      entry.audio.volume = Math.max(0, Math.min(1, start + (target - start) * t));
      if (t >= 1) {
        clearFade(entry);
        onDone?.();
      }
    }, FADE_INTERVAL_MS);
  }

  function stopEntry(entry, fadeSeconds) {
    if (!entry?.audio) return;
    if (fadeSeconds > 0) {
      fade(entry, 0, fadeSeconds, () => {
        entry.audio.pause();
        entry.audio.src = "";
      });
    } else {
      clearFade(entry);
      entry.audio.pause();
      entry.audio.src = "";
    }
  }

  return {
    /**
     * Start (or switch to) a cue. Re-calling with the cue already playing is a
     * no-op, so this is safe to call from a per-frame state check.
     */
    play(cue, { loop = true, fadeIn = 0.6, fadeOut = 0.8 } = {}) {
      if (!isEnabled()) return;
      if (current?.cue === cue && current.audio && !current.audio.paused) return;
      const url = urlFor(cue);
      if (!url) return;
      const previous = current;
      const audio = new Audio(url);
      audio.loop = loop;
      audio.volume = fadeIn > 0 ? 0 : peakVolume;
      audio.preload = "auto";
      const entry = { audio, cue, fadeTimer: null };
      current = entry;
      // Autoplay can still reject if no gesture has happened yet; the next cue
      // change (or the sound toggle) retries, so a rejection is not fatal.
      audio.play().then(() => {
        if (current === entry && fadeIn > 0) fade(entry, peakVolume, fadeIn);
      }).catch(() => {});
      if (previous) stopEntry(previous, fadeOut);
    },

    stop({ fadeOut = 0.8 } = {}) {
      stopEntry(current, fadeOut);
      current = null;
    },

    /** Duck to a fraction of peak (e.g. under a KO callout) and back. */
    setDuck(amount = 1, seconds = 0.4) {
      if (current) fade(current, peakVolume * amount, seconds);
    },

    setVolume(value) {
      peakVolume = Math.max(0, Math.min(1, value));
      if (current?.audio) {
        clearFade(current);
        current.audio.volume = peakVolume;
      }
    },

    /** Called when the game's sound toggle flips. */
    setEnabled(enabled) {
      if (!enabled) this.stop({ fadeOut: 0.25 });
    },

    get currentCue() {
      return current?.cue || null;
    },
  };
}
