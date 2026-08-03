// BattleBot Arena v2 — player input + gamepad haptics.
//
// createInput({ on, playerIndex }) -> { readInput(), dispose() }
// readInput() returns DriveInput { leftDrive, rightDrive, weapon, brake }.
//
// v1 mapping (main.js readControls):
// - Keyboard: W/S drive both sides, A/D split (tank turn), Q/E extra turn
//   (+-0.7), Space weapon, Shift brake.
// - Gamepad: left stick Y = left side, right stick Y = right side (tank),
//   RT (button 7) weapon, RB (5) secondary, LB (4) aux, LT (6) brake. Deadzone
//   0.12. Stick input wins over keyboard when non-zero; weapon/brake are OR'd.
//   Left stick X and right stick X carry strafe and rotation for the bots that
//   drive that way (Glitch, Shatter); see game/weaponControls.js.
//   LB reads as v1's brake for all but one bot — see game/weaponControls.js,
//   which owns which button means what to which machine.
//
// Haptics (v1 triggerGamepadHaptic pattern): subscribe EV.IMPACT and
// EV.WEAPON_HIT for the player's bot and pulse the pad's dual-rumble actuator
// scaled by hit strength, with per-kind cooldowns and a priority gate so weak
// rumbles never cut off strong ones. EV.WEAPON_SPIN drives a separate sustained
// buzz while the rotor is turning. Gated by settings.hapticsEnabled.
//
// Module is import-safe under node: DOM/gamepad access only happens when a
// window exists, and readInput() degrades to neutral input.

import { EV } from "../shared/events.js";
import { settings } from "../shared/settings.js";

const DEADZONE = 0.12;
const TRIGGER_THRESHOLD = 0.2;
const EXTRA_TURN = 0.7;

const HAPTIC_COLLISION_COOLDOWN_SECONDS = 0.05; // v1 values
const HAPTIC_WEAPON_COOLDOWN_SECONDS = 0.04;

// Sustained spinner rumble. The pad's dual-rumble effect is one-shot, so a
// continuous buzz means re-arming it slightly faster than it expires; the
// overlap is what keeps it from stuttering between pulses.
const SPIN_HAPTIC_MIN_RATIO = 0.06; // below this the blade is barely turning
const SPIN_HAPTIC_PULSE_MS = 220;
const SPIN_HAPTIC_REARM_SECONDS = 0.16;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dead = (v) => (Math.abs(v) < DEADZONE ? 0 : v);

const hasWindow = typeof window !== "undefined";

function nowSeconds() {
  return (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
}

function getGamepad(index) {
  if (!hasWindow || typeof navigator === "undefined" || !navigator.getGamepads) return null;
  return [...navigator.getGamepads()].filter(Boolean)[index] || null;
}

// v1 playGamepadHaptic: dual-rumble via vibrationActuator, pulse fallback.
function playHaptic(pad, { duration = 80, strong = 0.35, weak = 0.25 } = {}) {
  const actuator = pad?.vibrationActuator;
  const strongMagnitude = clamp(strong, 0, 1);
  const weakMagnitude = clamp(weak, 0, 1);
  if (actuator?.playEffect) {
    actuator.playEffect("dual-rumble", {
      startDelay: 0,
      duration,
      strongMagnitude,
      weakMagnitude,
    }).catch(() => {});
    return;
  }
  const fallback = pad?.hapticActuators?.[0];
  fallback?.pulse?.(Math.max(strongMagnitude, weakMagnitude), duration).catch?.(() => {});
}

/**
 * @param {object} args
 * @param {Function} args.on bus subscribe (for haptics); optional
 * @param {number} [args.playerIndex] which sim bot this player drives
 * @param {number} [args.gamepadIndex] which physical pad to read/rumble
 */
export function createInput({ on, playerIndex = 0, gamepadIndex = 0 } = {}) {
  const keys = new Set();
  const unsubscribes = [];
  const haptics = { collisionAt: 0, weaponAt: 0, activeUntil: 0, activePriority: 0 };
  const spin = { ratio: 0, scale: 1, nextAt: 0 };

  const onKeyDown = (event) => {
    if (event.repeat) return;
    keys.add(event.code);
  };
  const onKeyUp = (event) => keys.delete(event.code);
  const onBlur = () => keys.clear();

  if (hasWindow) {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
  }

  // --- haptics (v1 triggerGamepadHaptic port) -------------------------------

  function pulse(type, { strong, weak, duration }) {
    if (!settings.hapticsEnabled) return;
    const pad = getGamepad(gamepadIndex);
    if (!pad) return;
    const now = nowSeconds();
    const key = type === "weapon" ? "weaponAt" : "collisionAt";
    const cooldown = type === "weapon" ? HAPTIC_WEAPON_COOLDOWN_SECONDS : HAPTIC_COLLISION_COOLDOWN_SECONDS;
    const priority = Math.max(strong ?? 0.35, weak ?? 0.25);
    const hasActive = now < haptics.activeUntil;
    if (hasActive && priority < haptics.activePriority - 0.02) return;
    if (now - haptics[key] < cooldown && priority <= haptics.activePriority + 0.02) return;
    haptics[key] = now;
    haptics.activeUntil = now + duration / 1000;
    haptics.activePriority = priority;
    playHaptic(pad, { strong, weak, duration });
  }

  if (on) {
    unsubscribes.push(on(EV.IMPACT, ({ botIndex, relSpeed, force }) => {
      if (botIndex !== playerIndex) return;
      // Strength from relative speed, nudged by contact force when present.
      const speedTerm = clamp(((relSpeed || 0) - 3) / 14, 0, 1);
      const forceTerm = clamp((force || 0) / 9000, 0, 0.35);
      const strength = clamp(speedTerm + forceTerm, 0, 1);
      if (strength < 0.06) return;
      pulse("collision", {
        strong: 0.15 + strength * 0.75,
        weak: 0.1 + strength * 0.6,
        duration: 55 + strength * 90,
      });
    }));
    unsubscribes.push(on(EV.WEAPON_SPIN, ({ botIndex, ratio, powered, hapticScale }) => {
      if (botIndex !== playerIndex) return;
      // Rumble tracks the MOTOR, not the rotor. Spinning up, it climbs with the
      // ratio; the moment the trigger comes off it goes to nothing, even though
      // HUGE's bar takes the better part of ten seconds to actually stop. What
      // the driver feels through the sticks is the drive fighting the weapon,
      // and that ends when the power does.
      spin.ratio = powered === false ? 0 : clamp(ratio || 0, 0, 1);
      spin.scale = hapticScale || 1;
    }));
    unsubscribes.push(on(EV.WEAPON_HIT, ({ attackerIndex, targetIndex, impulse, heavy }) => {
      const isTarget = targetIndex === playerIndex;
      const isAttacker = attackerIndex === playerIndex;
      if (!isTarget && !isAttacker) return;
      const base = clamp((impulse || 0) / 260, 0, 1) * (heavy ? 1.15 : 1);
      const scale = isTarget ? 1 : 0.45; // attacker feels kickback, softer
      const strength = clamp(base * scale, 0, 1);
      if (strength < 0.05) return;
      pulse("weapon", {
        strong: 0.2 + strength * 0.8,
        weak: 0.15 + strength * 0.6,
        duration: 70 + strength * 90,
      });
    }));
  }

  // Spinning up a bar or drum is the one thing the player does that lasts, and
  // it was the one thing the pad stayed silent through: v1 buzzed continuously
  // with the rotor and only EV.IMPACT / EV.WEAPON_HIT transients were ported.
  // Weighted toward the WEAK (high-frequency) actuator, which is what reads as
  // a motor rather than a thud, and yields the moment a real hit lands so the
  // impact still punches through.
  function updateSpinHaptic() {
    if (!settings.hapticsEnabled) return;
    if (spin.ratio < SPIN_HAPTIC_MIN_RATIO) return;
    const now = nowSeconds();
    if (now < haptics.activeUntil || now < spin.nextAt) return;
    const pad = getGamepad(gamepadIndex);
    if (!pad) return;
    spin.nextAt = now + SPIN_HAPTIC_REARM_SECONDS;
    const intensity = clamp(spin.ratio * spin.scale, 0, 1);
    playHaptic(pad, {
      strong: 0.04 + intensity * 0.22,
      weak: 0.1 + intensity * 0.55,
      duration: SPIN_HAPTIC_PULSE_MS,
    });
  }

  // --- per-frame reading ----------------------------------------------------

  function keyboardInput() {
    const throttle = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const turn = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0)
      + (keys.has("KeyE") ? EXTRA_TURN : 0) - (keys.has("KeyQ") ? EXTRA_TURN : 0);
    return {
      leftDrive: clamp(throttle + turn, -1, 1),
      rightDrive: clamp(throttle - turn, -1, 1),
      // Throttle on its own, with no turn folded into it. A tank pair has
      // nowhere to put this; a bot that steers on a separate channel needs it,
      // and game/weaponControls.js is what knows which bots those are.
      throttle: clamp(throttle, -1, 1),
      // Holonomic channels, read only by bots whose drive.type says so (Glitch,
      // Shatter). An omniwheel drives along its own axis and SLIDES sideways,
      // so an X-drive can translate any direction independently of where it is
      // pointing — which needs a second axis the tank pair has nowhere to put.
      // A/D strafe, Q/E rotate: the whole of basic movement is on WASD, and
      // turning is the optional extra rather than the other way round.
      strafe: clamp((keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0), -1, 1),
      spin: clamp((keys.has("KeyE") ? 1 : 0) - (keys.has("KeyQ") ? 1 : 0), -1, 1),
      weapon: keys.has("Space"),
      // Secondary weapon channel (sawblaze saw toggle): R on keyboard, RB on pad.
      weaponAlt: keys.has("KeyR"),
      // Aux weapon channel (Tantrum's punch arms): F on keyboard, LB on pad.
      // game/weaponControls.js folds it back into the brake for every bot that
      // has no third mechanism, so LB still brakes for the rest of the roster.
      weaponAux: keys.has("KeyF"),
      brake: keys.has("ShiftLeft") || keys.has("ShiftRight"),
      pauseDown: keys.has("Escape"),
    };
  }

  let pauseWasDown = false;

  function readInput() {
    const keyboard = keyboardInput();
    const pad = getGamepad(gamepadIndex);
    const merged = !pad ? keyboard : (() => {
      const leftStick = -dead(pad.axes[1] || 0);
      const rightStick = -dead(pad.axes[3] || 0);
      const stickDrive = leftStick !== 0 || rightStick !== 0;
      // The left stick's X axis and the right stick's X axis are unused by a
      // tank pair. On a bot that steers independently of its tracks they are
      // the other two thirds of the drive: LEFT STICK translates in any
      // direction, RIGHT STICK rotates. The channels are derived here for
      // everyone and it costs nothing — a tank bot's sim never reads them, and
      // which mapping a bot gets is decided in game/weaponControls.js.
      const strafeAxis = dead(pad.axes[0] || 0);
      const turnAxis = dead(pad.axes[2] || 0);
      return {
        leftDrive: stickDrive ? clamp(leftStick, -1, 1) : keyboard.leftDrive,
        rightDrive: stickDrive ? clamp(rightStick, -1, 1) : keyboard.rightDrive,
        throttle: leftStick !== 0 ? clamp(leftStick, -1, 1) : keyboard.throttle,
        strafe: strafeAxis !== 0 ? clamp(strafeAxis, -1, 1) : keyboard.strafe,
        spin: turnAxis !== 0 ? clamp(turnAxis, -1, 1) : keyboard.spin,
        weapon: (pad.buttons[7]?.value || 0) > TRIGGER_THRESHOLD || Boolean(pad.buttons[7]?.pressed) || keyboard.weapon,
        weaponAlt: Boolean(pad.buttons[5]?.pressed) || keyboard.weaponAlt,
        weaponAux: (pad.buttons[4]?.value || 0) > TRIGGER_THRESHOLD || Boolean(pad.buttons[4]?.pressed) || keyboard.weaponAux,
        // LT joins the brake so a bot that spends LB on a third mechanism still
        // has a brake button on the pad; LB itself reaches the brake through
        // weaponControls, which is the one place that knows which bots those are.
        brake: (pad.buttons[6]?.value || 0) > TRIGGER_THRESHOLD || Boolean(pad.buttons[6]?.pressed) || keyboard.brake,
        pauseDown: Boolean(pad.buttons[9]?.pressed) || keyboard.pauseDown,
      };
    })();
    // Edge-detect pause so holding Start doesn't oscillate the state.
    merged.pausePressed = merged.pauseDown && !pauseWasDown;
    pauseWasDown = merged.pauseDown;
    updateSpinHaptic();
    return merged;
  }

  function hasGamepad() {
    return Boolean(getGamepad(gamepadIndex));
  }

  function dispose() {
    if (hasWindow) {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    }
    unsubscribes.forEach((unsubscribe) => unsubscribe?.());
    unsubscribes.length = 0;
    keys.clear();
  }

  return { readInput, hasGamepad, dispose };
}
