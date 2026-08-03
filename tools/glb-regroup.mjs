// Move segmentation parts between the model contract's groups, in place.
//
//   node tools/glb-regroup.mjs <bot.glb> <group> <part,part,...> [--write]
//   group: body | weapon | aux-<name> | weaponSub-<name>
//
// glb-partition.mjs is the tool that CUTS a bot, and it needs the raw Tripo
// segmentation GLB to do it. Those are not in the repo — only the partitioned
// result under public/models is — so a part that landed in the wrong group has
// no cheap way back without re-running the whole pipeline from a file nobody
// has.
//
// It does not need one. Partitioning leaves the parts exactly where they were
// and only writes the grouping: the `modelBody` / `modelWeapon` / `modelAux-*`
// nodes carry no transform of their own, and every part keeps its original
// translation. So moving a part between groups is an edit to two `children`
// arrays and nothing else — no geometry, no buffers, no re-bake.
//
// Update tools/part-maps/<bot>.json to match, or the next re-cut undoes this.
import fs from "node:fs";

const [path, group, partList, ...flags] = process.argv.slice(2);
if (!partList) {
  console.error("usage: node tools/glb-regroup.mjs <bot.glb> <group> <part,part,...> [--write]");
  process.exit(2);
}
const target = group === "body" ? "modelBody"
  : group === "weapon" ? "modelWeapon"
    : `model${group[0].toUpperCase()}${group.slice(1)}`;
const wanted = partList.split(",").map((p) => `tripo_part_${p.trim().replace(/^tripo_part_/, "")}`);

const align4 = (v) => (v + 3) & ~3;
const buf = fs.readFileSync(path);
if (buf.toString("utf8", 0, 4) !== "glTF") throw new Error(`${path} is not a GLB`);
const jsonLen = buf.readUInt32LE(12);
const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen).trim());
const binStart = 20 + align4(jsonLen) + 8;
const binLen = buf.readUInt32LE(binStart - 8);

const nodeIndex = new Map(json.nodes.map((n, i) => [n.name, i]));
if (!nodeIndex.has(target)) {
  throw new Error(`${path} has no ${target} — groups here are: ${json.nodes.map((n) => n.name).filter((n) => n?.startsWith("model")).join(", ")}`);
}
const groups = json.nodes.filter((n) => n.name?.startsWith("model"));

const moved = [];
for (const part of wanted) {
  const id = nodeIndex.get(part);
  if (id === undefined) throw new Error(`${path} has no ${part}`);
  const from = groups.find((g) => (g.children || []).includes(id));
  if (!from) throw new Error(`${part} is not in any group`);
  if (from.name === target) { console.log(`${part} already in ${target}`); continue; }
  from.children = from.children.filter((c) => c !== id);
  json.nodes[nodeIndex.get(target)].children.push(id);
  moved.push(`${part}: ${from.name} -> ${target}`);
}
if (!moved.length) { console.log("nothing to do"); process.exit(0); }
console.log(moved.join("\n"));

// weaponBounds/auxBounds are stale once membership changes. Nothing at runtime
// reads them (models.js reads pivotLocal only), but leaving a wrong number in
// the file is how the next person gets misled, so recompute from the members.
function boundsOf(node) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const id of node.children || []) {
    const child = json.nodes[id];
    if (child.mesh === undefined) continue;
    const acc = json.accessors[json.meshes[child.mesh].primitives[0].attributes.POSITION];
    const t = child.translation || [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], acc.min[i] + t[i]);
      max[i] = Math.max(max[i], acc.max[i] + t[i]);
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}
for (const g of groups) {
  const key = g.name === "modelWeapon" ? "weaponBounds" : g.name.startsWith("modelAux-") ? "auxBounds" : null;
  if (!key || !g.extras?.[key]) continue;
  const bounds = boundsOf(g);
  if (bounds) g.extras[key] = bounds;
}

if (!flags.includes("--write")) {
  console.log("(dry run — pass --write to apply)");
  process.exit(0);
}

const nextJson = Buffer.from(JSON.stringify(json), "utf8");
const padded = Buffer.alloc(align4(nextJson.length), 0x20);
nextJson.copy(padded);
const out = Buffer.alloc(12 + 8 + padded.length + 8 + binLen);
out.write("glTF", 0);
out.writeUInt32LE(2, 4);
out.writeUInt32LE(out.length, 8);
out.writeUInt32LE(padded.length, 12);
out.write("JSON", 16);
padded.copy(out, 20);
out.writeUInt32LE(binLen, 20 + padded.length);
out.write("BIN\0", 24 + padded.length);
buf.copy(out, 28 + padded.length, binStart, binStart + binLen);
fs.writeFileSync(path, out);

// Read it back: the container has to still parse and the move has to have stuck.
const check = fs.readFileSync(path);
const checkJson = JSON.parse(check.toString("utf8", 20, 20 + check.readUInt32LE(12)).trim());
const dest = checkJson.nodes.find((n) => n.name === target);
for (const part of wanted) {
  const id = checkJson.nodes.findIndex((n) => n.name === part);
  if (!dest.children.includes(id)) throw new Error(`verify failed: ${part} is not in ${target}`);
}
console.log(`verified: ${wanted.length} part(s) in ${target}, ${check.length} bytes`);
