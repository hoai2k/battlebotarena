import { FEET_PER_SECOND_PER_MPH, botGroundSpeedFeetPerSecond } from "./botConfig.js";
import { armHitProfile, armWeaponReach, isArmWeaponEngaged, isNewArmWeapon } from "./armWeapons.js";

const DEFAULTS = {
  floorY: 0,
  fixedDt: 1 / 60,
  maxSpeed: 5.4,
  turnRate: 3.8,
};

const BOT_MATERIAL = {
  body: { density: 5.8, friction: 0.58, restitution: 0.0 },
  wedge: { density: 5.2, friction: 0.5, restitution: 0.0 },
  weapon: { density: 4.2, friction: 0.34, restitution: 0.0 },
  wheelProxy: { density: 2.2, friction: 0.82, restitution: 0.0 },
};

const DRIVE_UPRIGHT_Y = 0.58;
const SETTLED_UPRIGHT_Y = 0.985;
const SOLID_GROUND_THRESHOLD = 0.26;
const SETTLED_SOLID_GROUND_THRESHOLD = 0.82;
const EDGE_GROUND_THRESHOLD = 0.12;
const GROUNDED_STABLE_SECONDS = 0.14;
const NEAR_UPRIGHT_SETTLE_Y = 0.99;
const NEAR_UPRIGHT_SETTLE_MAX_Y = 0.99995;
const SPINNER_EXTRA_TORQUE_SCALE = 0.26;
const FLIPPER_EXTRA_TORQUE_SCALE = 0.58;
const SPINNER_ATTACK_SENSOR_SPEED_RATIO = 0.18;
const BRAKE_ACCELERATION_MULTIPLIER = 4.2;
const BRAKE_FORWARD_TILT_ENABLED = true;
const BRAKE_FORWARD_TILT_SECONDS = 0.5;
const BRAKE_FORWARD_TILT_TORQUE = 0.012;
const BRAKE_FORWARD_TILT_FLOOR_UNDERRIDE = 0.025;
const SOFT_FLOOR_FULL_LIFT_THRESHOLD = 0.012;
const SOFT_FLOOR_MAX_LIFT_PER_STEP = 0.026;
const SOFT_FLOOR_MAX_DOWNWARD_SPEED = 0.38;
const SOFT_FLOOR_DEEP_MAX_DOWNWARD_SPEED = 0.15;
const SOFT_FLOOR_DOWNWARD_DAMPING = 0.35;
const SOFT_FLOOR_DEEP_DOWNWARD_DAMPING = 0.2;
const CEILING_HIT_EXTRA_DAMAGE_PERCENT = 5;
const CEILING_HIT_DAMAGE_COOLDOWN_SECONDS = 0.22;
const WEDGE_ASSIST_MIN_GROUNDED = 0.28;
const WEDGE_SIDE_BACK_EXPOSURE_START = 0.35;
const WEDGE_SIDE_BACK_LIFT_BONUS = 2.2;
const WEDGE_SIDE_BACK_TRACTION_BONUS = 0.28;
const WEDGE_ASSIST_MIN_FORWARD_SPEED = 0.55;
const PLOW_DEFENCE_HORIZONTAL_START_DEG = 12;
const PLOW_DEFENCE_HORIZONTAL_FULL_DEG = 48;
const PLOW_DEFENCE_VERTICAL_FULL_DEG = 10;
const PLOW_DEFENCE_VERTICAL_END_DEG = 50;
const SPINNER_FLOOR_LAUNCH_MIN_ANGLE_DEG = 30;
const ESCAPE_STUCK_SECONDS = 3;
const ESCAPE_STATIONARY_SPEED = 0.6;
const ESCAPE_DRIVE_DEMAND = 0.28;
const ESCAPE_BOOST_COOLDOWN_SECONDS = 1.25;
const ESCAPE_SOLO_CLEARANCE_LIFT = 1.15;
const ESCAPE_SOLO_UP_IMPULSE = 5.8;
const ESCAPE_PAIR_PUSH_IMPULSE = 4.8;
const ESCAPE_PAIR_UP_IMPULSE = 3.8;
const ESCAPE_PAIR_SPIN_IMPULSE = 1.6;
const ESCAPE_PAIR_RELATIVE_SPEED = 1.4;
const ESCAPE_CONTACT_SLOP = 0.28;
const ESCAPE_INTERLOCK_DIRECTION_DOT = 0.94;

const SPINNER_BIASES = {
  horizontal: { lift: 0.48, pitch: 0.35, yaw: 1.35, kickback: 0.88 },
  vertical: { lift: 1.08, pitch: 1.05, yaw: 0.55, kickback: 0.68 },
  "vertical-front": { lift: 0.92, pitch: 0.86, yaw: 0.62, kickback: 0.72 },
};

const BRONCO_FLIPPER = {
  selfRightCorrectionVelocity: 3.4,
  selfRightLiftVelocity: 7.0 * 0.16,
  selfRightForwardVelocity: 1.1 * 0.22,
  selfRightPitchVelocity: 9.4 * 0.34,
  targetCorrectionVelocity: 4.6,
  targetLiftVelocity: 3.2,
  targetForwardVelocity: 0.9,
  targetPitchVelocity: 4.8,
  propStrength: 0.55,
  hitCooldownSeconds: 0.28,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function damp(value, rate, dt, amount = 1) {
  return value * Math.exp(-Math.max(0, rate) * Math.max(0, amount) * dt);
}

function bodyMass(rb, fallback = 18) {
  const mass = rb?.mass?.();
  return Number.isFinite(mass) && mass > 0 ? mass : fallback;
}

function copyPart(part) {
  return {
    ...part,
    position: [...(part.position || [0, 0, 0])],
    halfExtents: [...(part.halfExtents || [0.4, 0.16, 0.4])],
    rotation: [...(part.rotation || [0, 0, 0])],
  };
}

function partMaterial(part) {
  if (part.part === "weapon") return BOT_MATERIAL.weapon;
  if (part.part === "driveContact") return BOT_MATERIAL.wheelProxy;
  if (part.type === "wedge") return BOT_MATERIAL.wedge;
  if (part.type === "cylinder") return BOT_MATERIAL.wheelProxy;
  return BOT_MATERIAL.body;
}

function isGroundContactPart(part, { ignoreUprightWeapons = false } = {}) {
  return part?.part !== "driveContact" && !part?.ignoreGroundContact && !(ignoreUprightWeapons && part?.part === "weapon");
}

function partVolume(part, scale = 1) {
  const half = (part.halfExtents || [0.4, 0.16, 0.4]).map((value) => Math.abs(value * scale));
  if (part.type === "cylinder") {
    const radius = Math.max(0.01, (half[1] + half[2]) * 0.5);
    return Math.PI * radius * radius * Math.max(0.01, half[0] * 2);
  }
  return Math.max(0.000001, half[0] * 2 * half[1] * 2 * half[2] * 2);
}

function cylinderColliderRadius(half) {
  return Math.max(0.01, (Math.abs(half[1]) + Math.abs(half[2])) * 0.5);
}

function colliderCenterOfMass(parts, visualScale = 1) {
  const weighted = { x: 0, y: 0, z: 0 };
  let total = 0;
  parts.forEach((part) => {
    if (part.part === "driveContact") return;
    const material = partMaterial(part);
    const density = Math.max(0.001, part.density ?? material.density);
    const volume = partVolume(part, visualScale);
    const mass = density * volume;
    const position = part.position || [0, 0, 0];
    weighted.x += (position[0] || 0) * visualScale * mass;
    weighted.y += (position[1] || 0) * visualScale * mass;
    weighted.z += (position[2] || 0) * visualScale * mass;
    total += mass;
  });
  if (total <= 0) return { x: 0, y: -0.14 * visualScale, z: 0.02 };
  return {
    x: clamp(weighted.x / total, -0.45 * visualScale, 0.45 * visualScale),
    y: clamp(weighted.y / total, -0.35 * visualScale, 0.12 * visualScale),
    z: clamp(weighted.z / total, -0.55 * visualScale, 0.55 * visualScale),
  };
}

function colliderHorizontalRadius(parts, visualScale = 1) {
  let radius = 1;
  parts.forEach((part) => {
    if (part.part === "driveContact") return;
    const position = part.position || [0, 0, 0];
    const half = part.halfExtents || [0.4, 0.16, 0.4];
    radius = Math.max(
      radius,
      Math.abs((position[0] || 0) * visualScale) + Math.abs((half[0] || 0) * visualScale),
      Math.abs((position[2] || 0) * visualScale) + Math.abs((half[2] || 0) * visualScale),
      Math.hypot((position[0] || 0) * visualScale, (position[2] || 0) * visualScale) +
        Math.hypot((half[0] || 0) * visualScale, (half[2] || 0) * visualScale) * 0.65,
    );
  });
  return radius;
}

function maybeSetCombineRules(RAPIER, desc, { frictionRule = "Max", restitutionRule = "Min" } = {}) {
  const rules = RAPIER.CoefficientCombineRule;
  if (rules?.[frictionRule] !== undefined && desc.setFrictionCombineRule) desc.setFrictionCombineRule(rules[frictionRule]);
  if (rules?.[restitutionRule] !== undefined && desc.setRestitutionCombineRule) desc.setRestitutionCombineRule(rules[restitutionRule]);
  return desc;
}

function rigidRotation(fighter, THREE) {
  const q = fighter.rb.rotation();
  return new THREE.Quaternion(q.x, q.y, q.z, q.w);
}

function yawBasis(fighter, THREE) {
  const q = rigidRotation(fighter, THREE);
  const yaw = new THREE.Euler().setFromQuaternion(q, "YXZ").y;
  return {
    yaw,
    forward: new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)),
    right: new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)),
  };
}

function upVector(fighter, THREE) {
  return new THREE.Vector3(0, 1, 0).applyQuaternion(rigidRotation(fighter, THREE));
}

function signedSpinnerDirection(fighter) {
  const weapon = fighter?.weapon;
  const current = Number.isFinite(weapon?.currentSpeed) ? weapon.currentSpeed : null;
  if (current !== null && Math.abs(current) > 0.001) return Math.sign(current);
  const configured = Number.isFinite(weapon?.visualSpeed)
    ? weapon.visualSpeed
    : Number.isFinite(weapon?.activeSpeed)
      ? weapon.activeSpeed
      : Number.isFinite(weapon?.speed)
        ? weapon.speed
        : 1;
  return Math.sign(configured || 1);
}

function spinnerHitDirection(attacker, contact, THREE) {
  const inertiaType = attacker.spec?.weaponRotationalInertiaType || "vertical-front";
  const side = new THREE.Vector3(contact.side.x, 0, contact.side.z);
  if (side.lengthSq() < 0.0001) return { direction: side.set(0, 0, -1), spinDirection: signedSpinnerDirection(attacker), tangential: false };
  side.normalize();
  const spinDirection = signedSpinnerDirection(attacker);
  if (inertiaType !== "horizontal") return { direction: side, spinDirection, tangential: false };
  const up = upVector(attacker, THREE);
  const tangent = up.cross(side).setY(0);
  if (tangent.lengthSq() < 0.0001) return { direction: side, spinDirection, tangential: false };
  tangent.normalize().multiplyScalar(spinDirection);
  const direction = tangent.multiplyScalar(0.86).addScaledVector(side, 0.14);
  if (direction.lengthSq() < 0.0001) direction.copy(side);
  direction.normalize();
  return { direction, spinDirection, tangential: true };
}

function localBodyPointToWorld(fighter, point, THREE) {
  const p = fighter.rb.translation();
  return new THREE.Vector3(point.x || 0, point.y || 0, point.z || 0)
    .applyQuaternion(rigidRotation(fighter, THREE))
    .add(new THREE.Vector3(p.x, p.y, p.z));
}

function localPointToWorld(fighter, part, corner, THREE) {
  const p = fighter.rb.translation();
  const origin = new THREE.Vector3(p.x, p.y, p.z);
  const bodyRotation = rigidRotation(fighter, THREE);
  const localRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0])));
  return new THREE.Vector3(...corner)
    .applyQuaternion(localRotation)
    .add(new THREE.Vector3(...(part.position || [0, 0, 0])).multiplyScalar(fighter.visualScale || 1))
    .applyQuaternion(bodyRotation)
    .add(origin);
}

function contactSamplesForPart(part, half) {
  const [hx, hy, hz] = half;
  if (part.type === "cylinder") {
    const radius = Math.max(Math.abs(hy), Math.abs(hz));
    const halfHeight = Math.abs(hx);
    return [
      [-radius, -halfHeight, -radius],
      [radius, -halfHeight, -radius],
      [-radius, -halfHeight, radius],
      [radius, -halfHeight, radius],
      [-radius, halfHeight, -radius],
      [radius, halfHeight, -radius],
      [-radius, halfHeight, radius],
      [radius, halfHeight, radius],
    ];
  }
  return [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [-hx, hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, hz],
    [hx, hy, hz],
  ];
}

function fighterGroundInfo(fighter, THREE, floorY) {
  const parts = fighter.physics?.parts || [];
  const scale = fighter.visualScale || 1;
  const ignoreUprightWeapons = (
    (fighter.weapon?.type === "bar" || fighter.weapon?.type === "drum") &&
    upVector(fighter, THREE).y > DRIVE_UPRIGHT_Y
  );
  let minY = Infinity;
  let point = null;
  let left = 0;
  let right = 0;
  let front = 0;
  let back = 0;
  let topLeft = 0;
  let topRight = 0;
  let topFront = 0;
  let topBack = 0;
  let leftDriveContact = 0;
  let rightDriveContact = 0;
  let topLeftDriveContact = 0;
  let topRightDriveContact = 0;
  parts.forEach((part) => {
    const half = (part.halfExtents || [0.4, 0.16, 0.4]).map((value) => value * scale);
    const samples = contactSamplesForPart(part, half);
    const contactRange = part.part === "driveContact" ? 0.08 : 0.1;
    samples.forEach((corner) => {
      const world = localPointToWorld(fighter, part, corner, THREE);
      const contact = clamp(1 - (world.y - floorY) / contactRange, 0, 1);
      if (part.part === "driveContact") {
        // Drive contacts are traction probes only. They do not contribute to
        // generic floor min, solid grounding, rest height, or physical collision
        // response. A bot hovering on these probes is always a bug.
        const side = part.side || (part.position?.[0] < 0 ? "left" : "right");
        if (side === "left") {
          leftDriveContact = Math.max(leftDriveContact, contact);
          topLeftDriveContact = Math.max(topLeftDriveContact, contact);
        } else {
          rightDriveContact = Math.max(rightDriveContact, contact);
          topRightDriveContact = Math.max(topRightDriveContact, contact);
        }
        return;
      }
      if (!isGroundContactPart(part, { ignoreUprightWeapons })) return;
      if (world.y < minY) {
        minY = world.y;
        point = world;
      }
      if (corner[1] < 0) {
        if (corner[0] < 0) left = Math.max(left, contact);
        else right = Math.max(right, contact);
        if (corner[2] < 0) front = Math.max(front, contact);
        else back = Math.max(back, contact);
      } else {
        if (corner[0] < 0) topLeft = Math.max(topLeft, contact);
        else topRight = Math.max(topRight, contact);
        if (corner[2] < 0) topFront = Math.max(topFront, contact);
        else topBack = Math.max(topBack, contact);
      }
    });
  });
  const leftTrack = left * Math.min(front, back);
  const rightTrack = right * Math.min(front, back);
  const leftEdge = left * Math.max(front, back);
  const rightEdge = right * Math.max(front, back);
  const topLeftTrack = topLeft * Math.min(topFront, topBack);
  const topRightTrack = topRight * Math.min(topFront, topBack);
  const topLeftEdge = topLeft * Math.max(topFront, topBack);
  const topRightEdge = topRight * Math.max(topFront, topBack);
  const minContact = Number.isFinite(minY) ? clamp(1 - (minY - floorY) / 0.1, 0, 1) : 0;
  const edgeGrounded = Math.max(left, right, front, back, minContact);
  const topEdgeGrounded = Math.max(topLeft, topRight, topFront, topBack, minContact);
  const solidGrounded = Math.min(left, right, front, back);
  const topSolidGrounded = Math.min(topLeft, topRight, topFront, topBack);
  return {
    minY,
    point,
    left,
    right,
    front,
    back,
    topLeft,
    topRight,
    topFront,
    topBack,
    leftTrack,
    rightTrack,
    leftEdge,
    rightEdge,
    topLeftTrack,
    topRightTrack,
    topLeftEdge,
    topRightEdge,
    leftDriveContact,
    rightDriveContact,
    topLeftDriveContact,
    topRightDriveContact,
    grounded: edgeGrounded,
    topGrounded: topEdgeGrounded,
    solidGrounded,
    topSolidGrounded,
    edgeGrounded: Math.max(edgeGrounded, topEdgeGrounded),
  };
}

function spinnerWeaponFloorInfo(fighter, THREE, floorY) {
  if (upVector(fighter, THREE).y > DRIVE_UPRIGHT_Y) return { minY: Infinity, point: null, clearance: Infinity, bite: 0 };
  const parts = (fighter.physics?.parts || []).filter((part) => part.part === "weapon");
  const scale = fighter.visualScale || 1;
  let minY = Infinity;
  let point = null;
  parts.forEach((part) => {
    const half = (part.halfExtents || [0.4, 0.16, 0.4]).map((value) => value * scale);
    const localRotation = part.ignoreLocalBottomFloorContact
      ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0])))
      : null;
    contactSamplesForPart(part, half).forEach((corner) => {
      if (localRotation && new THREE.Vector3(...corner).applyQuaternion(localRotation).y < 0) return;
      const world = localPointToWorld(fighter, part, corner, THREE);
      if (world.y < minY) {
        minY = world.y;
        point = world;
      }
    });
  });
  if (!Number.isFinite(minY)) return { minY: Infinity, point: null, clearance: Infinity, bite: 0 };
  const clearance = minY - floorY;
  return {
    minY,
    point,
    clearance,
    bite: clamp((floorY - minY - 0.035) / 0.12, 0, 1),
  };
}

let nowSeconds = () => performance.now() / 1000;

function markHit(fighter, seconds = 0.9) {
  if (!fighter?.physics) return;
  fighter.physics.hitGraceUntil = Math.max(fighter.physics.hitGraceUntil || 0, nowSeconds() + seconds);
}

function isInHitGrace(fighter) {
  return nowSeconds() < (fighter?.physics?.hitGraceUntil || 0);
}

function markOwnerRecoil(fighter, seconds = 0.48) {
  if (!fighter?.physics) return;
  fighter.physics.ownerRecoilUntil = Math.max(fighter.physics.ownerRecoilUntil || 0, nowSeconds() + seconds);
}

function isInOwnerRecoilGrace(fighter) {
  return nowSeconds() < (fighter?.physics?.ownerRecoilUntil || 0);
}

function drivePosture(fighter, THREE) {
  const upY = upVector(fighter, THREE).y;
  const upright = upY > DRIVE_UPRIGHT_Y;
  const inverted = Boolean(fighter.spec?.canDriveInverted && upY < -DRIVE_UPRIGHT_Y);
  return {
    upY,
    upright,
    inverted,
    edgeOnly: false,
    driveDirection: inverted ? -1 : 1,
    canNormalDrive: upright || inverted,
  };
}

function momentumScale(attacker, target) {
  const weaponWeight = Math.max(1, attacker.spec?.weaponWeightLbs || 50);
  const targetWeight = Math.max(1, target.fighter?.weightLbs || target.prop?.weightLbs || target.rb?.userData?.weightLbs || 250);
  return clamp(Math.sqrt(weaponWeight / targetWeight), 0.42, 1.35);
}

function spinnerPhysicalMaxSpeed(attacker) {
  const configured = attacker.spec?.weaponMaxAngularSpeed;
  if (Number.isFinite(configured) && configured > 0) return configured;
  const weapon = attacker.weapon;
  return Math.max(1, Math.abs(weapon?.visualSpeed || weapon?.activeSpeed || weapon?.speed || 1));
}

function spinnerPhysicalSpeed(attacker) {
  const weapon = attacker.weapon;
  const visualReference = Math.max(1, Math.abs(weapon?.visualSpeed || weapon?.activeSpeed || weapon?.speed || 1));
  const visualCurrent = Math.abs(Number.isFinite(weapon?.currentSpeed) ? weapon.currentSpeed : 0);
  return clamp(visualCurrent / visualReference, 0, 1.45) * spinnerPhysicalMaxSpeed(attacker);
}

function spinnerEnergy(attacker) {
  const speed = spinnerPhysicalSpeed(attacker);
  const weaponWeight = Math.max(1, attacker.spec?.weaponWeightLbs || 40);
  const inertiaCap = Number.isFinite(attacker.spec?.spinnerInertiaCap) ? attacker.spec.spinnerInertiaCap : 800;
  const inertia = clamp((weaponWeight / 70) * (0.65 + (attacker.spec?.weaponRotationalInertia || 0)), 0.12, Math.max(0.12, inertiaCap));
  return 0.5 * inertia * speed * speed * 0.0046;
}

function weaponEffectiveness(fighter) {
  const value = Number(fighter?.weapon?.damageEffectiveness);
  return Number.isFinite(value) ? clamp(value, 0, 1) : 1;
}

function spinnerSpeedPowerMultiplier(attacker) {
  const halfMultiplier = Number.isFinite(attacker.spec?.spinnerHalfSpeedPowerMultiplier)
    ? attacker.spec.spinnerHalfSpeedPowerMultiplier
    : 1;
  const fullMultiplier = Number.isFinite(attacker.spec?.spinnerFullSpeedPowerMultiplier)
    ? attacker.spec.spinnerFullSpeedPowerMultiplier
    : 1;
  if (halfMultiplier === 1 && fullMultiplier === 1) return 1;
  const speedRatio = clamp(spinnerPhysicalSpeed(attacker) / spinnerPhysicalMaxSpeed(attacker), 0, 1);
  if (speedRatio <= 0.5) return 1 + (halfMultiplier - 1) * (speedRatio / 0.5);
  return halfMultiplier + (fullMultiplier - halfMultiplier) * ((speedRatio - 0.5) / 0.5);
}

function drainSpinner(attacker, loss, minRatio = 0.22) {
  const weapon = attacker.weapon;
  if (!weapon || (weapon.type !== "bar" && weapon.type !== "drum")) return;
  const speed = Number.isFinite(weapon.currentSpeed) ? weapon.currentSpeed : 0;
  weapon.currentSpeed = speed * clamp(1 - loss, minRatio, 0.96);
}

function isSpinnerAttackColliderSensor(fighter, part = null) {
  const weapon = fighter?.weapon;
  if (weapon?.type !== "bar" && weapon?.type !== "drum") return false;
  if (part?.nonBlockingSpinner) return true;
  const speedRatio = clamp(spinnerPhysicalSpeed(fighter) / spinnerPhysicalMaxSpeed(fighter), 0, 1.45);
  return speedRatio >= (fighter.spec?.spinnerAttackSensorSpeedRatio ?? SPINNER_ATTACK_SENSOR_SPEED_RATIO);
}

function isWeaponColliderSensor(fighter, part = null) {
  if (part?.ignoreGroundContact) return true;
  return isSpinnerAttackColliderSensor(fighter, part);
}

function applyImpulseAtPoint(rb, impulse, point) {
  if (rb.applyImpulseAtPoint) {
    rb.applyImpulseAtPoint(impulse, point, true);
  } else {
    rb.applyImpulse(impulse, true);
  }
}

export function createPhysics({ THREE, RAPIER, now = null }) {
  nowSeconds = typeof now === "function" ? now : () => performance.now() / 1000;
  const state = {
    enabled: false,
    floorY: DEFAULTS.floorY,
    fixedDt: DEFAULTS.fixedDt,
    spinnerKnockbackEnabled: true,
    plowDefenceEnabled: true,
    teeterAssistEnabled: true,
    colliderCenterOfMassEnabled: false,
    softFloorCorrectionEnabled: true,
    arenaHalfWidth: 12,
    arenaHalfLength: 12,
    arenaCeilingHeight: 6.3,
  };

  function setEnabled(enabled) {
    state.enabled = Boolean(enabled);
  }

  function setOptions(options = {}) {
    if (options.spinnerKnockbackEnabled !== undefined) {
      state.spinnerKnockbackEnabled = Boolean(options.spinnerKnockbackEnabled);
    }
    if (options.plowDefenceEnabled !== undefined) {
      state.plowDefenceEnabled = Boolean(options.plowDefenceEnabled);
    }
    if (options.teeterAssistEnabled !== undefined) {
      state.teeterAssistEnabled = Boolean(options.teeterAssistEnabled);
    }
    if (options.colliderCenterOfMassEnabled !== undefined) {
      state.colliderCenterOfMassEnabled = Boolean(options.colliderCenterOfMassEnabled);
    }
    if (options.softFloorCorrectionEnabled !== undefined) {
      state.softFloorCorrectionEnabled = Boolean(options.softFloorCorrectionEnabled);
    }
    if (Number.isFinite(options.arenaHalfWidth) && options.arenaHalfWidth > 0) state.arenaHalfWidth = options.arenaHalfWidth;
    if (Number.isFinite(options.arenaHalfLength) && options.arenaHalfLength > 0) state.arenaHalfLength = options.arenaHalfLength;
    if (Number.isFinite(options.arenaCeilingHeight) && options.arenaCeilingHeight > 0) state.arenaCeilingHeight = options.arenaCeilingHeight;
  }

  function configureWorld(world) {
    if (!world) return;
    const params = world.integrationParameters;
    params.numSolverIterations = Math.max(params.numSolverIterations || 0, 12);
    params.numInternalPgsIterations = Math.max(params.numInternalPgsIterations || 0, 4);
    params.maxCcdSubsteps = Math.max(params.maxCcdSubsteps || 0, 4);
    params.normalizedAllowedLinearError = Math.min(params.normalizedAllowedLinearError || 0.001, 0.0007);
  }

  function colliderDescForPart(part, visualScale, helpers) {
    const half = (part.halfExtents || [0.4, 0.16, 0.4]).map((value) => value * visualScale);
    if (part.vertices?.length) {
      const vertices = new Float32Array(part.vertices.map((point) => point.map((value) => value * visualScale)).flat(2));
      return RAPIER.ColliderDesc.convexHull(vertices) || RAPIER.ColliderDesc.cuboid(...half);
    }
    if (part.type === "wedge") {
      const vertices = new Float32Array(helpers.wedgeVertices(half).flat());
      return RAPIER.ColliderDesc.convexHull(vertices) || RAPIER.ColliderDesc.cuboid(...half);
    }
    if (part.type === "cylinder") {
      const radius = cylinderColliderRadius(half);
      return RAPIER.ColliderDesc.cylinder(Math.max(0.01, Math.abs(half[0])), radius);
    }
    return RAPIER.ColliderDesc.cuboid(...half);
  }

  function addBotColliders({ world, rb, id, parts, visualScale = 1, group = null, helpers }) {
    const weaponBindings = [];
    const colliderBindings = [];
    const physicsParts = parts.map(copyPart);
    physicsParts.forEach((part, index) => {
      // Drive contacts are intentionally not Rapier colliders. They are sampled
      // by fighterGroundInfo for traction, but never hold the chassis up. If a
      // bot appears to rest on drive contacts, fix the physical colliders or
      // ground sampling, not this exclusion.
      if (part.part === "driveContact") return;
      const material = partMaterial(part);
      const desc = colliderDescForPart(part, visualScale, helpers);
      const position = part.position || [0, 0, 0];
      desc.setTranslation(position[0] * visualScale, position[1] * visualScale, position[2] * visualScale);
      if (part.rotation) desc.setRotation(helpers.colliderRotation(...part.rotation));
      desc.setDensity((part.density ?? material.density) * 2.75);
      desc.setFriction(part.friction ?? material.friction);
      desc.setRestitution(part.restitution ?? material.restitution);
      if (part.ignoreGroundContact && desc.setSensor) desc.setSensor(true);
      maybeSetCombineRules(RAPIER, desc);
      const collider = world.createCollider(desc, rb);
      collider.userData = {
        botId: id,
      material: part.part === "weapon" ? "weapon" : part.part === "driveContact" ? "driveContact" : part.type === "wedge" ? "wedge" : "body",
      };
      if (collider) colliderBindings.push({ collider, part, index });
      const relativeToWeapon = part.part === "weapon" && group ? helpers.colliderRelativeToWeapon(part, group) : null;
      if (collider && relativeToWeapon) weaponBindings.push({ collider, relativeToWeapon, visualScale, part });
    });
    return { weaponBindings, colliderBindings, parts: physicsParts };
  }

  function initializeFighter(fighter, parts, { floorY = DEFAULTS.floorY } = {}) {
    fighter.physics = {
      parts: parts.map(copyPart),
      hitGraceUntil: 0,
      wedgeUntil: 0,
      wedgeTractionPenalty: 0,
      groundedStableFor: 0,
      brakeTiltUntil: 0,
      escapeStuckFor: 0,
      escapeEligible: false,
    };
    state.floorY = floorY;
    const mass = Math.max(12, (fighter.spec?.weightLbs || 250) * 0.075);
    const inertiaBoost = fighter.spec?.id === "huge" ? 1.75 : fighter.spec?.id === "tombstone" ? 1.38 : 1.18;
    const centerOfMass = state.colliderCenterOfMassEnabled
      ? colliderCenterOfMass(fighter.physics.parts, fighter.visualScale || 1)
      : { x: 0, y: -0.14 * (fighter.visualScale || 1), z: 0.02 };
    fighter.physics.centerOfMass = centerOfMass;
    fighter.physics.radius = colliderHorizontalRadius(fighter.physics.parts, fighter.visualScale || 1);
    const angularInertia = {
      x: mass * inertiaBoost * 3.2,
      y: mass * inertiaBoost * (fighter.spec?.id === "huge" ? 0.34 : 1.05),
      z: mass * inertiaBoost * 3.2,
    };
    const frame = { x: 0, y: 0, z: 0, w: 1 };
    try {
      fighter.rb.setAdditionalMassProperties?.(mass, centerOfMass, angularInertia, frame, true);
    } catch {
      try {
        fighter.rb.setAdditionalMass?.(mass, true);
      } catch {
        // Optional Rapier API varies by build; collider density still carries mass.
      }
    }
    fighter.rb.setLinearDamping?.(0.28);
    fighter.rb.setAngularDamping?.(0.48);
    return fighter.physics;
  }

  function applyBrakeForwardTilt(fighter, forward, right, mass, driveGrip, dt) {
    if (!BRAKE_FORWARD_TILT_ENABLED || !fighter?.rb || !fighter.physics) return;
    const now = nowSeconds();
    if (now > (fighter.physics.brakeTiltUntil || 0)) return;
    const remaining = fighter.physics.brakeTiltUntil - now;
    const fade = clamp(remaining / BRAKE_FORWARD_TILT_SECONDS, 0, 1);
    const grip = clamp(driveGrip, 0, 1);
    if (grip <= 0.02) return;
    const amount = mass * BRAKE_FORWARD_TILT_TORQUE * grip * fade * (dt / DEFAULTS.fixedDt);
    fighter.rb.applyTorqueImpulse({
      x: -right.x * amount,
      y: 0,
      z: -right.z * amount,
    }, true);
    fighter.physics.lastBrakeTilt = {
      until: fighter.physics.brakeTiltUntil,
      remaining,
      amount,
      forward: { x: forward.x, z: forward.z },
    };
  }

  function tractionForFighter(fighter) {
    const ground = fighterGroundInfo(fighter, THREE, state.floorY);
    const posture = drivePosture(fighter, THREE);
    const penalty = nowSeconds() < (fighter.physics?.wedgeUntil || 0)
      ? 1 - (fighter.physics?.wedgeTractionPenalty || 0)
      : 1;
    const driveContactLeft = posture.inverted ? ground.topLeftDriveContact : ground.leftDriveContact;
    const driveContactRight = posture.inverted ? ground.topRightDriveContact : ground.rightDriveContact;
    const trackLeft = driveContactLeft || (posture.inverted ? ground.topLeftTrack : ground.leftTrack);
    const trackRight = driveContactRight || (posture.inverted ? ground.topRightTrack : ground.rightTrack);
    const edgeLeft = posture.inverted ? ground.topLeftEdge : ground.leftEdge;
    const edgeRight = posture.inverted ? ground.topRightEdge : ground.rightEdge;
    const solidGrounded = posture.inverted ? ground.topSolidGrounded : ground.solidGrounded;
    const grounded = posture.inverted ? ground.topGrounded : ground.grounded;
    const hasDriveContacts = fighter.physics?.parts?.some((part) => part.part === "driveContact");
    // Traction-only: this can improve wheel grip/readouts, but drive contacts
    // are not Rapier colliders and do not feed fighterGroundInfo's physical
    // solidGrounded/rest-height calculations. They must never hold a bot up.
    const driveSolidGrounded = hasDriveContacts ? Math.min(driveContactLeft, driveContactRight) : 0;
    const driveStableGrounded = hasDriveContacts ? Math.max(driveSolidGrounded, Math.max(driveContactLeft, driveContactRight) * 0.24) : 0;
    const left = posture.canNormalDrive ? (hasDriveContacts ? trackLeft : Math.max(trackLeft, solidGrounded * 0.82)) * penalty : 0;
    const right = posture.canNormalDrive ? (hasDriveContacts ? trackRight : Math.max(trackRight, solidGrounded * 0.82)) * penalty : 0;
    fighter.wheelTraction = {
      left,
      right,
      leftEdge: 0,
      rightEdge: 0,
      edgeGrounded: grounded,
      front: posture.inverted ? ground.topFront : ground.front,
      back: posture.inverted ? ground.topBack : ground.back,
      grounded: Math.max(left, right),
      solidGrounded: solidGrounded * penalty,
      bodySolidGrounded: solidGrounded * penalty,
      driveSolidGrounded: driveStableGrounded * penalty,
      upright: posture.upright,
      inverted: posture.inverted,
      edgeOnly: posture.edgeOnly,
      canNormalDrive: posture.canNormalDrive,
    };
    return fighter.wheelTraction;
  }

  function driveFighter(fighter, rawInput = {}, dt = state.fixedDt) {
    if (!fighter?.rb) return;
    const input = helpersCompleteDriveInput(rawInput);
    const traction = tractionForFighter(fighter);
    const posture = drivePosture(fighter, THREE);
    const leftDrive = posture.canNormalDrive ? input.leftDrive * (traction.left || 0) * posture.driveDirection : 0;
    const rightDrive = posture.canNormalDrive ? input.rightDrive * (traction.right || 0) * posture.driveDirection : 0;
    const requestedThrottle = posture.canNormalDrive ? clamp((input.leftDrive + input.rightDrive) * 0.5 * posture.driveDirection, -1, 1) : 0;
    const requestedTurn = posture.canNormalDrive ? clamp((input.leftDrive - input.rightDrive) * 0.5 * posture.driveDirection, -1, 1) : 0;
    const throttle = clamp((leftDrive + rightDrive) * 0.5, -1, 1);
    const turn = clamp((leftDrive - rightDrive) * 0.5, -1, 1);
    const driveGrip = Math.max(traction.left, traction.right);
    const yawGrip = fighter.spec?.id === "huge" ? driveGrip : Math.min(traction.left, traction.right);
    const { forward } = yawBasis(fighter, THREE);
    const { right } = yawBasis(fighter, THREE);
    const velocity = fighter.rb.linvel();
    const mass = bodyMass(fighter.rb);
    const defaultMaxSpeedMph = DEFAULTS.maxSpeed / FEET_PER_SECOND_PER_MPH;
    const maxSpeed = rawInput.boostActive
      ? botGroundSpeedFeetPerSecond(fighter.spec, "maxBoostSpeed", defaultMaxSpeedMph)
      : botGroundSpeedFeetPerSecond(fighter.spec, "maxSpeed", defaultMaxSpeedMph);
    const brakeActive = Boolean(rawInput.brakeActive);
    const targetSpeed = brakeActive ? 0 : requestedThrottle * maxSpeed;
    const currentSpeed = velocity.x * forward.x + velocity.z * forward.z;
    const acceleration = clamp(fighter.spec?.driveAcceleration || 8, 1, 16);
    const recoilGrace = isInHitGrace(fighter) || isInOwnerRecoilGrace(fighter);
    const recentHitCoast = recoilGrace && Math.abs(requestedThrottle) < 0.12 && Math.abs(requestedTurn) < 0.12;
    const brakeBlend = brakeActive && Math.abs(currentSpeed) > 0.05
      ? dt * acceleration * BRAKE_ACCELERATION_MULTIPLIER * driveGrip
      : 0;
    const driveBlend = recentHitCoast ? 0 : Math.min(1, Math.max(dt * acceleration * driveGrip, brakeBlend));
    const maxImpulse = Math.abs(targetSpeed - currentSpeed) * mass * driveBlend;
    const neededImpulse = (targetSpeed - currentSpeed) * mass;
    const driveImpulse = driveGrip > 0.02 ? clamp(neededImpulse, -maxImpulse, maxImpulse) : 0;
    if (brakeActive && posture.canNormalDrive && driveGrip > 0.02) {
      fighter.physics.brakeTiltUntil = Math.max(fighter.physics.brakeTiltUntil || 0, nowSeconds() + BRAKE_FORWARD_TILT_SECONDS);
    }
    fighter.physics.lastDrive = {
      leftDrive,
      rightDrive,
      throttle,
      turn,
      requestedThrottle,
      requestedTurn,
      grip: driveGrip,
      solidGrip: yawGrip,
      edgeGrip: 0,
      upright: posture.upright,
      inverted: posture.inverted,
      edgeOnly: posture.edgeOnly,
      canNormalDrive: posture.canNormalDrive,
      mass,
      maxSpeed,
      targetSpeed,
      currentSpeed,
      brakeActive,
      maxImpulse,
      neededImpulse,
      driveImpulse,
      driveBlend,
      recentHitCoast,
    };
    if (driveGrip <= 0.02) return;
    if (Math.abs(driveImpulse) > 0.001) {
      fighter.rb.applyImpulse({ x: forward.x * driveImpulse, y: 0, z: forward.z * driveImpulse }, true);
    }
    applyBrakeForwardTilt(fighter, forward, right, mass, driveGrip, dt);
    if (!posture.canNormalDrive) return;
    const angular = fighter.rb.angvel();
    const yawMass = mass * 0.22;
    const turnScale = (maxSpeed / DEFAULTS.maxSpeed) * clamp(fighter.spec?.turningTightness || 1, 0.45, 1.35);
    const yawDamping = clamp(fighter.spec?.yawDamping ?? 1, 0.35, 2.5);
    const counterRotating = Math.abs(requestedTurn) > 0.55 && Math.abs(requestedThrottle) < 0.18;
    const targetYawRaw = -requestedTurn * DEFAULTS.turnRate * turnScale * (counterRotating ? 1.45 : 1);
    const targetYaw = counterRotating ? clamp(targetYawRaw, -6.5, 6.5) : targetYawRaw;
    const yawAuthority = fighter.spec?.id === "huge" ? 3.4 : counterRotating ? 2.25 : 1;
    const maxYawImpulse = yawMass * 24 * dt * yawGrip * yawAuthority;
    const yawImpulse = clamp((targetYaw - angular.y) * yawMass, -maxYawImpulse, maxYawImpulse);
    if (yawGrip > 0.2 && Math.abs(yawImpulse) > 0.001) fighter.rb.applyTorqueImpulse({ x: 0, y: yawImpulse, z: 0 }, true);
    const yawOvershooting = Math.abs(targetYaw) > 0.05 && Math.sign(angular.y) === Math.sign(targetYaw) && Math.abs(angular.y) > Math.abs(targetYaw) * 1.08;
    const recentHit = recoilGrace;
    const yawReleased = !recentHit && Math.abs(requestedTurn) < 0.12 && Math.abs(angular.y) > 0.18;
    if ((fighter.spec?.id === "huge" || counterRotating || yawOvershooting || yawReleased) && yawGrip > 0.12) {
      const yawBlendRate = (yawReleased ? 20 : yawOvershooting ? 12 : fighter.spec?.id === "huge" ? 5.8 : 6.2) * yawDamping;
      const yawBlendLimit = clamp((yawReleased ? 0.55 : yawOvershooting ? 0.46 : fighter.spec?.id === "huge" ? 0.32 : 0.24) * yawDamping, 0.08, 0.68);
      const yawBlend = clamp(dt * yawBlendRate * yawGrip, 0, yawBlendLimit);
      const lateralDamp = counterRotating && yawGrip > 0.35 ? clamp(dt * 5.5 * yawGrip * yawDamping, 0, 0.2) : 0;
      fighter.rb.setAngvel({
        x: angular.x * (1 - lateralDamp),
        y: angular.y + (targetYaw - angular.y) * yawBlend,
        z: angular.z * (1 - lateralDamp),
      }, true);
    }
  }

  function helpersCompleteDriveInput(input = {}) {
    const leftDrive = input.leftDrive !== undefined ? input.leftDrive : clamp((input.throttle || 0) + (input.turn || 0), -1, 1);
    const rightDrive = input.rightDrive !== undefined ? input.rightDrive : clamp((input.throttle || 0) - (input.turn || 0), -1, 1);
    return { ...input, leftDrive: clamp(leftDrive, -1, 1), rightDrive: clamp(rightDrive, -1, 1) };
  }

  function updateWedgeStates(arena, dt = state.fixedDt) {
    if (!arena?.fighters?.length) return;
    const now = nowSeconds();
    arena.fighters.forEach((fighter) => {
      if (now > (fighter.physics?.wedgeUntil || 0)) {
        fighter.physics.wedgeTractionPenalty = 0;
      }
    });
    for (const attacker of arena.fighters) {
      const hasWedge = attacker.physics?.parts?.some((part) => part.type === "wedge");
      if (!hasWedge || upVector(attacker, THREE).y < 0.58) continue;
      const attackerGround = tractionForFighter(attacker);
      if ((attackerGround.solidGrounded || attackerGround.grounded || 0) < WEDGE_ASSIST_MIN_GROUNDED) continue;
      const a = attacker.rb.translation();
      const { forward, right } = yawBasis(attacker, THREE);
      const attackerVelocity = attacker.rb.linvel();
      const attackerForwardSpeed = attackerVelocity.x * forward.x + attackerVelocity.z * forward.z;
      if (attackerForwardSpeed < WEDGE_ASSIST_MIN_FORWARD_SPEED) continue;
      for (const target of arena.fighters) {
        if (target === attacker) continue;
        const b = target.rb.translation();
        const delta = new THREE.Vector3(b.x - a.x, b.y - a.y, b.z - a.z);
        const localForward = delta.dot(forward);
        const localRight = delta.dot(right);
        const targetRadius = Math.max(0.8, target.physics?.radius || 1.15);
        const attackerRadius = Math.max(0.8, attacker.physics?.radius || 1.15);
        const forwardQuality = 1 - Math.abs(localForward - 1.35) / 1.45;
        const lateralQuality = 1 - Math.abs(localRight) / (targetRadius + attackerRadius * 0.35);
        const verticalQuality = 1 - Math.abs(delta.y - 0.12) / 0.72;
        const baseQuality = clamp(Math.min(forwardQuality, lateralQuality, verticalQuality), 0, 1);
        const { forward: targetForward, right: targetRight } = yawBasis(target, THREE);
        const attackerDirection = new THREE.Vector3(a.x - b.x, 0, a.z - b.z);
        if (attackerDirection.lengthSq() > 0.0001) attackerDirection.normalize();
        const targetFrontExposure = attackerDirection.dot(targetForward);
        const targetSideExposure = Math.abs(attackerDirection.dot(targetRight));
        const targetBackExposure = Math.max(0, -targetFrontExposure);
        const sideBackExposure = clamp((Math.max(targetSideExposure, targetBackExposure) - WEDGE_SIDE_BACK_EXPOSURE_START) / (1 - WEDGE_SIDE_BACK_EXPOSURE_START), 0, 1);
        const quality = clamp(baseQuality + sideBackExposure * 0.35, 0, 1);
        if (quality <= 0) continue;
        target.physics.wedgeUntil = now + 0.22;
        target.physics.wedgeTractionPenalty = Math.max(
          target.physics.wedgeTractionPenalty || 0,
          clamp(0.35 + quality * 0.45 + sideBackExposure * WEDGE_SIDE_BACK_TRACTION_BONUS, 0, 0.92),
        );
        const ground = fighterGroundInfo(target, THREE, state.floorY);
        if (ground.grounded > 0.08 && !isInHitGrace(target)) {
          const mass = bodyMass(target.rb);
          const lift = mass * (0.38 + quality * 0.55) * (1 + sideBackExposure * WEDGE_SIDE_BACK_LIFT_BONUS) * dt;
          const shove = mass * quality * (0.32 + sideBackExposure * 0.08) * dt;
          const edgeContactPoint = new THREE.Vector3(b.x, b.y + 0.05, b.z).addScaledVector(attackerDirection, targetRadius * 0.72);
          if (sideBackExposure > 0.01) {
            applyImpulseAtPoint(target.rb, { x: 0, y: lift, z: 0 }, edgeContactPoint);
            target.rb.applyImpulse({ x: forward.x * shove, y: 0, z: forward.z * shove }, true);
          } else {
            target.rb.applyImpulse({ x: forward.x * shove, y: lift, z: forward.z * shove }, true);
          }
          target.physics.lastWedgeAssist = {
            attacker: attacker.spec?.id || null,
            quality,
            baseQuality,
            sideBackExposure,
            targetFrontExposure,
            targetSideExposure,
            targetBackExposure,
            lift,
            shove,
            edgeContactPoint: { x: edgeContactPoint.x, y: edgeContactPoint.y, z: edgeContactPoint.z },
            attackerGrounded: attackerGround.grounded || 0,
            attackerSolidGrounded: attackerGround.solidGrounded || 0,
          };
        }
      }
    }
  }

  function applySpinnerHit(attacker, target, contact, dt, callbacks = {}) {
    const weapon = attacker.weapon;
    const speed = spinnerPhysicalSpeed(attacker);
    const speedRatio = clamp(speed / spinnerPhysicalMaxSpeed(attacker), 0, 1.45);
    if (speedRatio < 0.12) return false;
    const key = target.fighter?.spec?.id || target.prop?.kind || target.rb?.handle;
    weapon.hitCooldowns ||= new Map();
    const now = nowSeconds();
    if (now - (weapon.hitCooldowns.get(key) || 0) < 0.18) return false;
    weapon.hitCooldowns.set(key, now);
    const targetVelocity = target.rb.linvel();
    const attackerVelocity = attacker.rb.linvel();
    const relative = new THREE.Vector3(targetVelocity.x - attackerVelocity.x, 0, targetVelocity.z - attackerVelocity.z);
    const approach = Math.max(0, -relative.dot(contact.side));
    const bite = clamp(0.35 + speedRatio * 0.65 + approach * 0.045, 0.25, 1.25);
    const biases = SPINNER_BIASES[attacker.spec?.weaponRotationalInertiaType || "vertical-front"] || SPINNER_BIASES["vertical-front"];
    const energy = spinnerEnergy(attacker);
    const impactScale = clamp(attacker.spec?.spinnerImpactScale ?? 1, 0.05, 6);
    const targetMass = clamp(bodyMass(target.rb), 1, 800);
    const transferEfficiency = clamp(attacker.spec?.spinnerEnergyTransferEfficiency ?? 0.42, 0.02, 1.5);
    const energyTransferImpulse = Math.sqrt(Math.max(0, 2 * targetMass * energy * transferEfficiency));
    if (weaponEffectiveness(attacker) <= 0) return false;
    const rawImpulseMag = energyTransferImpulse * bite * momentumScale(attacker, target) * impactScale * spinnerSpeedPowerMultiplier(attacker);
    const capEnabled = attacker.spec?.spinnerImpactCapEnabled !== false;
    const cap = Number.isFinite(attacker.spec?.spinnerImpactCap)
      ? attacker.spec.spinnerImpactCap
      : attacker.spec?.id === "tombstone"
        ? 10.5
        : 7.5;
    const minImpulse = 0.2;
    const impulseMag = capEnabled ? clamp(rawImpulseMag, minImpulse, Math.max(minImpulse, cap)) : Math.max(minImpulse, rawImpulseMag);
    const plow = spinnerPlowDefence(attacker, target, contact.targetPoint || contact.point);
    const hit = spinnerHitDirection(attacker, contact, THREE);
    const hitDirection = hit.direction;
    const pushImpulseMag = impulseMag * plow.pushFactor;
    const liftImpulseMag = impulseMag * plow.liftFactor;
    const torqueImpulseMag = impulseMag * plow.torqueFactor;
    const damageImpulseMag = impulseMag * plow.damageFactor;
    const reflectionImpulseMag = impulseMag * plow.pushFactor * plow.attackerReflectionBoost;
    if (target.fighter?.physics) {
      const plowRecord = {
        attacker: attacker.spec?.id || null,
        applied: plow.applied,
        slopeDeg: plow.slopeDeg,
        strength: plow.strength,
        pushFactor: plow.pushFactor,
        liftFactor: plow.liftFactor,
        torqueFactor: plow.torqueFactor,
        damageFactor: plow.damageFactor,
        attackerReflectionBoost: plow.attackerReflectionBoost,
        spinnerType: attacker.spec?.weaponRotationalInertiaType === "horizontal" ? "horizontal" : "vertical",
      };
      target.fighter.physics.lastPlowDefence = plowRecord;
      if (plow.applied) target.fighter.physics.lastAppliedPlowDefence = plowRecord;
    }
    callbacks.recordWeaponEvent?.({
      kind: "spinnerHit",
      attacker: attacker.spec?.id || null,
      target: target.fighter?.spec?.id || target.prop?.kind || null,
      speed,
      speedRatio,
      energy,
      impactScale,
      rawImpulseMag,
      impulseMag,
      pushImpulseMag,
      liftImpulseMag,
      torqueImpulseMag,
      damageImpulseMag,
      reflectedImpulseMag: reflectionImpulseMag,
      plowDefenceApplied: plow.applied,
      plowDefenceStrength: plow.strength,
      plowPushFactor: plow.pushFactor,
      plowLiftFactor: plow.liftFactor,
      plowTorqueFactor: plow.torqueFactor,
      plowDamageFactor: plow.damageFactor,
      plowAttackerReflectionBoost: plow.attackerReflectionBoost,
      plowWedgeSlopeDeg: plow.slopeDeg,
      cap,
      capEnabled,
      bite,
      spinDirection: hit.spinDirection,
      tangentialHitDirection: hit.tangential,
      hitDirection: { x: hitDirection.x, y: hitDirection.y, z: hitDirection.z },
      effectiveness: weaponEffectiveness(attacker),
      currentSpeed: weapon.currentSpeed || 0,
    });
    const targetImpulseScale = Math.max(0, attacker.spec?.spinnerTargetImpulseScale ?? 1);
    const targetLiftScale = Math.max(0, attacker.spec?.spinnerTargetLiftScale ?? 1);
    const lift = liftImpulseMag * (0.13 + biases.lift * 0.22) * clamp(speedRatio, 0.25, 1.25) * targetLiftScale;
    const impulse = {
      x: hitDirection.x * pushImpulseMag * targetImpulseScale,
      y: lift,
      z: hitDirection.z * pushImpulseMag * targetImpulseScale,
    };
    applyImpulseAtPoint(target.rb, impulse, contact.point);
    const targetLiftVelocity = attacker.spec?.spinnerTargetLiftVelocity;
    if (Number.isFinite(targetLiftVelocity) && targetLiftVelocity > 0) {
      const velocity = target.rb.linvel();
      const defendedLiftVelocity = targetLiftVelocity * plow.liftFactor;
      if (velocity.y < defendedLiftVelocity) {
        target.rb.setLinvel({ x: velocity.x, y: defendedLiftVelocity, z: velocity.z }, true);
      }
    }
    const targetLiftClearance = attacker.spec?.spinnerTargetLiftClearance;
    if (Number.isFinite(targetLiftClearance) && targetLiftClearance > 0) {
      const position = target.rb.translation();
      target.rb.setTranslation({ x: position.x, y: position.y + targetLiftClearance * plow.liftFactor, z: position.z }, true);
    }
    target.rb.applyTorqueImpulse({
      x: contact.right.x * torqueImpulseMag * biases.pitch * 0.32 * SPINNER_EXTRA_TORQUE_SCALE,
      y: torqueImpulseMag * biases.yaw * 0.42 * SPINNER_EXTRA_TORQUE_SCALE,
      z: contact.right.z * torqueImpulseMag * biases.pitch * 0.32 * SPINNER_EXTRA_TORQUE_SCALE,
    }, true);
    if (state.spinnerKnockbackEnabled) {
      const wallBacked = wallBackedEnergyReturn(target, hitDirection);
      applySpinnerOwnerReflection(attacker, { ...contact, side: hitDirection }, { impulseMag: reflectionImpulseMag, lift, biases, strength: 1 + wallBacked * 1.75 });
    }
    const drainLoss = clamp(0.72 + bite * 0.16 + speedRatio * 0.08, 0.72, 0.97);
    drainSpinner(attacker, drainLoss, 0.03);
    markHit(attacker, 0.48);
    if (target.fighter) markHit(target.fighter, 0.55);
    // spinnerDamageScale orders how much a spinner HURTS without touching how
    // far it throws (that is impactScale, which moves the whole hit). It comes
    // across with the ported entries — v2 uses it to rank the roster's damage —
    // and defaults to 1, so v1's own bots are unchanged.
    const damageScale = Number.isFinite(attacker.spec?.spinnerDamageScale) ? Math.max(0, attacker.spec.spinnerDamageScale) : 1;
    callbacks.recordDamage?.({
      fighter: target.fighter,
      amount: damageImpulseMag * (1.55 + speedRatio * 0.55) * damageScale,
      point: contact.point,
      normal: new THREE.Vector3(-hitDirection.x, -hitDirection.y, -hitDirection.z),
      kind: "spinner",
      source: attacker,
      directWeaponHit: Boolean(target.fighter && fighterPartsAtPoint(target.fighter, contact.targetPoint || contact.point).some((part) => part.part === "weapon")),
    });
    callbacks.recordDamage?.({
      fighter: attacker,
      amount: damageImpulseMag * 0.38,
      point: contact.point,
      normal: hitDirection,
      kind: "weaponRecoil",
      source: target.fighter || target.prop || null,
    });
    if (target.prop?.kind !== "botDamagePiece") {
      callbacks.spawnSparks?.(new THREE.Vector3(contact.point.x, contact.point.y + 0.12, contact.point.z), 18 + Math.round(damageImpulseMag * 2.5));
    }
    return true;
  }

  function spinnerPlowDefence(attacker, target, point) {
    if (!state.plowDefenceEnabled) return noPlowDefence();
    if (!target?.fighter?.physics?.parts?.length || !point) return noPlowDefence();
    const hit = wedgeOnlyHitAtPoint(target.fighter, point);
    if (!hit.wedge) return noPlowDefence();
    const slopeDeg = wedgeSlopeDegrees(hit.wedge);
    const spinnerType = attacker.spec?.weaponRotationalInertiaType === "horizontal" ? "horizontal" : "vertical";
    const strength = spinnerType === "horizontal"
      ? clamp((slopeDeg - PLOW_DEFENCE_HORIZONTAL_START_DEG) / (PLOW_DEFENCE_HORIZONTAL_FULL_DEG - PLOW_DEFENCE_HORIZONTAL_START_DEG), 0, 1)
      : clamp((PLOW_DEFENCE_VERTICAL_END_DEG - slopeDeg) / (PLOW_DEFENCE_VERTICAL_END_DEG - PLOW_DEFENCE_VERTICAL_FULL_DEG), 0, 1);
    if (strength <= 0) return { ...noPlowDefence(), applied: true, slopeDeg, strength: 0 };
    if (spinnerType === "horizontal") {
      return {
        applied: true,
        slopeDeg,
        strength,
        pushFactor: clamp(1 - 0.24 * strength, 0.76, 1),
        liftFactor: clamp(1 - 0.86 * strength, 0.14, 1),
        torqueFactor: clamp(1 - 0.9 * strength, 0.1, 1),
        damageFactor: clamp(1 - 0.58 * strength, 0.42, 1),
        attackerReflectionBoost: 1 + 0.42 * strength,
      };
    }
    return {
      applied: true,
      slopeDeg,
      strength,
      pushFactor: 1,
      liftFactor: clamp(1 - 0.84 * strength, 0.16, 1),
      torqueFactor: clamp(1 - 0.9 * strength, 0.1, 1),
      damageFactor: clamp(1 - 0.5 * strength, 0.5, 1),
      attackerReflectionBoost: 1,
    };
  }

  function noPlowDefence() {
    return {
      applied: false,
      slopeDeg: null,
      strength: 0,
      pushFactor: 1,
      liftFactor: 1,
      torqueFactor: 1,
      damageFactor: 1,
      attackerReflectionBoost: 1,
    };
  }

  function wedgeOnlyHitAtPoint(fighter, point) {
    const hits = fighterPartsAtPoint(fighter, point);
    const solidHits = hits.filter((part) => part.part !== "driveContact");
    const wedgeHits = solidHits.filter((part) => part.type === "wedge" || part.part === "wedge");
    const nonWedgeHits = solidHits.filter((part) => {
      if (part.type === "wedge" || part.part === "wedge") return false;
      if (part.part === "body") return false;
      return !isPlowSurfaceOverlay(fighter, part);
    });
    return {
      wedge: wedgeHits.length > 0 && nonWedgeHits.length === 0 ? wedgeHits[0] : null,
      hits: solidHits,
    };
  }

  function isPlowSurfaceOverlay(fighter, part) {
    const weaponType = fighter?.weapon?.type;
    return part?.part === "weapon" && (weaponType === "flipper" || weaponType === "meshFlipper");
  }

  function fighterPartsAtPoint(fighter, point, options = {}) {
    const horizontalPad = Number.isFinite(options.horizontalPad) ? options.horizontalPad : 0.16;
    const bodyVerticalPad = Number.isFinite(options.bodyVerticalPad) ? options.bodyVerticalPad : 0.12;
    const wedgeVerticalPad = Number.isFinite(options.wedgeVerticalPad) ? options.wedgeVerticalPad : 0.34;
    const scale = fighter.visualScale || 1;
    const worldPoint = new THREE.Vector3(point.x, point.y, point.z);
    const bodyPosition = fighter.rb.translation();
    const bodyRotation = rigidRotation(fighter, THREE).invert();
    return (fighter.physics?.parts || []).filter((part) => {
      if (part.part === "driveContact") return false;
      const localRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0]))).invert();
      const local = worldPoint.clone()
        .sub(new THREE.Vector3(bodyPosition.x, bodyPosition.y, bodyPosition.z))
        .applyQuaternion(bodyRotation)
        .sub(new THREE.Vector3(...(part.position || [0, 0, 0])).multiplyScalar(scale))
        .applyQuaternion(localRotation);
      const half = (part.halfExtents || [0.4, 0.16, 0.4]).map((value) => Math.abs(value * scale));
      const verticalPad = part.type === "wedge" || part.part === "wedge" ? wedgeVerticalPad : bodyVerticalPad;
      return Math.abs(local.x) <= half[0] + horizontalPad &&
        Math.abs(local.z) <= half[2] + horizontalPad &&
        Math.abs(local.y) <= half[1] + verticalPad;
    });
  }

  function wedgeSlopeDegrees(part) {
    const half = part.halfExtents || [0.4, 0.16, 0.4];
    const rise = Math.max(0.001, Math.abs(half[1]));
    const run = Math.max(0.001, Math.abs(half[2]));
    return Math.atan2(rise, run) * 180 / Math.PI;
  }

  function wallBackedEnergyReturn(target, launchSide) {
    if (!target?.fighter || !target.rb || !Number.isFinite(state.arenaHalfWidth) || !Number.isFinite(state.arenaHalfLength)) return 0;
    const p = target.rb.translation();
    const radius = Math.max(0.5, target.fighter.physics?.radius || 1);
    const xClearance = state.arenaHalfWidth - Math.abs(p.x) - radius;
    const zClearance = state.arenaHalfLength - Math.abs(p.z) - radius;
    const xPressure = Math.sign(p.x || launchSide.x) * launchSide.x;
    const zPressure = Math.sign(p.z || launchSide.z) * launchSide.z;
    const xBlocked = xPressure > 0.25 ? 1 - xClearance / 1.4 : 0;
    const zBlocked = zPressure > 0.25 ? 1 - zClearance / 1.4 : 0;
    return clamp(Math.max(xBlocked, zBlocked), 0, 1);
  }

  function applySpinnerOwnerReflection(attacker, contact, { impulseMag, lift, biases, strength = 1 }) {
    markOwnerRecoil(attacker, 0.54);
    const kickbackScale = Math.max(0, attacker.spec?.spinnerKickbackScale ?? 1);
    const targetImpulseScale = Math.max(0, attacker.spec?.spinnerTargetImpulseScale ?? 1);
    const ownerImpulseShare = clamp(Math.sqrt(targetImpulseScale) * 0.36, 0.45, 1.65);
    const horizontalSpinner = attacker.spec?.weaponRotationalInertiaType === "horizontal";
    const ownerYawShare = clamp(Math.sqrt(targetImpulseScale) * (horizontalSpinner ? 0.58 : 0.36), 0.55, horizontalSpinner ? 2.45 : 1.55);
    const kickback = impulseMag * biases.kickback * 0.36 * kickbackScale * ownerImpulseShare * strength;
    attacker.rb.applyImpulse({
      x: -contact.side.x * kickback,
      y: -Math.abs(lift) * 0.16 * strength,
      z: -contact.side.z * kickback,
    }, true);
    attacker.rb.applyTorqueImpulse({
      x: -contact.right.x * kickback * 0.16,
      y: -impulseMag * biases.yaw * 0.42 * SPINNER_EXTRA_TORQUE_SCALE * kickbackScale * ownerYawShare * strength,
      z: -contact.right.z * kickback * 0.16,
    }, true);
  }

  function applySpinnerFloorKnockback(fighter, weaponPoint, forward, right, dt, callbacks = {}) {
    if (!state.spinnerKnockbackEnabled || !fighter?.weapon || (fighter.weapon.type !== "bar" && fighter.weapon.type !== "drum")) return false;
    const speedRatio = clamp(spinnerPhysicalSpeed(fighter) / spinnerPhysicalMaxSpeed(fighter), 0, 1.45);
    if (speedRatio < 0.32) return false;
    const ground = fighterGroundInfo(fighter, THREE, state.floorY);
    const posture = drivePosture(fighter, THREE);
    const stableDriveActive = fighter.stableDrive?.active !== undefined
      ? Boolean(fighter.stableDrive.active)
      : false;
    if (ground.edgeGrounded < 0.12 && ground.solidGrounded < 0.08) return false;
    const weaponFloor = spinnerWeaponFloorInfo(fighter, THREE, state.floorY);
    const floorBite = weaponFloor.bite;
    if (floorBite <= 0) return false;
    const up = upVector(fighter, THREE);
    const floorLaunchAngleDeg = Number.isFinite(fighter.spec?.spinnerFloorLaunchAngleDeg)
      ? fighter.spec.spinnerFloorLaunchAngleDeg
      : SPINNER_FLOOR_LAUNCH_MIN_ANGLE_DEG;
    const floorLaunchThresholdY = Math.cos(floorLaunchAngleDeg * Math.PI / 180);
    const floorLaunchEnabled = Boolean(fighter.spec?.spinnerFloorLaunchEnabled);
    const floorLaunchTilt = floorLaunchEnabled
      ? clamp((floorLaunchThresholdY - up.y) / Math.max(0.001, floorLaunchThresholdY - 0.05), 0, 1)
      : 0;
    const floorLaunchActive = floorLaunchTilt > 0;
    if (!floorLaunchActive && (stableDriveActive || (posture.canNormalDrive && !posture.inverted && ground.solidGrounded > 0.35))) return false;
    fighter.weapon.hitCooldowns ||= new Map();
    const key = "__spinner_floor__";
    const now = nowSeconds();
    if (now - (fighter.weapon.hitCooldowns.get(key) || 0) < 0.24) return false;
    fighter.weapon.hitCooldowns.set(key, now);
    const biases = SPINNER_BIASES[fighter.spec?.weaponRotationalInertiaType || "vertical-front"] || SPINNER_BIASES["vertical-front"];
    const mass = clamp(bodyMass(fighter.rb), 1, 800);
    const transferEfficiency = clamp(fighter.spec?.spinnerEnergyTransferEfficiency ?? 0.42, 0.02, 1.5);
    const energyImpulse = Math.sqrt(Math.max(0, 2 * mass * spinnerEnergy(fighter) * transferEfficiency));
    const cap = Number.isFinite(fighter.spec?.spinnerImpactCap) ? fighter.spec.spinnerImpactCap : 7.5;
    if (weaponEffectiveness(fighter) <= 0) return false;
    const minImpulse = 0.2;
    const floorLaunchCap = Number.isFinite(fighter.spec?.spinnerFloorLaunchCap)
      ? fighter.spec.spinnerFloorLaunchCap
      : cap * 0.65;
    const impulseMag = clamp(
      energyImpulse * floorBite * (floorLaunchActive ? 0.34 : 0.26),
      minImpulse,
      Math.max(minImpulse, floorLaunchActive ? floorLaunchCap : cap * 0.65),
    );
    callbacks.recordWeaponEvent?.({
      kind: floorLaunchActive ? "spinnerFloorLaunch" : "spinnerFloor",
      attacker: fighter.spec?.id || null,
      speedRatio,
      floorBite,
      floorLaunchTilt,
      energy: spinnerEnergy(fighter),
      energyImpulse,
      impulseMag,
      cap,
      effectiveness: weaponEffectiveness(fighter),
      currentSpeed: fighter.weapon.currentSpeed || 0,
    });
    const kickbackScale = Math.max(0, fighter.spec?.spinnerKickbackScale ?? 1);
    const horizontal = impulseMag * biases.kickback * (0.55 + floorBite * 0.55) * kickbackScale;
    const lift = impulseMag * (0.18 + biases.lift * 0.24) * floorBite;
    if (floorLaunchActive) {
      const center = fighter.rb.translation();
      const sparkPoint = weaponFloor.point || weaponPoint;
      const away = new THREE.Vector3(center.x - sparkPoint.x, 0, center.z - sparkPoint.z);
      if (away.lengthSq() < 0.0001) away.copy(forward).multiplyScalar(-1);
      away.normalize();
      const launchScale = Math.max(0.1, fighter.spec?.spinnerFloorLaunchScale ?? 1);
      const launchHorizontal = horizontal * (0.75 + floorLaunchTilt * 0.65) * launchScale;
      const launchLift = impulseMag * (0.75 + speedRatio * 0.45 + floorLaunchTilt * 0.7) * floorBite * launchScale;
      fighter.rb.applyImpulse({ x: away.x * launchHorizontal, y: launchLift, z: away.z * launchHorizontal }, true);
    } else {
      fighter.rb.applyImpulse({ x: -forward.x * horizontal, y: -lift, z: -forward.z * horizontal }, true);
    }
    fighter.rb.applyTorqueImpulse({
      x: -right.x * horizontal * 0.18,
      y: -impulseMag * biases.yaw * 0.42 * SPINNER_EXTRA_TORQUE_SCALE * kickbackScale * floorBite,
      z: -right.z * horizontal * 0.18,
    }, true);
    drainSpinner(
      fighter,
      floorLaunchActive
        ? clamp(0.72 + floorBite * 0.18 + floorLaunchTilt * 0.12, 0.72, 0.94)
        : clamp(0.22 + floorBite * 0.34, 0.22, 0.62),
      floorLaunchActive ? 0.02 : 0.08,
    );
    markHit(fighter, 0.42);
    const sparkPoint = weaponFloor.point || weaponPoint;
    callbacks.recordDamage?.({
      fighter,
      amount: impulseMag * 0.55,
      point: sparkPoint,
      normal: { x: 0, y: 1, z: 0 },
      kind: "weaponFloor",
      source: "floor",
    });
    callbacks.spawnSparks?.(new THREE.Vector3(sparkPoint.x, state.floorY + 0.08, sparkPoint.z), 12 + Math.round(impulseMag));
    return true;
  }

  function applySpinnerWallKnockback(fighter, weaponPoint, right, callbacks = {}) {
    if (!state.spinnerKnockbackEnabled || !fighter?.weapon || (fighter.weapon.type !== "bar" && fighter.weapon.type !== "drum")) return false;
    const speedRatio = clamp(spinnerPhysicalSpeed(fighter) / spinnerPhysicalMaxSpeed(fighter), 0, 1.45);
    if (speedRatio < 0.32) return false;
    // The blade reaches its own radius past the axle, so a long bar strikes the
    // wall while its pivot is still a couple of feet clear. v1's own spinners
    // carry no radius (their weapon geometry is region-split at runtime) and
    // keep the pivot-distance behaviour they were tuned with; ported entries
    // measure their swept radius in the catalog, so use it.
    const sweep = Math.max(0, fighter.weapon.radius || 0);
    const contacts = [
      { clearance: state.arenaHalfWidth - weaponPoint.x - sweep, side: new THREE.Vector3(1, 0, 0) },
      { clearance: state.arenaHalfWidth + weaponPoint.x - sweep, side: new THREE.Vector3(-1, 0, 0) },
      { clearance: state.arenaHalfLength - weaponPoint.z - sweep, side: new THREE.Vector3(0, 0, 1) },
      { clearance: state.arenaHalfLength + weaponPoint.z - sweep, side: new THREE.Vector3(0, 0, -1) },
    ];
    const contact = contacts
      .map((item) => ({ ...item, bite: clamp(1 - item.clearance / 0.55, 0, 1) }))
      .sort((a, b) => b.bite - a.bite)[0];
    if (!contact || contact.bite <= 0) return false;
    fighter.weapon.hitCooldowns ||= new Map();
    const key = "__spinner_wall__";
    const now = nowSeconds();
    if (now - (fighter.weapon.hitCooldowns.get(key) || 0) < 0.24) return false;
    fighter.weapon.hitCooldowns.set(key, now);
    const biases = SPINNER_BIASES[fighter.spec?.weaponRotationalInertiaType || "vertical-front"] || SPINNER_BIASES["vertical-front"];
    const mass = clamp(bodyMass(fighter.rb), 1, 800);
    const transferEfficiency = clamp(fighter.spec?.spinnerEnergyTransferEfficiency ?? 0.42, 0.02, 1.5);
    const energyImpulse = Math.sqrt(Math.max(0, 2 * mass * spinnerEnergy(fighter) * transferEfficiency));
    const cap = Number.isFinite(fighter.spec?.spinnerImpactCap) ? fighter.spec.spinnerImpactCap : 7.5;
    if (weaponEffectiveness(fighter) <= 0) return false;
    const minImpulse = 0.2;
    const impulseMag = clamp(energyImpulse * contact.bite * 0.5, minImpulse, Math.max(minImpulse, cap * 0.85));
    callbacks.recordWeaponEvent?.({
      kind: "spinnerWall",
      attacker: fighter.spec?.id || null,
      speedRatio,
      bite: contact.bite,
      energy: spinnerEnergy(fighter),
      energyImpulse,
      impulseMag,
      cap,
      effectiveness: weaponEffectiveness(fighter),
      currentSpeed: fighter.weapon.currentSpeed || 0,
    });
    const reflectedLift = impulseMag * (0.13 + biases.lift * 0.22) * contact.bite;
    applySpinnerOwnerReflection(fighter, {
      side: contact.side,
      right,
      point: { x: weaponPoint.x, y: weaponPoint.y, z: weaponPoint.z },
    }, { impulseMag, lift: reflectedLift, biases, strength: 1.6 });
    drainSpinner(fighter, clamp(0.26 + contact.bite * 0.34, 0.26, 0.68), 0.08);
    markHit(fighter, 0.44);
    callbacks.recordDamage?.({
      fighter,
      amount: impulseMag * 0.78,
      point: weaponPoint,
      normal: contact.side,
      kind: "weaponWall",
      source: "wall",
    });
    callbacks.spawnSparks?.(new THREE.Vector3(weaponPoint.x, weaponPoint.y, weaponPoint.z), 14 + Math.round(impulseMag));
    return true;
  }


  function applySpinnerGyro(fighter, input = {}, dt = state.fixedDt) {
    const weapon = fighter?.weapon;
    if (!fighter?.rb || (weapon?.type !== "bar" && weapon?.type !== "drum")) return;
    const speedRatio = clamp(spinnerPhysicalSpeed(fighter) / spinnerPhysicalMaxSpeed(fighter), 0, 1.35);
    const rawSpeedDelta = Number.isFinite(weapon.lastSpeedDelta) ? weapon.lastSpeedDelta : 0;
    if (speedRatio <= 0.08 && Math.abs(rawSpeedDelta) < 0.001) return;
    const weaponWeight = Math.max(1, fighter.spec?.weaponWeightLbs || 40);
    const inertia = clamp((weaponWeight / 70) * (0.65 + (fighter.spec?.weaponRotationalInertia || 0)), 0.12, 4.4) * speedRatio;
    const gyroScale = clamp(fighter.spec?.spinnerGyroScale ?? 0.75, 0, 4);
    if (inertia <= 0.01 || gyroScale <= 0) return;
    const leftDrive = input.leftDrive !== undefined ? input.leftDrive : clamp((input.throttle || 0) + (input.turn || 0), -1, 1);
    const rightDrive = input.rightDrive !== undefined ? input.rightDrive : clamp((input.throttle || 0) - (input.turn || 0), -1, 1);
    const throttle = clamp((leftDrive + rightDrive) * 0.5, -1, 1);
    const turn = clamp((leftDrive - rightDrive) * 0.5, -1, 1);
    const biases = SPINNER_BIASES[fighter.spec?.weaponRotationalInertiaType || "vertical-front"] || SPINNER_BIASES["vertical-front"];
    const frameScale = dt * 60;
    const amount = inertia * gyroScale * 0.036 * frameScale;
    fighter.rb.applyTorqueImpulse({
      x: throttle * amount * biases.pitch,
      y: -turn * amount * biases.yaw * 0.45,
      z: -turn * amount * biases.pitch,
    }, true);
  }

  function hasStrongActiveGyro(fighter) {
    const weapon = fighter?.weapon;
    if (!fighter?.rb || (weapon?.type !== "bar" && weapon?.type !== "drum")) return false;
    if (fighter.spec?.id !== "minotaur" && fighter.spec?.id !== "tombstone") return false;
    const speedRatio = clamp(spinnerPhysicalSpeed(fighter) / spinnerPhysicalMaxSpeed(fighter), 0, 1.35);
    return speedRatio > 0.18;
  }

  function fighterDriveDemand(input = {}) {
    return Math.max(Math.abs(input.leftDrive || 0), Math.abs(input.rightDrive || 0), Math.abs(input.throttle || 0), Math.abs(input.turn || 0));
  }

  function fighterContactInfo(a, b) {
    if (!a?.rb || !b?.rb) return { touching: false, distance: Infinity, direction: new THREE.Vector3(1, 0, 0), overlap: 0 };
    const pa = a.rb.translation();
    const pb = b.rb.translation();
    const delta = new THREE.Vector3(pb.x - pa.x, 0, pb.z - pa.z);
    const distance = delta.length();
    const direction = distance > 0.0001 ? delta.clone().multiplyScalar(1 / distance) : new THREE.Vector3(1, 0, 0);
    const radius = Math.max(0.8, a.physics?.radius || 1) + Math.max(0.8, b.physics?.radius || 1);
    const overlap = radius + ESCAPE_CONTACT_SLOP - distance;
    return { touching: overlap > 0, distance, direction, overlap };
  }

  function applySoloEscapeBoost(fighter, direction, dt) {
    const mass = bodyMass(fighter.rb, 18);
    const scale = dt / DEFAULTS.fixedDt;
    const p = fighter.rb.translation();
    fighter.rb.setTranslation({ x: p.x, y: p.y + ESCAPE_SOLO_CLEARANCE_LIFT * scale, z: p.z }, true);
    const velocity = fighter.rb.linvel();
    fighter.rb.setLinvel({ x: velocity.x * 0.08, y: Math.max(velocity.y, 6.5 * scale), z: velocity.z * 0.08 }, true);
    fighter.rb.applyImpulse({
      x: 0,
      y: mass * ESCAPE_SOLO_UP_IMPULSE * scale,
      z: 0,
    }, true);
    fighter.physics.escapeStuckFor = 0;
    fighter.physics.escapeEligible = false;
    fighter.physics.escapeBoostCooldownUntil = nowSeconds() + ESCAPE_BOOST_COOLDOWN_SECONDS;
    fighter.physics.lastEscapeBoost = { kind: "solo", at: nowSeconds() };
    markHit(fighter, 0.2);
  }

  function applyPairEscapeBoost(a, b, direction, dt) {
    const scale = dt / DEFAULTS.fixedDt;
    const massA = bodyMass(a.rb, 18);
    const massB = bodyMass(b.rb, 18);
    const pa = a.rb.translation();
    const pb = b.rb.translation();
    const shift = 0.48 * scale;
    a.rb.setTranslation({ x: pa.x - direction.x * shift, y: pa.y + 0.18 * scale, z: pa.z - direction.z * shift }, true);
    b.rb.setTranslation({ x: pb.x + direction.x * shift, y: pb.y + 0.18 * scale, z: pb.z + direction.z * shift }, true);
    a.rb.applyImpulse({
      x: -direction.x * massA * ESCAPE_PAIR_PUSH_IMPULSE * scale,
      y: massA * ESCAPE_PAIR_UP_IMPULSE * scale,
      z: -direction.z * massA * ESCAPE_PAIR_PUSH_IMPULSE * scale,
    }, true);
    b.rb.applyImpulse({
      x: direction.x * massB * ESCAPE_PAIR_PUSH_IMPULSE * scale,
      y: massB * ESCAPE_PAIR_UP_IMPULSE * scale,
      z: direction.z * massB * ESCAPE_PAIR_PUSH_IMPULSE * scale,
    }, true);
    a.rb.applyTorqueImpulse({ x: direction.z * massA * ESCAPE_PAIR_SPIN_IMPULSE * scale, y: massA * 0.42 * scale, z: -direction.x * massA * ESCAPE_PAIR_SPIN_IMPULSE * scale }, true);
    b.rb.applyTorqueImpulse({ x: -direction.z * massB * ESCAPE_PAIR_SPIN_IMPULSE * scale, y: -massB * 0.42 * scale, z: direction.x * massB * ESCAPE_PAIR_SPIN_IMPULSE * scale }, true);
    [a, b].forEach((fighter) => {
      fighter.physics.escapeStuckFor = 0;
      fighter.physics.escapeEligible = false;
      fighter.physics.escapeBoostCooldownUntil = nowSeconds() + ESCAPE_BOOST_COOLDOWN_SECONDS;
      fighter.physics.lastEscapeBoost = { kind: "pair", at: nowSeconds() };
      markHit(fighter, 0.2);
    });
  }

  function updateEscapeBoosts(fighters = [], inputs = [], dt = state.fixedDt) {
    if (fighters.length < 1) return;
    const now = nowSeconds();
    const pair = fighters.length >= 2 ? fighterContactInfo(fighters[0], fighters[1]) : null;
    if (pair) {
      const a = fighters[0];
      const b = fighters[1];
      const va = a.rb.linvel();
      const vb = b.rb.linvel();
      const relativeSpeed = Math.hypot(va.x - vb.x, va.z - vb.z);
      const bothDriving = fighterDriveDemand(inputs[0]) > ESCAPE_DRIVE_DEMAND && fighterDriveDemand(inputs[1]) > ESCAPE_DRIVE_DEMAND;
      const stableDirection = !a.physics?.interlockDirection || a.physics.interlockDirection.dot(pair.direction) > ESCAPE_INTERLOCK_DIRECTION_DOT - 0.32;
      const interlocked = pair.touching && bothDriving && relativeSpeed < ESCAPE_PAIR_RELATIVE_SPEED && stableDirection;
      const nextFor = interlocked ? (a.physics?.interlockFor || 0) + dt : 0;
      fighters.forEach((fighter) => {
        fighter.physics.interlockFor = nextFor;
        fighter.physics.interlockDirection = pair.direction.clone();
        fighter.physics.interlockEligible = nextFor >= ESCAPE_STUCK_SECONDS;
      });
      if (
        nextFor >= ESCAPE_STUCK_SECONDS &&
        inputs[0]?.boostActive &&
        inputs[1]?.boostActive &&
        now >= (a.physics?.escapeBoostCooldownUntil || 0) &&
        now >= (b.physics?.escapeBoostCooldownUntil || 0)
      ) {
        applyPairEscapeBoost(a, b, pair.direction, dt);
        return;
      }
    }

    fighters.forEach((fighter, index) => {
      if (!fighter?.rb || !fighter.physics) return;
      const input = inputs[index] || {};
      const other = fighters.find((candidate) => candidate !== fighter);
      const contact = other ? fighterContactInfo(fighter, other) : { touching: false, direction: new THREE.Vector3(1, 0, 0) };
      const velocity = fighter.rb.linvel();
      const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
      const driving = fighterDriveDemand(input) > ESCAPE_DRIVE_DEMAND;
      const notMoving = horizontalSpeed < ESCAPE_STATIONARY_SPEED * 2;
      const cooldownReady = now >= (fighter.physics.escapeBoostCooldownUntil || 0);
      const stuck = driving && notMoving && !contact.touching;
      fighter.physics.escapeStuckFor = stuck ? (fighter.physics.escapeStuckFor || 0) + dt : 0;
      fighter.physics.escapeEligible = fighter.physics.escapeStuckFor >= ESCAPE_STUCK_SECONDS && cooldownReady;
      if (fighter.physics.escapeEligible && input.boostActive) {
        const { forward } = yawBasis(fighter, THREE);
        applySoloEscapeBoost(fighter, forward, dt);
      }
    });
  }

  function applyFlipperHit(attacker, target, contact, callbacks = {}) {
    const key = target.fighter?.spec?.id || target.prop?.kind || target.rb?.handle;
    attacker.weapon.hitCooldowns ||= new Map();
    const now = nowSeconds();
    if (now - (attacker.weapon.hitCooldowns.get(key) || 0) < BRONCO_FLIPPER.hitCooldownSeconds) return false;
    attacker.weapon.hitCooldowns.set(key, now);
    const effectiveness = weaponEffectiveness(attacker);
    if (effectiveness <= 0) return false;
    const contactPoint = new THREE.Vector3(contact.point.x, contact.point.y, contact.point.z);
    if (target.fighter) {
      const flipperTargetQuery = { bodyVerticalPad: 0.26, wedgeVerticalPad: 0.38 };
      const targetParts = [
        ...fighterPartsAtPoint(target.fighter, contact.targetPoint || contact.point, flipperTargetQuery),
        ...fighterPartsAtPoint(target.fighter, contact.point, flipperTargetQuery),
      ].filter((part, index, parts) => parts.indexOf(part) === index);
      if (targetParts.length === 0) return false;
      const weaponOnlyHit = targetParts.every((part) => part.part === "weapon");
      if (weaponOnlyHit) {
        const targetMass = clamp(bodyMass(target.rb), 1, 800);
        const attackerMass = clamp(bodyMass(attacker.rb), 1, 800);
        const massRatio = clamp(targetMass / attackerMass, 0.7, 1.35);
        const recoilImpulse = 0.42 * attackerMass * effectiveness * massRatio;
        applyImpulseAtPoint(attacker.rb, {
          x: -contact.side.x * recoilImpulse,
          y: 0.18 * recoilImpulse,
          z: -contact.side.z * recoilImpulse,
        }, contactPoint);
        markHit(attacker, 0.42);
        callbacks.recordWeaponEvent?.({
          kind: "flipperWeaponHit",
          attacker: attacker.spec?.id || null,
          target: target.fighter?.spec?.id || null,
          effectiveness,
          weaponOnlyHit: true,
        });
        callbacks.recordDamage?.({
          fighter: attacker,
          amount: 12 * effectiveness * massRatio,
          point: contactPoint,
          normal: contact.side,
          kind: "flipperWeaponHit",
          source: target.fighter,
        });
        callbacks.spawnSparks?.(contactPoint, 6);
        return true;
      }
    }
    const strength = (target.fighter ? 1 : BRONCO_FLIPPER.propStrength) * effectiveness;
    const targetPosition = target.rb.translation();
    const centerToContact = contactPoint.clone().sub(new THREE.Vector3(targetPosition.x, contactPoint.y, targetPosition.z));
    const targetRadius = Math.max(0.35, target.fighter?.physics?.radius || target.prop?.radius || 1.1);
    const leverRatio = clamp(centerToContact.length() / targetRadius, 0, 1);
    const liftScale = 0.72 + (1 - leverRatio) * 0.28;
    const pitchLeverageScale = 0.38 + leverRatio * 1.24;
    callbacks.recordWeaponEvent?.({
      kind: attacker.weapon?.type === "crusher" ? "crusherHit" : "flipperHit",
      attacker: attacker.spec?.id || null,
      target: target.fighter?.spec?.id || target.prop?.kind || null,
      effectiveness,
      strength,
      leverRatio,
      liftScale,
      pitchLeverageScale,
    });
    const targetMass = clamp(bodyMass(target.rb), 1, 800);
    const attackerMass = clamp(bodyMass(attacker.rb), 1, 800);
    const massRatio = clamp(attackerMass / targetMass, 0.78, 1.22);
    const velocity = target.rb.linvel?.() || { x: 0, y: 0, z: 0 };
    const targetLiftVelocity = Number.isFinite(attacker.spec?.targetLiftVelocity) ? attacker.spec.targetLiftVelocity : BRONCO_FLIPPER.targetLiftVelocity;
    const targetPitchVelocity = Number.isFinite(attacker.spec?.targetPitchVelocity) ? attacker.spec.targetPitchVelocity : BRONCO_FLIPPER.targetPitchVelocity;
    const upwardCorrection = Math.max(0, BRONCO_FLIPPER.targetCorrectionVelocity - velocity.y);
    const liftVelocity = (upwardCorrection + targetLiftVelocity * liftScale) * massRatio * strength;
    const forwardVelocity = BRONCO_FLIPPER.targetForwardVelocity * massRatio * strength;
    const impulse = {
      x: contact.side.x * forwardVelocity * targetMass,
      y: liftVelocity * targetMass,
      z: contact.side.z * forwardVelocity * targetMass,
    };
    applyImpulseAtPoint(target.rb, impulse, contactPoint);
    const pitchTorque = targetPitchVelocity * targetMass * massRatio * strength * pitchLeverageScale;
    target.rb.applyTorqueImpulse({
      x: contact.right.x * pitchTorque * FLIPPER_EXTRA_TORQUE_SCALE,
      y: 0.24 * targetMass * strength * FLIPPER_EXTRA_TORQUE_SCALE,
      z: contact.right.z * pitchTorque * FLIPPER_EXTRA_TORQUE_SCALE,
    }, true);
    if (attacker.spec?.id === "bronco") {
      const attackerPosition = attacker.rb.translation();
      attacker.physics ||= {};
      attacker.physics.noFlipperTargetRecoilUntil = now + 0.34;
      attacker.physics.noFlipperTargetRecoilBaseY = attackerPosition.y;
    }
    markHit(attacker, 0.4);
    if (target.fighter) markHit(target.fighter, 0.75);
    callbacks.recordDamage?.({
      fighter: target.fighter,
      amount: 12.5 * strength * massRatio,
      point: contactPoint,
      normal: new THREE.Vector3(-contact.side.x, -contact.side.y, -contact.side.z),
      kind: "flipper",
      source: attacker,
    });
    callbacks.recordDamage?.({
      fighter: attacker,
      amount: 1.75 * strength,
      point: contactPoint,
      normal: contact.side,
      kind: "flipperRecoil",
      source: target.fighter || target.prop || null,
    });
    if (target.prop?.kind !== "botDamagePiece") callbacks.spawnSparks?.(contactPoint, 8);
    return true;
  }

  // Hits from the mechanisms v1 gained with the ported roster. Everything here
  // is expressed the way v1's flipper path already speaks: velocities imparted
  // to the target, converted to impulses through its mass, plus a pitch torque
  // about the contact. That is what keeps a ported bot feeling like a v1 bot
  // instead of like a second physics engine bolted on.
  //
  // Three shapes, from armWeapons.js:
  //   hammer — one blow per stroke, weighted by stroke^2 so a graze near the
  //            top of the arc is worth almost nothing, driving DOWN not up.
  //   grind  — continuous while the arm is down and the disc is turning.
  //   lift   — spread across the stroke: an arm that is HELD hoists rather than
  //            throws, and carries what it has picked up while it stays up.
  function applyArmWeaponHit(attacker, target, contact, dt, callbacks = {}) {
    const weapon = attacker?.weapon;
    const profile = armHitProfile(weapon);
    if (!profile || !target?.rb) return false;
    const effectiveness = weaponEffectiveness(attacker);
    if (effectiveness <= 0) return false;
    const targetMass = clamp(bodyMass(target.rb), 1, 800);
    const attackerMass = clamp(bodyMass(attacker.rb), 1, 800);
    const massRatio = clamp(attackerMass / targetMass, 0.78, 1.22);
    const strength = (target.fighter ? 1 : 0.55) * effectiveness;
    const point = new THREE.Vector3(contact.point.x, contact.point.y, contact.point.z);
    const side = contact.side;
    const right = contact.right;

    if (profile.kind === "hammer") {
      weapon.impulseStrokeHits ||= new Set();
      const key = target.fighter?.spec?.id || target.prop?.kind || "target";
      if (weapon.impulseStrokeHits.has(key)) return false;
      const stroke = clamp(weapon.stroke || 0, 0, 1);
      const power = stroke * stroke;
      if (power < 0.05) return false;
      weapon.impulseStrokeHits.add(key);
      const vertical = (profile.liftVelocity - profile.downVelocity) * power * massRatio * strength;
      const forwardVelocity = profile.forwardVelocity * power * massRatio * strength;
      applyImpulseAtPoint(target.rb, {
        x: side.x * forwardVelocity * targetMass,
        y: vertical * targetMass,
        z: side.z * forwardVelocity * targetMass,
      }, point);
      const pitchTorque = profile.pitchVelocity * targetMass * power * massRatio * strength;
      target.rb.applyTorqueImpulse({
        x: right.x * pitchTorque * FLIPPER_EXTRA_TORQUE_SCALE,
        y: 0.18 * targetMass * power * strength * FLIPPER_EXTRA_TORQUE_SCALE,
        z: right.z * pitchTorque * FLIPPER_EXTRA_TORQUE_SCALE,
      }, true);
      // The head stops dead on what it hits; the machine behind it does not.
      // Beta stands on magnets for this reason, so the reaction is damped
      // rather than free (weapon.arm.downforce is the catalog's figure).
      const reaction = profile.recoil * (weapon.arm?.downforce ? 0.5 : 1);
      applyImpulseAtPoint(attacker.rb, {
        x: -side.x * forwardVelocity * attackerMass * reaction,
        y: Math.abs(vertical) * attackerMass * reaction * 0.35,
        z: -side.z * forwardVelocity * attackerMass * reaction,
      }, point);
      markHit(attacker, 0.34);
      if (target.fighter) markHit(target.fighter, 0.7);
      callbacks.recordWeaponEvent?.({
        kind: "hammerHit",
        attacker: attacker.spec?.id || null,
        target: target.fighter?.spec?.id || target.prop?.kind || null,
        stroke,
        power,
        effectiveness,
      });
      callbacks.recordDamage?.({
        fighter: target.fighter,
        amount: profile.damage * power * strength * massRatio,
        point,
        normal: new THREE.Vector3(-side.x, -side.y, -side.z),
        kind: "hammer",
        source: attacker,
      });
      callbacks.spawnSparks?.(point, 10);
      return true;
    }

    if (profile.kind === "grind") {
      const bite = clamp(weapon.subRatio ?? 0, 0, 1) * clamp(weapon.stroke || 0, 0, 1);
      if (bite <= 0.02) return false;
      const scale = dt * 60;
      applyImpulseAtPoint(target.rb, {
        x: side.x * profile.forwardVelocity * targetMass * bite * strength * scale * 0.02,
        y: (profile.liftVelocity - profile.downVelocity) * targetMass * bite * strength * scale * 0.02,
        z: side.z * profile.forwardVelocity * targetMass * bite * strength * scale * 0.02,
      }, point);
      markHit(attacker, 0.16);
      callbacks.recordDamage?.({
        fighter: target.fighter,
        amount: profile.damagePerSecond * dt * bite * strength,
        point,
        normal: new THREE.Vector3(-side.x, -side.y, -side.z),
        kind: "saw",
        source: attacker,
      });
      weapon.grindSparkCharge = (weapon.grindSparkCharge || 0) + dt * bite * 22;
      if (weapon.grindSparkCharge >= 1) {
        weapon.grindSparkCharge = 0;
        callbacks.spawnSparks?.(point, 5);
      }
      return true;
    }

    // profile.kind === "lift"
    const rise = Math.max(0, weapon.strokeDelta || 0);
    const holding = clamp(weapon.stroke || 0, 0, 1);
    const gripping = weapon.claw ? (weapon.clawAmount || 0) > 0.5 : true;
    let acted = false;
    if (rise > 0 && gripping) {
      const liftVelocity = profile.liftVelocity * rise * massRatio * strength;
      const forwardVelocity = profile.forwardVelocity * rise * massRatio * strength;
      applyImpulseAtPoint(target.rb, {
        x: side.x * forwardVelocity * targetMass,
        y: liftVelocity * targetMass,
        z: side.z * forwardVelocity * targetMass,
      }, point);
      const pitchTorque = profile.pitchVelocity * targetMass * rise * massRatio * strength;
      target.rb.applyTorqueImpulse({
        x: right.x * pitchTorque * FLIPPER_EXTRA_TORQUE_SCALE,
        y: 0,
        z: right.z * pitchTorque * FLIPPER_EXTRA_TORQUE_SCALE,
      }, true);
      // What goes up pushes the lifter down: that is the reaction, and it is
      // why a lifter with its arm up is easy to shove.
      applyImpulseAtPoint(attacker.rb, {
        x: 0,
        y: -liftVelocity * attackerMass * profile.recoil,
        z: 0,
      }, point);
      markHit(attacker, 0.2);
      if (target.fighter) markHit(target.fighter, 0.4);
      acted = true;
    }
    if (holding > 0.35) {
      // Carry: hold part of the victim's weight while the arm is up, so a bot
      // that has been scooped rides instead of sliding straight back off.
      const support = clamp(holding, 0, 1) * 0.42 * strength;
      target.rb.applyImpulse({ x: 0, y: targetMass * 32.174 * support * dt, z: 0 }, true);
      acted = true;
    }
    const holdDamage = profile.damagePerSecond * holding;
    const discDamage = profile.discDamagePerSecond * clamp(weapon.subRatio ?? 0, 0, 1);
    const damage = (holdDamage + discDamage) * dt * strength;
    if (damage > 0) {
      callbacks.recordDamage?.({
        fighter: target.fighter,
        amount: damage,
        point,
        normal: new THREE.Vector3(-side.x, -side.y, -side.z),
        kind: discDamage > holdDamage ? "saw" : "lifter",
        source: attacker,
      });
      weapon.grindSparkCharge = (weapon.grindSparkCharge || 0) + dt * (discDamage > 0 ? 16 : 4);
      if (weapon.grindSparkCharge >= 1) {
        weapon.grindSparkCharge = 0;
        callbacks.spawnSparks?.(point, 4);
      }
      acted = true;
    }
    if (acted) {
      callbacks.recordWeaponEvent?.({
        kind: "armHold",
        attacker: attacker.spec?.id || null,
        target: target.fighter?.spec?.id || target.prop?.kind || null,
        stroke: holding,
        rise,
        gripping,
      });
    }
    return acted;
  }

  function applyWeaponImpacts({ arena, attacker, active, dt = state.fixedDt, callbacks = {} }) {
    if (!active || !attacker?.weapon) return;
    const isSpinner = attacker.weapon.type === "bar" || attacker.weapon.type === "drum";
    const isFlipper = attacker.weapon.type === "flipper" || attacker.weapon.type === "meshFlipper";
    const isCrusher = attacker.weapon.type === "crusher";
    // Hammers, saw arms, lifters and grapplers: mechanisms v1 did not have
    // before the v2 roster arrived. They reach from the arm rather than from
    // the chassis, and each shapes its hit differently (see armWeapons.js).
    const isArm = isNewArmWeapon(attacker.weapon);
    if (!isSpinner && !isFlipper && !isCrusher && !isArm) return;
    const origin = attacker.rb.translation();
    const { forward, right } = yawBasis(attacker, THREE);
    const weaponPoint = new THREE.Vector3(origin.x, origin.y + 0.26, origin.z).addScaledVector(forward, isSpinner ? 0.7 : 1.25);
    // A spinner measures from its rotor, which is where its damage comes from.
    // An ARM does not: its hinge can sit at the back of the machine (Duck's plow
    // swings on a pivot between the axles) while the business end is out front,
    // so an arm keeps v1's chassis-relative measuring point — which is also the
    // frame the ported reach numbers were derived in.
    if (isSpinner && attacker.weapon.object) attacker.weapon.object.getWorldPosition(weaponPoint);
    const targets = [
      ...arena.fighters.filter((fighter) => fighter !== attacker).map((fighter) => ({ rb: fighter.rb, fighter, kind: "bot" })),
      ...arena.props.map((prop) => ({ rb: prop.rb, prop, kind: "prop" })),
    ];
    targets.forEach((target) => {
      const p = target.rb.translation();
      const toTarget = new THREE.Vector3(p.x - weaponPoint.x, 0, p.z - weaponPoint.z);
      const distance = toTarget.length();
      const reach = isSpinner
        ? Math.max(0.35, attacker.spec?.spinnerReach ?? 1.45)
        : isArm
          ? armWeaponReach(attacker.weapon, attacker.spec)
          : 1.72;
      if (distance > reach) return;
      const side = distance > 0.001 ? toTarget.multiplyScalar(1 / distance) : forward.clone();
      const facing = side.dot(forward);
      if (facing < (isSpinner ? -0.25 : 0.05)) return;
      const targetRadius = Math.max(0.35, target.fighter?.physics?.radius || target.prop?.radius || 1.1);
      const edgeOffset = isFlipper ? Math.min(targetRadius * 0.82, distance * 0.72) : 0;
      const contactPoint = isFlipper
        ? new THREE.Vector3(p.x, origin.y + 0.32, p.z).addScaledVector(side, -edgeOffset)
        : new THREE.Vector3(
            weaponPoint.x + side.x * Math.min(distance, 0.7),
            isSpinner ? weaponPoint.y : origin.y + 0.32,
            weaponPoint.z + side.z * Math.min(distance, 0.7),
          );
      const targetSurfaceOffset = Math.min(targetRadius * 1.2, Math.max(0.05, distance));
      const targetContactPoint = new THREE.Vector3(p.x, contactPoint.y, p.z).addScaledVector(side, -targetSurfaceOffset);
      const contact = {
        side,
        right,
        point: {
          x: contactPoint.x,
          y: contactPoint.y,
          z: contactPoint.z,
        },
        targetPoint: {
          x: targetContactPoint.x,
          y: targetContactPoint.y,
          z: targetContactPoint.z,
        },
      };
      if (isSpinner) applySpinnerHit(attacker, target, contact, dt, callbacks);
      else if (isArm) applyArmWeaponHit(attacker, target, contact, dt, callbacks);
      else if (isFlipper) applyFlipperHit(attacker, target, contact, callbacks);
      else if (isCrusher && target.fighter) {
        callbacks.recordQuantumBiteDamage?.(attacker, target, contact.targetPoint || contact.point, side.clone().negate(), dt);
        target.rb.applyImpulse({ x: side.x * 0.055, y: 0.018, z: side.z * 0.055 }, true);
      } else if (isCrusher && target.prop?.breakable) {
        target.prop.jawPressure = (target.prop.jawPressure || 0) + dt * 0.75;
        target.rb.applyImpulse({ x: side.x * 0.1, y: 0.04, z: side.z * 0.1 }, true);
      }
    });
    if (isSpinner) applySpinnerFloorKnockback(attacker, weaponPoint, forward, right, dt, callbacks);
    if (isSpinner) applySpinnerWallKnockback(attacker, weaponPoint, right, callbacks);
  }

  function afterStep({ arena, fighters, inputs, preStepMotion, dt = state.fixedDt, callbacks = {} }) {
    updateEscapeBoosts(fighters, inputs, dt);
    fighters.forEach((fighter, index) => {
      if (!fighter?.rb) return;
      const input = inputs[index] || {};
      const ground = fighterGroundInfo(fighter, THREE, state.floorY);
      const before = preStepMotion?.get?.(fighter);
      const landingSpeed = Math.max(0, -(before?.lin?.y || 0));
      const recentHit = isInHitGrace(fighter) || isInOwnerRecoilGrace(fighter);
      const now = nowSeconds();
      const brakeTiltRemaining = Math.max(0, (fighter.physics?.brakeTiltUntil || 0) - now);
      const brakeTiltFade = clamp(brakeTiltRemaining / BRAKE_FORWARD_TILT_SECONDS, 0, 1);
      const brakeFloorUnderride = BRAKE_FORWARD_TILT_ENABLED ? BRAKE_FORWARD_TILT_FLOOR_UNDERRIDE * brakeTiltFade : 0;
      const up = upVector(fighter, THREE);
      const debugStep = {
        ground: {
          minY: ground.minY,
          left: ground.left,
          right: ground.right,
          front: ground.front,
          back: ground.back,
          leftTrack: ground.leftTrack,
          rightTrack: ground.rightTrack,
          leftEdge: ground.leftEdge,
          rightEdge: ground.rightEdge,
          topLeftTrack: ground.topLeftTrack,
          topRightTrack: ground.topRightTrack,
          grounded: ground.grounded,
          topGrounded: ground.topGrounded,
          solidGrounded: ground.solidGrounded,
          topSolidGrounded: ground.topSolidGrounded,
        },
        floorLift: 0,
        verticalCorrection: 0,
        edgeSettleImpulse: 0,
        tumbleDamping: 0,
        yawDamping: 0,
        groundedStableFor: fighter.physics?.groundedStableFor || 0,
        landingSpeed,
        recentHit,
      };
      if (Number.isFinite(ground.minY)) {
        const lift = state.floorY - brakeFloorUnderride + 0.006 - ground.minY;
        const allowFloorLift = lift < 0.08 || Math.abs(up.y) > 0.86;
        if (lift > 0 && allowFloorLift) {
          const selfRighting =
            (fighter.selfRightingUntil && now < fighter.selfRightingUntil) ||
            fighter.spec?.id === "bronco";
          const softFloorActive = state.softFloorCorrectionEnabled && !selfRighting;
          const appliedLift = softFloorActive
            ? lift <= SOFT_FLOOR_FULL_LIFT_THRESHOLD
              ? lift
              : Math.min(lift * 0.55, SOFT_FLOOR_MAX_LIFT_PER_STEP)
            : lift;
          debugStep.floorLift = appliedLift;
          debugStep.floorLiftRequested = lift;
          debugStep.softFloorCorrection = softFloorActive;
          const p = fighter.rb.translation();
          fighter.rb.setTranslation({ x: p.x, y: p.y + appliedLift, z: p.z }, true);
          const v = fighter.rb.linvel();
          if (v.y < 0) {
            debugStep.verticalCorrection = -v.y;
            const nextY = softFloorActive
              ? lift > 0.035
                ? Math.max(v.y * SOFT_FLOOR_DEEP_DOWNWARD_DAMPING, -SOFT_FLOOR_DEEP_MAX_DOWNWARD_SPEED)
                : Math.max(v.y * SOFT_FLOOR_DOWNWARD_DAMPING, -SOFT_FLOOR_MAX_DOWNWARD_SPEED)
              : 0;
            fighter.rb.setLinvel({ x: v.x, y: nextY, z: v.z }, true);
          }
        }
      }
      const velocity = fighter.rb.linvel();
      const angular = fighter.rb.angvel();
      const traction = tractionForFighter(fighter);
      const solidGrounded = ground.solidGrounded;
      const driveStabilizingGround = traction.canNormalDrive ? (traction.driveSolidGrounded || 0) : 0;
      const stabilizingSolidGrounded = Math.max(solidGrounded, driveStabilizingGround);
      const edgeGrounded = ground.edgeGrounded;
      let settleTorque = null;
      const strongActiveGyro = hasStrongActiveGyro(fighter);
      const gyroSelfRightingPosture = strongActiveGyro && up.y < 0.35;
      const driveDemand = Math.max(Math.abs(input.leftDrive || 0), Math.abs(input.rightDrive || 0), Math.abs(input.throttle || 0), Math.abs(input.turn || 0));
      const p = fighter.rb.translation();
      const restingY = fighter.restingBodyY ?? state.floorY;
      const weaponDemand = Boolean(input.weapon || input.weaponActive || input.fire || input.trigger);
      let uprightBroncoTargetFlip = false;
      if (fighter.spec?.id === "bronco" && weaponDemand && up.y > 0.86 && !fighter.selfRightingUntil) {
        const { forward, right } = yawBasis(fighter, THREE);
        uprightBroncoTargetFlip = arena?.fighters?.some?.((other) => {
          if (!other?.rb || other === fighter) return false;
          const otherPosition = other.rb.translation();
          const toTarget = new THREE.Vector3(otherPosition.x - p.x, 0, otherPosition.z - p.z);
          const localForward = toTarget.dot(forward);
          const localRight = toTarget.dot(right);
          const localVertical = otherPosition.y - p.y;
          return localForward > 0.3 && localForward < 2.15 && Math.abs(localRight) < 1.15 && localVertical > -0.35 && localVertical < 1.2;
        });
        if (uprightBroncoTargetFlip) {
          fighter.physics ||= {};
          fighter.physics.noFlipperTargetRecoilBaseY = Number.isFinite(fighter.physics.noFlipperTargetRecoilBaseY)
            ? Math.min(fighter.physics.noFlipperTargetRecoilBaseY, p.y)
            : p.y;
        }
      }
      const suppressFlipperTargetRecoil =
        fighter.spec?.id === "bronco" &&
        (fighter.physics?.noFlipperTargetRecoilUntil > now || uprightBroncoTargetFlip) &&
        !fighter.selfRightingUntil &&
        up.y > 0.86;
      if (suppressFlipperTargetRecoil) {
        debugStep.suppressFlipperTargetRecoil = true;
        const velocity = fighter.rb.linvel();
        const angular = fighter.rb.angvel();
        const recoilBaseY = Number.isFinite(fighter.physics.noFlipperTargetRecoilBaseY)
          ? fighter.physics.noFlipperTargetRecoilBaseY
          : restingY;
        const recoilLiftCap = 0.03;
        if (p.y > recoilBaseY + recoilLiftCap) {
          fighter.rb.setTranslation({ x: p.x, y: recoilBaseY + recoilLiftCap, z: p.z }, true);
        }
        fighter.rb.setLinvel({ x: velocity.x, y: Math.min(velocity.y, 0), z: velocity.z }, true);
        fighter.rb.setAngvel({ x: angular.x * 0.35, y: angular.y, z: angular.z * 0.35 }, true);
      }
      const ceilingReleaseY = state.arenaCeilingHeight - 0.46;
      if (Number.isFinite(ceilingReleaseY) && p.y > ceilingReleaseY) {
        const ceilingVelocity = fighter.rb.linvel();
        debugStep.ceilingRelease = p.y - ceilingReleaseY;
        fighter.physics ||= {};
        if (now - (fighter.physics.lastCeilingDamageAt || 0) >= CEILING_HIT_DAMAGE_COOLDOWN_SECONDS) {
          fighter.physics.lastCeilingDamageAt = now;
          callbacks.recordDamage?.({
            fighter,
            amount: 0,
            percentAmount: CEILING_HIT_EXTRA_DAMAGE_PERCENT,
            point: new THREE.Vector3(p.x, state.arenaCeilingHeight, p.z),
            normal: new THREE.Vector3(0, -1, 0),
            kind: "ceiling",
            source: "ceiling",
          });
        }
        fighter.rb.setTranslation({ x: p.x, y: ceilingReleaseY, z: p.z }, true);
        fighter.rb.setLinvel({
          x: ceilingVelocity.x,
          y: Math.min(ceilingVelocity.y, recentHit ? -3.2 : -1.2),
          z: ceilingVelocity.z,
        }, true);
        fighter.rb.wakeUp?.();
      }
      if (driveDemand < 0.05 && edgeGrounded < 0.05 && Math.abs(up.y) < 0.75 && p.y > restingY + 0.28 && Math.abs(velocity.y) < 0.12) {
        debugStep.airborneWake = true;
        fighter.rb.wakeUp?.();
        fighter.rb.setLinvel({ x: velocity.x, y: -0.65, z: velocity.z }, true);
      }
      const stableGround = stabilizingSolidGrounded > SETTLED_SOLID_GROUND_THRESHOLD && Math.abs(up.y) > SETTLED_UPRIGHT_Y;
      if (fighter.physics) {
        fighter.physics.groundedStableFor = stableGround ? (fighter.physics.groundedStableFor || 0) + dt : 0;
        debugStep.groundedStableFor = fighter.physics.groundedStableFor;
      }
      const hugeDriveRightingScale = fighter.spec?.id === "huge"
        ? clamp((driveDemand - 0.04) / 0.62, 0, 1)
        : 1;
      if (!gyroSelfRightingPosture && hugeDriveRightingScale > 0 && edgeGrounded > 0.18 && solidGrounded < 0.12 && Math.abs(up.y) < 0.985) {
        const targetUpY = fighter.spec?.canDriveInverted && up.y < 0 ? -1 : 1;
        const settleAxis = up.clone().cross(new THREE.Vector3(0, targetUpY, 0));
        if (settleAxis.lengthSq() > 0.0001) {
          settleAxis.normalize();
          const impulse = bodyMass(fighter.rb, 18) * (1 - Math.abs(up.y)) * edgeGrounded * 2.4 * hugeDriveRightingScale;
          debugStep.edgeSettleImpulse = impulse;
          settleTorque = { x: settleAxis.x * impulse, y: 0, z: settleAxis.z * impulse };
        }
      }
      const quietTeeter = driveDemand < 0.05 && !weaponDemand && p.y < restingY + 0.22 && Math.abs(velocity.y) < 0.18;
      if (state.teeterAssistEnabled && fighter.spec?.id !== "huge" && quietTeeter && edgeGrounded > 0.1 && solidGrounded < 0.2 && ground.point && fighter.physics?.centerOfMass && !recentHit) {
        const com = localBodyPointToWorld(fighter, fighter.physics.centerOfMass, THREE);
        const overhang = new THREE.Vector3(com.x - ground.point.x, 0, com.z - ground.point.z);
        const overhangDistance = overhang.length();
        const deadZone = Math.max(0.035, (fighter.visualScale || 1) * 0.04);
        if (overhangDistance > deadZone) {
          const lever = overhangDistance - deadZone;
          const impulse = Math.min(bodyMass(fighter.rb, 18) * 0.08, bodyMass(fighter.rb, 18) * lever * edgeGrounded * 0.16);
          const direction = overhang.multiplyScalar(1 / overhangDistance);
          const nextTorque = {
            x: direction.z * impulse,
            y: 0,
            z: -direction.x * impulse,
          };
          debugStep.comTeeterLever = lever;
          debugStep.comTeeterImpulse = impulse;
          settleTorque = settleTorque
            ? { x: settleTorque.x + nextTorque.x, y: 0, z: settleTorque.z + nextTorque.z }
            : nextTorque;
        }
      }
      if (!gyroSelfRightingPosture && edgeGrounded > 0.16 && Math.abs(up.y) > 0.94 && Math.abs(up.y) < NEAR_UPRIGHT_SETTLE_MAX_Y && !recentHit) {
        const targetUpY = fighter.spec?.canDriveInverted && up.y < 0 ? -1 : 1;
        const settleAxis = up.clone().cross(new THREE.Vector3(0, targetUpY, 0));
        if (settleAxis.lengthSq() > 0.0001) {
          settleAxis.normalize();
          const driveScale = 1 - clamp(driveDemand * 0.32, 0, 0.28);
          const impulse = bodyMass(fighter.rb, 18) * (1 - Math.abs(up.y)) * edgeGrounded * 7.5 * driveScale;
          debugStep.nearUprightSettleImpulse = impulse;
          const nextTorque = { x: settleAxis.x * impulse, y: 0, z: settleAxis.z * impulse };
          settleTorque = settleTorque
            ? { x: settleTorque.x + nextTorque.x, y: 0, z: settleTorque.z + nextTorque.z }
            : nextTorque;
        }
      }
      if (stabilizingSolidGrounded > 0.05 || edgeGrounded > EDGE_GROUND_THRESHOLD) {
        const { forward, right } = yawBasis(fighter, THREE);
        const hVel = new THREE.Vector3(velocity.x, 0, velocity.z);
        const forwardSpeed = hVel.dot(forward);
        const lateralSpeed = hVel.dot(right);
        const canUseDriveInput = drivePosture(fighter, THREE).canNormalDrive;
        const throttle = canUseDriveInput
          ? Math.abs(input.throttle ?? ((input.leftDrive || 0) + (input.rightDrive || 0)) * 0.5)
          : 0;
        const contactAmount = Math.max(stabilizingSolidGrounded, edgeGrounded * 0.28);
        const lateralRate = !canUseDriveInput ? 18 : recentHit ? 3.4 : 10.5;
        const rollingRate = !canUseDriveInput ? 18 : recentHit ? 0.22 : 0.72;
        const nextForward = damp(forwardSpeed, rollingRate, dt, clamp(1 - throttle, 0, 1) * contactAmount);
        const nextLateral = damp(lateralSpeed, lateralRate, dt, contactAmount);
        const next = forward.clone().multiplyScalar(nextForward).addScaledVector(right, nextLateral);
        if (!canUseDriveInput) {
          const maxDisabledSpeed = 0.28;
          const speed = next.length();
          if (speed > maxDisabledSpeed) next.multiplyScalar(maxDisabledSpeed / speed);
        }
        fighter.rb.setLinvel({ x: next.x, y: velocity.y, z: next.z }, true);
        const angularVec = new THREE.Vector3(angular.x, angular.y, angular.z);
        const yawSpin = up.clone().multiplyScalar(angularVec.dot(up));
        const tumble = angularVec.sub(yawSpin);
        const settled = (fighter.physics?.groundedStableFor || 0) >= GROUNDED_STABLE_SECONDS;
        const plantedDrive = canUseDriveInput && driveDemand > 0.05 && stabilizingSolidGrounded > 0.35 && Math.abs(up.y) > 0.86;
        const landingBoost = clamp((landingSpeed - 0.8) / 5.5, 0, 1);
        const nearUprightSettling = driveDemand < 0.05 && Math.abs(up.y) > NEAR_UPRIGHT_SETTLE_Y && contactAmount > 0.2;
        const gyroDanceScale = strongActiveGyro && up.y < 0.35 ? clamp(0.24 + Math.max(0, up.y) * 0.9, 0.24, 0.55) : 1;
        const tumbleRate = (nearUprightSettling ? 22 : settled ? 12.5 : plantedDrive ? 10.5 : landingSpeed > 0.8 ? 4.8 + landingBoost * 5.2 : 1.2) * gyroDanceScale;
        const yawRate = recentHit ? 0.025 : settled ? 0.34 : 0.12;
        const tumbleAmount = contactAmount * (recentHit ? 0.72 : 1);
        debugStep.tumbleDamping = tumbleRate * tumbleAmount;
        debugStep.yawDamping = yawRate * contactAmount;
        const scrubbed = tumble
          .multiplyScalar(Math.exp(-tumbleRate * tumbleAmount * dt))
          .add(yawSpin.multiplyScalar(Math.exp(-yawRate * contactAmount * dt)));
        fighter.rb.setAngvel({ x: scrubbed.x, y: scrubbed.y, z: scrubbed.z }, true);
        if (
          plantedDrive &&
          !input.brakeActive &&
          !recentHit &&
          !strongActiveGyro &&
          up.y > 0.96 &&
          driveStabilizingGround - solidGrounded > 0.45
        ) {
          const rotation = fighter.rb.rotation();
          const current = new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w);
          const yaw = new THREE.Euler().setFromQuaternion(current, "YXZ").y;
          const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
          const lockBlend = clamp(dt * 16 * driveStabilizingGround, 0, 0.32);
          current.slerp(flat, lockBlend).normalize();
          fighter.rb.setRotation({ x: current.x, y: current.y, z: current.z, w: current.w }, true);
          debugStep.drivePostureLock = lockBlend;
        }
      }
      if (settleTorque) fighter.rb.applyTorqueImpulse(settleTorque, true);
      const lastDrive = fighter.physics?.lastDrive;
      if (
        (fighter.spec?.id === "huge" || fighter.spec?.id === "tombstone") &&
        lastDrive?.canNormalDrive &&
        Math.abs(lastDrive.requestedThrottle || 0) > 0.03 &&
        (lastDrive.solidGrip || 0) > 0.12
      ) {
        const { forward } = yawBasis(fighter, THREE);
        const currentVelocity = fighter.rb.linvel();
        const currentForward = currentVelocity.x * forward.x + currentVelocity.z * forward.z;
        const targetForward = lastDrive.targetSpeed || 0;
        const driveBlend = clamp(dt * 7.5 * (lastDrive.solidGrip || 0), 0, 0.38);
        const nextForward = currentForward + (targetForward - currentForward) * driveBlend;
        const deltaForward = nextForward - currentForward;
        fighter.rb.setLinvel({
          x: currentVelocity.x + forward.x * deltaForward,
          y: currentVelocity.y,
          z: currentVelocity.z + forward.z * deltaForward,
        }, true);
      }
      if (
        (fighter.spec?.id === "huge" || fighter.spec?.id === "tombstone") &&
        lastDrive?.canNormalDrive &&
        Math.abs(lastDrive.requestedTurn || 0) > 0.03 &&
        (lastDrive.solidGrip || 0) > 0.12
      ) {
        const maxSpeed = lastDrive.maxSpeed || DEFAULTS.maxSpeed;
        const turnScale = (maxSpeed / DEFAULTS.maxSpeed) * clamp(fighter.spec?.turningTightness || 1, 0.45, 1.35);
        const targetYaw = -(lastDrive.requestedTurn || 0) * DEFAULTS.turnRate * turnScale;
        const currentAngular = fighter.rb.angvel();
        const yawBlend = clamp(dt * 8.5 * (lastDrive.solidGrip || 0), 0, 0.45);
        fighter.rb.setAngvel({
          x: currentAngular.x,
          y: currentAngular.y + (targetYaw - currentAngular.y) * yawBlend,
          z: currentAngular.z,
        }, true);
        const yawStep = targetYaw * dt * clamp((lastDrive.solidGrip || 0) * 2.4, 0, 0.72);
        if (Math.abs(yawStep) > 0.0001) {
          const r = fighter.rb.rotation();
          const current = new THREE.Quaternion(r.x, r.y, r.z, r.w);
          const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawStep);
          const next = yaw.multiply(current).normalize();
          fighter.rb.setRotation({ x: next.x, y: next.y, z: next.z, w: next.w }, true);
        }
      }
      if (fighter.physics) {
        fighter.physics.lastStep = {
          ...debugStep,
          upY: up.y,
          solidGrounded,
          driveStabilizingGround,
          stabilizingSolidGrounded,
          edgeGrounded,
        };
      }
      if (!drivePosture(fighter, THREE).canNormalDrive && edgeGrounded > EDGE_GROUND_THRESHOLD) {
        const disabledVelocity = fighter.rb.linvel();
        const disabledHorizontal = Math.hypot(disabledVelocity.x, disabledVelocity.z);
        const maxDisabledSpeed = 0.28;
        if (disabledHorizontal > maxDisabledSpeed) {
          const scale = maxDisabledSpeed / disabledHorizontal;
          fighter.rb.setLinvel({
            x: disabledVelocity.x * scale,
            y: disabledVelocity.y,
            z: disabledVelocity.z * scale,
          }, true);
        }
      }
      const maxHorizontal = recentHit ? 60 : 26;
      const maxVertical = recentHit ? 34 : 30;
      const limitedVelocity = fighter.rb.linvel();
      const horizontal = Math.hypot(limitedVelocity.x, limitedVelocity.z);
      if (horizontal > maxHorizontal || Math.abs(limitedVelocity.y) > maxVertical) {
        const scale = horizontal > maxHorizontal ? maxHorizontal / horizontal : 1;
        fighter.rb.setLinvel({
          x: limitedVelocity.x * scale,
          y: clamp(limitedVelocity.y, -maxVertical, maxVertical),
          z: limitedVelocity.z * scale,
        }, true);
      }
      const limitedAngular = fighter.rb.angvel();
      const angularSpeed = Math.hypot(limitedAngular.x, limitedAngular.y, limitedAngular.z);
      const maxAngular = recentHit ? 30 : 22;
      if (angularSpeed > maxAngular) {
        const scale = maxAngular / angularSpeed;
        fighter.rb.setAngvel({ x: limitedAngular.x * scale, y: limitedAngular.y * scale, z: limitedAngular.z * scale }, true);
      }
    });
  }

  return {
    setEnabled,
    setOptions,
    configureWorld,
    addBotColliders,
    initializeFighter,
    driveFighter,
    updateWedgeStates,
    applyWeaponImpacts,
    applySpinnerGyro,
    afterStep,
    tractionForFighter,
    markHit,
    isSpinnerAttackColliderSensor,
    isWeaponColliderSensor,
  };
}
