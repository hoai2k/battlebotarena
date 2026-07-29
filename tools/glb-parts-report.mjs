// Per-part classification report for a Tripo segmentation GLB.
// Prints parts sorted by vertex count with size/position and flags likely
// wheel pairs (mirrored discs) to speed up part-map authoring.
// Usage: node tools/glb-parts-report.mjs tripo_out/<bot>_seg.glb
import fs from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node tools/glb-parts-report.mjs <seg.glb>");
  process.exit(1);
}
const buffer = fs.readFileSync(path);
const jsonLength = buffer.readUInt32LE(12);
const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).trim());

const parts = json.nodes
  .filter((node) => /^tripo_part_\d+$/.test(node.name || "") && node.mesh !== undefined)
  .map((node) => {
    const accessor = json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION];
    const size = accessor.max.map((v, i) => v - accessor.min[i]);
    const center = accessor.max.map((v, i) => (v + accessor.min[i]) / 2 + (node.translation?.[i] || 0));
    return { part: Number(node.name.replace("tripo_part_", "")), verts: accessor.count, size, center };
  })
  .sort((a, b) => b.verts - a.verts);

// Wheel heuristic: pairs mirrored across x or z with one thin axis and
// near-equal sizes.
const wheelish = new Set();
for (const a of parts) {
  for (const b of parts) {
    if (a.part >= b.part) continue;
    const sizeMatch = a.size.every((v, i) => Math.abs(v - b.size[i]) < 0.05);
    const thinAxis = a.size.findIndex((v) => v < Math.max(...a.size) * 0.45);
    if (!sizeMatch || thinAxis < 0) continue;
    const mirrorAxis = [0, 2].find((axis) => Math.abs(a.center[axis] + b.center[axis]) < 0.06 && Math.abs(a.center[axis]) > 0.15);
    if (mirrorAxis !== undefined && Math.abs(a.center[1] - b.center[1]) < 0.05) {
      wheelish.add(a.part);
      wheelish.add(b.part);
    }
  }
}

const fmt = (arr) => "[" + arr.map((v) => v.toFixed(2).padStart(6)) + "]";
for (const p of parts) {
  const tags = [];
  if (p === parts[0]) tags.push("BODY?");
  if (wheelish.has(p.part)) tags.push("WHEEL-PAIR?");
  console.log(`part ${String(p.part).padStart(2)}  verts ${String(p.verts).padStart(7)}  size ${fmt(p.size)}  center ${fmt(p.center)}  ${tags.join(" ")}`);
}
console.log(`\n${parts.length} parts. Author map: {"weapon": [..], "wheels": [[..],[..]], "weaponAxis": [0,0,1]}`);
