// Arm weapons: the mechanisms v1 gained when the v2 roster was ported in.
//
// v1 shipped three weapon families — spinner (bar/drum), impulse flipper, and
// Quantum's crusher — each wired straight into main.js. The ported roster needs
// four more shapes of mechanism, and they are all the same thing underneath: a
// part on a hinge, driven to an angle, that does something to whatever is in
// front of it while it is there.
//
//   hammer     (Beta, Shatter, Rusty)      one heavy stroke, slow re-cock
//   hammerSaw  (Sawblaze)                  arm holds down, disc grinds
//   lifter     (Duck, Free Shipping)       arm held at an angle, carries a foe
//   lifterDisc (Whiplash)                  the same arm with a disc bolted on
//   grappler   (Claw Viper, Overhaul)      forks plus a jaw that shuts on them
//   sawArms    (Dragon King)               two saws on a tilting arm
//
// This module owns the STATE and the shape of each hit; physics.js applies
// them, main.js draws them. It is DOM-free and three-free (callers pass what
// they need), so the headless physics rig runs the same mechanisms the game
// does — a bot's weapon behaves identically in a test and on screen.
//
// STROKE
// Every arm reports a 0..1 `stroke`: 0 at restAngle, 1 at fireAngle. A HELD arm
// (lifter, grappler, saw arm, crusher) tracks the button — up while pressed at
// 1/strokeSeconds, down when released at 1/returnSeconds — and stops wherever
// the player lets go, which is what makes carrying a bot at a chosen height
// possible. An IMPULSE arm (flipper, hammer) is fired: v1's existing stroke
// window drives it and the arm is committed until it returns.

export const ARM_WEAPON_TYPES = new Set([
  "flipper",
  "meshFlipper",
  "crusher",
  "hammer",
  "hammerSaw",
  "lifter",
  "lifterDisc",
  "grappler",
  "sawArms",
]);

// Fired-and-committed arms. v1's impulse machinery (stroke window + return
// gate) already covers flippers; hammers join them because a hammer that could
// be held half way up would never land the blow that is the whole point of it.
export const IMPULSE_ARM_TYPES = new Set(["flipper", "meshFlipper", "hammer"]);

// Arms that hold wherever the button leaves them.
export const HELD_ARM_TYPES = new Set(["crusher", "hammerSaw", "lifter", "lifterDisc", "grappler"]);

// Arms new to v1 (i.e. not one of the three families v1 already had). Used to
// keep the old code paths byte-identical for the bots that were always here.
export const NEW_ARM_TYPES = new Set(["hammer", "hammerSaw", "lifter", "lifterDisc", "grappler", "sawArms"]);

export function isArmWeapon(weapon) {
  return ARM_WEAPON_TYPES.has(weapon?.type);
}

export function isNewArmWeapon(weapon) {
  return NEW_ARM_TYPES.has(weapon?.type);
}

export function isHeldArmWeapon(weapon) {
  if (weapon?.type === "sawArms") return true;
  return HELD_ARM_TYPES.has(weapon?.type);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

/**
 * How a hit from this arm is shaped, in the units v1's flipper path already
 * speaks: velocities imparted to the target (ft/s), a per-hit damage figure in
 * hp, and a per-second figure for the mechanisms that grind rather than strike.
 *
 * The numbers are anchored to v1's own weapons: Bronco throws at 23 ft/s for
 * 12.5hp a hit, so a hammer that hurts more but throws less reads as a hammer.
 * `budgetCap` is the v2 catalog's weapon budget, which is a v1 impulse number
 * (ARCHITECTURE.md, "Weapon tuning"), so it orders the roster for free.
 */
export function armHitProfile(weapon) {
  const arm = weapon?.arm || {};
  const cap = clamp(arm.budgetCap ?? 160, 20, 700);
  switch (weapon?.type) {
    case "hammer":
      return {
        kind: "hammer",
        // A hammer drives DOWN. What lift there is comes from the target
        // bouncing, not from being thrown.
        liftVelocity: 1.6,
        forwardVelocity: 3.2,
        downVelocity: clamp(cap * 0.018, 2.4, 8),
        pitchVelocity: clamp(cap * 0.03, 5, 13),
        damage: clamp(cap * 0.055, 8, 26),
        recoil: 0.24,
        oncePerStroke: true,
      };
    case "hammerSaw":
    case "sawArms":
      return {
        kind: "grind",
        liftVelocity: 0.6,
        forwardVelocity: 1.1,
        downVelocity: 0.9,
        pitchVelocity: 1.2,
        damage: 0,
        damagePerSecond: clamp(arm.grindDamagePerSecond ?? 6, 1, 30),
        recoil: 0.06,
      };
    case "lifter":
    case "lifterDisc":
    case "grappler":
      return {
        kind: "lift",
        // Spread across the stroke rather than fired: an arm that is HELD
        // hoists, it does not throw. Past vertical the same arm does throw,
        // which is what a grappler's release is for.
        liftVelocity: clamp((arm.liftImpulse ?? 150) * 0.055, 5, 14),
        forwardVelocity: 2.2,
        downVelocity: 0,
        pitchVelocity: 3.4,
        damage: 0,
        damagePerSecond: clamp(arm.holdDamagePerSecond ?? 3.5, 0, 20),
        discDamagePerSecond: clamp(arm.sub?.damagePerSecond ?? 0, 0, 30),
        recoil: clamp(arm.liftRecoil ?? 0.5, 0, 1) * 0.4,
      };
    default:
      return null;
  }
}

/** Seconds the arm takes to reach its stop, and to come back. */
export function armStrokeSeconds(weapon) {
  return Math.max(0.05, weapon?.arm?.strokeSeconds ?? weapon?.strokeSeconds ?? 0.3);
}

export function armReturnSeconds(weapon) {
  return Math.max(0.05, weapon?.arm?.returnSeconds ?? weapon?.returnSeconds ?? 0.7);
}

/**
 * Advance an arm's stroke and its nested rotors. Pure state: no rendering, no
 * DOM, no three.js — the visual side reads `weapon.stroke` afterwards.
 *
 * @param {object} weapon        the fighter's weapon state
 * @param {number} dt            seconds
 * @param {object} input
 * @param {boolean} input.active         weapon button (RT / Space)
 * @param {boolean} input.secondary      secondary mechanism button (RB) — saw
 *                                       motors, jaws, discs. A bot without one
 *                                       ignores it.
 * @param {boolean} input.strokeActive   for impulse arms: the fired window
 * @param {boolean} input.broken         weapon destroyed
 */
export function updateArmWeaponState(weapon, dt, { active = false, secondary = false, strokeActive = false, broken = false } = {}) {
  if (!isArmWeapon(weapon)) return;
  const live = broken ? false : active;
  const held = isHeldArmWeapon(weapon);
  const target = held ? (live ? 1 : 0) : (strokeActive ? 1 : 0);
  const rate = target > (weapon.stroke || 0) ? 1 / armStrokeSeconds(weapon) : 1 / armReturnSeconds(weapon);
  const previous = clamp(weapon.stroke || 0, 0, 1);
  const next = clamp(previous + Math.sign(target - previous) * rate * dt, Math.min(previous, target), Math.max(previous, target));
  weapon.strokeDelta = next - previous;
  weapon.stroke = next;

  // Nested rotors. A disc rides its own channel (v2's `sawActive`), because a
  // lifter that only spins its disc while lifting can never cut anything it is
  // holding. Sawblaze's saw and Dragon King's blades run the same way.
  const subActive = broken ? false : (secondary || (weapon.arm?.subFollowsWeapon && live));
  weapon.subActive = Boolean(subActive);
  (weapon.subs || []).forEach((sub) => {
    const full = sub.visualSpeed || 120;
    const seconds = Math.max(0.05, subActive ? (sub.spinUpSeconds || 1.4) : (sub.spinDownSeconds || 1.1));
    const goal = subActive ? full : 0;
    const step = (Math.abs(full) / seconds) * dt;
    const current = Number.isFinite(sub.currentSpeed) ? sub.currentSpeed : 0;
    sub.currentSpeed = Math.abs(goal - current) <= step ? goal : current + Math.sign(goal - current) * step;
    sub.ratio = Math.abs(full) > 0.001 ? clamp(Math.abs(sub.currentSpeed) / Math.abs(full), 0, 1) : 0;
  });
  weapon.subRatio = (weapon.subs || []).reduce((max, sub) => Math.max(max, sub.ratio || 0), 0);

  // A jaw is a hinge on the same secondary channel: shut it to take a grip.
  if (weapon.claw) {
    const clampSeconds = Math.max(0.05, weapon.claw.clampSeconds || 0.25);
    const goal = subActive ? 1 : 0;
    const current = clamp(weapon.clawAmount || 0, 0, 1);
    const step = dt / clampSeconds;
    weapon.clawAmount = Math.abs(goal - current) <= step ? goal : current + Math.sign(goal - current) * step;
    weapon.gripping = weapon.clawAmount > 0.7;
  }
}

/** The arm angle to draw, in the model's own rotation-about-X convention. */
export function armWeaponAngle(weapon) {
  const base = weapon?.baseRotation || 0;
  const active = weapon?.activeRotation || 0;
  return base + clamp(weapon?.stroke || 0, 0, 1) * (active - base);
}

/**
 * Is the mechanism doing anything an opponent should feel right now? Held arms
 * only bite once they have travelled (an arm at rest is bodywork); impulse arms
 * bite during their fired window.
 */
export function isArmWeaponEngaged(weapon, { strokeActive = false } = {}) {
  if (!isArmWeapon(weapon)) return false;
  if (IMPULSE_ARM_TYPES.has(weapon.type)) return strokeActive;
  if (weapon.type === "hammerSaw" || weapon.type === "sawArms") {
    // The saw only cuts what the arm is down on, and only while it is turning.
    return (weapon.stroke || 0) > 0.35 && (weapon.subRatio || 0) > 0.25;
  }
  if (weapon.type === "grappler") return (weapon.stroke || 0) > 0.02 || (weapon.clawAmount || 0) > 0.5;
  return (weapon.stroke || 0) > 0.02;
}

/** Reach in feet, measured from the weapon pivot's world position. */
export function armWeaponReach(weapon, spec) {
  return Math.max(0.6, weapon?.arm?.reach ?? spec?.armReach ?? 1.8);
}
