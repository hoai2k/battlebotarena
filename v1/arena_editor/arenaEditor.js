import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { ARENA_LAYOUT } from "../src/arenaConfig.js?v=screw-front-1";
import { screwHazardDimensions, screwInwardRotation } from "../src/arenaHazards.js?v=screw-mirrored-auger-1";

const canvas = document.querySelector("#scene");
const createTypeSelect = document.querySelector("#create-type");
const createButton = document.querySelector("#create-object");
const mirrorAxisSelect = document.querySelector("#mirror-axis");
const mirrorButton = document.querySelector("#mirror-object");
const undoButton = document.querySelector("#undo-change");
const redoButton = document.querySelector("#redo-change");
const copyButton = document.querySelector("#copy-object");
const deleteButton = document.querySelector("#delete-object");
const outputButton = document.querySelector("#output-arena");
const selectedName = document.querySelector("#selected-name");
const statusText = document.querySelector("#status-text");
const inspector = document.querySelector("#inspector");
const arenaInspector = document.querySelector("#arena-inspector");
const labelInput = document.querySelector("#field-label");
const typeInput = document.querySelector("#field-type");
const rotationInput = document.querySelector("#field-rotation");
const sideRow = document.querySelector("#side-row");
const sideInput = document.querySelector("#field-side");
const visibleGameInput = document.querySelector("#field-visible-game");
const capOffsetInput = document.querySelector("#field-cap-offset");
const arenaWidthInput = document.querySelector("#field-arena-width");
const arenaLengthInput = document.querySelector("#field-arena-length");
const outputDialog = document.querySelector("#output-dialog");
const outputText = document.querySelector("#output-text");
const copyOutputButton = document.querySelector("#copy-output");
const downloadOutputButton = document.querySelector("#download-output");

const STORAGE_KEY = "battleBotArena.arenaEditor.layout";
const HISTORY_LIMIT = 80;
const FLOOR_Y = 0;
const FLOOR_DECAL_Y = FLOOR_Y + 0.006;
const DEFAULTS = {
  killSaw: { size: { x: 1.82, z: 0.82 }, color: "#d9dde0", visibleInGame: true },
  screw: { size: { x: 4.8, z: 0.78 }, color: "#8a5cf6", visibleInGame: true },
  upperDeck: { size: { x: 5.8, z: 2.35 }, color: "#2dd4bf", visibleInGame: true },
  pulverizer: { size: { x: 2.1, z: 2.1 }, color: "#f97316", visibleInGame: false },
  startBox: { size: { x: 5.2, z: 3.8 }, color: "#e1322a", visibleInGame: true, side: "player" },
  logo: { size: { x: 8.3, z: 5.55 }, visibleInGame: true },
};
const TYPE_LABELS = {
  killSaw: "Kill saw",
  screw: "Screw",
  upperDeck: "Upper deck",
  pulverizer: "Pulverizer",
  startBox: "Starting box",
  logo: "Logo",
};
const PLACEHOLDER_COLORS = {
  screw: "#8a5cf6",
  upperDeck: "#2dd4bf",
  pulverizer: "#f97316",
  startBox: "#e1322a",
};

function visibleInGameForType(type) {
  return type !== "pulverizer";
}

const layout = loadInitialLayout();
layout.dimensions ||= clonePlain(ARENA_LAYOUT.dimensions || {});
layout.screwHazards = {
  ...clonePlain(ARENA_LAYOUT.screwHazards || { depth: 2, rotationSpeed: 5.2 }),
  ...clonePlain(layout.screwHazards || {}),
};
let arenaWidth = finite(layout.dimensions.width, 34);
let arenaLength = finite(layout.dimensions.length, 26);
let halfWidth = arenaWidth / 2;
let halfLength = arenaLength / 2;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101314);
scene.fog = new THREE.Fog(0x101314, 28, 62);

const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 120);
camera.position.set(17, 16, 20);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const orbit = new OrbitControls(camera, canvas);
orbit.target.set(0, 0, 0);
orbit.enableDamping = true;
orbit.maxPolarAngle = Math.PI * 0.48;
orbit.update();

const transform = new TransformControls(camera, canvas);
transform.setSpace("local");
transform.setTranslationSnap(0.1);
transform.setRotationSnap(Math.PI / 2);
transform.setScaleSnap(0.1);
scene.add(transform);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const selectable = new Set();
let selectedObject = null;
let selectedObjects = [];
let transformStart = null;
let dragStartedAt = 0;
let pendingDeselect = null;
let modifierState = { shift: false, alt: false };
let interactionHistoryStart = null;
let applyingHistory = false;
const undoStack = [];
const redoStack = [];

const textureLoader = new THREE.TextureLoader();
const floorTexture = loadTexture("../public/arena/bb_arena_tile.png", [arenaWidth / 4.25, arenaLength / 4.25]);
const logoTexture = textureLoader.load("../public/arena/bb_arena_logo_alpha.png");
logoTexture.colorSpace = THREE.SRGBColorSpace;
logoTexture.anisotropy = 8;

const floorMat = new THREE.MeshStandardMaterial({ color: 0x858b86, roughness: 0.48, metalness: 0.35, map: floorTexture });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x151718, roughness: 0.44, metalness: 0.68 });
const barrierMat = new THREE.MeshStandardMaterial({ color: 0x171615, roughness: 0.42, metalness: 0.72 });
const yellowWallMat = new THREE.MeshStandardMaterial({ color: 0xffd01b, roughness: 0.58, metalness: 0.32 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0xa9c8ff, roughness: 0.16, transparent: true, opacity: 0.18 });
const lineMat = new THREE.MeshBasicMaterial({ color: 0xf4d817, transparent: true, opacity: 0.86, depthWrite: false });
const slotMat = new THREE.MeshBasicMaterial({ color: 0x111414, transparent: true, opacity: 0.82, depthWrite: false });
const logoMat = new THREE.MeshStandardMaterial({ map: logoTexture, transparent: true, depthWrite: false, roughness: 0.38, metalness: 0.18 });
const selectedMat = new THREE.LineBasicMaterial({ color: 0xf0c44f, transparent: true, opacity: 0.95 });

const root = new THREE.Group();
scene.add(root);
const selectionProxy = new THREE.Group();
selectionProxy.name = "selection-proxy";
scene.add(selectionProxy);

addLights();
rebuildEditorScene();
selectObject(null);
updateHistoryControls();
resize();
animate();

function finite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadInitialLayout() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved?.elements?.length) return saved;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return clonePlain(ARENA_LAYOUT);
}

function persistLayout() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleanLayout(), null, 2));
}

function selectedElementIds() {
  return selectedObjects.map((object) => object.userData.element?.id).filter(Boolean);
}

function historySnapshot(selectionIds = selectedElementIds()) {
  return {
    layout: cleanLayout(),
    selectionIds,
  };
}

function snapshotChanged(before, after = historySnapshot()) {
  return JSON.stringify(before.layout) !== JSON.stringify(after.layout);
}

function pushUndoSnapshot(snapshot) {
  undoStack.push(clonePlain(snapshot));
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  updateHistoryControls();
}

function withHistory(label, mutate) {
  const before = historySnapshot();
  mutate();
  if (!applyingHistory && snapshotChanged(before)) {
    pushUndoSnapshot(before);
    setStatus(label);
  }
}

function beginInteractionHistory() {
  if (!interactionHistoryStart) interactionHistoryStart = historySnapshot();
}

function commitInteractionHistory(label) {
  if (!interactionHistoryStart) return;
  const before = interactionHistoryStart;
  interactionHistoryStart = null;
  if (!applyingHistory && snapshotChanged(before)) {
    pushUndoSnapshot(before);
    setStatus(label);
  }
}

function applyLayoutSnapshot(snapshot) {
  applyingHistory = true;
  layout.version = snapshot.layout.version;
  layout.units = snapshot.layout.units;
  layout.dimensions = clonePlain(snapshot.layout.dimensions || ARENA_LAYOUT.dimensions || {});
  layout.wallBarriers = clonePlain(snapshot.layout.wallBarriers || {});
  layout.elements = clonePlain(snapshot.layout.elements || []);
  rebuildEditorScene();
  selectElementsByIds(snapshot.selectionIds || []);
  persistLayout();
  applyingHistory = false;
}

function selectElementsByIds(ids) {
  const idSet = new Set(ids);
  const objects = [...selectable].filter((object) => idSet.has(object.userData.element?.id));
  clearSelectionVisuals();
  selectedObjects = objects;
  selectedObject = objects.at(-1) || null;
  selectedObjects.forEach((object) => setObjectOutline(object, true));
  if (selectedObjects.length > 1) syncSelectionProxy();
  if (selectedObject) attachTransform();
  else transform.detach();
  updateInspector();
}

function undoChange() {
  const previous = undoStack.pop();
  if (!previous) return;
  redoStack.push(historySnapshot());
  applyLayoutSnapshot(previous);
  updateHistoryControls();
  setStatus("Undid change");
}

function redoChange() {
  const next = redoStack.pop();
  if (!next) return;
  undoStack.push(historySnapshot());
  applyLayoutSnapshot(next);
  updateHistoryControls();
  setStatus("Redid change");
}

function updateHistoryControls() {
  undoButton.disabled = undoStack.length === 0;
  redoButton.disabled = redoStack.length === 0;
}

function syncArenaDimensionsFromLayout() {
  layout.dimensions ||= clonePlain(ARENA_LAYOUT.dimensions || {});
  arenaWidth = Math.max(8, finite(layout.dimensions.width, 34));
  arenaLength = Math.max(8, finite(layout.dimensions.length, 26));
  halfWidth = arenaWidth / 2;
  halfLength = arenaLength / 2;
  layout.dimensions.width = round(arenaWidth);
  layout.dimensions.length = round(arenaLength);
  floorTexture.repeat.set(arenaWidth / 4.25, arenaLength / 4.25);
  floorTexture.needsUpdate = true;
}

function rebuildEditorScene() {
  transform.detach();
  selectedObject = null;
  selectedObjects = [];
  selectable.clear();
  root.clear();
  syncArenaDimensionsFromLayout();
  buildArenaShell();
  layout.elements.forEach(addElementObject);
}

function loadTexture(path, repeat) {
  const texture = textureLoader.load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy = 8;
  return texture;
}

function addLights() {
  scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x15130f, 1.5));
  const key = new THREE.DirectionalLight(0xffffff, 3.0);
  key.position.set(-6, 10, 7);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -22;
  key.shadow.camera.right = 22;
  key.shadow.camera.top = 18;
  key.shadow.camera.bottom = -18;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xf5b454, 1.2);
  rim.position.set(7, 6, -8);
  scene.add(rim);
}

function buildArenaShell() {
  const floor = new THREE.Mesh(new THREE.BoxGeometry(arenaWidth, 0.16, arenaLength), floorMat);
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  floor.userData.floor = true;
  root.add(floor);

  for (const z of [-halfLength, halfLength]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(arenaWidth, 1.0, 0.28), wallMat);
    wall.position.set(0, 0.5, z);
    wall.userData.wall = true;
    root.add(wall);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(arenaWidth, 7.8, 0.045), glassMat);
    glass.position.set(0, 4.8, z);
    glass.userData.wall = true;
    root.add(glass);
  }
  for (const x of [-halfWidth, halfWidth]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(0.28, 1.0, arenaLength), wallMat);
    wall.position.set(x, 0.5, 0);
    wall.userData.wall = true;
    root.add(wall);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(0.045, 7.8, arenaLength), glassMat);
    glass.position.set(x, 4.8, 0);
    glass.userData.wall = true;
    root.add(glass);
  }

  addEditorArenaBarriers(root);
}

function addFloorDecal(parent, size, material, pos, rotation = 0) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(...size), material);
  mesh.rotation.set(-Math.PI / 2, 0, rotation);
  mesh.position.set(pos[0], FLOOR_DECAL_Y, pos[1]);
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addRectOutline(parent, center, size, rotation = 0, lineWidth = 0.055) {
  const [w, d] = size;
  const corners = [
    { offset: [0, -d / 2], size: [w, lineWidth], rotation: 0 },
    { offset: [0, d / 2], size: [w, lineWidth], rotation: 0 },
    { offset: [-w / 2, 0], size: [d, lineWidth], rotation: Math.PI / 2 },
    { offset: [w / 2, 0], size: [d, lineWidth], rotation: Math.PI / 2 },
  ];
  const c = Math.cos(rotation);
  const s = Math.sin(rotation);
  corners.forEach((line) => {
    const x = center[0] + line.offset[0] * c - line.offset[1] * s;
    const z = center[1] + line.offset[0] * s + line.offset[1] * c;
    addFloorDecal(parent, line.size, lineMat, [x, z], rotation + line.rotation);
  });
}

function wallCapOffset() {
  layout.wallBarriers ||= {};
  if (Number.isFinite(layout.wallBarriers.capOffset)) return THREE.MathUtils.clamp(layout.wallBarriers.capOffset, -0.42, 2.4);
  const legacyOffsets = Object.values(layout.wallBarriers.capOffsets || {}).filter(Number.isFinite);
  layout.wallBarriers.capOffset = THREE.MathUtils.clamp(legacyOffsets[0] || 0, -0.42, 2.4);
  delete layout.wallBarriers.capOffsets;
  return layout.wallBarriers.capOffset;
}

function setWallCapOffset(value) {
  layout.wallBarriers ||= {};
  layout.wallBarriers.capOffset = round(THREE.MathUtils.clamp(value, -0.42, 2.4));
  delete layout.wallBarriers.capOffsets;
  return layout.wallBarriers.capOffset;
}

function addEditorArenaBarriers(parent) {
  const tile = 5.2;
  const addRun = (axis, sign, length) => {
    const side = axis === "x" ? (sign < 0 ? "north" : "south") : (sign < 0 ? "west" : "east");
    const count = Math.max(2, Math.ceil(length / tile));
    const step = length / count;
    for (let i = 0; i < count; i += 1) {
      const offset = -length / 2 + step * (i + 0.5);
      if (axis === "x") {
        addEditorBarrierTile(parent, {
          capId: `${side}-${i}`,
          length: step + 0.02,
          position: [offset, 0, sign * (halfLength - 0.24)],
          rotation: [0, sign < 0 ? Math.PI : 0, 0],
          side,
        });
      } else {
        addEditorBarrierTile(parent, {
          capId: `${side}-${i}`,
          length: step + 0.02,
          position: [sign * (halfWidth - 0.24), 0, offset],
          rotation: [0, sign > 0 ? Math.PI / 2 : -Math.PI / 2, 0],
          side,
        });
      }
    }
  };

  for (const z of [-halfLength + 0.16, halfLength - 0.16]) {
    addBox(parent, [arenaWidth, 0.28, 0.42], barrierMat, [0, 0.14, z], [0, 0, 0]);
    addRun("x", Math.sign(z), arenaWidth - 0.8);
  }
  for (const x of [-halfWidth + 0.16, halfWidth - 0.16]) {
    addBox(parent, [0.42, 0.28, arenaLength], barrierMat, [x, 0.14, 0], [0, 0, 0]);
    addRun("z", Math.sign(x), arenaLength - 0.8);
  }
  for (const x of [-halfWidth + 0.22, halfWidth - 0.22]) {
    for (const z of [-halfLength + 0.22, halfLength - 0.22]) {
      addEditorBarrierCorner(parent, {
        capId: `corner-${z < 0 ? "north" : "south"}-${x < 0 ? "west" : "east"}`,
        position: [x, 0, z],
      });
    }
  }
}

function addBox(parent, size, material, position, rotation = [0, 0, 0]) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addEditorBarrierTile(parent, { capId, length, position, rotation, side }) {
  const group = new THREE.Group();
  group.position.set(...position);
  group.rotation.set(...rotation);
  group.userData.wallSide = side;
  parent.add(group);

  addBox(group, [length, 0.3, 0.34], barrierMat, [0, 0.15, 0.23]);
  addBox(group, [length, 0.08, 0.96], barrierMat, [0, 0.04 + wallCapOffset(), -0.125]);
  addBox(group, [length, 0.68, 0.82], yellowWallMat, [0, 0.34, -0.08]);
  addBox(group, [length, 0.095, 0.96], barrierMat, [0, 0.68 + wallCapOffset(), -0.125]);
  addBox(group, [length, 0.1, 0.28], barrierMat, [0, 0.775 + wallCapOffset(), 0.14]);

  const toothCount = Math.max(2, Math.ceil(length / 0.72));
  const step = length / toothCount;
  for (let i = 0; i < toothCount; i += 1) {
    const x = -length / 2 + step * i;
    addBox(group, [0.055, 0.56, 0.09], yellowWallMat, [x, 0.36, -0.08]);
  }
}

function addEditorBarrierCorner(parent, { capId, position }) {
  const group = new THREE.Group();
  group.position.set(...position);
  group.rotation.y = Math.PI / 4;
  parent.add(group);

  addBox(group, [0.84, 0.28, 0.84], barrierMat, [0, 0.14, 0]);
  addBox(group, [0.92, 0.08, 0.82], barrierMat, [0, 0.04 + wallCapOffset(), -0.078]);
  addBox(group, [0.92, 0.6, 0.7], yellowWallMat, [0, 0.3, -0.04]);
  addBox(group, [0.92, 0.09, 0.82], barrierMat, [0, 0.59 + wallCapOffset(), -0.078]);
  addBox(group, [0.76, 0.08, 0.72], barrierMat, [0, 0.675 + wallCapOffset(), -0.08]);
}

function makeElementMaterial(element) {
  if (element.type === "logo") return logoMat;
  if (element.type === "killSaw") return slotMat;
  const color = element.color || PLACEHOLDER_COLORS[element.type] || "#7dd3fc";
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.66, depthWrite: false });
}

function createKillSawBlade(radius = 0.34) {
  const toothCount = 18;
  const shape = new THREE.Shape();
  for (let i = 0; i <= toothCount * 2; i += 1) {
    const angle = (i / (toothCount * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? radius : radius * 0.76;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  const blade = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshStandardMaterial({ color: 0xd9dde0, metalness: 0.86, roughness: 0.28, side: THREE.DoubleSide }),
  );
  blade.rotation.x = -Math.PI / 2;
  blade.position.y = 0.03;
  blade.userData.pickProxy = true;
  return blade;
}

function createElementObject(element) {
  const group = new THREE.Group();
  group.name = element.label || element.id;
  group.userData.elementId = element.id;
  group.userData.element = element;
  group.position.set(finite(element.position?.x, 0), FLOOR_Y, finite(element.position?.z, 0));
  let screwDims = null;
  let visualDepth = 1;
  if (element.type === "screw") {
    screwDims = screwHazardDimensions(element, { layout, floorY: FLOOR_Y });
    visualDepth = screwDims.capDepth;
    group.rotation.y = screwInwardRotation(group.position, { arenaHalfWidth: halfWidth, arenaHalfLength: halfLength });
    group.scale.set(Math.max(0.1, screwDims.totalLength), 1, 1);
  } else {
    group.rotation.y = THREE.MathUtils.degToRad(snapDegrees(element.rotation || 0));
    group.scale.set(Math.max(0.1, finite(element.size?.x, 1)), 1, Math.max(0.1, finite(element.size?.z, 1)));
  }

  const material = makeElementMaterial(element);
  const planeSize = element.type === "killSaw" ? [0.8, 0.56] : [1, visualDepth];
  const base = addFloorDecal(group, planeSize, material, [0, 0], 0);
  base.userData.pickProxy = true;

  if (element.type === "killSaw") {
    addRectOutline(group, [0, 0], [1, 1], 0, 0.035);
    const blade = createKillSawBlade(0.36);
    group.add(blade);
  } else if (element.type !== "logo") {
    addRectOutline(group, [0, 0], [1, visualDepth], 0, 0.035);
  }

  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 0.08, visualDepth)), selectedMat);
  outline.position.y = 0.15;
  outline.visible = false;
  outline.userData.selectionOutline = true;
  group.add(outline);
  return group;
}

function addElementObject(element) {
  normalizeElement(element);
  const object = createElementObject(element);
  root.add(object);
  selectable.add(object);
  return object;
}

function normalizeElement(element) {
  element.id ||= uniqueId(element.type || "object");
  element.type ||= "screw";
  element.label ||= `${TYPE_LABELS[element.type] || "Object"} ${layout.elements.length + 1}`;
  element.position ||= { x: 0, z: 0 };
  element.size ||= clonePlain(DEFAULTS[element.type]?.size || { x: 1, z: 1 });
  element.rotation = snapDegrees(finite(element.rotation, 0));
  element.visibleInGame = visibleInGameForType(element.type);
  if (!element.color && DEFAULTS[element.type]?.color) element.color = DEFAULTS[element.type].color;
  if (element.type === "startBox") {
    element.side ||= DEFAULTS.startBox.side;
    element.spawn ||= { y: 0.55, yaw: element.side === "rival" ? 180 : 0 };
  }
}

function syncElementFromObject(object, { silent = false } = {}) {
  const element = object?.userData.element;
  if (!element) return;
  object.position.x = THREE.MathUtils.clamp(object.position.x, -halfWidth, halfWidth);
  object.position.y = FLOOR_Y;
  object.position.z = THREE.MathUtils.clamp(object.position.z, -halfLength, halfLength);
  object.rotation.x = 0;
  object.rotation.z = 0;
  if (element.type === "screw") {
    object.rotation.y = screwInwardRotation(object.position, { arenaHalfWidth: halfWidth, arenaHalfLength: halfLength });
  } else {
    object.rotation.y = THREE.MathUtils.degToRad(snapDegrees(THREE.MathUtils.radToDeg(object.rotation.y)));
  }
  object.scale.x = Math.max(0.1, Math.abs(object.scale.x));
  object.scale.y = 1;
  object.scale.z = Math.max(0.1, Math.abs(object.scale.z));

  element.position = { x: round(object.position.x), z: round(object.position.z) };
  if (element.type === "screw") {
    const dims = screwHazardDimensions(element, { layout, floorY: FLOOR_Y });
    element.size = { x: round(object.scale.x), z: round(dims.size[1]) };
    element.rotation = snapDegrees(THREE.MathUtils.radToDeg(object.rotation.y));
    object.scale.z = 1;
  } else {
    element.size = { x: round(object.scale.x), z: round(object.scale.z) };
    element.rotation = snapDegrees(THREE.MathUtils.radToDeg(object.rotation.y));
  }
  if (element.type === "startBox") {
    element.spawn ||= { y: 0.55, yaw: element.side === "rival" ? 180 : 0 };
    element.spawn.y = finite(element.spawn.y, 0.55);
    element.spawn.yaw = element.rotation;
  }
  if (!silent) {
    updateInspector();
    persistLayout();
  }
}

function captureTransformStart() {
  if (selectedObjects.length > 1 && transform.object === selectionProxy) {
    syncSelectionProxy();
    return {
      kind: "multi",
      mode: transform.mode,
      proxyPosition: selectionProxy.position.clone(),
      proxyRotationY: selectionProxy.rotation.y,
      proxyScale: selectionProxy.scale.clone(),
      objects: selectedObjects.map((object) => ({
        object,
        position: object.position.clone(),
        rotationY: object.rotation.y,
        scale: object.scale.clone(),
      })),
    };
  }
  if (selectedObject?.userData.element) {
    return {
      kind: "single",
      object: selectedObject,
      position: selectedObject.position.clone(),
      rotationY: selectedObject.rotation.y,
      scale: selectedObject.scale.clone(),
    };
  }
  return null;
}

function applyMultiTransform() {
  if (!transformStart || transformStart.kind !== "multi") return;
  const delta = selectionProxy.position.clone().sub(transformStart.proxyPosition);
  const yawDelta = selectionProxy.rotation.y - transformStart.proxyRotationY;
  const scaleDelta = new THREE.Vector3(
    selectionProxy.scale.x / Math.max(0.0001, transformStart.proxyScale.x),
    1,
    selectionProxy.scale.z / Math.max(0.0001, transformStart.proxyScale.z),
  );
  const center = transformStart.proxyPosition;
  const cos = Math.cos(yawDelta);
  const sin = Math.sin(yawDelta);

  transformStart.objects.forEach(({ object, position, rotationY, scale }) => {
    let nextX = position.x;
    let nextZ = position.z;
    if (transform.mode === "translate") {
      nextX += delta.x;
      nextZ += delta.z;
    } else if (transform.mode === "rotate") {
      const dx = position.x - center.x;
      const dz = position.z - center.z;
      nextX = center.x + dx * cos - dz * sin;
      nextZ = center.z + dx * sin + dz * cos;
      object.rotation.y = THREE.MathUtils.degToRad(snapDegrees(THREE.MathUtils.radToDeg(rotationY + yawDelta)));
    } else if (transform.mode === "scale") {
      nextX = center.x + (position.x - center.x) * Math.abs(scaleDelta.x);
      nextZ = center.z + (position.z - center.z) * Math.abs(scaleDelta.z);
      object.scale.x = Math.max(0.1, Math.abs(scale.x * scaleDelta.x));
      object.scale.z = Math.max(0.1, Math.abs(scale.z * scaleDelta.z));
    }
    object.position.x = THREE.MathUtils.clamp(nextX, -halfWidth, halfWidth);
    object.position.y = FLOOR_Y;
    object.position.z = THREE.MathUtils.clamp(nextZ, -halfLength, halfLength);
    syncElementFromObject(object, { silent: true });
  });
  updateInspector();
  persistLayout();
}

function snapDegrees(degrees) {
  const snapped = Math.round(degrees / 90) * 90;
  return ((snapped % 360) + 360) % 360;
}

function round(value) {
  return Number(value.toFixed(3));
}

function uniqueId(type) {
  const base = type.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^-/, "");
  let i = 1;
  let id = `${base}-${i}`;
  const ids = new Set(layout.elements.map((element) => element.id));
  while (ids.has(id)) {
    i += 1;
    id = `${base}-${i}`;
  }
  return id;
}

function setObjectOutline(object, visible) {
  object?.children.forEach((child) => {
    if (child.userData.selectionOutline) child.visible = visible;
  });
}

function clearSelectionVisuals() {
  selectedObjects.forEach((object) => setObjectOutline(object, false));
}

function selectionTransformTarget() {
  return selectedObjects.length > 1 ? selectionProxy : selectedObject;
}

function syncSelectionProxy() {
  if (selectedObjects.length <= 1) return;
  const center = selectedObjects.reduce((sum, object) => sum.add(object.position), new THREE.Vector3()).multiplyScalar(1 / selectedObjects.length);
  selectionProxy.position.set(center.x, FLOOR_Y, center.z);
  selectionProxy.rotation.set(0, 0, 0);
  selectionProxy.scale.set(1, 1, 1);
}

function selectObject(object, { additive = false } = {}) {
  if (!additive) clearSelectionVisuals();

  if (!object) {
    selectedObject = null;
    selectedObjects = [];
    transform.detach();
    updateInspector();
    return;
  }

  if (additive && object.userData.element) {
    const index = selectedObjects.indexOf(object);
    if (index >= 0) {
      setObjectOutline(object, false);
      selectedObjects.splice(index, 1);
      selectedObject = selectedObjects.at(-1) || null;
    } else {
      selectedObjects.push(object);
      selectedObject = object;
    }
  } else {
    selectedObjects = [object];
    selectedObject = object;
  }

  selectedObjects.forEach((candidate) => setObjectOutline(candidate, true));
  if (selectedObjects.length > 1) syncSelectionProxy();
  if (selectedObject) attachTransform();
  else transform.detach();
  updateInspector();
}

function modeForModifiers() {
  if (!selectedObject) return "translate";
  if (selectedObjects.length > 1) {
    if (modifierState.alt) return "scale";
    if (modifierState.shift) return "rotate";
    return "translate";
  }
  if (modifierState.alt) return "scale";
  if (selectedObject.userData.element?.type === "screw") return "translate";
  if (modifierState.shift) return "rotate";
  return "translate";
}

function attachTransform() {
  if (selectedObjects.length > 1) syncSelectionProxy();
  const mode = modeForModifiers();
  transform.setMode(mode);
  transform.showX = true;
  transform.showY = mode === "rotate";
  transform.showZ = mode !== "rotate";
  if (mode === "rotate") {
    transform.showX = false;
    transform.showZ = false;
  } else {
    transform.showY = false;
  }
  if (mode === "scale" && selectedObjects.length === 1 && selectedObject?.userData.element?.type === "screw") {
    transform.showZ = false;
  }
  transform.attach(selectionTransformTarget());
}

function updateInspector() {
  if (selectedObjects.length > 1) {
    inspector.hidden = true;
    arenaInspector.hidden = true;
    selectedName.textContent = `${selectedObjects.length} objects`;
    mirrorButton.disabled = true;
    copyButton.disabled = false;
    deleteButton.disabled = false;
    return;
  }
  const element = selectedObject?.userData.element || null;
  inspector.hidden = !element;
  arenaInspector.hidden = Boolean(element);
  selectedName.textContent = element ? `${element.label || element.id} (${TYPE_LABELS[element.type] || element.type})` : "None";
  const hasSelection = Boolean(element);
  mirrorButton.disabled = !hasSelection;
  copyButton.disabled = !hasSelection;
  deleteButton.disabled = !hasSelection;
  if (!element) {
    arenaWidthInput.value = round(arenaWidth);
    arenaLengthInput.value = round(arenaLength);
    capOffsetInput.value = round(wallCapOffset());
    return;
  }
  labelInput.value = element.label || "";
  typeInput.value = element.type;
  rotationInput.value = String(snapDegrees(element.rotation || 0));
  rotationInput.disabled = element.type === "screw";
  sideRow.hidden = element.type !== "startBox";
  sideInput.value = element.side || "neutral";
  visibleGameInput.checked = visibleInGameForType(element.type);
  visibleGameInput.disabled = true;
  inspector.querySelectorAll("[data-field]").forEach((input) => {
    const [rootKey, leafKey] = input.dataset.field.split(".");
    input.value = element[rootKey]?.[leafKey] ?? "";
    input.disabled = element.type === "screw" && input.dataset.field === "size.z";
    if (element.type === "screw" && input.dataset.field === "size.z") {
      input.value = round(screwHazardDimensions(element, { layout, floorY: FLOOR_Y }).depth);
    }
  });
}

function applyArenaSizeFromInputs() {
  const oldWidth = arenaWidth;
  const oldLength = arenaLength;
  const nextWidth = THREE.MathUtils.clamp(Number(arenaWidthInput.value), 8, 80);
  const nextLength = THREE.MathUtils.clamp(Number(arenaLengthInput.value), 8, 80);
  if (!Number.isFinite(nextWidth) || !Number.isFinite(nextLength)) return;
  if (Math.abs(nextWidth - oldWidth) < 0.0001 && Math.abs(nextLength - oldLength) < 0.0001) return;

  const xScale = nextWidth / Math.max(0.001, oldWidth);
  const zScale = nextLength / Math.max(0.001, oldLength);
  layout.elements.forEach((element) => {
    element.position ||= { x: 0, z: 0 };
    element.position.x = round(THREE.MathUtils.clamp(finite(element.position.x, 0) * xScale, -nextWidth / 2, nextWidth / 2));
    element.position.z = round(THREE.MathUtils.clamp(finite(element.position.z, 0) * zScale, -nextLength / 2, nextLength / 2));
  });
  layout.dimensions ||= clonePlain(ARENA_LAYOUT.dimensions || {});
  layout.dimensions.width = round(nextWidth);
  layout.dimensions.length = round(nextLength);
  rebuildEditorScene();
  selectObject(null);
  persistLayout();
  setStatus(`BattleBox resized to ${round(nextWidth)} x ${round(nextLength)}`);
}

function setStatus(text) {
  statusText.textContent = text;
}

function setPointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function owningSelectable(object) {
  let node = object;
  while (node) {
    if (selectable.has(node)) return node;
    node = node.parent;
  }
  return null;
}

function pointerHits(event) {
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObjects([...selectable], true);
}

function createElement(type) {
  const defaults = clonePlain(DEFAULTS[type] || DEFAULTS.screw);
  const offset = layout.elements.length * 0.35;
  const element = {
    id: uniqueId(type),
    type,
    label: `${TYPE_LABELS[type] || "Object"} ${layout.elements.length + 1}`,
    position: {
      x: round(THREE.MathUtils.clamp(-2.4 + offset, -halfWidth + 2, halfWidth - 2)),
      z: round(THREE.MathUtils.clamp(1.8 - offset * 0.4, -halfLength + 2, halfLength - 2)),
    },
    size: defaults.size,
    rotation: 0,
    visibleInGame: visibleInGameForType(type),
  };
  if (defaults.color) element.color = defaults.color;
  if (type === "startBox") {
    element.side = "neutral";
    element.spawn = { y: 0.55, yaw: 0 };
  }
  layout.elements.push(element);
  const object = addElementObject(element);
  selectObject(object);
  persistLayout();
  setStatus(`Created ${element.label}`);
}

function duplicateSelected({ mirrorAxis = null } = {}) {
  const sources = selectedObjects.length ? selectedObjects.map((object) => object.userData.element).filter(Boolean) : [selectedObject?.userData.element].filter(Boolean);
  if (!sources.length) return;
  clearSelectionVisuals();
  selectedObjects = [];
  selectedObject = null;
  const created = sources.map((source) => {
    const element = clonePlain(source);
    element.id = uniqueId(source.type);
    element.label = mirrorAxis ? `${source.label || source.id} mirror` : `${source.label || source.id} copy`;
    element.position ||= { x: 0, z: 0 };
    if (mirrorAxis === "x") {
      element.position.z = round(-finite(element.position.z, 0));
      element.rotation = snapDegrees(-finite(element.rotation, 0));
    } else if (mirrorAxis === "z") {
      element.position.x = round(-finite(element.position.x, 0));
      element.rotation = snapDegrees(180 - finite(element.rotation, 0));
    } else {
      element.position.x = round(finite(element.position.x, 0) + 0.6);
      element.position.z = round(finite(element.position.z, 0) + 0.6);
    }
    if (element.type === "startBox") {
      element.spawn ||= { y: 0.55, yaw: 0 };
      element.spawn.yaw = element.rotation;
    }
    layout.elements.push(element);
    return addElementObject(element);
  });
  selectedObjects = created;
  selectedObject = created.at(-1) || null;
  selectedObjects.forEach((object) => setObjectOutline(object, true));
  if (selectedObjects.length > 1) syncSelectionProxy();
  attachTransform();
  updateInspector();
  persistLayout();
  setStatus(mirrorAxis ? `Created ${created.length} mirror${created.length === 1 ? "" : "s"} across ${mirrorAxis.toUpperCase()} axis` : `Copied ${created.length} object${created.length === 1 ? "" : "s"}`);
}

function deleteSelected() {
  if (!selectedObject) return;
  const objects = selectedObjects.length ? [...selectedObjects] : [selectedObject];
  const elements = new Set(objects.map((object) => object.userData.element).filter(Boolean));
  layout.elements = layout.elements.filter((candidate) => !elements.has(candidate));
  objects.forEach((object) => {
    selectable.delete(object);
    root.remove(object);
    object.traverse((child) => {
      child.geometry?.dispose?.();
      if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
      else if (child.material !== logoMat && child.material !== lineMat && child.material !== slotMat) child.material?.dispose?.();
    });
  });
  selectObject(null);
  persistLayout();
  setStatus(`Deleted ${objects.length} object${objects.length === 1 ? "" : "s"}`);
}

function cleanLayout() {
  const wallBarriers = clonePlain(layout.wallBarriers || {});
  wallBarriers.capOffset = round(wallCapOffset());
  delete wallBarriers.capOffsets;
  const dimensions = clonePlain(layout.dimensions || ARENA_LAYOUT.dimensions);
  dimensions.width = round(arenaWidth);
  dimensions.length = round(arenaLength);
  const screwHazards = {
    ...clonePlain(ARENA_LAYOUT.screwHazards || {}),
    ...clonePlain(layout.screwHazards || {}),
  };
  Object.keys(screwHazards).forEach((key) => {
    screwHazards[key] = round(finite(screwHazards[key], ARENA_LAYOUT.screwHazards?.[key] ?? screwHazards[key]));
  });
  screwHazards.depth = round(Math.max(0.5, finite(screwHazards.depth, 2)));
  screwHazards.rotationSpeed = round(finite(screwHazards.rotationSpeed, 5.2));
  return {
    version: layout.version || 1,
    units: "feet",
    dimensions,
    wallBarriers,
    screwHazards,
    elements: layout.elements.map((element) => {
      const clean = clonePlain(element);
      clean.visibleInGame = visibleInGameForType(clean.type);
      clean.position = { x: round(finite(clean.position?.x, 0)), z: round(finite(clean.position?.z, 0)) };
      clean.size = { x: round(Math.max(0.1, finite(clean.size?.x, 1))), z: round(Math.max(0.1, finite(clean.size?.z, 1))) };
      if (clean.type === "screw") {
        clean.rotation = snapDegrees(THREE.MathUtils.radToDeg(screwInwardRotation(clean.position, { arenaHalfWidth: arenaWidth / 2, arenaHalfLength: arenaLength / 2 })));
        clean.size.z = round(screwHazardDimensions(clean, { layout: { ...layout, screwHazards }, floorY: FLOOR_Y }).depth);
      } else {
        clean.rotation = snapDegrees(clean.rotation || 0);
      }
      return clean;
    }),
  };
}

function formatJsonAt(value, indent = 0) {
  const padding = " ".repeat(indent);
  return JSON.stringify(value, null, 2)
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${padding}${line}`))
    .join("\n");
}

function formatProperty(key, value, indent = 2, trailingComma = true) {
  const padding = " ".repeat(indent);
  return `${padding}"${key}": ${formatJsonAt(value, indent)}${trailingComma ? "," : ""}`;
}

function formatScrewHazards(screwHazards) {
  const orderedKeys = [
    "depth",
    "rotationSpeed",
    "capLength",
    "capHeight",
    "minCapDepth",
    "capDepthPadding",
    "bladeRadiusScale",
    "minBladeRadius",
    "maxBladeRadius",
    "axisRadiusScale",
    "minAxisY",
    "axisYOffset",
    "pitch",
    "impactSpeedThreshold",
    "impactDamageScale",
    "pressureDamageBase",
    "pressureDamageSpeedScale",
    "damageCooldown",
    "pressureSparkThreshold",
    "sparkCooldown",
    "baseInwardImpulse",
    "speedInwardImpulseScale",
    "maxInwardImpulse",
    "baseLiftImpulse",
    "speedLiftImpulseScale",
    "maxLiftImpulse",
    "radialImpulseScale",
    "maxRadialImpulse",
    "unstableSeconds",
    "unstablePressureSeconds",
    "torqueXScale",
    "torqueYScale",
    "torqueZScale",
  ];
  const comments = new Map([
    ["depth", "    // Screw dimensions are feet; rotationSpeed is radians per second."],
    ["impactSpeedThreshold", "    // impactSpeedThreshold is ft/s; impactDamageScale is hp per ft/s above that threshold."],
    ["pressureDamageBase", "    // Held-contact damage rates are hp per second at full pressure."],
    ["pressureDamageSpeedScale", "    // Adds hp per second for each ft/s of screw surface speed at full pressure."],
    ["damageCooldown", "    // Cooldowns and unstable durations are seconds."],
  ]);
  const keys = [
    ...orderedKeys.filter((key) => Object.hasOwn(screwHazards, key)),
    ...Object.keys(screwHazards).filter((key) => !orderedKeys.includes(key)),
  ];
  const lines = ['  "screwHazards": {'];
  keys.forEach((key, index) => {
    if (comments.has(key)) lines.push(comments.get(key));
    lines.push(formatProperty(key, screwHazards[key], 4, index < keys.length - 1));
  });
  lines.push("  }");
  return lines.join("\n");
}

function outputArenaModule() {
  const clean = cleanLayout();
  return [
    "export const ARENA_LAYOUT = {",
    formatProperty("version", clean.version),
    "  // Distances are feet. Speeds are per second. Damage values are hp.",
    formatProperty("units", clean.units),
    formatProperty("dimensions", clean.dimensions),
    formatProperty("wallBarriers", clean.wallBarriers),
    `${formatScrewHazards(clean.screwHazards)},`,
    formatProperty("elements", clean.elements, 2, false),
    "};",
    "",
  ].join("\n");
}

function showOutput() {
  outputText.value = outputArenaModule();
  outputDialog.showModal();
  outputText.select();
  setStatus("Arena output ready");
}

function downloadOutput() {
  const blob = new Blob([outputArenaModule()], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "arenaConfig.js";
  anchor.click();
  URL.revokeObjectURL(url);
}

function resize() {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function animate() {
  requestAnimationFrame(animate);
  orbit.update();
  renderer.render(scene, camera);
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || transform.dragging || performance.now() - dragStartedAt < 90) return;
  const hits = pointerHits(event);
  const object = hits.length ? owningSelectable(hits[0].object) : null;
  const additive = event.shiftKey || event.ctrlKey || event.metaKey;
  if (object) {
    pendingDeselect = null;
    selectObject(object, { additive });
  } else {
    pendingDeselect = { x: event.clientX, y: event.clientY, moved: false };
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (!pendingDeselect) return;
  if (Math.hypot(event.clientX - pendingDeselect.x, event.clientY - pendingDeselect.y) > 5) pendingDeselect.moved = true;
});

canvas.addEventListener("pointerup", (event) => {
  if (!pendingDeselect) return;
  const moved = pendingDeselect.moved || Math.hypot(event.clientX - pendingDeselect.x, event.clientY - pendingDeselect.y) > 5;
  pendingDeselect = null;
  if (!moved) selectObject(null);
});

transform.addEventListener("dragging-changed", (event) => {
  orbit.enabled = !event.value;
  if (event.value) {
    beginInteractionHistory();
    transformStart = captureTransformStart();
    return;
  }
  dragStartedAt = performance.now();
  if (transformStart?.kind === "multi") applyMultiTransform();
  else syncElementFromObject(selectedObject);
  transformStart = null;
  commitInteractionHistory("Edited selection");
  if (selectedObjects.length > 1) {
    syncSelectionProxy();
    attachTransform();
  }
});

transform.addEventListener("objectChange", () => {
  if (transformStart?.kind === "multi") applyMultiTransform();
  else syncElementFromObject(selectedObject);
});

window.addEventListener("keydown", (event) => {
  modifierState.shift = event.shiftKey;
  modifierState.alt = event.altKey;
  const key = event.key.toLowerCase();
  const commandKey = event.metaKey || event.ctrlKey;
  if (!event.repeat && commandKey && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redoChange();
    else undoChange();
    return;
  }
  if (!event.repeat && commandKey && key === "y") {
    event.preventDefault();
    redoChange();
    return;
  }
  if (!event.repeat && selectedObject && (event.key === "Delete" || event.key === "Backspace")) {
    withHistory("Deleted selection", deleteSelected);
    return;
  }
  if (!event.repeat && selectedObject && commandKey && key === "d") {
    event.preventDefault();
    withHistory("Copied selection", () => duplicateSelected());
  }
  if (selectedObject && !transform.dragging) attachTransform();
});

window.addEventListener("keyup", (event) => {
  modifierState.shift = event.shiftKey;
  modifierState.alt = event.altKey;
  if (selectedObject && !transform.dragging) attachTransform();
});

window.addEventListener("resize", resize);

undoButton.addEventListener("click", undoChange);
redoButton.addEventListener("click", redoChange);
createButton.addEventListener("click", () => withHistory("Created object", () => createElement(createTypeSelect.value)));
copyButton.addEventListener("click", () => withHistory("Copied selection", () => duplicateSelected()));
mirrorButton.addEventListener("click", () => withHistory("Created mirror", () => duplicateSelected({ mirrorAxis: mirrorAxisSelect.value })));
deleteButton.addEventListener("click", () => withHistory("Deleted selection", deleteSelected));
outputButton.addEventListener("click", showOutput);
downloadOutputButton.addEventListener("click", downloadOutput);
copyOutputButton.addEventListener("click", async () => {
  if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(outputText.value);
  else {
    outputText.focus();
    outputText.select();
    document.execCommand("copy");
  }
  setStatus("Copied arena output");
});

labelInput.addEventListener("input", () => {
  beginInteractionHistory();
  const element = selectedObject?.userData.element;
  if (!element) return;
  element.label = labelInput.value;
  selectedObject.name = element.label || element.id;
  updateInspector();
  persistLayout();
});
labelInput.addEventListener("change", () => commitInteractionHistory("Renamed object"));
labelInput.addEventListener("blur", () => commitInteractionHistory("Renamed object"));

typeInput.addEventListener("change", () => {
  withHistory("Changed object type", () => {
    const oldObject = selectedObject;
    const element = oldObject?.userData.element;
    if (!element) return;
    element.type = typeInput.value;
    if (DEFAULTS[element.type]?.color) element.color = DEFAULTS[element.type].color;
    element.visibleInGame = visibleInGameForType(element.type);
    selectable.delete(oldObject);
    root.remove(oldObject);
    const nextObject = addElementObject(element);
    selectObject(nextObject);
    persistLayout();
  });
});

rotationInput.addEventListener("change", () => {
  withHistory("Rotated object", () => {
    const element = selectedObject?.userData.element;
    if (!element) return;
    element.rotation = snapDegrees(Number(rotationInput.value));
    selectedObject.rotation.y = THREE.MathUtils.degToRad(element.rotation);
    syncElementFromObject(selectedObject);
  });
});

sideInput.addEventListener("change", () => {
  withHistory("Changed side", () => {
    const element = selectedObject?.userData.element;
    if (!element) return;
    element.side = sideInput.value;
    if (element.type === "startBox") {
      element.spawn ||= { y: 0.55, yaw: element.rotation || 0 };
      element.spawn.yaw = element.rotation || 0;
    }
    persistLayout();
  });
});

visibleGameInput.addEventListener("change", () => {
  withHistory("Changed visibility", () => {
    const element = selectedObject?.userData.element;
    if (!element) return;
    element.visibleInGame = visibleInGameForType(element.type);
    visibleGameInput.checked = element.visibleInGame;
    persistLayout();
  });
});

function applyCapOffsetInput() {
  setWallCapOffset(Number(capOffsetInput.value));
  rebuildEditorScene();
  selectObject(null);
  persistLayout();
  setStatus(`Wall cap Y offset ${round(wallCapOffset())}`);
}

capOffsetInput.addEventListener("input", applyCapOffsetInput);
capOffsetInput.addEventListener("focus", beginInteractionHistory);
capOffsetInput.addEventListener("change", () => {
  applyCapOffsetInput();
  commitInteractionHistory("Changed wall cap offset");
});
capOffsetInput.addEventListener("blur", () => commitInteractionHistory("Changed wall cap offset"));

arenaWidthInput.addEventListener("change", () => withHistory("Resized BattleBox", applyArenaSizeFromInputs));
arenaLengthInput.addEventListener("change", () => withHistory("Resized BattleBox", applyArenaSizeFromInputs));

inspector.addEventListener("change", (event) => {
  withHistory("Edited object", () => {
    const input = event.target.closest("[data-field]");
    const element = selectedObject?.userData.element;
    if (!input || !element) return;
    const [rootKey, leafKey] = input.dataset.field.split(".");
    element[rootKey] ||= {};
    element[rootKey][leafKey] = Number(input.value);
    selectedObject.position.set(finite(element.position?.x, 0), FLOOR_Y, finite(element.position?.z, 0));
    selectedObject.scale.set(Math.max(0.1, finite(element.size?.x, 1)), 1, Math.max(0.1, finite(element.size?.z, 1)));
    syncElementFromObject(selectedObject);
  });
});
