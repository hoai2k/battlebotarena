// Camera director: battle cam (frames both bots), bot chase cam, arena orbit.
// Impact shake is fed from the event bus by main.js via addShake().
import * as THREE from "three";
import { settings } from "../shared/settings.js";

const BATTLE_MIN_DIST = 12;
// The bounding radius the camera framing was authored around — roughly a
// 3.5ft-wide, 3ft-long machine. Bigger bots pull the camera back in proportion.
const REFERENCE_BOT_RADIUS = 2.3;
const BATTLE_HEIGHT = 7.5;
const BATTLE_LERP = 3.2;

export function createCameraDirector(camera) {
  const position = new THREE.Vector3(0, 14, 26);
  const target = new THREE.Vector3(0, 0.5, 0);
  let shake = 0;
  let shakeSeed = 0;
  let lastShakeAddAt = 0;
  let orbitAngle = Math.PI * 0.75;

  const scratch = {
    mid: new THREE.Vector3(),
    span: new THREE.Vector3(),
    desired: new THREE.Vector3(),
    offset: new THREE.Vector3(),
  };
  const lastSide = new THREE.Vector3(0, 0, 1);
  // Same idea as the chase camera's `framing`: the director's distances were
  // authored around a reference-sized machine, so a pair including a big bot
  // needs the whole shot pushed out or the bot fills the frame on its own.
  let battleFraming = 1;

  function updateBattle(dt, bots) {
    const [a, b] = bots;
    scratch.mid.set((a.position.x + b.position.x) / 2, 0.6, (a.position.z + b.position.z) / 2);
    scratch.span.set(a.position.x - b.position.x, 0, a.position.z - b.position.z);
    const spread = scratch.span.length();
    // Sit perpendicular to the line between the bots, pulled back with spread.
    const side = spread > 0.5
      ? scratch.offset.set(-scratch.span.z, 0, scratch.span.x).normalize()
      : scratch.offset.copy(lastSide);
    // Hysteresis, not a fixed hemisphere: when the perpendicular is ambiguous
    // (bots aligned with an axis) a sign test flips every frame and the camera
    // averages toward the arena center. Stay on whichever side we were on.
    if (side.dot(lastSide) < 0) side.multiplyScalar(-1);
    lastSide.copy(side);
    // Pull back with spread but never so far that fog/walls swallow the shot;
    // extra height covers what distance can't when the bots are far apart.
    const dist = Math.max(BATTLE_MIN_DIST * battleFraming, Math.min(27 * battleFraming, spread * 0.72 + 8 * battleFraming));
    scratch.desired.copy(scratch.mid).addScaledVector(side, dist).setY(BATTLE_HEIGHT + spread * 0.24);
    scratch.desired.x = THREE.MathUtils.clamp(scratch.desired.x, -30, 30);
    scratch.desired.z = THREE.MathUtils.clamp(scratch.desired.z, -30, 30);
    scratch.desired.y = Math.min(scratch.desired.y, 17);
    position.lerp(scratch.desired, 1 - Math.exp(-BATTLE_LERP * dt));
    target.lerp(scratch.mid, 1 - Math.exp(-BATTLE_LERP * 1.4 * dt));
  }

  const scratchForward = new THREE.Vector3();

  /**
   * Chase pose BEHIND a bot looking forward over it (game forward is the
   * bot's -Z, so behind = +bot-Z). Exported shape so split-screen can drive a
   * second camera with the same framing.
   */
  function chaseDesired(botState, outPosition, outTarget) {
    scratchForward.set(0, 0, -1).applyQuaternion(botState.quaternion);
    scratchForward.y = 0;
    if (scratchForward.lengthSq() < 0.001) scratchForward.set(0, 0, -1);
    scratchForward.normalize();
    outPosition.set(
      botState.position.x - scratchForward.x * 6.4,
      botState.position.y + 3.1,
      botState.position.z - scratchForward.z * 6.4,
    );
    outTarget.set(
      botState.position.x + scratchForward.x * 2.2,
      botState.position.y + 0.6,
      botState.position.z + scratchForward.z * 2.2,
    );
  }

  function updateBot(dt, bots) {
    chaseDesired(bots[0], scratch.desired, scratch.mid);
    position.lerp(scratch.desired, 1 - Math.exp(-4.5 * dt));
    target.lerp(scratch.mid, 1 - Math.exp(-6 * dt));
  }

  function updateArena(dt) {
    orbitAngle += dt * 0.05;
    scratch.desired.set(Math.sin(orbitAngle) * 27, 15, Math.cos(orbitAngle) * 27);
    position.lerp(scratch.desired, 1 - Math.exp(-1.4 * dt));
    target.lerp(scratch.mid.set(0, 0.5, 0), 1 - Math.exp(-2 * dt));
  }

  return {
    /** bots: [{position:{x,y,z}, yaw}, ...] from sim render state. */
    update(dt, bots) {
      const mode = settings.cameraMode;
      if (mode === "bot" && bots?.length) updateBot(dt, bots);
      else if (mode === "arena" || !bots?.length) updateArena(dt);
      else updateBattle(dt, bots);

      camera.position.copy(position);
      if (shake > 0.001) {
        shakeSeed += dt * 60;
        const s = shake * shake;
        camera.position.x += Math.sin(shakeSeed * 2.9) * 0.22 * s;
        camera.position.y += Math.sin(shakeSeed * 3.7 + 1.3) * 0.16 * s;
        camera.position.z += Math.cos(shakeSeed * 2.3 + 0.7) * 0.22 * s;
        shake = Math.max(0, shake - dt * 2.6);
      }
      camera.lookAt(target);
    },
    /**
     * strength 0..1; big spinner hit ≈ 0.8, wall thud ≈ 0.25.
     * Rate-limited: sustained grinding fires IMPACT events every few frames
     * and unbounded stacking turned every scrum into constant jitter — small
     * shakes are ignored while a comparable shake is already active, and only
     * clearly bigger hits may re-shake inside the cooldown window.
     */
    addShake(strength) {
      const now = performance.now() / 1000;
      const recentlyShaking = now - lastShakeAddAt < 0.22;
      if (recentlyShaking && strength < shake * 1.6) return;
      if (strength < 0.08) return;
      lastShakeAddAt = now;
      shake = Math.min(0.9, Math.max(shake, strength));
    },
    /** Largest bounding radius in the match, MEASURED off the loaded models. */
    setSubjectRadius(radius) {
      battleFraming = Math.min(1.9, Math.max(1, (radius || 0) / REFERENCE_BOT_RADIUS));
    },
    snapTo(bots) {
      if (bots?.length) {
        updateBattle(1, bots);
        position.copy(scratch.desired);
      }
    },
  };
}

function dampAngle(current, target, lambda, dt) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-lambda * dt));
}

function yawOfQuaternion(q) {
  // Forward is -Z; yaw 0 faces -Z. atan2 of the rotated forward vector.
  const fx = -(2 * (q.x * q.z + q.w * q.y));
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  return Math.atan2(-fx, -fz);
}

/**
 * Standalone smoothed chase camera (bot cam + split-screen viewports).
 * v1's third-person feel: the camera YAW chases the bot's yaw at only
 * 3.2/s — quick spins don't whip the view — and the position follows the
 * damped yaw at 9/s (v1 updateThirdPersonCamera constants).
 */
export function createChaseCamera(camera) {
  const position = new THREE.Vector3(0, 6, 10);
  const target = new THREE.Vector3(0, 0.5, 0);
  const desiredPosition = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  let smoothedYaw = 0;
  // How far back the camera sits is a function of HOW BIG THE BOT IS. A fixed
  // 6.4ft was framed around a ~2ft-radius machine and cropped anything larger:
  // Mammoth is more than twice that and you could not see your own bot. 1.0 is
  // the reference machine; setSubjectRadius scales off it.
  let framing = 1;

  function computeDesired(botState, dt) {
    smoothedYaw = dampAngle(smoothedYaw, yawOfQuaternion(botState.quaternion), 3.2, dt);
    // Behind the bot along the damped yaw (forward is -Z at yaw 0).
    const backX = Math.sin(smoothedYaw);
    const backZ = Math.cos(smoothedYaw);
    const back = 6.4 * framing;
    desiredTarget.set(botState.position.x, botState.position.y + 0.42 * framing, botState.position.z);
    desiredPosition.set(
      desiredTarget.x + backX * back,
      // Rising with distance keeps the same look-down angle, so a big bot is
      // framed rather than just further away and flatter.
      desiredTarget.y + 2.8 * framing,
      desiredTarget.z + backZ * back,
    );
  }

  return {
    /**
     * @param {number} radius bounding radius of the bot, in feet, MEASURED off
     * the loaded model rather than the catalog — the catalog's bodyDims are the
     * shell, and a bot's silhouette is mostly weapon (Mammoth's disc sits on a
     * truss well outside its chassis).
     */
    setSubjectRadius(radius) {
      framing = Math.min(2.6, Math.max(1, (radius || 0) / REFERENCE_BOT_RADIUS));
    },
    update(dt, botState) {
      if (!botState) return;
      computeDesired(botState, dt);
      const blend = 1 - Math.exp(-9 * dt);
      position.lerp(desiredPosition, blend);
      target.lerp(desiredTarget, blend);
      camera.position.copy(position);
      camera.lookAt(target);
    },
    snapTo(botState) {
      if (!botState) return;
      smoothedYaw = yawOfQuaternion(botState.quaternion);
      computeDesired(botState, 1000);
      position.copy(desiredPosition);
      target.copy(desiredTarget);
      camera.position.copy(position);
      camera.lookAt(target);
    },
  };
}
