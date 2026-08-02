// Player weapon control semantics — the ONE definition of which button does
// what to which mechanism.
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
// The two channels, in v1/pad terms:
//   primary   RT / Space  — the weapon proper
//   secondary RB / R      — the second mechanism, where a bot has one

/** Rotors: the primary button LATCHES them on and off. */
export const SPINNER_TYPES = new Set(["bar", "drum"]);

/** Arms whose SECONDARY channel latches (saw motor, disc, jaw, flame). */
export const ALT_TOGGLE_TYPES = new Set(["hammerSaw", "lifterDisc", "grappler", "lifter"]);

const PRIMARY_LABELS = {
  flipper: "FLIP",
  crusher: "BITE",
  hammer: "SWING",
  hammerSaw: "SWING",
  lifter: "LIFT",
  lifterDisc: "LIFT",
  grappler: "FORKS",
};

/**
 * What this bot's two channels are called and whether each latches. Drives the
 * practice viewer's buttons and any control legend.
 * @param {{ weapon?: object }} spec
 * @returns {{ primary: {label:string, toggle:boolean}|null,
 *             secondary: {label:string, toggle:boolean}|null }}
 */
export function describeWeaponControls(spec) {
  const w = spec?.weapon;
  if (!w) return { primary: null, secondary: null };
  const primary = SPINNER_TYPES.has(w.type)
    ? { label: "SPIN UP", toggle: true }
    : { label: PRIMARY_LABELS[w.type] || "WEAPON", toggle: false };

  // Tantrum's fists are the one MOMENTARY secondary: latching them would leave
  // the arms parked at full extension.
  let secondary = null;
  // A two-way arm spends its second channel on the OTHER DIRECTION rather than
  // on a second mechanism: RT drives it one way, RB the other, and it holds
  // wherever it is let go. That is the only way to park an arm with this much
  // travel exactly where you want it.
  if (w.twoWayArm) return { primary: { label: "RAISE", toggle: false }, secondary: { label: "LOWER", toggle: false } };
  if (w.fists) secondary = { label: "PUNCH", toggle: false };
  else if (w.disc) secondary = { label: "DISC", toggle: true };
  else if (w.flame) secondary = { label: "FLAME", toggle: true };
  else if (w.claw) secondary = { label: "JAW", toggle: true };
  else if (w.type === "hammerSaw") secondary = { label: "SAW", toggle: true };
  return { primary, secondary };
}

/**
 * Per-slot latch state + the raw -> shaped input mapping. One shaper per
 * consumer (the match loop keeps its own; the viewer keeps another) so the two
 * never fight over the same latches.
 *
 * `raw` is a DriveInput plus `weaponAlt`; the result is what the sim consumes:
 * `{ ...raw, weapon, sawActive }`.
 */
export function createWeaponInputShaper() {
  const weaponLatch = [false, false];
  const sawLatch = [false, false];
  const prevWeaponDown = [false, false];
  const prevAltDown = [false, false];

  function shape(raw, spec, slot) {
    const type = spec?.weapon?.type;
    const weaponEdge = raw.weapon && !prevWeaponDown[slot];
    const altEdge = raw.weaponAlt && !prevAltDown[slot];
    prevWeaponDown[slot] = Boolean(raw.weapon);
    prevAltDown[slot] = Boolean(raw.weaponAlt);
    if (SPINNER_TYPES.has(type)) {
      if (weaponEdge) weaponLatch[slot] = !weaponLatch[slot];
      // Tantrum's drum latches like any spinner, but the punch is momentary.
      if (spec.weapon.fists) return { ...raw, weapon: weaponLatch[slot], sawActive: raw.weaponAlt };
      return { ...raw, weapon: weaponLatch[slot] };
    }
    // Split controls: the trigger drives the arm, RB latches the second
    // mechanism. Free Shipping spends that channel on flame; Duck has nothing
    // on it and simply ignores it.
    // Two-way arm: both channels are momentary directions, so neither latches.
    // Checked before the toggle set because a plain lifter is in that set.
    if (spec?.weapon?.twoWayArm) return { ...raw, sawActive: Boolean(raw.weaponAlt) };
    if (ALT_TOGGLE_TYPES.has(type)) {
      if (altEdge) sawLatch[slot] = !sawLatch[slot];
      return { ...raw, sawActive: sawLatch[slot] };
    }
    return raw; // flipper fires on press, crusher bites while held, hammer swings while held
  }

  function reset(slot = null) {
    const slots = slot === null ? [0, 1] : [slot];
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
