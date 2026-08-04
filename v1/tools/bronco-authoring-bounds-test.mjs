import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  ensureOriginalAuthoringBounds,
  firstAuthoringMesh,
  modelAuthoringBounds,
  originalAuthoringBoundsForMesh,
} from "../src/modelParts.js";

globalThis.self ||= globalThis;
globalThis.URL ||= {
  createObjectURL() { return "blob:stub"; },
  revokeObjectURL() {},
};
globalThis.createImageBitmap ||= async () => ({ width: 1, height: 1, close() {} });
globalThis.FileReader ||= class FileReader {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    }, (error) => {
      this.error = error;
      this.onerror?.(error);
    });
  }
};

const broncoPath = "public/models/bronco_3d.glb";
const loweredAngle = -0.34;
const raisedAngle = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadGlb(filePath) {
  const buffer = await fs.readFile(filePath);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => loader.parse(arrayBuffer, "", resolve, reject));
}

async function exportGlb(scene, filePath) {
  scene.traverse((child) => {
    if (child.isMesh) child.material = new THREE.MeshBasicMaterial({ color: 0xffffff });
  });
  const exporter = new GLTFExporter();
  const result = await new Promise((resolve, reject) => {
    exporter.parse(scene, resolve, reject, { binary: true });
  });
  assert(result instanceof ArrayBuffer, "Expected GLTFExporter to produce a binary GLB ArrayBuffer");
  await fs.writeFile(filePath, Buffer.from(result));
}

function triangleIndices(geometry, triangleIndex) {
  const index = geometry.index;
  return [0, 1, 2].map((corner) => (index ? index.getX(triangleIndex * 3 + corner) : triangleIndex * 3 + corner));
}

function centroidForTriangle(position, indices) {
  return new THREE.Vector3(
    (position.getX(indices[0]) + position.getX(indices[1]) + position.getX(indices[2])) / 3,
    (position.getY(indices[0]) + position.getY(indices[1]) + position.getY(indices[2])) / 3,
    (position.getZ(indices[0]) + position.getZ(indices[1]) + position.getZ(indices[2])) / 3,
  );
}

function broncoSplitStats(mesh) {
  const geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const bounds = originalAuthoringBoundsForMesh(mesh) || geometry.boundingBox;
  const size = bounds.getSize(new THREE.Vector3());
  const sourcePosition = geometry.attributes.position;
  const triangleCount = geometry.index ? geometry.index.count / 3 : sourcePosition.count / 3;
  const liftStart = bounds.min.y + size.y * 0.42;
  const hinge = new THREE.Vector3(0, bounds.min.y + size.y * 0.34, bounds.max.z - size.z * 0.1);
  let flipperTriangles = 0;
  let bodyTriangles = 0;
  for (let i = 0; i < triangleCount; i += 1) {
    const tri = triangleIndices(geometry, i);
    const c = centroidForTriangle(sourcePosition, tri);
    const raised = c.y > liftStart;
    const narrowCenter = Math.abs(c.x) < size.x * 0.2;
    const frontTip = Math.abs(c.x) < size.x * 0.16 && c.y > bounds.min.y + size.y * 0.2 && c.z < bounds.min.z + size.z * 0.12;
    const notRearArmor = c.z < bounds.max.z - size.z * 0.16;
    const notFrontFork = c.z > bounds.min.z + size.z * 0.08;
    if (notRearArmor && (frontTip || (raised && narrowCenter && notFrontFork))) {
      flipperTriangles += 1;
    } else {
      bodyTriangles += 1;
    }
  }
  return {
    bodyTriangles,
    flipperTriangles,
    hinge: hinge.toArray(),
    liftStart,
    loweredAngle,
    raisedAngle,
  };
}

function cutLeftBodyTrianglesLikeColliderTweaker(mesh) {
  ensureOriginalAuthoringBounds(mesh);
  const geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const cutBounds = geometry.boundingBox.clone();
  const cutSize = cutBounds.getSize(new THREE.Vector3());
  const position = geometry.attributes.position;
  const triangleCount = geometry.index ? geometry.index.count / 3 : position.count / 3;
  const nextAttributes = {};
  Object.entries(geometry.attributes).forEach(([name]) => {
    nextAttributes[name] = [];
  });
  let removed = 0;

  const appendAttributeVertex = (target, attribute, index) => {
    for (let i = 0; i < attribute.itemSize; i += 1) target.push(attribute.getComponent(index, i));
  };

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const indices = triangleIndices(geometry, triangle);
    const centroid = centroidForTriangle(position, indices);
    if (centroid.x < cutBounds.min.x + cutSize.x * 0.15) {
      removed += 1;
      continue;
    }
    indices.forEach((index) => {
      Object.entries(geometry.attributes).forEach(([name, attribute]) => {
        appendAttributeVertex(nextAttributes[name], attribute, index);
      });
    });
  }

  const nextGeometry = new THREE.BufferGeometry();
  Object.entries(geometry.attributes).forEach(([name, attribute]) => {
    nextGeometry.setAttribute(name, new THREE.BufferAttribute(new attribute.array.constructor(nextAttributes[name]), attribute.itemSize, attribute.normalized));
  });
  nextGeometry.computeBoundingBox();
  nextGeometry.computeBoundingSphere();
  if (!nextGeometry.attributes.normal && nextGeometry.attributes.position) nextGeometry.computeVertexNormals();
  mesh.geometry = nextGeometry;
  return removed;
}

function weaponStatsEqual(a, b) {
  const epsilon = 1e-7;
  return a.flipperTriangles === b.flipperTriangles
    && Math.abs(a.liftStart - b.liftStart) <= epsilon
    && a.hinge.every((value, index) => Math.abs(value - b.hinge[index]) <= epsilon);
}

const original = await loadGlb(broncoPath);
const originalMesh = firstAuthoringMesh(original.scene);
assert(originalMesh, "Could not find Bronco authoring mesh");
const originalStats = broncoSplitStats(originalMesh);
ensureOriginalAuthoringBounds(originalMesh);
const originalAuthoringBounds = modelAuthoringBounds(original.scene);
const metadataStats = broncoSplitStats(originalMesh);
assert(weaponStatsEqual(originalStats, metadataStats), "Stamping original authoring bounds changed Bronco's weapon split");

const cutScene = original.scene.clone(true);
const cutMesh = firstAuthoringMesh(cutScene);
const removed = cutLeftBodyTrianglesLikeColliderTweaker(cutMesh);
assert(removed > 0, "Expected the cutter-style top cut to remove triangles");
const cutStatsBeforeExport = broncoSplitStats(cutMesh);
assert(weaponStatsEqual(originalStats, cutStatsBeforeExport), "Cut mesh did not preserve Bronco's weapon split before export");

const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "bronco-authoring-bounds-"));
const outPath = path.join(outDir, "bronco-cut.glb");
await exportGlb(cutScene, outPath);

const reloaded = await loadGlb(outPath);
const reloadedMesh = firstAuthoringMesh(reloaded.scene);
assert(reloadedMesh, "Could not find reloaded Bronco authoring mesh");
const reloadedStats = broncoSplitStats(reloadedMesh);
assert(weaponStatsEqual(originalStats, reloadedStats), "Reloaded cutter-style GLB did not preserve Bronco's weapon split");
const reloadedAuthoringBounds = modelAuthoringBounds(reloaded.scene);
assert(
  originalAuthoringBounds && reloadedAuthoringBounds && originalAuthoringBounds.equals(reloadedAuthoringBounds),
  "Reloaded cutter-style GLB did not preserve Bronco's model authoring bounds",
);

console.log(JSON.stringify({
  ok: true,
  removedTriangles: removed,
  originalStats,
  reloadedStats,
  originalAuthoringBounds: {
    min: originalAuthoringBounds.min.toArray(),
    max: originalAuthoringBounds.max.toArray(),
  },
  reloadedAuthoringBounds: {
    min: reloadedAuthoringBounds.min.toArray(),
    max: reloadedAuthoringBounds.max.toArray(),
  },
  roundTripGlb: outPath,
}, null, 2));
