// Background music player for v2 (driven by game/music.js). v1 keeps its own
// copy under v1/shared/ — the two are not the same file and this one is free to
// depend on v2's config.
//
// Uses HTMLAudioElement rather than WebAudio buffers: the tracks are multi-MB
// MP3s that stream progressively, so playback starts immediately instead of
// waiting on a full decode. Volume is faded manually on a timer, which keeps
// the module independent of any AudioContext (v1 and v2 each own their own).
//
// Three cues: "menu" under the title and bot-select screens, "countdown" during
// the pre-fight countdown, "battle" once fighting starts. Tracks are picked at
// random within a cue, avoiding an immediate repeat, and both the menu and
// battle cues loop.

import { CONFIG } from "../config.js";

const DEFAULT_TRACKS = {
  menu: ["Battle Bots Arena Anthem.mp3"],
  countdown: ["Steel Countdown.mp3", "Steel Countdown 2.mp3"],
  battle: ["Iron Circuit Rush.mp3", "Iron Circuit Rush 2.mp3", "Steel Arena.mp3", "Steel Arena 2.mp3"],
};

/** How far the music drops when the game pauses. Re-exported from config.js so
 *  the pause path (main.js) and the mix read one number. */
export const PAUSE_DUCK = CONFIG.music.pauseDuck;

// Per-cue level, as a fraction of the player's peak — see CONFIG.music.
const DEFAULT_CUE_VOLUME = CONFIG.music.cueVolume;

const FADE_INTERVAL_MS = 50;

/**
 * @param {object} options
 * @param {string} options.basePath  URL prefix for the music directory.
 * @param {number} [options.volume]  Peak volume for music (0..1).
 * @param {() => boolean} options.isEnabled  Gate checked before playing.
 */
export function createMusicPlayer({
  basePath,
  volume = CONFIG.music.masterVolume,
  isEnabled = () => true,
  tracks = DEFAULT_TRACKS,
  cueVolume = DEFAULT_CUE_VOLUME,
} = {}) {
  let current = null; // { audio, cue, fadeTimer }
  let lastTrackByCue = {};
  let peakVolume = volume;
  let duck = 1;

  /** The level THIS cue plays at: master, scaled by the cue's own share, and
   *  by whatever the game has ducked to. */
  function peakFor(cue) {
    return peakVolume * (cueVolume[cue] ?? 1) * duck;
  }

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
      audio.volume = fadeIn > 0 ? 0 : peakFor(cue);
      audio.preload = "auto";
      const entry = { audio, cue, fadeTimer: null };
      current = entry;
      // Autoplay can still reject if no gesture has happened yet; the next cue
      // change (or the sound toggle) retries, so a rejection is not fatal.
      audio.play().then(() => {
        if (current === entry && fadeIn > 0) fade(entry, peakFor(cue), fadeIn);
      }).catch(() => {});
      if (previous) stopEntry(previous, fadeOut);
    },

    stop({ fadeOut = 0.8 } = {}) {
      stopEntry(current, fadeOut);
      current = null;
    },

    /** Duck to a fraction of peak (e.g. under a KO callout) and back. */
    setDuck(amount = 1, seconds = 0.4) {
      duck = Math.max(0, Math.min(1, amount));
      if (current) fade(current, peakFor(current.cue), seconds);
    },

    setVolume(value) {
      peakVolume = Math.max(0, Math.min(1, value));
      if (current?.audio) {
        clearFade(current);
        current.audio.volume = peakFor(current.cue);
      }
    },

    /** Called when the game's sound toggle flips. */
    setEnabled(enabled) {
      if (!enabled) this.stop({ fadeOut: 0.25 });
    },

    get currentCue() {
      return current?.cue || null;
    },

    /** What the cue playing right now is actually at. Read-only, for tuning:
     *  the menu cue is meant to sit well under the fight and that is a number
     *  you want to be able to check rather than argue about. */
    get currentVolume() {
      return current?.audio ? current.audio.volume : 0;
    },
  };
}
