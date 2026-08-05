// Player control semantics — the ONE definition of which button does what to
// which mechanism, and of which bots read their sticks as a tank pair.
//
// Shared by the match loop (main.js) and the bot-select practice viewer
// (engine/botPreview.js), so a weapon you learn on the plinth is driven by
// exactly the same rules in the arena. Before this module existed the shaping
// lived only in main.js and the viewer improvised its own hold-to-run
// behaviour, which taught the wrong thing: HUGE's bar is a TOGGLE with a five
// second spin-up, not something you hold down.
//
// Pure JS — no DOM, no three, no rapier. `ui` may import it for the control
// labels (ui -> game is the allowed direction; see ARCHITECTURE.md).
//
// The three channels, in v1/pad terms:
//   primary   RT / Space  — the weapon proper
//   secondary RB / R      — the second mechanism, where a bot has one
//   aux       LB / F      — a THIRD mechanism, which only Tantrum has: its
//                           drum carriage and its punch arms are two separate
//                           machines and both are momentary, so neither can
//                           share a button with the other. LB is the brake on
//                           every other bot, and it is folded back into the
//                           brake here for them so the v1 mapping is untouched.

/**
 * Does this bot drive its sticks as a translation + a rotation rather than as
 * a tank pair? An X-drive's omniwheels resolve into movement along both chassis
 * axes AND yaw, all three independently, so a tank pair is the wrong shape for
 * it: LEFT STICK moves the bot (forward/back, and left/right strafes), RIGHT
 * STICK turns it on the spot. That is the entire reason a combat robot fits
 * omniwheels — you can circle an opponent with the weapon still pointed at
 * them — and a tank mapping throws it away.
 */
export function usesHolonomicSticks(spec) {
  return spec?.drive?.type === "holonomic";
}

/**
 * Raw stick channels -> the drive channels the sim reads. Tank bots pass
 * through untouched: their two sticks ARE their two sides.
 */
function mapDrive(raw, spec) {
  if (!usesHolonomicSticks(spec)) return raw;
  // Both sides get the same throttle — an X-drive does not steer by slewing one
  // side. `strafe` (left stick X) and `spin` (right stick X) go through as they
  // came in; sim/vehicle.js reads them only on a bot whose drive.type says so.
  const throttle = raw.throttle ?? (((raw.leftDrive ?? 0) + (raw.rightDrive ?? 0)) / 2);
  return { ...raw, leftDrive: throttle, rightDrive: throttle };
}

/** Rotors: the primary button LATCHES them on and off. */
export const SPINNER_TYPES = new Set(["bar", "drum", "shellSpinner"]);

/**
 * Does this bot spend LT on a mechanism instead of on the brake? Dragon King
 * rears its whole body up about the axle at the back of its pods, and that is a
 * HELD gesture with nowhere else to live: RT, RB and LB are already a jaw, a
 * pair of saw motors and the arm tilt, and none of the four can share with
 * another because you use them together — bite, drive somewhere, run the saws
 * up, tilt them down. Losing the brake is the price of being a four-mechanism
 * robot, and it is the least-used button on a bot that slow.
 */
export function usesLiftChannel(spec) {
  return Boolean(spec?.lift);
}

/** Arms whose SECONDARY channel latches (saw motor, disc, jaw, flame). */
export const ALT_TOGGLE_TYPES = new Set(["hammerSaw", "sawArms", "lifterDisc", "grappler", "lifter"]);

/** Does RB LATCH on this bot? The type set covers the arms whose second
 *  mechanism is a motor; a flame, a disc or a jaw latches whatever the arm
 *  underneath it is, which is how Kraken gets a flamethrower on a crusher. */
function altLatches(spec) {
  const w = spec?.weapon;
  if (!w) return false;
  return ALT_TOGGLE_TYPES.has(w.type) || Boolean(w.flame) || Boolean(w.disc) || Boolean(w.claw);
}

const PRIMARY_LABELS = {
  flipper: "FLIP",
  crusher: "BITE",
  hammer: "SWING",
  hammerSaw: "SWING",
  sawArms: "ARMS",
  lifter: "LIFT",
  lifterDisc: "LIFT",
  grappler: "FORKS",
};

/** Does this bot spend the aux channel, i.e. is LB something other than brake? */
export function usesAuxChannel(spec) {
  // Tantrum's punch arms and Dragon King's saw-arm tilt. Both are a third
  // machine that cannot share a button with the second one.
  return Boolean(spec?.weapon?.fists) || Boolean(spec?.aux?.jaw);
}

/**
 * What this bot's channels are called and whether each latches. Drives the
 * practice viewer's buttons and any control legend.
 * @param {{ weapon?: object }} spec
 * @returns {{ primary: {label:string, toggle:boolean}|null,
 *             secondary: {label:string, toggle:boolean}|null,
 *             aux: {label:string, toggle:boolean}|null }}
 */
export function describeWeaponControls(spec) {
  const w = spec?.weapon;
  if (!w) return { primary: null, secondary: null, aux: null, lift: null };
  // Dragon King reads nothing like the rest of the roster: its PRIMARY is the
  // jaw, not the saws, because the jaw is what every other mechanism depends on.
  if (w.type === "sawArms") {
    return {
      primary: { label: "BITE", toggle: true },
      secondary: { label: "SAWS", toggle: true },
      aux: { label: "TILT SAWS", toggle: false },
      lift: { label: "REAR UP", toggle: false },
    };
  }
  const primary = SPINNER_TYPES.has(w.type)
    ? { label: "SPIN UP", toggle: true }
    : { label: PRIMARY_LABELS[w.type] || "WEAPON", toggle: false };

  let secondary = null;
  // A two-way arm spends its second channel on the OTHER DIRECTION rather than
  // on a second mechanism: RT drives it one way, RB the other, and it holds
  // wherever it is let go. That is the only way to park an arm with this much
  // travel exactly where you want it.
  if (w.twoWayArm) {
    return {
      primary: { label: "RAISE", toggle: false },
      secondary: { label: "LOWER", toggle: false },
      aux: null,
      lift: null,
    };
  }
  // Tantrum's carriage is MOMENTARY on purpose: the button is the wind-up, and
  // the shot is letting go of it. Latching would mean pressing twice to fire.
  if (w.track) secondary = { label: "PULL BACK", toggle: false };
  else if (w.disc) secondary = { label: "DISC", toggle: true };
  else if (w.flame) secondary = { label: "FLAME", toggle: true };
  else if (w.claw) secondary = { label: "JAW", toggle: true };
  else if (w.type === "hammerSaw" || w.type === "sawArms") secondary = { label: "SAWS", toggle: true };
  // The punch arms are their own machine, on their own button, and momentary:
  // latching them would leave the arms standing up in the air.
  // The jaw is held, not latched: it is the grip, and letting go is how you
  // let go. Dragon King's saws do nothing without it.
  const aux = w.fists ? { label: "FISTS", toggle: false } : null;
  return { primary, secondary, aux, lift: null };
}

/**
 * Per-slot latch state + the raw -> shaped input mapping. One shaper per
 * consumer (the match loop keeps its own; the viewer keeps another) so the two
 * never fight over the same latches.
 *
 * `raw` is a DriveInput plus `weaponAlt` and `weaponAux`; the result is what
 * the sim consumes: `{ ...raw, weapon, sawActive, auxActive, brake }`.
 */
export function createWeaponInputShaper() {
  // One entry per SLOT: bot 0..3 in a match, bay 0..3 in the select screen's
  // viewer. Sized for the biggest local game rather than for a pair — a slot
  // past the end reads `undefined` for its latch, which is a weapon that
  // silently never toggles.
  const SLOTS = 4;
  const blank = () => new Array(SLOTS).fill(false);
  const weaponLatch = blank();
  const sawLatch = blank();
  const prevWeaponDown = blank();
  const prevAltDown = blank();

  function shape(rawIn, spec, slot) {
    const raw = mapDrive(rawIn, spec);
    const type = spec?.weapon?.type;
    const weaponEdge = raw.weapon && !prevWeaponDown[slot];
    const altEdge = raw.weaponAlt && !prevAltDown[slot];
    prevWeaponDown[slot] = Boolean(raw.weapon);
    prevAltDown[slot] = Boolean(raw.weaponAlt);
    // LB carries the aux mechanism on a bot that has one and the brake on every
    // bot that does not. Resolving it here rather than in the input layer is
    // what keeps the input layer from having to know the catalog.
    const aux = Boolean(raw.weaponAux);
    // LT is the brake on every bot that does not spend it on something else,
    // exactly as LB is. Resolving both here is what keeps the input layer from
    // having to know the catalog.
    const liftActive = usesLiftChannel(spec) ? Boolean(raw.weaponLift) : false;
    const brake = Boolean(raw.brake)
      || (aux && !usesAuxChannel(spec))
      || (Boolean(raw.weaponLift) && !usesLiftChannel(spec));
    // Dragon King: RT LATCHES the jaw (press to open, press again to bite and
    // hold), RB latches the saw motors, LB holds the arm tilt, LT holds the
    // body lift. Four mechanisms, four buttons, and the jaw latches because you
    // have to keep hold of something while driving and running the saws.
    if (type === "sawArms") {
      if (weaponEdge) weaponLatch[slot] = !weaponLatch[slot];
      if (altEdge) sawLatch[slot] = !sawLatch[slot];
      return {
        ...raw,
        weapon: weaponLatch[slot],
        sawActive: sawLatch[slot],
        auxActive: aux,
        liftActive,
        brake,
      };
    }
    if (SPINNER_TYPES.has(type)) {
      if (weaponEdge) weaponLatch[slot] = !weaponLatch[slot];
      // Tantrum's drum latches like any spinner. Its carriage and its arms are
      // both momentary, and on separate buttons, because the carriage's whole
      // point is that RELEASING it is the shot.
      if (spec.weapon.fists || spec.weapon.track) {
        return { ...raw, weapon: weaponLatch[slot], sawActive: Boolean(raw.weaponAlt), auxActive: aux, liftActive, brake };
      }
      return { ...raw, weapon: weaponLatch[slot], liftActive, brake };
    }
    // Split controls: the trigger drives the arm, RB latches the second
    // mechanism. Free Shipping spends that channel on flame; Duck has nothing
    // on it and simply ignores it.
    // Two-way arm: both channels are momentary directions, so neither latches.
    // Checked before the toggle set because a plain lifter is in that set.
    if (spec?.weapon?.twoWayArm) return { ...raw, sawActive: Boolean(raw.weaponAlt), liftActive, brake };
    if (altLatches(spec)) {
      if (altEdge) sawLatch[slot] = !sawLatch[slot];
      return { ...raw, sawActive: sawLatch[slot], auxActive: aux, liftActive, brake };
    }
    // flipper fires on press, crusher bites while held, hammer swings while held
    return { ...raw, liftActive, brake };
  }

  function reset(slot = null) {
    const slots = slot === null ? weaponLatch.map((_, i) => i) : [slot];
    for (const i of slots) {
      weaponLatch[i] = false;
      sawLatch[i] = false;
      prevWeaponDown[i] = false;
      prevAltDown[i] = false;
    }
  }

  return {
    shape,
    reset,
    isWeaponLatched: (slot) => weaponLatch[slot],
    isAltLatched: (slot) => sawLatch[slot],
  };
}
