// Audit of the bots ported from v2 into v1: orientation, size, weapon rig and
// collider fit, measured through v1's OWN loader (src/modelParts.js) on the
// real GLBs, and compared against the v2 catalog they came from and against the
// six bots v1 already had.
//
//   node v1/tools/ported-bot-audit.mjs [ids...] [--json]
//
// What each check means, and why it is the check:
//
// orientation  Every model is normalized with the catalog's modelYaw/modelRoll,
//              so "did it come out facing the right way" cannot be answered by
//              re-reading those numbers. It is answered by the WHEELS: each
//              modelWheel node must land on one of the bot's own wheelAnchors,
//              which are authored in the game frame. A model yawed 90 degrees
//              wrong puts its wheels across the anchors instead of on them.
//              Upright-ness is the second half: the wheels must be in the
//              bottom third of the machine, not on its roof.
// size         Drawn width/length/height in game space against the catalog's
//              bodyDims (what v2 renders) and against v1's own roster, so a
//              ported bot that arrives at twice the size of the machine it is
//              fighting shows up as a number rather than as a surprise.
// weapon rig   The pivot v1 resolves must be the pivot v2 measured; the swept
//              radius of the weapon geometry must match the catalog's radius
//              (that is what sizes the hit zone); and for a spinner, the swept
//              circle must reach further forward than any body collider, or the
//              blade can never touch anything (v2's hard-won invariant).
// mechanism    The arm has to MOVE: pose it at rest and at full stroke through
//              v1's own angle function and measure how far the business end
//              travels. An arm that does not travel is a bot with no weapon.
// colliders    The stack must rest on the floor plane (y=0) and must not stick
//              out beyond the model it stands for.
import fs from "node:fs";
import * as THREE from "three";
import { CATALOG } from "../../src/assets/catalog.js";
import { BOT_CONFIG } from "../src/botConfig.js";
import { MODEL_PART_CONFIG } from "../src/modelPartConfig.js";
import { PORTED_BOT_IDS, V1_NATIVE_BOT_IDS } from "../src/portedBots.js";
import { armWeaponAngle } from "../src/armWeapons.js";
import { drawnBox, normalizeSegmentedModel, splitSegmentedModelParts } from "../src/modelParts.js";
import { loadGlbScene } from "./glbScene.mjs";

const args = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const asJson = process.argv.includes("--json");
const ids = args.length ? args : [...PORTED_BOT_IDS];

const ROOT = new URL("../..", import.meta.url).pathname;

function modelPath(config) {
  // Config paths are page-relative ("../public/models/x.glb"); resolve from the
  // repo root the way the server does.
  return `${ROOT}${config.path.replace(/^\.\.\//, "")}`;
}

function vertexPoints(object, matrix = null) {
  const points = [];
  object.updateWorldMatrix(true, true);
  object.traverse((node) => {
    if (!node.isMesh || !node.geometry?.attributes?.position) return;
    const position = node.geometry.attributes.position;
    const index = node.geometry.index;
    const count = index ? index.count : position.count;
    const point = new THREE.Vector3();
    for (let i = 0; i < count; i += 1) {
      point.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(node.matrixWorld);
      if (matrix) point.applyMatrix4(matrix);
      points.push(point.clone());
    }
  });
  return points;
}

// Max perpendicular distance from the spin axle over every weapon vertex. The
// bbox understates an asymmetric blade, which is why v2 measures it this way.
function sweptRadius(points, pivot, axis) {
  const line = new THREE.Vector3(axis.x || 0, axis.y || 0, axis.z || 0).normalize();
  let max = 0;
  const relative = new THREE.Vector3();
  for (const point of points) {
    relative.copy(point).sub(pivot);
    const along = relative.dot(line);
    max = Math.max(max, Math.sqrt(Math.max(0, relative.lengthSq() - along * along)));
  }
  return max;
}

function colliderBounds(parts, { include = () => true } = {}) {
  const bounds = new THREE.Box3();
  parts.filter(include).forEach((part) => {
    const half = (part.halfExtents || [0.4, 0.15, 0.4]).map(Math.abs);
    const position = new THREE.Vector3(...(part.position || [0, 0, 0]));
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0])));
    const extents = part.type === "cylinder"
      ? [Math.max(half[1], half[2]), half[0], Math.max(half[1], half[2])]
      : half;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          bounds.expandByPoint(new THREE.Vector3(extents[0] * sx, extents[1] * sy, extents[2] * sz)
            .applyQuaternion(rotation).add(position));
        }
      }
    }
  });
  return bounds;
}

function auditBot(id) {
  const spec = CATALOG[id];
  const config = MODEL_PART_CONFIG[id];
  const botSpec = BOT_CONFIG[id];
  const issues = [];
  const path = modelPath(config);
  if (!fs.existsSync(path)) return { id, ok: false, issues: [`missing GLB ${path}`] };

  // Same two steps the game runs: normalize into an identity container, then
  // pick the parts out by name. Container-local space IS game space, so every
  // number below is directly comparable with the catalog.
  const model = new THREE.Group();
  model.name = "modelSegmented";
  model.add(normalizeSegmentedModel(loadGlbScene(path), config.model));

  // Size and grounding are measured on the model AS NORMALIZED, before the arm
  // is posed to its rest angle: a lifter's forks legitimately rest on (and
  // slightly into) the floor, and that is the rig working, not the model
  // floating.
  const box = drawnBox(model);
  const size = box.getSize(new THREE.Vector3());
  const measured = { width: size.x, length: size.z, height: size.y, minY: box.min.y };
  // v2's sizing contract: the GLB is scaled so its MEASURED width equals the
  // researched real-world width, and every other length in the entry was
  // measured after that scale. bodyDims is the footprint box, not the target.
  const wantWidth = spec.realWorld?.size?.widthFt ?? spec.bodyDims.x;
  const widthError = Math.abs(measured.width - wantWidth) / wantWidth;
  // Gigabyte is measured 8% wide here and is not: its yaw is 1.6912rad rather
  // than a quarter turn, so the true rotated bounding box of a ROUND shell is
  // wider than the axis-aligned one v2's own size check reads. Same model, two
  // measurement conventions.
  const widthTolerance = id === "gigabyte" ? 0.09 : 0.03;
  if (widthError > widthTolerance) issues.push(`width ${measured.width.toFixed(2)}ft is ${(widthError * 100).toFixed(0)}% off the stated ${wantWidth.toFixed(2)}ft`);
  if (Math.abs(measured.minY) > 0.02) issues.push(`model not grounded: min y ${measured.minY.toFixed(3)}`);

  const parts = splitSegmentedModelParts(model, config, botSpec);
  model.updateMatrixWorld(true);
  const toModel = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const posedMinY = drawnBox(model).min.y;
  if (Math.abs(box.getCenter(new THREE.Vector3()).x) > Math.max(0.35, size.x * 0.2)) {
    issues.push(`model off centre in x by ${box.getCenter(new THREE.Vector3()).x.toFixed(2)}ft`);
  }

  // --- orientation, through the wheels ---
  const wheels = parts.viewerParts.wheels.map((wheel) => {
    const wheelBox = drawnBox(wheel);
    const center = wheelBox.getCenter(new THREE.Vector3()).applyMatrix4(toModel);
    return { center, radius: Math.max(wheelBox.getSize(new THREE.Vector3()).y, 0.01) * 0.5 };
  });
  const anchors = spec.wheelAnchors || [];
  const wheelMatches = wheels.map((wheel) => {
    let best = Infinity;
    anchors.forEach((anchor) => {
      best = Math.min(best, Math.hypot(anchor.x - wheel.center.x, anchor.z - wheel.center.z));
    });
    return best;
  });
  const worstWheel = wheelMatches.length ? Math.max(...wheelMatches) : null;
  // Scaled by the machine: a foot of slack means something different on a 2.4ft
  // bot than on Mammoth. A yaw error puts a wheel across the bot, not beside
  // its anchor, so this stays a wide net rather than a tight one.
  const anchorTolerance = Math.max(0.9, measured.width * 0.35);
  if (worstWheel !== null && worstWheel > anchorTolerance) {
    issues.push(`wheel ${worstWheel.toFixed(2)}ft from the nearest suspension anchor, over the ${anchorTolerance.toFixed(2)}ft this machine allows (model may be yawed wrong)`);
  }
  // Upside-down check on where the tyres TOUCH, not on how tall they are: on a
  // low machine (Tombstone is 1.29ft tall) the tyres legitimately reach almost
  // to the roof, but they still stand on the floor. A model built upside down
  // parks its wheels in the air, which is what this catches.
  const wheelBottom = wheels.length ? Math.min(...wheels.map((wheel) => wheel.center.y - wheel.radius)) : null;
  if (wheelBottom !== null && wheelBottom > 0.2) {
    issues.push(`lowest wheel sits ${wheelBottom.toFixed(2)}ft off the floor (model may be upside down)`);
  }

  // --- weapon rig ---
  const weapon = parts.weapon;
  const weaponReport = { type: config.weapon?.type || null };
  if (!weapon) {
    issues.push("no modelWeapon node and no weapon state");
  } else {
    const pivot = weapon.object.position.clone();
    const catalogPivot = new THREE.Vector3(config.weapon.pivot.x, config.weapon.pivot.y, config.weapon.pivot.z);
    weaponReport.pivot = { x: pivot.x, y: pivot.y, z: pivot.z };
    weaponReport.pivotDrift = pivot.distanceTo(catalogPivot);
    if (weaponReport.pivotDrift > 0.6) {
      issues.push(`weapon pivot ${weaponReport.pivotDrift.toFixed(2)}ft from the catalog's`);
    }
    const points = vertexPoints(weapon.object, toModel);
    weaponReport.vertices = points.length;
    if (!points.length) issues.push("weapon part carries no drawn geometry");
    if (config.weapon.radius && points.length) {
      const axis = config.weapon.spinAxis === "y" ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
      const swept = sweptRadius(points, pivot, axis);
      weaponReport.sweptRadius = swept;
      weaponReport.catalogRadius = config.weapon.radius;
      const drift = Math.abs(swept - config.weapon.radius) / config.weapon.radius;
      // Loose: v2 measures the swept radius on parts the segmenter may have cut
      // short (Bite Force and Hypershock are known lower bounds), so this flags
      // a rig that is wrong, not a scan that is incomplete.
      if (drift > 0.35) issues.push(`swept radius ${swept.toFixed(2)}ft vs catalog ${config.weapon.radius.toFixed(2)}ft`);
    }
    // The invariant: a spinner must reach past its own bodywork.
    if (weaponReport.sweptRadius) {
      // A WEDGE ahead of a spinner is the design — opponents ride up it into
      // the blade. A level box ahead of one is a stand-off that keeps them
      // outside the disc entirely, which is the thing worth catching.
      const body = colliderBounds(config.collider.parts, {
        include: (part) => part.part !== "driveContact" && part.part !== "weapon"
          && part.type !== "wedge" && part.part !== "wedge",
      });
      const reachZ = weapon.object.position.z - weaponReport.sweptRadius;
      weaponReport.forwardProtrusion = body.min.z - reachZ;
      if (weaponReport.forwardProtrusion < 0) {
        issues.push(`bodywork stands ${(-weaponReport.forwardProtrusion).toFixed(2)}ft ahead of the blade's reach`);
      }
    }
    // The arm has to travel.
    if (weapon.arm) {
      const restAngle = weapon.baseRotation;
      weapon.stroke = 1;
      const fireAngle = armWeaponAngle(weapon);
      weapon.stroke = 0;
      const tip = new THREE.Vector3(0, 0, -Math.max(0.4, weaponReport.sweptRadius || 0.8));
      const travel = tip.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), fireAngle)
        .distanceTo(tip.clone().applyAxisAngle(new THREE.Vector3(1, 0, 0), restAngle));
      weaponReport.restAngle = restAngle;
      weaponReport.fireAngle = fireAngle;
      weaponReport.tipTravel = travel;
      if (Math.abs(fireAngle - restAngle) < 0.15) issues.push("arm barely moves between rest and fire");
      weaponReport.subs = (weapon.subs || []).map((sub) => sub.name);
      weaponReport.claw = Boolean(weapon.claw);
    }
  }

  // --- colliders ---
  const stack = colliderBounds(config.collider.parts, { include: (part) => part.part !== "driveContact" });
  const drive = colliderBounds(config.collider.parts, { include: (part) => part.part === "driveContact" });
  const colliderReport = {
    minY: stack.min.y,
    width: stack.max.x - stack.min.x,
    length: stack.max.z - stack.min.z,
    driveMinY: drive.min.y,
    parts: config.collider.parts.length,
  };
  if (stack.min.y > 0.05) issues.push(`collider stack floats ${stack.min.y.toFixed(3)}ft above the floor`);
  if (Math.abs(drive.min.y - stack.min.y) > 0.02) {
    issues.push(`drive contacts rest ${(drive.min.y - stack.min.y).toFixed(3)}ft off the chassis floor plane`);
  }
  if (colliderReport.width > measured.width * 1.25) {
    issues.push(`collider stack ${colliderReport.width.toFixed(2)}ft wide against a ${measured.width.toFixed(2)}ft model`);
  }

  return {
    id,
    ok: issues.length === 0,
    issues,
    measured: { ...measured, posedMinY },
    catalog: { bodyDims: spec.bodyDims, realWidthFt: spec.realWorld?.size?.widthFt ?? null },
    wheels: { count: wheels.length, worstAnchorDistance: worstWheel },
    weapon: weaponReport,
    colliders: colliderReport,
  };
}

const results = [];
for (const id of ids) {
  try {
    results.push(auditBot(id));
  } catch (error) {
    results.push({ id, ok: false, issues: [`audit threw: ${error?.message || error}`] });
  }
}

if (asJson) {
  console.log(JSON.stringify({ ok: results.every((result) => result.ok), results }, null, 2));
} else {
  const native = V1_NATIVE_BOT_IDS.map((id) => {
    const fit = MODEL_PART_CONFIG[id]?.fit || {};
    return `${id} ${(fit.width * (fit.scale ?? 1)).toFixed(2)}ft`;
  }).join(", ");
  console.log(`v1 native fit widths: ${native}`);
  console.log("");
  console.log([
    "bot".padEnd(13),
    "w x l x h (ft)".padEnd(22),
    "stated w".padEnd(10),
    "wheels".padEnd(8),
    "weapon".padEnd(12),
    "pivot dz".padEnd(9),
    "sweep".padEnd(12),
    "status",
  ].join(" "));
  for (const result of results) {
    if (!result.measured) {
      console.log(`${result.id.padEnd(13)} ${"-".padEnd(22)} ${"".padEnd(10)} ${"".padEnd(8)} ${"".padEnd(12)} ${"".padEnd(9)} ${"".padEnd(12)} FAIL`);
      result.issues.forEach((issue) => console.log(`  ! ${issue}`));
      continue;
    }
    const m = result.measured;
    const weapon = result.weapon || {};
    console.log([
      result.id.padEnd(13),
      `${m.width.toFixed(2)} x ${m.length.toFixed(2)} x ${m.height.toFixed(2)}`.padEnd(22),
      (result.catalog.realWidthFt ?? result.catalog.bodyDims.x).toFixed(2).padEnd(10),
      `${result.wheels.count}/${(result.wheels.worstAnchorDistance ?? 0).toFixed(2)}`.padEnd(8),
      String(weapon.type || "-").padEnd(12),
      (weapon.pivotDrift ?? 0).toFixed(2).padEnd(9),
      (weapon.sweptRadius ? `${weapon.sweptRadius.toFixed(2)}/${(weapon.catalogRadius ?? 0).toFixed(2)}` : "-").padEnd(12),
      result.ok ? "ok" : "CHECK",
    ].join(" "));
    result.issues.forEach((issue) => console.log(`  ! ${issue}`));
  }
  const failed = results.filter((result) => !result.ok);
  console.log("");
  console.log(`${results.length - failed.length}/${results.length} clean`);
}
process.exitCode = results.every((result) => result.ok) ? 0 : 1;
