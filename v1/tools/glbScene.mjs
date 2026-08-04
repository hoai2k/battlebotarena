// Build a three.js scene out of a GLB in plain node — geometry, node names,
// node transforms and node extras, and nothing else.
//
// three's GLTFLoader wants a DOM the moment a GLB carries textures, and every
// bot here does. The audit does not care what a bot is PAINTED like, only where
// its geometry is, so this reads the container directly and hands back the same
// object graph the game would have: named nodes (modelBody, modelWeapon,
// modelWheel-N, modelWeaponSub-*, modelAux-*), the transforms above them, and
// `userData.pivotLocal` off the node's extras — which is what v1's segmented
// loader reads to place a hinge.
//
// Positions are read through the INDEX buffer's own accessors, so the meshes
// this builds draw exactly the triangles the game draws; a carve that left
// orphaned vertices behind cannot inflate a measurement taken here.
import fs from "node:fs";
import * as THREE from "three";

const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMPONENTS_PER_TYPE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

function readChunks(buffer) {
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).trim());
  let offset = 20 + jsonLength;
  let bin = Buffer.alloc(0);
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (chunkType === 0x004e4942) bin = buffer.subarray(start, start + chunkLength);
    offset = start + chunkLength;
  }
  return { json, bin };
}

function readAccessor(json, bin, index) {
  const accessor = json.accessors[index];
  if (!accessor || accessor.bufferView === undefined) return null;
  const view = json.bufferViews[accessor.bufferView];
  const componentBytes = COMPONENT_BYTES[accessor.componentType];
  const components = COMPONENTS_PER_TYPE[accessor.type];
  const stride = view.byteStride || componentBytes * components;
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = accessor.componentType === 5126
    ? new Float32Array(accessor.count * components)
    : new Uint32Array(accessor.count * components);
  for (let i = 0; i < accessor.count; i += 1) {
    for (let c = 0; c < components; c += 1) {
      const at = base + i * stride + c * componentBytes;
      let value;
      if (accessor.componentType === 5126) value = bin.readFloatLE(at);
      else if (accessor.componentType === 5125) value = bin.readUInt32LE(at);
      else if (accessor.componentType === 5123) value = bin.readUInt16LE(at);
      else if (accessor.componentType === 5121) value = bin.readUInt8(at);
      else if (accessor.componentType === 5122) value = bin.readInt16LE(at);
      else value = bin.readInt8(at);
      out[i * components + c] = value;
    }
  }
  return out;
}

function buildMesh(json, bin, meshIndex) {
  const mesh = json.meshes[meshIndex];
  const group = new THREE.Group();
  group.name = mesh.name || `mesh-${meshIndex}`;
  (mesh.primitives || []).forEach((primitive, index) => {
    const positions = readAccessor(json, bin, primitive.attributes?.POSITION);
    if (!positions) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
    if (primitive.indices !== undefined) {
      const indices = readAccessor(json, bin, primitive.indices);
      if (indices) geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    }
    const child = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    child.name = `${group.name}-primitive-${index}`;
    group.add(child);
  });
  return group;
}

function buildNode(json, bin, nodeIndex, meshCache) {
  const node = json.nodes[nodeIndex];
  const object = new THREE.Group();
  object.name = node.name || `node-${nodeIndex}`;
  if (node.matrix) {
    const matrix = new THREE.Matrix4().fromArray(node.matrix);
    matrix.decompose(object.position, object.quaternion, object.scale);
  } else {
    if (node.translation) object.position.fromArray(node.translation);
    if (node.rotation) object.quaternion.fromArray(node.rotation);
    if (node.scale) object.scale.fromArray(node.scale);
  }
  if (node.extras) object.userData = { ...node.extras };
  if (node.mesh !== undefined) {
    if (!meshCache.has(node.mesh)) meshCache.set(node.mesh, buildMesh(json, bin, node.mesh));
    object.add(meshCache.get(node.mesh).clone(true));
  }
  (node.children || []).forEach((childIndex) => object.add(buildNode(json, bin, childIndex, meshCache)));
  return object;
}

/** @returns {THREE.Group} the GLB's default scene, as the game would receive it. */
export function loadGlbScene(path) {
  const { json, bin } = readChunks(fs.readFileSync(path));
  const scene = new THREE.Group();
  scene.name = "glbScene";
  const meshCache = new Map();
  const sceneDef = json.scenes?.[json.scene ?? 0] || { nodes: json.nodes.map((_, i) => i) };
  (sceneDef.nodes || []).forEach((nodeIndex) => scene.add(buildNode(json, bin, nodeIndex, meshCache)));
  return scene;
}

/** Part names present in a GLB, without building any geometry. */
export function glbPartNames(path) {
  const { json } = readChunks(fs.readFileSync(path));
  return (json.nodes || []).map((node) => node.name).filter(Boolean);
}
