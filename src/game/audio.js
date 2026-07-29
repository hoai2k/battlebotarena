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

let ctx = null;
let masterGain = null;
let noiseBuffer = null;
let enabled = Boolean(settings.soundEnabled);
let listenerProvider = null;
let unlockInstalled = false;
let activeVoices = 0;
let sweepTimer = null;

const MAX_VOICES = 14;
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
    masterGain.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.03);
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
  masterGain.gain.value = enabled ? 1 : 0;
  masterGain.connect(compressor);
  noiseBuffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 1.5), ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  sweepTimer = setInterval(sweepStaleLoops, 1500);
  return ctx;
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

function playImpactProfile(profileName, intensity, position) {
  const profile = IMPACT_PROFILES[profileName];
  if (!profile || activeVoices > MAX_VOICES) return;
  if (throttled(`impact:${profileName}`, profile.minGap)) return;
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
function breakSound(position, magnitude = 1) {
  if (!ready()) return;
  if (throttled("break", 0.12)) return;
  const strength = Math.min(1, 0.45 + magnitude * 0.08);
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
function weaponFire(type) {
  if (!ready()) return;
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

function hazardGrind(kind, position = null, intensity = 1) {
  if (!ready()) return;
  const settingsFor = GRIND_SETTINGS[kind];
  if (!settingsFor) return;
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
  let sawsActive = false;
  let lastFrameAt = null;
  const lastPositions = [null, null];

  unsubscribes.push(bus.on(EV.IMPACT, ({ surface, point, relSpeed }) => {
    if (!ready()) return;
    const mapping = SURFACE_SOUNDS[surface] || SURFACE_SOUNDS.bot;
    const intensity = Math.min(1, Math.sqrt(Math.max(0, relSpeed || 0) / mapping.scale));
    if (intensity < 0.12) return;
    playImpactProfile(mapping.profile, intensity, point);
  }));

  unsubscribes.push(bus.on(EV.WEAPON_HIT, ({ point, impulse, heavy }) => {
    if (!ready()) return;
    const intensity = Math.min(1, Math.sqrt(Math.max(0, impulse || 0) / 120)) * (heavy ? 1.1 : 1);
    if (intensity < 0.1) return;
    playImpactProfile("heavyClang", Math.min(1, intensity), point);
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
    playImpactProfile("heavyClang", Math.min(1, Math.sqrt(Math.max(0, impulse || 0) / 220)), point);
  }));

  unsubscribes.push(bus.on(EV.PART_BREAK, ({ point }) => {
    breakSound(point || null, 6);
  }));

  unsubscribes.push(bus.on(EV.MATCH, (payload) => {
    if (payload?.callout === "killSaws") sawsActive = true;
    if (payload?.phase === "ko" || payload?.phase === "timeUp" || payload?.phase === "results" || payload?.phase === "countdown") {
      sawsActive = false;
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
    }
    killSawAmbient(sawsActive);
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
