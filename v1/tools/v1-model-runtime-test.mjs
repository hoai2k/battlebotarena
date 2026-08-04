import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import zlib from "node:zlib";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MODEL_PART_CONFIG } from "../src/modelPartConfig.js";
import { modelAuthoringBounds, originalAuthoringBoundsForMesh, splitConfiguredModelParts } from "../src/modelParts.js";

globalThis.self ||= globalThis;
globalThis.createImageBitmap ||= async () => ({ width: 1, height: 1, close() {} });

function round(value) {
  return Number(value.toFixed(9));
}

function vector(vectorValue) {
  return vectorValue.toArray().map(round);
}

function expandedAttributeHash(geometry, attribute) {
  const index = geometry.index;
  const expandedCount = index?.count ?? attribute.count;
  const blockVertices = 8192;
  const blockArray = new attribute.array.constructor(blockVertices * attribute.itemSize);
  const hash = crypto.createHash("sha256");
  for (let base = 0; base < expandedCount; base += blockVertices) {
    const count = Math.min(blockVertices, expandedCount - base);
    for (let i = 0; i < count; i += 1) {
      const sourceIndex = index ? index.getX(base + i) : base + i;
      for (let component = 0; component < attribute.itemSize; component += 1) {
        blockArray[i * attribute.itemSize + component] = attribute.getComponent(sourceIndex, component);
      }
    }
    hash.update(Buffer.from(blockArray.buffer, 0, count * attribute.itemSize * attribute.array.BYTES_PER_ELEMENT));
  }
  return { expandedCount, sha256: hash.digest("hex") };
}

function geometrySignature(geometry) {
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const attributes = {};
  Object.entries(geometry.attributes).sort(([a], [b]) => a.localeCompare(b)).forEach(([name, attribute]) => {
    const expanded = expandedAttributeHash(geometry, attribute);
    attributes[name] = {
      count: expanded.expandedCount,
      itemSize: attribute.itemSize,
      normalized: attribute.normalized,
      sha256: expanded.sha256,
    };
  });
  return {
    triangleCount: (geometry.index?.count ?? geometry.attributes.position.count) / 3,
    attributes,
    boundingBox: {
      min: vector(geometry.boundingBox.min),
      max: vector(geometry.boundingBox.max),
    },
    boundingSphere: {
      center: vector(geometry.boundingSphere.center),
      radius: round(geometry.boundingSphere.radius),
    },
  };
}

function sceneSignature(root) {
  root.updateMatrixWorld(true);
  const objects = [];
  root.traverse((object) => {
    const entry = {
      type: object.type,
      name: object.name,
      visible: object.visible,
      position: vector(object.position),
      quaternion: [object.quaternion.x, object.quaternion.y, object.quaternion.z, object.quaternion.w].map(round),
      scale: vector(object.scale),
      userData: structuredClone(object.userData),
    };
    if (object.isMesh) entry.geometry = geometrySignature(object.geometry);
    objects.push(entry);
  });
  const bounds = new THREE.Box3().setFromObject(root);
  return {
    objects,
    bounds: { min: vector(bounds.min), max: vector(bounds.max) },
  };
}

async function loadGlb(filePath) {
  const stored = await fs.readFile(filePath);
  const buffer = filePath.endsWith(".gz") ? zlib.gunzipSync(stored) : stored;
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => loader.parse(arrayBuffer, "", resolve, reject));
}

function prepareLoadedModel(root, fit) {
  const model = root.clone(true);
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry = child.geometry.clone();
    if (child.material) child.material = child.material.clone();
  });
  const box = modelAuthoringBounds(model) || new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const fitScale = Number.isFinite(fit.scale) ? fit.scale : 1;
  const scale = Math.min(fit.width / size.x, fit.height / size.y, fit.depth / size.z) * fitScale;
  model.scale.setScalar(Number.isFinite(scale) ? scale : 1);
  const fitted = modelAuthoringBounds(model) || new THREE.Box3().setFromObject(model);
  const center = fitted.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -fitted.min.y, -center.z);
  return model;
}

function broncoPartitionSignature(model) {
  let mesh = null;
  model.traverse((child) => {
    if (child.isMesh && !mesh) mesh = child;
  });
  assert(mesh?.geometry?.attributes.position, "Bronco has no authoring mesh");
  const geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const bounds = originalAuthoringBoundsForMesh(mesh) || geometry.boundingBox;
  const size = bounds.getSize(new THREE.Vector3());
  const position = geometry.attributes.position;
  const index = geometry.index;
  const liftStart = bounds.min.y + size.y * 0.42;
  const hinge = new THREE.Vector3(0, bounds.min.y + size.y * 0.34, bounds.max.z - size.z * 0.1);
  let bodyTriangles = 0;
  let flipperTriangles = 0;
  const triangleCount = index ? index.count / 3 : position.count / 3;
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const indices = [0, 1, 2].map((corner) => index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner);
    const cx = indices.reduce((sum, i) => sum + position.getX(i), 0) / 3;
    const cy = indices.reduce((sum, i) => sum + position.getY(i), 0) / 3;
    const cz = indices.reduce((sum, i) => sum + position.getZ(i), 0) / 3;
    const raised = cy > liftStart;
    const narrowCenter = Math.abs(cx) < size.x * 0.2;
    const frontTip = Math.abs(cx) < size.x * 0.16 && cy > bounds.min.y + size.y * 0.2 && cz < bounds.min.z + size.z * 0.12;
    const notRearArmor = cz < bounds.max.z - size.z * 0.16;
    const notFrontFork = cz > bounds.min.z + size.z * 0.08;
    if (notRearArmor && (frontTip || (raised && narrowCenter && notFrontFork))) flipperTriangles += 1;
    else bodyTriangles += 1;
  }
  return {
    bodyTriangles,
    flipperTriangles,
    hinge: vector(hinge),
    liftStart: round(liftStart),
  };
}

function movingPartSummary(result) {
  return {
    hasBody: Boolean(result.viewerParts?.body),
    hasWeapon: Boolean(result.weapon?.object),
    wheelCount: result.viewerParts?.wheels?.length || 0,
    weaponType: result.weapon?.type || null,
    drivetrainType: result.drivetrain?.type || null,
  };
}

async function runtimeSignature(botId, filePath) {
  const gltf = await loadGlb(filePath);
  const config = MODEL_PART_CONFIG[botId];
  assert(config, `unknown bot ${botId}`);
  const model = prepareLoadedModel(gltf.scene, config.fit);
  const before = sceneSignature(model);
  if (botId === "bronco") {
    return {
      before,
      broncoPartition: broncoPartitionSignature(model),
    };
  }
  const movingParts = splitConfiguredModelParts(model, config, { weaponSpinUpSeconds: 2.5 });
  return {
    before,
    movingParts: movingPartSummary(movingParts),
    afterRuntimeSplit: sceneSignature(model),
  };
}

const args = process.argv.slice(2);
if (!args.length || args.length % 3 !== 0) {
  console.error("Usage: node tools/v1-model-runtime-test.mjs <bot-id> <source.glb[.gz]> <optimized.glb> [...]");
  process.exitCode = 1;
} else {
  const reports = [];
  for (let i = 0; i < args.length; i += 3) {
    const [botId, sourcePath, targetPath] = args.slice(i, i + 3);
    const source = await runtimeSignature(botId, sourcePath);
    const target = await runtimeSignature(botId, targetPath);
    assert.deepEqual(target, source, `${botId}: GLTFLoader/runtime part processing changed after re-indexing`);
    reports.push({
      botId,
      sourcePath,
      targetPath,
      ok: true,
      movingParts: target.movingParts || null,
      broncoPartition: target.broncoPartition || null,
      bounds: target.before.bounds,
    });
  }
  console.log(JSON.stringify({ ok: true, reports }, null, 2));
}
