// Bot visual animation, shared by the match frame loop (main.js) and the
// bot-select showcase (engine/botPreview.js). Both feed the same render-state
// shape ({ position, quaternion, weaponAngle, weaponSubAngle, wheelSpin }), so
// a weapon test-fired on the select screen moves exactly like it does in the
// arena — the sim produces the state during a match, the preview synthesizes
// it, and everything downstream of that is this file.
import * as THREE from "three";
import { scrollTrackBands } from "./tracks.js";
import { weaponVisualAngle } from "../assets/models.js";

const scratchAxis = new THREE.Vector3();

// --- spinner visuals ---------------------------------------------------------
// A rotor's DISPLAYED speed is not its physical speed and must not be. A real
// one runs 300-1200 rad/s; at 60fps that is several radians between frames, and
// what you see is not a blur but the wagon-wheel effect — the blade lands near
// the same place each frame and reads as stationary, crawling, or running
// backwards depending on where the beat falls. The physics keeps its real omega
// (every impulse, every hit, the whole energy budget) and only the picture is
// redrawn. The RATIO is exact either way, so spin-up still takes exactly as
// long as the driver has to learn it takes.
//
// The cap is in rad/s rather than per frame so the weapon does not visibly slow
// down on a slower machine. 34 rad/s is ~5.4 rev/s: at 60fps that is 18% of a
// two-fold blade's half-turn period and at 30fps it is 36%, so it cannot alias
// anywhere near the frame rates this game runs at, and it is about as fast as
// an eye resolves before it gives up and sees a disc.
export const SPIN_VISUAL_MAX_OMEGA = 34;

function spinnerAngle(visual, state, dt) {
  const spin = (visual.__spin ||= { angle: 0 });
  const ratio = THREE.MathUtils.clamp(state.weaponRatio ?? 0, 0, 1);
  spin.angle += ratio * SPIN_VISUAL_MAX_OMEGA * dt;
  return spin.angle;
}


export function syncBotVisual(visual, spec, state, dt = 1 / 60) {
  visual.group.position.copy(state.position);
  visual.group.quaternion.copy(state.quaternion);
  if (visual.parts.weapon && state.weaponAngle !== undefined) {
    const type = spec.weapon?.type;
    const spinning = type === "bar" || type === "drum";
    scratchAxis.set(spec.weapon.axis.x, spec.weapon.axis.y, spec.weapon.axis.z).normalize();
    visual.parts.weapon.quaternion.setFromAxisAngle(
      scratchAxis,
      spinning ? spinnerAngle(visual, state, dt) : weaponVisualAngle(visual, spec, state),
    );
  }
  // Tantrum's drum TRANSLATES as well as spins: the carriage it is mounted on
  // slides back and up the rails down the middle of the bot, taking the pivot
  // with it, and lets go forward again. This is not a weaponSub — a sub would
  // inherit the drum's spin — and not an aux anchor either, because it is the
  // rotor itself that moves. The rest position is cached on the visual the
  // first time through and every frame writes an ABSOLUTE position from it, so
  // calling this twice in a frame lands in the same place instead of walking
  // the drum out of the bot.
  const track = spec.weapon?.track;
  if (track && visual.parts.weapon) {
    const home = (visual.__weaponHome ||= visual.parts.weapon.position.clone());
    const along = THREE.MathUtils.clamp(state.weaponTrack ?? 0, 0, 1);
    visual.parts.weapon.position.set(
      home.x + (track.offset.x ?? 0) * along,
      home.y + track.offset.y * along,
      home.z + track.offset.z * along,
    );
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
  // Tantrum's fists: an independent mechanism, so it cannot be a weaponSub (a
  // sub inherits the drum's spin). It hinges off its own aux anchor — which is
  // the axle across the back of the bot, not the arms' bounding box — from the
  // sim's lift stroke.
  // Dragon King's clamping jaw and its two rotating track pods. Both are named
  // aux groups driven from the catalog's `aux` block rather than from the
  // weapon, because on this machine they ARE separate machines: the jaw is the
  // grip that makes the saws worth anything, and the pods rotate about their
  // mounting arms to reconfigure the stance, lift the body and self-right.
  for (const [name, cfg] of Object.entries(spec.aux || {})) {
    const node = visual.parts.aux?.[name];
    if (!node) continue;
    const a = cfg.axis ?? { x: 1, y: 0, z: 0 };
    scratchAxis.set(a.x, a.y, a.z).normalize();
    // The jaw runs off the weapon's own 0..1 (1 = shut). The PODS are the odd
    // one: they do not swing on a button at all, they are counter-rotated by
    // however far the chassis has reared up so they stay flat on the floor while
    // the body swings over them. That is what makes the lift read as the body
    // pivoting about the rear axle rather than the whole robot tipping over.
    if (name === "pods") {
      // NEGATIVE: the group above these pods is already carrying the chassis's
      // nose-up rotation, so cancelling it is what leaves them flat on the
      // floor. Rotating them the same way as the body stands them on end.
      const liftAngle = THREE.MathUtils.clamp(state.auxPodAngle ?? 0, 0, 1)
        * (((spec.lift?.maxAngleDeg ?? 90) * Math.PI) / 180);
      node.quaternion.setFromAxisAngle(scratchAxis, -liftAngle);
      continue;
    }
    const stroke = THREE.MathUtils.clamp(state.weaponAuxAngle ?? 0, 0, 1);
    const travel = cfg.openAngle ?? cfg.closeAngle ?? cfg.range ?? 0;
    node.quaternion.setFromAxisAngle(scratchAxis, stroke * travel);
  }
  // Tracks. The band is real geometry built at load time (engine/tracks.js) and
  // scrolled along its own length here; the track units' own textures are left
  // alone, because on a scanned pod they are one atlas shared with the wheels
  // and the frame and no offset of them means "forward".
  scrollTrackBands(visual.trackBands, spec, state.wheelSpin);
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
  // sawArms belongs here too, and its absence is why Dragon King's blades have
  // never turned: the channel latched, the sim spun its rotor up and gated the
  // grind damage on it, and the two discs on screen sat perfectly still.
  if (!sub || !["hammerSaw", "sawArms", "lifterDisc"].includes(spec.weapon?.type)) return;
  const state = (visual.__subSpin ||= { angle: 0, speed: 0 });
  const target = active ? SAW_DISC_SPEED : 0;
  state.speed += (target - state.speed) * Math.min(1, dt * (active ? 2.2 : 1.1));
  state.angle += state.speed * dt;
  scratchAxis.set(spec.weapon.axis.x, spec.weapon.axis.y, spec.weapon.axis.z).normalize();
  sub.quaternion.setFromAxisAngle(scratchAxis, state.angle);
}
