import * as THREE from "three";

const DEFAULT_SPINNER_FULL_SPEED = 120;
const DEFAULT_SPINNER_SPIN_DOWN_SECONDS = 1.1;
const AUTHORING_BOUNDS_KEY = "battleBotAuthoringBounds";

function vectorToPlain(vector) {
  return { x: vector.x, y: vector.y, z: vector.z };
}

function plainToVector(value) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y) || !Number.isFinite(value.z)) return null;
  return new THREE.Vector3(value.x, value.y, value.z);
}

export function serializeBounds(bounds) {
  if (!bounds || !Number.isFinite(bounds.min.x) || !Number.isFinite(bounds.max.x)) return null;
  return {
    min: vectorToPlain(bounds.min),
    max: vectorToPlain(bounds.max),
  };
}

export function deserializeBounds(value) {
  const min = plainToVector(value?.min);
  const max = plainToVector(value?.max);
  return min && max ? new THREE.Box3(min, max) : null;
}

export function originalAuthoringBoundsForMesh(mesh) {
  return deserializeBounds(mesh?.userData?.[AUTHORING_BOUNDS_KEY]);
}

export function ensureOriginalAuthoringBounds(mesh) {
  if (!mesh?.geometry?.attributes?.position) return null;
  const existing = originalAuthoringBoundsForMesh(mesh);
  if (existing) return existing;
  mesh.geometry.computeBoundingBox();
  const bounds = mesh.geometry.boundingBox?.clone();
  const serialized = serializeBounds(bounds);
  if (serialized) mesh.userData[AUTHORING_BOUNDS_KEY] = serialized;
  return bounds || null;
}

export function clearOriginalAuthoringBounds(root) {
  root?.traverse?.((child) => {
    if (child.userData) delete child.userData[AUTHORING_BOUNDS_KEY];
  });
}

export function modelAuthoringBounds(model) {
  if (!model) return null;
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  let found = false;
  model.traverse((child) => {
    if (!child.isMesh) return;
    const localBounds = originalAuthoringBoundsForMesh(child);
    if (!localBounds) return;
    for (const x of [localBounds.min.x, localBounds.max.x]) {
      for (const y of [localBounds.min.y, localBounds.max.y]) {
        for (const z of [localBounds.min.z, localBounds.max.z]) {
          point.set(x, y, z).applyMatrix4(child.matrixWorld);
          bounds.expandByPoint(point);
          found = true;
        }
      }
    }
  });
  return found ? bounds : null;
}

export function fractionBoundsToBox(bounds, region) {
  const size = bounds.getSize(new THREE.Vector3());
  return new THREE.Box3(
    new THREE.Vector3(
      bounds.min.x + size.x * region.x[0],
      bounds.min.y + size.y * region.y[0],
      bounds.min.z + size.z * region.z[0],
    ),
    new THREE.Vector3(
      bounds.min.x + size.x * region.x[1],
      bounds.min.y + size.y * region.y[1],
      bounds.min.z + size.z * region.z[1],
    ),
  );
}

export function firstAuthoringMesh(model) {
  let mesh = null;
  model?.traverse((child) => {
    if (child.isMesh && child.userData?.modelPartAuthoringMesh) mesh = child;
  });
  model?.traverse((child) => {
    if (child.isMesh && !mesh && !child.userData?.viewerPart) mesh = child;
  });
  return mesh;
}

function fractionBoundsToOrientedBox(bounds, region, { yaw = 0, pitch = 0 } = {}) {
  const box = fractionBoundsToBox(bounds, region);
  if (!yaw && !pitch) return { box, inverseMatrix: null };
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const rotation = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitch, yaw, 0));
  const inverseMatrix = new THREE.Matrix4()
    .makeTranslation(center.x, center.y, center.z)
    .multiply(rotation)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z))
    .invert();
  return {
    box: new THREE.Box3(center.clone().sub(size.clone().multiplyScalar(0.5)), center.clone().add(size.multiplyScalar(0.5))),
    inverseMatrix,
  };
}

function fractionPoint(bounds, point) {
  const size = bounds.getSize(new THREE.Vector3());
  return new THREE.Vector3(
    bounds.min.x + size.x * point.x,
    bounds.min.y + size.y * point.y,
    bounds.min.z + size.z * point.z,
  );
}

function triangleInRegion(sourcePosition, tri, regionBox) {
  const cx = (sourcePosition.getX(tri[0]) + sourcePosition.getX(tri[1]) + sourcePosition.getX(tri[2])) / 3;
  const cy = (sourcePosition.getY(tri[0]) + sourcePosition.getY(tri[1]) + sourcePosition.getY(tri[2])) / 3;
  const cz = (sourcePosition.getZ(tri[0]) + sourcePosition.getZ(tri[1]) + sourcePosition.getZ(tri[2])) / 3;
  const point = new THREE.Vector3(cx, cy, cz);
  if (regionBox.inverseMatrix) point.applyMatrix4(regionBox.inverseMatrix);
  return regionBox.box.containsPoint(point);
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

function recenterSplitData(data, fallbackPivot = new THREE.Vector3()) {
  if (data.position.length < 3) return fallbackPivot.clone();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  for (let i = 0; i < data.position.length; i += 3) {
    min.x = Math.min(min.x, data.position[i]);
    min.y = Math.min(min.y, data.position[i + 1]);
    min.z = Math.min(min.z, data.position[i + 2]);
    max.x = Math.max(max.x, data.position[i]);
    max.y = Math.max(max.y, data.position[i + 1]);
    max.z = Math.max(max.z, data.position[i + 2]);
  }
  const center = min.x === Infinity ? fallbackPivot.clone() : min.add(max).multiplyScalar(0.5);
  for (let i = 0; i < data.position.length; i += 3) {
    data.position[i] -= center.x;
    data.position[i + 1] -= center.y;
    data.position[i + 2] -= center.z;
  }
  return center;
}

function offsetSplitData(data, pivot) {
  for (let i = 0; i < data.position.length; i += 3) {
    data.position[i] -= pivot.x;
    data.position[i + 1] -= pivot.y;
    data.position[i + 2] -= pivot.z;
  }
}

function mirrorWeaponDataAcrossDiagonal(data, pivot, { frontAxis = "x", frontSign = 1, angle = Math.PI } = {}) {
  if (data.position.length < 9) return;
  const sourcePlaneNormal = frontAxis === "z"
    ? new THREE.Vector3(0, 1, frontSign).normalize()
    : new THREE.Vector3(frontSign, 1, 0).normalize();
  const rotationAxis = frontAxis === "z"
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 0, 1);
  const signedAngle = frontAxis === "z" ? -frontSign * angle : frontSign * angle;
  const source = {
    position: [...data.position],
    normal: [...data.normal],
    uv: [...data.uv],
  };
  const vertexCount = source.position.length / 3;
  const appendVertex = (i) => {
    const offset = i * 3;
    const point = new THREE.Vector3(source.position[offset], source.position[offset + 1], source.position[offset + 2]);
    point.sub(pivot).applyAxisAngle(rotationAxis, signedAngle).add(pivot);
    data.position.push(point.x, point.y, point.z);
    if (source.normal.length) {
      const n = new THREE.Vector3(source.normal[offset], source.normal[offset + 1], source.normal[offset + 2]);
      n.applyAxisAngle(rotationAxis, signedAngle);
      data.normal.push(n.x, n.y, n.z);
    }
    if (source.uv.length) {
      const uvOffset = i * 2;
      data.uv.push(source.uv[uvOffset], source.uv[uvOffset + 1]);
    }
  };
  for (let i = 0; i < vertexCount; i += 3) {
    const cx = (source.position[i * 3] + source.position[(i + 1) * 3] + source.position[(i + 2) * 3]) / 3;
    const cy = (source.position[i * 3 + 1] + source.position[(i + 1) * 3 + 1] + source.position[(i + 2) * 3 + 1]) / 3;
    const cz = (source.position[i * 3 + 2] + source.position[(i + 1) * 3 + 2] + source.position[(i + 2) * 3 + 2]) / 3;
    const centroid = new THREE.Vector3(cx, cy, cz);
    if (centroid.sub(pivot).dot(sourcePlaneNormal) <= 0) continue;
    appendVertex(i);
    appendVertex(i + 1);
    appendVertex(i + 2);
  }
}

function mirrorWheelTopHalfVertically(data, regionBox) {
  if (data.position.length < 9) return;
  const centerY = regionBox.getCenter(new THREE.Vector3()).y;
  const source = {
    position: [...data.position],
    normal: [...data.normal],
    uv: [...data.uv],
  };
  const appendVertex = (vertexIndex) => {
    const offset = vertexIndex * 3;
    const x = source.position[offset];
    const y = source.position[offset + 1];
    const z = source.position[offset + 2];
    data.position.push(x, centerY * 2 - y, z);
    if (source.normal.length) data.normal.push(source.normal[offset], -source.normal[offset + 1], source.normal[offset + 2]);
    if (source.uv.length) {
      const uvOffset = vertexIndex * 2;
      data.uv.push(source.uv[uvOffset], source.uv[uvOffset + 1]);
    }
  };
  const vertexCount = source.position.length / 3;
  for (let i = 0; i < vertexCount; i += 3) {
    const centroidY = (source.position[i * 3 + 1] + source.position[(i + 1) * 3 + 1] + source.position[(i + 2) * 3 + 1]) / 3;
    if (centroidY < centerY) continue;
    appendVertex(i);
    appendVertex(i + 2);
    appendVertex(i + 1);
  }
}

export function splitConfiguredModelParts(model, config, spec) {
  const mesh = firstAuthoringMesh(model);
  if (!mesh?.geometry?.attributes.position) return { weapon: null, drivetrain: null };

  const geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const bounds = originalAuthoringBoundsForMesh(mesh) || geometry.boundingBox;
  const sourcePosition = geometry.attributes.position;
  const sourceNormal = geometry.attributes.normal;
  const sourceUv = geometry.attributes.uv || geometry.attributes.uv0;
  const index = geometry.index;
  const weaponPivot = config.weapon?.pivot ? fractionPoint(bounds, config.weapon.pivot) : null;
  const partData = [
    { key: "weapon", regions: config.weapon?.regions || [], regionYaw: config.weapon?.regionYaw || 0, regionPitch: config.weapon?.axisPitch || 0, data: { position: [], normal: [], uv: [] } },
    ...(config.wheels || []).map((wheel, i) => ({ key: `wheel-${i}`, wheel, regions: [wheel], data: { position: [], normal: [], uv: [] } })),
  ];
  partData.forEach((part) => {
    part.regionBoxes = part.regions.map((region) => (
      part.regionYaw || part.regionPitch
        ? fractionBoundsToOrientedBox(bounds, region, { yaw: part.regionYaw, pitch: part.regionPitch })
        : { box: fractionBoundsToBox(bounds, region), inverseMatrix: null }
    ));
  });
  const bodyData = { position: [], normal: [], uv: [] };
  const tri = [0, 0, 0];

  const pushVertex = (data, vertexIndex) => {
    data.position.push(sourcePosition.getX(vertexIndex), sourcePosition.getY(vertexIndex), sourcePosition.getZ(vertexIndex));
    if (sourceNormal) data.normal.push(sourceNormal.getX(vertexIndex), sourceNormal.getY(vertexIndex), sourceNormal.getZ(vertexIndex));
    if (sourceUv) data.uv.push(sourceUv.getX(vertexIndex), sourceUv.getY(vertexIndex));
  };

  const triangleCount = index ? index.count / 3 : sourcePosition.count / 3;
  for (let i = 0; i < triangleCount; i += 1) {
    for (let j = 0; j < 3; j += 1) tri[j] = index ? index.getX(i * 3 + j) : i * 3 + j;
    const part = partData.find((candidate) => candidate.regionBoxes.some((regionBox) => triangleInRegion(sourcePosition, tri, regionBox)));
    const data = part?.data || bodyData;
    tri.forEach((vertexIndex) => pushVertex(data, vertexIndex));
  }

  const parent = mesh.parent;
  const weaponPart = partData.find((part) => part.key === "weapon");
  if (config.weapon?.mirrorDiagonal && weaponPart?.regionBoxes?.[0]) {
    mirrorWeaponDataAcrossDiagonal(weaponPart.data, weaponPivot, {
      frontAxis: config.weapon.mirrorDiagonalFrontAxis || "x",
      frontSign: config.weapon.mirrorDiagonalFrontSign || 1,
      angle: config.weapon.mirrorDiagonalAngle ?? Math.PI,
    });
  }
  partData.forEach((part) => {
    if (part.wheel?.mirrorVertical && part.regionBoxes?.[0]) mirrorWheelTopHalfVertically(part.data, part.regionBoxes[0]);
  });
  const bodyGeometry = makeSplitGeometry(bodyData);
  let body = null;
  if (bodyGeometry) {
    body = new THREE.Mesh(bodyGeometry, mesh.material.clone());
    body.name = "modelBody";
    body.userData.viewerPart = "body";
    body.matrix.copy(mesh.matrix);
    body.matrix.decompose(body.position, body.quaternion, body.scale);
    body.castShadow = true;
    body.receiveShadow = true;
    parent.add(body);
  }

  let weapon = null;
  const leftWheels = [];
  const rightWheels = [];
  partData.forEach((part) => {
    const pivot = part.key === "weapon" && config.weapon?.pivot
      ? weaponPivot
      : recenterSplitData(part.data);
    if (part.key === "weapon" && config.weapon?.pivot) offsetSplitData(part.data, pivot);
    const partGeometry = makeSplitGeometry(part.data);
    if (!partGeometry) return;
    const partMesh = new THREE.Mesh(partGeometry, mesh.material.clone());
    const partPivot = new THREE.Group();
    partPivot.name = part.key === "weapon" ? "modelWeapon" : "modelWheel";
    partPivot.userData.viewerPart = part.key === "weapon" ? "weapon" : "wheel";
    partPivot.position.copy(pivot);
    partPivot.quaternion.copy(mesh.quaternion);
    partPivot.scale.copy(mesh.scale);
    partPivot.add(partMesh);
    partMesh.castShadow = true;
    partMesh.receiveShadow = true;
    parent.add(partPivot);
    if (part.key === "weapon") {
      weapon = {
        type: config.weapon?.type || "bar",
        object: partPivot,
        spinAxis: config.weapon?.spinAxis || "z",
        axisPitch: config.weapon?.axisPitch || 0,
        currentSpeed: 0,
        idleSpeed: 0,
        visualSpeed: config.weapon?.visualSpeed || config.weapon?.activeSpeed || DEFAULT_SPINNER_FULL_SPEED,
        spinUpSeconds: spec.weaponSpinUpSeconds ?? 2.5,
        spinDownSeconds: config.weapon?.spinDownSeconds || DEFAULT_SPINNER_SPIN_DOWN_SECONDS,
        toggle: true,
        toggledOn: false,
        offset: pivot.clone(),
      };
    } else if (part.wheel?.side === "left") {
      leftWheels.push(partPivot);
    } else if (part.wheel?.side === "right") {
      rightWheels.push(partPivot);
    }
  });

  mesh.userData.modelPartAuthoringMesh = true;
  mesh.visible = false;
  const wheelRadius = [...leftWheels, ...rightWheels].reduce((max, wheel) => {
    const sphere = wheel.children[0]?.geometry?.boundingSphere;
    return Math.max(max, sphere?.radius || 0);
  }, 0.24);
  const drivetrain = leftWheels.length || rightWheels.length
    ? { type: "tank", leftWheels, rightWheels, wheelRadius: Math.max(0.12, wheelRadius * 0.72), spinAxis: config.drivetrain?.spinAxis || "z" }
    : null;
  return {
    weapon,
    drivetrain,
    viewerParts: {
      body,
      weapon: weapon?.object || null,
      wheels: [...leftWheels, ...rightWheels],
    },
  };
}
