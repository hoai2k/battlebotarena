// The BattleBox arena visuals: tiled floor, tessellated yellow barrier walls, framed
// window panels, lit ceiling grid, upper deck, kill-saw slots and screws.
//
// Dependencies are INJECTED rather than imported so this module stays decoupled
// from either game tree: callers pass the arena layout, the hazard element
// factories (from arenaHazards.js), and an asset base path. The only import is
// three, which each host resolves through its own importmap.

import * as THREE from "three";

function arenaNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

// --- Small scene helpers (mirrors of the v1 primitives) ---------------------

function add(mesh, parent, pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1]) {
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  mesh.scale.set(...scale);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function box(parent, size, material, pos, rot) {
  return add(new THREE.Mesh(new THREE.BoxGeometry(...size), material), parent, pos, rot);
}

function cyl(parent, radius, depth, material, pos, rot, segments = 48) {
  return add(new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, depth, segments), material), parent, pos, rot);
}

function makeScratchTexture(base, line, density) {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext("2d");
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  g.globalAlpha = density;
  for (let i = 0; i < 280; i += 1) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 5 + Math.random() * 38;
    g.strokeStyle = i % 5 === 0 ? "#050505" : line;
    g.lineWidth = Math.random() > 0.82 ? 1.4 : 0.55;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + len, y + (Math.random() - 0.5) * 11);
    g.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

/**
 * Yaw that faces an upper deck toward the nearest wall. Exported because the
 * physics side needs the same orientation for the deck's colliders.
 */
export function upperDeckYawForNearestWall(position, halfWidth, halfLength) {
  const west = Math.abs(position.x + halfWidth);
  const east = Math.abs(halfWidth - position.x);
  const north = Math.abs(position.z + halfLength);
  const south = Math.abs(halfLength - position.z);
  const nearest = Math.min(west, east, north, south);
  if (nearest === west) return Math.PI / 2;
  if (nearest === east) return -Math.PI / 2;
  if (nearest === north) return 0;
  return Math.PI;
}

/**
 * Builds the arena visual root.
 *
 * @param {object} options
 * @param {object} options.layout          ARENA_LAYOUT (src/arenaConfig.js).
 * @param {object} options.hazards         { createScrewHazardElement, createKillSawHazardElement }.
 * @param {string} options.assetBase       Prefix for texture URLs, resolved against the page.
 * @returns {THREE.Group} root with userData.{hazards, screwHazards, killSawHazards, wallMeshes}
 */
export function createArenaVisualRoot({ layout, hazards: hazardFactories, assetBase = "./" }) {
  const dims = layout.dimensions || {};
  const WIDTH = arenaNumber(dims.width, 34);
  const LENGTH = arenaNumber(dims.length, 26);
  const HALF_WIDTH = WIDTH / 2;
  const HALF_LENGTH = LENGTH / 2;
  const FLOOR_Y = arenaNumber(dims.floorY, 0);
  const FLOOR_THICKNESS = arenaNumber(dims.visualFloorThickness, 0.16);
  const DECAL_Y = FLOOR_Y + 0.006;
  const CEILING_HEIGHT = arenaNumber(dims.ceilingHeight, 9.45);
  const WALL_BASE_Y = arenaNumber(dims.wallBaseY, 0.58);
  const WALL_HEIGHT = CEILING_HEIGHT - WALL_BASE_Y;

  const textureLoader = new THREE.TextureLoader();
  const disposables = [];
  function loadTexture(path, repeat = [1, 1]) {
    const texture = textureLoader.load(assetBase + path);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
    texture.anisotropy = 8;
    disposables.push(texture);
    return texture;
  }
  function loadPlainTexture(path) {
    const texture = textureLoader.load(assetBase + path);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    disposables.push(texture);
    return texture;
  }

  const floorTileTexture = loadTexture("public/arena/bb_arena_tile.png", [8, 8]);
  const arenaLogoTexture = loadPlainTexture("public/arena/bb_arena_logo_alpha.png");
  const killSawTexture = loadPlainTexture("public/arena/kill_saw_alpha.png");
  const battleBoxMetalTexture = loadTexture("public/arena/battlebox_metal.png", [3.4, 1]);
  const battleBoxYellowTexture = loadTexture("public/arena/battlebox_yellow.png", [3.2, 1]);
  const screwMetalTexture = loadTexture("public/arena/screw_metal.png", [2.8, 1]);
  const upperDeckTexture = loadTexture("public/arena/upper_deck.png", [1.6, 0.8]);

  function elementPosition(element, fallback = { x: 0, z: 0 }) {
    return {
      x: arenaNumber(element?.position?.x, fallback.x),
      z: arenaNumber(element?.position?.z, fallback.z),
    };
  }
  function elementSize(element, fallback = [1, 1]) {
    return [
      Math.max(0.01, arenaNumber(element?.size?.x, fallback[0])),
      Math.max(0.01, arenaNumber(element?.size?.z, fallback[1])),
    ];
  }
  function elementRotation(element, fallback = 0) {
    return THREE.MathUtils.degToRad(arenaNumber(element?.rotation, fallback));
  }
  function wallCapYOffset() {
    const shared = layout.wallBarriers?.capOffset;
    if (Number.isFinite(shared)) return THREE.MathUtils.clamp(shared, -0.42, 2.4);
    const legacy = Object.values(layout.wallBarriers?.capOffsets || {}).filter(Number.isFinite);
    return THREE.MathUtils.clamp(legacy[0] || 0, -0.42, 2.4);
  }

  function floorDecal(parent, size, material, pos, rotation = 0) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...size), material);
    mesh.rotation.set(-Math.PI / 2, 0, rotation);
    mesh.position.set(pos[0], DECAL_Y, pos[1]);
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function floorRectOutline(parent, center, size, material, rotation = 0, lineWidth = 0.07) {
    const [w, d] = size;
    const lines = [
      { offset: [0, -d / 2], size: [w, lineWidth], rotation: 0 },
      { offset: [0, d / 2], size: [w, lineWidth], rotation: 0 },
      { offset: [-w / 2, 0], size: [d, lineWidth], rotation: Math.PI / 2 },
      { offset: [w / 2, 0], size: [d, lineWidth], rotation: Math.PI / 2 },
    ];
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    lines.forEach((line) => {
      const x = center[0] + line.offset[0] * c - line.offset[1] * s;
      const z = center[1] + line.offset[0] * s + line.offset[1] * c;
      floorDecal(parent, line.size, material, [x, z], rotation + line.rotation);
    });
  }

  function topDecal(parent, size, material, pos, rotation = 0, y = 1.006) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...size), material);
    mesh.rotation.set(-Math.PI / 2, 0, rotation);
    mesh.position.set(pos[0], y, pos[1]);
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    parent.add(mesh);
    return mesh;
  }

  // --- Tessellated (saw-tooth) barrier wall profile -------------------------

  function tessellatedWallFootprint(length, depth = 0.82) {
    const toothCount = Math.max(4, Math.round(length / 0.72));
    const step = length / toothCount;
    const backZ = -depth * 0.32;
    const valleyZ = depth * 0.08;
    const pointZ = depth * 0.5;
    const points = [
      new THREE.Vector2(-length / 2, backZ),
      new THREE.Vector2(length / 2, backZ),
      new THREE.Vector2(length / 2, valleyZ),
    ];
    for (let i = toothCount - 1; i >= 0; i -= 1) {
      const right = -length / 2 + step * (i + 1);
      const center = -length / 2 + step * (i + 0.5);
      const left = -length / 2 + step * i;
      points.push(new THREE.Vector2(right, valleyZ));
      points.push(new THREE.Vector2(center, pointZ));
      points.push(new THREE.Vector2(left, valleyZ));
    }
    return points;
  }

  function applyTessellatedWallUvs(geometry, length, height, depth) {
    geometry.computeVertexNormals();
    const pos = geometry.getAttribute("position");
    const normals = geometry.getAttribute("normal");
    const uvs = [];
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const normalY = Math.abs(normals.getY(i));
      if (normalY > 0.72) {
        uvs.push((x + length / 2) / Math.max(0.001, length), (z + depth / 2) / Math.max(0.001, depth));
      } else {
        uvs.push((x + length / 2) / 1.15, y / Math.max(0.001, height));
      }
    }
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  }

  function createTessellatedWallPlanGeometry(length, height = 0.76, depth = 0.82) {
    const geometryHeight = height * 1.5;
    const shape = new THREE.Shape();
    tessellatedWallFootprint(length, depth).forEach((point, index) => {
      if (index === 0) shape.moveTo(point.x, point.y);
      else shape.lineTo(point.x, point.y);
    });
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth: geometryHeight,
      bevelEnabled: true,
      bevelSize: 0.028,
      bevelThickness: 0.022,
      bevelSegments: 2,
      curveSegments: 2,
    });
    geometry.rotateX(-Math.PI / 2);
    applyTessellatedWallUvs(geometry, length, geometryHeight, depth);
    return geometry;
  }

  function addYellowWallTile(parent, length, yellowMat, barrierMat, pos, rot, side) {
    const bodyDepth = 0.82;
    const capDepth = 0.96;
    const bodyHeight = 0.68;
    const lowerCapHeight = 0.08;
    const topCapHeight = 0.095;
    const bodyY = 0;
    const capZ = -0.08 - (capDepth - bodyDepth) * 0.32;
    const group = new THREE.Group();
    group.position.set(...pos);
    group.rotation.set(...rot);
    group.userData.wallSide = side;
    parent.add(group);
    parent.userData.wallMeshes?.[side]?.push(group);

    box(group, [length, 0.3, 0.34], barrierMat, [0, 0.15, 0.23], [0, 0, 0]);
    const lowerCap = new THREE.Mesh(createTessellatedWallPlanGeometry(length, lowerCapHeight, capDepth), barrierMat);
    const capYOffset = wallCapYOffset();
    const faceHeight = bodyHeight * 1.5;
    const topCapActualHeight = topCapHeight * 1.5;
    const topCapY = bodyY + faceHeight + capYOffset;
    lowerCap.position.set(0, bodyY + capYOffset, capZ);
    lowerCap.castShadow = true;
    lowerCap.receiveShadow = true;
    group.add(lowerCap);
    const face = new THREE.Mesh(createTessellatedWallPlanGeometry(length, bodyHeight, bodyDepth), yellowMat);
    face.position.set(0, bodyY, -0.08);
    face.castShadow = true;
    face.receiveShadow = true;
    group.add(face);
    const topCap = new THREE.Mesh(createTessellatedWallPlanGeometry(length, topCapHeight, capDepth), barrierMat);
    topCap.position.set(0, topCapY, capZ);
    topCap.castShadow = true;
    topCap.receiveShadow = true;
    group.add(topCap);
    box(group, [length, 0.1, 0.28], barrierMat, [0, topCapY + topCapActualHeight / 2 - 0.005, 0.14], [0, 0, 0]);

    const toothWidth = 0.72;
    const count = Math.max(2, Math.ceil(length / toothWidth));
    const step = length / count;
    for (let i = 0; i < count; i += 1) {
      const x = -length / 2 + step * (i + 0.5);
      box(group, [0.055, 0.56, 0.09], yellowMat, [x - step / 2, 0.36, -0.08], [0, 0, 0]);
      if (i % 4 === 1) {
        const bolt = cyl(group, 0.052, 0.026, barrierMat, [x, 0.57, -0.1], [Math.PI / 2, 0, 0], 16);
        bolt.castShadow = false;
      }
    }
  }

  function addYellowWallCorner(parent, yellowMat, barrierMat, x, z) {
    const bodyDepth = 0.7;
    const capDepth = 0.82;
    const bodyHeight = 0.6;
    const lowerCapHeight = 0.08;
    const topCapHeight = 0.09;
    const bodyY = 0;
    const capZ = -0.04 - (capDepth - bodyDepth) * 0.32;
    const side = Math.abs(x / HALF_WIDTH) > Math.abs(z / HALF_LENGTH)
      ? (x < 0 ? "west" : "east")
      : (z < 0 ? "north" : "south");
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = Math.PI / 4;
    group.userData.wallSide = side;
    parent.add(group);
    parent.userData.wallMeshes?.[side]?.push(group);
    box(group, [0.84, 0.28, 0.84], barrierMat, [0, 0.14, 0], [0, 0, 0]);
    const lowerCap = new THREE.Mesh(createTessellatedWallPlanGeometry(0.92, lowerCapHeight, capDepth), barrierMat);
    const capYOffset = wallCapYOffset();
    const faceHeight = bodyHeight * 1.5;
    const topCapActualHeight = topCapHeight * 1.5;
    const topCapY = bodyY + faceHeight + capYOffset;
    lowerCap.position.set(0, bodyY + capYOffset, capZ);
    lowerCap.castShadow = true;
    lowerCap.receiveShadow = true;
    group.add(lowerCap);
    const face = new THREE.Mesh(createTessellatedWallPlanGeometry(0.92, bodyHeight, bodyDepth), yellowMat);
    face.position.set(0, bodyY, -0.04);
    face.castShadow = true;
    face.receiveShadow = true;
    group.add(face);
    const topCap = new THREE.Mesh(createTessellatedWallPlanGeometry(0.92, topCapHeight, capDepth), barrierMat);
    topCap.position.set(0, topCapY, capZ);
    topCap.castShadow = true;
    topCap.receiveShadow = true;
    group.add(topCap);
    box(group, [0.76, 0.08, 0.72], barrierMat, [0, topCapY + topCapActualHeight / 2 - 0.005, -0.08], [0, 0, 0]);
  }

  function addArenaBarriers(parent, barrierMat, yellowMat) {
    const tile = 5.2;
    const registerBarrierMesh = (mesh, side) => {
      mesh.userData.wallSide = side;
      parent.userData.wallMeshes?.[side]?.push(mesh);
      return mesh;
    };
    const addRun = (axis, sign, length) => {
      const side = axis === "x" ? (sign < 0 ? "north" : "south") : (sign < 0 ? "west" : "east");
      const count = Math.max(2, Math.ceil(length / tile));
      const step = length / count;
      for (let i = 0; i < count; i += 1) {
        const offset = -length / 2 + step * (i + 0.5);
        if (axis === "x") {
          addYellowWallTile(parent, step + 0.02, yellowMat, barrierMat, [offset, 0, sign * (HALF_LENGTH - 0.24)], [0, sign < 0 ? Math.PI : 0, 0], side);
        } else {
          addYellowWallTile(parent, step + 0.02, yellowMat, barrierMat, [sign * (HALF_WIDTH - 0.24), 0, offset], [0, sign > 0 ? Math.PI / 2 : -Math.PI / 2, 0], side);
        }
      }
    };
    for (const z of [-HALF_LENGTH + 0.16, HALF_LENGTH - 0.16]) {
      const side = z < 0 ? "north" : "south";
      registerBarrierMesh(box(parent, [WIDTH, 0.28, 0.42], barrierMat, [0, 0.14, z], [0, 0, 0]), side);
      addRun("x", Math.sign(z), WIDTH - 0.8);
    }
    for (const x of [-HALF_WIDTH + 0.16, HALF_WIDTH - 0.16]) {
      const side = x < 0 ? "west" : "east";
      registerBarrierMesh(box(parent, [0.42, 0.28, LENGTH], barrierMat, [x, 0.14, 0], [0, 0, 0]), side);
      addRun("z", Math.sign(x), LENGTH - 0.8);
    }
    for (const x of [-HALF_WIDTH + 0.22, HALF_WIDTH - 0.22]) {
      for (const z of [-HALF_LENGTH + 0.22, HALF_LENGTH - 0.22]) {
        addYellowWallCorner(parent, yellowMat, barrierMat, x, z);
      }
    }
  }

  function addWindowWalls(parent, glassMat, frameMat) {
    const baseY = WALL_BASE_Y;
    const wallCenterY = baseY + WALL_HEIGHT / 2;
    const panelCount = Math.ceil(WIDTH / 3);
    const panelW = WIDTH / panelCount;
    const registerWallMesh = (mesh, side) => {
      mesh.userData.wallSide = side;
      parent.userData.wallMeshes[side].push(mesh);
      return mesh;
    };
    for (const z of [-HALF_LENGTH, HALF_LENGTH]) {
      const side = z < 0 ? "north" : "south";
      for (let i = 0; i < panelCount; i += 1) {
        const x = -HALF_WIDTH + panelW * (i + 0.5);
        registerWallMesh(box(parent, [panelW - 0.08, WALL_HEIGHT, 0.045], glassMat, [x, wallCenterY, z], [0, 0, 0]), side);
      }
      for (let i = 0; i <= panelCount; i += 1) {
        const x = -HALF_WIDTH + panelW * i;
        registerWallMesh(box(parent, [0.065, WALL_HEIGHT + 0.25, 0.14], frameMat, [x, wallCenterY, z], [0, 0, 0]), side);
      }
      for (let y = baseY; y <= baseY + WALL_HEIGHT + 0.01; y += 1.25) {
        registerWallMesh(box(parent, [WIDTH + 0.16, 0.065, 0.14], frameMat, [0, y, z], [0, 0, 0]), side);
      }
    }

    const sidePanelCount = Math.ceil(LENGTH / 3);
    const sidePanelW = LENGTH / sidePanelCount;
    for (const x of [-HALF_WIDTH, HALF_WIDTH]) {
      const side = x < 0 ? "west" : "east";
      for (let i = 0; i < sidePanelCount; i += 1) {
        const z = -HALF_LENGTH + sidePanelW * (i + 0.5);
        registerWallMesh(box(parent, [0.045, WALL_HEIGHT, sidePanelW - 0.08], glassMat, [x, wallCenterY, z], [0, 0, 0]), side);
      }
      for (let i = 0; i <= sidePanelCount; i += 1) {
        const z = -HALF_LENGTH + sidePanelW * i;
        registerWallMesh(box(parent, [0.14, WALL_HEIGHT + 0.25, 0.065], frameMat, [x, wallCenterY, z], [0, 0, 0]), side);
      }
      for (let y = baseY; y <= baseY + WALL_HEIGHT + 0.01; y += 1.25) {
        registerWallMesh(box(parent, [0.14, 0.065, LENGTH + 0.16], frameMat, [x, y, 0], [0, 0, 0]), side);
      }
    }
  }

  function addArenaCeiling(parent, frameMat, lightMat) {
    const y = CEILING_HEIGHT;
    // Every ceiling mesh registers so hosts whose cameras can climb above the
    // box (v2's battle cam) can hide the lid without touching the lights.
    const ceiling = (mesh) => {
      parent.userData.ceilingMeshes.push(mesh);
      return mesh;
    };
    ceiling(box(parent, [WIDTH + 0.8, 0.08, 0.08], frameMat, [0, y, -HALF_LENGTH], [0, 0, 0]));
    ceiling(box(parent, [WIDTH + 0.8, 0.08, 0.08], frameMat, [0, y, HALF_LENGTH], [0, 0, 0]));
    ceiling(box(parent, [0.08, 0.08, LENGTH + 0.8], frameMat, [-HALF_WIDTH, y, 0], [0, 0, 0]));
    ceiling(box(parent, [0.08, 0.08, LENGTH + 0.8], frameMat, [HALF_WIDTH, y, 0], [0, 0, 0]));
    for (let x = -HALF_WIDTH + 3.2; x <= HALF_WIDTH - 3.2; x += 3.2) ceiling(box(parent, [0.055, 0.055, LENGTH + 0.6], frameMat, [x, y - 0.08, 0], [0, 0, 0]));
    for (let z = -HALF_LENGTH + 3.2; z <= HALF_LENGTH - 3.2; z += 3.2) ceiling(box(parent, [WIDTH + 0.6, 0.055, 0.055], frameMat, [0, y - 0.02, z], [0, 0, 0]));
    for (const z of [-8.4, -2.8, 2.8, 8.4]) {
      for (const x of [-11.2, 0, 11.2]) {
        const light = ceiling(box(parent, [1.2, 0.05, 0.7], lightMat, [x, y - 0.2, z], [0, 0.1 * Math.sign(x || 1), 0]));
        light.castShadow = false;
      }
    }
    for (const x of [-11.2, 0, 11.2]) {
      const pool = new THREE.PointLight(0xffffff, 2.3, 15, 2.2);
      pool.position.set(x, y - 0.5, x === 0 ? 0 : 2.5 * Math.sign(x));
      parent.add(pool);
    }
    for (const x of [-12, 12]) {
      const accent = new THREE.PointLight(x < 0 ? 0x2255ff : 0xff1f2f, 2.4, 12, 2.2);
      accent.position.set(x, y - 1.1, -10);
      parent.add(accent);
    }
  }

  // --- Upper deck ------------------------------------------------------------

  function addDeckLine(parent, material, center, size, rotation = 0) {
    topDecal(parent, size, material, center, rotation, 1.008);
  }

  function addUpperDeckDecor(parent, size, redMat, blueMat) {
    const [depth, span] = size;
    const line = Math.max(0.075, Math.min(depth, span) * 0.045);
    const wallX = -depth / 2;
    const centerX = depth / 2;
    const frontPad = Math.max(0.28, depth * 0.09);
    const sidePad = Math.max(0.22, span * 0.035);
    const centerGap = Math.max(0.34, span * 0.06);
    const laneStep = Math.max(line * 2.3, Math.min(depth, span) * 0.075);
    const turnReach = Math.max(depth * 0.46, Math.min(depth * 0.68, span * 0.33));

    const addSpanLine = (material, x, zCenter, length) => {
      addDeckLine(parent, material, [x, zCenter], [Math.max(0.2, length), line], Math.PI / 2);
    };
    const addDepthLine = (material, xCenter, z, length) => {
      addDeckLine(parent, material, [xCenter, z], [Math.max(0.2, length), line]);
    };

    const addNestedDeckMark = (side, material) => {
      for (let i = 0; i < 3; i += 1) {
        const inset = i * laneStep;
        const sideZ = side * (span / 2 - sidePad - inset);
        const innerZ = side * (centerGap + inset * 0.56);
        const frontLineX = centerX - frontPad - inset;
        const turnX = Math.max(wallX + frontPad, frontLineX - turnReach + inset * 0.18);
        const crossLength = Math.abs(sideZ - innerZ);
        addSpanLine(material, frontLineX, (sideZ + innerZ) / 2, crossLength);
        addDepthLine(material, (frontLineX + turnX) / 2, innerZ, frontLineX - turnX);
      }
    };

    addNestedDeckMark(1, blueMat);
    addNestedDeckMark(-1, redMat);
  }

  function addUpperDeckElement(parent, element, materials) {
    const position = elementPosition(element);
    const size = elementSize(element, [5.8, 2.35]);
    const rotation = elementRotation(element, THREE.MathUtils.radToDeg(upperDeckYawForNearestWall(position, HALF_WIDTH, HALF_LENGTH)));
    const group = new THREE.Group();
    group.position.set(position.x, FLOOR_Y, position.z);
    group.rotation.y = rotation;
    parent.add(group);

    const deck = box(group, [size[0], 1, size[1]], materials.upperDeckMat, [0, 0.5, 0], [0, 0, 0]);
    deck.castShadow = true;
    deck.receiveShadow = true;
    addUpperDeckDecor(group, size, materials.redDeckLineMat, materials.blueDeckLineMat);
    return group;
  }

  // --- Hazards ---------------------------------------------------------------

  function addScrewElement(parent, element, materials) {
    const { group, core, hazard } = hazardFactories.createScrewHazardElement({
      element,
      materials,
      layout,
      arenaHalfWidth: HALF_WIDTH,
      arenaHalfLength: HALF_LENGTH,
      floorY: FLOOR_Y,
      idFallback: `screw-${parent.userData.screwHazards?.length || 0}`,
    });
    parent.add(group);
    parent.userData.hazards?.push(core);
    parent.userData.screwHazards?.push(hazard);
    return group;
  }

  function addKillSawElement(parent, element, materials) {
    const position = elementPosition(element);
    const size = elementSize(element, [1.82, 0.82]);
    const rotation = elementRotation(element);
    const { group, hazard } = hazardFactories.createKillSawHazardElement({
      element,
      materials,
      layout,
      floorY: FLOOR_Y,
      idFallback: `kill-saw-${parent.userData.killSawHazards?.length || 0}`,
    });
    parent.add(group);
    parent.userData.killSawHazards?.push(hazard);
    floorRectOutline(parent, [position.x, position.z], size, materials.yellowLineMat, rotation, 0.045);
    return group;
  }

  function addArenaConfigElements(parent, materials) {
    layout.elements?.forEach((element) => {
      if (element.visibleInGame === false) return;
      const position = elementPosition(element);
      const size = elementSize(element, [1, 1]);
      const rotation = elementRotation(element);
      // Start boxes are NOT drawn from the layout any more. How many there are
      // and where they sit depends on how many machines are in the match (two
      // head-to-head, three with one on the west wall, four spread wide), so
      // they are rebuilt per match through root.userData.setStartBoxes below.
      if (element.type === "startBox") return;
      if (element.type === "logo") {
        floorDecal(parent, size, materials.logoMat, [position.x, position.z], rotation);
        return;
      }
      if (element.type === "killSaw") {
        addKillSawElement(parent, element, materials);
        return;
      }
      if (element.type === "screw") {
        addScrewElement(parent, element, materials);
        return;
      }
      if (element.type === "upperDeck") {
        addUpperDeckElement(parent, element, materials);
      }
    });
  }

  // --- Assemble --------------------------------------------------------------

  const root = new THREE.Group();
  root.userData.wallMeshes = { north: [], south: [], east: [], west: [] };
  root.userData.ceilingMeshes = [];
  root.userData.hazards = [];
  root.userData.screwHazards = [];
  root.userData.killSawHazards = [];

  const arenaFloorTexture = floorTileTexture.clone();
  arenaFloorTexture.repeat.set(WIDTH / 4.25, LENGTH / 4.25);
  arenaFloorTexture.needsUpdate = true;
  disposables.push(arenaFloorTexture);

  const arenaFloorMat = new THREE.MeshStandardMaterial({ color: 0x858b86, roughness: 0.48, metalness: 0.35, map: arenaFloorTexture });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xa9c8ff,
    metalness: 0,
    roughness: 0.16,
    transparent: true,
    opacity: 0.21,
    side: THREE.DoubleSide,
  });
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0x161819,
    metalness: 0.86,
    roughness: 0.24,
    map: makeScratchTexture("#303333", "#ffffff", 0.22),
  });
  const barrierMat = new THREE.MeshStandardMaterial({ color: 0x171615, metalness: 0.72, roughness: 0.42, map: battleBoxMetalTexture });
  const yellowWallMat = new THREE.MeshStandardMaterial({ color: 0xffd01b, metalness: 0.32, roughness: 0.58, map: battleBoxYellowTexture });
  const screwMat = new THREE.MeshStandardMaterial({ color: 0xb0aaa0, metalness: 1, roughness: 0.24, map: screwMetalTexture, envMapIntensity: 1.45 });
  const upperDeckMat = new THREE.MeshStandardMaterial({ color: 0x8a8c86, metalness: 0.42, roughness: 0.64, map: upperDeckTexture });
  const redDeckLineMat = new THREE.MeshBasicMaterial({ color: 0xe1322a, transparent: true, opacity: 0.92, depthWrite: false });
  const blueDeckLineMat = new THREE.MeshBasicMaterial({ color: 0x3aa9e8, transparent: true, opacity: 0.92, depthWrite: false });
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 3.3, roughness: 0.18 });
  const yellowLineMat = new THREE.MeshBasicMaterial({ color: 0xf4d817, transparent: true, opacity: 0.88, depthWrite: false });
  const hazardSlotMat = new THREE.MeshBasicMaterial({ color: 0x111414, transparent: true, opacity: 0.82, depthWrite: false });
  const killSawBladeMat = new THREE.MeshBasicMaterial({
    map: killSawTexture,
    transparent: true,
    alphaTest: 0.08,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const logoMat = new THREE.MeshStandardMaterial({
    map: arenaLogoTexture,
    transparent: true,
    depthWrite: false,
    roughness: 0.38,
    metalness: 0.18,
  });

  box(root, [WIDTH, FLOOR_THICKNESS, LENGTH], arenaFloorMat, [0, FLOOR_Y - FLOOR_THICKNESS / 2, 0], [0, 0, 0]);

  // The start boxes, in their own group so a new match can replace the lot.
  // Each is a coloured floor decal with a paler outline around it — the same
  // shapes the layout used to hold, just built from a list somebody hands us
  // rather than from the file. See src/sim/arenaSpec.js for the layouts.
  const startBoxGroup = new THREE.Group();
  root.add(startBoxGroup);
  const startBoxDisposables = [];
  root.userData.setStartBoxes = (boxes = []) => {
    startBoxGroup.clear();
    startBoxDisposables.forEach((item) => item.dispose());
    startBoxDisposables.length = 0;
    boxes.forEach((spawn) => {
      const size = [spawn.sizeX ?? 5.2, spawn.sizeZ ?? 4.7];
      const color = new THREE.Color(spawn.color || 0xe1322a);
      const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.75, depthWrite: false });
      const outline = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
      startBoxDisposables.push(material, outline);
      // Rotate the decal with the spawn's facing so a box that is entered from
      // the side reads as pointing where its machine points.
      const rotation = -(spawn.yaw ?? 0);
      floorDecal(startBoxGroup, size, material, [spawn.x, spawn.z], rotation);
      floorRectOutline(startBoxGroup, [spawn.x, spawn.z], size, outline, rotation, 0.11);
    });
    startBoxGroup.traverse((child) => {
      if (child.isMesh) child.castShadow = false;
    });
  };
  addArenaConfigElements(root, {
    yellowLineMat, hazardSlotMat, killSawBladeMat, logoMat, barrierMat,
    yellowWallMat, screwMat, upperDeckMat, redDeckLineMat, blueDeckLineMat,
  });
  addArenaBarriers(root, barrierMat, yellowWallMat);
  addWindowWalls(root, glassMat, frameMat);
  addArenaCeiling(root, frameMat, lightMat);
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = false;
    child.receiveShadow = child.geometry?.type === "BoxGeometry" && child.position.y < 0.2;
  });
  root.userData.disposeTextures = () => {
    disposables.forEach((texture) => texture.dispose());
    startBoxDisposables.forEach((item) => item.dispose());
  };
  return root;
}
