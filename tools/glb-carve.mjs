// Part surgery on a Tripo segmentation GLB (indexed geometry).
// Four modes per operation:
//   delete   — remove triangles of a part inside a region (junk cleanup)
//   extract  — MOVE triangles of a part inside a region into a NEW part node
//              (e.g. split sawblaze's saw disc out of the arm so it can spin)
//   reparent — move a whole tripo_part_N node under a different group, for a
//              part the map filed under the wrong assembly (clawviper's fork
//              hubs, which belong to the lifter)
//   pivot    — rewrite a group node's extras.pivotLocal, i.e. the hinge the
//              runtime loader turns that assembly about
//   transform — scale and/or offset a whole part node, for a part the scan
//              built at the wrong size or in the wrong place relative to the
//              rest of the machine (Free Shipping's fork carriage, which was
//              too narrow to pass either side of its own middle wedge)
//   mirror   — replace the bad half of a SYMMETRIC part with a mirrored copy of
//              the good half (writes new vertices)
//   clone    — duplicate a part rotated half a turn about an axis, for a bar
//              spinner whose second end the scan never resolved
//   paint    — move matching triangles onto a new plain material, for surface
//              the scan textured wrong (blank atlas corners read as pale patches)
//   islands  — MOVE every connected component below `minTris` into a new part.
//              A region carved out of a scan shell drags loose specks of the
//              donor along its cut line; they are not describable by position
//              or by colour, but they are always the components that are not
//              attached to the thing you actually carved.
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
//            {"mode": "islands", "part": 910, "minTris": 400, "newPart": 912,
//             "parent": "modelBody"}
//            {"mode": "reparent", "part": 5, "parent": "modelWeapon"}
//            {"mode": "pivot", "node": "modelWeapon", "pivotLocal": [x,y,z]}]
// Requires `sharp` only when an op uses a colour region: npm i --no-save sharp
// Regions are in MODEL space (node translation applied), matching the
// coordinates shown by glb-parts-report / the rainbow viewer. A region may
// also be {"type": "union", "regions": [ ... ]} — an arm that runs diagonally
// through a chassis needs several boxes, and one op per box would file each
// slice as its own part — or {"type": "intersect", "regions": [...]}.
//
// {"type": "cylinder", "axis": 0|1|2, "center": [x,y,z], "radius": r,
//  "halfLength": h} is the region a spinner wants: a box around a drum
// swallows chassis at its corners, a cylinder about the spin axis does not.
//
// {"type": "colour", "rgb": [r,g,b], "tolerance": 60} matches on the BASE
// COLOUR TEXEL under the triangle's UV centroid instead of on position. Some
// mistakes are only describable by livery: when a carve out of a chassis takes
// a few of the chassis's own painted rails with it, the rails are not in a box
// you can draw around, but they are unmistakably the body colour.
// {"type": "colour", "dominant": "b", "margin": 20} matches on hue instead of
// on distance — livery in shadow is the same hue at a fraction of the
// brightness, and a fixed RGB target misses most of it. Intersect it with a box
// when the same hue appears somewhere you want to keep.
//
// Two options make extract usable on an ALREADY-PARTITIONED GLB, where the
// point is usually to hand a stowaway back to the chassis rather than to split
// a new moving part out:
//   "invert": true    — operate on the triangles OUTSIDE the region. Describing
//                       the part you want to KEEP is far easier than describing
//                       the scattered scan debris you want gone.
//   "parent": "modelBody" — attach the new node under a group node instead of
//                       at the scene root, so it inherits that part's transform
//                       and the runtime loader sees it as body geometry.
import fs from "node:fs";
import sharp from "sharp";

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

// --- base-colour sampling (only paid for when a colour region is used) -------
const textureCache = new Map(); // image index -> { width, height, channels, data }

async function loadTexture(materialIndex) {
  const material = json.materials?.[materialIndex];
  const baseColor = material?.pbrMetallicRoughness?.baseColorTexture;
  if (!baseColor) return null;
  const image = json.textures[baseColor.index].source;
  if (!textureCache.has(image)) {
    const view = json.bufferViews[json.images[image].bufferView];
    const bytes = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    const raw = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    textureCache.set(image, {
      width: raw.info.width, height: raw.info.height, channels: raw.info.channels, data: raw.data,
    });
  }
  return textureCache.get(image);
}

function readUV(accessorIndex, vertexIndex) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const stride = view.byteStride || 8;
  const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0) + vertexIndex * stride;
  return [bin.readFloatLE(offset), bin.readFloatLE(offset + 4)];
}

/** glTF UV origin is TOP-LEFT: y = v * height, never (1 - v) * height. */
function sampleTexel(texture, u, v) {
  const x = Math.min(texture.width - 1, Math.max(0, Math.round(u * texture.width)));
  const y = Math.min(texture.height - 1, Math.max(0, Math.round(v * texture.height)));
  const i = (y * texture.width + x) * texture.channels;
  return [texture.data[i], texture.data[i + 1], texture.data[i + 2]];
}

function regionUsesColour(region) {
  if (!region) return false;
  if (region.type === "colour") return true;
  return (region.regions || []).some(regionUsesColour);
}

function inRegion(point, region, sample = null) {
  if (region.type === "sphere") {
    const [cx, cy, cz] = region.center;
    return Math.hypot(point[0] - cx, point[1] - cy, point[2] - cz) <= region.radius;
  }
  if (region.type === "cylinder") {
    // A box around a drum inevitably swallows chassis at its corners; a
    // cylinder about the spin axis does not.
    const axis = region.axis ?? 0;
    const [cx, cy, cz] = region.center;
    const centre = [cx, cy, cz];
    if (Math.abs(point[axis] - centre[axis]) > region.halfLength) return false;
    let sum = 0;
    for (let i = 0; i < 3; i += 1) {
      if (i === axis) continue;
      sum += (point[i] - centre[i]) ** 2;
    }
    return Math.sqrt(sum) <= region.radius;
  }
  if (region.type === "box") {
    return (
      point[0] >= region.min[0] && point[0] <= region.max[0] &&
      point[1] >= region.min[1] && point[1] <= region.max[1] &&
      point[2] >= region.min[2] && point[2] <= region.max[2]
    );
  }
  if (region.type === "union") return region.regions.some((r) => inRegion(point, r, sample));
  if (region.type === "intersect") return region.regions.every((r) => inRegion(point, r, sample));
  if (region.type === "colour") {
    if (!sample) return false;
    if (region.dominant) {
      // Livery in shadow is the same hue at a fraction of the brightness, so a
      // fixed RGB distance misses most of it. Ask which channel wins instead.
      const channel = { r: 0, g: 1, b: 2 }[region.dominant];
      const margin = region.margin ?? 20;
      return [0, 1, 2].every((i) => i === channel || sample[channel] - sample[i] >= margin);
    }
    const [r, g, b] = region.rgb;
    return Math.hypot(sample[0] - r, sample[1] - g, sample[2] - b) <= (region.tolerance ?? 48);
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


function readVec(accessorIndex, vertexIndex, size) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const stride = view.byteStride || size * 4;
  const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0) + vertexIndex * stride;
  const out = [];
  for (let i = 0; i < size; i += 1) out.push(bin.readFloatLE(offset + i * 4));
  return out;
}

/** Write a float vector back over the vertex it was read from. `bin` is a view
 *  into the loaded file and the output is concatenated from it, so this edits
 *  the geometry in place rather than appending a second copy of the part. */
function writeVec(accessorIndex, vertexIndex, values) {
  const accessor = json.accessors[accessorIndex];
  const view = json.bufferViews[accessor.bufferView];
  const stride = view.byteStride || values.length * 4;
  const offset = (view.byteOffset || 0) + (accessor.byteOffset || 0) + vertexIndex * stride;
  values.forEach((v, i) => bin.writeFloatLE(v, offset + i * 4));
}

const writePosition = (accessorIndex, vertexIndex, p) => writeVec(accessorIndex, vertexIndex, p);

/** Re-derive an accessor's min/max after moving its vertices. glTF carries them
 *  as metadata and viewers cull against them, so a stale pair makes a re-posed
 *  part flicker out at the edge of frame. */
function refreshAccessorBounds(accessorIndex, size) {
  const accessor = json.accessors[accessorIndex];
  const min = new Array(size).fill(Infinity);
  const max = new Array(size).fill(-Infinity);
  for (let i = 0; i < accessor.count; i += 1) {
    const v = readVec(accessorIndex, i, size);
    for (let k = 0; k < size; k += 1) {
      if (v[k] < min[k]) min[k] = v[k];
      if (v[k] > max[k]) max[k] = v[k];
    }
  }
  accessor.min = min;
  accessor.max = max;
}

/** Append a float accessor (VEC2/VEC3) and return its index. */
function appendFloatAccessor(rows, size) {
  const bytes = Buffer.alloc(align4(rows.length * size * 4));
  rows.forEach((row, r) => row.forEach((v, c) => bytes.writeFloatLE(v, (r * size + c) * 4)));
  const viewIndex = json.bufferViews.length;
  json.bufferViews.push({ buffer: 0, byteOffset: appendOffset, byteLength: rows.length * size * 4, target: 34962 });
  appendChunks.push(bytes);
  appendOffset += bytes.length;
  const min = new Array(size).fill(Infinity);
  const max = new Array(size).fill(-Infinity);
  for (const row of rows) row.forEach((v, c) => { min[c] = Math.min(min[c], v); max[c] = Math.max(max[c], v); });
  const accessorIndex = json.accessors.length;
  json.accessors.push({
    bufferView: viewIndex, componentType: 5126, count: rows.length,
    type: size === 3 ? "VEC3" : "VEC2", min, max,
  });
  return accessorIndex;
}

function nodeIndexByName(name) {
  const i = json.nodes.findIndex((n) => n.name === name);
  if (i < 0) throw new Error(`node ${name} not found`);
  return i;
}

for (const op of ops) {
  if (op.mode === "pivot") {
    const node = json.nodes[nodeIndexByName(op.node)];
    node.extras = { ...(node.extras || {}), pivotLocal: op.pivotLocal };
    console.log(`${op.node} [pivot]: pivotLocal = [${op.pivotLocal.join(", ")}]`);
    continue;
  }
  if (op.mode === "transform") {
    // Scale/offset a whole part node. Written as a node TRS rather than as new
    // vertices: the geometry is right, only its size and place are wrong, and
    // a node transform survives a re-run of the earlier carves untouched.
    // `centre` and `offset` are in the same MODEL space as a region (i.e. the
    // node's translation is already applied), so a spec can quote the game-space
    // number it came from and convert once with rig-inspect's --toglb.
    //   p' = centre + scale * (p - centre) + offset,  p = vertex + translation
    // => node.scale = scale, node.translation = scale*t + (1-scale)*centre + offset
    // The node's UNTRANSFORMED TRS is stashed in extras the first time, and
    // every later run solves from that rather than from the last result — so
    // running the spec twice lands in the same place instead of scaling the
    // part again. Every other mode here is naturally re-runnable over the
    // shipped GLB; this one would not be.
    const node = json.nodes[nodeIndexByName(op.node)];
    const scale = op.scale || [1, 1, 1];
    const centre = op.centre || op.center || [0, 0, 0];
    const offset = op.offset || [0, 0, 0];
    const base = node.extras?.transformBase
      || { translation: node.translation || [0, 0, 0], scale: node.scale || [1, 1, 1] };
    node.extras = { ...(node.extras || {}), transformBase: { translation: [...base.translation], scale: [...base.scale] } };
    node.scale = [0, 1, 2].map((i) => base.scale[i] * scale[i]);
    node.translation = [0, 1, 2].map((i) => scale[i] * base.translation[i] + (1 - scale[i]) * centre[i] + offset[i]);
    console.log(`${op.node} [transform]: scale ${node.scale.map((n) => n.toFixed(4)).join(", ")}`
      + `  translation ${base.translation.map((n) => n.toFixed(4)).join(", ")} -> ${node.translation.map((n) => n.toFixed(4)).join(", ")}`);
    continue;
  }
  if (op.mode === "paint") {
    // Move a part's triangles matching a region onto a NEW plain material.
    // Some scan damage is not shape at all: the surface is there and solid, its
    // UVs just point at a blank corner of the atlas, and it renders as a pale
    // patch that no amount of geometry surgery can reach. Deleting it opens a
    // hole; a panel behind it is hidden by it. The only thing that works is to
    // stop it sampling the texture.
    const node = json.nodes[nodeIndexByName(`tripo_part_${op.part}`)];
    const primitive = json.meshes[node.mesh].primitives[0];
    const posAccessor = primitive.attributes.POSITION;
    const uvAccessor = primitive.attributes.TEXCOORD_0;
    const indices = readIndices(primitive.indices);
    const translation = node.translation || [0, 0, 0];
    const texture = op.region?.type === "colour" || regionUsesColour(op.region)
      ? await loadTexture(primitive.material) : null;

    const kept = [];
    const painted = [];
    for (let t = 0; t < indices.length; t += 3) {
      const world = [0, 0, 0];
      for (let k = 0; k < 3; k += 1) {
        const p = readPosition(posAccessor, indices[t + k]);
        for (let a = 0; a < 3; a += 1) world[a] += (p[a] + translation[a]) / 3;
      }
      let sample = null;
      if (texture && uvAccessor !== undefined) {
        let u = 0, v = 0;
        for (let k = 0; k < 3; k += 1) {
          const uv = readUV(uvAccessor, indices[t + k]);
          u += uv[0] / 3; v += uv[1] / 3;
        }
        sample = sampleTexel(texture, u, v);
      }
      const inside = inRegion(world, op.region, sample) !== Boolean(op.invert);
      (inside ? painted : kept).push(indices[t], indices[t + 1], indices[t + 2]);
    }
    if (!painted.length) {
      if (op.allowEmpty) { console.log(`part ${op.part} [paint]: matched 0 triangles (allowEmpty)`); continue; }
      throw new Error(`part ${op.part}: paint matched 0 triangles — check the region`);
    }

    const materialIndex = json.materials.length;
    json.materials.push({
      name: op.material?.name || `paint_${op.part}`,
      pbrMetallicRoughness: {
        baseColorFactor: op.material?.baseColorFactor || [0.06, 0.06, 0.07, 1],
        metallicFactor: op.material?.metallicFactor ?? 0.6,
        roughnessFactor: op.material?.roughnessFactor ?? 0.45,
      },
      doubleSided: true,
    });
    primitive.indices = appendIndexBuffer(kept);
    json.meshes[node.mesh].primitives.push({
      attributes: { ...primitive.attributes },
      indices: appendIndexBuffer(painted),
      material: materialIndex,
    });
    console.log(`part ${op.part} [paint]: repainted ${painted.length / 3} tris, kept ${kept.length / 3}`);
    continue;
  }
  if (op.mode === "clone") {
    // Duplicate a part, rotated half a turn about an axis. A bar spinner has
    // TWO ends and they are the same casting a half-turn apart; when the scan
    // resolves only one of them, a mirror is the wrong symmetry (it gives a
    // reflected end, not the opposite one) and this is the right one. Rotation
    // preserves handedness, so unlike `mirror` the winding is left alone.
    const node = json.nodes[nodeIndexByName(`tripo_part_${op.part}`)];
    const primitive = json.meshes[node.mesh].primitives[0];
    const posAccessor = primitive.attributes.POSITION;
    const normalAccessor = primitive.attributes.NORMAL;
    const uvAccessor = primitive.attributes.TEXCOORD_0;
    const indices = readIndices(primitive.indices);
    const axis = op.axis ?? 0;                       // the axis turned about
    const translation = node.translation || [0, 0, 0];
    // Half a turn about `axis` negates the OTHER two components about centre.
    const other = [0, 1, 2].filter((i) => i !== axis);
    const centre = op.center;
    if (!Array.isArray(centre)) throw new Error(`part ${op.part}: clone needs "center"`);

    const remap = new Map();
    const position = [];
    const normal = [];
    const uv = [];
    for (const vi of indices) {
      if (remap.has(vi)) continue;
      remap.set(vi, position.length);
      const p = readPosition(posAccessor, vi);
      for (const i of other) p[i] = 2 * (centre[i] - translation[i]) - p[i];
      position.push(p);
      if (normalAccessor !== undefined) {
        const n = readVec(normalAccessor, vi, 3);
        for (const i of other) n[i] = -n[i];
        normal.push(n);
      }
      if (uvAccessor !== undefined) uv.push(readUV(uvAccessor, vi));
    }
    const cloned = [];
    for (const vi of indices) cloned.push(remap.get(vi));

    const attributes = { POSITION: appendFloatAccessor(position, 3) };
    if (normal.length) attributes.NORMAL = appendFloatAccessor(normal, 3);
    if (uv.length) attributes.TEXCOORD_0 = appendFloatAccessor(uv, 2);
    const meshIndex = json.meshes.length;
    json.meshes.push({
      name: `tripo_mesh_part_${op.part}_clone`,
      primitives: [{ attributes, indices: appendIndexBuffer(cloned), material: primitive.material }],
    });
    const newNodeIndex = json.nodes.length;
    json.nodes.push({ name: `tripo_part_${op.part}`, mesh: meshIndex, translation: [...translation] });
    const holder = json.nodes.find((n) => (n.children || []).includes(nodeIndexByName(`tripo_part_${op.part}`)));
    if (holder) { holder.children.push(newNodeIndex); }
    else json.scenes[0].nodes.push(newNodeIndex);
    console.log(`part ${op.part} [clone]: ${cloned.length / 3} tris turned 180 about axis ${axis}`);
    continue;
  }
  if (op.mode === "scale") {
    // Stretch or squash a part about a point, per axis, IN PLACE.
    //
    // Tripo resolves a body of revolution as an ellipse surprisingly often, and
    // on anything that SPINS that is not cosmetic: Gigabyte's shell measured
    // 3.81ft one way and 3.11ft the other, 18% out of round, which on a
    // full-body spinner reads as a wobble rather than as a dome. Scaling the
    // long axis back to the short one about the spin centre makes it circular
    // without touching the texture, because UVs do not move.
    //
    //   "factor": [sx,sy,sz], "pivot": [x,y,z] in MODEL space
    const node = json.nodes[nodeIndexByName(`tripo_part_${op.part}`)];
    const primitive = json.meshes[node.mesh].primitives[0];
    const posAccessor = primitive.attributes.POSITION;
    const indices = readIndices(primitive.indices);
    const translation = node.translation || [0, 0, 0];
    const factor = op.factor ?? [1, 1, 1];
    const pivot = op.pivot ?? [0, 0, 0];
    const seen = new Set();
    let moved = 0;
    for (const vi of indices) {
      if (seen.has(vi)) continue;
      seen.add(vi);
      const p = readPosition(posAccessor, vi);
      for (let k = 0; k < 3; k += 1) {
        p[k] = (p[k] + translation[k] - pivot[k]) * factor[k] + pivot[k] - translation[k];
      }
      writePosition(posAccessor, vi, p);
      moved += 1;
    }
    refreshAccessorBounds(posAccessor, 3);
    console.log(`part ${op.part} [scale]: ${moved} verts by [${factor.join(", ")}] about [${pivot.join(", ")}]`);
    continue;
  }
  if (op.mode === "rotate") {
    // Re-pose a part about an axis through a point, IN PLACE.
    //
    // A segmentation bakes whatever pose the photographs caught, and the
    // catalog's restAngle can only rotate a group the loader knows about. When
    // the baked pose is wrong the whole model pays for it, because
    // normalizeScene grounds on the lowest DRAWN point: Dragon King's front
    // grabber hung 0.56ft below its own tracks, so the tracks flew and the bot
    // stood on its chin. Rotating the offending group back is the only fix that
    // survives into the rest pose, the collider fit and every rig measurement
    // taken afterwards.
    //
    //   "axis": 0|1|2, "angle": radians, "pivot": [x,y,z] in MODEL space
    const node = json.nodes[nodeIndexByName(`tripo_part_${op.part}`)];
    const primitive = json.meshes[node.mesh].primitives[0];
    const posAccessor = primitive.attributes.POSITION;
    const normalAccessor = primitive.attributes.NORMAL;
    const indices = readIndices(primitive.indices);
    const translation = node.translation || [0, 0, 0];
    const axis = op.axis ?? 0;
    const angle = op.angle ?? 0;
    const pivot = op.pivot ?? [0, 0, 0];
    // The two axes that move, in right-handed order about `axis`.
    const [a, b] = axis === 0 ? [1, 2] : axis === 1 ? [2, 0] : [0, 1];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const seen = new Set();
    let moved = 0;
    for (const vi of indices) {
      if (seen.has(vi)) continue;
      seen.add(vi);
      const p = readPosition(posAccessor, vi);
      const pa = p[a] + translation[a] - pivot[a];
      const pb = p[b] + translation[b] - pivot[b];
      p[a] = pa * cos - pb * sin + pivot[a] - translation[a];
      p[b] = pa * sin + pb * cos + pivot[b] - translation[b];
      writePosition(posAccessor, vi, p);
      if (normalAccessor !== undefined) {
        const n = readVec(normalAccessor, vi, 3);
        const na = n[a];
        const nb = n[b];
        n[a] = na * cos - nb * sin;
        n[b] = na * sin + nb * cos;
        writeVec(normalAccessor, vi, n);
      }
      moved += 1;
    }
    refreshAccessorBounds(posAccessor, 3);
    console.log(`part ${op.part} [rotate]: ${moved} verts by ${angle.toFixed(3)}rad about axis ${axis} at [${pivot.join(", ")}]`);
    continue;
  }
  if (op.mode === "mirror") {
    // Replace the bad half of a SYMMETRIC part with a mirrored copy of the good
    // half. Photogrammetry lights one side better than the other and routinely
    // resolves the far end of a drum as ragged shell while the near end is
    // clean; the robot is symmetric, so the good half is the whole answer.
    // Unlike every other op this writes NEW vertices — a mirrored triangle
    // cannot be expressed by re-indexing the ones already there.
    const node = json.nodes[nodeIndexByName(`tripo_part_${op.part}`)];
    const primitive = json.meshes[node.mesh].primitives[0];
    const posAccessor = primitive.attributes.POSITION;
    const indices = readIndices(primitive.indices);
    const axis = op.axis ?? 0;
    const plane = op.plane ?? 0;
    const keepPositive = (op.keep ?? "+") === "+";
    const translation = node.translation || [0, 0, 0];

    const kept = [];
    for (let t = 0; t < indices.length; t += 3) {
      let mid = 0;
      for (let k = 0; k < 3; k += 1) mid += (readPosition(posAccessor, indices[t + k])[axis] + translation[axis]) / 3;
      if ((mid > plane) === keepPositive) kept.push(indices[t], indices[t + 1], indices[t + 2]);
    }
    if (!kept.length) throw new Error(`part ${op.part}: mirror kept 0 triangles — check plane/keep`);

    // Compact the kept side into its own vertex set, then emit its reflection.
    const remap = new Map();
    const position = [];
    const normal = [];
    const uv = [];
    const normalAccessor = primitive.attributes.NORMAL;
    const uvAccessor = primitive.attributes.TEXCOORD_0;
    for (const vi of kept) {
      if (remap.has(vi)) continue;
      remap.set(vi, position.length);
      const p = readPosition(posAccessor, vi);
      p[axis] = 2 * (plane - translation[axis]) - p[axis]; // reflect in the node's own frame
      position.push(p);
      if (normalAccessor !== undefined) {
        const n = readVec(normalAccessor, vi, 3);
        n[axis] = -n[axis];
        normal.push(n);
      }
      if (uvAccessor !== undefined) uv.push(readUV(uvAccessor, vi));
    }
    // Reflection flips handedness, so the winding has to flip back or every
    // mirrored face is inside-out and disappears under backface culling.
    const mirrored = [];
    for (let t = 0; t < kept.length; t += 3) {
      mirrored.push(remap.get(kept[t]), remap.get(kept[t + 2]), remap.get(kept[t + 1]));
    }

    primitive.indices = appendIndexBuffer(kept);
    const attributes = { POSITION: appendFloatAccessor(position, 3) };
    if (normal.length) attributes.NORMAL = appendFloatAccessor(normal, 3);
    if (uv.length) attributes.TEXCOORD_0 = appendFloatAccessor(uv, 2);
    const meshIndex = json.meshes.length;
    json.meshes.push({
      name: `tripo_mesh_part_${op.part}_mirror`,
      primitives: [{ attributes, indices: appendIndexBuffer(mirrored), material: primitive.material }],
    });
    const newNodeIndex = json.nodes.length;
    json.nodes.push({ name: `tripo_part_${op.part}`, mesh: meshIndex, translation: [...translation] });
    const parentName = op.parent || Object.entries(json.nodes).find(([, n]) =>
      (n.children || []).includes(nodeIndexByName(`tripo_part_${op.part}`)))?.[1]?.name;
    const parent = parentName ? json.nodes.find((n) => n.name === parentName) : null;
    if (parent) { parent.children = parent.children || []; parent.children.push(newNodeIndex); }
    else json.scenes[0].nodes.push(newNodeIndex);
    console.log(`part ${op.part} [mirror]: kept ${kept.length / 3} tris on the ${keepPositive ? "+" : "-"} side, mirrored to ${mirrored.length / 3}`);
    continue;
  }
  if (op.mode === "reparent") {
    const childIndex = nodeIndexByName(`tripo_part_${op.part}`);
    let from = null;
    for (const node of json.nodes) {
      if (!node.children?.includes(childIndex)) continue;
      from = node.name;
      node.children = node.children.filter((c) => c !== childIndex);
    }
    const parent = json.nodes[nodeIndexByName(op.parent)];
    parent.children = parent.children || [];
    if (!parent.children.includes(childIndex)) parent.children.push(childIndex);
    console.log(`part ${op.part} [reparent]: ${from || "(scene root)"} -> ${op.parent}`);
    continue;
  }
  if (op.mode === "islands") {
    const nodeIndex = json.nodes.findIndex((n) => n.name === `tripo_part_${op.part}`);
    if (nodeIndex < 0) throw new Error(`part ${op.part} not found`);
    const node = json.nodes[nodeIndex];
    const primitive = json.meshes[node.mesh].primitives[0];
    const indices = readIndices(primitive.indices);

    // Weld by rounded position first: a scan shell is riddled with UV seams
    // that split one surface into many index-distinct vertices.
    const key = new Map();
    const weld = new Int32Array(json.accessors[primitive.attributes.POSITION].count);
    for (let v = 0; v < weld.length; v += 1) {
      const p = readPosition(primitive.attributes.POSITION, v);
      const k = `${Math.round(p[0] * 4000)},${Math.round(p[1] * 4000)},${Math.round(p[2] * 4000)}`;
      let w = key.get(k);
      if (w === undefined) { w = v; key.set(k, v); }
      weld[v] = w;
    }
    const parent = new Int32Array(weld.length);
    for (let v = 0; v < parent.length; v += 1) parent[v] = v;
    const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
    const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
    for (let t = 0; t < indices.length; t += 3) {
      union(weld[indices[t]], weld[indices[t + 1]]);
      union(weld[indices[t + 1]], weld[indices[t + 2]]);
    }
    const size = new Map();
    for (let t = 0; t < indices.length; t += 3) {
      const r = find(weld[indices[t]]);
      size.set(r, (size.get(r) || 0) + 1);
    }
    const kept = [];
    const moved = [];
    for (let t = 0; t < indices.length; t += 3) {
      const big = size.get(find(weld[indices[t]])) >= op.minTris;
      (big ? kept : moved).push(indices[t], indices[t + 1], indices[t + 2]);
    }
    const islands = [...size.values()].filter((n) => n < op.minTris).length;
    if (!moved.length) {
      console.log(`part ${op.part} [islands]: nothing under ${op.minTris} tris`);
      continue;
    }
    primitive.indices = appendIndexBuffer(kept);
    console.log(`part ${op.part} [islands]: kept ${kept.length / 3} tris,`
      + ` moved ${islands} island(s) totalling ${moved.length / 3} tris`);
    const meshIndex = json.meshes.length;
    json.meshes.push({
      name: `tripo_mesh_part_${op.newPart}`,
      primitives: [{ attributes: { ...primitive.attributes }, indices: appendIndexBuffer(moved), material: primitive.material }],
    });
    const newNodeIndex = json.nodes.length;
    json.nodes.push({ name: `tripo_part_${op.newPart}`, mesh: meshIndex, translation: [...(node.translation || [0, 0, 0])] });
    if (op.parent) {
      const parentNode = json.nodes[nodeIndexByName(op.parent)];
      parentNode.children = parentNode.children || [];
      parentNode.children.push(newNodeIndex);
    } else {
      json.scenes[0].nodes.push(newNodeIndex);
    }
    continue;
  }
  const nodeIndex = json.nodes.findIndex((n) => n.name === `tripo_part_${op.part}`);
  if (nodeIndex < 0) throw new Error(`part ${op.part} not found`);
  const node = json.nodes[nodeIndex];
  const primitive = json.meshes[node.mesh].primitives[0];
  if (primitive.indices === undefined) throw new Error(`part ${op.part} is not indexed`);
  const translation = node.translation || [0, 0, 0];
  const indices = readIndices(primitive.indices);

  const usesColour = JSON.stringify(op.region).includes('"colour"');
  const texture = usesColour ? await loadTexture(primitive.material) : null;
  if (usesColour && !texture) throw new Error(`part ${op.part}: no base colour texture to sample`);
  const uvAccessor = primitive.attributes.TEXCOORD_0;

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
    let sample = null;
    if (texture) {
      let u = 0, v = 0;
      for (let k = 0; k < 3; k += 1) {
        const uv = readUV(uvAccessor, indices[t + k]);
        u += uv[0] / 3;
        v += uv[1] / 3;
      }
      sample = sampleTexel(texture, u, v);
    }
    const inside = inRegion(world, op.region, sample) !== Boolean(op.invert);
    (inside ? moved : kept).push(indices[t], indices[t + 1], indices[t + 2]);
  }
  if (!moved.length) {
    // Sweeping one region across a whole model (a Tripo scan's mirrored floor
    // reflection, a support stand) means listing every part whose BOX dips into
    // it, and a box that overlaps need not contain a triangle centroid. Opting
    // in to a no-op keeps that a single readable ops file instead of a
    // bisection.
    if (op.allowEmpty) {
      console.log(`part ${op.part} [${op.mode}]: region matched 0 triangles (allowEmpty)`);
      continue;
    }
    throw new Error(`part ${op.part}: region matched 0 triangles — check coordinates`);
  }

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
    if (op.parent) {
      const parent = json.nodes.find((n) => n.name === op.parent);
      if (!parent) throw new Error(`parent node ${op.parent} not found`);
      parent.children = parent.children || [];
      parent.children.push(newNodeIndex);
    } else {
      json.scenes[0].nodes.push(newNodeIndex);
    }
  }
}

// Reassemble GLB with appended BIN, then drop every bufferView nothing points
// at any more. Re-pointing a primitive orphans its old index view, and on a
// 300k-triangle chassis that is megabytes — clawviper's file grew 23% before
// this pass existed.
let newBin = Buffer.concat([bin, ...appendChunks]);

// Accessors are referenced by INDEX from a handful of known places, so they
// have to be collected by name rather than by walking for a `bufferView` key.
function accessorSlots() {
  const slots = [];
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (typeof prim.indices === "number") slots.push([prim, "indices"]);
      for (const key of Object.keys(prim.attributes || {})) slots.push([prim.attributes, key]);
      for (const target of prim.targets || []) {
        for (const key of Object.keys(target)) slots.push([target, key]);
      }
    }
  }
  for (const skin of json.skins || []) {
    if (typeof skin.inverseBindMatrices === "number") slots.push([skin, "inverseBindMatrices"]);
  }
  for (const animation of json.animations || []) {
    for (const sampler of animation.samplers || []) {
      slots.push([sampler, "input"], [sampler, "output"]);
    }
  }
  return slots;
}
{
  const slots = accessorSlots();
  const live = new Set(slots.map(([holder, key]) => holder[key]));
  if (live.size < json.accessors.length) {
    const remap = new Map();
    const kept = [];
    json.accessors.forEach((accessor, index) => {
      if (!live.has(index)) return;
      remap.set(index, kept.length);
      kept.push(accessor);
    });
    console.log(`compact: dropped ${json.accessors.length - kept.length} orphaned accessor(s)`);
    json.accessors = kept;
    for (const [holder, key] of slots) holder[key] = remap.get(holder[key]);
  }
}

const used = new Set();
(function collect(value) {
  if (Array.isArray(value)) return value.forEach(collect);
  if (!value || typeof value !== "object") return;
  if (typeof value.bufferView === "number") used.add(value.bufferView);
  Object.values(value).forEach(collect);
})(json);
if (used.size < json.bufferViews.length) {
  const chunks = [];
  const remap = new Map();
  const views = [];
  let cursor = 0;
  json.bufferViews.forEach((view, index) => {
    if (!used.has(index)) return;
    const start = view.byteOffset || 0;
    const bytes = newBin.subarray(start, start + view.byteLength);
    const padded = Buffer.concat([bytes, Buffer.alloc(align4(bytes.length) - bytes.length)]);
    remap.set(index, views.length);
    views.push({ ...view, byteOffset: cursor });
    chunks.push(padded);
    cursor += padded.length;
  });
  const dropped = json.bufferViews.length - views.length;
  const savedBytes = newBin.length - cursor;
  json.bufferViews = views;
  (function repoint(value) {
    if (Array.isArray(value)) return value.forEach(repoint);
    if (!value || typeof value !== "object") return;
    if (typeof value.bufferView === "number") value.bufferView = remap.get(value.bufferView);
    Object.values(value).forEach(repoint);
  })(json);
  newBin = Buffer.concat(chunks);
  console.log(`compact: dropped ${dropped} orphaned bufferView(s), ${(savedBytes / 1048576).toFixed(1)}MB`);
}
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
