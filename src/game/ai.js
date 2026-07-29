// BattleBot Arena v2 — opponent AI. Port of v1 main.js computeArenaAiInput:
// the same mode machine (approach / feint / strike / retreat / reaim /
// escapeWall) and steering shape, made headless (no three.js, no DOM,
// no performance.now — time accumulates from dt so node tests are
// deterministic) and weapon-type aware per the catalog.
//
// computeAiInput(selfState, foeState, spec, difficulty, dt) -> DriveInput
// - selfState/foeState: sim render-state entries { position, quaternion,
//   weaponRatio? } (world positions in feet).
// - difficulty: 'easy' | 'normal' | 'hard' scales max drive, turn gain, and
//   reaction (foe position is perceived through a lag filter).

// Arena half extents (feet) from v1 src/arenaConfig.js ARENA_LAYOUT 48x48.
const ARENA_HALF_X = 24;
const ARENA_HALF_Z = 24;

// v1 tuning constants (main.js).
const AI_ENGAGE_DISTANCE = 7.0;
const AI_STRIKE_DISTANCE = 4.15;
const AI_ESCAPE_DISTANCE = 5.6;
const AI_WALL_PRESSURE_DISTANCE = 2.4;
const AI_RETREAT_SECONDS = 0.85;
const AI_REAIM_SECONDS = 0.42;
const AI_MAX_ATTACK_SECONDS = 1.35;

const DIFFICULTY = {
  easy: { drive: 0.62, turnGain: 0.8, reactionSeconds: 0.38, range: 0.85 },
  normal: { drive: 0.85, turnGain: 1.0, reactionSeconds: 0.16, range: 1.0 },
  hard: { drive: 1.0, turnGain: 1.18, reactionSeconds: 0.05, range: 1.15 },
};

const states = new Map();

/** Reset stored AI state (call between matches). */
export function resetAiState(stateKey = null) {
  if (stateKey === null) states.clear();
  else states.delete(stateKey);
}

function stateFor(key) {
  let ai = states.get(key);
  if (!ai) {
    ai = {
      t: 0,
      mode: "approach",
      modeStartedAt: 0,
      lastStrikeAt: 0,
      lastFireAt: -10,
      latchedUntil: 0,
      side: Math.random() < 0.5 ? -1 : 1,
      perceived: null,
    };
    states.set(key, ai);
  }
  return ai;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function yawFromQuaternion(q) {
  // Forward is -Z; rotate (0,0,-1) by q and read the heading (v1 convention:
  // desired = atan2(-dir.x, -dir.z)).
  const { x, y, z, w } = q || { x: 0, y: 0, z: 0, w: 1 };
  // v' = q * (0,0,-1) * q^-1
  const fx = -(2 * (x * z + w * y));
  const fz = -(1 - 2 * (x * x + y * y));
  return Math.atan2(-fx, -fz);
}

function signedAngleToDirection(selfState, dir) {
  const yaw = yawFromQuaternion(selfState.quaternion);
  const desired = Math.atan2(-dir.x, -dir.z);
  const delta = desired - yaw;
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}

// v1 steerTowardDirection: throttle scaled by alignment, turn proportional.
function steerToward(selfState, dir, { throttle = 0.7, reverse = false, turnGain = 1.35 } = {}) {
  const lengthSq = dir.x * dir.x + dir.z * dir.z;
  if (lengthSq < 0.0001) return { throttle: 0, turn: 0 };
  const angle = signedAngleToDirection(selfState, dir);
  const absAngle = Math.abs(angle);
  const alignment = Math.cos(angle);
  const turn = clamp(-angle * turnGain, -1, 1);
  const driveThrottle = absAngle < 1.22
    ? throttle * clamp(alignment, 0.18, 1) * (reverse ? -1 : 1)
    : 0;
  return { throttle: driveThrottle, turn };
}

function wallPressure(position) {
  const xClearance = ARENA_HALF_X - Math.abs(position.x);
  const zClearance = ARENA_HALF_Z - Math.abs(position.z);
  const clearance = Math.min(xClearance, zClearance);
  if (clearance > AI_WALL_PRESSURE_DISTANCE) return null;
  return {
    clearance,
    away: {
      x: xClearance < zClearance ? -Math.sign(position.x || 1) : 0,
      z: zClearance <= xClearance ? -Math.sign(position.z || 1) : 0,
    },
  };
}

function normalize(v) {
  const length = Math.hypot(v.x, v.z);
  if (length < 0.0001) return { x: 0, z: -1 };
  return { x: v.x / length, z: v.z / length };
}

function setMode(ai, mode) {
  if (ai.mode === mode) return;
  ai.mode = mode;
  ai.modeStartedAt = ai.t;
}

function tankFrom(throttle, turn) {
  return {
    leftDrive: clamp(throttle + turn, -1, 1),
    rightDrive: clamp(throttle - turn, -1, 1),
  };
}

/**
 * @param {{position:{x,y,z}, quaternion:{x,y,z,w}, weaponRatio?:number}} selfState
 * @param {{position:{x,y,z}}} foeState
 * @param {import('../assets/catalog.js').BotSpec} spec
 * @param {'easy'|'normal'|'hard'} difficulty
 * @param {number} dt
 * @param {*} [stateKey] state bucket (defaults to spec.id)
 * @returns {{leftDrive:number, rightDrive:number, weapon:boolean, brake:boolean}}
 */
export function computeAiInput(selfState, foeState, spec, difficulty = "normal", dt = 1 / 60, stateKey = spec?.id) {
  const level = DIFFICULTY[difficulty] || DIFFICULTY.normal;
  const ai = stateFor(stateKey);
  ai.t += Math.max(0, dt || 0);

  const selfPos = selfState.position;
  // Reaction lag: the AI steers at a low-passed foe position.
  const actualFoe = foeState.position;
  if (!ai.perceived || level.reactionSeconds <= 0.001) {
    ai.perceived = { x: actualFoe.x, z: actualFoe.z };
  } else {
    const blend = clamp(dt / Math.max(0.001, level.reactionSeconds), 0, 1);
    ai.perceived.x += (actualFoe.x - ai.perceived.x) * blend;
    ai.perceived.z += (actualFoe.z - ai.perceived.z) * blend;
  }
  const foePos = { x: ai.perceived.x, y: actualFoe.y, z: ai.perceived.z };

  const toFoe = { x: foePos.x - selfPos.x, z: foePos.z - selfPos.z };
  const distance = Math.hypot(toFoe.x, toFoe.z);
  const dirToFoe = normalize(toFoe);
  const wall = wallPressure(selfPos);
  const foeWall = wallPressure(actualFoe);
  const modeAge = () => ai.t - ai.modeStartedAt;

  // --- v1 mode machine ------------------------------------------------------
  if (wall && ai.mode !== "strike") setMode(ai, "escapeWall");
  if (ai.mode === "approach" && distance < AI_STRIKE_DISTANCE) setMode(ai, "strike");
  if (ai.mode === "approach" && distance < AI_ENGAGE_DISTANCE && modeAge() > 0.65) setMode(ai, "feint");
  if (ai.mode === "strike" && (distance < 2.45 || modeAge() > AI_MAX_ATTACK_SECONDS)) {
    ai.lastStrikeAt = ai.t;
    ai.side *= -1;
    setMode(ai, "retreat");
  }
  if (ai.mode === "retreat" && (modeAge() > AI_RETREAT_SECONDS || distance > AI_ESCAPE_DISTANCE)) setMode(ai, "reaim");
  if (ai.mode === "reaim" && modeAge() > AI_REAIM_SECONDS) setMode(ai, "approach");
  if (ai.mode === "feint" && modeAge() > 0.52) setMode(ai, distance < AI_STRIKE_DISTANCE + 0.5 ? "strike" : "approach");
  if (ai.mode === "escapeWall" && (!wall || wall.clearance > AI_WALL_PRESSURE_DISTANCE + 0.8 || modeAge() > 0.9)) setMode(ai, "reaim");

  // --- steering per mode (v1 shapes) ---------------------------------------
  let steer;
  if (ai.mode === "escapeWall") {
    const away = wall?.away || { x: -dirToFoe.x, z: -dirToFoe.z };
    steer = steerToward(selfState, away, { throttle: 0.72, turnGain: 1.55 });
  } else if (ai.mode === "retreat") {
    const away = normalize({
      x: -dirToFoe.x + -dirToFoe.z * ai.side * 0.45,
      z: -dirToFoe.z + dirToFoe.x * ai.side * 0.45,
    });
    steer = steerToward(selfState, away, { throttle: 0.62, turnGain: 1.45 });
  } else if (ai.mode === "reaim") {
    const dir = normalize({
      x: dirToFoe.x + -dirToFoe.z * ai.side * 0.75,
      z: dirToFoe.z + dirToFoe.x * ai.side * 0.75,
    });
    steer = steerToward(selfState, dir, { throttle: 0.28, turnGain: 1.65 });
  } else if (ai.mode === "feint") {
    const dir = normalize({
      x: dirToFoe.x + -dirToFoe.z * ai.side * 0.95,
      z: dirToFoe.z + dirToFoe.x * ai.side * 0.95,
    });
    steer = steerToward(selfState, dir, { throttle: 0.42, turnGain: 1.65 });
  } else {
    // approach / strike: herd the foe toward their nearest wall.
    const bias = foeWall ? 0.45 : 0;
    const dir = normalize({
      x: dirToFoe.x - (foeWall?.away.x || 0) * bias,
      z: dirToFoe.z - (foeWall?.away.z || 0) * bias,
    });
    const throttle = ai.mode === "strike" ? 0.86 : 0.55;
    steer = steerToward(selfState, dir, { throttle, turnGain: ai.mode === "strike" ? 1.05 : 1.35 });
  }

  // --- weapon-type behavior -------------------------------------------------
  const type = spec?.weapon?.type;
  const spinner = type === "bar" || type === "drum";
  const engage = AI_ENGAGE_DISTANCE * level.range;
  const strikeRange = AI_STRIKE_DISTANCE * level.range;
  let weapon = false;
  let throttleScale = 1;

  if (spinner) {
    // Spin up early; hang back a touch until the weapon carries real energy.
    weapon = distance < engage + 1.5;
    const ratio = Number.isFinite(selfState.weaponRatio) ? selfState.weaponRatio : 1;
    if (weapon && ratio < 0.7 && ai.mode === "approach" && distance < engage) throttleScale = 0.55;
    if (ratio > 0.85 && ai.mode === "strike") throttleScale = 1.1;
  } else if (type === "flipper") {
    // Chase, fire on proximity, respect stroke + reload time.
    const reload = (spec.weapon.tuning?.returnSeconds || 2) + 0.2;
    if (ai.mode === "strike" && distance < strikeRange * 0.62 && ai.t - ai.lastFireAt > reload) {
      ai.lastFireAt = ai.t;
    }
    weapon = ai.t - ai.lastFireAt < 0.25; // hold through the stroke window
  } else if (type === "crusher") {
    // Latch on contact range and hold the clamp.
    if (distance < strikeRange * 0.7) ai.latchedUntil = ai.t + 1.6;
    weapon = ai.t < ai.latchedUntil;
    if (weapon && distance < 2.2) throttleScale = 0.45; // stay planted while biting
  } else if (type === "hammerSaw") {
    // Close in, then rhythmic swings while on target.
    if (distance < strikeRange + 0.35 && ai.mode === "strike") {
      weapon = (ai.t - ai.lastStrikeAt) % 1.1 < 0.55;
    } else if (distance < 2.6) {
      weapon = true; // keep grinding while parked on the foe
    }
  } else if (type === "hammer") {
    // One heavy swing, then wait out the slow re-cock: swinging early wastes
    // the stroke, since the head only pays off at the bottom of the arc.
    const cycle = (spec.weapon.tuning?.strokeSeconds || 0.22)
      + (spec.weapon.tuning?.returnSeconds || 0.9) + 0.15;
    if (ai.mode === "strike" && distance < strikeRange * 0.8 && ai.t - ai.lastFireAt > cycle) {
      ai.lastFireAt = ai.t;
    }
    weapon = ai.t - ai.lastFireAt < (spec.weapon.tuning?.strokeSeconds || 0.22);
  } else if (type === "lifterDisc") {
    // Get under them and hold the arm up — the lift is the point, the disc is
    // opportunistic. Hold the arm DOWN while closing so the forks can scoop.
    weapon = distance < strikeRange * 0.85;
    if (weapon && distance < 2.4) throttleScale = 0.6; // stay under them
  }

  // Disc/saw motor is a separate channel; the AI simply runs it whenever it is
  // anywhere near the fight. Without this an AI Sawblaze never spun its saw.
  const sawActive = (type === "hammerSaw" || type === "lifterDisc") && distance < engage + 3;

  const throttle = steer.throttle * level.drive * throttleScale;
  const turn = clamp(steer.turn * level.turnGain, -1, 1);
  const { leftDrive, rightDrive } = tankFrom(throttle, turn);
  return { leftDrive, rightDrive, weapon, brake: false, sawActive };
}
