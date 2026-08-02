// Bot visual animation, shared by the match frame loop (main.js) and the
// bot-select showcase (engine/botPreview.js). Both feed the same render-state
// shape ({ position, quaternion, weaponAngle, weaponSubAngle, wheelSpin }), so
// a weapon test-fired on the select screen moves exactly like it does in the
// arena — the sim produces the state during a match, the preview synthesizes
// it, and everything downstream of that is this file.
import * as THREE from "three";
import { weaponVisualAngle } from "../assets/models.js";

const scratchAxis = new THREE.Vector3();

export function syncBotVisual(visual, spec, state) {
  visual.group.position.copy(state.position);
  visual.group.quaternion.copy(state.quaternion);
  if (visual.parts.weapon && state.weaponAngle !== undefined) {
    scratchAxis.set(spec.weapon.axis.x, spec.weapon.axis.y, spec.weapon.axis.z).normalize();
    visual.parts.weapon.quaternion.setFromAxisAngle(scratchAxis, weaponVisualAngle(visual, spec, state));
  }
  // Negated: wheelSpin accumulates ground speed along forward (-Z), and a wheel
  // on the +X axle rolling the bot toward -Z turns NEGATIVE about +X. Without
  // the sign the tyres spin backwards — invisible on small dark wheels, glaring
  // on HUGE's six-foot spoked ones.
  visual.parts.wheels?.forEach((wheel, i) => {
    const spinIndex = wheel.userData.spinIndex ?? i;
    wheel.rotation.x = -(state.wheelSpin?.[spinIndex] ?? 0);
  });
  // Claw Viper's jaw: a nested sub-part that HINGES on its own channel rather
  // than spinning like Sawblaze's saw, so it is posed here from the sim's
  // clamp stroke instead of being driven by updateWeaponSub.
  const jaw = visual.parts.weaponSub;
  if (jaw && spec.weapon?.claw) {
    const open = spec.weapon.claw.openAngle ?? 0;
    const shut = spec.weapon.claw.closedAngle ?? -0.8;
    const clamp = THREE.MathUtils.clamp(state.weaponSubAngle ?? 0, 0, 1);
    scratchAxis.set(spec.weapon.axis.x, spec.weapon.axis.y, spec.weapon.axis.z).normalize();
    jaw.quaternion.setFromAxisAngle(scratchAxis, open + clamp * (shut - open));
  }
  // Bronco's pneumatic ram compresses with the flipper: fully shortened at
  // rest (arm down over it), full length at the top of the stroke. The aux
  // anchor sits at the ram's base, so scaling never pokes below the mount.
  const ram = visual.parts.aux?.ram;
  if (ram && spec.weapon?.type === "flipper") {
    const stroke = THREE.MathUtils.clamp(state.weaponAngle ?? 0, 0, 1);
    ram.scale.y = 0.35 + 0.65 * stroke;
  }
  // Tantrum's fists: a SECOND independent mechanism, so it cannot be a
  // weaponSub (a sub inherits the drum's spin). It hinges off its own aux
  // anchor from the sim's punch stroke.
  const punch = visual.parts.aux?.fists;
  if (punch && spec.weapon?.fists) {
    const f = spec.weapon.fists;
    const open = f.openAngle ?? 0;
    const shut = f.punchAngle ?? -1.0;
    const stroke = THREE.MathUtils.clamp(state.weaponSubAngle ?? 0, 0, 1);
    const a = f.axis ?? { x: 1, y: 0, z: 0 };
    scratchAxis.set(a.x, a.y, a.z).normalize();
    punch.quaternion.setFromAxisAngle(scratchAxis, open + stroke * (shut - open));
  }
}

// Nested sub-spinner inside a weapon arm (Sawblaze's saw, Whiplash's disc).
// Spins up while the RB toggle is on, coasts down when off; rides the arm's
// swing either way.
// Negative: the disc cuts on the DOWNSWING, so the teeth travel toward the
// target as the arm chops rather than away from it.
const SAW_DISC_SPEED = -67.2; // rad/s at full speed (was 42, +60%)
export function updateWeaponSub(visual, spec, dt, active) {
  const sub = visual.parts.weaponSub;
  if (!sub || !["hammerSaw", "lifterDisc"].includes(spec.weapon?.type)) return;
  const state = (visual.__subSpin ||= { angle: 0, speed: 0 });
  const target = active ? SAW_DISC_SPEED : 0;
  state.speed += (target - state.speed) * Math.min(1, dt * (active ? 2.2 : 1.1));
  state.angle += state.speed * dt;
  scratchAxis.set(spec.weapon.axis.x, spec.weapon.axis.y, spec.weapon.axis.z).normalize();
  sub.quaternion.setFromAxisAngle(scratchAxis, state.angle);
}
