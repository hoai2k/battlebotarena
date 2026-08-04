import fs from "node:fs/promises";
import path from "node:path";

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;

const COMPONENT_BYTES = new Map([
  [5120, 1],
  [5121, 1],
  [5122, 2],
  [5123, 2],
  [5125, 4],
  [5126, 4],
]);

const TYPE_COMPONENTS = new Map([
  ["SCALAR", 1],
  ["VEC2", 2],
  ["VEC3", 3],
  ["VEC4", 4],
  ["MAT2", 4],
  ["MAT3", 9],
  ["MAT4", 16],
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function align4(value) {
  return (value + 3) & ~3;
}

function parseGlb(buffer, filePath) {
  assert(buffer.length >= 20, `${filePath}: file is too short to be a GLB`);
  assert(buffer.readUInt32LE(0) === GLB_MAGIC, `${filePath}: invalid GLB magic`);
  assert(buffer.readUInt32LE(4) === 2, `${filePath}: only GLB version 2 is supported`);
  assert(buffer.readUInt32LE(8) === buffer.length, `${filePath}: declared GLB length does not match file size`);

  let json = null;
  let bin = null;
  for (let offset = 12; offset < buffer.length;) {
    const byteLength = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const data = buffer.subarray(offset + 8, offset + 8 + byteLength);
    if (type === JSON_CHUNK) json = JSON.parse(data.toString("utf8"));
    if (type === BIN_CHUNK) bin = data;
    offset += 8 + byteLength;
  }

  assert(json, `${filePath}: missing JSON chunk`);
  assert(bin, `${filePath}: missing BIN chunk`);
  assert(json.buffers?.length === 1 && !json.buffers[0].uri, `${filePath}: only a single embedded buffer is supported`);
  return { json, bin };
}

function accessorElementInfo(json, bin, accessorIndex) {
  const accessor = json.accessors?.[accessorIndex];
  assert(accessor, `missing accessor ${accessorIndex}`);
  assert(!accessor.sparse, `sparse accessor ${accessorIndex} is not supported`);
  const view = json.bufferViews?.[accessor.bufferView];
  assert(view, `accessor ${accessorIndex} has no bufferView`);
  const componentBytes = COMPONENT_BYTES.get(accessor.componentType);
  const componentCount = TYPE_COMPONENTS.get(accessor.type);
  assert(componentBytes && componentCount, `accessor ${accessorIndex} uses an unsupported component/type combination`);
  const elementBytes = componentBytes * componentCount;
  const stride = view.byteStride || elementBytes;
  assert(stride >= elementBytes, `accessor ${accessorIndex} has an invalid byteStride`);
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0);
  assert(start + Math.max(0, accessor.count - 1) * stride + elementBytes <= bin.length, `accessor ${accessorIndex} exceeds the BIN chunk`);
  return { accessor, view, elementBytes, stride, start };
}

function elementKey(bin, info, vertexIndex) {
  const start = info.start + vertexIndex * info.stride;
  return bin.toString("base64", start, start + info.elementBytes);
}

function compactPrimitive(json, bin, primitive, meshIndex, primitiveIndex, viewData, viewAccessorCounts) {
  if (primitive.indices !== undefined) return null;
  assert((primitive.mode ?? 4) === 4, `mesh ${meshIndex} primitive ${primitiveIndex}: only TRIANGLES primitives can be re-indexed`);
  assert(!primitive.targets?.length, `mesh ${meshIndex} primitive ${primitiveIndex}: morph targets are not supported`);

  const attributes = Object.entries(primitive.attributes || {});
  assert(attributes.length > 0, `mesh ${meshIndex} primitive ${primitiveIndex}: primitive has no attributes`);
  const infos = attributes.map(([semantic, accessorIndex]) => ({
    semantic,
    accessorIndex,
    ...accessorElementInfo(json, bin, accessorIndex),
  }));
  const vertexCount = infos[0].accessor.count;
  infos.forEach((info) => {
    assert(info.accessor.count === vertexCount, `mesh ${meshIndex} primitive ${primitiveIndex}: attribute counts differ`);
    assert(viewAccessorCounts.get(info.accessor.bufferView) === 1, `mesh ${meshIndex} primitive ${primitiveIndex}: shared/interleaved bufferViews are not supported`);
  });

  const uniqueByKey = new Map();
  const uniqueSourceIndices = [];
  const indices = new Uint32Array(vertexCount);
  for (let sourceIndex = 0; sourceIndex < vertexCount; sourceIndex += 1) {
    const key = infos.map((info) => elementKey(bin, info, sourceIndex)).join("|");
    let uniqueIndex = uniqueByKey.get(key);
    if (uniqueIndex === undefined) {
      uniqueIndex = uniqueSourceIndices.length;
      uniqueByKey.set(key, uniqueIndex);
      uniqueSourceIndices.push(sourceIndex);
    }
    indices[sourceIndex] = uniqueIndex;
  }

  infos.forEach((info) => {
    const data = Buffer.allocUnsafe(uniqueSourceIndices.length * info.elementBytes);
    uniqueSourceIndices.forEach((sourceIndex, uniqueIndex) => {
      const sourceStart = info.start + sourceIndex * info.stride;
      bin.copy(data, uniqueIndex * info.elementBytes, sourceStart, sourceStart + info.elementBytes);
    });
    viewData[info.accessor.bufferView] = data;
    info.view.byteLength = data.length;
    info.view.byteStride = info.elementBytes;
    info.view.target = ARRAY_BUFFER;
    info.accessor.byteOffset = 0;
    info.accessor.count = uniqueSourceIndices.length;
  });

  const indexData = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);
  const indexViewIndex = json.bufferViews.length;
  json.bufferViews.push({
    buffer: 0,
    byteLength: indexData.length,
    target: ELEMENT_ARRAY_BUFFER,
  });
  viewData.push(indexData);
  const indexAccessorIndex = json.accessors.length;
  json.accessors.push({
    bufferView: indexViewIndex,
    byteOffset: 0,
    componentType: 5125,
    count: vertexCount,
    max: [uniqueSourceIndices.length - 1],
    min: [0],
    type: "SCALAR",
  });
  primitive.indices = indexAccessorIndex;

  return {
    mesh: meshIndex,
    primitive: primitiveIndex,
    sourceVertices: vertexCount,
    uniqueVertices: uniqueSourceIndices.length,
    triangles: vertexCount / 3,
  };
}

function writeGlb(json, viewData) {
  const binaryChunks = [];
  let binaryLength = 0;
  json.bufferViews.forEach((view, index) => {
    const data = viewData[index];
    assert(data, `missing data for bufferView ${index}`);
    const alignedOffset = align4(binaryLength);
    if (alignedOffset > binaryLength) binaryChunks.push(Buffer.alloc(alignedOffset - binaryLength));
    binaryLength = alignedOffset;
    view.buffer = 0;
    view.byteOffset = binaryLength;
    view.byteLength = data.length;
    binaryChunks.push(data);
    binaryLength += data.length;
  });
  const paddedBinaryLength = align4(binaryLength);
  if (paddedBinaryLength > binaryLength) binaryChunks.push(Buffer.alloc(paddedBinaryLength - binaryLength));
  json.buffers[0].byteLength = paddedBinaryLength;

  const binary = Buffer.concat(binaryChunks, paddedBinaryLength);
  const jsonData = Buffer.from(JSON.stringify(json));
  const paddedJsonLength = align4(jsonData.length);
  const jsonChunk = Buffer.alloc(paddedJsonLength, 0x20);
  jsonData.copy(jsonChunk);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binary.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(GLB_MAGIC, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.writeUInt32LE(JSON_CHUNK, 4);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binary.length, 0);
  binHeader.writeUInt32LE(BIN_CHUNK, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binary], totalLength);
}

async function optimize(inputPath, outputPath) {
  const input = await fs.readFile(inputPath);
  const { json, bin } = parseGlb(input, inputPath);
  const viewData = (json.bufferViews || []).map((view) => Buffer.from(bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength)));
  const viewAccessorCounts = new Map();
  (json.accessors || []).forEach((accessor) => {
    if (accessor.bufferView === undefined) return;
    viewAccessorCounts.set(accessor.bufferView, (viewAccessorCounts.get(accessor.bufferView) || 0) + 1);
  });

  const primitives = [];
  (json.meshes || []).forEach((mesh, meshIndex) => {
    (mesh.primitives || []).forEach((primitive, primitiveIndex) => {
      const result = compactPrimitive(json, bin, primitive, meshIndex, primitiveIndex, viewData, viewAccessorCounts);
      if (result) primitives.push(result);
    });
  });
  assert(primitives.length > 0, `${inputPath}: no non-indexed TRIANGLES primitives were found`);

  const output = writeGlb(json, viewData);
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });
  const temporaryPath = path.join(outputDir, `.${path.basename(outputPath)}.${process.pid}.tmp`);
  await fs.writeFile(temporaryPath, output);
  await fs.rename(temporaryPath, outputPath);
  return {
    input: inputPath,
    output: outputPath,
    beforeBytes: input.length,
    afterBytes: output.length,
    savedBytes: input.length - output.length,
    savedPercent: Number((((input.length - output.length) / input.length) * 100).toFixed(2)),
    primitives,
  };
}

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("Usage: node tools/reindex-glb.mjs <input.glb> <output.glb>");
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(await optimize(inputPath, outputPath), null, 2));
}
