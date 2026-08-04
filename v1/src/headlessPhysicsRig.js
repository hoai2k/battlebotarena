import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { BOT_CONFIG } from "./botConfig.js";
import { MODEL_PART_CONFIG } from "./modelPartConfig.js";
import { createPhysics } from "./physics.js";
import {
  isArmWeaponEngaged,
  isNewArmWeapon,
  resolveWeaponControls,
  updateArmWeaponState,
  updateWeaponMechanisms,
} from "./armWeapons.js";

export const HEADLESS_FIXED_DT = 1 / 60;
export const HEADLESS_FLOOR_Y = 0;
export const HEADLESS_CEILING_HEIGHT = 9.45;
const HEADLESS_SPAWN_CLEARANCE = 0;
const HEADLESS_FLOOR_HALF_HEIGHT = 0.05;
const HEADLESS_GRAVITY_Y = -32.174;
const ARENA_HALF_WIDTH = 120;
const ARENA_HALF_LENGTH = 120;
// The arena's real ceiling (src/arenaConfig.js). The rig used to sit at 6.3,
// which is under Mammoth's blade tip at 6.33 — the tallest machine on the
// roster was pinned to the roof before it could take a step.
const ARENA_CEILING_HEIGHT = HEADLESS_CEILING_HEIGHT;
const BRONCO_SELF_RIGHT_COOLDOWN_SECONDS = 0.42;
const BRONCO_FLIPPER_LIFT_IMPULSE = 12.8;
const BRONCO_FLIPPER_ROLL_TORQUE = 15.2;
const BRONCO_FLIPPER_FORWARD_IMPULSE = 1.6;
const IMPULSE_WEAPON_STROKE_SECONDS = 0.38;
const IMPULSE_WEAPON_IMPACT_DELAY_SECONDS = 0.07;

const bots = Object.entries(BOT_CONFIG).map(([id, config]) => ({ id, ...config }));

function clonePart(part) {
  return {
    ...part,
    type: part.type || "box",
    part: part.part || "body",
    position: [...(part.position || [0, 0, 0])],
    halfExtents: [...(part.halfExtents || [0.4, 0.15, 0.4])],
    rotation: [...(part.rotation || [0, 0, 0])],
  };
}

function botParts(id) {
  const config = MODEL_PART_CONFIG[id] || {};
  const configuredParts = config.collider?.parts || config.colliders || [];
  if (configuredParts.length) return configuredParts.map(clonePart);
  const fit = config.fit || {};
  const scale = fit.scale || 1;
  const width = Math.max(0.4, (fit.width || 3) * scale);
  const height = Math.max(0.18, (fit.height || 1.2) * scale);
  const depth = Math.max(0.4, (fit.depth || 2.5) * scale);
  const minY = 0;
  const center = { x: 0, z: 0 };
  const bodyBottom = minY + height * 0.09;
  const bodyHeight = height * 0.42;
  const parts = [];
  if (id !== "huge" && id !== "tombstone") {
    parts.push({
      type: "wedge",
      part: config.weapon?.type === "flipper" ? "weapon" : "body",
      position: [center.x, minY + height * 0.115, -depth * 0.34],
      halfExtents: [width * 0.39, height * 0.115, depth * 0.16],
      density: 4,
    });
  }
  parts.push({
    type: "box",
    part: "body",
    position: [center.x, bodyBottom + bodyHeight * 0.5, depth * 0.04],
    halfExtents: [width * 0.36, bodyHeight * 0.5, depth * 0.29],
    density: 4,
  });
  if (depth > width * 0.72) {
    parts.push({
      type: "box",
      part: "body",
      position: [center.x, bodyBottom + bodyHeight * 0.56, depth * 0.3],
      halfExtents: [width * 0.33, bodyHeight * 0.44, depth * 0.16],
      density: 3.6,
    });
  }
  if (config.weapon?.regions?.[0]) {
    const region = config.weapon.regions[0];
    const xMin = (-width * 0.5) + width * region.x[0];
    const xMax = (-width * 0.5) + width * region.x[1];
    const yMin = minY + height * region.y[0];
    const yMax = minY + height * region.y[1];
    const zMin = (-depth * 0.5) + depth * region.z[0];
    const zMax = (-depth * 0.5) + depth * region.z[1];
    parts.push({
      type: config.weapon.type === "bar" || config.weapon.type === "drum" ? "cylinder" : "box",
      part: "weapon",
      position: [(xMin + xMax) * 0.5, (yMin + yMax) * 0.5, (zMin + zMax) * 0.5],
      halfExtents: [(xMax - xMin) * 0.5, (yMax - yMin) * 0.5, (zMax - zMin) * 0.5],
      rotation: config.weapon.type === "bar" || config.weapon.type === "drum" ? [0, 0, Math.PI / 2] : [0, 0, 0],
      density: 3.2,
    });
  }
  const wheelWidth = THREE.MathUtils.clamp(width * 0.065, 0.06, 0.18);
  const wheelRadius = THREE.MathUtils.clamp(Math.min(height * 0.34, depth * 0.14), 0.08, 0.42);
  const sideX = Math.max(0, width * 0.5 - wheelWidth * 0.55);
  const sideY = minY + Math.min(height * 0.42, wheelRadius);
  const wheelZ = Math.max(0.18, depth * 0.24);
  const cylinder = (side, z) => ({
    side,
    type: "cylinder",
    part: "driveContact",
    position: [(side === "left" ? -sideX : sideX), sideY, z],
    halfExtents: [wheelWidth, wheelRadius, wheelRadius],
    rotation: [0, 0, Math.PI / 2],
    density: 1.7,
    friction: 0.92,
    restitution: 0,
  });
  const sideBox = (side, zCenter = 0, zHalf = depth * 0.28) => {
    const yHalf = Math.max(0.08, height * 0.24);
    return {
      side,
      type: "box",
      part: "driveContact",
      position: [(side === "left" ? -sideX : sideX), minY + yHalf, zCenter],
      halfExtents: [wheelWidth * 1.1, yHalf, Math.max(0.08, zHalf)],
      density: 1.7,
      friction: 0.92,
      restitution: 0,
    };
  };
  if (id === "huge") {
    const hugeRadius = Math.max(0.16, Math.min(height, depth) * 0.42);
    parts.push(
      {
        ...cylinder("left", 0),
        position: [-sideX, minY + hugeRadius, 0],
        halfExtents: [Math.max(wheelWidth, width * 0.055), hugeRadius, hugeRadius],
      },
      {
        ...cylinder("right", 0),
        position: [sideX, minY + hugeRadius, 0],
        halfExtents: [Math.max(wheelWidth, width * 0.055), hugeRadius, hugeRadius],
      },
    );
  } else if (id === "biteforce" || id === "minotaur") {
    parts.push(sideBox("left"), sideBox("right"));
  } else if (id === "sawblaze" || id === "tombstone") {
    parts.push(sideBox("left", depth * 0.24, depth * 0.12), sideBox("right", depth * 0.24, depth * 0.12));
  } else {
    parts.push(cylinder("left", -wheelZ), cylinder("left", wheelZ), cylinder("right", -wheelZ), cylinder("right", wheelZ));
  }
  return parts.map(clonePart);
}

function colliderPartsMinY(parts, visualScale = 1) {
  // Drive contacts are traction probes only, and upright weapon bottoms that
  // ignore floor contact should not define the chassis rest height.
  const groundingParts = parts.filter((part) => (
    part.part !== "driveContact" &&
    !part.ignoreGroundContact &&
    !(part.part === "weapon" && part.ignoreLocalBottomFloorContact)
  ));
  const bounds = colliderPartsBounds(groundingParts.length ? groundingParts : parts, visualScale);
  return Number.isFinite(bounds.min.y) ? bounds.min.y : Infinity;
}

function createBotFrame({ id, parts, visualScale = 1, floorY = HEADLESS_FLOOR_Y, spawnClearance = HEADLESS_SPAWN_CLEARANCE } = {}) {
  const frameParts = parts || botParts(id);
  const colliderMinY = colliderPartsMinY(frameParts, visualScale);
  const groundedBodyY = Number.isFinite(colliderMinY) ? floorY + spawnClearance - colliderMinY : 0.55;
  return {
    id,
    parts: frameParts,
    visualScale,
    floorY,
    spawnClearance,
    colliderMinY,
    groundedBodyY,
    tractionBounds: colliderPartsBounds(frameParts, visualScale),
  };
}

function setFighterBodyPose(fighter, position, rotation, linvel = null, angvel = null) {
  fighter.rb.setTranslation(position, true);
  if (rotation) fighter.rb.setRotation(rotation, true);
  if (linvel) fighter.rb.setLinvel(linvel, true);
  if (angvel) fighter.rb.setAngvel(angvel, true);
}

function colliderSamplePoints(part, half) {
  if (part.type === "cylinder") {
    const radius = Math.max(Math.abs(half[1]), Math.abs(half[2]));
    const halfHeight = Math.abs(half[0]);
    return [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [
      radius * x,
      halfHeight * y,
      radius * z,
    ])));
  }
  return [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [
    half[0] * x,
    half[1] * y,
    half[2] * z,
  ])));
}

function colliderPartsBounds(parts, visualScale = 1) {
  const bounds = {
    min: new THREE.Vector3(Infinity, Infinity, Infinity),
    max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
  };
  parts.forEach((part) => {
    const half = (part.halfExtents || [0.4, 0.15, 0.4]).map((value) => value * visualScale);
    const position = new THREE.Vector3(...(part.position || [0, 0, 0])).multiplyScalar(visualScale);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0])));
    colliderSamplePoints(part, half).forEach((point) => {
      const corner = new THREE.Vector3(...point).applyQuaternion(rotation).add(position);
      bounds.min.min(corner);
      bounds.max.max(corner);
    });
  });
  return bounds;
}

function wedgeVertices(halfExtents) {
  const [hx, hy, hz] = halfExtents;
  return [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [-hx, hy, hz],
    [hx, hy, hz],
  ];
}

function colliderRotation(x = 0, y = 0, z = 0) {
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  return { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
}

function completeDriveInput(input = {}) {
  const clamp = (value) => THREE.MathUtils.clamp(value || 0, -1, 1);
  const tank = input.leftDrive !== undefined || input.rightDrive !== undefined
    ? input
    : { leftDrive: clamp((input.throttle || 0) + (input.turn || 0)), rightDrive: clamp((input.throttle || 0) - (input.turn || 0)) };
  const leftDrive = clamp(tank.leftDrive);
  const rightDrive = clamp(tank.rightDrive);
  return {
    ...input,
    leftDrive,
    rightDrive,
    throttle: (leftDrive + rightDrive) * 0.5,
    turn: (leftDrive - rightDrive) * 0.5,
    weapon: Boolean(input.weapon),
    boostActive: Boolean(input.boostActive),
    brakeActive: Boolean(input.brakeActive),
  };
}

function rigidBodyMass(rb, fallback = 1) {
  const mass = rb?.mass?.();
  return Number.isFinite(mass) && mass > 0 ? mass : fallback;
}

function fighterUpVector(fighter) {
  const q = fighter?.rb?.rotation?.();
  if (!q) return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
}

function isFighterInverted(fighter) {
  return fighterUpVector(fighter).y < -0.35;
}

// Lowest world point of a fighter's colliders. `filter` narrows it to one kind
// of part — a floor-strike probe cares where the WEAPON is, and on a machine
// whose bodywork hangs lower than its blade the two answers differ by a foot.
function fighterColliderWorldMinY(fighter, filter = null) {
  const parts = (fighter.physics?.parts || botParts(fighter.spec.id)).filter((part) => !filter || filter(part));
  const visualScale = fighter.visualScale || 1;
  const p = fighter.rb.translation();
  const q = fighter.rb.rotation();
  const origin = new THREE.Vector3(p.x, p.y, p.z);
  const bodyRotation = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  const ignoreUprightWeapons = (
    (fighter.weapon?.type === "bar" || fighter.weapon?.type === "drum") &&
    fighterUpVector(fighter).y > 0.58
  );
  let minY = Infinity;
  parts.forEach((part) => {
    if (part.part === "driveContact" || part.ignoreGroundContact || (ignoreUprightWeapons && part.part === "weapon")) return;
    const half = (part.halfExtents || [0.4, 0.15, 0.4]).map((value) => value * visualScale);
    const position = new THREE.Vector3(...(part.position || [0, 0, 0])).multiplyScalar(visualScale);
    const localRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0])));
    colliderSamplePoints(part, half).forEach(([x, y, z]) => {
      const world = new THREE.Vector3(x, y, z).applyQuaternion(localRotation).add(position).applyQuaternion(bodyRotation).add(origin);
      minY = Math.min(minY, world.y);
    });
  });
  return minY;
}

function correctFighterAboveFloor(fighter, margin = 0.035) {
  const minY = fighterColliderWorldMinY(fighter);
  if (!Number.isFinite(minY)) return 0;
  const lift = HEADLESS_FLOOR_Y + margin - minY;
  if (lift <= 0) return 0;
  const p = fighter.rb.translation();
  fighter.rb.setTranslation({ x: p.x, y: p.y + lift, z: p.z }, true);
  const velocity = fighter.rb.linvel();
  if (velocity.y < 0) fighter.rb.setLinvel({ x: velocity.x, y: 0, z: velocity.z }, true);
  return lift;
}

function captureFighterMotion(fighter) {
  const lin = fighter.rb.linvel();
  const ang = fighter.rb.angvel();
  return {
    lin: { x: lin.x, y: lin.y, z: lin.z },
    ang: { x: ang.x, y: ang.y, z: ang.z },
  };
}

function createWeapon(spec) {
  const config = MODEL_PART_CONFIG[spec.id]?.weapon || {};
  if (spec.id === "bronco") {
    return {
      type: "flipper",
      speed: 18,
      activeSpeed: 18,
      baseRotation: -0.34,
      activeRotation: 0,
      returnSeconds: spec.weaponReturnSeconds,
      currentSpeed: 0,
      hitCooldowns: new Map(),
    };
  }
  if (spec.id === "quantum") {
    return {
      type: "crusher",
      speed: 9,
      activeSpeed: 9,
      baseRotation: 0,
      activeRotation: -1.05,
      currentSpeed: 0,
      hitCooldowns: new Map(),
    };
  }
  // Ported arms (hammer, saw arm, lifter, grappler) run the same state machine
  // headless that they do on screen — no visuals, but the same stroke, the same
  // rotor spin-up and therefore the same hits.
  if (ARM_CONFIG_TYPES.has(config.type)) {
    const sign = config.axisSign || 1;
    return {
      type: config.type,
      arm: config,
      aux: MODEL_PART_CONFIG[spec.id]?.aux || null,
      spinAxis: "x",
      baseRotation: sign * (config.restAngle || 0),
      activeRotation: sign * (config.fireAngle || 0),
      returnSeconds: config.returnSeconds ?? spec.weaponReturnSeconds,
      strokeSeconds: config.strokeSeconds,
      stroke: 0,
      strokeDelta: 0,
      subs: config.sub ? [{ name: "sub", currentSpeed: 0, ...config.sub }] : [],
      claw: config.claw ? { ...config.claw } : null,
      clawAmount: 0,
      currentSpeed: 0,
      hitCooldowns: new Map(),
    };
  }
  if (config.type) {
    return {
      type: config.type,
      arm: config,
      aux: MODEL_PART_CONFIG[spec.id]?.aux || null,
      spinAxis: config.spinAxis || "x",
      radius: config.radius || 0,
      visualSpeed: config.visualSpeed || config.activeSpeed || 120,
      speed: config.visualSpeed || config.activeSpeed || 120,
      idleSpeed: 0,
      spinUpSeconds: spec.weaponSpinUpSeconds || 2,
      spinDownSeconds: spec.id === "huge" ? 0.8 : 1,
      currentSpeed: 0,
      lastSpeedDelta: 0,
      hitCooldowns: new Map(),
    };
  }
  return null;
}

function updateWeapon(fighter, dt, active, input = {}, now = 0) {
  const weapon = fighter?.weapon;
  if (!weapon) return;
  // The second channel is read literally rather than defaulting to the trigger:
  // a two-way arm spends it driving the arm back DOWN, so "secondary follows
  // weapon" would hold Duck's plow perfectly still and look like a dead
  // mechanism.
  const channels = resolveWeaponControls(weapon, input);
  const secondary = channels.secondary;
  updateWeaponMechanisms(weapon, dt, {
    weapon: Boolean(active),
    secondary,
    aux: channels.aux,
    lift: channels.lift,
    now,
  });
  if (isNewArmWeapon(weapon)) {
    updateArmWeaponState(weapon, dt, {
      active,
      secondary,
      strokeActive: Boolean(weapon.headlessStrokeActive),
    });
    weapon.lastSpeedDelta = 0;
    return;
  }
  if (weapon.type === "bar" || weapon.type === "drum") {
    const visualSpeed = weapon.visualSpeed || weapon.activeSpeed || weapon.speed || 0;
    // A rotor jammed by a blow from directly above cannot pull against it.
    const targetSpeed = active && !weapon.stalled ? visualSpeed : weapon.idleSpeed || 0;
    const currentSpeed = Number.isFinite(weapon.currentSpeed) ? weapon.currentSpeed : 0;
    const seconds = active && !weapon.stalled ? weapon.spinUpSeconds : weapon.spinDownSeconds;
    const rate = seconds ? Math.max(1, Math.abs(visualSpeed || weapon.speed || 1)) / seconds : Infinity;
    const nextSpeed = Number.isFinite(rate)
      ? THREE.MathUtils.clamp(currentSpeed + Math.sign(targetSpeed - currentSpeed) * rate * dt, Math.min(currentSpeed, targetSpeed), Math.max(currentSpeed, targetSpeed))
      : targetSpeed;
    weapon.lastSpeedDelta = nextSpeed - currentSpeed;
    weapon.currentSpeed = nextSpeed;
  } else {
    weapon.lastSpeedDelta = 0;
  }
}

const ARM_CONFIG_TYPES = new Set(["hammer", "hammerSaw", "lifter", "lifterDisc", "grappler", "sawArms"]);

function isImpulseWeapon(weapon) {
  return weapon?.type === "flipper" || weapon?.type === "meshFlipper" || weapon?.type === "crusher"
    || weapon?.type === "hammer";
}

function consumeWeaponPressEdge(sim, fighter, inputActive) {
  const weapon = fighter?.weapon;
  if (!weapon) return Boolean(inputActive);
  const pressed = Boolean(inputActive);
  const returning = isImpulseWeapon(weapon) && sim.time < (weapon.impulseReturnUntil || 0);
  const edge = pressed && !weapon.impulseInputWasActive && !returning;
  if (edge && isImpulseWeapon(weapon)) {
    weapon.impulseStrokeStartedAt = sim.time;
    weapon.impulseStrokeUntil = sim.time + IMPULSE_WEAPON_STROKE_SECONDS;
    const returnSeconds = Number.isFinite(weapon.returnSeconds) ? Math.max(0, weapon.returnSeconds) : 0;
    weapon.impulseReturnUntil = weapon.impulseStrokeUntil + returnSeconds;
    weapon.impulseStrokeHits = new Set();
    weapon.hitCooldowns?.clear?.();
  }
  weapon.impulseInputWasActive = pressed;
  return edge;
}

function isWeaponImpulseStrokeActive(sim, fighter, minElapsed = 0) {
  const weapon = fighter?.weapon;
  return Boolean(
    isImpulseWeapon(weapon) &&
    sim.time < (weapon.impulseStrokeUntil || 0) &&
    sim.time - (weapon.impulseStrokeStartedAt || 0) >= minElapsed
  );
}

function isWeaponImpactActive(sim, fighter, inputActive) {
  const weapon = fighter?.weapon;
  if (!weapon) return inputActive;
  if (isNewArmWeapon(weapon)) {
    return isArmWeaponEngaged(weapon, {
      strokeActive: isWeaponImpulseStrokeActive(sim, fighter, IMPULSE_WEAPON_IMPACT_DELAY_SECONDS),
    });
  }
  if (weapon.type === "bar" || weapon.type === "drum") {
    const currentSpeed = Number.isFinite(weapon.currentSpeed) ? Math.abs(weapon.currentSpeed) : 0;
    return currentSpeed > Math.max(2, (weapon.visualSpeed || weapon.activeSpeed || weapon.speed || 1) * 0.08);
  }
  return isImpulseWeapon(weapon) ? isWeaponImpulseStrokeActive(sim, fighter, IMPULSE_WEAPON_IMPACT_DELAY_SECONDS) : inputActive;
}

function applyBroncoSelfRighting(sim, fighter, active) {
  if (!active || fighter?.spec?.id !== "bronco" || !fighter?.rb) return;
  if (!isFighterInverted(fighter)) return;
  if (sim.time - (fighter.lastSelfRightAt || 0) < BRONCO_SELF_RIGHT_COOLDOWN_SECONDS) return;
  fighter.lastSelfRightAt = sim.time;
  fighter.selfRightingUntil = sim.time + 2.4;
  correctFighterAboveFloor(fighter, 0.08);
  const q = fighter.rb.rotation();
  const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w), "YXZ").y;
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const velocity = fighter.rb.linvel();
  const mass = THREE.MathUtils.clamp(rigidBodyMass(fighter.rb), 1, 800);
  const upwardCorrection = Math.max(0, 3.4 - velocity.y);
  if (upwardCorrection > 0) fighter.rb.applyImpulse({ x: 0, y: upwardCorrection * mass, z: 0 }, true);
  fighter.rb.applyImpulse({
    x: -forward.x * BRONCO_FLIPPER_FORWARD_IMPULSE * mass * 0.22,
    y: BRONCO_FLIPPER_LIFT_IMPULSE * mass * 0.28,
    z: -forward.z * BRONCO_FLIPPER_FORWARD_IMPULSE * mass * 0.22,
  }, true);
  fighter.rb.applyTorqueImpulse({
    x: right.x * BRONCO_FLIPPER_ROLL_TORQUE * mass * 0.72,
    y: 0.4 * mass * 0.12,
    z: right.z * BRONCO_FLIPPER_ROLL_TORQUE * mass * 0.72,
  }, true);
}

function stabilizeSelfRightingFighter(sim, fighter) {
  if (fighter?.spec?.id !== "bronco" || !fighter.selfRightingUntil) return;
  if (sim.time > fighter.selfRightingUntil) {
    fighter.selfRightingUntil = 0;
    return;
  }
  correctFighterAboveFloor(fighter, 0.1);
  const upY = fighterUpVector(fighter).y;
  if (upY > 0.15 && upY < 0.78) {
    const q = fighter.rb.rotation();
    const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w), "YXZ").y;
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const mass = THREE.MathUtils.clamp(rigidBodyMass(fighter.rb), 1, 800);
    fighter.rb.applyImpulse({ x: 0, y: 0.018 * mass, z: 0 }, true);
    fighter.rb.applyTorqueImpulse({ x: right.x * 0.052 * mass, y: 0, z: right.z * 0.052 * mass }, true);
  }
  if (upY > 0.35) {
    const velocity = fighter.rb.linvel();
    const angular = fighter.rb.angvel();
    const settle = THREE.MathUtils.clamp((upY - 0.35) / 0.45, 0, 1);
    fighter.rb.setLinvel({ x: velocity.x * (1 - settle * 0.08), y: velocity.y, z: velocity.z * (1 - settle * 0.08) }, true);
    fighter.rb.setAngvel({ x: angular.x * (1 - settle * 0.18), y: angular.y * (1 - settle * 0.08), z: angular.z * (1 - settle * 0.18) }, true);
    if (upY > 0.48) {
      const q = fighter.rb.rotation();
      const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w), "YXZ").y;
      const upright = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
      fighter.rb.setRotation({ x: upright.x, y: upright.y, z: upright.z, w: upright.w }, true);
      fighter.rb.setLinvel({ x: velocity.x * 0.35, y: 0, z: velocity.z * 0.35 }, true);
      fighter.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      correctFighterAboveFloor(fighter, 0.08);
      fighter.selfRightingUntil = 0;
    }
  }
}

// The rig has no renderer, but physics.js measures reach FROM THE WEAPON — a
// spinner's hit zone, a wall strike and every ported arm all start at the
// weapon's world position. Without an object it falls back to a point 0.7ft in
// front of the chassis, which is nowhere near the end of Tombstone's bar or
// Sawblaze's arm. A bare pair of Object3Ds, synced from the rigid body each
// step, puts the measurement back where the game takes it.
//
// Only the ported entries carry an ABSOLUTE pivot; v1's own configs store a
// fractional one that means nothing without the fitted model, so those bots
// keep the old fallback and their behaviour is untouched.
function attachHeadlessWeaponObject(weapon, botId) {
  const config = MODEL_PART_CONFIG[botId];
  const pivot = config?.segmented ? config.weapon?.pivot : null;
  if (!weapon || !pivot) return weapon;
  const body = new THREE.Object3D();
  const object = new THREE.Object3D();
  object.position.set(pivot.x || 0, pivot.y || 0, pivot.z || 0);
  body.add(object);
  weapon.bodyObject = body;
  weapon.object = object;
  return weapon;
}

function syncHeadlessWeaponObject(fighter) {
  const body = fighter?.weapon?.bodyObject;
  if (!body) return;
  const translation = fighter.rb.translation();
  const rotation = fighter.rb.rotation();
  body.position.set(translation.x, translation.y, translation.z);
  body.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  body.updateMatrixWorld(true);
}

function createFighter(sim, botId, index) {
  const spec = bots.find((bot) => bot.id === botId);
  if (!spec) throw new Error(`Unknown bot id: ${botId}`);
  const visualScale = botId === "huge" ? 0.9 : 1;
  const parts = botParts(botId);
  const frame = createBotFrame({ id: botId, parts, visualScale });
  const spawnBodyY = frame.groundedBodyY;
  const spawn = index === 0 ? { x: 0, z: ARENA_HALF_LENGTH - 2.25, yaw: 0 } : { x: 0, z: -ARENA_HALF_LENGTH + 2.25, yaw: Math.PI };
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spawn.yaw, 0));
  const rb = sim.world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawnBodyY, spawn.z)
      .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w })
      .setLinearDamping(0.24)
      .setAngularDamping(0.045)
      .setCcdEnabled(true)
      .setCanSleep(false),
  );
  const result = sim.physics.addBotColliders({
    world: sim.world,
    rb,
    id: botId,
    parts,
    visualScale,
    group: null,
    helpers: {
      wedgeVertices,
      colliderRotation,
      colliderRelativeToWeapon: () => null,
    },
  });
  rb.userData = { weightLbs: spec.weightLbs || 250, physicsParts: result.parts, physicsColliderBindings: result.colliderBindings || [] };
  const weapon = createWeapon(spec);
  attachHeadlessWeaponObject(weapon, botId);
  const fighter = {
    spec,
    rb,
    weightLbs: spec.weightLbs || 250,
    weapon,
    weaponColliderBindings: [],
    frame,
    visualScale,
    colliderMinY: frame.colliderMinY,
    tractionBounds: frame.tractionBounds,
    restingBodyY: spawnBodyY,
  };
  sim.physics.initializeFighter(fighter, result.parts, { floorY: HEADLESS_FLOOR_Y });
  return fighter;
}

function addArenaBounds(sim) {
  const ground = sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, HEADLESS_FLOOR_Y - HEADLESS_FLOOR_HALF_HEIGHT, 0));
  sim.world.createCollider(RAPIER.ColliderDesc.cuboid(ARENA_HALF_WIDTH, HEADLESS_FLOOR_HALF_HEIGHT, ARENA_HALF_LENGTH).setFriction(1.4), ground);
  const makeWall = (x, z, sx, sz) => {
    const body = sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, ARENA_CEILING_HEIGHT / 2, z));
    sim.world.createCollider(RAPIER.ColliderDesc.cuboid(sx, ARENA_CEILING_HEIGHT / 2, sz).setFriction(1.1).setRestitution(0.05), body);
  };
  makeWall(0, -ARENA_HALF_LENGTH, ARENA_HALF_WIDTH + 0.1, 0.1);
  makeWall(0, ARENA_HALF_LENGTH, ARENA_HALF_WIDTH + 0.1, 0.1);
  makeWall(-ARENA_HALF_WIDTH, 0, 0.1, ARENA_HALF_LENGTH + 0.1);
  makeWall(ARENA_HALF_WIDTH, 0, 0.1, ARENA_HALF_LENGTH + 0.1);
  const ceiling = sim.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, ARENA_CEILING_HEIGHT, 0));
  sim.world.createCollider(RAPIER.ColliderDesc.cuboid(ARENA_HALF_WIDTH, 0.12, ARENA_HALF_LENGTH).setFriction(0.8).setRestitution(0.05), ceiling);
}

export async function createHeadlessPhysicsSim({
  playerId = "biteforce",
  rivalId = "minotaur",
} = {}) {
  await RAPIER.init();
  const sim = {
    time: 100,
    dt: HEADLESS_FIXED_DT,
    world: new RAPIER.World({ x: 0, y: HEADLESS_GRAVITY_Y, z: 0 }),
    fighters: [],
    props: [],
    inputs: [completeDriveInput(), completeDriveInput()],
    physics: null,
  };
  sim.physics = createPhysics({ THREE, RAPIER, now: () => sim.time });
  sim.physics.setOptions({ arenaHalfWidth: ARENA_HALF_WIDTH, arenaHalfLength: ARENA_HALF_LENGTH, arenaCeilingHeight: ARENA_CEILING_HEIGHT });
  sim.world.integrationParameters.dt = sim.dt;
  sim.physics.configureWorld(sim.world);
  addArenaBounds(sim);
  sim.fighters = [createFighter(sim, playerId, 0), createFighter(sim, rivalId, 1)];
  return Object.assign(sim, {
    completeDriveInput,
    setInput(index, input = {}) {
      this.inputs[index] = completeDriveInput(input);
    },
    setPose(indexOrFighter, position, yaw = 0, linvel = { x: 0, y: 0, z: 0 }, angvel = { x: 0, y: 0, z: 0 }) {
      const fighter = typeof indexOrFighter === "number" ? this.fighters[indexOrFighter] : indexOrFighter;
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
      setFighterBodyPose(fighter, position, { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, linvel, angvel);
      syncHeadlessWeaponObject(fighter);
      if (fighter.physics) {
        fighter.physics.wedgeUntil = 0;
        fighter.physics.wedgeTractionPenalty = 0;
      }
    },
    setRotation(indexOrFighter, quaternion, linvel = { x: 0, y: 0, z: 0 }, angvel = { x: 0, y: 0, z: 0 }) {
      const fighter = typeof indexOrFighter === "number" ? this.fighters[indexOrFighter] : indexOrFighter;
      fighter.rb.setRotation({ x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w }, true);
      fighter.rb.setLinvel(linvel, true);
      fighter.rb.setAngvel(angvel, true);
      syncHeadlessWeaponObject(fighter);
    },
    syncWeaponObjects() {
      this.fighters.forEach((fighter) => syncHeadlessWeaponObject(fighter));
    },
    stepFrame() {
      const [player, rival] = this.fighters;
      const [playerInput, rivalInput] = this.inputs;
      this.physics.updateWedgeStates(this, this.dt);
      this.fighters.forEach((fighter, index) => this.physics.driveFighter(fighter, this.inputs[index], this.dt));
      this.fighters.forEach((fighter, index) => {
        const input = this.inputs[index];
        const pressed = consumeWeaponPressEdge(this, fighter, input.weapon);
        if (fighter.weapon) {
          fighter.weapon.headlessStrokeActive = isWeaponImpulseStrokeActive(this, fighter);
        }
        updateWeapon(fighter, this.dt, input.weapon, input, this.time);
        this.physics.applyWeaponMechanics(fighter, input, this.dt, this.weaponImpactCallbacks || {});
        this.physics.applySpinnerGyro(fighter, input, this.dt);
        applyBroncoSelfRighting(this, fighter, pressed);
        stabilizeSelfRightingFighter(this, fighter);
      });
      this.fighters.forEach((fighter) => syncHeadlessWeaponObject(fighter));
      const active = this.fighters.map((fighter, index) => isWeaponImpactActive(this, fighter, this.inputs[index].weapon));
      const preStepMotion = new Map(this.fighters.map((fighter) => [fighter, captureFighterMotion(fighter)]));
      this.fighters.forEach((fighter, index) => {
        // Tests can watch what the weapon pipeline reports (damage, weapon
        // events) by setting sim.weaponImpactCallbacks — the same callback bag
        // main.js passes in the game.
        this.physics.applyWeaponImpacts({
          arena: this,
          attacker: fighter,
          active: active[index],
          dt: this.dt,
          callbacks: this.weaponImpactCallbacks || {},
        });
        // Fire, punch arms and grips are on their own channels and are not
        // gated on the primary weapon being engaged.
        this.physics.applyWeaponMechanismImpacts({
          arena: this,
          attacker: fighter,
          dt: this.dt,
          callbacks: this.weaponImpactCallbacks || {},
        });
      });
      this.world.integrationParameters.dt = this.dt;
      this.world.step();
      stabilizeSelfRightingFighter(this, player);
      stabilizeSelfRightingFighter(this, rival);
      this.physics.afterStep({ arena: this, fighters: this.fighters, inputs: this.inputs, preStepMotion, dt: this.dt });
      this.time += this.dt;
    },
    stepFrames(frames, onFrame = null) {
      for (let frame = 0; frame < frames; frame += 1) {
        this.stepFrame();
        onFrame?.(frame);
      }
    },
    snapshot(label = "") {
      return {
        label,
        time: this.time,
        fighters: this.fighters.map((fighter) => {
          const p = fighter.rb.translation();
          const r = fighter.rb.rotation();
          const linvel = fighter.rb.linvel();
          const angvel = fighter.rb.angvel();
          return {
            id: fighter.spec.id,
            position: { x: p.x, y: p.y, z: p.z },
            rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
            linvel: { x: linvel.x, y: linvel.y, z: linvel.z },
            angvel: { x: angvel.x, y: angvel.y, z: angvel.z },
            upY: fighterUpVector(fighter).y,
            traction: this.physics.tractionForFighter(fighter),
            physics: fighter.physics ? {
              lastDrive: fighter.physics.lastDrive || null,
              lastStep: fighter.physics.lastStep || null,
            } : null,
          };
        }),
      };
    },
    dispose() {
      this.world.free?.();
    },
  });
}

export function setPhysicsCornerTeeterPose(sim, fighter, {
  yawDeg = 25,
  pitchDeg = 25,
  rollDeg = -25,
  heightOffset = 0,
  position = { x: 0, z: 0 },
  linvel = { x: 0, y: 0, z: 0 },
  angvel = { x: 0, y: 0, z: 0 },
} = {}) {
  const bounds = colliderPartsBounds(fighter.physics?.parts || botParts(fighter.spec.id), fighter.visualScale || 1);
  const corner = new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z);
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(pitchDeg),
    THREE.MathUtils.degToRad(yawDeg),
    THREE.MathUtils.degToRad(rollDeg),
    "YXZ",
  ));
  const rotatedCorner = corner.clone().applyQuaternion(rotation);
  const bodyPosition = new THREE.Vector3(position.x, HEADLESS_FLOOR_Y + heightOffset, position.z).sub(rotatedCorner);
  fighter.rb.setTranslation({ x: bodyPosition.x, y: bodyPosition.y, z: bodyPosition.z }, true);
  fighter.rb.setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, true);
  correctFighterAboveFloor(fighter, heightOffset);
  fighter.rb.setLinvel(linvel, true);
  fighter.rb.setAngvel(angvel, true);
}

export const headlessTestUtils = {
  THREE,
  bots,
  completeDriveInput,
  correctFighterAboveFloor,
  fighterColliderWorldMinY,
  fighterUpVector,
  isFighterInverted,
};
