// Paint a decal off one side of a GLB part's baseColour texture.
//
// Tripo reconstructs a bot from reference photos and mirrors what it sees, so
// single-sided livery ends up on both sides: HUGE's angry eyes are two bolted
// aluminium plates on the FRONT of the frame, but the scan bakes them into the
// texture of the rear faces too. Deleting geometry is not the fix — the decal
// is paint, so the fix is in texture space.
//
// Working directly in the UV atlas is hopeless (Tripo charts are per-triangle
// confetti), so selection happens where the decal is actually legible: an
// orthographic projection of the part along `from`. Dark blobs there are the
// decal, and triangles whose projected pixels are mostly inside a blob get
// their UV footprint masked. Whichever of `from` / `protectFrom` sees more of
// a triangle owns it, so the front copy survives even where a chamfer is
// grazed by both cameras.
//
// Masked texels are repainted from the colour of nearby NON-decal surface in
// 3D, not from neighbouring texels — charts that touch in the atlas come from
// unrelated corners of the part, so an ordinary inpaint just refills the eye
// with whatever ink happened to sit next to it in the atlas.
//
// Optional `flatten` also relaxes the geometry: photogrammetry embosses a
// decal as well as painting it, and a flat texture over a carved outline still
// catches the light. See the flatten pass for why the region is dilated and
// the mesh welded first.
//
// Runs on the shipped GLB (post glb-partition), like glb-texture-optimize.
// Requires `sharp` for the texture decode/encode: npm i --no-save sharp
//
// Debug output (pass a directory): view-from / view-protect are what each
// camera sees, selection is view-from with the chosen triangles in red, and
// image<N>-before/after are the textures. They are written before the "nothing
// selected" bail-out, so a miss can be diagnosed from the same run.
//
// Usage: node tools/glb-erase-decal.mjs <in.glb> <out.glb> <ops.json> [debugDir]
// ops.json:
//   { "parts": [3, 7],          // tripo_part_N whose texture to repaint
//     "from": "-x",             // view the decal is erased on
//     "protectFrom": "+x",      // view whose surfaces must be left alone
//     "resolution": 1200,       // projection raster size
//     "maxLuma": 70,            // 0-255; darker than this is decal ink
//     "minBlobPixels": 300,     // ignore rivets/panel lines/shadow specks
//     "blobCoverage": 0.5,      // fraction of a triangle that must be blob
//     "maskPad": 1,             // texels of halo (JPEG smears past the chart)
//     "donorCell": 0.02,        // repaint search radius, model units
//     "jpegQuality": 92,
//     "flatten": { "iterations": 14, "lambda": 0.55, "dilate": 3 } }
import fs from "node:fs";
import sharp from "sharp";

function align4(value) {
  return (value + 3) & ~3;
}

const [inPath, outPath, opsPath, debugDir] = process.argv.slice(2);
if (!opsPath) {
  console.error("Usage: node tools/glb-erase-decal.mjs <in.glb> <out.glb> <ops.json> [debugDir]");
  process.exit(1);
}
const ops = JSON.parse(fs.readFileSync(opsPath, "utf8"));
const RES = ops.resolution || 1200;
const MAX_LUMA = ops.maxLuma ?? 70;
const MIN_BLOB = ops.minBlobPixels ?? 300;
const QUALITY = ops.jpegQuality ?? 92;

const buffer = fs.readFileSync(inPath);
if (buffer.toString("utf8", 0, 4) !== "glTF") throw new Error("not a GLB");
const jsonLength = buffer.readUInt32LE(12);
const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).trim());
const binHeader = 20 + align4(jsonLength);
const binLength = buffer.readUInt32LE(binHeader);
const bin = buffer.subarray(binHeader + 8, binHeader + 8 + binLength);

function readAccessor(index, comps) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  const size = { 5126: 4, 5125: 4, 5123: 2, 5121: 1 }[accessor.componentType];
  const stride = view.byteStride || comps * size;
  const out = new Float64Array(accessor.count * comps);
  for (let i = 0; i < accessor.count; i += 1) {
    const offset = base + i * stride;
    for (let c = 0; c < comps; c += 1) {
      const at = offset + c * size;
      out[i * comps + c] = accessor.componentType === 5126 ? bin.readFloatLE(at)
        : accessor.componentType === 5125 ? bin.readUInt32LE(at)
        : accessor.componentType === 5123 ? bin.readUInt16LE(at)
        : bin.readUInt8(at);
    }
  }
  return out;
}

// --- Gather triangles -------------------------------------------------------

const textures = new Map(); // image index -> { width, height, channels, data }
const triangles = []; // { p: [3][3], uv: [3][2], image, part, v: [3] }
const meshes = new Map(); // part -> { primitive, translation, position, indices }

for (const part of ops.parts) {
  const node = json.nodes.find((n) => n.name === `tripo_part_${part}`);
  if (!node) throw new Error(`part ${part} not found`);
  const primitive = json.meshes[node.mesh].primitives[0];
  const translation = node.translation || [0, 0, 0];
  const position = readAccessor(primitive.attributes.POSITION, 3);
  const uv = readAccessor(primitive.attributes.TEXCOORD_0, 2);
  const indices = readAccessor(primitive.indices, 1);
  meshes.set(part, { primitive, translation, position, indices });
  const baseColor = json.materials[primitive.material]?.pbrMetallicRoughness?.baseColorTexture;
  if (!baseColor) throw new Error(`part ${part} has no baseColour texture`);
  const image = json.textures[baseColor.index].source;
  if (!textures.has(image)) {
    const view = json.bufferViews[json.images[image].bufferView];
    const bytes = bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
    // eslint-disable-next-line no-await-in-loop
    const raw = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    textures.set(image, {
      width: raw.info.width,
      height: raw.info.height,
      channels: raw.info.channels,
      data: raw.data,
      part,
    });
  }
  for (let i = 0; i < indices.length; i += 3) {
    const corner = (k) => {
      const v = indices[i + k];
      return {
        p: [position[v * 3] + translation[0], position[v * 3 + 1] + translation[1], position[v * 3 + 2] + translation[2]],
        uv: [uv[v * 2], uv[v * 2 + 1]],
      };
    };
    const [a, b, c] = [corner(0), corner(1), corner(2)];
    triangles.push({
      p: [a.p, b.p, c.p],
      uv: [a.uv, b.uv, c.uv],
      image,
      part,
      v: [indices[i], indices[i + 1], indices[i + 2]],
    });
  }
}
console.log(`parts ${ops.parts.join(",")}: ${triangles.length} triangles, ${textures.size} textures`);

// --- Orthographic projection ------------------------------------------------

const AXES = {
  "+x": { depth: 0, sign: -1, u: [2, -1], v: [1, 1] },
  "-x": { depth: 0, sign: 1, u: [2, 1], v: [1, 1] },
  "+z": { depth: 2, sign: -1, u: [0, 1], v: [1, 1] },
  "-z": { depth: 2, sign: 1, u: [0, -1], v: [1, 1] },
};

const bounds = [0, 1, 2].map((k) => {
  let min = Infinity, max = -Infinity;
  for (const t of triangles) for (const p of t.p) { min = Math.min(min, p[k]); max = Math.max(max, p[k]); }
  return [min, max];
});

// `sign` = +1 keeps the nearest surface to -axis, -1 the nearest to +axis; the
// winner per pixel is the one an orthographic camera on that side would see.
function project(axisKey) {
  const axis = AXES[axisKey];
  if (!axis) throw new Error(`unknown view ${axisKey}`);
  const span = Math.max(...[0, 1, 2].map((k) => bounds[k][1] - bounds[k][0]));
  const centre = [0, 1, 2].map((k) => (bounds[k][0] + bounds[k][1]) / 2);
  const scale = (RES - 4) / (span * 1.02);
  const toScreen = (p) => [
    (p[axis.u[0]] * axis.u[1] - centre[axis.u[0]] * axis.u[1]) * scale + RES / 2,
    RES / 2 - (p[axis.v[0]] * axis.v[1] - centre[axis.v[0]] * axis.v[1]) * scale,
  ];
  const depthBuffer = new Float64Array(RES * RES).fill(Infinity);
  const triBuffer = new Int32Array(RES * RES).fill(-1);
  const baryBuffer = new Float64Array(RES * RES * 3);

  triangles.forEach((tri, index) => {
    const s = tri.p.map(toScreen);
    const minX = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0])));
    const maxX = Math.min(RES - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1])));
    const maxY = Math.min(RES - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])));
    const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(area) < 1e-9) return;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((s[1][0] - px) * (s[2][1] - py) - (s[2][0] - px) * (s[1][1] - py)) / area;
        const w1 = ((s[2][0] - px) * (s[0][1] - py) - (s[0][0] - px) * (s[2][1] - py)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const depth = axis.sign * (w0 * tri.p[0][axis.depth] + w1 * tri.p[1][axis.depth] + w2 * tri.p[2][axis.depth]);
        const at = y * RES + x;
        if (depth >= depthBuffer[at]) continue;
        depthBuffer[at] = depth;
        triBuffer[at] = index;
        baryBuffer[at * 3] = w0;
        baryBuffer[at * 3 + 1] = w1;
        baryBuffer[at * 3 + 2] = w2;
      }
    }
  });
  return { triBuffer, baryBuffer };
}

function sampleColour(tri, weights) {
  const texture = textures.get(tri.image);
  let u = 0, v = 0;
  for (let k = 0; k < 3; k += 1) {
    u += weights[k] * tri.uv[k][0];
    v += weights[k] * tri.uv[k][1];
  }
  const x = Math.min(texture.width - 1, Math.max(0, Math.round(u * texture.width - 0.5)));
  const y = Math.min(texture.height - 1, Math.max(0, Math.round(v * texture.height - 0.5)));
  const at = (y * texture.width + x) * texture.channels;
  return [texture.data[at], texture.data[at + 1], texture.data[at + 2]];
}

function sampleLuma(tri, weights) {
  const [r, g, b] = sampleColour(tri, weights);
  return (r + g + b) / 3;
}

const front = project(ops.from || "-x");
const protectView = project(ops.protectFrom || "+x");

// --- Select decal blobs -----------------------------------------------------

const dark = new Uint8Array(RES * RES);
const luma = new Uint8Array(RES * RES);
for (let i = 0; i < RES * RES; i += 1) {
  const index = front.triBuffer[i];
  if (index < 0) continue;
  const value = sampleLuma(triangles[index], front.baryBuffer.subarray(i * 3, i * 3 + 3));
  luma[i] = Math.min(255, value);
  if (value < MAX_LUMA) dark[i] = 1;
}

const blobId = new Int32Array(RES * RES).fill(-1);
const blobSizes = [];
for (let start = 0; start < RES * RES; start += 1) {
  if (!dark[start] || blobId[start] >= 0) continue;
  const id = blobSizes.length;
  const stack = [start];
  blobId[start] = id;
  let size = 0;
  while (stack.length) {
    const at = stack.pop();
    size += 1;
    const x = at % RES, y = (at - x) / RES;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= RES || ny >= RES) continue;
      const next = ny * RES + nx;
      if (!dark[next] || blobId[next] >= 0) continue;
      blobId[next] = id;
      stack.push(next);
    }
  }
  blobSizes.push(size);
}
const keptBlobs = new Set(blobSizes.map((size, id) => (size >= MIN_BLOB ? id : -1)).filter((id) => id >= 0));
console.log(`blobs: ${blobSizes.length}, kept ${keptBlobs.size} (>= ${MIN_BLOB}px): ` +
  blobSizes.filter((s) => s >= MIN_BLOB).sort((a, b) => b - a).join(", "));

// A triangle is decal if most of what the camera sees of it is blob.
const seen = new Int32Array(triangles.length);
const hit = new Int32Array(triangles.length);
for (let i = 0; i < RES * RES; i += 1) {
  const index = front.triBuffer[i];
  if (index < 0) continue;
  seen[index] += 1;
  if (blobId[i] >= 0 && keptBlobs.has(blobId[i])) hit[index] += 1;
}
// A triangle belongs to whichever side shows more of it. Plain "visible from
// the far side at all" over-protects: the chamfers the decal wraps around are
// grazed by both cameras, and protecting them leaves the brow of the eye
// stranded on the face that was supposed to be repainted.
const protectSeen = new Int32Array(triangles.length);
for (let i = 0; i < RES * RES; i += 1) {
  const index = protectView.triBuffer[i];
  if (index >= 0) protectSeen[index] += 1;
}
const protectedTris = new Uint8Array(triangles.length);
for (let i = 0; i < triangles.length; i += 1) {
  if (protectSeen[i] > 0 && protectSeen[i] >= seen[i]) protectedTris[i] = 1;
}
const erase = [];
for (let i = 0; i < triangles.length; i += 1) {
  if (protectedTris[i] || seen[i] < 2) continue;
  if (hit[i] / seen[i] >= (ops.blobCoverage ?? 0.5)) erase.push(i);
}
const eraseSet = new Set(erase);
console.log(`triangles to repaint: ${erase.length}`);
if (debugDir) {
  fs.mkdirSync(debugDir, { recursive: true });
  const plain = Buffer.alloc(RES * RES * 3);
  const view = Buffer.alloc(RES * RES * 3);
  for (const [name, buffers] of [["from", front], ["protect", protectView]]) {
    for (let i = 0; i < RES * RES; i += 1) {
      const index = buffers.triBuffer[i];
      const rgb = index < 0 ? [0, 0, 0] : sampleColour(triangles[index], buffers.baryBuffer.subarray(i * 3, i * 3 + 3));
      const selected = name === "from" && index >= 0 && eraseSet.has(index);
      for (let c = 0; c < 3; c += 1) plain[i * 3 + c] = rgb[c];
      view[i * 3] = selected ? 255 : rgb[0];
      view[i * 3 + 1] = selected ? 0 : rgb[1];
      view[i * 3 + 2] = selected ? 0 : rgb[2];
    }
    await sharp(plain, { raw: { width: RES, height: RES, channels: 3 } }).png().toFile(`${debugDir}/view-${name}.png`);
    if (name === "from") {
      await sharp(view, { raw: { width: RES, height: RES, channels: 3 } }).png().toFile(`${debugDir}/selection.png`);
    }
  }
}

if (!erase.length) throw new Error("no triangles selected — check maxLuma / minBlobPixels / from");

// --- Mask + repaint ---------------------------------------------------------

// pad>0 fills the triangle's bounding box grown by `pad` texels — JPEG smears
// the decal past its own charts, and a Tripo chart is only a few texels wide,
// so the ink has to be chased a little outside the triangle to disappear.
// pad<0 asks for exact coverage, used for the charts that must survive: an
// over-eager protect mask punches the decal's own texels back out of the erase
// mask and leaves the eye showing through in outline.
function rasteriseUV(list, texture, mask, value, pad, positions) {
  for (const index of list) {
    const tri = triangles[index];
    if (tri.image !== texture.image) continue;
    const s = tri.uv.map(([u, v]) => [u * texture.width - 0.5, v * texture.height - 0.5]);
    const grow = Math.max(0, pad);
    const minX = Math.max(0, Math.floor(Math.min(s[0][0], s[1][0], s[2][0])) - grow);
    const maxX = Math.min(texture.width - 1, Math.ceil(Math.max(s[0][0], s[1][0], s[2][0])) + grow);
    const minY = Math.max(0, Math.floor(Math.min(s[0][1], s[1][1], s[2][1])) - grow);
    const maxY = Math.min(texture.height - 1, Math.ceil(Math.max(s[0][1], s[1][1], s[2][1])) + grow);
    const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
    if (Math.abs(area) < 1e-12) continue;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5, py = y + 0.5;
        let w0 = ((s[1][0] - px) * (s[2][1] - py) - (s[2][0] - px) * (s[1][1] - py)) / area;
        let w1 = ((s[2][0] - px) * (s[0][1] - py) - (s[0][0] - px) * (s[2][1] - py)) / area;
        let w2 = 1 - w0 - w1;
        if (pad < 0 && (w0 < 0 || w1 < 0 || w2 < 0)) continue;
        const at = y * texture.width + x;
        mask[at] = value;
        if (!positions) continue;
        // Halo texels land outside the triangle; clamping keeps their surface
        // point on it, which is close enough to pick the same 3D neighbours.
        w0 = Math.max(0, w0); w1 = Math.max(0, w1); w2 = Math.max(0, w2);
        const total = w0 + w1 + w2 || 1;
        for (let c = 0; c < 3; c += 1) {
          positions[at * 3 + c] = (w0 * tri.p[0][c] + w1 * tri.p[1][c] + w2 * tri.p[2][c]) / total;
        }
      }
    }
  }
}

// Donors are the surfaces the repaint should look like: everything the `from`
// camera sees that is NOT decal and not itself ink. Keyed by a coarse spatial
// hash so a texel can find its 3D neighbours without scanning them all.
const CELL = ops.donorCell ?? 0.02;
const donorGrid = new Map();
const cellKey = (p) => `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)},${Math.floor(p[2] / CELL)}`;
let donorCount = 0;
for (let i = 0; i < triangles.length; i += 1) {
  if (eraseSet.has(i) || hit[i] > 0 || seen[i] < 1) continue;
  const tri = triangles[i];
  const rgb = sampleColour(tri, [1 / 3, 1 / 3, 1 / 3]);
  if ((rgb[0] + rgb[1] + rgb[2]) / 3 < MAX_LUMA) continue; // never donate ink
  const centre = [0, 1, 2].map((c) => (tri.p[0][c] + tri.p[1][c] + tri.p[2][c]) / 3);
  const key = cellKey(centre);
  if (!donorGrid.has(key)) donorGrid.set(key, []);
  donorGrid.get(key).push({ centre, rgb });
  donorCount += 1;
}
console.log(`donor triangles: ${donorCount}`);

function donorColour(point) {
  const base = [Math.floor(point[0] / CELL), Math.floor(point[1] / CELL), Math.floor(point[2] / CELL)];
  for (let ring = 1; ring <= 6; ring += 1) {
    const sum = [0, 0, 0];
    let weight = 0;
    for (let dx = -ring; dx <= ring; dx += 1) {
      for (let dy = -ring; dy <= ring; dy += 1) {
        for (let dz = -ring; dz <= ring; dz += 1) {
          const bucket = donorGrid.get(`${base[0] + dx},${base[1] + dy},${base[2] + dz}`);
          if (!bucket) continue;
          for (const donor of bucket) {
            const distance = Math.hypot(
              donor.centre[0] - point[0], donor.centre[1] - point[1], donor.centre[2] - point[2],
            );
            const w = 1 / (distance + CELL * 0.25);
            sum[0] += donor.rgb[0] * w;
            sum[1] += donor.rgb[1] * w;
            sum[2] += donor.rgb[2] * w;
            weight += w;
          }
        }
      }
    }
    if (weight > 0) return [sum[0] / weight, sum[1] / weight, sum[2] / weight];
  }
  return null;
}

const keep = [];
for (let i = 0; i < triangles.length; i += 1) if (protectedTris[i]) keep.push(i);

const replacements = new Map(); // image index -> encoded bytes
for (const [image, texture] of textures) {
  texture.image = image;
  const { width, height, channels, data } = texture;
  const mask = new Uint8Array(width * height);
  const surface = new Float32Array(width * height * 3);
  rasteriseUV(erase, texture, mask, 1, ops.maskPad ?? 1, surface);
  rasteriseUV(keep, texture, mask, 0, -1); // never repaint a texel the far side uses
  const masked = mask.reduce((sum, v) => sum + v, 0);
  console.log(`image ${image} (${width}x${height}): ${masked} texels repainted ` +
    `(${((masked * 100) / mask.length).toFixed(1)}%)`);
  if (!masked) continue;

  // Repaint from 3D neighbours, not from neighbouring texels: charts that touch
  // in the atlas come from unrelated corners of the part, so growing the hole
  // shut in texture space just refills the eye with whatever ink sat next to it.
  const out = Buffer.from(data);
  let orphans = 0;
  for (let at = 0; at < mask.length; at += 1) {
    if (!mask[at]) continue;
    const rgb = donorColour([surface[at * 3], surface[at * 3 + 1], surface[at * 3 + 2]]);
    if (!rgb) { orphans += 1; continue; }
    for (let c = 0; c < 3; c += 1) out[at * channels + c] = Math.round(rgb[c]);
  }
  if (orphans) console.log(`  ${orphans} texels had no donor in range and were left alone`);

  replacements.set(image, await sharp(out, { raw: { width, height, channels } })
    .jpeg({ quality: QUALITY }).toBuffer());
  if (debugDir) {
    fs.mkdirSync(debugDir, { recursive: true });
    await sharp(out, { raw: { width, height, channels } }).png().toFile(`${debugDir}/image${image}-after.png`);
    await sharp(Buffer.from(data), { raw: { width, height, channels } }).png().toFile(`${debugDir}/image${image}-before.png`);
  }
}

// --- Flatten the relief -----------------------------------------------------

// Photogrammetry does not only paint the decal, it embosses it: the eye's
// outline and brow are carved a fraction of a millimetre into the frame, so
// flattening the texture alone leaves a ghost that catches the light. Smooth
// the vertices the decal owns — interior ones only, so the plate's real edges
// and the boundary with untouched geometry stay put — and rebuild their
// normals, which is what actually shades the ghost away.
const flatten = ops.flatten;
const rewrites = new Map(); // accessor index -> Float64Array
if (flatten) {
  const iterations = flatten.iterations ?? 10;
  const lambda = flatten.lambda ?? 0.5;
  for (const [part, mesh] of meshes) {
    const own = triangles
      .map((tri, index) => ({ tri, index }))
      .filter(({ tri }) => tri.part === part);
    const vertexCount = mesh.position.length / 3;

    // UV seams duplicate a vertex per chart, so index adjacency is not surface
    // adjacency: smoothing on it moves each copy independently and tears the
    // mesh open along every seam. Weld by position first and move the copies
    // together.
    const welded = new Int32Array(vertexCount);
    const byPosition = new Map();
    for (let v = 0; v < vertexCount; v += 1) {
      const key = `${Math.round(mesh.position[v * 3] * 1e6)},`
        + `${Math.round(mesh.position[v * 3 + 1] * 1e6)},${Math.round(mesh.position[v * 3 + 2] * 1e6)}`;
      if (!byPosition.has(key)) byPosition.set(key, v);
      welded[v] = byPosition.get(key);
    }

    // The relief's walls are the boundary of the decal region, so a strict
    // "all my triangles are decal" interior test excludes exactly the vertices
    // that form the crease. Grow the region a couple of rings first so the
    // groove ends up inside it.
    const region = new Set(own.filter(({ index }) => eraseSet.has(index)).map(({ index }) => index));
    for (let ring = 0; ring < (flatten.dilate ?? 2); ring += 1) {
      const rim = new Set();
      for (const { tri, index } of own) {
        if (!region.has(index)) continue;
        for (const v of tri.v) rim.add(welded[v]);
      }
      for (const { tri, index } of own) {
        if (region.has(index)) continue;
        if (tri.v.some((v) => rim.has(welded[v]))) region.add(index);
      }
    }

    const incident = new Int32Array(vertexCount);
    const decalIncident = new Int32Array(vertexCount);
    for (const { tri, index } of own) {
      for (const v of tri.v) {
        incident[welded[v]] += 1;
        if (region.has(index)) decalIncident[welded[v]] += 1;
      }
    }
    const interior = new Uint8Array(vertexCount);
    let count = 0;
    for (let v = 0; v < vertexCount; v += 1) {
      if (welded[v] !== v) continue;
      if (incident[v] > 0 && incident[v] === decalIncident[v]) { interior[v] = 1; count += 1; }
    }
    if (!count) { console.log(`part ${part}: no interior decal vertices to flatten`); continue; }

    const neighbours = new Map();
    const link = (a, b) => {
      if (!neighbours.has(a)) neighbours.set(a, new Set());
      neighbours.get(a).add(b);
    };
    for (const { tri } of own) {
      const [a, b, c] = tri.v.map((v) => welded[v]);
      link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b);
    }
    const position = Float64Array.from(mesh.position);
    for (let pass = 0; pass < iterations; pass += 1) {
      const moved = [];
      for (let v = 0; v < vertexCount; v += 1) {
        if (!interior[v]) continue;
        const list = neighbours.get(v);
        if (!list || !list.size) continue;
        const average = [0, 0, 0];
        for (const n of list) for (let c = 0; c < 3; c += 1) average[c] += position[n * 3 + c];
        moved.push([v, [0, 1, 2].map((c) => position[v * 3 + c]
          + lambda * (average[c] / list.size - position[v * 3 + c]))]);
      }
      for (const [v, p] of moved) for (let c = 0; c < 3; c += 1) position[v * 3 + c] = p[c];
      for (let v = 0; v < vertexCount; v += 1) {
        if (welded[v] === v) continue;
        for (let c = 0; c < 3; c += 1) position[v * 3 + c] = position[welded[v] * 3 + c];
      }
    }

    // Rebuild normals for every vertex a moved triangle touches, so the seam
    // between smoothed and untouched geometry does not read as a crease.
    const normal = Float64Array.from(readAccessor(mesh.primitive.attributes.NORMAL, 3));
    const dirty = new Uint8Array(vertexCount);
    const accum = new Float64Array(vertexCount * 3);
    for (const { tri } of own) {
      const [a, b, c] = tri.v.map((v) => welded[v]);
      if (!interior[a] && !interior[b] && !interior[c]) continue;
      for (const v of [a, b, c]) dirty[v] = 1;
    }
    for (const { tri } of own) {
      const [a, b, c] = tri.v.map((v) => welded[v]);
      if (!dirty[a] && !dirty[b] && !dirty[c]) continue;
      const p = (v) => [position[v * 3], position[v * 3 + 1], position[v * 3 + 2]];
      const [A, B, C] = [p(a), p(b), p(c)];
      const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      const e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      // Unnormalised cross product: its length is twice the triangle area, so
      // big triangles pull the averaged normal harder, as they should.
      const n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      for (const v of [a, b, c]) for (let k = 0; k < 3; k += 1) accum[v * 3 + k] += n[k];
    }
    for (let v = 0; v < vertexCount; v += 1) {
      const w = welded[v];
      if (!dirty[w]) continue;
      const length = Math.hypot(accum[w * 3], accum[w * 3 + 1], accum[w * 3 + 2]);
      if (length < 1e-12) continue;
      // Keep the winding-derived normal pointing the same way the scan had it.
      const flip = accum[w * 3] * normal[v * 3] + accum[w * 3 + 1] * normal[v * 3 + 1]
        + accum[w * 3 + 2] * normal[v * 3 + 2] < 0 ? -1 : 1;
      for (let k = 0; k < 3; k += 1) normal[v * 3 + k] = (flip * accum[w * 3 + k]) / length;
    }
    rewrites.set(mesh.primitive.attributes.POSITION, position);
    rewrites.set(mesh.primitive.attributes.NORMAL, normal);
    console.log(`part ${part}: flattened ${count} vertices (${iterations} passes, lambda ${lambda})`);
  }
}

// --- Repoint images and reassemble -----------------------------------------

const appendChunks = [];
let appendOffset = bin.length;
for (const [image, bytes] of replacements) {
  const padded = Buffer.concat([bytes, Buffer.alloc(align4(bytes.length) - bytes.length)]);
  json.images[image].bufferView = json.bufferViews.length;
  json.images[image].mimeType = "image/jpeg";
  json.bufferViews.push({ buffer: 0, byteOffset: appendOffset, byteLength: bytes.length });
  appendChunks.push(padded);
  appendOffset += padded.length;
}
// Smoothed vertex data is the same size as what it replaces, so it goes back
// over the original bytes instead of appending a second copy and orphaning
// 1.3MB of dead buffer inside a model that ships to the browser.
const editableBin = Buffer.from(bin);
for (const [index, values] of rewrites) {
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  if (view.byteStride || view.byteLength !== values.length * 4 || accessor.byteOffset) {
    throw new Error(`accessor ${index} is interleaved or shared; cannot rewrite in place`);
  }
  values.forEach((value, i) => editableBin.writeFloatLE(value, (view.byteOffset || 0) + i * 4));
  if (accessor.min) {
    for (let c = 0; c < 3; c += 1) {
      let min = Infinity, max = -Infinity;
      for (let i = c; i < values.length; i += 3) { min = Math.min(min, values[i]); max = Math.max(max, values[i]); }
      accessor.min[c] = min;
      accessor.max[c] = max;
    }
  }
}

const newBin = Buffer.concat([editableBin, ...appendChunks]);
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
