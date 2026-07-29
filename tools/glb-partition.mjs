// Convert a Tripo segmentation GLB into the v2 model contract:
//   nodes grouped + renamed to modelBody / modelWeapon / modelWheel-N,
//   duplicate images deduped (segmentation clones the texture set per part),
//   weapon pivot written as GLTF extras on the modelWeapon node.
// Orientation/scale are NOT baked — the runtime loader normalizes from the
// catalog, so the GLB stays pristine.
//
// Usage: node tools/glb-partition.mjs <in_seg.glb> <map.json> <out.glb>
// map.json: { "weapon": [8], "wheels": [[0],[13]], "weaponAxis": [0,0,1] }
//   (part indices refer to tripo_part_N; all unlisted parts become body)
import fs from "node:fs";
import crypto from "node:crypto";

function align4(value) {
  return (value + 3) & ~3;
}

const [inPath, mapPath, outPath] = process.argv.slice(2);
if (!outPath) {
  console.error("Usage: node tools/glb-partition.mjs <in_seg.glb> <map.json> <out.glb>");
  process.exit(1);
}
const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
const buffer = fs.readFileSync(inPath);
if (buffer.toString("utf8", 0, 4) !== "glTF") throw new Error("not a GLB");
const jsonLength = buffer.readUInt32LE(12);
const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).trim());
const binHeader = 20 + align4(jsonLength);
const binStart = binHeader + 8;

// --- 1. Dedupe images by content hash -------------------------------------
const imageHashes = new Map(); // hash -> first image index
const imageRemap = new Map(); // old index -> kept index
(json.images || []).forEach((image, index) => {
  const view = json.bufferViews[image.bufferView];
  const start = binStart + (view.byteOffset || 0);
  const hash = crypto.createHash("sha1").update(buffer.subarray(start, start + view.byteLength)).digest("hex");
  if (imageHashes.has(hash)) imageRemap.set(index, imageHashes.get(hash));
  else {
    imageHashes.set(hash, index);
    imageRemap.set(index, index);
  }
});
(json.textures || []).forEach((texture) => {
  if (texture.source !== undefined) texture.source = imageRemap.get(texture.source);
});

// --- 2. Dedupe textures + materials that became identical ------------------
function canon(value) {
  return JSON.stringify(value);
}
const textureRemap = new Map();
const seenTextures = new Map();
(json.textures || []).forEach((texture, index) => {
  const key = canon(texture);
  if (seenTextures.has(key)) textureRemap.set(index, seenTextures.get(key));
  else {
    seenTextures.set(key, index);
    textureRemap.set(index, index);
  }
});
const retex = (ref) => {
  if (ref && ref.index !== undefined) ref.index = textureRemap.get(ref.index);
};
(json.materials || []).forEach((material) => {
  retex(material.pbrMetallicRoughness?.baseColorTexture);
  retex(material.pbrMetallicRoughness?.metallicRoughnessTexture);
  retex(material.normalTexture);
  retex(material.occlusionTexture);
  retex(material.emissiveTexture);
});
const materialRemap = new Map();
const seenMaterials = new Map();
(json.materials || []).forEach((material, index) => {
  const key = canon({ ...material, name: undefined });
  if (seenMaterials.has(key)) materialRemap.set(index, seenMaterials.get(key));
  else {
    seenMaterials.set(key, index);
    materialRemap.set(index, index);
  }
});
(json.meshes || []).forEach((mesh) => mesh.primitives.forEach((primitive) => {
  if (primitive.material !== undefined) primitive.material = materialRemap.get(primitive.material);
}));

// --- 3. Group + rename nodes ----------------------------------------------
const partIndex = (node) => {
  const match = /^tripo_part_(\d+)$/.exec(node.name || "");
  return match ? Number(match[1]) : null;
};
const weaponParts = new Set(map.weapon || []);
const wheelGroups = (map.wheels || []).map((group) => new Set(group));
const nodeIdsFor = (predicate) => json.nodes
  .map((node, i) => ({ node, i }))
  .filter(({ node }) => {
    const part = partIndex(node);
    return part !== null && predicate(part);
  })
  .map(({ i }) => i);

const weaponNodeIds = nodeIdsFor((part) => weaponParts.has(part));
const wheelNodeIds = wheelGroups.map((group) => nodeIdsFor((part) => group.has(part)));
// Aux groups claim their nodes BEFORE the body sweep so nothing is
// double-parented (a glTF node may only have one parent).
const auxNodeIds = {};
for (const [auxName, auxDef] of Object.entries(map.aux || {})) {
  const partSet = new Set(auxDef.parts || []);
  auxNodeIds[auxName] = nodeIdsFor((part) => partSet.has(part));
}
// weaponSub: parts nested INSIDE modelWeapon with their own spin pivot (e.g.
// sawblaze's saw disc — swings with the arm AND spins locally).
const subDef = map.weaponSub || null;
const subParts = new Set(subDef?.parts || []);
const weaponSubNodeIds = subDef ? nodeIdsFor((part) => subParts.has(part)) : [];
const claimed = new Set([
  ...weaponNodeIds,
  ...wheelNodeIds.flat(),
  ...Object.values(auxNodeIds).flat(),
  ...weaponSubNodeIds,
]);
const bodyNodeIds = json.nodes
  .map((_, i) => i)
  .filter((i) => !claimed.has(i) && partIndex(json.nodes[i]) !== null);

function readIndexList(primitive) {
  const accessor = json.accessors[primitive.indices];
  const view = json.bufferViews[accessor.bufferView];
  const base = binStart + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = new Uint32Array(accessor.count);
  for (let i = 0; i < accessor.count; i += 1) {
    if (accessor.componentType === 5123) out[i] = buffer.readUInt16LE(base + i * 2);
    else if (accessor.componentType === 5125) out[i] = buffer.readUInt32LE(base + i * 4);
    else out[i] = buffer.readUInt8(base + i);
  }
  return out;
}

function readVertex(primitive, vertexIndex) {
  const accessor = json.accessors[primitive.attributes.POSITION];
  const view = json.bufferViews[accessor.bufferView];
  const stride = view.byteStride || 12;
  const base = binStart + (view.byteOffset || 0) + (accessor.byteOffset || 0) + vertexIndex * stride;
  return [buffer.readFloatLE(base), buffer.readFloatLE(base + 4), buffer.readFloatLE(base + 8)];
}

// Bounds over the vertices a part ACTUALLY references. Accessor min/max
// describes the whole shared vertex buffer, so after glb-carve moves triangles
// between parts it is stale — using it put weapon/wheel pivots off-centre.
function boundsCenter(nodeIds) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const id of nodeIds) {
    const node = json.nodes[id];
    if (node.mesh === undefined) continue;
    const primitive = json.meshes[node.mesh].primitives[0];
    const offset = [0, 1, 2].map((axis) => node.translation?.[axis] || 0);
    if (primitive.indices === undefined) {
      const accessor = json.accessors[primitive.attributes.POSITION];
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], accessor.min[axis] + offset[axis]);
        max[axis] = Math.max(max[axis], accessor.max[axis] + offset[axis]);
      }
      continue;
    }
    const seen = new Set();
    for (const vertexIndex of readIndexList(primitive)) {
      if (seen.has(vertexIndex)) continue;
      seen.add(vertexIndex);
      const p = readVertex(primitive, vertexIndex);
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], p[axis] + offset[axis]);
        max[axis] = Math.max(max[axis], p[axis] + offset[axis]);
      }
    }
  }
  return { min, max, center: min.map((v, i) => (v + max[i]) / 2) };
}

const newNodes = [];
function addGroupNode(name, childIds, extras) {
  const id = json.nodes.length + newNodes.length;
  newNodes.push({ name, children: childIds, ...(extras ? { extras } : {}) });
  return id;
}
const rootChildren = [addGroupNode("modelBody", bodyNodeIds)];
if (weaponNodeIds.length) {
  const bounds = boundsCenter(weaponNodeIds);
  const weaponChildren = [...weaponNodeIds];
  if (weaponSubNodeIds.length) {
    weaponChildren.push(addGroupNode(`modelWeaponSub-${subDef.name}`, weaponSubNodeIds, {
      // A bbox centre is wrong for irregular shapes (a toothed saw disc skews
      // it), so a map may declare the true axis of rotation instead.
      pivotLocal: subDef.pivotOverride || boundsCenter(weaponSubNodeIds).center,
    }));
  }
  rootChildren.push(addGroupNode("modelWeapon", weaponChildren, {
    // pivotOverride lets flipper/hammer maps place the hinge at the arm base
    // instead of the part's bbox center (right for spinners, wrong for arms).
    pivotLocal: map.pivotOverride || bounds.center,
    weaponAxis: map.weaponAxis || [0, 0, 1],
    weaponBounds: { min: bounds.min, max: bounds.max },
  }));
}
wheelNodeIds.forEach((ids, index) => {
  if (ids.length) rootChildren.push(addGroupNode(`modelWheel-${index}`, ids, { pivotLocal: boundsCenter(ids).center }));
});
// Auxiliary animated groups (e.g. bronco's pneumatic ram): map "aux" is
// { name: { parts: [ids] } } -> node modelAux-<name> with its bounds in
// extras so the loader can anchor scaling at the part's base.
for (const [auxName, ids] of Object.entries(auxNodeIds)) {
  if (!ids.length) continue;
  const bounds = boundsCenter(ids);
  rootChildren.push(addGroupNode(`modelAux-${auxName}`, ids, { auxBounds: { min: bounds.min, max: bounds.max } }));
}
json.nodes.push(...newNodes);
json.scenes[0].nodes = rootChildren;

// --- 4. Repack BIN keeping only referenced bufferViews ---------------------
const usedViews = new Set();
(json.accessors || []).forEach((accessor) => {
  if (accessor.bufferView !== undefined) usedViews.add(accessor.bufferView);
});
(json.images || []).forEach((image, index) => {
  if (imageRemap.get(index) === index && image.bufferView !== undefined) usedViews.add(image.bufferView);
});
const keptViews = [...usedViews].sort((a, b) => a - b);
const viewRemap = new Map(keptViews.map((oldIndex, newIndex) => [oldIndex, newIndex]));
let cursor = 0;
const chunks = [];
const newViews = keptViews.map((oldIndex) => {
  const view = json.bufferViews[oldIndex];
  const start = binStart + (view.byteOffset || 0);
  const bytes = buffer.subarray(start, start + view.byteLength);
  const aligned = align4(cursor);
  if (aligned > cursor) chunks.push(Buffer.alloc(aligned - cursor));
  cursor = aligned;
  chunks.push(bytes);
  const rewritten = { ...view, byteOffset: cursor };
  cursor += view.byteLength;
  return rewritten;
});
json.bufferViews = newViews;
(json.accessors || []).forEach((accessor) => {
  if (accessor.bufferView !== undefined) accessor.bufferView = viewRemap.get(accessor.bufferView);
});
// Drop duplicate images (texture.source already points at kept old indices),
// then renumber sources to the compacted array and fix image bufferViews.
{
  const orderRemap = new Map();
  json.images = (json.images || []).filter((image, oldIndex) => {
    if (imageRemap.get(oldIndex) !== oldIndex) return false;
    orderRemap.set(oldIndex, orderRemap.size);
    return true;
  });
  (json.textures || []).forEach((texture) => {
    if (texture.source !== undefined) texture.source = orderRemap.get(texture.source);
  });
  json.images.forEach((image) => {
    if (image.bufferView !== undefined) image.bufferView = viewRemap.get(image.bufferView);
  });
}
const newBin = Buffer.concat(chunks);
json.buffers = [{ byteLength: newBin.length }];

// --- 5. Write GLB ----------------------------------------------------------
const jsonBytes = Buffer.from(JSON.stringify(json), "utf8");
const jsonPadded = Buffer.concat([jsonBytes, Buffer.alloc(align4(jsonBytes.length) - jsonBytes.length, 0x20)]);
const binPadded = Buffer.concat([newBin, Buffer.alloc(align4(newBin.length) - newBin.length)]);
const total = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
const out = Buffer.alloc(total);
out.write("glTF", 0);
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonPadded.length, 12);
out.writeUInt32LE(0x4e4f534a, 16);
jsonPadded.copy(out, 20);
let offset = 20 + jsonPadded.length;
out.writeUInt32LE(binPadded.length, offset);
out.writeUInt32LE(0x004e4942, offset + 4);
binPadded.copy(out, offset + 8);
fs.writeFileSync(outPath, out);
console.log(`${outPath}: ${(out.length / 1048576).toFixed(1)}MB (from ${(buffer.length / 1048576).toFixed(1)}MB), body=${bodyNodeIds.length} weapon=${weaponNodeIds.length} wheels=${wheelNodeIds.map((w) => w.length).join("/")}`);
