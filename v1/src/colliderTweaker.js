import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { stepPhysicsArena } from "./arenaPhysicsStep.js";
import { MODEL_PART_CONFIG } from "./modelPartConfig.js";
import { clearOriginalAuthoringBounds, ensureOriginalAuthoringBounds } from "./modelParts.js";
import { DEFAULT_PHYSICAL_DAMAGE_OPTIONS, applyPhysicalDamageBreak } from "./physicalDamage.js?v=game-config-1";
import { PHYSICAL_DAMAGE_COLLIDER_CARVE, PHYSICAL_DAMAGE_FILL, PHYSICAL_DAMAGE_SYNC_NOTE } from "./physicalDamageShared.js";
import { createPhysics } from "./physics.js";
import { COLLIDER_TWEAKER_CONTROL_DEFAULTS, applyControlDefaults } from "./gameConfig.js";
import {
  authoredColliderParts,
  bots,
  buildModelViewerGroup,
  colliderVisibleForMode,
  generateColliderPartsFromVisual,
  makeColliderObject,
  measureVisualFloorOffset,
  rebuildModelViewerSplit,
  refreshColliderObjectGeometry,
  regionBoxForWeaponSplit,
  setObjectFromPart,
  setViewerPartVisibility,
  splitAuthoringBounds,
  syncPartFromObject,
} from "./colliderTools.js";

const canvas = document.querySelector("#scene");
const botSelect = document.querySelector("#bot-select");
const editModeSelect = document.querySelector("#edit-mode");
const colliderViewModeSelect = document.querySelector("#collider-view-mode");
const geometryViewSelect = document.querySelector("#geometry-view");
const outputButton = document.querySelector("#output-colliders");
const outputWeaponSplitButton = document.querySelector("#output-weapon-split");
const outputGeometryButton = document.querySelector("#output-geometry");
const geometryCutterActions = document.querySelector("#geometry-cutter-actions");
const physicsTestActions = document.querySelector("#physics-test-actions");
const runPhysicsTestButton = document.querySelector("#run-physics-test");
const outputPhysicsTestButton = document.querySelector("#output-physics-test");
const snapshotPhysicsTestButton = document.querySelector("#snapshot-physics-test");
const physicsVelocityInputs = {
  x: document.querySelector("#physics-velocity-x"),
  y: document.querySelector("#physics-velocity-y"),
  z: document.querySelector("#physics-velocity-z"),
};
const physicsGravityInput = document.querySelector("#physics-gravity");
const physicsGravityValue = document.querySelector("#physics-gravity-value");
const physicsViewCollidersInput = document.querySelector("#physics-view-colliders");
const physicsWeaponOnInput = document.querySelector("#physics-weapon-on");
const physicsRecentlyHitInput = document.querySelector("#physics-recently-hit");
const physicsSelfRightingInput = document.querySelector("#physics-self-righting");
const physicalDamageActions = document.querySelector("#physical-damage-actions");
const causePhysicalDamageButton = document.querySelector("#cause-physical-damage");
const tweakerDamageAmountInput = document.querySelector("#tweaker-damage-amount");
const tweakerDamageHitsInput = document.querySelector("#tweaker-damage-hits");
const tweakerDamageRadiusInput = document.querySelector("#tweaker-damage-radius");
const tweakerDamageMatchRadiusInput = document.querySelector("#tweaker-damage-match-radius");
const tweakerDamageMaxRadiusInput = document.querySelector("#tweaker-damage-max-radius");
const tweakerDamageMaxMatchRadiusInput = document.querySelector("#tweaker-damage-max-match-radius");
const tweakerDamageMaxRadiusMultiplierInput = document.querySelector("#tweaker-damage-max-radius-multiplier");
const tweakerDamageThresholdInput = document.querySelector("#tweaker-damage-threshold");
const tweakerDamageResilienceInput = document.querySelector("#tweaker-damage-resilience");
const tweakerDamageImpulseInput = document.querySelector("#tweaker-damage-impulse");
const tweakerDamageMaxPiecesInput = document.querySelector("#tweaker-damage-max-pieces");
const tweakerDamageConvexInput = document.querySelector("#tweaker-damage-convex");
const physicalDamageViewCollidersInput = document.querySelector("#physical-damage-view-colliders");
const outputBreakInfoButton = document.querySelector("#output-break-info");
const physicalDamageStatus = document.querySelector("#physical-damage-status");
const createModelTransformButton = document.querySelector("#create-model-transform");
const createCutBoxButton = document.querySelector("#create-cut-box");
const applyGeometryCutButton = document.querySelector("#apply-geometry-cut");
const applyGeometryFillButton = document.querySelector("#apply-geometry-fill");
const weaponSplitDebug = document.querySelector("#weapon-split-debug");
const viewWeaponSplitInput = document.querySelector("#view-weapon-split");
const weaponSplitInputs = [...document.querySelectorAll("[data-split-field]")];
const weaponMirrorRow = document.querySelector("#weapon-mirror-row");
const weaponMirrorAngleRow = document.querySelector("#weapon-mirror-angle-row");
const weaponAxisPitchRow = document.querySelector("#weapon-axis-pitch-row");

applyControlDefaults(COLLIDER_TWEAKER_CONTROL_DEFAULTS);
const weaponRegionYawRow = document.querySelector("#weapon-region-yaw-row");
const resetButton = document.querySelector("#reset-colliders");
const autoGenerateButton = document.querySelector("#auto-generate-colliders");
const newColliderTypeSelect = document.querySelector("#new-collider-type");
const addColliderButton = document.querySelector("#add-collider");
const deleteCollidersButton = document.querySelector("#delete-colliders");
const undoButton = document.querySelector("#undo-change");
const redoButton = document.querySelector("#redo-change");
const statusText = document.querySelector("#status-text");
const selectedText = document.querySelector("#selected-collider");
const numericInspector = document.querySelector("#numeric-inspector");
const numericInspectorTitle = document.querySelector("#numeric-inspector-title");
const numericInspectorFields = document.querySelector("#numeric-inspector-fields");
const modal = document.querySelector("#collider-output-modal");
const outputTitle = document.querySelector("#output-title");
const outputText = document.querySelector("#collider-output-text");
const copyButton = document.querySelector("#copy-output");
const closeOutputButtons = [...document.querySelectorAll("[data-close-output]")];

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x101314);
scene.fog = new THREE.Fog(0x101314, 18, 42);

const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 120);
camera.position.set(4.5, 3.0, 6.5);

const orbit = new OrbitControls(camera, canvas);
orbit.target.set(0, 0.75, 0);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.maxPolarAngle = Math.PI;
orbit.minDistance = 2.2;
orbit.maxDistance = 18;

const transform = new TransformControls(camera, canvas);
transform.setSize(0.86);
scene.add(transform.getHelper ? transform.getHelper() : transform);

const groundReference = new THREE.Group();
groundReference.name = "groundReference";
groundReference.userData.toolKind = "groundReference";
const groundPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(12, 12),
  new THREE.MeshBasicMaterial({
    color: 0x7fd6ff,
    transparent: true,
    opacity: 0.055,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
);
groundPlane.rotation.x = -Math.PI / 2;
groundPlane.renderOrder = -4;
groundPlane.userData.hideWhenCameraBelowFloor = true;
const groundGrid = new THREE.GridHelper(12, 24, 0xbfefff, 0x5a6f75);
const groundGridMaterials = Array.isArray(groundGrid.material) ? groundGrid.material : [groundGrid.material];
groundGridMaterials.forEach((material) => {
  material.transparent = true;
  material.opacity = 0.42;
  material.depthWrite = false;
});
groundGrid.renderOrder = -3;
groundReference.add(groundPlane, groundGrid);
scene.add(groundReference);

scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x15130f, 1.6));
const keyLight = new THREE.DirectionalLight(0xffffff, 3.1);
keyLight.position.set(-4.5, 7.5, 5.5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -12;
keyLight.shadow.camera.right = 12;
keyLight.shadow.camera.top = 12;
keyLight.shadow.camera.bottom = -12;
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 32;
keyLight.shadow.bias = -0.00025;
keyLight.shadow.normalBias = 0.025;
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xf5b454, 1.25);
rimLight.position.set(5, 4, -6);
scene.add(rimLight);

const gltfLoader = new GLTFLoader();
const gltfExporter = new GLTFExporter();
const physics = createPhysics({ THREE, RAPIER });
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const sourceModels = new Map();

const initialUrlParams = new URLSearchParams(window.location.search);
let selectedBotId = initialUrlParams.get("bot") || "bronco";
if (!MODEL_PART_CONFIG[selectedBotId]) selectedBotId = "bronco";
let editMode = initialUrlParams.get("mode") || "colliders";
if (!["colliders", "weaponSplit", "geometryCutter", "physicsTest", "physicalDamage"].includes(editMode)) editMode = "colliders";
let botGroup = null;
let colliderRoot = null;
let colliderParts = [];
let splitRoot = null;
let splitState = null;
let splitHelpersVisible = true;
let weaponSplitGeometryDirty = false;
let cutterRoot = null;
let cutterBox = null;
let suppressCutterUrlUpdate = false;
const keys = new Set();
let selectedObject = null;
let selectedObjects = [];
let selectedFeature = null;
let featureHandle = null;
const selectionProxy = new THREE.Object3D();
let applyingFeatureChange = false;
let activeLoadId = 0;
let lastTransformDragEndedAt = 0;
let dragStartSnapshot = null;
let dragStartSelection = null;
let numericEditSnapshot = null;
let updatingNumericInspector = false;
let pendingCanvasDeselect = null;
const modifierState = {
  shift: false,
  alt: false,
};
const undoStack = [];
const redoStack = [];
const ARENA_WIDTH = 24;
const ARENA_LENGTH = 24;
const ARENA_HALF_WIDTH = ARENA_WIDTH / 2;
const ARENA_HALF_LENGTH = ARENA_LENGTH / 2;
const ARENA_FLOOR_Y = 0;
const ARENA_VISUAL_FLOOR_THICKNESS = 0.08;
const ARENA_PHYSICS_FLOOR_HALF_HEIGHT = 0.05;
const ARENA_VISUAL_FLOOR_Y = ARENA_FLOOR_Y;
const ARENA_PHYSICS_FLOOR_Y = ARENA_FLOOR_Y;
const ARENA_PHYSICS_FLOOR_BODY_Y = ARENA_FLOOR_Y - ARENA_PHYSICS_FLOOR_HALF_HEIGHT;
const ARENA_CEILING_HEIGHT = 9.45;
const FIXED_PHYSICS_DT = 1 / 60;
const MAX_PHYSICS_SUBSTEPS = 5;
const DEFAULT_PHYSICS2_GRAVITY_Y = -32.174;
const PHYSICS2_SPAWN_CLEARANCE = 0;
const PHYSICS_TEST_DROP_BODY_Y = (ARENA_VISUAL_FLOOR_Y + ARENA_CEILING_HEIGHT) * 0.25;
let rapierReady = false;
let physicsArenaRoot = null;
let physicsWorld = null;
let physicsFighter = null;
let physicsTestRunning = false;
let physicsTestStartPose = null;
let prePhysicsTestEditorPose = null;
let damageArena = null;
let damageFighter = null;
let damageAimActive = false;
let damageProps = [];
let damageEffects = [];
let damageTintMarker = null;
const damageCandidatePreviewMeshes = new Set();
const damagePreviewQueue = new Set();
let damagePreviewQueueScheduled = false;
let damageGeometrySnapshot = null;
let damageColliderSnapshot = null;
let pendingDamageTint = null;
let damagePointerWorld = null;
let damagePointerOverBot = false;
let pendingUrlBreakApplied = false;
let suppressBreakUrlUpdate = false;
const damageInteriorMaterial = new THREE.MeshStandardMaterial({ color: 0x181413, roughness: 0.88, metalness: 0.12 });
const damageSolidFillMaterial = damageInteriorMaterial.clone();
damageSolidFillMaterial.side = THREE.DoubleSide;
const damageFallbackMaterial = new THREE.MeshStandardMaterial({ color: 0x6f7779, roughness: 0.5, metalness: 0.55 });

function editorDisplayScale(id = selectedBotId) {
  return id === "huge" ? 1.15 : 1.35;
}

function physicsTestVisualScale(id = selectedBotId) {
  return id === "huge" ? 0.9 : 1;
}

function physicsGravityY() {
  const value = Number(physicsGravityInput?.value);
  return Number.isFinite(value) ? value : DEFAULT_PHYSICS2_GRAVITY_Y;
}

function syncPhysicsGravityUi() {
  if (physicsGravityValue) physicsGravityValue.textContent = physicsGravityY().toFixed(1);
  if (physicsWorld) physicsWorld.gravity = { x: 0, y: physicsGravityY(), z: 0 };
}

function captureBotPose() {
  if (!botGroup) return null;
  return {
    position: botGroup.position.toArray(),
    quaternion: botGroup.quaternion.toArray(),
    scale: botGroup.scale.toArray(),
  };
}

function applyBotPose(pose) {
  if (!botGroup || !pose) return;
  botGroup.position.fromArray(pose.position || [0, 0, 0]);
  botGroup.quaternion.fromArray(pose.quaternion || [0, 0, 0, 1]);
  botGroup.scale.fromArray(pose.scale || [editorDisplayScale(), editorDisplayScale(), editorDisplayScale()]);
  botGroup.updateMatrixWorld(true);
  updateNumericInspector();
}

window.__colliderTweakerDebug = {
  scene,
  get botGroup() { return botGroup; },
  get physicsFighter() { return physicsFighter; },
  get damageTintMarker() { return damageTintMarker; },
  get splitRoot() { return splitRoot; },
  get editMode() { return editMode; },
  floorAudit() {
    const box = botGroup ? new THREE.Box3().setFromObject(botGroup) : null;
    const rbPosition = physicsFighter?.rb?.translation?.();
    const lastStep = physicsFighter?.physics?.lastStep;
    return {
      hasBot: Boolean(botGroup),
      editMode,
      physicsTestRunning,
      visualMinY: box?.min?.y ?? null,
      visualMaxY: box?.max?.y ?? null,
      visualGap: box ? box.min.y - ARENA_FLOOR_Y : null,
      rbY: rbPosition?.y ?? null,
      floorY: ARENA_FLOOR_Y,
      physicsFloorY: ARENA_PHYSICS_FLOOR_Y,
      visualFloorY: ARENA_VISUAL_FLOOR_Y,
      groundedStableFor: physicsFighter?.physics?.groundedStableFor ?? null,
      groundMinY: lastStep?.ground?.minY ?? null,
      upY: lastStep?.upY ?? null,
    };
  },
};

function setStatus(text) {
  if (statusText) statusText.textContent = text;
}

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

function snapshotState() {
  return {
    colliders: clonePlain(colliderParts),
    split: clonePlain(splitState),
  };
}

function statesEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function updateHistoryButtons() {
  if (undoButton) undoButton.disabled = undoStack.length === 0;
  if (redoButton) redoButton.disabled = redoStack.length === 0;
}

function pushHistory(before, after = snapshotState()) {
  if (!before || statesEqual(before, after)) return;
  undoStack.push(before);
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
  updateHistoryButtons();
}

function applyState(state) {
  if (!botGroup || !state) return;
  deselect();
  colliderParts = clonePlain(state.colliders || []);
  splitState = clonePlain(state.split);
  markWeaponSplitGeometryDirty();
  rebuildDirtyWeaponSplitGeometry();
  rebuildColliderRoot();
  rebuildSplitRoot();
  updateModeUi();
}

function undoChange() {
  if (!undoStack.length) return;
  const current = snapshotState();
  const previous = undoStack.pop();
  redoStack.push(current);
  applyState(previous);
  updateHistoryButtons();
}

function redoChange() {
  if (!redoStack.length) return;
  const current = snapshotState();
  const next = redoStack.pop();
  undoStack.push(current);
  applyState(next);
  updateHistoryButtons();
}

function selectedPartObjects() {
  return selectedObjects.filter((object) => object?.userData?.part);
}

function selectedPartsMidpoint() {
  const objects = selectedPartObjects();
  if (!objects.length) return null;
  return objects.reduce((sum, object) => sum.add(object.position), new THREE.Vector3()).multiplyScalar(1 / objects.length);
}

function syncSelectionProxyPosition() {
  const midpoint = selectedPartsMidpoint();
  if (!midpoint || !colliderRoot) return;
  if (selectionProxy.parent !== colliderRoot) colliderRoot.add(selectionProxy);
  selectionProxy.position.copy(midpoint);
  selectionProxy.quaternion.identity();
  selectionProxy.scale.set(1, 1, 1);
}

function activeTransformTarget() {
  return selectedPartObjects().length > 1 ? selectionProxy : selectedObject;
}

function inspectorSelectionKind() {
  const partObjects = selectedPartObjects();
  if (partObjects.length) return "part";
  if (selectedObject?.userData.toolKind === "weaponSplit" && splitState?.region) return "split";
  if (selectedObject?.userData.toolKind === "physicsTestBot") return "physicsTestBot";
  if (selectedObject?.userData.toolKind === "physicalDamagePiece") return "physicalDamagePiece";
  return null;
}

function setSelectedText() {
  if (!selectedText) return;
  if (deleteCollidersButton) deleteCollidersButton.disabled = selectedPartObjects().length === 0 || editMode !== "colliders";
  if (!selectedObject) {
    selectedText.textContent = "None";
    updateNumericInspector();
    return;
  }
  if (selectedPartObjects().length > 1) {
    selectedText.textContent = `${selectedPartObjects().length} colliders`;
    updateNumericInspector();
    return;
  }
  if (selectedObject.userData.toolKind === "weaponSplit") {
    const name = selectedObject.userData.splitRole === "pivot" ? "weapon split pivot" : "weapon split region";
    selectedText.textContent = selectedFeature ? `${name}, ${selectedFeature.kind}` : name;
    updateNumericInspector();
    return;
  }
  if (selectedObject.userData.toolKind === "geometryCutter") {
    selectedText.textContent = "geometry cut box";
    updateNumericInspector();
    return;
  }
  if (selectedObject.userData.modelTransformTarget) {
    selectedText.textContent = "bot model transform";
    updateNumericInspector();
    return;
  }
  if (selectedObject.userData.toolKind === "physicsTestBot") {
    selectedText.textContent = editMode === "physicalDamage" ? "physical damage bot" : "physics test bot";
    updateNumericInspector();
    return;
  }
  if (selectedObject.userData.toolKind === "physicalDamagePiece") {
    selectedText.textContent = "broken bot piece";
    updateNumericInspector();
    return;
  }
  const part = selectedObject.userData.part;
  const label = `${selectedObject.userData.colliderIndex + 1}: ${part.part || "body"} ${part.type || "box"}`;
  selectedText.textContent = selectedFeature ? `${label}, ${selectedFeature.kind}` : label;
  updateNumericInspector();
}

function inspectorNumber(value) {
  return numberLiteral(Number.isFinite(value) ? value : 0);
}

function makeNumericField(label, path) {
  const wrapper = document.createElement("label");
  wrapper.className = "numeric-field";
  const labelText = document.createElement("span");
  labelText.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.step = "0.001";
  input.inputMode = "decimal";
  input.dataset.inspectorPath = path;
  wrapper.append(labelText, input);
  return wrapper;
}

function makeNumericVector(label, fields, className = "") {
  const group = document.createElement("div");
  group.className = "numeric-vector";
  const title = document.createElement("span");
  title.textContent = label;
  const row = document.createElement("div");
  row.className = `numeric-vector-row${className ? ` ${className}` : ""}`;
  fields.forEach((field) => row.append(makeNumericField(field.label, field.path)));
  group.append(title, row);
  return group;
}

function buildNumericInspectorForSelection() {
  if (!numericInspectorFields) return;
  numericInspectorFields.innerHTML = "";
  if (!selectedObject) return;
  if (selectedObject.userData.part) {
    numericInspectorTitle.textContent = "Collider Values";
    numericInspectorFields.append(
      makeNumericVector("Position", [
        { label: "X", path: "part.position.0" },
        { label: "Y", path: "part.position.1" },
        { label: "Z", path: "part.position.2" },
      ]),
      makeNumericVector("Half Extents", [
        { label: "X", path: "part.halfExtents.0" },
        { label: "Y", path: "part.halfExtents.1" },
        { label: "Z", path: "part.halfExtents.2" },
      ]),
      makeNumericVector("Rotation", [
        { label: "X", path: "part.rotation.0" },
        { label: "Y", path: "part.rotation.1" },
        { label: "Z", path: "part.rotation.2" },
      ]),
    );
    return;
  }
  if (selectedObject.userData.toolKind === "weaponSplit" && splitState?.region) {
    numericInspectorTitle.textContent = "Weapon Split Values";
    numericInspectorFields.append(
      makeNumericVector("Region X", [
        { label: "Min", path: "split.region.x.0" },
        { label: "Max", path: "split.region.x.1" },
      ], "two-up"),
      makeNumericVector("Region Y", [
        { label: "Min", path: "split.region.y.0" },
        { label: "Max", path: "split.region.y.1" },
      ], "two-up"),
      makeNumericVector("Region Z", [
        { label: "Min", path: "split.region.z.0" },
        { label: "Max", path: "split.region.z.1" },
      ], "two-up"),
      makeNumericVector("Pivot", [
        { label: "X", path: "split.pivot.x" },
        { label: "Y", path: "split.pivot.y" },
        { label: "Z", path: "split.pivot.z" },
      ]),
    );
    return;
  }
  if (selectedObject.userData.toolKind === "physicsTestBot") {
    numericInspectorTitle.textContent = editMode === "physicalDamage" ? "Bot Pose" : "Bot Pose";
    numericInspectorFields.append(
      makeNumericVector("Position", [
        { label: "X", path: "physicsBot.position.x" },
        { label: "Y", path: "physicsBot.position.y" },
        { label: "Z", path: "physicsBot.position.z" },
      ]),
      makeNumericVector("Rotation", [
        { label: "X", path: "physicsBot.rotation.x" },
        { label: "Y", path: "physicsBot.rotation.y" },
        { label: "Z", path: "physicsBot.rotation.z" },
      ]),
    );
    return;
  }
  if (selectedObject.userData.toolKind === "physicalDamagePiece") {
    numericInspectorTitle.textContent = "Broken Piece Pose";
    numericInspectorFields.append(
      makeNumericVector("Position", [
        { label: "X", path: "damagePiece.position.x" },
        { label: "Y", path: "damagePiece.position.y" },
        { label: "Z", path: "damagePiece.position.z" },
      ]),
      makeNumericVector("Rotation", [
        { label: "X", path: "damagePiece.rotation.x" },
        { label: "Y", path: "damagePiece.rotation.y" },
        { label: "Z", path: "damagePiece.rotation.z" },
      ]),
    );
  }
}

function valueForInspectorPath(path) {
  const tokens = path.split(".");
  if (tokens[0] === "part") {
    const objects = selectedPartObjects();
    if (!objects.length) return null;
    const key = tokens[1];
    const index = Number(tokens[2]);
    if (objects.length > 1 && key === "position") {
      return selectedPartsMidpoint()?.getComponent(index) ?? null;
    }
    const values = objects.map((object) => {
      const part = object.userData.part;
      if (key === "rotation") part.rotation ||= [0, 0, 0];
      const vector = part[key];
      return Array.isArray(vector) ? vector[index] : null;
    });
    if (values.some((value) => value === null || value === undefined)) return null;
    return values.every((value) => Math.abs(value - values[0]) < 0.0000005) ? values[0] : null;
  }
  if (tokens[0] === "split") {
    if (!splitState) return null;
    let value = splitState;
    for (const token of tokens.slice(1)) value = value?.[Number.isNaN(Number(token)) ? token : Number(token)];
    return value;
  }
  if (tokens[0] === "physicsBot" && botGroup) {
    const vector = tokens[1] === "position" ? botGroup.position : botGroup.rotation;
    return vector?.[tokens[2]] ?? null;
  }
  if (tokens[0] === "damagePiece" && selectedObject?.userData.toolKind === "physicalDamagePiece") {
    const vector = tokens[1] === "position" ? selectedObject.position : selectedObject.rotation;
    return vector?.[tokens[2]] ?? null;
  }
  return null;
}

function updateNumericInspector() {
  if (!numericInspector || !numericInspectorFields) return;
  const nextKind = inspectorSelectionKind();
  const shouldShow = Boolean(nextKind);
  numericInspector.hidden = !shouldShow;
  if (!shouldShow) {
    numericInspectorFields.innerHTML = "";
    delete numericInspectorFields.dataset.kind;
    numericEditSnapshot = null;
    return;
  }
  const activePath = document.activeElement?.dataset?.inspectorPath;
  const currentPaths = [...numericInspectorFields.querySelectorAll("input[data-inspector-path]")].map((input) => input.dataset.inspectorPath).join("|");
  if (numericInspectorFields.dataset.kind !== nextKind || !currentPaths) {
    numericInspectorFields.dataset.kind = nextKind;
    buildNumericInspectorForSelection();
  }
  updatingNumericInspector = true;
  const groups = new Set();
  numericInspectorFields.querySelectorAll("input[data-inspector-path]").forEach((input) => {
    groups.add(input.closest(".numeric-vector"));
    if (input.dataset.inspectorPath === activePath && document.activeElement === input) return;
    const value = valueForInspectorPath(input.dataset.inspectorPath);
    const hasSharedValue = value !== null && value !== undefined;
    input.closest(".numeric-field").hidden = !hasSharedValue;
    input.disabled = !hasSharedValue;
    input.value = hasSharedValue ? inspectorNumber(value) : "";
  });
  groups.forEach((group) => {
    group.hidden = ![...group.querySelectorAll(".numeric-field")].some((field) => !field.hidden);
  });
  updatingNumericInspector = false;
}

function clampSplitRange(axis) {
  const range = splitState?.region?.[axis];
  if (!range) return;
  range[0] = Math.min(0.99, Math.max(0, range[0]));
  range[1] = Math.min(1, Math.max(0.01, range[1]));
  if (range[1] - range[0] < 0.01) {
    if (range[0] > 0.99) range[0] = range[1] - 0.01;
    else range[1] = range[0] + 0.01;
  }
}

function setSplitObjectsFromState() {
  if (!splitRoot || !splitState?.region) return;
  const authoring = splitAuthoringBounds(botGroup);
  if (!authoring) return;
  const bounds = authoring.bounds;
  const boundsSize = bounds.getSize(new THREE.Vector3());
  const boxObject = splitRoot.children.find((child) => child.userData.splitRole === "region");
  const pivotObject = splitRoot.children.find((child) => child.userData.splitRole === "pivot");
  if (boxObject) {
    const min = new THREE.Vector3(
      bounds.min.x + boundsSize.x * splitState.region.x[0],
      bounds.min.y + boundsSize.y * splitState.region.y[0],
      bounds.min.z + boundsSize.z * splitState.region.z[0],
    );
    const max = new THREE.Vector3(
      bounds.min.x + boundsSize.x * splitState.region.x[1],
      bounds.min.y + boundsSize.y * splitState.region.y[1],
      bounds.min.z + boundsSize.z * splitState.region.z[1],
    );
    boxObject.position.copy(min.clone().add(max).multiplyScalar(0.5));
    boxObject.scale.copy(max.sub(min));
    boxObject.rotation.set(splitState.weapon?.axisPitch || 0, splitState.weapon?.regionYaw || 0, 0);
  }
  if (pivotObject && splitState.pivot) {
    pivotObject.position.set(
      bounds.min.x + boundsSize.x * splitState.pivot.x,
      bounds.min.y + boundsSize.y * splitState.pivot.y,
      bounds.min.z + boundsSize.z * splitState.pivot.z,
    );
    pivotObject.rotation.set(splitState.weapon?.axisPitch || 0, 0, 0);
  }
}

function invalidateTweakerWeaponPoseCache() {
  const weapon = botGroup?.userData?.weapon;
  if (!weapon) return;
  delete weapon.tweakerBaseQuaternion;
  delete weapon.tweakerOriginalOffset;
  delete weapon.tweakerBaseChildPositions;
}

function markWeaponSplitGeometryDirty() {
  weaponSplitGeometryDirty = true;
  invalidateTweakerWeaponPoseCache();
}

function rebuildDirtyWeaponSplitGeometry() {
  if (!weaponSplitGeometryDirty || !botGroup || !splitState?.region) return;
  weaponSplitGeometryDirty = false;
  const activeView = geometryViewSelect?.value || "everything";
  rebuildModelViewerSplit(botGroup, selectedBotId, splitState);
  setViewerPartVisibility(botGroup, activeView);
  invalidateTweakerWeaponPoseCache();
}

function applyNumericValue(path, rawValue) {
  if (updatingNumericInspector || !selectedObject) return;
  beginNumericEdit();
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return;
  const tokens = path.split(".");
  if (tokens[0] === "part") {
    const objects = selectedPartObjects();
    if (!objects.length) return;
    const key = tokens[1];
    const index = Number(tokens[2]);
    if (objects.length > 1 && key === "position") {
      const midpoint = selectedPartsMidpoint();
      const delta = value - (midpoint?.getComponent(index) ?? 0);
      objects.forEach((object) => {
        const part = object.userData.part;
        part.position ||= [0, 0, 0];
        part.position[index] += delta;
        setObjectFromPart(object, part);
      });
      syncSelectionProxyPosition();
      updateNumericInspector();
      return;
    }
    objects.forEach((object) => {
      const part = object.userData.part;
      if (key === "rotation") part.rotation ||= [0, 0, 0];
      const vector = part[key];
      if (!Array.isArray(vector)) return;
      vector[index] = key === "halfExtents" ? Math.max(0.01, value) : value;
      setObjectFromPart(object, part);
      refreshColliderObjectGeometry(object, part);
    });
    if (objects.length > 1) syncSelectionProxyPosition();
    if (selectedFeature) updateFeatureHandlePosition();
    updateNumericInspector();
    return;
  }
  if (tokens[0] === "split" && splitState) {
    if (tokens[1] === "region") {
      const axis = tokens[2];
      splitState.region[axis][Number(tokens[3])] = value;
      clampSplitRange(axis);
    } else if (tokens[1] === "pivot") {
      splitState.pivot ||= { x: 0.5, y: 0.5, z: 0.5 };
      splitState.pivot[tokens[2]] = Math.min(1, Math.max(0, value));
    }
    markWeaponSplitGeometryDirty();
    setSplitObjectsFromState();
    if (selectedFeature) updateFeatureHandlePosition();
    updateNumericInspector();
    syncWeaponSplitDebugControls();
  }
  if (tokens[0] === "physicsBot" && botGroup && !physicsTestRunning) {
    const target = tokens[1] === "position" ? botGroup.position : botGroup.rotation;
    if (target && tokens[2] in target) target[tokens[2]] = value;
    botGroup.updateMatrixWorld(true);
    if (editMode === "physicalDamage") syncDamageFighterBodyFromBot();
    updateNumericInspector();
    return;
  }
  if (tokens[0] === "damagePiece" && selectedObject?.userData.toolKind === "physicalDamagePiece") {
    const target = tokens[1] === "position" ? selectedObject.position : selectedObject.rotation;
    if (target && tokens[2] in target) target[tokens[2]] = value;
    selectedObject.updateMatrixWorld(true);
    syncDamagePropBodyFromMesh(selectedObject);
    updateNumericInspector();
    return;
  }
}

function beginNumericEdit() {
  numericEditSnapshot ||= snapshotState();
}

function commitNumericEdit() {
  if (!numericEditSnapshot) return;
  pushHistory(numericEditSnapshot);
  numericEditSnapshot = null;
}

function updateUrlBot(id) {
  const url = new URL(window.location.href);
  url.searchParams.set("bot", id);
  url.searchParams.set("mode", editMode);
  window.history.replaceState(null, "", url);
}

function updateUrlMode(mode = editMode) {
  const url = new URL(window.location.href);
  url.searchParams.set("bot", selectedBotId);
  url.searchParams.set("mode", mode);
  window.history.replaceState(null, "", url);
}

function base64UrlEncodeJson(value) {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecodeJson(value) {
  try {
    const padded = String(value || "").replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(String(value || "").length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}

function clearUrlBreak() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("break") && !url.searchParams.has("breaks")) return;
  url.searchParams.delete("break");
  url.searchParams.delete("breaks");
  window.history.replaceState(null, "", url);
}

function breakUrlOptions(options) {
  return {
    threshold: options.threshold,
    significantHitsRequired: options.significantHitsRequired,
    resilience: options.resilience,
    breakRadius: options.breakRadius,
    primeMatchRadius: options.primeMatchRadius,
    maxBreakRadius: options.maxBreakRadius,
    maxPrimeMatchRadius: options.maxPrimeMatchRadius,
    maxRadiusDamageMultiplier: options.maxRadiusDamageMultiplier,
    impulseScale: options.impulseScale,
    maxPiecesPerBot: options.maxPiecesPerBot,
    convexCollider: options.convexCollider,
  };
}

function breakUrlHitPayload({ point, normal, rawDamage }) {
  return {
    point: plainVec3(point),
    normal: plainVec3(normal),
    rawDamage,
  };
}

function breakUrlPayload({ point, normal, rawDamage, options }) {
  return {
    v: 1,
    bot: selectedBotId,
    pose: captureBotPose(),
    ...breakUrlHitPayload({ point, normal, rawDamage }),
    options: breakUrlOptions(options),
  };
}

function updateUrlBreak(payload) {
  if (suppressBreakUrlUpdate || !payload) return;
  const url = new URL(window.location.href);
  url.searchParams.set("bot", selectedBotId);
  url.searchParams.set("mode", "physicalDamage");
  const existing = base64UrlDecodeJson(url.searchParams.get("breaks"));
  const hits = Array.isArray(existing?.hits) && existing.bot === selectedBotId
    ? existing.hits.slice()
    : (() => {
      const legacy = base64UrlDecodeJson(url.searchParams.get("break"));
      return legacy?.v === 1 && legacy.bot === selectedBotId ? [breakUrlHitPayload(legacy)] : [];
    })();
  hits.push(breakUrlHitPayload(payload));
  url.searchParams.delete("break");
  url.searchParams.set("breaks", base64UrlEncodeJson({
    v: 2,
    bot: selectedBotId,
    pose: existing?.pose || payload.pose,
    options: payload.options,
    hits,
  }));
  window.history.replaceState(null, "", url);
}

function validUrlBreakHit(hit) {
  const point = hit?.point;
  const normal = hit?.normal;
  if (!Array.isArray(point) || point.length < 3 || point.some((value) => !Number.isFinite(Number(value)))) return null;
  if (!Array.isArray(normal) || normal.length < 3 || normal.some((value) => !Number.isFinite(Number(value)))) return null;
  return {
    point,
    normal,
    rawDamage: hit.rawDamage,
  };
}

function parseUrlBreak() {
  const params = new URLSearchParams(window.location.search);
  const multi = base64UrlDecodeJson(params.get("breaks"));
  if (multi?.v === 2 && multi.bot === selectedBotId && Array.isArray(multi.hits)) {
    const hits = multi.hits.map(validUrlBreakHit).filter(Boolean);
    if (!hits.length) return null;
    return { ...multi, hits };
  }
  const payload = base64UrlDecodeJson(params.get("break"));
  if (!payload || payload.v !== 1 || payload.bot !== selectedBotId) return null;
  const hit = validUrlBreakHit(payload);
  return hit ? { ...payload, hits: [hit] } : null;
}

function applyUrlBreakControls(payload) {
  if (!payload?.options) return;
  const options = payload.options;
  if (tweakerDamageAmountInput && Number.isFinite(Number(payload.rawDamage))) tweakerDamageAmountInput.value = String(payload.rawDamage);
  if (tweakerDamageHitsInput && Number.isFinite(Number(options.significantHitsRequired))) tweakerDamageHitsInput.value = String(options.significantHitsRequired);
  if (tweakerDamageRadiusInput && Number.isFinite(Number(options.breakRadius))) tweakerDamageRadiusInput.value = String(options.breakRadius);
  if (tweakerDamageMatchRadiusInput && Number.isFinite(Number(options.primeMatchRadius))) tweakerDamageMatchRadiusInput.value = String(options.primeMatchRadius);
  if (tweakerDamageMaxRadiusInput && Number.isFinite(Number(options.maxBreakRadius))) tweakerDamageMaxRadiusInput.value = String(options.maxBreakRadius);
  if (tweakerDamageMaxMatchRadiusInput && Number.isFinite(Number(options.maxPrimeMatchRadius))) tweakerDamageMaxMatchRadiusInput.value = String(options.maxPrimeMatchRadius);
  if (tweakerDamageMaxRadiusMultiplierInput && Number.isFinite(Number(options.maxRadiusDamageMultiplier))) {
    tweakerDamageMaxRadiusMultiplierInput.value = String(options.maxRadiusDamageMultiplier);
  }
  if (tweakerDamageThresholdInput && Number.isFinite(Number(options.threshold))) tweakerDamageThresholdInput.value = String(options.threshold);
  if (tweakerDamageResilienceInput && Number.isFinite(Number(options.resilience))) tweakerDamageResilienceInput.value = String(options.resilience);
  if (tweakerDamageImpulseInput && Number.isFinite(Number(options.impulseScale))) tweakerDamageImpulseInput.value = String(options.impulseScale);
  if (tweakerDamageMaxPiecesInput && Number.isFinite(Number(options.maxPiecesPerBot))) tweakerDamageMaxPiecesInput.value = String(options.maxPiecesPerBot);
  if (tweakerDamageConvexInput && typeof options.convexCollider === "boolean") tweakerDamageConvexInput.checked = options.convexCollider;
}

function applyUrlBreakPose(payload) {
  if (!payload?.pose || !botGroup) return;
  applyBotPose(payload.pose);
  syncDamageFighterBodyFromBot();
}

function formatUrlNumber(value) {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : 0;
}

function updateUrlCutterBox() {
  if (!cutterBox || suppressCutterUrlUpdate) return;
  const url = new URL(window.location.href);
  const values = [
    ...cutterBox.position.toArray(),
    ...cutterBox.quaternion.toArray(),
    ...cutterBox.scale.toArray(),
  ].map(formatUrlNumber);
  url.searchParams.set("bot", selectedBotId);
  url.searchParams.set("mode", editMode);
  url.searchParams.set("cutBox", values.join(","));
  window.history.replaceState(null, "", url);
}

function clearUrlCutterBox() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("cutBox")) return;
  url.searchParams.delete("cutBox");
  window.history.replaceState(null, "", url);
}

function parseUrlCutterBox() {
  const values = (initialUrlParams.get("cutBox") || "").split(",").map((value) => Number(value));
  if (values.length !== 10 || values.some((value) => !Number.isFinite(value))) return null;
  return {
    position: values.slice(0, 3),
    quaternion: values.slice(3, 7),
    scale: values.slice(7, 10),
  };
}

function populateBotSelect() {
  bots.forEach((bot) => {
    const option = document.createElement("option");
    option.value = bot.id;
    option.textContent = bot.name;
    botSelect.append(option);
  });
  botSelect.value = selectedBotId;
  if (editModeSelect) editModeSelect.value = editMode;
  syncPhysicsGravityUi();
}

async function loadSourceModel(id) {
  if (sourceModels.has(id)) return sourceModels.get(id);
  const config = MODEL_PART_CONFIG[id];
  if (!config?.path) return null;
  setStatus(`Loading ${bots.find((bot) => bot.id === id)?.name || id}`);
  const source = await gltfLoader.loadAsync(config.path);
  sourceModels.set(id, source.scene);
  return source.scene;
}

function clearSceneBot() {
  stopPhysicsTest();
  disposeDamageSession();
  disposePhysicsWorld();
  transform.detach();
  selectedObject = null;
  selectedObjects = [];
  selectedFeature = null;
  if (featureHandle) {
    scene.remove(featureHandle);
    featureHandle = null;
  }
  if (botGroup) scene.remove(botGroup);
  botGroup = null;
  colliderRoot = null;
  splitRoot = null;
  cutterRoot = null;
  cutterBox = null;
  if (physicsArenaRoot) physicsArenaRoot.visible = false;
  colliderParts = [];
  splitState = null;
  undoStack.length = 0;
  redoStack.length = 0;
  updateHistoryButtons();
  setSelectedText();
}

function rebuildColliderRoot() {
  if (!botGroup) return;
  if (colliderRoot) botGroup.remove(colliderRoot);
  colliderRoot = new THREE.Group();
  colliderRoot.name = "colliderEditorRoot";
  colliderParts.forEach((part, index) => colliderRoot.add(makeColliderObject(part, index)));
  botGroup.add(colliderRoot);
  syncColliderRootTransform();
  updateColliderVisibility();
}

// Drive-contact colliders are traction probes only. They must not create
// Rapier collision shapes, set rest height, or hold the bot above the floor.
// If a bot appears to hover on them, the bug is in physical collider sampling
// or authored physical geometry, not in the intended role of drive contacts.
function solidPhysicsColliderParts(parts) {
  return (parts || []).filter((part) => part.part !== "driveContact" && !part.ignoreGroundContact);
}

function groundProbeColliderParts(parts) {
  return (parts || []).filter((part) => part.part !== "driveContact" && !part.ignoreGroundContact);
}

function colliderPartSamplePoints(part, half) {
  if (part.type === "cylinder") {
    const radius = Math.max(Math.abs(half[1]), Math.abs(half[2]));
    const halfHeight = Math.abs(half[0]);
    return [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [
      radius * x,
      halfHeight * y,
      radius * z,
    ])));
  }
  return [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [
    half[0] * x,
    half[1] * y,
    half[2] * z,
  ])));
}

function colliderPartsMinY(parts, visualScale = 1) {
  let minY = Infinity;
  groundProbeColliderParts(parts).forEach((part) => {
    const half = (part.halfExtents || [0.1, 0.1, 0.1]).map((value) => value * visualScale);
    const matrix = colliderLocalMatrix({
      ...part,
      position: (part.position || [0, 0, 0]).map((value) => value * visualScale),
    });
    colliderPartSamplePoints(part, half).forEach((point) => {
      minY = Math.min(minY, new THREE.Vector3(...point).applyMatrix4(matrix).y);
    });
  });
  return minY;
}

function createPhysicsTestFrame(visualScale = 1) {
  const parts = clonePlain(colliderParts);
  const colliderMinY = colliderPartsMinY(parts, visualScale);
  const groundedBodyY = Number.isFinite(colliderMinY) ? ARENA_PHYSICS_FLOOR_Y + PHYSICS2_SPAWN_CLEARANCE - colliderMinY : 0.55;
  const visualGroundOffset = botGroup ? measureVisualFloorOffsetAtOrigin(botGroup) : 0;
  // The collider tweaker edits colliders in the bot model's local space. Physics
  // Test must preserve that same model/collider relationship instead of applying
  // the arena's visual floor offset, otherwise the debug colliders and visible
  // model drift apart while the rigidbody is running.
  const visualOffsetY = 0;
  return {
    id: selectedBotId,
    parts,
    visualScale,
    floorY: ARENA_PHYSICS_FLOOR_Y,
    colliderMinY,
    solidParts: solidPhysicsColliderParts(parts),
    visualGroundOffset,
    visualOffsetY,
    groundedBodyY,
  };
}

function measureVisualFloorOffsetAtOrigin(group) {
  const position = group.position.clone();
  const quaternion = group.quaternion.clone();
  group.position.set(0, 0, 0);
  group.quaternion.identity();
  group.updateMatrixWorld(true);
  const offset = measureVisualFloorOffset(group);
  group.position.copy(position);
  group.quaternion.copy(quaternion);
  group.updateMatrixWorld(true);
  return offset;
}

function applyScaleForCurrentMode() {
  if (!botGroup || physicsTestRunning) return;
  botGroup.scale.setScalar(editMode === "physicsTest" || editMode === "physicalDamage" ? physicsTestVisualScale() : editorDisplayScale());
  botGroup.updateMatrixWorld(true);
}

function bodyPositionToVisualPosition(fighter, position) {
  const offset = fighter?.frame?.visualOffsetY ?? fighter?.visualFloorOffset ?? 0;
  return new THREE.Vector3(position.x, position.y + offset, position.z);
}

function visualPositionToBodyPosition(fighter, position) {
  const offset = fighter?.frame?.visualOffsetY ?? fighter?.visualFloorOffset ?? 0;
  return new THREE.Vector3(position.x, position.y - offset, position.z);
}

function syncColliderRootTransform() {
  if (!colliderRoot) return;
  colliderRoot.position.set(0, 0, 0);
  colliderRoot.quaternion.identity();
  colliderRoot.scale.set(1, 1, 1);
}

function syncPhysicsTestVisualFromBody() {
  if (!physicsFighter?.rb || !botGroup) return;
  const p = physicsFighter.rb.translation();
  const r = physicsFighter.rb.rotation();
  botGroup.position.copy(bodyPositionToVisualPosition(physicsFighter, p));
  botGroup.quaternion.set(r.x, r.y, r.z, r.w);
  syncColliderRootTransform();
}

function syncDamageFighterBodyFromBot() {
  if (!damageFighter?.rb || !botGroup) return;
  const bodyPosition = visualPositionToBodyPosition(damageFighter, botGroup.position);
  damageFighter.rb.setTranslation({ x: bodyPosition.x, y: bodyPosition.y, z: bodyPosition.z }, true);
  damageFighter.rb.setRotation({ x: botGroup.quaternion.x, y: botGroup.quaternion.y, z: botGroup.quaternion.z, w: botGroup.quaternion.w }, true);
  damageFighter.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
  damageFighter.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

function rigidBodyMass(rb, fallback = 1) {
  const mass = rb?.mass?.();
  return Number.isFinite(mass) && mass > 0 ? mass : fallback;
}

function fighterUpVector(fighter) {
  const q = fighter?.rb?.rotation?.();
  return new THREE.Vector3(0, 1, 0)
    .applyQuaternion(q ? new THREE.Quaternion(q.x, q.y, q.z, q.w) : new THREE.Quaternion())
    .normalize();
}

function fighterColliderWorldMinY(fighter) {
  let minY = Infinity;
  const colliderCount = fighter?.rb?.numColliders?.() || 0;
  for (let i = 0; i < colliderCount; i += 1) {
    const collider = fighter.rb.collider?.(i);
    const aabb = collider?.computeAABB?.();
    if (aabb?.mins) minY = Math.min(minY, aabb.mins.y);
  }
  if (Number.isFinite(minY)) return minY;
  const p = fighter?.rb?.translation?.();
  const r = fighter?.rb?.rotation?.();
  if (!p || !r) return minY;
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(p.x, p.y, p.z),
    new THREE.Quaternion(r.x, r.y, r.z, r.w),
    new THREE.Vector3(1, 1, 1),
  );
  solidPhysicsColliderParts(fighter.colliderParts).forEach((part) => {
    const half = part.halfExtents || [0, 0, 0];
    const local = colliderLocalMatrix(part);
    const partMatrix = matrix.clone().multiply(local);
    [-1, 1].forEach((sx) => [-1, 1].forEach((sy) => [-1, 1].forEach((sz) => {
      const point = new THREE.Vector3(
        sx * Math.abs(half[0]) * (fighter.visualScale || 1),
        sy * Math.abs(half[1]) * (fighter.visualScale || 1),
        sz * Math.abs(half[2]) * (fighter.visualScale || 1),
      ).applyMatrix4(partMatrix);
      minY = Math.min(minY, point.y);
    })));
  });
  return minY;
}

function correctFighterAboveFloor(fighter, margin = 0.035) {
  const minY = fighterColliderWorldMinY(fighter);
  if (!Number.isFinite(minY)) return 0;
  const lift = ARENA_PHYSICS_FLOOR_Y + margin - minY;
  if (lift <= 0) return 0;
  const p = fighter.rb.translation();
  fighter.rb.setTranslation({ x: p.x, y: p.y + lift, z: p.z }, true);
  const velocity = fighter.rb.linvel();
  if (velocity.y < 0) fighter.rb.setLinvel({ x: velocity.x, y: Math.max(0, velocity.y), z: velocity.z }, true);
  return lift;
}

function stabilizeSelfRightingFighter(fighter) {
  if (fighter?.spec?.id !== "bronco" || !fighter.selfRightingUntil) return;
  if (performance.now() / 1000 > fighter.selfRightingUntil) {
    fighter.selfRightingUntil = 0;
    return;
  }
  correctFighterAboveFloor(fighter, 0.1);
  const upY = fighterUpVector(fighter).y;
  if (upY > 0.15 && upY < 0.78) {
    const q = fighter.rb.rotation();
    const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w), "YXZ").y;
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const mass = THREE.MathUtils.clamp(rigidBodyMass(fighter.rb), 1, 800);
    fighter.rb.applyImpulse({ x: 0, y: 0.018 * mass, z: 0 }, true);
    fighter.rb.applyTorqueImpulse({ x: right.x * 0.052 * mass, y: 0, z: right.z * 0.052 * mass }, true);
  }
  if (upY > 0.35) {
    const velocity = fighter.rb.linvel();
    const angular = fighter.rb.angvel();
    const settle = THREE.MathUtils.clamp((upY - 0.35) / 0.45, 0, 1);
    fighter.rb.setLinvel({ x: velocity.x * (1 - settle * 0.08), y: velocity.y, z: velocity.z * (1 - settle * 0.08) }, true);
    fighter.rb.setAngvel({ x: angular.x * (1 - settle * 0.18), y: angular.y * (1 - settle * 0.08), z: angular.z * (1 - settle * 0.18) }, true);
    if (upY > 0.48) {
      const q = fighter.rb.rotation();
      const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w), "YXZ").y;
      const upright = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
      const current = fighter.rb.linvel();
      fighter.rb.setRotation({ x: upright.x, y: upright.y, z: upright.z, w: upright.w }, true);
      fighter.rb.setLinvel({ x: current.x * 0.35, y: 0, z: current.z * 0.35 }, true);
      fighter.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      correctFighterAboveFloor(fighter, 0.08);
      fighter.selfRightingUntil = 0;
    }
  }
}

function updatePhysicsTestWeapon(fighter, dt, active = false) {
  const weapon = fighter?.weapon;
  if (!weapon?.object) return;
  weapon.lastSpeedDelta = 0;
  if (weapon.type === "flipper" || weapon.type === "crusher") {
    const target = active ? weapon.activeRotation : weapon.baseRotation;
    const speed = active ? weapon.activeSpeed || weapon.speed : weapon.returnSpeed || weapon.speed;
    weapon.object.rotation.x = THREE.MathUtils.damp(weapon.object.rotation.x, target, speed, dt);
  } else if (weapon.type === "meshFlipper") {
    const target = active ? 1 : 0;
    weapon.amount = THREE.MathUtils.damp(weapon.amount || 0, target, weapon.speed, dt);
    weapon.apply?.(weapon.amount);
  }
}

function setPhysicsTestWeaponPose(active = false) {
  const weapon = botGroup?.userData?.weapon;
  if (!weapon?.object) return;
  weapon.lastSpeedDelta = 0;
  if (weapon.type === "flipper" || weapon.type === "crusher") {
    weapon.object.rotation.x = active ? weapon.activeRotation : weapon.baseRotation;
  } else if (weapon.type === "meshFlipper") {
    weapon.amount = active ? 1 : 0;
    weapon.apply?.(weapon.amount);
  }
  botGroup.updateMatrixWorld(true);
}

function syncPhysicsTestWeaponColliderBindings(fighter) {
  const weaponMatrix = fighter?.group ? weaponLocalMatrix(fighter.group) : null;
  if (!weaponMatrix || !fighter?.weaponColliderBindings?.length) return;
  if (fighter.spec?.id === "bronco" && fighter.selfRightingUntil && performance.now() / 1000 < fighter.selfRightingUntil) return;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  fighter.weaponColliderBindings.forEach((binding) => {
    matrix.multiplyMatrices(weaponMatrix, binding.relativeToWeapon).decompose(position, quaternion, scale);
    binding.collider.setTranslationWrtParent?.({
      x: position.x * binding.visualScale,
      y: position.y * binding.visualScale,
      z: position.z * binding.visualScale,
    });
    binding.collider.setRotationWrtParent?.({
      x: quaternion.x,
      y: quaternion.y,
      z: quaternion.z,
      w: quaternion.w,
    });
  });
  const sensor = physics.isSpinnerAttackColliderSensor?.(fighter) || false;
  fighter.weaponColliderBindings.forEach((binding) => {
    if (!binding.collider?.setSensor || binding.attackSensor === sensor) return;
    binding.collider.setSensor(sensor);
    binding.attackSensor = sensor;
  });
}

function colliderRotation(x = 0, y = 0, z = 0) {
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  return { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
}

function colliderLocalMatrix(part) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(part.position || [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0]))),
    new THREE.Vector3(1, 1, 1),
  );
}

function weaponLocalMatrix(group) {
  const weaponObject = group?.userData?.weapon?.object;
  if (!weaponObject) return null;
  group.updateMatrixWorld(true);
  weaponObject.updateMatrixWorld(true);
  return group.matrixWorld.clone().invert().multiply(weaponObject.matrixWorld);
}

function colliderRelativeToWeapon(part, group) {
  const weaponMatrix = weaponLocalMatrix(group);
  if (!weaponMatrix) return null;
  return weaponMatrix.clone().invert().multiply(colliderLocalMatrix(part));
}

function wedgeVertices(halfExtents) {
  const [hx, hy, hz] = halfExtents;
  return [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [-hx, hy, hz],
    [hx, hy, hz],
  ];
}

function getSelectedWeaponSplitConfig(id = selectedBotId) {
  const config = MODEL_PART_CONFIG[id];
  const region = config?.weapon?.regions?.[0];
  if (!region) return null;
  return {
    weapon: clonePlain(config.weapon),
    region: clonePlain(region),
    pivot: clonePlain(config.weapon.pivot || {
      x: (region.x[0] + region.x[1]) * 0.5,
      y: (region.y[0] + region.y[1]) * 0.5,
      z: (region.z[0] + region.z[1]) * 0.5,
    }),
  };
}

function splitHasCustomWeaponRegion() {
  return Boolean(splitState?.region);
}

function reselectSplitRole(role) {
  if (!role || !splitRoot) return;
  const object = splitRoot.children.find((child) => child.userData.splitRole === role);
  if (object) selectObject(object);
}

function mirrorTransformForSplit(splitBox) {
  if (!splitState?.weapon?.mirrorDiagonal || !splitState?.region) return null;
  const bounds = splitBox.bounds;
  const size = bounds.getSize(new THREE.Vector3());
  const pivot = splitState.pivot || {
    x: (splitState.region.x[0] + splitState.region.x[1]) * 0.5,
    y: (splitState.region.y[0] + splitState.region.y[1]) * 0.5,
    z: (splitState.region.z[0] + splitState.region.z[1]) * 0.5,
  };
  const frontAxis = splitState.weapon.mirrorDiagonalFrontAxis || "x";
  const frontSign = splitState.weapon.mirrorDiagonalFrontSign || 1;
  const rotationAxis = frontAxis === "z" ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1);
  const signedAngle = frontAxis === "z"
    ? -frontSign * (splitState.weapon.mirrorDiagonalAngle ?? Math.PI)
    : frontSign * (splitState.weapon.mirrorDiagonalAngle ?? Math.PI);
  return {
    pivot: new THREE.Vector3(bounds.min.x + size.x * pivot.x, bounds.min.y + size.y * pivot.y, bounds.min.z + size.z * pivot.z),
    quaternion: new THREE.Quaternion().setFromAxisAngle(rotationAxis, signedAngle),
  };
}

function applyMirrorTransform(object, mirror) {
  object.position.sub(mirror.pivot).applyQuaternion(mirror.quaternion).add(mirror.pivot);
  object.quaternion.premultiply(mirror.quaternion);
}

function getSplitFieldValue(field) {
  if (!splitState) return 0;
  if (field === "mirrorDiagonal") return Boolean(splitState.weapon?.mirrorDiagonal);
  if (field === "mirrorDiagonalAngle") return THREE.MathUtils.radToDeg(splitState.weapon?.mirrorDiagonalAngle ?? Math.PI);
  if (field === "axisPitch") return THREE.MathUtils.radToDeg(splitState.weapon?.axisPitch || 0);
  if (field === "regionYaw") return THREE.MathUtils.radToDeg(splitState.weapon?.regionYaw || 0);
  const parts = field.split(".");
  const [, axis, index] = parts;
  if (field.startsWith("region.")) return splitState.region?.[axis]?.[Number(index)] ?? 0;
  if (field.startsWith("pivot.")) return splitState.pivot?.[axis] ?? 0;
  return 0;
}

function setSplitFieldValue(field, value) {
  if (!splitState) return;
  splitState.weapon ||= {};
  if (field === "mirrorDiagonal") {
    splitState.weapon.mirrorDiagonal = Boolean(value);
    return;
  }
  if (field === "mirrorDiagonalAngle") {
    splitState.weapon.mirrorDiagonalAngle = THREE.MathUtils.degToRad(Number.isFinite(value) ? value : 180);
    return;
  }
  if (field === "axisPitch") {
    splitState.weapon.axisPitch = THREE.MathUtils.degToRad(value || 0);
    return;
  }
  if (field === "regionYaw") {
    splitState.weapon.regionYaw = THREE.MathUtils.degToRad(value || 0);
    return;
  }
  const parts = field.split(".");
  const [, axis, index] = parts;
  if (field.startsWith("region.") && splitState.region?.[axis]) splitState.region[axis][Number(index)] = value;
  if (field.startsWith("pivot.")) {
    splitState.pivot ||= { x: 0.5, y: 0.5, z: 0.5 };
    splitState.pivot[axis] = value;
  }
}

function syncWeaponSplitDebugControls() {
  const splitAvailable = splitHasCustomWeaponRegion();
  weaponSplitDebug?.classList.toggle("active", editMode === "weaponSplit" && splitAvailable);
  if (viewWeaponSplitInput) viewWeaponSplitInput.checked = splitHelpersVisible;
  weaponSplitInputs.forEach((input) => {
    input.disabled = editMode !== "weaponSplit" || !splitAvailable;
    if (!splitAvailable) return;
    if (input.type === "checkbox") input.checked = Boolean(getSplitFieldValue(input.dataset.splitField));
    else input.value = getSplitFieldValue(input.dataset.splitField).toFixed(input.step === "0.5" ? 1 : 2);
  });
  const mirrorAvailable = Boolean(splitState?.weapon && "mirrorDiagonal" in splitState.weapon);
  weaponMirrorRow?.classList.toggle("active", editMode === "weaponSplit" && splitAvailable && mirrorAvailable);
  weaponMirrorAngleRow?.classList.toggle("active", editMode === "weaponSplit" && splitAvailable && mirrorAvailable);
  const axisPitchAvailable = Boolean(selectedBotId === "tombstone");
  weaponAxisPitchRow?.classList.toggle("active", editMode === "weaponSplit" && splitAvailable && axisPitchAvailable);
  const regionYawAvailable = Boolean(selectedBotId === "tombstone");
  weaponRegionYawRow?.classList.toggle("active", editMode === "weaponSplit" && splitAvailable && regionYawAvailable);
}

function makeMirrorPlaneHelper(splitBox) {
  if (!splitState?.weapon?.mirrorDiagonal) return null;
  const bounds = splitBox.bounds;
  const size = bounds.getSize(new THREE.Vector3());
  const pivot = splitState.pivot || {
    x: (splitState.region.x[0] + splitState.region.x[1]) * 0.5,
    y: (splitState.region.y[0] + splitState.region.y[1]) * 0.5,
    z: (splitState.region.z[0] + splitState.region.z[1]) * 0.5,
  };
  const frontAxis = splitState.weapon.mirrorDiagonalFrontAxis || "x";
  const frontSign = splitState.weapon.mirrorDiagonalFrontSign || 1;
  const normal = frontAxis === "z"
    ? new THREE.Vector3(0, 1, frontSign).normalize()
    : new THREE.Vector3(frontSign, 1, 0).normalize();
  const planeSize = Math.max(size.x, size.y, size.z) * 1.25;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(planeSize, planeSize),
    new THREE.MeshBasicMaterial({
      color: 0xfff05a,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  plane.name = "weaponSplitMirrorPlane";
  plane.position.set(bounds.min.x + size.x * pivot.x, bounds.min.y + size.y * pivot.y, bounds.min.z + size.z * pivot.z);
  plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
  plane.rotateZ(splitState.weapon.mirrorDiagonalAngle ?? Math.PI);
  plane.renderOrder = 11;
  return plane;
}

function makePivotAxisHelper(splitBox) {
  const size = splitBox.bounds.getSize(new THREE.Vector3());
  const axisLength = Math.max(0.08, {
    x: size.x,
    y: size.y,
    z: size.z,
  }[splitState.weapon?.spinAxis || "z"] * 1.35);
  const axisRadius = Math.max(0.012, Math.min(size.x, size.y, size.z) * 0.012);
  const axis = new THREE.Mesh(
    new THREE.CylinderGeometry(axisRadius, axisRadius, axisLength, 24),
    new THREE.MeshBasicMaterial({
      color: 0x2ad8ff,
      transparent: true,
      opacity: 0.72,
      depthTest: false,
      depthWrite: false,
    }),
  );
  axis.name = "weaponSplitPivotAxis";
  if (splitState.weapon?.spinAxis === "x") axis.rotation.z = Math.PI / 2;
  if (splitState.weapon?.spinAxis === "z" || !splitState.weapon?.spinAxis) axis.rotation.x = Math.PI / 2;
  axis.renderOrder = 12;
  return axis;
}

function makeMirroredWeaponPreview(splitBox, mirror) {
  const weaponObject = botGroup?.userData?.weapon?.object;
  if (!weaponObject || !mirror) return null;
  const preview = weaponObject.clone(true);
  preview.name = "weaponSplitMirroredWeaponPreview";
  preview.userData.weaponSplitPreview = true;
  preview.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = false;
    child.receiveShadow = false;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    const cloned = materials.map((material) => {
      const next = material?.clone?.() || new THREE.MeshBasicMaterial();
      next.transparent = true;
      next.opacity = Math.min(0.62, next.opacity ?? 0.62);
      next.depthWrite = false;
      return next;
    });
    child.material = Array.isArray(child.material) ? cloned : cloned[0];
  });
  applyMirrorTransform(preview, mirror);
  return preview;
}

function rebuildSplitRoot() {
  if (!botGroup) return;
  if (splitRoot) splitRoot.parent?.remove(splitRoot);
  splitRoot = null;
  if (!splitState?.region) return;
  const splitBox = regionBoxForWeaponSplit(botGroup, splitState);
  if (!splitBox) return;
  const root = new THREE.Group();
  root.name = "weaponSplitEditorRoot";
  root.userData.toolKind = "weaponSplitRoot";
  const mirror = mirrorTransformForSplit(splitBox);
  root.userData.mirror = mirror;
  const size = splitBox.box.getSize(new THREE.Vector3());
  const center = splitBox.box.getCenter(new THREE.Vector3());
  const fill = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  const lines = new THREE.LineSegments(
    new THREE.EdgesGeometry(fill.geometry),
    new THREE.LineBasicMaterial({ color: 0xffb7ef, transparent: true, opacity: 1, depthWrite: false }),
  );
  const boxObject = new THREE.Group();
  boxObject.name = "weaponSplitRegion";
  boxObject.position.copy(center);
  boxObject.scale.copy(size);
  boxObject.rotation.y = splitState.weapon?.regionYaw || 0;
  boxObject.rotation.x = splitState.weapon?.axisPitch || 0;
  boxObject.userData.toolKind = "weaponSplit";
  boxObject.userData.splitRole = "region";
  boxObject.add(fill, lines);
  root.add(boxObject);
  if (mirror) {
    const mirroredBoxObject = boxObject.clone(true);
    mirroredBoxObject.name = "weaponSplitMirroredRegion";
    delete mirroredBoxObject.userData.toolKind;
    delete mirroredBoxObject.userData.splitRole;
    mirroredBoxObject.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material = child.material.clone();
        child.material.color.set(0xfff05a);
        child.material.opacity = 0.14;
      }
      if (child.isLineSegments && child.material) {
        child.material = child.material.clone();
        child.material.color.set(0xfff05a);
      }
    });
    applyMirrorTransform(mirroredBoxObject, mirror);
    root.add(mirroredBoxObject);
  }
  const pivot = splitState.pivot || {
    x: (splitState.region.x[0] + splitState.region.x[1]) * 0.5,
    y: (splitState.region.y[0] + splitState.region.y[1]) * 0.5,
    z: (splitState.region.z[0] + splitState.region.z[1]) * 0.5,
  };
  const bounds = splitBox.bounds;
  const boundsSize = bounds.getSize(new THREE.Vector3());
  const pivotObject = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(0.035, Math.min(boundsSize.x, boundsSize.y, boundsSize.z) * 0.018), 24, 12),
    new THREE.MeshBasicMaterial({ color: 0xf0c44f, depthTest: false, depthWrite: false }),
  );
  pivotObject.name = "weaponSplitPivot";
  pivotObject.position.set(
    bounds.min.x + boundsSize.x * pivot.x,
    bounds.min.y + boundsSize.y * pivot.y,
    bounds.min.z + boundsSize.z * pivot.z,
  );
  pivotObject.rotation.x = splitState.weapon?.axisPitch || 0;
  pivotObject.userData.toolKind = "weaponSplit";
  pivotObject.userData.splitRole = "pivot";
  pivotObject.add(makePivotAxisHelper(splitBox));
  root.add(pivotObject);
  const mirrorPlane = makeMirrorPlaneHelper(splitBox);
  if (mirrorPlane) root.add(mirrorPlane);
  const mirroredWeapon = makeMirroredWeaponPreview(splitBox, mirror);
  if (mirroredWeapon) root.add(mirroredWeapon);
  splitBox.parent.add(root);
  splitRoot = root;
  updateModeUi();
}

function syncSplitStateFromObjects() {
  if (!splitRoot || !splitState?.region) return;
  const authoring = splitAuthoringBounds(botGroup);
  const boxObject = splitRoot.children.find((child) => child.userData.splitRole === "region");
  const pivotObject = splitRoot.children.find((child) => child.userData.splitRole === "pivot");
  if (!authoring || !boxObject) return;
  const bounds = authoring.bounds;
  const boundsSize = bounds.getSize(new THREE.Vector3());
  const half = boxObject.scale.clone().multiplyScalar(0.5);
  const min = boxObject.position.clone().sub(half);
  const max = boxObject.position.clone().add(half);
  splitState.weapon ||= {};
  splitState.weapon.regionYaw = boxObject.rotation.y;
  splitState.region = {
    x: [
      (min.x - bounds.min.x) / boundsSize.x,
      (max.x - bounds.min.x) / boundsSize.x,
    ],
    y: [
      (min.y - bounds.min.y) / boundsSize.y,
      (max.y - bounds.min.y) / boundsSize.y,
    ],
    z: [
      (min.z - bounds.min.z) / boundsSize.z,
      (max.z - bounds.min.z) / boundsSize.z,
    ],
  };
  if (pivotObject) {
    splitState.pivot = {
      x: (pivotObject.position.x - bounds.min.x) / boundsSize.x,
      y: (pivotObject.position.y - bounds.min.y) / boundsSize.y,
      z: (pivotObject.position.z - bounds.min.z) / boundsSize.z,
    };
    if (splitSupportsPivotRotation()) splitState.weapon.axisPitch = pivotObject.rotation.x;
    boxObject.rotation.x = pivotObject.rotation.x;
  }
  markWeaponSplitGeometryDirty();
  invalidateTweakerWeaponPoseCache();
  syncWeaponSplitDebugControls();
}

function applyWeaponSplitDebugTuning(event) {
  const input = event?.target;
  if (!input?.dataset?.splitField || editMode !== "weaponSplit" || !splitState?.region) return;
  const before = snapshotState();
  setSplitFieldValue(input.dataset.splitField, input.type === "checkbox" ? input.checked : Number(input.value));
  ["x", "y", "z"].forEach(clampSplitRange);
  markWeaponSplitGeometryDirty();
  deselect();
  rebuildSplitRoot();
  syncWeaponSplitDebugControls();
  pushHistory(before);
}

function visualBoundsForCutter() {
  if (!botGroup) return null;
  botGroup.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const meshBounds = new THREE.Box3();
  botGroup.traverse((child) => {
    if (!isCuttableVisualMesh(child)) return;
    meshBounds.setFromObject(child);
    if (Number.isFinite(meshBounds.min.x)) bounds.union(meshBounds);
  });
  if (!Number.isFinite(bounds.min.x)) return null;
  const inverse = botGroup.matrixWorld.clone().invert();
  const points = [];
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) points.push(new THREE.Vector3(x, y, z).applyMatrix4(inverse));
    }
  }
  return new THREE.Box3().setFromPoints(points);
}

function isCuttableVisualMesh(mesh) {
  if (!mesh?.isMesh || !mesh.geometry?.attributes?.position) return false;
  let node = mesh;
  while (node && node !== botGroup) {
    if (node === colliderRoot || node === splitRoot || node === cutterRoot) return false;
    if (node.userData?.toolKind || node.userData?.part || node.userData?.weaponSplitPreview) return false;
    node = node.parent;
  }
  return true;
}

function createCutBox({ restoreFromUrl = false } = {}) {
  if (!botGroup || editMode !== "geometryCutter") return;
  if (!cutterRoot) {
    cutterRoot = new THREE.Group();
    cutterRoot.name = "geometryCutterRoot";
    cutterRoot.userData.toolKind = "geometryCutterRoot";
    botGroup.add(cutterRoot);
  }
  if (cutterBox) cutterRoot.remove(cutterBox);
  const bounds = visualBoundsForCutter();
  const size = bounds?.getSize(new THREE.Vector3()) || new THREE.Vector3(1, 1, 1);
  const center = bounds?.getCenter(new THREE.Vector3()) || new THREE.Vector3(0, 0.5, 0);
  const fill = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xfff05a, transparent: true, opacity: 0.18, depthWrite: false }),
  );
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(fill.geometry),
    new THREE.LineBasicMaterial({ color: 0xfff05a, transparent: true, opacity: 1, depthWrite: false }),
  );
  cutterBox = new THREE.Group();
  cutterBox.name = "geometryCutBox";
  cutterBox.userData.toolKind = "geometryCutter";
  const savedBox = restoreFromUrl ? parseUrlCutterBox() : null;
  if (savedBox) {
    cutterBox.position.fromArray(savedBox.position);
    cutterBox.quaternion.fromArray(savedBox.quaternion);
    cutterBox.scale.fromArray(savedBox.scale.map((value) => Math.max(0.01, Math.abs(value))));
  } else {
    cutterBox.position.set(center.x, center.y + size.y * 0.72, center.z);
    cutterBox.scale.set(Math.max(0.2, size.x * 0.45), Math.max(0.2, size.y * 0.3), Math.max(0.2, size.z * 0.45));
  }
  cutterBox.add(fill, edges);
  cutterRoot.add(cutterBox);
  selectedObject = cutterBox;
  selectedObjects = [];
  selectedFeature = null;
  transform.detach();
  attachTransform(cutterBox, transformModeForSelection());
  if (applyGeometryCutButton) applyGeometryCutButton.disabled = false;
  if (applyGeometryFillButton) applyGeometryFillButton.disabled = false;
  updateUrlCutterBox();
  setSelectedText();
  setStatus("Position the cut box");
}

function createModelTransformHandle() {
  const model = botGroup?.userData?.sourceModel;
  if (!model || editMode !== "geometryCutter") return;
  model.userData.modelTransformTarget = true;
  selectedObject = model;
  selectedObjects = [];
  selectedFeature = null;
  transform.detach();
  attachTransform(model, transformModeForSelection());
  setSelectedText();
  setStatus("Move or Shift-rotate the bot model before export");
}

function materialIndexForTriangle(geometry, triangleIndex) {
  if (!geometry.groups?.length) return 0;
  const offset = triangleIndex * 3;
  const group = geometry.groups.find((entry) => offset >= entry.start && offset < entry.start + entry.count);
  return group?.materialIndex || 0;
}

function appendAttributeVertex(target, attribute, index) {
  const itemSize = attribute.itemSize;
  for (let i = 0; i < itemSize; i += 1) target.push(attribute.getComponent(index, i));
}

function attributeTuple(attribute, index) {
  const tuple = [];
  for (let i = 0; i < attribute.itemSize; i += 1) tuple.push(attribute.getComponent(index, i));
  return tuple;
}

function appendAttributeTuple(target, tuple) {
  tuple.forEach((value) => target.push(value));
}

function averagedAttributeTuple(attribute, indices, name) {
  const tuple = new Array(attribute.itemSize).fill(0);
  indices.forEach((index) => {
    for (let i = 0; i < attribute.itemSize; i += 1) tuple[i] += attribute.getComponent(index, i);
  });
  const scale = 1 / Math.max(1, indices.length);
  for (let i = 0; i < tuple.length; i += 1) tuple[i] *= scale;
  if (name === "normal" && tuple.length >= 3) {
    const normal = new THREE.Vector3(tuple[0], tuple[1], tuple[2]).normalize();
    tuple[0] = normal.x;
    tuple[1] = normal.y;
    tuple[2] = normal.z;
  }
  return tuple;
}

function edgeVertexKey(vector) {
  return `${Math.round(vector.x * 100000)}:${Math.round(vector.y * 100000)}:${Math.round(vector.z * 100000)}`;
}

function pointInsideUnitBox(vector) {
  return Math.abs(vector.x) <= 0.5 && Math.abs(vector.y) <= 0.5 && Math.abs(vector.z) <= 0.5;
}

function triangleInsideUnitBox(points) {
  return points.every(pointInsideUnitBox);
}

function getTriangleIndices(geometry, triangle) {
  const sourceIndex = geometry.index;
  return [0, 1, 2].map((corner) => sourceIndex ? sourceIndex.getX(triangle * 3 + corner) : triangle * 3 + corner);
}

function cutGeometryWithBox(mesh, boxObject) {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  if (!position || position.count < 3) return { removed: 0, kept: position?.count || 0 };
  ensureOriginalAuthoringBounds(mesh);
  mesh.updateMatrixWorld(true);
  boxObject.updateMatrixWorld(true);
  const toBox = boxObject.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const sourceIndex = geometry.index;
  const triangleCount = sourceIndex ? sourceIndex.count / 3 : position.count / 3;
  const nextAttributes = {};
  Object.entries(geometry.attributes).forEach(([name, attribute]) => {
    nextAttributes[name] = [];
  });
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const centroid = new THREE.Vector3();
  let removed = 0;
  let vertexCount = 0;
  let activeGroup = null;
  const nextGroups = [];

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const indices = [0, 1, 2].map((corner) => sourceIndex ? sourceIndex.getX(triangle * 3 + corner) : triangle * 3 + corner);
    centroid.set(0, 0, 0);
    indices.forEach((index, corner) => {
      v[corner].fromBufferAttribute(position, index).applyMatrix4(toBox);
      centroid.add(v[corner]);
    });
    centroid.multiplyScalar(1 / 3);
    const inside = Math.abs(centroid.x) <= 0.5 && Math.abs(centroid.y) <= 0.5 && Math.abs(centroid.z) <= 0.5;
    if (inside) {
      removed += 1;
      continue;
    }
    const materialIndex = materialIndexForTriangle(geometry, triangle);
    if (!activeGroup || activeGroup.materialIndex !== materialIndex) {
      activeGroup = { start: vertexCount, count: 0, materialIndex };
      nextGroups.push(activeGroup);
    }
    indices.forEach((index) => {
      Object.entries(geometry.attributes).forEach(([name, attribute]) => appendAttributeVertex(nextAttributes[name], attribute, index));
      vertexCount += 1;
      activeGroup.count += 1;
    });
  }

  if (!removed) return { removed: 0, kept: vertexCount };
  const nextGeometry = new THREE.BufferGeometry();
  Object.entries(geometry.attributes).forEach(([name, attribute]) => {
    nextGeometry.setAttribute(name, new THREE.BufferAttribute(new attribute.array.constructor(nextAttributes[name]), attribute.itemSize, attribute.normalized));
  });
  nextGroups.forEach((group) => nextGeometry.addGroup(group.start, group.count, group.materialIndex));
  nextGeometry.computeBoundingBox();
  nextGeometry.computeBoundingSphere();
  if (!nextGeometry.attributes.normal && nextGeometry.attributes.position) nextGeometry.computeVertexNormals();
  geometry.dispose();
  mesh.geometry = nextGeometry;
  if (vertexCount === 0) mesh.visible = false;
  return { removed, kept: vertexCount };
}

function orderedBoundaryLoop(edges) {
  if (!edges.length) return [];
  const links = new Map();
  edges.forEach((edge) => {
    links.set(edge.from, [...(links.get(edge.from) || []), edge]);
    links.set(edge.to, [...(links.get(edge.to) || []), { ...edge, from: edge.to, to: edge.from, a: edge.b, b: edge.a }]);
  });
  const start = edges[0].from;
  const loop = [edges[0].a];
  let current = edges[0].to;
  let previous = start;
  const used = new Set([`${start}|${current}`]);
  for (let guard = 0; guard < edges.length + 4; guard += 1) {
    const nextEdges = links.get(current) || [];
    const next = nextEdges.find((edge) => edge.to !== previous && !used.has(`${edge.from}|${edge.to}`)) || nextEdges.find((edge) => !used.has(`${edge.from}|${edge.to}`));
    if (!next) break;
    loop.push(next.a);
    previous = current;
    current = next.to;
    used.add(`${next.from}|${next.to}`);
    if (current === start) return loop;
  }
  return [];
}

function orderedBoundaryLoops(edges, position) {
  const remaining = [...edges];
  const loops = [];
  while (remaining.length) {
    const loop = orderedBoundaryLoop(remaining);
    if (loop.length < 3) break;
    loops.push(loop);
    const loopKeys = new Set();
    for (let i = 0; i < loop.length; i += 1) {
      const a = edgeVertexKey(new THREE.Vector3().fromBufferAttribute(position, loop[i]));
      const b = edgeVertexKey(new THREE.Vector3().fromBufferAttribute(position, loop[(i + 1) % loop.length]));
      loopKeys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
    for (let i = remaining.length - 1; i >= 0; i -= 1) {
      const key = remaining[i].from < remaining[i].to ? `${remaining[i].from}|${remaining[i].to}` : `${remaining[i].to}|${remaining[i].from}`;
      if (loopKeys.has(key)) remaining.splice(i, 1);
    }
    if (remaining.length === edges.length) break;
  }
  return loops;
}

function triangleBoxIntersectsUnitBox(points) {
  for (let axis = 0; axis < 3; axis += 1) {
    const values = points.map((point) => point.getComponent(axis));
    if (Math.max(...values) < -0.5 || Math.min(...values) > 0.5) return false;
  }
  return true;
}

function mostCommonMaterialIndex(samples) {
  const counts = new Map();
  samples.forEach((sample) => counts.set(sample.materialIndex, (counts.get(sample.materialIndex) || 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 0;
}

function pointInTriangle2D(px, pz, a, b, c) {
  const v0x = c.x - a.x;
  const v0z = c.z - a.z;
  const v1x = b.x - a.x;
  const v1z = b.z - a.z;
  const v2x = px - a.x;
  const v2z = pz - a.z;
  const dot00 = v0x * v0x + v0z * v0z;
  const dot01 = v0x * v1x + v0z * v1z;
  const dot02 = v0x * v2x + v0z * v2z;
  const dot11 = v1x * v1x + v1z * v1z;
  const dot12 = v1x * v2x + v1z * v2z;
  const denominator = dot00 * dot11 - dot01 * dot01;
  if (Math.abs(denominator) < 0.0000001) return false;
  const invDenominator = 1 / denominator;
  const u = (dot11 * dot02 - dot01 * dot12) * invDenominator;
  const v = (dot00 * dot12 - dot01 * dot02) * invDenominator;
  return u >= -0.0001 && v >= -0.0001 && u + v <= 1.0001;
}

function interpolatedSampleAttribute(attribute, samples, boxPoint, name) {
  const nearest = samples
    .map((sample) => ({
      sample,
      distanceSq: sample.boxPoint.distanceToSquared(boxPoint),
    }))
    .sort((a, b) => a.distanceSq - b.distanceSq)
    .slice(0, 8);
  const tuple = new Array(attribute.itemSize).fill(0);
  let totalWeight = 0;
  nearest.forEach(({ sample, distanceSq }) => {
    const weight = 1 / Math.max(0.00001, distanceSq);
    totalWeight += weight;
    for (let i = 0; i < attribute.itemSize; i += 1) {
      tuple[i] += attribute.getComponent(sample.index, i) * weight;
    }
  });
  const scale = 1 / Math.max(0.00001, totalWeight);
  for (let i = 0; i < tuple.length; i += 1) tuple[i] *= scale;
  if (name === "normal" && tuple.length >= 3) {
    const normal = new THREE.Vector3(tuple[0], tuple[1], tuple[2]).normalize();
    tuple[0] = normal.x;
    tuple[1] = normal.y;
    tuple[2] = normal.z;
  }
  return tuple;
}

function appendExistingGeometryToAttributes(geometry, nextAttributes, nextGroups) {
  const triangleCount = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
  let vertexCount = 0;
  let activeGroup = null;
  const appendTriangle = (indices, materialIndex) => {
    if (!activeGroup || activeGroup.materialIndex !== materialIndex) {
      activeGroup = { start: vertexCount, count: 0, materialIndex };
      nextGroups.push(activeGroup);
    }
    indices.forEach((index) => {
      Object.entries(geometry.attributes).forEach(([name, attribute]) => appendAttributeVertex(nextAttributes[name], attribute, index));
      vertexCount += 1;
      activeGroup.count += 1;
    });
  };
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    appendTriangle(getTriangleIndices(geometry, triangle), materialIndexForTriangle(geometry, triangle));
  }
  return { vertexCount, activeGroup };
}

function topDownHoleFillGeometryWithBox(mesh, boxObject) {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  if (!position || position.count < 3) return { added: 0, mode: "topDown" };
  const wasVisible = mesh.visible;
  const toBox = boxObject.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  const fromBoxToMesh = mesh.matrixWorld.clone().invert().multiply(boxObject.matrixWorld);
  const triangleCount = geometry.index ? geometry.index.count / 3 : position.count / 3;
  const local = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const inBox = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const samples = [];
  const projectedTriangles = [];

  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const indices = getTriangleIndices(geometry, triangle);
    indices.forEach((index, corner) => {
      local[corner].fromBufferAttribute(position, index);
      inBox[corner].copy(local[corner]).applyMatrix4(toBox);
    });
    if (!triangleBoxIntersectsUnitBox(inBox)) continue;
    const materialIndex = materialIndexForTriangle(geometry, triangle);
    projectedTriangles.push({
      points: inBox.map((point) => point.clone()),
      materialIndex,
    });
    indices.forEach((index, corner) => {
      samples.push({
        index,
        materialIndex,
        boxPoint: inBox[corner].clone(),
      });
    });
  }

  if (samples.length < 3 || !projectedTriangles.length) return { added: 0, mode: "topDown" };
  const gridSize = 48;
  const occupied = Array.from({ length: gridSize }, () => Array(gridSize).fill(false));
  const cellCenter = (index) => -0.5 + (index + 0.5) / gridSize;

  projectedTriangles.forEach(({ points }) => {
    const minX = THREE.MathUtils.clamp(Math.floor((Math.min(points[0].x, points[1].x, points[2].x) + 0.5) * gridSize), 0, gridSize - 1);
    const maxX = THREE.MathUtils.clamp(Math.ceil((Math.max(points[0].x, points[1].x, points[2].x) + 0.5) * gridSize), 0, gridSize - 1);
    const minZ = THREE.MathUtils.clamp(Math.floor((Math.min(points[0].z, points[1].z, points[2].z) + 0.5) * gridSize), 0, gridSize - 1);
    const maxZ = THREE.MathUtils.clamp(Math.ceil((Math.max(points[0].z, points[1].z, points[2].z) + 0.5) * gridSize), 0, gridSize - 1);
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (pointInTriangle2D(cellCenter(x), cellCenter(z), points[0], points[1], points[2])) occupied[z][x] = true;
      }
    }
  });

  const outside = Array.from({ length: gridSize }, () => Array(gridSize).fill(false));
  const queue = [];
  const pushOutside = (x, z) => {
    if (x < 0 || x >= gridSize || z < 0 || z >= gridSize || occupied[z][x] || outside[z][x]) return;
    outside[z][x] = true;
    queue.push([x, z]);
  };
  for (let i = 0; i < gridSize; i += 1) {
    pushOutside(i, 0);
    pushOutside(i, gridSize - 1);
    pushOutside(0, i);
    pushOutside(gridSize - 1, i);
  }
  for (let index = 0; index < queue.length; index += 1) {
    const [x, z] = queue[index];
    pushOutside(x + 1, z);
    pushOutside(x - 1, z);
    pushOutside(x, z + 1);
    pushOutside(x, z - 1);
  }

  const holeCells = [];
  for (let z = 0; z < gridSize; z += 1) {
    for (let x = 0; x < gridSize; x += 1) {
      if (!occupied[z][x] && !outside[z][x]) holeCells.push([x, z]);
    }
  }
  if (!holeCells.length) return { added: 0, mode: "topDown" };

  const nextAttributes = {};
  Object.entries(geometry.attributes).forEach(([name]) => { nextAttributes[name] = []; });
  const nextGroups = [];
  let { vertexCount, activeGroup } = appendExistingGeometryToAttributes(geometry, nextAttributes, nextGroups);
  const fillMaterial = mostCommonMaterialIndex(samples);
  if (!activeGroup || activeGroup.materialIndex !== fillMaterial) {
    activeGroup = { start: vertexCount, count: 0, materialIndex: fillMaterial };
    nextGroups.push(activeGroup);
  }

  const cornerCache = new Map();
  const averageY = THREE.MathUtils.clamp(samples.reduce((sum, sample) => sum + sample.boxPoint.y, 0) / samples.length, -0.5, 0.5);
  const ySamples = samples.map((sample, index) => ({ ...sample, index }));
  const yAttribute = {
    itemSize: 1,
    getComponent: (index) => ySamples[index]?.boxPoint.y ?? averageY,
  };
  const patchVertex = (x, z) => {
    const key = `${x}:${z}`;
    if (cornerCache.has(key)) return cornerCache.get(key);
    const boxPoint = new THREE.Vector3(-0.5 + x / gridSize, averageY, -0.5 + z / gridSize);
    const interpolatedY = interpolatedSampleAttribute(yAttribute, ySamples, boxPoint, "height")[0];
    boxPoint.y = THREE.MathUtils.clamp(Number.isFinite(interpolatedY) ? interpolatedY : averageY, -0.5, 0.5);
    const attrs = {};
    Object.entries(geometry.attributes).forEach(([name, attribute]) => {
      attrs[name] = name === "position"
        ? boxPoint.clone().applyMatrix4(fromBoxToMesh).toArray()
        : interpolatedSampleAttribute(attribute, samples, boxPoint, name);
    });
    const vertex = { boxPoint, attrs };
    cornerCache.set(key, vertex);
    return vertex;
  };
  const appendPatchVertex = (vertex) => {
    Object.entries(geometry.attributes).forEach(([name]) => appendAttributeTuple(nextAttributes[name], vertex.attrs[name]));
    vertexCount += 1;
    activeGroup.count += 1;
  };
  const emittedVertexInsideBox = (vertex) => {
    const outputPosition = vertex.attrs.position;
    if (!outputPosition || outputPosition.length < 3) return false;
    return pointInsideUnitBox(new THREE.Vector3(outputPosition[0], outputPosition[1], outputPosition[2]).applyMatrix4(toBox));
  };
  const appendPatchTriangle = (a, b, c) => {
    if (!triangleInsideUnitBox([a.boxPoint, b.boxPoint, c.boxPoint])) return false;
    if (![a, b, c].every(emittedVertexInsideBox)) return false;
    [a, b, c].forEach(appendPatchVertex);
    return true;
  };

  let added = 0;
  holeCells.forEach(([x, z]) => {
    const a = patchVertex(x, z);
    const b = patchVertex(x + 1, z);
    const c = patchVertex(x + 1, z + 1);
    const d = patchVertex(x, z + 1);
    if (appendPatchTriangle(a, b, c)) added += 1;
    if (appendPatchTriangle(a, c, d)) added += 1;
  });

  if (!added) return { added: 0, mode: "topDown" };
  const nextGeometry = new THREE.BufferGeometry();
  Object.entries(geometry.attributes).forEach(([name, attribute]) => {
    nextGeometry.setAttribute(name, new THREE.BufferAttribute(new attribute.array.constructor(nextAttributes[name]), attribute.itemSize, attribute.normalized));
  });
  nextGroups.forEach((group) => nextGeometry.addGroup(group.start, group.count, group.materialIndex));
  nextGeometry.computeBoundingBox();
  nextGeometry.computeBoundingSphere();
  if (!nextGeometry.attributes.normal && nextGeometry.attributes.position) nextGeometry.computeVertexNormals();
  geometry.dispose();
  mesh.geometry = nextGeometry;
  mesh.visible = wasVisible;
  return { added, mode: "topDown" };
}

function fillGeometryWithBox(mesh, boxObject) {
  const geometry = mesh.geometry;
  const position = geometry.attributes.position;
  if (!position || position.count < 3) return { added: 0 };
  ensureOriginalAuthoringBounds(mesh);
  mesh.updateMatrixWorld(true);
  boxObject.updateMatrixWorld(true);
  return topDownHoleFillGeometryWithBox(mesh, boxObject);
}

function applyGeometryCut() {
  if (!botGroup || !cutterBox || editMode !== "geometryCutter") return;
  let removed = 0;
  let meshesTouched = 0;
  let meshesChecked = 0;
  botGroup.traverse((child) => {
    if (!isCuttableVisualMesh(child)) return;
    meshesChecked += 1;
    const result = cutGeometryWithBox(child, cutterBox);
    if (result.removed > 0) {
      removed += result.removed;
      meshesTouched += 1;
    }
  });
  setStatus(removed
    ? `Removed ${removed} triangles from ${meshesTouched} mesh${meshesTouched === 1 ? "" : "es"}`
    : `Cut removed no geometry (${meshesChecked} mesh${meshesChecked === 1 ? "" : "es"} checked)`);
}

function applyGeometryFill() {
  if (!botGroup || !cutterBox || editMode !== "geometryCutter") return;
  let added = 0;
  let meshesTouched = 0;
  let meshesChecked = 0;
  botGroup.traverse((child) => {
    if (!isCuttableVisualMesh(child)) return;
    meshesChecked += 1;
    const result = fillGeometryWithBox(child, cutterBox);
    if (result.added > 0) {
      added += result.added;
      meshesTouched += 1;
    }
  });
  setStatus(added
    ? `Filled ${added} top-down hole patch triangles across ${meshesTouched} mesh${meshesTouched === 1 ? "" : "es"}`
    : `Fill found no enclosed top-down holes (${meshesChecked} mesh${meshesChecked === 1 ? "" : "es"} checked)`);
}

function cloneGameReadyGeometryModel(sourceModel) {
  const clone = sourceModel.clone(true);
  clone.position.set(0, 0, 0);
  clone.quaternion.identity();
  clone.scale.set(1, 1, 1);
  delete clone.userData.modelTransformTarget;

  const generatedViewerParts = [];
  clone.traverse((child) => {
    if (child.userData?.viewerPart) generatedViewerParts.push(child);
    if (!child.isMesh) return;
    child.visible = true;
    child.geometry = child.geometry.clone();
    if (Array.isArray(child.material)) {
      child.material = child.material.map((material) => material?.clone?.() || material);
    } else if (child.material?.clone) {
      child.material = child.material.clone();
    }
  });

  // Viewer parts are generated from the hidden authoring mesh for preview/runtime animation.
  // Exporting them makes the game split an already split model, which breaks positioning and weapon pivots.
  generatedViewerParts.forEach((part) => part.parent?.remove(part));
  clearOriginalAuthoringBounds(clone);
  clone.updateMatrixWorld(true);
  return clone;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function outputGeometry() {
  if (!botGroup?.userData?.sourceModel) return;
  setStatus("Exporting geometry");
  const exportModel = cloneGameReadyGeometryModel(botGroup.userData.sourceModel);
  gltfExporter.parse(
    exportModel,
    (result) => {
      const blob = result instanceof ArrayBuffer
        ? new Blob([result], { type: "model/gltf-binary" })
        : new Blob([JSON.stringify(result)], { type: "model/gltf+json" });
      downloadBlob(blob, `${selectedBotId}-cut.glb`);
      setStatus("Downloaded modified GLB");
    },
    (error) => {
      console.error(error);
      setStatus("Could not export geometry");
    },
    { binary: true },
  );
}

function makePhysicsArenaVisual() {
  const root = new THREE.Group();
  root.name = "physicsTestArena";
  root.userData.toolKind = "physicsTestArena";
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(ARENA_WIDTH, ARENA_VISUAL_FLOOR_THICKNESS, ARENA_LENGTH),
    new THREE.MeshStandardMaterial({ color: 0x2d3336, roughness: 0.72, metalness: 0.18 }),
  );
  floor.position.set(0, ARENA_FLOOR_Y - ARENA_VISUAL_FLOOR_THICKNESS / 2, 0);
  floor.receiveShadow = true;
  floor.userData.hideWhenCameraBelowFloor = true;
  const grid = new THREE.GridHelper(ARENA_WIDTH, 24, 0x7fd6ff, 0x4b5a5f);
  grid.position.y = ARENA_VISUAL_FLOOR_Y + 0.004;
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x5f737b, roughness: 0.5, metalness: 0.35, transparent: true, opacity: 0.42 });
  const wallHeight = ARENA_CEILING_HEIGHT - ARENA_VISUAL_FLOOR_Y;
  const wallY = ARENA_VISUAL_FLOOR_Y + wallHeight * 0.5;
  [
    [0, wallY, -ARENA_HALF_LENGTH, ARENA_WIDTH, wallHeight, 0.12],
    [0, wallY, ARENA_HALF_LENGTH, ARENA_WIDTH, wallHeight, 0.12],
    [-ARENA_HALF_WIDTH, wallY, 0, 0.12, wallHeight, ARENA_LENGTH],
    [ARENA_HALF_WIDTH, wallY, 0, 0.12, wallHeight, ARENA_LENGTH],
  ].forEach(([x, y, z, sx, sy, sz]) => {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), wallMaterial);
    wall.position.set(x, y, z);
    wall.receiveShadow = true;
    root.add(wall);
  });
  root.add(floor, grid);
  return root;
}

function ensurePhysicsArenaVisible() {
  if (!physicsArenaRoot) {
    physicsArenaRoot = makePhysicsArenaVisual();
    scene.add(physicsArenaRoot);
  }
  physicsArenaRoot.visible = editMode === "physicsTest" || editMode === "physicalDamage";
}

function updateFloorVisibilityForCamera() {
  const belowFloor = camera.position.y < ARENA_FLOOR_Y - 0.01;
  groundPlane.visible = !belowFloor;
  physicsArenaRoot?.traverse((child) => {
    if (child.userData?.hideWhenCameraBelowFloor) child.visible = !belowFloor;
  });
}

function disposePhysicsWorld() {
  physicsWorld?.free?.();
  physicsWorld = null;
  physicsFighter = null;
}

function createPhysicsWorldShell() {
  disposePhysicsWorld();
  physicsWorld = new RAPIER.World({ x: 0, y: physicsGravityY(), z: 0 });
  physicsWorld.integrationParameters.dt = FIXED_PHYSICS_DT;
  physicsWorld.integrationParameters.numSolverIterations = Math.max(physicsWorld.integrationParameters.numSolverIterations || 0, 8);
  physicsWorld.integrationParameters.numInternalPgsIterations = Math.max(physicsWorld.integrationParameters.numInternalPgsIterations || 0, 2);
  physicsWorld.integrationParameters.maxCcdSubsteps = Math.max(physicsWorld.integrationParameters.maxCcdSubsteps || 0, 2);
  physics.configureWorld(physicsWorld);
  physics.setEnabled(true);
  physics.setOptions({
    spinnerKnockbackEnabled: true,
    teeterAssistEnabled: true,
    colliderCenterOfMassEnabled: false,
    softFloorCorrectionEnabled: true,
    arenaHalfWidth: ARENA_HALF_WIDTH,
    arenaHalfLength: ARENA_HALF_LENGTH,
    arenaCeilingHeight: ARENA_CEILING_HEIGHT,
  });
  const ground = physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, ARENA_PHYSICS_FLOOR_BODY_Y, 0));
  physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(ARENA_HALF_WIDTH, ARENA_PHYSICS_FLOOR_HALF_HEIGHT, ARENA_HALF_LENGTH).setFriction(1.4), ground);
  const makeWall = (x, z, sx, sz) => {
    const body = physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, ARENA_CEILING_HEIGHT / 2, z));
    physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(sx, ARENA_CEILING_HEIGHT / 2, sz).setFriction(1.1).setRestitution(0.05), body);
  };
  makeWall(0, -ARENA_HALF_LENGTH, ARENA_HALF_WIDTH + 0.1, 0.1);
  makeWall(0, ARENA_HALF_LENGTH, ARENA_HALF_WIDTH + 0.1, 0.1);
  makeWall(-ARENA_HALF_WIDTH, 0, 0.1, ARENA_HALF_LENGTH + 0.1);
  makeWall(ARENA_HALF_WIDTH, 0, 0.1, ARENA_HALF_LENGTH + 0.1);
  const ceiling = physicsWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, ARENA_CEILING_HEIGHT, 0));
  physicsWorld.createCollider(RAPIER.ColliderDesc.cuboid(ARENA_HALF_WIDTH, 0.12, ARENA_HALF_LENGTH).setFriction(0.8).setRestitution(0.05), ceiling);
}

function readPhysicsInitialVelocity() {
  return {
    x: Number(physicsVelocityInputs.x?.value || 0) || 0,
    y: Number(physicsVelocityInputs.y?.value || 0) || 0,
    z: Number(physicsVelocityInputs.z?.value || 0) || 0,
  };
}

function capturePhysicsTestPose() {
  return {
    position: botGroup.position.toArray(),
    quaternion: botGroup.quaternion.toArray(),
    scale: botGroup.scale.toArray(),
    rotation: [botGroup.rotation.x, botGroup.rotation.y, botGroup.rotation.z],
    velocity: readPhysicsInitialVelocity(),
    weaponOn: Boolean(physicsWeaponOnInput?.checked),
    recentlyHit: Boolean(physicsRecentlyHitInput?.checked),
    selfRightingGrace: Boolean(physicsSelfRightingInput?.checked),
  };
}

function applyPhysicsTestPose(pose) {
  applyBotPose(pose);
}

function createPhysicsFighterFromCurrentPose(startPose) {
  const spec = bots.find((bot) => bot.id === selectedBotId) || {};
  const visualScale = physicsTestVisualScale();
  setPhysicsTestWeaponPose(Boolean(startPose.weaponOn));
  const frame = createPhysicsTestFrame(visualScale);
  const bodyPosition = visualPositionToBodyPosition({ frame }, botGroup.position);
  const rb = physicsWorld.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(bodyPosition.x, bodyPosition.y, bodyPosition.z)
      .setRotation({ x: botGroup.quaternion.x, y: botGroup.quaternion.y, z: botGroup.quaternion.z, w: botGroup.quaternion.w })
      .setLinearDamping(0.24)
      .setAngularDamping(0.045)
      .setCcdEnabled(true)
      .setCanSleep(false),
  );
  const result = physics.addBotColliders({
    world: physicsWorld,
    rb,
    id: selectedBotId,
    parts: frame.parts,
    visualScale,
    group: botGroup,
    helpers: { wedgeVertices, colliderRotation, colliderRelativeToWeapon },
  });
  rb.userData = {
    ...(rb.userData || {}),
    weightLbs: spec.weightLbs || 250,
    physicsParts: result.parts,
    physicsColliderBindings: result.colliderBindings,
  };
  const fighter = {
    spec,
    group: botGroup,
    rb,
    health: 100,
    weightLbs: spec.weightLbs || 250,
    weapon: botGroup.userData.weapon,
    drivetrain: botGroup.userData.drivetrain,
    weaponColliderBindings: result.weaponBindings,
    frame,
    visualScale,
    visualFloorOffset: frame.visualOffsetY,
    colliderMinY: frame.colliderMinY,
    colliderParts: frame.parts,
    restingBodyY: frame.groundedBodyY,
    stableDrive: { active: true, unstableUntil: 0, stableSince: performance.now() / 1000 },
  };
  fighter.physicalDamageOriginalColliderParts = frame.parts.map(cloneColliderPartForDamage);
  physics.initializeFighter(fighter, result.parts, { floorY: ARENA_PHYSICS_FLOOR_Y });
  rb.setLinvel(startPose.velocity, true);
  rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
  if (startPose.recentlyHit) physics.markHit(fighter, 1.5);
  if (startPose.selfRightingGrace) fighter.selfRightingUntil = performance.now() / 1000 + 2.4;
  return fighter;
}

function damageNumber(input, fallback, { integer = false } = {}) {
  const value = Number(input?.value);
  if (!Number.isFinite(value)) return fallback;
  return integer ? Math.round(value) : value;
}

function physicalDamageTweakerOptions() {
  const significantHitsRequired = damageNumber(
    tweakerDamageHitsInput,
    DEFAULT_PHYSICAL_DAMAGE_OPTIONS.significantHitsRequired,
    { integer: true },
  );
  return {
    ...DEFAULT_PHYSICAL_DAMAGE_OPTIONS,
    enabled: true,
    threshold: damageNumber(tweakerDamageThresholdInput, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.threshold),
    significantHitsRequired,
    resilience: damageNumber(tweakerDamageResilienceInput, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.resilience),
    breakRadius: damageNumber(tweakerDamageRadiusInput, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.breakRadius),
    primeMatchRadius: damageNumber(tweakerDamageMatchRadiusInput, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.primeMatchRadius),
    maxBreakRadius: damageNumber(tweakerDamageMaxRadiusInput, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.maxBreakRadius),
    maxPrimeMatchRadius: damageNumber(tweakerDamageMaxMatchRadiusInput, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.maxPrimeMatchRadius),
    maxRadiusDamageMultiplier: damageNumber(tweakerDamageMaxRadiusMultiplierInput, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.maxRadiusDamageMultiplier),
    impulseScale: damageNumber(tweakerDamageImpulseInput, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.impulseScale),
    maxPiecesPerBot: damageNumber(tweakerDamageMaxPiecesInput, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.maxPiecesPerBot, { integer: true }),
    convexCollider: tweakerDamageConvexInput?.checked !== false,
  };
}

function setPhysicalDamageStatus(text, detail = null) {
  if (physicalDamageStatus) {
    physicalDamageStatus.textContent = detail ? `${text}\n${detail}` : text;
  }
  setStatus(text);
}

function updateBreakInfoButton() {
  if (!outputBreakInfoButton) return;
  const hasBreakContext = Boolean(
    damageFighter?.physicalDamageLastResult ||
    damageFighter?.physicalDamageBrokenAt?.length ||
    damageFighter?.physicalDamagePrimedAt?.length ||
    damageProps.length,
  );
  outputBreakInfoButton.disabled = editMode !== "physicalDamage" || !hasBreakContext;
}

function cloneColliderPartForDamage(part) {
  return {
    ...part,
    position: [...(part.position || [0, 0, 0])],
    halfExtents: [...(part.halfExtents || [0.4, 0.16, 0.4])],
    rotation: part.rotation ? [...part.rotation] : part.rotation,
    vertices: part.vertices ? part.vertices.map((point) => [...point]) : part.vertices,
  };
}

// Keep this physical damage collider/fill integration in sync with main.js.
// Shared tuning lives in physicalDamageShared.js; host-specific editor/debug glue stays here.
void PHYSICAL_DAMAGE_SYNC_NOTE;

function colliderSolidVerticesForDamage(part) {
  const half = part.halfExtents || [0.4, 0.16, 0.4];
  const [hx, hy, hz] = half.map((value) => Math.max(0.01, Math.abs(value)));
  if (part.type === "wedge" || part.part === "wedge") return wedgeVertices([hx, hy, hz]).map((point) => new THREE.Vector3(...point));
  return [
    new THREE.Vector3(-hx, -hy, -hz), new THREE.Vector3(hx, -hy, -hz),
    new THREE.Vector3(-hx, hy, -hz), new THREE.Vector3(hx, hy, -hz),
    new THREE.Vector3(-hx, -hy, hz), new THREE.Vector3(hx, -hy, hz),
    new THREE.Vector3(-hx, hy, hz), new THREE.Vector3(hx, hy, hz),
  ];
}

function colliderSolidEdgesForDamage(part) {
  if (part.type === "wedge" || part.part === "wedge") {
    return [[0, 1], [0, 2], [1, 3], [2, 3], [2, 4], [3, 5], [4, 5], [0, 4], [1, 5]];
  }
  return [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
}

function colliderCutAxisForDamage(partPoint, half, preferredNormal = null) {
  if (preferredNormal?.lengthSq?.() > 0.0001) {
    const normalScores = [0, 1, 2].map((axis) => Math.abs(preferredNormal.getComponent(axis)));
    const normalAxis = normalScores.indexOf(Math.max(...normalScores));
    if (normalScores[normalAxis] > 0.55) return normalAxis;
  }
  const scores = [0, 1, 2].map((axis) => Math.abs(partPoint.getComponent(axis)) / Math.max(0.001, half[axis]));
  let axis = scores[0] >= scores[2] ? 0 : 2;
  if (scores[1] > Math.max(scores[0], scores[2]) * 1.8 && partPoint.y > half[1] * 0.35) axis = 1;
  return axis;
}

function clipDamageFillPolygon(points, axis, min, max) {
  if (points.length < 3) return points;
  const clip = (input, keepGreater, limit) => {
    const output = [];
    for (let i = 0; i < input.length; i += 1) {
      const current = input[i];
      const previous = input[(i + input.length - 1) % input.length];
      const currentInside = keepGreater ? current.getComponent(axis) >= limit : current.getComponent(axis) <= limit;
      const previousInside = keepGreater ? previous.getComponent(axis) >= limit : previous.getComponent(axis) <= limit;
      const addIntersection = () => {
        const a = previous.getComponent(axis);
        const b = current.getComponent(axis);
        const t = Math.abs(b - a) < 0.000001 ? 0 : (limit - a) / (b - a);
        output.push(previous.clone().lerp(current, THREE.MathUtils.clamp(t, 0, 1)));
      };
      if (currentInside) {
        if (!previousInside) addIntersection();
        output.push(current.clone());
      } else if (previousInside) {
        addIntersection();
      }
    }
    return output;
  };
  return clip(clip(points, true, min), false, max);
}

function colliderSolidCutFacesForDamage(part, partPoint, radius, preferredNormal = null) {
  const half = (part.halfExtents || [0.4, 0.16, 0.4]).map((value) => Math.max(0.01, Math.abs(value)));
  const axis = colliderCutAxisForDamage(partPoint, half, preferredNormal);
  const side = preferredNormal && Math.abs(preferredNormal.getComponent(axis)) > 0.25
    ? Math.sign(preferredNormal.getComponent(axis)) || 1
    : partPoint.getComponent(axis) >= 0 ? 1 : -1;
  const cutCoord = THREE.MathUtils.clamp(
    partPoint.getComponent(axis) - side * Math.max(PHYSICAL_DAMAGE_FILL.cutInsetMin, radius * PHYSICAL_DAMAGE_FILL.cutInsetFactor),
    -half[axis] + 0.01,
    half[axis] - 0.01,
  );
  const vertices = colliderSolidVerticesForDamage(part);
  const points = [];
  colliderSolidEdgesForDamage(part).forEach(([ai, bi]) => {
    const a = vertices[ai];
    const b = vertices[bi];
    const da = a.getComponent(axis) - cutCoord;
    const db = b.getComponent(axis) - cutCoord;
    if (Math.abs(da) < 0.00001) points.push(a.clone());
    if (Math.abs(db) < 0.00001) points.push(b.clone());
    if (da * db < 0) points.push(a.clone().lerp(b, da / (da - db)));
  });
  const unique = [];
  points.forEach((point) => {
    if (!unique.some((existing) => existing.distanceToSquared(point) < 0.000001)) unique.push(point);
  });
  if (unique.length < 3) return [];
  let clipped = unique;
  const patchRadius = THREE.MathUtils.clamp(
    radius * PHYSICAL_DAMAGE_FILL.localPatchRadiusScale,
    PHYSICAL_DAMAGE_FILL.localPatchRadiusMin,
    PHYSICAL_DAMAGE_FILL.localPatchRadiusMax,
  );
  [0, 1, 2].forEach((clipAxis) => {
    if (clipAxis === axis || clipped.length < 3) return;
    clipped = clipDamageFillPolygon(
      clipped,
      clipAxis,
      Math.max(-half[clipAxis], partPoint.getComponent(clipAxis) - patchRadius),
      Math.min(half[clipAxis], partPoint.getComponent(clipAxis) + patchRadius),
    );
  });
  if (clipped.length < 3) return [];
  const normal = new THREE.Vector3().setComponent(axis, side);
  const center = clipped.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / clipped.length);
  const tangent = Math.abs(normal.y) < 0.82 ? new THREE.Vector3(0, 1, 0).cross(normal).normalize() : new THREE.Vector3(1, 0, 0).cross(normal).normalize();
  const bitangent = normal.clone().cross(tangent).normalize();
  clipped.sort((a, b) => {
    const ar = a.clone().sub(center);
    const br = b.clone().sub(center);
    return Math.atan2(ar.dot(bitangent), ar.dot(tangent)) - Math.atan2(br.dot(bitangent), br.dot(tangent));
  });
  return [{ normal, vertices: clipped }];
}

function colliderPartWorldMatrixForDamage(part, fighter) {
  if (part.part === "weapon" && fighter?.group?.userData?.weapon?.object) {
    const relative = colliderRelativeToWeapon(part, fighter.group);
    if (relative) {
      fighter.group.userData.weapon.object.updateMatrixWorld(true);
      return fighter.group.userData.weapon.object.matrixWorld.clone().multiply(relative);
    }
  }
  return fighter.group.matrixWorld.clone().multiply(colliderLocalMatrix(part));
}

function pushDamageFillTriangles({ bodyPositions, debrisPositions, face, partMatrix, mesh, debrisCenter, bodyOnly = false, inflate = 1 }) {
  const triangles = [];
  for (let i = 1; i < face.vertices.length - 1; i += 1) triangles.push([0, i, i + 1]);
  const worldNormal = face.normal.clone().transformDirection(partMatrix).normalize();
  const center = face.vertices.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / face.vertices.length);
  const bodyLocal = new THREE.Vector3();
  const debrisLocal = new THREE.Vector3();
  triangles.forEach((tri) => {
    tri.forEach((index) => {
      const local = face.vertices[index].clone();
      if (inflate !== 1) local.sub(center).multiplyScalar(inflate).add(center);
      const world = local.applyMatrix4(partMatrix).addScaledVector(
        worldNormal,
        bodyOnly ? PHYSICAL_DAMAGE_FILL.bodySurfaceOffset : PHYSICAL_DAMAGE_FILL.sharedSurfaceOffset,
      );
      bodyLocal.copy(world);
      mesh.worldToLocal(bodyLocal);
      bodyPositions.push(bodyLocal.x, bodyLocal.y, bodyLocal.z);
      if (!bodyOnly) {
        debrisLocal.copy(world).sub(debrisCenter);
        debrisPositions.push(debrisLocal.x, debrisLocal.y, debrisLocal.z);
      }
    });
  });
}

function damageFillGeometry(positions) {
  if (positions.length < 9) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function pushDamageDoubleSidedQuad(positions, a, b, c, d) {
  [a, b, c, a, c, d, d, c, b, d, b, a].forEach((point) => positions.push(point.x, point.y, point.z));
}

// Mirrored host fallback for the cake-volume model. Keep this in sync with
// main.js: only body physics colliders define the bottom of the simulated solid
// interior, never drive contacts or other gameplay proxy colliders.
function isDamageCakeFloorCollider(part) {
  return part?.part === "body" && part.type !== "cylinder" && part.type !== "driveContact";
}

function damageBodyFloorInMeshLocal(fighter, mesh) {
  const parts = fighter.physicalDamageOriginalColliderParts || fighter.colliderParts || [];
  let floorY = Infinity;
  parts.forEach((part) => {
    if (!isDamageCakeFloorCollider(part)) return;
    const position = part.position || [0, 0, 0];
    const half = part.halfExtents || [0.4, 0.16, 0.4];
    floorY = Math.min(floorY, position[1] - Math.abs(half[1]));
  });
  if (!Number.isFinite(floorY)) return null;
  const world = fighter.group.localToWorld(new THREE.Vector3(0, floorY + PHYSICAL_DAMAGE_FILL.cakeFloorOffset, 0));
  return mesh.worldToLocal(world).y;
}

function addCakeSolidInteriorFillForDamage({ fighter, candidate, bodyPositions }) {
  const geometry = candidate?.split?.pieceGeometry;
  if (!fighter?.group || !candidate?.mesh || !geometry?.attributes?.position) return 0;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox?.clone();
  if (!box || !Number.isFinite(box.min.x)) return 0;
  box.expandByScalar(PHYSICAL_DAMAGE_FILL.cakeBoundsExpand);
  const floorY = damageBodyFloorInMeshLocal(fighter, candidate.mesh);
  if (Number.isFinite(floorY)) box.min.y = Math.min(box.min.y, floorY);
  const localNormal = candidate.lastHitNormal?.clone?.().transformDirection(candidate.mesh.matrixWorld.clone().invert()).normalize() || new THREE.Vector3(0, 1, 0);
  const scores = [Math.abs(localNormal.x), Math.abs(localNormal.y), Math.abs(localNormal.z)];
  const axis = scores.indexOf(Math.max(...scores));
  const side = Math.sign(localNormal.getComponent(axis)) || 1;
  const cut = side > 0 ? box.min.getComponent(axis) : box.max.getComponent(axis);
  const min = box.min;
  const max = box.max;
  const point = (x, y, z) => new THREE.Vector3(x, y, z);
  const addPlane = (fixedAxis, fixed, a0, a1, b0, b1) => {
    const axes = [0, 1, 2].filter((value) => value !== fixedAxis);
    const make = (a, b) => {
      const values = [0, 0, 0];
      values[fixedAxis] = fixed;
      values[axes[0]] = a;
      values[axes[1]] = b;
      return point(values[0], values[1], values[2]);
    };
    pushDamageDoubleSidedQuad(bodyPositions, make(a0, b0), make(a1, b0), make(a1, b1), make(a0, b1));
  };
  if (axis === 1) {
    const y = THREE.MathUtils.clamp(cut, min.y, max.y);
    addPlane(1, y, min.x, max.x, min.z, max.z);
    if (y > min.y + 0.01) {
      pushDamageDoubleSidedQuad(bodyPositions, point(min.x, min.y, min.z), point(min.x, y, min.z), point(min.x, y, max.z), point(min.x, min.y, max.z));
      pushDamageDoubleSidedQuad(bodyPositions, point(max.x, min.y, max.z), point(max.x, y, max.z), point(max.x, y, min.z), point(max.x, min.y, min.z));
      pushDamageDoubleSidedQuad(bodyPositions, point(max.x, min.y, min.z), point(max.x, y, min.z), point(min.x, y, min.z), point(min.x, min.y, min.z));
      pushDamageDoubleSidedQuad(bodyPositions, point(min.x, min.y, max.z), point(min.x, y, max.z), point(max.x, y, max.z), point(max.x, min.y, max.z));
    }
  } else if (axis === 0) {
    addPlane(0, cut, min.y, max.y, min.z, max.z);
    addPlane(1, min.y, Math.min(cut, max.x), Math.max(cut, min.x), min.z, max.z);
  } else {
    addPlane(2, cut, min.x, max.x, min.y, max.y);
    addPlane(1, min.y, min.x, max.x, Math.min(cut, max.z), Math.max(cut, min.z));
  }
  return 1;
}

function addColliderSolidFillForTweakerBreak({ fighter, candidate, prop, radius = 0.35 }) {
  if (!fighter?.group || !candidate?.mesh || !candidate?.worldPoint || !prop?.mesh) return { body: 0, debris: 0 };
  const parts = fighter.physicalDamageOriginalColliderParts || fighter.colliderParts || [];
  if (!parts.length) return { body: 0, debris: 0 };
  if (candidate.damageZone === "weapon") {
    fighter.physicalDamageLastSolidFill = {
      body: 0,
      debris: 0,
      sourceParts: parts.length,
      usedParts: 0,
      cakeFill: 0,
      weaponSkipped: 1,
    };
    return fighter.physicalDamageLastSolidFill;
  }
  if (candidate.split?.remainingCapGeometry && candidate.split?.pieceCapGeometry) {
    fighter.physicalDamageLastSolidFill = {
      body: 0,
      debris: 0,
      sourceParts: parts.length,
      usedParts: 0,
      cakeFill: 0,
      splitCap: 1,
    };
    return fighter.physicalDamageLastSolidFill;
  }
  fighter.group.updateMatrixWorld(true);
  candidate.mesh.updateMatrixWorld(true);
  prop.mesh.updateMatrixWorld(true);
  const scaledRadius = Math.max(PHYSICAL_DAMAGE_FILL.searchRadiusMin, radius * (fighter.visualScale || 1));
  const debrisCenter = prop.mesh.getWorldPosition(new THREE.Vector3());
  const bodyPositions = [];
  const debrisPositions = [];
  let usedParts = 0;
  let nearest = null;
  let cakeFill = addCakeSolidInteriorFillForDamage({ fighter, candidate, bodyPositions });
  const addPartFill = (part, { force = false } = {}) => {
    if (usedParts >= PHYSICAL_DAMAGE_FILL.maxSourceParts || part.part === "driveContact" || part.type === "cylinder") return false;
    const partMatrix = colliderPartWorldMatrixForDamage(part, fighter);
    if (!partMatrix) return false;
    const half = (part.halfExtents || [0.4, 0.16, 0.4]).map((value) => Math.max(0.01, Math.abs(value)));
    const partPoint = candidate.worldPoint.clone().applyMatrix4(partMatrix.clone().invert());
    const preferredNormal = candidate.lastHitNormal?.clone?.().transformDirection(partMatrix.clone().invert()).normalize() || null;
    const expanded = half.map((value) => value + scaledRadius);
    const overflow = Math.max(Math.abs(partPoint.x) - half[0], Math.abs(partPoint.y) - half[1], Math.abs(partPoint.z) - half[2]);
    if (!nearest || overflow < nearest.overflow) nearest = { part, overflow };
    if (!force && (Math.abs(partPoint.x) > expanded[0] || Math.abs(partPoint.y) > expanded[1] || Math.abs(partPoint.z) > expanded[2])) return false;
    const faces = colliderSolidCutFacesForDamage(part, partPoint, scaledRadius, preferredNormal);
    if (!faces.length) return false;
    faces.forEach((face) => {
      pushDamageFillTriangles({ bodyPositions, debrisPositions, face, partMatrix, mesh: candidate.mesh, debrisCenter });
      pushDamageFillTriangles({
        bodyPositions,
        debrisPositions,
        face,
        partMatrix,
        mesh: candidate.mesh,
        debrisCenter,
        bodyOnly: true,
        inflate: PHYSICAL_DAMAGE_FILL.tweakerBodyPatchInflate,
      });
    });
    usedParts += 1;
    return true;
  };
  parts.forEach((part) => addPartFill(part));
  if (!usedParts && nearest?.part) addPartFill(nearest.part, { force: true });
  const bodyGeometry = damageFillGeometry(bodyPositions);
  let body = 0;
  let debris = 0;
  if (bodyGeometry && candidate.mesh.parent) {
    const bodyFill = new THREE.Mesh(bodyGeometry, damageSolidFillMaterial);
    bodyFill.name = "physicalDamageColliderSolidFill";
    bodyFill.userData.physicalDamageCap = true;
    bodyFill.castShadow = true;
    bodyFill.receiveShadow = true;
    bodyFill.matrix.copy(candidate.mesh.matrix);
    bodyFill.matrix.decompose(bodyFill.position, bodyFill.quaternion, bodyFill.scale);
    candidate.mesh.parent.add(bodyFill);
    body = 1;
  }
  const debrisGeometry = damageFillGeometry(debrisPositions);
  if (debrisGeometry) {
    const debrisFill = new THREE.Mesh(debrisGeometry, damageSolidFillMaterial);
    debrisFill.name = "physicalDamageDebrisSolidFill";
    debrisFill.userData.physicalDamageDetached = true;
    debrisFill.castShadow = true;
    debrisFill.receiveShadow = true;
    prop.mesh.add(debrisFill);
    debris = 1;
  }
  fighter.physicalDamageLastSolidFill = { body, debris, sourceParts: parts.length, usedParts, cakeFill };
  return fighter.physicalDamageLastSolidFill;
}

function damageColliderPartWithRanges(part, ranges) {
  const next = cloneColliderPartForDamage(part);
  next.position = ranges.map(([min, max]) => (min + max) * 0.5);
  next.halfExtents = ranges.map(([min, max]) => (max - min) * 0.5);
  if (next.vertices) delete next.vertices;
  return next;
}

function damageCandidateLocalSubtractBox(fighter, candidate) {
  const geometry = candidate?.split?.pieceGeometry;
  if (!fighter?.group || !candidate?.mesh || !geometry?.attributes?.position) return null;
  const position = geometry.attributes.position;
  const box = new THREE.Box3();
  for (let i = 0; i < position.count; i += 1) {
    const point = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
    candidate.mesh.localToWorld(point);
    fighter.group.worldToLocal(point);
    box.expandByPoint(point);
  }
  if (!Number.isFinite(box.min.x)) return null;
  box.expandByScalar(PHYSICAL_DAMAGE_COLLIDER_CARVE.subtractBoxExpand);
  return box;
}

function subtractBoxFromDamageBodyCollider(part, subtractBox) {
  if (!subtractBox || part.type !== "box" || part.part !== "body") return null;
  const position = part.position || [0, 0, 0];
  const half = part.halfExtents || [0.4, 0.16, 0.4];
  const ranges = [0, 1, 2].map((axis) => [
    position[axis] - Math.abs(half[axis]),
    position[axis] + Math.abs(half[axis]),
  ]);
  const cut = [
    [Math.max(ranges[0][0], subtractBox.min.x), Math.min(ranges[0][1], subtractBox.max.x)],
    [Math.max(ranges[1][0], subtractBox.min.y), Math.min(ranges[1][1], subtractBox.max.y)],
    [Math.max(ranges[2][0], subtractBox.min.z), Math.min(ranges[2][1], subtractBox.max.z)],
  ];
  if (cut.some(([min, max]) => max <= min)) return [cloneColliderPartForDamage(part)];
  const minHalf = PHYSICAL_DAMAGE_COLLIDER_CARVE.bodyMinHalf;
  const out = [];
  const addBox = (nextRanges) => {
    if (nextRanges.some(([min, max]) => max - min < minHalf * 2)) return;
    out.push(damageColliderPartWithRanges(part, nextRanges));
  };
  addBox([[ranges[0][0], cut[0][0]], ranges[1], ranges[2]]);
  addBox([[cut[0][1], ranges[0][1]], ranges[1], ranges[2]]);
  addBox([cut[0], [ranges[1][0], cut[1][0]], ranges[2]]);
  addBox([cut[0], [cut[1][1], ranges[1][1]], ranges[2]]);
  addBox([cut[0], cut[1], [ranges[2][0], cut[2][0]]]);
  addBox([cut[0], cut[1], [cut[2][1], ranges[2][1]]]);
  return out.length ? out : null;
}

function subtractBoxFromDamageWedgeCollider(part, subtractBox) {
  if (!subtractBox || (part.type !== "wedge" && part.part !== "wedge")) return null;
  const position = part.position || [0, 0, 0];
  const half = part.halfExtents || [0.4, 0.16, 0.4];
  const ranges = [0, 1, 2].map((axis) => [
    position[axis] - Math.abs(half[axis]),
    position[axis] + Math.abs(half[axis]),
  ]);
  const cut = [
    [Math.max(ranges[0][0], subtractBox.min.x), Math.min(ranges[0][1], subtractBox.max.x)],
    [Math.max(ranges[1][0], subtractBox.min.y), Math.min(ranges[1][1], subtractBox.max.y)],
    [Math.max(ranges[2][0], subtractBox.min.z), Math.min(ranges[2][1], subtractBox.max.z)],
  ];
  if (cut.some(([min, max]) => max <= min)) return [cloneColliderPartForDamage(part)];
  const widths = ranges.map(([min, max]) => Math.max(0.001, max - min));
  const overlaps = cut.map(([min, max]) => Math.max(0, max - min));
  const overlapFraction = overlaps.reduce((total, width) => total * width, 1)
    / widths.reduce((total, width) => total * width, 1);
  if (overlapFraction > 0.5) return [];
  const minWidth = 0.07;
  const subtractCenter = subtractBox.getCenter(new THREE.Vector3());
  const side = subtractCenter.x >= position[0] ? 1 : -1;
  const nextRanges = ranges.map((range) => [...range]);
  if (side > 0) nextRanges[0][1] = cut[0][0];
  else nextRanges[0][0] = cut[0][1];
  if (nextRanges[0][1] - nextRanges[0][0] < minWidth) return [cloneColliderPartForDamage(part)];
  return [damageColliderPartWithRanges(part, nextRanges)];
}

function splitDamageBodyBoxColliderForBreak(part, localPoint, radius, axis, side, cutPlane) {
  if (part.type !== "box" || part.part !== "body") return null;
  const position = part.position || [0, 0, 0];
  const half = part.halfExtents || [0.4, 0.16, 0.4];
  const ranges = [0, 1, 2].map((rangeAxis) => [
    position[rangeAxis] - Math.abs(half[rangeAxis]),
    position[rangeAxis] + Math.abs(half[rangeAxis]),
  ]);
  const minHalf = PHYSICAL_DAMAGE_COLLIDER_CARVE.bodyMinHalf;
  const out = [];
  const addBox = (nextRanges) => {
    if (nextRanges.some(([min, max]) => max - min < minHalf * 2)) return;
    out.push(damageColliderPartWithRanges(part, nextRanges));
  };
  const coreRanges = ranges.map((range) => [...range]);
  const slabRanges = ranges.map((range) => [...range]);
  if (side > 0) {
    coreRanges[axis][1] = THREE.MathUtils.clamp(cutPlane, ranges[axis][0], ranges[axis][1]);
    slabRanges[axis][0] = coreRanges[axis][1];
  } else {
    coreRanges[axis][0] = THREE.MathUtils.clamp(cutPlane, ranges[axis][0], ranges[axis][1]);
    slabRanges[axis][1] = coreRanges[axis][0];
  }
  addBox(coreRanges);
  if (slabRanges[axis][1] - slabRanges[axis][0] < minHalf * 2) return out.length ? out : null;
  const patchRadius = Math.max(minHalf, radius * PHYSICAL_DAMAGE_COLLIDER_CARVE.splitPatchRadiusScale);
  const [axisA, axisB] = [0, 1, 2].filter((rangeAxis) => rangeAxis !== axis);
  const patchA = [
    THREE.MathUtils.clamp(localPoint.getComponent(axisA) - patchRadius, ranges[axisA][0], ranges[axisA][1]),
    THREE.MathUtils.clamp(localPoint.getComponent(axisA) + patchRadius, ranges[axisA][0], ranges[axisA][1]),
  ];
  const patchB = [
    THREE.MathUtils.clamp(localPoint.getComponent(axisB) - patchRadius, ranges[axisB][0], ranges[axisB][1]),
    THREE.MathUtils.clamp(localPoint.getComponent(axisB) + patchRadius, ranges[axisB][0], ranges[axisB][1]),
  ];
  const addSlab = (aRange, bRange) => {
    const nextRanges = slabRanges.map((range) => [...range]);
    nextRanges[axisA] = aRange;
    nextRanges[axisB] = bRange;
    addBox(nextRanges);
  };
  addSlab([ranges[axisA][0], patchA[0]], ranges[axisB]);
  addSlab([patchA[1], ranges[axisA][1]], ranges[axisB]);
  addSlab(patchA, [ranges[axisB][0], patchB[0]]);
  addSlab(patchA, [patchB[1], ranges[axisB][1]]);
  return out.length ? out : null;
}

function carveColliderPartForBreak(part, localPoint, radius, { force = false, localNormal = null } = {}) {
  if (part.type === "wedge" || part.part === "wedge") return cloneColliderPartForDamage(part);
  const next = cloneColliderPartForDamage(part);
  const position = next.position || [0, 0, 0];
  const half = next.halfExtents || [0.4, 0.16, 0.4];
  const delta = [
    localPoint.x - position[0],
    localPoint.y - position[1],
    localPoint.z - position[2],
  ];
  const expanded = half.map((value) => Math.abs(value) + radius);
  if (!force && (Math.abs(delta[0]) > expanded[0] || Math.abs(delta[1]) > expanded[1] || Math.abs(delta[2]) > expanded[2])) return next;
  const scores = delta.map((value, index) => Math.abs(value) / Math.max(0.001, Math.abs(half[index])));
  let axis = scores[0] >= scores[2] ? 0 : 2;
  if (localNormal?.lengthSq?.() > 0.0001) {
    const normalScores = [0, 1, 2].map((normalAxis) => Math.abs(localNormal.getComponent(normalAxis)));
    const normalAxis = normalScores.indexOf(Math.max(...normalScores));
    if (normalScores[normalAxis] > 0.55 && (normalAxis !== 1 || localNormal.y > 0.25)) axis = normalAxis;
  } else if (scores[1] > Math.max(scores[0], scores[2]) * 1.8 && localPoint.y > position[1] + half[1] * 0.35) axis = 1;
  const surfaceScoreMin = part.part === "driveContact"
    ? PHYSICAL_DAMAGE_COLLIDER_CARVE.driveSurfaceScoreMin
    : PHYSICAL_DAMAGE_COLLIDER_CARVE.bodySurfaceScoreMin;
  if (
    scores[axis] < (force ? PHYSICAL_DAMAGE_COLLIDER_CARVE.forcedNearestSurfaceScoreMin : surfaceScoreMin)
  ) return next;
  const side = localNormal && Math.abs(localNormal.getComponent(axis)) > 0.25
    ? Math.sign(localNormal.getComponent(axis)) || 1
    : delta[axis] >= 0 ? 1 : -1;
  const oldMin = position[axis] - half[axis];
  const oldMax = position[axis] + half[axis];
  const cutPlane = localPoint.getComponent(axis) - side * radius * (
    part.part === "driveContact" ? PHYSICAL_DAMAGE_COLLIDER_CARVE.driveCutPlaneFactor : PHYSICAL_DAMAGE_COLLIDER_CARVE.bodyCutPlaneFactor
  );
  const minHalf = part.part === "driveContact" ? PHYSICAL_DAMAGE_COLLIDER_CARVE.driveMinHalf : PHYSICAL_DAMAGE_COLLIDER_CARVE.bodyMinHalf;
  const minWidthRatio = part.part === "driveContact" ? PHYSICAL_DAMAGE_COLLIDER_CARVE.driveMinWidthRatio : PHYSICAL_DAMAGE_COLLIDER_CARVE.bodyMinWidthRatio;
  let newMin = oldMin;
  let newMax = oldMax;
  if (side > 0) newMax = Math.min(oldMax, cutPlane);
  else newMin = Math.max(oldMin, cutPlane);
  const oldWidth = oldMax - oldMin;
  const minWidth = Math.max(minHalf * 2, oldWidth * minWidthRatio);
  if (newMax - newMin < minWidth) {
    if (side > 0) newMax = oldMin + minWidth;
    else newMin = oldMax - minWidth;
  }
  newMin = Math.max(oldMin, newMin);
  newMax = Math.min(oldMax, newMax);
  if (newMax - newMin < minHalf * 2) return null;
  const splitParts = splitDamageBodyBoxColliderForBreak(part, localPoint, radius, axis, side, side > 0 ? newMax : newMin);
  if (splitParts?.length) return splitParts;
  position[axis] = (newMin + newMax) * 0.5;
  half[axis] = (newMax - newMin) * 0.5;
  next.position = position;
  next.halfExtents = half;
  if (next.vertices) delete next.vertices;
  return next;
}

function rebuildDamageFighterColliders(fighter, nextParts) {
  if (!physicsWorld || !fighter?.rb) return;
  const bindings = fighter.rb.userData?.physicsColliderBindings || [];
  bindings.forEach((binding) => {
    if (binding.collider) physicsWorld.removeCollider(binding.collider, true);
  });
  const result = physics.addBotColliders({
    world: physicsWorld,
    rb: fighter.rb,
    id: fighter.spec.id,
    parts: nextParts,
    visualScale: fighter.visualScale || 1,
    group: fighter.group,
    helpers: { wedgeVertices, colliderRotation, colliderRelativeToWeapon },
  });
  fighter.weaponColliderBindings = result.weaponBindings;
  fighter.colliderParts = result.parts.map(cloneColliderPartForDamage);
  fighter.rb.userData.physicsParts = fighter.colliderParts.map(cloneColliderPartForDamage);
  fighter.rb.userData.physicsColliderBindings = result.colliderBindings;
  if (fighter.physics) fighter.physics.parts = fighter.colliderParts.map(cloneColliderPartForDamage);
  colliderParts = fighter.colliderParts.map(cloneColliderPartForDamage);
  rebuildColliderRoot();
}

function damageCarveResultList(result) {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

function adjustDamageFighterCollidersForPhysicalBreak({ fighter, candidate = null, worldPoint, worldNormal = null, radius = 0.35 }) {
  if (!fighter?.group || !fighter?.colliderParts?.length || !worldPoint) return null;
  const subtractBox = damageCandidateLocalSubtractBox(fighter, candidate);
  const scaledRadius = Math.max(
    PHYSICAL_DAMAGE_COLLIDER_CARVE.radiusMin,
    radius * (fighter.visualScale || 1) * PHYSICAL_DAMAGE_COLLIDER_CARVE.radiusScale,
  );
  const localHitForPart = (part) => {
    const matrix = part.part === "weapon"
      ? colliderPartWorldMatrixForDamage(part, fighter)
      : fighter.group.matrixWorld;
    const inverse = matrix.clone().invert();
    return {
      point: worldPoint.clone().applyMatrix4(inverse),
      normal: worldNormal?.clone?.().transformDirection(inverse).normalize() || null,
    };
  };
  const beforeCount = fighter.colliderParts.length;
  let nextParts = fighter.colliderParts
    .flatMap((part) => {
      const localHit = localHitForPart(part);
      return damageCarveResultList(
        subtractBoxFromDamageBodyCollider(part, subtractBox)
          || subtractBoxFromDamageWedgeCollider(part, subtractBox)
          || carveColliderPartForBreak(part, localHit.point, scaledRadius, { localNormal: localHit.normal }),
      );
    });
  if (!nextParts.length) return null;
  let changedCount = nextParts.filter((part, index) => {
    const previous = fighter.colliderParts[index];
    if (!previous) return true;
    return JSON.stringify(part.position) !== JSON.stringify(previous.position)
      || JSON.stringify(part.halfExtents) !== JSON.stringify(previous.halfExtents);
  }).length;
  if (!changedCount) {
    let nearestIndex = -1;
    let nearestDistance = Infinity;
    fighter.colliderParts.forEach((part, index) => {
      if (part.part === "driveContact") return;
      const localPoint = localHitForPart(part).point;
      const position = part.position || [0, 0, 0];
      const distance = Math.hypot(localPoint.x - position[0], localPoint.y - position[1], localPoint.z - position[2]);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    if (nearestIndex >= 0) {
      nextParts = fighter.colliderParts.map((part, index) => {
        if (index !== nearestIndex) return cloneColliderPartForDamage(part);
        const localHit = localHitForPart(part);
        const maxHalf = Math.max(...(part.halfExtents || [0.4, 0.16, 0.4]).map(Math.abs));
        return carveColliderPartForBreak(
          part,
          localHit.point,
          Math.max(scaledRadius, maxHalf * PHYSICAL_DAMAGE_COLLIDER_CARVE.forcedNearestHalfFactor),
          { force: true, localNormal: localHit.normal },
        );
      }).flatMap(damageCarveResultList);
      changedCount = 1;
    }
  }
  const adjustment = { beforeCount, afterCount: nextParts.length, changedCount };
  rebuildDamageFighterColliders(fighter, nextParts);
  fighter.physicalDamageLastColliderAdjustment = adjustment;
  return adjustment;
}

function createTweakerArenaProp(mesh, colliders, position, rotation = [0, 0, 0], meta = {}) {
  if (!damageArena?.world) return null;
  const colliderList = Array.isArray(colliders) ? colliders : [colliders];
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.traverse?.((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
  });
  scene.add(mesh);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(position[0], position[1], position[2])
    .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  bodyDesc.setLinearDamping(meta.linearDamping ?? 0.28);
  bodyDesc.setAngularDamping(meta.angularDamping ?? 0.9);
  if (meta.ccd) bodyDesc.setCcdEnabled(true);
  if (meta.canSleep === false || meta.boundedArenaDebris) bodyDesc.setCanSleep(false);
  const rb = damageArena.world.createRigidBody(bodyDesc);
  const prop = { mesh, rb, ...meta, colliderCount: 0, colliderHandles: [] };
  colliderList.forEach((collider) => {
    const { desc, translation = [0, 0, 0], rotation: colliderRot = null, density = 1.8, friction = 1.05, restitution = 0.18 } = collider.desc
      ? collider
      : { desc: collider };
    desc.setTranslation(...translation);
    if (colliderRot) desc.setRotation(colliderRot);
    const created = damageArena.world.createCollider(desc.setDensity(density).setFriction(friction).setRestitution(restitution), rb);
    prop.colliderCount += 1;
    prop.colliderHandles.push(created.handle);
  });
  rb.userData = { weightLbs: prop.weightLbs || null, kind: prop.kind || "prop" };
  mesh.userData.toolKind = "physicalDamagePiece";
  mesh.userData.damageProp = prop;
  damageArena.props.push(prop);
  damageProps.push(prop);
  return prop;
}

function ensureDamagePropColliderHelper(prop) {
  if (!prop?.mesh || prop.colliderHelper) return prop?.colliderHelper || null;
  prop.mesh.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(prop.mesh);
  if (!Number.isFinite(bounds.min.x)) return null;
  const size = bounds.getSize(new THREE.Vector3());
  if (size.lengthSq() <= 0.000001) return null;
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  const material = new THREE.LineBasicMaterial({
    color: 0xffd24a,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const helper = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), material);
  helper.name = "physicalDamagePieceColliderHelper";
  helper.userData.colliderHelper = true;
  helper.userData.toolKind = "physicalDamagePieceColliderHelper";
  const center = bounds.getCenter(new THREE.Vector3());
  prop.mesh.worldToLocal(center);
  helper.position.copy(center);
  helper.renderOrder = 80;
  prop.mesh.add(helper);
  prop.colliderHelper = helper;
  return helper;
}

function syncDamagePropColliderHelpers() {
  const visible = editMode === "physicalDamage" && Boolean(physicalDamageViewCollidersInput?.checked);
  damageProps.forEach((prop) => {
    const helper = ensureDamagePropColliderHelper(prop);
    if (helper) helper.visible = visible;
  });
}

function disposeDamageSession() {
  damageAimActive = false;
  damagePointerWorld = null;
  damagePointerOverBot = false;
  pendingDamageTint = null;
  restoreDamageGeometrySnapshot();
  clearDamagePreviewMeshes();
  clearDamageTintMarker();
  damageProps.forEach((prop) => prop.mesh?.parent?.remove(prop.mesh));
  damageProps = [];
  damageEffects.forEach((effect) => effect.parent?.remove(effect));
  damageEffects = [];
  damageArena = null;
  damageFighter = null;
  canvas.classList.remove("damage-aiming", "damage-aiming-over-bot");
  updateBreakInfoButton();
}

function captureDamageGeometrySnapshot() {
  if (!botGroup || damageGeometrySnapshot) return;
  const entries = [];
  botGroup.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position) return;
    if (child.userData?.toolKind || child.userData?.part || child.userData?.colliderHelper) return;
    if (child.userData?.physicalDamageCap || child.userData?.physicalDamageDetached) return;
    entries.push({ mesh: child, geometry: child.geometry });
  });
  damageGeometrySnapshot = entries;
  damageColliderSnapshot = clonePlain(colliderParts);
}

function restoreDamageGeometrySnapshot() {
  damageGeometrySnapshot?.forEach(({ mesh, geometry }) => {
    if (mesh?.parent && geometry) mesh.geometry = geometry;
  });
  botGroup?.traverse((child) => {
    if (!child.userData?.physicalDamageCap && !child.userData?.physicalDamageDetached) return;
    child.parent?.remove(child);
    child.geometry?.dispose?.();
  });
  if (damageColliderSnapshot) {
    colliderParts = clonePlain(damageColliderSnapshot);
    if (damageFighter) {
      damageFighter.colliderParts = clonePlain(damageColliderSnapshot);
      damageFighter.rb.userData.physicsParts = clonePlain(damageColliderSnapshot);
      if (damageFighter.physics) damageFighter.physics.parts = clonePlain(damageColliderSnapshot);
    }
    rebuildColliderRoot();
  }
  damageGeometrySnapshot = null;
  damageColliderSnapshot = null;
  if (damageFighter) {
    damageFighter.physicalDamagePrimedBreaks = [];
    damageFighter.physicalDamagePrimedAt = [];
    damageFighter.physicalDamageBrokenAt = [];
    damageFighter.physicalDamagePieces = 0;
    damageFighter.physicalDamageLastResult = null;
  }
}

function clearDamageTintMarker() {
  if (!damageTintMarker) return;
  damageTintMarker.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material?.dispose?.());
    else child.material?.dispose?.();
  });
  damageTintMarker.parent?.remove(damageTintMarker);
  damageTintMarker = null;
}

function disposeDamagePreviewMesh(candidate) {
  const mesh = candidate?.previewMesh;
  if (candidate) damagePreviewQueue.delete(candidate);
  if (!mesh) return;
  damageCandidatePreviewMeshes.delete(mesh);
  mesh.geometry?.dispose?.();
  if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material?.dispose?.());
  else mesh.material?.dispose?.();
  mesh.parent?.remove(mesh);
  candidate.previewMesh = null;
}

function clearDamagePreviewMeshes() {
  damageFighter?.physicalDamagePrimedBreaks?.forEach(disposeDamagePreviewMesh);
  damageCandidatePreviewMeshes.forEach((mesh) => {
    mesh.geometry?.dispose?.();
    if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material?.dispose?.());
    else mesh.material?.dispose?.();
    mesh.parent?.remove(mesh);
  });
  damageCandidatePreviewMeshes.clear();
  damagePreviewQueue.clear();
}

function damagePreviewMeshes() {
  const meshes = [];
  botGroup?.traverse((child) => {
    if (!child.isMesh || child.visible === false || !child.geometry?.attributes?.position) return;
    if (child.userData?.toolKind || child.userData?.part || child.userData?.colliderHelper) return;
    if (child.userData?.physicalDamageCap || child.userData?.physicalDamageDetached) return;
    meshes.push(child);
  });
  return meshes;
}

function bestDamagePreviewMesh(worldPoint) {
  const meshes = damagePreviewMeshes();
  const local = new THREE.Vector3();
  const bounds = new THREE.Box3();
  let best = null;
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

function damageBreakEdgeAlpha(point, localPoint, localNormal, radius, falloff, band) {
  const offset = point.clone().sub(localPoint);
  const distance = offset.length();
  const directional = distance > 0.00001 ? Math.max(0, offset.multiplyScalar(1 / distance).dot(localNormal)) : 0;
  const limit = radius * (1 + directional * falloff);
  const t = THREE.MathUtils.clamp(1 - Math.max(0, limit - distance) / Math.max(0.001, band), 0, 1);
  return t * t * (3 - 2 * t);
}

function makeDamageBreakEdgeMaterial(opacity = 0.54) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    side: THREE.DoubleSide,
    uniforms: { opacity: { value: opacity } },
    vertexShader: `
      attribute float edgeAlpha;
      varying float vEdgeAlpha;
      void main() {
        vEdgeAlpha = edgeAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float opacity;
      varying float vEdgeAlpha;
      void main() {
        gl_FragColor = vec4(0.006, 0.005, 0.004, vEdgeAlpha * opacity);
      }
    `,
  });
}

function damagePreviewHash(value) {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function dentedDamagePreviewNormal(baseNormal, point, triangleIndex) {
  const normal = baseNormal?.clone?.() || new THREE.Vector3(0, 1, 0);
  if (normal.lengthSq() < 0.000001) normal.set(0, 1, 0);
  normal.normalize();
  const tangentSeed = Math.abs(normal.y) < 0.82 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const tangent = tangentSeed.cross(normal).normalize();
  const bitangent = normal.clone().cross(tangent).normalize();
  const scale = 7.5;
  const n1 = damagePreviewHash(point.x * scale + point.z * 3.1 + triangleIndex * 0.73) - 0.5;
  const n2 = damagePreviewHash(point.y * scale - point.x * 2.7 + triangleIndex * 1.19) - 0.5;
  return normal
    .addScaledVector(tangent, n1 * 0.72)
    .addScaledVector(bitangent, n2 * 0.72)
    .normalize();
}

function makeDamageCandidateMaterial(opacity = 0.5) {
  const material = makeDamageBreakEdgeMaterial(opacity);
  material.uniforms.color = { value: new THREE.Color(0x020101) };
  material.fragmentShader = `
    uniform float opacity;
    uniform vec3 color;
    varying float vEdgeAlpha;
    void main() {
      float alpha = max(0.18, vEdgeAlpha) * opacity;
      gl_FragColor = vec4(color, alpha);
    }
  `;
  material.needsUpdate = true;
  return material;
}

function triangleCentroidAttribute(position, tri, target = new THREE.Vector3()) {
  return target.set(
    (position.getX(tri[0]) + position.getX(tri[1]) + position.getX(tri[2])) / 3,
    (position.getY(tri[0]) + position.getY(tri[1]) + position.getY(tri[2])) / 3,
    (position.getZ(tri[0]) + position.getZ(tri[1]) + position.getZ(tri[2])) / 3,
  );
}

function buildDamageCandidatePreviewMesh(candidate, options = physicalDamageTweakerOptions()) {
  const mesh = candidate?.mesh;
  const geometry = mesh?.geometry;
  const position = geometry?.attributes?.position;
  if (!mesh?.parent || !position || candidate.committed || candidate.status === "failed") return null;
  if (mesh.geometry !== candidate.sourceGeometry) return null;
  const index = geometry.index;
  const sourceNormal = geometry.attributes.normal;
  const sourceUv = geometry.attributes.uv || geometry.attributes.uv0;
  const triangleCount = index ? index.count / 3 : position.count / 3;
  const radius = Math.max(0.08, Number(candidate.breakRadius) || Number(options.breakRadius) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.breakRadius);
  const falloff = Math.max(0.05, Number(options.radialFalloff) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.radialFalloff);
  const localNormal = candidate.lastHitNormal?.clone?.().transformDirection(mesh.matrixWorld.clone().invert()).normalize() || new THREE.Vector3(0, 1, 0);
  const localPoint = candidate.localPoint?.clone?.() || new THREE.Vector3();
  const selected = [];
  const maxPreviewTriangles = Math.min(12000, Math.max(1200, Math.round(triangleCount * 0.35)));
  const tri = [0, 0, 0];
  const centroid = new THREE.Vector3();
  for (let i = 0; i < triangleCount; i += 1) {
    for (let j = 0; j < 3; j += 1) tri[j] = index ? index.getX(i * 3 + j) : i * 3 + j;
    triangleCentroidAttribute(position, tri, centroid);
    const offset = centroid.clone().sub(localPoint);
    const distance = offset.length();
    const directional = distance > 0.00001 ? Math.max(0, offset.multiplyScalar(1 / distance).dot(localNormal)) : 0;
    if (distance <= radius * (1 + directional * falloff)) {
      selected.push(i);
      if (selected.length >= maxPreviewTriangles) break;
    }
  }
  if (!selected.length || selected.length >= triangleCount - 6) return null;

  const positions = [];
  const normals = [];
  const uvs = [];
  const edgeAlphas = [];
  const edgeBand = Math.max(0.035, radius * 0.22);
  selected.forEach((triangleIndex) => {
    for (let j = 0; j < 3; j += 1) {
      const vertexIndex = index ? index.getX(triangleIndex * 3 + j) : triangleIndex * 3 + j;
      const point = new THREE.Vector3(position.getX(vertexIndex), position.getY(vertexIndex), position.getZ(vertexIndex));
      positions.push(point.x, point.y, point.z);
      if (sourceNormal) {
        const dented = dentedDamagePreviewNormal(
          new THREE.Vector3(sourceNormal.getX(vertexIndex), sourceNormal.getY(vertexIndex), sourceNormal.getZ(vertexIndex)),
          point,
          triangleIndex,
        );
        normals.push(dented.x, dented.y, dented.z);
      }
      if (sourceUv) uvs.push(sourceUv.getX(vertexIndex), sourceUv.getY(vertexIndex));
      edgeAlphas.push(damageBreakEdgeAlpha(point, localPoint, localNormal, radius, falloff, edgeBand));
    }
  });
  const previewGeometry = new THREE.BufferGeometry();
  previewGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  previewGeometry.setAttribute("edgeAlpha", new THREE.Float32BufferAttribute(edgeAlphas, 1));
  if (normals.length) previewGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  else previewGeometry.computeVertexNormals();
  if (uvs.length) previewGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  previewGeometry.computeBoundingBox();
  previewGeometry.computeBoundingSphere();
  const preview = new THREE.Mesh(previewGeometry, makeDamageCandidateMaterial(0.5));
  preview.name = "physicalDamageFutureBreakPreview";
  preview.userData.physicalDamagePreview = true;
  preview.userData.candidate = candidate;
  preview.userData.localPoint = localPoint.toArray();
  preview.renderOrder = 48;
  preview.matrix.copy(mesh.matrix);
  preview.matrix.decompose(preview.position, preview.quaternion, preview.scale);
  mesh.parent.add(preview);
  candidate.previewMesh = preview;
  damageCandidatePreviewMeshes.add(preview);
  return preview;
}

function queueDamageCandidatePreviewBuild(candidate) {
  if (!candidate || candidate.committed || candidate.status === "failed") return;
  const previewPoint = candidate.previewMesh?.userData?.localPoint;
  if (candidate.previewMesh && previewPoint) {
    const dx = previewPoint[0] - candidate.localPoint.x;
    const dy = previewPoint[1] - candidate.localPoint.y;
    const dz = previewPoint[2] - candidate.localPoint.z;
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 0.08) disposeDamagePreviewMesh(candidate);
  }
  if (candidate.previewMesh) return;
  damagePreviewQueue.add(candidate);
  if (damagePreviewQueueScheduled) return;
  damagePreviewQueueScheduled = true;
  const run = (deadline = null) => {
    damagePreviewQueueScheduled = false;
    const start = performance.now();
    while (damagePreviewQueue.size) {
      const candidateToBuild = damagePreviewQueue.values().next().value;
      damagePreviewQueue.delete(candidateToBuild);
      buildDamageCandidatePreviewMesh(candidateToBuild);
      const timeRemaining = typeof deadline?.timeRemaining === "function" ? deadline.timeRemaining() : 0;
      if (performance.now() - start > 4 || (deadline && timeRemaining < 2)) break;
    }
    if (damagePreviewQueue.size) {
      damagePreviewQueueScheduled = true;
      if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 120 });
      else window.setTimeout(run, 32);
    }
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 120 });
  else window.setTimeout(run, 32);
}

function updateDamageCandidatePreviews() {
  if (!damageFighter || editMode !== "physicalDamage") {
    clearDamagePreviewMeshes();
    return;
  }
  const now = performance.now() * 0.001;
  (damageFighter.physicalDamagePrimedBreaks || []).forEach((candidate) => {
    if (candidate.committed || candidate.status === "failed" || candidate.mesh?.geometry !== candidate.sourceGeometry) {
      disposeDamagePreviewMesh(candidate);
      return;
    }
    if (!candidate.previewMesh) queueDamageCandidatePreviewBuild(candidate);
    const preview = candidate.previewMesh;
    if (!preview?.material) return;
    const waitingToRelease = candidate.releaseWhenReady
      && candidate.hits >= candidate.requiredHits
      && candidate.status !== "ready"
      && candidate.status !== "deferred-interior";
    const flash = Math.sin(now * 9.5) * 0.5 + 0.5;
    const opacity = waitingToRelease
      ? 0.28 + flash * 0.3
      : 0.32 + (Math.sin(now * 2.6 + (candidate.createdAt || 0) * 0.001) * 0.5 + 0.5) * 0.08;
    if (preview.material.uniforms?.color) {
      preview.material.uniforms.color.value.setHex(waitingToRelease ? 0xff170b : 0x020101);
    }
    if (preview.material.uniforms?.opacity) preview.material.uniforms.opacity.value = opacity;
    else preview.material.opacity = opacity;
    preview.visible = true;
  });
}

function createDamageSelectionPreview(point, normal, options) {
  // This is for editor feedback only. It walks model triangles, so keep it out of pointer,
  // physics, and animation hot paths unless it is behind an idle/deferred queue.
  const target = bestDamagePreviewMesh(point);
  const geometry = target?.mesh?.geometry;
  const position = geometry?.attributes?.position;
  if (!target || !position) return null;
  const index = geometry.index;
  const sourceNormal = geometry.attributes.normal;
  const sourceUv = geometry.attributes.uv || geometry.attributes.uv0;
  const localNormal = (normal?.clone?.() || new THREE.Vector3(0, 1, 0))
    .transformDirection(target.mesh.matrixWorld.clone().invert())
    .normalize();
  const radius = Math.max(0.08, Number(options?.breakRadius) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.breakRadius);
  const falloff = Math.max(0.05, Number(options?.radialFalloff) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.radialFalloff);
  const minPieceTriangles = Math.max(1, Number(options?.minPieceTriangles) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.minPieceTriangles);
  const triangleCount = index ? index.count / 3 : position.count / 3;
  const maxPieceTriangles = Math.max(minPieceTriangles, Number(options?.maxPieceTriangles) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.maxPieceTriangles);
  const tri = [0, 0, 0];
  const centroid = new THREE.Vector3();
  let selected = [];
  let previewRadius = radius;
  for (let attempt = 0; attempt < 7; attempt += 1) {
    selected = [];
    for (let i = 0; i < triangleCount; i += 1) {
      for (let j = 0; j < 3; j += 1) tri[j] = index ? index.getX(i * 3 + j) : i * 3 + j;
      centroid.set(
        (position.getX(tri[0]) + position.getX(tri[1]) + position.getX(tri[2])) / 3,
        (position.getY(tri[0]) + position.getY(tri[1]) + position.getY(tri[2])) / 3,
        (position.getZ(tri[0]) + position.getZ(tri[1]) + position.getZ(tri[2])) / 3,
      );
      const offset = centroid.clone().sub(target.localPoint);
      const distance = offset.length();
      const directional = distance > 0.00001 ? Math.max(0, offset.multiplyScalar(1 / distance).dot(localNormal)) : 0;
      if (distance <= previewRadius * (1 + directional * falloff)) selected.push(i);
    }
    if (selected.length <= maxPieceTriangles || previewRadius <= 0.045) break;
    previewRadius *= 0.68;
  }
  if (selected.length < minPieceTriangles || selected.length >= triangleCount - 6) return null;

  const positions = [];
  const normals = [];
  const uvs = [];
  const edgeAlphas = [];
  const edgeBand = Math.max(0.035, previewRadius * 0.22);
  selected.forEach((triangleIndex) => {
    for (let j = 0; j < 3; j += 1) {
      const vertexIndex = index ? index.getX(triangleIndex * 3 + j) : triangleIndex * 3 + j;
      const vertexPoint = new THREE.Vector3(position.getX(vertexIndex), position.getY(vertexIndex), position.getZ(vertexIndex));
      positions.push(vertexPoint.x, vertexPoint.y, vertexPoint.z);
      if (sourceNormal) normals.push(sourceNormal.getX(vertexIndex), sourceNormal.getY(vertexIndex), sourceNormal.getZ(vertexIndex));
      if (sourceUv) uvs.push(sourceUv.getX(vertexIndex), sourceUv.getY(vertexIndex));
      edgeAlphas.push(damageBreakEdgeAlpha(vertexPoint, target.localPoint, localNormal, previewRadius, falloff, edgeBand));
    }
  });
  const previewGeometry = new THREE.BufferGeometry();
  previewGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  previewGeometry.setAttribute("edgeAlpha", new THREE.Float32BufferAttribute(edgeAlphas, 1));
  if (normals.length) previewGeometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  else previewGeometry.computeVertexNormals();
  if (uvs.length) previewGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  previewGeometry.computeBoundingBox();
  previewGeometry.computeBoundingSphere();
  const material = makeDamageBreakEdgeMaterial(0.54);
  const preview = new THREE.Mesh(previewGeometry, material);
  preview.name = "physicalDamagePreviewSelection";
  preview.renderOrder = 47;
  preview.matrix.copy(target.mesh.matrix);
  preview.matrix.decompose(preview.position, preview.quaternion, preview.scale);
  target.mesh.parent?.add(preview);
  return preview;
}

function createDamageTintMarker(point, normal, options) {
  clearDamageTintMarker();
  const preview = createDamageSelectionPreview(point, normal, options);
  if (preview) {
    damageTintMarker = preview;
    return preview;
  }
  const radius = Math.max(0.12, Number(options?.breakRadius) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.breakRadius);
  const markerNormal = normal?.lengthSq?.() > 0.0001 ? normal.clone().normalize() : new THREE.Vector3(0, 1, 0);
  const marker = new THREE.Group();
  marker.name = "physicalDamageCalculatingTint";
  marker.userData.createdAt = performance.now();
  marker.position.copy(point).add(markerNormal.clone().multiplyScalar(0.018));
  marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), markerNormal);

  const tint = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 48),
    new THREE.MeshBasicMaterial({
      color: 0x050403,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  tint.renderOrder = 45;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.92, radius, 48),
    new THREE.MeshBasicMaterial({
      color: 0x050403,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  ring.position.z = 0.002;
  ring.renderOrder = 46;
  marker.add(tint, ring);
  scene.add(marker);
  damageTintMarker = marker;
  return marker;
}

function updateDamageTintMarker() {
  updateDamageCandidatePreviews();
  if (!damageTintMarker || !damageFighter) return;
  const status = damageFighter.physicalDamageLastResult?.status;
  if (status === "prepare-failed" || status === "max-pieces" || status === "below-threshold" || status === "no-target-mesh") {
    pendingDamageTint = null;
    clearDamageTintMarker();
  }
}

function ensurePendingDamageTintVisible() {
  if (damageTintMarker || !damageFighter) return;
  const status = damageFighter.physicalDamageLastResult?.status;
  if (!pendingDamageTint && (status === "queued" || status === "calculating" || status === "ready" || status === "committing")) {
    const primed = damageFighter.physicalDamagePrimedAt?.at?.(-1);
    if (primed?.point) {
      pendingDamageTint = {
        point: primed.point.clone ? primed.point.clone() : new THREE.Vector3(primed.point.x || 0, primed.point.y || 0, primed.point.z || 0),
        normal: new THREE.Vector3(0, 1, 0),
        options: { breakRadius: primed.breakRadius || physicalDamageTweakerOptions().breakRadius },
      };
    }
  }
  if (!pendingDamageTint) return;
  if (status === "queued" || status === "calculating" || status === "ready" || status === "committing") {
    createDamageTintMarker(pendingDamageTint.point, pendingDamageTint.normal, pendingDamageTint.options);
  }
}

function ensureDamageSession() {
  if (!botGroup || editMode !== "physicalDamage") return false;
  if (!rapierReady) {
    setPhysicalDamageStatus("Physics loading");
    return false;
  }
  if (damageArena && damageFighter) return true;
  captureDamageGeometrySnapshot();
  createPhysicsWorldShell();
  damageArena = { fighters: [], props: [], world: physicsWorld };
  damageFighter = createPhysicsFighterFromCurrentPose({
    position: botGroup.position.toArray(),
    quaternion: botGroup.quaternion.toArray(),
    scale: botGroup.scale.toArray(),
    velocity: { x: 0, y: 0, z: 0 },
    weaponOn: Boolean(physicsWeaponOnInput?.checked),
    recentlyHit: false,
    selfRightingGrace: false,
  });
  damageArena.fighters.push(damageFighter);
  setPhysicalDamageStatus("Physical damage ready", "Click Cause Damage, then click the bot.");
  updateBreakInfoButton();
  return true;
}

function tryApplyUrlBreak() {
  if (pendingUrlBreakApplied || editMode !== "physicalDamage" || !botGroup || !rapierReady) return;
  const payload = parseUrlBreak();
  if (!payload) {
    pendingUrlBreakApplied = true;
    return;
  }
  applyUrlBreakControls(payload);
  applyUrlBreakPose(payload);
  if (!ensureDamageSession()) return;
  applyUrlBreakPose(payload);
  const options = physicalDamageTweakerOptions();
  pendingUrlBreakApplied = true;
  suppressBreakUrlUpdate = true;
  try {
    payload.hits.forEach((hit) => {
      const rawDamage = Number.isFinite(Number(hit.rawDamage))
        ? Number(hit.rawDamage)
        : Math.max(options.threshold * options.resilience, 72);
      applyPhysicalDamageAtPoint({
        point: new THREE.Vector3(...hit.point.map(Number)),
        normal: new THREE.Vector3(...hit.normal.map(Number)),
        rawDamage,
        options,
        updateUrl: false,
      });
    });
  } finally {
    suppressBreakUrlUpdate = false;
  }
  setStatus(`Replayed ${payload.hits.length} URL break hit${payload.hits.length === 1 ? "" : "s"}`);
}

function syncDamagePropVisuals() {
  damageProps.forEach((prop) => {
    const p = prop.rb?.translation?.();
    const r = prop.rb?.rotation?.();
    if (!p || !r || transform.object === prop.mesh) return;
    prop.mesh.position.set(p.x, p.y, p.z);
    prop.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  });
}

function syncDamagePropBodyFromMesh(object) {
  const prop = object?.userData?.damageProp;
  if (!prop?.rb) return;
  prop.rb.setTranslation({ x: object.position.x, y: object.position.y, z: object.position.z }, true);
  prop.rb.setRotation({ x: object.quaternion.x, y: object.quaternion.y, z: object.quaternion.z, w: object.quaternion.w }, true);
  prop.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
  prop.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

function updatePhysicalDamageStatusBox() {
  if (!damageFighter || !physicalDamageStatus) return;
  updateDamageCandidatePreviews();
  const last = damageFighter.physicalDamageLastResult;
  const adjustment = damageFighter.physicalDamageLastColliderAdjustment;
  const sideEffects = [
    "Left drive: unchanged",
    "Right drive: unchanged",
    "Weapon: unchanged",
  ].join("\n");
  const lines = [
    `Pieces: ${damageFighter.physicalDamagePieces || 0}`,
    `Last result: ${last?.status || "ready"}`,
  ];
  if (last?.reason) lines.push(`Reason: ${last.reason}`);
  if (last?.details) {
    const { selectedTriangles, minPieceTriangles, triangleCount } = last.details;
    const detail = [
      Number.isFinite(selectedTriangles) ? `selected ${selectedTriangles}` : null,
      Number.isFinite(minPieceTriangles) ? `min ${minPieceTriangles}` : null,
      Number.isFinite(triangleCount) ? `mesh ${triangleCount}` : null,
    ].filter(Boolean).join(", ");
    if (detail) lines.push(`Details: ${detail}`);
  }
  if (last?.hits) lines.push(`Hits: ${last.hits}/${last.requiredHits || "?"}`);
  if (last?.triangles) lines.push(`Triangles: ${last.triangles}`);
  if (adjustment) lines.push(`Collider update: ${adjustment.changedCount} changed, ${adjustment.beforeCount} -> ${adjustment.afterCount}`);
  lines.push(sideEffects);
  physicalDamageStatus.textContent = lines.join("\n");
  updateBreakInfoButton();
}

function moveCommittedDamagePiece(prop, candidate) {
  if (!prop?.mesh || !prop?.rb || !candidate?.worldPoint) return;
  const center = new THREE.Box3().setFromObject(botGroup).getCenter(new THREE.Vector3());
  const dir = candidate.worldPoint.clone().sub(center);
  if (dir.lengthSq() < 0.0001) dir.set(1, 0.25, 0);
  dir.normalize();
  const p = prop.rb.translation();
  const next = new THREE.Vector3(p.x, p.y, p.z).add(dir.multiplyScalar(0.38));
  prop.rb.setTranslation({ x: next.x, y: next.y, z: next.z }, true);
  prop.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
  prop.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
  prop.mesh.position.copy(next);
}

function createExplosionEffect(point) {
  const root = new THREE.Group();
  root.position.copy(point);
  root.userData.createdAt = performance.now();
  const flash = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 18, 12),
    new THREE.MeshBasicMaterial({ color: 0xffcf66, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  root.add(flash);
  for (let i = 0; i < 18; i += 1) {
    const spark = new THREE.Mesh(
      new THREE.SphereGeometry(0.012 + Math.random() * 0.014, 8, 6),
      new THREE.MeshBasicMaterial({ color: i % 3 === 0 ? 0xfff1a8 : 0xff6b24, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    const velocity = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize().multiplyScalar(0.35 + Math.random() * 0.65);
    spark.userData.velocity = velocity;
    root.add(spark);
  }
  scene.add(root);
  damageEffects.push(root);
}

function updateDamageEffects(dt) {
  for (let i = damageEffects.length - 1; i >= 0; i -= 1) {
    const effect = damageEffects[i];
    const age = ((performance.now() - (effect.userData.createdAt || 0)) / 1000);
    const life = effect.userData.aimFlame ? 0.22 : 0.58;
    const t = THREE.MathUtils.clamp(age / life, 0, 1);
    effect.children.forEach((child) => {
      child.position.addScaledVector(child.userData.velocity || new THREE.Vector3(), dt);
      if (child.material) child.material.opacity = Math.max(0, 1 - t);
      child.scale.setScalar(1 + t * (effect.userData.aimFlame ? 1.2 : 3.2));
    });
    if (t >= 1) {
      effect.parent?.remove(effect);
      damageEffects.splice(i, 1);
    }
  }
}

function spawnDamageCursorFlame() {
  if (!damageAimActive || !damagePointerOverBot || !damagePointerWorld) return;
  const root = new THREE.Group();
  root.position.copy(damagePointerWorld);
  root.userData.createdAt = performance.now();
  root.userData.aimFlame = true;
  for (let i = 0; i < 4; i += 1) {
    const ember = new THREE.Mesh(
      new THREE.SphereGeometry(0.015 + Math.random() * 0.018, 8, 6),
      new THREE.MeshBasicMaterial({ color: i % 2 ? 0xff7a1c : 0xffd25a, transparent: true, opacity: 0.75, depthWrite: false }),
    );
    ember.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 0.18, 0.1 + Math.random() * 0.16, (Math.random() - 0.5) * 0.18);
    root.add(ember);
  }
  scene.add(root);
  damageEffects.push(root);
}

function botDamageIntersections(event) {
  if (!botGroup) return [];
  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);
  const meshes = [];
  botGroup.traverse((child) => {
    if (child.isMesh && child.visible !== false && !child.userData?.toolKind && !child.userData?.part && !child.userData?.colliderHelper) meshes.push(child);
  });
  return raycaster.intersectObjects(meshes, false);
}

function startDamageAim() {
  if (!ensureDamageSession()) return;
  damageAimActive = true;
  canvas.classList.add("damage-aiming");
  transform.detach();
  setPhysicalDamageStatus("Choose damage point", "Click a visible part of the bot.");
}

function stopDamageAim(detail = "Click Cause Damage to aim another hit.") {
  damageAimActive = false;
  damagePointerOverBot = false;
  damagePointerWorld = null;
  canvas.classList.remove("damage-aiming", "damage-aiming-over-bot");
  setPhysicalDamageStatus("Physical damage ready", detail);
}

function damageHitViewerPart(object) {
  for (let node = object; node && node !== botGroup.parent; node = node.parent) {
    if (node.userData?.viewerPart) return node.userData.viewerPart;
    if (node === botGroup) break;
  }
  return null;
}

function damageHitTargetMesh(object) {
  for (let node = object; node && node !== botGroup.parent; node = node.parent) {
    if (node.isMesh && node.geometry?.attributes?.position && !node.userData?.toolKind && !node.userData?.part && !node.userData?.colliderHelper) {
      return node;
    }
    if (node === botGroup) break;
  }
  return object?.isMesh ? object : null;
}

function applyPhysicalDamageAtPoint({ point, normal, rawDamage, options, updateUrl = true, damageZone = null, targetMesh = null } = {}) {
  if (!ensureDamageSession() || !point || !normal || !options) return;
  const worldPoint = point.clone ? point.clone() : new THREE.Vector3(point.x || 0, point.y || 0, point.z || 0);
  const worldNormal = normal.clone ? normal.clone() : new THREE.Vector3(normal.x || 0, normal.y || 0, normal.z || 0);
  if (worldNormal.lengthSq() < 0.0001) worldNormal.set(0, 1, 0);
  worldNormal.normalize();
  pendingDamageTint = {
    point: worldPoint.clone(),
    normal: worldNormal.clone(),
    options: { breakRadius: options.breakRadius },
  };
  createExplosionEffect(worldPoint);
  clearDamageTintMarker();
  if (updateUrl) updateUrlBreak(breakUrlPayload({ point: worldPoint, normal: worldNormal, rawDamage, options }));
  applyPhysicalDamageBreak({
    fighter: damageFighter,
    worldPoint,
    worldNormal,
    rawDamage,
    options,
    arena: damageArena,
    RAPIER,
    createArenaProp: createTweakerArenaProp,
    interiorMaterial: damageInteriorMaterial,
    originalMaterialFallback: damageFallbackMaterial,
    onStatusChanged: ({ candidate, status } = {}) => {
      if (status === "prepare-failed" || status === "superseded" || status === "committed-linked") disposeDamagePreviewMesh(candidate);
      else queueDamageCandidatePreviewBuild(candidate);
      updateDamageCandidatePreviews();
      updatePhysicalDamageStatusBox();
      updateBreakInfoButton();
    },
    onCommitted: ({ fighter, candidate, prop, options: committedOptions }) => {
      pendingDamageTint = null;
      disposeDamagePreviewMesh(candidate);
      clearDamageTintMarker();
      moveCommittedDamagePiece(prop, candidate);
      addColliderSolidFillForTweakerBreak({
        fighter,
        candidate,
        prop,
        radius: Math.max(committedOptions.breakRadius || 0.24, 0.18) * 1.25,
      });
      ensureDamagePropColliderHelper(prop);
      syncDamagePropColliderHelpers();
      adjustDamageFighterCollidersForPhysicalBreak({
        fighter,
        candidate,
        worldPoint: candidate.worldPoint,
        worldNormal: candidate.lastHitNormal,
        radius: Math.max(committedOptions.breakRadius || 0.24, 0.18) * 1.25,
      });
      fighter.physicalDamageLastResult = {
        status: "committed",
        hits: candidate.hits,
        requiredHits: candidate.requiredHits,
        triangles: candidate.split?.triangleCount || 0,
      };
      updatePhysicalDamageStatusBox();
      updateBreakInfoButton();
    },
    allowInteriorBreak: damageZone === "weapon",
    damageZone,
    targetMesh,
  });
  if (damageAimActive) setPhysicalDamageStatus("Damage hit applied", "Click another bot part, or click the background to stop.");
  updatePhysicalDamageStatusBox();
  updateBreakInfoButton();
}

function applyDamageAtHit(hit) {
  if (!hit?.point) return;
  const options = physicalDamageTweakerOptions();
  const rawDamage = damageNumber(tweakerDamageAmountInput, Math.max(options.threshold * options.resilience, 72));
  const viewerPart = damageHitViewerPart(hit.object);
  const damageZone = viewerPart === "weapon" ? "weapon" : null;
  const normal = hit.face?.normal
    ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize()
    : hit.point.clone().sub(botGroup.position).normalize();
  applyPhysicalDamageAtPoint({
    point: hit.point,
    normal,
    rawDamage,
    options,
    updateUrl: true,
    damageZone,
    targetMesh: damageZone === "weapon" ? damageHitTargetMesh(hit.object) : null,
  });
}

function startPhysicsTest() {
  if (!botGroup || physicsTestRunning) return;
  if (!rapierReady) {
    setStatus("Physics loading");
    return;
  }
  physicsTestStartPose = capturePhysicsTestPose();
  createPhysicsWorldShell();
  physicsFighter = createPhysicsFighterFromCurrentPose(physicsTestStartPose);
  physicsTestRunning = true;
  transform.detach();
  if (runPhysicsTestButton) runPhysicsTestButton.textContent = "Stop Test";
  setStatus("Physics test running");
}

function stopPhysicsTest() {
  if (!physicsTestRunning && !physicsWorld) return;
  physicsTestRunning = false;
  disposePhysicsWorld();
  applyPhysicsTestPose(physicsTestStartPose);
  setPhysicsTestWeaponPose(Boolean(physicsTestStartPose?.weaponOn));
  physicsTestStartPose = null;
  if (runPhysicsTestButton) runPhysicsTestButton.textContent = "Run Test";
  if (selectedObject?.userData.toolKind === "physicsTestBot") attachTransform(botGroup, transformModeForSelection());
  setStatus("Physics test stopped");
}

function togglePhysicsTest() {
  if (physicsTestRunning) stopPhysicsTest();
  else startPhysicsTest();
}

function runPhysicsTestArenaStep(stepDt) {
  const weaponOn = Boolean(physicsTestStartPose?.weaponOn);
  const input = { leftDrive: 0, rightDrive: 0, throttle: 0, turn: 0, weapon: weaponOn };
  const arena = { fighters: [physicsFighter], props: [], world: physicsWorld };
  stepPhysicsArena({
    physics,
    world: physicsWorld,
    arena,
    fighters: [physicsFighter],
    inputs: [input],
    dt: stepDt,
    updateWeapon: updatePhysicsTestWeapon,
    stabilizeFighter: stabilizeSelfRightingFighter,
    syncWeaponColliderBindings: syncPhysicsTestWeaponColliderBindings,
    weaponActiveForImpact: () => weaponOn,
  });
}

function updatePhysicsTest(dt) {
  if (!physicsTestRunning || !physicsWorld || !physicsFighter) return;
  const clampedDt = Math.min(dt, FIXED_PHYSICS_DT * MAX_PHYSICS_SUBSTEPS);
  const substeps = Math.max(1, Math.min(MAX_PHYSICS_SUBSTEPS, Math.ceil(clampedDt / FIXED_PHYSICS_DT)));
  const stepDt = clampedDt / substeps;
  for (let i = 0; i < substeps; i += 1) {
    runPhysicsTestArenaStep(stepDt);
  }
  syncPhysicsTestVisualFromBody();
}

function positionBotForPhysicsTest({ force = false } = {}) {
  if (!botGroup || physicsTestRunning) return;
  if (!force && botGroup.userData.physicsTestPositioned) return;
  applyScaleForCurrentMode();
  botGroup.quaternion.identity();
  botGroup.updateMatrixWorld(true);
  const frame = createPhysicsTestFrame(physicsTestVisualScale());
  const bodyPosition = new THREE.Vector3(0, Math.max(PHYSICS_TEST_DROP_BODY_Y, frame.groundedBodyY + 0.5), 0);
  botGroup.position.copy(bodyPositionToVisualPosition({ frame, group: botGroup }, bodyPosition));
  botGroup.userData.physicsTestPositioned = true;
  frameCameraToBot();
}

function physicsTestColliderRoles() {
  const indexedParts = colliderParts.map((part, index) => ({ part, index }));
  return {
    solidPhysics: indexedParts
      .filter(({ part }) => part.part !== "driveContact")
      .map(({ part, index }) => ({ index, part: part.part || "body", type: part.type || "box" })),
    groundProbe: indexedParts
      .filter(({ part }) => part.part !== "driveContact")
      .map(({ part, index }) => ({ index, part: part.part || "body", type: part.type || "box" })),
    driveContact: indexedParts
      .filter(({ part }) => part.part === "driveContact")
      .map(({ part, index }) => ({ index, side: part.side || null, type: part.type || "box" })),
  };
}

function cameraSnapshot() {
  camera.updateMatrixWorld(true);
  return {
    position: camera.position.toArray(),
    rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z],
    quaternion: camera.quaternion.toArray(),
    fov: camera.fov,
    near: camera.near,
    far: camera.far,
    zoom: camera.zoom,
    aspect: camera.aspect,
    orbitTarget: orbit.target.toArray(),
    orbitDistance: camera.position.distanceTo(orbit.target),
  };
}

function currentPhysicsRuntimeSnapshot() {
  const rb = physicsFighter?.rb;
  const position = rb?.translation?.();
  const rotation = rb?.rotation?.();
  const linvel = rb?.linvel?.();
  const angvel = rb?.angvel?.();
  const bounds = botGroup ? new THREE.Box3().setFromObject(botGroup) : null;
  return {
    running: physicsTestRunning,
    rigidBody: position ? {
      position: [position.x, position.y, position.z],
      quaternion: rotation ? [rotation.x, rotation.y, rotation.z, rotation.w] : null,
      linvel: linvel ? [linvel.x, linvel.y, linvel.z] : null,
      angvel: angvel ? [angvel.x, angvel.y, angvel.z] : null,
      mass: rb?.mass?.() ?? null,
    } : null,
    visual: botGroup ? {
      position: botGroup.position.toArray(),
      rotation: [botGroup.rotation.x, botGroup.rotation.y, botGroup.rotation.z],
      quaternion: botGroup.quaternion.toArray(),
      scale: botGroup.scale.toArray(),
      bounds: bounds ? { min: bounds.min.toArray(), max: bounds.max.toArray() } : null,
      floorGap: bounds ? bounds.min.y - ARENA_FLOOR_Y : null,
    } : null,
    floorAudit: window.__colliderTweakerDebug?.floorAudit?.() || null,
    physics: {
      groundedStableFor: physicsFighter?.physics?.groundedStableFor ?? null,
      lastStep: clonePlain(physicsFighter?.physics?.lastStep || null),
    },
  };
}

function plainVec3(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.slice(0, 3);
  return [
    Number(value.x || 0),
    Number(value.y || 0),
    Number(value.z || 0),
  ];
}

function plainQuat(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.slice(0, 4);
  return [
    Number(value.x || 0),
    Number(value.y || 0),
    Number(value.z || 0),
    Number(value.w ?? 1),
  ];
}

function rigidBodySnapshot(rb) {
  const position = rb?.translation?.();
  const rotation = rb?.rotation?.();
  const linvel = rb?.linvel?.();
  const angvel = rb?.angvel?.();
  return position ? {
    position: plainVec3(position),
    quaternion: plainQuat(rotation),
    linvel: plainVec3(linvel),
    angvel: plainVec3(angvel),
    mass: rb?.mass?.() ?? null,
    numColliders: rb?.numColliders?.() ?? null,
  } : null;
}

function objectSnapshot(object) {
  if (!object) return null;
  object.updateMatrixWorld?.(true);
  const bounds = new THREE.Box3().setFromObject(object);
  return {
    name: object.name || "",
    position: object.position?.toArray?.() || null,
    rotation: object.rotation ? [object.rotation.x, object.rotation.y, object.rotation.z] : null,
    quaternion: object.quaternion?.toArray?.() || null,
    scale: object.scale?.toArray?.() || null,
    bounds: Number.isFinite(bounds.min.x) ? { min: bounds.min.toArray(), max: bounds.max.toArray() } : null,
  };
}

function damageCandidateSnapshot(candidate) {
  if (!candidate) return null;
  return {
    status: candidate.status || null,
    damageZone: candidate.damageZone || null,
    hits: candidate.hits ?? null,
    requiredHits: candidate.requiredHits ?? null,
    damage: candidate.damage ?? null,
    breakRadius: candidate.breakRadius ?? null,
    primeMatchRadius: candidate.primeMatchRadius ?? null,
    localPoint: plainVec3(candidate.localPoint),
    worldPoint: plainVec3(candidate.worldPoint),
    lastHitNormal: plainVec3(candidate.lastHitNormal),
    triangles: candidate.split?.triangleCount || 0,
    releaseWhenReady: Boolean(candidate.releaseWhenReady),
    committed: Boolean(candidate.committed),
    failureReason: candidate.failureReason || null,
    failureDetails: candidate.failureDetails || null,
    meshName: candidate.mesh?.name || "",
  };
}

function damagePropSnapshot(prop, index) {
  return {
    index,
    kind: prop.kind || prop.rb?.userData?.kind || "prop",
    weightLbs: prop.weightLbs || null,
    boundedArenaDebris: Boolean(prop.boundedArenaDebris),
    colliderCount: prop.colliderCount || 0,
    colliderHandles: prop.colliderHandles?.length || 0,
    colliderHelper: Boolean(prop.colliderHelper),
    mesh: objectSnapshot(prop.mesh),
    rigidBody: rigidBodySnapshot(prop.rb),
  };
}

function physicalDamageBreakPayload(imageDataUrl = null) {
  const status = physicalDamageStatus?.textContent || "";
  const bounds = botGroup ? new THREE.Box3().setFromObject(botGroup) : null;
  return {
    kind: "battleBotPhysicalDamageBreakInfo",
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    fileNotes: [
      "Self-contained HTML report generated by collider-tweaker Physical Damage mode.",
      "The screenshot is embedded as a data URL and the full payload is embedded in script#break-info-data.",
      "payload.replayUrl can be opened in collider-tweaker.html to rerun the same break once on load.",
      "Use payload.statusText, payload.damage.lastResult, payload.damage.primedBreaks, payload.damage.brokenAt, payload.damage.props, and payload.colliderParts first when debugging break behavior.",
      "Coordinates are Three.js world/local coordinates unless a key explicitly says rigidBody or collider.",
    ],
    replayUrl: window.location.href,
    bot: {
      id: selectedBotId,
      name: bots.find((bot) => bot.id === selectedBotId)?.name || selectedBotId,
      spec: clonePlain(damageFighter?.spec || bots.find((bot) => bot.id === selectedBotId) || {}),
      visual: botGroup ? {
        position: botGroup.position.toArray(),
        rotation: [botGroup.rotation.x, botGroup.rotation.y, botGroup.rotation.z],
        quaternion: botGroup.quaternion.toArray(),
        scale: botGroup.scale.toArray(),
        bounds: bounds && Number.isFinite(bounds.min.x) ? { min: bounds.min.toArray(), max: bounds.max.toArray() } : null,
      } : null,
      rigidBody: rigidBodySnapshot(damageFighter?.rb),
      frame: clonePlain(damageFighter?.frame || null),
    },
    parameters: {
      rawDamage: damageNumber(tweakerDamageAmountInput, Math.max(physicalDamageTweakerOptions().threshold, 72)),
      options: physicalDamageTweakerOptions(),
      gravityY: physicsGravityY(),
      colliderView: colliderViewModeSelect?.value || "all",
      viewColliders: Boolean(physicalDamageViewCollidersInput?.checked),
    },
    statusText: status,
    damage: {
      lastResult: clonePlain(damageFighter?.physicalDamageLastResult || null),
      lastColliderAdjustment: clonePlain(damageFighter?.physicalDamageLastColliderAdjustment || null),
      pieces: damageFighter?.physicalDamagePieces || 0,
      brokenAt: (damageFighter?.physicalDamageBrokenAt || []).map((entry) => ({
        point: plainVec3(entry.point),
        damage: entry.damage ?? null,
        hits: entry.hits ?? null,
        triangles: entry.triangles ?? null,
      })),
      primedAt: (damageFighter?.physicalDamagePrimedAt || []).map((entry) => ({
        point: plainVec3(entry.point),
        damage: entry.damage ?? null,
        triangles: entry.triangles ?? null,
      })),
      primedBreaks: (damageFighter?.physicalDamagePrimedBreaks || []).map(damageCandidateSnapshot),
      pendingTint: pendingDamageTint ? {
        point: plainVec3(pendingDamageTint.point),
        normal: plainVec3(pendingDamageTint.normal),
        options: clonePlain(pendingDamageTint.options || null),
      } : null,
      props: damageProps.map(damagePropSnapshot),
      solidFill: clonePlain(damageFighter?.physicalDamageLastSolidFill || null),
      sideEffects: {
        leftDrive: "unchanged",
        rightDrive: "unchanged",
        weapon: "unchanged",
      },
    },
    colliderParts: clonePlain(colliderParts),
    colliderRoles: physicsTestColliderRoles(),
    camera: cameraSnapshot(),
    viewport: {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    screenshot: imageDataUrl,
  };
}

function outputPhysicalDamageBreakInfo() {
  if (!botGroup) return;
  renderer.render(scene, camera);
  const imageDataUrl = canvas.toDataURL("image/png");
  const payload = physicalDamageBreakPayload(imageDataUrl);
  const json = JSON.stringify(payload, null, 2);
  const scriptJson = json.replace(/</g, "\\u003c");
  const title = `${payload.bot.name} Physical Damage Break Info`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
body { margin: 24px; background: #111416; color: #edf3f4; font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
h1 { margin: 0 0 8px; font-size: 22px; }
h2 { margin: 22px 0 8px; font-size: 16px; }
.meta, .notes { color: #aebec2; margin-bottom: 16px; }
.status { white-space: pre-line; border: 1px solid #493d34; background: #1d1715; padding: 12px; border-radius: 6px; }
img { display: block; max-width: 100%; height: auto; border: 1px solid #39464a; background: #0b0d0e; }
pre { white-space: pre-wrap; word-break: break-word; background: #0b0d0e; border: 1px solid #39464a; padding: 16px; overflow: auto; border-radius: 6px; }
code { color: #f0c44f; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${escapeHtml(payload.createdAt)} · ${escapeHtml(payload.bot.id)} · schema ${payload.schemaVersion}</div>
<div class="notes">${payload.fileNotes.map((note) => `<div>${escapeHtml(note)}</div>`).join("")}</div>
<img alt="Physical damage break screenshot" src="${imageDataUrl}" />
<h2>Status</h2>
<div class="status">${escapeHtml(payload.statusText || "No status")}</div>
<h2>Quick Debug Fields</h2>
<pre>${escapeHtml(JSON.stringify({
  bot: payload.bot.id,
  parameters: payload.parameters,
  lastResult: payload.damage.lastResult,
  lastColliderAdjustment: payload.damage.lastColliderAdjustment,
  pieces: payload.damage.pieces,
  brokenAt: payload.damage.brokenAt,
  propCount: payload.damage.props.length,
}, null, 2))}</pre>
<h2>Full Payload</h2>
<pre>${escapeHtml(json)}</pre>
<script type="application/json" id="break-info-data">${scriptJson}</script>
</body>
</html>`;
  const filenameDate = payload.createdAt.replace(/[:.]/g, "-");
  downloadBlob(new Blob([html], { type: "text/html" }), `${selectedBotId}-physical-damage-break-info-${filenameDate}.html`);
  setStatus("Downloaded break info");
}

function physicsTestPayload() {
  const pose = capturePhysicsTestPose();
  return {
    kind: "battleBotPhysicsTest",
    bot: selectedBotId,
    createdAt: new Date().toISOString(),
    position: pose.position,
    rotation: pose.rotation,
    quaternion: pose.quaternion,
    initialVelocity: pose.velocity,
    weaponOn: pose.weaponOn,
    recentlyHit: pose.recentlyHit,
    selfRightingGrace: pose.selfRightingGrace,
    startPose: physicsTestStartPose ? clonePlain(physicsTestStartPose) : null,
    currentPose: pose,
    camera: cameraSnapshot(),
    runtime: currentPhysicsRuntimeSnapshot(),
    viewport: {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    colliderParts: clonePlain(colliderParts),
    colliderRoles: physicsTestColliderRoles(),
    physics: {
      floorY: ARENA_PHYSICS_FLOOR_Y,
      visualFloorY: ARENA_VISUAL_FLOOR_Y,
      physicsFloorBodyY: ARENA_PHYSICS_FLOOR_BODY_Y,
      physicsFloorHalfHeight: ARENA_PHYSICS_FLOOR_HALF_HEIGHT,
      gravityY: physicsGravityY(),
      fixedDt: FIXED_PHYSICS_DT,
      arenaHalfWidth: ARENA_HALF_WIDTH,
      arenaHalfLength: ARENA_HALF_LENGTH,
      arenaCeilingHeight: ARENA_CEILING_HEIGHT,
    },
  };
}

function outputPhysicsTest() {
  if (!botGroup) return;
  const payload = physicsTestPayload();
  outputTitle.textContent = "Physics test output";
  outputText.value = JSON.stringify(payload, null, 2);
  modal.showModal();
}

function takePhysicsTestSnapshot() {
  if (!botGroup) return;
  renderer.render(scene, camera);
  const imageDataUrl = canvas.toDataURL("image/png");
  const payload = physicsTestPayload();
  const json = JSON.stringify(payload, null, 2);
  const scriptJson = json.replace(/</g, "\\u003c");
  const title = `${selectedBotId} Physics Test Snapshot`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
body { margin: 24px; background: #111416; color: #edf3f4; font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
h1 { margin: 0 0 12px; font-size: 22px; }
.meta { color: #aebec2; margin-bottom: 18px; }
img { display: block; max-width: 100%; height: auto; border: 1px solid #39464a; background: #0b0d0e; }
pre { white-space: pre-wrap; word-break: break-word; background: #0b0d0e; border: 1px solid #39464a; padding: 16px; overflow: auto; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<div class="meta">${escapeHtml(payload.createdAt)} · ${escapeHtml(`${canvas.width}x${canvas.height}`)}</div>
<img alt="Current Physics Test camera view" src="${imageDataUrl}" />
<h2>Parameters</h2>
<pre>${escapeHtml(json)}</pre>
<script type="application/json" id="physics-test-snapshot-data">${scriptJson}</script>
</body>
</html>`;
  const filenameDate = payload.createdAt.replace(/[:.]/g, "-");
  downloadBlob(new Blob([html], { type: "text/html" }), `${selectedBotId}-physics-test-snapshot-${filenameDate}.html`);
  setStatus("Downloaded physics test snapshot");
}

function updateColliderVisibility() {
  syncColliderRootTransform();
  const view = colliderViewModeSelect?.value || "all";
  const showPhysicsTestColliders = editMode === "physicsTest" && Boolean(physicsViewCollidersInput?.checked);
  const showPhysicalDamageColliders = editMode === "physicalDamage" && Boolean(physicalDamageViewCollidersInput?.checked);
  colliderRoot?.children.forEach((object) => {
    object.visible = (editMode === "colliders" || showPhysicsTestColliders || showPhysicalDamageColliders) && colliderVisibleForMode(object.userData.part, view);
  });
  syncDamagePropColliderHelpers();
}

function updateGroundReference() {
  groundReference.visible = editMode !== "physicsTest" && editMode !== "physicalDamage";
  groundReference.position.y = editMode === "geometryCutter" && botGroup ? botGroup.position.y : 0;
}

function applyGeometryView() {
  setViewerPartVisibility(botGroup, geometryViewSelect?.value || "everything");
}

function updateModeUi() {
  const splitAvailable = splitHasCustomWeaponRegion();
  if (editModeSelect) {
    const splitOption = editModeSelect.querySelector('option[value="weaponSplit"]');
    if (splitOption) splitOption.disabled = !splitAvailable;
    if (!splitAvailable && editMode === "weaponSplit") {
      editMode = "colliders";
      editModeSelect.value = editMode;
      updateUrlMode(editMode);
    }
  }
  if (outputButton) outputButton.hidden = editMode !== "colliders";
  if (outputWeaponSplitButton) outputWeaponSplitButton.hidden = editMode !== "weaponSplit" || !splitAvailable;
  if (outputGeometryButton) outputGeometryButton.hidden = editMode !== "geometryCutter";
  if (geometryCutterActions) geometryCutterActions.hidden = editMode !== "geometryCutter";
  if (physicsTestActions) physicsTestActions.hidden = editMode !== "physicsTest";
  if (physicalDamageActions) physicalDamageActions.hidden = editMode !== "physicalDamage";
  if (runPhysicsTestButton) runPhysicsTestButton.textContent = physicsTestRunning ? "Stop Test" : "Run Test";
  if (applyGeometryCutButton) applyGeometryCutButton.disabled = !cutterBox || editMode !== "geometryCutter";
  if (applyGeometryFillButton) applyGeometryFillButton.disabled = !cutterBox || editMode !== "geometryCutter";
  if (autoGenerateButton) autoGenerateButton.hidden = editMode !== "colliders";
  if (resetButton) resetButton.hidden = editMode !== "colliders" && editMode !== "weaponSplit";
  if (newColliderTypeSelect) newColliderTypeSelect.hidden = editMode !== "colliders";
  if (addColliderButton) addColliderButton.hidden = editMode !== "colliders";
  if (deleteCollidersButton) deleteCollidersButton.hidden = editMode !== "colliders";
  if (colliderViewModeSelect?.closest("label")) colliderViewModeSelect.closest("label").hidden = editMode !== "colliders" && editMode !== "physicsTest" && editMode !== "physicalDamage";
  if (geometryViewSelect?.closest("label")) geometryViewSelect.closest("label").hidden = editMode === "physicsTest" || editMode === "physicalDamage";
  updateColliderVisibility();
  if (splitRoot) splitRoot.visible = editMode === "weaponSplit" && splitHelpersVisible;
  if (cutterRoot) cutterRoot.visible = editMode === "geometryCutter";
  ensurePhysicsArenaVisible();
  updateGroundReference();
  updateBreakInfoButton();
  if (transform.object?.userData?.toolKind === "weaponSplit" && (!splitRoot?.visible || editMode !== "weaponSplit")) deselect();
  if (transform.object?.userData?.toolKind === "geometryCutter" && editMode !== "geometryCutter") deselect();
  if (transform.object?.userData?.modelTransformTarget && editMode !== "geometryCutter") deselect();
  if (transform.object?.userData?.toolKind === "physicsTestBot" && editMode !== "physicsTest" && editMode !== "physicalDamage") deselect();
  if (transform.object?.userData?.toolKind === "physicalDamagePiece" && editMode !== "physicalDamage") deselect();
  syncWeaponSplitDebugControls();
  setSelectedText();
}

async function loadBot(id) {
  const loadId = ++activeLoadId;
  clearSceneBot();
  prePhysicsTestEditorPose = null;
  physicsTestStartPose = null;
  selectedBotId = id;
  updateUrlBot(id);
  setStatus("Loading");
  try {
    const source = await loadSourceModel(id);
    if (loadId !== activeLoadId) return;
    botGroup = buildModelViewerGroup(id, source);
    botGroup.userData.toolKind = "physicsTestBot";
    botGroup.scale.setScalar(editorDisplayScale(id));
    botGroup.rotation.set(...(bots.find((bot) => bot.id === id)?.viewerRotation || [0, 0, 0]));
    botGroup.position.set(0, 0, 0);
    botGroup.updateMatrixWorld(true);
    botGroup.position.y += ARENA_VISUAL_FLOOR_Y + measureVisualFloorOffset(botGroup);
    colliderParts = authoredColliderParts(id);
    splitState = getSelectedWeaponSplitConfig(id);
    rebuildColliderRoot();
    applyGeometryView();
    scene.add(botGroup);
    rebuildSplitRoot();
    if (editMode === "physicsTest" || editMode === "physicalDamage") positionBotForPhysicsTest({ force: true });
    frameCameraToBot();
    updateModeUi();
    if (editMode === "physicalDamage") ensureDamageSession();
    if (editMode === "geometryCutter" && parseUrlCutterBox()) createCutBox({ restoreFromUrl: true });
    setStatus(`${bots.find((bot) => bot.id === id)?.name || id} ready`);
    tryApplyUrlBreak();
  } catch (error) {
    console.error(error);
    setStatus(`Could not load ${id}`);
  }
}

function frameCameraToBot() {
  if (!botGroup) return;
  botGroup.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(botGroup);
  if (!Number.isFinite(bounds.min.x)) return;
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const span = Math.max(size.x, size.y, size.z, 1);
  orbit.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(span * 1.25, span * 0.78, span * 1.55));
  camera.near = Math.max(0.02, span / 120);
  camera.far = Math.max(80, span * 24);
  camera.updateProjectionMatrix();
  orbit.update();
}

function setPointerFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function selectableIntersections(event) {
  setPointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);
  const meshes = [];
  if (editMode === "colliders") {
    colliderRoot?.traverse((child) => {
      if (child.isMesh && child.parent?.visible) meshes.push(child);
    });
  } else if (editMode === "weaponSplit") {
    splitRoot?.traverse((child) => {
      if (!child.userData?.splitRole || child.visible === false) return;
      child.traverse((nested) => {
        if (nested.isMesh && nested.visible !== false) meshes.push(nested);
      });
    });
  } else if (editMode === "geometryCutter") {
    cutterRoot?.traverse((child) => {
      if ((child.isMesh || child.isLineSegments) && child.visible !== false) meshes.push(child);
    });
  } else if (editMode === "physicsTest" && botGroup && !physicsTestRunning) {
    botGroup.traverse((child) => {
      if (child.isMesh && child.visible !== false && !child.userData?.toolKind && !child.userData?.part) meshes.push(child);
    });
  } else if (editMode === "physicalDamage" && botGroup && !damageAimActive) {
    botGroup.traverse((child) => {
      if (child.isMesh && child.visible !== false && !child.userData?.toolKind && !child.userData?.part) meshes.push(child);
    });
    damageProps.forEach((prop) => {
      prop.mesh?.traverse?.((child) => {
        if (child.isMesh && child.visible !== false) meshes.push(child);
      });
    });
  }
  return raycaster.intersectObjects(meshes, false);
}

function owningToolObject(object) {
  if (editMode === "physicsTest" && botGroup) return botGroup;
  if (editMode === "physicalDamage") {
    let node = object;
    while (node && node.parent) {
      if (node.userData?.toolKind === "physicalDamagePiece") return node;
      if (node === botGroup) return botGroup;
      node = node.parent;
    }
    return null;
  }
  let node = object;
  while (node && node.parent) {
    if (node.userData?.toolKind === "geometryCutter") return node;
    if (node.userData?.part || (node.userData?.toolKind === "weaponSplit" && node.userData?.splitRole)) return node;
    node = node.parent;
  }
  return null;
}

function setTransformAxes({ x = true, y = true, z = true } = {}) {
  transform.showX = x;
  transform.showY = y;
  transform.showZ = z;
}

function splitSupportsPivotRotation() {
  return Boolean(splitState?.weapon && ("axisPitch" in splitState.weapon || splitState.weapon.spinAxis === "y"));
}

function configureTransformAxesForTarget(object, mode) {
  if (object?.userData?.toolKind === "physicsTestBot" && mode === "scale") {
    setTransformAxes({ x: false, y: false, z: false });
    return;
  }
  if (object?.userData?.toolKind === "weaponSplit" && mode === "rotate") {
    if (object.userData.splitRole === "region") setTransformAxes({ x: false, y: true, z: false });
    else if (object.userData.splitRole === "pivot") setTransformAxes({ x: splitSupportsPivotRotation(), y: false, z: false });
    return;
  }
  setTransformAxes({ x: true, y: true, z: true });
}

function attachTransform(object, mode = "translate") {
  transform.setMode(mode);
  transform.setSpace("local");
  configureTransformAxesForTarget(object, mode);
  transform.attach(object);
}

function transformModeForSelection() {
  if ((editMode === "physicsTest" || editMode === "physicalDamage") && selectedObject?.userData.toolKind === "physicsTestBot") {
    if (modifierState.shift) return "rotate";
    return "translate";
  }
  if (editMode === "physicalDamage" && selectedObject?.userData.toolKind === "physicalDamagePiece") {
    if (modifierState.shift) return "rotate";
    return "translate";
  }
  if (editMode === "geometryCutter" && selectedObject?.userData.modelTransformTarget) {
    if (modifierState.shift) return "rotate";
    return "translate";
  }
  if (editMode === "geometryCutter" && (selectedObject?.userData.toolKind === "geometryCutter" || transform.object === cutterBox)) {
    if (modifierState.alt) return "scale";
    if (modifierState.shift) return "rotate";
    return "translate";
  }
  if (!selectedObject || selectedFeature) return "translate";
  if (selectedObject.userData.toolKind === "weaponSplit") {
    if (modifierState.alt && selectedObject.userData.splitRole === "region") return "scale";
    if (modifierState.shift && (selectedObject.userData.splitRole === "region" || (selectedObject.userData.splitRole === "pivot" && splitSupportsPivotRotation()))) return "rotate";
    return "translate";
  }
  if (selectedPartObjects().length > 1) return "translate";
  if (modifierState.alt && (selectedObject.userData.part || selectedObject.userData.splitRole === "region")) return "scale";
  if (modifierState.shift && selectedObject.userData.part) return "rotate";
  return "translate";
}

function syncTransformModeToModifiers() {
  if (selectedFeature || transform.dragging) return;
  if ((editMode === "physicsTest" || editMode === "physicalDamage") && selectedObject?.userData.toolKind === "physicsTestBot") {
    attachTransform(selectedObject, transformModeForSelection());
    return;
  }
  if (editMode === "physicalDamage" && selectedObject?.userData.toolKind === "physicalDamagePiece") {
    attachTransform(selectedObject, transformModeForSelection());
    return;
  }
  if (editMode === "geometryCutter" && selectedObject?.userData.modelTransformTarget) {
    attachTransform(selectedObject, transformModeForSelection());
    return;
  }
  if (editMode === "geometryCutter" && (selectedObject?.userData.toolKind === "geometryCutter" || transform.object === cutterBox) && cutterBox) {
    attachTransform(cutterBox, transformModeForSelection());
    return;
  }
  if (!selectedObject) return;
  const target = activeTransformTarget();
  if (target === selectionProxy) syncSelectionProxyPosition();
  attachTransform(target, transformModeForSelection());
}

function createFeatureHandle() {
  const root = new THREE.Group();
  root.name = "featureHandle";
  const material = new THREE.MeshBasicMaterial({ color: 0xf0c44f, depthTest: false, depthWrite: false });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.055, 18, 10), material);
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.34, 12), material);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.x = 0.17;
  root.add(sphere, shaft);
  root.renderOrder = 80;
  root.visible = false;
  scene.add(root);
  return root;
}

function clearFeatureSelection() {
  selectedFeature = null;
  if (featureHandle) featureHandle.visible = false;
  syncTransformModeToModifiers();
  setSelectedText();
}

function selectObject(object, { additive = false } = {}) {
  selectedFeature = null;
  if (featureHandle) featureHandle.visible = false;
  if (additive && object.userData.part) {
    const existingIndex = selectedObjects.indexOf(object);
    if (existingIndex >= 0) {
      selectedObjects.splice(existingIndex, 1);
      selectedObject = selectedObjects.at(-1) || null;
    } else {
      selectedObjects.push(object);
      selectedObject = object;
    }
  } else {
    selectedObjects = object.userData.part ? [object] : [];
    selectedObject = object;
  }
  if (selectedPartObjects().length > 1) syncSelectionProxyPosition();
  if (selectedObject && !(editMode === "physicsTest" && physicsTestRunning)) attachTransform(activeTransformTarget(), transformModeForSelection());
  else transform.detach();
  setSelectedText();
}

function deselect() {
  selectedObject = null;
  selectedObjects = [];
  selectedFeature = null;
  transform.detach();
  if (featureHandle) featureHandle.visible = false;
  setSelectedText();
}

function dominantAxis(normal) {
  const axes = [
    { axis: 0, value: Math.abs(normal.x), sign: Math.sign(normal.x) || 1 },
    { axis: 1, value: Math.abs(normal.y), sign: Math.sign(normal.y) || 1 },
    { axis: 2, value: Math.abs(normal.z), sign: Math.sign(normal.z) || 1 },
  ].sort((a, b) => b.value - a.value);
  return axes[0];
}

function canSelectEdge(object) {
  return (
    object?.userData?.splitRole === "region" ||
    object?.userData?.part?.type === "wedge"
  );
}

function hitLooksLikeFrontBackEdge(object, hit) {
  if (!canSelectEdge(object)) return null;
  const local = object.worldToLocal(hit.point.clone());
  const halfZ = object.userData.splitRole === "region"
    ? 0.5
    : object.userData.part?.halfExtents?.[2] || 0.5;
  const halfY = object.userData.splitRole === "region"
    ? 0.5
    : object.userData.part?.halfExtents?.[1] || 0.5;
  const zNear = Math.min(Math.abs(local.z - halfZ), Math.abs(local.z + halfZ));
  const yNearTopOrBottom = Math.min(Math.abs(local.y - halfY), Math.abs(local.y + halfY));
  const tolerance = object.userData.splitRole === "region" ? 0.08 : Math.max(0.025, halfZ * 0.16);
  if (zNear > tolerance || yNearTopOrBottom > Math.max(tolerance, halfY * 0.2)) return null;
  return local.z >= 0 ? 1 : -1;
}

function selectEdge(hit, sign) {
  if (!selectedObject) return;
  featureHandle ||= createFeatureHandle();
  const anchorLocal = selectedObject.worldToLocal(hit.point.clone());
  const worldNormal = new THREE.Vector3(0, 0, sign).transformDirection(selectedObject.matrixWorld).normalize();
  featureHandle.position.copy(hit.point);
  featureHandle.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), worldNormal);
  featureHandle.visible = true;
  selectedFeature = {
    kind: "edge",
    object: selectedObject,
    axis: 2,
    sign,
    anchorLocal: anchorLocal.toArray(),
    normalWorld: worldNormal,
    startWorldPosition: hit.point.clone(),
    startPart: selectedObject.userData.part ? clonePlain(selectedObject.userData.part) : null,
    startPosition: selectedObject.position.toArray(),
    startScale: selectedObject.scale.toArray(),
  };
  transform.detach();
  transform.setMode("translate");
  transform.setSpace("local");
  setTransformAxes({ x: true, y: false, z: false });
  transform.attach(featureHandle);
  setSelectedText();
}

function selectFace(intersection) {
  if (!selectedObject || !intersection.face || selectedObject.userData.toolKind === "weaponSplit") return;
  featureHandle ||= createFeatureHandle();
  const localNormal = intersection.face.normal.clone().normalize();
  const worldNormal = localNormal.clone().transformDirection(selectedObject.matrixWorld).normalize();
  featureHandle.position.copy(intersection.point);
  featureHandle.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), worldNormal);
  featureHandle.visible = true;
  selectedFeature = {
    kind: "face",
    object: selectedObject,
    normalLocal: localNormal,
    normalWorld: worldNormal,
    startWorldPosition: intersection.point.clone(),
    startPart: clonePlain(selectedObject.userData.part),
  };
  transform.detach();
  transform.setMode("translate");
  transform.setSpace("local");
  setTransformAxes({ x: true, y: false, z: false });
  transform.attach(featureHandle);
  setSelectedText();
}

function applyColliderFaceEdit() {
  const { object, normalLocal, normalWorld, startWorldPosition, startPart } = selectedFeature;
  const worldDelta = featureHandle.position.clone().sub(startWorldPosition);
  const worldScale = object.getWorldScale(new THREE.Vector3());
  const localAmount = worldDelta.dot(normalWorld) / Math.max(0.0001, (worldScale.x + worldScale.y + worldScale.z) / 3);
  const { axis, sign } = dominantAxis(normalLocal);
  applyColliderAxisExtentEdit(object, startPart, axis, sign, localAmount);
}

function applyColliderAxisExtentEdit(object, startPart, axis, sign, localAmount) {
  const part = object.userData.part;
  const oldPosition = [...(startPart.position || [0, 0, 0])];
  const oldHalf = [...(startPart.halfExtents || [0.4, 0.15, 0.4])];
  const min = oldPosition[axis] - oldHalf[axis];
  const max = oldPosition[axis] + oldHalf[axis];
  let nextMin = min;
  let nextMax = max;
  if (sign > 0) nextMax = max + localAmount;
  else nextMin = min + localAmount;
  if (nextMax - nextMin < 0.02) {
    if (sign > 0) nextMax = nextMin + 0.02;
    else nextMin = nextMax - 0.02;
  }
  const nextPosition = [...oldPosition];
  const nextHalf = [...oldHalf];
  nextPosition[axis] = (nextMin + nextMax) * 0.5;
  nextHalf[axis] = Math.max(0.01, (nextMax - nextMin) * 0.5);
  part.position = nextPosition;
  part.halfExtents = nextHalf;
  part.rotation = [...(startPart.rotation || part.rotation || [0, 0, 0])];
  if (startPart.vertices?.length) {
    const oldFaceCoord = sign > 0 ? max : min;
    const newCenter = nextPosition[axis];
    const tolerance = Math.max(0.01, oldHalf[axis] * 0.08);
    part.vertices = startPart.vertices.map((vertex) => {
      const absolute = oldPosition[axis] + vertex[axis];
      const movedAbsolute = Math.abs(absolute - oldFaceCoord) <= tolerance ? absolute + localAmount : absolute;
      const next = [...vertex];
      next[axis] = movedAbsolute - newCenter;
      return next;
    });
  }
  setObjectFromPart(object, part);
  refreshColliderObjectGeometry(object, part);
}

function applyEdgeEdit() {
  const { object, axis, sign, normalWorld, startWorldPosition, startPart, startPosition, startScale } = selectedFeature;
  const worldDelta = featureHandle.position.clone().sub(startWorldPosition);
  const worldScale = object.getWorldScale(new THREE.Vector3());
  const localAmount = worldDelta.dot(normalWorld) / Math.max(0.0001, (worldScale.x + worldScale.y + worldScale.z) / 3);
  if (object.userData.splitRole === "region") {
    const oldPosition = new THREE.Vector3(...startPosition);
    const oldScale = new THREE.Vector3(...startScale);
    const min = oldPosition.getComponent(axis) - oldScale.getComponent(axis) * 0.5;
    const max = oldPosition.getComponent(axis) + oldScale.getComponent(axis) * 0.5;
    let nextMin = min;
    let nextMax = max;
    if (sign > 0) nextMax = max + localAmount;
    else nextMin = min + localAmount;
    if (nextMax - nextMin < 0.02) {
      if (sign > 0) nextMax = nextMin + 0.02;
      else nextMin = nextMax - 0.02;
    }
    object.position.setComponent(axis, (nextMin + nextMax) * 0.5);
    object.scale.setComponent(axis, nextMax - nextMin);
    syncSplitStateFromObjects();
    return;
  }
  applyColliderAxisExtentEdit(object, startPart, axis, sign, localAmount);
}

function updateFeatureHandlePosition() {
  if (!selectedFeature || !featureHandle) return;
  const object = selectedFeature.object;
  if (selectedFeature.kind === "edge") {
    const local = new THREE.Vector3(...(selectedFeature.anchorLocal || [0, 0, 0]));
    const halfZ = object.userData.part ? object.userData.part.halfExtents?.[2] || 0.5 : 0.5;
    local.z = selectedFeature.sign * halfZ;
    featureHandle.position.copy(object.localToWorld(local));
  } else if (object.userData.part) {
    const { axis, sign } = dominantAxis(selectedFeature.normalLocal);
    const local = new THREE.Vector3();
    local.setComponent(axis, sign * (object.userData.part.halfExtents?.[axis] || 0.5));
    featureHandle.position.copy(object.localToWorld(local));
  }
}

function applyFeatureEditFromHandle() {
  if (!selectedFeature || !featureHandle || applyingFeatureChange) return;
  applyingFeatureChange = true;
  if (selectedFeature.kind === "edge") applyEdgeEdit();
  else applyColliderFaceEdit();
  if (!transform.dragging) updateFeatureHandlePosition();
  updateNumericInspector();
  applyingFeatureChange = false;
}

function updateSelectedFromTransform() {
  if (selectedFeature) {
    applyFeatureEditFromHandle();
    return;
  }
  if (!selectedObject) return;
  if (dragStartSelection?.kind === "multiTranslate" && transform.object === selectionProxy) {
    const delta = selectionProxy.position.clone().sub(dragStartSelection.proxyPosition);
    dragStartSelection.objects.forEach(({ object, part, position }) => {
      part.position = [
        position[0] + delta.x,
        position[1] + delta.y,
        position[2] + delta.z,
      ];
      setObjectFromPart(object, part);
    });
    updateNumericInspector();
    return;
  }
  if (selectedObject.userData.part && transform.mode !== "scale") syncPartFromObject(selectedObject.userData.part, selectedObject);
  if (selectedObject.userData.toolKind === "weaponSplit") syncSplitStateFromObjects();
  if (editMode === "physicalDamage" && selectedObject.userData.toolKind === "physicsTestBot") syncDamageFighterBodyFromBot();
  if (editMode === "physicalDamage" && selectedObject.userData.toolKind === "physicalDamagePiece") syncDamagePropBodyFromMesh(selectedObject);
  if (editMode === "geometryCutter" && (selectedObject === cutterBox || transform.object === cutterBox)) updateUrlCutterBox();
  updateNumericInspector();
}

function captureSelectedTransformStart() {
  if (!selectedObject || selectedFeature) return null;
  const objects = selectedPartObjects();
  if (objects.length > 1 && transform.object === selectionProxy) {
    syncSelectionProxyPosition();
    return {
      kind: "multiTranslate",
      proxyPosition: selectionProxy.position.clone(),
      objects: objects.map((object) => ({
        object,
        part: object.userData.part,
        position: [...(object.userData.part.position || [0, 0, 0])],
      })),
    };
  }
  return {
    object: selectedObject,
    part: selectedObject.userData.part ? clonePlain(selectedObject.userData.part) : null,
    position: selectedObject.position.toArray(),
    quaternion: selectedObject.quaternion.toArray(),
    scale: selectedObject.scale.toArray(),
  };
}

function bakeScaleTransform() {
  if (dragStartSelection?.kind === "multiTranslate") {
    syncSelectionProxyPosition();
    updateNumericInspector();
    return;
  }
  if (!dragStartSelection?.object || dragStartSelection.object !== selectedObject || transform.mode !== "scale") return;
  if (selectedObject.userData.part && dragStartSelection.part) {
    const part = selectedObject.userData.part;
    const startHalf = dragStartSelection.part.halfExtents || [0.4, 0.15, 0.4];
    part.position = [selectedObject.position.x, selectedObject.position.y, selectedObject.position.z];
    part.halfExtents = [
      Math.max(0.01, Math.abs(startHalf[0] * selectedObject.scale.x)),
      Math.max(0.01, Math.abs(startHalf[1] * selectedObject.scale.y)),
      Math.max(0.01, Math.abs(startHalf[2] * selectedObject.scale.z)),
    ];
    part.rotation = [...(dragStartSelection.part.rotation || part.rotation || [0, 0, 0])];
    if (dragStartSelection.part.vertices?.length) {
      part.vertices = dragStartSelection.part.vertices.map((vertex) => [
        vertex[0] * selectedObject.scale.x,
        vertex[1] * selectedObject.scale.y,
        vertex[2] * selectedObject.scale.z,
      ]);
    }
    selectedObject.scale.set(1, 1, 1);
    setObjectFromPart(selectedObject, part);
    refreshColliderObjectGeometry(selectedObject, part);
    updateNumericInspector();
    return;
  }
  if (selectedObject.userData.splitRole === "region") {
    syncSplitStateFromObjects();
    updateNumericInspector();
  }
}

function handleCanvasPointerDown(event) {
  if (event.button !== 0 || transform.dragging) return;
  if (performance.now() - lastTransformDragEndedAt < 80) return;
  pendingCanvasDeselect = null;
  if (editMode === "physicalDamage" && damageAimActive) {
    const hits = botDamageIntersections(event);
    if (hits.length) applyDamageAtHit(hits[0]);
    else stopDamageAim("Click Cause Damage to aim another hit.");
    return;
  }
  const hits = selectableIntersections(event);
  const additive = editMode === "colliders" && (event.metaKey || event.ctrlKey);
  if (!hits.length) {
    if (!additive) pendingCanvasDeselect = { x: event.clientX, y: event.clientY, moved: false };
    return;
  }
  const hit = hits[0];
  const object = owningToolObject(hit.object);
  if (!object) {
    if (!additive) pendingCanvasDeselect = { x: event.clientX, y: event.clientY, moved: false };
    return;
  }
  if (additive && object.userData.part) {
    selectObject(object, { additive: true });
    return;
  }
  if (selectedObject === object && selectedObjects.length <= 1 && editMode === "colliders") {
    const edgeSign = hitLooksLikeFrontBackEdge(object, hit);
    if (edgeSign) {
      selectEdge(hit, edgeSign);
      return;
    }
    if (object.userData.part) {
      selectFace(hit);
      return;
    }
  }
  selectObject(object);
}

function handleCanvasPointerMove(event) {
  if (editMode === "physicalDamage" && damageAimActive) {
    const hits = botDamageIntersections(event);
    damagePointerOverBot = hits.length > 0;
    damagePointerWorld = hits[0]?.point?.clone?.() || null;
    canvas.classList.toggle("damage-aiming-over-bot", damagePointerOverBot);
  }
  if (!pendingCanvasDeselect) return;
  const dx = event.clientX - pendingCanvasDeselect.x;
  const dy = event.clientY - pendingCanvasDeselect.y;
  if (Math.hypot(dx, dy) > 5) pendingCanvasDeselect.moved = true;
}

function handleCanvasPointerUp(event) {
  if (!pendingCanvasDeselect) return;
  const shouldDeselect = !pendingCanvasDeselect.moved && Math.hypot(event.clientX - pendingCanvasDeselect.x, event.clientY - pendingCanvasDeselect.y) <= 5;
  pendingCanvasDeselect = null;
  if (shouldDeselect) deselect();
}

function numberLiteral(value) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.abs(value) < 0.0000005 ? 0 : Number(value.toFixed(6));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

function stringLiteral(value) {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function formatArray(values, indent) {
  if (!values?.length) return "[]";
  if (values.every((value) => typeof value === "number")) {
    if (values.length <= 3) return `[${values.map(numberLiteral).join(", ")}]`;
    return `[\n${values.map((value) => `${" ".repeat(indent + 2)}${numberLiteral(value)}`).join(",\n")}\n${" ".repeat(indent)}]`;
  }
  return `[\n${values.map((value) => `${" ".repeat(indent + 2)}${formatValue(value, indent + 2)}`).join(",\n")}\n${" ".repeat(indent)}]`;
}

function formatObject(object, indent) {
  const entries = Object.entries(object).filter(([, value]) => value !== undefined);
  return `{\n${entries.map(([key, value]) => `${" ".repeat(indent + 2)}${key}: ${formatValue(value, indent + 2)}`).join(",\n")}\n${" ".repeat(indent)}}`;
}

function formatValue(value, indent = 0) {
  if (typeof value === "number") return numberLiteral(value);
  if (typeof value === "string") return stringLiteral(value);
  if (Array.isArray(value)) return formatArray(value, indent);
  if (value && typeof value === "object") return formatObject(value, indent);
  if (typeof value === "boolean") return value ? "true" : "false";
  return "null";
}

function orderedPart(part) {
  const next = {
    type: part.type || "box",
    part: part.part || "body",
    position: part.position || [0, 0, 0],
    halfExtents: part.halfExtents || [0.4, 0.15, 0.4],
  };
  const rotation = part.rotation || [0, 0, 0];
  if (rotation.some((value) => Math.abs(value) > 0.0000005)) next.rotation = rotation;
  if (part.side) next.side = part.side;
  if (part.density !== undefined) next.density = part.density;
  if (part.friction !== undefined) next.friction = part.friction;
  if (part.restitution !== undefined) next.restitution = part.restitution;
  if (part.vertices?.length) next.vertices = part.vertices;
  return next;
}

function colliderOutputCode() {
  return `    collider: ${formatValue({ parts: colliderParts.map(orderedPart) }, 4)}`;
}

function weaponSplitOutputCode() {
  if (!splitState?.region) return "";
  const weapon = clonePlain(splitState.weapon || {});
  weapon.pivot = splitState.pivot;
  weapon.regions = [splitState.region];
  return `    weapon: ${formatValue(weapon, 4)}`;
}

function openOutputModal(kind = "colliders") {
  outputTitle.textContent = kind === "weaponSplit" ? "Weapon split output" : "Collider output";
  outputText.value = kind === "weaponSplit" ? weaponSplitOutputCode() : colliderOutputCode();
  modal.showModal();
  outputText.focus();
  outputText.select();
}

function closeOutputModal() {
  modal.close();
}

async function copyOutput() {
  outputText.select();
  await navigator.clipboard?.writeText(outputText.value);
  copyButton.textContent = "Copied";
  window.setTimeout(() => {
    copyButton.textContent = "Copy";
  }, 900);
}

function defaultColliderPosition() {
  const midpoint = selectedPartsMidpoint();
  if (midpoint) return midpoint.toArray();
  if (!botGroup) return [0, 0.25, 0];
  botGroup.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(botGroup);
  if (!Number.isFinite(bounds.min.x)) return [0, 0.25, 0];
  const center = bounds.getCenter(new THREE.Vector3());
  if (colliderRoot) colliderRoot.worldToLocal(center);
  return center.toArray();
}

function makeNewColliderPart(type, position = defaultColliderPosition()) {
  const part = {
    type: type === "wedge" ? "wedge" : "box",
    part: type === "weapon" ? "weapon" : type === "driveContact" ? "driveContact" : "body",
    position,
    halfExtents: [0.25, 0.12, 0.25],
  };
  if (type === "driveContact") {
    part.side = "left";
    part.halfExtents = [0.16, 0.24, 0.24];
    part.rotation = [0, 0, Math.PI / 2];
  }
  if (type === "weapon") part.halfExtents = [0.28, 0.16, 0.28];
  if (type === "wedge") part.halfExtents = [0.35, 0.12, 0.35];
  return part;
}

function addCollider() {
  if (!botGroup || editMode !== "colliders") return;
  const before = snapshotState();
  const position = defaultColliderPosition();
  deselect();
  const part = makeNewColliderPart(newColliderTypeSelect?.value || "box", position);
  colliderParts.push(part);
  rebuildColliderRoot();
  const object = colliderRoot?.children.at(-1);
  if (object) selectObject(object);
  pushHistory(before);
  setStatus(`Added ${part.part} ${part.type}`);
}

function deleteSelectedColliders() {
  const selected = selectedPartObjects();
  if (!selected.length || editMode !== "colliders") return;
  const before = snapshotState();
  const indexes = new Set(selected.map((object) => object.userData.colliderIndex));
  deselect();
  colliderParts = colliderParts.filter((part, index) => !indexes.has(index));
  rebuildColliderRoot();
  pushHistory(before);
  setStatus(`Deleted ${indexes.size} collider${indexes.size === 1 ? "" : "s"}`);
}

function resetActiveMode() {
  if (!botGroup) return;
  if (editMode === "physicsTest") {
    stopPhysicsTest();
    positionBotForPhysicsTest({ force: true });
    setStatus("Physics test reset");
    return;
  }
  const before = snapshotState();
  deselect();
  if (editMode === "weaponSplit") {
    splitState = getSelectedWeaponSplitConfig(selectedBotId);
    markWeaponSplitGeometryDirty();
    rebuildDirtyWeaponSplitGeometry();
    rebuildSplitRoot();
  } else {
    colliderParts = authoredColliderParts(selectedBotId);
    rebuildColliderRoot();
  }
  pushHistory(before);
}

function autoGenerateColliders() {
  if (!botGroup) return;
  const before = snapshotState();
  deselect();
  colliderParts = generateColliderPartsFromVisual(botGroup, selectedBotId, { includeDriveContacts: true });
  rebuildColliderRoot();
  pushHistory(before);
  setStatus(`Generated ${colliderParts.length} colliders`);
}

function resizeRenderer() {
  const width = canvas.clientWidth || window.innerWidth;
  const height = canvas.clientHeight || window.innerHeight;
  const needsResize = canvas.width !== Math.floor(width * renderer.getPixelRatio()) || canvas.height !== Math.floor(height * renderer.getPixelRatio());
  if (needsResize) renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(1, height);
  camera.updateProjectionMatrix();
}

function getTweakerWeaponInput() {
  const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
  const rightTrigger = pads.some((pad) => (pad.buttons[7]?.value || 0) > 0.2);
  return keys.has("Space") || rightTrigger;
}

function splitPivotPointFromState() {
  if (!splitState?.pivot || !botGroup) return null;
  const authoring = splitAuthoringBounds(botGroup);
  if (!authoring) return null;
  const bounds = authoring.bounds;
  const size = bounds.getSize(new THREE.Vector3());
  return new THREE.Vector3(
    bounds.min.x + size.x * splitState.pivot.x,
    bounds.min.y + size.y * splitState.pivot.y,
    bounds.min.z + size.z * splitState.pivot.z,
  );
}

function syncTweakerWeaponAnimationFromSplit() {
  const weapon = botGroup?.userData?.weapon;
  if (!weapon?.object || !splitState?.weapon) return;
  if (Number.isFinite(splitState.weapon.axisPitch)) weapon.axisPitch = splitState.weapon.axisPitch;
  if (splitState.weapon.spinAxis) weapon.spinAxis = splitState.weapon.spinAxis;
  const pivot = splitPivotPointFromState();
  if (!pivot) return;
  weapon.tweakerOriginalOffset ||= weapon.offset?.clone?.() || weapon.object.position.clone();
  weapon.tweakerBaseChildPositions ||= weapon.object.children.map((child) => child.position.clone());
  const compensation = weapon.tweakerOriginalOffset.clone().sub(pivot);
  weapon.object.position.copy(pivot);
  weapon.object.children.forEach((child, index) => {
    const base = weapon.tweakerBaseChildPositions[index];
    if (base) child.position.copy(base).add(compensation);
  });
}

function updateTweakerWeapon(dt, active) {
  rebuildDirtyWeaponSplitGeometry();
  const weapon = botGroup?.userData?.weapon;
  if (!weapon?.object) return;
  syncTweakerWeaponAnimationFromSplit();
  if (weapon.type === "bar" || weapon.type === "drum") {
    weapon.tweakerBaseQuaternion ||= weapon.object.quaternion.clone();
    if (weapon.toggle && active && !weapon.wasInputActive) weapon.toggledOn = !weapon.toggledOn;
    weapon.wasInputActive = active;
    const spinning = weapon.toggle ? weapon.toggledOn : active;
    const visualSpeed = Number.isFinite(weapon.visualSpeed) ? weapon.visualSpeed : Number.isFinite(weapon.activeSpeed) ? weapon.activeSpeed : Number.isFinite(weapon.speed) ? weapon.speed * 3 : 0;
    const idleSpeed = Number.isFinite(weapon.idleSpeed) ? weapon.idleSpeed : 0;
    const targetSpeed = spinning ? visualSpeed : idleSpeed;
    const currentSpeed = Number.isFinite(weapon.currentSpeed) ? weapon.currentSpeed : Number.isFinite(weapon.speed) ? weapon.speed : 0;
    const seconds = spinning ? weapon.spinUpSeconds : weapon.spinDownSeconds;
    const fixedRate = seconds ? Math.max(0.01, Math.max(1, Math.abs(visualSpeed || weapon.speed || 1)) / seconds) : null;
    weapon.currentSpeed = fixedRate
      ? THREE.MathUtils.clamp(currentSpeed + Math.sign(targetSpeed - currentSpeed) * fixedRate * dt, Math.min(currentSpeed, targetSpeed), Math.max(currentSpeed, targetSpeed))
      : THREE.MathUtils.damp(currentSpeed, targetSpeed, spinning ? (weapon.acceleration || 60) : (weapon.deceleration || 28), dt);
    if (!spinning && Math.abs(weapon.currentSpeed) < 0.08) weapon.currentSpeed = 0;
    const amount = dt * weapon.currentSpeed;
    if (Math.abs(weapon.currentSpeed) > 0.001) {
      if (weapon.axisPitch && weapon.spinAxis === "y") {
        weapon.object.rotateOnAxis(new THREE.Vector3(0, Math.cos(weapon.axisPitch), Math.sin(weapon.axisPitch)).normalize(), amount);
      } else {
        if (weapon.spinAxis === "x") weapon.object.rotation.x += amount;
        if (weapon.spinAxis === "y") weapon.object.rotation.y += amount;
        if (weapon.spinAxis === "z") weapon.object.rotation.z += amount;
      }
    } else if (!spinning && weapon.tweakerBaseQuaternion) {
      weapon.object.quaternion.slerp(weapon.tweakerBaseQuaternion, 1 - Math.exp(-12 * dt));
    }
  }
  if (weapon.type === "flipper" || weapon.type === "crusher") {
    const target = active ? weapon.activeRotation : weapon.baseRotation;
    const speed = active ? weapon.activeSpeed || weapon.speed : weapon.returnSpeed || weapon.speed;
    weapon.object.rotation.x = THREE.MathUtils.damp(weapon.object.rotation.x, target, speed, dt);
  }
  const mirroredPreview = splitRoot?.children.find((child) => child.name === "weaponSplitMirroredWeaponPreview");
  const mirror = splitRoot?.userData?.mirror;
  if (mirroredPreview && mirror) {
    mirroredPreview.position.copy(weapon.object.position);
    mirroredPreview.quaternion.copy(weapon.object.quaternion);
    mirroredPreview.scale.copy(weapon.object.scale);
    applyMirrorTransform(mirroredPreview, mirror);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.033);
  resizeRenderer();
  if (editMode === "physicsTest") updatePhysicsTest(dt);
  else if (editMode === "physicalDamage") {
    syncDamagePropVisuals();
    updateDamageTintMarker();
    updateDamageEffects(dt);
    spawnDamageCursorFlame();
  } else updateTweakerWeapon(dt, getTweakerWeaponInput());
  orbit.update();
  updateFloorVisibilityForCamera();
  renderer.render(scene, camera);
}

transform.addEventListener("dragging-changed", (event) => {
  orbit.enabled = !event.value;
  if (event.value) {
    dragStartSnapshot = snapshotState();
    dragStartSelection = captureSelectedTransformStart();
  } else {
    const splitRole = selectedObject?.userData?.toolKind === "weaponSplit" ? selectedObject.userData.splitRole : null;
    bakeScaleTransform();
    if (editMode === "geometryCutter" && (selectedObject === cutterBox || transform.object === cutterBox)) updateUrlCutterBox();
    if (selectedFeature) updateFeatureHandlePosition();
    lastTransformDragEndedAt = performance.now();
    pushHistory(dragStartSnapshot);
    dragStartSnapshot = null;
    dragStartSelection = null;
    if (splitRole && editMode === "weaponSplit") {
      rebuildSplitRoot();
      reselectSplitRole(splitRole);
      return;
    }
    syncTransformModeToModifiers();
  }
});
transform.addEventListener("objectChange", updateSelectedFromTransform);

canvas.addEventListener("pointerdown", handleCanvasPointerDown);
canvas.addEventListener("pointermove", handleCanvasPointerMove);
canvas.addEventListener("pointerup", handleCanvasPointerUp);
canvas.addEventListener("pointercancel", () => {
  pendingCanvasDeselect = null;
});
botSelect.addEventListener("change", () => {
  clearUrlBreak();
  pendingUrlBreakApplied = true;
  loadBot(botSelect.value);
});
editModeSelect.addEventListener("change", () => {
  const previousMode = editMode;
  if (previousMode !== "physicsTest" && previousMode !== "physicalDamage" && (editModeSelect.value === "physicsTest" || editModeSelect.value === "physicalDamage")) {
    prePhysicsTestEditorPose = captureBotPose();
  }
  if (physicsTestRunning) stopPhysicsTest();
  if (previousMode === "physicalDamage") disposeDamageSession();
  editMode = editModeSelect.value;
  updateUrlMode(editMode);
  deselect();
  if ((previousMode === "physicsTest" || previousMode === "physicalDamage") && editMode !== "physicsTest" && editMode !== "physicalDamage") {
    applyBotPose(prePhysicsTestEditorPose);
    prePhysicsTestEditorPose = null;
    if (botGroup) botGroup.userData.physicsTestPositioned = false;
    frameCameraToBot();
  } else {
    applyScaleForCurrentMode();
    if (editMode === "physicsTest" || editMode === "physicalDamage") positionBotForPhysicsTest({ force: true });
    else frameCameraToBot();
  }
  if (editMode === "physicalDamage") ensureDamageSession();
  updateModeUi();
});
colliderViewModeSelect.addEventListener("change", updateColliderVisibility);
physicsViewCollidersInput?.addEventListener("change", updateColliderVisibility);
physicalDamageViewCollidersInput?.addEventListener("change", updateColliderVisibility);
physicsWeaponOnInput?.addEventListener("change", () => {
  if (editMode === "physicsTest" && !physicsTestRunning) {
    setPhysicsTestWeaponPose(Boolean(physicsWeaponOnInput.checked));
  }
});
geometryViewSelect.addEventListener("change", applyGeometryView);
viewWeaponSplitInput?.addEventListener("change", () => {
  splitHelpersVisible = Boolean(viewWeaponSplitInput.checked);
  updateModeUi();
});
weaponSplitInputs.forEach((input) => {
  input.addEventListener("input", applyWeaponSplitDebugTuning);
  input.addEventListener("change", applyWeaponSplitDebugTuning);
});
outputButton.addEventListener("click", () => openOutputModal("colliders"));
outputWeaponSplitButton.addEventListener("click", () => openOutputModal("weaponSplit"));
outputGeometryButton.addEventListener("click", outputGeometry);
runPhysicsTestButton?.addEventListener("click", togglePhysicsTest);
outputPhysicsTestButton?.addEventListener("click", outputPhysicsTest);
snapshotPhysicsTestButton?.addEventListener("click", takePhysicsTestSnapshot);
causePhysicalDamageButton?.addEventListener("click", startDamageAim);
outputBreakInfoButton?.addEventListener("click", outputPhysicalDamageBreakInfo);
physicsGravityInput?.addEventListener("input", syncPhysicsGravityUi);
createModelTransformButton.addEventListener("click", createModelTransformHandle);
createCutBoxButton.addEventListener("click", createCutBox);
applyGeometryCutButton.addEventListener("click", applyGeometryCut);
applyGeometryFillButton.addEventListener("click", applyGeometryFill);
resetButton.addEventListener("click", resetActiveMode);
autoGenerateButton.addEventListener("click", autoGenerateColliders);
addColliderButton.addEventListener("click", addCollider);
deleteCollidersButton.addEventListener("click", deleteSelectedColliders);
undoButton.addEventListener("click", undoChange);
redoButton.addEventListener("click", redoChange);
copyButton.addEventListener("click", copyOutput);
closeOutputButtons.forEach((button) => button.addEventListener("click", closeOutputModal));
modal.addEventListener("cancel", () => closeOutputModal());
numericInspectorFields?.addEventListener("focusin", (event) => {
  if (event.target?.matches?.("input[data-inspector-path]")) beginNumericEdit();
});
numericInspectorFields?.addEventListener("input", (event) => {
  const input = event.target;
  if (!input?.matches?.("input[data-inspector-path]")) return;
  applyNumericValue(input.dataset.inspectorPath, input.value);
});
numericInspectorFields?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target?.matches?.("input[data-inspector-path]")) {
    event.preventDefault();
    commitNumericEdit();
    event.target.blur();
  }
});
numericInspectorFields?.addEventListener("change", commitNumericEdit);
numericInspectorFields?.addEventListener("focusout", (event) => {
  if (event.target?.matches?.("input[data-inspector-path]")) commitNumericEdit();
});
window.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  const target = event.target;
  const isTyping = target?.matches?.("input, textarea, select");
  if (event.code === "Space" && !isTyping) {
    event.preventDefault();
    keys.add(event.code);
  }
  if ((event.metaKey || event.ctrlKey) && key === "z") {
    event.preventDefault();
    if (event.shiftKey) redoChange();
    else undoChange();
    return;
  }
  if (!isTyping && editMode === "colliders" && (event.key === "Delete" || event.key === "Backspace") && selectedPartObjects().length) {
    event.preventDefault();
    deleteSelectedColliders();
    return;
  }
  const wasShift = modifierState.shift;
  const wasAlt = modifierState.alt;
  if (event.key === "Shift") modifierState.shift = true;
  if (event.key === "Alt") modifierState.alt = true;
  if (wasShift !== modifierState.shift || wasAlt !== modifierState.alt) syncTransformModeToModifiers();
});
window.addEventListener("keyup", (event) => {
  if (event.code === "Space") {
    event.preventDefault();
    keys.delete(event.code);
  }
  const wasShift = modifierState.shift;
  const wasAlt = modifierState.alt;
  if (event.key === "Shift") modifierState.shift = false;
  if (event.key === "Alt") modifierState.alt = false;
  if (wasShift !== modifierState.shift || wasAlt !== modifierState.alt) syncTransformModeToModifiers();
});
window.addEventListener("blur", () => {
  keys.clear();
  if (!modifierState.shift && !modifierState.alt) return;
  modifierState.shift = false;
  modifierState.alt = false;
  syncTransformModeToModifiers();
});

populateBotSelect();
loadBot(selectedBotId);
RAPIER.init().then(() => {
  rapierReady = true;
  if (editMode === "physicsTest") setStatus("Physics ready");
  if (editMode === "physicalDamage") ensureDamageSession();
  tryApplyUrlBreak();
}).catch((error) => {
  console.error(error);
  setStatus("Physics failed to load");
});
animate();
