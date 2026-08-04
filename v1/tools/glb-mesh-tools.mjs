import fs from "node:fs";

function align4(value) {
  return (value + 3) & ~3;
}

function parseGlb(path) {
  const buffer = fs.readFileSync(path);
  if (buffer.toString("utf8", 0, 4) !== "glTF") throw new Error(`${path} is not a GLB`);
  const jsonLength = buffer.readUInt32LE(12);
  const jsonType = buffer.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error("Missing JSON chunk");
  const jsonStart = 20;
  const json = JSON.parse(buffer.toString("utf8", jsonStart, jsonStart + jsonLength).trim());
  const binHeader = jsonStart + align4(jsonLength);
  const binLength = buffer.readUInt32LE(binHeader);
  const binType = buffer.readUInt32LE(binHeader + 4);
  if (binType !== 0x004e4942) throw new Error("Missing BIN chunk");
  const binStart = binHeader + 8;
  return { buffer, json, jsonStart, jsonLength, binStart, binLength };
}

function accessorView(glb, accessorIndex) {
  const accessor = glb.json.accessors[accessorIndex];
  const view = glb.json.bufferViews[accessor.bufferView];
  const byteOffset = glb.binStart + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  return { accessor, view, byteOffset };
}

function getPrimitive(glb) {
  return glb.json.meshes[0].primitives[0];
}

function getPositions(glb) {
  const primitive = getPrimitive(glb);
  const { accessor, byteOffset } = accessorView(glb, primitive.attributes.POSITION);
  const positions = [];
  for (let i = 0; i < accessor.count; i += 1) {
    positions.push([
      glb.buffer.readFloatLE(byteOffset + i * 12),
      glb.buffer.readFloatLE(byteOffset + i * 12 + 4),
      glb.buffer.readFloatLE(byteOffset + i * 12 + 8),
    ]);
  }
  return positions;
}

function getIndices(glb) {
  const primitive = getPrimitive(glb);
  const { accessor, byteOffset } = accessorView(glb, primitive.indices);
  const indices = [];
  const bytes = accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : 1;
  for (let i = 0; i < accessor.count; i += 1) {
    const offset = byteOffset + i * bytes;
    indices.push(bytes === 4 ? glb.buffer.readUInt32LE(offset) : bytes === 2 ? glb.buffer.readUInt16LE(offset) : glb.buffer.readUInt8(offset));
  }
  return indices;
}

function writeAccessorMinMax(glb, accessorIndex) {
  const primitive = getPrimitive(glb);
  const { accessor, byteOffset } = accessorView(glb, accessorIndex);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < accessor.count; i += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = glb.buffer.readFloatLE(byteOffset + i * 12 + axis * 4);
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }
  glb.json.accessors[accessorIndex].min = min;
  glb.json.accessors[accessorIndex].max = max;
  return primitive;
}

function rewriteJsonChunk(glb, outPath) {
  let jsonBytes = Buffer.from(JSON.stringify(glb.json));
  const paddedJsonLength = align4(jsonBytes.length);
  if (jsonBytes.length < paddedJsonLength) jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(paddedJsonLength - jsonBytes.length, 0x20)]);
  const binBytes = glb.buffer.subarray(glb.binStart, glb.binStart + glb.binLength);
  const next = Buffer.alloc(12 + 8 + jsonBytes.length + 8 + binBytes.length);
  next.write("glTF", 0, "utf8");
  next.writeUInt32LE(2, 4);
  next.writeUInt32LE(next.length, 8);
  next.writeUInt32LE(jsonBytes.length, 12);
  next.writeUInt32LE(0x4e4f534a, 16);
  jsonBytes.copy(next, 20);
  const binHeader = 20 + jsonBytes.length;
  next.writeUInt32LE(binBytes.length, binHeader);
  next.writeUInt32LE(0x004e4942, binHeader + 4);
  binBytes.copy(next, binHeader + 8);
  fs.writeFileSync(outPath, next);
}

function rotateY(inPath, outPath, radians) {
  const glb = parseGlb(inPath);
  const primitive = getPrimitive(glb);
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  for (const attributeName of ["POSITION", "NORMAL"]) {
    const accessorIndex = primitive.attributes[attributeName];
    if (accessorIndex === undefined) continue;
    const { accessor, byteOffset } = accessorView(glb, accessorIndex);
    for (let i = 0; i < accessor.count; i += 1) {
      const offset = byteOffset + i * 12;
      const x = glb.buffer.readFloatLE(offset);
      const z = glb.buffer.readFloatLE(offset + 8);
      glb.buffer.writeFloatLE(x * c + z * s, offset);
      glb.buffer.writeFloatLE(-x * s + z * c, offset + 8);
    }
    if (attributeName === "POSITION") writeAccessorMinMax(glb, accessorIndex);
  }
  rewriteJsonChunk(glb, outPath);
}

function rotateXAndGround(inPath, outPath, radians) {
  const glb = parseGlb(inPath);
  const primitive = getPrimitive(glb);
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  let minY = Infinity;
  const positionAccessorIndex = primitive.attributes.POSITION;

  for (const attributeName of ["POSITION", "NORMAL"]) {
    const accessorIndex = primitive.attributes[attributeName];
    if (accessorIndex === undefined) continue;
    const { accessor, byteOffset } = accessorView(glb, accessorIndex);
    for (let i = 0; i < accessor.count; i += 1) {
      const offset = byteOffset + i * 12;
      const y = glb.buffer.readFloatLE(offset + 4);
      const z = glb.buffer.readFloatLE(offset + 8);
      const nextY = y * c - z * s;
      const nextZ = y * s + z * c;
      glb.buffer.writeFloatLE(nextY, offset + 4);
      glb.buffer.writeFloatLE(nextZ, offset + 8);
      if (attributeName === "POSITION") minY = Math.min(minY, nextY);
    }
  }

  if (Number.isFinite(minY)) {
    const { accessor, byteOffset } = accessorView(glb, positionAccessorIndex);
    const groundClearance = 0.000001;
    for (let i = 0; i < accessor.count; i += 1) {
      const offset = byteOffset + i * 12 + 4;
      glb.buffer.writeFloatLE(glb.buffer.readFloatLE(offset) - minY + groundClearance, offset);
    }
  }
  writeAccessorMinMax(glb, positionAccessorIndex);
  rewriteJsonChunk(glb, outPath);
}

function inspectBounds(path) {
  const glb = parseGlb(path);
  const positions = getPositions(glb);
  const indices = getIndices(glb);
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (const p of positions) {
    for (let axis = 0; axis < 3; axis += 1) {
      bounds.min[axis] = Math.min(bounds.min[axis], p[axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], p[axis]);
    }
  }
  const yBuckets = Array.from({ length: 20 }, () => 0);
  const yRange = bounds.max[1] - bounds.min[1] || 1;
  for (let i = 0; i < indices.length; i += 3) {
    const y = (positions[indices[i]][1] + positions[indices[i + 1]][1] + positions[indices[i + 2]][1]) / 3;
    const bucket = Math.max(0, Math.min(yBuckets.length - 1, Math.floor(((y - bounds.min[1]) / yRange) * yBuckets.length)));
    yBuckets[bucket] += 1;
  }
  console.log(JSON.stringify({ path, vertices: positions.length, triangles: indices.length / 3, bounds, yBuckets }, null, 2));
}

function inspectLowTriangles(path, yFraction = 0.2) {
  const glb = parseGlb(path);
  const positions = getPositions(glb);
  const indices = getIndices(glb);
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (const p of positions) {
    for (let axis = 0; axis < 3; axis += 1) {
      bounds.min[axis] = Math.min(bounds.min[axis], p[axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], p[axis]);
    }
  }
  const threshold = bounds.min[1] + (bounds.max[1] - bounds.min[1]) * yFraction;
  const lowBounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  const buckets = new Map();
  let count = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const c = [0, 0, 0];
    for (const index of [indices[i], indices[i + 1], indices[i + 2]]) {
      c[0] += positions[index][0] / 3;
      c[1] += positions[index][1] / 3;
      c[2] += positions[index][2] / 3;
    }
    if (c[1] >= threshold) continue;
    count += 1;
    for (let axis = 0; axis < 3; axis += 1) {
      lowBounds.min[axis] = Math.min(lowBounds.min[axis], c[axis]);
      lowBounds.max[axis] = Math.max(lowBounds.max[axis], c[axis]);
    }
    const sx = Math.floor(((c[0] - bounds.min[0]) / (bounds.max[0] - bounds.min[0])) * 10);
    const sz = Math.floor(((c[2] - bounds.min[2]) / (bounds.max[2] - bounds.min[2])) * 10);
    const key = `${Math.max(0, Math.min(9, sx))},${Math.max(0, Math.min(9, sz))}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const sortedBuckets = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  console.log(JSON.stringify({ path, yFraction, threshold, lowTriangleCount: count, lowBounds, sortedBuckets }, null, 2));
}

function removeTriangles(inPath, outPath, predicate) {
  const glb = parseGlb(inPath);
  const positions = getPositions(glb);
  const primitive = getPrimitive(glb);
  const indexInfo = accessorView(glb, primitive.indices);
  const indexAccessor = indexInfo.accessor;
  if (indexAccessor.componentType !== 5125) throw new Error("Only uint32 indices are supported for triangle removal");
  let writeIndex = 0;
  let removed = 0;
  const keptVertexIndices = new Set();
  const bounds = {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  };
  for (const p of positions) {
    for (let axis = 0; axis < 3; axis += 1) {
      bounds.min[axis] = Math.min(bounds.min[axis], p[axis]);
      bounds.max[axis] = Math.max(bounds.max[axis], p[axis]);
    }
  }
  for (let i = 0; i < indexAccessor.count; i += 3) {
    const tri = [
      glb.buffer.readUInt32LE(indexInfo.byteOffset + i * 4),
      glb.buffer.readUInt32LE(indexInfo.byteOffset + i * 4 + 4),
      glb.buffer.readUInt32LE(indexInfo.byteOffset + i * 4 + 8),
    ];
    const c = [0, 0, 0];
    for (const index of tri) {
      c[0] += positions[index][0] / 3;
      c[1] += positions[index][1] / 3;
      c[2] += positions[index][2] / 3;
    }
    if (predicate(c, bounds)) {
      removed += 1;
      continue;
    }
    glb.buffer.writeUInt32LE(tri[0], indexInfo.byteOffset + writeIndex * 4);
    glb.buffer.writeUInt32LE(tri[1], indexInfo.byteOffset + writeIndex * 4 + 4);
    glb.buffer.writeUInt32LE(tri[2], indexInfo.byteOffset + writeIndex * 4 + 8);
    tri.forEach((index) => keptVertexIndices.add(index));
    writeIndex += 3;
  }
  const positionInfo = accessorView(glb, primitive.attributes.POSITION);
  const safePoint = [0, bounds.min[1] + (bounds.max[1] - bounds.min[1]) * 0.32, 0];
  for (let i = 0; i < positionInfo.accessor.count; i += 1) {
    if (keptVertexIndices.has(i)) continue;
    glb.buffer.writeFloatLE(safePoint[0], positionInfo.byteOffset + i * 12);
    glb.buffer.writeFloatLE(safePoint[1], positionInfo.byteOffset + i * 12 + 4);
    glb.buffer.writeFloatLE(safePoint[2], positionInfo.byteOffset + i * 12 + 8);
  }
  writeAccessorMinMax(glb, primitive.attributes.POSITION);
  indexAccessor.count = writeIndex;
  indexInfo.view.byteLength = writeIndex * 4;
  rewriteJsonChunk(glb, outPath);
  console.log(JSON.stringify({ inPath, outPath, removedTriangles: removed, keptTriangles: writeIndex / 3 }, null, 2));
}

const [command, inPath, outPath] = process.argv.slice(2);
if (command === "inspect") inspectBounds(inPath);
else if (command === "inspect-low") inspectLowTriangles(inPath, Number(outPath || 0.2));
else if (command === "rotate-y-180") rotateY(inPath, outPath, Math.PI);
else if (command === "rotate-y-deg") rotateY(inPath, outPath, (Number(process.argv[5] || 0) * Math.PI) / 180);
else if (command === "rotate-x-ground-deg") rotateXAndGround(inPath, outPath, (Number(process.argv[5] || 0) * Math.PI) / 180);
else if (command === "remove-minotaur-prop") {
  removeTriangles(inPath, outPath, (c, bounds) => {
    const sx = (c[0] - bounds.min[0]) / (bounds.max[0] - bounds.min[0]);
    const sy = (c[1] - bounds.min[1]) / (bounds.max[1] - bounds.min[1]);
    const sz = (c[2] - bounds.min[2]) / (bounds.max[2] - bounds.min[2]);
    return sy < 0.38 && sx < 0.2 && sz > 0.18 && sz < 0.34;
  });
} else {
  console.error("Usage: node tools/glb-mesh-tools.mjs inspect <file> | rotate-y-180 <in> <out> | rotate-y-deg <in> <out> <deg> | rotate-x-ground-deg <in> <out> <deg> | remove-minotaur-prop <in> <out>");
  process.exit(1);
}
