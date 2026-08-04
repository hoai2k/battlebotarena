// Bots ported from the v2 game (repo root) into v1.
//
// v2's catalog (../../src/assets/catalog.js) is the single source of truth for
// every machine's real-world knowledge: researched sizes and speeds, measured
// model rigs (modelYaw/modelScale, weapon pivots, arm rest/fire angles) and
// collider stacks authored against segmented GLBs. This module is the bridge:
// it reads that catalog and emits the two shapes v1 runs on — a BOT_CONFIG
// spec (botConfig.js) and a MODEL_PART_CONFIG entry (modelPartConfig.js).
//
// WHY THE FRAMES LINE UP
// v2's catalog header states its coordinates are "body-local, matches v1
// fitted-model space": +Y up, forward -Z, +X right, y=0 the floor plane, feet.
// That is exactly the frame v1 authors collider parts in, so offsets, pivots
// and extents port across as numbers, not as guesses. What does NOT port is
// v1's *fit* box (v1 scales a raw one-mesh GLB to fit.width/height/depth);
// segmented v2 models carry their own scale, so entries emitted here set
// `segmented: true` and `model: {...}` and the loader normalizes them the way
// v2 does (yaw, roll, uniform scale, ground to y=0, centre on modelBody).
//
// WHAT IS DELIBERATELY NOT COPIED
// - Mass. v1 gives every bot the same 250lb rigid-body mass and lets collider
//   density add the rest; v2's collider stacks are far more solid, so raw
//   densities would make Mammoth eight times heavier than Minotaur. Densities
//   are normalized per bot to v1's own collider-mass band (see NATIVE_*).
// - Suspension. v1 has no raycast suspension: traction comes from colliders
//   marked `part: "driveContact"`. Those are synthesized from v2 wheelAnchors.
import { CATALOG, BOT_IDS } from "../../src/assets/catalog.js";

export const FEET_PER_SECOND_PER_MPH = 22 / 15;

// The six bots v1 already ships with its own hand-tuned GLBs and hand-tweaked
// colliders. They stay exactly as they are; everything else in the v2 catalog
// is ported. Sawblaze and Tombstone are ported too — v1's own entries pointed
// at GLBs that were never in the repo.
export const V1_NATIVE_BOT_IDS = Object.freeze([
  "biteforce",
  "bronco",
  "huge",
  "quantum",
  "hypershock",
  "minotaur",
]);

export const PORTED_BOT_IDS = Object.freeze(BOT_IDS.filter((id) => !V1_NATIVE_BOT_IDS.includes(id)));

// v1's native bots carry 9-46 units of collider mass on top of the flat
// 250lb (18.75 unit) rigid-body mass every fighter gets. Ported bots are
// normalized onto the median of that band so a v2 collider stack does not
// arrive four times heavier than the bot it is fighting.
const NATIVE_COLLIDER_MASS_TARGET = 27.6;
// The two bots that REPLACED a v1 entry keep the collider mass that entry
// carried, so every fight v1 was tuned around still plays the way it did.
// (Measured off the old modelPartConfig.js stacks before they were removed.)
const REPLACED_COLLIDER_MASS = { tombstone: 16.04, sawblaze: 25.64 };
const COLLIDER_DENSITY_SCALE = 2.75; // physics.js multiplies part density by this
const DENSITY_RATIO = { body: 1, wedge: 1, weapon: 0.8, driveContact: 0.425 };
const BASE_DENSITY_HINT = 4; // v1's authored body density, used for the ratios above

// Ported spinners inherit v1's picker/HUD conventions.
const VIEWER_ROTATION = [0, Math.PI - 0.2, 0];
const MAX_HP = 1000;

// v1 renders spinners at a readable speed rather than at their physical rad/s
// (Bite Force's drum is 487 rad/s in physics and 136 on screen). Keep that
// convention: rendered speed tracks the real one but stays inside the band v1
// already used, so a ported spinner does not strobe.
const VISUAL_SPEED_RATIO = 0.28;
const VISUAL_SPEED_MIN = 60;
const VISUAL_SPEED_MAX = 150;

const ARM_WEAPON_TYPES = Object.freeze([
  "flipper",
  "crusher",
  "hammer",
  "hammerSaw",
  "lifter",
  "lifterDisc",
  "grappler",
  "sawArms",
]);

export const SPINNER_WEAPON_TYPES = Object.freeze(["bar", "drum", "shellSpinner"]);

export function isSpinnerWeaponType(type) {
  return SPINNER_WEAPON_TYPES.includes(type);
}

export function isArmWeaponType(type) {
  return ARM_WEAPON_TYPES.includes(type);
}

function round(value, places = 6) {
  const factor = 10 ** places;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function feetPerSecondToMph(fps) {
  return round(fps / FEET_PER_SECOND_PER_MPH, 3);
}

function shortName(id, name) {
  const words = String(name || id).split(/[\s-]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const letters = String(name || id).replace(/[^A-Za-z]/g, "");
  return (letters.slice(0, 2) || id.slice(0, 2)).toUpperCase();
}

function notesFor(spec) {
  const real = spec.realWorld || {};
  const bits = [spec.tagline];
  if (real.weapon?.name) bits.push(`${real.weapon.name}${real.weapon.weightLbs ? ` (${real.weapon.weightLbs}lb)` : ""}.`);
  if (real.team) bits.push(`Team ${real.team}${real.from ? `, ${real.from}` : ""}.`);
  if (real.drive) bits.push(`Drive: ${real.drive}.`);
  return bits.filter(Boolean).join(" ");
}

function partVolume(part) {
  const [hx, hy, hz] = (part.halfExtents || [0.4, 0.16, 0.4]).map((value) => Math.abs(value));
  if (part.type === "cylinder") {
    const radius = Math.max(0.01, (hy + hz) * 0.5);
    return Math.PI * radius * radius * Math.max(0.01, hx * 2);
  }
  if (part.type === "wedge") return Math.max(0.000001, hx * 2 * hy * hz * 2); // half a box
  return Math.max(0.000001, hx * 2 * hy * 2 * hz * 2);
}

// One density per bot, so that the total collider mass lands on v1's band while
// the body/weapon/wheel ratios v1 authored by hand are preserved.
function normalizeDensities(parts, id) {
  const weighted = parts.reduce((sum, part) => {
    if (part.part === "driveContact") return sum;
    const ratio = DENSITY_RATIO[part.part] ?? DENSITY_RATIO[part.type] ?? 1;
    return sum + partVolume(part) * ratio;
  }, 0);
  if (weighted <= 0) return parts;
  const target = REPLACED_COLLIDER_MASS[id] ?? NATIVE_COLLIDER_MASS_TARGET;
  const base = target / (COLLIDER_DENSITY_SCALE * weighted);
  return parts.map((part) => {
    const ratio = DENSITY_RATIO[part.part] ?? DENSITY_RATIO[part.type] ?? 1;
    return { ...part, density: round(base * ratio, 4) };
  });
}

function colliderToPart(collider, index) {
  const offset = collider.offset || { x: 0, y: 0, z: 0 };
  const position = [round(offset.x), round(offset.y), round(offset.z)];
  // A collider that swings with the arm becomes a v1 `part: "weapon"`, which
  // main.js re-poses against the weapon pivot every step (the same binding
  // Bite Force's drum uses).
  const part = collider.ridesArm ? "weapon" : "body";
  if (collider.shape === "cylinder") {
    const radius = Math.abs(collider.radius ?? collider.halfExtents?.y ?? 0.3);
    const halfHeight = Math.abs(collider.halfHeight ?? collider.halfExtents?.x ?? 0.2);
    const axis = collider.axis || "y";
    // v1 builds cylinders along local Y and rotates them; a drum across the bot
    // takes the z-roll v1's own configs use.
    return {
      type: "cylinder",
      part,
      position,
      halfExtents: [round(halfHeight), round(radius), round(radius)],
      rotation: axis === "x" ? [0, 0, Math.PI / 2] : axis === "z" ? [Math.PI / 2, 0, 0] : [0, 0, 0],
      density: BASE_DENSITY_HINT,
      index,
    };
  }
  const half = collider.halfExtents || { x: 0.4, y: 0.2, z: 0.4 };
  if (collider.shape === "wedge") {
    return {
      type: "wedge",
      part: part === "weapon" ? "weapon" : "wedge",
      position,
      halfExtents: [round(half.x), round(half.y), round(half.z)],
      density: BASE_DENSITY_HINT,
      friction: 0.58,
      index,
    };
  }
  return {
    type: "box",
    part,
    position,
    halfExtents: [round(half.x), round(half.y), round(half.z)],
    density: BASE_DENSITY_HINT,
    index,
  };
}

// Where the collider stack actually rests. v2 authors offsets against y=0 but
// lets individual pieces dip a little under it (its sim grounds the assembled
// stack), and v1 does the same — so a drive contact whose bottom sat at exactly
// 0 would ride that dip's worth of air and report itself half off the floor.
// Tombstone's drive pods dip 0.015ft and that alone took its traction reading
// from 1.00 to 0.82.
function colliderStackMinY(parts) {
  let min = Infinity;
  parts.forEach((part) => {
    if (part.part === "driveContact" || part.ignoreGroundContact) return;
    if (part.part === "weapon" && part.ignoreLocalBottomFloorContact) return;
    const [hx, hy, hz] = (part.halfExtents || [0.4, 0.16, 0.4]).map(Math.abs);
    const [rx, , rz] = part.rotation || [0, 0, 0];
    // Same corner sampling v1 grounds with (main.js colliderPartsBounds).
    const half = part.type === "cylinder" ? [Math.max(hy, hz), hx, Math.max(hy, hz)] : [hx, hy, hz];
    const cos = Math.cos(rx) * Math.cos(rz);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          // Only the vertical extent matters here; a rotation about X or Z
          // spreads it, which the |sin| terms cover.
          const y = (part.position?.[1] ?? 0)
            + sy * half[1] * Math.abs(cos)
            + sx * half[0] * Math.abs(Math.sin(rz))
            + sz * half[2] * Math.abs(Math.sin(rx));
          min = Math.min(min, y);
        }
      }
    }
  });
  return Number.isFinite(min) ? min : 0;
}

// v1 has no raycast suspension: traction is sampled from colliders tagged
// `driveContact`, which are probes rather than solids (physics.js never turns
// them into Rapier colliders). Build one per v2 wheel anchor, sized so the
// contact patch sits on the floor plane the model is grounded to.
function driveContactsFromAnchors(anchors = [], bodyDims, floorY = 0) {
  const halfLength = Math.max(0.18, Math.min(0.42, (bodyDims?.z || 2.6) * 0.14));
  return anchors.map((anchor) => {
    const radius = Math.max(0.16, Math.min(0.55, (anchor.y || 0.24) * 1.3));
    return {
      type: "box",
      part: "driveContact",
      position: [round(anchor.x), round(floorY + radius), round(anchor.z)],
      halfExtents: [round(Math.max(0.14, radius * 0.55)), round(radius), round(halfLength)],
      side: anchor.x < 0 ? "left" : "right",
      density: BASE_DENSITY_HINT * DENSITY_RATIO.driveContact,
      friction: 0.92,
      restitution: 0,
    };
  });
}

// The spinner's own solid. v1 uses it for damage zoning, for the "is my blade
// buried in something" checks and for the weapon-vs-floor strike path, and
// binds it to the weapon pivot so it turns with the rotor.
function spinnerWeaponPart(spec) {
  const weapon = spec.weapon;
  if (!weapon || !isSpinnerWeaponType(weapon.type)) return null;
  const pivot = weapon.pivot || { x: 0, y: 0.5, z: 0 };
  const dims = weapon.dims || { x: 0.3, y: 0.3, z: 0.3 };
  const radius = Math.abs(weapon.radius || Math.max(dims.y, dims.z));
  const position = [round(pivot.x), round(pivot.y), round(pivot.z)];
  const verticalAxis = Math.abs(weapon.axis?.y || 0) > 0.5;
  if (verticalAxis) {
    // A bar or shell turning about Y sweeps a disc in the floor plane. Model the
    // bar itself (Tombstone) as a box; a full-body shell (Gigabyte) as the disc.
    if (weapon.type === "shellSpinner") {
      return {
        type: "cylinder",
        part: "weapon",
        position,
        halfExtents: [round(Math.abs(dims.y)), round(radius), round(radius)],
        density: BASE_DENSITY_HINT * DENSITY_RATIO.weapon,
        nonBlockingSpinner: true,
        ignoreLocalBottomFloorContact: true,
      };
    }
    return {
      type: "box",
      part: "weapon",
      position,
      halfExtents: [round(Math.abs(dims.x)), round(Math.abs(dims.y)), round(Math.abs(dims.z))],
      density: BASE_DENSITY_HINT * DENSITY_RATIO.weapon,
      nonBlockingSpinner: true,
    };
  }
  // Drum or vertical disc across the bot: a cylinder laid along X.
  return {
    type: "cylinder",
    part: "weapon",
    position,
    halfExtents: [round(Math.abs(dims.x)), round(radius), round(radius)],
    rotation: [0, 0, Math.PI / 2],
    density: BASE_DENSITY_HINT * DENSITY_RATIO.weapon,
    nonBlockingSpinner: true,
    ignoreLocalBottomFloorContact: true,
  };
}

// How far the bot's own nose sits ahead of its weapon pivot. v1 measures a
// spinner's reach from the rotor to the TARGET'S CENTRE, so a machine whose
// drum is set well back behind a long nose needs that much more reach before it
// can touch anything: two solid chassis cannot get closer than the sum of their
// half-lengths, and the difference decides whether a bot ever lands a hit at
// all.
function noseAheadOfPivot(spec) {
  const pivotZ = spec.weapon?.pivot?.z ?? 0;
  let frontZ = 0;
  (spec.colliders || []).forEach((collider) => {
    const offset = collider.offset || { z: 0 };
    const half = collider.shape === "cylinder"
      ? Math.abs(collider.radius ?? collider.halfExtents?.z ?? 0.3)
      : Math.abs(collider.halfExtents?.z ?? 0.3);
    frontZ = Math.min(frontZ, offset.z - half);
  });
  return Math.max(0, pivotZ - frontZ);
}

// A foe's half-length, near enough: the roster runs 2.2-4.9ft long, so the
// centre of anything this bot is touching sits about this far past the contact.
const FOE_HALF_LENGTH = 1.6;

function weaponInertiaType(spec) {
  const weapon = spec.weapon || {};
  if (Math.abs(weapon.axis?.y || 0) > 0.5) return "horizontal";
  const pivotZ = weapon.pivot?.z ?? 0;
  return pivotZ < -0.15 ? "vertical-front" : "vertical";
}

function visualSpinSpeed(spec) {
  const weapon = spec.weapon || {};
  const omega = Math.abs(weapon.maxOmega || 300);
  const magnitude = Math.min(VISUAL_SPEED_MAX, Math.max(VISUAL_SPEED_MIN, omega * VISUAL_SPEED_RATIO));
  // Vertical spinners cut upward at the front (rotation about +X lifts the nose
  // of the rotor); horizontal bars run the other way, as v1's Tombstone does.
  const sign = Math.abs(weapon.axis?.y || 0) > 0.5 ? -1 : 1;
  return round(sign * magnitude, 2);
}

/**
 * The v1 BOT_CONFIG entry for a catalog bot: drive numbers, weapon energy and
 * the spinner shaping chain. v2's `weapon.tuning` block holds raw v1 numbers
 * (see ARCHITECTURE.md "Weapon tuning"), so those port straight across.
 */
export function portedBotSpec(id) {
  const spec = CATALOG[id];
  if (!spec) return null;
  const weapon = spec.weapon || {};
  const tuning = weapon.tuning || {};
  const spinner = isSpinnerWeaponType(weapon.type);
  const maxSpeed = feetPerSecondToMph(spec.maxSpeedFps);
  const entry = {
    name: spec.name,
    short: shortName(id, spec.name),
    ref: `../public/reference/${id}.png`,
    notes: notesFor(spec),
    maxSpeed,
    maxBoostSpeed: round(maxSpeed * 1.45, 3),
    driveAcceleration: round(spec.accel, 3),
    turningTightness: round(spec.turnRate, 3),
    yawDamping: spinner && Math.abs(weapon.axis?.y || 0) > 0.5 ? 1.25 : 1.0,
    weaponSpinUpSeconds: round(weapon.spinUpSeconds ?? tuning.strokeSeconds ?? 0.2, 3),
    maxHp: MAX_HP,
    weightLbs: spec.weightLbs || 250,
    weaponWeightLbs: spec.weaponWeightLbs || 30,
    weaponRotationalInertia: round(weapon.inertia ?? 0, 3),
    weaponRotationalInertiaType: weaponInertiaType(spec),
    frontYawOffset: 0,
    viewerRotation: VIEWER_ROTATION,
    portedFrom: "v2",
    realWorld: spec.realWorld || null,
  };
  if (spec.canDriveInverted) entry.canDriveInverted = true;
  if (spec.drive?.type && spec.drive.type !== "tank") {
    entry.driveType = spec.drive.type;
    entry.driveStrafeRatio = round(spec.drive.strafeRatio ?? 0.9, 3);
    entry.drivePushForceScale = round(spec.drive.pushForceScale ?? 0.5, 3);
    // A holonomic bot's sticks are not a tank pair, and a tracked one does not
    // coast; the control scheme follows the drivetrain.
    entry.controlScheme = spec.drive.type === "holonomic" ? "holonomic" : "tank";
  }
  if (spinner) {
    entry.weaponMaxAngularSpeed = round(weapon.maxOmega ?? 300, 2);
    entry.spinnerEnergyTransferEfficiency = round(tuning.efficiency ?? 0.5, 3);
    entry.spinnerTargetImpulseScale = round(tuning.impulseScale ?? 10, 3);
    entry.spinnerTargetLiftScale = round(tuning.liftScale ?? 28, 3);
    entry.spinnerTargetLiftVelocity = round(tuning.liftVelocity ?? 4.5, 3);
    entry.spinnerTargetLiftClearance = round(tuning.liftClearance ?? 0.55, 3);
    if (Number.isFinite(tuning.kickbackScale)) entry.spinnerKickbackScale = round(tuning.kickbackScale, 3);
    entry.spinnerImpactCapEnabled = true;
    entry.spinnerImpactCap = round(weapon.budgetCap ?? 200, 2);
    entry.spinnerImpactScale = round(tuning.impactScale ?? 1, 3);
    entry.spinnerGyroScale = round(tuning.gyroScale ?? 0.9, 3);
    // v2 measures reach from the axle; v1 measures it from the weapon object's
    // world position, which is the same point.
    // v1 measures spinner reach from the rotor to the TARGET'S CENTRE and
    // defaults to 1.45ft, which suits its own compact machines. A ported entry
    // takes v2's measured reach where there is one (those numbers are v1's,
    // rescaled with the model) but never less than its own geometry needs:
    // Witch Doctor's drum sits a foot behind a 3.4ft nose, and at v1's default
    // its blade stopped 0.6ft short of anything it drove into.
    entry.spinnerReach = round(Math.max(
      tuning.reach ?? 0,
      noseAheadOfPivot(spec) + FOE_HALF_LENGTH,
      1.45,
    ), 3);
    if (tuning.floorLaunch?.enabled) {
      entry.spinnerFloorLaunchEnabled = true;
      entry.spinnerFloorLaunchAngleDeg = round(tuning.floorLaunch.angleDeg ?? 30, 2);
      entry.spinnerFloorLaunchScale = round(tuning.floorLaunch.scale ?? 1, 3);
      entry.spinnerFloorLaunchCap = round(tuning.floorLaunch.cap ?? 180, 2);
    }
    if (Number.isFinite(tuning.damageScale)) entry.spinnerDamageScale = round(tuning.damageScale, 3);
  } else {
    entry.weaponMaxAngularSpeed = 0;
    // Impulse arms report their stroke through v1's flipper return machinery.
    entry.weaponReturnSeconds = round(tuning.returnSeconds ?? weapon.lowerSeconds ?? 0.8, 3);
    if (Number.isFinite(tuning.liftVelocity)) entry.targetLiftVelocity = round(tuning.liftVelocity, 3);
    if (Number.isFinite(tuning.pitchVelocity)) entry.targetPitchVelocity = round(tuning.pitchVelocity, 3);
    entry.armReach = round(Math.max(tuning.reach ?? tuning.gripReach ?? 1.8, 1.72), 3);
  }
  return entry;
}

// Arm mechanics that v1's weapon runtime reads (see armWeapons.js). Everything
// here is measured in v2's rig-inspect passes: the angles are GAME-space arm
// angles, not GLB ones, which is why they can be used directly.
function armWeaponBlock(spec) {
  const weapon = spec.weapon;
  const tuning = weapon.tuning || {};
  const axisSign = (weapon.axis?.x ?? 1) < 0 ? -1 : 1;
  const block = {
    type: weapon.type,
    spinAxis: "x",
    axisSign,
    pivotFromCatalog: Boolean(weapon.pivotFromCatalog),
    pivot: { x: round(weapon.pivot?.x ?? 0), y: round(weapon.pivot?.y ?? 0.6), z: round(weapon.pivot?.z ?? 0) },
    restAngle: round(weapon.restAngle ?? 0, 4),
    fireAngle: round(weapon.fireAngle ?? weapon.liftAngle ?? 0.9, 4),
    strokeSeconds: round(tuning.strokeSeconds ?? weapon.liftSeconds ?? 0.3, 3),
    returnSeconds: round(tuning.returnSeconds ?? weapon.lowerSeconds ?? 0.7, 3),
    reach: round(Math.max(tuning.reach ?? tuning.gripReach ?? 1.8, 1.72), 3),
    budgetCap: round(weapon.budgetCap ?? 160, 2),
  };
  if (weapon.type === "hammer") {
    block.holdStroke = Boolean(weapon.holdStroke);
    block.downforce = round(weapon.downforce ?? 0, 2);
  }
  if (weapon.type === "flipper") {
    block.liftVelocity = round(tuning.liftVelocity ?? 24, 3);
    block.pitchVelocity = round(tuning.pitchVelocity ?? 10.5, 3);
  }
  if (weapon.type === "lifter" || weapon.type === "lifterDisc" || weapon.type === "grappler") {
    block.held = true;
    block.liftImpulse = round(weapon.liftImpulse ?? weapon.gripStrength * 6 ?? 150, 2);
    // v2 gives a grappler no hold damage at all, because in v2 a fight it
    // controls can be won on the judges' cards. v1 has no judges: damage is the
    // only way anything is decided here, so a machine whose whole game is
    // control still has to be able to score while it holds you.
    block.holdDamagePerSecond = round(tuning.holdDamagePerSecond || (weapon.type === "grappler" ? 2.5 : 3.5), 3);
    block.gripReach = round(tuning.gripReach ?? tuning.reach ?? 1.8, 3);
    if (weapon.twoWayArm) block.twoWayArm = true;
  }
  if (weapon.type === "hammerSaw" || weapon.type === "sawArms") {
    block.held = true;
    block.grindDamagePerSecond = round(tuning.grindDamagePerSecond ?? weapon.sub?.damagePerSecond ?? 8, 3);
  }
  if (weapon.type === "crusher") {
    block.held = true;
    block.holdDamagePerSecond = round(tuning.holdDamagePerSecond ?? 6, 3);
    block.gripReach = round(tuning.gripReach ?? 2, 3);
  }
  // Nested rotors: Sawblaze's cutting disc, Whiplash's disc, Dragon King's saws.
  const disc = weapon.disc || weapon.sub;
  if (disc) {
    block.sub = {
      kind: "spinner",
      spinUpSeconds: round(disc.spinUpSeconds ?? 1.4, 3),
      maxOmega: round(disc.maxOmega ?? 380, 2),
      visualSpeed: round(Math.min(VISUAL_SPEED_MAX, Math.max(VISUAL_SPEED_MIN, (disc.maxOmega ?? 380) * VISUAL_SPEED_RATIO)), 2),
      damagePerSecond: round(disc.contactDamagePerSecond ?? disc.damagePerSecond ?? 10, 3),
      radius: round(disc.radius ?? 0.45, 4),
      // Dragon King's two blades lean about seven degrees apart in opposite
      // directions; spinning both about one horizontal axle is the wobble you
      // would get from bending the axle instead of the arms.
      axes: disc.axes ? { ...disc.axes } : undefined,
      // Photogrammetry is bad at thin repeating edges: these came back as discs
      // with a ring of nubs. v2 draws them instead, and v1 uses the same module
      // and the same numbers rather than a second copy of the shape.
      blade: disc.blade ? { ...disc.blade } : undefined,
    };
  } else if (weapon.type === "hammerSaw") {
    // Sawblaze's saw is the weapon part itself, spun about the arm's own axle.
    block.sub = {
      kind: "spinner",
      spinUpSeconds: round(weapon.spinUpSeconds ?? 2.4, 3),
      maxOmega: round(weapon.maxOmega ?? 880, 2),
      visualSpeed: round(Math.min(VISUAL_SPEED_MAX, Math.max(VISUAL_SPEED_MIN, (weapon.maxOmega ?? 880) * VISUAL_SPEED_RATIO)), 2),
      damagePerSecond: round(tuning.grindDamagePerSecond ?? 5, 3),
      radius: round(weapon.radius ?? 0.55, 4),
      onWeaponPart: true,
    };
  }
  // A jaw is a hinge, not a rotor (Claw Viper, Overhaul).
  if (weapon.claw) {
    block.claw = {
      openAngle: round(weapon.claw.openAngle ?? 0, 4),
      closedAngle: round(weapon.claw.closedAngle ?? -0.8, 4),
      clampSeconds: round(weapon.claw.clampSeconds ?? 0.25, 3),
    };
  }
  return { ...block, ...weaponMechanismsBlock(spec) };
}

// Mechanisms that are not the weapon itself but ride with it. Every one of
// these is a v2 block ported verbatim — the numbers are measured, so they come
// across as numbers and the behaviour is implemented against them (see
// armWeapons.js for the state machine and physics.js for what each one does).
function weaponMechanismsBlock(spec) {
  const weapon = spec.weapon || {};
  const block = {};
  if (weapon.track) {
    // Tantrum's drum rides a carriage down the middle of the bot: hold the
    // second channel to winch it back and up, release to fire it forward. The
    // hit is scaled AFTER the budget cap, because the cap is the rotor's stored
    // energy and the carriage's momentum is not part of it.
    block.track = {
      offset: { ...weapon.track.offset },
      retractSeconds: round(weapon.track.retractSeconds ?? 0.55, 3),
      flingSeconds: round(weapon.track.flingSeconds ?? 0.16, 3),
      hitBoost: round(weapon.track.hitBoost ?? 1.5, 3),
    };
  }
  if (weapon.fists) {
    // A third mechanism on its own button: the arms hinge on the axle across
    // the back and punch up through a quarter turn, which is what helps when
    // the drum has stalled against someone.
    block.fists = {
      openAngle: round(weapon.fists.openAngle ?? 0, 4),
      punchAngle: round(weapon.fists.punchAngle ?? 1.3, 4),
      punchSeconds: round(weapon.fists.punchSeconds ?? 0.18, 3),
      impulse: round(weapon.fists.impulse ?? 90, 2),
      damagePerHit: round(weapon.fists.damagePerHit ?? 2.5, 3),
      reach: round(weapon.fists.reach ?? 1.1, 3),
    };
  }
  if (weapon.flame) {
    block.flame = {
      damagePerSecond: round(weapon.flame.damagePerSecond ?? 8, 3),
      reach: round(weapon.flame.reach ?? 3, 3),
      scale: round(weapon.flame.scale ?? 1, 3),
      dir: { ...(weapon.flame.dir || { x: 0, y: 0, z: -1 }) },
      nozzles: (weapon.flame.nozzles || []).map((nozzle) => ({ ...nozzle })),
      ridesWeapon: Boolean(weapon.flame.ridesWeapon),
      requiresGrip: Boolean(weapon.flame.requiresGrip),
    };
  }
  if (weapon.overheadStall) {
    // Gigabyte's rotor IS its roof: a hammer that comes down square on it stops
    // the shell dead and jams it for a beat.
    block.overheadStall = { ...weapon.overheadStall };
  }
  if (weapon.selfRight) block.selfRight = true;
  if (weapon.downforce) block.downforce = round(weapon.downforce, 2);
  if (weapon.holdStroke) block.holdStroke = true;
  if (weapon.twoWayArm) block.twoWayArm = true;
  if (weapon.gripStrength) {
    block.grip = {
      reach: round(weapon.gripReach ?? 2, 3),
      height: round(weapon.gripHeight ?? 0.5, 3),
      strength: round(weapon.gripStrength ?? 24, 3),
      impulseCap: round(weapon.gripImpulseCap ?? 200, 2),
      angularDamping: round(weapon.gripAngularDamping ?? 10, 3),
      throwScale: round(weapon.throwScale ?? 0.55, 3),
      downforceLbs: round(weapon.downforceLbs ?? 0, 2),
    };
  }
  if (Number.isFinite(weapon.tuning?.ownerPitchScale)) {
    // The reason the biggest weapon in the game is not simply the best: its own
    // hits tumble it.
    block.ownerPitchScale = round(weapon.tuning.ownerPitchScale, 3);
  }
  // Structure the scan could not see — Duck's plow hangs off two thin carrier
  // bars, Quantum's jaw off a ram — stated as numbers so the moving part is not
  // left floating unattached to the hinge it turns about.
  if (weapon.arms?.length) block.arms = weapon.arms.map((arm) => JSON.parse(JSON.stringify(arm)));
  return block;
}

// Dragon King is four mechanisms on four buttons, none of which means anything
// alone: the jaw is the enabling weapon (the saws only cut what it is gripping),
// the arms tilt onto what the jaw holds, and the body rears up about the axle at
// the back of its track pods to reach a bot BEHIND it.
function auxMechanismsBlock(spec) {
  const block = {};
  if (spec.aux?.jaw) {
    block.jaw = {
      node: spec.aux.jaw.node,
      pivot: { ...spec.aux.jaw.pivot },
      openAngle: round(spec.aux.jaw.openAngle ?? 0.6, 4),
      seconds: round(spec.aux.jaw.seconds ?? 0.4, 3),
      reach: round(spec.aux.jaw.reach ?? 2.3, 3),
      clampForce: round(spec.aux.jaw.clampForce ?? 260, 2),
      holdStrength: round(spec.aux.jaw.holdStrength ?? 9, 3),
      breakDistance: round(spec.aux.jaw.breakDistance ?? 3.2, 3),
    };
  }
  if (spec.aux?.pods) {
    block.pods = {
      node: spec.aux.pods.node,
      pivot: { ...spec.aux.pods.pivot },
      range: round(spec.aux.pods.range ?? 2.2, 3),
      seconds: round(spec.aux.pods.seconds ?? 0.8, 3),
    };
  }
  if (spec.lift) {
    block.lift = {
      pivot: { ...spec.lift.pivot },
      maxAngleDeg: round(spec.lift.maxAngleDeg ?? 90, 2),
      seconds: round(spec.lift.seconds ?? 0.9, 3),
    };
  }
  return Object.keys(block).length ? block : null;
}

function spinnerWeaponBlock(spec) {
  const weapon = spec.weapon;
  const verticalAxis = Math.abs(weapon.axis?.y || 0) > 0.5;
  return {
    type: weapon.type === "shellSpinner" ? "bar" : weapon.type,
    shellSpinner: weapon.type === "shellSpinner" || undefined,
    spinAxis: verticalAxis ? "y" : "x",
    axisSign: 1,
    pivotFromCatalog: Boolean(weapon.pivotFromCatalog),
    visualSpeed: visualSpinSpeed(spec),
    spinDownSeconds: round(weapon.spinDownSeconds ?? 1.1, 3),
    radius: round(weapon.radius ?? 0.5, 4),
    pivot: { x: round(weapon.pivot?.x ?? 0), y: round(weapon.pivot?.y ?? 0.5), z: round(weapon.pivot?.z ?? 0) },
    ...weaponMechanismsBlock(spec),
  };
}

/**
 * The v1 MODEL_PART_CONFIG entry: where the GLB is, how to normalize it, the
 * collider stack, and the weapon mechanics. `segmented: true` tells v1's model
 * loader the GLB carries v2's part-named nodes (modelBody / modelWeapon /
 * modelWheel-N / modelWeaponSub-* / modelAux-*) instead of v1's fraction
 * regions, so nothing here needs hand tweaking in the collider tweaker.
 */
export function portedModelConfig(id) {
  const spec = CATALOG[id];
  if (!spec) return null;
  const arm = isArmWeaponType(spec.weapon?.type);
  const parts = [];
  (spec.colliders || []).forEach((collider, index) => parts.push(colliderToPart(collider, index)));
  const weaponPart = spinnerWeaponPart(spec);
  if (weaponPart) parts.push(weaponPart);
  const normalized = normalizeDensities(parts, id);
  // v1 grounds a bot on its COLLIDERS while the model grounds on its geometry,
  // so a stack authored a little above y=0 (Copperhead's single box sits 0.1ft
  // up) would bury the model that far into the floor. Drop the stack onto the
  // floor plane the model rests on; there is no suspension here to take it up.
  const stackMinY = colliderStackMinY(normalized);
  if (stackMinY > 0.02) {
    normalized.forEach((part) => {
      part.position = [part.position[0], round(part.position[1] - stackMinY), part.position[2]];
    });
  }
  normalized.push(...driveContactsFromAnchors(spec.wheelAnchors, spec.bodyDims, colliderStackMinY(normalized)));
  return {
    name: spec.name,
    path: `../public/models/${id}.glb`,
    segmented: true,
    model: {
      yaw: spec.modelYaw ?? 0,
      roll: spec.modelRoll ?? 0,
      scale: spec.modelScale ?? null,
      centerOn: spec.modelCenterOn ?? "modelBody",
      bodyDims: { ...spec.bodyDims },
      hideWheels: Boolean(spec.hideWheels),
    },
    collider: { parts: normalized },
    weapon: arm ? armWeaponBlock(spec) : spinnerWeaponBlock(spec),
    aux: auxMechanismsBlock(spec),
    // Two machines here are not tank-steered at all (Glitch and Shatter run
    // omniwheels) and two run on tracks, which changes how they STOP rather
    // than how they accelerate.
    drive: spec.drive ? { ...spec.drive } : { type: "tank" },
    drivetrain: { spinAxis: "x" },
  };
}

export const PORTED_BOT_CONFIG = Object.freeze(Object.fromEntries(
  PORTED_BOT_IDS.map((id) => [id, portedBotSpec(id)]),
));

export const PORTED_MODEL_PART_CONFIG = Object.freeze(Object.fromEntries(
  PORTED_BOT_IDS.map((id) => [id, portedModelConfig(id)]),
));

export function isPortedBot(id) {
  return PORTED_BOT_IDS.includes(id);
}
