import * as THREE from "three";
import { BOT_CONFIG } from "./botConfig.js";
import { MODEL_PART_CONFIG } from "./modelPartConfig.js";
import { fractionBoundsToBox, modelAuthoringBounds, normalizeSegmentedModel, originalAuthoringBoundsForMesh, splitConfiguredModelParts, splitSegmentedModelParts } from "./modelParts.js";

import { PORTED_BOT_IDS } from "./portedBots.js";

export const BOT_PICKER_ORDER = ["bronco", "biteforce", "huge", "quantum", "hypershock", "minotaur", ...PORTED_BOT_IDS];

const BRONCO_FLIPPER_LOWERED_ANGLE = -0.34;
const BRONCO_FLIPPER_RAISED_ANGLE = 0.0;
const QUANTUM_CRUSHER_OPEN_ANGLE = 0;
const QUANTUM_CRUSHER_CLOSED_ANGLE = -1.05;

export const bots = Object.entries(BOT_CONFIG).map(([id, config]) => ({
  id,
  ...config,
})).sort((a, b) => BOT_PICKER_ORDER.indexOf(a.id) - BOT_PICKER_ORDER.indexOf(b.id));

export function prepareLoadedModel(root, fit = { width: 2.9, height: 1.45, depth: 2.9 }) {
  const model = root.clone(true);
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.geometry = child.geometry.clone();
    if (child.material) child.material = child.material.clone();
  });

  const box3 = modelAuthoringBounds(model) || new THREE.Box3().setFromObject(model);
  const size = box3.getSize(new THREE.Vector3());
  const fitScale = Number.isFinite(fit.scale) ? fit.scale : 1;
  const scale = Math.min(fit.width / size.x, fit.height / size.y, fit.depth / size.z) * fitScale;
  model.scale.setScalar(Number.isFinite(scale) ? scale : 1);

  const fitted = modelAuthoringBounds(model) || new THREE.Box3().setFromObject(model);
  const center = fitted.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -fitted.min.y, -center.z);
  return model;
}

function makeSplitGeometry(data) {
  if (!data.position.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(data.position, 3));
  if (data.normal.length) geometry.setAttribute("normal", new THREE.Float32BufferAttribute(data.normal, 3));
  if (data.uv.length) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(data.uv, 2));
  if (!data.normal.length) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeBroncoFlipperWeapon(model) {
  let mesh = null;
  model.traverse((child) => {
    if (child.isMesh && !mesh) mesh = child;
  });
  if (!mesh?.geometry?.attributes.position) return null;

  const geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const bounds = originalAuthoringBoundsForMesh(mesh) || geometry.boundingBox;
  const size = bounds.getSize(new THREE.Vector3());
  const sourcePosition = geometry.attributes.position;
  const sourceNormal = geometry.attributes.normal;
  const sourceUv = geometry.attributes.uv || geometry.attributes.uv0;
  const index = geometry.index;
  const liftStart = bounds.min.y + size.y * 0.42;
  const hinge = new THREE.Vector3(0, bounds.min.y + size.y * 0.34, bounds.max.z - size.z * 0.1);
  const bodyData = { position: [], normal: [], uv: [] };
  const flipperData = { position: [], normal: [], uv: [] };
  const tri = [0, 0, 0];

  const pushVertex = (data, vertexIndex, offset = null) => {
    const x = sourcePosition.getX(vertexIndex);
    const y = sourcePosition.getY(vertexIndex);
    const z = sourcePosition.getZ(vertexIndex);
    data.position.push(offset ? x - offset.x : x, offset ? y - offset.y : y, offset ? z - offset.z : z);
    if (sourceNormal) data.normal.push(sourceNormal.getX(vertexIndex), sourceNormal.getY(vertexIndex), sourceNormal.getZ(vertexIndex));
    if (sourceUv) data.uv.push(sourceUv.getX(vertexIndex), sourceUv.getY(vertexIndex));
  };

  const triangleCount = index ? index.count / 3 : sourcePosition.count / 3;
  for (let i = 0; i < triangleCount; i += 1) {
    for (let j = 0; j < 3; j += 1) tri[j] = index ? index.getX(i * 3 + j) : i * 3 + j;
    const cx = (sourcePosition.getX(tri[0]) + sourcePosition.getX(tri[1]) + sourcePosition.getX(tri[2])) / 3;
    const cy = (sourcePosition.getY(tri[0]) + sourcePosition.getY(tri[1]) + sourcePosition.getY(tri[2])) / 3;
    const cz = (sourcePosition.getZ(tri[0]) + sourcePosition.getZ(tri[1]) + sourcePosition.getZ(tri[2])) / 3;
    const raised = cy > liftStart;
    const narrowCenter = Math.abs(cx) < size.x * 0.2;
    const frontTip = Math.abs(cx) < size.x * 0.16 && cy > bounds.min.y + size.y * 0.2 && cz < bounds.min.z + size.z * 0.12;
    const notRearArmor = cz < bounds.max.z - size.z * 0.16;
    const notFrontFork = cz > bounds.min.z + size.z * 0.08;
    const data = notRearArmor && (frontTip || (raised && narrowCenter && notFrontFork)) ? flipperData : bodyData;
    const offset = data === flipperData ? hinge : null;
    tri.forEach((vertexIndex) => pushVertex(data, vertexIndex, offset));
  }

  const bodyGeometry = makeSplitGeometry(bodyData);
  const flipperGeometry = makeSplitGeometry(flipperData);
  if (!bodyGeometry || !flipperGeometry) return null;

  const parent = mesh.parent;
  const body = new THREE.Mesh(bodyGeometry, mesh.material.clone());
  const flipper = new THREE.Mesh(flipperGeometry, mesh.material.clone());
  const pivot = new THREE.Group();
  body.name = "modelBody";
  pivot.name = "modelWeapon";
  body.userData.viewerPart = "body";
  pivot.userData.viewerPart = "weapon";
  body.castShadow = true;
  body.receiveShadow = true;
  flipper.castShadow = true;
  flipper.receiveShadow = true;
  body.matrix.copy(mesh.matrix);
  body.matrix.decompose(body.position, body.quaternion, body.scale);
  pivot.position.copy(hinge);
  pivot.quaternion.copy(mesh.quaternion);
  pivot.scale.copy(mesh.scale);
  pivot.add(flipper);
  parent.add(body, pivot);
  mesh.visible = false;
  pivot.rotation.x = BRONCO_FLIPPER_LOWERED_ANGLE;

  return {
    type: "flipper",
    object: pivot,
    body,
    baseRotation: BRONCO_FLIPPER_LOWERED_ANGLE,
    activeRotation: BRONCO_FLIPPER_RAISED_ANGLE,
    activeSpeed: 48,
    returnSpeed: 4.2,
  };
}

function makeQuantumCrusherWeapon(model) {
  let mesh = null;
  model.traverse((child) => {
    if (child.isMesh && !mesh) mesh = child;
  });
  if (!mesh?.geometry?.attributes.position) return null;

  const geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const bounds = originalAuthoringBoundsForMesh(mesh) || geometry.boundingBox;
  const size = bounds.getSize(new THREE.Vector3());
  const sourcePosition = geometry.attributes.position;
  const sourceNormal = geometry.attributes.normal;
  const sourceUv = geometry.attributes.uv || geometry.attributes.uv0;
  const index = geometry.index;
  const bodyData = { position: [], normal: [], uv: [] };
  const skullData = { position: [], normal: [], uv: [] };
  const hinge = new THREE.Vector3(0, bounds.min.y + size.y * 0.48, bounds.min.z + size.z * 0.4);
  const tri = [0, 0, 0];

  const pushVertex = (data, vertexIndex, offset = null) => {
    const x = sourcePosition.getX(vertexIndex);
    const y = sourcePosition.getY(vertexIndex);
    const z = sourcePosition.getZ(vertexIndex);
    data.position.push(offset ? x - offset.x : x, offset ? y - offset.y : y, offset ? z - offset.z : z);
    if (sourceNormal) data.normal.push(sourceNormal.getX(vertexIndex), sourceNormal.getY(vertexIndex), sourceNormal.getZ(vertexIndex));
    if (sourceUv) data.uv.push(sourceUv.getX(vertexIndex), sourceUv.getY(vertexIndex));
  };

  const triangleCount = index ? index.count / 3 : sourcePosition.count / 3;
  for (let i = 0; i < triangleCount; i += 1) {
    for (let j = 0; j < 3; j += 1) tri[j] = index ? index.getX(i * 3 + j) : i * 3 + j;
    const cx = (sourcePosition.getX(tri[0]) + sourcePosition.getX(tri[1]) + sourcePosition.getX(tri[2])) / 3;
    const cy = (sourcePosition.getY(tri[0]) + sourcePosition.getY(tri[1]) + sourcePosition.getY(tri[2])) / 3;
    const cz = (sourcePosition.getZ(tri[0]) + sourcePosition.getZ(tri[1]) + sourcePosition.getZ(tri[2])) / 3;
    const aboveFrontArmor = cy > bounds.min.y + size.y * 0.42;
    const inTopJawWidth = Math.abs(cx) < size.x * 0.4;
    const inCrusherSide = cz < bounds.min.z + size.z * 0.62;
    const pastPivot = cz > bounds.min.z + size.z * 0.1;
    const frontTip = cz < bounds.min.z + size.z * 0.2 && cy > bounds.min.y + size.y * 0.34 && Math.abs(cx) < size.x * 0.44;
    const notCenterMechanism = !(Math.abs(cx) < size.x * 0.18 && cz > bounds.min.z + size.z * 0.34 && cy < bounds.min.y + size.y * 0.62);
    const data = frontTip || (aboveFrontArmor && inTopJawWidth && inCrusherSide && pastPivot && notCenterMechanism) ? skullData : bodyData;
    const offset = data === skullData ? hinge : null;
    tri.forEach((vertexIndex) => pushVertex(data, vertexIndex, offset));
  }

  const bodyGeometry = makeSplitGeometry(bodyData);
  const skullGeometry = makeSplitGeometry(skullData);
  if (!bodyGeometry || !skullGeometry) return null;

  const parent = mesh.parent;
  const body = new THREE.Mesh(bodyGeometry, mesh.material.clone());
  const skull = new THREE.Mesh(skullGeometry, mesh.material.clone());
  const pivot = new THREE.Group();
  body.name = "modelBody";
  pivot.name = "modelWeapon";
  body.userData.viewerPart = "body";
  pivot.userData.viewerPart = "weapon";
  body.castShadow = true;
  body.receiveShadow = true;
  skull.castShadow = true;
  skull.receiveShadow = true;
  body.matrix.copy(mesh.matrix);
  body.matrix.decompose(body.position, body.quaternion, body.scale);
  pivot.position.copy(hinge);
  pivot.quaternion.copy(mesh.quaternion);
  pivot.scale.copy(mesh.scale);
  pivot.add(skull);
  parent.add(body, pivot);
  mesh.visible = false;

  return {
    type: "crusher",
    object: pivot,
    body,
    baseRotation: QUANTUM_CRUSHER_OPEN_ANGLE,
    activeRotation: QUANTUM_CRUSHER_CLOSED_ANGLE,
    speed: 8,
  };
}

export function buildModelViewerGroup(id, sourceModel) {
  const config = MODEL_PART_CONFIG[id];
  const spec = bots.find((bot) => bot.id === id) || {};
  const group = new THREE.Group();
  if (!config || !sourceModel) return group;

  // A bot ported from v2 arrives segmented and pre-scaled, so the tweaker shows
  // it the same way the game does: normalized rather than fitted to a box, and
  // split by part name rather than by hand-drawn regions. Its colliders are
  // authored in the same frame, so the overlays still land — there is just
  // nothing here that needs dragging.
  if (config.segmented) {
    const container = new THREE.Group();
    container.name = "modelSegmented";
    container.add(normalizeSegmentedModel(sourceModel.clone(true), config.model));
    group.add(container);
    group.userData.sourceModel = container;
    group.userData.segmentedModel = true;
    group.userData.modelPartConfig = config;
    const segmentedParts = splitSegmentedModelParts(container, config, spec);
    group.userData.weapon = segmentedParts.weapon;
    group.userData.drivetrain = segmentedParts.drivetrain;
    group.userData.viewerParts = segmentedParts.viewerParts;
    return group;
  }

  const model = prepareLoadedModel(sourceModel, config.fit);
  group.add(model);
  group.userData.sourceModel = model;
  group.userData.modelPartConfig = config;

  if (id === "bronco") {
    const weapon = makeBroncoFlipperWeapon(model);
    group.userData.weapon = weapon;
    group.userData.viewerParts = {
      body: weapon?.body || model,
      weapon: weapon?.object || null,
      wheels: [],
    };
    return group;
  }

  if (id === "quantum") {
    const weapon = makeQuantumCrusherWeapon(model);
    group.userData.weapon = weapon;
    group.userData.viewerParts = {
      body: weapon?.body || model,
      weapon: weapon?.object || null,
      wheels: [],
    };
    return group;
  }

  const movingParts = splitConfiguredModelParts(model, config, spec);
  group.userData.weapon = movingParts.weapon;
  group.userData.drivetrain = movingParts.drivetrain;
  group.userData.viewerParts = movingParts.viewerParts;
  return group;
}

function removeObjectFromParent(object) {
  if (!object?.parent) return;
  object.parent.remove(object);
}

function removeViewerParts(parts = {}) {
  removeObjectFromParent(parts.body);
  removeObjectFromParent(parts.weapon);
  parts.wheels?.forEach(removeObjectFromParent);
}

function modelPartConfigWithWeaponSplit(config, split) {
  return {
    ...config,
    weapon: {
      ...(config.weapon || {}),
      ...(split.weapon || {}),
      pivot: split.pivot || split.weapon?.pivot || config.weapon?.pivot,
      regions: split.region ? [split.region] : split.weapon?.regions || config.weapon?.regions || [],
    },
  };
}

export function rebuildModelViewerSplit(group, id, split) {
  const model = group?.userData?.sourceModel;
  const config = MODEL_PART_CONFIG[id];
  if (!model || !config || !split?.region) return null;
  removeViewerParts(group.userData.viewerParts);
  model.traverse((child) => {
    if (child.userData?.modelPartAuthoringMesh) child.visible = true;
  });
  const spec = bots.find((bot) => bot.id === id) || {};
  const splitConfig = modelPartConfigWithWeaponSplit(config, split);
  const movingParts = splitConfiguredModelParts(model, splitConfig, spec);
  group.userData.modelPartConfig = splitConfig;
  group.userData.weapon = movingParts.weapon;
  group.userData.drivetrain = movingParts.drivetrain;
  group.userData.viewerParts = movingParts.viewerParts;
  return movingParts;
}

export function isGroundingVisualMesh(mesh) {
  if (!mesh?.isMesh || !mesh.visible) return false;
  let node = mesh;
  while (node) {
    const name = node.name?.toLowerCase() || "";
    if (name.includes("helper") || name.includes("colliderpreview")) return false;
    node = node.parent;
  }
  return true;
}

export function measureVisualFloorOffset(group) {
  // A segmented (ported) model was already grounded on its drawn geometry when
  // it was normalized; measuring it again through the position buffer would
  // pick up vertices a carve orphaned and lift the whole bot off the floor.
  if (group?.userData?.segmentedModel) return 0;
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  group.traverse((child) => {
    if (!isGroundingVisualMesh(child) || !child.geometry?.attributes?.position) return;
    const position = child.geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
      bounds.expandByPoint(point);
    }
  });
  return Number.isFinite(bounds.min.y) ? -bounds.min.y : 0;
}

export function setViewerPartVisibility(group, view = "everything") {
  const parts = group?.userData?.viewerParts;
  if (!parts) return;
  const showEverything = view === "everything";
  if (parts.body) parts.body.visible = showEverything || view === "body";
  if (parts.weapon) parts.weapon.visible = showEverything || view === "weapon";
  parts.wheels?.forEach((wheel) => {
    wheel.visible = showEverything || view === "wheels";
  });
}

export function cloneColliderPart(part) {
  const copy = {
    type: part.type || "box",
    part: part.part || "body",
    position: [...(part.position || [0, 0, 0])],
    halfExtents: [...(part.halfExtents || [0.4, 0.15, 0.4])],
    density: part.density ?? 3,
  };
  if (part.rotation) copy.rotation = [...part.rotation];
  if (part.side) copy.side = part.side;
  if (part.vertices) copy.vertices = part.vertices.map((point) => [...point]);
  if (part.friction !== undefined) copy.friction = part.friction;
  if (part.restitution !== undefined) copy.restitution = part.restitution;
  if (part.ignoreGroundContact !== undefined) copy.ignoreGroundContact = part.ignoreGroundContact;
  if (part.ignoreLocalBottomFloorContact !== undefined) copy.ignoreLocalBottomFloorContact = part.ignoreLocalBottomFloorContact;
  return copy;
}

export function authoredColliderParts(id) {
  const config = MODEL_PART_CONFIG[id] || {};
  const parts = config.collider?.parts || config.colliders || [];
  return parts.map(cloneColliderPart);
}

export function colliderKind(part) {
  if (part.part === "weapon") return "weapon";
  if (part.part === "driveContact") return "driveContact";
  if (part.part === "wedge" || part.type === "wedge") return "wedge";
  return "physics";
}

export function colliderVisibleForMode(part, mode = "all") {
  const kind = colliderKind(part);
  if (mode === "physics") return kind === "physics";
  if (mode === "drive") return kind === "driveContact";
  if (mode === "weapon") return kind === "weapon";
  if (mode === "wedge") return kind === "wedge";
  return true;
}

export function wedgeVertices(halfExtents) {
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

export function colliderPreviewGeometry(part) {
  if (part.vertices?.length >= 4) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(part.vertices.flat(), 3));
    const indices = part.vertices.length === 8
      ? [
          0, 1, 3, 1, 2, 3,
          4, 7, 5, 5, 7, 6,
          0, 4, 5, 0, 5, 1,
          1, 5, 6, 1, 6, 2,
          0, 3, 7, 0, 7, 4,
          3, 2, 6, 3, 6, 7,
        ]
      : [];
    for (let i = 1; !indices.length && i < part.vertices.length - 1; i += 1) indices.push(0, i, i + 1);
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }
  if (part.type === "wedge") {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(wedgeVertices(part.halfExtents || [0.4, 0.15, 0.4]).flat(), 3));
    geometry.setIndex([
      0, 2, 4,
      1, 5, 3,
      0, 1, 3, 0, 3, 2,
      2, 3, 5, 2, 5, 4,
      0, 4, 5, 0, 5, 1,
    ]);
    geometry.computeVertexNormals();
    return geometry;
  }
  if (part.type === "cylinder") {
    const halfExtents = part.halfExtents || [0.2, 0.5, 0.5];
    const radius = Math.max(0.01, (Math.abs(halfExtents[1]) + Math.abs(halfExtents[2])) * 0.5);
    const height = Math.max(0.02, Math.abs(halfExtents[0]) * 2);
    return new THREE.CylinderGeometry(radius, radius, height, 32, 1);
  }
  return new THREE.BoxGeometry(...(part.halfExtents || [0.4, 0.15, 0.4]).map((value) => value * 2));
}

export function partTransformMatrix(part) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(part.position || [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0]))),
    new THREE.Vector3(1, 1, 1),
  );
}

export function makeColliderObject(part, index) {
  const kind = colliderKind(part);
  const color = kind === "weapon" ? 0xff4fd8 : kind === "driveContact" ? 0x20e6b6 : kind === "wedge" ? 0xffd24a : 0x45d8ff;
  const edgeColor = kind === "weapon" ? 0xffb7ef : kind === "driveContact" ? 0xb7fff0 : kind === "wedge" ? 0xffd24a : 0xc8f6ff;
  const opacity = kind === "weapon" ? 0.34 : kind === "driveContact" ? 0.28 : kind === "wedge" ? 0.3 : 0.18;
  const mesh = new THREE.Mesh(
    colliderPreviewGeometry(part),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    }),
  );
  const lines = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({
      color: edgeColor,
      transparent: true,
      opacity: kind === "physics" ? 0.78 : 1,
      depthWrite: false,
    }),
  );
  const object = new THREE.Group();
  object.name = `collider-${index + 1}`;
  object.userData.colliderIndex = index;
  object.userData.colliderKind = kind;
  object.userData.part = part;
  object.add(mesh, lines);
  partTransformMatrix(part).decompose(object.position, object.quaternion, object.scale);
  mesh.renderOrder = 42 + index * 2;
  lines.renderOrder = 43 + index * 2;
  return object;
}

export function refreshColliderObjectGeometry(object, part) {
  const mesh = object.children.find((child) => child.isMesh);
  const lines = object.children.find((child) => child.isLineSegments);
  if (!mesh) return;
  mesh.geometry.dispose();
  mesh.geometry = colliderPreviewGeometry(part);
  if (lines) {
    lines.geometry.dispose();
    lines.geometry = new THREE.EdgesGeometry(mesh.geometry);
  }
}

export function syncPartFromObject(part, object) {
  part.position = [object.position.x, object.position.y, object.position.z];
  const euler = new THREE.Euler().setFromQuaternion(object.quaternion, "XYZ");
  part.rotation = [euler.x, euler.y, euler.z];
}

export function setObjectFromPart(object, part) {
  partTransformMatrix(part).decompose(object.position, object.quaternion, object.scale);
}

export function visualLocalBoundsForObject(group, object) {
  group.updateMatrixWorld(true);
  const inverseRoot = group.matrixWorld.clone().invert();
  const bounds = new THREE.Box3();
  const meshBox = new THREE.Box3();
  object.traverse((child) => {
    if (!isGroundingVisualMesh(child)) return;
    meshBox.setFromObject(child);
    if (Number.isFinite(meshBox.min.x)) bounds.union(meshBox);
  });
  if (!Number.isFinite(bounds.min.x)) return null;
  const corners = [];
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        corners.push(new THREE.Vector3(x, y, z).applyMatrix4(inverseRoot));
      }
    }
  }
  return new THREE.Box3().setFromPoints(corners);
}

export function visualLocalVertexPoints(group, object) {
  group.updateMatrixWorld(true);
  const inverseRoot = group.matrixWorld.clone().invert();
  const points = [];
  const scratch = new THREE.Vector3();
  object.traverse((child) => {
    if (!isGroundingVisualMesh(child) || !child.geometry?.attributes?.position) return;
    const position = child.geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      scratch.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld).applyMatrix4(inverseRoot);
      points.push(scratch.clone());
    }
  });
  return points;
}

function viewerWheelObjects(group) {
  const drivetrain = group?.userData?.drivetrain;
  const wheels = [
    ...(drivetrain?.leftWheels || []).map((object) => ({ object, side: "left" })),
    ...(drivetrain?.rightWheels || []).map((object) => ({ object, side: "right" })),
  ];
  if (wheels.length) return wheels;
  return (group?.userData?.viewerParts?.wheels || []).map((object) => ({ object, side: null }));
}

function boxToColliderPart(box, density = 4) {
  const size = box.getSize(new THREE.Vector3());
  if (size.x < 0.01 || size.y < 0.01 || size.z < 0.01) return null;
  const center = box.getCenter(new THREE.Vector3());
  return {
    type: "box",
    part: "body",
    position: [center.x, center.y, center.z],
    halfExtents: [size.x * 0.5, size.y * 0.5, size.z * 0.5],
    density,
  };
}

function pointsToPercentileBox(points, trims = {}) {
  if (!points.length) return null;
  const percentile = (values, fraction) => {
    const sorted = [...values].sort((a, b) => a - b);
    const index = THREE.MathUtils.clamp(Math.round((sorted.length - 1) * fraction), 0, sorted.length - 1);
    return sorted[index];
  };
  const xTrim = trims.x ?? 0.02;
  const yTrim = trims.y ?? 0.015;
  const zTrim = trims.z ?? 0.02;
  return new THREE.Box3(
    new THREE.Vector3(
      percentile(points.map((point) => point.x), xTrim),
      percentile(points.map((point) => point.y), yTrim),
      percentile(points.map((point) => point.z), zTrim),
    ),
    new THREE.Vector3(
      percentile(points.map((point) => point.x), 1 - xTrim),
      percentile(points.map((point) => point.y), 1 - yTrim),
      percentile(points.map((point) => point.z), 1 - zTrim),
    ),
  );
}

function splitPointsIntoColliderParts(points, maxParts = 7) {
  if (points.length < 24) return [];
  const rootBounds = new THREE.Box3().setFromPoints(points);
  if (!Number.isFinite(rootBounds.min.x)) return [];
  const clusters = [{ points, bounds: rootBounds }];
  while (clusters.length < maxParts) {
    let splitIndex = -1;
    let splitScore = 0;
    clusters.forEach((cluster, index) => {
      if (cluster.points.length < 42) return;
      const size = cluster.bounds.getSize(new THREE.Vector3());
      const score = Math.max(size.x, size.z, size.y * 3.5) * Math.cbrt(cluster.points.length);
      if (score > splitScore) {
        splitScore = score;
        splitIndex = index;
      }
    });
    if (splitIndex < 0) break;
    const cluster = clusters.splice(splitIndex, 1)[0];
    const size = cluster.bounds.getSize(new THREE.Vector3());
    const axis = size.z >= size.x && size.z >= size.y * 2 ? "z" : size.x >= size.y * 2 ? "x" : "y";
    const sorted = [...cluster.points].sort((a, b) => a[axis] - b[axis]);
    const middle = Math.floor(sorted.length / 2);
    const left = sorted.slice(0, middle);
    const right = sorted.slice(middle);
    if (left.length < 16 || right.length < 16) {
      clusters.push(cluster);
      break;
    }
    clusters.push(
      { points: left, bounds: new THREE.Box3().setFromPoints(left) },
      { points: right, bounds: new THREE.Box3().setFromPoints(right) },
    );
  }
  return clusters
    .map((cluster) => boxToColliderPart(pointsToPercentileBox(cluster.points, { x: 0.01, y: 0.02, z: 0.01 }), 4))
    .filter(Boolean)
    .map((part) => {
      part.type = "box";
      part.part = "body";
      return part;
    });
}

function localPositionOfObjectOrigin(group, object) {
  if (!group || !object) return null;
  group.updateMatrixWorld(true);
  object.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(object.matrixWorld).applyMatrix4(group.matrixWorld.clone().invert());
}

function weaponPivotPointFromConfig(bounds, config) {
  const pivot = config.weapon?.pivot;
  if (!bounds || !pivot) return null;
  const size = bounds.getSize(new THREE.Vector3());
  return new THREE.Vector3(
    bounds.min.x + size.x * pivot.x,
    bounds.min.y + size.y * pivot.y,
    bounds.min.z + size.z * pivot.z,
  );
}

function sideContactX(side, bounds, halfWidth, extraOutboard = 0.12) {
  if (!bounds || !Number.isFinite(bounds.min.x)) return 0;
  const overlap = halfWidth * THREE.MathUtils.clamp(1 - extraOutboard, 0.3, 0.95);
  return side === "left"
    ? bounds.min.x - halfWidth + overlap
    : bounds.max.x + halfWidth - overlap;
}

function automaticDriveContactsForVisualBounds(id, visualBounds, group = null, bodyBounds = null) {
  const wheelObjects = viewerWheelObjects(group);
  if (wheelObjects.length) {
    return wheelObjects.map(({ object, side }) => {
      const bounds = visualLocalBoundsForObject(group, object);
      if (!bounds) return null;
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const radius = Math.max(size.y, size.z) * 0.48;
      const width = THREE.MathUtils.clamp(size.x * 0.5, 0.035, 0.26);
      return {
        side: side || (center.x < 0 ? "left" : "right"),
        type: "cylinder",
        part: "driveContact",
        position: [center.x, bounds.min.y + radius, center.z],
        halfExtents: [width, radius, radius],
        rotation: [0, 0, Math.PI / 2],
        density: 1.7,
        friction: 0.92,
        restitution: 0,
      };
    }).filter(Boolean);
  }
  if (!visualBounds) return [];
  const size = visualBounds.getSize(new THREE.Vector3());
  const center = visualBounds.getCenter(new THREE.Vector3());
  const wheelWidth = THREE.MathUtils.clamp(size.x * 0.065, 0.06, 0.18);
  const wheelRadius = THREE.MathUtils.clamp(Math.min(size.y * 0.34, size.z * 0.14), 0.08, 0.42);
  const anchorBounds = bodyBounds || visualBounds;
  const sideY = visualBounds.min.y + Math.min(size.y * 0.42, wheelRadius);
  const wheelZ = Math.max(0.18, size.z * 0.24);
  const cylinder = (side, z) => ({
    side,
    type: "cylinder",
    part: "driveContact",
    position: [sideContactX(side, anchorBounds, wheelWidth), sideY, center.z + z],
    halfExtents: [wheelWidth, wheelRadius, wheelRadius],
    rotation: [0, 0, Math.PI / 2],
    density: 1.7,
    friction: 0.92,
    restitution: 0,
  });
  const sideBox = (side, zCenter = center.z, zHalf = size.z * 0.28) => {
    const yHalf = Math.max(0.08, size.y * 0.24);
    return {
      side,
      type: "box",
      part: "driveContact",
      position: [sideContactX(side, anchorBounds, wheelWidth * 1.1), visualBounds.min.y + yHalf, zCenter],
      halfExtents: [wheelWidth * 1.1, yHalf, Math.max(0.08, zHalf)],
      density: 1.7,
      friction: 0.92,
      restitution: 0,
    };
  };
  if (id === "huge") return ["left", "right"].map((side) => cylinder(side, 0));
  if (id === "biteforce" || id === "minotaur") return [sideBox("left"), sideBox("right")];
  if (id === "sawblaze" || id === "tombstone") return [sideBox("left", center.z + size.z * 0.24, size.z * 0.12), sideBox("right", center.z + size.z * 0.24, size.z * 0.12)];
  return [cylinder("left", -wheelZ), cylinder("left", wheelZ), cylinder("right", -wheelZ), cylinder("right", wheelZ)];
}

function weaponColliderFromVisual(group, id, visualBounds) {
  const config = MODEL_PART_CONFIG[id] || {};
  const weaponObject = group.userData?.viewerParts?.weapon || group.userData?.weapon?.object;
  if (!weaponObject) return null;
  const points = visualLocalVertexPoints(group, weaponObject);
  const weaponBounds = pointsToPercentileBox(points, id === "bronco" ? { x: 0.08, y: 0.02, z: 0.03 } : { x: 0.025, y: 0.015, z: 0.025 })
    || visualLocalBoundsForObject(group, weaponObject);
  const weapon = weaponBounds ? boxToColliderPart(weaponBounds, 3.2) : null;
  if (!weapon) return null;
  weapon.part = "weapon";
  const shape = config.weapon?.colliderShape || ((config.weapon?.type === "bar" || config.weapon?.type === "drum") ? "cylinder" : "box");
  weapon.type = shape === "split" ? "box" : shape;
  const pivot = localPositionOfObjectOrigin(group, weaponObject) || weaponPivotPointFromConfig(visualBounds, config);
  if (config.weapon?.centerColliderOnPivot && pivot) weapon.position = [pivot.x, pivot.y, pivot.z];
  if (weapon.type === "cylinder") {
    if (pivot) weapon.position = [pivot.x, pivot.y, pivot.z];
    weapon.rotation = [0, 0, Math.PI / 2];
  }
  return weapon;
}

export function generateColliderPartsFromVisual(group, id, { includeDriveContacts = true } = {}) {
  const visualBounds = visualLocalBoundsForObject(group, group);
  const bodyObject = group.userData?.viewerParts?.body || group;
  const bodyPoints = visualLocalVertexPoints(group, bodyObject);
  const bodyBounds = visualLocalBoundsForObject(group, bodyObject) || visualBounds;
  const visualSize = visualBounds?.getSize(new THREE.Vector3()) || new THREE.Vector3(2, 1, 2);
  let parts = splitPointsIntoColliderParts(bodyPoints, id === "huge" ? 5 : 7);
  if (!parts.length && bodyBounds) {
    const fallback = boxToColliderPart(bodyBounds, 4);
    if (fallback) parts = [fallback];
  }
  parts.forEach((part) => {
    part.part = "body";
    const bottom = part.position[1] - part.halfExtents[1];
    const raisedBottom = (visualBounds?.min.y || 0) + visualSize.y * 0.055;
    if (bottom < raisedBottom) {
      const top = part.position[1] + part.halfExtents[1];
      part.position[1] = (raisedBottom + top) * 0.5;
      part.halfExtents[1] = Math.max(0.035, (top - raisedBottom) * 0.5);
    }
  });
  const config = MODEL_PART_CONFIG[id] || {};
  if (parts.length >= 2 && id !== "tombstone" && config.weapon?.type !== "flipper") {
    const front = parts.reduce((lowest, part) => (part.position[2] < lowest.position[2] ? part : lowest), parts[0]);
    front.type = "wedge";
    front.part = "wedge";
    front.friction = 0.58;
  }
  if (config.weapon?.type === "flipper" && visualBounds) {
    const center = visualBounds.getCenter(new THREE.Vector3());
    parts.push({
      type: "wedge",
      part: "wedge",
      position: [center.x, visualBounds.min.y + visualSize.y * 0.115, visualBounds.min.z + visualSize.z * 0.16],
      halfExtents: [visualSize.x * 0.36, visualSize.y * 0.115, visualSize.z * 0.16],
      density: 4.3,
      friction: 0.58,
    });
  }
  const weapon = weaponColliderFromVisual(group, id, visualBounds);
  if (weapon) parts.push(weapon);
  if (includeDriveContacts) {
    const physicsBounds = parts.length ? new THREE.Box3().setFromPoints(parts.flatMap((part) => {
      const position = new THREE.Vector3(...part.position);
      const half = part.halfExtents || [0.1, 0.1, 0.1];
      return [
        position.clone().add(new THREE.Vector3(-half[0], -half[1], -half[2])),
        position.clone().add(new THREE.Vector3(half[0], half[1], half[2])),
      ];
    })) : bodyBounds;
    automaticDriveContactsForVisualBounds(id, visualBounds, group, physicsBounds).forEach((part) => parts.push(part));
  }
  return parts
    .filter((part) => part.halfExtents?.every((value) => Number.isFinite(value) && value > 0))
    .map(cloneColliderPart);
}

export function firstVisibleMesh(model) {
  let mesh = null;
  model?.traverse((child) => {
    if (child.isMesh && !mesh && child.visible) mesh = child;
  });
  return mesh;
}

export function splitAuthoringBounds(group) {
  const model = group?.userData?.sourceModel;
  let mesh = null;
  model?.traverse((child) => {
    if (child.isMesh && child.userData?.modelPartAuthoringMesh) mesh = child;
  });
  if (!mesh) mesh = firstVisibleMesh(model);
  if (!mesh) {
    model?.traverse((child) => {
      if (child.isMesh && !mesh && !child.userData?.viewerPart) mesh = child;
    });
  }
  if (!mesh?.geometry?.attributes?.position) return null;
  mesh.geometry.computeBoundingBox();
  return { mesh, bounds: mesh.geometry.boundingBox.clone(), parent: mesh.parent || model };
}

export function regionBoxForWeaponSplit(group, split) {
  const authoring = splitAuthoringBounds(group);
  if (!authoring || !split?.region) return null;
  const box = fractionBoundsToBox(authoring.bounds, split.region);
  return { ...authoring, box };
}
