// Spinner hit ladder: what the sim does today vs what this update makes it do.
//
//   node tools/weapon-tuning-verify.mjs
//
// Reports, per spinner, at four spin ratios:
//   dV+  target horizontal launch speed (ft/s)   dV^  vertical launch (ft/s)
//   dmg  match.js damage for that hit (% of 100) CAP  the budget cap clamped it
// "now" = current v2/src/sim/weapons.js, "v1" = root src/physics.js reference,
// "new" = v2/src/sim/weaponTuning.js (what the sim now does).

import { CATALOG } from "../src/assets/catalog.js";
import { createSpinnerModel, V1, V1_IMPULSE_TO_V2 } from "../src/sim/weaponTuning.js";

const G = 32.174;
const SLUG = (lbs) => lbs / G;
const V1_MASS = (lbs) => Math.max(12, lbs * V1.massPerLb);
const DAMAGE_PER_IMPULSE = 0.028; // match.js WEAPON_HIT_DAMAGE_PER_IMPULSE
const HEAVY = 1.25;
const RATIOS = [0.25, 0.5, 0.75, 1];
// Every spinner in the catalog, so a new bot cannot be tuned blind.
const SPINNERS = Object.values(CATALOG)
  .filter((b) => b.weapon?.type === "bar" || b.weapon?.type === "drum")
  .map((b) => b.id);
const TARGET = CATALOG.biteforce; // 250 lb reference target for every row

// --- current v2 weapons.js, verbatim -----------------------------------------
function nowHit(spec, ratio) {
  const w = spec.weapon;
  const omega = w.maxOmega * ratio;
  const e = 0.5 * w.inertia * omega * omega;
  const m = SLUG(spec.weightLbs);
  const mEff = (m * SLUG(TARGET.weightLbs)) / (m + SLUG(TARGET.weightLbs));
  const raw = Math.sqrt(2 * mEff * e * (w.efficiency ?? 0.4)) * (w.impulseScale ?? 1);
  const j = Math.min(raw, w.budgetCap);
  const lift = w.liftFactor ?? (w.type === "drum" ? 0.85 : 0.25);
  const unit = 1 / Math.hypot(1, lift);
  const tm = SLUG(TARGET.weightLbs);
  return {
    dvH: (j * unit) / tm,
    dvV: (j * unit * lift) / tm,
    dmg: Math.min(15, Math.max(0.8, j * DAMAGE_PER_IMPULSE)) * (j >= w.budgetCap * 0.5 ? HEAVY : 1),
    capped: raw > w.budgetCap,
  };
}

// --- v1 reference (root src/physics.js applySpinnerHit) ----------------------
const V1_BIAS = {
  horizontal: { lift: 0.48 }, vertical: { lift: 1.08 }, "vertical-front": { lift: 0.92 },
};
function v1Hit(spec, ratio) {
  const model = createSpinnerModel(spec);
  const t = model.tuning;
  const w = spec.weapon;
  const energy = model.v1Energy(ratio);
  const eti = Math.sqrt(2 * V1_MASS(TARGET.weightLbs) * energy * t.efficiency);
  const bite = Math.min(1.25, Math.max(0.25, 0.35 + ratio * 0.65));
  const momentum = Math.min(1.35, Math.max(0.42, Math.sqrt(spec.weaponWeightLbs / TARGET.weightLbs)));
  const half = t.halfSpeedPowerMultiplier, full = t.fullSpeedPowerMultiplier;
  const power = half === 1 && full === 1 ? 1
    : ratio <= 0.5 ? 1 + (half - 1) * (ratio / 0.5) : half + (full - half) * ((ratio - 0.5) / 0.5);
  const raw = eti * bite * momentum * t.impactScale * power;
  const j = Math.min(Math.max(raw, 0.2), w.budgetCap);
  const bias = V1_BIAS[t.spinType].lift;
  const m1 = V1_MASS(TARGET.weightLbs);
  return {
    dvH: (j * t.impulseScale) / m1,
    dvV: (j * (0.13 + bias * 0.22) * Math.min(1.25, Math.max(0.25, ratio)) * t.liftScale) / m1,
    dmgHp: j * (V1.damageBase + ratio * V1.damageRamp), // hp out of 1000 => %/10
    capped: raw > w.budgetCap,
  };
}

// --- this update -------------------------------------------------------------
function newHit(spec, ratio) {
  const hit = createSpinnerModel(spec).hit({ ratio, targetSpec: TARGET });
  const tm = SLUG(TARGET.weightLbs);
  return {
    dvH: hit.push / tm,
    dvV: hit.lift / tm + hit.liftVelocityFloor * 0, // floor is a top-up, shown separately
    floor: hit.liftVelocityFloor,
    dmg: Math.min(15, Math.max(0.8, hit.damageImpulse * DAMAGE_PER_IMPULSE)),
    capped: hit.capped,
    retained: hit.spinRetained,
  };
}

const f = (x, w = 6) => x.toFixed(1).padStart(w);
for (const id of SPINNERS) {
  const spec = CATALOG[id];
  const model = createSpinnerModel(spec);
  console.log(`\n${spec.name}  (${spec.weapon.type}, cap ${spec.weapon.budgetCap}, spin ${model.tuning.spinType})`);
  console.log("  spin |      now: dV+   dV^   dmg |       v1: dV+   dV^   dmg |      new: dV+   dV^   dmg");
  for (const r of RATIOS) {
    const a = nowHit(spec, r), b = v1Hit(spec, r), c = newHit(spec, r);
    console.log(
      `  ${r.toFixed(2)} |${a.capped ? " CAP" : "    "} ${f(a.dvH)}${f(a.dvV)}${f(a.dmg, 6)} |` +
      `${b.capped ? " CAP" : "    "} ${f(b.dvH)}${f(b.dvV)}${f(b.dmgHp / 10, 6)} |` +
      `${c.capped ? " CAP" : "    "} ${f(c.dvH)}${f(c.dvV)}${f(c.dmg, 6)}`,
    );
  }
  const c1 = newHit(spec, 1);
  console.log(`  lift-velocity floor ${c1.floor.toFixed(1)} ft/s | spin retained after a hit ${(c1.retained * 100).toFixed(0)}%`);
}

console.log(`\nunit bridge: v1 impulse x ${V1_IMPULSE_TO_V2.toFixed(5)} = v2 slug-ft/s`);
console.log("dV rows are for a 250 lb target; 'now' rows show today's flat, always-capped hits.");
