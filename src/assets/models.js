// BattleBot Arena v2 — bot model loading. The ONLY game/assets file that
// imports three.js.
//
// loadBotModel(spec) resolves { group, parts: { body, weapon|null, wheels } }.
// It tries the part-named GLB at spec.modelPath (nodes modelBody, modelWeapon,
// modelWheel-0..N) and falls back PER PART to procedural placeholders built
// from the catalog (box chassis, cylinder drum/bar, wedge flipper plate,
// wheel cylinders at wheelAnchors). The game must be fully playable with zero
// GLBs on disk.
//
// parts.weapon is a pivot Group positioned at spec.weapon.pivot: the
// integrator spins/rocks the weapon by setting rotation about spec.weapon.axis
// on that group (e.g. quaternion.setFromAxisAngle(axis, angle)).

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Cache parsed GLB responses: a rematch or a re-pick of the same bot would
// otherwise re-download 10-17MB per model and sit on the loading screen again.
THREE.Cache.enabled = true;

const loader = new GLTFLoader();
const MAX_WHEEL_NODES = 8;

function accentMaterial(spec, { dark = false, metal = 0.55 } = {}) {
  return new THREE.MeshStandardMaterial({
    color: dark ? spec.accentDark || "#22252b" : spec.accent || "#888c94",
    metalness: metal,
    roughness: 0.55,
  });
}

// Tripo writes no pbrMetallicRoughness block, so glTF's defaults apply and every
// scanned material arrives at metalness 1 / roughness 1. That pair is the worst
// case there is: fully metallic means NO diffuse term at all, and fully rough
// means the specular is smeared to nothing, so the baked albedo is left tinting
// a reflection nobody can see. The result reads as chalk or matte plastic no
// matter how good the photograph was.
//
// These machines are painted metal. Paint is a dielectric over steel: mostly
// diffuse, with a tight specular that catches the arena lights. Dropping
// metalness and roughness to those values is what puts the photograph back on
// the surface and the highlight back on the edges.
const SURFACE = { metalness: 0.28, roughness: 0.42 };

function repaintScanned(object, spec) {
  const surface = { ...SURFACE, ...(spec.surface || {}) };
  object.traverse((child) => {
    // Only touch materials that came in from the GLB with a baked texture.
    // Procedural parts (placeholder bodies, Duck's carrier bars, the spin
    // ghost) are authored with the values they want.
    if (!child.isMesh || !child.material?.map) return;
    child.material.metalness = surface.metalness;
    child.material.roughness = surface.roughness;
    child.material.needsUpdate = true;
  });
  return object;
}

function markShadows(object) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });
  return object;
}

// --- Placeholder builders ---------------------------------------------------

function placeholderBody(spec) {
  const dims = spec.bodyDims;
  const group = new THREE.Group();
  group.name = "placeholderBody";
  const chassis = new THREE.Mesh(
    new THREE.BoxGeometry(dims.x, dims.y * 0.62, dims.z),
    accentMaterial(spec, { dark: true }),
  );
  chassis.position.y = dims.y * 0.62 * 0.5 + 0.12;
  group.add(chassis);
  // Accent top plate so the bot reads at a glance + shows facing.
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(dims.x * 0.8, dims.y * 0.14, dims.z * 0.72),
    accentMaterial(spec),
  );
  plate.position.set(0, dims.y * 0.62 + 0.12 + dims.y * 0.07, dims.z * 0.04);
  group.add(plate);
  // Front wedge marker (forward is -Z).
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(dims.x * 0.55, dims.y * 0.2, dims.z * 0.18),
    accentMaterial(spec),
  );
  nose.position.set(0, dims.y * 0.24, -dims.z * 0.5);
  nose.rotation.x = -0.5;
  group.add(nose);
  return group;
}

function cylinderAcross(radius, halfLength, material, axis = "x") {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, halfLength * 2, 18),
    material,
  );
  if (axis === "x") mesh.rotation.z = Math.PI / 2;
  if (axis === "z") mesh.rotation.x = Math.PI / 2;
  return mesh;
}

// Weapon placeholder geometry is authored around the local origin so that
// parenting it under the pivot group makes rotation about spec.weapon.axis
// look correct with no extra offsets.
function placeholderWeapon(spec) {
  const weapon = spec.weapon;
  if (!weapon) return null;
  const dims = weapon.dims || { x: 0.4, y: 0.3, z: 0.3 };
  const accent = accentMaterial(spec, { metal: 0.8 });
  const dark = accentMaterial(spec, { dark: true, metal: 0.8 });
  const group = new THREE.Group();
  group.name = "placeholderWeapon";
  if (weapon.type === "drum") {
    const drum = cylinderAcross(weapon.radius || dims.y, dims.x, accent, "x");
    group.add(drum);
    const tooth = new THREE.Mesh(
      new THREE.BoxGeometry(dims.x * 2, (weapon.radius || dims.y) * 2.3, 0.12),
      dark,
    );
    group.add(tooth);
  } else if (weapon.type === "bar") {
    const vertical = weapon.axis?.x === 1; // HUGE: disc plane Y-Z; Tombstone: horizontal
    const bar = new THREE.Mesh(
      vertical
        ? new THREE.BoxGeometry(dims.x * 2, (weapon.radius || dims.y) * 2, dims.z * 2)
        : new THREE.BoxGeometry((weapon.radius || dims.x) * 2, dims.y * 2, dims.z * 2),
      accent,
    );
    group.add(bar);
    const hub = cylinderAcross(0.16, 0.1, dark, vertical ? "x" : "y");
    group.add(hub);
  } else if (weapon.type === "flipper") {
    // Plate extends forward (-Z) from the hinge at the pivot.
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(dims.x * 2, dims.y * 2, dims.z * 2),
      accent,
    );
    plate.position.z = -dims.z;
    group.add(plate);
  } else if (weapon.type === "crusher") {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, dims.z * 2), dark);
    arm.position.z = -dims.z;
    group.add(arm);
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 6), accent);
    tooth.position.set(0, -0.2, -dims.z * 2 + 0.1);
    tooth.rotation.x = Math.PI;
    group.add(tooth);
  } else if (weapon.type === "grappler") {
    // Fork pair out front with a jaw plate hinged above them.
    const reach = Math.max(1.0, dims.z * 3);
    for (const side of [-1, 1]) {
      const fork = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, reach), accent);
      fork.position.set(side * 0.34, -0.04, -reach / 2);
      group.add(fork);
    }
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, reach * 0.7), dark);
    jaw.position.set(0, 0.42, -reach * 0.45);
    group.add(jaw);
  } else if (weapon.type === "hammer") {
    // Truss arm out to a cylindrical head, hinged at the pivot.
    const reach = Math.max(0.8, dims.y * 2);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, reach), dark);
    arm.position.z = -reach / 2;
    group.add(arm);
    const head = cylinderAcross(0.22, 0.3, accent, "x");
    head.position.z = -reach;
    group.add(head);
  } else if (weapon.type === "lifterDisc" || weapon.type === "lifter") {
    // Lifter beam with fork prongs, plus the disc that rides on it (lifterDisc
    // only — a plain lifter is the same arm with nothing bolted to it).
    const reach = Math.max(1.0, dims.z * 4);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.14, reach), dark);
    beam.position.z = -reach / 2;
    group.add(beam);
    for (const side of [-1, 1]) {
      const prong = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.5), accent);
      prong.position.set(side * 0.28, -0.06, -reach - 0.2);
      group.add(prong);
    }
    if (weapon.disc) {
      const disc = cylinderAcross(weapon.disc.radius ?? 0.42, 0.07, accent, "x");
      disc.position.set(0, 0.25, -reach * 0.55);
      group.add(disc);
    }
  } else if (weapon.type === "hammerSaw") {
    const sawCenter = weapon.tuning?.sawCenter || { x: 0, y: 0, z: -0.9 };
    const armVec = new THREE.Vector3(
      sawCenter.x - weapon.pivot.x,
      sawCenter.y - weapon.pivot.y,
      sawCenter.z - weapon.pivot.z,
    );
    const arm = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.1, Math.max(0.4, armVec.length())),
      dark,
    );
    arm.position.copy(armVec.clone().multiplyScalar(0.5));
    arm.lookAt(armVec);
    group.add(arm);
    const saw = cylinderAcross(weapon.radius || dims.y, dims.x, accent, "x");
    saw.position.copy(armVec);
    group.add(saw);
  }
  return group;
}

/**
 * A single tubular arm inside a weapon group, from `bar.from` to `bar.to` in
 * BODY-local feet, mirrored to both sides by `bar.x`. Positioned in the pivot
 * group's frame, so it swings with the weapon it belongs to.
 */
function buildWeaponArm(weaponPivot, bar, spec) {
  const material = new THREE.MeshStandardMaterial({
    color: bar.color || spec.accentDark || "#2a2d33",
    metalness: 0.85,
    roughness: 0.35,
  });
  const from = new THREE.Vector3(bar.x, bar.from.y, bar.from.z);
  const to = new THREE.Vector3(bar.x, bar.to.y, bar.to.z);
  const span = new THREE.Vector3().subVectors(to, from);
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(bar.radius ?? 0.06, bar.radius ?? 0.06, span.length(), 12),
    material,
  );
  mesh.name = "weaponArm";
  // CylinderGeometry runs along +Y; aim it down the span.
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), span.clone().normalize());
  mesh.position.copy(from).addScaledVector(span, 0.5);
  weaponPivot.updateMatrixWorld(true);
  weaponPivot.attach(mesh);
  return mesh;
}

function placeholderWheels(spec) {
  const material = new THREE.MeshStandardMaterial({ color: "#181a1d", metalness: 0.2, roughness: 0.85 });
  return (spec.wheelAnchors || []).map((anchor, index) => {
    const radius = Math.max(0.22, Math.min(anchor.y + 0.08, 0.6));
    const wheel = new THREE.Group();
    wheel.name = `placeholderWheel-${index}`;
    const tire = cylinderAcross(radius, 0.14, material, "x");
    wheel.add(tire);
    const hub = cylinderAcross(radius * 0.45, 0.15, accentMaterial(spec), "x");
    wheel.add(hub);
    wheel.position.set(anchor.x, anchor.y, anchor.z);
    return wheel;
  });
}

// --- GLB helpers ------------------------------------------------------------

// onProgress(fraction|null) reports download progress: a 0..1 fraction while
// the response reports a total, null when it does not (chunked/gzipped
// responses have no usable content-length, which is the common case over
// HTTP). Callers use null to switch to an indeterminate indicator.
async function tryLoadScene(path, onProgress) {
  try {
    const gltf = await loader.loadAsync(path, (event) => {
      if (typeof onProgress !== "function") return;
      onProgress(event?.lengthComputable && event.total > 0 ? event.loaded / event.total : null);
    });
    return gltf?.scene || null;
  } catch {
    return null; // Missing/broken GLB: every part falls back to placeholders.
  }
}

// Bounds over the geometry a mesh actually DRAWS, not over its whole position
// buffer. glb-carve moves triangles between parts and leaves the donor's
// vertices in place, so a deleted stand-off leg still sits in the buffer at its
// old height — and Box3.setFromObject, which reads positions and ignores the
// index, would keep resting the model on geometry nobody can see. Endgame came
// out of the carve floating 0.46ft off the floor for exactly that reason.
//
// The local box is cached on the geometry (once per model, not per call) and
// the world box expands by its eight transformed corners. For the axis-aligned
// yaw/roll every bot in the catalog uses that is exact; for an arbitrary angle
// it is the same AABB-of-rotated-AABB three.js already returns, so it is never
// worse than what it replaces.
const scratchCorner = new THREE.Vector3();
function drawnLocalBox(geometry) {
  if (geometry.userData.__drawnBox) return geometry.userData.__drawnBox;
  const box = new THREE.Box3();
  const pos = geometry.attributes.position;
  const index = geometry.index;
  if (pos) {
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i += 1) {
      scratchCorner.fromBufferAttribute(pos, index ? index.getX(i) : i);
      box.expandByPoint(scratchCorner);
    }
  }
  geometry.userData.__drawnBox = box;
  return box;
}

function drawnBox(object, target = new THREE.Box3()) {
  target.makeEmpty();
  object.updateWorldMatrix(true, true);
  object.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const local = drawnLocalBox(node.geometry);
    if (local.isEmpty()) return;
    for (let i = 0; i < 8; i += 1) {
      scratchCorner.set(
        i & 1 ? local.max.x : local.min.x,
        i & 2 ? local.max.y : local.min.y,
        i & 4 ? local.max.z : local.min.z,
      ).applyMatrix4(node.matrixWorld);
      target.expandByPoint(scratchCorner);
    }
  });
  return target;
}

// Tripo GLBs are ~1-unit normalized and face +X in authoring space; the game
// convention is feet with forward -Z (see catalog header). Rather than baking
// transforms into the files, normalize at load: yaw by spec.modelYaw, roll by
// spec.modelRoll, scale to the catalog footprint (spec.modelScale overrides),
// and rest the wheels on y=0. Runs BEFORE part extraction so detach() bakes it
// into every part.
//
// modelRoll is applied on the WRAPPER, i.e. about the game-space forward axis
// AFTER the yaw, so `Math.PI` means "this model came out of Tripo upside down"
// no matter which way it was facing. Copperhead and Duck both did; nothing in
// the segmentation pass looks at which way is up.
function normalizeScene(scene, spec) {
  if (!scene) return null;
  const wrapper = new THREE.Group();
  wrapper.name = "modelNormalized";
  wrapper.add(scene);
  scene.rotation.y = spec.modelYaw ?? 0;
  wrapper.rotation.z = spec.modelRoll ?? 0;
  wrapper.updateMatrixWorld(true);
  const bbox = drawnBox(wrapper);
  if (bbox.isEmpty()) return wrapper;
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const footprintScale = ((spec.bodyDims.x / Math.max(size.x, 0.001)) + (spec.bodyDims.z / Math.max(size.z, 0.001))) / 2;
  const scale = spec.modelScale ?? footprintScale;
  wrapper.scale.setScalar(scale);
  wrapper.updateMatrixWorld(true);
  const grounded = drawnBox(wrapper);
  wrapper.position.y = -grounded.min.y;
  // Center the footprint on the origin (Tripo models are near-centered but
  // weapon overhangs skew the bbox; recenter on the body when present).
  const bodyNode = wrapper.getObjectByName("modelBody");
  const centerBox = bodyNode ? drawnBox(bodyNode) : grounded;
  const center = new THREE.Vector3();
  centerBox.getCenter(center);
  wrapper.position.x -= center.x;
  wrapper.position.z -= center.z;
  wrapper.updateMatrixWorld(true);
  return wrapper;
}

// Match a visual wheel to the suspension probe under it. Both are in game
// space by the time this runs (normalizeScene has applied yaw/scale), so plain
// XZ distance is the whole story. Bots with more probes than wheels (HUGE runs
// four probes inside two tyres) resolve to one of the probes on that side,
// which report the same speed anyway.
function nearestAnchorIndex(spec, center, fallback) {
  const anchors = spec.wheelAnchors || [];
  if (!anchors.length) return fallback;
  let best = fallback < anchors.length ? fallback : 0;
  let bestDistance = Infinity;
  anchors.forEach((anchor, index) => {
    const distance = (anchor.x - center.x) ** 2 + (anchor.z - center.z) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

function detach(node) {
  node.updateWorldMatrix(true, false);
  const world = node.matrixWorld.clone();
  node.removeFromParent();
  world.decompose(node.position, node.quaternion, node.scale);
  return node;
}

// --- Public API -------------------------------------------------------------

/**
 * Visual weapon angle for a sim render state. Spinners report an accumulated
 * angle used directly; impulse arms (flipper/hammer/crusher) report a 0..1
 * stroke. GLB arms are baked in the pose the reference photo showed (usually
 * FIRED/raised), so stroke maps rest -> baked; placeholders are authored at
 * rest and swing through throwAngle. Owned here, beside the pivot wrapping,
 * so all bot visual behavior tunes in one file.
 */
export function weaponVisualAngle(visual, spec, state) {
  const type = spec.weapon?.type;
  if (type === "flipper" || type === "hammerSaw" || type === "crusher"
    || type === "hammer" || type === "lifter" || type === "lifterDisc" || type === "grappler") {
    const stroke = THREE.MathUtils.clamp(state.weaponAngle ?? 0, 0, 1);
    if (visual.weaponIsPlaceholder) return stroke * (spec.weapon.throwAngle ?? 0.9);
    // GLB arms are baked in one pose (angle 0). restAngle poses the arm at
    // stroke 0, fireAngle at stroke 1 — either may be 0 to mean "the baked
    // pose": bronco is baked FIRED (rest -x, fire 0), sawblaze/quantum are
    // baked at REST (rest 0, fire -x chops/clamps down).
    const rest = spec.weapon.restAngle ?? 0;
    // Grapplers name their top-of-travel liftAngle; it is the same thing.
    const fired = spec.weapon.fireAngle ?? spec.weapon.liftAngle ?? 0;
    return rest + stroke * (fired - rest);
  }
  return state.weaponAngle ?? 0;
}

/**
 * @param {import('./catalog.js').BotSpec} spec
 * @returns {Promise<{ group: THREE.Group, parts: { body: THREE.Object3D, weapon: THREE.Group|null, wheels: THREE.Object3D[] } }>}
 */
export async function loadBotModel(spec, { onProgress } = {}) {
  const scene = normalizeScene(await tryLoadScene(spec.modelPath, onProgress), spec);

  const group = new THREE.Group();
  group.name = `bot-${spec.id}`;

  // Body: named GLB node or placeholder chassis.
  let body = scene?.getObjectByName("modelBody") || null;
  body = body ? detach(body) : placeholderBody(spec);
  group.add(body);

  // Weapon: always wrapped in a pivot group so setting rotation on
  // parts.weapon spins about spec.weapon.pivot / spec.weapon.axis.
  let weaponPivot = null;
  let usedGlbWeapon = false;
  let weaponSub = null;
  if (spec.weapon) {
    weaponPivot = new THREE.Group();
    weaponPivot.name = "weaponPivot";
    const pivot = { ...spec.weapon.pivot };
    const glbWeapon = scene?.getObjectByName("modelWeapon") || null;
    usedGlbWeapon = Boolean(glbWeapon);
    if (glbWeapon) {
      // Prefer the pivot authored in the GLB extras (glb-partition writes
      // pivotLocal in raw GLB scene space — the part map's pivotOverride for
      // hinged arms, or the part bbox center for spinners). Transform it
      // through the normalization (yaw/scale/grounding) into game space.
      // Fall back to the normalized part's bbox center.
      const pivotLocal = glbWeapon.userData?.pivotLocal;
      const center = new THREE.Vector3();
      let havePivot = false;
      // ...unless the catalog says the GLB's is wrong. Duck's plow rides on two
      // long carrier bars back to a hinge between the axles; segmentation never
      // saw the bars, so the pivot it wrote is at the plow itself and the scoop
      // hinges on its own lip instead of swinging on an arm.
      if (spec.weapon.pivotFromCatalog) {
        center.set(pivot.x, pivot.y, pivot.z);
        havePivot = true;
      } else if (Array.isArray(pivotLocal) && glbWeapon.parent) {
        glbWeapon.parent.updateWorldMatrix(true, false);
        center.fromArray(pivotLocal).applyMatrix4(glbWeapon.parent.matrixWorld);
        havePivot = true;
      }
      detach(glbWeapon);
      if (!havePivot) {
        const bbox = new THREE.Box3().setFromObject(glbWeapon);
        if (!bbox.isEmpty()) bbox.getCenter(center);
        else center.set(pivot.x, pivot.y, pivot.z);
      }
      pivot.x = center.x;
      pivot.y = center.y;
      pivot.z = center.z;
      weaponPivot.position.set(pivot.x, pivot.y, pivot.z);
      weaponPivot.attach(glbWeapon); // preserves the part's world placement
      // Structure the scan could not see. Some mechanisms are mostly air —
      // Duck's plow hangs off two thin bars — and photogrammetry resolves them
      // as nothing at all, which leaves the moving part floating unattached to
      // the hinge it turns about. They are simple enough to state as numbers.
      for (const bar of spec.weapon.arms || []) {
        // attach: "body" pins the part to the chassis instead of the moving
        // group. A hydraulic ram belongs to the frame — it PUSHES the arm, it
        // does not ride on it, and swinging it rigidly with the jaw reads as a
        // strut welded to the wrong end.
        buildWeaponArm(bar.attach === "body" ? group : weaponPivot, bar, spec);
      }
      // Nested sub-spinner (modelWeaponSub-*, e.g. sawblaze's saw disc):
      // wrapped in its own pivot at its bbox center INSIDE the weapon group,
      // so it swings with the arm and spins locally.
      let subNode = null;
      glbWeapon.traverse((child) => {
        if (!subNode && child.name?.startsWith("modelWeaponSub-")) subNode = child;
      });
      if (subNode) {
        const subCenter = new THREE.Vector3();
        // A hinged jaw (clawviper) turns about its knuckle, not its middle, so
        // the part map's pivotOverride wins when the partitioner baked one.
        // Without it (sawblaze's disc) the bbox center is the axle.
        const subPivotLocal = subNode.userData?.pivotLocal;
        if (Array.isArray(subPivotLocal) && subNode.parent) {
          subNode.parent.updateWorldMatrix(true, false);
          subCenter.fromArray(subPivotLocal).applyMatrix4(subNode.parent.matrixWorld);
        } else {
          const subBox = new THREE.Box3().setFromObject(subNode);
          if (!subBox.isEmpty()) subBox.getCenter(subCenter);
        }
        const subPivot = new THREE.Group();
        subPivot.name = "weaponSubPivot";
        // Parent to the WEAPON PIVOT, not to the sub node's GLB parent. The
        // integrator spins this group about spec.weapon.axis, which is a game
        // -space axis; nodes inside the GLB hierarchy still carry the
        // normalization yaw, so under the GLB parent that axis lands rotated
        // (sawblaze's disc span about vertical instead of in its own plane).
        // weaponPivot is a plain group in game space, and the disc is bolted
        // to the arm anyway, so it correctly swings with the arm from here.
        weaponPivot.add(subPivot);
        // Box3 center is world-space; bring it into the pivot's frame.
        weaponPivot.updateWorldMatrix(true, false);
        subPivot.position.copy(weaponPivot.worldToLocal(subCenter.clone()));
        subPivot.attach(subNode);
        weaponSub = subPivot;
      }
    } else {
      weaponPivot.position.set(pivot.x, pivot.y, pivot.z);
      const placeholder = placeholderWeapon(spec);
      if (placeholder) weaponPivot.add(placeholder);
    }
    group.add(weaponPivot);
  }

  // Wheels: collect named nodes; if none exist, place placeholder cylinders
  // at the catalog wheel anchors. Every wheel is wrapped in a pivot group at
  // its own center so spin writes (pivot.rotation.x) compose with the wheel's
  // baked orientation instead of overwriting it.
  const wheels = [];
  if (scene) {
    for (let i = 0; i < MAX_WHEEL_NODES; i += 1) {
      const wheel = scene.getObjectByName(`modelWheel-${i}`);
      if (!wheel) break;
      detach(wheel);
      const bbox = new THREE.Box3().setFromObject(wheel);
      const center = new THREE.Vector3();
      if (!bbox.isEmpty()) bbox.getCenter(center);
      const pivot = new THREE.Group();
      pivot.name = `wheelPivot-${i}`;
      pivot.position.copy(center);
      pivot.attach(wheel);
      // Which suspension probe drives this wheel: nearest catalog anchor, NOT
      // the node's ordinal. modelWheel-N numbering follows the GLB's part map,
      // which has no reason to agree with wheelAnchors order — on HUGE it is
      // reversed, so the left stick spun the right wheel.
      pivot.userData.spinIndex = nearestAnchorIndex(spec, center, i);
      wheels.push(pivot);
    }
  }
  // hideWheels: the bot's real wheels are enclosed by its shell and never
  // segmented out (Beta), so the procedural fallback would push cylinders
  // through the bodywork. The suspension still runs off wheelAnchors.
  if (wheels.length === 0 && !spec.hideWheels) wheels.push(...placeholderWheels(spec).map((wheel, i) => {
    const pivot = new THREE.Group();
    pivot.name = `wheelPivot-${i}`;
    pivot.position.copy(wheel.position);
    wheel.position.set(0, 0, 0);
    pivot.add(wheel);
    pivot.userData.spinIndex = i; // placeholders are built from the anchors
    return pivot;
  }));
  wheels.forEach((wheel) => group.add(wheel));

  // Aux animated groups (modelAux-<name>, e.g. bronco's pneumatic ram): each
  // is re-anchored at its own BOTTOM-center so scaling Y compresses the part
  // toward its base — it shortens without ever extending below its mount.
  const aux = {};
  if (scene) {
    const auxNodes = [];
    scene.traverse((node) => {
      if (node.name?.startsWith("modelAux-")) auxNodes.push(node);
    });
    for (const node of auxNodes) {
      const name = node.name.slice("modelAux-".length);
      detach(node);
      const bbox = new THREE.Box3().setFromObject(node);
      const anchor = new THREE.Group();
      anchor.name = `auxAnchor-${name}`;
      if (!bbox.isEmpty()) {
        const center = new THREE.Vector3();
        bbox.getCenter(center);
        anchor.position.set(center.x, bbox.min.y, center.z);
      }
      anchor.attach(node);
      group.add(anchor);
      aux[name] = anchor;
    }
  }

  // Swept-volume ghost for a spinner: a translucent disc the size of the
  // blade's circle, hidden until the rotor is fast enough that a real one would
  // be a smear. It stands in for motion blur, which would otherwise need a
  // post-process pass to fake something the eye supplies for free.
  let spinBlur = null;
  if (weaponPivot && (spec.weapon.type === "bar" || spec.weapon.type === "drum")) {
    const radius = spec.weapon.radius ?? Math.max(spec.weapon.dims?.y ?? 0.5, spec.weapon.dims?.z ?? 0.5);
    const thickness = (spec.weapon.dims?.x ?? 0.2) * 2;
    spinBlur = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, thickness, 28, 1, true),
      new THREE.MeshBasicMaterial({
        color: spec.accent || "#9aa3b0",
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    spinBlur.name = "spinBlur";
    // Lie the cylinder down on the spin axis.
    const axis = new THREE.Vector3(spec.weapon.axis.x, spec.weapon.axis.y, spec.weapon.axis.z).normalize();
    spinBlur.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    spinBlur.position.copy(weaponPivot.position);
    spinBlur.visible = false;
    spinBlur.castShadow = false;
    group.add(spinBlur);
  }

  repaintScanned(group, spec);
  markShadows(group);
  if (spinBlur) spinBlur.castShadow = false;
  return {
    group,
    parts: { body, weapon: weaponPivot, wheels, aux, weaponSub, spinBlur },
    weaponIsPlaceholder: Boolean(spec.weapon) && !usedGlbWeapon,
  };
}
