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
  // A hammer that holds its stroke, or an arm driven both ways, is worked
  // rather than fired.
  if (weapon?.arm?.holdStroke || weapon?.arm?.twoWayArm) return true;
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
  const config = weapon.arm || {};
  const previous = clamp(weapon.stroke || 0, 0, 1);
  let next;
  if (config.twoWayArm) {
    // Duck's plow has enough travel that "held = up, released = falls" stops
    // being a control scheme: it swings a half turn, so one channel drives it
    // up, the other down, and it HOLDS wherever it is let go. Without that the
    // plow goes up on the first approach and stays parked over its own back.
    const direction = (live ? 1 : 0) - (!broken && secondary ? 1 : 0);
    const rate = direction > 0 ? 1 / armStrokeSeconds(weapon) : 1 / armReturnSeconds(weapon);
    next = clamp(previous + direction * rate * dt, 0, 1);
  } else if (config.holdStroke) {
    // Rusty's axe is a pneumatic gantry, and re-cocking it is a separate action
    // that failed often enough on the real machine to leave the head dragging.
    // So the stroke stays DOWN while the trigger is down and only re-cocks when
    // you let go, on the one button.
    const rate = live ? 1 / armStrokeSeconds(weapon) : 1 / armReturnSeconds(weapon);
    next = clamp(previous + (live ? 1 : -1) * rate * dt, 0, 1);
  } else {
    const target = held ? (live ? 1 : 0) : (strokeActive ? 1 : 0);
    const rate = target > previous ? 1 / armStrokeSeconds(weapon) : 1 / armReturnSeconds(weapon);
    next = clamp(previous + Math.sign(target - previous) * rate * dt, Math.min(previous, target), Math.max(previous, target));
  }
  weapon.strokeDelta = next - previous;
  weapon.stroke = next;

  // Nested rotors. A disc rides its own channel (v2's `sawActive`), because a
  // lifter that only spins its disc while lifting can never cut anything it is
  // holding. Sawblaze's saw and Dragon King's blades run the same way.
  // A two-way arm spends its second channel on driving the arm DOWN, so it has
  // nothing left for a rotor — and it has none to spin.
  const subActive = broken ? false : (!weapon.arm?.twoWayArm && secondary);
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
  // A held hammer bites on the way DOWN, which is its own stroke rather than
  // v1's fired window.
  if (weapon.arm?.holdStroke) return (weapon.stroke || 0) > 0.35;
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

// --- Control channels -------------------------------------------------------
//
// v1 has four buttons: weapon (RT), the secondary mechanism (RB), brake (LB)
// and boost (LT). v2's roster wants up to four HELD weapon channels, so two of
// v1's driving buttons are taken over — but only by the machines that have
// something to put on them, which is the same rule v2 uses:
//
//   RT  the weapon proper   — or, on Dragon King, the JAW, because the jaw is
//                             what every other mechanism on it depends on
//   RB  second mechanism    saw motors, discs, jaws, Tantrum's carriage, flame
//   LB  third mechanism     Tantrum's punch arms, Dragon King's arm tilt
//                           (that bot loses its brake — it is tracked and does
//                           not coast, so it never needed one)
//   LT  fourth mechanism    Dragon King's body lift (loses boost, same reason)
//
// The rules here are v2's, from src/game/weaponControls.js, deliberately
// reproduced rather than imported: v2 shapes a whole DriveInput through a
// per-slot shaper, and v1 resolves per weapon because a v1 weapon object is
// already the thing that persists across frames — the match fighters have one
// each and so does the bot-select viewer, which is exactly the separation v2
// gets from having one shaper per consumer.
//
// LATCHING is the half that was missing, and it is the difference between a
// mechanism you can use and one you cannot: a saw motor, a disc or a jaw has to
// stay on while both hands go back to driving. Every latch is edge-triggered
// off state kept on the weapon, so calling this twice in a frame — v1 resolves
// once per frame for the drive channels and again per physics substep — cannot
// double-toggle.

/** Arms whose SECOND channel drives a motor, and therefore latches. */
export const ALT_TOGGLE_TYPES = new Set(["hammerSaw", "sawArms", "lifterDisc", "grappler", "lifter"]);

/**
 * Does RB latch on this bot? The type set covers the arms whose second
 * mechanism is a motor; a flame, a disc or a jaw latches whatever the arm
 * underneath it is, which is how Kraken gets a flamethrower on a crusher.
 */
export function secondaryLatches(weapon) {
  const config = weapon?.arm || weapon || {};
  if (!weapon?.type) return false;
  // A two-way arm spends the channel on the OTHER DIRECTION, and Tantrum's
  // carriage spends it on a wind-up whose RELEASE is the shot. Both are
  // momentary by construction, and both are checked before the type set
  // because a plain lifter is in it.
  if (config.twoWayArm || config.track) return false;
  return ALT_TOGGLE_TYPES.has(weapon.type)
    || Boolean(config.flame) || Boolean(config.sub) || Boolean(config.claw);
}

/**
 * Is there anything on RB at all? A bot with nothing there reports the channel
 * dead rather than passing the button through, so a stray press cannot reach a
 * mechanism the bot does not have.
 */
export function usesSecondaryChannel(weapon) {
  const config = weapon?.arm || weapon || {};
  return Boolean(
    config.twoWayArm || config.track || config.sub || config.claw || config.flame
    || weapon?.claw || weapon?.subs?.length,
  );
}

/** Does this bot spend LB on a mechanism instead of on the brake? */
export function usesAuxChannel(weapon) {
  // Tantrum's punch arms and Dragon King's saw-arm tilt. Both are a third
  // machine that cannot share a button with the second one.
  return Boolean(weapon?.arm?.fists || weapon?.fists || weapon?.aux?.jaw);
}

/** Does this bot spend LT on a mechanism instead of on the boost? */
export function usesLiftChannel(weapon) {
  return Boolean(weapon?.aux?.lift);
}

export function resolveWeaponControls(weapon, input = {}) {
  const config = weapon?.arm || weapon || {};
  const wantsAux = usesAuxChannel(weapon);
  const wantsLift = usesLiftChannel(weapon);
  const primary = Boolean(input.weapon);
  const rawSecondary = Boolean(input.weaponSecondary);
  const aux = wantsAux ? Boolean(input.brakeActive || input.weaponAux) : false;
  const lift = wantsLift ? Boolean(input.boostActive || input.weaponLift) : false;

  let secondary = usesSecondaryChannel(weapon) ? rawSecondary : false;
  if (secondaryLatches(weapon)) {
    if (rawSecondary && !weapon.secondaryWasDown) weapon.secondaryLatched = !weapon.secondaryLatched;
    secondary = Boolean(weapon.secondaryLatched);
  }
  if (weapon) weapon.secondaryWasDown = rawSecondary;

  // Dragon King: RT is the jaw (latched in updateWeaponMechanisms, because you
  // have to keep hold of what you caught while both hands drive), RB the saw
  // motors, and the ARM ITSELF rides LB. Nothing else remaps its arm channel.
  const armActive = weapon?.type === "sawArms" ? aux : primary;

  return {
    weapon: primary,
    armActive,
    secondary,
    aux,
    lift,
    brakeActive: wantsAux ? false : Boolean(input.brakeActive),
    boostActive: wantsLift ? false : Boolean(input.boostActive),
  };
}

const PRIMARY_LABELS = {
  bar: "SPIN UP",
  drum: "SPIN UP",
  flipper: "FLIP",
  meshFlipper: "FLIP",
  crusher: "BITE",
  hammer: "SWING",
  hammerSaw: "SWING",
  sawArms: "ARMS",
  lifter: "LIFT",
  lifterDisc: "LIFT",
  grappler: "FORKS",
};

/**
 * What this bot's four channels are called and whether each latches. Same
 * answers v2's describeWeaponControls gives, for the same reason: a control
 * legend that disagrees with the controls teaches the wrong thing.
 */
export function describeWeaponControls(weapon) {
  if (!weapon?.type) return { primary: null, secondary: null, aux: null, lift: null };
  const config = weapon.arm || weapon;
  if (weapon.type === "sawArms") {
    return {
      primary: { label: "BITE", toggle: true },
      secondary: { label: "SAWS", toggle: true },
      aux: { label: "TILT SAWS", toggle: false },
      lift: { label: "REAR UP", toggle: false },
    };
  }
  if (config.twoWayArm) {
    return { primary: { label: "RAISE", toggle: false }, secondary: { label: "LOWER", toggle: false }, aux: null, lift: null };
  }
  const spinner = weapon.type === "bar" || weapon.type === "drum";
  const primary = { label: PRIMARY_LABELS[weapon.type] || "WEAPON", toggle: spinner ? Boolean(weapon.toggle) : false };
  const latches = secondaryLatches(weapon);
  let secondary = null;
  if (config.track) secondary = { label: "PULL BACK", toggle: false };
  else if (config.flame) secondary = { label: "FLAME", toggle: latches };
  else if (config.claw) secondary = { label: "JAW", toggle: latches };
  else if (config.sub) secondary = { label: weapon.type === "hammerSaw" ? "SAW" : "DISC", toggle: latches };
  const aux = config.fists ? { label: "FISTS", toggle: false } : null;
  return { primary, secondary, aux, lift: null };
}

// --- Mechanisms that ride a weapon of any type ------------------------------
//
// A carriage, a pair of punch arms, a flamethrower, a jaw, a body lift: none of
// these is a weapon TYPE, they are things bolted to one. Tantrum's drum is a
// spinner AND a carriage AND a pair of fists; Kraken is a crusher with fire in
// its throat. So they update here, off whatever weapon carries them, rather
// than inside any one weapon's code path.
export function updateWeaponMechanisms(weapon, dt, channels = {}) {
  if (!weapon) return;
  const config = weapon.arm || weapon;
  const { secondary = false, aux = false, lift = false, broken = false } = channels;

  // Tantrum's carriage: hold the second channel to winch the drum back and up
  // to the far stop, release and it fires forward. The whole point is that the
  // rotor is TRAVELLING when it arrives, so the fling scale is reported for the
  // hit to use — and while it is parked at the back it is a foot behind where
  // it can reach anything, which is what the wind-up costs.
  if (config.track) {
    const previous = weapon.carriage || 0;
    const rate = (!broken && secondary)
      ? 1 / Math.max(0.05, config.track.retractSeconds)
      : -1 / Math.max(0.05, config.track.flingSeconds);
    const next = clamp(previous + rate * dt, 0, 1);
    weapon.carriageRate = dt > 0 ? (next - previous) / dt : 0;
    weapon.carriage = next;
    const moving = clamp(-weapon.carriageRate * config.track.flingSeconds, 0, 1);
    weapon.flingScale = 1 + ((config.track.hitBoost ?? 1.5) - 1) * moving;
  }

  // The punch arms, on the third channel. Momentary, not latched: a toggle
  // would leave them standing in the air.
  if (config.fists) {
    const seconds = Math.max(0.05, config.fists.punchSeconds);
    const punching = !broken && aux;
    const previous = weapon.fistStroke || 0;
    weapon.fistStroke = clamp(previous + (punching ? dt / seconds : -dt / (seconds * 2.2)), 0, 1);
    // One hit per punch, re-armed once the arms have come most of the way back.
    if (weapon.fistStroke >= 0.85 && !weapon.fistOut) weapon.fistFired = true;
    else weapon.fistFired = false;
    if (weapon.fistStroke >= 0.85) weapon.fistOut = true;
    else if (weapon.fistStroke < 0.4) weapon.fistOut = false;
  }

  // Fire takes a moment to light and a moment to die back. It is always on the
  // second channel — BattleBots requires flame systems to be independently
  // armed, which is exactly why it is never folded into the trigger.
  if (config.flame) {
    const lit = !broken && secondary;
    weapon.burning = clamp((weapon.burning || 0) + (lit ? dt / 0.12 : -dt / 0.25), 0, 1);
    weapon.flameLit = lit;
  }

  // Dragon King's jaw is a LATCH, not a hold: both hands are busy driving, so
  // you press to open, press again to bite and keep hold of what you caught.
  if (weapon.aux?.jaw) {
    const pressed = Boolean(channels.weapon);
    if (pressed && !weapon.jawWasPressed) weapon.jawOpen = !weapon.jawOpen;
    weapon.jawWasPressed = pressed;
    const seconds = Math.max(0.05, weapon.aux.jaw.seconds);
    const goal = weapon.jawOpen ? 1 : 0;
    const step = dt / seconds;
    const current = clamp(weapon.jawAmount ?? 0, 0, 1);
    weapon.jawAmount = Math.abs(goal - current) <= step ? goal : current + Math.sign(goal - current) * step;
    weapon.gripping = weapon.jawAmount < 0.25;
  }

  // The body rears up about the axle at the back of the track pods. It is a
  // real pitch rather than an animation, because the point of the gesture is
  // that what comes over the top collides with things — it is the only way this
  // machine reaches a bot BEHIND it.
  if (weapon.aux?.lift) {
    const seconds = Math.max(0.05, weapon.aux.lift.seconds);
    const goal = !broken && lift ? 1 : 0;
    const step = dt / seconds;
    const current = clamp(weapon.liftAmount || 0, 0, 1);
    weapon.liftAmount = Math.abs(goal - current) <= step ? goal : current + Math.sign(goal - current) * step;
  }

  // A rotor that has been stopped dead from above cannot pull against the jam.
  if (weapon.stallUntil && channels.now !== undefined && channels.now < weapon.stallUntil) weapon.stalled = true;
  else weapon.stalled = false;
}

/** Where the carriage has put the rotor, relative to its rest pivot. */
export function trackOffset(weapon) {
  const track = (weapon?.arm || weapon || {}).track;
  if (!track) return null;
  const carriage = clamp(weapon.carriage || 0, 0, 1);
  return {
    x: (track.offset.x ?? 0) * carriage,
    y: (track.offset.y ?? 0) * carriage,
    z: (track.offset.z ?? 0) * carriage,
  };
}

/** Jam a rotor that took a blow square on the roof (Gigabyte). */
export function stallWeapon(weapon, now, seconds) {
  if (!weapon) return;
  weapon.stallUntil = Math.max(weapon.stallUntil || 0, now + seconds);
  weapon.currentSpeed = 0;
}
