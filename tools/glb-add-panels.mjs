// Append flat armour panels to a partitioned GLB.
//
// Photogrammetry/Tripo bodies are reconstructed from reference photos, so faces
// the camera never saw come back missing: Tombstone's shell arrives as a wedge
// canopy with no rear panel and nothing underneath, and you can see straight
// into the chassis from behind or below. This tool closes those openings with
// procedurally generated plates carrying a plain dark material (no texture) —
// the same read as the bare steel the rest of the body is painted with.
//
// Panels are appended as children of a group node (modelBody by default), so
// they inherit the part's transform and the runtime loader picks them up with
// no changes: normalizeScene() bakes yaw/scale/grounding over the whole scene
// and detach() carries the panels along with the rest of the body.
//
// This runs AFTER glb-partition (it needs the model* group nodes) and is
// therefore a re-runnable step on the shipped GLB, like glb-texture-optimize.
//
// Usage: node tools/glb-add-panels.mjs <in.glb> <out.glb> <panels.json>
// panels.json:
//   { "parent": "modelBody",
//     "material": { "name": "...", "baseColorFactor": [r,g,b,a],
//                   "metallicFactor": 0.55, "roughnessFactor": 0.5,
//                   "alpha": 0.28 },   // set alpha for a glass/lexan window
//     "panels": [
//       { "name": "panelBack", "type": "box",
//         "min": [x,y,z], "max": [x,y,z] },
//       { "name": "panelBottom", "type": "plate", "axis": "y",
//         "range": [yLow, yHigh], "outline": [[x,z], ...] }
//     ] }
// Coordinates are MODEL space (the part node's translation already applied) —
// the same frame glb-parts-report and the rainbow viewer print.
import fs from "node:fs";

function align4(value) {
  return (value + 3) & ~3;
}

const [inPath, outPath, specPath] = process.argv.slice(2);
if (!specPath) {
  console.error("Usage: node tools/glb-add-panels.mjs <in.glb> <out.glb> <panels.json>");
  process.exit(1);
}
const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
const buffer = fs.readFileSync(inPath);
if (buffer.toString("utf8", 0, 4) !== "glTF") throw new Error("not a GLB");
const jsonLength = buffer.readUInt32LE(12);
const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).trim());
const binHeader = 20 + align4(jsonLength);
const binLength = buffer.readUInt32LE(binHeader);
const bin = buffer.subarray(binHeader + 8, binHeader + 8 + binLength);

// --- Mesh building ----------------------------------------------------------

// Every panel is flat-shaded: each triangle owns its three vertices so the
// plate edges stay crisp instead of smearing a shared normal around a corner.
function createBuilder() {
  const positions = [];
  const normals = [];
  const indices = [];
  return {
    positions,
    normals,
    indices,
    /** @param {number[][]} points triangle corners, counter-clockwise seen from outside */
    triangle(points) {
      const [a, b, c] = points;
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const length = Math.hypot(n[0], n[1], n[2]) || 1;
      const base = positions.length / 3;
      for (const point of points) {
        positions.push(point[0], point[1], point[2]);
        normals.push(n[0] / length, n[1] / length, n[2] / length);
      }
      indices.push(base, base + 1, base + 2);
    },
    quad(points) {
      this.triangle([points[0], points[1], points[2]]);
      this.triangle([points[0], points[2], points[3]]);
    },
  };
}

function buildBox(builder, panel) {
  const [x0, y0, z0] = panel.min;
  const [x1, y1, z1] = panel.max;
  const corner = (x, y, z) => [x ? x1 : x0, y ? y1 : y0, z ? z1 : z0];
  builder.quad([corner(0, 0, 1), corner(1, 0, 1), corner(1, 1, 1), corner(0, 1, 1)]); // +z
  builder.quad([corner(1, 0, 0), corner(0, 0, 0), corner(0, 1, 0), corner(1, 1, 0)]); // -z
  builder.quad([corner(1, 0, 1), corner(1, 0, 0), corner(1, 1, 0), corner(1, 1, 1)]); // +x
  builder.quad([corner(0, 0, 0), corner(0, 0, 1), corner(0, 1, 1), corner(0, 1, 0)]); // -x
  builder.quad([corner(0, 1, 1), corner(1, 1, 1), corner(1, 1, 0), corner(0, 1, 0)]); // +y
  builder.quad([corner(0, 0, 0), corner(1, 0, 0), corner(1, 0, 1), corner(0, 0, 1)]); // -y
}

// Ear clipping — the footprint outlines traced off a scanned hull are simple
// but not reliably convex, so a fan from vertex 0 would fold over itself.
function triangulate(outline) {
  const area = (poly) => poly.reduce((sum, p, i) => {
    const q = poly[(i + 1) % poly.length];
    return sum + (p[0] * q[1] - q[0] * p[1]);
  }, 0) / 2;
  const remaining = area(outline) < 0 ? outline.map((_, i) => outline.length - 1 - i) : outline.map((_, i) => i);
  const cross = (o, a, b) => (outline[a][0] - outline[o][0]) * (outline[b][1] - outline[o][1])
    - (outline[a][1] - outline[o][1]) * (outline[b][0] - outline[o][0]);
  const inside = (p, a, b, c) => {
    const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  const triangles = [];
  let guard = remaining.length * remaining.length;
  while (remaining.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i += 1) {
      const a = remaining[(i + remaining.length - 1) % remaining.length];
      const b = remaining[i];
      const c = remaining[(i + 1) % remaining.length];
      if (cross(a, b, c) <= 0) continue; // reflex corner
      if (remaining.some((p) => p !== a && p !== b && p !== c && inside(p, a, b, c))) continue;
      triangles.push([a, b, c]);
      remaining.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate outline: keep what we have
  }
  if (remaining.length === 3) triangles.push([remaining[0], remaining[1], remaining[2]]);
  return triangles;
}

// A plate is an outline traced in the plane normal to `axis`, extruded between
// range[0] and range[1] — the shape a real armour plate cut from flat stock has.
function buildPlate(builder, panel) {
  const axis = panel.axis || "y";
  const [low, high] = panel.range;
  const outline = panel.outline;
  const point = (uv, level) => (axis === "y" ? [uv[0], level, uv[1]]
    : axis === "x" ? [level, uv[0], uv[1]]
    : [uv[0], uv[1], level]);
  for (const [a, b, c] of triangulate(outline)) {
    builder.triangle([point(outline[a], high), point(outline[b], high), point(outline[c], high)]);
    builder.triangle([point(outline[c], low), point(outline[b], low), point(outline[a], low)]);
  }
  for (let i = 0; i < outline.length; i += 1) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    builder.quad([point(a, low), point(b, low), point(b, high), point(a, high)]);
  }
}

// --- BIN appending ----------------------------------------------------------

const appendChunks = [];
let appendOffset = bin.length;

function appendView(bytes, target) {
  const padded = Buffer.concat([bytes, Buffer.alloc(align4(bytes.length) - bytes.length)]);
  const index = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset: appendOffset, byteLength: bytes.length, target });
  appendChunks.push(padded);
  appendOffset += padded.length;
  return index;
}

function appendFloats(values, type) {
  const comps = type === "VEC3" ? 3 : 1;
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => bytes.writeFloatLE(value, i * 4));
  const count = values.length / comps;
  const min = new Array(comps).fill(Infinity);
  const max = new Array(comps).fill(-Infinity);
  for (let i = 0; i < values.length; i += 1) {
    const c = i % comps;
    min[c] = Math.min(min[c], values[i]);
    max[c] = Math.max(max[c], values[i]);
  }
  const accessor = json.accessors.length;
  json.accessors.push({ bufferView: appendView(bytes, 34962), componentType: 5126, count, type, min, max });
  return accessor;
}

function appendIndices(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, i) => bytes.writeUInt32LE(value, i * 4));
  const accessor = json.accessors.length;
  json.accessors.push({ bufferView: appendView(bytes, 34963), componentType: 5125, count: values.length, type: "SCALAR" });
  return accessor;
}

// --- Assemble ---------------------------------------------------------------

const parentName = spec.parent || "modelBody";
const parent = json.nodes.find((node) => node.name === parentName);
if (!parent) throw new Error(`parent node ${parentName} not found — run glb-partition first`);
if (parent.translation || parent.rotation || parent.scale || parent.matrix) {
  throw new Error(`parent node ${parentName} has a transform; panel coordinates assume identity`);
}

const material = spec.material || {};
const materialIndex = json.materials.length;
const panelMaterial = {
  name: material.name || "PanelPlain",
  // Single-sided for glass: a doubleSided transparent box blends its own back
  // faces over its front ones and comes out milky.
  doubleSided: material.doubleSided ?? !material.alpha,
  pbrMetallicRoughness: {
    baseColorFactor: material.baseColorFactor || [0.04, 0.04, 0.045, 1],
    metallicFactor: material.metallicFactor ?? 0.55,
    roughnessFactor: material.roughnessFactor ?? 0.5,
  },
};
// `alpha` makes the panel a window rather than a plate: polycarbonate over an
// electronics bay reads as glass, and the parts inside stay visible.
if (material.alpha !== undefined) {
  panelMaterial.alphaMode = "BLEND";
  panelMaterial.pbrMetallicRoughness.baseColorFactor = [
    ...(material.baseColorFactor || [0.04, 0.04, 0.045]).slice(0, 3), material.alpha,
  ];
}
json.materials.push(panelMaterial);

parent.children = parent.children || [];
for (const panel of spec.panels) {
  const builder = createBuilder();
  if (panel.type === "box") buildBox(builder, panel);
  else if (panel.type === "plate") buildPlate(builder, panel);
  else throw new Error(`unknown panel type ${panel.type}`);
  if (!builder.indices.length) throw new Error(`panel ${panel.name} produced no triangles`);

  const meshIndex = json.meshes.length;
  json.meshes.push({
    name: `mesh_${panel.name}`,
    primitives: [{
      attributes: {
        POSITION: appendFloats(builder.positions, "VEC3"),
        NORMAL: appendFloats(builder.normals, "VEC3"),
      },
      indices: appendIndices(builder.indices),
      material: materialIndex,
    }],
  });
  const nodeIndex = json.nodes.length;
  json.nodes.push({ name: panel.name, mesh: meshIndex });
  parent.children.push(nodeIndex);
  console.log(`${panel.name}: ${builder.indices.length / 3} tris -> ${parentName}`);
}

// --- Reassemble GLB ---------------------------------------------------------

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
