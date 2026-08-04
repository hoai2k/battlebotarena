import * as THREE from "three";
import { PHYSICAL_DAMAGE_DEFAULTS } from "./gameConfig.js";

export const DEFAULT_PHYSICAL_DAMAGE_OPTIONS = PHYSICAL_DAMAGE_DEFAULTS;

const DAMAGEABLE_VIEWER_PARTS = new Set(["body", "weapon", "wheel"]);
const CAP_DENT_NORMAL_STRENGTH = 0.72;
const PHYSICAL_DAMAGE_PREPARE_TIMEOUT_MS = 30000;
const INACTIVE_PHYSICAL_DAMAGE_STATUSES = new Set(["failed", "superseded", "committed-linked", "cancelled"]);
let nextPhysicalDamageJobId = 1;
let nextPhysicalDamageGroupId = 1;
const physicalDamageJobs = new Map();
const pendingPhysicalDamagePrepares = [];
let physicalDamagePrepareDrainScheduled = false;
const pendingPhysicalDamageHits = [];
let physicalDamageHitDrainScheduled = false;

function finiteVector(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);
}

function quantizedVertexKey(position, index) {
  const q = 10000;
  return [
    Math.round(position.getX(index) * q),
    Math.round(position.getY(index) * q),
    Math.round(position.getZ(index) * q),
  ].join(",");
}

function makeGeometry(data) {
  if (!data?.position?.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(data.position, 3));
  if (data.normal?.length) geometry.setAttribute("normal", new THREE.Float32BufferAttribute(data.normal, 3));
  if (data.uv?.length) geometry.setAttribute("uv", new THREE.Float32BufferAttribute(data.uv, 2));
  if (!data.normal?.length) geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function splitPayloadToGeometries(split) {
  const remainingGeometry = makeGeometry(split.remaining);
  const pieceGeometry = makeGeometry(split.piece);
  if (!remainingGeometry || !pieceGeometry) return null;
  return {
    remainingGeometry,
    pieceGeometry,
    remainingCapGeometry: makeGeometry(split.remainingCap),
    pieceCapGeometry: makeGeometry(split.pieceCap),
    localCenter: new THREE.Vector3(split.localCenter?.x || 0, split.localCenter?.y || 0, split.localCenter?.z || 0),
    triangleCount: split.triangleCount || 0,
  };
}

function snapshotMeshSource(mesh) {
  const geometry = mesh?.geometry;
  const position = geometry?.attributes?.position;
  if (!position?.array || position.itemSize !== 3) return null;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv || geometry.attributes.uv0;
  const source = {
    position: position.array.slice(0),
    normal: normal?.array && normal.itemSize === 3 ? normal.array.slice(0) : null,
    uv: uv?.array && uv.itemSize === 2 ? uv.array.slice(0) : null,
    index: geometry.index?.array ? geometry.index.array.slice(0) : null,
  };
  const transfers = [source.position.buffer];
  if (source.normal) transfers.push(source.normal.buffer);
  if (source.uv) transfers.push(source.uv.buffer);
  if (source.index) transfers.push(source.index.buffer);
  return { source, transfers };
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

// Top of the cake is not the mesh bounding-box max. For each generated cap
// sample, project a ray down in mesh-local Y and use the highest triangle hit
// at that X/Z; if the projection misses inside the shell bounds, interpolate
// from nearby triangle centers so sparse/uneven model topology still gets a
// plausible roof.
function makePhysicalDamageTopSurfaceQuery(geometry) {
  const position = geometry?.attributes?.position;
  if (!position?.array || position.itemSize !== 3) return null;
  const index = geometry.index?.array || null;
  const triangleCount = index ? index.length / 3 : position.count / 3;
  const triangles = [];
  const point = (vertexIndex) => new THREE.Vector3(position.getX(vertexIndex), position.getY(vertexIndex), position.getZ(vertexIndex));
  const tri = [0, 0, 0];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < triangleCount; i += 1) {
    for (let j = 0; j < 3; j += 1) tri[j] = index ? index[i * 3 + j] : i * 3 + j;
    const a = point(tri[0]);
    const b = point(tri[1]);
    const c = point(tri[2]);
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
  const divisions = THREE.MathUtils.clamp(Math.ceil(Math.sqrt(triangles.length) / 2), 8, 44);
  const widthX = Math.max(0.0001, maxX - minX);
  const widthZ = Math.max(0.0001, maxZ - minZ);
  const grid = Array.from({ length: divisions * divisions }, () => []);
  const cellX = (x) => THREE.MathUtils.clamp(Math.floor(((x - minX) / widthX) * divisions), 0, divisions - 1);
  const cellZ = (z) => THREE.MathUtils.clamp(Math.floor(((z - minZ) / widthZ) * divisions), 0, divisions - 1);
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
      const distanceSq = dx * dx + dz * dz;
      nearest.push({ distanceSq, y: triangle.centerY });
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

function physicalDamageCapBounds(fighter, mesh) {
  const geometry = mesh?.geometry;
  if (!fighter?.group || !mesh || !geometry?.attributes?.position) return null;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox?.clone();
  if (!bounds || !Number.isFinite(bounds.min.x)) return null;
  // Mesh-local cake volume for break caps: the mesh shell gives the top/sides,
  // while original body physics colliders give the floor. Drive contacts and
  // cylinders are proxies, so they must not lower or widen the solid interior.
  // The expensive top-surface index is built inside the damage worker. The
  // main thread only sends the intent so hit handling does not stall animation.
  bounds.useTopSurface = true;
  const parts = fighter.physicalDamageOriginalColliderParts || fighter.colliderParts || [];
  let bodyFloorY = Infinity;
  parts.forEach((part) => {
    if (part?.part !== "body" || part.type === "driveContact" || part.type === "cylinder") return;
    const position = part.position || [0, 0, 0];
    const half = part.halfExtents || [0.4, 0.16, 0.4];
    bodyFloorY = Math.min(bodyFloorY, position[1] - Math.abs(half[1]));
  });
  if (Number.isFinite(bodyFloorY)) {
    const worldFloor = fighter.group.localToWorld(new THREE.Vector3(0, bodyFloorY, 0));
    const meshFloorY = mesh.worldToLocal(worldFloor).y;
    if (Number.isFinite(meshFloorY)) bounds.min.y = meshFloorY;
  }
  bounds.expandByScalar(0.002);
  return bounds;
}

function physicalDamageMainBodyBounds(fighter, mesh) {
  if (!fighter?.group || !mesh) return null;
  const parts = fighter.physicalDamageOriginalColliderParts || fighter.colliderParts || [];
  const bounds = new THREE.Box3();
  parts.forEach((part) => {
    if (part?.part !== "body" || part.type !== "box") return;
    const position = part.position || [0, 0, 0];
    const half = (part.halfExtents || [0.4, 0.16, 0.4]).map((value) => Math.abs(value));
    [-1, 1].forEach((xSign) => {
      [-1, 1].forEach((ySign) => {
        [-1, 1].forEach((zSign) => {
          const point = new THREE.Vector3(
            position[0] + half[0] * xSign,
            position[1] + half[1] * ySign,
            position[2] + half[2] * zSign,
          );
          fighter.group.localToWorld(point);
          mesh.worldToLocal(point);
          bounds.expandByPoint(point);
        });
      });
    });
  });
  if (!Number.isFinite(bounds.min.x)) return null;
  bounds.expandByScalar(0.002);
  return bounds;
}

function plainBounds3(bounds) {
  if (!bounds || !Number.isFinite(bounds.min.x)) return null;
  return {
    min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
    max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
    useTopSurface: Boolean(bounds.useTopSurface),
  };
}

function workerResultStatus(candidate) {
  if (!candidate) return null;
  return {
    status: candidate.status,
    reason: candidate.failureReason || null,
    details: candidate.failureDetails || null,
    hits: candidate.hits,
    requiredHits: candidate.requiredHits,
    interiorForceHits: candidate.interiorForceHits ?? null,
    triangles: candidate.split?.triangleCount || 0,
    releaseWhenReady: Boolean(candidate.releaseWhenReady),
    interiorFraction: candidate.interiorFraction ?? null,
    damage: candidate.damage ?? null,
    maxHitDamage: candidate.maxHitDamage ?? null,
  };
}

function breakInteriorFraction2D(localPoint, capBounds, radius) {
  if (!localPoint || !capBounds || !Number.isFinite(capBounds.min?.x) || !Number.isFinite(capBounds.max?.z)) return 0;
  const breakRadius = Math.max(0.05, Number(radius) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.breakRadius);
  let inside = 0;
  let total = 0;
  const steps = 4;
  for (let ix = -steps; ix <= steps; ix += 1) {
    for (let iz = -steps; iz <= steps; iz += 1) {
      const x = (ix / steps) * breakRadius;
      const z = (iz / steps) * breakRadius;
      if (x * x + z * z > breakRadius * breakRadius) continue;
      total += 1;
      const sampleX = localPoint.x + x;
      const sampleZ = localPoint.z + z;
      if (
        sampleX >= capBounds.min.x &&
        sampleX <= capBounds.max.x &&
        sampleZ >= capBounds.min.z &&
        sampleZ <= capBounds.max.z
      ) inside += 1;
    }
  }
  return total ? inside / total : 0;
}

function interiorForceHitCount(options, maxHitDamage = 0) {
  const requiredHits = Math.max(1, Math.round(options.significantHitsRequired || 1));
  const multiplier = Math.max(1, Math.round(options.interiorBreakHitMultiplier ?? DEFAULT_PHYSICAL_DAMAGE_OPTIONS.interiorBreakHitMultiplier));
  const weakCount = requiredHits * multiplier;
  const threshold = Math.max(0.001, Number(options.threshold) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.threshold);
  const hitRatio = Math.max(1, Number(maxHitDamage) / threshold);
  const strongT = THREE.MathUtils.clamp((hitRatio - 1) / 2, 0, 1);
  return Math.max(requiredHits, Math.round(THREE.MathUtils.lerp(weakCount, requiredHits, strongT)));
}

function physicalDamageRadiusScale(options, damage = 0) {
  const threshold = Math.max(0.001, Number(options.threshold) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.threshold);
  const maxMultiplier = Math.max(1, Number(options.maxRadiusDamageMultiplier) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.maxRadiusDamageMultiplier);
  const ratio = THREE.MathUtils.clamp(Math.max(0, Number(damage) || 0) / threshold, 1, maxMultiplier);
  return 1 + ((ratio - 1) / Math.max(1, maxMultiplier - 1)) * 3;
}

function scaledPhysicalDamageRadii(options, damage = 0) {
  const scale = physicalDamageRadiusScale(options, damage);
  const baseBreak = Math.max(0.08, Number(options.breakRadius) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.breakRadius);
  const baseMatch = Math.max(0.1, Number(options.primeMatchRadius) || baseBreak * 1.5);
  const maxBreak = Math.max(baseBreak, Number(options.maxBreakRadius) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.maxBreakRadius);
  const maxMatch = Math.max(baseMatch, Number(options.maxPrimeMatchRadius) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.maxPrimeMatchRadius);
  return {
    breakRadius: Math.min(maxBreak, baseBreak * scale),
    primeMatchRadius: Math.min(maxMatch, baseMatch * scale),
    scale,
  };
}

function isInteriorBreak(localPoint, interiorBounds, options) {
  const fraction = breakInteriorFraction2D(localPoint, interiorBounds, options.breakRadius);
  return {
    fraction,
    interior: fraction > (options.interiorBreakInsideThreshold ?? DEFAULT_PHYSICAL_DAMAGE_OPTIONS.interiorBreakInsideThreshold),
  };
}

function completePreparedBreak(candidate, context, split) {
  const geometrySplit = splitPayloadToGeometries(split);
  if (!geometrySplit) {
    candidate.status = "failed";
    candidate.failureReason = "geometry-build-failed";
    context.fighter.physicalDamageLastResult = { status: "prepare-failed", reason: candidate.failureReason };
    context.onStatusChanged?.({ fighter: context.fighter, candidate, status: "prepare-failed" });
    return;
  }
  candidate.split = geometrySplit;
  const candidateOptions = {
    ...context.options,
    breakRadius: candidate.breakRadius || context.options.breakRadius,
    primeMatchRadius: candidate.primeMatchRadius || context.options.primeMatchRadius,
  };
  const interior = isInteriorBreak(candidate.localPoint, candidate.interiorBounds, candidateOptions);
  candidate.interiorFraction = interior.fraction;
  candidate.interiorForceHits = interiorForceHitCount(candidateOptions, candidate.maxHitDamage || candidate.damage);
  if (interior.interior && !candidate.allowInteriorBreak && candidate.hits < candidate.interiorForceHits) {
    candidate.status = "deferred-interior";
    context.fighter.physicalDamageLastResult = {
      status: "deferred-interior",
      hits: candidate.hits,
      requiredHits: candidate.requiredHits,
      interiorForceHits: candidate.interiorForceHits,
      triangles: candidate.split.triangleCount,
      interiorFraction: candidate.interiorFraction,
    };
    context.onStatusChanged?.({ fighter: context.fighter, candidate, status: "deferred-interior" });
    return;
  }
  candidate.status = "ready";
  context.fighter.physicalDamageLastResult = {
    status: "ready",
    hits: candidate.hits,
    requiredHits: candidate.requiredHits,
    triangles: candidate.split.triangleCount,
  };
  context.onStatusChanged?.({ fighter: context.fighter, candidate, status: "ready" });
  if (candidate.releaseWhenReady && candidate.hits >= candidate.requiredHits) {
    const winner = firstReadyCandidateInGroup(context.fighter, candidate) || candidate;
    context.fighter.physicalDamageLastResult = {
      status: "committing-ready",
      hits: winner.hits,
      requiredHits: winner.requiredHits,
      triangles: winner.split.triangleCount,
    };
    context.onStatusChanged?.({ fighter: context.fighter, candidate: winner, status: "committing-ready" });
    commitPhysicalDamageBreak({
      ...context,
      options: {
        ...context.options,
        breakRadius: winner.breakRadius || context.options.breakRadius,
        primeMatchRadius: winner.primeMatchRadius || context.options.primeMatchRadius,
      },
      candidate: winner,
      hitNormal: winner.lastHitNormal.clone(),
      damage: winner.damage,
      afterTheFact: true,
    });
  }
}

function createPhysicalDamageWorker() {
  return typeof Worker === "undefined" ? null : new Worker(new URL("./physicalDamageWorker.js?v=solid-cap-23", import.meta.url), { type: "module" });
}

function finishPhysicalDamageJob(id, { terminate = true } = {}) {
  const job = physicalDamageJobs.get(id);
  if (!job) return null;
  physicalDamageJobs.delete(id);
  if (job.timeoutId) clearTimeout(job.timeoutId);
  if (terminate) job.worker?.terminate?.();
  return job;
}

function cancelPhysicalDamageCandidate(candidate, reason = "cancelled") {
  if (!candidate || candidate.committed) return;
  if (candidate.jobId) finishPhysicalDamageJob(candidate.jobId);
  candidate.status = reason;
  candidate.failureReason = reason;
}

function cancelSiblingDamageCandidates(fighter, committedCandidate) {
  const groupId = committedCandidate?.groupId;
  if (!groupId) return;
  (fighter?.physicalDamagePrimedBreaks || []).forEach((candidate) => {
    if (candidate === committedCandidate || candidate.groupId !== groupId || candidate.committed) return;
    cancelPhysicalDamageCandidate(candidate, "superseded");
    candidate.committed = true;
  });
}

function firstReadyCandidateInGroup(fighter, candidate) {
  const groupId = candidate?.groupId;
  if (!groupId) return candidate?.status === "ready" && candidate.split ? candidate : null;
  return (fighter?.physicalDamagePrimedBreaks || []).find((item) => (
    !item.committed &&
    item.groupId === groupId &&
    item.status === "ready" &&
    item.split &&
    item.hits >= item.requiredHits
  )) || null;
}

function adjacentDeferredInteriorCandidates(fighter, candidate, options) {
  const radius = Math.max(0.08, Number(candidate?.breakRadius) || Number(options.breakRadius) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.breakRadius);
  const adjacencyRadius = Math.max(radius * 2.2, radius + 0.28);
  return (fighter?.physicalDamagePrimedBreaks || []).filter((item) => (
    item !== candidate &&
    !item.committed &&
    item.status === "deferred-interior" &&
    item.split &&
    item.mesh === candidate.mesh &&
    item.sourceGeometry === candidate.sourceGeometry &&
    item.localPoint.distanceTo(candidate.localPoint) <= adjacencyRadius
  ));
}

function wirePhysicalDamageWorker(worker) {
  worker.onmessage = (event) => {
    const { id, ok, split, reason, details } = event.data || {};
    const job = finishPhysicalDamageJob(id, { terminate: true });
    if (!job) return;
    const { candidate, context } = job;
    if (candidate.committed) return;
    if (!ok) {
      candidate.status = "failed";
      candidate.failureReason = reason || "split-failed";
      candidate.failureDetails = details || null;
      context.fighter.physicalDamageLastResult = { status: "prepare-failed", reason: candidate.failureReason };
      context.onStatusChanged?.({ fighter: context.fighter, candidate, status: "prepare-failed" });
      return;
    }
    completePreparedBreak(candidate, context, split);
  };
  worker.onerror = () => {
    const matching = [...physicalDamageJobs.entries()].find(([, job]) => job.worker === worker);
    if (!matching) return;
    const [id, { candidate, context }] = matching;
    finishPhysicalDamageJob(id, { terminate: true });
    candidate.status = "failed";
    candidate.failureReason = "worker-error";
    context.fighter.physicalDamageLastResult = { status: "prepare-failed", reason: "worker-error" };
    context.onStatusChanged?.({ fighter: context.fighter, candidate, status: "prepare-failed" });
  };
  return worker;
}

function prepareBreakAsync(candidate, context, sourceSnapshot, localNormal, options, capBounds = null) {
  const worker = wirePhysicalDamageWorker(createPhysicalDamageWorker());
  if (!worker || !sourceSnapshot) {
    candidate.status = "failed";
    candidate.failureReason = worker ? "snapshot-failed" : "worker-unavailable";
    return;
  }
  const id = nextPhysicalDamageJobId++;
  candidate.jobId = id;
  candidate.status = "calculating";
  const timeoutId = setTimeout(() => {
    const job = finishPhysicalDamageJob(id, { terminate: true });
    if (!job) return;
    const { candidate: jobCandidate, context: jobContext } = job;
    jobCandidate.status = "failed";
    jobCandidate.failureReason = "prepare-timeout";
    jobContext.fighter.physicalDamageLastResult = {
      status: "prepare-failed",
      reason: "prepare-timeout",
      hits: jobCandidate.hits,
      requiredHits: jobCandidate.requiredHits,
    };
    jobContext.onStatusChanged?.({ fighter: jobContext.fighter, candidate: jobCandidate, status: "prepare-failed" });
  }, PHYSICAL_DAMAGE_PREPARE_TIMEOUT_MS);
  physicalDamageJobs.set(id, { candidate, context, timeoutId, worker });
  worker.postMessage({
    id,
    source: sourceSnapshot.source,
    localPoint: { x: candidate.localPoint.x, y: candidate.localPoint.y, z: candidate.localPoint.z },
    localNormal: { x: localNormal.x, y: localNormal.y, z: localNormal.z },
    capBounds: plainBounds3(capBounds),
    options: {
      breakRadius: options.breakRadius,
      radialFalloff: options.radialFalloff,
      minPieceTriangles: options.minPieceTriangles,
      maxPieceTriangles: options.maxPieceTriangles,
      skipCaps: candidate.damageZone === "weapon" || options.skipCaps,
    },
  }, sourceSnapshot.transfers);
}

function schedulePhysicalDamagePrepare(candidate, context, target, hitNormal, options) {
  if (!candidate || candidate.prepareQueued || candidate.status !== "queued") return;
  candidate.prepareQueued = true;
  pendingPhysicalDamagePrepares.push({ candidate, context, target, hitNormal: hitNormal.clone(), options });
  context.onStatusChanged?.({ fighter: context.fighter, candidate, status: "queued" });
  if (physicalDamagePrepareDrainScheduled) return;
  physicalDamagePrepareDrainScheduled = true;
  // Keep collision/animation frames light: geometry snapshots, cake bounds, and worker startup
  // can all touch large GLB buffers, so they must stay in this deferred drain.
  const drain = (deadline = null) => {
    physicalDamagePrepareDrainScheduled = false;
    while (pendingPhysicalDamagePrepares.length) {
      const hasIdleBudget = !deadline || deadline.didTimeout || (deadline.timeRemaining?.() ?? 0) > 4;
      if (!hasIdleBudget) break;
      const item = pendingPhysicalDamagePrepares.shift();
      const { candidate: queued, context: queuedContext, target: queuedTarget } = item;
      queued.prepareQueued = false;
      if (queued.committed || queued.status !== "queued" || queued.mesh?.geometry !== queued.sourceGeometry) continue;
      const sourceSnapshot = snapshotMeshSource(queuedTarget.mesh);
      if (!sourceSnapshot) {
        queued.status = "failed";
        queued.failureReason = "snapshot-failed";
        queuedContext.fighter.physicalDamageLastResult = { status: "prepare-failed", reason: queued.failureReason };
        queuedContext.onStatusChanged?.({ fighter: queuedContext.fighter, candidate: queued, status: "prepare-failed" });
        continue;
      }
      const localNormal = item.hitNormal.clone().transformDirection(queuedTarget.mesh.matrixWorld.clone().invert());
      const capBounds = queued.capBounds || physicalDamageCapBounds(queuedContext.fighter, queuedTarget.mesh);
      queued.capBounds = capBounds?.clone?.() || null;
      queued.interiorBounds ||= physicalDamageMainBodyBounds(queuedContext.fighter, queuedTarget.mesh);
      prepareBreakAsync(queued, queuedContext, sourceSnapshot, localNormal, item.options, capBounds);
      queuedContext.onStatusChanged?.({ fighter: queuedContext.fighter, candidate: queued, status: "calculating" });
      break;
    }
    if (pendingPhysicalDamagePrepares.length) {
      physicalDamagePrepareDrainScheduled = true;
      if (typeof requestIdleCallback === "function") requestIdleCallback(drain, { timeout: 120 });
      else setTimeout(drain, 0);
    }
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(drain, { timeout: 120 });
  else setTimeout(drain, 0);
}

function schedulePhysicalDamageHit(hit) {
  pendingPhysicalDamageHits.push(hit);
  if (physicalDamageHitDrainScheduled) return;
  physicalDamageHitDrainScheduled = true;
  // Frame-safety guard: this drain is the first place physical-damage code may inspect
  // render meshes, compute mesh bounds, or choose target geometry. Collision and animation
  // frames must only enqueue hit facts and return.
  const drain = (deadline = null) => {
    physicalDamageHitDrainScheduled = false;
    while (pendingPhysicalDamageHits.length) {
      const hasIdleBudget = !deadline || deadline.didTimeout || (deadline.timeRemaining?.() ?? 0) > 4;
      if (!hasIdleBudget) break;
      const next = pendingPhysicalDamageHits.shift();
      processPhysicalDamageHit(next);
      break;
    }
    if (pendingPhysicalDamageHits.length) {
      physicalDamageHitDrainScheduled = true;
      if (typeof requestIdleCallback === "function") requestIdleCallback(drain, { timeout: 80 });
      else setTimeout(drain, 0);
    }
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(drain, { timeout: 80 });
  else setTimeout(drain, 0);
}

function pushVertex(data, position, normal, uv, index) {
  data.position.push(position.getX(index), position.getY(index), position.getZ(index));
  if (normal) data.normal.push(normal.getX(index), normal.getY(index), normal.getZ(index));
  if (uv) data.uv.push(uv.getX(index), uv.getY(index));
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
  pushCapTriangle(data, points, [indices[2], indices[1], indices[0]], normal.clone().negate());
}

function pushCurvedCapTriangle(data, vertices, indices, normalSign = 1) {
  indices.forEach((index) => {
    const vertex = vertices[index];
    pushPoint(data, vertex.point, vertex.normal.clone().multiplyScalar(normalSign));
  });
}

function pushDoubleSidedCurvedCapTriangle(data, vertices, indices, normalSign = 1) {
  pushCurvedCapTriangle(data, vertices, indices, normalSign);
  pushCurvedCapTriangle(data, vertices, [indices[2], indices[1], indices[0]], -normalSign);
}

function clampPointToCapBounds(point, capBounds, { useTopSurface = true } = {}) {
  if (!capBounds) return point;
  // Clamp only generated interior cap samples. Boundary vertices are copied
  // from the real break loop so the cap still seals the cut exactly. The top
  // limit is sampled from the visible mesh shell at this X/Z, not from the
  // single highest point of the mesh bounding box.
  const clamped = point.clone().clamp(capBounds.min, capBounds.max);
  const topY = useTopSurface ? capBounds.topSurfaceYAt?.(clamped.x, clamped.z) : null;
  if (Number.isFinite(topY)) clamped.y = Math.min(clamped.y, Math.max(capBounds.min.y, topY));
  return clamped;
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
  const clamped = point.clone();
  clamped.y = Math.min(clamped.y, roofY);
  return clamped;
}

function dentedCapNormal(point, baseNormal, localPoint, u, v, radius) {
  const safeRadius = Math.max(0.001, radius);
  const offset = point.clone().sub(localPoint);
  const x = offset.dot(u) / safeRadius;
  const y = offset.dot(v) / safeRadius;
  const z = offset.length() / safeRadius;
  const n1 = Math.sin(x * 18.7 + y * 7.9 + z * 5.3)
    + Math.sin(x * -9.4 + y * 21.1 + z * 3.7) * 0.55
    + Math.cos((x + y) * 14.2 - z * 8.1) * 0.35;
  const n2 = Math.cos(x * 11.3 - y * 17.6 + z * 6.9)
    + Math.sin(x * 23.5 + y * 10.8 - z * 4.4) * 0.5
    + Math.cos((x - y) * 16.9 + z * 7.2) * 0.35;
  const gouge = 0.65 + 0.35 * Math.sin(x * 31.0 + y * 27.0 + z * 12.0);
  return baseNormal.clone()
    .addScaledVector(u, n1 * CAP_DENT_NORMAL_STRENGTH * gouge)
    .addScaledVector(v, n2 * CAP_DENT_NORMAL_STRENGTH * gouge)
    .normalize();
}

function triangleCentroid(position, tri, target = new THREE.Vector3()) {
  return target.set(
    (position.getX(tri[0]) + position.getX(tri[1]) + position.getX(tri[2])) / 3,
    (position.getY(tri[0]) + position.getY(tri[1]) + position.getY(tri[2])) / 3,
    (position.getZ(tri[0]) + position.getZ(tri[1]) + position.getZ(tri[2])) / 3,
  );
}

function orderedBoundaryLoops(boundary, position) {
  const vertices = new Map();
  const adjacency = new Map();
  const edgeKeys = [];
  const addVertex = (index) => {
    const key = quantizedVertexKey(position, index);
    if (!vertices.has(key)) vertices.set(key, new THREE.Vector3(position.getX(index), position.getY(index), position.getZ(index)));
    if (!adjacency.has(key)) adjacency.set(key, []);
    return key;
  };
  const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  boundary.forEach((edge) => {
    if (!edge.selectedCount || !edge.remainingCount) return;
    const a = addVertex(edge.a);
    const b = addVertex(edge.b);
    const key = edgeKey(a, b);
    if (edgeKeys.includes(key)) return;
    edgeKeys.push(key);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  });
  const unused = new Set(edgeKeys);
  const loops = [];
  while (unused.size) {
    const [startA, startB] = [...unused][0].split("|");
    const loop = [startA];
    let previous = startA;
    let current = startB;
    unused.delete(edgeKey(startA, startB));
    let guard = edgeKeys.length + 4;
    while (guard > 0) {
      guard -= 1;
      loop.push(current);
      if (current === startA) break;
      const next = (adjacency.get(current) || []).find((candidate) => candidate !== previous && unused.has(edgeKey(current, candidate)))
        || (adjacency.get(current) || []).find((candidate) => unused.has(edgeKey(current, candidate)));
      if (!next) break;
      unused.delete(edgeKey(current, next));
      previous = current;
      current = next;
    }
    if (loop[loop.length - 1] === startA) loop.pop();
    const uniqueLoop = loop.filter((key, index) => loop.indexOf(key) === index);
    if (uniqueLoop.length >= 3) loops.push(uniqueLoop.map((key) => vertices.get(key).clone()));
  }
  return loops;
}

function buildSphericalCapFromLoop({ loop, normal, localPoint, radius, capBounds, remainingCapData, pieceCapLocalData }) {
  if (loop.length < 3 || radius <= 0.001) return false;
  const tangentSeed = Math.abs(normal.y) < 0.82 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = tangentSeed.cross(normal).normalize();
  const v = normal.clone().cross(u).normalize();
  const centerU = localPoint.dot(u);
  const centerV = localPoint.dot(v);
  const useLoopRoof = Math.abs(normal.y) > 0.2;
  const depthDirection = normal.y < -0.2 ? normal.clone() : normal.clone().negate();
  const ringCount = THREE.MathUtils.clamp(Math.ceil(loop.length / 10), 5, 10);
  const rings = [];
  const makeVertex = (point) => {
    const sphereNormal = point.clone().sub(localPoint);
    if (sphereNormal.lengthSq() < 0.000001) sphereNormal.copy(normal).negate();
    else sphereNormal.normalize();
    return { point, normal: dentedCapNormal(point, sphereNormal, localPoint, u, v, radius) };
  };
  rings.push([makeVertex(clampPointToCapBounds(
    useLoopRoof
      ? clampPointToBreakLoopRoof(localPoint.clone().addScaledVector(depthDirection, radius), loop)
      : localPoint.clone().addScaledVector(depthDirection, radius),
    capBounds,
    { useTopSurface: !useLoopRoof },
  ))]);
  for (let ring = 1; ring <= ringCount; ring += 1) {
    const t = ring / ringCount;
    rings.push(loop.map((boundaryPoint) => {
      if (ring === ringCount) return makeVertex(boundaryPoint.clone());
      const bu = boundaryPoint.dot(u);
      const bv = boundaryPoint.dot(v);
      const lateralU = (bu - centerU) * t;
      const lateralV = (bv - centerV) * t;
      const lateralDistance = Math.hypot(lateralU, lateralV);
      const depth = Math.sqrt(Math.max(0, radius * radius - Math.min(radius, lateralDistance) ** 2));
      const capPoint = localPoint.clone()
        .addScaledVector(u, lateralU)
        .addScaledVector(v, lateralV)
        .addScaledVector(depthDirection, depth);
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
    pushDoubleSidedCurvedCapTriangle(pieceCapLocalData, tri, [0, 1, 2], 1);
    pushDoubleSidedCurvedCapTriangle(remainingCapData, tri, [2, 1, 0], -1);
  }
  for (let ring = 2; ring < rings.length; ring += 1) {
    const previous = rings[ring - 1];
    const current = rings[ring];
    for (let i = 0; i < current.length; i += 1) {
      const next = (i + 1) % current.length;
      const quad = [previous[i], previous[next], current[next], current[i]];
      pushDoubleSidedCurvedCapTriangle(pieceCapLocalData, quad, [0, 1, 2], 1);
      pushDoubleSidedCurvedCapTriangle(pieceCapLocalData, quad, [0, 2, 3], 1);
      pushDoubleSidedCurvedCapTriangle(remainingCapData, quad, [2, 1, 0], -1);
      pushDoubleSidedCurvedCapTriangle(remainingCapData, quad, [3, 2, 0], -1);
    }
  }
  return true;
}

function buildCapDataFromBoundary(boundary, position, hitNormal, localPoint, radius, capBounds = null) {
  const remainingCapData = { position: [], normal: [], uv: [] };
  const pieceCapLocalData = { position: [], normal: [], uv: [] };
  const normal = hitNormal.clone().normalize();
  const tangentSeed = Math.abs(normal.y) < 0.82 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = tangentSeed.cross(normal).normalize();
  const v = normal.clone().cross(u).normalize();
  orderedBoundaryLoops(boundary, position).forEach((loop) => {
    if (localPoint && buildSphericalCapFromLoop({
      loop,
      normal,
      localPoint,
      radius: Math.max(0.04, radius),
      capBounds,
      remainingCapData,
      pieceCapLocalData,
    })) return;
    const projected = loop.map((point) => new THREE.Vector2(point.dot(u), point.dot(v)));
    if (Math.abs(THREE.ShapeUtils.area(projected)) < 0.000001) return;
    let points = loop;
    let points2 = projected;
    if (THREE.ShapeUtils.area(points2) < 0) {
      points = [...points].reverse();
      points2 = [...points2].reverse();
    }
    THREE.ShapeUtils.triangulateShape(points2, []).forEach((tri) => {
      pushDoubleSidedCapTriangle(pieceCapLocalData, points, tri, normal);
      pushDoubleSidedCapTriangle(remainingCapData, points, [tri[2], tri[1], tri[0]], normal.clone().negate());
    });
  });
  return { remainingCapData, pieceCapLocalData };
}

function collectDamageableMeshes(fighter) {
  const meshes = [];
  fighter?.group?.traverse?.((child) => {
    if (!child.isMesh || !child.visible || !child.geometry?.attributes?.position) return;
    if (child.userData?.viewerPart && !DAMAGEABLE_VIEWER_PARTS.has(child.userData.viewerPart)) return;
    if (child.userData?.physicalDamageCap || child.userData?.physicalDamageDetached || child.userData?.colliderHelper) return;
    meshes.push(child);
  });
  return meshes;
}

function bestDamageMesh(fighter, worldPoint, preferredMesh = null, options = DEFAULT_PHYSICAL_DAMAGE_OPTIONS) {
  let meshes = collectDamageableMeshes(fighter);
  if (!meshes.length) return null;
  const minBreakableTriangles = Math.max(1, options.minPieceTriangles || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.minPieceTriangles || 18) + 7;
  const viableMeshes = meshes.filter((mesh) => {
    const position = mesh.geometry?.attributes?.position;
    if (!position) return false;
    const triangleCount = mesh.geometry.index ? mesh.geometry.index.count / 3 : position.count / 3;
    return triangleCount >= minBreakableTriangles;
  });
  if (viableMeshes.length) meshes = viableMeshes;
  const local = new THREE.Vector3();
  const bounds = new THREE.Box3();
  let best = null;
  if (preferredMesh && meshes.includes(preferredMesh)) {
    preferredMesh.geometry.computeBoundingBox();
    if (preferredMesh.geometry.boundingBox) {
      local.copy(worldPoint);
      preferredMesh.worldToLocal(local);
      bounds.copy(preferredMesh.geometry.boundingBox).expandByScalar(0.08);
      const clamped = local.clone().clamp(bounds.min, bounds.max);
      return { mesh: preferredMesh, localPoint: local.clone(), distance: clamped.distanceTo(local) };
    }
  }
  meshes.forEach((mesh) => {
    mesh.geometry.computeBoundingBox();
    if (!mesh.geometry.boundingBox) return;
    local.copy(worldPoint);
    mesh.worldToLocal(local);
    bounds.copy(mesh.geometry.boundingBox).expandByScalar(0.08);
    const clamped = local.clone().clamp(bounds.min, bounds.max);
    const distance = clamped.distanceTo(local);
    if (!best || distance < best.distance) best = { mesh, localPoint: local.clone(), distance };
  });
  return best;
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
  const centroid = new THREE.Vector3();
  const edgeKey = (a, b) => {
    const ka = quantizedVertexKey(position, a);
    const kb = quantizedVertexKey(position, b);
    return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
  };
  const selectedEdges = new Set();
  for (let i = 0; i < triangleCount; i += 1) {
    if (!selected.has(i)) continue;
    for (let j = 0; j < 3; j += 1) tri[j] = index ? index.getX(i * 3 + j) : i * 3 + j;
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
      for (let j = 0; j < 3; j += 1) tri[j] = index ? index.getX(i * 3 + j) : i * 3 + j;
      triangleCentroid(position, tri, centroid);
      if (centroid.distanceTo(localPoint) > cleanupRadius) continue;
      let selectedNeighborCount = 0;
      if (selectedEdges.has(edgeKey(tri[0], tri[1]))) selectedNeighborCount += 1;
      if (selectedEdges.has(edgeKey(tri[1], tri[2]))) selectedNeighborCount += 1;
      if (selectedEdges.has(edgeKey(tri[2], tri[0]))) selectedNeighborCount += 1;
      if (selectedNeighborCount >= 2) nextSelected.push(i);
    }
    if (!nextSelected.length) break;
    nextSelected.forEach((triangleIndex) => {
      selected.add(triangleIndex);
      for (let j = 0; j < 3; j += 1) tri[j] = index ? index.getX(triangleIndex * 3 + j) : triangleIndex * 3 + j;
      selectedEdges.add(edgeKey(tri[0], tri[1]));
      selectedEdges.add(edgeKey(tri[1], tri[2]));
      selectedEdges.add(edgeKey(tri[2], tri[0]));
    });
    absorbed += nextSelected.length;
  }
}

function splitMeshAtHit(mesh, localPoint, localNormal, options, capBounds = null) {
  const source = mesh.geometry;
  const position = source.attributes.position;
  const normal = source.attributes.normal;
  const uv = source.attributes.uv || source.attributes.uv0;
  const index = source.index;
  const triangleCount = index ? index.count / 3 : position.count / 3;
  const tri = [0, 0, 0];
  const selected = new Set();
  const centroid = new THREE.Vector3();
  const hitNormal = localNormal?.clone?.() || new THREE.Vector3(0, 1, 0);
  if (hitNormal.lengthSq() < 0.0001) hitNormal.set(0, 1, 0);
  hitNormal.normalize();
  const linkedBreaks = (options.linkedBreaks || []).map((item) => {
    const itemNormal = item.localNormal?.clone?.() || hitNormal.clone();
    if (itemNormal.lengthSq() < 0.0001) itemNormal.copy(hitNormal);
    itemNormal.normalize();
    return {
      localPoint: item.localPoint?.clone?.() || localPoint.clone(),
      localNormal: itemNormal,
    };
  });
  let radius = Math.max(0.08, options.breakRadius);
  const falloff = Math.max(0.05, options.radialFalloff);
  const minPieceTriangles = Math.max(1, options.minPieceTriangles || 18);
  const maxPieceTriangles = Math.max(minPieceTriangles, options.maxPieceTriangles || 55000);
  const pointSelectsTriangle = (point, pointNormal, triangleCenter, testRadius) => {
    const distance = triangleCenter.distanceTo(point);
    const direction = triangleCenter.clone().sub(point);
    if (direction.lengthSq() > 0.000001) direction.normalize();
    const directional = Math.max(0, direction.dot(pointNormal));
    const effectiveRadius = testRadius * (1 + directional * falloff);
    return distance <= effectiveRadius;
  };

  for (let attempt = 0; attempt < 7; attempt += 1) {
    selected.clear();
    for (let i = 0; i < triangleCount; i += 1) {
      for (let j = 0; j < 3; j += 1) tri[j] = index ? index.getX(i * 3 + j) : i * 3 + j;
      triangleCentroid(position, tri, centroid);
      if (pointSelectsTriangle(localPoint, hitNormal, centroid, radius)) {
        selected.add(i);
        continue;
      }
      if (linkedBreaks.some((item) => pointSelectsTriangle(item.localPoint, item.localNormal, centroid, radius))) selected.add(i);
    }
    if (selected.size <= maxPieceTriangles || radius <= 0.045) break;
    radius *= 0.68;
  }

  if (selected.size < minPieceTriangles) {
    const nearest = [];
    for (let i = 0; i < triangleCount; i += 1) {
      for (let j = 0; j < 3; j += 1) tri[j] = index ? index.getX(i * 3 + j) : i * 3 + j;
      triangleCentroid(position, tri, centroid);
      nearest.push({ index: i, distance: centroid.distanceTo(localPoint) });
    }
    nearest.sort((a, b) => a.distance - b.distance);
    const needed = Math.min(minPieceTriangles, Math.max(0, triangleCount - 7));
    for (let i = 0; i < nearest.length && selected.size < needed; i += 1) selected.add(nearest[i].index);
  }

  absorbLocalThreadTriangles(selected, position, index, triangleCount, { localPoint, radius });

  if (selected.size < minPieceTriangles || selected.size >= triangleCount - 6) return null;

  const remainingData = { position: [], normal: [], uv: [] };
  const pieceLocalData = { position: [], normal: [], uv: [] };
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
    for (let j = 0; j < 3; j += 1) tri[j] = index ? index.getX(i * 3 + j) : i * 3 + j;
    const data = selected.has(i) ? pieceLocalData : remainingData;
    tri.forEach((vertexIndex) => pushVertex(data, position, normal, uv, vertexIndex));
    addBoundaryEdge(tri[0], tri[1], selected.has(i));
    addBoundaryEdge(tri[1], tri[2], selected.has(i));
    addBoundaryEdge(tri[2], tri[0], selected.has(i));
  }

  const selectedCenter = new THREE.Vector3();
  for (let i = 0; i < pieceLocalData.position.length; i += 3) {
    selectedCenter.x += pieceLocalData.position[i];
    selectedCenter.y += pieceLocalData.position[i + 1];
    selectedCenter.z += pieceLocalData.position[i + 2];
  }
  selectedCenter.multiplyScalar(3 / Math.max(3, pieceLocalData.position.length));
  const { remainingCapData, pieceCapLocalData } = options.skipCaps
    ? { remainingCapData: { position: [], normal: [], uv: [] }, pieceCapLocalData: { position: [], normal: [], uv: [] } }
    : buildCapDataFromBoundary(boundary, position, hitNormal, localPoint, radius, capBounds);

  const remainingGeometry = makeGeometry(remainingData);
  const pieceGeometry = makeGeometry(pieceLocalData);
  const remainingCapGeometry = makeGeometry(remainingCapData);
  const pieceCapGeometry = makeGeometry(pieceCapLocalData);
  if (!remainingGeometry || !pieceGeometry) return null;

  return {
    remainingGeometry,
    pieceGeometry,
    remainingCapGeometry,
    pieceCapGeometry,
    localCenter: selectedCenter,
    triangleCount: selected.size,
  };
}

function geometryToCenteredWorldGeometry(mesh, geometry, forcedCenter = null) {
  const sourcePosition = geometry.attributes.position;
  const sourceNormal = geometry.attributes.normal;
  const sourceUv = geometry.attributes.uv || geometry.attributes.uv0;
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const worldPoints = [];
  const worldNormals = [];
  const center = forcedCenter?.clone?.() || new THREE.Vector3();
  for (let i = 0; i < sourcePosition.count; i += 1) {
    const point = new THREE.Vector3(sourcePosition.getX(i), sourcePosition.getY(i), sourcePosition.getZ(i));
    mesh.localToWorld(point);
    worldPoints.push(point);
    if (!forcedCenter) center.add(point);
    if (sourceNormal) {
      const normal = new THREE.Vector3(sourceNormal.getX(i), sourceNormal.getY(i), sourceNormal.getZ(i))
        .applyMatrix3(normalMatrix)
        .normalize();
      worldNormals.push(normal);
    }
  }
  if (!forcedCenter) center.multiplyScalar(1 / Math.max(1, worldPoints.length));
  const data = { position: [], normal: [], uv: [] };
  worldPoints.forEach((point, index) => {
    data.position.push(point.x - center.x, point.y - center.y, point.z - center.z);
    const normal = worldNormals[index];
    if (normal) data.normal.push(normal.x, normal.y, normal.z);
    if (sourceUv) data.uv.push(sourceUv.getX(index), sourceUv.getY(index));
  });
  const next = makeGeometry(data);
  return { geometry: next, center };
}

function makeDebrisColliderDesc(RAPIER, geometry, options) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox || new THREE.Box3(new THREE.Vector3(-0.1, -0.1, -0.1), new THREE.Vector3(0.1, 0.1, 0.1));
  const size = box.getSize(new THREE.Vector3());
  if (options.convexCollider) {
    const source = geometry.attributes.position;
    const stride = Math.max(1, Math.ceil(source.count / 96));
    const vertices = [];
    for (let i = 0; i < source.count; i += stride) {
      vertices.push(source.getX(i), source.getY(i), source.getZ(i));
    }
    const desc = vertices.length >= 12 ? RAPIER.ColliderDesc.convexHull(new Float32Array(vertices)) : null;
    if (desc) return desc;
  }
  return RAPIER.ColliderDesc.cuboid(Math.max(0.04, size.x / 2), Math.max(0.04, size.y / 2), Math.max(0.04, size.z / 2));
}

function findPrimedBreak(fighter, mesh, localPoint, options, { skipDeferredInterior = false, matchRadius = null } = {}) {
  const candidates = fighter.physicalDamagePrimedBreaks || [];
  const fallbackRadius = Math.max(0.1, options.primeMatchRadius || options.breakRadius * 1.5);
  return candidates.find((candidate) => (
    !candidate.committed &&
    !INACTIVE_PHYSICAL_DAMAGE_STATUSES.has(candidate.status) &&
    (!skipDeferredInterior || candidate.status !== "deferred-interior") &&
    candidate.mesh === mesh &&
    candidate.sourceGeometry === mesh.geometry &&
    candidate.localPoint.distanceTo(localPoint) <= Math.max(
      fallbackRadius,
      Number(matchRadius) || 0,
      Number(candidate.primeMatchRadius) || 0,
    )
  )) || null;
}

function groupDamageCandidates(fighter, groupId) {
  if (!groupId) return [];
  return (fighter?.physicalDamagePrimedBreaks || []).filter((candidate) => (
    !candidate.committed &&
    candidate.groupId === groupId &&
    candidate.status !== "failed" &&
    candidate.status !== "superseded"
  ));
}

function makePhysicalDamageCandidate({
  target,
  hitPoint,
  hitNormal,
  hits,
  requiredHits,
  damage,
  maxHitDamage = damage,
  groupId,
  releaseWhenReady,
  allowInteriorBreak = false,
  capBounds = null,
  interiorBounds = null,
  damageZone = null,
  breakRadius = null,
  primeMatchRadius = null,
}) {
  return {
    mesh: target.mesh,
    sourceGeometry: target.mesh.geometry,
    split: null,
    localPoint: target.localPoint.clone(),
    worldPoint: hitPoint.clone(),
    hits,
    requiredHits,
    damage,
    maxHitDamage,
    status: "queued",
    releaseWhenReady,
    allowInteriorBreak,
    capBounds: capBounds?.clone?.() || null,
    interiorBounds: interiorBounds?.clone?.() || null,
    lastHitNormal: hitNormal.clone(),
    createdAt: performance.now?.() || Date.now(),
    lastHitAt: performance.now?.() || Date.now(),
    committed: false,
    groupId,
    damageZone,
    breakRadius,
    primeMatchRadius,
    interiorForceHits: null,
  };
}

function commitPhysicalDamageBreak({
  fighter,
  candidate,
  hitNormal,
  damage,
  options,
  arena,
  RAPIER,
  createArenaProp,
  interiorMaterial,
  originalMaterialFallback,
  onCommitted,
  onStatusChanged,
  afterTheFact = false,
}) {
  // Deferred/main-thread mutation only. This function edits Three.js meshes and
  // Rapier colliders, so it must never be called directly from the physics
  // substep; enter through applyPhysicalDamageBreak() so the hit is queued first.
  const { mesh } = candidate;
  if (!mesh?.geometry || mesh.geometry !== candidate.sourceGeometry) {
    candidate.committed = true;
    cancelSiblingDamageCandidates(fighter, candidate);
    return null;
  }

  const linkedInterior = candidate.allowInteriorBreak ? [] : adjacentDeferredInteriorCandidates(fighter, candidate, options);
  if (linkedInterior.length) {
    const localNormal = candidate.lastHitNormal.clone().transformDirection(mesh.matrixWorld.clone().invert());
    const linkedBreaks = linkedInterior.map((item) => ({
      localPoint: item.localPoint.clone(),
      localNormal: item.lastHitNormal.clone().transformDirection(mesh.matrixWorld.clone().invert()),
    }));
    const mergedSplit = splitMeshAtHit(
      mesh,
      candidate.localPoint,
      localNormal,
      {
        ...options,
        breakRadius: candidate.breakRadius || options.breakRadius,
        primeMatchRadius: candidate.primeMatchRadius || options.primeMatchRadius,
        linkedBreaks,
        skipCaps: candidate.damageZone === "weapon" || options.skipCaps,
      },
	      candidate.capBounds || physicalDamageCapBounds(fighter, mesh),
	    );
    if (mergedSplit?.pieceGeometry && mergedSplit?.remainingGeometry) {
      candidate.split = mergedSplit;
      candidate.linkedInteriorCandidates = linkedInterior;
    }
  }

  const oldGeometry = mesh.geometry;
  mesh.geometry = candidate.split.remainingGeometry;
  oldGeometry.dispose?.();
  candidate.committed = true;
  cancelSiblingDamageCandidates(fighter, candidate);
  if (candidate.linkedInteriorCandidates?.length) {
    candidate.linkedInteriorCandidates.forEach((item) => {
      cancelPhysicalDamageCandidate(item, "committed-linked");
      item.committed = true;
      onStatusChanged?.({ fighter, candidate: item, status: "committed-linked" });
    });
  }
  if (candidate.split.remainingCapGeometry && interiorMaterial) {
    const capMesh = new THREE.Mesh(candidate.split.remainingCapGeometry, interiorMaterial);
    capMesh.name = "physicalDamageBodyCap";
    capMesh.userData.physicalDamageCap = true;
    capMesh.castShadow = true;
    capMesh.receiveShadow = true;
    capMesh.matrix.copy(mesh.matrix);
    capMesh.matrix.decompose(capMesh.position, capMesh.quaternion, capMesh.scale);
    mesh.parent?.add(capMesh);
  }

  const worldPiece = geometryToCenteredWorldGeometry(mesh, candidate.split.pieceGeometry);
  const pieceMesh = new THREE.Mesh(worldPiece.geometry, mesh.material || originalMaterialFallback);
  pieceMesh.userData.physicalDamageDetached = true;
  pieceMesh.castShadow = true;
  pieceMesh.receiveShadow = true;
  let debrisMesh = pieceMesh;
  if (candidate.split.pieceCapGeometry && interiorMaterial) {
    const worldCap = geometryToCenteredWorldGeometry(mesh, candidate.split.pieceCapGeometry, worldPiece.center);
    const group = new THREE.Group();
    group.add(pieceMesh);
    const capMesh = new THREE.Mesh(worldCap.geometry, interiorMaterial);
    capMesh.userData.physicalDamageDetached = true;
    capMesh.castShadow = true;
    capMesh.receiveShadow = true;
    group.add(capMesh);
    debrisMesh = group;
  }

  const desc = makeDebrisColliderDesc(RAPIER, worldPiece.geometry, options);
  const debrisWeightLbs = Math.max(8, Math.min(85, candidate.split.triangleCount * 0.08));
  const debrisDensity = Math.max(4.5, Math.min(14, debrisWeightLbs * 0.16));
  const prop = createArenaProp(
    debrisMesh,
    {
      desc,
      density: debrisDensity,
      friction: 1.05,
      restitution: 0.1,
    },
    [worldPiece.center.x, worldPiece.center.y, worldPiece.center.z],
    [0, 0, 0],
    {
      kind: "botDamagePiece",
      boundedArenaDebris: true,
      ccd: true,
      weightLbs: debrisWeightLbs,
      linearDamping: 0.64,
      angularDamping: 1.25,
    },
  );
  if (!prop) return null;

  fighter.physicalDamagePieces = (fighter.physicalDamagePieces || 0) + 1;
  fighter.physicalDamageBrokenAt ||= [];
  fighter.physicalDamageBrokenAt.push({
    point: candidate.worldPoint.clone(),
    damage,
    hits: candidate.hits,
    triangles: candidate.split.triangleCount,
    linkedInteriorBreaks: candidate.linkedInteriorCandidates?.length || 0,
  });

  const sourceVelocity = fighter.rb.linvel();
  const impulseDir = hitNormal.lengthSq() > 0.0001 ? hitNormal.normalize() : new THREE.Vector3(0, 1, 0);
  const debrisVelocity = new THREE.Vector3(
    sourceVelocity.x + (afterTheFact ? 0 : impulseDir.x * damage * options.impulseScale),
    sourceVelocity.y + (afterTheFact ? 0 : Math.abs(options.liftImpulse) + Math.max(0, impulseDir.y) * damage * options.impulseScale),
    sourceVelocity.z + (afterTheFact ? 0 : impulseDir.z * damage * options.impulseScale),
  );
  const maxDebrisSpeed = Math.max(1, options.maxDebrisSpeed || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.maxDebrisSpeed);
  if (!afterTheFact && debrisVelocity.length() > maxDebrisSpeed) debrisVelocity.setLength(maxDebrisSpeed);
  prop.rb.setLinvel({ x: debrisVelocity.x, y: debrisVelocity.y, z: debrisVelocity.z }, true);
  if (!afterTheFact) {
    prop.rb.applyTorqueImpulse({
      x: (Math.random() - 0.5) * damage * options.angularImpulse,
      y: (Math.random() - 0.5) * damage * options.angularImpulse,
      z: (Math.random() - 0.5) * damage * options.angularImpulse,
    }, true);
  }
  onCommitted?.({ fighter, candidate, prop, options, afterTheFact });
  return prop;
}

function processPhysicalDamageHit({
  fighter,
  worldPoint,
  worldNormal,
  rawDamage = 0,
  options = DEFAULT_PHYSICAL_DAMAGE_OPTIONS,
  arena,
  RAPIER,
  createArenaProp,
  interiorMaterial,
  originalMaterialFallback,
  onCommitted,
  onStatusChanged,
  allowInteriorBreak = false,
  damageZone = null,
  targetMesh = null,
}) {
  // Deferred hit processor. Mesh selection and bounds checks are allowed here
  // because schedulePhysicalDamageHit() runs this from idle/time-sliced work,
  // not from the collision callback that reported the hit.
  const markResult = (status, extra = {}) => {
    if (fighter) fighter.physicalDamageLastResult = { status, ...extra };
    return null;
  };
  if (!options.enabled || !fighter?.group || !fighter?.rb || !arena?.world || !RAPIER || !createArenaProp) return null;
  if ((fighter.physicalDamagePieces || 0) >= options.maxPiecesPerBot) return markResult("max-pieces");
  if (!finiteVector(worldPoint)) return markResult("missing-point");

  const damage = Math.max(0, Number(rawDamage) || 0) / Math.max(0.05, options.resilience);
  if (damage < options.threshold) return markResult("below-threshold", { damage, threshold: options.threshold });
  const scaledRadii = scaledPhysicalDamageRadii(options, damage);
  const hitOptions = {
    ...options,
    breakRadius: scaledRadii.breakRadius,
    primeMatchRadius: scaledRadii.primeMatchRadius,
  };
  const hitPoint = new THREE.Vector3(worldPoint.x, worldPoint.y, worldPoint.z);
  const hitNormal = finiteVector(worldNormal) ? new THREE.Vector3(worldNormal.x, worldNormal.y, worldNormal.z) : new THREE.Vector3(0, 1, 0);
  const target = bestDamageMesh(fighter, hitPoint, targetMesh, options);
  if (!target?.mesh) return markResult("no-target-mesh");
  const requiredHits = Math.max(1, Math.round(options.significantHitsRequired || 1));
  const capBoundsForHit = physicalDamageCapBounds(fighter, target.mesh);
  const interiorBoundsForHit = physicalDamageMainBodyBounds(fighter, target.mesh);
  const hitInterior = isInteriorBreak(target.localPoint, interiorBoundsForHit, hitOptions);
  const primed = findPrimedBreak(fighter, target.mesh, target.localPoint, options, {
    skipDeferredInterior: !allowInteriorBreak && !hitInterior.interior,
    matchRadius: scaledRadii.primeMatchRadius,
  });
  if (primed) {
    primed.hits += 1;
    primed.damage += damage;
    primed.maxHitDamage = Math.max(primed.maxHitDamage || 0, damage);
    primed.lastHitAt = performance.now?.() || Date.now();
    primed.worldPoint.copy(hitPoint);
    primed.lastHitNormal.copy(hitNormal);
    primed.breakRadius = Math.max(Number(primed.breakRadius) || 0, scaledRadii.breakRadius);
    primed.primeMatchRadius = Math.max(Number(primed.primeMatchRadius) || 0, scaledRadii.primeMatchRadius);
    groupDamageCandidates(fighter, primed.groupId).forEach((candidate) => {
      candidate.hits = Math.max(candidate.hits, primed.hits);
      candidate.requiredHits = requiredHits;
      candidate.damage = Math.max(candidate.damage, primed.damage);
      candidate.maxHitDamage = Math.max(candidate.maxHitDamage || 0, primed.maxHitDamage || damage);
      candidate.releaseWhenReady = candidate.releaseWhenReady || primed.hits >= requiredHits;
      candidate.lastHitAt = primed.lastHitAt;
      candidate.breakRadius = Math.max(Number(candidate.breakRadius) || 0, primed.breakRadius || scaledRadii.breakRadius);
      candidate.primeMatchRadius = Math.max(Number(candidate.primeMatchRadius) || 0, primed.primeMatchRadius || scaledRadii.primeMatchRadius);
    });
    if (primed.hits < requiredHits) {
      fighter.physicalDamageLastResult = workerResultStatus(primed);
      return { primed: true, hits: primed.hits, requiredHits };
    }
    primed.interiorForceHits = interiorForceHitCount(options, primed.maxHitDamage || damage);
    if (primed.status === "deferred-interior" && primed.hits >= primed.interiorForceHits) {
      primed.allowInteriorBreak = true;
      primed.status = "ready";
      primed.releaseWhenReady = true;
    }
    if (primed.status === "deferred-interior") {
      fighter.physicalDamageLastResult = workerResultStatus(primed);
      return {
        primed: true,
        deferredInterior: true,
        hits: primed.hits,
        requiredHits,
        interiorFraction: primed.interiorFraction ?? null,
      };
    }
    const readyCandidate = firstReadyCandidateInGroup(fighter, primed);
    if (readyCandidate) {
      fighter.physicalDamageLastResult = { status: "committing", hits: readyCandidate.hits, requiredHits, triangles: readyCandidate.split.triangleCount };
      return commitPhysicalDamageBreak({
        fighter,
        candidate: readyCandidate,
        hitNormal,
        damage: readyCandidate.damage,
        options: {
          ...options,
          breakRadius: readyCandidate.breakRadius || options.breakRadius,
          primeMatchRadius: readyCandidate.primeMatchRadius || options.primeMatchRadius,
        },
        arena,
        RAPIER,
        createArenaProp,
        interiorMaterial,
        originalMaterialFallback,
        onCommitted,
        onStatusChanged,
      });
    }
    if (primed.status !== "ready") {
      if (primed.status === "deferred-interior") {
        fighter.physicalDamageLastResult = workerResultStatus(primed);
        return { primed: true, deferredInterior: true, hits: primed.hits, requiredHits };
      }
      primed.releaseWhenReady = true;
      const alternateCount = groupDamageCandidates(fighter, primed.groupId).length;
      if (alternateCount < 3) {
        const alternate = makePhysicalDamageCandidate({
          target,
          hitPoint,
          hitNormal,
          hits: primed.hits,
          requiredHits,
          damage: primed.damage,
          maxHitDamage: primed.maxHitDamage || damage,
          groupId: primed.groupId,
          releaseWhenReady: true,
          allowInteriorBreak,
          capBounds: capBoundsForHit,
          interiorBounds: interiorBoundsForHit,
          damageZone,
        });
        fighter.physicalDamagePrimedBreaks ||= [];
        fighter.physicalDamagePrimedBreaks.push(alternate);
        schedulePhysicalDamagePrepare(alternate, {
          fighter,
          arena,
          RAPIER,
          createArenaProp,
          interiorMaterial,
          originalMaterialFallback,
          options,
          onCommitted,
          onStatusChanged,
        }, target, hitNormal, { ...options, breakRadius: alternate.breakRadius || scaledRadii.breakRadius });
      }
      fighter.physicalDamageLastResult = workerResultStatus(primed);
      return { primed: true, calculating: true, hits: primed.hits, requiredHits };
    }
    fighter.physicalDamageLastResult = { status: "committing", hits: primed.hits, requiredHits, triangles: primed.split.triangleCount };
    return commitPhysicalDamageBreak({
      fighter,
      candidate: primed,
      hitNormal,
      damage: primed.damage,
      options: {
        ...options,
        breakRadius: primed.breakRadius || options.breakRadius,
        primeMatchRadius: primed.primeMatchRadius || options.primeMatchRadius,
      },
      arena,
      RAPIER,
      createArenaProp,
      interiorMaterial,
      originalMaterialFallback,
      onCommitted,
    });
  }

  const candidate = makePhysicalDamageCandidate({
    target,
    hitPoint,
    hitNormal,
    hits: 1,
    requiredHits,
    damage,
    maxHitDamage: damage,
    groupId: nextPhysicalDamageGroupId++,
    releaseWhenReady: requiredHits <= 1,
    allowInteriorBreak,
    capBounds: capBoundsForHit,
    interiorBounds: interiorBoundsForHit,
    damageZone,
    targetMesh,
    breakRadius: scaledRadii.breakRadius,
    primeMatchRadius: scaledRadii.primeMatchRadius,
  });
  fighter.physicalDamagePrimedBreaks ||= [];
  fighter.physicalDamagePrimedBreaks = fighter.physicalDamagePrimedBreaks.filter((item) => !item.committed && item.sourceGeometry === item.mesh?.geometry);
  fighter.physicalDamagePrimedBreaks.push(candidate);
  fighter.physicalDamagePrimedAt ||= [];
  fighter.physicalDamagePrimedAt.push({
    point: hitPoint.clone(),
    damage,
    breakRadius: candidate.breakRadius,
    primeMatchRadius: candidate.primeMatchRadius,
    triangles: 0,
  });
  const context = {
    fighter,
    arena,
    RAPIER,
    createArenaProp,
    interiorMaterial,
    originalMaterialFallback,
    options,
    onCommitted,
    onStatusChanged,
  };
  schedulePhysicalDamagePrepare(candidate, context, target, hitNormal, { ...options, breakRadius: candidate.breakRadius });
  fighter.physicalDamageLastResult = workerResultStatus(candidate);
  return { primed: true, queued: true, hits: 1, requiredHits };
}

export function applyPhysicalDamageBreak({
  fighter,
  worldPoint,
  worldNormal,
  rawDamage = 0,
  options = DEFAULT_PHYSICAL_DAMAGE_OPTIONS,
  arena,
  RAPIER,
  createArenaProp,
  interiorMaterial,
  originalMaterialFallback,
  onCommitted,
  onStatusChanged,
  allowInteriorBreak = false,
  damageZone = null,
  targetMesh = null,
}) {
  const markResult = (status, extra = {}) => {
    if (fighter) fighter.physicalDamageLastResult = { status, ...extra };
    return null;
  };
  // Physics-frame boundary: this function is called from collision callbacks
  // inside the animation/physics substep. Keep it scalar-only: no mesh traversal,
  // bounding boxes, geometry snapshots, preview construction, collider edits, or
  // split work. Those operations belong in schedulePhysicalDamageHit(),
  // schedulePhysicalDamagePrepare(), commitPhysicalDamageBreak(), and ultimately
  // the physical-damage worker.
  if (!options.enabled || !fighter?.group || !fighter?.rb || !arena?.world || !RAPIER || !createArenaProp) return null;
  if ((fighter.physicalDamagePieces || 0) >= options.maxPiecesPerBot) return markResult("max-pieces");
  if (!finiteVector(worldPoint)) return markResult("missing-point");
  const damage = Math.max(0, Number(rawDamage) || 0) / Math.max(0.05, options.resilience);
  if (damage < options.threshold) return markResult("below-threshold", { damage, threshold: options.threshold });

  schedulePhysicalDamageHit({
    fighter,
    worldPoint: { x: worldPoint.x, y: worldPoint.y, z: worldPoint.z },
    worldNormal: finiteVector(worldNormal) ? { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z } : null,
    rawDamage,
    options: { ...options },
    arena,
    RAPIER,
    createArenaProp,
    interiorMaterial,
    originalMaterialFallback,
    onCommitted,
    onStatusChanged,
    allowInteriorBreak,
    damageZone,
    targetMesh,
  });
  fighter.physicalDamageLastResult = { status: "hit-queued", damage, threshold: options.threshold };
  return { queued: true, deferred: true, damage, threshold: options.threshold };
}
