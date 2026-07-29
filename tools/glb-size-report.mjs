// Byte-level breakdown of a GLB: where the size actually goes.
// Usage: node tools/glb-size-report.mjs <file.glb> [...more.glb]
import fs from "node:fs";

function align4(v) { return (v + 3) & ~3; }

function analyze(path) {
  const buffer = fs.readFileSync(path);
  const jsonLength = buffer.readUInt32LE(12);
  const json = JSON.parse(buffer.toString("utf8", 20, 20 + jsonLength).trim());
  const binStart = 20 + align4(jsonLength) + 8;

  const viewBytes = (json.bufferViews || []).map((v) => v.byteLength || 0);
  const total = buffer.length;

  // Classify every bufferView by what references it.
  const imageViews = new Set();
  const indexViews = new Set();
  const attrViews = new Map(); // semantic -> Set(view)
  (json.images || []).forEach((img) => { if (img.bufferView !== undefined) imageViews.add(img.bufferView); });
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.indices !== undefined) {
        const a = json.accessors[prim.indices];
        if (a?.bufferView !== undefined) indexViews.add(a.bufferView);
      }
      for (const [sem, accIdx] of Object.entries(prim.attributes || {})) {
        const a = json.accessors[accIdx];
        if (a?.bufferView === undefined) continue;
        if (!attrViews.has(sem)) attrViews.set(sem, new Set());
        attrViews.get(sem).add(a.bufferView);
      }
    }
  }
  const referenced = new Set([...imageViews, ...indexViews, ...[...attrViews.values()].flatMap((s) => [...s])]);
  const orphanBytes = viewBytes.reduce((sum, b, i) => sum + (referenced.has(i) ? 0 : b), 0);
  const sum = (set) => [...set].reduce((s, i) => s + viewBytes[i], 0);

  // Image details: format + dimensions (PNG/JPEG headers).
  const images = (json.images || []).map((img, i) => {
    const view = json.bufferViews[img.bufferView];
    const start = binStart + (view.byteOffset || 0);
    const bytes = buffer.subarray(start, start + view.byteLength);
    let w = 0, h = 0, kind = img.mimeType || "?";
    if (bytes[0] === 0x89 && bytes[1] === 0x50) {
      kind = "png"; w = bytes.readUInt32BE(16); h = bytes.readUInt32BE(20);
    } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
      kind = "jpeg";
      let p = 2;
      while (p < bytes.length - 9) {
        if (bytes[p] !== 0xff) { p += 1; continue; }
        const marker = bytes[p + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          h = bytes.readUInt16BE(p + 5); w = bytes.readUInt16BE(p + 7); break;
        }
        p += 2 + bytes.readUInt16BE(p + 2);
      }
    }
    return { i, kind, w, h, bytes: view.byteLength };
  });

  // Duplicate image content (identical bytes) still costing space.
  const seen = new Map();
  let dupBytes = 0;
  for (const img of images) {
    const view = json.bufferViews[json.images[img.i].bufferView];
    const start = binStart + (view.byteOffset || 0);
    const key = buffer.subarray(start, start + Math.min(4096, view.byteLength)).toString("base64") + ":" + view.byteLength;
    if (seen.has(key)) dupBytes += view.byteLength;
    else seen.set(key, img.i);
  }

  const attrTotals = [...attrViews.entries()]
    .map(([sem, set]) => [sem, sum(set)])
    .sort((a, b) => b[1] - a[1]);

  const mb = (b) => (b / 1048576).toFixed(2);
  console.log(`\n=== ${path} — ${mb(total)} MB ===`);
  console.log(`  images      ${mb(sum(imageViews)).padStart(6)} MB  (${images.length} images, ${mb(dupBytes)} MB duplicated)`);
  console.log(`  indices     ${mb(sum(indexViews)).padStart(6)} MB`);
  for (const [sem, bytes] of attrTotals) console.log(`  ${sem.padEnd(11)} ${mb(bytes).padStart(6)} MB`);
  console.log(`  orphaned    ${mb(orphanBytes).padStart(6)} MB  (unreferenced bufferViews)`);
  console.log(`  json        ${mb(jsonLength).padStart(6)} MB`);
  const byDim = {};
  for (const img of images) {
    const k = `${img.kind} ${img.w}x${img.h}`;
    byDim[k] = (byDim[k] || 0) + img.bytes;
  }
  console.log("  image mix:", Object.entries(byDim).map(([k, v]) => `${k} → ${mb(v)}MB`).join(", "));
  return { total, images: sum(imageViews), dupBytes, orphanBytes, attrTotals, indices: sum(indexViews) };
}

const paths = process.argv.slice(2);
if (!paths.length) { console.error("Usage: node tools/glb-size-report.mjs <file.glb> [...]"); process.exit(1); }
let grand = { total: 0, images: 0, dup: 0, orphan: 0 };
for (const p of paths) {
  const r = analyze(p);
  grand.total += r.total; grand.images += r.images; grand.dup += r.dupBytes; grand.orphan += r.orphanBytes;
}
if (paths.length > 1) {
  const mb = (b) => (b / 1048576).toFixed(1);
  console.log(`\n=== ALL ${paths.length} FILES: ${mb(grand.total)} MB total | images ${mb(grand.images)} MB | duplicated ${mb(grand.dup)} MB | orphaned ${mb(grand.orphan)} MB ===`);
}
