// Move segmentation parts between the model contract's groups, in place.
//
//   node tools/glb-regroup.mjs <bot.glb> <group> <part,part,...> [--write]
//   group: body | weapon | aux-<name> | weaponSub-<name> | none
//
// `none` unparents the part instead, which is how a part that should not be on
// the robot at all gets removed. glTF only draws what the scene graph reaches,
// so an unparented part is gone from every renderer; its vertex data stays in
// the BIN chunk, which is the same trade glb-carve.mjs already makes and costs
// only bytes. Carving the triangles out would need the region to be expressed
// in the right space, and for a whole part there is nothing to express.
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
const REMOVE = group === "none";
const target = REMOVE ? null
  : group === "body" ? "modelBody"
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
const createdGroups = new Set();
if (!REMOVE && !nodeIndex.has(target)) {
  // --create makes the group instead of refusing. A group is a node with a
  // children list and a pivotLocal, and nothing else — see the note above about
  // groups carrying no transform — so there is nothing to bake and no reason
  // the only way to get one should be a re-cut from a file nobody has. The case
  // that needs it is SPLITTING an existing group: Dragon King's two saw blades
  // were partitioned as one modelWeaponSub, and one group can only spin about
  // one axis, which is wrong for two blades that lean opposite ways.
  if (!flags.includes("--create")) {
    throw new Error(`${path} has no ${target} — groups here are: ${json.nodes.map((n) => n.name).filter((n) => n?.startsWith("model")).join(", ")}`
      + `\n(pass --create to make it)`);
  }
  // modelWeaponSub-* hangs under modelWeapon, because that is where models.js
  // looks for it; everything else is a scene root alongside modelBody.
  const holderName = target.startsWith("modelWeaponSub-") ? "modelWeapon" : null;
  const created = { name: target, children: [], extras: {} };
  json.nodes.push(created);
  nodeIndex.set(target, json.nodes.length - 1);
  if (holderName) {
    const holder = json.nodes[nodeIndex.get(holderName)];
    if (!holder) throw new Error(`${path} has no ${holderName} to hang ${target} under`);
    holder.children = holder.children || [];
    holder.children.push(nodeIndex.get(target));
  } else {
    json.scenes[0].nodes.push(nodeIndex.get(target));
  }
  createdGroups.add(target);
  console.log(`created ${target}${holderName ? ` under ${holderName}` : " at the scene root"}`);
}
const groups = json.nodes.filter((n) => n.name?.startsWith("model"));

const moved = [];
for (const part of wanted) {
  const id = nodeIndex.get(part);
  if (id === undefined) throw new Error(`${path} has no ${part}`);
  const from = groups.find((g) => (g.children || []).includes(id));
  if (!from) throw new Error(`${part} is not in any group`);
  if (!REMOVE && from.name === target) { console.log(`${part} already in ${target}`); continue; }
  from.children = from.children.filter((c) => c !== id);
  if (!REMOVE) json.nodes[nodeIndex.get(target)].children.push(id);
  moved.push(`${part}: ${from.name} -> ${target ?? "removed"}`);
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

// A group with no pivotLocal falls back at load time to the bbox centre of
// whatever it holds, which is right for a disc and wrong for a hinge. Write it
// explicitly for a group this run created, so the file says what it turns about
// instead of leaving the answer to be re-derived.
for (const g of groups) {
  if (!createdGroups.has(g.name) || g.extras?.pivotLocal || !(g.children || []).length) continue;
  const bounds = boundsOf(g);
  if (bounds) {
    g.extras = g.extras || {};
    g.extras.pivotLocal = [0, 1, 2].map((i) => +((bounds.min[i] + bounds.max[i]) / 2).toFixed(4));
    console.log(`${g.name}: pivotLocal ${JSON.stringify(g.extras.pivotLocal)}`);
  }
}

// Splitting a group empties the one it came from. An empty group is not
// harmless — models.js takes the FIRST modelWeaponSub-* it finds, so an empty
// leftover can win the search and the real one never spins.
for (const g of groups) {
  if (g.mesh !== undefined || (g.children || []).length) continue;
  const id = json.nodes.indexOf(g);
  let dropped = false;
  for (const n of json.nodes) {
    if (!n.children?.includes(id)) continue;
    n.children = n.children.filter((c) => c !== id);
    dropped = true;
  }
  const roots = json.scenes[0].nodes;
  if (roots.includes(id)) { json.scenes[0].nodes = roots.filter((c) => c !== id); dropped = true; }
  // Unparented, not spliced out: node indices are positional and everything
  // above the hole would shift. glTF draws only what the scene reaches.
  if (dropped) console.log(`${g.name}: empty, unparented`);
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
for (const part of wanted) {
  const id = checkJson.nodes.findIndex((n) => n.name === part);
  const parents = checkJson.nodes.filter((n) => (n.children || []).includes(id)).map((n) => n.name);
  if (REMOVE) {
    if (parents.length) throw new Error(`verify failed: ${part} is still under ${parents.join(", ")}`);
  } else if (!parents.includes(target)) {
    throw new Error(`verify failed: ${part} is not in ${target} (it is under ${parents.join(", ") || "nothing"})`);
  }
}
console.log(`verified: ${wanted.length} part(s) ${REMOVE ? "unparented" : `in ${target}`}, ${check.length} bytes`);
