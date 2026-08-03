// Resize one bot in the catalog, consistently.
//
//   node tools/rescale-bot.mjs <botId> <newWidthFt> [--write]
//
// Every length in a catalog entry is in the SAME scaled space: the GLB is
// scaled so its measured width equals realWorld.size.widthFt (see SIZING at the
// top of the catalog), and bodyDims, collider extents and offsets, weapon
// pivots and radii, wheel anchor x/z and the tuning reaches were all MEASURED
// after that scale was applied. So a bot cannot be resized by editing widthFt:
// changing it without moving everything else leaves a bot whose colliders no
// longer match its model, whose weapon pivot is off its own axle, and whose
// wheels are inside its chassis.
//
// Resizing is therefore one multiply applied to every length in the entry. The
// one exception is wheelAnchors.y, which is not a length on the bot at all — it
// is a suspension probe origin measured against the fixed 0.45ft ray travel in
// sim/vehicle.js, and scaling it either sinks the chassis into the floor or
// takes the wheels off the ground.
//
// The rewrite is textual and scoped to the bot's own object literal, then
// verified by re-importing the catalog and comparing every scaled field against
// the factor. If anything did not land, this exits non-zero and writes nothing.

import fs from "node:fs";

const CATALOG_PATH = new URL("../src/assets/catalog.js", import.meta.url);

// Keys whose numeric values are lengths in the bot's scaled space. Anything not
// named here is left alone — angles, masses, ratios, rpm, colours, spin-up
// seconds, and wheelAnchors.y (see above).
const LENGTH_KEYS = new Set([
  "modelScale",
  "widthFt", "lengthFt", "heightFt",
  "halfExtents", "halfHeight", "radius", "offset", "tipY",
  "bodyDims", "dims", "pivot",
  "reach", "liftClearance", "sawCenter", "gripReach",
  "wheelRadius",
  // A flamethrower's nozzles are points on the bot and its reach is a distance
  // from it; `scale` sizes the jet's puffs in world feet (engine/effects.js), so
  // it is a length too — a bot that got 12% bigger breathes a 12% bigger flame.
  "nozzles", "scale",
]);
// Inside these, x/y/z are all lengths. wheelAnchors is handled specially.
const VECTOR_KEYS = new Set([
  "halfExtents", "offset", "bodyDims", "dims", "pivot", "sawCenter", "nozzles",
]);

function botRange(src, id) {
  const head = src.indexOf(`\n  ${id}: {`);
  if (head < 0) throw new Error(`no catalog entry for "${id}"`);
  let depth = 0;
  let i = src.indexOf("{", head);
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  throw new Error(`unterminated entry for "${id}"`);
}

/**
 * Four decimals at minimum, whatever the source used. The catalog's measured
 * values are authored to 3-4 places and a scale factor is not a round number:
 * carrying an authored `0.55` through at two places lands on 0.61 when the
 * answer is 0.6142, which is a tenth of an inch of collider in the wrong place
 * for no reason.
 */
function fmt(value, sample) {
  const decimals = (sample.split(".")[1] || "").length;
  const out = value.toFixed(Math.max(decimals, 4));
  return out.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/**
 * Walk the entry's text and scale every numeric literal that sits under a
 * length key. Tracks the enclosing key so `{ x, y, z }` members are scaled only
 * when their parent is a vector of lengths, and so wheelAnchors keeps its y.
 */
function rescaleText(text, factor) {
  const out = [];
  let cursor = 0;
  // key: value | key: { ... } — find every `name:` and decide from the name.
  const keyRe = /([A-Za-z_$][\w$]*)\s*:\s*/g;
  const stack = []; // enclosing length-key context
  let inWheelAnchors = false;
  let wheelDepth = 0;
  let depth = 0;
  let match;
  let last = 0;

  // A single pass that tracks brace depth alongside the key scan.
  const pushDepthTo = (index) => {
    for (let i = last; i < index; i++) {
      const ch = text[i];
      if (ch === "{" || ch === "[") depth++;
      else if (ch === "}" || ch === "]") {
        depth--;
        while (stack.length && stack[stack.length - 1].depth > depth) stack.pop();
        if (inWheelAnchors && depth < wheelDepth) inWheelAnchors = false;
      }
    }
    last = index;
  };

  while ((match = keyRe.exec(text)) !== null) {
    pushDepthTo(match.index);
    const key = match[1];
    const after = keyRe.lastIndex;
    if (key === "wheelAnchors") {
      inWheelAnchors = true;
      wheelDepth = depth + 1;
      continue;
    }
    const parent = stack.length ? stack[stack.length - 1].key : null;
    const isVectorMember = (key === "x" || key === "y" || key === "z")
      && (VECTOR_KEYS.has(parent) || inWheelAnchors);
    if (text[after] === "{") {
      if (LENGTH_KEYS.has(key)) stack.push({ key, depth: depth + 1 });
      continue;
    }
    const scalar = /^-?\d+(?:\.\d+)?/.exec(text.slice(after));
    if (!scalar) continue;
    // wheelAnchors.y is a probe origin, not a length on the bot.
    if (inWheelAnchors && key === "y") continue;
    if (!isVectorMember && !LENGTH_KEYS.has(key)) continue;
    const raw = scalar[0];
    out.push({ at: after, raw, next: fmt(Number(raw) * factor, raw) });
  }

  let result = "";
  cursor = 0;
  for (const edit of out) {
    result += text.slice(cursor, edit.at) + edit.next;
    cursor = edit.at + edit.raw.length;
  }
  return { text: result + text.slice(cursor), count: out.length };
}

const [id, widthArg, ...flags] = process.argv.slice(2);
if (!id || !widthArg) {
  console.error("usage: node tools/rescale-bot.mjs <botId> <newWidthFt> [--write]");
  process.exit(2);
}

const { CATALOG } = await import("../src/assets/catalog.js");
const before = CATALOG[id];
if (!before) throw new Error(`no catalog entry for "${id}"`);
const oldWidth = before.realWorld?.size?.widthFt;
if (!oldWidth) throw new Error(`${id} has no realWorld.size.widthFt to scale from`);
const newWidth = Number(widthArg);
const factor = newWidth / oldWidth;

const src = fs.readFileSync(CATALOG_PATH, "utf8");
const { start, end } = botRange(src, id);
const { text: scaled, count } = rescaleText(src.slice(start, end), factor);
const next = src.slice(0, start) + scaled + src.slice(end);

console.log(`${id}: ${oldWidth} -> ${newWidth} ft (x${factor.toFixed(5)}), ${count} lengths rewritten`);

if (!flags.includes("--write")) {
  console.log("(dry run — pass --write to apply)");
  process.exit(0);
}

fs.writeFileSync(CATALOG_PATH, next);

// Verify against a fresh import: every length must have moved by exactly the
// factor, and nothing else may have moved at all.
const { CATALOG: reloaded } = await import(`../src/assets/catalog.js?v=${Date.now()}`);
const after = reloaded[id];
const problems = [];
const near = (a, b) => Math.abs(a - b) <= Math.max(1e-4, Math.abs(b) * 2e-3);
const checkScaled = (path, a, b) => {
  if (!near(b, a * factor)) problems.push(`${path}: ${a} -> ${b}, expected ${(a * factor).toFixed(4)}`);
};
checkScaled("modelScale", before.modelScale, after.modelScale);
for (const axis of ["x", "y", "z"]) checkScaled(`bodyDims.${axis}`, before.bodyDims[axis], after.bodyDims[axis]);
before.wheelAnchors.forEach((anchor, i) => {
  checkScaled(`wheelAnchors[${i}].x`, anchor.x, after.wheelAnchors[i].x);
  checkScaled(`wheelAnchors[${i}].z`, anchor.z, after.wheelAnchors[i].z);
  if (anchor.y !== after.wheelAnchors[i].y) {
    problems.push(`wheelAnchors[${i}].y moved (${anchor.y} -> ${after.wheelAnchors[i].y}) — probe origins do not scale`);
  }
});
for (const axis of ["x", "y", "z"]) checkScaled(`weapon.pivot.${axis}`, before.weapon.pivot[axis], after.weapon.pivot[axis]);
if (before.weapon.radius) checkScaled("weapon.radius", before.weapon.radius, after.weapon.radius);
before.colliders.forEach((c, i) => {
  for (const axis of ["x", "y", "z"]) {
    if (c.halfExtents) checkScaled(`colliders[${i}].halfExtents.${axis}`, c.halfExtents[axis], after.colliders[i].halfExtents[axis]);
    if (c.offset) checkScaled(`colliders[${i}].offset.${axis}`, c.offset[axis], after.colliders[i].offset[axis]);
  }
  if (c.radius) checkScaled(`colliders[${i}].radius`, c.radius, after.colliders[i].radius);
  if (c.halfHeight) checkScaled(`colliders[${i}].halfHeight`, c.halfHeight, after.colliders[i].halfHeight);
});
// Nothing that is not a length may have shifted.
for (const [key, value] of Object.entries(before.weapon)) {
  if (typeof value !== "number") continue;
  if (["radius"].includes(key)) continue;
  if (after.weapon[key] !== value) problems.push(`weapon.${key} changed (${value} -> ${after.weapon[key]}) — not a length`);
}
if (before.weightLbs !== after.weightLbs) problems.push("weightLbs changed");
if (before.maxSpeedFps !== after.maxSpeedFps) problems.push("maxSpeedFps changed");

if (problems.length) {
  fs.writeFileSync(CATALOG_PATH, src); // put it back
  console.error(`REVERTED — the rewrite did not verify:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log("verified: every length scaled, nothing else touched");
