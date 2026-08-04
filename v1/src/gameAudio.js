// Procedural BattleBots soundscape (no audio assets). All effects are
// synthesized with WebAudio: metal impacts, spinner whir, drive motors,
// kill saw / screw grinding, pneumatic flippers, and part-break tears.
//
// Design notes:
// - The AudioContext is created lazily on the first user gesture (autoplay policy).
// - One-shot impacts route through per-kind throttles and a global voice cap.
// - Continuous loops (spinners, drive motors, hazard grinds) use a keep-alive
//   pattern: the game loop must refresh them every frame or they fade out on
//   their own within ~0.3s, so pauses, round ends, and mode switches go quiet
//   without explicit teardown calls.

const STORAGE_KEY = "bba-sound-enabled";

let ctx = null;
let masterGain = null;
let noiseBuffer = null;
let enabled = readStoredEnabled();
let listenerProvider = null;
let unlockInstalled = false;
let activeVoices = 0;

const MAX_VOICES = 14;
const loops = new Map();
const lastPlayedByKey = new Map();
const enabledListeners = new Set();

// Sound is opt-in: it stays off until the player turns it on, and only an
// explicit "on" in storage carries that choice across sessions.
function readStoredEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch (error) {
    return false;
  }
}

export function isSoundEnabled() {
  return enabled;
}

export function setSoundEnabled(value) {
  enabled = Boolean(value);
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch (error) {
    // Storage may be unavailable (private browsing); the in-session flag still works.
  }
  // Turning sound on is itself a user gesture, so this is a valid moment to
  // create the context the default-off path never built.
  if (enabled) ensureContext();
  if (ctx && masterGain) {
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.03);
    if (enabled && ctx.state === "suspended") ctx.resume().catch(() => {});
  }
  enabledListeners.forEach((listener) => listener(enabled));
}

export function onSoundEnabledChanged(listener) {
  enabledListeners.add(listener);
}

export function setListenerProvider(provider) {
  listenerProvider = provider;
}

// Installs one-time gesture listeners so the context can start under autoplay rules.
export function initGameAudioUnlock() {
  if (unlockInstalled) return;
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
  setInterval(sweepStaleLoops, 1500);
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
      } catch (error) {
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
// One-shot impact synthesis
// ---------------------------------------------------------------------------

// Each profile: thump (low body), modes (metallic ring partials), crack (noise
// transient). Frequencies are randomized a few percent per hit so repeated
// impacts don't sound machine-gunned.
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

// Maps recordBotDamage `kind` strings to a profile + intensity divisor.
// Recoil kinds are skipped: they are the attacker-side entry of the same hit.
const KIND_SOUNDS = {
  collision: { profile: "clang", scale: 5 },
  botCollision: { profile: "clang", scale: 5 },
  wall: { profile: "wall", scale: 5 },
  ceiling: { profile: "wall", scale: 6 },
  spinner: { profile: "heavyClang", scale: 11 },
  spinnerHit: { profile: "heavyClang", scale: 11 },
  spinnerWall: { profile: "wall", scale: 7 },
  spinnerFloor: { profile: "floor", scale: 6 },
  spinnerFloorLaunch: { profile: "heavyClang", scale: 8 },
  weaponFloor: { profile: "floor", scale: 6 },
  weaponWall: { profile: "wall", scale: 7 },
  flipper: { profile: "clang", scale: 6 },
  flipperHit: { profile: "heavyClang", scale: 8 },
  flipperWeaponHit: { profile: "clang", scale: 7 },
  crusherHit: { profile: "clank", scale: 4 },
  quantumBite: { profile: "clank", scale: 4 },
  quantumBiteInitial: { profile: "clank", scale: 3 },
  killSawHazard: { profile: "clank", scale: 8 },
  screwHazard: { profile: "clank", scale: 8 },
};

export function impactSound(kind, amount, position = null) {
  if (!enabled || !ctx || ctx.state !== "running") return;
  const mapping = KIND_SOUNDS[kind];
  if (!mapping) return;
  const intensity = Math.min(1, Math.sqrt(Math.max(0, amount) / mapping.scale));
  if (intensity < 0.12) return;
  playImpactProfile(mapping.profile, intensity, position);
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

// Metal tearing + debris clatter when a piece physically breaks off a bot.
export function breakSound(position = null, magnitude = 1) {
  if (!enabled || !ctx || ctx.state !== "running") return;
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
      if (enabled && ctx?.state === "running") {
        playImpactProfile("clank", strength * (0.25 + Math.random() * 0.3), position);
      }
    }, delay * 1000);
  }
}

// Pneumatic flipper fire: CO2 hiss sweep + launch thunk + latch click.
export function weaponFire(type) {
  if (!enabled || !ctx || ctx.state !== "running") return;
  if (type !== "flipper" && type !== "meshFlipper") return;
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
    if (enabled && ctx?.state === "running") playImpactProfile("clank", 0.45, null);
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
export function weaponLoop(key, { type, ratio = 0, position = null } = {}) {
  if (!enabled || !ctx || ctx.state !== "running") return;
  if (type === "crusher") {
    crusherLoop(key, ratio);
    return;
  }
  if (type !== "bar" && type !== "drum") return;
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
  whooshGain.gain.setTargetAtTime(0.1 + curve * 0.34, now, 0.1);
  wub.frequency.setTargetAtTime(2 + ratio * (isDrum ? 22 : 13), now, 0.08);
  wubDepth.gain.setTargetAtTime(ratio > 0.05 ? 0.1 : 0, now, 0.1);
  const spatial = spatialize(position);
  keepAlive(loop, ratio <= 0.01 ? 0 : (0.1 + ratio * 0.5) * spatial.gain);
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
export function driveLoop(key, { level = 0, speed = 0, position = null } = {}) {
  if (!enabled || !ctx || ctx.state !== "running") return;
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
export function killSawAmbient(active) {
  if (!enabled || !ctx || ctx.state !== "running") return;
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
// Called from the spark callbacks while a bot is on a saw/screw, so refreshes
// arrive every spark cooldown (~0.12-0.24s); the fade window rides through that.
const GRIND_SETTINGS = {
  killSaw: { center: 2400, q: 1.2, rumble: 88, level: 0.42, sizzle: 0.3 },
  screw: { center: 640, q: 1, rumble: 52, level: 0.34, sizzle: 0.14 },
};

export function hazardGrind(kind, position = null, intensity = 1) {
  if (!enabled || !ctx || ctx.state !== "running") return;
  const settings = GRIND_SETTINGS[kind];
  if (!settings) return;
  const loop = acquireLoop(`grind:${kind}`, (l) => {
    const roar = noiseSource();
    const roarFilter = ctx.createBiquadFilter();
    roarFilter.type = "bandpass";
    roarFilter.frequency.value = settings.center;
    roarFilter.Q.value = settings.q;
    roar.connect(roarFilter);
    roarFilter.connect(l.gain);

    const sizzle = noiseSource();
    const sizzleFilter = ctx.createBiquadFilter();
    sizzleFilter.type = "highpass";
    sizzleFilter.frequency.value = 5200;
    const sizzleGain = ctx.createGain();
    sizzleGain.gain.value = settings.sizzle;
    const flutter = ctx.createOscillator();
    flutter.type = "square";
    flutter.frequency.value = 23;
    const flutterDepth = ctx.createGain();
    flutterDepth.gain.value = settings.sizzle * 0.6;
    flutter.connect(flutterDepth);
    flutterDepth.connect(sizzleGain.gain);
    sizzle.connect(sizzleFilter);
    sizzleFilter.connect(sizzleGain);
    sizzleGain.connect(l.gain);

    const rumble = ctx.createOscillator();
    rumble.type = "triangle";
    rumble.frequency.value = settings.rumble;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.3;
    rumble.connect(rumbleGain);
    rumbleGain.connect(l.gain);

    l.params = { roarFilter };
    l.nodes.push(roar, sizzle, flutter, rumble);
  });
  const now = ctx.currentTime;
  loop.params.roarFilter.frequency.setTargetAtTime(
    settings.center * (0.9 + Math.random() * 0.25), now, 0.05,
  );
  const spatial = spatialize(position);
  // Longer tail than keepAlive's default: spark callbacks arrive sparsely.
  loop.gain.gain.cancelScheduledValues(now);
  loop.gain.gain.setTargetAtTime(settings.level * Math.min(1, Math.max(0.35, intensity)) * spatial.gain, now, 0.05);
  loop.gain.gain.setTargetAtTime(0, now + 0.42, 0.12);
}
