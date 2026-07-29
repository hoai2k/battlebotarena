// Re-encode a GLB's metallicRoughness textures from PNG to JPEG.
//
// Why only metallicRoughness: baseColor and normal maps are already JPEG in
// these models, and MR maps are smooth non-colour data (roughness in G,
// metalness in B) where JPEG artefacts are not visible on a moving game model.
// Nothing else about the file changes — node names, pivots, extras, geometry
// and UVs are untouched, so game part associations are preserved exactly.
//
// Requires macOS `sips` for the image encode.
//
// Usage: node tools/glb-texture-optimize.mjs <in.glb> <out.glb> [quality=92]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

function align4(v) { return (v + 3) & ~3; }

const [inPath, outPath, qualityArg] = process.argv.slice(2);
if (!outPath) {
  console.error("Usage: node tools/glb-texture-optimize.mjs <in.glb> <out.glb> [quality=92]");
  process.exit(1);
}
const quality = Number(qualityArg || 92);

const buffer = fs.readFileSync(inPath);
if (buffer.toString("utf8", 0, 4) !== "glTF") throw new Error("not a GLB");
const jsonLength = buffer.readUInt32LE(12);
const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).trim());
const binHeader = 20 + align4(jsonLength);
const binLength = buffer.readUInt32LE(binHeader);
const binStart = binHeader + 8;
const bin = buffer.subarray(binStart, binStart + binLength);

// Which images are metallicRoughness?
const mrImages = new Set();
for (const material of json.materials || []) {
  const ref = material.pbrMetallicRoughness?.metallicRoughnessTexture;
  if (!ref) continue;
  const source = json.textures?.[ref.index]?.source;
  if (source !== undefined) mrImages.add(source);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "glbtex-"));
const replacement = new Map(); // image index -> Buffer(jpeg)
let originalBytes = 0;
let newBytes = 0;

for (const index of mrImages) {
  const image = json.images[index];
  if (image?.bufferView === undefined) continue;
  const view = json.bufferViews[image.bufferView];
  const start = (view.byteOffset || 0);
  const data = bin.subarray(start, start + view.byteLength);
  if (data[0] !== 0x89 || data[1] !== 0x50) continue; // already non-PNG
  const src = path.join(tmp, `${index}.png`);
  const dst = path.join(tmp, `${index}.jpg`);
  fs.writeFileSync(src, data);
  execFileSync("sips", ["-s", "format", "jpeg", "-s", "formatOptions", String(quality), src, "--out", dst], { stdio: "ignore" });
  const encoded = fs.readFileSync(dst);
  // Never let a "optimisation" make a texture bigger.
  if (encoded.length < data.length) {
    replacement.set(index, encoded);
    originalBytes += data.length;
    newBytes += encoded.length;
  }
  fs.rmSync(src); fs.rmSync(dst);
}
fs.rmSync(tmp, { recursive: true, force: true });

if (!replacement.size) {
  console.log("no metallicRoughness PNGs to convert");
  fs.copyFileSync(inPath, outPath);
  process.exit(0);
}

// Rebuild the BIN with replaced image payloads, rewriting every bufferView
// offset (they all shift once one payload changes size).
const chunks = [];
let cursor = 0;
const newViews = json.bufferViews.map((view, viewIndex) => {
  const imageIndex = json.images?.findIndex((img) => img.bufferView === viewIndex) ?? -1;
  const payload = imageIndex >= 0 && replacement.has(imageIndex)
    ? replacement.get(imageIndex)
    : bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength);
  const aligned = align4(cursor);
  if (aligned > cursor) chunks.push(Buffer.alloc(aligned - cursor));
  cursor = aligned;
  chunks.push(payload);
  const rewritten = { ...view, byteOffset: cursor, byteLength: payload.length };
  cursor += payload.length;
  return rewritten;
});
json.bufferViews = newViews;
for (const index of replacement.keys()) json.images[index].mimeType = "image/jpeg";

const newBin = Buffer.concat(chunks);
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
let at = 20 + jsonPadded.length;
out.writeUInt32LE(binPadded.length, at);
out.writeUInt32LE(0x004e4942, at + 4);
binPadded.copy(out, at + 8);
fs.writeFileSync(outPath, out);

const mb = (b) => (b / 1048576).toFixed(2);
console.log(`${outPath}: ${mb(buffer.length)}MB -> ${mb(out.length)}MB (${replacement.size} MR textures, ${mb(originalBytes)}MB -> ${mb(newBytes)}MB at q${quality})`);
