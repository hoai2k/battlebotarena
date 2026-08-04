// Exact DRAWN bounds per part: only the vertices the index buffer actually
// references, in node-translated model space, to four decimals.
//
//   node tools/glb-drawn-bounds.mjs <file.glb> [partIndex]
//
// glb-parts-report.mjs reads the accessor's own min/max, which is the bound of
// every vertex in the buffer whether or not a triangle still points at it.
// That is fine on a raw segmentation and WRONG after a carve, because every
// mode here is append-only: `delete` and `mirror` re-point the primitive at a
// subset and leave the vertex data alone. Glitch's plate still reported itself
// as 1.09 wide after being cut to 0.61, which is exactly the kind of stale
// number a repair gets checked against.
//
// Also prints triangle counts, so a part that a carve emptied shows up as 0
// rather than as its original size.
import fs from "node:fs";
const path = process.argv[2];
const want = process.argv[3] ? Number(process.argv[3]) : null;
const buf = fs.readFileSync(path);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen).trim());
const binStart = 20 + jsonLen + 8;
const bin = buf.subarray(binStart);
const view = (i) => { const v = json.bufferViews[i]; return bin.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength); };
function readAcc(ai) {
  const a = json.accessors[ai], v = view(a.bufferView);
  const comp = { 5125: 4, 5123: 2, 5121: 1, 5126: 4 }[a.componentType];
  const n = { SCALAR: 1, VEC2: 2, VEC3: 3 }[a.type];
  const stride = json.bufferViews[a.bufferView].byteStride || comp * n;
  const base = a.byteOffset || 0;
  const out = [];
  for (let i = 0; i < a.count; i += 1) {
    const o = base + i * stride;
    const row = [];
    for (let k = 0; k < n; k += 1) {
      const p = o + k * comp;
      row.push(a.componentType === 5126 ? v.readFloatLE(p) : a.componentType === 5125 ? v.readUInt32LE(p) : a.componentType === 5123 ? v.readUInt16LE(p) : v.readUInt8(p));
    }
    out.push(n === 1 ? row[0] : row);
  }
  return out;
}
for (const node of json.nodes) {
  const m = /^tripo_part_(\d+)$/.exec(node.name || "");
  if (!m || node.mesh === undefined) continue;
  const part = Number(m[1]);
  if (want !== null && part !== want) continue;
  const prim = json.meshes[node.mesh].primitives[0];
  const idx = readAcc(prim.indices);
  const pos = readAcc(prim.attributes.POSITION);
  const t = node.translation || [0, 0, 0];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const seen = new Set();
  for (const i of idx) {
    if (seen.has(i)) continue;
    seen.add(i);
    for (let k = 0; k < 3; k += 1) {
      const c = pos[i][k] + t[k];
      if (c < lo[k]) lo[k] = c;
      if (c > hi[k]) hi[k] = c;
    }
  }
  const f = (a) => a.map((v) => v.toFixed(4)).join(", ");
  console.log(`part ${String(part).padStart(3)} mesh ${node.mesh}  tris ${idx.length / 3}  min [${f(lo)}]  max [${f(hi)}]  ctr [${f(lo.map((v, k) => (v + hi[k]) / 2))}]  size [${f(hi.map((v, k) => v - lo[k]))}]`);
}
