function vecLengthSq(v) {
  return v.x * v.x + v.y * v.y + v.z * v.z;
}

const CAP_DENT_NORMAL_STRENGTH = 0.72;

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize(v, fallback = { x: 0, y: 1, z: 0 }) {
  const len = Math.sqrt(vecLengthSq(v));
  if (len <= 0.00001) return { ...fallback };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function quantizedVertexKey(position, index) {
  const q = 10000;
  const offset = index * 3;
  return [
    Math.round(position[offset] * q),
    Math.round(position[offset + 1] * q),
    Math.round(position[offset + 2] * q),
  ].join(",");
}

function pushVertex(data, source, index) {
  const posOffset = index * 3;
  data.position.push(source.position[posOffset], source.position[posOffset + 1], source.position[posOffset + 2]);
  if (source.normal) data.normal.push(source.normal[posOffset], source.normal[posOffset + 1], source.normal[posOffset + 2]);
  if (source.uv) {
    const uvOffset = index * 2;
    data.uv.push(source.uv[uvOffset], source.uv[uvOffset + 1]);
  }
}

function pushPoint(data, point, normal = null) {
  data.position.push(point.x, point.y, point.z);
  if (normal) data.normal.push(normal.x, normal.y, normal.z);
}

function pushCapTriangle(data, points, indices, normal) {
  indices.forEach((index) => pushPoint(data, points[index], normal));
}

function pushDoubleSidedCapTriangle(data, points, indices, normal) {
  pushCapTriangle(data, points, indices, normal);
  pushCapTriangle(data, points, [indices[2], indices[1], indices[0]], scale(normal, -1));
}

function pushCurvedCapTriangle(data, vertices, indices, normalSign = 1) {
  indices.forEach((index) => {
    const vertex = vertices[index];
    pushPoint(data, vertex.point, scale(vertex.normal, normalSign));
  });
}

function pushDoubleSidedCurvedCapTriangle(data, vertices, indices, normalSign = 1) {
  pushCurvedCapTriangle(data, vertices, indices, normalSign);
  pushCurvedCapTriangle(data, vertices, [indices[2], indices[1], indices[0]], -normalSign);
}

function clampPointToCapBounds(point, capBounds, { useTopSurface = true } = {}) {
  if (!capBounds) return point;
  // capBounds is the main-thread cake volume in mesh-local coordinates. Clamp
  // generated interior cap samples to keep the solid-fill surface inside the
  // bot; the outer boundary ring remains the actual break loop. The top limit
  // is sampled from the visible mesh shell at this X/Z, not from the single
  // highest point of the mesh bounding box.
  const x = Math.max(capBounds.min.x, Math.min(capBounds.max.x, point.x));
  const z = Math.max(capBounds.min.z, Math.min(capBounds.max.z, point.z));
  const sampledTop = useTopSurface ? capBounds.topSurfaceYAt?.(x, z) : null;
  const maxY = Number.isFinite(sampledTop)
    ? Math.min(capBounds.max.y, Math.max(capBounds.min.y, sampledTop))
    : capBounds.max.y;
  return {
    x,
    y: Math.max(capBounds.min.y, Math.min(maxY, point.y)),
    z,
  };
}

function loopRoofYAtXZ(loop, x, z) {
  if (!loop?.length) return null;
  const samples = loop.map((point) => {
    const dx = point.x - x;
    const dz = point.z - z;
    return { distanceSq: dx * dx + dz * dz, y: point.y };
  }).sort((a, b) => a.distanceSq - b.distanceSq);
  if (samples[0]?.distanceSq < 0.000001) return samples[0].y;
  let weightSum = 0;
  let ySum = 0;
  samples.slice(0, Math.min(8, samples.length)).forEach((sample) => {
    const weight = 1 / Math.max(0.0001, sample.distanceSq);
    weightSum += weight;
    ySum += sample.y * weight;
  });
  return weightSum > 0 ? ySum / weightSum : null;
}

function clampPointToBreakLoopRoof(point, loop) {
  const roofY = loopRoofYAtXZ(loop, point.x, point.z);
  if (!Number.isFinite(roofY)) return point;
  return { ...point, y: Math.min(point.y, roofY) };
}

function dentedCapNormal(point, baseNormal, localPoint, u, v, radius) {
  const safeRadius = Math.max(0.001, radius);
  const offset = sub(point, localPoint);
  const x = dot(offset, u) / safeRadius;
  const y = dot(offset, v) / safeRadius;
  const z = Math.sqrt(vecLengthSq(offset)) / safeRadius;
  const n1 = Math.sin(x * 18.7 + y * 7.9 + z * 5.3)
    + Math.sin(x * -9.4 + y * 21.1 + z * 3.7) * 0.55
    + Math.cos((x + y) * 14.2 - z * 8.1) * 0.35;
  const n2 = Math.cos(x * 11.3 - y * 17.6 + z * 6.9)
    + Math.sin(x * 23.5 + y * 10.8 - z * 4.4) * 0.5
    + Math.cos((x - y) * 16.9 + z * 7.2) * 0.35;
  const gouge = 0.65 + 0.35 * Math.sin(x * 31.0 + y * 27.0 + z * 12.0);
  return normalize(add(
    add(baseNormal, scale(u, n1 * CAP_DENT_NORMAL_STRENGTH * gouge)),
    scale(v, n2 * CAP_DENT_NORMAL_STRENGTH * gouge),
  ), baseNormal);
}

function triangleCentroid(position, tri) {
  const a = tri[0] * 3;
  const b = tri[1] * 3;
  const c = tri[2] * 3;
  return {
    x: (position[a] + position[b] + position[c]) / 3,
    y: (position[a + 1] + position[b + 1] + position[c + 1]) / 3,
    z: (position[a + 2] + position[b + 2] + position[c + 2]) / 3,
  };
}

function pointAt(position, index) {
  const offset = index * 3;
  return { x: position[offset], y: position[offset + 1], z: position[offset + 2] };
}

function barycentricTopYAtXZ(x, z, a, b, c) {
  const v0x = b.x - a.x;
  const v0z = b.z - a.z;
  const v1x = c.x - a.x;
  const v1z = c.z - a.z;
  const v2x = x - a.x;
  const v2z = z - a.z;
  const den = v0x * v1z - v1x * v0z;
  if (Math.abs(den) < 0.0000001) return null;
  const u = (v2x * v1z - v1x * v2z) / den;
  const v = (v0x * v2z - v2x * v0z) / den;
  const w = 1 - u - v;
  const tolerance = 0.0008;
  if (u < -tolerance || v < -tolerance || w < -tolerance) return null;
  return a.y * w + b.y * u + c.y * v;
}

// Worker copy of the cake roof query. It constrains generated cap samples to
// the visible mesh shell at their X/Z position instead of letting them rise to
// the global bounding-box top.
function makeTopSurfaceQuery(source) {
  const position = source?.position;
  if (!position?.length) return null;
  const index = source.index || null;
  const triangleCount = index ? index.length / 3 : position.length / 9;
  const triangles = [];
  const tri = [0, 0, 0];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < triangleCount; i += 1) {
    for (let j = 0; j < 3; j += 1) tri[j] = index ? index[i * 3 + j] : i * 3 + j;
    const a = pointAt(position, tri[0]);
    const b = pointAt(position, tri[1]);
    const c = pointAt(position, tri[2]);
    const xzArea = Math.abs((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z));
    if (xzArea < 0.0000001) continue;
    const triangle = {
      a,
      b,
      c,
      minX: Math.min(a.x, b.x, c.x),
      maxX: Math.max(a.x, b.x, c.x),
      minZ: Math.min(a.z, b.z, c.z),
      maxZ: Math.max(a.z, b.z, c.z),
      centerX: (a.x + b.x + c.x) / 3,
      centerZ: (a.z + b.z + c.z) / 3,
      centerY: (a.y + b.y + c.y) / 3,
    };
    minX = Math.min(minX, triangle.minX);
    maxX = Math.max(maxX, triangle.maxX);
    minZ = Math.min(minZ, triangle.minZ);
    maxZ = Math.max(maxZ, triangle.maxZ);
    triangles.push(triangle);
  }
  if (!triangles.length) return null;
  const divisions = clampNumber(Math.ceil(Math.sqrt(triangles.length) / 2), 8, 44);
  const widthX = Math.max(0.0001, maxX - minX);
  const widthZ = Math.max(0.0001, maxZ - minZ);
  const grid = Array.from({ length: divisions * divisions }, () => []);
  const cellX = (x) => clampNumber(Math.floor(((x - minX) / widthX) * divisions), 0, divisions - 1);
  const cellZ = (z) => clampNumber(Math.floor(((z - minZ) / widthZ) * divisions), 0, divisions - 1);
  const cellIndex = (x, z) => z * divisions + x;
  triangles.forEach((triangle) => {
    const x0 = cellX(triangle.minX);
    const x1 = cellX(triangle.maxX);
    const z0 = cellZ(triangle.minZ);
    const z1 = cellZ(triangle.maxZ);
    for (let gz = z0; gz <= z1; gz += 1) {
      for (let gx = x0; gx <= x1; gx += 1) grid[cellIndex(gx, gz)].push(triangle);
    }
  });
  const candidatesNear = (x, z, radius = 0) => {
    const cx = cellX(x);
    const cz = cellZ(z);
    const candidates = [];
    const seen = new Set();
    for (let gz = Math.max(0, cz - radius); gz <= Math.min(divisions - 1, cz + radius); gz += 1) {
      for (let gx = Math.max(0, cx - radius); gx <= Math.min(divisions - 1, cx + radius); gx += 1) {
        grid[cellIndex(gx, gz)].forEach((triangle) => {
          if (seen.has(triangle)) return;
          seen.add(triangle);
          candidates.push(triangle);
        });
      }
    }
    return candidates;
  };
  return (x, z) => {
    let top = -Infinity;
    for (let radius = 0; radius <= 1 && !Number.isFinite(top); radius += 1) {
      candidatesNear(x, z, radius).forEach((triangle) => {
        if (x < triangle.minX || x > triangle.maxX || z < triangle.minZ || z > triangle.maxZ) return;
        const y = barycentricTopYAtXZ(x, z, triangle.a, triangle.b, triangle.c);
        if (Number.isFinite(y)) top = Math.max(top, y);
      });
    }
    if (Number.isFinite(top)) return top;

    const nearest = [];
    let interpolationCandidates = [];
    for (let radius = 1; radius <= 4 && interpolationCandidates.length < 6; radius += 1) {
      interpolationCandidates = candidatesNear(x, z, radius);
    }
    if (!interpolationCandidates.length) interpolationCandidates = triangles;
    interpolationCandidates.forEach((triangle) => {
      const dx = triangle.centerX - x;
      const dz = triangle.centerZ - z;
      nearest.push({ distanceSq: dx * dx + dz * dz, y: triangle.centerY });
    });
    nearest.sort((a, b) => a.distanceSq - b.distanceSq);
    let weightSum = 0;
    let ySum = 0;
    nearest.slice(0, 6).forEach((sample) => {
      const weight = 1 / Math.max(0.0001, sample.distanceSq);
      weightSum += weight;
      ySum += sample.y * weight;
    });
    return weightSum > 0 ? ySum / weightSum : null;
  };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v, amount) {
  return { x: v.x * amount, y: v.y * amount, z: v.z * amount };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function toTypedData(data) {
  return {
    position: new Float32Array(data.position),
    normal: data.normal.length ? new Float32Array(data.normal) : null,
    uv: data.uv.length ? new Float32Array(data.uv) : null,
  };
}

function transferForPayload(payload) {
  return [
    payload.remaining.position.buffer,
    payload.piece.position.buffer,
    ...(payload.remaining.normal ? [payload.remaining.normal.buffer] : []),
    ...(payload.piece.normal ? [payload.piece.normal.buffer] : []),
    ...(payload.remaining.uv ? [payload.remaining.uv.buffer] : []),
    ...(payload.piece.uv ? [payload.piece.uv.buffer] : []),
    ...(payload.remainingCap?.position ? [payload.remainingCap.position.buffer] : []),
    ...(payload.remainingCap?.normal ? [payload.remainingCap.normal.buffer] : []),
    ...(payload.remainingCap?.uv ? [payload.remainingCap.uv.buffer] : []),
    ...(payload.pieceCap?.position ? [payload.pieceCap.position.buffer] : []),
    ...(payload.pieceCap?.normal ? [payload.pieceCap.normal.buffer] : []),
    ...(payload.pieceCap?.uv ? [payload.pieceCap.uv.buffer] : []),
  ];
}

function capProjectionBasis(normal) {
  const tangentSeed = Math.abs(normal.y) < 0.82 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = normalize(cross(tangentSeed, normal), { x: 1, y: 0, z: 0 });
  const v = normalize(cross(normal, u), { x: 0, y: 0, z: 1 });
  return { u, v };
}

function signedArea2(points) {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area * 0.5;
}

function pointInTriangle2(point, a, b, c) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const cax = a.x - c.x;
  const cay = a.y - c.y;
  const apx = point.x - a.x;
  const apy = point.y - a.y;
  const bpx = point.x - b.x;
  const bpy = point.y - b.y;
  const cpx = point.x - c.x;
  const cpy = point.y - c.y;
  const c1 = abx * apy - aby * apx;
  const c2 = bcx * bpy - bcy * bpx;
  const c3 = cax * cpy - cay * cpx;
  return c1 >= -0.000001 && c2 >= -0.000001 && c3 >= -0.000001;
}

function triangulateLoop2(points) {
  if (points.length < 3) return [];
  const indices = points.map((_, index) => index);
  const triangles = [];
  let guard = points.length * points.length;
  while (indices.length > 3 && guard > 0) {
    guard -= 1;
    let clipped = false;
    for (let i = 0; i < indices.length; i += 1) {
      const previous = indices[(i - 1 + indices.length) % indices.length];
      const current = indices[i];
      const next = indices[(i + 1) % indices.length];
      const a = points[previous];
      const b = points[current];
      const c = points[next];
      const cross2 = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (cross2 <= 0.000001) continue;
      let contains = false;
      for (let j = 0; j < indices.length; j += 1) {
        const candidate = indices[j];
        if (candidate === previous || candidate === current || candidate === next) continue;
        if (pointInTriangle2(points[candidate], a, b, c)) {
          contains = true;
          break;
        }
      }
      if (contains) continue;
      triangles.push([previous, current, next]);
      indices.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (indices.length === 3) triangles.push([indices[0], indices[1], indices[2]]);
  return triangles;
}

function orderedBoundaryLoops(boundary, position) {
  const vertices = new Map();
  const adjacency = new Map();
  const edgeKeys = [];
  const addVertex = (index) => {
    const key = quantizedVertexKey(position, index);
    if (!vertices.has(key)) vertices.set(key, pointAt(position, index));
    if (!adjacency.has(key)) adjacency.set(key, []);
    return key;
  };
  boundary.forEach((edge) => {
    if (!edge.selectedCount || !edge.remainingCount) return;
    const a = addVertex(edge.a);
    const b = addVertex(edge.b);
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (edgeKeys.includes(key)) return;
    edgeKeys.push(key);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  });

  const unused = new Set(edgeKeys);
  const loops = [];
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const takeEdge = (a, b) => unused.delete(edgeKey(a, b));
  while (unused.size) {
    const [startA, startB] = [...unused][0].split("|");
    const loop = [startA];
    let previous = startA;
    let current = startB;
    takeEdge(startA, startB);
    let guard = edgeKeys.length + 4;
    while (guard > 0) {
      guard -= 1;
      loop.push(current);
      if (current === startA) break;
      const next = (adjacency.get(current) || []).find((candidate) => candidate !== previous && unused.has(edgeKey(current, candidate)))
        || (adjacency.get(current) || []).find((candidate) => unused.has(edgeKey(current, candidate)));
      if (!next) break;
      takeEdge(current, next);
      previous = current;
      current = next;
    }
    if (loop[loop.length - 1] === startA) loop.pop();
    const uniqueLoop = loop.filter((key, index) => loop.indexOf(key) === index);
    if (uniqueLoop.length >= 3) loops.push(uniqueLoop.map((key) => vertices.get(key)));
  }
  return loops;
}

function buildSphericalCapFromLoop({ loop, hitNormal, localPoint, radius, capBounds, remainingCap, pieceCap }) {
  if (loop.length < 3 || radius <= 0.001) return false;
  const basis = capProjectionBasis(hitNormal);
  const centerU = dot(localPoint, basis.u);
  const centerV = dot(localPoint, basis.v);
  const useLoopRoof = Math.abs(hitNormal.y) > 0.2;
  const depthDirection = hitNormal.y < -0.2 ? hitNormal : scale(hitNormal, -1);
  const ringCount = Math.max(5, Math.min(10, Math.ceil(loop.length / 10)));
  const makeVertex = (point) => ({
    point,
    normal: dentedCapNormal(point, normalize(sub(point, localPoint), scale(hitNormal, -1)), localPoint, basis.u, basis.v, radius),
  });
  const rings = [[makeVertex(clampPointToCapBounds(
    useLoopRoof
      ? clampPointToBreakLoopRoof(add(localPoint, scale(depthDirection, radius)), loop)
      : add(localPoint, scale(depthDirection, radius)),
    capBounds,
    { useTopSurface: !useLoopRoof },
  ))]];
  for (let ring = 1; ring <= ringCount; ring += 1) {
    const t = ring / ringCount;
    rings.push(loop.map((boundaryPoint) => {
      if (ring === ringCount) return makeVertex({ ...boundaryPoint });
      const lateralU = (dot(boundaryPoint, basis.u) - centerU) * t;
      const lateralV = (dot(boundaryPoint, basis.v) - centerV) * t;
      const lateralDistance = Math.hypot(lateralU, lateralV);
      const clampedDistance = Math.min(radius, lateralDistance);
      const depth = Math.sqrt(Math.max(0, radius * radius - clampedDistance * clampedDistance));
      const capPoint = add(
        add(add(localPoint, scale(basis.u, lateralU)), scale(basis.v, lateralV)),
        scale(depthDirection, depth),
      );
      return makeVertex(clampPointToCapBounds(
        useLoopRoof ? clampPointToBreakLoopRoof(capPoint, loop) : capPoint,
        capBounds,
        { useTopSurface: !useLoopRoof },
      ));
    }));
  }
  const firstRing = rings[1];
  const center = rings[0][0];
  for (let i = 0; i < firstRing.length; i += 1) {
    const next = (i + 1) % firstRing.length;
    const tri = [center, firstRing[i], firstRing[next]];
    pushDoubleSidedCurvedCapTriangle(pieceCap, tri, [0, 1, 2], 1);
    pushDoubleSidedCurvedCapTriangle(remainingCap, tri, [2, 1, 0], -1);
  }
  for (let ring = 2; ring < rings.length; ring += 1) {
    const previous = rings[ring - 1];
    const current = rings[ring];
    for (let i = 0; i < current.length; i += 1) {
      const next = (i + 1) % current.length;
      const quad = [previous[i], previous[next], current[next], current[i]];
      pushDoubleSidedCurvedCapTriangle(pieceCap, quad, [0, 1, 2], 1);
      pushDoubleSidedCurvedCapTriangle(pieceCap, quad, [0, 2, 3], 1);
      pushDoubleSidedCurvedCapTriangle(remainingCap, quad, [2, 1, 0], -1);
      pushDoubleSidedCurvedCapTriangle(remainingCap, quad, [3, 2, 0], -1);
    }
  }
  return true;
}

function buildCapData(boundary, position, hitNormal, localPoint, radius, capBounds) {
  const remainingCap = { position: [], normal: [], uv: [] };
  const pieceCap = { position: [], normal: [], uv: [] };
  const basis = capProjectionBasis(hitNormal);
  const loops = orderedBoundaryLoops(boundary, position);
  loops.forEach((loop) => {
    if (localPoint && buildSphericalCapFromLoop({
      loop,
      hitNormal,
      localPoint,
      radius: Math.max(0.04, radius),
      capBounds,
      remainingCap,
      pieceCap,
    })) return;
    const projected = loop.map((point) => ({ x: dot(point, basis.u), y: dot(point, basis.v) }));
    if (Math.abs(signedArea2(projected)) < 0.000001) return;
    let points = loop;
    let points2 = projected;
    if (signedArea2(points2) < 0) {
      points = [...points].reverse();
      points2 = [...points2].reverse();
    }
    const triangles = triangulateLoop2(points2);
    triangles.forEach((tri) => {
      pushDoubleSidedCapTriangle(pieceCap, points, tri, hitNormal);
      pushDoubleSidedCapTriangle(remainingCap, points, [tri[2], tri[1], tri[0]], scale(hitNormal, -1));
    });
  });
  if (!pieceCap.position.length) {
    const center = { x: 0, y: 0, z: 0 };
    let count = 0;
    boundary.forEach((edge) => {
      if (!edge.selectedCount || !edge.remainingCount) return;
      const a = pointAt(position, edge.a);
      const b = pointAt(position, edge.b);
      center.x += a.x + b.x;
      center.y += a.y + b.y;
      center.z += a.z + b.z;
      count += 2;
    });
    if (count > 0) {
      center.x /= count;
      center.y /= count;
      center.z /= count;
      boundary.forEach((edge) => {
        if (!edge.selectedCount || !edge.remainingCount) return;
        const a = pointAt(position, edge.a);
        const b = pointAt(position, edge.b);
        const inset = add(center, scale(sub(add(a, b), scale(center, 2)), 0.35));
        pushDoubleSidedCapTriangle(pieceCap, [a, b, inset], [0, 1, 2], hitNormal);
        pushDoubleSidedCapTriangle(remainingCap, [b, a, inset], [0, 1, 2], scale(hitNormal, -1));
      });
    }
  }
  return { remainingCap, pieceCap, loopCount: loops.length };
}

function absorbLocalThreadTriangles(selected, position, index, triangleCount, { localPoint, radius }) {
  // Prevent local visual slivers after a break without building full mesh
  // connectivity. Only triangles near the hit and mostly surrounded by the
  // break selection are folded into the debris.
  const remainingCount = triangleCount - selected.size;
  if (selected.size / Math.max(1, triangleCount) > 0.9 || remainingCount < 96) return;
  const maxSelectable = triangleCount - 7;
  const cleanupRadius = Math.max(radius * 2.35, radius + 0.22);
  const tri = [0, 0, 0];
  const edgeKey = (a, b) => {
    const ka = quantizedVertexKey(position, a);
    const kb = quantizedVertexKey(position, b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const selectedEdges = new Set();
  for (let i = 0; i < triangleCount; i += 1) {
    if (!selected.has(i)) continue;
    for (let j = 0; j < 3; j += 1) tri[j] = index ? index[i * 3 + j] : i * 3 + j;
    selectedEdges.add(edgeKey(tri[0], tri[1]));
    selectedEdges.add(edgeKey(tri[1], tri[2]));
    selectedEdges.add(edgeKey(tri[2], tri[0]));
  }

  const maxThreadTriangles = Math.max(12, Math.min(500, Math.round(selected.size * 0.012)));
  for (let pass = 0, absorbed = 0; pass < 2 && absorbed < maxThreadTriangles; pass += 1) {
    const nextSelected = [];
    for (let i = 0; i < triangleCount && absorbed + nextSelected.length < maxThreadTriangles; i += 1) {
      if (selected.size + nextSelected.length >= maxSelectable) break;
      if (selected.has(i)) continue;
      for (let j = 0; j < 3; j += 1) tri[j] = index ? index[i * 3 + j] : i * 3 + j;
      const centroid = triangleCentroid(position, tri);
      const dx = centroid.x - localPoint.x;
      const dy = centroid.y - localPoint.y;
      const dz = centroid.z - localPoint.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > cleanupRadius) continue;
      let selectedNeighborCount = 0;
      if (selectedEdges.has(edgeKey(tri[0], tri[1]))) selectedNeighborCount += 1;
      if (selectedEdges.has(edgeKey(tri[1], tri[2]))) selectedNeighborCount += 1;
      if (selectedEdges.has(edgeKey(tri[2], tri[0]))) selectedNeighborCount += 1;
      if (selectedNeighborCount >= 2) nextSelected.push(i);
    }
    if (!nextSelected.length) break;
    nextSelected.forEach((triangleIndex) => {
      selected.add(triangleIndex);
      for (let j = 0; j < 3; j += 1) tri[j] = index ? index[triangleIndex * 3 + j] : triangleIndex * 3 + j;
      selectedEdges.add(edgeKey(tri[0], tri[1]));
      selectedEdges.add(edgeKey(tri[1], tri[2]));
      selectedEdges.add(edgeKey(tri[2], tri[0]));
    });
    absorbed += nextSelected.length;
  }
}

function splitMeshAtHit(source, localPoint, localNormal, options, capBounds = null) {
  const position = source.position;
  const index = source.index;
  const capVolume = capBounds?.useTopSurface
    ? { ...capBounds, topSurfaceYAt: makeTopSurfaceQuery(source) }
    : capBounds;
  const triangleCount = index ? index.length / 3 : position.length / 9;
  const tri = [0, 0, 0];
  const selected = new Set();
  const hitNormal = normalize(localNormal);
  let radius = Math.max(0.08, options.breakRadius);
  const falloff = Math.max(0.05, options.radialFalloff);
  const minPieceTriangles = Math.max(1, options.minPieceTriangles || 18);
  const maxPieceTriangles = Math.max(minPieceTriangles, options.maxPieceTriangles || 55000);

  for (let attempt = 0; attempt < 7; attempt += 1) {
    selected.clear();
    for (let i = 0; i < triangleCount; i += 1) {
      for (let j = 0; j < 3; j += 1) tri[j] = index ? index[i * 3 + j] : i * 3 + j;
      const centroid = triangleCentroid(position, tri);
      const dx = centroid.x - localPoint.x;
      const dy = centroid.y - localPoint.y;
      const dz = centroid.z - localPoint.z;
      const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const dir = distance > 0.00001 ? { x: dx / distance, y: dy / distance, z: dz / distance } : { x: 0, y: 0, z: 0 };
      const directional = Math.max(0, dir.x * hitNormal.x + dir.y * hitNormal.y + dir.z * hitNormal.z);
      const effectiveRadius = radius * (1 + directional * falloff);
      if (distance <= effectiveRadius) selected.add(i);
    }
    if (selected.size <= maxPieceTriangles || radius <= 0.045) break;
    radius *= 0.68;
  }

  if (selected.size < minPieceTriangles) {
    const nearest = [];
    for (let i = 0; i < triangleCount; i += 1) {
      for (let j = 0; j < 3; j += 1) tri[j] = index ? index[i * 3 + j] : i * 3 + j;
      const centroid = triangleCentroid(position, tri);
      const dx = centroid.x - localPoint.x;
      const dy = centroid.y - localPoint.y;
      const dz = centroid.z - localPoint.z;
      nearest.push({ index: i, distance: Math.sqrt(dx * dx + dy * dy + dz * dz) });
    }
    nearest.sort((a, b) => a.distance - b.distance);
    const needed = Math.min(minPieceTriangles, Math.max(0, triangleCount - 7));
    for (let i = 0; i < nearest.length && selected.size < needed; i += 1) selected.add(nearest[i].index);
  }

  absorbLocalThreadTriangles(selected, position, index, triangleCount, { localPoint, radius });

  if (selected.size < minPieceTriangles) {
    return {
      ok: false,
      reason: "too-few-triangles",
      selectedTriangles: selected.size,
      minPieceTriangles,
      triangleCount,
      radius,
    };
  }
  if (selected.size >= triangleCount - 6) {
    return {
      ok: false,
      reason: "whole-mesh-selected",
      selectedTriangles: selected.size,
      triangleCount,
      radius,
    };
  }

  const remaining = { position: [], normal: [], uv: [] };
  const piece = { position: [], normal: [], uv: [] };
  const boundary = new Map();
  const addBoundaryEdge = (a, b, selectedSide) => {
    const ka = quantizedVertexKey(position, a);
    const kb = quantizedVertexKey(position, b);
    const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    const existing = boundary.get(key);
    if (existing) {
      existing.count += 1;
      if (selectedSide) existing.selectedCount += 1;
      else existing.remainingCount += 1;
    } else {
      boundary.set(key, {
        a,
        b,
        count: 1,
        selectedCount: selectedSide ? 1 : 0,
        remainingCount: selectedSide ? 0 : 1,
      });
    }
  };

  for (let i = 0; i < triangleCount; i += 1) {
    for (let j = 0; j < 3; j += 1) tri[j] = index ? index[i * 3 + j] : i * 3 + j;
    const data = selected.has(i) ? piece : remaining;
    tri.forEach((vertexIndex) => pushVertex(data, source, vertexIndex));
    addBoundaryEdge(tri[0], tri[1], selected.has(i));
    addBoundaryEdge(tri[1], tri[2], selected.has(i));
    addBoundaryEdge(tri[2], tri[0], selected.has(i));
  }

  const selectedCenter = { x: 0, y: 0, z: 0 };
  for (let i = 0; i < piece.position.length; i += 3) {
    selectedCenter.x += piece.position[i];
    selectedCenter.y += piece.position[i + 1];
    selectedCenter.z += piece.position[i + 2];
  }
  const divisor = Math.max(3, piece.position.length) / 3;
  selectedCenter.x /= divisor;
  selectedCenter.y /= divisor;
  selectedCenter.z /= divisor;
  const { remainingCap, pieceCap } = options.skipCaps
    ? { remainingCap: { position: [], normal: [], uv: [] }, pieceCap: { position: [], normal: [], uv: [] } }
    : buildCapData(boundary, position, hitNormal, localPoint, radius, capVolume);

  return {
    remaining: toTypedData(remaining),
    piece: toTypedData(piece),
    remainingCap: remainingCap.position.length ? toTypedData(remainingCap) : null,
    pieceCap: pieceCap.position.length ? toTypedData(pieceCap) : null,
    localCenter: selectedCenter,
    triangleCount: selected.size,
  };
}

self.onmessage = (event) => {
  const { id, source, localPoint, localNormal, options, capBounds } = event.data || {};
  try {
    const split = splitMeshAtHit(source, localPoint, localNormal, options, capBounds);
    if (!split || split.ok === false) {
      self.postMessage({ id, ok: false, reason: split?.reason || "split-failed", details: split || null });
      return;
    }
    self.postMessage({ id, ok: true, split }, transferForPayload(split));
  } catch (error) {
    self.postMessage({ id, ok: false, reason: error?.message || String(error) });
  }
};
