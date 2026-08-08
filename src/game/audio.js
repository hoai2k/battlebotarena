// BattleBot Arena v2 — procedural soundscape. Port of v1 src/gameAudio.js
// synthesis (metal impacts, spinner whir, drive motors, hazard grinds,
// pneumatic flippers, part-break tears) rewired onto the event bus:
//
//   EV.IMPACT         -> impact profile by surface (bot/wall/floor/ceiling/prop)
//   EV.WEAPON_HIT     -> heavy clang scaled by impulse
//   EV.WEAPON_SPIN    -> spinner loop target level (kept alive per frame)
//   EV.WEAPON_FIRED   -> flipper pneumatic hiss/thunk
//   EV.HAZARD_CONTACT -> kill saw / screw grind keep-alive
//   EV.PART_BREAK     -> metal tear + debris clatter
//   EV.MATCH          -> kill-saw ambient on 'killSaws' callout, off at end
//
// createGameAudio(bus, { specs }) -> { updateFrame(inputs, renderState),
// setListenerProvider(fn), dispose() }. updateFrame must be called by the
// integrator every frame: drive-motor loops read the frame's DriveInputs and
// render positions, and all continuous loops use the v1 keep-alive pattern
// (unrefreshed loops fade out within ~0.3s, so pause/match-end go quiet
// without teardown calls).
//
// Sound gate: settings.soundEnabled (default false, persisted by the settings
// store under bba2-soundEnabled). The AudioContext is created lazily on the
// first enable or user gesture, exactly like v1.

import { EV } from "../shared/events.js";
import { settings, onSettingChanged } from "../shared/settings.js";
import { CONFIG } from "../config.js";
import { attachSfxContext, preloadSfx, hasSample, takeSample, loadSfxManifest } from "./sfxBank.js";
import { freshCrowd, crowdVerdict } from "./crowdMood.js";

/** Master level for every sound this module makes. The soundEnabled toggle is
 *  a separate, harder gate: off is 0 whatever this says. */
const SFX_VOLUME = CONFIG.audio.sfxVolume;

/** Sampled bank on/off. The build default lives in config; the player's switch
 *  overrides it, and either way a sample that is missing or still downloading
 *  falls through to synthesis. */
let useSamples = CONFIG.audio.useSamples && settings.sampledSfx !== false;
onSettingChanged("sampledSfx", (value) => {
  useSamples = CONFIG.audio.useSamples && value !== false;
  if (useSamples) preloadSfx();
  // Loops are built from whichever source was live when they were created, so
  // the running ones have to go for the switch to be audible immediately.
  dropLoops();
});

let ctx = null;
let masterGain = null;
let noiseBuffer = null;
let enabled = Boolean(settings.soundEnabled);
let listenerProvider = null;
let unlockInstalled = false;
let activeVoices = 0;
let sweepTimer = null;

// Raised from 14 for the sampled bank: a 2.5-second heavy impact holds a voice
// far longer than the 0.3-second synth ping the old ceiling was measured
// against, and 14 was clipping the tail off exchanges that landed together.
const MAX_VOICES = 24;
const loops = new Map();
const lastPlayedByKey = new Map();

const hasWindow = typeof window !== "undefined";

onSettingChanged("soundEnabled", (value) => {
  enabled = Boolean(value);
  // Turning sound on is itself a user gesture, so this is a valid moment to
  // create the context the default-off path never built.
  if (enabled) ensureContext();
  if (ctx && masterGain) {
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setTargetAtTime(enabled ? SFX_VOLUME : 0, now, 0.03);
    if (enabled && ctx.state === "suspended") ctx.resume().catch(() => {});
  }
});

// Installs one-time gesture listeners so the context can start under autoplay rules.
function installUnlock() {
  if (unlockInstalled || !hasWindow) return;
  unlockInstalled = true;
  const unlock = () => {
    // Muted players never spin up audio hardware; the toggle builds the
    // context on demand instead.
    if (!enabled) return;
    ensureContext();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

function ensureContext() {
  if (ctx) {
    if (ctx.state === "suspended" && enabled) ctx.resume().catch(() => {});
    return ctx;
  }
  if (!hasWindow) return null;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;
  ctx = new AudioContextClass();
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 18;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.16;
  compressor.connect(ctx.destination);
  masterGain = ctx.createGain();
  masterGain.gain.value = enabled ? SFX_VOLUME : 0;
  masterGain.connect(compressor);
  noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  sweepTimer = setInterval(sweepStaleLoops, 1500);
  attachSfxContext(ctx);
  if (useSamples) preloadSfx();
  return ctx;
}

/** Tear every loop down so the next frame rebuilds it. Used when the sampled/
 *  synth choice changes underneath a loop that is already running. */
function dropLoops() {
  if (!ctx) return;
  loops.forEach((loop) => {
    try {
      loop.nodes.forEach((node) => node.stop?.());
      loop.gain.disconnect();
    } catch {
      // Already stopped; nothing further to clean.
    }
  });
  loops.clear();
}

function sweepStaleLoops() {
  if (!ctx) return;
  const now = ctx.currentTime;
  loops.forEach((loop, key) => {
    if (now - loop.lastUpdate > 3) {
      try {
        loop.nodes.forEach((node) => node.stop?.());
        loop.gain.disconnect();
      } catch {
        // Nodes may already be stopped; nothing to clean further.
      }
      loops.delete(key);
    }
  });
}

// Stereo pan + distance attenuation from a world position, using the game camera.
function spatialize(position) {
  const camera = listenerProvider?.();
  if (!camera || !position) return { pan: 0, gain: 1 };
  const e = camera.matrixWorldInverse?.elements;
  if (!e) return { pan: 0, gain: 1 };
  const { x, y, z } = position;
  const lx = e[0] * x + e[4] * y + e[8] * z + e[12];
  const lz = e[2] * x + e[6] * y + e[10] * z + e[14];
  const dist = Math.hypot(lx, lz);
  return {
    pan: Math.max(-0.8, Math.min(0.8, lx / (Math.abs(lz) + 6))),
    gain: Math.max(0.35, Math.min(1, 16 / (16 + dist * dist * 0.06))),
  };
}

function outputChain(position) {
  const spatial = spatialize(position);
  const gainNode = ctx.createGain();
  gainNode.gain.value = spatial.gain;
  if (ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = spatial.pan;
    gainNode.connect(panner);
    panner.connect(masterGain);
  } else {
    gainNode.connect(masterGain);
  }
  return gainNode;
}

function noiseSource() {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;
  source.loopStart = 0;
  source.loopEnd = noiseBuffer.duration;
  return source;
}

function trackVoice(node, stopAt) {
  activeVoices += 1;
  node.onended = () => {
    activeVoices = Math.max(0, activeVoices - 1);
  };
  node.stop(stopAt);
}

function throttled(key, minGap) {
  const now = ctx.currentTime;
  const last = lastPlayedByKey.get(key) || -Infinity;
  if (now - last < minGap) return true;
  lastPlayedByKey.set(key, now);
  return false;
}

// ---------------------------------------------------------------------------
// Sampled layer (public/sfx, see sfxBank.js)
//
// Every entry point here answers the same question the same way: is there a
// decoded sample for this, and is the bank switched on? If yes it plays and
// returns true, and the caller returns early; if no it returns false and the
// synthesis below runs exactly as it always did. No call site has to know
// which of the two it got.
//
// masterGain already carries mix.master * mix.sfx, so the crowd and announcer
// levels here are expressed RELATIVE to the SFX level rather than absolutely —
// that keeps one master fader in front of everything.
// ---------------------------------------------------------------------------

const CROWD_GAIN = CONFIG.mix.sfx > 0 ? CONFIG.mix.crowd / CONFIG.mix.sfx : 0;
const ANNOUNCER_GAIN = CONFIG.mix.sfx > 0 ? CONFIG.mix.announcer / CONFIG.mix.sfx : 0;

/**
 * Play one take of a sampled asset.
 * @returns {boolean} true if a sample actually started.
 */
function playSample(id, { gain = 1, position = null, rate = 1, jitter = true } = {}) {
  if (!useSamples || !ready() || activeVoices > MAX_VOICES) return false;
  const buffer = takeSample(id);
  if (!buffer) return false;
  const jitterAmount = jitter ? CONFIG.audio.samplePitchJitter : 0;
  // Same take twice in a row is the artefact variants exist to hide; a few
  // percent of pitch on top hides what is left of it.
  const pitch = 1 + (Math.random() * 2 - 1) * jitterAmount;
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = Math.max(0.25, rate * pitch);
  const env = ctx.createGain();
  env.gain.value = Math.max(0, gain);
  source.connect(env);
  env.connect(outputChain(position));
  source.start();
  trackVoice(source, ctx.currentTime + buffer.duration / source.playbackRate.value + 0.05);
  return true;
}

/**
 * Sampled equivalent of the synth loops. Keyed separately (`sample:`) from the
 * synth ones on purpose: if the bank is still downloading, the synth loop runs
 * first and simply stops being refreshed once the sample arrives, so it fades
 * out on its own through the same keep-alive path. No crossfade code needed.
 *
 * @param {number} [tail] seconds of hold before the fade, for loops refreshed
 *   by sparse contact events rather than every frame.
 * @returns {boolean}
 */
function sampledLoop(key, id, level, { rate = 1, tail = 0 } = {}) {
  if (!useSamples || !ready() || !hasSample(id)) return false;
  const existing = loops.get(`sample:${key}`);
  const buffer = existing ? null : takeSample(id);
  if (!existing && !buffer) return false;
  const loop = acquireLoop(`sample:${key}`, (l) => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(l.gain);
    l.params = { source };
    l.nodes.push(source);
  });
  const now = ctx.currentTime;
  loop.params.source.playbackRate.setTargetAtTime(Math.max(0.25, rate), now, 0.08);
  if (tail > 0) {
    loop.gain.gain.cancelScheduledValues(now);
    loop.gain.gain.setTargetAtTime(level, now, 0.05);
    loop.gain.gain.setTargetAtTime(0, now + tail, 0.12);
  } else {
    keepAlive(loop, level);
  }
  return true;
}

/** EV.IMPACT surface + intensity -> sampled asset id. The tiers exist because
 *  a tap and a full-speed slam differ in SPECTRUM, not just level. */
function impactSampleId(surface, intensity) {
  switch (surface) {
    case "wall":
    case "ceiling":
      return intensity < 0.5 ? "impact/wall_light" : "impact/wall_heavy";
    case "floor":
      return "impact/floor";
    case "prop":
      return "impact/prop";
    default:
      if (intensity < 0.35) return "impact/bot_light";
      return intensity < 0.7 ? "impact/bot_medium" : "impact/bot_heavy";
  }
}

/** Weapon type (from the catalog spec) -> the hit sample that reads as it. */
function weaponHitSampleId(weaponType, intensity, isFlame) {
  if (isFlame) return "weapon/flame_tick";
  if (weaponType === "hammer" || weaponType === "hammerSaw") return "weapon/hammer_hit";
  if (weaponType === "crusher") return "weapon/crusher_bite";
  if (weaponType === "sawArms") return "weapon/saw_bite";
  if (intensity < 0.35) return "weapon/spinner_hit_glance";
  return intensity < 0.75 ? "weapon/spinner_hit_solid" : "weapon/spinner_hit_massive";
}

/** EV.WEAPON_FIRED weaponType -> mechanism sample. */
const FIRE_SAMPLES = {
  flipper: "weapon/flipper_fire",
  crusher: "weapon/crusher_actuate",
  jaw: "weapon/jaw_grip",
  grappler: "weapon/grappler_fire",
  hammer: "weapon/hammer_swing",
  hammerSaw: "weapon/hammer_swing",
  lifter: "weapon/lifter_raise",
  lifterDisc: "weapon/lifter_raise",
};

// --- Crowd reactions -------------------------------------------------------
// The decision (react or not, and how loudly) lives in crowdMood.js, which has
// no Web Audio in it and can therefore be run in node — see tools/crowd-probe.
// This half only turns a verdict into a sound.

let crowdMood = freshCrowd();

function resetCrowdState() {
  crowdMood = freshCrowd();
}

/**
 * @param {string} id crowd asset
 * @param {number} magnitude 0..1, how extreme the thing that caused it was
 * @param {{force?: boolean}} [options] force = a bell-to-bell moment (fight
 *   start, KO, the chant), which lands regardless of what came before it.
 */
function crowdReact(id, magnitude = 1, { force = false } = {}) {
  if (!ready() || CROWD_GAIN <= 0) return;
  const verdict = crowdVerdict(crowdMood, magnitude, ctx.currentTime, CONFIG.audio.crowd, force);
  crowdMood = verdict.mood;
  if (!verdict.play) return;
  playSample(id, { gain: verdict.gain * magnitude * CROWD_GAIN * 1.6, jitter: false });
}

/**
 * Announcer callout. Off by default — see CONFIG.audio.announcerVoice and
 * public/sfx/vo/README.md for why the takes in the repo are not shippable.
 */
function announce(id) {
  if (!CONFIG.audio.announcerVoice || !id.startsWith("vo/")) return;
  playSample(id, { gain: ANNOUNCER_GAIN, jitter: false });
}

/** Crowd bed under the whole fight, keep-alive like every other loop. */
function crowdLoop(active) {
  if (CROWD_GAIN <= 0) return;
  sampledLoop("crowd", "loop/crowd_ambient", active ? CROWD_GAIN * 0.5 : 0);
}

/** Spinner loop sample per weapon type. */
const SPIN_LOOP_SAMPLES = {
  bar: "loop/spinner_bar",
  drum: "loop/spinner_drum",
  shellSpinner: "loop/spinner_shell",
  hammerSaw: "loop/spinner_hammersaw",
};

// ---------------------------------------------------------------------------
// One-shot impact synthesis (verbatim v1 profiles)
// ---------------------------------------------------------------------------

const IMPACT_PROFILES = {
  clang: {
    thumpFreq: 110, thumpGain: 0.5, modes: [420, 818, 1366, 2230, 3620],
    ringGain: 0.34, ringDecay: 0.34, crackGain: 0.4, crackFreq: 3200, minGap: 0.055,
  },
  heavyClang: {
    thumpFreq: 82, thumpGain: 0.8, modes: [318, 636, 1122, 1990, 3260],
    ringGain: 0.44, ringDecay: 0.5, crackGain: 0.5, crackFreq: 2600, minGap: 0.07,
  },
  wall: {
    thumpFreq: 64, thumpGain: 0.95, modes: [150, 292, 512, 884],
    ringGain: 0.3, ringDecay: 0.42, crackGain: 0.26, crackFreq: 1900, minGap: 0.09,
  },
  floor: {
    thumpFreq: 76, thumpGain: 0.62, modes: [170, 335, 566],
    ringGain: 0.16, ringDecay: 0.2, crackGain: 0.2, crackFreq: 1400, minGap: 0.09,
  },
  clank: {
    thumpFreq: 150, thumpGain: 0.25, modes: [740, 1240, 2080],
    ringGain: 0.22, ringDecay: 0.14, crackGain: 0.3, crackFreq: 4200, minGap: 0.06,
  },
};

// EV.IMPACT surface -> profile + relSpeed divisor (intensity = sqrt(amount/scale)).
const SURFACE_SOUNDS = {
  bot: { profile: "clang", scale: 8 },
  wall: { profile: "wall", scale: 8 },
  ceiling: { profile: "wall", scale: 12 },
  floor: { profile: "floor", scale: 14 },
  prop: { profile: "clank", scale: 12 },
};

function ready() {
  return enabled && ctx && ctx.state === "running";
}

/**
 * @param {string} profileName synth profile, used when no sample is available
 * @param {string} [sampleId] sampled asset to prefer. The throttle runs FIRST
 *   and is shared between the two paths — otherwise a contact-heavy frame
 *   fires forty overlapping clangs the moment the bank loads.
 */
function playImpactProfile(profileName, intensity, position, sampleId = null) {
  const profile = IMPACT_PROFILES[profileName];
  if (!profile || activeVoices > MAX_VOICES) return;
  if (throttled(`impact:${sampleId || profileName}`, profile.minGap)) return;
  if (sampleId && playSample(sampleId, {
    gain: 0.45 + intensity * 0.75,
    position,
    // Harder hits play very slightly faster, which reads as more energy
    // without needing a fourth tier of samples.
    rate: 0.96 + intensity * 0.1,
  })) return;
  const now = ctx.currentTime;
  const out = outputChain(position);

  const thump = ctx.createOscillator();
  thump.type = "sine";
  const thumpFreq = profile.thumpFreq * (0.92 + Math.random() * 0.16);
  thump.frequency.setValueAtTime(thumpFreq * 1.6, now);
  thump.frequency.exponentialRampToValueAtTime(thumpFreq * 0.6, now + 0.09);
  const thumpEnv = ctx.createGain();
  thumpEnv.gain.setValueAtTime(profile.thumpGain * intensity, now);
  thumpEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.1 + intensity * 0.12);
  thump.connect(thumpEnv);
  thumpEnv.connect(out);
  thump.start(now);
  trackVoice(thump, now + 0.3);

  const ringDecay = profile.ringDecay * (0.45 + intensity * 0.75);
  profile.modes.forEach((freq, index) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq * (0.97 + Math.random() * 0.06);
    const env = ctx.createGain();
    const level = (profile.ringGain * intensity) / (1 + index * 0.7);
    env.gain.setValueAtTime(level, now);
    env.gain.exponentialRampToValueAtTime(0.001, now + ringDecay * (1 - index * 0.12));
    osc.connect(env);
    env.connect(out);
    osc.start(now);
    trackVoice(osc, now + ringDecay + 0.05);
  });

  const crack = noiseSource();
  const crackFilter = ctx.createBiquadFilter();
  crackFilter.type = "highpass";
  crackFilter.frequency.value = profile.crackFreq;
  const crackEnv = ctx.createGain();
  crackEnv.gain.setValueAtTime(profile.crackGain * intensity, now);
  crackEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
  crack.connect(crackFilter);
  crackFilter.connect(crackEnv);
  crackEnv.connect(out);
  crack.start(now, Math.random());
  trackVoice(crack, now + 0.06);
}

// Metal tearing + debris clatter when a part-disable threshold is crossed.
function breakSound(position, magnitude = 1, zone = "weapon") {
  if (!ready()) return;
  if (throttled("break", 0.12)) return;
  const strength = Math.min(1, 0.45 + magnitude * 0.08);

  const breakId = zone === "drive" ? "damage/part_break_drive" : "damage/part_break_weapon";
  if (playSample(breakId, { gain: 0.85 * strength, position })) {
    // The clatter is a separate asset rather than part of the break take, so
    // the debris can trail the tear by a different amount every time.
    setTimeout(() => {
      playSample("damage/debris_clatter", { gain: 0.55 * strength, position });
    }, 120 + Math.random() * 220);
    return;
  }

  const now = ctx.currentTime;
  const out = outputChain(position);

  const tear = noiseSource();
  const tearFilter = ctx.createBiquadFilter();
  tearFilter.type = "bandpass";
  tearFilter.Q.value = 1.4;
  tearFilter.frequency.setValueAtTime(2800, now);
  tearFilter.frequency.exponentialRampToValueAtTime(620, now + 0.24);
  const tearEnv = ctx.createGain();
  tearEnv.gain.setValueAtTime(0.55 * strength, now);
  tearEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
  tear.connect(tearFilter);
  tearFilter.connect(tearEnv);
  tearEnv.connect(out);
  tear.start(now, Math.random());
  trackVoice(tear, now + 0.3);

  playImpactProfile("heavyClang", strength, position);
  const clatterCount = 2 + Math.round(strength * 2);
  for (let i = 0; i < clatterCount; i += 1) {
    const delay = 0.09 + Math.random() * 0.3;
    setTimeout(() => {
      if (ready()) playImpactProfile("clank", strength * (0.25 + Math.random() * 0.3), position);
    }, delay * 1000);
  }
}

// Pneumatic flipper fire: CO2 hiss sweep + launch thunk + latch click.
// The sampled bank covers every mechanism in the roster; the synthesis below
// it only ever knew how to be a flipper.
function weaponFire(type) {
  if (!ready()) return;
  const sampleId = FIRE_SAMPLES[type];
  if (sampleId && !throttled(`fire:${type}`, 0.15)
    && playSample(sampleId, { gain: 0.8 })) {
    if (type === "flipper") {
      setTimeout(() => playSample("weapon/flipper_reset", { gain: 0.5 }), 420);
    }
    return;
  }
  if (type !== "flipper") return;
  if (throttled("flipperFire", 0.15)) return;
  const now = ctx.currentTime;
  const out = outputChain(null);

  const hiss = noiseSource();
  const hissFilter = ctx.createBiquadFilter();
  hissFilter.type = "bandpass";
  hissFilter.Q.value = 1.8;
  hissFilter.frequency.setValueAtTime(1500, now);
  hissFilter.frequency.exponentialRampToValueAtTime(420, now + 0.3);
  const hissEnv = ctx.createGain();
  hissEnv.gain.setValueAtTime(0.42, now);
  hissEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
  hiss.connect(hissFilter);
  hissFilter.connect(hissEnv);
  hissEnv.connect(out);
  hiss.start(now, Math.random());
  trackVoice(hiss, now + 0.35);

  const thunk = ctx.createOscillator();
  thunk.type = "triangle";
  thunk.frequency.setValueAtTime(140, now);
  thunk.frequency.exponentialRampToValueAtTime(52, now + 0.08);
  const thunkEnv = ctx.createGain();
  thunkEnv.gain.setValueAtTime(0.65, now);
  thunkEnv.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
  thunk.connect(thunkEnv);
  thunkEnv.connect(out);
  thunk.start(now);
  trackVoice(thunk, now + 0.18);

  setTimeout(() => {
    if (ready()) playImpactProfile("clank", 0.45, null);
  }, 220);
}

// ---------------------------------------------------------------------------
// Continuous loops (keep-alive: refresh every frame or they fade out)
// ---------------------------------------------------------------------------

function acquireLoop(key, builder) {
  let loop = loops.get(key);
  if (!loop) {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(masterGain);
    loop = { gain, nodes: [], params: {}, lastUpdate: 0 };
    builder(loop);
    loop.nodes.forEach((node) => node.start?.());
    loops.set(key, loop);
  }
  loop.lastUpdate = ctx.currentTime;
  return loop;
}

function keepAlive(loop, level) {
  const now = ctx.currentTime;
  loop.gain.gain.cancelScheduledValues(now);
  loop.gain.gain.setTargetAtTime(level, now, 0.07);
  // Fallback fade: if the game loop stops refreshing (pause, round end,
  // mode switch), the loop dies on its own shortly afterwards.
  loop.gain.gain.setTargetAtTime(0, now + 0.3, 0.09);
}

// Spinner weapon whir: motor whine + air whoosh + blade-pass wub.
function weaponLoop(key, { type, ratio = 0, position = null } = {}) {
  if (!ready()) return;
  if (type === "crusher") {
    crusherLoop(key, ratio);
    return;
  }
  if (type !== "bar" && type !== "drum" && type !== "hammerSaw") return;
  const sampleLevel = ratio <= 0.01 ? 0 : (0.06 + ratio * 0.3) * spatialize(position).gain;
  // Samples were rendered at full RPM: playback rate IS the spin-up. Floored
  // well above zero so a coasting rotor still sounds like a rotor rather than
  // a tape being stopped by hand.
  if (sampledLoop(`spin:${key}`, SPIN_LOOP_SAMPLES[type], sampleLevel,
    { rate: 0.55 + ratio * 0.55 })) return;
  const loop = acquireLoop(`spin:${key}`, (l) => {
    const whine = ctx.createOscillator();
    whine.type = "sawtooth";
    const whineFilter = ctx.createBiquadFilter();
    whineFilter.type = "lowpass";
    whineFilter.frequency.value = 900;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.16;
    whine.connect(whineFilter);
    whineFilter.connect(whineGain);
    whineGain.connect(l.gain);

    const whoosh = noiseSource();
    const whooshFilter = ctx.createBiquadFilter();
    whooshFilter.type = "bandpass";
    whooshFilter.Q.value = 0.7;
    const whooshGain = ctx.createGain();
    whooshGain.gain.value = 0;
    whoosh.connect(whooshFilter);
    whooshFilter.connect(whooshGain);
    whooshGain.connect(l.gain);

    const wub = ctx.createOscillator();
    wub.type = "sine";
    const wubDepth = ctx.createGain();
    wubDepth.gain.value = 0;
    wub.connect(wubDepth);
    wubDepth.connect(whooshGain.gain);

    l.params = { whine, whineFilter, whoosh: whooshFilter, whooshGain, wub, wubDepth };
    l.nodes.push(whine, whoosh, wub);
  });
  const now = ctx.currentTime;
  const curve = ratio * ratio;
  const isDrum = type === "drum";
  const { whine, whineFilter, whoosh, whooshGain, wub, wubDepth } = loop.params;
  whine.frequency.setTargetAtTime((isDrum ? 55 : 34) + curve * (isDrum ? 210 : 130), now, 0.08);
  whineFilter.frequency.setTargetAtTime(400 + curve * 1600, now, 0.08);
  whoosh.frequency.setTargetAtTime(260 + curve * (isDrum ? 2400 : 1700), now, 0.08);
  whooshGain.gain.setTargetAtTime(0.07 + curve * 0.22, now, 0.1);
  wub.frequency.setTargetAtTime(2 + ratio * (isDrum ? 22 : 13), now, 0.08);
  wubDepth.gain.setTargetAtTime(ratio > 0.05 ? 0.1 : 0, now, 0.1);
  const spatial = spatialize(position);
  keepAlive(loop, ratio <= 0.01 ? 0 : (0.06 + ratio * 0.3) * spatial.gain);
}

// Hydraulic crusher: slow pump groan while the jaw is driven.
function crusherLoop(key, active) {
  if (sampledLoop(`crusher:${key}`, "loop/crusher_pump", active > 0 ? 0.3 : 0)) return;
  const loop = acquireLoop(`crusher:${key}`, (l) => {
    const pump = ctx.createOscillator();
    pump.type = "sawtooth";
    pump.frequency.value = 46;
    const pumpFilter = ctx.createBiquadFilter();
    pumpFilter.type = "lowpass";
    pumpFilter.frequency.value = 320;
    const strain = noiseSource();
    const strainFilter = ctx.createBiquadFilter();
    strainFilter.type = "bandpass";
    strainFilter.frequency.value = 480;
    strainFilter.Q.value = 2.2;
    const strainGain = ctx.createGain();
    strainGain.gain.value = 0.35;
    pump.connect(pumpFilter);
    pumpFilter.connect(l.gain);
    strain.connect(strainFilter);
    strainFilter.connect(strainGain);
    strainGain.connect(l.gain);
    l.nodes.push(pump, strain);
  });
  keepAlive(loop, active > 0 ? 0.3 : 0);
}

// Drive motors: detuned low buzz scaled by input + wheel rumble scaled by speed.
function driveLoop(key, { level = 0, speed = 0, position = null } = {}) {
  if (!ready()) return;
  const speedShare = Math.min(1, speed / 14);
  const spatialGain = spatialize(position).gain;
  // Motor and wheel rumble are two samples, not one, because throttle and
  // ground speed come apart constantly: a bot pushing against a wall is all
  // motor and no rumble, and a bot coasting after a hit is the reverse.
  const motorSampled = sampledLoop(`drive:${key}`, "loop/drive_motor",
    level <= 0.02 ? 0 : (0.05 + level * 0.2) * spatialGain,
    { rate: 0.8 + level * 0.45 });
  if (motorSampled) {
    sampledLoop(`rumble:${key}`, "loop/drive_rumble",
      speedShare <= 0.03 ? 0 : speedShare * 0.22 * spatialGain,
      { rate: 0.85 + speedShare * 0.4 });
    return;
  }
  const loop = acquireLoop(`drive:${key}`, (l) => {
    const motorA = ctx.createOscillator();
    motorA.type = "sawtooth";
    const motorB = ctx.createOscillator();
    motorB.type = "sawtooth";
    const motorFilter = ctx.createBiquadFilter();
    motorFilter.type = "lowpass";
    motorFilter.frequency.value = 480;
    const motorGain = ctx.createGain();
    motorGain.gain.value = 0.13;
    motorA.connect(motorFilter);
    motorB.connect(motorFilter);
    motorFilter.connect(motorGain);
    motorGain.connect(l.gain);

    const rumble = noiseSource();
    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = "lowpass";
    rumbleFilter.frequency.value = 230;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;
    rumble.connect(rumbleFilter);
    rumbleFilter.connect(rumbleGain);
    rumbleGain.connect(l.gain);

    l.params = { motorA, motorB, rumbleGain };
    l.nodes.push(motorA, motorB, rumble);
  });
  const now = ctx.currentTime;
  const speedRatio = Math.min(1, speed / 14);
  const { motorA, motorB, rumbleGain } = loop.params;
  const baseFreq = 52 + level * 46 + speedRatio * 38;
  motorA.frequency.setTargetAtTime(baseFreq, now, 0.09);
  motorB.frequency.setTargetAtTime(baseFreq * 1.024, now, 0.09);
  rumbleGain.gain.setTargetAtTime(speedRatio * 0.24, now, 0.12);
  const spatial = spatialize(position);
  keepAlive(loop, Math.max(level, speedRatio * 0.7) <= 0.02 ? 0 : (0.05 + Math.max(level, speedRatio) * 0.2) * spatial.gain);
}

// Kill saw ambience: idle blade whine whenever the saws are live.
function killSawAmbient(active) {
  if (!ready()) return;
  if (sampledLoop("killSawAmbient", "loop/killsaw_ambient", active ? 0.05 : 0)) return;
  const loop = acquireLoop("killSawAmbient", (l) => {
    const bladeA = ctx.createOscillator();
    bladeA.type = "sawtooth";
    bladeA.frequency.value = 96;
    const bladeB = ctx.createOscillator();
    bladeB.type = "sawtooth";
    bladeB.frequency.value = 97.7;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 1250;
    filter.Q.value = 0.8;
    bladeA.connect(filter);
    bladeB.connect(filter);
    filter.connect(l.gain);
    l.nodes.push(bladeA, bladeB);
  });
  keepAlive(loop, active ? 0.05 : 0);
}

// Hazard contact grind: filtered roar + spark sizzle, keyed by hazard kind.
// Refreshes arrive per contact event; the fade window rides through gaps.
const GRIND_SETTINGS = {
  killSaw: { center: 2400, q: 1.2, rumble: 88, level: 0.42, sizzle: 0.3 },
  screw: { center: 640, q: 1, rumble: 52, level: 0.34, sizzle: 0.14 },
};

const GRIND_SAMPLES = { killSaw: "loop/killsaw_grind", screw: "loop/screw_grind" };

function hazardGrind(kind, position = null, intensity = 1) {
  if (!ready()) return;
  const settingsFor = GRIND_SETTINGS[kind];
  if (!settingsFor) return;
  const level = settingsFor.level * Math.min(1, Math.max(0.35, intensity)) * spatialize(position).gain;
  // 0.42s tail rather than the default keep-alive fade: contact events arrive
  // sparsely, and a grind that drops out between them sounds like a fault.
  if (sampledLoop(`grind:${kind}`, GRIND_SAMPLES[kind], level, { tail: 0.42 })) {
    if (kind === "killSaw" && intensity > 0.6 && !throttled("sparks", 0.35)) {
      playSample("damage/sparks", { gain: 0.4 * intensity, position });
    }
    return;
  }
  const loop = acquireLoop(`grind:${kind}`, (l) => {
    const roar = noiseSource();
    const roarFilter = ctx.createBiquadFilter();
    roarFilter.type = "bandpass";
    roarFilter.frequency.value = settingsFor.center;
    roarFilter.Q.value = settingsFor.q;
    roar.connect(roarFilter);
    roarFilter.connect(l.gain);

    const sizzle = noiseSource();
    const sizzleFilter = ctx.createBiquadFilter();
    sizzleFilter.type = "highpass";
    sizzleFilter.frequency.value = 5200;
    const sizzleGain = ctx.createGain();
    sizzleGain.gain.value = settingsFor.sizzle;
    const flutter = ctx.createOscillator();
    flutter.type = "square";
    flutter.frequency.value = 23;
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.value = settingsFor.sizzle * 0.6;
    flutter.connect(flutterDepth);
    flutterDepth.connect(sizzleGain.gain);
    sizzle.connect(sizzleFilter);
    sizzleFilter.connect(sizzleGain);
    sizzleGain.connect(l.gain);

    const rumble = ctx.createOscillator();
    rumble.type = "triangle";
    rumble.frequency.value = settingsFor.rumble;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.3;
    rumble.connect(rumbleGain);
    rumbleGain.connect(l.gain);

    l.params = { roarFilter };
    l.nodes.push(roar, sizzle, flutter, rumble);
  });
  const now = ctx.currentTime;
  loop.params.roarFilter.frequency.setTargetAtTime(
    settingsFor.center * (0.9 + Math.random() * 0.25), now, 0.05,
  );
  const spatial = spatialize(position);
  // Longer tail than keepAlive's default: contact events arrive sparsely.
  loop.gain.gain.cancelScheduledValues(now);
  loop.gain.gain.setTargetAtTime(settingsFor.level * Math.min(1, Math.max(0.35, intensity)) * spatial.gain, now, 0.05);
  loop.gain.gain.setTargetAtTime(0, now + 0.42, 0.12);
}

// ---------------------------------------------------------------------------
// Public API: bus wiring + per-frame keep-alive
// ---------------------------------------------------------------------------

const UI_GAIN = CONFIG.mix.sfx > 0 ? CONFIG.mix.ui / CONFIG.mix.sfx : 0;

/**
 * App-level audio start-up: install the gesture unlock and begin fetching the
 * sample manifest before any match exists. Without this the menus are silent
 * until the first fight builds a context, which is the wrong way round — the
 * menus are where the first click happens.
 */
export function initAppAudio() {
  installUnlock();
  loadSfxManifest();
  if (enabled) ensureContext();
}

/**
 * Play a UI sound by asset id ("ui/confirm"). Sampled only: there is no synth
 * fallback for the menus, because there was never any menu audio to fall back
 * to — with the bank switched off, the UI is as silent as it always was.
 */
export function playUiSound(id, gain = 1) {
  if (!ctx) ensureContext();
  if (UI_GAIN <= 0) return;
  playSample(id, { gain: gain * UI_GAIN, jitter: false });
}

/**
 * @param {{on: Function}} bus event bus (needs .on)
 * @param {{specs?: import('../assets/catalog.js').BotSpec[]}} [options]
 *   specs (by bot index) let the crusher pump react to weapon-hold input.
 */
export function createGameAudio(bus, { specs = [] } = {}) {
  installUnlock();
  if (enabled) ensureContext();

  const unsubscribes = [];
  // Latest spin ratio per bot (EV.WEAPON_SPIN only fires on change; loops
  // still need per-frame keep-alive, so updateFrame replays these).
  const spinState = new Map();
  // A rematch starts with a fresh crowd: whatever impressed them last round is
  // not a bar this one has to clear.
  resetCrowdState();
  let sawsActive = false;
  let crowdActive = false;
  let lastPhase = null;
  let lastCount = null;
  let lastFrameAt = null;
  const lastPositions = [null, null];

  unsubscribes.push(bus.on(EV.IMPACT, ({ surface, point, relSpeed }) => {
    if (!ready()) return;
    const mapping = SURFACE_SOUNDS[surface] || SURFACE_SOUNDS.bot;
    const intensity = Math.min(1, Math.sqrt(Math.max(0, relSpeed || 0) / mapping.scale));
    if (intensity < 0.12) return;
    playImpactProfile(mapping.profile, intensity, point, impactSampleId(surface, intensity));
  }));

  unsubscribes.push(bus.on(EV.WEAPON_HIT, (payload) => {
    if (!ready()) return;
    const { point, impulse, heavy, attackerIndex, appliedImpulse } = payload || {};
    const intensity = Math.min(1, Math.sqrt(Math.max(0, impulse || 0) / 120)) * (heavy ? 1.1 : 1);
    if (intensity < 0.1) return;
    // WEAPON_HIT carries no weapon type — the attacker's catalog spec does, and
    // audio already holds the specs for the crusher pump. A hit that applied no
    // impulse at all from a machine with a flamethrower is the flame ticking:
    // fire is the one weapon in the game that damages without pushing.
    const weapon = specs[attackerIndex]?.weapon;
    const isFlame = Boolean(weapon?.flame) && !(appliedImpulse > 0);
    const sampleId = weaponHitSampleId(weapon?.type, intensity, isFlame);
    playImpactProfile("heavyClang", Math.min(1, intensity), point, sampleId);
    if (intensity > 0.8) crowdReact("crowd/cheer_big", Math.min(1, intensity));
  }));

  unsubscribes.push(bus.on(EV.WEAPON_SPIN, ({ botIndex, weaponType, ratio }) => {
    spinState.set(botIndex, { type: weaponType, ratio: Math.max(0, Math.min(1, ratio || 0)) });
  }));

  unsubscribes.push(bus.on(EV.WEAPON_FIRED, ({ weaponType }) => {
    weaponFire(weaponType);
  }));

  unsubscribes.push(bus.on(EV.HAZARD_CONTACT, ({ kind, point, intensity }) => {
    hazardGrind(kind, point, intensity);
  }));

  unsubscribes.push(bus.on(EV.HAZARD_LAUNCH, ({ point, impulse }) => {
    if (!ready()) return;
    const intensity = Math.min(1, Math.sqrt(Math.max(0, impulse || 0) / 220));
    playImpactProfile("heavyClang", intensity, point, "hazard/killsaw_launch");
    // A bot going airborne off the saws is the crowd's moment, not the KO.
    if (intensity > 0.5) crowdReact("crowd/gasp", Math.min(1, intensity));
  }));

  unsubscribes.push(bus.on(EV.PART_BREAK, ({ point, zone }) => {
    breakSound(point || null, 6, zone);
    // A part coming off is the top of the scale — nothing in a fight beats it,
    // so it is what the bar gets set to.
    crowdReact("crowd/cheer_big", 1);
  }));

  unsubscribes.push(bus.on(EV.MATCH, (payload) => {
    if (payload?.callout === "killSaws") {
      if (!sawsActive) {
        playSample("hazard/killsaw_deploy", { gain: 0.7 });
        announce("vo/killsaws");
      }
      sawsActive = true;
    }
    const phase = payload?.phase;
    if (phase === "ko" || phase === "timeUp" || phase === "results" || phase === "countdown") {
      sawsActive = false;
    }
    crowdActive = phase === "countdown" || phase === "fight";

    if (phase === "countdown" && typeof payload.count === "number" && payload.count !== lastCount) {
      lastCount = payload.count;
      playSample("match/countdown_beep", { gain: 0.5, jitter: false });
      announce(`vo/${["", "one", "two", "three"][payload.count] || ""}`);
    }
    if (phase !== "countdown") lastCount = null;
    if (phase !== lastPhase) {
      if (phase === "fight") {
        playSample("match/countdown_beep_final", { gain: 0.6, jitter: false });
        announce("vo/fight");
        crowdReact("crowd/cheer_big", 1, { force: true });
      }
      if (phase === "ko") {
        announce("vo/ko");
        crowdReact("crowd/cheer_big", 1, { force: true });
      }
      // The chant runs over the 3-2-1, under the countdown cue, and is the one
      // crowd sound that is not a reaction to anything in the arena.
      if (phase === "countdown") crowdReact("crowd/chant_fight", 1, { force: true });
      if (phase === "timeUp") announce("vo/time");
      if (phase === "results") playSample("match/results_sting", { gain: 0.7, jitter: false });
      lastPhase = phase;
    }
  }));

  /**
   * Call once per rendered frame. inputs: [DriveInput, DriveInput];
   * renderState: sim.getRenderState() array (positions in feet).
   */
  function updateFrame(inputs = [], renderState = []) {
    if (!ready()) return;
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    const dt = lastFrameAt === null ? 1 / 60 : Math.max(1 / 240, Math.min(0.1, now - lastFrameAt));
    lastFrameAt = now;

    for (let i = 0; i < Math.max(inputs.length, renderState.length); i += 1) {
      const input = inputs[i] || null;
      const position = renderState[i]?.position || null;
      // Drive motors: level from input, rumble from measured ground speed.
      let speed = 0;
      if (position && lastPositions[i]) {
        speed = Math.hypot(position.x - lastPositions[i].x, position.z - lastPositions[i].z) / dt;
      }
      if (position) lastPositions[i] = { x: position.x, z: position.z };
      const level = input ? Math.max(Math.abs(input.leftDrive || 0), Math.abs(input.rightDrive || 0)) : 0;
      driveLoop(i, { level, speed, position });

      // Spinner keep-alive from the last EV.WEAPON_SPIN ratio. HammerSaw is
      // excluded: its whine is driven by the RB saw toggle below, not stroke.
      const spin = spinState.get(i);
      if (spin && specs[i]?.weapon?.type !== "hammerSaw") {
        weaponLoop(i, { type: spin.type, ratio: spin.ratio, position });
      }

      // Crusher pump follows the held weapon input directly.
      if (specs[i]?.weapon?.type === "crusher") {
        weaponLoop(i, { type: "crusher", ratio: input?.weapon ? 1 : 0, position });
      }
      // Sawblaze saw motor (RB toggle): steady saw whine while active.
      if (specs[i]?.weapon?.type === "hammerSaw") {
        weaponLoop(i, { type: "bar", ratio: input?.sawActive ? 0.85 : 0, position });
      }
      // Flame rides the secondary channel on whatever arm the bot has, so the
      // jet loop follows that latch rather than a weapon type.
      if (specs[i]?.weapon?.flame) {
        const burning = Boolean(input?.auxActive || input?.sawActive);
        sampledLoop(`flame:${i}`, "loop/flame_jet",
          burning ? 0.32 * spatialize(position).gain : 0);
      }
    }
    killSawAmbient(sawsActive);
    crowdLoop(crowdActive);
  }

  function setListenerProviderLocal(provider) {
    listenerProvider = provider;
  }

  function dispose() {
    unsubscribes.forEach((unsubscribe) => unsubscribe?.());
    unsubscribes.length = 0;
    spinState.clear();
    if (sweepTimer) {
      clearInterval(sweepTimer);
      sweepTimer = null;
    }
  }

  return { updateFrame, setListenerProvider: setListenerProviderLocal, dispose };
}
