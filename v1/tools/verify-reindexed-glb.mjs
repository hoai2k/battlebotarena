import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import zlib from "node:zlib";

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const COMPONENT_BYTES = new Map([[5120, 1], [5121, 1], [5122, 2], [5123, 2], [5125, 4], [5126, 4]]);
const TYPE_COMPONENTS = new Map([["SCALAR", 1], ["VEC2", 2], ["VEC3", 3], ["VEC4", 4], ["MAT2", 4], ["MAT3", 9], ["MAT4", 16]]);

async function readAsset(filePath) {
  const data = await fs.readFile(filePath);
  const buffer = filePath.endsWith(".gz") ? zlib.gunzipSync(data) : data;
  assert.equal(buffer.readUInt32LE(0), GLB_MAGIC, `${filePath}: invalid GLB magic`);
  assert.equal(buffer.readUInt32LE(8), buffer.length, `${filePath}: invalid declared length`);
  let json;
  let bin;
  for (let offset = 12; offset < buffer.length;) {
    const byteLength = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const chunk = buffer.subarray(offset + 8, offset + 8 + byteLength);
    if (type === JSON_CHUNK) json = JSON.parse(chunk.toString("utf8"));
    if (type === BIN_CHUNK) bin = chunk;
    offset += 8 + byteLength;
  }
  assert(json && bin, `${filePath}: incomplete GLB`);
  return { filePath, compressedBytes: data.length, glbBytes: buffer.length, json, bin };
}

function accessorInfo(asset, accessorIndex) {
  const accessor = asset.json.accessors[accessorIndex];
  const view = asset.json.bufferViews[accessor.bufferView];
  const elementBytes = COMPONENT_BYTES.get(accessor.componentType) * TYPE_COMPONENTS.get(accessor.type);
  return {
    accessor,
    elementBytes,
    stride: view.byteStride || elementBytes,
    start: (view.byteOffset || 0) + (accessor.byteOffset || 0),
  };
}

function readIndex(asset, info, index) {
  const offset = info.start + index * info.stride;
  if (info.accessor.componentType === 5121) return asset.bin.readUInt8(offset);
  if (info.accessor.componentType === 5123) return asset.bin.readUInt16LE(offset);
  if (info.accessor.componentType === 5125) return asset.bin.readUInt32LE(offset);
  throw new Error(`${asset.filePath}: unsupported index component type ${info.accessor.componentType}`);
}

function expandedAttributeHash(asset, primitive, accessorIndex) {
  const attribute = accessorInfo(asset, accessorIndex);
  const index = primitive.indices === undefined ? null : accessorInfo(asset, primitive.indices);
  const expandedCount = index?.accessor.count ?? attribute.accessor.count;
  const blockVertices = 8192;
  const block = Buffer.allocUnsafe(blockVertices * attribute.elementBytes);
  const hash = crypto.createHash("sha256");
  for (let base = 0; base < expandedCount; base += blockVertices) {
    const count = Math.min(blockVertices, expandedCount - base);
    for (let i = 0; i < count; i += 1) {
      const expandedIndex = base + i;
      const sourceIndex = index ? readIndex(asset, index, expandedIndex) : expandedIndex;
      const sourceStart = attribute.start + sourceIndex * attribute.stride;
      asset.bin.copy(block, i * attribute.elementBytes, sourceStart, sourceStart + attribute.elementBytes);
    }
    hash.update(block.subarray(0, count * attribute.elementBytes));
  }
  return { expandedCount, sha256: hash.digest("hex") };
}

function normalizeStructuralJson(json) {
  const copy = structuredClone(json);
  delete copy.accessors;
  delete copy.bufferViews;
  delete copy.buffers;
  (copy.meshes || []).forEach((mesh) => {
    (mesh.primitives || []).forEach((primitive) => delete primitive.indices);
  });
  return copy;
}

function imageHash(asset, image) {
  const view = asset.json.bufferViews[image.bufferView];
  const start = view.byteOffset || 0;
  return crypto.createHash("sha256").update(asset.bin.subarray(start, start + view.byteLength)).digest("hex");
}

function comparableAccessor(accessor) {
  const copy = structuredClone(accessor);
  delete copy.bufferView;
  delete copy.byteOffset;
  delete copy.count;
  return copy;
}

function verify(source, target) {
  assert.deepEqual(normalizeStructuralJson(target.json), normalizeStructuralJson(source.json), "non-geometry GLB structure changed");
  assert.equal(target.json.meshes.length, source.json.meshes.length, "mesh count changed");
  assert.equal(target.json.images?.length || 0, source.json.images?.length || 0, "image count changed");

  const primitives = [];
  source.json.meshes.forEach((sourceMesh, meshIndex) => {
    const targetMesh = target.json.meshes[meshIndex];
    assert.equal(targetMesh.primitives.length, sourceMesh.primitives.length, `mesh ${meshIndex}: primitive count changed`);
    sourceMesh.primitives.forEach((sourcePrimitive, primitiveIndex) => {
      const targetPrimitive = targetMesh.primitives[primitiveIndex];
      assert.notEqual(targetPrimitive.indices, undefined, `mesh ${meshIndex} primitive ${primitiveIndex}: output is not indexed`);
      assert.deepEqual(Object.keys(targetPrimitive.attributes).sort(), Object.keys(sourcePrimitive.attributes).sort(), `mesh ${meshIndex} primitive ${primitiveIndex}: attributes changed`);
      const attributes = {};
      Object.entries(sourcePrimitive.attributes).forEach(([semantic, sourceAccessorIndex]) => {
        const targetAccessorIndex = targetPrimitive.attributes[semantic];
        const sourceAccessor = source.json.accessors[sourceAccessorIndex];
        const targetAccessor = target.json.accessors[targetAccessorIndex];
        assert.deepEqual(comparableAccessor(targetAccessor), comparableAccessor(sourceAccessor), `mesh ${meshIndex} primitive ${primitiveIndex} ${semantic}: accessor metadata changed`);
        const sourceHash = expandedAttributeHash(source, sourcePrimitive, sourceAccessorIndex);
        const targetHash = expandedAttributeHash(target, targetPrimitive, targetAccessorIndex);
        assert.deepEqual(targetHash, sourceHash, `mesh ${meshIndex} primitive ${primitiveIndex} ${semantic}: expanded data changed`);
        attributes[semantic] = sourceHash.sha256;
      });
      const sourcePosition = expandedAttributeHash(source, sourcePrimitive, sourcePrimitive.attributes.POSITION);
      const targetIndex = accessorInfo(target, targetPrimitive.indices).accessor;
      assert.equal(targetIndex.count, sourcePosition.expandedCount, `mesh ${meshIndex} primitive ${primitiveIndex}: index count changed`);
      primitives.push({
        mesh: meshIndex,
        primitive: primitiveIndex,
        triangles: sourcePosition.expandedCount / 3,
        sourceVertices: source.json.accessors[sourcePrimitive.attributes.POSITION].count,
        indexedVertices: target.json.accessors[targetPrimitive.attributes.POSITION].count,
        attributes,
      });
    });
  });

  const images = (source.json.images || []).map((sourceImage, index) => {
    const targetImage = target.json.images[index];
    const sourceSha256 = imageHash(source, sourceImage);
    const targetSha256 = imageHash(target, targetImage);
    assert.equal(targetSha256, sourceSha256, `image ${index}: embedded bytes changed`);
    return { index, mimeType: sourceImage.mimeType, sha256: sourceSha256 };
  });

  return {
    source: source.filePath,
    target: target.filePath,
    sourceGlbBytes: source.glbBytes,
    targetGlbBytes: target.glbBytes,
    below25MB: target.glbBytes < 25_000_000,
    primitives,
    images,
  };
}

const [sourcePath, targetPath] = process.argv.slice(2);
if (!sourcePath || !targetPath) {
  console.error("Usage: node tools/verify-reindexed-glb.mjs <source.glb[.gz]> <target.glb>");
  process.exitCode = 1;
} else {
  const source = await readAsset(sourcePath);
  const target = await readAsset(targetPath);
  const report = verify(source, target);
  assert(report.below25MB, `${targetPath}: optimized file is not below 25,000,000 bytes`);
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
}
