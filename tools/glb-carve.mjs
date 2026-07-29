// Triangle-level surgery on a Tripo segmentation GLB (indexed geometry).
// Two modes per operation:
//   delete  — remove triangles of a part inside a region (junk cleanup)
//   extract — MOVE triangles of a part inside a region into a NEW part node
//             (e.g. split sawblaze's saw disc out of the arm so it can spin)
//
// Append-only strategy: new index buffers are appended to the BIN chunk and
// the source primitive is re-pointed; vertex data is shared untouched. The
// orphaned original index view wastes a few KB — harmless.
//
// Usage: node tools/glb-carve.mjs <in.glb> <out.glb> <ops.json>
// ops.json: [{ "part": 8, "mode": "extract", "newPart": 900,
//              "region": {"type": "sphere", "center": [x,y,z], "radius": r} }
//            {"part": 5, "mode": "delete",
//              "region": {"type": "box", "min": [..], "max": [..]} }]
// Regions are in MODEL space (node translation applied), matching the
// coordinates shown by glb-parts-report / the rainbow viewer.
import fs from "node:fs";

function align4(value) {
  return (value + 3) & ~3;
}

const [inPath, outPath, opsPath] = process.argv.slice(2);
if (!opsPath) {
  console.error("Usage: node tools/glb-carve.mjs <in.glb> <out.glb> <ops.json>");
  process.exit(1);
}
const ops = JSON.parse(fs.readFileSync(opsPath, "utf8"));
const buffer = fs.readFileSync(inPath);
if (buffer.toString("utf8", 0, 4) !== "glTF") throw new Error("not a GLB");
const jsonLength = buffer.readUInt32LE(12);
const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).trim());
const binHeader = 20 + align4(jsonLength);
const binLength = buffer.readUInt32LE(binHeader);
let bin = buffer.subarray(binHeader + 8, binHeader + 8 + binLength);

const COMPONENT_BYTES = { 5121: 1, 5123: 2, 5125: 4 };

// Index buffers created during this run, so a second op on the same part
// reads the FIRST op's result instead of the stale original.
const appendedIndices = new Map();

function readIndices(accessorIndex) {
  if (appendedIndices.has(accessorIndex)) return appendedIndices.get(accessorIndex);
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const out = new Uint32Array(accessor.count);
  for (let i = 0; i < accessor.count; i += 1) {
    if (accessor.componentType === 5123) out[i] = bin.readUInt16LE(offset + i * 2);
    else if (accessor.componentType === 5125) out[i] = bin.readUInt32LE(offset + i * 4);
    else out[i] = bin.readUInt8(offset + i);
  }
  return out;
}

function readPosition(accessorIndex, vertexIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const stride = view.byteStride || 12;
  const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0) + vertexIndex * stride;
  return [bin.readFloatLE(offset), bin.readFloatLE(offset + 4), bin.readFloatLE(offset + 8)];
}

function inRegion(point, region) {
  if (region.type === "sphere") {
    const [cx, cy, cz] = region.center;
    return Math.hypot(point[0] - cx, point[1] - cy, point[2] - cz) <= region.radius;
  }
  if (region.type === "box") {
    return (
      point[0] >= region.min[0] && point[0] <= region.max[0] &&
      point[1] >= region.min[1] && point[1] <= region.max[1] &&
      point[2] >= region.min[2] && point[2] <= region.max[2]
    );
  }
  throw new Error(`Unknown region type ${region.type}`);
}

const appendChunks = [];
let appendOffset = bin.length;

function appendIndexBuffer(indices) {
  // Always write uint32: simple and safe for any vertex count.
  const bytes = Buffer.alloc(align4(indices.length * 4));
  indices.forEach((value, i) => bytes.writeUInt32LE(value, i * 4));
  const viewIndex = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset: appendOffset, byteLength: indices.length * 4, target: 34963 });
  appendChunks.push(bytes);
  appendOffset += bytes.length;
  const accessorIndex = json.accessors.length;
  json.accessors.push({ bufferView: viewIndex, componentType: 5125, count: indices.length, type: "SCALAR" });
  appendedIndices.set(accessorIndex, Uint32Array.from(indices));
  return accessorIndex;
}

for (const op of ops) {
  const nodeIndex = json.nodes.findIndex((n) => n.name === `tripo_part_${op.part}`);
  if (nodeIndex < 0) throw new Error(`part ${op.part} not found`);
  const node = json.nodes[nodeIndex];
  const primitive = json.meshes[node.mesh].primitives[0];
  if (primitive.indices === undefined) throw new Error(`part ${op.part} is not indexed`);
  const translation = node.translation || [0, 0, 0];
  const indices = readIndices(primitive.indices);

  const kept = [];
  const moved = [];
  for (let t = 0; t < indices.length; t += 3) {
    const c = [0, 0, 0];
    for (let v = 0; v < 3; v += 1) {
      const p = readPosition(primitive.attributes.POSITION, indices[t + v]);
      c[0] += p[0] / 3;
      c[1] += p[1] / 3;
      c[2] += p[2] / 3;
    }
    const world = [c[0] + translation[0], c[1] + translation[1], c[2] + translation[2]];
    const inside = inRegion(world, op.region);
    (inside ? moved : kept).push(indices[t], indices[t + 1], indices[t + 2]);
  }
  if (!moved.length) throw new Error(`part ${op.part}: region matched 0 triangles — check coordinates`);

  primitive.indices = appendIndexBuffer(kept);
  console.log(`part ${op.part} [${op.mode}]: kept ${kept.length / 3} tris, ${op.mode === "delete" ? "deleted" : "extracted"} ${moved.length / 3}`);

  if (op.mode === "extract") {
    // New mesh shares the vertex attributes; only the index list is its own.
    const meshIndex = json.meshes.length;
    json.meshes.push({
      name: `tripo_mesh_part_${op.newPart}`,
      primitives: [{ attributes: { ...primitive.attributes }, indices: appendIndexBuffer(moved), material: primitive.material }],
    });
    const newNodeIndex = json.nodes.length;
    json.nodes.push({ name: `tripo_part_${op.newPart}`, mesh: meshIndex, translation: [...translation] });
    json.scenes[0].nodes.push(newNodeIndex);
  }
}

// Reassemble GLB with appended BIN.
const newBin = Buffer.concat([bin, ...appendChunks]);
json.buffers[0].byteLength = newBin.length;
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
let cursor = 20 + jsonPadded.length;
out.writeUInt32LE(binPadded.length, cursor);
out.writeUInt32LE(0x004e4942, cursor + 4);
binPadded.copy(out, cursor + 8);
fs.writeFileSync(outPath, out);
console.log(`${outPath}: ${(out.length / 1048576).toFixed(1)}MB`);
