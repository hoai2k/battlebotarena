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

// Tripo GLBs are ~1-unit normalized and face +X in authoring space; the game
// convention is feet with forward -Z (see catalog header). Rather than baking
// transforms into the files, normalize at load: yaw by spec.modelYaw, scale to
// the catalog footprint (spec.modelScale overrides), and rest the wheels on
// y=0. Runs BEFORE part extraction so detach() bakes it into every part.
function normalizeScene(scene, spec) {
  if (!scene) return null;
  const wrapper = new THREE.Group();
  wrapper.name = "modelNormalized";
  wrapper.add(scene);
  scene.rotation.y = spec.modelYaw ?? 0;
  wrapper.updateMatrixWorld(true);
  const bbox = new THREE.Box3().setFromObject(wrapper);
  if (bbox.isEmpty()) return wrapper;
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const footprintScale = ((spec.bodyDims.x / Math.max(size.x, 0.001)) + (spec.bodyDims.z / Math.max(size.z, 0.001))) / 2;
  const scale = spec.modelScale ?? footprintScale;
  wrapper.scale.setScalar(scale);
  wrapper.updateMatrixWorld(true);
  const grounded = new THREE.Box3().setFromObject(wrapper);
  wrapper.position.y = -grounded.min.y;
  // Center the footprint on the origin (Tripo models are near-centered but
  // weapon overhangs skew the bbox; recenter on the body when present).
  const bodyNode = wrapper.getObjectByName("modelBody");
  const centerBox = bodyNode ? new THREE.Box3().setFromObject(bodyNode) : grounded;
  const center = new THREE.Vector3();
  centerBox.getCenter(center);
  wrapper.position.x -= center.x;
  wrapper.position.z -= center.z;
  wrapper.updateMatrixWorld(true);
  return wrapper;
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
  if (type === "flipper" || type === "hammerSaw" || type === "crusher") {
    const stroke = THREE.MathUtils.clamp(state.weaponAngle ?? 0, 0, 1);
    if (visual.weaponIsPlaceholder) return stroke * (spec.weapon.throwAngle ?? 0.9);
    // GLB arms are baked in one pose (angle 0). restAngle poses the arm at
    // stroke 0, fireAngle at stroke 1 — either may be 0 to mean "the baked
    // pose": bronco is baked FIRED (rest -x, fire 0), sawblaze/quantum are
    // baked at REST (rest 0, fire -x chops/clamps down).
    const rest = spec.weapon.restAngle ?? 0;
    const fired = spec.weapon.fireAngle ?? 0;
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
      if (Array.isArray(pivotLocal) && glbWeapon.parent) {
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
      // Nested sub-spinner (modelWeaponSub-*, e.g. sawblaze's saw disc):
      // wrapped in its own pivot at its bbox center INSIDE the weapon group,
      // so it swings with the arm and spins locally.
      let subNode = null;
      glbWeapon.traverse((child) => {
        if (!subNode && child.name?.startsWith("modelWeaponSub-")) subNode = child;
      });
      if (subNode) {
        const parent = subNode.parent;
        const subBox = new THREE.Box3().setFromObject(subNode);
        const subCenter = new THREE.Vector3();
        if (!subBox.isEmpty()) subBox.getCenter(subCenter);
        const subPivot = new THREE.Group();
        subPivot.name = "weaponSubPivot";
        parent.add(subPivot);
        // Box3 center is world-space; bring it into the parent's frame.
        parent.updateWorldMatrix(true, false);
        subPivot.position.copy(parent.worldToLocal(subCenter.clone()));
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
      wheels.push(pivot);
    }
  }
  if (wheels.length === 0) wheels.push(...placeholderWheels(spec).map((wheel, i) => {
    const pivot = new THREE.Group();
    pivot.name = `wheelPivot-${i}`;
    pivot.position.copy(wheel.position);
    wheel.position.set(0, 0, 0);
    pivot.add(wheel);
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

  markShadows(group);
  return {
    group,
    parts: { body, weapon: weaponPivot, wheels, aux, weaponSub },
    weaponIsPlaceholder: Boolean(spec.weapon) && !usedGlbWeapon,
  };
}
