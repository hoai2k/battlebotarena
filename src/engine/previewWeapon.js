// Weapon behaviour for the bot-select practice viewer.
//
// createPreviewWeapon(spec) -> { update(dt, input), reset(), state, ratio() }
//
// The plinth has no physics world, so this mirrors the STROKE MACHINES in
// src/sim/weapons.js rather than running them: same phase names, same timings
// (read from the same `resolveWeaponTuning`), same 0..1 stroke and accumulated
// spinner angle the sim reports through getAngle()/getSubAngle(). What it
// deliberately does NOT model is anything that needs an opponent — impulses,
// grabs, damage. The point is that the CONTROLS and the MOTION are the ones
// the player will meet in the arena; HUGE's bar takes its real five seconds to
// wind up here, and stopping it takes a second press, not letting go.
//
// Input is already shaped by game/weaponControls.js, i.e. `weapon` and
// `sawActive` are post-latch, exactly as the sim receives them.

import { resolveWeaponTuning } from "../sim/weaponTuning.js";
import { SPINNER_TYPES } from "../game/weaponControls.js";

// Both of these belong to the sim and the shared animation module; importing
// them rather than restating them is what keeps the showcase and the arena
// showing the same weapon at the same speed.
import { WEAPON_TUNING } from "../sim/weapons.js";
import { SPIN_VISUAL_MAX_OMEGA } from "./botAnimation.js";

const VISUAL_OMEGA_CAP = SPIN_VISUAL_MAX_OMEGA;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/**
 * @param {import('../assets/catalog.js').BotSpec} spec
 */
export function createPreviewWeapon(spec) {
  const w = spec?.weapon;
  if (!w) {
    return {
      update: () => {},
      reset: () => {},
      state: { weaponAngle: 0, weaponSubAngle: 0, weaponTrack: 0 },
      ratio: () => 0,
      subRatio: () => 0,
      auxRatio: () => 0,
    };
  }
  const tune = resolveWeaponTuning(spec);
  const type = w.type;

  // Shared output, read by botAnimation's syncBotVisual exactly as the sim's
  // render state would be.
  // weaponRatio matters as much as weaponAngle: botAnimation drives a spinner's
  // DRAWN rotation from the ratio (see SPIN_VISUAL_MAX_OMEGA there) and ignores
  // weaponAngle entirely for bar/drum, so a preview that only reported the
  // angle left every rotor in the viewer stone dead however long you held RT.
  const state = { weaponAngle: 0, weaponSubAngle: 0, weaponTrack: 0, weaponRatio: 0 };

  // --- per-type state ------------------------------------------------------
  let omega = 0; // spinner rotor
  let visualAngle = 0; // drawn spinner angle
  let stroke = 0; // 0..1 arm position (crusher/lifter/grappler)
  let sub = 0; // 0..1 secondary stroke (fists lift / grappler jaw)
  let carriage = 0; // 0..1 along a sliding weapon's track (Tantrum's drum)
  let subOmega = 0; // whiplash disc / free shipping flame ramp
  let phase = "idle"; // flipper / hammer / hammerSaw phase machine
  let t = 0;

  const maxOmega = w.maxOmega || 1;
  const spinUpSeconds = Math.max(0.05, w.spinUpSeconds || 1);
  const spinUpRate = maxOmega / spinUpSeconds;
  const spinDownRate = maxOmega / (w.spinDownSeconds ?? WEAPON_TUNING.spinDownSeconds);

  const disc = w.disc || null;
  const discMaxOmega = disc?.maxOmega ?? 380;
  const discSpinUp = Math.max(0.05, disc?.spinUpSeconds ?? 1.4);
  const track = w.track || null;

  function updateSpinner(dt, fire, alt, aux) {
    omega = fire
      ? Math.min(maxOmega, omega + spinUpRate * dt)
      : Math.max(0, omega - spinDownRate * dt);
    visualAngle += (omega / maxOmega) * VISUAL_OMEGA_CAP * dt;
    state.weaponAngle = visualAngle;
    state.weaponRatio = omega / maxOmega;
    // Tantrum's drum carriage: held it winches back up the track, released it
    // fires forward, at the same two rates the sim's updateTrack runs. The
    // plinth cannot show the extra damage the forward stroke does, but it can
    // and must show that the shot is the RELEASE.
    if (track) {
      carriage = clamp01(carriage + (alt ? dt / track.retractSeconds : -dt / track.flingSeconds));
      state.weaponTrack = carriage;
    }
    // Tantrum's fists: momentary lift on the aux channel, same rates as the
    // sim's updateFists.
    if (w.fists) {
      const seconds = Math.max(0.05, w.fists.punchSeconds ?? 0.18);
      sub = clamp01(sub + (aux ? dt / seconds : -dt / (seconds * 2.2)));
      state.weaponSubAngle = sub;
    }
  }

  // Flipper and hammer share a shape: fire from idle only, a fixed stroke, then
  // a return you have to wait out. The wait IS the weapon's rhythm.
  function updateOneShot(dt, fire, strokeSeconds, returnSeconds) {
    if (phase === "idle" && fire) {
      phase = "firing";
      t = 0;
    } else if (phase === "firing") {
      t += dt;
      if (t >= strokeSeconds) {
        phase = "returning";
        t = 0;
      }
    } else if (phase === "returning") {
      t += dt;
      if (t >= returnSeconds) phase = "idle";
    }
    state.weaponAngle =
      phase === "firing"
        ? Math.min(1, t / strokeSeconds)
        : phase === "returning"
          ? Math.max(0, 1 - t / returnSeconds)
          : 0;
  }

  // Sawblaze: the arm swings, then HOLDS at full extension while the trigger is
  // still down (that is the grind), and only returns when released. The saw
  // motor is its own latched channel — in the sim it is visual/audio only
  // (botAnimation's updateWeaponSub spins the mesh), so the ramp here mirrors
  // that lerp rather than a rotor model, purely to drive the readiness meter.
  function updateHammerSaw(dt, fire, alt) {
    subOmega += ((alt ? 1 : 0) - subOmega) * Math.min(1, dt * (alt ? 2.2 : 1.1));
    const swingSeconds = tune.swingSeconds;
    const returnSeconds = tune.returnSeconds;
    if (phase === "idle" && fire) {
      phase = "swinging";
      t = 0;
    }
    if (phase === "swinging") {
      t += dt;
      if (t >= swingSeconds) {
        phase = fire ? "held" : "returning";
        t = 0;
      }
    } else if (phase === "held") {
      if (!fire) {
        phase = "returning";
        t = 0;
      }
    } else if (phase === "returning") {
      t += dt;
      if (t >= returnSeconds) phase = "idle";
    }
    state.weaponAngle =
      phase === "swinging"
        ? Math.min(1, t / swingSeconds)
        : phase === "held"
          ? 1
          : phase === "returning"
            ? Math.max(0, 1 - t / returnSeconds)
            : 0;
  }

  function updateCrusher(dt, fire) {
    // weapons.js: 0.25s to bite, 0.4s to open.
    stroke = clamp01(stroke + (fire ? dt / 0.25 : -dt / 0.4));
    state.weaponAngle = stroke;
  }

  function updateLifter(dt, fire, alt) {
    const raiseSeconds = tune.strokeSeconds;
    const lowerSeconds = w.lowerSeconds ?? tune.strokeSeconds * 1.3;
    // Two-way arm (Duck): RT up, RB down, holds when neither or both are held.
    // Everything else keeps the old shape — held raises, released falls back.
    const dir = w.twoWayArm ? (fire ? 1 : 0) - (alt ? 1 : 0) : (fire ? 1 : -1);
    stroke = clamp01(stroke + (dir > 0 ? dt / raiseSeconds : dir < 0 ? -dt / lowerSeconds : 0));
    state.weaponAngle = stroke;
    if (disc) {
      const up = discMaxOmega / discSpinUp;
      const down = discMaxOmega / (disc.spinDownSeconds ?? WEAPON_TUNING.spinDownSeconds);
      subOmega = alt
        ? Math.min(discMaxOmega, subOmega + up * dt)
        : Math.max(0, subOmega - down * dt);
    } else if (w.flame) {
      // weapons.js ramps `burning` 0..1 while lit; it drives the nozzle VFX.
      subOmega = clamp01(subOmega + (alt ? dt / 0.25 : -dt / 0.35));
    }
  }

  function updateGrappler(dt, fire, alt) {
    const liftSeconds = w.liftSeconds ?? tune.strokeSeconds;
    const lowerSeconds = w.lowerSeconds ?? liftSeconds * 1.3;
    const clampSeconds = w.claw?.clampSeconds ?? 0.25;
    stroke = clamp01(stroke + (fire ? dt / liftSeconds : -dt / lowerSeconds));
    sub = clamp01(sub + (alt ? dt / clampSeconds : -dt / clampSeconds));
    state.weaponAngle = stroke;
    state.weaponSubAngle = sub;
  }

  function update(dt, input = {}) {
    const fire = Boolean(input.weapon);
    const alt = Boolean(input.sawActive);
    const aux = Boolean(input.auxActive);
    if (SPINNER_TYPES.has(type)) updateSpinner(dt, fire, alt, aux);
    else if (type === "flipper") updateOneShot(dt, fire, tune.strokeSeconds, tune.returnSeconds);
    else if (type === "hammer") updateOneShot(dt, fire, tune.strokeSeconds, tune.returnSeconds);
    else if (type === "hammerSaw" || type === "sawArms") updateHammerSaw(dt, fire, alt);
    else if (type === "crusher") updateCrusher(dt, fire);
    else if (type === "lifter" || type === "lifterDisc") updateLifter(dt, fire, alt);
    else if (type === "grappler") updateGrappler(dt, fire, alt);
  }

  function reset() {
    omega = 0;
    visualAngle = 0;
    stroke = 0;
    sub = 0;
    carriage = 0;
    subOmega = 0;
    phase = "idle";
    t = 0;
    state.weaponAngle = 0;
    state.weaponSubAngle = 0;
    state.weaponTrack = 0;
    state.weaponRatio = 0;
  }

  return {
    update,
    reset,
    state,
    /** 0..1 primary readiness, matching the sim's getRatio() per type: rotor
     *  speed for spinners, reload CHARGE for a flipper, arm position else. */
    ratio() {
      if (SPINNER_TYPES.has(type)) return omega / maxOmega;
      if (type === "flipper") {
        if (phase === "returning") return clamp01(t / tune.returnSeconds);
        return phase === "idle" ? 1 : 0;
      }
      if (type === "hammer") {
        if (phase === "returning") return clamp01(t / tune.returnSeconds);
        return phase === "idle" ? 1 : 0;
      }
      return state.weaponAngle;
    },
    /** 0..1 secondary readiness — disc speed, saw motor, flame ramp, jaw, carriage. */
    subRatio() {
      if (disc) return subOmega / discMaxOmega;
      if (w.flame || type === "hammerSaw" || type === "sawArms") return subOmega;
      if (track) return carriage; // how far back the drum is wound, i.e. how big the shot is
      return sub;
    },
    /** 0..1 aux readiness — the punch arms' lift. */
    auxRatio() {
      return sub;
    },
  };
}
