import * as THREE from "three";

const DEFAULT_SCREW_HAZARD_SETTINGS = {
  // Distances are feet; angular speeds are radians per second.
  depth: 2,
  rotationSpeed: 5.2,
  capLength: 0.72,
  capHeight: 1.29,
  minCapDepth: 1.08,
  capDepthPadding: 0.28,
  bladeRadiusScale: 0.375,
  minBladeRadius: 0.56,
  maxBladeRadius: 1.1,
  axisRadiusScale: 0.36,
  minAxisY: 0.46,
  axisYOffset: 0.08,
  pitch: 1.1,
  // Linear speed thresholds are feet per second. Damage values are hp.
  impactSpeedThreshold: 0.85,
  impactDamageScale: 10,
  // Held-contact damage rates are hp per second at full pressure.
  pressureDamageBase: 100,
  // Adds hp per second for each ft/s of screw surface speed at full pressure.
  pressureDamageSpeedScale: 4.167,
  // Seconds between screw hazard damage applications.
  damageCooldown: 0.18,
  minRecordedDamage: 0.22,
  contactPressureThreshold: 0.18,
  pressureSparkThreshold: 0.35,
  sparkCooldown: 0.24,
  baseInwardImpulse: 0.026,
  speedInwardImpulseScale: 0.012,
  maxInwardImpulse: 11,
  baseLiftImpulse: 0.018,
  speedLiftImpulseScale: 0.008,
  maxLiftImpulse: 7.5,
  radialImpulseScale: 0.026,
  maxRadialImpulse: 5.5,
  unstableSeconds: 1.1,
  unstablePressureSeconds: 0.8,
  torqueXScale: 0.008,
  torqueYScale: 0.005,
  torqueZScale: 0.012,
};

const DEFAULT_KILL_SAW_SETTINGS = {
  // Distances are feet; angular speeds are radians per second.
  bladeRadiusScale: 0.55,
  minBladeRadius: 0.52,
  maxBladeRadius: 0.82,
  bladeThickness: 0.12,
  maxExposureFraction: 0.5,
  stowedDepth: 0.08,
  upSecondsMin: 10,
  upSecondsMax: 15,
  downSecondsMin: 5,
  downSecondsMax: 10,
  riseSeconds: 0.42,
  sinkSeconds: 0.42,
  rotationSpeed: 30,
  contactPressureThreshold: 0.05,
  damageCooldown: 0.1,
  damageRate: 34,
  speedDamageScale: 0.42,
  damageMultiplier: 10,
  minRecordedDamage: 0.18,
  basePushImpulse: 0.034,
  speedPushImpulseScale: 0.0032,
  maxPushImpulse: 8.5,
  liftImpulseScale: 0.018,
  maxLiftImpulse: 4.5,
  rideLiftImpulseScale: 0.04,
  maxRideLiftImpulse: 9,
  risingLiftImpulseScale: 0.032,
  maxRisingLiftImpulse: 7,
  torqueScale: 0.006,
  unstableSeconds: 0.72,
  sparkCooldown: 0.12,
  sparkSurfaceThreshold: 0.08,
};

function arenaNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function elementSize(element, fallback = [1, 1]) {
  return [
    Math.max(0.01, arenaNumber(element?.size?.x, fallback[0])),
    Math.max(0.01, arenaNumber(element?.size?.z, fallback[1])),
  ];
}

export function screwHazardSettings(layout = {}) {
  const source = layout.screwHazards || {};
  const settings = {};
  Object.entries(DEFAULT_SCREW_HAZARD_SETTINGS).forEach(([key, fallback]) => {
    settings[key] = arenaNumber(source[key], fallback);
  });
  settings.depth = Math.max(0.5, settings.depth);
  settings.capLength = Math.max(0.1, settings.capLength);
  settings.capHeight = Math.max(0.1, settings.capHeight);
  settings.damageCooldown = Math.max(0.02, settings.damageCooldown);
  settings.minRecordedDamage = Math.max(0, settings.minRecordedDamage);
  settings.contactPressureThreshold = THREE.MathUtils.clamp(settings.contactPressureThreshold, 0, 0.9);
  settings.sparkCooldown = Math.max(0.02, settings.sparkCooldown);
  return settings;
}

export function screwHazardDepth(layout) {
  return screwHazardSettings(layout).depth;
}

export function screwHazardRotationSpeed(layout) {
  return screwHazardSettings(layout).rotationSpeed;
}

export function killSawHazardSettings(layout = {}) {
  const source = layout.killSawHazards || {};
  const settings = {};
  Object.entries(DEFAULT_KILL_SAW_SETTINGS).forEach(([key, fallback]) => {
    settings[key] = arenaNumber(source[key], fallback);
  });
  settings.bladeRadiusScale = Math.max(0.01, settings.bladeRadiusScale);
  settings.minBladeRadius = Math.max(0.08, settings.minBladeRadius);
  settings.maxBladeRadius = Math.max(settings.minBladeRadius, settings.maxBladeRadius);
  settings.bladeThickness = Math.max(0.01, settings.bladeThickness);
  settings.maxExposureFraction = THREE.MathUtils.clamp(settings.maxExposureFraction, 0.05, 1);
  settings.upSecondsMin = Math.max(0.2, settings.upSecondsMin);
  settings.upSecondsMax = Math.max(settings.upSecondsMin, settings.upSecondsMax);
  settings.downSecondsMin = Math.max(0.2, settings.downSecondsMin);
  settings.downSecondsMax = Math.max(settings.downSecondsMin, settings.downSecondsMax);
  settings.riseSeconds = Math.max(0.02, settings.riseSeconds);
  settings.sinkSeconds = Math.max(0.02, settings.sinkSeconds);
  settings.damageCooldown = Math.max(0.02, settings.damageCooldown);
  settings.contactPressureThreshold = THREE.MathUtils.clamp(settings.contactPressureThreshold, 0, 0.9);
  settings.sparkCooldown = Math.max(0.02, settings.sparkCooldown);
  settings.damageMultiplier = Math.max(0, settings.damageMultiplier);
  settings.rideLiftImpulseScale = Math.max(0, settings.rideLiftImpulseScale);
  settings.maxRideLiftImpulse = Math.max(0, settings.maxRideLiftImpulse);
  return settings;
}

export function killSawHazardRotationSpeed(layout) {
  return killSawHazardSettings(layout).rotationSpeed;
}

export const SCREW_LOCAL_FRONT = Object.freeze({ x: 0, y: 0, z: -1 });
export const SCREW_LOCAL_EXTERIOR = Object.freeze({ x: 0, y: 0, z: 1 });

export function screwFrontDirection(yaw) {
  return localScrewVectorToWorld(yaw, SCREW_LOCAL_FRONT);
}

export function screwInwardRotation(position, { arenaHalfWidth, arenaHalfLength }) {
  const west = Math.abs(position.x + arenaHalfWidth);
  const east = Math.abs(arenaHalfWidth - position.x);
  const north = Math.abs(position.z + arenaHalfLength);
  const south = Math.abs(arenaHalfLength - position.z);
  const nearest = Math.min(west, east, north, south);
  // Screw assemblies use local -Z as their front/inward face and local +Z as the exterior wall face.
  if (nearest === west) return -Math.PI / 2;
  if (nearest === east) return Math.PI / 2;
  if (nearest === north) return Math.PI;
  return 0;
}

export function screwHazardDimensions(element, { layout, floorY = 0 } = {}) {
  const settings = screwHazardSettings(layout);
  const size = elementSize(element, [4.8, 0.78]);
  const totalLength = Math.max(1.9, size[0]);
  const capLength = Math.min(settings.capLength, totalLength * 0.22);
  const screwLength = Math.max(0.8, totalLength - capLength * 2);
  const bladeRadius = THREE.MathUtils.clamp(
    settings.depth * settings.bladeRadiusScale,
    settings.minBladeRadius,
    settings.maxBladeRadius,
  );
  const axisRadius = bladeRadius * settings.axisRadiusScale;
  const axisY = floorY + Math.max(settings.minAxisY, bladeRadius + settings.axisYOffset);
  const capDepth = Math.max(settings.minCapDepth, settings.depth + settings.capDepthPadding);
  return {
    settings,
    size,
    totalLength,
    depth: settings.depth,
    capLength,
    capHeight: settings.capHeight,
    capDepth,
    screwLength,
    bladeRadius,
    axisRadius,
    axisY,
    pitch: settings.pitch,
  };
}

function createHazardFloorDecal(size, material, pos = [0, 0], rotation = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.rotation.z = rotation;
  mesh.position.set(pos[0], 0.012, pos[1]);
  mesh.receiveShadow = true;
  return mesh;
}

function createHazardCylinder(radius, depth, material, pos, rot, segments = 48) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, depth, segments), material);
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function createTrapezoidBlockGeometry(width, height, depth, topDepth = depth * 0.68) {
  const hw = width / 2;
  const hd = depth / 2;
  const htd = topDepth / 2;
  const vertices = new Float32Array([
    -hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd,
    -hw, height, -htd, hw, height, -htd, hw, height, htd, -hw, height, htd,
  ]);
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
    0, 4, 5, 0, 5, 1,
    1, 5, 6, 1, 6, 2,
    2, 6, 7, 2, 7, 3,
    3, 7, 4, 3, 4, 0,
  ];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createScrewFlightGeometry(length, axisRadius, bladeRadius, pitch = 1.15) {
  const halfLength = length / 2;
  const turnsPerHalf = Math.max(0.55, halfLength / pitch);
  const stepsPerHalf = Math.max(18, Math.ceil(turnsPerHalf * 28));
  const bladeWidth = Math.min(0.34, pitch * 0.34);
  const toothCount = Math.max(4, Math.round(halfLength / 0.28));
  const positions = [];
  const uvs = [];
  const indices = [];
  const pushVertex = (x, radius, angle, u, v) => {
    positions.push(x, Math.cos(angle) * radius, Math.sin(angle) * radius);
    uvs.push(u, v);
    return positions.length / 3 - 1;
  };

  const addMirroredHalf = (side) => {
    const ring = [];
    for (let i = 0; i <= stepsPerHalf; i += 1) {
      const t = i / stepsPerHalf;
      const outwardDistance = t * halfLength;
      const x = side * outwardDistance;
      // Equal distances from center share phase; d(angle)/dx flips by side, so the blade is mirrored at x=0.
      const angle = t * turnsPerHalf * Math.PI * 2;
      const toothPhase = (t * toothCount) % 1;
      const serration = toothPhase < 0.58 ? toothPhase / 0.58 : 1 - (toothPhase - 0.58) / 0.42;
      const tipRadius = bladeRadius * (0.86 + serration * 0.18);
      const u = outwardDistance / pitch;
      ring.push([
        pushVertex(x - side * bladeWidth * 0.5, axisRadius * 1.03, angle, u, 0),
        pushVertex(x, tipRadius, angle, u + 0.15, 1),
        pushVertex(x + side * bladeWidth * 0.5, axisRadius * 1.03, angle, u + 0.3, 0),
      ]);
    }

    for (let i = 0; i < stepsPerHalf; i += 1) {
      for (let j = 0; j < 2; j += 1) {
        const a = ring[i][j];
        const b = ring[i + 1][j];
        const c = ring[i + 1][j + 1];
        const d = ring[i][j + 1];
        if (side < 0) indices.push(a, d, b, b, d, c);
        else indices.push(a, b, d, b, c, d);
      }
    }
  };

  addMirroredHalf(-1);
  addMirroredHalf(1);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addScrewEndCap(parent, x, dims, barrierMat) {
  const { capLength, capHeight, capDepth } = dims;
  const cap = new THREE.Group();
  cap.position.x = x;
  cap.userData.frontLocal = SCREW_LOCAL_FRONT;
  cap.userData.exteriorLocal = SCREW_LOCAL_EXTERIOR;
  parent.add(cap);

  const base = new THREE.Mesh(createTrapezoidBlockGeometry(capLength, capHeight, capDepth), barrierMat);
  base.position.y = 0.02;
  base.castShadow = true;
  base.receiveShadow = true;
  cap.add(base);
}

export function createScrewHazardElement({
  element,
  materials,
  layout,
  arenaHalfWidth,
  arenaHalfLength,
  floorY = 0,
  idFallback = "screw",
}) {
  const position = {
    x: arenaNumber(element?.position?.x, 0),
    z: arenaNumber(element?.position?.z, 0),
  };
  const dims = screwHazardDimensions(element, { layout, floorY });
  const rotation = screwInwardRotation(position, { arenaHalfWidth, arenaHalfLength });

  const group = new THREE.Group();
  group.position.set(position.x, floorY, position.z);
  group.rotation.y = rotation;
  group.userData.frontLocal = SCREW_LOCAL_FRONT;
  group.userData.exteriorLocal = SCREW_LOCAL_EXTERIOR;
  group.userData.frontWorld = screwFrontDirection(rotation);

  group.add(createHazardFloorDecal(
    [Math.max(0.2, dims.screwLength), Math.max(0.18, dims.depth * 0.72)],
    materials.hazardSlotMat,
    [0, 0],
    0,
  ));
  addScrewEndCap(group, -dims.totalLength / 2 + dims.capLength / 2, dims, materials.barrierMat);
  addScrewEndCap(group, dims.totalLength / 2 - dims.capLength / 2, dims, materials.barrierMat);

  const core = new THREE.Group();
  core.position.y = dims.axisY;
  core.userData.rotationAxis = "x";
  core.userData.rotationSpeed = screwHazardRotationSpeed(layout);
  group.add(core);

  const shaft = createHazardCylinder(dims.axisRadius, dims.screwLength, materials.screwMat, [0, 0, 0], [0, 0, Math.PI / 2], 36);
  core.add(shaft);

  const flight = new THREE.Mesh(createScrewFlightGeometry(dims.screwLength, dims.axisRadius, dims.bladeRadius, dims.pitch), materials.screwMat);
  flight.material.side = THREE.DoubleSide;
  flight.castShadow = true;
  flight.receiveShadow = true;
  core.add(flight);

  const centerCollar = createHazardCylinder(dims.axisRadius * 1.32, 0.18, materials.screwMat, [0, 0, 0], [0, 0, Math.PI / 2], 36);
  centerCollar.castShadow = true;
  core.add(centerCollar);

  for (const x of [-dims.screwLength / 2, dims.screwLength / 2]) {
    const collar = createHazardCylinder(dims.axisRadius * 1.18, 0.12, materials.screwMat, [x, 0, 0], [0, 0, Math.PI / 2], 32);
    collar.castShadow = true;
    core.add(collar);
  }

  const hazard = {
    id: element.id || idFallback,
    element,
    group,
    core,
    position,
    yaw: rotation,
    frontLocal: SCREW_LOCAL_FRONT,
    exteriorLocal: SCREW_LOCAL_EXTERIOR,
    frontWorld: screwFrontDirection(rotation),
    ...dims,
    rotationSpeed: screwHazardRotationSpeed(layout),
  };

  return { group, core, hazard };
}

export function killSawHazardDimensions(element, { layout } = {}) {
  const settings = killSawHazardSettings(layout);
  const size = elementSize(element, [1.82, 0.82]);
  const radius = THREE.MathUtils.clamp(
    Math.max(size[0], size[1]) * settings.bladeRadiusScale,
    settings.minBladeRadius,
    settings.maxBladeRadius,
  );
  return {
    settings,
    size,
    radius,
    diameter: radius * 2,
    thickness: settings.bladeThickness,
    maxRise: radius * 2 * settings.maxExposureFraction,
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return () => {
    let t = seed += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededRange(random, min, max) {
  return min + (max - min) * random();
}

function nextKillSawPairDuration(pair, settings, up) {
  return up
    ? seededRange(pair.random, settings.upSecondsMin, settings.upSecondsMax)
    : seededRange(pair.random, settings.downSecondsMin, settings.downSecondsMax);
}

function roundedLaneKey(value) {
  return Math.round(value * 1000) / 1000;
}

function killSawPairAxis(hazard) {
  const rotation = Math.abs((((THREE.MathUtils.radToDeg(hazard.yaw) % 180) + 180) % 180));
  return rotation > 45 && rotation < 135 ? "x" : "z";
}

function groupedKillSawPairClusters(hazards) {
  const lanes = new Map();
  hazards.forEach((hazard) => {
    const axis = killSawPairAxis(hazard);
    const laneValue = axis === "x" ? hazard.position.z : hazard.position.x;
    const key = `${axis}:${roundedLaneKey(laneValue)}`;
    if (!lanes.has(key)) lanes.set(key, { axis, hazards: [] });
    lanes.get(key).hazards.push(hazard);
  });

  const clusters = [];
  lanes.forEach((lane) => {
    const along = lane.axis === "x" ? "x" : "z";
    const sorted = lane.hazards.slice().sort((a, b) => a.position[along] - b.position[along]);
    for (let i = 0; i < sorted.length;) {
      const group = [sorted[i]];
      let j = i + 1;
      while (
        j < sorted.length &&
        Math.abs(sorted[j].position[along] - sorted[i].position[along]) < 0.08
      ) {
        group.push(sorted[j]);
        j += 1;
      }
      if (j < sorted.length) {
        group.push(sorted[j]);
        const mateCoordinate = sorted[j].position[along];
        j += 1;
        while (
          j < sorted.length &&
          Math.abs(sorted[j].position[along] - mateCoordinate) < 0.08
        ) {
          group.push(sorted[j]);
          j += 1;
        }
      }
      clusters.push(group);
      i = j;
    }
  });
  return clusters;
}

function ensureKillSawPairs(arena) {
  if (arena.killSawPairs?.length || !arena?.killSawHazards?.length) return arena.killSawPairs || [];
  const pairs = groupedKillSawPairClusters(arena.killSawHazards).map((hazards) => {
    const id = hazards.map((candidate) => candidate.id).sort().join("+");
    const seed = hashString(`${id}:${Math.floor(Math.random() * 0xffffffff)}`);
    return {
      id,
      seed,
      random: mulberry32(seed),
      hazards,
      initialized: false,
      state: "down",
      elapsed: 0,
      duration: 0,
      exposure: 0,
    };
  });
  arena.killSawPairs = pairs;
  return pairs;
}

export function createKillSawHazardElement({
  element,
  materials,
  layout,
  floorY = 0,
  idFallback = "kill-saw",
}) {
  const position = {
    x: arenaNumber(element?.position?.x, 0),
    z: arenaNumber(element?.position?.z, 0),
  };
  const yaw = THREE.MathUtils.degToRad(arenaNumber(element?.rotation, 0));
  const dims = killSawHazardDimensions(element, { layout });
  const group = new THREE.Group();
  group.position.set(position.x, floorY, position.z);
  group.rotation.y = yaw;

  group.add(createHazardFloorDecal(
    [Math.max(0.36, dims.size[0] * 0.78), Math.max(0.055, dims.size[1] * 0.14)],
    materials.hazardSlotMat,
    [0, 0],
    0,
  ));

  const blade = new THREE.Mesh(new THREE.PlaneGeometry(dims.diameter, dims.diameter), materials.killSawBladeMat);
  blade.position.y = -dims.radius - settingsSafeStowedDepth(dims.settings);
  blade.material.side = THREE.DoubleSide;
  blade.castShadow = true;
  blade.receiveShadow = true;
  group.add(blade);

  const hazard = {
    id: element.id || idFallback,
    element,
    group,
    blade,
    position,
    yaw,
    floorY,
    ...dims,
    rotationSpeed: killSawHazardRotationSpeed(layout),
    exposure: 0,
    riseSpeed: 0,
    bladeCenterY: -dims.radius - settingsSafeStowedDepth(dims.settings),
    active: false,
  };

  return { group, blade, hazard };
}

function settingsSafeStowedDepth(settings) {
  return Math.max(0, settings?.stowedDepth || 0);
}

export function updateKillSawHazardVisuals({
  arena,
  enabled = true,
  dt = 0,
}) {
  if (!arena?.killSawHazards?.length) return;
  const pairs = ensureKillSawPairs(arena);
  if (!enabled) {
    pairs.forEach((pair) => {
      pair.initialized = false;
      pair.state = "down";
      pair.elapsed = 0;
      pair.duration = 0;
      pair.exposure = 0;
    });
  }

  pairs.forEach((pair) => {
    const settings = pair.hazards[0]?.settings || {};
    if (enabled && !pair.initialized) {
      const startsUp = pair.random() < 0.5;
      pair.initialized = true;
      pair.state = startsUp ? "up" : "down";
      pair.elapsed = 0;
      pair.duration = nextKillSawPairDuration(pair, settings, startsUp);
      pair.exposure = startsUp ? 1 : 0;
    } else if (enabled) {
      pair.elapsed += Math.max(0, dt);
      if (pair.state === "up" && pair.elapsed >= pair.duration) {
        pair.state = "sinking";
        pair.elapsed = 0;
        pair.duration = settings.sinkSeconds;
      } else if (pair.state === "sinking" && pair.elapsed >= pair.duration) {
        pair.state = "down";
        pair.elapsed = 0;
        pair.duration = nextKillSawPairDuration(pair, settings, false);
      } else if (pair.state === "down" && pair.elapsed >= pair.duration) {
        pair.state = "rising";
        pair.elapsed = 0;
        pair.duration = settings.riseSeconds;
      } else if (pair.state === "rising" && pair.elapsed >= pair.duration) {
        pair.state = "up";
        pair.elapsed = 0;
        pair.duration = nextKillSawPairDuration(pair, settings, true);
      }

      if (pair.state === "up") pair.exposure = 1;
      else if (pair.state === "down") pair.exposure = 0;
      else if (pair.state === "rising") pair.exposure = THREE.MathUtils.smoothstep(pair.elapsed / Math.max(0.001, pair.duration), 0, 1);
      else if (pair.state === "sinking") pair.exposure = 1 - THREE.MathUtils.smoothstep(pair.elapsed / Math.max(0.001, pair.duration), 0, 1);
    }

    pair.hazards.forEach((hazard) => {
      const previousCenterY = Number.isFinite(hazard.bladeCenterY)
        ? hazard.bladeCenterY
        : hazard.blade.position.y;
      hazard.exposure = pair.exposure;
      hazard.active = hazard.exposure > 0.02;
      const rise = hazard.maxRise * hazard.exposure;
      const bladeCenterY = -hazard.radius - settingsSafeStowedDepth(hazard.settings) + rise;
      hazard.bladeCenterY = bladeCenterY;
      hazard.riseSpeed = dt > 0 ? Math.max(0, (bladeCenterY - previousCenterY) / dt) : 0;
      hazard.blade.position.y = bladeCenterY;
      if (hazard.blockBody?.setNextKinematicTranslation) {
        hazard.blockBody.setNextKinematicTranslation({
          x: hazard.position.x,
          y: (hazard.floorY || 0) + bladeCenterY,
          z: hazard.position.z,
        });
      } else if (hazard.blockBody?.setTranslation) {
        hazard.blockBody.setTranslation({
          x: hazard.position.x,
          y: (hazard.floorY || 0) + bladeCenterY,
          z: hazard.position.z,
        }, true);
      }
      if (enabled && hazard.blade) hazard.blade.rotation.z += (hazard.rotationSpeed || 0) * dt;
    });
  });
}

export function localScrewVectorToWorld(yaw, local) {
  return new THREE.Vector3(local.x, local.y, local.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
}

export function localScrewPointToWorld(hazard, local, floorY = 0) {
  const offset = localScrewVectorToWorld(hazard.yaw, local);
  return new THREE.Vector3(hazard.position.x + offset.x, floorY + offset.y, hazard.position.z + offset.z);
}

function worldPointToLocalScrew(hazard, point, floorY = 0) {
  return new THREE.Vector3(
    point.x - hazard.position.x,
    point.y - floorY,
    point.z - hazard.position.z,
  ).applyAxisAngle(new THREE.Vector3(0, 1, 0), -hazard.yaw);
}

function worldVectorToLocalScrew(hazard, vector) {
  return new THREE.Vector3(vector.x, vector.y, vector.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -hazard.yaw);
}

function fighterVerticalHalfExtent(fighter) {
  const parts = fighter?.colliderParts || fighter?.physics2?.parts || [];
  let minY = Infinity;
  let maxY = -Infinity;
  const scale = fighter?.visualScale || 1;
  parts.forEach((part) => {
    if (part?.part === "driveContact" || !part?.halfExtents || !part?.position) return;
    const centerY = (Number(part.position[1]) || 0) * scale;
    const halfY = Math.abs(Number(part.halfExtents[1]) || 0) * scale;
    minY = Math.min(minY, centerY - halfY);
    maxY = Math.max(maxY, centerY + halfY);
  });
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return 0.45;
  return Math.max(0.12, (maxY - minY) * 0.5);
}

function fighterRotation(fighter) {
  const q = fighter?.rb?.rotation?.();
  return q
    ? new THREE.Quaternion(q.x, q.y, q.z, q.w)
    : new THREE.Quaternion();
}

function screwColliderContact(fighter, hazard, floorY = 0) {
  const parts = (fighter?.colliderParts || fighter?.physics2?.parts || [])
    .filter((part) => part?.part !== "driveContact" && part?.halfExtents && part?.position);
  if (!fighter?.rb || !parts.length) return null;
  const bodyPosition = fighter.rb.translation();
  const bodyOrigin = new THREE.Vector3(bodyPosition.x, bodyPosition.y, bodyPosition.z);
  const bodyRotation = fighterRotation(fighter);
  const scale = fighter.visualScale || 1;
  let best = null;
  const sampleSteps = [-1, 0, 1];
  parts.forEach((part) => {
    const half = part.halfExtents.map((value) => Math.abs(Number(value) || 0) * scale);
    const center = new THREE.Vector3(...part.position).multiplyScalar(scale);
    const partRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0])));
    sampleSteps.forEach((xSign) => {
      sampleSteps.forEach((ySign) => {
        sampleSteps.forEach((zSign) => {
          const localPartPoint = new THREE.Vector3(half[0] * xSign, half[1] * ySign, half[2] * zSign)
            .applyQuaternion(partRotation)
            .add(center);
          const worldPoint = localPartPoint.applyQuaternion(bodyRotation).add(bodyOrigin);
          const screwLocal = worldPointToLocalScrew(hazard, worldPoint, floorY);
          if (Math.abs(screwLocal.x) > hazard.screwLength / 2 + 0.08) return;
          const dy = screwLocal.y - hazard.axisY;
          if (Math.abs(dy) > hazard.bladeRadius + 0.08) return;
          const radialDistance = Math.hypot(screwLocal.z, dy);
          const penetration = hazard.bladeRadius - radialDistance;
          if (penetration <= 0) return;
          const overlapPressure = THREE.MathUtils.clamp(penetration / Math.max(0.001, hazard.bladeRadius), 0, 1);
          if (!best || overlapPressure > best.overlapPressure) {
            const radialScale = radialDistance > 0.001 ? hazard.bladeRadius / radialDistance : 1;
            best = {
              overlapPressure,
              radialDistance,
              local: screwLocal,
              closestLocalDy: dy,
              contactPoint: localScrewPointToWorld(hazard, {
                x: THREE.MathUtils.clamp(screwLocal.x, -hazard.screwLength / 2, hazard.screwLength / 2),
                y: hazard.axisY + dy * radialScale,
                z: screwLocal.z * radialScale,
              }, floorY),
            };
          }
        });
      });
    });
  });
  return best;
}

function colliderYawRotation(yaw, extra = new THREE.Quaternion()) {
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)).multiply(extra);
  return { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
}

function createFixedColliderBody(RAPIER, world, position, yaw = 0) {
  return world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z)
      .setRotation(colliderYawRotation(yaw)),
  );
}

function createFixedColliderBodyWithRotation(RAPIER, world, position, rotation) {
  return world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z)
      .setRotation({ x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }),
  );
}

export function addScrewPhysicsColliders({ RAPIER, world, screwHazards = [], floorY = 0 }) {
  const shaftAxisRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
  screwHazards.forEach((hazard) => {
    const shaftRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hazard.yaw, 0)).multiply(shaftAxisRotation);
    const shaftBody = createFixedColliderBodyWithRotation(RAPIER, world, { x: hazard.position.x, y: hazard.axisY, z: hazard.position.z }, shaftRotation);
    const shaft = world.createCollider(
      RAPIER.ColliderDesc.cylinder(hazard.screwLength / 2, hazard.axisRadius * 1.12)
        .setFriction(0.85)
        .setRestitution(0.03),
      shaftBody,
    );
    shaft.userData = { kind: "screwShaft", hazardId: hazard.id };

    const coreBody = createFixedColliderBody(RAPIER, world, { x: hazard.position.x, y: hazard.axisY, z: hazard.position.z }, hazard.yaw);
    const bladeSensor = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hazard.screwLength / 2, hazard.bladeRadius, hazard.bladeRadius)
        .setSensor(true),
      coreBody,
    );
    bladeSensor.userData = { kind: "screwBladeSensor", hazardId: hazard.id };

    for (const side of [-1, 1]) {
      const capCenter = localScrewPointToWorld(hazard, {
        x: side * (hazard.totalLength / 2 - hazard.capLength / 2),
        y: hazard.capHeight / 2,
        z: 0,
      }, floorY);
      const capBody = createFixedColliderBody(RAPIER, world, capCenter, hazard.yaw);
      const cap = world.createCollider(
        RAPIER.ColliderDesc.cuboid(hazard.capLength / 2, hazard.capHeight / 2, hazard.capDepth / 2)
          .setFriction(1.1)
          .setRestitution(0.04),
        capBody,
      );
      cap.userData = { kind: "screwCap", hazardId: hazard.id, side };
    }
  });
}

function worldPointToLocalKillSaw(hazard, point, floorY = 0) {
  return new THREE.Vector3(
    point.x - hazard.position.x,
    point.y - floorY,
    point.z - hazard.position.z,
  ).applyAxisAngle(new THREE.Vector3(0, 1, 0), -hazard.yaw);
}

function localKillSawVectorToWorld(hazard, local) {
  return new THREE.Vector3(local.x, local.y, local.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), hazard.yaw);
}

function worldVectorToLocalKillSaw(hazard, vector) {
  return new THREE.Vector3(vector.x, vector.y, vector.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), -hazard.yaw);
}

function localKillSawPointToWorld(hazard, local, floorY = 0) {
  const offset = localKillSawVectorToWorld(hazard, local);
  return new THREE.Vector3(hazard.position.x + offset.x, floorY + offset.y, hazard.position.z + offset.z);
}

export function addKillSawPhysicsColliders({ RAPIER, world, killSawHazards = [], floorY = 0 }) {
  killSawHazards.forEach((hazard) => {
    const rotation = colliderYawRotation(hazard.yaw);
    const blockBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(hazard.position.x, floorY + hazard.bladeCenterY, hazard.position.z)
        .setRotation(rotation),
    );
    const blockCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hazard.radius, hazard.radius, hazard.thickness)
        .setSensor(true),
      blockBody,
    );
    blockCollider.userData = { kind: "killSawLiftSensor", hazardId: hazard.id };
    hazard.blockBody = blockBody;
    hazard.blockCollider = blockCollider;

    const sensorBody = createFixedColliderBody(
      RAPIER,
      world,
      { x: hazard.position.x, y: floorY + Math.max(0.05, hazard.radius * 0.5), z: hazard.position.z },
      hazard.yaw,
    );
    const sensor = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hazard.radius, Math.max(0.06, hazard.radius * 0.5), hazard.thickness)
        .setSensor(true),
      sensorBody,
    );
    sensor.userData = { kind: "killSawSensor", hazardId: hazard.id };
  });
}

function killSawColliderContact(fighter, hazard, floorY = 0) {
  const parts = (fighter?.colliderParts || fighter?.physics2?.parts || [])
    .filter((part) => part?.part !== "driveContact" && part?.halfExtents && part?.position);
  if (!fighter?.rb || !parts.length || !hazard.active) return null;
  const exposedHeight = hazard.maxRise * THREE.MathUtils.clamp(hazard.exposure || 0, 0, 1);
  if (exposedHeight <= 0.001) return null;
  const bladeCenterY = -hazard.radius - settingsSafeStowedDepth(hazard.settings) + exposedHeight;
  const visibleTopY = Math.max(0, bladeCenterY + hazard.radius);
  if (visibleTopY <= 0.01) return null;

  const bodyPosition = fighter.rb.translation();
  const bodyOrigin = new THREE.Vector3(bodyPosition.x, bodyPosition.y, bodyPosition.z);
  const bodyRotation = fighterRotation(fighter);
  const scale = fighter.visualScale || 1;
  let sampleCount = 0;
  let weightedPressure = 0;
  let weightedTopPressure = 0;
  let best = null;
  const sampleSteps = [-1, 0, 1];
  parts.forEach((part) => {
    const half = part.halfExtents.map((value) => Math.abs(Number(value) || 0) * scale);
    const center = new THREE.Vector3(...part.position).multiplyScalar(scale);
    const partRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0])));
    sampleSteps.forEach((xSign) => {
      sampleSteps.forEach((ySign) => {
        sampleSteps.forEach((zSign) => {
          const localPartPoint = new THREE.Vector3(half[0] * xSign, half[1] * ySign, half[2] * zSign)
            .applyQuaternion(partRotation)
            .add(center);
          const worldPoint = localPartPoint.applyQuaternion(bodyRotation).add(bodyOrigin);
          const local = worldPointToLocalKillSaw(hazard, worldPoint, floorY);
          if (Math.abs(local.z) > hazard.thickness + 0.24) return;
          if (local.y < -0.04 || local.y > visibleTopY + 0.08) return;
          const diskY = local.y - bladeCenterY;
          const radialDistance = Math.hypot(local.x, diskY);
          if (radialDistance > hazard.radius + 0.08) return;
          const edgePressure = THREE.MathUtils.clamp((hazard.radius + 0.08 - radialDistance) / 0.18, 0, 1);
          const thicknessPressure = THREE.MathUtils.clamp((hazard.thickness + 0.24 - Math.abs(local.z)) / 0.24, 0, 1);
          const exposurePressure = THREE.MathUtils.clamp(local.y / Math.max(0.001, visibleTopY), 0.1, 1);
          const topPressure = THREE.MathUtils.clamp((visibleTopY + 0.08 - local.y) / 0.16, 0, 1);
          const pressure = edgePressure * thicknessPressure * exposurePressure;
          if (pressure <= 0) return;
          sampleCount += 1;
          weightedPressure += pressure;
          weightedTopPressure += pressure * topPressure;
          if (!best || pressure > best.pressure) {
            const radialScale = radialDistance > 0.001 ? hazard.radius / radialDistance : 1;
            best = {
              pressure,
              topPressure,
              visibleTopY,
              local,
              radialDistance,
              contactPoint: localKillSawPointToWorld(hazard, {
                x: local.x * radialScale,
                y: Math.max(0.04, bladeCenterY + diskY * radialScale),
                z: THREE.MathUtils.clamp(local.z, -hazard.thickness, hazard.thickness),
              }, floorY),
            };
          }
        });
      });
    });
  });
  if (!best || sampleCount <= 0) return null;
  const contactSurface = THREE.MathUtils.clamp(weightedPressure / 10, 0, 1);
  const topPressure = THREE.MathUtils.clamp(weightedTopPressure / Math.max(0.001, weightedPressure), 0, 1);
  return { ...best, contactSurface, topPressure, visibleTopY, sampleCount };
}

export function applyKillSawHazardEffects({
  arena,
  fighters,
  dt,
  preStepMotion = null,
  floorY = 0,
  rigidBodyMass,
  recordBotDamage,
  spawnSparks,
  markFighterUnstable,
}) {
  if (!arena?.killSawHazards?.length || !fighters?.length) return;
  const now = performance.now() / 1000;
  arena.killSawHazards.forEach((hazard) => {
    if (!hazard.active) return;
    const settings = hazard.settings || {};
    const surfaceSpeed = Math.abs(hazard.rotationSpeed || settings.rotationSpeed || 0) * hazard.radius;
    fighters.forEach((fighter) => {
      if (!fighter?.rb) return;
      const contact = killSawColliderContact(fighter, hazard, floorY);
      if (!contact || contact.contactSurface < settings.contactPressureThreshold) return;
      const surface = THREE.MathUtils.clamp(
        (contact.contactSurface - settings.contactPressureThreshold) / Math.max(0.001, 1 - settings.contactPressureThreshold),
        0,
        1,
      );
      const mass = THREE.MathUtils.clamp(rigidBodyMass(fighter.rb, 80), 8, 360);
      const tangentLocal = new THREE.Vector3(
        -(contact.local.y + hazard.radius * 0.08),
        contact.local.x,
        Math.sign(contact.local.z || 1) * 0.16,
      );
      if (tangentLocal.lengthSq() < 0.0001) tangentLocal.set(1, 0.18, 0);
      tangentLocal.normalize().multiplyScalar(Math.sign(hazard.rotationSpeed || 1));
      const push = THREE.MathUtils.clamp(
        mass * (settings.basePushImpulse + surfaceSpeed * settings.speedPushImpulseScale) * surface,
        0,
        settings.maxPushImpulse,
      );
      const lift = THREE.MathUtils.clamp(mass * settings.liftImpulseScale * surface, 0, settings.maxLiftImpulse);
      const rideLift = THREE.MathUtils.clamp(
        mass
          * (settings.rideLiftImpulseScale || 0)
          * Math.max(surface, contact.topPressure || 0)
          * THREE.MathUtils.clamp(((contact.visibleTopY || 0) + 0.08 - contact.local.y) / Math.max(0.001, hazard.radius), 0, 1),
        0,
        settings.maxRideLiftImpulse || 0,
      );
      const risingLift = THREE.MathUtils.clamp(
        mass * (settings.risingLiftImpulseScale || 0) * (hazard.riseSpeed || 0) * Math.max(surface, contact.topPressure || 0),
        0,
        settings.maxRisingLiftImpulse || 0,
      );
      const impulseWorld = localKillSawVectorToWorld(hazard, {
        x: tangentLocal.x * push,
        y: lift + rideLift + risingLift + Math.max(0, tangentLocal.y) * push * 0.25,
        z: tangentLocal.z * push,
      });
      if (fighter.rb.applyImpulseAtPoint) fighter.rb.applyImpulseAtPoint({ x: impulseWorld.x, y: impulseWorld.y, z: impulseWorld.z }, contact.contactPoint, true);
      else fighter.rb.applyImpulse({ x: impulseWorld.x, y: impulseWorld.y, z: impulseWorld.z }, true);
      fighter.rb.applyTorqueImpulse({
        x: impulseWorld.z * settings.torqueScale,
        y: push * settings.torqueScale * Math.sign(hazard.rotationSpeed || 1),
        z: -impulseWorld.x * settings.torqueScale,
      }, true);
      markFighterUnstable(fighter, settings.unstableSeconds * (0.6 + surface));

      fighter.killSawHazardContacts ||= new Map();
      const contactState = fighter.killSawHazardContacts.get(hazard.id) || { lastDamageAt: null, lastSparkAt: 0 };
      const damageElapsedSeconds = contactState.lastDamageAt === null
        ? settings.damageCooldown
        : now - contactState.lastDamageAt;
      if (damageElapsedSeconds >= settings.damageCooldown) {
        const pre = preStepMotion?.get?.(fighter);
        const velocity = pre?.lin || fighter.rb.linvel();
        const localVelocity = worldVectorToLocalKillSaw(hazard, velocity);
        const incomingSpeed = Math.hypot(localVelocity.x, Math.min(0, localVelocity.y), localVelocity.z);
        const rawDamage = settings.damageMultiplier
          * surface
          * (settings.damageRate + surfaceSpeed * settings.speedDamageScale + incomingSpeed * 0.9)
          * damageElapsedSeconds;
        const normalWorld = localKillSawVectorToWorld(hazard, {
          x: contact.local.x,
          y: Math.max(0.2, contact.local.y),
          z: Math.sign(contact.local.z || 1) * 0.25,
        }).normalize();
        recordBotDamage(fighter, {
          amount: rawDamage,
          point: contact.contactPoint,
          normal: normalWorld,
          kind: "killSawHazard",
          source: { kind: "killSawHazard", id: hazard.id },
        });
        contactState.lastDamageAt = now;
      }
      if (
        surface >= settings.sparkSurfaceThreshold &&
        now - contactState.lastSparkAt >= settings.sparkCooldown
      ) {
        spawnSparks(contact.contactPoint, THREE.MathUtils.clamp(Math.round(5 + surface * 20), 5, 30));
        contactState.lastSparkAt = now;
      }
      fighter.killSawHazardContacts.set(hazard.id, contactState);
    });
  });
}

export function applyScrewHazardEffects({
  arena,
  fighters,
  dt,
  preStepMotion = null,
  floorY = 0,
  horizontalBodyRadius,
  rigidBodyMass,
  recordBotDamage,
  spawnSparks,
  markFighterUnstable,
}) {
  if (!arena?.screwHazards?.length || !fighters?.length) return;
  const now = performance.now() / 1000;
  arena.screwHazards.forEach((hazard) => {
    const settings = hazard.settings || {};
    const surfaceSpeed = Math.abs(hazard.rotationSpeed || settings.rotationSpeed || 0) * hazard.bladeRadius;
    fighters.forEach((fighter) => {
      if (!fighter?.rb) return;
      const p = fighter.rb.translation();
      const local = worldPointToLocalScrew(hazard, p, floorY);
      const contact = screwColliderContact(fighter, hazard, floorY);
      if (!contact || contact.overlapPressure < settings.contactPressureThreshold) return;
      const pressure = THREE.MathUtils.clamp(
        (contact.overlapPressure - settings.contactPressureThreshold) / Math.max(0.001, 1 - settings.contactPressureThreshold),
        0,
        1,
      );
      const velocity = fighter.rb.linvel();
      const centerDirection = Math.abs(local.x) > 0.08 ? -Math.sign(local.x) : 0;
      const radialZDirection = Math.abs(local.z) > 0.03 ? Math.sign(local.z) : (hazard.position.z >= 0 ? -1 : 1);
      const mass = THREE.MathUtils.clamp(rigidBodyMass(fighter.rb, 80), 8, 360);
      const inwardImpulse = THREE.MathUtils.clamp(
        mass * (settings.baseInwardImpulse + surfaceSpeed * settings.speedInwardImpulseScale) * pressure,
        0,
        settings.maxInwardImpulse,
      );
      const liftImpulse = THREE.MathUtils.clamp(
        mass * (settings.baseLiftImpulse + surfaceSpeed * settings.speedLiftImpulseScale) * pressure,
        0,
        settings.maxLiftImpulse,
      );
      const radialImpulse = THREE.MathUtils.clamp(mass * settings.radialImpulseScale * pressure, 0, settings.maxRadialImpulse);
      const impulseWorld = localScrewVectorToWorld(hazard.yaw, {
        x: centerDirection * inwardImpulse,
        y: liftImpulse,
        z: radialZDirection * radialImpulse,
      });
      const contactPoint = contact.contactPoint;
      if (fighter.rb.applyImpulseAtPoint) fighter.rb.applyImpulseAtPoint({ x: impulseWorld.x, y: impulseWorld.y, z: impulseWorld.z }, contactPoint, true);
      else fighter.rb.applyImpulse({ x: impulseWorld.x, y: impulseWorld.y, z: impulseWorld.z }, true);
      fighter.rb.applyTorqueImpulse({
        x: radialZDirection * mass * settings.torqueXScale * pressure,
        y: centerDirection * mass * settings.torqueYScale * pressure,
        z: -centerDirection * mass * settings.torqueZScale * pressure,
      }, true);
      markFighterUnstable(fighter, settings.unstableSeconds + pressure * settings.unstablePressureSeconds);

      fighter.screwHazardContacts ||= new Map();
      const contactState = fighter.screwHazardContacts.get(hazard.id) || { lastDamageAt: null, lastSparkAt: 0 };
      const pre = preStepMotion?.get?.(fighter);
      const preVelocity = pre?.lin || velocity;
      const localPreVelocity = worldVectorToLocalScrew(hazard, preVelocity);
      const impactSpeed = Math.hypot(localPreVelocity.x, localPreVelocity.z, Math.min(0, localPreVelocity.y));
      const damageElapsedSeconds = contactState.lastDamageAt === null
        ? settings.damageCooldown
        : now - contactState.lastDamageAt;
      if (damageElapsedSeconds >= settings.damageCooldown) {
        const rawDamage = Math.max(0, impactSpeed - settings.impactSpeedThreshold) * settings.impactDamageScale
          + pressure * (settings.pressureDamageBase + surfaceSpeed * settings.pressureDamageSpeedScale) * damageElapsedSeconds;
        const normalWorld = localScrewVectorToWorld(hazard.yaw, {
          x: 0,
          y: contact.radialDistance > 0.001 ? contact.closestLocalDy / contact.radialDistance : 0.35,
          z: contact.radialDistance > 0.001 ? contact.local.z / contact.radialDistance : radialZDirection,
        }).normalize();
        recordBotDamage(fighter, {
          amount: rawDamage,
          point: contactPoint,
          normal: normalWorld,
          kind: "screwHazard",
          source: { kind: "screwHazard", id: hazard.id },
        });
        contactState.lastDamageAt = now;
        if (rawDamage >= settings.minRecordedDamage && now - contactState.lastSparkAt > settings.sparkCooldown) {
          const sparkCount = THREE.MathUtils.clamp(Math.round(3 + rawDamage * 0.32 + pressure * 5), 3, 36);
          spawnSparks(contactPoint, sparkCount);
          contactState.lastSparkAt = now;
        }
      }
      fighter.screwHazardContacts.set(hazard.id, contactState);
    });
  });
}
