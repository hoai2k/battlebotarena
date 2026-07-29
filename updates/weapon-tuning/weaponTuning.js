// BattleBot Arena v2 — weapon tuning resolver.
//
// DROP-IN TARGET: v2/src/sim/weaponTuning.js  (SIM area, imported by weapons.js)
//
// Two jobs:
//   1. Flatten `catalog.weapon.tuning` into the names the sim reads, with
//      defaults. Today weapons.js reads `w.efficiency`, `w.impulseScale`,
//      `w.strokeSeconds`, ... off the weapon object while the catalog nests
//      them under `weapon.tuning`, so every bot silently runs on generic
//      defaults.
//   2. Port v1's spinner shaping chain (root `src/physics.js` applySpinnerHit /
//      applySpinnerOwnerReflection / applySpinnerGyro / drainSpinner) into v2
//      units, so the per-bot numbers mean in v2 what they meant in v1.
//
// UNIT BRIDGE (this is the part that makes the raw v1 numbers usable)
//   v1 rigid bodies used mass = weightLbs * 0.075  (18.75 for a 250 lb bot).
//   v2 uses true slugs = weightLbs / 32.174        ( 7.77 for a 250 lb bot).
//   Same feet, same gravity, different mass scale — so an impulse ports across
//   by the mass ratio: J_v2 = J_v1 * V1_IMPULSE_TO_V2 (0.4144). Torque impulses
//   port by the angular-inertia ratio, which differs per bot and per axis, so
//   they go through toV2Torque().
//
// Pure math. No Rapier, no three, no DOM — safe for headless sim tests.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** v1 constants this port depends on (root src/physics.js + src/botConfig.js). */
export const V1 = Object.freeze({
  massPerLb: 0.075, // v1 rb mass = max(12, weightLbs * 0.075)
  gravity: 32.174,
  energyScale: 0.0046, // v1 spinnerEnergy()
  inertiaDivisor: 70, // v1 inertia = (weaponWeightLbs / 70) * (0.65 + weaponRotationalInertia)
  inertiaBase: 0.65,
  inertiaMax: 800,
  gyroInertiaMax: 4.4,
  extraTorqueScale: 0.26, // SPINNER_EXTRA_TORQUE_SCALE
  damageBase: 1.55, // v1 damage = damageImpulse * (1.55 + ratio * 0.55), in hp of 1000
  damageRamp: 0.55,
  minImpulse: 0.2,
});

/** Multiply a v1 linear impulse by this to get the v2 (slug·ft/s) equivalent. */
export const V1_IMPULSE_TO_V2 = 1 / (V1.massPerLb * V1.gravity); // 0.41441

// v1 damage was hp out of maxHp 1000 (1% = 10 hp); v2 match.js turns the event
// `impulse` into percent with WEAPON_HIT_DAMAGE_PER_IMPULSE (0.028). This
// constant maps v1's damage *curve* onto that constant. 0.6 puts the hardest
// full-spin hit in the game (Minotaur) at ~4.5% — roughly today's flat 4.2%
// drum hit — so the ceiling stays put while everything below it becomes a
// ramp. Dial this one number to move overall match pace.
export const DAMAGE_CALIBRATION = 0.6;

// Mirror of match.js WEAPON_HIT_DAMAGE_PER_IMPULSE. Only used to express a
// damage-per-second tuning value (crusher hold, saw grind) as an event impulse;
// keep the two in sync, or add an explicit `damagePercent` to the payload.
export const MATCH_DAMAGE_PER_IMPULSE = 0.028;

/** Event `impulse` that makes match.js deal `dps` percent per second in `tick` steps. */
export function damageImpulseForRate(dps, tickSeconds) {
  return (dps * tickSeconds) / MATCH_DAMAGE_PER_IMPULSE;
}

export const SPINNER_BIASES = Object.freeze({
  horizontal: { lift: 0.48, pitch: 0.35, yaw: 1.35, kickback: 0.88 },
  vertical: { lift: 1.08, pitch: 1.05, yaw: 0.55, kickback: 0.68 },
  "vertical-front": { lift: 0.92, pitch: 0.86, yaw: 0.62, kickback: 0.72 },
});

const SPINNER_DEFAULTS = Object.freeze({
  efficiency: 0.42,
  impulseScale: 1,
  liftScale: 1,
  liftVelocity: 0,
  liftClearance: 0,
  kickbackScale: 1,
  impactScale: 1,
  gyroScale: 0.75,
  reach: 1.45,
  halfSpeedPowerMultiplier: 1,
  fullSpeedPowerMultiplier: 1,
  hapticScale: 1,
  floorLaunch: null,
});

const STROKE_DEFAULTS = Object.freeze({
  strokeSeconds: 0.18,
  returnSeconds: 1.2,
  swingSeconds: 0.4,
  liftVelocity: 0,
  pitchVelocity: 0,
  holdDamagePerSecond: 0,
  grindDamagePerSecond: 0,
  sawTouchCap: 0,
  sawCenter: null,
  reach: null,
  zone: null,
  clampForce: 380,
});

/**
 * v1 called this weaponRotationalInertiaType. The v2 catalog dropped it, but it
 * is recoverable from the weapon axis + type (verified against v1 botConfig:
 * tombstone horizontal, huge/sawblaze vertical, drums vertical-front).
 */
export function spinnerBiasKey(spec) {
  const w = spec.weapon || {};
  if (w.tuning?.spinType) return w.tuning.spinType;
  if (Math.abs(w.axis?.y ?? 0) > 0.5) return "horizontal";
  return w.type === "drum" ? "vertical-front" : "vertical";
}

/** Flat, frozen tuning for any weapon type. Tuning wins, weapon-level wins over defaults. */
export function resolveWeaponTuning(spec) {
  const w = spec.weapon || {};
  const t = w.tuning || {};
  const base = w.type === "bar" || w.type === "drum" ? SPINNER_DEFAULTS : STROKE_DEFAULTS;
  const out = { ...STROKE_DEFAULTS, ...base };
  for (const key of Object.keys(out)) {
    const value = t[key] !== undefined ? t[key] : w[key];
    if (value !== undefined) out[key] = value;
  }
  out.spinType = spinnerBiasKey(spec);
  return Object.freeze(out);
}

/** v1 rigid-body angular inertia (src/physics.js resetFighterPhysics). */
export function v1AngularInertia(spec) {
  const mass = Math.max(12, (spec.weightLbs || 250) * V1.massPerLb);
  const boost = spec.id === "huge" ? 1.75 : spec.id === "tombstone" ? 1.38 : 1.18;
  return {
    x: mass * boost * 3.2,
    y: mass * boost * (spec.id === "huge" ? 0.34 : 1.05),
    z: mass * boost * 3.2,
  };
}

/** v2 rigid-body angular inertia — mirrors v2/src/sim/vehicle.js. */
export function v2AngularInertia(spec) {
  const mass = (spec.weightLbs || 250) / V1.gravity;
  const d = spec.bodyDims || { x: 3, y: 1.5, z: 3 };
  return {
    x: (mass / 12) * (d.y * d.y + d.z * d.z),
    y: 0.7 * (mass / 12) * (d.x * d.x + d.z * d.z),
    z: (mass / 12) * (d.x * d.x + d.y * d.y),
  };
}

/** Port a v1 torque impulse to v2 by matching the resulting angular velocity change. */
export function toV2Torque(spec, axis, v1Torque) {
  const i1 = v1AngularInertia(spec);
  const i2 = v2AngularInertia(spec);
  return v1Torque * (i2[axis] / i1[axis]);
}

/**
 * Spinner model for one bot. `spec` is a catalog BotSpec.
 *
 *   const model = createSpinnerModel(spec);
 *   const hit = model.hit({ ratio, targetSpec, approachSpeed });
 *
 * All returned impulses are already in v2 units (slug·ft/s) and are magnitudes;
 * the sim supplies the directions (it owns the contact frame).
 */
export function createSpinnerModel(spec) {
  const w = spec.weapon || {};
  const t = resolveWeaponTuning(spec);
  const bias = SPINNER_BIASES[t.spinType] || SPINNER_BIASES["vertical-front"];
  const weaponLbs = Math.max(1, spec.weaponWeightLbs || 40);
  const v1Inertia = clamp(
    (weaponLbs / V1.inertiaDivisor) * (V1.inertiaBase + (w.inertia || 0)),
    0.12,
    V1.inertiaMax,
  );
  const maxOmega = w.maxOmega || 1;
  const cap = Number.isFinite(w.budgetCap) ? w.budgetCap : 7.5; // v1 spinnerImpactCap units
  const efficiency = clamp(t.efficiency, 0.02, 1.5);
  const impactScale = clamp(t.impactScale, 0.05, 6);

  /** v1 spinnerSpeedPowerMultiplier — HUGE's mid-spin power hump. */
  function speedPower(ratio) {
    const half = t.halfSpeedPowerMultiplier;
    const full = t.fullSpeedPowerMultiplier;
    if (half === 1 && full === 1) return 1;
    const r = clamp(ratio, 0, 1);
    if (r <= 0.5) return 1 + (half - 1) * (r / 0.5);
    return half + (full - half) * ((r - 0.5) / 0.5);
  }

  return {
    tuning: t,
    bias,
    v1Inertia,
    /** Stored energy in v1 units (only meaningful inside this chain). */
    v1Energy(ratio) {
      const speed = maxOmega * clamp(ratio, 0, 1.45);
      return 0.5 * v1Inertia * speed * speed * V1.energyScale;
    },
    /**
     * @param {{ratio:number, targetSpec:object, approachSpeed?:number, plow?:object}} args
     * @returns {{push:number, lift:number, liftVelocityFloor:number, damageImpulse:number,
     *   kickback:number, kickbackLift:number, targetYawTorque:number, targetPitchTorque:number,
     *   ownerYawTorque:number, spinRetained:number, bite:number, capped:boolean}}
     */
    hit({ ratio, targetSpec, approachSpeed = 0, plow = null }) {
      const r = clamp(ratio, 0, 1.45);
      const targetLbs = targetSpec?.weightLbs || 250;
      const v1TargetMass = Math.max(12, targetLbs * V1.massPerLb);
      const energy = this.v1Energy(r);
      const eti = Math.sqrt(Math.max(0, 2 * v1TargetMass * energy * efficiency));
      const bite = clamp(0.35 + r * 0.65 + approachSpeed * 0.045, 0.25, 1.25);
      const momentum = clamp(Math.sqrt(weaponLbs / targetLbs), 0.42, 1.35);
      const raw = eti * bite * momentum * impactScale * speedPower(r);
      const j = clamp(raw, V1.minImpulse, Math.max(V1.minImpulse, cap));

      // v1 splits the capped impulse into push / lift / torque / damage shares
      // (all 1 without wedge plow defence, which v2 does not model yet).
      const pushMag = j * (plow?.pushFactor ?? 1);
      const liftMag = j * (plow?.liftFactor ?? 1);
      const torqueMag = j * (plow?.torqueFactor ?? 1);
      const damageMag = j * (plow?.damageFactor ?? 1);
      const reflectionMag = pushMag * (plow?.attackerReflectionBoost ?? 1);
      const liftV1 = liftMag * (0.13 + bias.lift * 0.22) * clamp(r, 0.25, 1.25) * t.liftScale;

      // Owner recoil (v1 applySpinnerOwnerReflection).
      const ownerShare = clamp(Math.sqrt(t.impulseScale) * 0.36, 0.45, 1.65);
      const horizontal = t.spinType === "horizontal";
      const ownerYawShare = clamp(
        Math.sqrt(t.impulseScale) * (horizontal ? 0.58 : 0.36),
        0.55,
        horizontal ? 2.45 : 1.55,
      );
      const kickbackV1 = reflectionMag * bias.kickback * 0.36 * t.kickbackScale * ownerShare;

      const yawV1 = torqueMag * bias.yaw * 0.42 * V1.extraTorqueScale;
      const pitchV1 = torqueMag * bias.pitch * 0.32 * V1.extraTorqueScale;
      const ownerYawV1 = torqueMag * bias.yaw * 0.42 * V1.extraTorqueScale * t.kickbackScale * ownerYawShare;

      const drainLoss = clamp(0.72 + bite * 0.16 + r * 0.08, 0.72, 0.97);

      return {
        push: pushMag * t.impulseScale * V1_IMPULSE_TO_V2,
        lift: liftV1 * V1_IMPULSE_TO_V2,
        liftVelocityFloor: t.liftVelocity * (plow?.liftFactor ?? 1), // ft/s, applied as a top-up impulse
        damageImpulse: damageMag * (V1.damageBase + r * V1.damageRamp) * DAMAGE_CALIBRATION,
        kickback: kickbackV1 * V1_IMPULSE_TO_V2,
        kickbackLift: liftV1 * 0.16 * V1_IMPULSE_TO_V2,
        targetYawTorque: toV2Torque(targetSpec || spec, "y", yawV1),
        targetPitchTorque: toV2Torque(targetSpec || spec, "x", pitchV1),
        ownerYawTorque: toV2Torque(spec, "y", ownerYawV1),
        spinRetained: clamp(1 - drainLoss, 0.03, 0.96), // multiply omega by this after a hit
        bite,
        capped: raw > cap,
      };
    },
    /**
     * v1 applySpinnerGyro: a spun-up weapon fights the drive — the bot pitches
     * under throttle and rolls/yaws into turns. Returns a v2 torque impulse for
     * this tick; apply with applyTorqueImpulse (body frame: x pitch, y yaw, z roll).
     */
    gyroTorque({ ratio, throttle = 0, turn = 0, dt }) {
      const r = clamp(ratio, 0, 1.35);
      if (r <= 0.08 || t.gyroScale <= 0) return null;
      const inertia = clamp(
        (weaponLbs / V1.inertiaDivisor) * (V1.inertiaBase + (w.inertia || 0)),
        0.12,
        V1.gyroInertiaMax,
      ) * r;
      const amount = inertia * clamp(t.gyroScale, 0, 4) * 0.036 * (dt * 60);
      return {
        x: toV2Torque(spec, "x", clamp(throttle, -1, 1) * amount * bias.pitch),
        y: toV2Torque(spec, "y", -clamp(turn, -1, 1) * amount * bias.yaw * 0.45),
        z: toV2Torque(spec, "z", -clamp(turn, -1, 1) * amount * bias.pitch),
      };
    },
  };
}
