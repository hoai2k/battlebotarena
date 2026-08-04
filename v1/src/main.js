import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import RAPIER from "@dimforge/rapier3d-compat";
import { init as initInstant, id as instantId } from "@instantdb/core";
import { BOT_CONFIG, PHYSICS_ASSISTS, botGroundSpeedFeetPerSecond } from "./botConfig.js?v=bot-speed-mph-1";
import { MODEL_PART_CONFIG } from "./modelPartConfig.js?v=bronco-flipper-1";
import { stepPhysicsArena } from "./arenaPhysicsStep.js";
import { drawnBox, fractionBoundsToBox, modelAuthoringBounds, normalizeSegmentedModel, originalAuthoringBoundsForMesh, splitConfiguredModelParts, splitSegmentedModelParts } from "./modelParts.js";
import {
  armWeaponAngle,
  isArmWeaponEngaged,
  isHeldArmWeapon,
  isNewArmWeapon,
  updateArmWeaponState,
} from "./armWeapons.js";
import { PORTED_BOT_IDS, isPortedBot } from "./portedBots.js";
import { createPhysics } from "./physics.js?v=bot-speed-mph-1";
import { DEFAULT_PHYSICAL_DAMAGE_OPTIONS, applyPhysicalDamageBreak } from "./physicalDamage.js?v=game-config-1";
import { PHYSICAL_DAMAGE_COLLIDER_CARVE, PHYSICAL_DAMAGE_FILL, PHYSICAL_DAMAGE_SYNC_NOTE } from "./physicalDamageShared.js";
import { GAME_CONFIG, MAIN_CONTROL_DEFAULTS, applyControlDefaults } from "./gameConfig.js";
import { ARENA_LAYOUT } from "./arenaConfig.js?v=screw-front-1";
import {
  addKillSawPhysicsColliders,
  addScrewPhysicsColliders,
  applyKillSawHazardEffects,
  applyScrewHazardEffects,
  createKillSawHazardElement,
  createScrewHazardElement,
  screwHazardRotationSpeed,
  updateKillSawHazardVisuals,
} from "./arenaHazards.js?v=kill-saws-lane-pairs-1";
import {
  breakSound,
  driveLoop,
  hazardGrind,
  impactSound,
  initGameAudioUnlock,
  isSoundEnabled,
  killSawAmbient,
  setListenerProvider,
  setSoundEnabled,
  weaponFire,
  weaponLoop,
} from "./gameAudio.js?v=soundscape-1";
import { createMusicPlayer } from "../shared/musicPlayer.js";
import { createArenaVisualRoot as createSharedArenaVisualRoot, upperDeckYawForNearestWall } from "../shared/arenaVisuals.js";

function arenaNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function arenaElementById(id) {
  return ARENA_LAYOUT.elements?.find((element) => element.id === id) || null;
}

function arenaElementPosition(element, fallback = { x: 0, z: 0 }) {
  return {
    x: arenaNumber(element?.position?.x, fallback.x),
    z: arenaNumber(element?.position?.z, fallback.z),
  };
}

function arenaElementSize(element, fallback = [1, 1]) {
  return [
    Math.max(0.01, arenaNumber(element?.size?.x, fallback[0])),
    Math.max(0.01, arenaNumber(element?.size?.z, fallback[1])),
  ];
}

function arenaElementRotationRadians(element, fallback = 0) {
  return THREE.MathUtils.degToRad(arenaNumber(element?.rotation, fallback));
}

function arenaSpawnFromElement(element, fallback) {
  const position = arenaElementPosition(element, fallback);
  return {
    x: position.x,
    y: arenaNumber(element?.spawn?.y, fallback.y),
    z: position.z,
    yaw: THREE.MathUtils.degToRad(arenaNumber(element?.spawn?.yaw, THREE.MathUtils.radToDeg(fallback.yaw))),
  };
}

function arenaWallCapYOffset() {
  const sharedOffset = ARENA_LAYOUT.wallBarriers?.capOffset;
  if (Number.isFinite(sharedOffset)) return THREE.MathUtils.clamp(sharedOffset, -0.42, 2.4);
  const legacyOffsets = Object.values(ARENA_LAYOUT.wallBarriers?.capOffsets || {}).filter(Number.isFinite);
  return THREE.MathUtils.clamp(legacyOffsets[0] || 0, -0.42, 2.4);
}

const canvas = document.querySelector("#scene");
const loadingOverlay = document.querySelector("#loading-overlay");
const loadingMessage = document.querySelector("#loading-message");
const arenaCalloutOverlay = document.querySelector("#arena-callout-overlay");
const fightIntroOverlay = document.querySelector("#fight-intro-overlay");
const pauseOverlay = document.querySelector("#pause-overlay");
const panel = document.querySelector(".panel");
const panelToggle = document.querySelector("#panel-toggle");
const hostArenaButton = document.querySelector("#host-arena");
const joinArenaButton = document.querySelector("#join-arena");
const leaveOnlineButton = document.querySelector("#leave-online");
const onlineStatus = document.querySelector("#online-status");
const picker = document.querySelector(".bot-picker");
const reference = document.querySelector("#reference");
const botName = document.querySelector("#bot-name");
const botNotes = document.querySelector("#bot-notes");
const controllerStatus = document.querySelector("#controller-status");
const lightingInput = document.querySelector("#lighting");
const lightingNumberInput = document.querySelector("#lighting-number");
const gravityInput = document.querySelector("#gravity");
const gravityNumberInput = document.querySelector("#gravity-number");
const groundSpeedInput = document.querySelector("#ground-speed");
const groundSpeedValue = document.querySelector("#ground-speed-value");
const spinnerKnockbackToggleInput = document.querySelector("#spinner-knockback-toggle");
const plowDefenceToggleInput = document.querySelector("#plow-defence-toggle");
const showAllBotsInput = document.querySelector("#show-all-bots");
const teeterAssistToggleInput = document.querySelector("#teeter-assist-toggle");
const colliderComToggleInput = document.querySelector("#collider-com-toggle");
const softFloorCorrectionToggleInput = document.querySelector("#soft-floor-correction-toggle");
const enableDamageToggleInput = document.querySelector("#enable-damage-toggle");
const physicalDamageToggleInput = document.querySelector("#physical-damage-toggle");
const physicalDamageThresholdInput = document.querySelector("#physical-damage-threshold");
const physicalDamageThresholdValue = document.querySelector("#physical-damage-threshold-value");
const physicalDamageHitsRequiredInput = document.querySelector("#physical-damage-hits-required");
const physicalDamageHitsRequiredValue = document.querySelector("#physical-damage-hits-required-value");
const physicalDamageResilienceInput = document.querySelector("#physical-damage-resilience");
const physicalDamageResilienceValue = document.querySelector("#physical-damage-resilience-value");
const physicalDamageRadiusInput = document.querySelector("#physical-damage-radius");
const physicalDamageRadiusValue = document.querySelector("#physical-damage-radius-value");
const physicalDamageMatchRadiusInput = document.querySelector("#physical-damage-match-radius");
const physicalDamageMatchRadiusValue = document.querySelector("#physical-damage-match-radius-value");
const physicalDamageMaxRadiusInput = document.querySelector("#physical-damage-max-radius");
const physicalDamageMaxRadiusValue = document.querySelector("#physical-damage-max-radius-value");
const physicalDamageMaxMatchRadiusInput = document.querySelector("#physical-damage-max-match-radius");
const physicalDamageMaxMatchRadiusValue = document.querySelector("#physical-damage-max-match-radius-value");
const physicalDamageMaxRadiusMultiplierInput = document.querySelector("#physical-damage-max-radius-multiplier");
const physicalDamageMaxRadiusMultiplierValue = document.querySelector("#physical-damage-max-radius-multiplier-value");
const physicalDamageImpulseInput = document.querySelector("#physical-damage-impulse");
const physicalDamageImpulseValue = document.querySelector("#physical-damage-impulse-value");
const physicalDamageMaxPiecesInput = document.querySelector("#physical-damage-max-pieces");
const physicalDamageMaxPiecesValue = document.querySelector("#physical-damage-max-pieces-value");
const physicalDamageFailureThresholdInput = document.querySelector("#physical-damage-failure-threshold");
const physicalDamageFailureThresholdValue = document.querySelector("#physical-damage-failure-threshold-value");
const physicalDamageConvexInput = document.querySelector("#physical-damage-convex");
const physicalDamageSolidFillInput = document.querySelector("#physical-damage-solid-fill");
const showDamageEventsInput = document.querySelector("#show-damage-events-toggle");
const fullscreenToggleButton = document.querySelector("#fullscreen-toggle");
const soundToggleButton = document.querySelector("#sound-toggle");
const physicsLogToggleButton = document.querySelector("#physics-log-toggle");
const physicsLogTypeSelect = document.querySelector("#physics-log-type");
const physicsLogStatus = document.querySelector("#physics-log-status");
const physicsLogOutput = document.querySelector("#physics-log-output");
const playerDamageReadout = document.querySelector("#player-damage");
const rivalDamageReadout = document.querySelector("#rival-damage");
const playerDamageStatus = document.querySelector("#player-damage-status");
const rivalDamageStatus = document.querySelector("#rival-damage-status");
const playerDamageEvents = document.querySelector("#player-damage-events");
const rivalDamageEvents = document.querySelector("#rival-damage-events");
const matchTimerReadout = document.querySelector("#match-timer");
const knockoutBanner = document.querySelector("#knockout-banner");
const roundEndOverlay = document.querySelector("#round-end-overlay");
const roundEndTitle = document.querySelector("#round-end-title");
const roundEndImage = document.querySelector("#round-end-image");
const driveAccelerationInput = document.querySelector("#drive-acceleration");
const driveAccelerationValue = document.querySelector("#drive-acceleration-value");
const turningTightnessInput = document.querySelector("#turning-tightness");
const turningTightnessValue = document.querySelector("#turning-tightness-value");
const yawDampingInput = document.querySelector("#yaw-damping");
const yawDampingValue = document.querySelector("#yaw-damping-value");
const weaponSpinupInput = document.querySelector("#weapon-spinup");
const weaponSpinupValue = document.querySelector("#weapon-spinup-value");
const spinnerImpactCapEnabledInput = document.querySelector("#spinner-impact-cap-enabled");
const spinnerImpactCapInput = document.querySelector("#spinner-impact-cap");
const spinnerImpactCapValue = document.querySelector("#spinner-impact-cap-value");
const spinnerImpactScaleInput = document.querySelector("#spinner-impact-scale");
const spinnerImpactScaleValue = document.querySelector("#spinner-impact-scale-value");
const spinnerGyroScaleInput = document.querySelector("#spinner-gyro-scale");
const spinnerGyroScaleValue = document.querySelector("#spinner-gyro-scale-value");
const debugInfo = document.querySelector("#debug-info");
const colliderTweakerLink = document.querySelector("#collider-tweaker-link");
const botWeightInput = document.querySelector("#bot-weight");
const weaponWeightInput = document.querySelector("#weapon-weight");
const controlSchemeSelect = document.querySelector("#control-scheme");
const weaponRotationalInertiaInput = document.querySelector("#weapon-rotational-inertia");
const showCollidersInput = document.querySelector("#show-colliders");
const testHapticsButton = document.querySelector("#test-haptics");
const hapticsStatus = document.querySelector("#haptics-status");
const colliderViewModeRow = document.querySelector("#collider-view-mode-row");
const colliderViewModeSelect = document.querySelector("#collider-view-mode");
const cameraModeSelect = document.querySelector("#camera-mode");
const cameraDistanceInput = document.querySelector("#camera-distance");
const cameraDistanceNumberInput = document.querySelector("#camera-distance-number");
const cameraHeightInput = document.querySelector("#camera-height");
const cameraHeightNumberInput = document.querySelector("#camera-height-number");
const arenaFovInput = document.querySelector("#arena-fov");
const arenaFovNumberInput = document.querySelector("#arena-fov-number");
const invertOrbitYInput = document.querySelector("#invert-orbit-y");
const opponentSelect = document.querySelector("#opponent-select");
const botConfigSummary = document.querySelector("#bot-config-summary");
const arenaObjectModeSelect = document.querySelector("#arena-object-mode");
const arenaObjectCountInput = document.querySelector("#arena-object-count");
const arenaObjectCountNumberInput = document.querySelector("#arena-object-count-number");
const arenaResetButton = document.querySelector("#arena-reset");
const useHapticsInput = document.querySelector("#use-haptics");
const battleToggleButton = document.querySelector("#battle-toggle");
const modeButtons = [...document.querySelectorAll("[data-mode]")];

applyControlDefaults(MAIN_CONTROL_DEFAULTS);

const BOT_BUILDERS = {
  biteforce: buildBiteForce,
  bronco: buildBronco,
  huge: buildHuge,
  quantum: buildQuantum,
  hypershock: buildHypershock,
  minotaur: buildMinotaur,
  // Every bot ported from v2 builds the same way: its GLB is already segmented,
  // so there is one builder for all of them rather than one function per bot.
  ...Object.fromEntries(PORTED_BOT_IDS.map((id) => [id, () => buildConfiguredModelBot(id)])),
};

const BOT_PICKER_ORDER = ["bronco", "biteforce", "huge", "quantum", "hypershock", "minotaur", ...PORTED_BOT_IDS];
const GAME_HIDDEN_BOT_IDS = new Set();
const bots = Object.entries(BOT_CONFIG).map(([id, config]) => ({
  id,
  ...config,
  builder: BOT_BUILDERS[id],
})).sort((a, b) => BOT_PICKER_ORDER.indexOf(a.id) - BOT_PICKER_ORDER.indexOf(b.id));
const initialUrlParams = new URLSearchParams(window.location.search);
const initialBotParam = initialUrlParams.get("bot");
const initialOpponentParam = initialUrlParams.get("opponent");
const initialSelectedBot = bots.find((bot) => bot.id === initialBotParam && isGameBotVisible(bot));
const initialOpponentBot = bots.find((bot) => bot.id === initialOpponentParam && isGameBotVisible(bot));

const INSTANT_APP_ID = "96e3e93f-4644-4596-a02f-40e8ae915138";
const ONLINE_ROOM_ENTITY = "arenaRooms";
const ONLINE_LOBBY_STALE_MS = 18_000;
const ONLINE_HEARTBEAT_MS = 5_000;
const ONLINE_INPUT_SEND_MS = 50;
const ONLINE_SNAPSHOT_SEND_MS = 33;
const ONLINE_INTERPOLATION_DELAY_MS = 105;
const ONLINE_MAX_PENDING_INPUTS = 90;
const ONLINE_MAX_SNAPSHOT_BUFFER = 12;
const ONLINE_RECONCILE_SOFT_DISTANCE = 0.35;
const ONLINE_RECONCILE_HARD_DISTANCE = 1.4;
const ONLINE_WAITING_MESSAGE = "Waiting for players to join...";
const onlineClientId = instantId();
const onlinePlayerName = `player ${onlineClientId.slice(0, 4)}`;
const onlineDb = initInstant({ appId: INSTANT_APP_ID, devtool: false });
const physics = createPhysics({ THREE, RAPIER });
const online = {
  role: null,
  state: "idle",
  roomId: null,
  recordId: null,
  room: null,
  unsubLobby: null,
  unsubTopics: [],
  hostedRooms: [],
  hostClientId: null,
  joinerClientId: null,
  player1BotId: null,
  player2BotId: null,
  message: "Online idle",
  lastHeartbeatAt: 0,
  lastInputSentAt: 0,
  lastSnapshotSentAt: 0,
  lastFrame: 0,
  remoteInput: completeDriveInput({ weapon: false }),
  lastRemoteInputAt: 0,
  nextInputSeq: 1,
  lastSentInputSignature: "",
  pendingInputs: [],
  lastProcessedJoinerInputSeq: 0,
  remoteSnapshotBuffer: [],
  latestSnapshot: null,
  lastAppliedSnapshotFrame: -1,
  pauseOwnerClientId: null,
};

let selected = initialSelectedBot || bots.find((bot) => bot.id === "bronco") || bots[0];
let opponent = initialOpponentBot && initialOpponentBot.id !== selected.id
  ? initialOpponentBot
  : bots.find((bot) => bot.id !== selected.id && isGameBotVisible(bot)) || bots.find((bot) => bot.id !== selected.id) || bots[0];
let mode = "viewer";
let cameraModeExplicitlySet = false;
let viewerBot;
let viewerColliderHelper = null;
const debugInfoOpenByBot = new Map();
const gamepadHapticState = new Map();
let arena;
const physicsLogRecorder = {
  active: false,
  startedAt: 0,
  stoppedAt: 0,
  frames: 0,
  maxSamples: 20000,
  droppedSamples: 0,
  samples: [],
  events: [],
  meta: null,
};
let rapierReady = false;
let mouseDown = false;
let arenaPaused = false;
let panelAutoExpandedForPause = false;
let testArenaInputs = null;
let loadingDepth = 0;
let loadingGeneration = 0;
let loadingTaskId = 0;
const loadingTasks = new Map();
const modelLoadPromises = new Map();
const modelLoadFailures = new Set();
let lazyModelQueueStarted = false;
const gamepadButtonState = new Map();
let panMode = false;
let lastPointer = new THREE.Vector2();
let lastCameraInputAt = 0;
let orbitYaw = -0.55;
let orbitPitch = 0.28;
let orbitDistance = 7.6;
const orbitTarget = new THREE.Vector3(-1.2, 0.75, 0);
const followCameraPosition = new THREE.Vector3();
const followCameraTarget = new THREE.Vector3();
const battleCameraPosition = new THREE.Vector3();
const battleCameraTarget = new THREE.Vector3();
let followCameraYaw = -0.7;
let followCameraYawOffset = 0;
let followCameraPitchOffset = 0;
let followCameraNeedsSnap = true;
let battleCameraYawOffset = 0;
let battleCameraPitchOffset = 0;
let battleCameraDistanceOffset = 0;
const battleCameraPanOffset = new THREE.Vector3();
let fightIntro = null;
let fightIntroPreviewRoot = null;
let cachedArenaVisualRoot = null;
let cachedArenaVisualRootReady = false;
let arenaIntroStartPending = false;
let fightIntroWarmRenderTarget = null;
const BRONCO_FLIPPER_LOWERED_ANGLE = -0.34;
const BRONCO_FLIPPER_RAISED_ANGLE = 0.0;
const IMPULSE_FLIPPER_RETURN_SLOW_FRACTION = 0.9;
const IMPULSE_FLIPPER_RETURN_SNAP_SECONDS = 0.18;
const QUANTUM_CRUSHER_OPEN_ANGLE = 0;
const QUANTUM_CRUSHER_CLOSED_ANGLE = -1.05;
const urlParams = new URLSearchParams(window.location.search);
const debugMode = urlParams.has("debug");
document.body.dataset.debug = String(debugMode);
const debugHugeSplit = urlParams.has("debugHugeSplit");
const TANK_DRIVE_MAX_SPEED = 3.682;
const WHEEL_ANIMATION_SPEED_SCALE = 0.17;
const HUGE_WHEEL_ANIMATION_LEFT_CENTER_X_RATIO = 0.19;
const HUGE_WHEEL_ANIMATION_RIGHT_CENTER_X_RATIO = 0.19;
const HUGE_WHEEL_ANIMATION_CENTER_Y_RATIO = 0.48;
const HUGE_WHEEL_ANIMATION_INNER_RADIUS_THRESHOLD = 0.1;
const HUGE_WHEEL_ANIMATION_OUTER_RADIUS_THRESHOLD = 0.72;

function currentForegroundLoadingTasks() {
  return [...loadingTasks.values()].filter((task) => task.generation === loadingGeneration);
}

function syncLoadingOverlay(message = "Loading") {
  const tasks = currentForegroundLoadingTasks();
  const active = tasks.length > 0;
  document.body.dataset.loading = active ? "true" : "false";
  if (loadingMessage) {
    loadingMessage.textContent = active
      ? tasks.map((task) => task.detail || task.message).join("\n")
      : message;
  }
  if (loadingOverlay) loadingOverlay.hidden = !active;
}

function loadingDetail(title, lines = []) {
  return [title, ...lines.filter(Boolean)].join("\n");
}

function bumpLoadingPriority() {
  loadingGeneration += 1;
  syncLoadingOverlay();
  return loadingGeneration;
}

function beginLoading(message = "Loading", { detail = "", generation = loadingGeneration } = {}) {
  loadingDepth += 1;
  const id = ++loadingTaskId;
  loadingTasks.set(id, {
    message,
    detail: detail || message,
    generation,
    startedAt: performance.now(),
  });
  syncLoadingOverlay(message);
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    loadingDepth = Math.max(0, loadingDepth - 1);
    loadingTasks.delete(id);
    syncLoadingOverlay(message);
  };
  end.update = (detail) => {
    const task = loadingTasks.get(id);
    if (!task) return;
    task.detail = detail || task.message;
    syncLoadingOverlay(task.message);
  };
  end.setBackground = () => {
    const task = loadingTasks.get(id);
    if (!task) return;
    task.generation = -1;
    syncLoadingOverlay(task.message);
  };
  return end;
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function botDisplayName(id) {
  return bots.find((bot) => bot.id === id)?.name || MODEL_PART_CONFIG[id]?.name || id;
}

function syncBotUrlState() {
  if (!selected?.id || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  const previous = url.search;
  url.searchParams.set("bot", selected.id);
  if (opponent?.id) url.searchParams.set("opponent", opponent.id);
  if (url.search === previous) return;
  window.history.replaceState(window.history.state, "", url);
}

function markControlPending(control) {
  if (!control) return;
  const target = control.closest?.("button, label, select, input") || control;
  target.classList.add("control-pending");
  window.setTimeout(() => target.classList.remove("control-pending"), 220);
}

function bindImmediateControlFeedback(root = document) {
  root.addEventListener("pointerdown", (event) => {
    markControlPending(event.target.closest("button, label.switch, select, input[type='checkbox']"));
  }, true);
  root.addEventListener("change", (event) => {
    markControlPending(event.target.closest("button, label, select, input"));
  }, true);
}
const HUGE_WHEEL_ANIMATION_SIDE_X_THRESHOLD = 0.17;
let broncoModel = null;
let broncoModelFailed = false;
let hugeModel = null;
let hugeModelFailed = false;
let quantumModel = null;
let quantumModelFailed = false;
let biteforceModel = null;
let biteforceModelFailed = false;
let hypershockModel = null;
let hypershockModelFailed = false;
let minotaurModel = null;
let minotaurModelFailed = false;
// Every loaded GLB, ported roster included. The named handles above stay for
// the six bots whose viewer/builder code refers to them directly.
const loadedModels = new Map();

const keys = new Set();
const clock = new THREE.Clock();
const scene = new THREE.Scene();
const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();
const ARENA_WIDTH = arenaNumber(ARENA_LAYOUT.dimensions?.width, 34);
const ARENA_LENGTH = arenaNumber(ARENA_LAYOUT.dimensions?.length, 26);
const ARENA_HALF_WIDTH = ARENA_WIDTH / 2;
const ARENA_HALF_LENGTH = ARENA_LENGTH / 2;
const ARENA_FLOOR_Y = arenaNumber(ARENA_LAYOUT.dimensions?.floorY, 0);
const ARENA_VISUAL_FLOOR_THICKNESS = arenaNumber(ARENA_LAYOUT.dimensions?.visualFloorThickness, 0.16);
const ARENA_PHYSICS_FLOOR_HALF_HEIGHT = arenaNumber(ARENA_LAYOUT.dimensions?.physicsFloorHalfHeight, 0.05);
const ARENA_VISUAL_FLOOR_Y = ARENA_FLOOR_Y;
const ARENA_PHYSICS_FLOOR_Y = ARENA_FLOOR_Y;
const ARENA_PHYSICS_FLOOR_BODY_Y = ARENA_FLOOR_Y - ARENA_PHYSICS_FLOOR_HALF_HEIGHT;
const ARENA_FLOOR_DECAL_Y = ARENA_VISUAL_FLOOR_Y + 0.006;
const PHYSICS2_SPAWN_CLEARANCE = 0;
const DEFAULT_GRAVITY_Y = GAME_CONFIG.physics.gravityY;
const PHYSICS_LOG_STORAGE_KEY = "battleBotArena.physics.lastLog";
const ARENA_CEILING_HEIGHT = arenaNumber(ARENA_LAYOUT.dimensions?.ceilingHeight, 9.45);
const ARENA_WALL_BASE_Y = arenaNumber(ARENA_LAYOUT.dimensions?.wallBaseY, 0.58);
const ARENA_WALL_HEIGHT = ARENA_CEILING_HEIGHT - ARENA_WALL_BASE_Y;
const CAMERA_BOUND_PADDING = 0.42;
const CAMERA_OUTSIDE_MARGIN = 4.6;
const ARENA_WHEEL_DOLLY_SPEED = 0.0048;
const PLAYER_START_ELEMENT = arenaElementById("player-start");
const RIVAL_START_ELEMENT = arenaElementById("rival-start");
const PLAYER_SPAWN = arenaSpawnFromElement(PLAYER_START_ELEMENT, { x: 0, y: 0.55, z: ARENA_HALF_LENGTH - 2.25, yaw: 0 });
const RIVAL_SPAWN = arenaSpawnFromElement(RIVAL_START_ELEMENT, { x: 0, y: 0.55, z: -ARENA_HALF_LENGTH + 2.25, yaw: Math.PI });
const SEGMENTED_MODEL_SURFACE = { metalness: 0.28, roughness: 0.42 };
const MODEL_BACKED_BOTS = new Set(["biteforce", "bronco", "huge", "quantum", "hypershock", "minotaur", ...PORTED_BOT_IDS]);
const HUGE_SPINNER_BREAK_SPEED_RATIO = 0.72;
const HUGE_SPINNER_FULL_SPEED = 145;
const HUGE_SPINNER_SPIN_UP_SECONDS = 5;
const HUGE_SPINNER_SPIN_DOWN_SECONDS = 0.8;
const SPINNER_GEOMETRY_BLOCK_SPEED_RATIO = 0.34;
const HUGE_SPINNER_PIVOT_OFFSET = {
  x: 0,
  y: -0.014,
  z: 0,
};
const HUGE_CLIMB_ASSIST_IMPULSE = 0.16;
const HUGE_CLIMB_ASSIST_FORWARD_THRESHOLD = 0.52;
const HUGE_CLIMB_ASSIST_MAX_HEIGHT = 1.12;
const HUGE_CLIMB_ASSIST_PROBE_DISTANCE = 1.35;
const HUGE_CLIMB_ASSIST_PROBE_HEIGHT = 0.55;
const HUGE_CLIMB_ASSIST_SIDE_TORQUE = 0.28;
const QUANTUM_CHAIR_BREAK_SECONDS = 5;
const CHAIR_BREAK_STRESS = 2.4;
const CHAIR_PHYSICS_STRESS_RATE = 0.22;
const BOT_TURN_RATE = 3.8;
const DEFAULT_BOT_ACCELERATION = GAME_CONFIG.botTuningFallbacks.driveAcceleration;
const DEFAULT_BOT_TURNING_TIGHTNESS = GAME_CONFIG.botTuningFallbacks.turningTightness;
const MOMENTUM_REFERENCE_WEIGHT_LBS = 80;
const WEAPON_ENERGY_SCALE = 0.0065;
const WEAPON_KICKBACK_SCALE = 0.32;
const SPINNER_TARGET_IMPULSE_SCALE = 1.18;
const SPINNER_TARGET_LIFT_SCALE = 0.78;
const SPINNER_TARGET_TORQUE_SCALE = 0.72;
const SPINNER_ATTACKER_TORQUE_SCALE = 0.38;
const WEAPON_SPIN_LOSS_SCALE = 0.18;
const WEAPON_HIT_COOLDOWN_SECONDS = 0.16;
const SPINNER_GYRO_TORQUE_SCALE = 0.012;
const HAPTIC_COLLISION_COOLDOWN_SECONDS = 0.05;
const HAPTIC_WEAPON_COOLDOWN_SECONDS = 0.04;
const BOT_LINEAR_DAMPING = 0.34;
const BOT_ANGULAR_DAMPING = 0;
const DAMAGE_MARK_MIN_AMOUNT = 0.22;
const DEFAULT_BOT_MAX_HP = 1000;
const DAMAGE_TUNING_TO_DISPLAY_HP = DEFAULT_BOT_MAX_HP / 5000;
const DAMAGE_PART_WARNING_THRESHOLD = 30;
const DAMAGE_PART_KILL_THRESHOLD = 40;
const DAMAGE_TOTAL_KILL_THRESHOLD = 100;
const MATCH_DURATION_SECONDS = arenaNumber(GAME_CONFIG.battle?.matchDurationSeconds, 180);
const KILL_SAW_START_REMAINING_SECONDS = arenaNumber(GAME_CONFIG.battle?.killSawStartRemainingSeconds, 60);
const KILL_SAW_CALLOUT_SECONDS = arenaNumber(GAME_CONFIG.battle?.killSawCalloutSeconds, 3.2);
const KNOCKOUT_DELAY_SECONDS = 6;
const DAMAGE_EVENT_CONFIG = GAME_CONFIG.damageEvents || {};
const DAMAGE_EVENT_DISPLAY_SECONDS = DAMAGE_EVENT_CONFIG.normalDisplaySeconds ?? 1;
const NOTABLE_DAMAGE_EVENT_DISPLAY_SECONDS = DAMAGE_EVENT_CONFIG.notableDisplaySeconds ?? 3;
const NOTABLE_DAMAGE_EVENT_HP = DAMAGE_EVENT_CONFIG.notableHpThreshold ?? 10;
const MAJOR_DAMAGE_EVENT_DISPLAY_SECONDS = DAMAGE_EVENT_CONFIG.majorDisplaySeconds ?? 7;
const MAJOR_DAMAGE_EVENT_HP = DAMAGE_EVENT_CONFIG.majorHpThreshold ?? 50;
const CONTINUOUS_DAMAGE_EVENT_SECONDS = 1;
const CONTINUOUS_DAMAGE_KINDS = new Set(["screwHazard", "killSawHazard"]);
const QUANTUM_BITE_INITIAL_DAMAGE_HP = 10;
const QUANTUM_BITE_DEBRIS_NEUTRAL_EPSILON = 0.045;
const DAMAGE_COLLISION_COOLDOWN_SECONDS = 0.18;
const FIXED_PHYSICS_DT = 1 / 60;
const MAX_PHYSICS_SUBSTEPS = 5;
const BRONCO_SELF_RIGHT_COOLDOWN_SECONDS = 0.42;
const BRONCO_FLIPPER_LIFT_IMPULSE = 12.8;
const BRONCO_FLIPPER_ROLL_TORQUE = 15.2;
const BRONCO_FLIPPER_FORWARD_IMPULSE = 1.6;
const IMPULSE_WEAPON_STROKE_SECONDS = 0.38;
const IMPULSE_WEAPON_IMPACT_DELAY_SECONDS = 0.07;
const STABLE_DRIVE_EXIT_SECONDS = 1.05;
const AI_ENGAGE_DISTANCE = 7.0;
const AI_STRIKE_DISTANCE = 4.15;
const AI_ESCAPE_DISTANCE = 5.6;
const AI_WALL_PRESSURE_DISTANCE = 2.4;
const AI_RETREAT_SECONDS = 0.85;
const AI_REAIM_SECONDS = 0.42;
const AI_MAX_ATTACK_SECONDS = 1.35;
const PROP_WEIGHT_LBS = {
  chair: 22,
  barbell: 120,
  simpleCube: 55,
  simpleSphere: 45,
  simpleCylinder: 65,
  simpleBar: 80,
  chairPiece: 4,
};
scene.background = new THREE.Color(0x101314);
scene.fog = new THREE.Fog(0x101314, 24, 58);

const camera = new THREE.PerspectiveCamera(48, (canvas.clientWidth || window.innerWidth) / (canvas.clientHeight || window.innerHeight), 0.05, 120);
setListenerProvider(() => camera);
initGameAudioUnlock();
const music = createMusicPlayer({ basePath: "../public/music/", isEnabled: isSoundEnabled });
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const hemi = new THREE.HemisphereLight(0xdbe8ff, 0x15130f, 1.6);
scene.add(hemi);
const keyLight = new THREE.DirectionalLight(0xffffff, 3.1);
keyLight.position.set(-4.5, 7.5, 5.5);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -19;
keyLight.shadow.camera.right = 19;
keyLight.shadow.camera.top = 16;
keyLight.shadow.camera.bottom = -16;
keyLight.shadow.camera.near = 1;
keyLight.shadow.camera.far = 32;
keyLight.shadow.bias = -0.00025;
keyLight.shadow.normalBias = 0.025;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0xf5b454, 1.3);
rimLight.position.set(5, 4, -6);
scene.add(rimLight);

function loadTexture(path, repeat = [1, 1]) {
  const texture = textureLoader.load(path);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(...repeat);
  texture.anisotropy = 8;
  return texture;
}

const floorTileTexture = loadTexture("./public/arena/bb_arena_tile.png", [8, 8]);
const arenaLogoTexture = textureLoader.load("./public/arena/bb_arena_logo_alpha.png");
arenaLogoTexture.colorSpace = THREE.SRGBColorSpace;
arenaLogoTexture.anisotropy = 8;
const killSawTexture = textureLoader.load("./public/arena/kill_saw_alpha.png");
killSawTexture.colorSpace = THREE.SRGBColorSpace;
killSawTexture.anisotropy = 8;
const battleBoxMetalTexture = loadTexture("../public/arena/battlebox_metal.png", [3.4, 1]);
const battleBoxYellowTexture = loadTexture("../public/arena/battlebox_yellow.png", [3.2, 1]);
const screwMetalTexture = loadTexture("../public/arena/screw_metal.png", [2.8, 1]);
const upperDeckTexture = loadTexture("../public/arena/upper_deck.png", [1.6, 0.8]);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(42, 42),
  new THREE.MeshStandardMaterial({
    color: 0x7d8581,
    roughness: 0.34,
    metalness: 0.42,
    map: floorTileTexture,
  }),
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const materials = {};

function mat(name, color, metalness = 0.72, roughness = 0.36) {
  if (!materials[name]) {
    materials[name] = new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness,
      map: makeScratchTexture("#303333", "#ffffff", 0.22),
    });
  }
  return materials[name];
}

const black = mat("black", 0x111111, 0.64, 0.44);
const dark = mat("dark", 0x222524, 0.78, 0.32);
const physicalDamageSolidFillMaterial = dark.clone();
physicalDamageSolidFillMaterial.side = THREE.DoubleSide;
const physicalDamagePreviewMeshes = new Set();
const physicalDamagePreviewQueue = new Set();
let physicalDamagePreviewQueueScheduled = false;
const steel = mat("steel", 0x9d9c92, 0.94, 0.22);
const chrome = mat("chrome", 0xd6d3c7, 1, 0.12);
const white = mat("white", 0xdedbd1, 0.45, 0.5);
const blue = mat("blue", 0x104c94, 0.68, 0.34);
const red = mat("red", 0xa9241d, 0.55, 0.42);
const tire = mat("tire", 0x111111, 0.25, 0.74);

function makeScratchTexture(base, line, density) {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
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
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

function damageEnabled() {
  return enableDamageToggleInput?.checked !== true;
}

function physicalDamageEnabled() {
  return damageEffectsEnabled() && physicalDamageToggleInput?.checked === true;
}

function pairedRangeNumberValue(range, number, fallback = 0) {
  const value = Number(number?.value ?? range?.value ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

function physicalDamageOptions() {
  return {
    ...DEFAULT_PHYSICAL_DAMAGE_OPTIONS,
    enabled: physicalDamageEnabled(),
    threshold: pairedRangeNumberValue(physicalDamageThresholdInput, physicalDamageThresholdValue, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.threshold),
    significantHitsRequired: pairedRangeNumberValue(
      physicalDamageHitsRequiredInput,
      physicalDamageHitsRequiredValue,
      DEFAULT_PHYSICAL_DAMAGE_OPTIONS.significantHitsRequired,
    ),
    resilience: pairedRangeNumberValue(physicalDamageResilienceInput, physicalDamageResilienceValue, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.resilience),
    breakRadius: pairedRangeNumberValue(physicalDamageRadiusInput, physicalDamageRadiusValue, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.breakRadius),
    primeMatchRadius: pairedRangeNumberValue(physicalDamageMatchRadiusInput, physicalDamageMatchRadiusValue, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.primeMatchRadius),
    maxBreakRadius: pairedRangeNumberValue(physicalDamageMaxRadiusInput, physicalDamageMaxRadiusValue, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.maxBreakRadius),
    maxPrimeMatchRadius: pairedRangeNumberValue(physicalDamageMaxMatchRadiusInput, physicalDamageMaxMatchRadiusValue, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.maxPrimeMatchRadius),
    maxRadiusDamageMultiplier: pairedRangeNumberValue(
      physicalDamageMaxRadiusMultiplierInput,
      physicalDamageMaxRadiusMultiplierValue,
      DEFAULT_PHYSICAL_DAMAGE_OPTIONS.maxRadiusDamageMultiplier,
    ),
    impulseScale: pairedRangeNumberValue(physicalDamageImpulseInput, physicalDamageImpulseValue, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.impulseScale),
    maxPiecesPerBot: pairedRangeNumberValue(physicalDamageMaxPiecesInput, physicalDamageMaxPiecesValue, DEFAULT_PHYSICAL_DAMAGE_OPTIONS.maxPiecesPerBot),
    convexCollider: physicalDamageConvexInput?.checked !== false,
  };
}

function physicalDamagePreviewHash(value) {
  const x = Math.sin(value * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function dentedPreviewNormal(baseNormal, point, triangleIndex) {
  const normal = baseNormal?.clone?.() || new THREE.Vector3(0, 1, 0);
  if (normal.lengthSq() < 0.000001) normal.set(0, 1, 0);
  normal.normalize();
  const tangentSeed = Math.abs(normal.y) < 0.82 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const tangent = tangentSeed.cross(normal).normalize();
  const bitangent = normal.clone().cross(tangent).normalize();
  const scale = 7.5;
  const n1 = physicalDamagePreviewHash(point.x * scale + point.z * 3.1 + triangleIndex * 0.73) - 0.5;
  const n2 = physicalDamagePreviewHash(point.y * scale - point.x * 2.7 + triangleIndex * 1.19) - 0.5;
  return normal
    .addScaledVector(tangent, n1 * 0.72)
    .addScaledVector(bitangent, n2 * 0.72)
    .normalize();
}

function disposePhysicalDamagePreview(candidate) {
  const mesh = candidate?.previewMesh;
  if (candidate) physicalDamagePreviewQueue.delete(candidate);
  if (!mesh) return;
  physicalDamagePreviewMeshes.delete(mesh);
  mesh.geometry?.dispose?.();
  mesh.material?.dispose?.();
  mesh.parent?.remove(mesh);
  candidate.previewMesh = null;
}

function clearPhysicalDamagePreviews(fighter = null) {
  if (fighter?.physicalDamagePrimedBreaks) {
    fighter.physicalDamagePrimedBreaks.forEach(disposePhysicalDamagePreview);
    return;
  }
  physicalDamagePreviewMeshes.forEach((mesh) => {
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
    mesh.parent?.remove(mesh);
  });
  physicalDamagePreviewMeshes.clear();
  physicalDamagePreviewQueue.clear();
}

function triangleCentroidAttribute(position, tri, target = new THREE.Vector3()) {
  return target.set(
    (position.getX(tri[0]) + position.getX(tri[1]) + position.getX(tri[2])) / 3,
    (position.getY(tri[0]) + position.getY(tri[1]) + position.getY(tri[2])) / 3,
    (position.getZ(tri[0]) + position.getZ(tri[1]) + position.getZ(tri[2])) / 3,
  );
}

function makeBreakEdgeFadeMaterial({ opacity = 1 } = {}) {
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
        float alpha = max(0.18, vEdgeAlpha) * opacity;
        gl_FragColor = vec4(0.006, 0.005, 0.004, alpha);
      }
    `,
  });
}

function breakEdgeAlpha(point, localPoint, hitNormal, radius, falloff, band) {
  const offset = point.clone().sub(localPoint);
  const distance = offset.length();
  const directional = distance > 0.00001 ? Math.max(0, offset.multiplyScalar(1 / distance).dot(hitNormal)) : 0;
  const limit = radius * (1 + directional * falloff);
  const t = THREE.MathUtils.clamp(1 - Math.max(0, limit - distance) / Math.max(0.001, band), 0, 1);
  return t * t * (3 - 2 * t);
}

function buildPhysicalDamagePreviewMesh(candidate, options = physicalDamageOptions()) {
  // This scans mesh triangles, so callers must keep it behind queuePhysicalDamagePreviewBuild().
  // Do not call this directly from physics/collision handling.
  const mesh = candidate?.mesh;
  const geometry = mesh?.geometry;
  const position = geometry?.attributes?.position;
  if (!mesh?.parent || !position || candidate.committed || candidate.status === "failed") return null;
  const index = geometry.index;
  const normal = geometry.attributes.normal;
  const uv = geometry.attributes.uv || geometry.attributes.uv0;
  const triangleCount = index ? index.count / 3 : position.count / 3;
  const radius = Math.max(0.08, Number(candidate.breakRadius) || Number(options.breakRadius) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.breakRadius);
  const falloff = Math.max(0.05, Number(options.radialFalloff) || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.radialFalloff);
  const hitNormal = candidate.lastHitNormal?.clone?.().transformDirection(mesh.matrixWorld.clone().invert()).normalize() || new THREE.Vector3(0, 1, 0);
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
    const directional = distance > 0.00001 ? Math.max(0, offset.multiplyScalar(1 / distance).dot(hitNormal)) : 0;
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
      if (normal) {
        const dented = dentedPreviewNormal(
          new THREE.Vector3(normal.getX(vertexIndex), normal.getY(vertexIndex), normal.getZ(vertexIndex)),
          point,
          triangleIndex,
        );
        normals.push(dented.x, dented.y, dented.z);
      }
      if (uv) uvs.push(uv.getX(vertexIndex), uv.getY(vertexIndex));
      edgeAlphas.push(breakEdgeAlpha(point, localPoint, hitNormal, radius, falloff, edgeBand));
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
  const material = makeBreakEdgeFadeMaterial({ opacity: 0.5 });
  const preview = new THREE.Mesh(previewGeometry, material);
  preview.name = "physicalDamageFutureBreakPreview";
  preview.userData.physicalDamagePreview = true;
  preview.userData.candidate = candidate;
  preview.userData.localPoint = localPoint.toArray();
  preview.renderOrder = 48;
  preview.matrix.copy(mesh.matrix);
  preview.matrix.decompose(preview.position, preview.quaternion, preview.scale);
  mesh.parent.add(preview);
  candidate.previewMesh = preview;
  physicalDamagePreviewMeshes.add(preview);
  return preview;
}

function queuePhysicalDamagePreviewBuild(candidate) {
  if (!candidate || candidate.committed || candidate.status === "failed") return;
  if (candidate.status !== "ready" && candidate.status !== "deferred-interior") return;
  if ((candidate.split?.triangleCount || 0) > 12000) return;
  const previewPoint = candidate.previewMesh?.userData?.localPoint;
  if (candidate.previewMesh && previewPoint) {
    const dx = previewPoint[0] - candidate.localPoint.x;
    const dy = previewPoint[1] - candidate.localPoint.y;
    const dz = previewPoint[2] - candidate.localPoint.z;
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) > 0.08) disposePhysicalDamagePreview(candidate);
  }
  if (candidate.previewMesh) return;
  physicalDamagePreviewQueue.add(candidate);
  if (physicalDamagePreviewQueueScheduled) return;
  physicalDamagePreviewQueueScheduled = true;
  // Preview construction is intentionally idle-queued. Even though the break-edge alpha is
  // O(selected vertices), selecting triangles still walks model geometry and must not run in
  // the collision frame.
  const run = (deadline = null) => {
    physicalDamagePreviewQueueScheduled = false;
    const start = performance.now();
    while (physicalDamagePreviewQueue.size) {
      const candidateToBuild = physicalDamagePreviewQueue.values().next().value;
      physicalDamagePreviewQueue.delete(candidateToBuild);
      const preview = buildPhysicalDamagePreviewMesh(candidateToBuild);
      recordPhysicsLogEvent("physicalDamage", {
        status: "preview-build",
        target: candidateToBuild?.fighterId || null,
        built: Boolean(preview),
        candidate: physicalDamageCandidateLogPayload(candidateToBuild),
      });
      const timeRemaining = typeof deadline?.timeRemaining === "function" ? deadline.timeRemaining() : 0;
      if (performance.now() - start > 4 || (deadline && timeRemaining < 2)) break;
    }
    if (physicalDamagePreviewQueue.size) {
      physicalDamagePreviewQueueScheduled = true;
      if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 120 });
      else window.setTimeout(run, 32);
    }
  };
  if ("requestIdleCallback" in window) window.requestIdleCallback(run, { timeout: 120 });
  else window.setTimeout(run, 32);
}

function updatePhysicalDamagePreviewMeshes() {
  if (!physicalDamageEnabled() || !arena?.fighters?.length) {
    clearPhysicalDamagePreviews();
    return;
  }
  const now = performance.now() * 0.001;
  arena.fighters.forEach((fighter) => {
    (fighter.physicalDamagePrimedBreaks || []).forEach((candidate) => {
      if (candidate.committed || candidate.status === "failed" || candidate.mesh?.geometry !== candidate.sourceGeometry) {
        disposePhysicalDamagePreview(candidate);
        return;
      }
      if (!candidate.previewMesh) queuePhysicalDamagePreviewBuild(candidate);
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
      if (preview.material.uniforms?.opacity) preview.material.uniforms.opacity.value = opacity;
      else preview.material.opacity = opacity;
      preview.visible = true;
    });
  });
}

function damageVector(value, fallback = new THREE.Vector3()) {
  if (!value) return fallback.clone();
  return value.clone ? value.clone() : new THREE.Vector3(value.x || 0, value.y || 0, value.z || 0);
}

function defaultDamageParts() {
  return { left: 0, center: 0, right: 0, weapon: 0 };
}

function fighterGeometryMeshes(fighter) {
  const meshes = [];
  fighter?.group?.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position || child.visible === false) return;
    let node = child;
    while (node) {
      const name = node.name?.toLowerCase?.() || "";
      if (name.includes("colliderpreview")) return;
      node = node.parent;
    }
    meshes.push(child);
  });
  return meshes;
}

function fighterDamageLocalBounds(fighter) {
  if (fighter?.damageLocalBounds) return fighter.damageLocalBounds;
  if (!fighter?.group) return new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  fighter.group.updateMatrixWorld(true);
  const groupInverse = new THREE.Matrix4().copy(fighter.group.matrixWorld).invert();
  const bounds = new THREE.Box3();
  const meshBox = new THREE.Box3();
  fighterGeometryMeshes(fighter).forEach((mesh) => {
    if (!mesh.geometry?.boundingBox) mesh.geometry.computeBoundingBox();
    if (!mesh.geometry?.boundingBox) return;
    const localMatrix = new THREE.Matrix4().multiplyMatrices(groupInverse, mesh.matrixWorld);
    meshBox.copy(mesh.geometry.boundingBox).applyMatrix4(localMatrix);
    bounds.union(meshBox);
  });
  if (bounds.isEmpty()) bounds.set(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
  fighter.damageLocalBounds = bounds;
  return bounds;
}

function matrixMatchesSnapshot(matrix, snapshot) {
  if (!matrix || !snapshot) return false;
  const elements = matrix.elements;
  for (let i = 0; i < 16; i += 1) {
    if (elements[i] !== snapshot[i]) return false;
  }
  return true;
}

function copyMatrixSnapshot(matrix) {
  return matrix?.elements ? matrix.elements.slice(0, 16) : null;
}

function objectBoundsInFighterLocal(fighter, object, { cacheKey = null } = {}) {
  if (!fighter?.group || !object) return null;
  fighter.group.updateMatrixWorld(true);
  object.updateMatrixWorld(true);
  // This helper is reached from damage handling, which can be called by the
  // physics substep. Use transform-keyed caching for moving parts such as
  // weapons; hierarchy traversal and bounding-box transforms are too expensive
  // to repeat for every damage tick in the collision frame.
  const cache = cacheKey ? fighter[cacheKey] : null;
  if (
    cache?.object === object &&
    cache.bounds &&
    matrixMatchesSnapshot(fighter.group.matrixWorld, cache.groupMatrixWorld) &&
    matrixMatchesSnapshot(object.matrixWorld, cache.objectMatrixWorld)
  ) {
    return cache.bounds;
  }
  const groupInverse = new THREE.Matrix4().copy(fighter.group.matrixWorld).invert();
  const bounds = new THREE.Box3();
  const meshBox = new THREE.Box3();
  object.traverse?.((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.position || child.visible === false) return;
    if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
    if (!child.geometry.boundingBox) return;
    const localMatrix = new THREE.Matrix4().multiplyMatrices(groupInverse, child.matrixWorld);
    meshBox.copy(child.geometry.boundingBox).applyMatrix4(localMatrix);
    bounds.union(meshBox);
  });
  if (bounds.isEmpty()) return null;
  if (cacheKey) {
    fighter[cacheKey] = {
      object,
      groupMatrixWorld: copyMatrixSnapshot(fighter.group.matrixWorld),
      objectMatrixWorld: copyMatrixSnapshot(object.matrixWorld),
      bounds,
    };
  }
  return bounds;
}

function damagePointIsOnWeapon(fighter, localPoint) {
  const weaponObject = fighter?.group?.userData?.viewerParts?.weapon || fighter?.weapon?.object;
  const bounds = objectBoundsInFighterLocal(fighter, weaponObject, { cacheKey: "damageWeaponLocalBoundsCache" });
  if (!bounds) return false;
  return bounds.clone().expandByScalar(0.08).containsPoint(localPoint);
}

function damageZoneForLocalPoint(fighter, localPoint) {
  // Physics-frame budget: this function may be called from recordBotDamage while
  // resolving collision damage. Keep it to cached bounds and scalar checks only.
  if (damagePointIsOnWeapon(fighter, localPoint)) return "weapon";
  const bounds = fighterDamageLocalBounds(fighter);
  const width = Math.max(0.001, bounds.max.x - bounds.min.x);
  const fraction = THREE.MathUtils.clamp((localPoint.x - bounds.min.x) / width, 0, 1);
  if (fraction < 1 / 3) return "left";
  if (fraction > 2 / 3) return "right";
  return "center";
}

function damageEffectsEnabled() {
  return damageEnabled();
}

function fighterPartDamage(fighter, part) {
  return Number(fighter?.damageParts?.[part] || 0);
}

function physicalDamageFailureThreshold() {
  return pairedRangeNumberValue(
    physicalDamageFailureThresholdInput,
    physicalDamageFailureThresholdValue,
    DEFAULT_PHYSICAL_DAMAGE_OPTIONS.failureThreshold,
  );
}

function colliderPartVolumeForFailure(part) {
  const half = (part?.halfExtents || [0, 0, 0]).map((value) => Math.max(0, Math.abs(value)));
  if (!half.every((value) => Number.isFinite(value))) return 0;
  if (part.type === "cylinder") {
    const radius = Math.max(0, (half[1] + half[2]) * 0.5);
    return Math.PI * radius * radius * half[0] * 2;
  }
  return half[0] * 2 * half[1] * 2 * half[2] * 2;
}

function systemKeyForColliderPart(part) {
  if (part?.part === "weapon") return "weapon";
  if (part?.part === "driveContact") return part.side === "right" || part.position?.[0] > 0 ? "rightDrive" : "leftDrive";
  return null;
}

function colliderPartLateralBounds(part) {
  const halfX = Math.max(0, Math.abs(part?.halfExtents?.[0] || 0));
  const centerX = Number(part?.position?.[0] || 0);
  return { minX: centerX - halfX, maxX: centerX + halfX };
}

function overlapWidth(minA, maxA, minB, maxB) {
  return Math.max(0, Math.min(maxA, maxB) - Math.max(minA, minB));
}

function colliderPartSideVolumeFractions(part, lateralRegions = null) {
  const { minX, maxX } = colliderPartLateralBounds(part);
  const width = Math.max(0.000001, maxX - minX);
  if (!lateralRegions) {
    if (width <= 0.000001) return minX < 0 ? { left: 1, center: 0, right: 0 } : { left: 0, center: 0, right: 1 };
    const leftWidth = THREE.MathUtils.clamp(Math.min(0, maxX) - minX, 0, width);
    const rightWidth = THREE.MathUtils.clamp(maxX - Math.max(0, minX), 0, width);
    return { left: leftWidth / width, center: 0, right: rightWidth / width };
  }
  const leftWidth = overlapWidth(minX, maxX, lateralRegions.left.min, lateralRegions.left.max);
  const centerWidth = overlapWidth(minX, maxX, lateralRegions.center.min, lateralRegions.center.max);
  const rightWidth = overlapWidth(minX, maxX, lateralRegions.right.min, lateralRegions.right.max);
  const total = Math.max(0.000001, leftWidth + centerWidth + rightWidth);
  return {
    left: leftWidth / total,
    center: centerWidth / total,
    right: rightWidth / total,
  };
}

function colliderSystemVolumes(parts = []) {
  const totals = { leftDrive: 0, rightDrive: 0, weapon: 0, leftSide: 0, centerSide: 0, rightSide: 0 };
  const bodyParts = parts.filter((part) => !systemKeyForColliderPart(part));
  const lateralBounds = bodyParts.reduce((bounds, part) => {
    const { minX, maxX } = colliderPartLateralBounds(part);
    bounds.min = Math.min(bounds.min, minX);
    bounds.max = Math.max(bounds.max, maxX);
    return bounds;
  }, { min: Infinity, max: -Infinity });
  const lateralWidth = lateralBounds.max - lateralBounds.min;
  const lateralRegions = Number.isFinite(lateralWidth) && lateralWidth > 0.000001
    ? {
      left: { min: lateralBounds.min, max: lateralBounds.min + lateralWidth / 3 },
      center: { min: lateralBounds.min + lateralWidth / 3, max: lateralBounds.min + (lateralWidth * 2) / 3 },
      right: { min: lateralBounds.min + (lateralWidth * 2) / 3, max: lateralBounds.max },
    }
    : null;
  parts.forEach((part) => {
    const volume = colliderPartVolumeForFailure(part);
    const key = systemKeyForColliderPart(part);
    if (key) {
      totals[key] += volume;
      return;
    }
    const side = colliderPartSideVolumeFractions(part, lateralRegions);
    totals.leftSide += volume * side.left;
    totals.centerSide += volume * side.center;
    totals.rightSide += volume * side.right;
  });
  return totals;
}

function ensurePhysicalDamageBaseline(fighter) {
  if (fighter?.physicalDamageColliderBaseline) return fighter.physicalDamageColliderBaseline;
  const parts = fighter?.physicalDamageOriginalColliderParts?.length
    ? fighter.physicalDamageOriginalColliderParts
    : fighter?.colliderParts?.length
    ? fighter.colliderParts
    : [];
  const baseline = colliderSystemVolumes(parts);
  fighter.physicalDamageColliderBaseline = baseline;
  return baseline;
}

function physicalDamageSystemLossPercent(fighter, key) {
  if (!fighter) return 0;
  const replicated = fighter.onlineDamageState?.systemLossPercent?.[key];
  if (Number.isFinite(replicated)) return THREE.MathUtils.clamp(replicated, 0, 100);
  const baseline = ensurePhysicalDamageBaseline(fighter);
  const original = baseline?.[key] || 0;
  if (original <= 0) return 0;
  const current = colliderSystemVolumes(fighter.colliderParts || [])[key] || 0;
  return THREE.MathUtils.clamp((1 - current / original) * 100, 0, 100);
}

function boxVolume(box) {
  if (!box || !Number.isFinite(box.min?.x) || !Number.isFinite(box.max?.x)) return 0;
  const width = Math.max(0, box.max.x - box.min.x);
  const height = Math.max(0, box.max.y - box.min.y);
  const depth = Math.max(0, box.max.z - box.min.z);
  return width * height * depth;
}

function physicalDamageRemovedBoundingBoxPercent(candidate) {
  const geometry = candidate?.split?.pieceGeometry;
  const totalBounds = candidate?.capBounds;
  if (!geometry?.attributes?.position || !totalBounds) return 0;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const removedVolume = boxVolume(geometry.boundingBox);
  const totalVolume = boxVolume(totalBounds);
  if (removedVolume <= 0 || totalVolume <= 0) return 0;
  return THREE.MathUtils.clamp((removedVolume / totalVolume) * 100, 0, 100);
}

function isPhysicalDamageSystemBroken(fighter, key) {
  return damageEffectsEnabled() && physicalDamageSystemLossPercent(fighter, key) >= physicalDamageFailureThreshold();
}

function isLeftDriveBroken(fighter) {
  return isPhysicalDamageSystemBroken(fighter, "leftDrive");
}

function isRightDriveBroken(fighter) {
  return isPhysicalDamageSystemBroken(fighter, "rightDrive");
}

function isWeaponBroken(fighter) {
  return isPhysicalDamageSystemBroken(fighter, "weapon");
}

function weaponDamagePercent(fighter) {
  return physicalDamageSystemLossPercent(fighter, "weapon");
}

function weaponDamageEffectiveness(fighter) {
  if (!damageEffectsEnabled() || !fighter) return 1;
  if (isWeaponBroken(fighter)) return 0;
  return THREE.MathUtils.clamp(1 - weaponDamagePercent(fighter) / 100, 0, 1);
}

function spinnerBaseVisualSpeed(weapon) {
  if (!weapon) return 0;
  if (Number.isFinite(weapon.visualSpeed)) return weapon.visualSpeed;
  if (Number.isFinite(weapon.activeSpeed)) return weapon.activeSpeed;
  if (Number.isFinite(weapon.speed)) return weapon.speed * 3;
  return 0;
}

function spinnerEffectiveVisualSpeed(fighter) {
  const weapon = fighter?.weapon;
  const baseSpeed = spinnerBaseVisualSpeed(weapon);
  if (weapon?.type !== "bar" && weapon?.type !== "drum") return baseSpeed;
  return baseSpeed * weaponDamageEffectiveness(fighter);
}

function damageStatusLines(fighter) {
  if (!damageEffectsEnabled() || !fighter) return [];
  const lines = [];
  if (fighter.knockedOut) lines.push(`${fighterDisplayName(fighter)} disabled`);
  const threshold = physicalDamageFailureThreshold();
  const left = physicalDamageSystemLossPercent(fighter, "leftDrive");
  const weapon = weaponDamagePercent(fighter);
  const right = physicalDamageSystemLossPercent(fighter, "rightDrive");
  const leftSide = physicalDamageSystemLossPercent(fighter, "leftSide");
  const centerSide = physicalDamageSystemLossPercent(fighter, "centerSide");
  const rightSide = physicalDamageSystemLossPercent(fighter, "rightSide");
  const systemLine = (label, value) => {
    if (value <= 0.5) return;
    const rounded = Math.round(value);
    const state = value >= threshold ? "broken" : "damaged";
    const remaining = Math.max(0, 100 - rounded);
    lines.push(`${label} ${state}: ${rounded}% lost, ${remaining}% effective`);
  };
  systemLine("Left drive", left);
  systemLine("Weapon", weapon);
  systemLine("Right drive", right);
  const sideLine = (label, value) => {
    if (value <= 0.5) return;
    const rounded = Math.round(value);
    lines.push(`${label} damage: ${rounded}%`);
  };
  sideLine("Left side", leftSide);
  sideLine("Center", centerSide);
  sideLine("Right side", rightSide);
  return lines;
}

function applyDamageToInput(fighter, input = {}) {
  const next = completeDriveInput(input);
  if (fighter?.knockedOut) {
    next.leftDrive = 0;
    next.rightDrive = 0;
    next.throttle = 0;
    next.turn = 0;
    next.weapon = false;
    next.weaponSecondary = false;
    return next;
  }
  if (isLeftDriveBroken(fighter)) next.leftDrive = 0;
  if (isRightDriveBroken(fighter)) next.rightDrive = 0;
  next.throttle = (next.leftDrive + next.rightDrive) * 0.5;
  next.turn = (next.leftDrive - next.rightDrive) * 0.5;
  if (isWeaponBroken(fighter)) {
    next.weapon = false;
    next.weaponSecondary = false;
  }
  return next;
}

function stopBrokenWeapon(fighter) {
  if (!isWeaponBroken(fighter) && !fighter?.knockedOut) return;
  const weapon = fighter?.weapon;
  if (!weapon) return;
  weapon.toggledOn = false;
}

function botWinnerImageSrc(fighter) {
  const id = fighter?.spec?.id;
  return id ? `../public/reference/${id}.png` : "";
}

function fighterDisplayName(fighter, fallback = "Bot") {
  return botDisplayName(fighter?.spec?.id) || fighter?.spec?.name || fallback;
}

function lessDamagedWinner() {
  const [player, rival] = arena?.fighters || [];
  if (!player || !rival) return null;
  return (player.damageTotal || 0) <= (rival.damageTotal || 0) ? player : rival;
}

function setRoundEndWinner(winner, reason = "damage") {
  if (!arena || arena.roundOver) return;
  const winnerName = fighterDisplayName(winner, "Winner");
  arena.roundOver = true;
  arena.roundEndReason = reason;
  arena.winner = winner;
  arena.winnerText = `${winnerName} Wins!`;
  music.stop({ fadeOut: 1.4 });
  document.body.dataset.roundOver = "true";
  if (roundEndTitle) roundEndTitle.textContent = arena.winnerText;
  if (roundEndImage) {
    roundEndImage.src = botWinnerImageSrc(winner);
    roundEndImage.alt = `${winnerName} reference`;
  }
  if (roundEndOverlay) roundEndOverlay.hidden = false;
  setArenaPaused(true, { publish: onlineIsActive() });
  updateMatchHud();
  publishOnlineSnapshot(true);
}

function startKnockout(loser) {
  if (!arena || arena.knockoutPending || arena.roundOver || !loser) return;
  const [player, rival] = arena.fighters;
  const winner = loser === player ? rival : player;
  loser.knockedOut = true;
  stopBrokenWeapon(loser);
  const velocity = loser.rb?.linvel?.();
  if (velocity) loser.rb.setLinvel({ x: velocity.x * 0.25, y: velocity.y, z: velocity.z * 0.25 }, true);
  loser.rb?.setAngvel?.({ x: 0, y: 0, z: 0 }, true);
  arena.knockoutPending = true;
  arena.knockoutAt = performance.now() / 1000;
  arena.knockoutLoser = loser;
  arena.knockoutWinner = winner;
  if (knockoutBanner) knockoutBanner.textContent = "Knockout!";
  updateMatchHud();
}

function updateRoundOverState() {
  if (online.role === "joiner" && online.state === "playing") return;
  if (!damageEffectsEnabled() || !arena?.fighters?.length || arena.roundOver) return;
  if (arena.knockoutPending) {
    if (performance.now() / 1000 - (arena.knockoutAt || 0) >= KNOCKOUT_DELAY_SECONDS) {
      setRoundEndWinner(arena.knockoutWinner || lessDamagedWinner(), "knockout");
    }
    return;
  }
  const loser = arena.fighters.find((fighter) => (fighter.damageTotal || 0) >= DAMAGE_TOTAL_KILL_THRESHOLD);
  if (loser) {
    startKnockout(loser);
    return;
  }
  if ((arena.matchTimeRemaining ?? MATCH_DURATION_SECONDS) <= 0) {
    setRoundEndWinner(lessDamagedWinner(), "time");
  }
}

function botMaxHp(fighterOrSpec) {
  const spec = fighterOrSpec?.spec || fighterOrSpec;
  const value = Number(spec?.maxHp);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_BOT_MAX_HP;
}

// Individual damage event popups show visible hp, where 10 hp = 1% on a
// 1000 hp bot. Main HUD totals store/display percent of maxHp. Many combat
// formulas are tuned around the previous 5000 hp scale, so scale those inputs
// at this boundary to preserve fight balance while changing displayed units.
function percentDamageToDisplayHp(fighterOrSpec, percent) {
  return botMaxHp(fighterOrSpec) * (Number(percent) || 0) / 100;
}

function tunedDamageToDisplayHp(rawDamage) {
  return (Number(rawDamage) || 0) * DAMAGE_TUNING_TO_DISPLAY_HP;
}

function displayHpToTunedDamage(displayHp) {
  return (Number(displayHp) || 0) / DAMAGE_TUNING_TO_DISPLAY_HP;
}

function displayHpToPercent(fighterOrSpec, displayHp) {
  return (Number(displayHp) || 0) / botMaxHp(fighterOrSpec) * 100;
}

function quantumBiteTargetKey(target) {
  return target?.fighter?.rb?.handle ?? target?.fighter?.spec?.id ?? target?.rb?.handle ?? "target";
}

function quantumBiteSurfacePoint(target, point, normal = null) {
  const fighter = target?.fighter;
  if (!fighter?.rb) return damageVector(point);
  if (point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) {
    return damageVector(point);
  }
  const center = fighter.rb.translation();
  const centerPoint = new THREE.Vector3(center.x, center.y, center.z);
  const incoming = damageVector(normal, damageVector(point).sub(centerPoint));
  incoming.y = 0;
  if (incoming.lengthSq() < 0.0001) {
    incoming.copy(damageVector(point).sub(centerPoint));
    incoming.y = 0;
  }
  if (incoming.lengthSq() < 0.0001) incoming.set(1, 0, 0);
  incoming.normalize();
  const radius = Math.max(0.35, horizontalBodyRadius(fighter) * 0.82);
  const surface = centerPoint.addScaledVector(incoming, radius);
  surface.y = point?.y ?? center.y;
  return surface;
}

// Any crusher's bite, not just Quantum's: Kraken arrived with the same jaw and
// the same job, so the gate is on the mechanism rather than on the bot.
function recordCrusherBiteDamage(attacker, target, point, normal, dt = 0) {
  if (attacker?.weapon?.type !== "crusher" || !target?.fighter || !damageEffectsEnabled()) return;
  const fighter = target.fighter;
  if (!fighter?.group) return;
  const bitePoint = quantumBiteSurfacePoint(target, point, normal);
  fighter.group.updateMatrixWorld(true);
  const visualPoint = bodyPositionToVisualPosition(fighter, bitePoint);
  const localPoint = fighter.group.worldToLocal(visualPoint.clone());
  const zone = damageZoneForLocalPoint(fighter, localPoint);
  const weapon = attacker.weapon || (attacker.weapon = {});
  weapon.quantumBiteContacts ||= new Map();
  const key = quantumBiteTargetKey(target);
  if (weapon.quantumBiteContacts.has(key)) return;
  weapon.quantumBiteContacts.set(key, { zone });
  recordBotDamage(fighter, {
    hpAmount: QUANTUM_BITE_INITIAL_DAMAGE_HP,
    point: bitePoint,
    normal,
    kind: "quantumBiteInitial",
    source: attacker,
  });
}

function resetCrusherBiteDamageLatch(fighter) {
  const weapon = fighter?.weapon;
  if (weapon?.type !== "crusher") return;
  weapon.quantumBiteContacts?.clear?.();
}

function damageEventsEnabled() {
  return showDamageEventsInput?.checked !== false;
}

function formatDamageEventAmount(amount) {
  const value = Math.max(0, Number(amount) || 0);
  if (value <= 0) return "-0";
  if (value >= 10) return `-${Math.round(value)}`;
  if (value >= 1) return `-${Number(value.toFixed(1))}`;
  return `-${Number(value.toFixed(2))}`;
}

function pushDamageEvent(fighter, amount, { now = performance.now() / 1000, label = "" } = {}) {
  if (!fighter || !damageEventsEnabled()) return;
  const value = Number(amount) || 0;
  if (!Number.isFinite(value) || value <= 0) return;
  const major = value >= MAJOR_DAMAGE_EVENT_HP || Boolean(label);
  const notable = value >= NOTABLE_DAMAGE_EVENT_HP;
  const duration = major ? MAJOR_DAMAGE_EVENT_DISPLAY_SECONDS : notable ? NOTABLE_DAMAGE_EVENT_DISPLAY_SECONDS : DAMAGE_EVENT_DISPLAY_SECONDS;
  fighter.damageEvents ||= [];
  fighter.damageEvents.push({
    id: `${now}-${Math.random().toString(36).slice(2)}`,
    amount: value,
    label,
    major,
    notable,
    duration,
    createdAt: now,
    expiresAt: now + duration,
  });
}

function flushContinuousDamageEvent(fighter, key, bucket, now = performance.now() / 1000) {
  if (!bucket || bucket.amount <= 0) return;
  pushDamageEvent(fighter, bucket.amount, { now });
  fighter.damageEventBuckets?.delete?.(key);
}

function recordDamageEvent(fighter, amount, kind, details = {}) {
  if (!fighter || !damageEventsEnabled()) return;
  const value = Number(amount) || 0;
  if (!Number.isFinite(value) || value <= 0) return;
  const now = performance.now() / 1000;
  if (!CONTINUOUS_DAMAGE_KINDS.has(kind)) {
    pushDamageEvent(fighter, value, { now, label: details.label || "" });
    return;
  }
  fighter.damageEventBuckets ||= new Map();
  const key = kind || "continuous";
  const bucket = fighter.damageEventBuckets.get(key) || { amount: 0, startedAt: now, flushAt: now + CONTINUOUS_DAMAGE_EVENT_SECONDS };
  if (now >= bucket.flushAt) {
    flushContinuousDamageEvent(fighter, key, bucket, now);
    fighter.damageEventBuckets.set(key, { amount: value, startedAt: now, flushAt: now + CONTINUOUS_DAMAGE_EVENT_SECONDS });
    return;
  }
  bucket.amount += value;
  fighter.damageEventBuckets.set(key, bucket);
}

function fighterDamageEventsForRender(fighter, now = performance.now() / 1000) {
  if (!fighter || !damageEventsEnabled()) return [];
  fighter.damageEventBuckets?.forEach((bucket, key) => {
    if (now >= bucket.flushAt) flushContinuousDamageEvent(fighter, key, bucket, now);
  });
  fighter.damageEvents = (fighter.damageEvents || []).filter((event) => event.expiresAt > now);
  return fighter.damageEvents;
}

function renderDamageEvents(container, fighter, now = performance.now() / 1000) {
  if (!container) return;
  const events = fighterDamageEventsForRender(fighter, now);
  if (!events.length) {
    container.replaceChildren();
    return;
  }
  const newestFirst = [...events].sort((a, b) => Number(b.major) - Number(a.major) || Number(b.notable) - Number(a.notable) || b.createdAt - a.createdAt);
  container.replaceChildren(...newestFirst.map((event, index) => {
    const duration = Math.max(0.001, Number(event.duration) || DAMAGE_EVENT_DISPLAY_SECONDS);
    const age = THREE.MathUtils.clamp((now - event.createdAt) / duration, 0, 1);
    const element = document.createElement("div");
    element.className = `damage-event${event.major ? " major" : event.notable ? " notable" : ""}${age > 0.65 ? " fading" : ""}`;
    element.style.setProperty("--damage-event-age", age.toFixed(3));
    element.style.setProperty("--damage-event-index", String(index));
    element.textContent = `${formatDamageEventAmount(event.amount)}${event.label ? ` ${event.label}` : ""}`;
    return element;
  }));
}

function updateDamageEventHud() {
  const player = arena?.fighters?.[0];
  const rival = arena?.fighters?.[1];
  if (!damageEventsEnabled()) {
    playerDamageEvents?.replaceChildren();
    rivalDamageEvents?.replaceChildren();
    arena?.fighters?.forEach((fighter) => {
      fighter.damageEvents = [];
      fighter.damageEventBuckets?.clear?.();
    });
    return;
  }
  const now = performance.now() / 1000;
  renderDamageEvents(playerDamageEvents, player, now);
  renderDamageEvents(rivalDamageEvents, rival, now);
}

function updateDamageHud() {
  const player = arena?.fighters?.[0];
  const rival = arena?.fighters?.[1];
  if (playerDamageReadout) playerDamageReadout.textContent = `${Math.round(player?.damageTotal || 0)}%`;
  if (rivalDamageReadout) rivalDamageReadout.textContent = `${Math.round(rival?.damageTotal || 0)}%`;
  if (playerDamageStatus) playerDamageStatus.textContent = damageStatusLines(player).join("\n");
  if (rivalDamageStatus) rivalDamageStatus.textContent = damageStatusLines(rival).join("\n");
  updateDamageEventHud();
  updateMatchHud();
}

function formatMatchTime(seconds) {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

function updateMatchHud() {
  const enabled = damageEffectsEnabled();
  const remaining = arena?.matchTimeRemaining ?? MATCH_DURATION_SECONDS;
  if (matchTimerReadout) {
    matchTimerReadout.textContent = formatMatchTime(remaining);
    matchTimerReadout.classList.toggle("urgent", enabled && remaining > 0 && remaining <= 10 && !arena?.knockoutPending && !arena?.roundOver);
  }
  if (knockoutBanner && !arena?.knockoutPending) knockoutBanner.textContent = "";
  if (!arena?.roundOver && roundEndOverlay) roundEndOverlay.hidden = true;
  document.body.dataset.roundOver = String(Boolean(arena?.roundOver));
}

let arenaCalloutHideTimer = 0;

function showArenaCallout(message, duration = KILL_SAW_CALLOUT_SECONDS) {
  if (!arenaCalloutOverlay || !message) return;
  window.clearTimeout(arenaCalloutHideTimer);
  arenaCalloutOverlay.style.setProperty("--arena-callout-seconds", `${Math.max(0.1, duration)}s`);
  arenaCalloutOverlay.textContent = message;
  arenaCalloutOverlay.hidden = false;
  arenaCalloutOverlay.style.animation = "none";
  arenaCalloutOverlay.offsetHeight;
  arenaCalloutOverlay.style.animation = "";
  arenaCalloutHideTimer = window.setTimeout(() => {
    if (arenaCalloutOverlay.textContent === message) arenaCalloutOverlay.hidden = true;
  }, Math.max(0.1, duration) * 1000);
}

function maybeShowKillSawActivationCallout(previousRemaining, nextRemaining) {
  if (!arena || arena.killSawCalloutShown || arena.roundOver || !damageEffectsEnabled()) return;
  if (!Number.isFinite(previousRemaining) || !Number.isFinite(nextRemaining)) return;
  if (previousRemaining > KILL_SAW_START_REMAINING_SECONDS && nextRemaining <= KILL_SAW_START_REMAINING_SECONDS) {
    arena.killSawCalloutShown = true;
    showArenaCallout("One minute remaining\nkill saws now active");
  }
}

function syncDamageVisibility() {
  const gameModeEnabled = damageEnabled();
  document.body.dataset.damageEnabled = String(gameModeEnabled);
  document.body.dataset.physicalDamageEnabled = String(physicalDamageEnabled());
  updateDamageHud();
  updateRoundOverState();
  updateMatchHud();
}

function isDirectSpinnerWeaponDamage({ damageZone, kind, source, directWeaponHit = false }) {
  const sourceWeapon = source?.weapon || source?.group?.userData?.weapon;
  return damageZone === "weapon" &&
    kind === "spinner" &&
    Boolean(directWeaponHit) &&
    (sourceWeapon?.type === "bar" || sourceWeapon?.type === "drum");
}

function isQuantumBiteWeaponDamage({ damageZone, kind, source }) {
  const sourceWeapon = source?.weapon || source?.group?.userData?.weapon;
  return damageZone === "weapon" &&
    kind === "quantumBiteInitial" &&
    sourceWeapon?.type === "crusher";
}

function canApplyDamageForZone(damageZone, kind, source, directWeaponHit = false) {
  if (damageZone !== "weapon") return true;
  return isDirectSpinnerWeaponDamage({ damageZone, kind, source, directWeaponHit }) ||
    isQuantumBiteWeaponDamage({ damageZone, kind, source });
}

function canApplyPhysicalDamageForZone(damageZone, kind, source, directWeaponHit = false) {
  if (kind === "weaponRecoil" || kind === "flipperRecoil" || kind === "weaponFloor" || kind === "weaponWall") return false;
  if (damageZone !== "weapon") return true;
  return isDirectSpinnerWeaponDamage({ damageZone, kind, source, directWeaponHit }) ||
    isQuantumBiteWeaponDamage({ damageZone, kind, source });
}

function damageZoneDisplayLabel(zone) {
  if (zone === "left") return "left side";
  if (zone === "right") return "right side";
  if (zone === "center") return "center";
  if (zone === "weapon") return "weapon";
  return "body";
}

function recordLogicalDamageOnly(fighter, {
  percentAmount = 0,
  point = null,
  kind = "logical",
  source = null,
  zone = null,
  eventLabel = "",
  extra = null,
} = {}) {
  if (!fighter?.group || !fighter?.rb) return 0;
  const damage = Number(percentAmount) || 0;
  if (!Number.isFinite(damage) || damage <= 0) return 0;
  const bodyPoint = point
    ? new THREE.Vector3(point.x, point.y, point.z)
    : new THREE.Vector3(fighter.rb.translation().x, fighter.rb.translation().y, fighter.rb.translation().z);
  const visualPoint = bodyPositionToVisualPosition(fighter, bodyPoint);
  fighter.group.updateMatrixWorld(true);
  const localPoint = fighter.group.worldToLocal(visualPoint.clone());
  const damageZone = zone || damageZoneForLocalPoint(fighter, localPoint);
  fighter.damageParts ||= defaultDamageParts();
  fighter.damageParts[damageZone] = (fighter.damageParts[damageZone] || 0) + damage;
  fighter.damageTotal = (fighter.damageTotal || 0) + damage;
  const displayHp = percentDamageToDisplayHp(fighter, damage);
  const tunedAmount = displayHpToTunedDamage(displayHp);
  recordDamageEvent(fighter, displayHp, kind, { label: eventLabel });
  fighter.damageLog ||= [];
  fighter.damageLog.push({
    time: performance.now() / 1000,
    amount: damage,
    rawAmount: displayHp,
    tunedAmount,
    kind,
    source: physicsLogSourceLabel(source),
    zone: damageZone,
    world: plainVec3(bodyPoint),
    local: plainVec3(localPoint),
    extra,
  });
  recordPhysicsLogEvent("damage", {
    target: fighter.spec?.id || null,
    amount: damage,
    rawAmount: displayHp,
    tunedAmount,
    kind,
    source: physicsLogSourceLabel(source),
    zone: damageZone,
    world: plainVec3(bodyPoint),
    extra,
  });
  updateDamageHud();
  updateRoundOverState();
  return damage;
}

function physicalDamageRawDamageForKind(rawDamage, kind, options) {
  if (kind === "quantumBiteInitial") {
    return Math.max(rawDamage, (options?.threshold || DEFAULT_PHYSICAL_DAMAGE_OPTIONS.threshold) * Math.max(0.05, options?.resilience || 1));
  }
  return rawDamage;
}

function signedAngleDelta(a = 0, b = 0) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function attachQuantumBiteDebrisToJaw(attacker, prop) {
  const weapon = attacker?.weapon;
  const jaw = weapon?.object;
  if (attacker?.spec?.id !== "quantum" || weapon?.type !== "crusher" || !jaw || !prop?.rb || !prop?.mesh) return;
  attacker.group?.updateMatrixWorld(true);
  jaw.updateMatrixWorld(true);
  prop.mesh.updateMatrixWorld(true);
  const jawWorldPosition = new THREE.Vector3();
  const jawWorldQuaternion = new THREE.Quaternion();
  const propWorldPosition = new THREE.Vector3();
  const propWorldQuaternion = new THREE.Quaternion();
  jaw.getWorldPosition(jawWorldPosition);
  jaw.getWorldQuaternion(jawWorldQuaternion);
  prop.mesh.getWorldPosition(propWorldPosition);
  prop.mesh.getWorldQuaternion(propWorldQuaternion);
  const inverseJawQuaternion = jawWorldQuaternion.clone().invert();
  prop.quantumJawAttachment = {
    attacker,
    jaw,
    localPosition: propWorldPosition.clone().sub(jawWorldPosition).applyQuaternion(inverseJawQuaternion),
    localQuaternion: inverseJawQuaternion.multiply(propWorldQuaternion),
  };
  prop.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
  prop.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

function physicalDamageCandidateLogPayload(candidate) {
  if (!candidate) return null;
  return {
    status: candidate.status || null,
    zone: candidate.damageZone || null,
    hits: candidate.hits ?? null,
    requiredHits: candidate.requiredHits ?? null,
    interiorForceHits: candidate.interiorForceHits ?? null,
    damage: candidate.damage ?? null,
    maxHitDamage: candidate.maxHitDamage ?? null,
    breakRadius: candidate.breakRadius ?? null,
    primeMatchRadius: candidate.primeMatchRadius ?? null,
    interiorFraction: candidate.interiorFraction ?? null,
    releaseWhenReady: Boolean(candidate.releaseWhenReady),
    allowInteriorBreak: Boolean(candidate.allowInteriorBreak),
    triangles: candidate.split?.triangleCount || 0,
    linkedInteriorBreaks: candidate.linkedInteriorCandidates?.length || 0,
    groupId: candidate.groupId ?? null,
    failureReason: candidate.failureReason || null,
    previewBuilt: Boolean(candidate.previewMesh),
    mesh: candidate.mesh?.name || candidate.mesh?.userData?.viewerPart || null,
    local: plainVec3(candidate.localPoint),
    world: plainVec3(candidate.worldPoint),
  };
}

function recordBotDamage(fighter, {
  amount = 0,
  hpAmount = 0,
  percentAmount = 0,
  point = null,
  normal = null,
  kind = "collision",
  source = null,
  directWeaponHit = false,
} = {}) {
  if (!fighter?.group || !fighter?.rb) return;
  // Hot path: weapon impacts, hazards, and afterStep callbacks can all arrive
  // here from the physics/animation frame. Keep this limited to lightweight
  // damage bookkeeping plus a physical-damage enqueue; fracture prep, preview
  // meshes, and collider edits belong in the deferred physical-damage pipeline.
  const tunedAmount = Number(amount) + displayHpToTunedDamage(Number(hpAmount) || 0) + displayHpToTunedDamage(percentDamageToDisplayHp(fighter, Number(percentAmount) || 0));
  if (!Number.isFinite(tunedAmount)) return;
  impactSound(kind, tunedAmount, point);
  if (tunedAmount < DAMAGE_MARK_MIN_AMOUNT) return;
  const displayHp = tunedDamageToDisplayHp(tunedAmount);
  const damage = displayHpToPercent(fighter, displayHp);
  const bodyPoint = point
    ? new THREE.Vector3(point.x, point.y, point.z)
    : fighterGroundContactInfo(fighter).point || new THREE.Vector3(fighter.rb.translation().x, fighter.rb.translation().y, fighter.rb.translation().z);
  const visualPoint = bodyPositionToVisualPosition(fighter, bodyPoint);
  fighter.group.updateMatrixWorld(true);
  const localPoint = fighter.group.worldToLocal(visualPoint.clone());
  const damageZone = damageZoneForLocalPoint(fighter, localPoint);
  if (!canApplyDamageForZone(damageZone, kind, source, directWeaponHit)) {
    recordPhysicsLogEvent("damage-ignored", {
      target: fighter.spec?.id || null,
      rawAmount: displayHp,
      tunedAmount,
      kind,
      source: physicsLogSourceLabel(source),
      zone: damageZone,
      reason: "weapon-zone-requires-direct-weapon-damage",
      directWeaponHit: Boolean(directWeaponHit),
      world: plainVec3(bodyPoint),
    });
    return;
  }
  fighter.damageParts ||= defaultDamageParts();
  fighter.damageParts[damageZone] = (fighter.damageParts[damageZone] || 0) + damage;
  fighter.damageTotal = (fighter.damageTotal || 0) + damage;
  recordDamageEvent(fighter, displayHp, kind);
  fighter.damageLog ||= [];
  fighter.damageLog.push({
    time: performance.now() / 1000,
    amount: damage,
    rawAmount: displayHp,
    tunedAmount,
    kind,
    source: physicsLogSourceLabel(source),
    zone: damageZone,
    world: plainVec3(bodyPoint),
    local: plainVec3(localPoint),
  });
  recordPhysicsLogEvent("damage", {
    target: fighter.spec?.id || null,
    amount: damage,
    rawAmount: displayHp,
    tunedAmount,
    kind,
    source: physicsLogSourceLabel(source),
    zone: damageZone,
    world: plainVec3(bodyPoint),
  });
  if (physicalDamageEnabled() && canApplyPhysicalDamageForZone(damageZone, kind, source, directWeaponHit)) {
    // Frame-safety guard: recordBotDamage is reached from physics/animation callbacks.
    // Do not add mesh traversal, geometry edits, bounding-box scans, or preview construction here.
    // applyPhysicalDamageBreak must stay a cheap hit enqueue; heavy break work is deferred.
    const options = physicalDamageOptions();
    const physicalResult = applyPhysicalDamageBreak({
      fighter,
      worldPoint: visualPoint,
      worldNormal: normal,
      rawDamage: physicalDamageRawDamageForKind(tunedAmount, kind, options),
      options,
      arena,
      RAPIER,
      createArenaProp,
      interiorMaterial: dark,
      originalMaterialFallback: steel,
      damageZone,
      onStatusChanged: ({ fighter: changedFighter, candidate, status }) => {
        if (candidate && changedFighter?.spec?.id) candidate.fighterId = changedFighter.spec.id;
        recordPhysicsLogEvent("physicalDamage", {
          target: changedFighter?.spec?.id || null,
          status,
          candidate: physicalDamageCandidateLogPayload(candidate),
          lastResult: changedFighter?.physicalDamageLastResult || null,
        });
        if (status === "prepare-failed" || status === "superseded" || status === "committed-linked") disposePhysicalDamagePreview(candidate);
        else queuePhysicalDamagePreviewBuild(candidate);
        updateDamageHud();
      },
      onCommitted: ({ fighter: damagedFighter, candidate, prop, options }) => {
        const removedBoundingBoxPercent = physicalDamageRemovedBoundingBoxPercent(candidate);
        breakSound(candidate.worldPoint, removedBoundingBoxPercent);
        const breakZone = candidate.damageZone || damageZone;
        const logicalDamage = recordLogicalDamageOnly(damagedFighter, {
          percentAmount: removedBoundingBoxPercent,
          point: visualPositionToBodyPosition(damagedFighter, candidate.worldPoint),
          kind: "physicalBreak",
          source,
          zone: breakZone,
          eventLabel: `${damageZoneDisplayLabel(breakZone)} break`,
          extra: {
            removedBoundingBoxPercent,
            triangles: candidate.split?.triangleCount || 0,
            linkedInteriorBreaks: candidate.linkedInteriorCandidates?.length || 0,
          },
        });
        recordPhysicsLogEvent("physicalDamage", {
          target: damagedFighter?.spec?.id || null,
          status: "committed",
          candidate: physicalDamageCandidateLogPayload(candidate),
          logicalDamage,
          removedBoundingBoxPercent,
          prop: prop ? { kind: prop.kind || prop.userData?.kind || null } : null,
        });
        disposePhysicalDamagePreview(candidate);
        addColliderSolidFillForPhysicalBreak({
          fighter: damagedFighter,
          candidate,
          prop,
          radius: Math.max(options.breakRadius || 0.24, 0.18) * 1.25,
        });
        if (kind === "quantumBiteInitial") attachQuantumBiteDebrisToJaw(source, prop);
        adjustFighterCollidersForPhysicalBreak({
          fighter: damagedFighter,
          candidate,
          worldPoint: candidate.worldPoint,
          worldNormal: candidate.lastHitNormal,
          radius: Math.max(options.breakRadius || 0.24, 0.18) * 1.25,
        });
      },
      allowInteriorBreak: kind === "quantumBiteInitial",
    });
    recordPhysicsLogEvent("physicalDamage", {
      target: fighter.spec?.id || null,
      status: "apply-result",
      kind,
      source: physicsLogSourceLabel(source),
      zone: damageZone,
      rawDamage: physicalDamageRawDamageForKind(tunedAmount, kind, options),
      world: plainVec3(visualPoint),
      result: physicalResult || null,
      lastResult: fighter.physicalDamageLastResult || null,
      options: {
        threshold: options.threshold,
        significantHitsRequired: options.significantHitsRequired,
        resilience: options.resilience,
        breakRadius: options.breakRadius,
        primeMatchRadius: options.primeMatchRadius,
        maxBreakRadius: options.maxBreakRadius,
        maxPrimeMatchRadius: options.maxPrimeMatchRadius,
        maxRadiusDamageMultiplier: options.maxRadiusDamageMultiplier,
        maxPiecesPerBot: options.maxPiecesPerBot,
        interiorBreakInsideThreshold: options.interiorBreakInsideThreshold,
        interiorBreakHitMultiplier: options.interiorBreakHitMultiplier,
      },
    });
  }
  updateDamageHud();
  updateRoundOverState();
}

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

function torus(parent, radius, tube, material, pos, rot) {
  return add(new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 18, 96), material), parent, pos, rot);
}

function wedge(parent, size, material, pos, rot) {
  const [w, h, d] = size;
  const vertices = new Float32Array([
    -w / 2, 0, -d / 2, w / 2, 0, -d / 2, -w / 2, 0, d / 2, w / 2, 0, d / 2,
    -w / 2, h, d / 2, w / 2, h, d / 2,
  ]);
  const indices = [0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4, 0, 2, 4, 0, 4, 1, 1, 4, 5, 1, 5, 3, 0, 5, 1, 0, 4, 5];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return add(new THREE.Mesh(geo, material), parent, pos, rot);
}

function trianglePrism(parent, size, material, pos, rot) {
  const [w, h, d] = size;
  const vertices = new Float32Array([
    -w / 2, -h / 2, -d / 2,
    w / 2, -h / 2, -d / 2,
    0, h / 2, -d / 2,
    -w / 2, -h / 2, d / 2,
    w / 2, -h / 2, d / 2,
    0, h / 2, d / 2,
  ]);
  const indices = [
    0, 1, 2,
    3, 5, 4,
    0, 3, 4, 0, 4, 1,
    1, 4, 5, 1, 5, 2,
    2, 5, 3, 2, 3, 0,
  ];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return add(new THREE.Mesh(geo, material), parent, pos, rot);
}

function label(parent, text, pos, rot, size = [1, 0.26], color = "#f4f5f2") {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 160;
  const g = c.getContext("2d");
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = color;
  g.font = "900 72px Georgia, serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, 256, 80);
  const tex = new THREE.CanvasTexture(c);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size[0], size[1]),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  return add(mesh, parent, pos, rot);
}

function bolts(parent, positions, radius = 0.035) {
  positions.forEach((p) => cyl(parent, radius, 0.035, dark, p, [Math.PI / 2, 0, 0], 16));
}

function tireWheel(parent, pos, radius = 0.34, width = 0.22) {
  const wheel = new THREE.Group();
  wheel.position.set(...pos);
  parent.add(wheel);
  cyl(wheel, radius, width, tire, [0, 0, 0], [0, 0, Math.PI / 2], 48);
  cyl(wheel, radius * 0.54, width * 1.08, steel, [0, 0, 0], [0, 0, Math.PI / 2], 32);
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2;
    box(wheel, [0.035, width * 1.12, radius * 0.26], tire, [0, Math.sin(a) * radius * 0.98, Math.cos(a) * radius * 0.98], [a, 0, Math.PI / 2]);
  }
  wheel.userData.wheelRadius = radius;
  wheel.userData.driveSide = pos[0] < 0 ? "left" : "right";
  return wheel;
}

function prepareLoadedModel(root, fit = { width: 2.9, height: 1.45, depth: 2.9 }) {
  const model = root.clone(true);
  model.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.geometry = child.geometry.clone();
      if (child.material) child.material = child.material.clone();
    }
  });

  const box3 = modelAuthoringBounds(model) || new THREE.Box3().setFromObject(model);
  const size = box3.getSize(new THREE.Vector3());
  const fitScale = Number.isFinite(fit.scale) ? fit.scale : 1;
  const scale = Math.min(fit.width / size.x, fit.height / size.y, fit.depth / size.z) * fitScale;
  model.scale.setScalar(Number.isFinite(scale) ? scale : 1);

  const fitted = modelAuthoringBounds(model) || new THREE.Box3().setFromObject(model);
  const center = fitted.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -fitted.min.y, -center.z);
  return model;
}

// Models ported from v2 arrive already segmented and already the right size:
// normalize them exactly the way v2 does (yaw, roll, uniform scale, ground the
// drawn geometry to y=0, centre on the body) so the catalog's colliders and
// pivots — all measured against that pose — land where they were measured.
//
// The repaint matters as much as the transform. Tripo writes no
// pbrMetallicRoughness block, so every scanned material arrives fully metallic
// and fully rough, which renders as chalk: no diffuse term and no visible
// specular. These are painted machines, so the baked photograph goes back on
// the surface at v2's values.
function prepareSegmentedModel(source, config) {
  const model = source.clone(true);
  model.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.geometry = child.geometry.clone();
    if (child.material) {
      child.material = child.material.clone();
      if (child.material.map) {
        child.material.metalness = SEGMENTED_MODEL_SURFACE.metalness;
        child.material.roughness = SEGMENTED_MODEL_SURFACE.roughness;
        child.material.needsUpdate = true;
      }
    }
  });
  // The normalized wrapper carries the model's scale and grounding offset, so
  // nothing may be hung directly off it: a pivot placed there would be measured
  // in the wrapper's own scaled frame. It goes inside an identity container,
  // which makes container-local space and game space the same thing — and that
  // is the space the catalog's pivots, angles and collider offsets are in.
  const container = new THREE.Group();
  container.name = "modelSegmented";
  container.add(normalizeSegmentedModel(model, config.model));
  return container;
}

function buildConfiguredModelBot(id) {
  const config = MODEL_PART_CONFIG[id];
  const source = modelForId(id);
  if (!config || !source) return new THREE.Group();
  const spec = bots.find((bot) => bot.id === id) || {};
  const group = new THREE.Group();
  const segmented = Boolean(config.segmented);
  const model = segmented ? prepareSegmentedModel(source, config) : prepareLoadedModel(source, config.fit);
  const movingParts = segmented
    ? splitSegmentedModelParts(model, config, spec)
    : splitConfiguredModelParts(model, config, spec);
  group.add(model);
  group.userData.segmentedModel = segmented;
  group.userData.sourceModel = model;
  group.userData.modelPartConfig = config;
  group.userData.weapon = movingParts.weapon;
  group.userData.drivetrain = movingParts.drivetrain;
  group.userData.viewerParts = movingParts.viewerParts;
  return group;
}

function makeBroncoFlipperWeapon(model) {
  let mesh = null;
  model.traverse((child) => {
    if (child.isMesh && !mesh) mesh = child;
  });
  if (!mesh?.geometry?.attributes.position) return null;

  const geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const bounds = originalAuthoringBoundsForMesh(mesh) || geometry.boundingBox;
  const size = bounds.getSize(new THREE.Vector3());
  const sourcePosition = geometry.attributes.position;
  const sourceNormal = geometry.attributes.normal;
  const sourceUv = geometry.attributes.uv || geometry.attributes.uv0;
  const index = geometry.index;
  const liftStart = bounds.min.y + size.y * 0.42;
  const hinge = new THREE.Vector3(0, bounds.min.y + size.y * 0.34, bounds.max.z - size.z * 0.1);
  const bodyData = { position: [], normal: [], uv: [] };
  const flipperData = { position: [], normal: [], uv: [] };
  const tri = [0, 0, 0];

  const pushVertex = (data, vertexIndex, offset = null) => {
    const x = sourcePosition.getX(vertexIndex);
    const y = sourcePosition.getY(vertexIndex);
    const z = sourcePosition.getZ(vertexIndex);
    data.position.push(offset ? x - offset.x : x, offset ? y - offset.y : y, offset ? z - offset.z : z);
    if (sourceNormal) data.normal.push(sourceNormal.getX(vertexIndex), sourceNormal.getY(vertexIndex), sourceNormal.getZ(vertexIndex));
    if (sourceUv) data.uv.push(sourceUv.getX(vertexIndex), sourceUv.getY(vertexIndex));
  };

  const triangleCount = index ? index.count / 3 : sourcePosition.count / 3;
  for (let i = 0; i < triangleCount; i += 1) {
    for (let j = 0; j < 3; j += 1) tri[j] = index ? index.getX(i * 3 + j) : i * 3 + j;
    const cx = (sourcePosition.getX(tri[0]) + sourcePosition.getX(tri[1]) + sourcePosition.getX(tri[2])) / 3;
    const cy = (sourcePosition.getY(tri[0]) + sourcePosition.getY(tri[1]) + sourcePosition.getY(tri[2])) / 3;
    const cz = (sourcePosition.getZ(tri[0]) + sourcePosition.getZ(tri[1]) + sourcePosition.getZ(tri[2])) / 3;
    const raised = cy > liftStart;
    const narrowCenter = Math.abs(cx) < size.x * 0.2;
    const frontTip = Math.abs(cx) < size.x * 0.16 && cy > bounds.min.y + size.y * 0.2 && cz < bounds.min.z + size.z * 0.12;
    const notRearArmor = cz < bounds.max.z - size.z * 0.16;
    const notFrontFork = cz > bounds.min.z + size.z * 0.08;
    const data = notRearArmor && (frontTip || (raised && narrowCenter && notFrontFork)) ? flipperData : bodyData;
    const offset = data === flipperData ? hinge : null;
    tri.forEach((vertexIndex) => pushVertex(data, vertexIndex, offset));
  }

  const makeGeometry = (data) => {
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.Float32BufferAttribute(data.position, 3));
    if (data.normal.length) next.setAttribute("normal", new THREE.Float32BufferAttribute(data.normal, 3));
    if (data.uv.length) next.setAttribute("uv", new THREE.Float32BufferAttribute(data.uv, 2));
    if (!data.normal.length) next.computeVertexNormals();
    next.computeBoundingSphere();
    return next;
  };

  const parent = mesh.parent;
  const body = new THREE.Mesh(makeGeometry(bodyData), mesh.material.clone());
  const flipper = new THREE.Mesh(makeGeometry(flipperData), mesh.material.clone());
  const pivot = new THREE.Group();
  body.castShadow = true;
  body.receiveShadow = true;
  flipper.castShadow = true;
  flipper.receiveShadow = true;
  body.matrix.copy(mesh.matrix);
  body.matrix.decompose(body.position, body.quaternion, body.scale);
  pivot.position.copy(hinge);
  pivot.quaternion.copy(mesh.quaternion);
  pivot.scale.copy(mesh.scale);
  pivot.add(flipper);
  parent.add(body);
  parent.add(pivot);
  mesh.visible = false;
  pivot.rotation.x = BRONCO_FLIPPER_LOWERED_ANGLE;

  return {
    type: "flipper",
    object: pivot,
    body,
    baseRotation: BRONCO_FLIPPER_LOWERED_ANGLE,
    activeRotation: BRONCO_FLIPPER_RAISED_ANGLE,
    activeSpeed: 48,
    returnSpeed: 4.2,
    returnSeconds: BOT_CONFIG.bronco.weaponReturnSeconds,
  };
}

function setModelForId(id, model) {
  loadedModels.set(id, model);
  if (id === "biteforce") biteforceModel = model;
  if (id === "bronco") broncoModel = model;
  if (id === "huge") hugeModel = model;
  if (id === "quantum") quantumModel = model;
  if (id === "hypershock") hypershockModel = model;
  if (id === "minotaur") minotaurModel = model;
}

function markModelFailed(id) {
  modelLoadFailures.add(id);
  if (id === "biteforce") biteforceModelFailed = true;
  if (id === "bronco") broncoModelFailed = true;
  if (id === "huge") hugeModelFailed = true;
  if (id === "quantum") quantumModelFailed = true;
  if (id === "hypershock") hypershockModelFailed = true;
  if (id === "minotaur") minotaurModelFailed = true;
}

function isBotModelLoading(id) {
  return modelLoadPromises.has(id);
}

function shouldRebuildArenaForLoadedModel(id) {
  if (mode !== "arena" || !getArenaFighterIds().includes(id)) return false;
  if (arena?.root || fightIntro) return false;
  return !arena?.world || (arena.fighters?.length || 0) < getArenaFighterIds().length;
}

function loadBotModel(id, { foreground = false, reason = "bot" } = {}) {
  if (!MODEL_BACKED_BOTS.has(id) || modelForId(id) || modelLoadFailures.has(id)) return Promise.resolve(modelForId(id));
  const loadingMessageText = reason === "opponent"
    ? `Loading opponent: ${botDisplayName(id)}`
    : reason === "arena"
      ? `Loading arena: ${botDisplayName(id)}`
      : `Loading ${botDisplayName(id)}`;
  if (modelLoadPromises.has(id)) {
    const existing = modelLoadPromises.get(id);
    if (foreground) {
      const doneLoading = beginLoading(loadingMessageText, { detail: `${loadingMessageText}\nwaiting for existing request` });
      existing.finally(doneLoading);
    }
    return existing;
  }
  const config = MODEL_PART_CONFIG[id];
  if (!config?.path) return Promise.resolve(null);
  const doneLoading = foreground ? beginLoading(loadingMessageText, { detail: `${loadingMessageText}\nstarting GLB request` }) : null;
  const promise = new Promise((resolve) => {
    gltfLoader.load(
      config.path,
      (gltf) => {
        doneLoading?.update(`${loadingMessageText}\nprocessing model`);
        setModelForId(id, gltf.scene);
        modelLoadPromises.delete(id);
        doneLoading?.();
        if (selected.id === id && mode === "viewer") showViewerBot();
        if (shouldRebuildArenaForLoadedModel(id)) buildArena();
        resolve(gltf.scene);
      },
      (event) => {
        if (!doneLoading) return;
        const total = event.total || 0;
        const loaded = event.loaded || 0;
        const progress = total > 0 ? ` ${Math.round((loaded / total) * 100)}%` : ` ${Math.round(loaded / 1024)}kb`;
        doneLoading.update(`${loadingMessageText}\ndownloading${progress}`);
      },
      (error) => {
        markModelFailed(id);
        modelLoadPromises.delete(id);
        doneLoading?.();
        console.warn(`${botDisplayName(id)} GLB failed to load; using fallback if available.`, error);
        if (selected.id === id && mode === "viewer") showViewerBot();
        if (shouldRebuildArenaForLoadedModel(id)) buildArena();
        resolve(null);
      },
    );
  });
  modelLoadPromises.set(id, promise);
  return promise;
}

function loadBroncoModel(options = {}) {
  return loadBotModel("bronco", options);
}

function loadHugeModel(options = {}) {
  return loadBotModel("huge", options);
}

function applyHugeSpinnerPivotOffset(pivot, object = null) {
  const offset = new THREE.Vector3(HUGE_SPINNER_PIVOT_OFFSET.x, HUGE_SPINNER_PIVOT_OFFSET.y, HUGE_SPINNER_PIVOT_OFFSET.z);
  if (offset.lengthSq() === 0) return;
  pivot.position.add(offset);
  if (object) object.position.sub(offset);
}

function makeHugeMovingParts(model) {
  let mesh = null;
  model.traverse((child) => {
    if (child.isMesh && !mesh) mesh = child;
  });
  if (!mesh?.geometry?.attributes.position) return null;

  const geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const bounds = originalAuthoringBoundsForMesh(mesh) || geometry.boundingBox;
  const size = bounds.getSize(new THREE.Vector3());
  const sourcePosition = geometry.attributes.position;
  const sourceNormal = geometry.attributes.normal;
  const sourceUv = geometry.attributes.uv || geometry.attributes.uv0;
  const index = geometry.index;
  const bodyData = { position: [], normal: [], uv: [] };
  const spinnerData = { position: [], normal: [], uv: [] };
  const leftWheelData = { position: [], normal: [], uv: [] };
  const rightWheelData = { position: [], normal: [], uv: [] };
  let pivotPoint = new THREE.Vector3(0, bounds.min.y + size.y * 0.52, 0);
  let leftWheelPoint = new THREE.Vector3(
    bounds.min.x + size.x * HUGE_WHEEL_ANIMATION_LEFT_CENTER_X_RATIO,
    bounds.min.y + size.y * HUGE_WHEEL_ANIMATION_CENTER_Y_RATIO,
    0,
  );
  let rightWheelPoint = new THREE.Vector3(
    bounds.max.x - size.x * HUGE_WHEEL_ANIMATION_RIGHT_CENTER_X_RATIO,
    bounds.min.y + size.y * HUGE_WHEEL_ANIMATION_CENTER_Y_RATIO,
    0,
  );
  const tri = [0, 0, 0];

  const pushVertex = (data, vertexIndex, offset = null) => {
    const x = sourcePosition.getX(vertexIndex);
    const y = sourcePosition.getY(vertexIndex);
    const z = sourcePosition.getZ(vertexIndex);
    data.position.push(offset ? x - offset.x : x, offset ? y - offset.y : y, offset ? z - offset.z : z);
    if (sourceNormal) data.normal.push(sourceNormal.getX(vertexIndex), sourceNormal.getY(vertexIndex), sourceNormal.getZ(vertexIndex));
    if (sourceUv) data.uv.push(sourceUv.getX(vertexIndex), sourceUv.getY(vertexIndex));
  };

  const triangleCount = index ? index.count / 3 : sourcePosition.count / 3;
  for (let i = 0; i < triangleCount; i += 1) {
    for (let j = 0; j < 3; j += 1) tri[j] = index ? index.getX(i * 3 + j) : i * 3 + j;
    const cx = (sourcePosition.getX(tri[0]) + sourcePosition.getX(tri[1]) + sourcePosition.getX(tri[2])) / 3;
    const cy = (sourcePosition.getY(tri[0]) + sourcePosition.getY(tri[1]) + sourcePosition.getY(tri[2])) / 3;
    const cz = (sourcePosition.getZ(tri[0]) + sourcePosition.getZ(tri[1]) + sourcePosition.getZ(tri[2])) / 3;
    const inSpinnerWidth = cx > -size.x * 0.05 && cx < size.x * 0.01;
    const centralBlade = inSpinnerWidth;
    const wheelRadiusBand = Math.hypot(cy - leftWheelPoint.y, cz - leftWheelPoint.z);
    const inWheelMass =
      wheelRadiusBand > size.y * HUGE_WHEEL_ANIMATION_INNER_RADIUS_THRESHOLD &&
      wheelRadiusBand < size.y * HUGE_WHEEL_ANIMATION_OUTER_RADIUS_THRESHOLD;
    const leftWheel = !centralBlade && inWheelMass && cx < bounds.min.x + size.x * HUGE_WHEEL_ANIMATION_SIDE_X_THRESHOLD;
    const rightWheel = !centralBlade && inWheelMass && cx > bounds.max.x - size.x * HUGE_WHEEL_ANIMATION_SIDE_X_THRESHOLD;
    const data = centralBlade ? spinnerData : leftWheel ? leftWheelData : rightWheel ? rightWheelData : bodyData;
    const offset = centralBlade ? pivotPoint : leftWheel ? leftWheelPoint : rightWheel ? rightWheelPoint : null;
    tri.forEach((vertexIndex) => pushVertex(data, vertexIndex, offset));
  }

  if (spinnerData.position.length < 9) return null;

  const recenterSpinnerToHub = (data, pivot) => {
    const radii = [];
    for (let i = 0; i < data.position.length; i += 3) {
      radii.push(Math.hypot(data.position[i + 1], data.position[i + 2]));
    }
    radii.sort((a, b) => a - b);
    const hubRadius = radii[Math.floor(radii.length * 0.34)] || 0;
    const hub = new THREE.Vector3();
    let count = 0;
    for (let i = 0; i < data.position.length; i += 3) {
      const radius = Math.hypot(data.position[i + 1], data.position[i + 2]);
      if (radius > hubRadius || radius < 0.025) continue;
      hub.y += data.position[i + 1];
      hub.z += data.position[i + 2];
      count += 1;
    }
    if (!count) return pivot;
    hub.y /= count;
    hub.z /= count;
    for (let i = 0; i < data.position.length; i += 3) {
      data.position[i + 1] -= hub.y;
      data.position[i + 2] -= hub.z;
    }
    return pivot.clone().add(hub);
  };

  const recenterPartData = (data, pivot) => {
    if (data.position.length < 3) return pivot;
    const center = new THREE.Vector3();
    const min = new THREE.Vector3(Infinity, Infinity, Infinity);
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < data.position.length; i += 3) {
      min.x = Math.min(min.x, data.position[i]);
      min.y = Math.min(min.y, data.position[i + 1]);
      min.z = Math.min(min.z, data.position[i + 2]);
      max.x = Math.max(max.x, data.position[i]);
      max.y = Math.max(max.y, data.position[i + 1]);
      max.z = Math.max(max.z, data.position[i + 2]);
    }
    center.addVectors(min, max).multiplyScalar(0.5);
    for (let i = 0; i < data.position.length; i += 3) {
      data.position[i] -= center.x;
      data.position[i + 1] -= center.y;
      data.position[i + 2] -= center.z;
    }
    return pivot.clone().add(center);
  };

  pivotPoint = recenterSpinnerToHub(spinnerData, pivotPoint);
  leftWheelPoint = recenterPartData(leftWheelData, leftWheelPoint);
  rightWheelPoint = recenterPartData(rightWheelData, rightWheelPoint);

  const makeGeometry = (data) => {
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.Float32BufferAttribute(data.position, 3));
    if (data.normal.length) next.setAttribute("normal", new THREE.Float32BufferAttribute(data.normal, 3));
    if (data.uv.length) next.setAttribute("uv", new THREE.Float32BufferAttribute(data.uv, 2));
    if (!data.normal.length) next.computeVertexNormals();
    next.computeBoundingSphere();
    return next;
  };

  const parent = mesh.parent;
  const bodyMaterial = debugHugeSplit
    ? new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.35, roughness: 0.5, transparent: true, opacity: 0.42 })
    : mesh.material.clone();
  const spinnerMaterial = debugHugeSplit ? new THREE.MeshStandardMaterial({ color: 0x00a6ff, metalness: 0.2, roughness: 0.32 }) : mesh.material.clone();
  const leftWheelMaterial = debugHugeSplit ? new THREE.MeshStandardMaterial({ color: 0xfff2ad, metalness: 0.15, roughness: 0.48 }) : mesh.material.clone();
  const rightWheelMaterial = debugHugeSplit ? new THREE.MeshStandardMaterial({ color: 0xff7b7b, metalness: 0.15, roughness: 0.48 }) : mesh.material.clone();
  const body = new THREE.Mesh(makeGeometry(bodyData), bodyMaterial);
  const spinner = new THREE.Mesh(makeGeometry(spinnerData), spinnerMaterial);
  const leftWheel = new THREE.Mesh(makeGeometry(leftWheelData), leftWheelMaterial);
  const rightWheel = new THREE.Mesh(makeGeometry(rightWheelData), rightWheelMaterial);
  const pivot = new THREE.Group();
  const leftWheelPivot = new THREE.Group();
  const rightWheelPivot = new THREE.Group();
  body.castShadow = true;
  body.receiveShadow = true;
  spinner.castShadow = true;
  spinner.receiveShadow = true;
  leftWheel.castShadow = true;
  leftWheel.receiveShadow = true;
  rightWheel.castShadow = true;
  rightWheel.receiveShadow = true;
  body.matrix.copy(mesh.matrix);
  body.matrix.decompose(body.position, body.quaternion, body.scale);
  pivot.position.copy(pivotPoint);
  pivot.quaternion.copy(mesh.quaternion);
  pivot.scale.copy(mesh.scale);
  applyHugeSpinnerPivotOffset(pivot, spinner);
  pivot.add(spinner);
  leftWheelPivot.position.copy(leftWheelPoint);
  leftWheelPivot.quaternion.copy(mesh.quaternion);
  leftWheelPivot.scale.copy(mesh.scale);
  leftWheelPivot.add(leftWheel);
  rightWheelPivot.position.copy(rightWheelPoint);
  rightWheelPivot.quaternion.copy(mesh.quaternion);
  rightWheelPivot.scale.copy(mesh.scale);
  rightWheelPivot.add(rightWheel);
  parent.add(body);
  parent.add(pivot);
  parent.add(leftWheelPivot);
  parent.add(rightWheelPivot);
  mesh.visible = false;

  const wheelRadius = Math.max(0.1, Math.max(
    leftWheel.geometry.boundingSphere?.radius || 0,
    rightWheel.geometry.boundingSphere?.radius || 0,
  ) * 0.72);

  return {
    viewerParts: {
      body,
      weapon: pivot,
      wheels: [leftWheelPivot, rightWheelPivot],
    },
    weapon: {
      type: "bar",
      object: pivot,
      spinAxis: "x",
      currentSpeed: 0,
      idleSpeed: 0,
      visualSpeed: HUGE_SPINNER_FULL_SPEED,
      spinUpSeconds: HUGE_SPINNER_SPIN_UP_SECONDS,
      spinDownSeconds: HUGE_SPINNER_SPIN_DOWN_SECONDS,
      toggle: true,
      toggledOn: false,
      },
    drivetrain: {
      type: "tank",
      leftWheels: [leftWheelPivot],
      rightWheels: [rightWheelPivot],
      wheelRadius,
      spinAxis: "x",
    },
  };
}

function loadQuantumModel(options = {}) {
  return loadBotModel("quantum", options);
}

function modelForId(id) {
  return loadedModels.get(id) || null;
}

function loadConfiguredModel(id) {
  return loadBotModel(id);
}

function startLazyModelQueue() {
  if (lazyModelQueueStarted) return;
  lazyModelQueueStarted = true;
  const queue = bots.map((bot) => bot.id).filter((id) => id !== selected.id);
  const schedule = window.requestIdleCallback
    ? (callback, timeout = 5000) => window.requestIdleCallback(callback, { timeout })
    : (callback, timeout = 5000) => window.setTimeout(callback, Math.min(timeout, 1800));
  const loadNext = () => {
    if (!loadingOverlay?.hidden || mode === "arena" || Boolean(fightIntro)) {
      schedule(loadNext, 2500);
      return;
    }
    const id = queue.shift();
    if (!id) return;
    if (modelForId(id) || modelLoadFailures.has(id)) {
      schedule(loadNext, 2500);
      return;
    }
    loadBotModel(id, { foreground: false }).finally(() => schedule(loadNext, 5000));
  };
  schedule(loadNext, 6000);
}

function scheduleSecondaryWork(callback, { timeout = 1200 } = {}) {
  if (window.requestIdleCallback) return window.requestIdleCallback(callback, { timeout });
  return window.setTimeout(callback, 120);
}

function buildBiteForce() {
  return buildConfiguredModelBot("biteforce");
}

function buildHypershock() {
  return buildConfiguredModelBot("hypershock");
}

function buildMinotaur() {
  return buildConfiguredModelBot("minotaur");
}

function makeQuantumCrusherWeapon(model) {
  let mesh = null;
  model.traverse((child) => {
    if (child.isMesh && !mesh) mesh = child;
  });
  if (!mesh?.geometry?.attributes.position) return null;

  const geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  const size = bounds.getSize(new THREE.Vector3());
  const sourcePosition = geometry.attributes.position;
  const sourceNormal = geometry.attributes.normal;
  const sourceUv = geometry.attributes.uv || geometry.attributes.uv0;
  const index = geometry.index;
  const bodyData = { position: [], normal: [], uv: [] };
  const skullData = { position: [], normal: [], uv: [] };
  const hinge = new THREE.Vector3(0, bounds.min.y + size.y * 0.48, bounds.min.z + size.z * 0.4);
  const tri = [0, 0, 0];

  const pushVertex = (data, vertexIndex, offset = null) => {
    const x = sourcePosition.getX(vertexIndex);
    const y = sourcePosition.getY(vertexIndex);
    const z = sourcePosition.getZ(vertexIndex);
    data.position.push(offset ? x - offset.x : x, offset ? y - offset.y : y, offset ? z - offset.z : z);
    if (sourceNormal) data.normal.push(sourceNormal.getX(vertexIndex), sourceNormal.getY(vertexIndex), sourceNormal.getZ(vertexIndex));
    if (sourceUv) data.uv.push(sourceUv.getX(vertexIndex), sourceUv.getY(vertexIndex));
  };

  const triangleCount = index ? index.count / 3 : sourcePosition.count / 3;
  for (let i = 0; i < triangleCount; i += 1) {
    for (let j = 0; j < 3; j += 1) tri[j] = index ? index.getX(i * 3 + j) : i * 3 + j;
    const cx = (sourcePosition.getX(tri[0]) + sourcePosition.getX(tri[1]) + sourcePosition.getX(tri[2])) / 3;
    const cy = (sourcePosition.getY(tri[0]) + sourcePosition.getY(tri[1]) + sourcePosition.getY(tri[2])) / 3;
    const cz = (sourcePosition.getZ(tri[0]) + sourcePosition.getZ(tri[1]) + sourcePosition.getZ(tri[2])) / 3;
    const aboveFrontArmor = cy > bounds.min.y + size.y * 0.42;
    const inTopJawWidth = Math.abs(cx) < size.x * 0.4;
    const inCrusherSide = cz < bounds.min.z + size.z * 0.62;
    const pastPivot = cz > bounds.min.z + size.z * 0.1;
    const frontTip = cz < bounds.min.z + size.z * 0.2 && cy > bounds.min.y + size.y * 0.34 && Math.abs(cx) < size.x * 0.44;
    const notCenterMechanism = !(Math.abs(cx) < size.x * 0.18 && cz > bounds.min.z + size.z * 0.34 && cy < bounds.min.y + size.y * 0.62);
    const isSkull = frontTip || (aboveFrontArmor && inTopJawWidth && inCrusherSide && pastPivot && notCenterMechanism);
    const data = isSkull ? skullData : bodyData;
    const offset = isSkull ? hinge : null;
    tri.forEach((vertexIndex) => pushVertex(data, vertexIndex, offset));
  }

  if (skullData.position.length < 9) return null;

  const makeGeometry = (data) => {
    const next = new THREE.BufferGeometry();
    next.setAttribute("position", new THREE.Float32BufferAttribute(data.position, 3));
    if (data.normal.length) next.setAttribute("normal", new THREE.Float32BufferAttribute(data.normal, 3));
    if (data.uv.length) next.setAttribute("uv", new THREE.Float32BufferAttribute(data.uv, 2));
    if (!data.normal.length) next.computeVertexNormals();
    next.computeBoundingSphere();
    return next;
  };

  const parent = mesh.parent;
  const body = new THREE.Mesh(makeGeometry(bodyData), mesh.material.clone());
  const skull = new THREE.Mesh(makeGeometry(skullData), mesh.material.clone());
  const pivot = new THREE.Group();
  body.castShadow = true;
  body.receiveShadow = true;
  skull.castShadow = true;
  skull.receiveShadow = true;
  body.matrix.copy(mesh.matrix);
  body.matrix.decompose(body.position, body.quaternion, body.scale);
  pivot.position.copy(hinge);
  pivot.quaternion.copy(mesh.quaternion);
  pivot.scale.copy(mesh.scale);
  pivot.add(skull);
  parent.add(body);
  parent.add(pivot);
  mesh.visible = false;

  return {
    type: "crusher",
    object: pivot,
    body,
    baseRotation: QUANTUM_CRUSHER_OPEN_ANGLE,
    activeRotation: QUANTUM_CRUSHER_CLOSED_ANGLE,
    speed: 8,
  };
}

function trussPlate(parent, side = 1) {
  const plate = box(parent, [0.075, 0.78, 1.36], white, [side * 0.72, 0.82, 0.04], [0.42, 0, 0]);
  for (let i = 0; i < 5; i += 1) {
    const z = -0.43 + i * 0.22;
    box(parent, [0.08, 0.24, 0.038], black, [side * 0.725, 0.72, z], [0.42, 0, 0.68]);
    box(parent, [0.08, 0.24, 0.038], black, [side * 0.725, 0.72, z + 0.06], [0.42, 0, -0.68]);
  }
  return plate;
}

function buildProceduralBiteForce() {
  const g = new THREE.Group();
  box(g, [2.8, 0.32, 2.35], white, [0, 0.25, 0], [0, 0, 0]);
  box(g, [2.95, 0.2, 0.15], white, [0, 0.42, 1.18], [0, 0, 0]);
  for (const x of [-0.98, -0.34, 0.34, 0.98]) wedge(g, [0.46, 0.36, 1.2], blue, [x, 0.08, -1.64], [0.08, 0, 0]);
  cyl(g, 0.34, 1.38, black, [0, 0.69, -0.28], [0, 0, Math.PI / 2], 64);
  cyl(g, 0.2, 1.55, steel, [0, 0.69, -0.28], [0, 0, Math.PI / 2], 32);
  trussPlate(g, -1);
  trussPlate(g, 1);
  for (const x of [-1.17, 1.17]) for (const z of [-0.76, 0.76]) tireWheel(g, [x, 0.28, z], 0.25, 0.2);
  label(g, "BITE FORCE", [0.73, 0.437, 0.77], [-Math.PI / 2, 0, -0.05], [0.95, 0.18], "#111111");
  label(g, "BITE FORCE", [-0.73, 0.437, 0.77], [-Math.PI / 2, 0, 0.05], [0.95, 0.18], "#111111");
  const boltPositions = [];
  for (let x = -1.25; x <= 1.25; x += 0.25) {
    boltPositions.push([x, 0.44, -1.03], [x, 0.44, 1.03]);
  }
  bolts(g, boltPositions, 0.028);
  g.userData.weapon = { type: "drum", object: g.children[5], spinAxis: "x", speed: 18, offset: new THREE.Vector3(0, 0.69, -0.28) };
  return g;
}

function buildBronco() {
  if (broncoModel) {
    const g = new THREE.Group();
    const model = prepareLoadedModel(broncoModel, MODEL_PART_CONFIG.bronco.fit);
    g.add(model);
    const weapon = makeBroncoFlipperWeapon(model);
    g.userData.weapon = weapon;
    g.userData.viewerParts = {
      body: weapon?.body || model,
      weapon: weapon?.object || null,
      wheels: [],
    };
    return g;
  }

  const g = new THREE.Group();
  wedge(g, [2.8, 0.45, 2.65], steel, [0, 0.15, 0.15], [0, 0, 0]);
  box(g, [2.7, 0.18, 1.52], steel, [0, 0.42, 0.2], [0.06, 0, 0]);
  const flipper = box(g, [2.25, 0.18, 2.45], steel, [0, 1.05, -0.2], [0.58, 0, 0]);
  box(g, [2.06, 0.03, 1.16], red, [0, 1.14, -0.4], [0.58, 0, 0]);
  label(g, "BRONCO", [0, 1.18, -0.68], [-0.99, 0, 0], [1.15, 0.25], "#9f201d");
  for (const x of [-1.2, 1.2]) for (const z of [-0.72, 0.72]) tireWheel(g, [x, 0.32, z], 0.34, 0.2);
  cyl(g, 0.12, 0.78, chrome, [0, 0.77, -0.2], [0.25, 0, 0], 32);
  cyl(g, 0.08, 1.12, steel, [0, 1.0, -0.25], [0.25, 0, 0], 24);
  for (const x of [-0.96, 0, 0.96]) wedge(g, [0.65, 0.24, 0.78], steel, [x, 0.09, -1.42], [0, 0, 0]);
  label(g, "VEX", [-0.88, 0.43, 0.98], [-Math.PI / 2, 0, -0.12], [0.55, 0.24], "#bd2a23");
  bolts(g, [[-1.18, 0.53, -0.82], [1.18, 0.53, -0.82], [-1.18, 0.53, 0.82], [1.18, 0.53, 0.82]], 0.035);
  g.userData.weapon = { type: "flipper", object: flipper, baseRotation: flipper.rotation.x, activeRotation: 1.12, activeSpeed: 48, returnSpeed: 4.2, returnSeconds: BOT_CONFIG.bronco.weaponReturnSeconds };
  return g;
}

function buildHuge() {
  if (hugeModel) {
    const g = new THREE.Group();
    const model = prepareLoadedModel(hugeModel, MODEL_PART_CONFIG.huge.fit);
    g.add(model);
    const movingParts = makeHugeMovingParts(model);
    if (movingParts?.weapon) movingParts.weapon.spinUpSeconds = bots.find((bot) => bot.id === "huge")?.weaponSpinUpSeconds ?? HUGE_SPINNER_SPIN_UP_SECONDS;
    g.userData.weapon = movingParts?.weapon || null;
    g.userData.drivetrain = movingParts?.drivetrain || null;
    g.userData.viewerParts = movingParts?.viewerParts || null;
    return g;
  }

  const g = new THREE.Group();
  box(g, [2.55, 0.26, 0.36], white, [0, 0.82, 0], [0, 0, 0]);
  const leftWheels = [];
  const rightWheels = [];
  for (const x of [-1.74, 1.74]) {
    const wheel = new THREE.Group();
    wheel.position.set(x, 0.96, 0);
    g.add(wheel);
    (x < 0 ? leftWheels : rightWheels).push(wheel);
    torus(wheel, 0.92, 0.075, white, [0, 0, 0], [0, Math.PI / 2, 0]);
    cyl(wheel, 0.08, 0.22, steel, [0, 0, 0], [0, 0, Math.PI / 2], 32);
    for (let i = 0; i < 6; i += 1) {
      const a = (i / 6) * Math.PI * 2;
      box(wheel, [0.09, 0.08, 0.88], white, [0, 0, 0], [0, Math.PI / 2, a]);
    }
  }
  cyl(g, 0.18, 0.52, steel, [0, 0.92, 0], [0, 0, Math.PI / 2], 48);
  const spinnerPivot = new THREE.Group();
  spinnerPivot.position.set(0, 0.92, 0);
  applyHugeSpinnerPivotOffset(spinnerPivot);
  g.add(spinnerPivot);
  const spinner = box(spinnerPivot, [0.18, 1.5, 0.23], blue, [0, 0, 0], [0, 0, 0.08]);
  spinner.position.sub(new THREE.Vector3(HUGE_SPINNER_PIVOT_OFFSET.x, HUGE_SPINNER_PIVOT_OFFSET.y, HUGE_SPINNER_PIVOT_OFFSET.z));
  box(g, [0.12, 0.92, 0.18], steel, [0, 0.92, 0], [0, 0, -0.72]);
  label(g, "HUGE", [0.55, 1.07, -0.2], [-Math.PI / 2, 0, 0], [0.55, 0.18], "#111111");
  for (const x of [-0.64, 0.64]) {
    const eye = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 32, 1, 0, Math.PI), new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.DoubleSide }));
    add(eye, g, [x, 1.02, -0.195], [Math.PI / 2, 0, x > 0 ? 0.2 : -0.2]);
  }
  g.userData.weapon = {
    type: "bar",
    object: spinnerPivot,
    spinAxis: "x",
    currentSpeed: 0,
    idleSpeed: 0,
    visualSpeed: HUGE_SPINNER_FULL_SPEED,
    spinUpSeconds: bots.find((bot) => bot.id === "huge")?.weaponSpinUpSeconds ?? HUGE_SPINNER_SPIN_UP_SECONDS,
    spinDownSeconds: HUGE_SPINNER_SPIN_DOWN_SECONDS,
    toggle: true,
    toggledOn: false,
    offset: new THREE.Vector3(0, 0.92, 0),
  };
  g.userData.drivetrain = {
    type: "tank",
    leftWheels,
    rightWheels,
    wheelRadius: 0.92,
    spinAxis: "x",
  };
  return g;
}

function buildQuantum() {
  if (quantumModel) {
    const g = new THREE.Group();
    const model = prepareLoadedModel(quantumModel, MODEL_PART_CONFIG.quantum.fit);
    g.add(model);
    const weapon = makeQuantumCrusherWeapon(model);
    g.userData.weapon = weapon;
    g.userData.viewerParts = {
      body: weapon?.body || model,
      weapon: weapon?.object || null,
      wheels: [],
    };
    return g;
  }

  const g = new THREE.Group();
  wedge(g, [2.75, 0.45, 2.25], dark, [0, 0.16, 0.12], [0, 0, 0]);
  wedge(g, [1.7, 0.34, 1.7], blue, [0.36, 0.36, -0.18], [0, 0, 0]);
  for (const x of [-1.05, 1.05]) for (const z of [-0.72, 0.72]) tireWheel(g, [x, 0.29, z], 0.25, 0.18);
  const lowerJaw = wedge(g, [1.95, 0.22, 0.86], blue, [0.1, 0.26, -1.17], [0.04, 0, 0]);
  const upper = new THREE.Group();
  box(upper, [1.1, 0.2, 1.56], chrome, [0, 0, 0], [0.64, 0, 0]);
  box(upper, [1.0, 0.12, 0.42], chrome, [0, -0.17, -0.77], [0.64, 0, 0]);
  for (let i = 0; i < 7; i += 1) wedge(upper, [0.1, 0.18, 0.18], chrome, [-0.42 + i * 0.14, -0.28, -0.88], [Math.PI, 0, 0]);
  for (const x of [-0.34, 0, 0.34]) for (const z of [-0.2, 0.28]) cyl(upper, 0.085, 0.025, black, [x, 0.105, z], [Math.PI / 2, 0, 0], 28);
  upper.position.set(-0.24, 1.05, -0.34);
  upper.rotation.x = -0.28;
  g.add(upper);
  cyl(g, 0.1, 0.85, chrome, [-0.05, 0.68, -0.22], [0.55, 0, 0], 24);
  label(g, "Quantum", [0.5, 0.51, -0.45], [-Math.PI / 2, 0, -0.05], [0.78, 0.18], "#f8fbff");
  g.userData.weapon = { type: "crusher", object: upper, baseRotation: upper.rotation.x, activeRotation: -0.72, speed: 6, lowerJaw };
  return g;
}

function buildTombstone() {
  const g = new THREE.Group();
  wedge(g, [2.28, 0.72, 1.75], black, [0, 0.33, 0.28], [0, 0, Math.PI]);
  box(g, [2.22, 0.18, 1.58], black, [0, 0.76, 0.2], [-0.22, 0, 0]);
  for (const x of [-1.35, 1.35]) tireWheel(g, [x, 0.46, 0.27], 0.43, 0.26);
  cyl(g, 0.22, 0.34, steel, [0, 0.42, -0.93], [0, 0, 0], 56);
  const blade = box(g, [3.2, 0.19, 0.46], steel, [0, 0.37, -1.34], [0, 0, -0.05]);
  box(g, [0.34, 0.2, 0.52], steel, [-1.72, 0.37, -1.34], [0, 0, -0.05]);
  box(g, [0.34, 0.2, 0.52], steel, [1.72, 0.37, -1.34], [0, 0, -0.05]);
  label(g, "TOMBSTONE", [0, 0.875, 0.27], [-1.78, 0, 0], [1.22, 0.23], "#f0f0e8");
  bolts(g, [[-0.9, 0.86, 0.7], [-0.45, 0.86, 0.7], [0, 0.86, 0.7], [0.45, 0.86, 0.7], [0.9, 0.86, 0.7]], 0.032);
  g.userData.weapon = { type: "bar", object: blade, spinAxis: "y", speed: 24, offset: new THREE.Vector3(0, 0.37, -1.34) };
  return g;
}

function isBotModelReady(id) {
  if (!MODEL_BACKED_BOTS.has(id)) return true;
  return Boolean(modelForId(id)) || modelLoadFailures.has(id);
}

function getArenaFighterIds() {
  if (onlineIsActive() && online.player1BotId && online.player2BotId) {
    return [online.player1BotId, online.player2BotId];
  }
  return [selected.id, opponent.id === selected.id ? fallbackGameBot(selected.id)?.id : opponent.id].filter(Boolean);
}

function preloadArenaFighterModels({ foreground = false } = {}) {
  getArenaFighterIds().forEach((id) => {
    if (!isBotModelReady(id) && !isBotModelLoading(id)) {
      loadBotModel(id, { foreground, reason: foreground ? "viewer" : "arena" });
    }
  });
}

async function ensureArenaFighterModelsReadyForIntro() {
  const ids = getArenaFighterIds();
  const missing = ids.filter((id) => !isBotModelReady(id));
  if (!missing.length) return true;
  await Promise.all(missing.map((id, index) => {
    const reason = id === selected.id && index === 0 ? "viewer" : "opponent";
    return loadBotModel(id, { foreground: true, reason });
  }));
  await nextPaint();
  return ids.every((id) => isBotModelReady(id));
}

async function startArenaFromViewerIntro() {
  if (mode !== "viewer" || arenaIntroStartPending) return;
  arenaIntroStartPending = true;
  if (battleToggleButton) battleToggleButton.disabled = true;
  try {
    await ensureArenaFighterModelsReadyForIntro();
  } finally {
    arenaIntroStartPending = false;
    if (battleToggleButton) battleToggleButton.disabled = false;
  }
  if (mode === "viewer") setMode("arena", { runIntro: true });
}

function selectedWeaponKind() {
  if (selected.id === "bronco") return "flipper";
  if (selected.id === "quantum") return "crusher";
  return "spinner";
}

function syncRangeNumber(range, number, value = range?.value) {
  if (!range || !number || value === undefined) return;
  const numeric = Number(value);
  const min = Number(range.min);
  const max = Number(range.max);
  const rangeValue = Number.isFinite(numeric)
    ? THREE.MathUtils.clamp(numeric, Number.isFinite(min) ? min : numeric, Number.isFinite(max) ? max : numeric)
    : value;
  range.value = Number.isFinite(rangeValue) ? String(rangeValue) : String(value);
  number.value = String(value);
}

function bindRangeNumber(range, number, onInput = null) {
  if (!range || !number) return;
  const syncFrom = (source) => {
    syncRangeNumber(range, number, source.value);
    onInput?.();
  };
  range.addEventListener("input", () => syncFrom(range));
  number.addEventListener("input", () => syncFrom(number));
  number.addEventListener("change", () => syncFrom(number));
  syncRangeNumber(range, number);
}

function arenaGravityY() {
  const value = pairedRangeNumberValue(gravityInput, gravityNumberInput, DEFAULT_GRAVITY_Y);
  if (Number.isFinite(value)) return value;
  return DEFAULT_GRAVITY_Y;
}

function applyArenaGravity() {
  if (!arena?.world) return;
  arena.world.gravity = { x: 0, y: arenaGravityY(), z: 0 };
}

function syncBotTuningControls() {
  if (botConfigSummary) botConfigSummary.textContent = `${botDisplayName(selected.id)} Config`;
  document.body.dataset.selectedWeapon = selectedWeaponKind();
  if (groundSpeedInput) {
    syncRangeNumber(groundSpeedInput, groundSpeedValue, selected.maxSpeed || TANK_DRIVE_MAX_SPEED);
  }
  if (driveAccelerationInput) {
    syncRangeNumber(driveAccelerationInput, driveAccelerationValue, selected.driveAcceleration ?? DEFAULT_BOT_ACCELERATION);
  }
  if (turningTightnessInput) {
    syncRangeNumber(turningTightnessInput, turningTightnessValue, selected.turningTightness ?? DEFAULT_BOT_TURNING_TIGHTNESS);
  }
  if (yawDampingInput) {
    syncRangeNumber(yawDampingInput, yawDampingValue, selected.yawDamping ?? GAME_CONFIG.botTuningFallbacks.yawDamping);
  }
  if (weaponSpinupInput) {
    syncRangeNumber(weaponSpinupInput, weaponSpinupValue, selected.weaponSpinUpSeconds ?? GAME_CONFIG.botTuningFallbacks.weaponSpinUpSeconds);
  }
  if (botWeightInput) botWeightInput.value = String(selected.weightLbs || GAME_CONFIG.botTuningFallbacks.botWeightLbs);
  if (weaponWeightInput) weaponWeightInput.value = String(selected.weaponWeightLbs || 0);
  if (controlSchemeSelect) controlSchemeSelect.value = selected.controlScheme || "tank";
  if (weaponRotationalInertiaInput) weaponRotationalInertiaInput.value = String(selected.weaponRotationalInertia || 0);
  if (spinnerImpactCapEnabledInput) spinnerImpactCapEnabledInput.checked = selected.spinnerImpactCapEnabled !== false;
  if (spinnerImpactCapInput) {
    spinnerImpactCapInput.disabled = selected.spinnerImpactCapEnabled === false;
    if (spinnerImpactCapValue) spinnerImpactCapValue.disabled = selected.spinnerImpactCapEnabled === false;
    syncRangeNumber(spinnerImpactCapInput, spinnerImpactCapValue, selected.spinnerImpactCap ?? (selected.id === "tombstone" ? 10.5 : 7.5));
  }
  if (spinnerImpactScaleInput) {
    syncRangeNumber(spinnerImpactScaleInput, spinnerImpactScaleValue, selected.spinnerImpactScale ?? 1);
  }
  if (spinnerGyroScaleInput) {
    syncRangeNumber(spinnerGyroScaleInput, spinnerGyroScaleValue, selected.spinnerGyroScale ?? 0.75);
  }
  syncDebugInfoControls();
}

function ensureViewerColliderHelper() {
  if (!viewerBot || viewerColliderHelper) return viewerColliderHelper;
  viewerColliderHelper = makeColliderPreview(viewerBot, selected.id);
  viewerColliderHelper.visible = false;
  viewerBot.add(viewerColliderHelper);
  return viewerColliderHelper;
}

function syncViewerColliderHelper() {
  const show = mode === "viewer" && Boolean(showCollidersInput?.checked);
  if (show) ensureViewerColliderHelper();
  if (viewerColliderHelper) {
    viewerColliderHelper.visible = show;
    viewerColliderHelper.userData.linkedHelpers?.forEach((helper) => {
      helper.visible = show;
    });
    applyColliderViewMode(viewerColliderHelper, show);
    viewerColliderHelper.userData.linkedHelpers?.forEach((helper) => applyColliderViewMode(helper, show));
  }
}

function colliderViewMode() {
  return colliderViewModeSelect?.value || "all";
}

function colliderPreviewVisibleForMode(kind, show) {
  if (!show) return false;
  const viewMode = colliderViewMode();
  if (viewMode === "physics") return kind === "physics";
  if (viewMode === "drive") return kind === "driveContact";
  if (viewMode === "weapon") return kind === "weapon";
  if (viewMode === "wedge") return kind === "wedge";
  return true;
}

function applyColliderViewMode(root, show) {
  root?.traverse((child) => {
    const kind = child.userData?.colliderKind;
    if (!kind) return;
    child.visible = colliderPreviewVisibleForMode(kind, show);
  });
}

function setColliderPreviewStyle(root, { solid = false } = {}) {
  root?.traverse((child) => {
    if (!child.material) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!material) return;
      if (child.isMesh) {
        material.transparent = true;
        material.opacity = solid ? 0.78 : material.userData.previewOpacity ?? material.opacity;
        material.depthWrite = false;
      } else if (child.isLineSegments || child.isLine) {
        material.transparent = true;
        material.opacity = solid ? 1 : material.userData.previewOpacity ?? material.opacity;
        material.depthWrite = false;
      }
      material.needsUpdate = true;
    });
  });
}

function setFighterVisualTransparency(fighter, faded) {
  fighter?.group?.traverse((child) => {
    if (!child.isMesh || child.name?.toLowerCase().includes("colliderpreview")) return;
    let node = child.parent;
    while (node) {
      if (node.name?.toLowerCase().includes("colliderpreview")) return;
      node = node.parent;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (!material) return;
      material.userData.colliderDebugOriginal ??= {
        transparent: material.transparent,
        opacity: material.opacity,
        depthWrite: material.depthWrite,
      };
      const original = material.userData.colliderDebugOriginal;
      if (faded) {
        material.transparent = true;
        material.opacity = 0.28;
        material.depthWrite = false;
      } else {
        material.transparent = original.transparent;
        material.opacity = original.opacity;
        material.depthWrite = original.depthWrite;
      }
      material.needsUpdate = true;
    });
  });
}

function syncArenaColliderHelpers() {
  const show = mode === "arena" && Boolean(showCollidersInput?.checked);
  arena?.fighters?.forEach((fighter) => {
    if (show && !fighter.colliderHelper) {
      fighter.colliderHelper = makeColliderPreview(fighter.group, fighter.spec.id, fighter.colliderParts);
      fighter.colliderHelper.visible = false;
      fighter.group.add(fighter.colliderHelper);
    }
    if (!fighter.colliderHelper) return;
    fighter.colliderHelper.position.set(0, 0, 0);
    fighter.colliderHelper.visible = show;
    fighter.colliderHelper.userData.linkedHelpers?.forEach((helper) => {
      helper.position.y = helper.userData.basePreviewPositionY ?? helper.position.y;
      helper.visible = show;
    });
    applyColliderViewMode(fighter.colliderHelper, show);
    fighter.colliderHelper.userData.linkedHelpers?.forEach((helper) => applyColliderViewMode(helper, show));
    setColliderPreviewStyle(fighter.colliderHelper, { solid: false });
    fighter.colliderHelper.userData.linkedHelpers?.forEach((helper) => setColliderPreviewStyle(helper, { solid: false }));
    setFighterVisualTransparency(fighter, false);
  });
}

function syncGlobalColliderOverlay() {
  const show = Boolean(showCollidersInput?.checked);
  if (colliderViewModeRow) {
    colliderViewModeRow.hidden = !show;
    colliderViewModeRow.classList.toggle("active", show);
  }
  syncViewerColliderHelper();
  syncArenaColliderHelpers();
}

function rebuildViewerColliderHelper() {
  if (!viewerBot) return;
  if (viewerColliderHelper) {
    viewerColliderHelper.userData.linkedHelpers?.forEach((helper) => helper.parent?.remove(helper));
    viewerBot.remove(viewerColliderHelper);
  }
  viewerColliderHelper = makeColliderPreview(viewerBot, selected.id);
  viewerColliderHelper.visible = false;
  viewerBot.add(viewerColliderHelper);
  syncViewerColliderHelper();
}

function syncDebugInfoControls() {
  if (!debugMode) {
    if (debugInfo) debugInfo.open = false;
    syncViewerColliderHelper();
    return;
  }
  debugInfo?.classList.toggle("active", mode === "viewer" || mode === "arena");
  if (debugInfo && mode === "viewer") debugInfo.open = Boolean(debugInfoOpenByBot.get(selected.id));
  syncViewerColliderHelper();
}

function syncArenaObjectControls() {
  document.body.dataset.arenaObjects = arenaObjectModeSelect?.value || "none";
}

function applySelectedBotTuning(changedField = null) {
  const before = physicsLogRecorder.active && physicsLogType() === "weapons" ? botTuningPayload(selected) : null;
  const shouldApply = (field) => !changedField || changedField === field;
  if (shouldApply("maxSpeed") && groundSpeedInput) selected.maxSpeed = pairedRangeNumberValue(groundSpeedInput, groundSpeedValue, selected.maxSpeed);
  if (shouldApply("driveAcceleration") && driveAccelerationInput) {
    selected.driveAcceleration = pairedRangeNumberValue(driveAccelerationInput, driveAccelerationValue, selected.driveAcceleration);
  }
  if (shouldApply("turningTightness") && turningTightnessInput) {
    selected.turningTightness = pairedRangeNumberValue(turningTightnessInput, turningTightnessValue, selected.turningTightness);
  }
  if (shouldApply("yawDamping") && yawDampingInput) selected.yawDamping = pairedRangeNumberValue(yawDampingInput, yawDampingValue, selected.yawDamping);
  if (shouldApply("weaponSpinUpSeconds") && weaponSpinupInput) {
    selected.weaponSpinUpSeconds = pairedRangeNumberValue(weaponSpinupInput, weaponSpinupValue, selected.weaponSpinUpSeconds);
  }
  if (shouldApply("weightLbs") && botWeightInput) selected.weightLbs = Number(botWeightInput.value);
  if (shouldApply("weaponWeightLbs") && weaponWeightInput) selected.weaponWeightLbs = Number(weaponWeightInput.value);
  if (shouldApply("controlScheme") && controlSchemeSelect) selected.controlScheme = controlSchemeSelect.value || "tank";
  if (shouldApply("weaponRotationalInertia") && weaponRotationalInertiaInput) {
    selected.weaponRotationalInertia = Number(weaponRotationalInertiaInput.value);
  }
  if (shouldApply("spinnerImpactCapEnabled") && spinnerImpactCapEnabledInput) {
    selected.spinnerImpactCapEnabled = Boolean(spinnerImpactCapEnabledInput.checked);
  }
  if (shouldApply("spinnerImpactCap") && spinnerImpactCapInput) {
    selected.spinnerImpactCap = pairedRangeNumberValue(spinnerImpactCapInput, spinnerImpactCapValue, selected.spinnerImpactCap);
  }
  if (shouldApply("spinnerImpactScale") && spinnerImpactScaleInput) {
    selected.spinnerImpactScale = pairedRangeNumberValue(spinnerImpactScaleInput, spinnerImpactScaleValue, selected.spinnerImpactScale);
  }
  if (shouldApply("spinnerGyroScale") && spinnerGyroScaleInput) {
    selected.spinnerGyroScale = pairedRangeNumberValue(spinnerGyroScaleInput, spinnerGyroScaleValue, selected.spinnerGyroScale);
  }
  if (before) {
    const after = botTuningPayload(selected);
    const changed = Object.fromEntries(Object.entries(after).filter(([key, value]) => before[key] !== value));
    if (Object.keys(changed).length) recordPhysicsLogEvent("tuning", { bot: selected.id, changed, before, after });
  }
  syncBotTuningControls();
  [viewerBot?.userData?.weapon, ...(arena?.fighters || []).filter((fighter) => fighter.spec?.id === selected.id).map((fighter) => fighter.weapon)]
    .filter(Boolean)
    .forEach((weapon) => {
      if (shouldApply("weaponSpinUpSeconds")) weapon.spinUpSeconds = selected.weaponSpinUpSeconds;
    });
  publishOnlinePlayerConfig("tuning");
}

function setSelected(bot) {
  if (!isGameBotVisible(bot) && !onlineIsActive()) return;
  if (onlineIsActive()) {
    const lockedOpponentId = onlineOpponentBotId();
    if (bot.id === lockedOpponentId) {
      onlineSetMessage("Your opponent has already chosen that bot");
      syncBotPicker();
      return;
    }
    bumpLoadingPriority();
    selected = bot;
    if (onlineLocalPlayerNumber() === 2) online.player2BotId = bot.id;
    else online.player1BotId = bot.id;
    opponent = botById(onlineOpponentBotId(), opponent);
    syncOpponentSelect();
    syncSelectedBotReadout();
    loadBotModel(bot.id, { foreground: mode === "viewer", reason: mode === "viewer" ? "viewer" : "bot" });
    if (mode === "viewer") preloadArenaFighterModels({ foreground: false });
    if (mode === "viewer") showViewerBot();
    if (mode === "arena") buildArena();
    publishOnlinePlayerConfig("bot");
    return;
  }
  bumpLoadingPriority();
  selected = bot;
  if (!opponent || opponent.id === selected.id || !isGameBotVisible(opponent)) opponent = fallbackGameBot(selected.id);
  syncOpponentSelect();
  syncSelectedBotReadout();
  loadBotModel(bot.id, { foreground: mode === "viewer", reason: mode === "viewer" ? "viewer" : "bot" });
  if (mode === "viewer") preloadArenaFighterModels({ foreground: false });
  if (mode === "viewer") showViewerBot();
  if (mode === "arena") buildArena();
}

async function showViewerBot() {
  const generation = bumpLoadingPriority();
  const targetId = selected.id;
  const targetName = botDisplayName(targetId);
  const doneLoading = beginLoading("Preparing viewer", {
    detail: loadingDetail("Preparing viewer", [`bot: ${targetName}`, "checking model cache"]),
    generation,
  });
  await nextPaint();
  if (generation !== loadingGeneration || mode !== "viewer" || selected.id !== targetId) {
    doneLoading();
    return;
  }
  doneLoading.update(loadingDetail("Preparing viewer", [`bot: ${targetName}`, "clearing previous scene"]));
  if (viewerBot) scene.remove(viewerBot);
  viewerBot = null;
  viewerColliderHelper = null;
  disposeArena();
  if (!isBotModelReady(targetId)) {
    doneLoading.update(loadingDetail("Preparing viewer", [`bot: ${targetName}`, "loading model asset"]));
    loadBotModel(targetId, { foreground: true, reason: "viewer" });
    doneLoading();
    return;
  }
  if (generation !== loadingGeneration || mode !== "viewer" || selected.id !== targetId) {
    doneLoading();
    return;
  }
  doneLoading.update(loadingDetail("Preparing viewer", [`bot: ${targetName}`, "building visible model"]));
  await nextPaint();
  if (generation !== loadingGeneration || mode !== "viewer" || selected.id !== targetId) {
    doneLoading();
    return;
  }
  viewerBot = selected.builder();
  viewerBot.scale.setScalar(selected.id === "huge" ? 1.15 : 1.35);
  viewerBot.position.set(-1.6, 0, 0);
  viewerBot.rotation.set(...(selected.viewerRotation || [0, 0, 0]));
  viewerBot.updateMatrixWorld(true);
  viewerBot.position.y += ARENA_VISUAL_FLOOR_Y + measureArenaVisualFloorOffset(viewerBot);
  scene.add(viewerBot);
  if (showCollidersInput?.checked) syncViewerColliderHelper();
  scheduleSecondaryWork(() => {
    if (generation !== loadingGeneration || mode !== "viewer" || selected.id !== targetId || !viewerBot) return;
    if (!viewerColliderHelper) {
      ensureViewerColliderHelper();
      syncViewerColliderHelper();
    }
  });
  requestAnimationFrame(doneLoading);
}

function isGroundingVisualMesh(mesh) {
  if (!mesh?.isMesh || !mesh.visible) return false;
  let node = mesh;
  while (node) {
    const name = node.name?.toLowerCase() || "";
    if (name.includes("helper") || name.includes("colliderpreview")) return false;
    node = node.parent;
  }
  return true;
}

function measureArenaVisualFloorOffset(group) {
  // A segmented model was grounded on its DRAWN geometry when it was
  // normalized, so it needs no correction here — and measuring it through the
  // position buffer would reintroduce the orphaned vertices a carve leaves
  // behind (v2 traced Endgame hovering 0.46ft up to exactly that).
  if (group?.userData?.segmentedModel) return 0;
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  group.traverse((child) => {
    if (!isGroundingVisualMesh(child) || !child.geometry?.attributes?.position) return;
    const position = child.geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      point.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
      bounds.expandByPoint(point);
    }
  });
  return Number.isFinite(bounds.min.y) ? -bounds.min.y : 0;
}

function showAllBotsEnabled() {
  return Boolean(showAllBotsInput?.checked);
}

function isGameBotVisible(bot) {
  return showAllBotsEnabled() || !GAME_HIDDEN_BOT_IDS.has(bot?.id);
}

function gameVisibleBots() {
  return bots.filter(isGameBotVisible);
}

function fallbackGameBot(excludeId = null) {
  return gameVisibleBots().find((bot) => bot.id !== excludeId) || bots.find((bot) => bot.id !== excludeId) || bots[0];
}

function createPicker() {
  bots.forEach((bot) => {
    const button = document.createElement("button");
    button.dataset.id = bot.id;
    button.dataset.short = bot.short;
    button.hidden = !isGameBotVisible(bot);
    button.setAttribute("aria-label", bot.name);
    const thumb = document.createElement("img");
    thumb.src = bot.ref;
    thumb.alt = "";
    button.append(thumb);
    button.addEventListener("click", () => setSelected(bot));
    picker.append(button);
  });
}

function syncOpponentSelect() {
  if (!opponentSelect) return;
  opponentSelect.innerHTML = "";
  if (onlineIsActive()) {
    const option = document.createElement("option");
    option.value = opponent.id;
    option.textContent = opponent.name;
    option.selected = true;
    opponentSelect.append(option);
    return;
  }
  gameVisibleBots()
    .filter((bot) => bot.id !== selected.id)
    .forEach((bot) => {
      const option = document.createElement("option");
      option.value = bot.id;
      option.textContent = bot.name;
      option.selected = bot.id === opponent.id;
      opponentSelect.append(option);
    });
}

function syncPhysicsModeUi() {
  physics.setEnabled(true);
  physics.setOptions?.({
    spinnerKnockbackEnabled: spinnerKnockbackToggleInput?.checked !== false,
    plowDefenceEnabled: plowDefenceToggleInput?.checked !== false,
    teeterAssistEnabled: teeterAssistToggleInput?.checked === true,
    colliderCenterOfMassEnabled: colliderComToggleInput?.checked === true,
    softFloorCorrectionEnabled: softFloorCorrectionToggleInput?.checked !== false,
    arenaHalfWidth: ARENA_HALF_WIDTH,
    arenaHalfLength: ARENA_HALF_LENGTH,
    arenaCeilingHeight: ARENA_CEILING_HEIGHT,
  });
  document.body.dataset.physicsVersion = "2";
  document.body.dataset.physicalDamageEnabled = String(physicalDamageEnabled());
  syncPhysicsLogUi();
}

function onlineSetMessage(message) {
  online.message = message;
  if (onlineStatus) onlineStatus.textContent = message;
  controllerStatus.textContent = mode === "arena" && arenaPaused ? pauseOverlay?.textContent || "Arena paused" : message;
}

function onlineIsActive() {
  return online.role === "host" || online.role === "joiner";
}

function onlineIsPlaying() {
  return onlineIsActive() && online.state === "playing";
}

function localArenaFighterIndex() {
  return online.role === "joiner" ? 1 : 0;
}

function onlineRenderUi() {
  const canJoin = !onlineIsActive() && onlineAvailableRooms().length > 0;
  document.body.dataset.onlineActive = String(onlineIsActive());
  document.body.dataset.onlineRole = online.role || "none";
  if (hostArenaButton) hostArenaButton.hidden = onlineIsActive();
  if (joinArenaButton) {
    joinArenaButton.hidden = !canJoin;
    joinArenaButton.disabled = !canJoin;
  }
  if (leaveOnlineButton) {
    leaveOnlineButton.hidden = !onlineIsActive();
    leaveOnlineButton.textContent = online.role === "host" && online.state === "waiting" ? "Stop Hosting" : "Leave";
  }
  if (onlineStatus) onlineStatus.textContent = online.message;
}

function onlineAvailableRooms() {
  const now = Date.now();
  return online.hostedRooms
    .filter((room) => room.hostClientId !== onlineClientId)
    .filter((room) => room.status === "waiting")
    .filter((room) => now - Number(room.updatedAt || 0) < ONLINE_LOBBY_STALE_MS)
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

function closeOnlineRoomRecord(room, status = "closed") {
  if (!room?.id) return Promise.resolve();
  return onlineDb.transact(onlineDb.tx[ONLINE_ROOM_ENTITY][room.id].update({
    status,
    updatedAt: Date.now(),
  }));
}

function pruneStaleOnlineRooms() {
  const now = Date.now();
  const staleRooms = online.hostedRooms.filter((room) => (
    room.status !== "closed" &&
    now - Number(room.updatedAt || room.createdAt || 0) >= ONLINE_LOBBY_STALE_MS
  ));
  staleRooms.forEach((room) => closeOnlineRoomRecord(room, "closed"));
}

function newestActiveOnlineRoom() {
  return online.hostedRooms
    .filter((room) => room.status !== "closed")
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0] || null;
}

function handleSupersededOnlineHost() {
  if (online.role !== "host" || !online.recordId) return;
  const newest = newestActiveOnlineRoom();
  if (!newest || newest.id === online.recordId) return;
  if (Number(newest.createdAt || 0) <= Number(online.hostedRooms.find((room) => room.id === online.recordId)?.createdAt || 0)) return;
  stopOnlineSession({ notify: true, message: "Another host started a new game." });
}

function updateOnlineLobbyButtons() {
  const available = onlineAvailableRooms();
  if (!onlineIsActive() && !online.message.startsWith("Could not")) onlineSetMessage(available.length ? "Arena available online" : "Online idle");
  onlineRenderUi();
}

function subscribeOnlineLobby() {
  if (online.unsubLobby) return;
  online.unsubLobby = onlineDb.subscribeQuery({ [ONLINE_ROOM_ENTITY]: {} }, (resp) => {
    if (resp.error) {
      onlineSetMessage(`Online error: ${resp.error.message}`);
      onlineRenderUi();
      return;
    }
    online.hostedRooms = resp.data?.[ONLINE_ROOM_ENTITY] || [];
    pruneStaleOnlineRooms();
    handleSupersededOnlineHost();
    if (online.role === "joiner" && online.recordId) {
      const room = online.hostedRooms.find((candidate) => candidate.id === online.recordId);
      if (room?.status === "closed") {
        stopOnlineSession({ notify: false, message: "Host has stopped the game." });
      }
    }
    updateOnlineLobbyButtons();
  });
}

function botById(id, fallback = selected) {
  return bots.find((bot) => bot.id === id) || fallback || bots[0];
}

function onlineLocalPlayerNumber() {
  return online.role === "joiner" ? 2 : 1;
}

function onlineLocalBotId() {
  return onlineLocalPlayerNumber() === 2 ? online.player2BotId : online.player1BotId;
}

function onlineOpponentBotId() {
  return onlineLocalPlayerNumber() === 2 ? online.player1BotId : online.player2BotId;
}

function botTuningPayload(bot) {
  if (!bot) return null;
  return {
    maxSpeed: bot.maxSpeed,
    driveAcceleration: bot.driveAcceleration,
    turningTightness: bot.turningTightness,
    yawDamping: bot.yawDamping,
    weaponSpinUpSeconds: bot.weaponSpinUpSeconds,
    weightLbs: bot.weightLbs,
    weaponWeightLbs: bot.weaponWeightLbs,
    controlScheme: bot.controlScheme,
    weaponRotationalInertia: bot.weaponRotationalInertia,
    spinnerImpactCapEnabled: bot.spinnerImpactCapEnabled,
    spinnerImpactCap: bot.spinnerImpactCap,
    spinnerImpactScale: bot.spinnerImpactScale,
    spinnerGyroScale: bot.spinnerGyroScale,
  };
}

function applyBotTuningPayload(botId, tuning) {
  const bot = bots.find((candidate) => candidate.id === botId);
  if (!bot || !tuning) return;
  Object.entries(tuning).forEach(([key, value]) => {
    if (value !== undefined) bot[key] = value;
  });
}

function gameRulesPayload() {
  return {
    damageEffects: damageEffectsEnabled(),
    physicalDamage: physicalDamageEnabled(),
    failureThreshold: physicalDamageFailureThreshold(),
    damageEvents: damageEventsEnabled(),
  };
}

function applyGameRulesPayload(rules = {}) {
  if (!rules || typeof rules !== "object") return;
  if (sandboxModeInput && rules.damageEffects !== undefined) sandboxModeInput.checked = !Boolean(rules.damageEffects);
  if (physicalDamageToggleInput && rules.physicalDamage !== undefined) physicalDamageToggleInput.checked = Boolean(rules.physicalDamage);
  if (showDamageEventsInput && rules.damageEvents !== undefined) showDamageEventsInput.checked = Boolean(rules.damageEvents);
  if (Number.isFinite(rules.failureThreshold)) {
    if (physicalDamageFailureThresholdInput) physicalDamageFailureThresholdInput.value = String(rules.failureThreshold);
    if (physicalDamageFailureThresholdValue) physicalDamageFailureThresholdValue.value = String(rules.failureThreshold);
  }
  syncDamageVisibility();
}

function syncBotPicker() {
  const lockedOpponentId = onlineIsActive() ? onlineOpponentBotId() : null;
  [...picker.children].forEach((button) => {
    const bot = bots.find((candidate) => candidate.id === button.dataset.id);
    const isSelected = button.dataset.id === selected.id;
    button.hidden = !isGameBotVisible(bot);
    button.classList.toggle("active", isSelected);
    button.disabled = Boolean(lockedOpponentId && button.dataset.id === lockedOpponentId && !isSelected);
    button.title = button.disabled ? "Opponent bot locked" : "";
  });
}

function syncGameBotVisibility() {
  if (!onlineIsActive()) {
    if (!isGameBotVisible(selected)) selected = fallbackGameBot(opponent.id);
    if (!isGameBotVisible(opponent) || opponent.id === selected.id) opponent = fallbackGameBot(selected.id);
  }
  syncOpponentSelect();
  syncSelectedBotReadout();
  if (mode === "viewer") showViewerBot();
  if (mode === "arena") buildArena();
}

function syncSelectedBotReadout() {
  if (!isGameBotVisible(selected) && !onlineIsActive()) {
    selected = fallbackGameBot(opponent.id);
  }
  if (!isGameBotVisible(opponent) && !onlineIsActive()) {
    opponent = fallbackGameBot(selected.id);
  }
  if (opponent.id === selected.id && !onlineIsActive()) {
    opponent = fallbackGameBot(selected.id);
  }
  syncBotUrlState();
  document.body.dataset.selectedBot = selected.id;
  reference.src = selected.ref;
  reference.alt = `${selected.name} reference`;
  botName.textContent = selected.name;
  botNotes.textContent = selected.notes;
  if (colliderTweakerLink) colliderTweakerLink.href = `./collider-tweaker.html?bot=${encodeURIComponent(selected.id)}`;
  syncBotTuningControls();
  syncBotPicker();
}

function setOnlineBots(player1BotId, player2BotId, { rebuild = false } = {}) {
  const player1 = botById(player1BotId);
  const player2 = botById(player2BotId, bots.find((bot) => bot.id !== player1.id) || bots[0]);
  online.player1BotId = player1.id;
  online.player2BotId = player2.id;
  selected = online.role === "joiner" ? player2 : player1;
  opponent = online.role === "joiner" ? player1 : player2;
  syncOpponentSelect();
  syncSelectedBotReadout();
  if (rebuild && mode === "arena") buildArena();
}

function publishOnlinePlayerConfig(reason = "config") {
  if (!onlineIsActive() || !online.room) return;
  const playerNumber = onlineLocalPlayerNumber();
  const localBotId = selected.id;
  const payload = {
    clientId: onlineClientId,
    role: online.role,
    playerNumber,
    botId: localBotId,
    tuning: botTuningPayload(selected),
    reason,
    sentAt: Date.now(),
  };
  if (playerNumber === 1) online.player1BotId = localBotId;
  else online.player2BotId = localBotId;
  if (online.role === "host") {
    transactOnlineRoom({ player1BotId: online.player1BotId, player2BotId: online.player2BotId, status: online.state === "playing" ? "playing" : "waiting", paused: arenaPaused });
    online.room.publishTopic("arenaConfig", {
      ...payload,
      hostClientId: onlineClientId,
      player1BotId: online.player1BotId,
      player2BotId: online.player2BotId,
      player1Tuning: botTuningPayload(botById(online.player1BotId)),
      player2Tuning: botTuningPayload(botById(online.player2BotId)),
      rules: gameRulesPayload(),
    });
  } else {
    online.room.publishTopic("playerConfig", payload);
  }
}

function applyOnlineArenaConfig(event, { rebuild = true } = {}) {
  if (!event?.player1BotId || !event?.player2BotId) return;
  applyBotTuningPayload(event.player1BotId, event.player1Tuning);
  applyBotTuningPayload(event.player2BotId, event.player2Tuning);
  applyGameRulesPayload(event.rules);
  setOnlineBots(event.player1BotId, event.player2BotId, { rebuild });
}

function transactOnlineRoom(update) {
  if (!online.recordId) return Promise.resolve();
  return onlineDb.transact(onlineDb.tx[ONLINE_ROOM_ENTITY][online.recordId].update({
    ...update,
    updatedAt: Date.now(),
  }));
}

function closeOnlineRoom(status = "closed") {
  if (!online.recordId) return Promise.resolve();
  return onlineDb.transact(onlineDb.tx[ONLINE_ROOM_ENTITY][online.recordId].update({
    status,
    updatedAt: Date.now(),
  }));
}

function leaveOnlineRoom() {
  online.unsubTopics.forEach((unsub) => unsub?.());
  online.unsubTopics = [];
  online.room?.leaveRoom?.();
  online.room = null;
}

function joinOnlineRealtimeRoom(role, roomId) {
  leaveOnlineRoom();
  online.room = onlineDb.joinRoom("arena", roomId, {
    initialPresence: {
      clientId: onlineClientId,
      name: onlinePlayerName,
      role,
    },
  });
  online.unsubTopics.push(
    online.room.subscribeTopic("joinRequest", (event) => {
      if (online.role !== "host" || online.state !== "waiting") return;
      if (!event?.clientId || event.clientId === onlineClientId) return;
      acceptOnlineJoiner(event);
    }),
    online.room.subscribeTopic("joinAccepted", (event) => {
      if (online.role !== "joiner" || event?.clientId !== onlineClientId) return;
      applyBotTuningPayload(event.player1BotId, event.player1Tuning);
      applyBotTuningPayload(event.player2BotId, event.player2Tuning);
      applyGameRulesPayload(event.rules);
      startOnlineArena("joiner", event.player1BotId, event.player2BotId, event.hostClientId, event.clientId);
    }),
    online.room.subscribeTopic("hostStopped", () => {
      if (online.role !== "joiner") return;
      stopOnlineSession({ notify: false, message: "Host has stopped the game." });
    }),
    online.room.subscribeTopic("playerLeft", (event) => {
      if (event?.clientId === onlineClientId) return;
      if (online.role === "host") {
        online.joinerClientId = null;
        online.state = "waiting";
        online.remoteInput = completeDriveInput({ weapon: false });
        onlineSetMessage(`Player 2 has left the game. ${ONLINE_WAITING_MESSAGE}`);
        transactOnlineRoom({ status: "waiting", joinerClientId: null, paused: true, pauseOwnerClientId: null });
        if (mode !== "arena") setMode("arena");
        setArenaPaused(true);
      } else if (online.role === "joiner") {
        stopOnlineSession({ notify: false, message: "Host has stopped the game." });
      }
    }),
    online.room.subscribeTopic("pauseState", (event) => {
      if (!onlineIsActive() || event?.clientId === onlineClientId) return;
      if (event?.hostClientId && event.hostClientId !== online.hostClientId) return;
      applyOnlinePauseState(Boolean(event?.paused), event?.clientId || null);
    }),
    online.room.subscribeTopic("playerConfig", (event) => {
      if (online.role !== "host" || event?.clientId !== online.joinerClientId || event?.playerNumber !== 2) return;
      const nextPlayer2BotId = event.botId && event.botId !== online.player1BotId ? event.botId : online.player2BotId;
      applyBotTuningPayload(nextPlayer2BotId, event.tuning);
      online.player2BotId = nextPlayer2BotId;
      opponent = botById(nextPlayer2BotId, opponent);
      syncOpponentSelect();
      syncBotPicker();
      transactOnlineRoom({ status: online.state === "playing" ? "playing" : "waiting", player2BotId: nextPlayer2BotId, paused: arenaPaused });
      online.room.publishTopic("arenaConfig", {
        clientId: onlineClientId,
        hostClientId: onlineClientId,
        player1BotId: online.player1BotId,
        player2BotId: online.player2BotId,
        player1Tuning: botTuningPayload(botById(online.player1BotId)),
        player2Tuning: botTuningPayload(botById(online.player2BotId)),
        rules: gameRulesPayload(),
        reason: event.reason || "playerConfig",
        sentAt: Date.now(),
      });
      if (mode === "arena") buildArena();
    }),
    online.room.subscribeTopic("arenaConfig", (event) => {
      if (online.role !== "joiner" || event?.hostClientId !== online.hostClientId) return;
      applyOnlineArenaConfig(event);
    }),
    online.room.subscribeTopic("input", (event) => {
      if (online.role !== "host" || event?.clientId !== online.joinerClientId) return;
      online.remoteInput = completeDriveInput(event.input || {});
      online.lastProcessedJoinerInputSeq = Math.max(online.lastProcessedJoinerInputSeq, Number(event.seq || 0));
      online.lastRemoteInputAt = performance.now();
    }),
    online.room.subscribeTopic("snapshot", (event) => {
      if (online.role !== "joiner" || event?.hostClientId !== online.hostClientId) return;
      appendOnlineSnapshot(event);
    }),
  );
}

function startOnlineArena(role, player1BotId, player2BotId, hostClientId, joinerClientId) {
  online.role = role;
  online.state = "playing";
  online.player1BotId = player1BotId;
  online.player2BotId = player2BotId;
  online.hostClientId = hostClientId;
  online.joinerClientId = joinerClientId;
  clearOnlineRuntimeState();
  online.remoteInput = completeDriveInput({ weapon: false });
  online.pauseOwnerClientId = null;
  setOnlineBots(player1BotId, player2BotId);
  onlineSetMessage(role === "host" ? "Player 2 joined. Arena online" : "Joined arena as player 2");
  onlineRenderUi();
  setMode("arena");
  setArenaPaused(false);
}

function acceptOnlineJoiner(event) {
  const player2BotId = event.botId && event.botId !== selected.id ? event.botId : opponent.id;
  applyBotTuningPayload(player2BotId, event.tuning);
  online.joinerClientId = event.clientId;
  online.player1BotId = selected.id;
  online.player2BotId = player2BotId;
  online.state = "playing";
  opponent = botById(player2BotId, opponent);
  syncOpponentSelect();
  transactOnlineRoom({
    status: "playing",
    joinerClientId: event.clientId,
    player2BotId,
    paused: false,
    pauseOwnerClientId: null,
  });
  online.room.publishTopic("joinAccepted", {
    clientId: event.clientId,
    hostClientId: onlineClientId,
    player1BotId: selected.id,
    player2BotId,
    player1Tuning: botTuningPayload(botById(selected.id)),
    player2Tuning: botTuningPayload(botById(player2BotId)),
    rules: gameRulesPayload(),
    startedAt: Date.now(),
  });
  startOnlineArena("host", selected.id, player2BotId, onlineClientId, event.clientId);
}

async function hostOnlineArena() {
  if (onlineIsActive()) return;
  await Promise.all(
    online.hostedRooms
      .filter((room) => room.status !== "closed")
      .map((room) => closeOnlineRoomRecord(room, "closed")),
  );
  const roomId = instantId();
  const recordId = instantId();
  online.role = "host";
  online.state = "waiting";
  online.roomId = roomId;
  online.recordId = recordId;
  online.hostClientId = onlineClientId;
  online.player1BotId = selected.id;
  online.player2BotId = opponent.id;
  joinOnlineRealtimeRoom("host", roomId);
  onlineSetMessage(ONLINE_WAITING_MESSAGE);
  onlineRenderUi();
  setOnlineBots(selected.id, opponent.id);
  if (mode !== "arena") setMode("arena");
  setArenaPaused(true);
  await onlineDb.transact(onlineDb.tx[ONLINE_ROOM_ENTITY][recordId].update({
    roomId,
    hostClientId: onlineClientId,
    hostName: onlinePlayerName,
    status: "waiting",
    player1BotId: selected.id,
    player2BotId: opponent.id,
    paused: true,
    pauseOwnerClientId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));
}

async function joinOnlineArena() {
  if (onlineIsActive()) return;
  const room = onlineAvailableRooms()[0];
  if (!room) {
    onlineSetMessage("No hosted arena is available");
    onlineRenderUi();
    return;
  }
  online.role = "joiner";
  online.state = "joining";
  online.roomId = room.roomId;
  online.recordId = room.id;
  online.hostClientId = room.hostClientId;
  online.player1BotId = room.player1BotId;
  online.player2BotId = selected.id === room.player1BotId ? room.player2BotId : selected.id;
  joinOnlineRealtimeRoom("joiner", room.roomId);
  onlineSetMessage("Joining hosted arena...");
  onlineRenderUi();
  setOnlineBots(online.player1BotId, online.player2BotId);
  if (mode !== "arena") setMode("arena");
  online.room.publishTopic("joinRequest", {
    clientId: onlineClientId,
    name: onlinePlayerName,
    botId: online.player2BotId,
    tuning: botTuningPayload(selected),
    requestedAt: Date.now(),
  });
}

function stopOnlineSession({ notify = true, message = null } = {}) {
  const wasHost = online.role === "host";
  const wasPlaying = online.state === "playing";
  if (notify && online.room) {
    if (wasHost) online.room.publishTopic("hostStopped", { clientId: onlineClientId });
    else online.room.publishTopic("playerLeft", { clientId: onlineClientId, role: online.role });
  }
  if (wasHost) closeOnlineRoom("closed");
  leaveOnlineRoom();
  online.role = null;
  online.state = "idle";
  online.roomId = null;
  online.recordId = null;
  online.hostClientId = null;
  online.joinerClientId = null;
  online.player1BotId = null;
  online.player2BotId = null;
  clearOnlineRuntimeState();
  online.pauseOwnerClientId = null;
  online.remoteInput = completeDriveInput({ weapon: false });
  onlineSetMessage(message || (wasHost && !wasPlaying ? "Hosting cancelled" : "Online idle"));
  onlineRenderUi();
}

function visibleArenaElementsOfType(type) {
  return (ARENA_LAYOUT.elements || []).filter((element) => element.type === type && element.visibleInGame !== false);
}

// Arena geometry/materials live in shared/arenaVisuals.js so v1 and v2 render
// the identical BattleBox. v1 keeps animating the returned hazard elements
// through updateKillSawHazardVisuals / its screw spin loop.
function createArenaVisualRoot() {
  return createSharedArenaVisualRoot({
    layout: ARENA_LAYOUT,
    hazards: { createScrewHazardElement, createKillSawHazardElement },
    assetBase: "./",
  });
}


function takeArenaVisualRoot() {
  if (cachedArenaVisualRoot) {
    const root = cachedArenaVisualRoot;
    cachedArenaVisualRoot = null;
    cachedArenaVisualRootReady = false;
    return root;
  }
  return createArenaVisualRoot();
}

function disposeThreeObject(object) {
  object?.traverse?.((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material?.dispose?.());
  });
}

function clearFightIntroPreviewRoot() {
  if (!fightIntroPreviewRoot) return;
  scene.remove(fightIntroPreviewRoot);
  disposeThreeObject(fightIntroPreviewRoot);
  fightIntroPreviewRoot = null;
}

function warmBattleBoxArena() {
  if (cachedArenaVisualRoot || cachedArenaVisualRootReady || arena) return;
  cachedArenaVisualRootReady = true;
  window.setTimeout(() => {
    if (cachedArenaVisualRoot || arena || mode !== "viewer") {
      cachedArenaVisualRootReady = Boolean(cachedArenaVisualRoot);
      return;
    }
    cachedArenaVisualRoot = createArenaVisualRoot();
    cachedArenaVisualRootReady = true;
  }, 350);
}

async function buildArena({ runIntro = false } = {}) {
  const generation = bumpLoadingPriority();
  const ids = getArenaFighterIds();
  const fighterNames = ids.map(botDisplayName).join(" vs ");
  const doneLoading = beginLoading("Preparing arena", { detail: `Preparing arena\nfighters: ${fighterNames}\nchecking model cache`, generation });
  const previousTestOptions = arena?.testOptions || {};
  await nextPaint();
  if (generation !== loadingGeneration || mode !== "arena") {
    doneLoading();
    return;
  }
  doneLoading.update(`Preparing arena\nfighters: ${fighterNames}\nclearing previous scene`);
  disposeArena();
  if (viewerBot) scene.remove(viewerBot);
  if (generation !== loadingGeneration || mode !== "arena") {
    doneLoading();
    return;
  }
  doneLoading.update(`Preparing arena\nfighters: ${fighterNames}\nshowing BattleBox`);
  if (runIntro) {
    fightIntroPreviewRoot = createArenaVisualRoot();
    scene.add(fightIntroPreviewRoot);
    beginEmptyArenaIntro();
  }
  doneLoading.setBackground();
  await nextPaint();
  if (generation !== loadingGeneration || mode !== "arena") {
    clearFightIntroPreviewRoot();
    doneLoading();
    return;
  }
  doneLoading.update(`Preparing arena\nfighters: ${fighterNames}\npreparing match BattleBox`);
  const root = takeArenaVisualRoot();
  const sparks = new THREE.Group();
  root.add(sparks);
  arena = {
    root,
    sparks,
    fighters: [],
    props: [],
    hazards: root.userData.hazards || [],
    screwHazards: root.userData.screwHazards || [],
    killSawHazards: root.userData.killSawHazards || [],
    world: null,
    testOptions: previousTestOptions,
    matchTimeRemaining: MATCH_DURATION_SECONDS,
    knockoutPending: false,
    roundOver: false,
    killSawCalloutShown: false,
  };
  document.body.dataset.roundOver = "false";
  if (roundEndOverlay) roundEndOverlay.hidden = true;
  if (knockoutBanner) knockoutBanner.textContent = "";
  updateMatchHud();
  await nextPaint();
  if (!ids.every((id) => isBotModelReady(id))) {
    const missing = ids.filter((id) => !isBotModelReady(id));
    console.info(`Preparing arena intro: waiting for bot models (${missing.map(botDisplayName).join(", ")}). If the camera stutters here, GLB parsing is still happening on the main thread.`);
    viewerBot = null;
    for (const id of missing) {
      loadBotModel(id, { foreground: false, reason: "arena" });
      await nextPaint();
    }
    while (!ids.every((id) => isBotModelReady(id))) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      await nextPaint();
      if (generation !== loadingGeneration || mode !== "arena") {
        disposeArena();
        doneLoading();
        return;
      }
    }
  }
  if (runIntro) {
    const elapsedIntroSeconds = fightIntro?.phase === "empty" ? (performance.now() - fightIntro.startedAt) / 1000 : 0;
    await new Promise((resolve) => window.setTimeout(resolve, Math.max(0, fightIntroPreviewOrbitSeconds() - elapsedIntroSeconds) * 1000));
  }
  if (generation !== loadingGeneration || mode !== "arena") {
    disposeArena();
    doneLoading();
    return;
  }
  if (rapierReady) {
    doneLoading.update(`Preparing arena\nfighters: ${fighterNames}\ncreating physics world and colliders`);
    await nextPaint();
    if (generation !== loadingGeneration || mode !== "arena") {
      disposeArena();
      doneLoading();
      return;
    }
    const initialized = await initPhysicsArena(
      (stage) => doneLoading.update(`Preparing arena\nfighters: ${fighterNames}\n${stage}`),
      () => generation === loadingGeneration && mode === "arena",
    );
    if (!initialized) {
      disposeArena();
      doneLoading();
      return;
    }
    scene.add(root);
    if (runIntro) {
      warmIntroGameArenaOffscreen();
      await nextPaint();
    }
    if (runIntro) clearFightIntroPreviewRoot();
    if (runIntro) {
      await nextPaint();
      if (generation !== loadingGeneration || mode !== "arena") {
        disposeArena();
        doneLoading();
        return;
      }
      beginFightCountdownIntro();
      await nextPaint();
    }
  } else {
    doneLoading.update(`Preparing arena\nfighters: ${fighterNames}\nwaiting for physics engine`);
  }
  requestAnimationFrame(doneLoading);
}

function configuredColliderParts(id) {
  const config = MODEL_PART_CONFIG[id] || {};
  return config.collider?.parts || config.colliders || [];
}

function filterColliderPartsForDriveContacts(parts, includeDriveContacts = true) {
  return includeDriveContacts ? parts : parts.filter((part) => part.part !== "driveContact");
}

function botColliderParts(id, { includeDriveContacts = true } = {}) {
  return filterColliderPartsForDriveContacts(configuredColliderParts(id), includeDriveContacts);
}

function botPartConfig(id) {
  MODEL_PART_CONFIG[id] ||= {};
  MODEL_PART_CONFIG[id].collider ||= {};
  MODEL_PART_CONFIG[id].collider.parts ||= [];
  return MODEL_PART_CONFIG[id];
}

function cloneColliderPart(part) {
  const copy = {
    type: part.type || "box",
    part: part.part || "body",
    position: [...(part.position || [0, 0, 0])],
    halfExtents: [...(part.halfExtents || [0.4, 0.15, 0.4])],
    rotation: [...(part.rotation || [0, 0, 0])],
    density: part.density ?? 3,
  };
  if (part.side) copy.side = part.side;
  if (part.vertices) copy.vertices = clonePointArray(part.vertices);
  if (part.friction !== undefined) copy.friction = part.friction;
  if (part.restitution !== undefined) copy.restitution = part.restitution;
  if (part.ignoreGroundContact !== undefined) copy.ignoreGroundContact = part.ignoreGroundContact;
  if (part.ignoreLocalBottomFloorContact !== undefined) copy.ignoreLocalBottomFloorContact = part.ignoreLocalBottomFloorContact;
  return copy;
}

function viewerWheelObjects(group) {
  const drivetrain = group?.userData?.drivetrain;
  const wheels = [
    ...(drivetrain?.leftWheels || []).map((object) => ({ object, side: "left" })),
    ...(drivetrain?.rightWheels || []).map((object) => ({ object, side: "right" })),
  ];
  if (wheels.length) return wheels;
  return (group?.userData?.viewerParts?.wheels || []).map((object) => ({ object, side: null }));
}

function sideContactX(side, bounds, halfWidth, extraOutboard = 0.12) {
  if (!bounds || !Number.isFinite(bounds.min.x)) return 0;
  const overlap = halfWidth * THREE.MathUtils.clamp(1 - extraOutboard, 0.3, 0.95);
  return side === "left"
    ? bounds.min.x - halfWidth + overlap
    : bounds.max.x + halfWidth - overlap;
}

function clampDriveContactToBody(part, bodyBounds) {
  if (!bodyBounds || !Number.isFinite(bodyBounds.min.x)) return part;
  const next = cloneColliderPart(part);
  next.side = part.side;
  next.friction = part.friction;
  next.restitution = part.restitution;
  const halfWidth = next.halfExtents[0];
  const side = next.side || (next.position[0] < 0 ? "left" : "right");
  next.position[0] = sideContactX(side, bodyBounds, halfWidth);
  const minY = next.position[1] - next.halfExtents[1];
  const maxY = next.position[1] + next.halfExtents[1];
  if (maxY < bodyBounds.min.y) next.position[1] += bodyBounds.min.y - maxY;
  if (minY > bodyBounds.max.y) next.position[1] -= minY - bodyBounds.max.y;
  return next;
}

function automaticDriveContactsForWheelObjects(group, bodyBounds = null) {
  const wheels = viewerWheelObjects(group);
  const parts = [];
  wheels.forEach(({ object, side }) => {
    const bounds = visualLocalBoundsForObject(group, object);
    if (!bounds) return;
    const size = bounds.getSize(new THREE.Vector3());
    if (size.x < 0.03 || size.y < 0.08 || size.z < 0.08) return;
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = Math.max(size.y, size.z) * 0.48;
    const width = THREE.MathUtils.clamp(size.x * 0.5, 0.035, 0.26);
    const part = {
      side: side || (center.x < 0 ? "left" : "right"),
      type: "cylinder",
      part: "driveContact",
      position: [center.x, bounds.min.y + radius, center.z],
      halfExtents: [width, radius, radius],
      rotation: [0, 0, Math.PI / 2],
      density: 1.7,
      friction: 0.92,
      restitution: 0,
    };
    parts.push(clampDriveContactToBody(part, bodyBounds));
  });
  return parts;
}

function automaticDriveContactsForVisualBounds(id, visualBounds, group = null, bodyBounds = null) {
  const wheelParts = group ? automaticDriveContactsForWheelObjects(group, bodyBounds) : [];
  if (wheelParts.length) return wheelParts;
  if (!visualBounds) return [];
  const size = visualBounds.getSize(new THREE.Vector3());
  const center = visualBounds.getCenter(new THREE.Vector3());
  const wheelWidth = THREE.MathUtils.clamp(size.x * 0.065, 0.06, 0.18);
  const wheelRadius = THREE.MathUtils.clamp(Math.min(size.y * 0.34, size.z * 0.14), 0.08, 0.42);
  const anchorBounds = bodyBounds || visualBounds;
  const sideY = visualBounds.min.y + Math.min(size.y * 0.42, wheelRadius);
  const wheelZ = Math.max(0.18, size.z * 0.24);
  const cylinder = (side, z) => ({
    side,
    type: "cylinder",
    part: "driveContact",
    position: [sideContactX(side, anchorBounds, wheelWidth), sideY, center.z + z],
    halfExtents: [wheelWidth, wheelRadius, wheelRadius],
    rotation: [0, 0, Math.PI / 2],
    density: 1.7,
    friction: 0.92,
    restitution: 0,
  });
  const sideBox = (side, zCenter = center.z, zHalf = size.z * 0.28) => {
    const yHalf = Math.max(0.08, size.y * 0.24);
    return {
      side,
      type: "box",
      part: "driveContact",
      position: [sideContactX(side, anchorBounds, wheelWidth * 1.1), visualBounds.min.y + yHalf, zCenter],
      halfExtents: [wheelWidth * 1.1, yHalf, Math.max(0.08, zHalf)],
      density: 1.7,
      friction: 0.92,
      restitution: 0,
    };
  };

  if (id === "huge") {
    const hugeRadius = Math.max(0.16, Math.min(size.y, size.z) * 0.42);
    return ["left", "right"].map((side) => ({
      side,
      type: "cylinder",
      part: "driveContact",
      position: [sideContactX(side, anchorBounds, Math.max(wheelWidth, size.x * 0.055)), visualBounds.min.y + hugeRadius, center.z],
      halfExtents: [Math.max(wheelWidth, size.x * 0.055), hugeRadius, hugeRadius],
      rotation: [0, 0, Math.PI / 2],
      density: 1.7,
      friction: 0.92,
      restitution: 0,
    }));
  }
  if (id === "biteforce" || id === "minotaur") {
    return [sideBox("left", center.z, size.z * 0.28), sideBox("right", center.z, size.z * 0.28)];
  }
  if (id === "sawblaze" || id === "tombstone") {
    const rearZ = center.z + size.z * 0.24;
    return [sideBox("left", rearZ, size.z * 0.12), sideBox("right", rearZ, size.z * 0.12)];
  }
  return [cylinder("left", -wheelZ), cylinder("left", wheelZ), cylinder("right", -wheelZ), cylinder("right", wheelZ)];
}

function visualLocalBoundsForObject(group, object) {
  group.updateMatrixWorld(true);
  const inverseRoot = group.matrixWorld.clone().invert();
  const bounds = new THREE.Box3();
  const meshBox = new THREE.Box3();
  object.traverse((child) => {
    if (!isGroundingVisualMesh(child)) return;
    meshBox.setFromObject(child);
    if (Number.isFinite(meshBox.min.x)) bounds.union(meshBox);
  });
  if (!Number.isFinite(bounds.min.x)) return null;
  const corners = [];
  for (const x of [bounds.min.x, bounds.max.x]) {
    for (const y of [bounds.min.y, bounds.max.y]) {
      for (const z of [bounds.min.z, bounds.max.z]) {
        corners.push(new THREE.Vector3(x, y, z).applyMatrix4(inverseRoot));
      }
    }
  }
  return new THREE.Box3().setFromPoints(corners);
}

function visualLocalVertexPoints(group, object) {
  group.updateMatrixWorld(true);
  const inverseRoot = group.matrixWorld.clone().invert();
  const points = [];
  const scratch = new THREE.Vector3();
  object.traverse((child) => {
    if (!isGroundingVisualMesh(child) || !child.geometry?.attributes?.position) return;
    const position = child.geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      scratch.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld).applyMatrix4(inverseRoot);
      points.push(scratch.clone());
    }
  });
  return points;
}

function visualLocalVertexPointsForObjects(group, objects) {
  const points = [];
  objects.filter(Boolean).forEach((object) => {
    visualLocalVertexPoints(group, object).forEach((point) => points.push(point));
  });
  return points;
}

function pointInsideColliderPart(point, part, padding = 1) {
  const local = point.clone().sub(new THREE.Vector3(...(part.position || [0, 0, 0])));
  const rotation = new THREE.Euler(...(part.rotation || [0, 0, 0]));
  local.applyQuaternion(new THREE.Quaternion().setFromEuler(rotation).invert());
  const halfExtents = part.halfExtents || [0.24, 0.24, 0.24];
  return (
    Math.abs(local.x) <= halfExtents[0] * padding &&
    Math.abs(local.y) <= halfExtents[1] * padding &&
    Math.abs(local.z) <= halfExtents[2] * padding
  );
}

function visualBodyBoundsExcludingDriveContacts(group, object, id, visualBounds = null) {
  const points = visualLocalVertexPoints(group, object);
  if (points.length < 24) return visualLocalBoundsForObject(group, object);
  const driveContacts = automaticDriveContactsForVisualBounds(id, visualBounds || visualLocalBoundsForObject(group, object), group, visualLocalBoundsForObject(group, object));
  const bodyPoints = driveContacts.length
    ? points.filter((point) => !driveContacts.some((part) => pointInsideColliderPart(point, part, 1.25)))
    : points;
  const usablePoints = bodyPoints.length >= Math.max(24, points.length * 0.2) ? bodyPoints : points;
  return new THREE.Box3().setFromPoints(usablePoints);
}

function collisionBodyBoundsIncludingWheelRegions(group, id, visualBounds, bodyBounds) {
  if (!visualBounds) return bodyBounds;
  const bounds = (bodyBounds || visualBounds).clone();
  const visualSize = visualBounds.getSize(new THREE.Vector3());
  const raisedBellyMinY = visualBounds.min.y + visualSize.y * 0.055;
  const wheelBounds = viewerWheelObjects(group)
    .map(({ object }) => visualLocalBoundsForObject(group, object))
    .filter((box) => box && Number.isFinite(box.min.x));
  if (!wheelBounds.length) {
    bounds.min.x = Math.min(bounds.min.x, visualBounds.min.x);
    bounds.max.x = Math.max(bounds.max.x, visualBounds.max.x);
    bounds.min.z = Math.min(bounds.min.z, visualBounds.min.z);
    bounds.max.z = Math.max(bounds.max.z, visualBounds.max.z);
    bounds.max.y = Math.max(bounds.max.y, visualBounds.max.y);
    bounds.min.y = Math.max(bounds.min.y, raisedBellyMinY);
    return bounds;
  }
  wheelBounds.forEach((box) => {
    bounds.min.x = Math.min(bounds.min.x, box.min.x);
    bounds.max.x = Math.max(bounds.max.x, box.max.x);
    bounds.min.z = Math.min(bounds.min.z, box.min.z);
    bounds.max.z = Math.max(bounds.max.z, box.max.z);
    bounds.max.y = Math.max(bounds.max.y, box.max.y);
  });
  bounds.min.y = Math.max(bounds.min.y, raisedBellyMinY);
  return bounds;
}

function visibleColliderSourceObjects(group) {
  const viewerParts = group.userData?.viewerParts;
  const objects = [
    viewerParts?.body,
    viewerParts?.weapon,
    ...(viewerParts?.wheels || []),
  ].filter(Boolean);
  if (objects.length) return objects;
  group.traverse((child) => {
    if (!child.isMesh || !child.visible) return;
    if (child.name?.toLowerCase().includes("helper")) return;
    if (child.parent?.name?.toLowerCase().includes("helper")) return;
    objects.push(child);
  });
  return objects;
}

function boxToColliderPart(box, density = 2.4) {
  const size = box.getSize(new THREE.Vector3());
  if (size.x < 0.01 || size.y < 0.01 || size.z < 0.01) return null;
  const center = box.getCenter(new THREE.Vector3());
  return {
    halfExtents: [size.x * 0.5, size.y * 0.5, size.z * 0.5],
    position: [center.x, center.y, center.z],
    density,
  };
}

function partAabb(part) {
  const position = part.position || [0, 0, 0];
  const halfExtents = part.halfExtents || [0.4, 0.15, 0.4];
  return {
    min: {
      x: position[0] - halfExtents[0],
      y: position[1] - halfExtents[1],
      z: position[2] - halfExtents[2],
    },
    max: {
      x: position[0] + halfExtents[0],
      y: position[1] + halfExtents[1],
      z: position[2] + halfExtents[2],
    },
  };
}

function aabbOverlap(a, b) {
  return {
    x: Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x),
    y: Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y),
    z: Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z),
  };
}

function colliderGenerationAudit({ id, visualBounds, bodyBounds, collisionBounds, parts }) {
  const physicsParts = parts.filter((part) => part.part !== "driveContact");
  const driveContacts = parts.filter((part) => part.part === "driveContact");
  const disconnectedDriveContacts = driveContacts.filter((drive) => {
    const driveBox = partAabb(drive);
    return !physicsParts.some((part) => {
      const overlap = aabbOverlap(driveBox, partAabb(part));
      return overlap.x > -0.015 && overlap.y > -0.015 && overlap.z > -0.015;
    });
  });
  return {
    id,
    visualBounds: serializeBox3(visualBounds),
    bodyBounds: serializeBox3(bodyBounds),
    collisionBounds: serializeBox3(collisionBounds),
    counts: {
      total: parts.length,
      physics: physicsParts.length,
      driveContact: driveContacts.length,
      disconnectedDriveContact: disconnectedDriveContacts.length,
    },
    disconnectedDriveContacts: disconnectedDriveContacts.map((part) => cloneColliderPart(part)),
    parts: parts.map((part) => cloneColliderPart(part)),
  };
}

function clonePointArray(points) {
  return points?.map((point) => [...point]);
}

function pointsToColliderPart(points, density = 4) {
  if (!points.length) return null;
  const sortedY = points.map((point) => point.y).sort((a, b) => a - b);
  const bottomIndex = Math.min(sortedY.length - 1, Math.floor(sortedY.length * 0.015));
  const topIndex = Math.max(0, Math.ceil(sortedY.length * 0.995) - 1);
  const minY = sortedY[bottomIndex];
  const maxY = sortedY[topIndex];
  const box = new THREE.Box3();
  points.forEach((point) => {
    if (point.y < minY || point.y > maxY) return;
    box.expandByPoint(point);
  });
  return Number.isFinite(box.min.x) ? boxToColliderPart(box, density) : null;
}

function pointsToTightColliderPart(points, { density = 4, minY = -Infinity } = {}) {
  if (!points.length) return null;
  const sortedY = points.map((point) => point.y).sort((a, b) => a - b);
  const bottomIndex = Math.min(sortedY.length - 1, Math.floor(sortedY.length * 0.015));
  const topIndex = Math.max(0, Math.ceil(sortedY.length * 0.995) - 1);
  const bottom = Math.max(sortedY[bottomIndex], minY);
  const top = Math.max(bottom + 0.04, sortedY[topIndex]);
  const box = new THREE.Box3();
  points.forEach((point) => {
    box.expandByPoint(point);
  });
  if (!Number.isFinite(box.min.x)) return null;
  box.min.y = bottom;
  box.max.y = top;
  return boxToColliderPart(box, density);
}

function boundsForPoints(points) {
  const box = new THREE.Box3();
  points.forEach((point) => box.expandByPoint(point));
  return Number.isFinite(box.min.x) ? box : null;
}

function chooseColliderSplitAxis(box) {
  const size = box.getSize(new THREE.Vector3());
  const weighted = [
    { axis: "x", span: size.x },
    { axis: "y", span: size.y * 4 },
    { axis: "z", span: size.z },
  ].sort((a, b) => b.span - a.span);
  return weighted[0].axis;
}

function splitPointCluster(points, maxClusters) {
  const rootBounds = boundsForPoints(points);
  if (!rootBounds) return [];
  const clusters = [{ points, bounds: rootBounds }];
  while (clusters.length < maxClusters) {
    let splitIndex = -1;
    let splitScore = 0;
    clusters.forEach((cluster, index) => {
      if (cluster.points.length < 42) return;
      const size = cluster.bounds.getSize(new THREE.Vector3());
      const score = Math.max(size.x, size.z, size.y * 4) * Math.cbrt(cluster.points.length);
      if (score > splitScore) {
        splitScore = score;
        splitIndex = index;
      }
    });
    if (splitIndex < 0) break;
    const cluster = clusters.splice(splitIndex, 1)[0];
    const axis = chooseColliderSplitAxis(cluster.bounds);
    const sorted = [...cluster.points].sort((a, b) => a[axis] - b[axis]);
    const middle = Math.floor(sorted.length / 2);
    const left = sorted.slice(0, middle);
    const right = sorted.slice(middle);
    if (left.length < 16 || right.length < 16) {
      clusters.push(cluster);
      break;
    }
    clusters.push(
      { points: left, bounds: boundsForPoints(left) },
      { points: right, bounds: boundsForPoints(right) },
    );
  }
  return clusters.filter((cluster) => cluster.bounds);
}

function tightBodyColliderPartsFromVisual(group, id, visualBounds, bodyObject) {
  if (!visualBounds) return [];
  const wheelObjects = viewerWheelObjects(group).map(({ object }) => object);
  const points = visualLocalVertexPointsForObjects(group, [bodyObject, ...wheelObjects]);
  if (points.length < 24) return [];
  const visualSize = visualBounds.getSize(new THREE.Vector3());
  const raisedBellyMinY = visualBounds.min.y + visualSize.y * 0.055;
  const bounds = boundsForPoints(points);
  if (!bounds) return [];
  const horizontalSpan = Math.max(bounds.max.x - bounds.min.x, bounds.max.z - bounds.min.z);
  const clusterCount = THREE.MathUtils.clamp(Math.ceil(horizontalSpan / 0.58) + 1, 5, 8);
  const parts = splitPointCluster(points, clusterCount)
    .map((cluster) => pointsToTightColliderPart(cluster.points, { density: 4, minY: raisedBellyMinY }))
    .filter(Boolean)
    .map((part) => {
      part.type = "box";
      part.part = "body";
      return part;
    });
  const config = MODEL_PART_CONFIG[id] || {};
  if (parts.length >= 2 && id !== "tombstone" && config.weapon?.type !== "flipper") {
    const front = parts.reduce((lowest, part) => (part.position[2] < lowest.position[2] ? part : lowest), parts[0]);
    front.type = "wedge";
    front.friction = 0.58;
  }
  return parts;
}

function hugeBodyColliderPartsFromVisual(group, visualBounds, bodyObject) {
  if (!visualBounds) return [];
  const parts = [];
  const colliderConfig = MODEL_PART_CONFIG.huge?.collider || {};
  const visualSize = visualBounds.getSize(new THREE.Vector3());
  const raisedBellyMinY = visualBounds.min.y + visualSize.y * 0.035;
  const bodyPoints = visualLocalVertexPoints(group, bodyObject);
  const bodyBox = pointsToPercentileBox(bodyPoints, { x: 0.04, y: 0.025, z: 0.04 }) || visualLocalBoundsForObject(group, bodyObject);
  if (bodyBox) {
    bodyBox.min.y = Math.max(bodyBox.min.y, raisedBellyMinY);
    const bodyPart = boxToColliderPart(bodyBox, 4.2);
    if (bodyPart) {
      bodyPart.type = "box";
      bodyPart.part = "body";
      bodyPart.friction = 0.62;
      parts.push(bodyPart);
    }
  }
  viewerWheelObjects(group).forEach(({ object, side }) => {
    const wheelBounds = visualLocalBoundsForObject(group, object);
    if (!wheelBounds) return;
    const size = wheelBounds.getSize(new THREE.Vector3());
    const center = wheelBounds.getCenter(new THREE.Vector3());
    const radius = Math.max(size.y, size.z) * 0.49;
    const width = THREE.MathUtils.clamp(size.x * 0.5, 0.06, visualSize.x * 0.12);
    const wheelPart = {
      side: side || (center.x < 0 ? "left" : "right"),
      type: "cylinder",
      part: "body",
      position: [center.x, wheelBounds.min.y + radius, center.z],
      halfExtents: [width * (colliderConfig.body?.wheelBodyWidthScale ?? 0.2), radius, radius],
      rotation: [0, 0, Math.PI / 2],
      density: 3.8,
      friction: 0.72,
      restitution: 0,
    };
    parts.push(wheelPart);
  });
  return parts.filter((part) => part.halfExtents?.every((value) => Number.isFinite(value) && value > 0));
}

function trimmedBodyBoxColliderFromVisual(group, visualBounds, bodyObject, {
  density = 4,
  xTrim = 0.035,
  yTrim = 0.12,
  zTrim = 0.035,
  minGroundClearance = 0.045,
  topClearance = 0.045,
} = {}) {
  if (!visualBounds || !bodyObject) return null;
  const points = visualLocalVertexPoints(group, bodyObject);
  const box = pointsToPercentileBox(points, { x: xTrim, y: yTrim, z: zTrim }) || visualLocalBoundsForObject(group, bodyObject);
  if (!box) return null;
  const visualSize = visualBounds.getSize(new THREE.Vector3());
  box.min.y = Math.max(box.min.y, visualBounds.min.y + minGroundClearance, visualBounds.min.y + visualSize.y * 0.055);
  box.max.y = Math.min(box.max.y, visualBounds.max.y - topClearance);
  if (box.max.y <= box.min.y + 0.05) box.max.y = box.min.y + 0.05;
  const part = boxToColliderPart(box, density);
  if (!part) return null;
  part.type = "box";
  part.part = "body";
  return part;
}

function frontWedgePartsFromBodyBox(bodyPart, {
  count = 1,
  widthScale = 0.42,
  yScale = 0.42,
  zScale = 0.24,
  xOffsetScale = 0.24,
  frontReachScale = 0,
  friction = 0.58,
} = {}) {
  if (!bodyPart) return [];
  const [cx, cy, cz] = bodyPart.position;
  const [hx, hy, hz] = bodyPart.halfExtents;
  const frontZ = cz - hz;
  const wedgeHalfY = Math.max(0.035, hy * yScale);
  const wedgeHalfZ = Math.max(0.055, hz * zScale);
  const make = (x) => ({
    type: "wedge",
    part: "wedge",
    position: [x, cy - hy + wedgeHalfY, frontZ + wedgeHalfZ * (1 - frontReachScale)],
    halfExtents: [Math.max(0.055, hx * widthScale), wedgeHalfY, wedgeHalfZ],
    density: bodyPart.density ?? 4,
    friction,
  });
  if (count === 2) return [make(cx - hx * xOffsetScale), make(cx + hx * xOffsetScale)];
  return [make(cx)];
}

function minotaurBodyColliderPartsFromVisual(group, visualBounds, bodyObject) {
  const colliderConfig = MODEL_PART_CONFIG.minotaur?.collider || {};
  const body = trimmedBodyBoxColliderFromVisual(group, visualBounds, bodyObject, {
    density: 4.4,
    xTrim: 0.05,
    yTrim: 0.18,
    zTrim: 0.055,
    minGroundClearance: 0.055,
    topClearance: 0.055,
    ...(colliderConfig.body?.trim || {}),
  });
  return [
    body,
    ...frontWedgePartsFromBodyBox(body, colliderConfig.body?.wedge || { count: 2, widthScale: 0.16, yScale: 0.34, zScale: 0.16, xOffsetScale: 0.49, frontReachScale: 1 }),
  ].filter(Boolean);
}

function hypershockBodyColliderPartsFromVisual(group, visualBounds, bodyObject) {
  const colliderConfig = MODEL_PART_CONFIG.hypershock?.collider || {};
  const bodyConfig = colliderConfig.body || {};
  const body = trimmedBodyBoxColliderFromVisual(group, visualBounds, bodyObject, {
    density: 4,
    xTrim: 0.055,
    yTrim: 0.16,
    zTrim: 0.06,
    minGroundClearance: 0.06,
    topClearance: 0.04,
    ...(bodyConfig.trim || {}),
  });
  if (body) {
    const bodyLength = body.halfExtents[2] * 2;
    body.position[2] -= bodyLength * (bodyConfig.initialBodyForwardShiftScale ?? 0.5);
  }
  const bodyLength = body ? body.halfExtents[2] * 2 : 0;
  const bodyFrontZ = body ? body.position[2] - body.halfExtents[2] : 0;
  const wedgeConfig = bodyConfig.wedge || {};
  const wedgeHalfZ = Math.max(0.055, bodyLength * ((wedgeConfig.lengthScale ?? 0.3) * 0.5));
  const wedgeHalfY = body ? Math.max(0.035, body.halfExtents[1] * (wedgeConfig.heightScale ?? 0.42)) : 0;
  const wedge = body
    ? {
        type: "wedge",
        part: "wedge",
        position: [body.position[0], body.position[1] - body.halfExtents[1] + wedgeHalfY, bodyFrontZ - wedgeHalfZ],
        halfExtents: [body.halfExtents[0], wedgeHalfY, wedgeHalfZ],
        density: body.density ?? 4,
        friction: wedgeConfig.friction ?? 0.58,
      }
    : null;
  const config = MODEL_PART_CONFIG.hypershock || {};
  const pivot = localPositionOfObjectOrigin(group, group.userData?.weapon?.object)
    || weaponPivotPointFromConfig(visualBounds, config);
  if (bodyConfig.alignFrontFaceToWeaponPivot && body && wedge && pivot) {
    const bodyFrontZ = body.position[2] - body.halfExtents[2];
    const shiftBackZ = pivot.z - bodyFrontZ;
    body.position[2] += shiftBackZ;
    wedge.position[2] += shiftBackZ;
  }
  return [
    body,
    wedge,
  ].filter(Boolean);
}

function tombstoneBodyColliderPartsFromVisual(group, visualBounds, bodyObject) {
  const colliderConfig = MODEL_PART_CONFIG.tombstone?.collider || {};
  const bodyConfig = colliderConfig.body || {};
  const body = trimmedBodyBoxColliderFromVisual(group, visualBounds, bodyObject, {
    density: 4.2,
    xTrim: 0.055,
    yTrim: 0.14,
    zTrim: 0.055,
    minGroundClearance: 0.055,
    topClearance: 0.045,
    ...(bodyConfig.trim || {}),
  });
  if (!body) return [];
  const [cx, cy, cz] = body.position;
  const [hx, hy, hz] = body.halfExtents;
  const frontZ = cz - hz;
  const rearZ = cz + hz;
  const splitZ = frontZ + hz * (bodyConfig.splitScale ?? 0.72);
  const rearConfig = bodyConfig.rearBox || {};
  const rearBox = {
    type: "box",
    part: "body",
    position: [cx, cy, (splitZ + rearZ) * 0.5],
    halfExtents: [hx * (rearConfig.widthScale ?? 0.9), hy, (rearZ - splitZ) * 0.5],
    density: body.density ?? 4.2,
  };
  const wedgeConfig = bodyConfig.frontWedge || {};
  const frontHalfZ = Math.max(0.055, (splitZ - frontZ) * 0.5);
  const frontWedge = {
    type: "wedge",
    part: "wedge",
    position: [cx, cy + hy * (wedgeConfig.yOffsetScale ?? -0.06), frontZ + frontHalfZ],
    halfExtents: [hx * (wedgeConfig.widthScale ?? 0.82), hy * (wedgeConfig.heightScale ?? 0.94), frontHalfZ],
    density: body.density ?? 4.2,
    friction: wedgeConfig.friction ?? 0.58,
  };
  const shoulderConfig = bodyConfig.frontShoulder || {};
  const frontShoulder = {
    type: "box",
    part: "body",
    position: [cx, cy + hy * (shoulderConfig.yOffsetScale ?? 0.16), frontZ + frontHalfZ * (shoulderConfig.zOffsetScale ?? 1.25)],
    halfExtents: [hx * (shoulderConfig.widthScale ?? 0.74), hy * (shoulderConfig.heightScale ?? 0.58), frontHalfZ * (shoulderConfig.zScale ?? 0.55)],
    density: body.density ?? 4.2,
  };
  return [rearBox, frontWedge, frontShoulder].filter((part) => part.halfExtents?.every((value) => Number.isFinite(value) && value > 0));
}

function colliderBoxSize(box) {
  return box.getSize
    ? box.getSize(new THREE.Vector3())
    : new THREE.Vector3(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
}

function colliderBoxCenter(box) {
  return box.getCenter
    ? box.getCenter(new THREE.Vector3())
    : new THREE.Vector3(
        box.min.x + (box.max.x - box.min.x) * 0.5,
        box.min.y + (box.max.y - box.min.y) * 0.5,
        box.min.z + (box.max.z - box.min.z) * 0.5,
      );
}

function pointsToPercentileBox(points, trims = {}) {
  if (!points.length) return null;
  const percentile = (values, fraction) => {
    const sorted = [...values].sort((a, b) => a - b);
    const index = THREE.MathUtils.clamp(Math.round((sorted.length - 1) * fraction), 0, sorted.length - 1);
    return sorted[index];
  };
  const xTrim = trims.x ?? 0.02;
  const yTrim = trims.y ?? 0.015;
  const zTrim = trims.z ?? 0.02;
  return new THREE.Box3(
    new THREE.Vector3(
      percentile(points.map((point) => point.x), xTrim),
      percentile(points.map((point) => point.y), yTrim),
      percentile(points.map((point) => point.z), zTrim),
    ),
    new THREE.Vector3(
      percentile(points.map((point) => point.x), 1 - xTrim),
      percentile(points.map((point) => point.y), 1 - yTrim),
      percentile(points.map((point) => point.z), 1 - zTrim),
    ),
  );
}

function localPositionOfObjectOrigin(group, object) {
  if (!group || !object) return null;
  group.updateMatrixWorld(true);
  object.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(object.matrixWorld).applyMatrix4(group.matrixWorld.clone().invert());
}

function weaponPivotPointFromConfig(bounds, config) {
  const pivot = config.weapon?.pivot;
  if (!bounds || !pivot) return null;
  const size = bounds.getSize(new THREE.Vector3());
  return new THREE.Vector3(
    bounds.min.x + size.x * pivot.x,
    bounds.min.y + size.y * pivot.y,
    bounds.min.z + size.z * pivot.z,
  );
}

function orientedWeaponBoxColliderFromPoints(points, config) {
  if (!points?.length) return null;
  let meanY = 0;
  let meanZ = 0;
  points.forEach((point) => {
    meanY += point.y;
    meanZ += point.z;
  });
  meanY /= points.length;
  meanZ /= points.length;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  points.forEach((point) => {
    const y = point.y - meanY;
    const z = point.z - meanZ;
    yy += y * y;
    yz += y * z;
    zz += z * z;
  });
  yy /= points.length;
  yz /= points.length;
  zz /= points.length;
  const angle = 0.5 * Math.atan2(2 * yz, yy - zz);
  const axisY = Math.cos(angle);
  const axisZ = Math.sin(angle);
  let minX = Infinity;
  let maxX = -Infinity;
  let minLong = Infinity;
  let maxLong = -Infinity;
  let minThin = Infinity;
  let maxThin = -Infinity;
  points.forEach((point) => {
    const y = point.y - meanY;
    const z = point.z - meanZ;
    const along = y * axisY + z * axisZ;
    const across = -y * axisZ + z * axisY;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minLong = Math.min(minLong, along);
    maxLong = Math.max(maxLong, along);
    minThin = Math.min(minThin, across);
    maxThin = Math.max(maxThin, across);
  });
  if (![minX, maxX, minLong, maxLong, minThin, maxThin].every(Number.isFinite)) return null;
  const centerLong = (minLong + maxLong) * 0.5;
  const centerThin = (minThin + maxThin) * 0.5;
  const thinScale = THREE.MathUtils.clamp(config.weapon?.colliderThinScale ?? 1, 0.1, 1);
  return {
    type: "box",
    part: "weapon",
    position: [
      (minX + maxX) * 0.5,
      meanY + centerLong * axisY - centerThin * axisZ,
      meanZ + centerLong * axisZ + centerThin * axisY,
    ],
    halfExtents: [
      Math.max(0.01, (maxX - minX) * 0.5),
      Math.max(0.02, (maxLong - minLong) * 0.5),
      Math.max(0.015, (maxThin - minThin) * 0.5 * thinScale),
    ],
    rotation: [angle, 0, 0],
    density: 3.2,
  };
}

function weaponColliderFromSplitGeometry(group, config, visualBounds, id) {
  const weaponObject = group.userData?.viewerParts?.weapon || group.userData?.weapon?.object;
  if (!weaponObject) return null;
  const points = visualLocalVertexPoints(group, weaponObject);
  if (config.weapon?.orientedBoxCollider) {
    const orientedWeapon = orientedWeaponBoxColliderFromPoints(points, config);
    if (orientedWeapon) return orientedWeapon;
  }
  const trim = id === "bronco" ? { x: 0.08, y: 0.02, z: 0.03 } : { x: 0.025, y: 0.015, z: 0.025 };
  const weaponBounds = pointsToPercentileBox(points, trim) || visualLocalBoundsForObject(group, weaponObject);
  const weapon = weaponBounds ? boxToColliderPart(weaponBounds, 3.2) : null;
  if (!weapon) return null;
  weapon.part = "weapon";
  const shape = config.weapon?.colliderShape || ((config.weapon?.type === "bar" || config.weapon?.type === "drum") ? "cylinder" : "box");
  weapon.type = shape === "split" ? "box" : shape;
  const pivot = localPositionOfObjectOrigin(group, group.userData?.weapon?.object) || weaponPivotPointFromConfig(visualBounds, config);
  if (config.weapon?.centerColliderOnPivot && pivot) {
    weapon.position = [pivot.x, pivot.y, pivot.z];
  }
  if (weapon.type === "cylinder") {
    if (pivot) weapon.position = [pivot.x, pivot.y, pivot.z];
    weapon.rotation = [0, 0, Math.PI / 2];
  }
  const visualSize = visualBounds?.getSize?.(new THREE.Vector3());
  if (visualSize && config.weapon?.type === "flipper") {
    weapon.halfExtents[1] = Math.min(weapon.halfExtents[1], Math.max(0.035, visualSize.y * 0.12));
  }
  return weapon;
}

function quantumWeaponColliderFromSplitGeometry(group, config, visualBounds) {
  const weaponObject = group.userData?.viewerParts?.weapon || group.userData?.weapon?.object;
  if (!weaponObject) return null;
  const points = visualLocalVertexPoints(group, weaponObject);
  const colliderConfig = config.collider?.weapon || {};
  const weaponBounds = pointsToPercentileBox(points, colliderConfig.trim || { x: 0.04, y: 0.03, z: 0.04 })
    || visualLocalBoundsForObject(group, weaponObject);
  const weapon = weaponBounds ? boxToColliderPart(weaponBounds, 3.2) : null;
  if (!weapon) return null;
  weapon.part = "weapon";
  weapon.type = "wedge";
  weapon.rotation = colliderConfig.rotation || [Math.PI / 4, 0, 0];
  const pivot = localPositionOfObjectOrigin(group, group.userData?.weapon?.object)
    || weaponPivotPointFromConfig(visualBounds, config);
  if (pivot) {
    const [, cy, cz] = weapon.position;
    weapon.position = [pivot.x, cy, cz];
  }
  return weapon;
}

function broncoFlipperCollidersFromSplitGeometry(group, config, visualBounds) {
  const weaponObject = group.userData?.viewerParts?.weapon || group.userData?.weapon?.object;
  if (!weaponObject) return [];
  const points = visualLocalVertexPoints(group, weaponObject);
  if (points.length < 24) return [weaponColliderFromSplitGeometry(group, config, visualBounds, "bronco")].filter(Boolean);
  const bounds = pointsToPercentileBox(points, { x: 0.14, y: 0.02, z: 0.03 });
  if (!bounds) return [];
  const size = bounds.getSize(new THREE.Vector3());
  const topCutY = bounds.min.y + size.y * 0.82;
  const highPoints = points.filter((point) => point.y >= topCutY);
  const peakZ = highPoints.length
    ? highPoints.reduce((sum, point) => sum + point.z, 0) / highPoints.length
    : bounds.min.z + size.z * 0.48;
  const frontCutZ = THREE.MathUtils.clamp(peakZ, bounds.min.z + size.z * 0.22, bounds.max.z - size.z * 0.18);
  const frontPoints = points.filter((point) => point.z <= frontCutZ);
  const rearPoints = points.filter((point) => point.z > frontCutZ);
  const parts = [];
  const frontBox = pointsToPercentileBox(frontPoints, { x: 0.16, y: 0.02, z: 0.02 });
  const rearBox = pointsToPercentileBox(rearPoints, { x: 0.12, y: 0.02, z: 0.03 });
  const visualSize = visualBounds?.getSize?.(new THREE.Vector3());
  const maxHeight = visualSize ? Math.max(0.035, visualSize.y * 0.12) : Infinity;
  const makeWeaponPart = (box, type, density = 3.2) => {
    const part = box ? boxToColliderPart(box, density) : null;
    if (!part) return null;
    part.part = "weapon";
    part.type = type;
    part.halfExtents[1] = Math.min(part.halfExtents[1], maxHeight);
    return part;
  };
  const front = makeWeaponPart(frontBox, "convex", 3.4);
  if (front) {
    const frontMin = frontBox.min;
    const frontMax = frontBox.max;
    const frontCenter = new THREE.Vector3(...front.position);
    const frontY = frontMin.y;
    const highY = frontMax.y;
    const frontZ = frontMin.z;
    const ridgeZ = THREE.MathUtils.clamp(peakZ, frontMin.z + (frontMax.z - frontMin.z) * 0.25, frontMax.z);
    const backZ = frontMax.z;
    const xs = [frontMin.x, frontMax.x];
    front.vertices = xs.flatMap((x) => [
      [x - frontCenter.x, frontY - frontCenter.y, frontZ - frontCenter.z],
      [x - frontCenter.x, frontY - frontCenter.y, ridgeZ - frontCenter.z],
      [x - frontCenter.x, frontY - frontCenter.y, backZ - frontCenter.z],
      [x - frontCenter.x, highY - frontCenter.y, ridgeZ - frontCenter.z],
    ]);
  }
  const rear = makeWeaponPart(rearBox, "box", 3.0);
  if (front) parts.push(front);
  if (rear) parts.push(rear);
  return parts.length ? parts : [weaponColliderFromSplitGeometry(group, config, visualBounds, "bronco")].filter(Boolean);
}

function flushBroncoLowerBodyFront(parts) {
  const bodyBoxes = parts.filter((part) => part.part === "body" && part.type === "box");
  if (bodyBoxes.length < 2) return;
  const sortedByHeight = [...bodyBoxes].sort((a, b) => a.position[1] - b.position[1]);
  const lower = sortedByHeight[0];
  const upper = sortedByHeight[sortedByHeight.length - 1];
  const lowerMinZ = lower.position[2] - lower.halfExtents[2];
  const lowerMaxZ = lower.position[2] + lower.halfExtents[2];
  const upperMinZ = upper.position[2] - upper.halfExtents[2];
  if (lowerMinZ >= upperMinZ || upperMinZ >= lowerMaxZ - 0.04) return;
  lower.position[2] = (upperMinZ + lowerMaxZ) * 0.5;
  lower.halfExtents[2] = (lowerMaxZ - upperMinZ) * 0.5;
}

function applyBiteForceColliderNudges(parts, bodyBounds) {
  const colliderConfig = MODEL_PART_CONFIG.biteforce?.collider?.nudges || {};
  const bodyBoxes = parts.filter((part) => part.part === "body" && part.type === "box");
  if (bodyBoxes.length >= 2) {
    const sortedByHeight = [...bodyBoxes].sort((a, b) => a.position[1] - b.position[1]);
    const lower = sortedByHeight[0];
    const upper = sortedByHeight[sortedByHeight.length - 1];
    const upperMinZ = upper.position[2] - upper.halfExtents[2];
    const upperMaxZ = upper.position[2] + upper.halfExtents[2];
    const upperLength = upperMaxZ - upperMinZ;
    const trim = colliderConfig.upperBodyTrim || {};
    const trimmedUpperMinZ = upperMinZ + upperLength * (trim.front ?? 0.25);
    const trimmedUpperMaxZ = upperMaxZ - upperLength * (trim.back ?? 0.5);
    if (trimmedUpperMaxZ > trimmedUpperMinZ + 0.04) {
      upper.position[2] = (trimmedUpperMinZ + trimmedUpperMaxZ) * 0.5;
      upper.halfExtents[2] = (trimmedUpperMaxZ - trimmedUpperMinZ) * 0.5;
    }
    const upperMinX = upper.position[0] - upper.halfExtents[0];
    const upperMaxX = upper.position[0] + upper.halfExtents[0];
    const lowerMaxZ = lower.position[2] + lower.halfExtents[2];
    const adjustedUpperMinZ = upper.position[2] - upper.halfExtents[2];
    if (adjustedUpperMinZ < lowerMaxZ - 0.04) {
      lower.position[2] = (adjustedUpperMinZ + lowerMaxZ) * 0.5;
      lower.halfExtents[2] = (lowerMaxZ - adjustedUpperMinZ) * 0.5;
    }
    lower.position[0] = (upperMinX + upperMaxX) * 0.5;
    lower.halfExtents[0] = (upperMaxX - upperMinX) * 0.5;
  }
  const referenceBounds = bodyBoxes.length
    ? colliderPartsBounds(bodyBoxes, 1)
    : bodyBounds;
  const centerX = referenceBounds
    ? (referenceBounds.min.x + referenceBounds.max.x) * 0.5
    : 0;
  const fullHalfWidth = referenceBounds
    ? (referenceBounds.max.x - referenceBounds.min.x) * 0.5
    : null;
  parts.forEach((part) => {
    if (part.part === "weapon") {
      part.halfExtents[1] *= colliderConfig.weaponRadiusScale ?? 1.3;
      part.halfExtents[2] *= colliderConfig.weaponRadiusScale ?? 1.3;
    }
    if (colliderConfig.widenBodyWedgesToBody && part.type === "wedge" && part.part !== "weapon" && fullHalfWidth) {
      part.position[0] = centerX;
      part.halfExtents[0] = fullHalfWidth;
    }
    if (part.part === "driveContact") {
      part.position[0] = centerX + (part.position[0] - centerX) * (colliderConfig.driveContactXScale ?? 0.85);
    }
  });
}

function applyBroncoColliderNudges(parts, bounds) {
  if (!bounds) return;
  const colliderConfig = MODEL_PART_CONFIG.bronco?.collider?.nudges || {};
  flushBroncoLowerBodyFront(parts);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const backShift = size.z * (colliderConfig.frontDriveContactBackShiftScale ?? 0.1);
  parts.forEach((part) => {
    if (part.part === "wedge") part.position[2] += size.z * (colliderConfig.wedgeBackShiftScale ?? 0.1);
    if (part.part !== "driveContact") return;
    part.position[0] = center.x + (part.position[0] - center.x) * (colliderConfig.driveContactXScale ?? 0.8);
    if (part.position[2] < center.z) part.position[2] += backShift;
  });
}

function applyHugeColliderNudges(parts, bounds) {
  if (!bounds) return;
  const colliderConfig = MODEL_PART_CONFIG.huge?.collider?.nudges || {};
  const center = bounds.getCenter(new THREE.Vector3());
  parts.forEach((part) => {
    if (part.part !== "driveContact") return;
    part.position[0] = center.x + (part.position[0] - center.x) * (colliderConfig.driveContactXScale ?? 0.88);
  });
}

function applyQuantumColliderNudges(parts, bounds) {
  if (!bounds) return;
  const colliderConfig = MODEL_PART_CONFIG.quantum?.collider?.nudges || {};
  const bodyBoxes = parts.filter((part) => part.part === "body" && part.type === "box");
  const wedges = parts.filter((part) => part.part === "wedge");
  const keepWedge = [...wedges].sort((a, b) => {
    const frontDelta = (a.position[2] - a.halfExtents[2]) - (b.position[2] - b.halfExtents[2]);
    return frontDelta || (a.position[1] - b.position[1]);
  })[0];
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index].part === "wedge" && parts[index] !== keepWedge) parts.splice(index, 1);
  }
  if (bodyBoxes.length >= 2) {
    const sortedByHeight = [...bodyBoxes].sort((a, b) => a.position[1] - b.position[1]);
    const bottomBody = sortedByHeight[0];
    const aboveBody = sortedByHeight[1];
    const bottomMaxZ = bottomBody.position[2] + bottomBody.halfExtents[2];
    const aboveFrontZ = aboveBody.position[2] - aboveBody.halfExtents[2];
    if (aboveFrontZ < bottomMaxZ - 0.04) {
      bottomBody.position[2] = (aboveFrontZ + bottomMaxZ) * 0.5;
      bottomBody.halfExtents[2] = (bottomMaxZ - aboveFrontZ) * 0.5;
    }
  }
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const backShift = size.z * (colliderConfig.frontDriveContactBackShiftScale ?? 0.1);
  parts.forEach((part) => {
    if (part.part !== "driveContact") return;
    part.position[0] = center.x + (part.position[0] - center.x) * (colliderConfig.driveContactXScale ?? 0.8);
    if (part.position[2] < center.z) part.position[2] += backShift;
  });
}

function applyMinotaurColliderNudges(parts, bounds) {
  if (!bounds) return;
  const colliderConfig = MODEL_PART_CONFIG.minotaur?.collider?.nudges || {};
  const center = bounds.getCenter(new THREE.Vector3());
  const topY = bounds.max.y;
  const mainBody = parts
    .filter((part) => part.part === "body" && part.type === "box")
    .sort((a, b) => {
      const volumeA = a.halfExtents[0] * a.halfExtents[1] * a.halfExtents[2];
      const volumeB = b.halfExtents[0] * b.halfExtents[1] * b.halfExtents[2];
      return volumeB - volumeA;
    })[0];
  if (mainBody) {
    const frontZ = mainBody.position[2] - mainBody.halfExtents[2];
    const backZ = mainBody.position[2] + mainBody.halfExtents[2];
    const length = backZ - frontZ;
    const extendedBackZ = backZ + length * (colliderConfig.mainBodyBackExtensionScale ?? 0.1);
    mainBody.position[2] = (frontZ + extendedBackZ) * 0.5;
    mainBody.halfExtents[2] = (extendedBackZ - frontZ) * 0.5;
  }
  parts.forEach((part) => {
    if (part.part === "weapon") {
      part.halfExtents[1] *= colliderConfig.weaponRadiusScale ?? 1.1;
      part.halfExtents[2] *= colliderConfig.weaponRadiusScale ?? 1.1;
    }
    if (part.part === "wedge") {
      if (colliderConfig.wedgeForwardByOwnLength) part.position[2] -= part.halfExtents[2] * 2;
      if (colliderConfig.wedgeOutwardByOwnHalfWidth) part.position[0] = center.x + (part.position[0] - center.x) + Math.sign(part.position[0] - center.x) * part.halfExtents[0];
    }
    if (part.part !== "driveContact") return;
    part.position[0] = center.x + (part.position[0] - center.x) * (colliderConfig.driveContactXScale ?? 0.85);
    const minY = part.position[1] - part.halfExtents[1];
    part.position[1] = (minY + topY) * 0.5;
    part.halfExtents[1] = Math.max(0.04, (topY - minY) * 0.5);
  });
}

function applySawBlazeColliderNudges(parts, bounds) {
  if (!bounds) return;
  const colliderConfig = MODEL_PART_CONFIG.sawblaze?.collider?.nudges || {};
  const center = bounds.getCenter(new THREE.Vector3());
  const bodyBoxes = parts
    .filter((part) => part.part === "body" && part.type === "box")
    .sort((a, b) => a.position[1] - b.position[1]);
  const bodyWedges = parts.filter((part) => part.part === "wedge");
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (parts[index].part === "wedge") parts.splice(index, 1);
  }
  if (bodyBoxes.length >= 2) {
    const bottom = bodyBoxes[0];
    const above = bodyBoxes[1];
    const oldBottomFrontZ = bottom.position[2] - bottom.halfExtents[2];
    const oldBottomBottomY = bottom.position[1] - bottom.halfExtents[1];
    const targetFrontZ = above.position[2] - above.halfExtents[2];
    const bottomBackZ = bottom.position[2] + bottom.halfExtents[2];
    if (targetFrontZ < bottomBackZ - 0.04) {
      bottom.position[2] = (targetFrontZ + bottomBackZ) * 0.5;
      bottom.halfExtents[2] = (bottomBackZ - targetFrontZ) * 0.5;
    }
    const newBottomTopY = bottom.position[1] + bottom.halfExtents[1];
    const wedgeMinZ = Math.min(oldBottomFrontZ, targetFrontZ);
    const wedgeMaxZ = targetFrontZ;
    if (wedgeMaxZ > wedgeMinZ + 0.04 && newBottomTopY > oldBottomBottomY + 0.035) {
      parts.push({
        type: "wedge",
        part: "wedge",
        position: [bottom.position[0], (oldBottomBottomY + newBottomTopY) * 0.5, (wedgeMinZ + wedgeMaxZ) * 0.5],
        halfExtents: [bottom.halfExtents[0], (newBottomTopY - oldBottomBottomY) * 0.5, (wedgeMaxZ - wedgeMinZ) * 0.5],
        density: bottom.density ?? 4,
        friction: bodyWedges[0]?.friction ?? 0.58,
      });
    }
  }
  if (bodyBoxes.length >= 3) {
    const top = bodyBoxes[bodyBoxes.length - 1];
    const below = bodyBoxes[bodyBoxes.length - 2];
    const targetFrontZ = below.position[2] - below.halfExtents[2];
    const topBackZ = top.position[2] + top.halfExtents[2];
    if (targetFrontZ < topBackZ - 0.04) {
      top.position[2] = (targetFrontZ + topBackZ) * 0.5;
      top.halfExtents[2] = (topBackZ - targetFrontZ) * 0.5;
    }
  }
  parts.forEach((part) => {
    if (part.part === "weapon") {
      part.halfExtents[1] *= colliderConfig.weaponRadiusScale ?? 1.15;
      part.halfExtents[2] *= colliderConfig.weaponRadiusScale ?? 1.15;
    }
    if (part.part === "driveContact") {
      part.position[0] = center.x + (part.position[0] - center.x) * (colliderConfig.driveContactXScale ?? 0.9);
    }
  });
}

function applyTombstoneColliderNudges(parts, bounds) {
  if (!bounds) return;
  const colliderConfig = MODEL_PART_CONFIG.tombstone?.collider?.nudges || {};
  const center = bounds.getCenter(new THREE.Vector3());
  parts.forEach((part) => {
    if (part.part === "driveContact") {
      part.position[0] = center.x + (part.position[0] - center.x) * (colliderConfig.driveContactXScale ?? 0.9);
    }
    if ((colliderConfig.weaponRotationXFromAxisPitch || colliderConfig.weaponRotationZFromAxisPitch) && part.part === "weapon") {
      const rotation = part.rotation || [0, 0, 0];
      part.rotation = [rotation[0] + (MODEL_PART_CONFIG.tombstone?.weapon?.axisPitch || 0), rotation[1], rotation[2]];
    }
  });
}

function applyHypershockColliderNudges(parts, bounds) {
  if (!bounds) return;
  const colliderConfig = MODEL_PART_CONFIG.hypershock?.collider?.nudges || {};
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const rearwardShift = size.z * (colliderConfig.frontDriveContactBackShiftScale ?? 0.11);
  const mainBody = parts
    .filter((part) => part.part === "body" && part.type === "box")
    .sort((a, b) => {
      const volumeA = a.halfExtents[0] * a.halfExtents[1] * a.halfExtents[2];
      const volumeB = b.halfExtents[0] * b.halfExtents[1] * b.halfExtents[2];
      return volumeB - volumeA;
    })[0];
  if (mainBody) {
    const bottomY = mainBody.position[1] - mainBody.halfExtents[1];
    const height = mainBody.halfExtents[1] * 2;
    const topY = bottomY + height * (colliderConfig.bodyHeightScale ?? 1.2);
    mainBody.position[1] = (bottomY + topY) * 0.5;
    mainBody.halfExtents[1] = (topY - bottomY) * 0.5;
  }
  parts.forEach((part) => {
    if (part.part === "weapon") {
      part.halfExtents[1] *= colliderConfig.weaponRadiusScale ?? 1.25;
      part.halfExtents[2] *= colliderConfig.weaponRadiusScale ?? 1.25;
    }
    if (part.part !== "driveContact") return;
    part.position[0] = center.x + (part.position[0] - center.x) * (colliderConfig.driveContactXScale ?? 0.9);
    if (part.position[2] < center.z) part.position[2] += rearwardShift;
  });
  const frontContacts = parts.filter((part) => part.part === "driveContact" && part.position[2] < center.z);
  if (colliderConfig.upperBodyFromFrontAxle && mainBody && frontContacts.length) {
    const frontmostZ = Math.min(...frontContacts.map((part) => part.position[2]));
    const axleContacts = frontContacts.filter((part) => Math.abs(part.position[2] - frontmostZ) < Math.max(0.04, size.z * 0.04));
    const axleZ = axleContacts.reduce((sum, part) => sum + part.position[2], 0) / axleContacts.length;
    const radius = Math.max(...axleContacts.map((part) => Math.max(part.halfExtents[1] || 0, part.halfExtents[2] || 0)));
    if (Number.isFinite(axleZ) && Number.isFinite(radius) && radius > 0.02) {
      const mainTopY = mainBody.position[1] + mainBody.halfExtents[1];
      parts.push({
        type: "box",
        part: "body",
        position: [mainBody.position[0], mainTopY + radius * 0.5, axleZ + radius * 0.5],
        halfExtents: [mainBody.halfExtents[0], radius * 0.5, radius * 0.5],
        density: mainBody.density ?? 4,
      });
    }
  }
}

function legacyHeuristicColliderPartsFromVisual(group, id, { includeDriveContacts = false } = {}) {
  const visualBounds = visualLocalBoundsForObject(group, group);
  const bodyObject = group.userData?.viewerParts?.body || group;
  const bounds = visualBodyBoundsExcludingDriveContacts(group, bodyObject, id, visualBounds) || visualLocalBoundsForObject(group, bodyObject) || visualBounds;
  if (!bounds) return botColliderParts(id, { includeDriveContacts }).map(cloneColliderPart);
  const config = MODEL_PART_CONFIG[id] || {};
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const minY = bounds.min.y;
  const height = Math.max(0.18, size.y);
  const width = Math.max(0.4, size.x);
  const depth = Math.max(0.4, size.z);
  const bodyBottom = minY + height * 0.09;
  const bodyHeight = height * 0.42;
  const parts = [];

  if (id !== "huge" && id !== "tombstone") {
    parts.push({
      type: "wedge",
      part: config.weapon?.type === "flipper" ? "weapon" : "body",
      position: [center.x, minY + height * 0.115, bounds.min.z + depth * 0.16],
      halfExtents: [width * 0.39, height * 0.115, depth * 0.16],
      density: 4.3,
      friction: 0.58,
    });
  }

  parts.push({
    type: "box",
    part: "body",
    position: [center.x, bodyBottom + bodyHeight * 0.5, center.z + depth * 0.04],
    halfExtents: [width * 0.36, bodyHeight * 0.5, depth * 0.29],
    density: 4,
  });

  if (depth > width * 0.72) {
    parts.push({
      type: "box",
      part: "body",
      position: [center.x, bodyBottom + bodyHeight * 0.56, bounds.max.z - depth * 0.2],
      halfExtents: [width * 0.33, bodyHeight * 0.44, depth * 0.16],
      density: 3.6,
    });
  }

  if (config.weapon?.regions?.[0]) {
    const weaponBox = fractionBoundsToBox(visualBounds || bounds, config.weapon.regions[0]);
    const weapon = boxToColliderPart(weaponBox, 3.2);
    if (weapon) {
      weapon.part = "weapon";
      weapon.type = config.weapon.type === "bar" || config.weapon.type === "drum" ? "cylinder" : "box";
      if (weapon.type === "cylinder") weapon.rotation = [0, 0, Math.PI / 2];
      parts.push(weapon);
    }
  }

  if (includeDriveContacts) {
    automaticDriveContactsForVisualBounds(id, visualBounds || bounds, group).forEach((part) => parts.push(part));
  }

  return parts.filter((part) => part.halfExtents?.every((value) => Number.isFinite(value) && value > 0));
}

function subdivideVisualColliderParts(group, object, density = 4) {
  const points = visualLocalVertexPoints(group, object);
  if (points.length < 24) {
    const box = visualLocalBoundsForObject(group, object);
    const part = box ? boxToColliderPart(box, density) : null;
    return part ? [part] : [];
  }
  const bounds = new THREE.Box3().setFromPoints(points);
  const spanX = bounds.max.x - bounds.min.x;
  const spanZ = bounds.max.z - bounds.min.z;
  const axis = spanZ >= spanX ? "z" : "x";
  const min = axis === "z" ? bounds.min.z : bounds.min.x;
  const max = axis === "z" ? bounds.max.z : bounds.max.x;
  const bands = spanZ >= spanX * 1.25 || spanX >= spanZ * 1.25 ? 3 : 2;
  const parts = [];
  for (let band = 0; band < bands; band += 1) {
    const a = min + ((max - min) * band) / bands;
    const b = min + ((max - min) * (band + 1)) / bands;
    const bandPoints = points.filter((point) => {
      const value = axis === "z" ? point.z : point.x;
      return band === bands - 1 ? value >= a && value <= b : value >= a && value < b;
    });
    const part = pointsToColliderPart(bandPoints, density);
    if (part) parts.push(part);
  }
  return parts.length ? parts : [pointsToColliderPart(points, density)].filter(Boolean);
}

function generateColliderPartsFromVisual(group, id = selected.id, { includeDriveContacts = false } = {}) {
  const visualBounds = visualLocalBoundsForObject(group, group);
  const bodyObject = group.userData?.viewerParts?.body || group;
  const bodyBounds = visualLocalBoundsForObject(group, bodyObject) || visualBounds;
  const bounds = collisionBodyBoundsIncludingWheelRegions(group, id, visualBounds, bodyBounds);
  if (!bounds) return botColliderParts(id, { includeDriveContacts }).map(cloneColliderPart);
  const config = MODEL_PART_CONFIG[id] || {};
  const parts = id === "huge"
    ? hugeBodyColliderPartsFromVisual(group, visualBounds || bounds, bodyObject)
    : id === "minotaur"
      ? minotaurBodyColliderPartsFromVisual(group, visualBounds || bounds, bodyObject)
      : id === "hypershock"
        ? hypershockBodyColliderPartsFromVisual(group, visualBounds || bounds, bodyObject)
        : id === "tombstone"
          ? tombstoneBodyColliderPartsFromVisual(group, visualBounds || bounds, bodyObject)
          : tightBodyColliderPartsFromVisual(group, id, visualBounds || bounds, bodyObject);
  if (!parts.length) {
    const fallbackParts = legacyHeuristicColliderPartsFromVisual(group, id, { includeDriveContacts });
    group.userData.generatedColliderParts = fallbackParts.map(cloneColliderPart);
    group.userData.generatedColliderAudit = colliderGenerationAudit({
      id,
      visualBounds,
      bodyBounds,
      collisionBounds: colliderPartsBounds(fallbackParts.filter((part) => part.part !== "driveContact"), 1),
      parts: fallbackParts,
    });
    return fallbackParts;
  }

  if (config.weapon?.type === "flipper" && !config.weapon?.regions?.[0]) {
    const bodyPhysicsBounds = colliderPartsBounds(parts.filter((part) => part.part === "body"), 1) || bodyBounds || bounds;
    const size = bounds.getSize(new THREE.Vector3());
    const bodySize = colliderBoxSize(bodyPhysicsBounds);
    const bodyCenter = colliderBoxCenter(bodyPhysicsBounds);
    const height = Math.max(0.18, size.y);
    const width = Math.max(0.4, bodySize.x);
    const depth = Math.max(0.4, size.z);
    parts.push({
      type: "wedge",
      part: "wedge",
      position: [bodyCenter.x, bounds.min.y + height * 0.115, bounds.min.z + depth * 0.16],
      halfExtents: [width * 0.39, height * 0.115, depth * 0.16],
      density: 4.3,
      friction: 0.58,
    });
    broncoFlipperCollidersFromSplitGeometry(group, config, visualBounds || bounds).forEach((part) => parts.push(part));
  }

  if (id === "huge") {
    const weapon = weaponColliderFromSplitGeometry(group, config, visualBounds || bounds, id);
    if (weapon) parts.push(weapon);
  }

  if (id === "quantum") {
    const weapon = quantumWeaponColliderFromSplitGeometry(group, config, visualBounds || bounds);
    if (weapon) parts.push(weapon);
  }

  if (config.weapon?.regions?.[0]) {
    const weaponBox = fractionBoundsToBox(visualBounds || bounds, config.weapon.regions[0]);
    const weapon = weaponColliderFromSplitGeometry(group, config, visualBounds || bounds, id) || boxToColliderPart(weaponBox, 3.2);
    if (weapon) {
      weapon.part = "weapon";
      weapon.type = config.weapon.type === "bar" || config.weapon.type === "drum" ? "cylinder" : "box";
      if (weapon.type === "cylinder") {
        const pivot = localPositionOfObjectOrigin(group, group.userData?.weapon?.object) || weaponPivotPointFromConfig(visualBounds || bounds, config);
        if (pivot) weapon.position = [pivot.x, pivot.y, pivot.z];
        weapon.rotation = [0, 0, Math.PI / 2];
      }
      parts.push(weapon);
    }
  }

  if (includeDriveContacts) {
    const physicsBounds = colliderPartsBounds(parts.filter((part) => part.part === "body"), 1) || bounds;
    automaticDriveContactsForVisualBounds(id, visualBounds || bounds, group, physicsBounds).forEach((part) => parts.push(part));
  }
  if (id === "biteforce") applyBiteForceColliderNudges(parts, bodyBounds || bounds);
  if (id === "huge") applyHugeColliderNudges(parts, bounds);
  if (id === "bronco") applyBroncoColliderNudges(parts, bounds);
  if (id === "quantum") applyQuantumColliderNudges(parts, bounds);
  if (id === "minotaur") applyMinotaurColliderNudges(parts, bounds);
  if (id === "sawblaze") applySawBlazeColliderNudges(parts, bounds);
  if (id === "tombstone") applyTombstoneColliderNudges(parts, bounds);
  if (id === "hypershock") applyHypershockColliderNudges(parts, bounds);

  const generatedParts = parts.filter((part) => part.halfExtents?.every((value) => Number.isFinite(value) && value > 0));
  group.userData.generatedColliderParts = generatedParts.map(cloneColliderPart);
  group.userData.generatedColliderAudit = colliderGenerationAudit({
    id,
    visualBounds,
    bodyBounds,
    collisionBounds: bounds,
    parts: generatedParts,
  });
  return generatedParts;
}

function collectVisualColliderParts(group, id = selected.id, options = {}) {
  const includeDriveContacts = Boolean(options.includeDriveContacts);
  const authoredParts = botColliderParts(id, { includeDriveContacts });
  if (authoredParts.length) return authoredParts.map(cloneColliderPart);
  if (!group) return [];
  const cacheKey = `${id}:${includeDriveContacts ? "drive" : "body"}`;
  group.userData.colliderPartsCache ||= new Map();
  const cached = group.userData.colliderPartsCache.get(cacheKey);
  if (cached) return cached.map(cloneColliderPart);
  const generated = generateColliderPartsFromVisual(group, id, options);
  group.userData.colliderPartsCache.set(cacheKey, generated.map(cloneColliderPart));
  return generated.map(cloneColliderPart);
}

function activeColliderPartsForMode(group, id = selected.id) {
  return group
    ? collectVisualColliderParts(group, id, { includeDriveContacts: true })
    : botColliderParts(id, { includeDriveContacts: true }).map(cloneColliderPart);
}

function serializeBox3(box) {
  if (!box || !Number.isFinite(box.min.x)) return null;
  if (typeof box.getSize !== "function") {
    const min = box.min;
    const max = box.max;
    const size = new THREE.Vector3(max.x - min.x, max.y - min.y, max.z - min.z);
    const center = new THREE.Vector3(min.x + size.x * 0.5, min.y + size.y * 0.5, min.z + size.z * 0.5);
    return {
      min: [min.x, min.y, min.z],
      max: [max.x, max.y, max.z],
      center: [center.x, center.y, center.z],
      size: [size.x, size.y, size.z],
    };
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
    center: [center.x, center.y, center.z],
    size: [size.x, size.y, size.z],
  };
}

function viewerColliderAudit() {
  if (!viewerBot) return null;
  const visualBounds = visualLocalBoundsForObject(viewerBot, viewerBot);
  const bodyObject = viewerBot.userData?.viewerParts?.body || viewerBot;
  return {
    id: selected.id,
    physicsVersion: 2,
    visualBounds: serializeBox3(visualBounds),
    bodyBounds: serializeBox3(visualLocalBoundsForObject(viewerBot, bodyObject)),
    wheelBounds: viewerWheelObjects(viewerBot).map(({ object, side }) => ({
      side,
      bounds: serializeBox3(visualLocalBoundsForObject(viewerBot, object)),
    })),
    generatedColliderAudit: viewerBot.userData?.generatedColliderAudit || null,
    parts: activeColliderPartsForMode(viewerBot, selected.id).map((part) => ({
      type: part.type || "box",
      part: part.part || "body",
      side: part.side || null,
      position: [...(part.position || [0, 0, 0])],
      halfExtents: [...(part.halfExtents || [0.4, 0.15, 0.4])],
      rotation: [...(part.rotation || [0, 0, 0])],
    })),
  };
}

function colliderPartsMinY(parts, visualScale = 1) {
  // Drive contacts are traction probes, not support geometry. Resting height is
  // based on real chassis support only. Weapons with ignored local bottom
  // contact should not pull the visual frame below the arena while upright.
  const groundingParts = parts.filter((part) => (
    part.part !== "driveContact" &&
    !part.ignoreGroundContact &&
    !(part.part === "weapon" && part.ignoreLocalBottomFloorContact)
  ));
  const bounds = colliderPartsBounds(groundingParts.length ? groundingParts : parts, visualScale);
  return bounds && Number.isFinite(bounds.min.y) ? bounds.min.y : Infinity;
}

function colliderSamplePoints(part, half) {
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

function colliderPartsBounds(parts, visualScale = 1) {
  const bounds = {
    min: new THREE.Vector3(Infinity, Infinity, Infinity),
    max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
  };
  parts.forEach((part) => {
    const half = (part.halfExtents || [0.4, 0.15, 0.4]).map((value) => value * visualScale);
    const position = new THREE.Vector3(...(part.position || [0, 0, 0])).multiplyScalar(visualScale);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0])));
    colliderSamplePoints(part, half).forEach((point) => {
      const corner = new THREE.Vector3(...point).applyQuaternion(rotation).add(position);
      bounds.min.min(corner);
      bounds.max.max(corner);
    });
  });
  return Number.isFinite(bounds.min.x) ? bounds : null;
}

function botColliderRestingBodyY(id, visualScale = 1, group = null) {
  const parts = activeColliderPartsForMode(group, id);
  const minY = colliderPartsMinY(parts, visualScale);
  return Number.isFinite(minY) ? ARENA_PHYSICS_FLOOR_Y - minY : 0.55;
}

function createBotFrame({ group, id, visualScale = 1, floorY = ARENA_PHYSICS_FLOOR_Y, spawnClearance = 0 } = {}) {
  const parts = activeColliderPartsForMode(group, id);
  const colliderMinY = colliderPartsMinY(parts, visualScale);
  const visualGroundOffset = group ? measureArenaVisualFloorOffset(group) : 0;
  const groundedBodyY = Number.isFinite(colliderMinY) ? floorY + spawnClearance - colliderMinY : 0.55;
  const visualOffsetY = ARENA_VISUAL_FLOOR_Y - groundedBodyY + visualGroundOffset;
  return {
    id,
    parts,
    visualScale,
    floorY,
    spawnClearance,
    colliderMinY,
    visualGroundOffset,
    visualOffsetY,
    groundedBodyY,
    tractionBounds: colliderPartsBounds(parts, visualScale),
  };
}

function fighterFrame(fighter) {
  return fighter?.frame || null;
}

function fighterGroundedBodyY(fighter) {
  return fighterFrame(fighter)?.groundedBodyY ?? fighter?.restingBodyY ?? fighter?.rb?.translation?.().y ?? ARENA_PHYSICS_FLOOR_Y;
}

function fighterFloorY(fighter) {
  return fighterFrame(fighter)?.floorY ?? ARENA_PHYSICS_FLOOR_Y;
}

function fighterVisualOffsetY(fighter) {
  return fighterFrame(fighter)?.visualOffsetY ?? fighter?.visualFloorOffset ?? 0;
}

function bodyPositionToVisualPosition(fighter, position) {
  return new THREE.Vector3(position.x, position.y + fighterVisualOffsetY(fighter), position.z);
}

function visualPositionToBodyPosition(fighter, position) {
  return new THREE.Vector3(position.x, position.y - fighterVisualOffsetY(fighter), position.z);
}

function syncFighterVisualFromBody(fighter) {
  if (!fighter?.rb || !fighter.group) return;
  const p = fighter.rb.translation();
  const r = fighter.rb.rotation();
  fighter.group.position.copy(bodyPositionToVisualPosition(fighter, p));
  fighter.group.quaternion.set(r.x, r.y, r.z, r.w);
}

function setFighterBodyPose(fighter, position, rotation, linvel = null, angvel = null) {
  if (!fighter?.rb) return;
  fighter.rb.setTranslation(position, true);
  if (rotation) fighter.rb.setRotation(rotation, true);
  if (linvel) fighter.rb.setLinvel(linvel, true);
  if (angvel) fighter.rb.setAngvel(angvel, true);
  syncFighterVisualFromBody(fighter);
}

function makeColliderPreview(group, id = selected.id, parts = null) {
  const root = new THREE.Group();
  root.name = "botColliderPreview";
  root.userData.linkedHelpers = [];
  (parts || activeColliderPartsForMode(group, id)).forEach((part, index) => {
    const geometry = colliderPreviewGeometry(part);
    const isWedgeCollider = part.part === "wedge" || part.type === "wedge";
    const color = part.part === "weapon" ? 0xff4fd8 : part.part === "driveContact" ? 0x20e6b6 : isWedgeCollider ? 0xffd24a : 0x45d8ff;
    const opacity = part.part === "weapon" ? 0.34 : part.part === "driveContact" ? 0.28 : isWedgeCollider ? 0.3 : 0.18;
    const fill = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    const edge = new THREE.LineBasicMaterial({
      color: part.part === "weapon" ? 0xffb7ef : part.part === "driveContact" ? 0xb7fff0 : isWedgeCollider ? 0xffd24a : 0xc8f6ff,
      transparent: true,
      opacity: isWedgeCollider || part.part === "driveContact" || part.part === "weapon" ? 1 : 0.78,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, fill);
    const lines = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), edge);
    fill.userData.previewOpacity = opacity;
    edge.userData.previewOpacity = isWedgeCollider || part.part === "driveContact" || part.part === "weapon" ? 1 : 0.78;
    const boxGroup = new THREE.Group();
    boxGroup.userData.colliderIndex = index;
    boxGroup.userData.colliderKind = part.part === "weapon" ? "weapon" : part.part === "driveContact" ? "driveContact" : isWedgeCollider ? "wedge" : "physics";
    mesh.userData.defaultColor = 0x45d8ff;
    mesh.userData.defaultOpacity = 0.2;
    mesh.userData.selectedOpacity = 0.34;
    lines.userData.defaultColor = 0xc8f6ff;
    lines.userData.defaultOpacity = 0.85;
    lines.userData.selectedOpacity = 1;
    setColliderPreviewTransform(boxGroup, part, group);
    boxGroup.userData.basePreviewPositionY = boxGroup.position.y;
    mesh.renderOrder = 42 + index * 2;
    lines.renderOrder = 43 + index * 2;
    boxGroup.add(mesh, lines);
    if (part.part === "weapon" && group.userData?.weapon?.object) {
      boxGroup.visible = root.visible;
      root.userData.linkedHelpers.push(boxGroup);
      group.userData.weapon.object.add(boxGroup);
    } else {
      root.add(boxGroup);
    }
  });
  return root;
}

function colliderLocalMatrix(part) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(part.position || [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0]))),
    new THREE.Vector3(1, 1, 1),
  );
}

function weaponLocalMatrix(group) {
  const weaponObject = group.userData?.weapon?.object;
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

function setColliderPreviewTransform(object, part, group) {
  const matrix = part.part === "weapon" ? colliderRelativeToWeapon(part, group) : colliderLocalMatrix(part);
  if (matrix) matrix.decompose(object.position, object.quaternion, object.scale);
  else {
    object.position.set(...(part.position || [0, 0, 0]));
    object.rotation.set(...(part.rotation || [0, 0, 0]));
  }
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

function colliderPreviewGeometry(part) {
  if (part.vertices?.length >= 4) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(part.vertices.flat(), 3));
    const indices = part.vertices.length === 8
      ? [
          0, 1, 3, 1, 2, 3,
          4, 7, 5, 5, 7, 6,
          0, 4, 5, 0, 5, 1,
          1, 5, 6, 1, 6, 2,
          0, 3, 7, 0, 7, 4,
          3, 2, 6, 3, 6, 7,
        ]
      : [];
    for (let i = 1; !indices.length && i < part.vertices.length - 1; i += 1) indices.push(0, i, i + 1);
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }
  if (part.type === "wedge") {
    const geometry = new THREE.BufferGeometry();
    const vertices = wedgeVertices(part.halfExtents || [0.4, 0.15, 0.4]).flat();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex([
      0, 2, 4,
      1, 5, 3,
      0, 1, 3, 0, 3, 2,
      2, 3, 5, 2, 5, 4,
      0, 4, 5, 0, 5, 1,
    ]);
    geometry.computeVertexNormals();
    return geometry;
  }
  if (part.type === "cylinder") {
    const halfExtents = part.halfExtents || [0.2, 0.5, 0.5];
    const radius = Math.max(0.01, (Math.abs(halfExtents[1]) + Math.abs(halfExtents[2])) * 0.5);
    const height = Math.max(0.02, Math.abs(halfExtents[0]) * 2);
    return new THREE.CylinderGeometry(radius, radius, height, 32, 1);
  }
  return new THREE.BoxGeometry(...(part.halfExtents || [0.4, 0.15, 0.4]).map((value) => value * 2));
}

function addBotColliders(rb, id, visualScale = 1, group = null, partsOverride = null) {
  const parts = partsOverride || (group ? collectVisualColliderParts(group, id, { includeDriveContacts: true }) : botColliderParts(id, { includeDriveContacts: true }));
  const result = physics.addBotColliders({
    world: arena.world,
    rb,
    id,
    parts,
    visualScale,
    group,
    helpers: {
      wedgeVertices,
      colliderRotation,
      colliderRelativeToWeapon,
    },
  });
  rb.userData ||= {};
  rb.userData.physicsParts = result.parts;
  rb.userData.physicsColliderBindings = result.colliderBindings || [];
  return result.weaponBindings;
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

// Keep this physical damage collider/fill integration in sync with colliderTweaker.js.
// Shared tuning lives in physicalDamageShared.js; host-specific scene/Rapier glue stays here.
void PHYSICAL_DAMAGE_SYNC_NOTE;

function colliderSolidFillFaces(part) {
  const half = part.halfExtents || [0.4, 0.16, 0.4];
  const [hx, hy, hz] = half.map((value) => Math.max(0.01, Math.abs(value)));
  const face = (normal, vertices) => ({
    normal: new THREE.Vector3(...normal).normalize(),
    vertices: vertices.map((point) => new THREE.Vector3(...point)),
  });
  if (part.type === "wedge" || part.part === "wedge") {
    const vertices = wedgeVertices([hx, hy, hz]);
    return [
      face([-1, 0, 0], [vertices[0], vertices[2], vertices[4]]),
      face([1, 0, 0], [vertices[1], vertices[5], vertices[3]]),
      face([0, -1, 0], [vertices[0], vertices[1], vertices[3], vertices[2]]),
      face([0, 0, 1], [vertices[2], vertices[3], vertices[5], vertices[4]]),
      face([0, 1, -1], [vertices[0], vertices[4], vertices[5], vertices[1]]),
    ];
  }
  return [
    face([1, 0, 0], [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]]),
    face([-1, 0, 0], [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]]),
    face([0, 1, 0], [[-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz]]),
    face([0, -1, 0], [[-hx, -hy, hz], [-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]]),
    face([0, 0, 1], [[hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [-hx, -hy, hz]]),
    face([0, 0, -1], [[-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz]]),
  ];
}

function colliderSolidVertices(part) {
  const half = part.halfExtents || [0.4, 0.16, 0.4];
  const [hx, hy, hz] = half.map((value) => Math.max(0.01, Math.abs(value)));
  if (part.type === "wedge" || part.part === "wedge") return wedgeVertices([hx, hy, hz]).map((point) => new THREE.Vector3(...point));
  return [
    new THREE.Vector3(-hx, -hy, -hz),
    new THREE.Vector3(hx, -hy, -hz),
    new THREE.Vector3(-hx, hy, -hz),
    new THREE.Vector3(hx, hy, -hz),
    new THREE.Vector3(-hx, -hy, hz),
    new THREE.Vector3(hx, -hy, hz),
    new THREE.Vector3(-hx, hy, hz),
    new THREE.Vector3(hx, hy, hz),
  ];
}

function colliderSolidEdges(part) {
  if (part.type === "wedge" || part.part === "wedge") {
    return [
      [0, 1], [0, 2], [1, 3], [2, 3], [2, 4], [3, 5],
      [4, 5], [0, 4], [1, 5],
    ];
  }
  return [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
}

function colliderCutAxis(partPoint, half, preferredNormal = null) {
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

function clipColliderDamagePolygon(points, axis, min, max) {
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

function colliderSolidCutFaces(part, partPoint, radius, preferredNormal = null) {
  const half = (part.halfExtents || [0.4, 0.16, 0.4]).map((value) => Math.max(0.01, Math.abs(value)));
  const axis = colliderCutAxis(partPoint, half, preferredNormal);
  const side = preferredNormal && Math.abs(preferredNormal.getComponent(axis)) > 0.25
    ? Math.sign(preferredNormal.getComponent(axis)) || 1
    : partPoint.getComponent(axis) >= 0 ? 1 : -1;
  const cutCoord = THREE.MathUtils.clamp(
    partPoint.getComponent(axis) - side * Math.max(PHYSICAL_DAMAGE_FILL.cutInsetMin, radius * PHYSICAL_DAMAGE_FILL.cutInsetFactor),
    -half[axis] + 0.01,
    half[axis] - 0.01,
  );
  const vertices = colliderSolidVertices(part);
  const points = [];
  colliderSolidEdges(part).forEach(([ai, bi]) => {
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
    clipped = clipColliderDamagePolygon(
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

function colliderPartWorldMatrix(part, fighter) {
  if (part.part === "weapon" && fighter?.group?.userData?.weapon?.object) {
    const relative = colliderRelativeToWeapon(part, fighter.group);
    if (relative) {
      fighter.group.userData.weapon.object.updateMatrixWorld(true);
      return fighter.group.userData.weapon.object.matrixWorld.clone().multiply(relative);
    }
  }
  return fighter.group.matrixWorld.clone().multiply(colliderLocalMatrix(part));
}

function addColliderFaceTriangles({ bodyPositions, debrisPositions, face, partMatrix, mesh, debrisCenter }) {
  const triangles = [];
  for (let i = 1; i < face.vertices.length - 1; i += 1) triangles.push([0, i, i + 1]);
  const worldNormal = face.normal.clone().transformDirection(partMatrix).normalize();
  const bodyLocal = new THREE.Vector3();
  const debrisLocal = new THREE.Vector3();
  triangles.forEach((tri) => {
    tri.forEach((index) => {
      const world = face.vertices[index].clone().applyMatrix4(partMatrix);
      world.addScaledVector(worldNormal, PHYSICAL_DAMAGE_FILL.sharedSurfaceOffset);
      bodyLocal.copy(world);
      mesh.worldToLocal(bodyLocal);
      bodyPositions.push(bodyLocal.x, bodyLocal.y, bodyLocal.z);
      debrisLocal.copy(world).sub(debrisCenter);
      debrisPositions.push(debrisLocal.x, debrisLocal.y, debrisLocal.z);
    });
  });
}

function addBodyOnlyFaceTriangles({ bodyPositions, face, partMatrix, mesh, inflate = 1 }) {
  const triangles = [];
  for (let i = 1; i < face.vertices.length - 1; i += 1) triangles.push([0, i, i + 1]);
  const worldNormal = face.normal.clone().transformDirection(partMatrix).normalize();
  const center = face.vertices.reduce((sum, point) => sum.add(point), new THREE.Vector3()).multiplyScalar(1 / face.vertices.length);
  const bodyLocal = new THREE.Vector3();
  triangles.forEach((tri) => {
    tri.forEach((index) => {
      const local = face.vertices[index].clone();
      if (inflate !== 1) local.sub(center).multiplyScalar(inflate).add(center);
      const world = local.applyMatrix4(partMatrix).addScaledVector(worldNormal, PHYSICAL_DAMAGE_FILL.bodySurfaceOffset);
      bodyLocal.copy(world);
      mesh.worldToLocal(bodyLocal);
      bodyPositions.push(bodyLocal.x, bodyLocal.y, bodyLocal.z);
    });
  });
}

function makeSolidFillGeometry(positions) {
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

// Host fallback for the cake-volume model. Only body physics colliders define
// the bottom of the simulated solid interior; drive contacts are gameplay
// proxies and would make broken caps extend below the real bot.
function isPhysicalDamageCakeFloorCollider(part) {
  return part?.part === "body" && part.type !== "cylinder" && part.type !== "driveContact";
}

function physicalDamageBodyFloorInMeshLocal(fighter, mesh) {
  const parts = fighter.physicalDamageOriginalColliderParts || fighter.colliderParts || [];
  let floorY = Infinity;
  parts.forEach((part) => {
    if (!isPhysicalDamageCakeFloorCollider(part)) return;
    const position = part.position || [0, 0, 0];
    const half = part.halfExtents || [0.4, 0.16, 0.4];
    floorY = Math.min(floorY, position[1] - Math.abs(half[1]));
  });
  if (!Number.isFinite(floorY)) return null;
  const world = fighter.group.localToWorld(new THREE.Vector3(0, floorY + PHYSICAL_DAMAGE_FILL.cakeFloorOffset, 0));
  return mesh.worldToLocal(world).y;
}

function addCakeSolidInteriorFill({ fighter, candidate, bodyPositions }) {
  const geometry = candidate?.split?.pieceGeometry;
  if (!fighter?.group || !candidate?.mesh || !geometry?.attributes?.position) return 0;
  geometry.computeBoundingBox();
  const box = geometry.boundingBox?.clone();
  if (!box || !Number.isFinite(box.min.x)) return 0;
  box.expandByScalar(PHYSICAL_DAMAGE_FILL.cakeBoundsExpand);
  const floorY = physicalDamageBodyFloorInMeshLocal(fighter, candidate.mesh);
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

function addColliderSolidFillForPhysicalBreak({ fighter, candidate, prop, radius = 0.35 }) {
  if (!physicalDamageSolidFillInput?.checked || !fighter?.group || !candidate?.mesh || !candidate?.worldPoint || !prop?.mesh) return;
  const parts = fighter.physicalDamageOriginalColliderParts || fighter.colliderParts || [];
  if (!parts.length) return;
  if (candidate.damageZone === "weapon") {
    fighter.physicalDamageLastSolidFill = {
      body: 0,
      debris: 0,
      sourceParts: parts.length,
      usedParts: 0,
      cakeFill: 0,
      weaponSkipped: 1,
    };
    return;
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
    return;
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
  let cakeFill = addCakeSolidInteriorFill({ fighter, candidate, bodyPositions });

  const addPartFill = (part, { force = false } = {}) => {
    if (usedParts >= PHYSICAL_DAMAGE_FILL.maxSourceParts || part.part === "driveContact" || part.type === "cylinder") return false;
    const partMatrix = colliderPartWorldMatrix(part, fighter);
    if (!partMatrix) return false;
    const half = (part.halfExtents || [0.4, 0.16, 0.4]).map((value) => Math.max(0.01, Math.abs(value)));
    const inverse = partMatrix.clone().invert();
    const partPoint = candidate.worldPoint.clone().applyMatrix4(inverse);
    const preferredNormal = candidate.lastHitNormal?.clone?.().transformDirection(inverse).normalize() || null;
    const expanded = half.map((value) => value + scaledRadius);
    const overflow = Math.max(
      Math.abs(partPoint.x) - half[0],
      Math.abs(partPoint.y) - half[1],
      Math.abs(partPoint.z) - half[2],
    );
    if (!nearest || overflow < nearest.overflow) nearest = { part, overflow };
    if (!force && (Math.abs(partPoint.x) > expanded[0] || Math.abs(partPoint.y) > expanded[1] || Math.abs(partPoint.z) > expanded[2])) return false;
    const direction = partPoint.clone();
    if (direction.lengthSq() < 0.0001) direction.set(0, 1, 0);
    direction.normalize();
    let faces = colliderSolidCutFaces(part, partPoint, scaledRadius, preferredNormal);
    if (!faces.length) {
      faces = colliderSolidFillFaces(part)
      .map((face) => {
        const plane = face.vertices.reduce((sum, vertex) => sum + vertex.dot(face.normal), 0) / face.vertices.length;
        const distance = Math.abs(partPoint.dot(face.normal) - plane);
        const facing = face.normal.dot(direction);
        return { face, score: facing * 1.8 - distance / Math.max(0.001, scaledRadius), distance, facing };
      })
      .filter((item) => item.facing > 0.16 || item.distance < scaledRadius * 0.8)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2)
      .map((item) => item.face);
    }
    if (!faces.length) return;
    faces.forEach((face) => {
      addColliderFaceTriangles({
      bodyPositions,
      debrisPositions,
      face,
      partMatrix,
      mesh: candidate.mesh,
      debrisCenter,
      });
      addBodyOnlyFaceTriangles({
        bodyPositions,
        face,
        partMatrix,
        mesh: candidate.mesh,
        inflate: PHYSICAL_DAMAGE_FILL.mainBodyPatchInflate,
      });
    });
    usedParts += 1;
    return true;
  };

  parts.forEach((part) => addPartFill(part));
  if (!usedParts && nearest?.part) addPartFill(nearest.part, { force: true });

  const bodyGeometry = makeSolidFillGeometry(bodyPositions);
  if (bodyGeometry && candidate.mesh.parent) {
    const bodyFill = new THREE.Mesh(bodyGeometry, physicalDamageSolidFillMaterial);
    bodyFill.name = "physicalDamageColliderSolidFill";
    bodyFill.userData.physicalDamageCap = true;
    bodyFill.castShadow = true;
    bodyFill.receiveShadow = true;
    bodyFill.matrix.copy(candidate.mesh.matrix);
    bodyFill.matrix.decompose(bodyFill.position, bodyFill.quaternion, bodyFill.scale);
    candidate.mesh.parent.add(bodyFill);
  }

  const debrisGeometry = makeSolidFillGeometry(debrisPositions);
  if (debrisGeometry) {
    const debrisFill = new THREE.Mesh(debrisGeometry, physicalDamageSolidFillMaterial);
    debrisFill.name = "physicalDamageDebrisSolidFill";
    debrisFill.userData.physicalDamageDetached = true;
    debrisFill.castShadow = true;
    debrisFill.receiveShadow = true;
    prop.mesh.add(debrisFill);
  }
  fighter.physicalDamageLastSolidFill = {
    body: bodyGeometry ? 1 : 0,
    debris: debrisGeometry ? 1 : 0,
    sourceParts: parts.length,
    usedParts,
    cakeFill,
  };
}

function colliderPartWithRanges(part, ranges) {
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

function subtractBoxFromBodyCollider(part, subtractBox) {
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
    out.push(colliderPartWithRanges(part, nextRanges));
  };
  addBox([[ranges[0][0], cut[0][0]], ranges[1], ranges[2]]);
  addBox([[cut[0][1], ranges[0][1]], ranges[1], ranges[2]]);
  addBox([cut[0], [ranges[1][0], cut[1][0]], ranges[2]]);
  addBox([cut[0], [cut[1][1], ranges[1][1]], ranges[2]]);
  addBox([cut[0], cut[1], [ranges[2][0], cut[2][0]]]);
  addBox([cut[0], cut[1], [cut[2][1], ranges[2][1]]]);
  return out.length ? out : null;
}

function subtractBoxFromWedgeCollider(part, subtractBox) {
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
  return [colliderPartWithRanges(part, nextRanges)];
}

function splitBodyBoxColliderForBreak(part, localPoint, radius, axis, side, cutPlane) {
  if (part.type !== "box" || part.part !== "body") return null;
  const position = part.position || [0, 0, 0];
  const half = part.halfExtents || [0.4, 0.16, 0.4];
  const ranges = [0, 1, 2].map((rangeAxis) => [
    position[rangeAxis] - Math.abs(half[rangeAxis]),
    position[rangeAxis] + Math.abs(half[rangeAxis]),
  ]);
  const minHalf = PHYSICAL_DAMAGE_COLLIDER_CARVE.bodyMinHalf;
  const addBox = (out, nextRanges) => {
    if (nextRanges.some(([min, max]) => max - min < minHalf * 2)) return;
    out.push(colliderPartWithRanges(part, nextRanges));
  };
  const out = [];
  const coreRanges = ranges.map((range) => [...range]);
  const slabRanges = ranges.map((range) => [...range]);
  if (side > 0) {
    coreRanges[axis][1] = THREE.MathUtils.clamp(cutPlane, ranges[axis][0], ranges[axis][1]);
    slabRanges[axis][0] = coreRanges[axis][1];
  } else {
    coreRanges[axis][0] = THREE.MathUtils.clamp(cutPlane, ranges[axis][0], ranges[axis][1]);
    slabRanges[axis][1] = coreRanges[axis][0];
  }
  addBox(out, coreRanges);
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
    addBox(out, nextRanges);
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
  // Prefer lateral/depth trimming so damage does not accidentally remove the
  // bot's floor support and let the visible model sink through the arena.
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
  const splitParts = splitBodyBoxColliderForBreak(part, localPoint, radius, axis, side, side > 0 ? newMax : newMin);
  if (splitParts?.length) return splitParts;
  position[axis] = (newMin + newMax) * 0.5;
  half[axis] = (newMax - newMin) * 0.5;
  next.position = position;
  next.halfExtents = half;
  if (next.vertices) delete next.vertices;
  return next;
}

function rebuildFighterPhysicsColliders(fighter, nextParts) {
  if (!arena?.world || !fighter?.rb) return;
  const bindings = fighter.rb.userData?.physicsColliderBindings || [];
  bindings.forEach((binding) => {
    if (binding.collider) arena.world.removeCollider(binding.collider, true);
  });
  fighter.weaponColliderBindings = addBotColliders(fighter.rb, fighter.spec.id, fighter.visualScale || 1, fighter.group, nextParts);
  fighter.colliderParts = nextParts.map(cloneColliderPartForDamage);
  fighter.rb.userData.physicsParts = fighter.colliderParts.map(cloneColliderPartForDamage);
  if (fighter.physics) {
    fighter.physics.parts = fighter.colliderParts.map(cloneColliderPartForDamage);
  }
  fighter.colliderMinY = colliderPartsMinY(fighter.colliderParts, fighter.visualScale || 1);
  fighter.tractionBounds = colliderPartsBounds(fighter.colliderParts, fighter.visualScale || 1) || fighter.tractionBounds;
  if (fighter.frame) {
    fighter.frame.parts = fighter.colliderParts.map(cloneColliderPartForDamage);
    fighter.frame.colliderMinY = fighter.colliderMinY;
    fighter.frame.tractionBounds = fighter.tractionBounds;
  }
  if (fighter.colliderHelper) {
    fighter.colliderHelper.userData.linkedHelpers?.forEach((helper) => helper.parent?.remove(helper));
    fighter.group.remove(fighter.colliderHelper);
    fighter.colliderHelper = null;
  }
  if (showCollidersInput?.checked) {
    fighter.colliderHelper = makeColliderPreview(fighter.group, fighter.spec.id, fighter.colliderParts);
    fighter.colliderHelper.visible = mode === "arena";
    fighter.group.add(fighter.colliderHelper);
    syncArenaColliderHelpers();
  }
  correctFighterAboveFloor(fighter, 0.055);
}

function physicalDamageCarveResultList(result) {
  if (!result) return [];
  return Array.isArray(result) ? result : [result];
}

function adjustFighterCollidersForPhysicalBreak({ fighter, candidate = null, worldPoint, worldNormal = null, radius = 0.35 }) {
  if (!fighter?.group || !fighter?.colliderParts?.length || !worldPoint) return;
  const localPoint = fighter.group.worldToLocal(worldPoint.clone());
  const localNormal = worldNormal?.clone?.().transformDirection(fighter.group.matrixWorld.clone().invert()).normalize() || null;
  const subtractBox = damageCandidateLocalSubtractBox(fighter, candidate);
  const scaledRadius = Math.max(
    PHYSICAL_DAMAGE_COLLIDER_CARVE.radiusMin,
    radius * (fighter.visualScale || 1) * PHYSICAL_DAMAGE_COLLIDER_CARVE.radiusScale,
  );
  const beforeCount = fighter.colliderParts.length;
  let nextParts = fighter.colliderParts
    .flatMap((part) => {
      if (candidate?.damageZone === "weapon" && part.part !== "weapon") return [cloneColliderPartForDamage(part)];
      return physicalDamageCarveResultList(
        subtractBoxFromBodyCollider(part, subtractBox)
          || subtractBoxFromWedgeCollider(part, subtractBox)
          || carveColliderPartForBreak(part, localPoint, scaledRadius, { localNormal }),
      );
    });
  if (!nextParts.length) return;
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
      if (candidate?.damageZone === "weapon" && part.part !== "weapon") return;
      if (part.part === "driveContact") return;
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
        if (candidate?.damageZone === "weapon" && part.part !== "weapon") return cloneColliderPartForDamage(part);
        const maxHalf = Math.max(...(part.halfExtents || [0.4, 0.16, 0.4]).map(Math.abs));
        return carveColliderPartForBreak(
          part,
          localPoint,
          Math.max(scaledRadius, maxHalf * PHYSICAL_DAMAGE_COLLIDER_CARVE.forcedNearestHalfFactor),
          { force: true, localNormal },
        );
      }).flatMap(physicalDamageCarveResultList);
      changedCount = 1;
    }
  }
  const adjustment = {
    beforeCount,
    afterCount: nextParts.length,
    changedCount,
  };
  rebuildFighterPhysicsColliders(fighter, nextParts);
  fighter.physicalDamageLastColliderAdjustment = adjustment;
}

function syncWeaponColliderBindings(fighter) {
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
  fighter.weaponColliderBindings.forEach((binding) => {
    const sensor = physics.isWeaponColliderSensor?.(fighter, binding.part) || false;
    if (!binding.collider?.setSensor || binding.attackSensor === sensor) return;
    binding.collider.setSensor(sensor);
    binding.attackSensor = sensor;
  });
}

function densityForWeight(weightLbs, colliderCount = 1, scale = 0.08) {
  return Math.max(0.2, (weightLbs * scale) / Math.max(1, colliderCount));
}

function targetWeight(target) {
  return target.fighter?.weightLbs || target.prop?.weightLbs || target.rb?.userData?.weightLbs || MOMENTUM_REFERENCE_WEIGHT_LBS;
}

function rigidBodyMass(rb, fallback = 1) {
  const mass = rb?.mass?.();
  return Number.isFinite(mass) && mass > 0 ? mass : fallback;
}

function momentumScale(attacker, target, base = 1) {
  const weaponWeight = attacker.spec?.weaponWeightLbs || attacker.spec?.weightLbs || MOMENTUM_REFERENCE_WEIGHT_LBS;
  const receiverWeight = targetWeight(target);
  const inertia = attacker.weapon?.type === "bar" || attacker.weapon?.type === "drum"
    ? 1 + (attacker.spec?.weaponRotationalInertia || 0) * 0.35
    : 1;
  return base * inertia * THREE.MathUtils.clamp(weaponWeight / Math.max(1, receiverWeight), 0.18, 2.4);
}

function weaponInertiaAmount(fighter) {
  return Math.max(0, Number(fighter?.spec?.weaponRotationalInertia || 0));
}

function weaponMomentOfInertia(fighter) {
  const weaponWeight = Math.max(1, Number(fighter?.spec?.weaponWeightLbs || 0));
  const normalizedWeight = weaponWeight / MOMENTUM_REFERENCE_WEIGHT_LBS;
  return THREE.MathUtils.clamp(normalizedWeight * (0.65 + weaponInertiaAmount(fighter)), 0.08, 4.2);
}

function spinnerEnergy(fighter) {
  const rawSpeed = fighter?.weapon?.currentSpeed || 0;
  const speed = Number.isFinite(rawSpeed) ? Math.abs(rawSpeed) : 0;
  return 0.5 * weaponMomentOfInertia(fighter) * speed * speed * WEAPON_ENERGY_SCALE;
}

function spinnerSpeedRatio(fighter) {
  const weapon = fighter?.weapon;
  const visualSpeed = Math.max(1, Math.abs(weapon?.visualSpeed || weapon?.activeSpeed || weapon?.speed || 1));
  const currentSpeed = Number.isFinite(weapon?.currentSpeed) ? Math.abs(weapon.currentSpeed) : 0;
  return THREE.MathUtils.clamp(currentSpeed / visualSpeed, 0, 1);
}

function spinnerSpeedPowerMultiplier(fighter) {
  const halfMultiplier = Number.isFinite(fighter?.spec?.spinnerHalfSpeedPowerMultiplier)
    ? fighter.spec.spinnerHalfSpeedPowerMultiplier
    : 1;
  const fullMultiplier = Number.isFinite(fighter?.spec?.spinnerFullSpeedPowerMultiplier)
    ? fighter.spec.spinnerFullSpeedPowerMultiplier
    : 1;
  if (halfMultiplier === 1 && fullMultiplier === 1) return 1;
  const speedRatio = spinnerSpeedRatio(fighter);
  if (speedRatio <= 0.5) return 1 + (halfMultiplier - 1) * (speedRatio / 0.5);
  return halfMultiplier + (fullMultiplier - halfMultiplier) * ((speedRatio - 0.5) / 0.5);
}

function weaponInertiaBiases(type = "vertical-front") {
  if (type === "horizontal") return { lift: 0.58, pitch: 0.42, yaw: 1.55, kickback: 1.12, gyroYaw: 0.95, gyroRoll: 0.28 };
  if (type === "vertical") return { lift: 1.28, pitch: 1.22, yaw: 0.7, kickback: 0.92, gyroYaw: 0.24, gyroRoll: 1.12 };
  return { lift: 1.12, pitch: 1.0, yaw: 0.82, kickback: 1.0, gyroYaw: 0.34, gyroRoll: 0.95 };
}

function signedSpinnerDirection(fighter) {
  const weapon = fighter?.weapon;
  const current = Number.isFinite(weapon?.currentSpeed) ? weapon.currentSpeed : null;
  if (current !== null && Math.abs(current) > 0.001) return Math.sign(current);
  const configured = Number.isFinite(weapon?.visualSpeed)
    ? weapon.visualSpeed
    : Number.isFinite(weapon?.activeSpeed)
      ? weapon.activeSpeed
      : Number.isFinite(weapon?.speed)
        ? weapon.speed
        : 1;
  return Math.sign(configured || 1);
}

function spinnerHitDirection(attacker, side) {
  const radial = side.clone().setY(0);
  if (radial.lengthSq() < 0.0001) return radial.set(0, 0, -1);
  radial.normalize();
  if ((attacker.spec?.weaponRotationalInertiaType || "vertical-front") !== "horizontal") return radial;
  const tangent = fighterUpVector(attacker).cross(radial).setY(0);
  if (tangent.lengthSq() < 0.0001) return radial;
  tangent.normalize().multiplyScalar(signedSpinnerDirection(attacker));
  const direction = tangent.multiplyScalar(0.86).addScaledVector(radial, 0.14);
  if (direction.lengthSq() < 0.0001) return radial;
  return direction.normalize();
}

const PLOW_DEFENCE_HORIZONTAL_START_DEG = 12;
const PLOW_DEFENCE_HORIZONTAL_FULL_DEG = 48;
const PLOW_DEFENCE_VERTICAL_FULL_DEG = 10;
const PLOW_DEFENCE_VERTICAL_END_DEG = 50;

function wedgeSlopeDegrees(part) {
  const half = part?.halfExtents || [0.4, 0.16, 0.4];
  return Math.atan2(Math.max(0.001, Math.abs(half[1])), Math.max(0.001, Math.abs(half[2]))) * 180 / Math.PI;
}

function fighterPartsAtWorldPoint(fighter, point) {
  if (!fighter?.rb || !fighter?.physics?.parts?.length || !point) return [];
  const scale = fighter.visualScale || 1;
  const rbPosition = fighter.rb.translation();
  const rbRotation = fighter.rb.rotation();
  const bodyInverse = new THREE.Quaternion(rbRotation.x, rbRotation.y, rbRotation.z, rbRotation.w).invert();
  const worldPoint = new THREE.Vector3(point.x, point.y, point.z);
  return fighter.physics.parts.filter((part) => {
    if (part.part === "driveContact") return false;
    const partInverse = new THREE.Quaternion()
      .setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0])))
      .invert();
    const local = worldPoint.clone()
      .sub(new THREE.Vector3(rbPosition.x, rbPosition.y, rbPosition.z))
      .applyQuaternion(bodyInverse)
      .sub(new THREE.Vector3(...(part.position || [0, 0, 0])).multiplyScalar(scale))
      .applyQuaternion(partInverse);
    const half = (part.halfExtents || [0.4, 0.16, 0.4]).map((value) => Math.abs(value * scale));
    const horizontalPad = 0.16;
    const verticalPad = part.type === "wedge" || part.part === "wedge" ? 0.34 : 0.12;
    return Math.abs(local.x) <= half[0] + horizontalPad &&
      Math.abs(local.z) <= half[2] + horizontalPad &&
      Math.abs(local.y) <= half[1] + verticalPad;
  });
}

function spinnerPlowDefence(attacker, target, point) {
  if (plowDefenceToggleInput?.checked === false) return noPlowDefence();
  if (!target?.fighter) return noPlowDefence();
  const hits = fighterPartsAtWorldPoint(target.fighter, point);
  const wedgeHits = hits.filter((part) => part.type === "wedge" || part.part === "wedge");
  const targetWeaponType = target.fighter.weapon?.type;
  const nonWedgeHits = hits.filter((part) => {
    if (part.type === "wedge" || part.part === "wedge") return false;
    if (part.part === "body") return false;
    return !(part.part === "weapon" && (targetWeaponType === "flipper" || targetWeaponType === "meshFlipper"));
  });
  if (!wedgeHits.length || nonWedgeHits.length) return noPlowDefence();
  const slopeDeg = wedgeSlopeDegrees(wedgeHits[0]);
  const spinnerType = attacker.spec?.weaponRotationalInertiaType === "horizontal" ? "horizontal" : "vertical";
  const strength = spinnerType === "horizontal"
    ? THREE.MathUtils.clamp((slopeDeg - PLOW_DEFENCE_HORIZONTAL_START_DEG) / (PLOW_DEFENCE_HORIZONTAL_FULL_DEG - PLOW_DEFENCE_HORIZONTAL_START_DEG), 0, 1)
    : THREE.MathUtils.clamp((PLOW_DEFENCE_VERTICAL_END_DEG - slopeDeg) / (PLOW_DEFENCE_VERTICAL_END_DEG - PLOW_DEFENCE_VERTICAL_FULL_DEG), 0, 1);
  if (strength <= 0) return { ...noPlowDefence(), applied: true, slopeDeg, strength: 0 };
  if (spinnerType === "horizontal") {
    return {
      applied: true,
      slopeDeg,
      strength,
      pushFactor: THREE.MathUtils.clamp(1 - 0.24 * strength, 0.76, 1),
      liftFactor: THREE.MathUtils.clamp(1 - 0.86 * strength, 0.14, 1),
      torqueFactor: THREE.MathUtils.clamp(1 - 0.9 * strength, 0.1, 1),
      damageFactor: THREE.MathUtils.clamp(1 - 0.58 * strength, 0.42, 1),
      attackerReflectionBoost: 1 + 0.42 * strength,
    };
  }
  return {
    applied: true,
    slopeDeg,
    strength,
    pushFactor: 1,
    liftFactor: THREE.MathUtils.clamp(1 - 0.84 * strength, 0.16, 1),
    torqueFactor: THREE.MathUtils.clamp(1 - 0.9 * strength, 0.1, 1),
    damageFactor: THREE.MathUtils.clamp(1 - 0.5 * strength, 0.5, 1),
    attackerReflectionBoost: 1,
  };
}

function noPlowDefence() {
  return {
    applied: false,
    slopeDeg: null,
    strength: 0,
    pushFactor: 1,
    liftFactor: 1,
    torqueFactor: 1,
    damageFactor: 1,
    attackerReflectionBoost: 1,
  };
}

function weaponHitKey(target) {
  return target.fighter?.spec?.id || target.prop?.kind || String(target.rb?.handle ?? "target");
}

function canApplyWeaponHit(attacker, target) {
  const weapon = attacker?.weapon;
  if (!weapon) return true;
  const now = performance.now() / 1000;
  if (!weapon.lastHitTimes) weapon.lastHitTimes = new Map();
  const key = weaponHitKey(target);
  if (isImpulseWeapon(weapon) && now < (weapon.impulseStrokeUntil || 0)) {
    weapon.impulseStrokeHits ||= new Set();
    if (weapon.impulseStrokeHits.has(key)) return false;
    weapon.impulseStrokeHits.add(key);
    weapon.lastHitTimes.set(key, now);
    return true;
  }
  const previous = weapon.lastHitTimes.get(key) || 0;
  if (now - previous < WEAPON_HIT_COOLDOWN_SECONDS) return false;
  weapon.lastHitTimes.set(key, now);
  return true;
}

function drainSpinnerEnergy(fighter, amount) {
  const weapon = fighter?.weapon;
  if (!weapon || (weapon.type !== "bar" && weapon.type !== "drum")) return;
  const loss = THREE.MathUtils.clamp(amount, 0.035, 0.46);
  const currentSpeed = Number.isFinite(weapon.currentSpeed) ? weapon.currentSpeed : 0;
  weapon.currentSpeed = currentSpeed * Math.max(0.16, 1 - loss);
}

function spinnerSpinAxisWorld(fighter) {
  const q = fighter?.rb?.rotation?.();
  const orientation = q ? new THREE.Quaternion(q.x, q.y, q.z, q.w) : new THREE.Quaternion();
  const inertiaType = fighter?.spec?.weaponRotationalInertiaType || "vertical-front";
  if (inertiaType === "horizontal") return new THREE.Vector3(0, 1, 0).applyQuaternion(orientation).normalize();
  return new THREE.Vector3(1, 0, 0).applyQuaternion(orientation).normalize();
}

function yawForLocalMinusZFrontFacingTarget(from, target = { x: 0, z: 0 }, frontYawOffset = 0) {
  const yawToTarget = Math.atan2(from.x - target.x, from.z - target.z);
  return yawToTarget - frontYawOffset;
}

async function initPhysicsArena(progress = null, shouldContinue = () => true) {
  if (!arena || !shouldContinue()) return false;
  arena.world = new RAPIER.World({ x: 0, y: arenaGravityY(), z: 0 });
  arena.world.integrationParameters.dt = FIXED_PHYSICS_DT;
  arena.world.integrationParameters.numSolverIterations = Math.max(arena.world.integrationParameters.numSolverIterations || 0, 8);
  arena.world.integrationParameters.numInternalPgsIterations = Math.max(arena.world.integrationParameters.numInternalPgsIterations || 0, 2);
  arena.world.integrationParameters.maxCcdSubsteps = Math.max(arena.world.integrationParameters.maxCcdSubsteps || 0, 2);
  physics.configureWorld(arena.world);
  const groundDesc = RAPIER.RigidBodyDesc.fixed();
  const ground = arena.world.createRigidBody(groundDesc.setTranslation(0, ARENA_PHYSICS_FLOOR_BODY_Y, 0));
  arena.world.createCollider(RAPIER.ColliderDesc.cuboid(ARENA_HALF_WIDTH, ARENA_PHYSICS_FLOOR_HALF_HEIGHT, ARENA_HALF_LENGTH).setFriction(1.4), ground);
  const makeWall = (x, z, sx, sz) => {
    const body = arena.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, ARENA_CEILING_HEIGHT / 2, z));
    arena.world.createCollider(RAPIER.ColliderDesc.cuboid(sx, ARENA_CEILING_HEIGHT / 2, sz).setFriction(1.1).setRestitution(0.05), body);
  };
  makeWall(0, -ARENA_HALF_LENGTH, ARENA_HALF_WIDTH + 0.1, 0.1);
  makeWall(0, ARENA_HALF_LENGTH, ARENA_HALF_WIDTH + 0.1, 0.1);
  makeWall(-ARENA_HALF_WIDTH, 0, 0.1, ARENA_HALF_LENGTH + 0.1);
  makeWall(ARENA_HALF_WIDTH, 0, 0.1, ARENA_HALF_LENGTH + 0.1);
  const ceiling = arena.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, ARENA_CEILING_HEIGHT, 0));
  arena.world.createCollider(RAPIER.ColliderDesc.cuboid(ARENA_HALF_WIDTH, 0.12, ARENA_HALF_LENGTH).setFriction(0.8).setRestitution(0.05), ceiling);
  visibleArenaElementsOfType("upperDeck").forEach((element) => {
    const position = arenaElementPosition(element);
    const size = arenaElementSize(element, [5.8, 2.35]);
    const yaw = arenaElementRotationRadians(element, THREE.MathUtils.radToDeg(upperDeckYawForNearestWall(position, ARENA_HALF_WIDTH, ARENA_HALF_LENGTH)));
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    const body = arena.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(position.x, ARENA_PHYSICS_FLOOR_Y + 0.5, position.z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }),
    );
    arena.world.createCollider(
      RAPIER.ColliderDesc.cuboid(size[0] / 2, 0.5, size[1] / 2)
        .setFriction(1.15)
        .setRestitution(0.04),
      body,
    );
  });
  addScrewPhysicsColliders({ RAPIER, world: arena.world, screwHazards: arena.screwHazards || [], floorY: ARENA_VISUAL_FLOOR_Y });
  addKillSawPhysicsColliders({ RAPIER, world: arena.world, killSawHazards: arena.killSawHazards || [], floorY: ARENA_VISUAL_FLOOR_Y });

  progress?.("creating arena props");
  await nextPaint();
  if (!arena || !shouldContinue()) return false;

  const makeProp = (mesh, colliders, position, rotation = [0, 0, 0], meta = {}) => createArenaProp(mesh, colliders, position, rotation, meta);
  const propPositions = [
    [-3.6, 0.56, -5.2],
    [3.7, 0.56, -5.5],
    [-4.8, 0.56, -1.2],
    [4.6, 0.56, -0.8],
    [-3.4, 0.56, 3.2],
    [3.5, 0.56, 3.4],
    [-6.8, 0.56, 1.5],
    [6.8, 0.56, 1.8],
    [-1.8, 0.56, -7.2],
    [1.8, 0.56, -7.0],
  ];
  const makeSimpleProp = (i, position) => {
    const kind = i % 4;
    if (kind === 0) {
      const size = [0.72, 0.72, 0.72];
      makeProp(
        new THREE.Mesh(new THREE.BoxGeometry(...size), red),
        { desc: RAPIER.ColliderDesc.cuboid(0.36, 0.36, 0.36), density: densityForWeight(PROP_WEIGHT_LBS.simpleCube) },
        position,
        [0, i * 0.28, 0],
        { kind: "simpleCube", weightLbs: PROP_WEIGHT_LBS.simpleCube },
      );
      return;
    }
    if (kind === 1) {
      makeProp(
        new THREE.Mesh(new THREE.SphereGeometry(0.46, 32, 18), steel),
        { desc: RAPIER.ColliderDesc.ball(0.46), density: densityForWeight(PROP_WEIGHT_LBS.simpleSphere) },
        position,
        [0, 0, 0],
        { kind: "simpleSphere", weightLbs: PROP_WEIGHT_LBS.simpleSphere },
      );
      return;
    }
    if (kind === 2) {
      makeProp(
        new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.9, 32), chrome),
        { desc: RAPIER.ColliderDesc.cylinder(0.45, 0.36), density: densityForWeight(PROP_WEIGHT_LBS.simpleCylinder) },
        position,
        [0, i * 0.36, Math.PI / 2],
        { kind: "simpleCylinder", weightLbs: PROP_WEIGHT_LBS.simpleCylinder },
      );
      return;
    }
    makeProp(
      new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.28, 0.42), dark),
      { desc: RAPIER.ColliderDesc.cuboid(0.675, 0.14, 0.21), density: densityForWeight(PROP_WEIGHT_LBS.simpleBar) },
      position,
      [0, i * 0.42, 0.08],
      { kind: "simpleBar", weightLbs: PROP_WEIGHT_LBS.simpleBar },
    );
  };
  const makeBarbellProp = (position, yaw) => {
    const group = new THREE.Group();
    cyl(group, 0.075, 2.15, steel, [0, 0, 0], [0, 0, Math.PI / 2], 24);
    for (const x of [-1.18, 1.18]) {
      cyl(group, 0.32, 0.32, dark, [x, 0, 0], [0, 0, Math.PI / 2], 32);
      cyl(group, 0.24, 0.42, steel, [x + Math.sign(x) * 0.28, 0, 0], [0, 0, Math.PI / 2], 32);
    }
    makeProp(
      group,
      [
        { desc: RAPIER.ColliderDesc.capsule(1.02, 0.045), rotation: colliderRotation(0, 0, Math.PI / 2), density: densityForWeight(PROP_WEIGHT_LBS.barbell, 3), friction: 1.15, restitution: 0.04 },
        { desc: RAPIER.ColliderDesc.cylinder(0.17, 0.32), translation: [-1.18, 0, 0], rotation: colliderRotation(0, 0, Math.PI / 2), density: densityForWeight(PROP_WEIGHT_LBS.barbell, 3), friction: 1.2, restitution: 0.04 },
        { desc: RAPIER.ColliderDesc.cylinder(0.17, 0.32), translation: [1.18, 0, 0], rotation: colliderRotation(0, 0, Math.PI / 2), density: densityForWeight(PROP_WEIGHT_LBS.barbell, 3), friction: 1.2, restitution: 0.04 },
      ],
      [position[0], 0.36, position[2]],
      [0, yaw, 0],
      { kind: "barbell", weightLbs: PROP_WEIGHT_LBS.barbell, linearDamping: 0.5, angularDamping: 1.6 },
    );
  };
  const makeChairProp = (position, yaw) => {
    const group = new THREE.Group();
    box(group, [1.08, 0.12, 0.92], steel, [0, 0.44, 0], [0, 0, 0]);
    box(group, [1.08, 0.12, 0.16], steel, [0, 0.24, -0.38], [0, 0, 0]);
    box(group, [0.12, 1.05, 0.14], dark, [-0.42, 0.82, 0.38], [0.18, 0, 0]);
    box(group, [0.12, 1.05, 0.14], dark, [0.42, 0.82, 0.38], [0.18, 0, 0]);
    box(group, [1.08, 0.16, 0.14], dark, [0, 1.18, 0.48], [0.18, 0, 0]);
    for (const x of [-0.42, 0.42]) for (const z of [-0.32, 0.32]) box(group, [0.12, 0.56, 0.12], chrome, [x, 0.14, z], [0, 0, 0]);
    makeProp(
      group,
      [
        { desc: RAPIER.ColliderDesc.cuboid(0.46, 0.035, 0.36), translation: [0, 0.44, 0], density: densityForWeight(PROP_WEIGHT_LBS.chair, 9), friction: 1.05, restitution: 0.03 },
        { desc: RAPIER.ColliderDesc.cuboid(0.46, 0.035, 0.045), translation: [0, 0.24, -0.38], density: densityForWeight(PROP_WEIGHT_LBS.chair, 9), friction: 1.05, restitution: 0.03 },
        { desc: RAPIER.ColliderDesc.cuboid(0.46, 0.045, 0.04), translation: [0, 1.18, 0.48], rotation: colliderRotation(0.18, 0, 0), density: densityForWeight(PROP_WEIGHT_LBS.chair, 9), friction: 1.05, restitution: 0.03 },
        { desc: RAPIER.ColliderDesc.cuboid(0.035, 0.43, 0.04), translation: [-0.42, 0.82, 0.38], rotation: colliderRotation(0.18, 0, 0), density: densityForWeight(PROP_WEIGHT_LBS.chair, 9), friction: 1.05, restitution: 0.03 },
        { desc: RAPIER.ColliderDesc.cuboid(0.035, 0.43, 0.04), translation: [0.42, 0.82, 0.38], rotation: colliderRotation(0.18, 0, 0), density: densityForWeight(PROP_WEIGHT_LBS.chair, 9), friction: 1.05, restitution: 0.03 },
        { desc: RAPIER.ColliderDesc.cuboid(0.035, 0.23, 0.035), translation: [-0.42, 0.14, -0.32], density: densityForWeight(PROP_WEIGHT_LBS.chair, 9), friction: 1.05, restitution: 0.03 },
        { desc: RAPIER.ColliderDesc.cuboid(0.035, 0.23, 0.035), translation: [0.42, 0.14, -0.32], density: densityForWeight(PROP_WEIGHT_LBS.chair, 9), friction: 1.05, restitution: 0.03 },
        { desc: RAPIER.ColliderDesc.cuboid(0.035, 0.23, 0.035), translation: [-0.42, 0.14, 0.32], density: densityForWeight(PROP_WEIGHT_LBS.chair, 9), friction: 1.05, restitution: 0.03 },
        { desc: RAPIER.ColliderDesc.cuboid(0.035, 0.23, 0.035), translation: [0.42, 0.14, 0.32], density: densityForWeight(PROP_WEIGHT_LBS.chair, 9), friction: 1.05, restitution: 0.03 },
      ],
      [position[0], 0.18, position[2]],
      [0, yaw, 0],
      { kind: "chair", breakable: true, jawPressure: 0, stress: 0, weightLbs: PROP_WEIGHT_LBS.chair, linearDamping: 0.75, angularDamping: 2.1 },
    );
  };
  const objectMode = damageEnabled() ? "none" : arenaObjectModeSelect?.value || "none";
  const objectCount = THREE.MathUtils.clamp(
    pairedRangeNumberValue(arenaObjectCountInput, arenaObjectCountNumberInput, GAME_CONFIG.ui.arenaObjectCount),
    1,
    propPositions.length,
  );
  if (objectMode === "simple") {
    propPositions.slice(0, objectCount).forEach((position, i) => makeSimpleProp(i, position));
  } else if (objectMode === "complex") {
    propPositions.slice(0, objectCount).forEach((position, i) => (i % 2 ? makeChairProp(position, i * 0.5) : makeBarbellProp(position, i * 0.5)));
  }

  progress?.("creating bot rigid bodies and colliders");
  await nextPaint();
  if (!arena || !shouldContinue()) return false;

  getArenaFighterIds().forEach((id, i) => {
    const spec = bots.find((b) => b.id === id);
    const group = spec.builder();
    const visualScale = id === "huge" ? 0.9 : 1;
    group.scale.setScalar(visualScale);
    arena.root.add(group);
    const spawn = i === 0 ? PLAYER_SPAWN : RIVAL_SPAWN;
    const spawnYaw = yawForLocalMinusZFrontFacingTarget(spawn, { x: 0, z: 0 }, spec.frontYawOffset || 0);
    const spawnRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, spawnYaw, 0));
    const frame = createBotFrame({
      group,
      id,
      visualScale,
      floorY: ARENA_PHYSICS_FLOOR_Y,
      spawnClearance: PHYSICS2_SPAWN_CLEARANCE,
    });
    const colliderParts = frame.parts;
    const spawnBodyY = frame.groundedBodyY;
    group.position.copy(bodyPositionToVisualPosition({ frame }, { x: spawn.x, y: spawnBodyY, z: spawn.z }));
    group.quaternion.copy(spawnRotation);
    group.updateMatrixWorld(true);
    const rb = arena.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.x, spawnBodyY, spawn.z)
        .setRotation({ x: spawnRotation.x, y: spawnRotation.y, z: spawnRotation.z, w: spawnRotation.w })
        .setLinearDamping(0.24)
        .setAngularDamping(0.045)
        .setCcdEnabled(true)
        .setCanSleep(false),
    );
    const weaponColliderBindings = addBotColliders(rb, id, visualScale, group, colliderParts);
    rb.userData = { ...(rb.userData || {}), weightLbs: spec.weightLbs || 250 };
    const fighter = {
      spec,
      group,
      rb,
      health: 100,
      damageTotal: 0,
      damageParts: defaultDamageParts(),
      damageLog: [],
      lastDamageCollisionAt: 0,
      weightLbs: spec.weightLbs || 250,
      weapon: group.userData.weapon,
      drivetrain: group.userData.drivetrain,
      weaponColliderBindings,
      frame,
      visualScale,
      visualFloorOffset: frame.visualOffsetY,
      colliderMinY: frame.colliderMinY,
      colliderParts,
      tractionBounds: frame.tractionBounds,
      restingBodyY: spawnBodyY,
      stableDrive: { active: true, unstableUntil: 0, stableSince: performance.now() / 1000 },
      ai: i === 1,
      gamepadIndex: i,
	    };
	    fighter.physicalDamageColliderBaseline = colliderSystemVolumes(colliderParts);
	    fighter.physicalDamageOriginalColliderParts = colliderParts.map(cloneColliderPartForDamage);
	    if (showCollidersInput?.checked) {
      fighter.colliderHelper = makeColliderPreview(group, id, colliderParts);
      fighter.colliderHelper.visible = false;
      group.add(fighter.colliderHelper);
    } else {
      fighter.colliderHelper = null;
    }
    physics.initializeFighter(fighter, rb.userData?.physicsParts || colliderParts, { floorY: ARENA_PHYSICS_FLOOR_Y });
    arena.fighters.push(fighter);
  });
  updateDamageHud();
  syncDamageVisibility();
  progress?.(showCollidersInput?.checked ? "finalizing collider overlays" : "finalizing fighters");
  syncArenaColliderHelpers();
  if (!showCollidersInput?.checked) {
    const targetArena = arena;
    scheduleSecondaryWork(() => {
      if (mode !== "arena" || arena !== targetArena) return;
      arena.fighters.forEach((fighter) => {
        if (fighter.colliderHelper) return;
        fighter.colliderHelper = makeColliderPreview(fighter.group, fighter.spec.id, fighter.colliderParts);
        fighter.colliderHelper.visible = false;
        fighter.group.add(fighter.colliderHelper);
      });
      syncArenaColliderHelpers();
    });
  }
  return true;
}

function disposeArena() {
  clearFightIntroPreviewRoot();
  fightIntroWarmRenderTarget?.dispose?.();
  fightIntroWarmRenderTarget = null;
  window.clearTimeout(arenaCalloutHideTimer);
  arenaCalloutHideTimer = 0;
  if (arenaCalloutOverlay) arenaCalloutOverlay.hidden = true;
  if (!arena) return;
  endFightIntro({ startMatch: false });
  if (physicsLogRecorder.active) stopPhysicsLogRecording();
  scene.remove(arena.root);
  arena = null;
  document.body.dataset.roundOver = "false";
  if (roundEndOverlay) roundEndOverlay.hidden = true;
  if (knockoutBanner) knockoutBanner.textContent = "";
  updateDamageHud();
}

function colliderRotation(x = 0, y = 0, z = 0) {
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));
  return { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
}

function createArenaProp(mesh, colliders, position, rotation = [0, 0, 0], meta = {}) {
  if (!arena?.world) return null;
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
  arena.root.add(mesh);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(position[0], position[1], position[2])
    .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
  bodyDesc.setLinearDamping(meta.linearDamping ?? 0.28);
  bodyDesc.setAngularDamping(meta.angularDamping ?? 0.9);
  if (meta.ccd) bodyDesc.setCcdEnabled(true);
  if (meta.canSleep === false || meta.boundedArenaDebris) bodyDesc.setCanSleep(false);
  const rb = arena.world.createRigidBody(bodyDesc);
  const prop = { mesh, rb, ...meta, colliderCount: 0, colliderHandles: [] };
  colliderList.forEach((collider) => {
    const { desc, translation = [0, 0, 0], rotation: colliderRot = null, density = 1.8, friction = 1.05, restitution = 0.18 } = collider.desc
      ? collider
      : { desc: collider };
    desc.setTranslation(...translation);
    if (colliderRot) desc.setRotation(colliderRot);
    const created = arena.world.createCollider(desc.setDensity(density).setFriction(friction).setRestitution(restitution), rb);
    prop.colliderCount += 1;
    prop.colliderHandles.push(created.handle);
  });
  rb.userData = { weightLbs: prop.weightLbs || null, kind: prop.kind || "prop" };
  arena.props.push(prop);
  return prop;
}

function addChairStress(prop, amount, impulse = new THREE.Vector3()) {
  if (!prop?.breakable || prop.broken) return;
  prop.stress = (prop.stress || 0) + amount;
  prop.lastStressImpulse = impulse.clone();
  if (prop.stress >= CHAIR_BREAK_STRESS) breakChairProp(prop, impulse);
}

function breakChairProp(prop, impulse = new THREE.Vector3()) {
  if (!arena?.world || !prop || prop.broken) return;
  prop.broken = true;
  const p = prop.rb.translation();
  const r = prop.rb.rotation();
  const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w), "YXZ").y;
  arena.root.remove(prop.mesh);
  arena.world.removeRigidBody(prop.rb);
  arena.props = arena.props.filter((candidate) => candidate !== prop);

  const pieces = [
    { size: [1.08, 0.12, 0.92], local: [0, 0.44, 0], mat: steel },
    { size: [1.08, 0.16, 0.14], local: [0, 1.18, 0.48], mat: dark },
    { size: [0.12, 0.74, 0.12], local: [-0.42, 0.52, -0.32], mat: chrome },
    { size: [0.12, 0.74, 0.12], local: [0.42, 0.52, -0.32], mat: chrome },
    { size: [0.12, 0.95, 0.14], local: [-0.42, 0.82, 0.38], mat: dark },
    { size: [0.12, 0.95, 0.14], local: [0.42, 0.82, 0.38], mat: dark },
  ];
  pieces.forEach((piece, i) => {
    const local = new THREE.Vector3(...piece.local).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...piece.size), piece.mat);
    const next = createArenaProp(
      mesh,
      {
        desc: RAPIER.ColliderDesc.cuboid(piece.size[0] / 2, piece.size[1] / 2, piece.size[2] / 2),
        density: densityForWeight(PROP_WEIGHT_LBS.chairPiece),
        friction: 1.05,
        restitution: 0.06,
      },
      [p.x + local.x, p.y + local.y, p.z + local.z],
      [0.15 * (i % 2 ? -1 : 1), yaw + i * 0.23, 0.12 * (i % 3 - 1)],
      { kind: "chairPiece", weightLbs: PROP_WEIGHT_LBS.chairPiece, linearDamping: 0.65, angularDamping: 1.6 },
    );
    next?.rb.applyImpulse({ x: impulse.x * 0.18 + (i - 2.5) * 0.045, y: 0.05 + i * 0.01, z: impulse.z * 0.18 + (2.5 - i) * 0.035 }, true);
  });
}

function spawnSparks(position, count = 16) {
  if (!arena) return;
  const frame = Number.isFinite(online?.lastFrame) ? online.lastFrame : Math.floor(performance.now() / 16);
  const cellSize = 0.28;
  const key = [
    Math.round(position.x / cellSize),
    Math.round(position.y / cellSize),
    Math.round(position.z / cellSize),
  ].join(":");
  arena.sparkBurstFrame ||= new Map();
  if (arena.sparkBurstFrame.get(key) === frame) return;
  arena.sparkBurstFrame.set(key, frame);
  if (arena.sparkBurstFrame.size > 80) {
    for (const [entryKey, entryFrame] of arena.sparkBurstFrame) {
      if (frame - entryFrame > 2) arena.sparkBurstFrame.delete(entryKey);
    }
  }
  for (let i = 0; i < count; i += 1) {
    const spark = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), new THREE.MeshBasicMaterial({ color: i % 3 ? 0xffb338 : 0xffffff }));
    spark.position.copy(position);
    spark.userData.velocity = new THREE.Vector3((Math.random() - 0.5) * 4, Math.random() * 2.2 + 0.6, (Math.random() - 0.5) * 4);
    spark.userData.life = 0.45 + Math.random() * 0.4;
    arena.sparks.add(spark);
  }
}

function isSpinnerBlockedByBotGeometry(fighter, targetSpeed) {
  const weapon = fighter?.weapon;
  if (!arena?.fighters?.length || !fighter?.rb || !weapon?.object) return false;
  if (weapon.type !== "bar" && weapon.type !== "drum") return false;
  if (Math.abs(targetSpeed) <= 0.001) return false;
  const visualSpeed = Math.max(1, Math.abs(weapon.visualSpeed || weapon.activeSpeed || weapon.speed || 1));
  const currentSpeed = Math.abs(Number.isFinite(weapon.currentSpeed) ? weapon.currentSpeed : 0);
  if (currentSpeed / visualSpeed >= SPINNER_GEOMETRY_BLOCK_SPEED_RATIO) return false;
  const origin = fighter.rb.translation();
  const yaw = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(fighter.rb.rotation().x, fighter.rb.rotation().y, fighter.rb.rotation().z, fighter.rb.rotation().w),
    "YXZ",
  ).y;
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const weaponPoint = new THREE.Vector3();
  weapon.object.getWorldPosition(weaponPoint);
  const reach = Math.max(0.35, fighter.spec?.spinnerReach ?? 1.45);
  return arena.fighters.some((target) => {
    if (target === fighter || !target?.rb) return false;
    const p = target.rb.translation();
    const targetRadius = Math.max(0.55, target.physics?.radius || target.bodyRadius || 1.05);
    const toTarget = new THREE.Vector3(p.x - weaponPoint.x, 0, p.z - weaponPoint.z);
    const distance = toTarget.length();
    const contactDistance = Math.min(reach, targetRadius + 0.42);
    if (distance > contactDistance) return false;
    const side = distance > 0.001 ? toTarget.multiplyScalar(1 / distance) : forward;
    if (side.dot(forward) < -0.35) return false;
    return Math.abs(p.y - origin.y) < 1.35;
  });
}

function updateWeapon(fighter, dt, active, input = {}) {
  const weapon = fighter?.weapon;
  if (!weapon?.object) return;
  const now = performance.now() / 1000;
  weapon.damageEffectiveness = weaponDamageEffectiveness(fighter);
  stopBrokenWeapon(fighter);
  const weaponActive = isWeaponBroken(fighter) ? false : active;
  if (weapon.type === "crusher" && !weaponActive) resetCrusherBiteDamageLatch(fighter);
  // Mechanisms new to v1 (hammer, saw arm, lifter, grappler) run their stroke
  // and their nested rotors through the shared arm-weapon runtime, so the game
  // and the headless rig drive them identically.
  if (isNewArmWeapon(weapon)) {
    updateArmWeaponState(weapon, dt, {
      active: weaponActive,
      secondary: Boolean(input.weaponSecondary),
      strokeActive: isWeaponImpulseStrokeActive(fighter),
      broken: isWeaponBroken(fighter),
    });
    weapon.object.rotation.x = armWeaponAngle(weapon);
    (weapon.subs || []).forEach((sub) => {
      if (!sub.object) return;
      // A saw that IS the weapon part turns about the arm's own axis; a nested
      // rotor turns inside the arm group about its own axle.
      if (sub.spinsWeaponPivot) sub.spinAngle = (sub.spinAngle || 0) + sub.currentSpeed * dt;
      else sub.object.rotation.x += sub.currentSpeed * dt;
    });
    if (weapon.claw?.object) {
      const open = weapon.claw.openAngle || 0;
      const closed = weapon.claw.closedAngle || 0;
      weapon.claw.object.rotation.x = open + (weapon.clawAmount || 0) * (closed - open);
    }
    weapon.lastSpeedDelta = 0;
    return;
  }
  if (weapon.type === "bar" || weapon.type === "drum") {
    if (weapon.toggle && weaponActive && !weapon.wasInputActive) weapon.toggledOn = !weapon.toggledOn;
    weapon.wasInputActive = weaponActive;
    const spinning = weapon.toggle ? weapon.toggledOn : weaponActive;
    const visualSpeed = spinnerEffectiveVisualSpeed(fighter);
    const idleSpeed = Number.isFinite(weapon.idleSpeed) ? weapon.idleSpeed : 0;
    const targetSpeed = spinning ? visualSpeed : idleSpeed;
    const currentSpeed = Number.isFinite(weapon.currentSpeed) ? weapon.currentSpeed : Number.isFinite(weapon.speed) ? weapon.speed : 0;
    const speedDelta = Math.abs(targetSpeed - currentSpeed);
    const seconds = spinning ? weapon.spinUpSeconds : weapon.spinDownSeconds;
    const fixedRate = seconds ? Math.max(0.01, Math.max(1, Math.abs(visualSpeed || weapon.speed || 1)) / seconds) : null;
    const nextSpeed = fixedRate
      ? THREE.MathUtils.clamp(currentSpeed + Math.sign(targetSpeed - currentSpeed) * fixedRate * dt, Math.min(currentSpeed, targetSpeed), Math.max(currentSpeed, targetSpeed))
      : THREE.MathUtils.damp(currentSpeed, targetSpeed, spinning ? (weapon.acceleration || 60) : (weapon.deceleration || 28), dt);
    const blocked = spinning && isSpinnerBlockedByBotGeometry(fighter, targetSpeed);
    const cappedSpeed = Math.sign(nextSpeed || targetSpeed || currentSpeed) * Math.min(Math.abs(nextSpeed), Math.abs(visualSpeed || nextSpeed));
    const resolvedSpeed = blocked ? 0 : speedDelta < 0.001 ? targetSpeed : cappedSpeed;
    weapon.blockedByBotGeometry = blocked;
    weapon.lastSpeedDelta = resolvedSpeed - currentSpeed;
    weapon.currentSpeed = resolvedSpeed;
    const amount = dt * weapon.currentSpeed;
    if (weapon.axisPitch && weapon.spinAxis === "y") {
      weapon.object.rotateOnAxis(new THREE.Vector3(0, Math.cos(weapon.axisPitch), Math.sin(weapon.axisPitch)).normalize(), amount);
    } else {
      if (weapon.spinAxis === "x") weapon.object.rotation.x += amount;
      if (weapon.spinAxis === "y") weapon.object.rotation.y += amount;
      if (weapon.spinAxis === "z") weapon.object.rotation.z += amount;
    }
  } else {
    weapon.lastSpeedDelta = 0;
  }
  if (weapon.type === "flipper" || weapon.type === "crusher") {
    const strokeActive = isImpulseWeapon(weapon) && now < (weapon.impulseStrokeUntil || 0);
    const impulseVisualActive = isImpulseWeapon(weapon) ? strokeActive : weaponActive;
    const configuredReturnSeconds = Number.isFinite(weapon.returnSeconds) ? Math.max(0, weapon.returnSeconds) : null;
    let target = impulseVisualActive ? weapon.activeRotation : weapon.baseRotation;
    let speed = impulseVisualActive ? weapon.activeSpeed || weapon.speed : weapon.returnSpeed || weapon.speed;
    if (!impulseVisualActive && isImpulseWeapon(weapon) && configuredReturnSeconds && now < (weapon.impulseReturnUntil || 0)) {
      const returnStart = (weapon.impulseReturnUntil || now) - configuredReturnSeconds;
      const returnElapsed = Math.max(0, now - returnStart);
      const snapSeconds = Math.min(IMPULSE_FLIPPER_RETURN_SNAP_SECONDS, configuredReturnSeconds * 0.35);
      const slowSeconds = Math.max(0.001, configuredReturnSeconds - snapSeconds);
      const slowReturnTarget = THREE.MathUtils.lerp(weapon.activeRotation, weapon.baseRotation, IMPULSE_FLIPPER_RETURN_SLOW_FRACTION);
      const slowReturnSpeed = -Math.log(0.04) / slowSeconds;
      if (returnElapsed < slowSeconds) {
        target = slowReturnTarget;
        speed = slowReturnSpeed;
      } else {
        target = weapon.baseRotation;
        speed = -Math.log(0.003) / Math.max(0.001, snapSeconds);
      }
    } else if (!impulseVisualActive && configuredReturnSeconds) {
      speed = -Math.log(0.01) / configuredReturnSeconds;
    }
    weapon.object.rotation.x = THREE.MathUtils.damp(weapon.object.rotation.x, target, speed, dt);
  }
  if (weapon.type === "meshFlipper") {
    const target = weaponActive ? 1 : 0;
    weapon.amount = THREE.MathUtils.damp(weapon.amount, target, weapon.speed, dt);
    weapon.apply(weapon.amount);
  }
}

function isWeaponImpactActive(fighter, inputActive) {
  const weapon = fighter?.weapon;
  if (!weapon) return inputActive;
  if (weapon.type === "bar" || weapon.type === "drum") {
    const currentSpeed = Number.isFinite(weapon.currentSpeed) ? Math.abs(weapon.currentSpeed) : 0;
    return currentSpeed > Math.max(2, (weapon.visualSpeed || weapon.activeSpeed || weapon.speed || 1) * 0.08);
  }
  return inputActive;
}

function isImpulseWeapon(weapon) {
  // A hammer is fired and committed like a flipper: it takes v1's stroke window
  // and return gate, so it cannot be parked half way up.
  return weapon?.type === "flipper" || weapon?.type === "meshFlipper" || weapon?.type === "hammer";
}

function consumeWeaponPressEdge(fighter, inputActive) {
  const weapon = fighter?.weapon;
  if (!weapon) return Boolean(inputActive);
  const pressed = Boolean(inputActive);
  const now = performance.now() / 1000;
  const returning = isImpulseWeapon(weapon) && now < (weapon.impulseReturnUntil || 0);
  const edge = pressed && !weapon.impulseInputWasActive && !returning;
  if (edge && isImpulseWeapon(weapon)) {
    weapon.impulseStrokeStartedAt = now;
    weapon.impulseStrokeUntil = now + IMPULSE_WEAPON_STROKE_SECONDS;
    const returnSeconds = Number.isFinite(weapon.returnSeconds) ? Math.max(0, weapon.returnSeconds) : 0;
    weapon.impulseReturnUntil = weapon.impulseStrokeUntil + returnSeconds;
    weapon.impulseStrokeHits = new Set();
    weapon.lastHitTimes?.clear?.();
    weapon.hitCooldowns?.clear?.();
  }
  weapon.impulseInputWasActive = pressed;
  return edge;
}

function isWeaponImpulseStrokeActive(fighter, minElapsed = 0) {
  const weapon = fighter?.weapon;
  const now = performance.now() / 1000;
  return Boolean(
    isImpulseWeapon(weapon) &&
    now < (weapon.impulseStrokeUntil || 0) &&
    now - (weapon.impulseStrokeStartedAt || 0) >= minElapsed
  );
}

function clampDrive(value) {
  return THREE.MathUtils.clamp(value || 0, -1, 1);
}

function makeTankDriveInput(throttle = 0, turn = 0, extraTurn = 0) {
  const totalTurn = turn + extraTurn;
  return {
    leftDrive: clampDrive(throttle + totalTurn),
    rightDrive: clampDrive(throttle - totalTurn),
  };
}

function completeDriveInput(input = {}) {
  const tank = input.leftDrive !== undefined || input.rightDrive !== undefined ? input : makeTankDriveInput(input.throttle || 0, input.turn || 0);
  const leftDrive = clampDrive(tank.leftDrive);
  const rightDrive = clampDrive(tank.rightDrive);
  return {
    ...input,
    leftDrive,
    rightDrive,
    throttle: (leftDrive + rightDrive) * 0.5,
    turn: (leftDrive - rightDrive) * 0.5,
    brakeActive: Boolean(input.brakeActive),
  };
}

function controlSchemeForBot(id) {
  return bots.find((bot) => bot.id === id)?.controlScheme || "tank";
}

function gamepadDriveForScheme(pad, scheme) {
  const dead = (v) => (Math.abs(v) < 0.12 ? 0 : v);
  const leftY = -dead(pad.axes[1] || 0);
  const leftX = dead(pad.axes[0] || 0);
  const rightY = -dead(pad.axes[3] || 0);
  if (scheme === "arcade") return { throttle: leftY, turn: leftX, controlScheme: scheme };
  if (scheme === "car") return { throttle: leftY, turn: leftX * 0.62, controlScheme: scheme };
  return { leftDrive: leftY, rightDrive: rightY, controlScheme: "tank" };
}

function updateDrivetrain(target, driveInput, dt, visualScale = 1) {
  const drivetrain = target?.drivetrain || target?.userData?.drivetrain;
  if (!drivetrain) return;
  const input = completeDriveInput(driveInput);
  const wheelRadius = Math.max(0.05, (drivetrain.wheelRadius || 0.35) * visualScale);
  const maxSpeed = botGroundSpeedFeetPerSecond(target?.spec, "maxSpeed", TANK_DRIVE_MAX_SPEED);
  const applySpin = (wheel, sideDrive) => {
    const amount = (-sideDrive * maxSpeed * WHEEL_ANIMATION_SPEED_SCALE * dt) / wheelRadius;
    const axis = drivetrain.spinAxis || "x";
    if (axis === "x") wheel.rotation.x += amount;
    if (axis === "y") wheel.rotation.y += amount;
    if (axis === "z") wheel.rotation.z += amount;
  };
  drivetrain.leftWheels?.forEach((wheel) => applySpin(wheel, input.leftDrive));
  drivetrain.rightWheels?.forEach((wheel) => applySpin(wheel, input.rightDrive));
}

function hasHugeClimbObstacle(fighter, forward, right, side) {
  if (!arena?.world) return false;
  const origin = fighter.rb.translation();
  const wheelLane = new THREE.Vector3(origin.x, origin.y, origin.z)
    .addScaledVector(forward, 0.4)
    .addScaledVector(right, side * 1.28 * (fighter.visualScale || 1));
  const candidates = [
    ...arena.fighters.filter((candidate) => candidate !== fighter).map((candidate) => candidate.rb),
    ...arena.props.map((prop) => prop.rb),
  ];
  return candidates.some((rb) => {
    const p = rb.translation();
    const delta = new THREE.Vector3(p.x - wheelLane.x, p.y - wheelLane.y, p.z - wheelLane.z);
    const ahead = delta.dot(forward);
    const lateral = delta.dot(right);
    const vertical = p.y - origin.y;
    return (
      ahead > 0.05 &&
      ahead < HUGE_CLIMB_ASSIST_PROBE_DISTANCE &&
      Math.abs(lateral) < 0.72 &&
      vertical > -0.42 &&
      vertical < HUGE_CLIMB_ASSIST_PROBE_HEIGHT
    );
  });
}

function applyHugeClimbAssist(fighter, drive, forward, right, current, maxSpeed, dt) {
  if (!PHYSICS_ASSISTS.hugeClimbAssist) return;
  if (fighter.spec?.id !== "huge") return;
  const throttle = drive.throttle;
  if (throttle <= HUGE_CLIMB_ASSIST_FORWARD_THRESHOLD) return;
  const forwardSpeed = current.x * forward.x + current.z * forward.z;
  if (forwardSpeed >= maxSpeed * 0.55) return;
  const height = fighter.rb.translation().y;
  if (height >= HUGE_CLIMB_ASSIST_MAX_HEIGHT) return;
  const heightFade = THREE.MathUtils.clamp((HUGE_CLIMB_ASSIST_MAX_HEIGHT - height) / 0.36, 0, 1);
  const sideDrives = [
    { side: -1, drive: Math.max(0, drive.leftDrive) },
    { side: 1, drive: Math.max(0, drive.rightDrive) },
  ];
  sideDrives.forEach(({ side, drive: sideDrive }) => {
    if (sideDrive < HUGE_CLIMB_ASSIST_FORWARD_THRESHOLD || !hasHugeClimbObstacle(fighter, forward, right, side)) return;
    const amount = HUGE_CLIMB_ASSIST_IMPULSE * sideDrive * heightFade * dt * 60;
    fighter.rb.applyImpulse({ x: forward.x * amount * 0.12, y: amount, z: forward.z * amount * 0.12 }, true);
    const rollTorque = forward.clone().multiplyScalar(-side * amount * HUGE_CLIMB_ASSIST_SIDE_TORQUE);
    const pitchTorque = right.clone().multiplyScalar(amount * 0.05);
    fighter.rb.applyTorqueImpulse({ x: rollTorque.x + pitchTorque.x, y: 0, z: rollTorque.z + pitchTorque.z }, true);
  });
}

function botColliderGroundClearance(fighter) {
  const bodyY = fighter?.rb?.translation?.().y || 0;
  const parts = fighter?.colliderParts?.length ? fighter.colliderParts : activeColliderPartsForMode(fighter.group, fighter.spec.id);
  const minY = Number.isFinite(fighter?.colliderMinY) ? fighter.colliderMinY : colliderPartsMinY(parts, fighter.visualScale || 1);
  return bodyY + minY - fighterFloorY(fighter);
}

function fighterColliderWorldMinY(fighter) {
  return fighterGroundContactInfo(fighter).minY;
}

function fighterGroundContactInfo(fighter) {
  if (!fighter?.rb) return { minY: Infinity, point: null };
  const parts = fighter.colliderParts?.length ? fighter.colliderParts : activeColliderPartsForMode(fighter.group, fighter.spec.id);
  const visualScale = fighter.visualScale || 1;
  const p = fighter.rb.translation();
  const q = fighter.rb.rotation();
  const origin = new THREE.Vector3(p.x, p.y, p.z);
  const bodyRotation = new THREE.Quaternion(q.x, q.y, q.z, q.w);
  const ignoreUprightWeapons = (
    (fighter.weapon?.type === "bar" || fighter.weapon?.type === "drum") &&
    fighterUpVector(fighter).y > 0.58
  );
  let minY = Infinity;
  let point = null;
  const contactSamples = (part, halfExtents) => {
    if (part.type !== "cylinder") {
      return [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [
        halfExtents[0] * x,
        halfExtents[1] * y,
        halfExtents[2] * z,
      ])));
    }
    const radius = Math.max(Math.abs(halfExtents[1]), Math.abs(halfExtents[2]));
    const halfHeight = Math.abs(halfExtents[0]);
    return [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [
      radius * x,
      halfHeight * y,
      radius * z,
    ])));
  };
  parts.forEach((part) => {
    if (part.part === "driveContact" || part.ignoreGroundContact || (ignoreUprightWeapons && part.part === "weapon")) return;
    const halfExtents = (part.halfExtents || [0.4, 0.15, 0.4]).map((value) => value * visualScale);
    const position = new THREE.Vector3(...(part.position || [0, 0, 0])).multiplyScalar(visualScale);
    const localRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0])));
    contactSamples(part, halfExtents).forEach(([x, y, z]) => {
      const world = new THREE.Vector3(x, y, z).applyQuaternion(localRotation).add(position).applyQuaternion(bodyRotation).add(origin);
      if (world.y < minY) {
        minY = world.y;
        point = world;
      }
    });
  });
  return { minY, point };
}

function correctFighterAboveFloor(fighter, margin = 0.035) {
  const minY = fighterColliderWorldMinY(fighter);
  if (!Number.isFinite(minY)) return 0;
  const lift = fighterFloorY(fighter) + margin - minY;
  if (lift <= 0) return 0;
  const p = fighter.rb.translation();
  fighter.rb.setTranslation({ x: p.x, y: p.y + lift, z: p.z }, true);
  const velocity = fighter.rb.linvel();
  if (velocity.y < 0) fighter.rb.setLinvel({ x: velocity.x, y: Math.max(0, velocity.y), z: velocity.z }, true);
  return lift;
}

function fighterUpVector(fighter) {
  const q = fighter?.rb?.rotation?.();
  if (!q) return new THREE.Vector3(0, 1, 0);
  return new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
}

function isFighterInverted(fighter) {
  return fighterUpVector(fighter).y < -0.35;
}

function horizontalBodyRadius(fighter) {
  const bounds = fighter?.tractionBounds;
  if (!bounds) return 1.25;
  return Math.max(Math.abs(bounds.min.x), Math.abs(bounds.max.x), Math.abs(bounds.min.z), Math.abs(bounds.max.z), 0.65);
}

function stableDriveState(fighter) {
  if (!fighter.stableDrive) fighter.stableDrive = { active: true, unstableUntil: 0, stableSince: performance.now() / 1000 };
  return fighter.stableDrive;
}

function markFighterUnstable(fighter, seconds = STABLE_DRIVE_EXIT_SECONDS) {
  if (!fighter?.rb) return;
  const state = stableDriveState(fighter);
  state.active = false;
  state.unstableUntil = Math.max(state.unstableUntil || 0, performance.now() / 1000 + seconds);
  state.stableSince = 0;
}

function applyBroncoSelfRighting(fighter, active) {
  if (!active || fighter?.spec?.id !== "bronco" || !fighter?.rb) return;
  if (!isFighterInverted(fighter)) return;
  const effectiveness = weaponDamageEffectiveness(fighter);
  if (effectiveness <= 0) return;
  const now = performance.now() / 1000;
  if (now - (fighter.lastSelfRightAt || 0) < BRONCO_SELF_RIGHT_COOLDOWN_SECONDS) return;
  fighter.lastSelfRightAt = now;
  fighter.selfRightingUntil = now + 2.4;
  correctFighterAboveFloor(fighter, 0.08);
  const q = fighter.rb.rotation();
  const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w), "YXZ").y;
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const velocity = fighter.rb.linvel();
  const mass = THREE.MathUtils.clamp(rigidBodyMass(fighter.rb), 1, 800);
  const upwardCorrection = Math.max(0, 3.4 * effectiveness - velocity.y);
  if (upwardCorrection > 0) fighter.rb.applyImpulse({ x: 0, y: upwardCorrection * mass, z: 0 }, true);
  fighter.rb.applyImpulse({
    x: -forward.x * BRONCO_FLIPPER_FORWARD_IMPULSE * mass * 0.22 * effectiveness,
    y: BRONCO_FLIPPER_LIFT_IMPULSE * mass * 0.28 * effectiveness,
    z: -forward.z * BRONCO_FLIPPER_FORWARD_IMPULSE * mass * 0.22 * effectiveness,
  }, true);
  fighter.rb.applyTorqueImpulse({
    x: right.x * BRONCO_FLIPPER_ROLL_TORQUE * mass * 0.72 * effectiveness,
    y: 0.4 * mass * 0.12 * effectiveness,
    z: right.z * BRONCO_FLIPPER_ROLL_TORQUE * mass * 0.72 * effectiveness,
  }, true);
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
    fighter.rb.applyTorqueImpulse({
      x: right.x * 0.052 * mass,
      y: 0,
      z: right.z * 0.052 * mass,
    }, true);
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

function getConnectedGamepads() {
  return [...navigator.getGamepads()].filter(Boolean);
}

function defaultArenaCameraMode() {
  if (onlineIsActive()) return "bot";
  return getConnectedGamepads()[1] ? "battle" : "bot";
}

function getGamepadForIndex(index = 0) {
  return getConnectedGamepads()[index] || null;
}

function getGamepadButtonState(index) {
  if (!gamepadButtonState.has(index)) gamepadButtonState.set(index, { pause: false, confirm: false, anyButtonsDown: false });
  return gamepadButtonState.get(index);
}

function hapticStateForGamepad(index) {
  if (!gamepadHapticState.has(index)) gamepadHapticState.set(index, {
    collisionAt: 0,
    weaponAt: 0,
    activeUntil: 0,
    activePriority: 0,
  });
  return gamepadHapticState.get(index);
}

function playGamepadHaptic(index, { duration = 80, strong = 0.35, weak = 0.25 } = {}) {
  const pad = getGamepadForIndex(index);
  const actuator = pad?.vibrationActuator;
  const strongMagnitude = THREE.MathUtils.clamp(strong, 0, 1);
  const weakMagnitude = THREE.MathUtils.clamp(weak, 0, 1);
  if (actuator?.playEffect) {
    actuator.playEffect("dual-rumble", {
      startDelay: 0,
      duration,
      strongMagnitude,
      weakMagnitude,
    }).catch(() => {});
    return;
  }
  const fallback = pad?.hapticActuators?.[0];
  fallback?.pulse?.(Math.max(strongMagnitude, weakMagnitude), duration).catch?.(() => {});
}

async function testGamepadHaptic(index = 0) {
  const pad = getGamepadForIndex(index);
  if (!pad) return { ok: false, message: "No gamepad detected" };
  const strongMagnitude = 0.75;
  const weakMagnitude = 0.55;
  const duration = 180;
  const actuator = pad.vibrationActuator;
  if (actuator?.playEffect) {
    try {
      await actuator.playEffect("dual-rumble", {
        startDelay: 0,
        duration,
        strongMagnitude,
        weakMagnitude,
      });
      return { ok: true, message: `Haptics sent via vibrationActuator (${pad.id || "gamepad"})` };
    } catch (error) {
      return { ok: false, message: `vibrationActuator failed: ${error?.name || error?.message || error}` };
    }
  }
  const fallback = pad.hapticActuators?.[0];
  if (fallback?.pulse) {
    try {
      await fallback.pulse(Math.max(strongMagnitude, weakMagnitude), duration);
      return { ok: true, message: `Haptics sent via hapticActuators (${pad.id || "gamepad"})` };
    } catch (error) {
      return { ok: false, message: `hapticActuators failed: ${error?.name || error?.message || error}` };
    }
  }
  return { ok: false, message: `Gamepad has no haptic actuator (${pad.id || "gamepad"})` };
}

async function runHapticsTest() {
  if (hapticsStatus) hapticsStatus.textContent = "Testing haptics...";
  const result = await testGamepadHaptic(0);
  if (hapticsStatus) hapticsStatus.textContent = result.message;
}

function triggerGamepadHaptic(index, type, options = {}) {
  if (index === undefined || index === null) return;
  if (useHapticsInput && !useHapticsInput.checked) return;
  const now = performance.now() / 1000;
  const state = hapticStateForGamepad(index);
  const key = type === "weapon" ? "weaponAt" : "collisionAt";
  const cooldown = type === "weapon"
    ? HAPTIC_WEAPON_COOLDOWN_SECONDS
    : HAPTIC_COLLISION_COOLDOWN_SECONDS;
  const priority = options.priority ?? Math.max(options.strong ?? 0.35, options.weak ?? 0.25);
  const activePriority = state.activePriority || 0;
  const hasActiveHaptic = now < (state.activeUntil || 0);
  if (hasActiveHaptic && priority < activePriority - 0.02) return;
  if (now - (state[key] || 0) < cooldown && priority <= activePriority + 0.02) return;
  state[key] = now;
  state.activeUntil = now + (options.duration ?? 80) / 1000;
  state.activePriority = priority;
  playGamepadHaptic(index, options);
}

function localGamepadIndexForFighter(fighter) {
  if (!fighter) return null;
  if (online.role === "joiner" && arena?.fighters?.[1] === fighter) return 0;
  if (online.role === "host" && arena?.fighters?.[0] === fighter) return 0;
  return fighter.gamepadIndex;
}

function triggerFighterHaptic(fighter, type, options = {}) {
  triggerGamepadHaptic(localGamepadIndexForFighter(fighter), type, options);
}

function spinnerHapticProfile(fighter) {
  const id = fighter?.spec?.id;
  if (id === "minotaur" || id === "huge" || id === "tombstone") {
    return {
      base: 0.24,
      ramp: 0.76,
      exponent: 1.05,
      pulse: 0.22,
      duration: 58,
      strongMin: 0.22,
      strongRange: 0.78,
      weakMin: 0.18,
      weakRange: 0.72,
      priority: 0.42,
    };
  }
  if (id === "hypershock") {
    return {
      base: 0.2,
      ramp: 0.64,
      exponent: 1.02,
      pulse: 0.2,
      duration: 42,
      strongMin: 0.16,
      strongRange: 0.66,
      weakMin: 0.14,
      weakRange: 0.56,
      priority: 0.38,
    };
  }
  if (id === "biteforce") {
    return {
      base: 0.18,
      ramp: 0.56,
      exponent: 1.08,
      pulse: 0.18,
      duration: 50,
      strongMin: 0.14,
      strongRange: 0.58,
      weakMin: 0.13,
      weakRange: 0.5,
      priority: 0.3,
    };
  }
  return {
    base: 0.12,
    ramp: 0.38,
    exponent: 1.12,
    pulse: 0.12,
    duration: 54,
    strongMin: 0.1,
    strongRange: 0.42,
    weakMin: 0.1,
    weakRange: 0.36,
    priority: 0.22,
  };
}

function spinnerHapticStrength(fighter) {
  const weapon = fighter?.weapon;
  if (weapon?.type !== "bar" && weapon?.type !== "drum") return 0;
  const currentSpeed = Number.isFinite(weapon.currentSpeed) ? Math.abs(weapon.currentSpeed) : 0;
  const speedRatio = spinnerSpeedRatio(fighter);
  const visualSpeed = Math.max(1, Math.abs(weapon.visualSpeed || weapon.activeSpeed || weapon.speed || 1));
  const speedDelta = Number.isFinite(weapon.lastSpeedDelta) ? Math.abs(weapon.lastSpeedDelta) : 0;
  const speedDeltaRatio = THREE.MathUtils.clamp(speedDelta / Math.max(0.1, visualSpeed * 0.035), 0, 1);
  if (speedRatio <= 0.004 && speedDeltaRatio <= 0.004 && currentSpeed <= 0.001) return 0;
  const profile = spinnerHapticProfile(fighter);
  const speedCurve = Math.pow(speedRatio, profile.exponent);
  const spinupPulse = speedDeltaRatio * THREE.MathUtils.lerp(profile.pulse, profile.pulse * 0.45, speedRatio);
  const hapticScale = Number.isFinite(fighter.spec?.spinnerHapticScale) ? fighter.spec.spinnerHapticScale : 1;
  return THREE.MathUtils.clamp((profile.base + speedCurve * profile.ramp + spinupPulse) * hapticScale, 0, 1);
}

function updateWeaponSpinHaptics(fighter) {
  if (mode !== "arena") return;
  const weapon = fighter?.weapon;
  if (weapon?.type !== "bar" && weapon?.type !== "drum") return;
  const strength = spinnerHapticStrength(fighter);
  if (strength <= 0.025) return;
  const profile = spinnerHapticProfile(fighter);
  triggerFighterHaptic(fighter, "weapon", {
    duration: profile.duration,
    strong: profile.strongMin + strength * profile.strongRange,
    weak: profile.weakMin + strength * profile.weakRange,
    priority: profile.priority + strength * 0.5,
  });
}

// Refreshes the keep-alive audio loops (drive motor + weapon) for one fighter.
// Called once per rendered frame from the arena update; loops fade out on
// their own when this stops being called (pause, round over, mode switch).
function updateFighterSoundLoops(fighter, input, index) {
  if (!fighter?.rb) return;
  const position = fighter.rb.translation();
  const lin = fighter.rb.linvel();
  driveLoop(`fighter-${index}`, {
    level: Math.max(Math.abs(input?.leftDrive || 0), Math.abs(input?.rightDrive || 0)),
    speed: Math.hypot(lin.x, lin.z),
    position,
  });
  const type = fighter.weapon?.type;
  if (type === "bar" || type === "drum") {
    weaponLoop(`fighter-${index}`, { type, ratio: spinnerSpeedRatio(fighter), position });
  } else if (type === "crusher") {
    weaponLoop(`fighter-${index}`, { type, ratio: input?.weapon && !isWeaponBroken(fighter) ? 1 : 0, position });
  } else if (fighter.weapon?.subs?.length) {
    // Saw discs and lifter discs are rotors too, and a saw you cannot hear is a
    // saw the player forgets to switch on. They ride the drum loop at whatever
    // the rotor has actually spun up to.
    weaponLoop(`fighter-${index}`, { type: "drum", ratio: fighter.weapon.subRatio || 0, position });
  }
}

function captureFighterMotion(fighter) {
  const lin = fighter.rb.linvel();
  const ang = fighter.rb.angvel();
  return { lin: new THREE.Vector3(lin.x, lin.y, lin.z), ang: new THREE.Vector3(ang.x, ang.y, ang.z) };
}

function plainVec3(vector) {
  return vector ? { x: vector.x, y: vector.y, z: vector.z } : null;
}

function physicsLogSourceLabel(source) {
  if (!source) return null;
  if (typeof source === "string" || typeof source === "number" || typeof source === "boolean") return source;
  return source?.spec?.id || source?.prop?.kind || source?.kind || source?.id || source?.constructor?.name || "object";
}

function physicsLogSafeValue(value, seen = new WeakSet()) {
  if (value === null || value === undefined) return value ?? null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value?.isVector3 || ("x" in value && "y" in value && "z" in value && Object.keys(value).length <= 4)) return plainVec3(value);
  if (Array.isArray(value)) return value.map((item) => physicsLogSafeValue(item, seen));
  if (typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    const next = {};
    Object.entries(value).forEach(([key, item]) => {
      if (typeof item === "function") return;
      next[key] = physicsLogSafeValue(item, seen);
    });
    seen.delete(value);
    return next;
  }
  return String(value);
}

function physicsLogType() {
  if (physicsLogRecorder.active && physicsLogRecorder.meta?.type) return physicsLogRecorder.meta.type;
  return physicsLogTypeSelect?.value || "all";
}

function fighterWeaponLogState(fighter, input = null) {
  if (!fighter?.rb) return null;
  const weapon = fighter.weapon || null;
  const velocity = fighter.rb.linvel();
  const angular = fighter.rb.angvel();
  const visualSpeed = weapon?.type === "bar" || weapon?.type === "drum" ? spinnerEffectiveVisualSpeed(fighter) : 0;
  const currentSpeed = Number.isFinite(weapon?.currentSpeed) ? weapon.currentSpeed : 0;
  const speedRatio = visualSpeed ? Math.abs(currentSpeed) / Math.max(1, Math.abs(visualSpeed)) : 0;
  return {
    id: fighter.spec?.id || "unknown",
    weapon: weapon ? {
      type: weapon.type || null,
      input: Boolean(input?.weapon),
      active: isWeaponImpactActive(fighter, Boolean(input?.weapon)),
      broken: isWeaponBroken(fighter),
      damagePercent: weaponDamagePercent(fighter),
      effectiveness: weaponDamageEffectiveness(fighter),
      currentSpeed,
      effectiveVisualSpeed: visualSpeed,
      speedRatio,
      lastSpeedDelta: Number.isFinite(weapon.lastSpeedDelta) ? weapon.lastSpeedDelta : 0,
      blockedByBotGeometry: Boolean(weapon.blockedByBotGeometry),
      impactScale: fighter.spec?.spinnerImpactScale ?? null,
      impactCap: fighter.spec?.spinnerImpactCap ?? null,
      impactCapEnabled: fighter.spec?.spinnerImpactCapEnabled !== false,
      gyroScale: fighter.spec?.spinnerGyroScale ?? null,
      spinUpSeconds: weapon.spinUpSeconds ?? fighter.spec?.weaponSpinUpSeconds ?? null,
      hitCooldownEntries: weapon.hitCooldowns?.size || weapon.lastHitTimes?.size || 0,
    } : null,
    motion: {
      linvel: { x: velocity.x, y: velocity.y, z: velocity.z },
      angvel: { x: angular.x, y: angular.y, z: angular.z },
      speed: Math.hypot(velocity.x, velocity.y, velocity.z),
      angularSpeed: Math.hypot(angular.x, angular.y, angular.z),
      upY: fighterUpVector(fighter).y,
    },
  };
}

function physicsLogFighterState(fighter, input = null, before = null) {
  if (!fighter?.rb) return null;
  const p = fighter.rb.translation();
  const r = fighter.rb.rotation();
  const linvel = fighter.rb.linvel();
  const angvel = fighter.rb.angvel();
  const traction = physics.tractionForFighter(fighter);
  const up = fighterUpVector(fighter);
  const contact = fighterGroundContactInfo(fighter);
  return {
    id: fighter.spec?.id || "unknown",
    position: { x: p.x, y: p.y, z: p.z },
    rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
    linvel: { x: linvel.x, y: linvel.y, z: linvel.z },
    angvel: { x: angvel.x, y: angvel.y, z: angvel.z },
    speed: Math.hypot(linvel.x, linvel.y, linvel.z),
    horizontalSpeed: Math.hypot(linvel.x, linvel.z),
    angularSpeed: Math.hypot(angvel.x, angvel.y, angvel.z),
    upY: up.y,
    mass: rigidBodyMass(fighter.rb),
    minColliderY: contact.minY,
    groundClearance: Number.isFinite(contact.minY) ? contact.minY - fighterFloorY(fighter) : null,
    lowestPoint: plainVec3(contact.point),
    traction,
    input: input ? {
      leftDrive: input.leftDrive || 0,
      rightDrive: input.rightDrive || 0,
      throttle: input.throttle || 0,
      turn: input.turn || 0,
      weapon: Boolean(input.weapon),
      boostActive: Boolean(input.boostActive),
    } : null,
    physics: fighter.physics ? {
      lastDrive: fighter.physics.lastDrive || null,
      lastStep: fighter.physics.lastStep || null,
      wedgeTractionPenalty: fighter.physics.wedgeTractionPenalty || 0,
      inHitGrace: performance.now() / 1000 < (fighter.physics.hitGraceUntil || 0),
    } : null,
    preStep: before ? {
      lin: plainVec3(before.lin),
      ang: plainVec3(before.ang),
    } : null,
  };
}

function recordPhysicsLogEvent(type, detail = {}) {
  if (!physicsLogRecorder.active || physicsLogType() !== "weapons") return;
  physicsLogRecorder.events.push({
    elapsed: (performance.now() - physicsLogRecorder.startedAt) / 1000,
    type,
    ...physicsLogSafeValue(detail),
  });
}

function syncPhysicsLogUi() {
  if (!physicsLogToggleButton) return;
  physicsLogToggleButton.textContent = physicsLogRecorder.active ? "Stop recording" : "Record physics log";
  physicsLogToggleButton.classList.toggle("recording", physicsLogRecorder.active);
  if (!physicsLogStatus) return;
  if (physicsLogRecorder.active) {
    physicsLogStatus.textContent = `Recording ${physicsLogRecorder.samples.length} samples`;
  } else if (physicsLogRecorder.samples.length) {
    physicsLogStatus.textContent = `Recorded ${physicsLogRecorder.samples.length} samples`;
  } else {
    physicsLogStatus.textContent = "Physics log idle";
  }
}

function startPhysicsLogRecording() {
  physicsLogRecorder.active = true;
  physicsLogRecorder.startedAt = performance.now();
  physicsLogRecorder.stoppedAt = 0;
  physicsLogRecorder.frames = 0;
  physicsLogRecorder.droppedSamples = 0;
  physicsLogRecorder.samples = [];
  physicsLogRecorder.events = [];
  physicsLogRecorder.meta = {
    type: physicsLogTypeSelect?.value || "all",
    startedAt: new Date().toISOString(),
    gravityY: arenaGravityY(),
    fixedDt: FIXED_PHYSICS_DT,
    maxSamples: physicsLogRecorder.maxSamples,
    selectedBot: selected?.id,
    opponentBot: opponent?.id,
    fighters: (arena?.fighters || []).map((fighter) => ({
      id: fighter.spec?.id,
      visualScale: fighter.visualScale || 1,
      mass: fighter.rb ? rigidBodyMass(fighter.rb) : null,
      bounds: fighter.tractionBounds ? {
        min: plainVec3(fighter.tractionBounds.min),
        max: plainVec3(fighter.tractionBounds.max),
      } : null,
    })),
  };
  window.__battleBotPhysicsLog = { meta: physicsLogRecorder.meta, samples: physicsLogRecorder.samples };
  window.battleBotPhysicsLog = window.__battleBotPhysicsLog;
  if (physicsLogOutput) {
    physicsLogOutput.value = "";
    physicsLogOutput.hidden = true;
  }
  document.body.dataset.physicsLogStatus = "recording";
  syncPhysicsLogUi();
}

function stopPhysicsLogRecording() {
  recordPhysicsLogSample({ stepDt: 0, substep: 0, substeps: 0, inputs: [], preStepMotion: null, reason: "stop" });
  physicsLogRecorder.active = false;
  physicsLogRecorder.stoppedAt = performance.now();
  const log = {
    meta: {
      ...(physicsLogRecorder.meta || {}),
      stoppedAt: new Date().toISOString(),
      durationSeconds: (physicsLogRecorder.stoppedAt - physicsLogRecorder.startedAt) / 1000,
      sampleCount: physicsLogRecorder.samples.length,
      droppedSamples: physicsLogRecorder.droppedSamples,
    },
    samples: physicsLogRecorder.samples,
  };
  window.__battleBotPhysicsLog = log;
  window.battleBotPhysicsLog = log;
  let serialized = "";
  try {
    serialized = JSON.stringify(log);
  } catch (error) {
    serialized = JSON.stringify({
      meta: {
        ...(log.meta || {}),
        serializationError: error?.message || String(error),
        sampleCount: log.samples?.length || 0,
      },
      samples: log.samples?.map((sample) => ({
        index: sample.index,
        elapsed: sample.elapsed,
        mode: sample.mode,
        paused: sample.paused,
        events: sample.events?.map((event) => ({ type: event.type, elapsed: event.elapsed })) || [],
      })) || [],
    });
  }
  if (physicsLogOutput) {
    physicsLogOutput.value = serialized;
    physicsLogOutput.hidden = false;
    physicsLogOutput.focus();
    physicsLogOutput.select();
  }
  try {
    localStorage.setItem(PHYSICS_LOG_STORAGE_KEY, serialized);
  } catch {
    // Large recordings can exceed storage quota; the textarea still keeps the log for this session.
  }
  document.body.dataset.physicsLogSamples = String(log.meta.sampleCount);
  document.body.dataset.physicsLogStatus = "recorded";
  syncPhysicsLogUi();
  if (physicsLogStatus) physicsLogStatus.textContent = `Recorded ${log.meta.sampleCount} samples; log text selected for copying`;
  return log;
}

function recordPhysicsLogSample({ stepDt, substep, substeps, inputs = [], preStepMotion = null, reason = null }) {
  if (!physicsLogRecorder.active || !arena?.fighters?.length) return;
  if (physicsLogRecorder.samples.length >= physicsLogRecorder.maxSamples) {
    physicsLogRecorder.droppedSamples += 1;
    return;
  }
  physicsLogRecorder.frames += 1;
  const now = performance.now();
  const events = physicsLogRecorder.events.splice(0);
  const common = {
    index: physicsLogRecorder.samples.length,
    elapsed: (now - physicsLogRecorder.startedAt) / 1000,
    mode,
    paused: arenaPaused,
    reason,
    stepDt,
    substep,
    substeps,
  };
  physicsLogRecorder.samples.push(physicsLogType() === "weapons" ? {
    ...common,
    events,
    fighters: arena.fighters.map((fighter, index) => fighterWeaponLogState(fighter, inputs[index])),
  } : {
    ...common,
    events,
    fighters: arena.fighters.map((fighter, index) => physicsLogFighterState(fighter, inputs[index], preStepMotion?.get?.(fighter) || null)),
  });
  if (physicsLogRecorder.samples.length % 30 === 0) syncPhysicsLogUi();
}

function restoreLastPhysicsLog() {
  if (!physicsLogOutput) return;
  let text = "";
  try {
    text = localStorage.getItem(PHYSICS_LOG_STORAGE_KEY) || "";
  } catch {
    text = "";
  }
  if (!text) return;
  physicsLogOutput.value = text;
  physicsLogOutput.hidden = false;
  try {
    const log = JSON.parse(text);
    window.__battleBotPhysicsLog = log;
    window.battleBotPhysicsLog = log;
    physicsLogRecorder.samples = log.samples || [];
    physicsLogRecorder.meta = log.meta || null;
    document.body.dataset.physicsLogSamples = String(log.meta?.sampleCount || log.samples?.length || 0);
    document.body.dataset.physicsLogStatus = "restored";
  } catch {
    // Ignore stale/invalid debug payloads.
  }
  syncPhysicsLogUi();
}

function estimateCollisionDamagePoint(fighter) {
  if (!fighter?.rb) return { point: null, normal: null, kind: "collision" };
  const p = fighter.rb.translation();
  const position = new THREE.Vector3(p.x, p.y, p.z);
  const floorContact = fighterGroundContactInfo(fighter);
  let best = null;
  if (floorContact.point && floorContact.minY <= fighterFloorY(fighter) + 0.08) {
    best = {
      point: floorContact.point.clone(),
      normal: new THREE.Vector3(0, 1, 0),
      kind: "floor",
      score: 1,
    };
  }
  const wallDistances = [
    { distance: ARENA_HALF_WIDTH - Math.abs(position.x), normal: new THREE.Vector3(-Math.sign(position.x || 1), 0, 0), point: new THREE.Vector3(THREE.MathUtils.clamp(position.x, -ARENA_HALF_WIDTH, ARENA_HALF_WIDTH), position.y, position.z) },
    { distance: ARENA_HALF_LENGTH - Math.abs(position.z), normal: new THREE.Vector3(0, 0, -Math.sign(position.z || 1)), point: new THREE.Vector3(position.x, position.y, THREE.MathUtils.clamp(position.z, -ARENA_HALF_LENGTH, ARENA_HALF_LENGTH)) },
  ].sort((a, b) => a.distance - b.distance);
  if (wallDistances[0]?.distance < 0.34) {
    best = {
      point: wallDistances[0].point,
      normal: wallDistances[0].normal,
      kind: "wall",
      score: 1.2,
    };
  }
  const radius = Math.max(0.8, horizontalBodyRadius(fighter));
  const other = arena?.fighters
    ?.filter((candidate) => candidate !== fighter && candidate.rb)
    .map((candidate) => {
      const q = candidate.rb.translation();
      const delta = new THREE.Vector3(q.x - position.x, q.y - position.y, q.z - position.z);
      return { candidate, delta, distance: delta.length() };
    })
    .sort((a, b) => a.distance - b.distance)[0];
  if (other && other.distance < radius + Math.max(0.8, horizontalBodyRadius(other.candidate)) + 0.55) {
    const normal = other.delta.lengthSq() > 0.0001 ? other.delta.clone().normalize() : new THREE.Vector3(0, 0, -1);
    best = {
      point: position.clone().addScaledVector(normal, radius * 0.72),
      normal: normal.clone().negate(),
      kind: "botCollision",
      source: other.candidate,
      score: 1.4,
    };
  }
  return best || { point: position, normal: null, kind: "collision" };
}

function updateCollisionHaptics(fighter, before) {
  if (!fighter?.rb || !before) return;
  const lin = fighter.rb.linvel();
  const ang = fighter.rb.angvel();
  const linearDelta = new THREE.Vector3(lin.x, lin.y, lin.z).sub(before.lin).length();
  const angularDelta = new THREE.Vector3(ang.x, ang.y, ang.z).sub(before.ang).length();
  const severity = THREE.MathUtils.clamp((linearDelta - 1.15) / 6 + (angularDelta - 2.4) / 12, 0, 1);
  if (severity <= 0.06) return;
  markFighterUnstable(fighter, 1.15 + severity * 1.1);
  const now = performance.now() / 1000;
  if (now - (fighter.lastDamageCollisionAt || 0) < DAMAGE_COLLISION_COOLDOWN_SECONDS) return;
  fighter.lastDamageCollisionAt = now;
  const contact = estimateCollisionDamagePoint(fighter);
  const damage = (0.5 + severity * 5.5 + Math.max(0, linearDelta - 1.15) * 0.18) * (contact.score || 1);
  recordBotDamage(fighter, {
    amount: damage,
    point: contact.point,
    normal: contact.normal,
    kind: contact.kind,
    source: contact.source || null,
  });
}

function controlledBotIdForGamepad(gamepadIndex = 0) {
  if (gamepadIndex === 0) return selected.id;
  return opponent.id === selected.id ? fallbackGameBot(selected.id)?.id : opponent.id;
}

function readControls(gamepadIndex = 0) {
  const pads = getConnectedGamepads();
  const pad = pads[gamepadIndex] || null;
  const keyboardTank = gamepadIndex === 1
    ? makeTankDriveInput(
      (keys.has("ArrowUp") ? 1 : 0) - (keys.has("ArrowDown") ? 1 : 0),
      (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0),
    )
    : makeTankDriveInput(
      (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0),
      (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0),
      (keys.has("KeyE") ? 0.7 : 0) - (keys.has("KeyQ") ? 0.7 : 0),
    );
  const keyboard = {
    ...completeDriveInput(keyboardTank),
    weapon: gamepadIndex === 1 ? keys.has("Enter") : keys.has("Space"),
    // Second mechanism channel: saw motors, lifter discs, grappler jaws. Bots
    // without one ignore it, so the control layer does not need to know which
    // machine is which (armWeapons.js does).
    weaponSecondary: gamepadIndex === 1 ? keys.has("ShiftRight") : keys.has("ShiftLeft"),
    boostActive: false,
    brakeActive: false,
    pausePressed: false,
    confirmPressed: false,
  };
  if (!pad) {
    if (gamepadIndex === 0 && !arenaPaused && !onlineIsActive()) controllerStatus.textContent = "Controller waiting";
    return keyboard;
  }
  if (gamepadIndex === 0 && !arenaPaused && !onlineIsActive()) controllerStatus.textContent = pads[1] ? "2 controllers live" : "Xbox controller live";
  const controlledBotId = controlledBotIdForGamepad(gamepadIndex);
  const scheme = controlSchemeForBot(controlledBotId);
  const gamepadDrive = gamepadDriveForScheme(pad, scheme);
  const hasStickDrive = gamepadDrive.leftDrive !== undefined || gamepadDrive.rightDrive !== undefined
    ? gamepadDrive.leftDrive !== 0 || gamepadDrive.rightDrive !== 0
    : gamepadDrive.throttle !== 0 || gamepadDrive.turn !== 0;
  const boostActive = (pad.buttons[6]?.value || 0) > 0.2;
  const brakeActive = (pad.buttons[4]?.value || 0) > 0.2 || Boolean(pad.buttons[4]?.pressed);
  const anyButtonsDown = pad.buttons.some((button) => Boolean(button?.pressed) || (button?.value || 0) > 0.2);
  const confirmDown = Boolean(pad.buttons[0]?.pressed);
  const pauseDown = Boolean(pad.buttons[9]?.pressed);
  const previous = getGamepadButtonState(gamepadIndex);
  const anyButtonPressed = anyButtonsDown && !previous.anyButtonsDown;
  const confirmPressed = confirmDown && !previous.confirm;
  const pausePressed = pauseDown && !previous.pause;
  previous.anyButtonsDown = anyButtonsDown;
  previous.confirm = confirmDown;
  previous.pause = pauseDown;
  return {
    ...completeDriveInput(hasStickDrive ? gamepadDrive : gamepadIndex === 0 ? keyboard : {}),
    weapon: (pad.buttons[7]?.value || 0) > 0.2 || (gamepadIndex === 0 && keyboard.weapon),
    weaponSecondary: Boolean(pad.buttons[5]?.pressed) || (pad.buttons[5]?.value || 0) > 0.2
      || (gamepadIndex === 0 && keyboard.weaponSecondary),
    boostActive,
    brakeActive,
    pausePressed,
    confirmPressed,
    anyButtonPressed,
  };
}

function readViewerControls() {
  const input = readControls(0);
  const pad = getConnectedGamepads()[0];
  if (!pad) return { ...input, orbitX: 0, orbitY: 0 };
  const dead = (v) => (Math.abs(v) < 0.12 ? 0 : v);
  return {
    ...input,
    orbitX: dead(pad.axes[0] || 0),
    orbitY: dead(pad.axes[1] || 0),
  };
}

function signedAngleToDirection(fighter, direction) {
  const q = fighter.rb.rotation();
  const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w), "YXZ").y;
  const desired = Math.atan2(-direction.x, -direction.z);
  return Math.atan2(Math.sin(desired - yaw), Math.cos(desired - yaw));
}

function steerTowardDirection(fighter, direction, { throttle = 0.7, reverse = false, turnGain = 1.35 } = {}) {
  if (direction.lengthSq() < 0.0001) return completeDriveInput({ weapon: false });
  const angle = signedAngleToDirection(fighter, direction);
  const absAngle = Math.abs(angle);
  const alignment = Math.cos(angle);
  const turn = THREE.MathUtils.clamp(-angle * turnGain, -1, 1);
  const driveThrottle = absAngle < 1.22
    ? throttle * THREE.MathUtils.clamp(alignment, 0.18, 1) * (reverse ? -1 : 1)
    : 0;
  return completeDriveInput({ throttle: driveThrottle, turn });
}

function arenaWallPressure(position) {
  const xClearance = ARENA_HALF_WIDTH - Math.abs(position.x);
  const zClearance = ARENA_HALF_LENGTH - Math.abs(position.z);
  const clearance = Math.min(xClearance, zClearance);
  if (clearance > AI_WALL_PRESSURE_DISTANCE) return null;
  const away = new THREE.Vector3(
    xClearance < zClearance ? -Math.sign(position.x || 1) : 0,
    0,
    zClearance <= xClearance ? -Math.sign(position.z || 1) : 0,
  );
  return { clearance, away };
}

function updateAiMode(ai, modeName, now) {
  if (ai.mode === modeName) return;
  ai.mode = modeName;
  ai.modeStartedAt = now;
}

function computeArenaAiInput(fighter, opponentFighter, dt) {
  const now = performance.now() / 1000;
  const ai = fighter.aiState || (fighter.aiState = {
    mode: "approach",
    modeStartedAt: now,
    lastStrikeAt: 0,
    side: Math.random() < 0.5 ? -1 : 1,
  });
  const selfPos = fighter.rb.translation();
  const opponentPos = opponentFighter.rb.translation();
  const toOpponent = new THREE.Vector3(opponentPos.x - selfPos.x, 0, opponentPos.z - selfPos.z);
  const distance = toOpponent.length();
  const directionToOpponent = distance > 0.001 ? toOpponent.clone().multiplyScalar(1 / distance) : new THREE.Vector3(0, 0, -1);
  const wall = arenaWallPressure(selfPos);
  const opponentWall = arenaWallPressure(opponentPos);
  const modeAge = () => now - ai.modeStartedAt;
  if (wall && ai.mode !== "strike") updateAiMode(ai, "escapeWall", now);
  if (ai.mode === "approach" && distance < AI_STRIKE_DISTANCE) updateAiMode(ai, "strike", now);
  if (ai.mode === "approach" && distance < AI_ENGAGE_DISTANCE && modeAge() > 0.65) updateAiMode(ai, "feint", now);
  if (ai.mode === "strike" && (distance < 2.45 || modeAge() > AI_MAX_ATTACK_SECONDS)) {
    ai.lastStrikeAt = now;
    ai.side *= -1;
    updateAiMode(ai, "retreat", now);
  }
  if (ai.mode === "retreat" && (modeAge() > AI_RETREAT_SECONDS || distance > AI_ESCAPE_DISTANCE)) updateAiMode(ai, "reaim", now);
  if (ai.mode === "reaim" && modeAge() > AI_REAIM_SECONDS) updateAiMode(ai, "approach", now);
  if (ai.mode === "feint" && modeAge() > 0.52) updateAiMode(ai, distance < AI_STRIKE_DISTANCE + 0.5 ? "strike" : "approach", now);
  if (ai.mode === "escapeWall" && (!wall || wall.clearance > AI_WALL_PRESSURE_DISTANCE + 0.8 || modeAge() > 0.9)) updateAiMode(ai, "reaim", now);

  let input;
  if (ai.mode === "escapeWall") {
    input = steerTowardDirection(fighter, wall?.away || directionToOpponent.clone().negate(), { throttle: 0.72, turnGain: 1.55 });
  } else if (ai.mode === "retreat") {
    const lateral = new THREE.Vector3(-directionToOpponent.z * ai.side, 0, directionToOpponent.x * ai.side).multiplyScalar(0.45);
    const away = directionToOpponent.clone().negate().add(lateral).normalize();
    input = steerTowardDirection(fighter, away, { throttle: 0.62, turnGain: 1.45 });
  } else if (ai.mode === "reaim") {
    const lateral = new THREE.Vector3(-directionToOpponent.z * ai.side, 0, directionToOpponent.x * ai.side).multiplyScalar(0.75);
    input = steerTowardDirection(fighter, directionToOpponent.clone().add(lateral).normalize(), { throttle: 0.28, turnGain: 1.65 });
  } else if (ai.mode === "feint") {
    const lateral = new THREE.Vector3(-directionToOpponent.z * ai.side, 0, directionToOpponent.x * ai.side).multiplyScalar(0.95);
    input = steerTowardDirection(fighter, directionToOpponent.clone().add(lateral).normalize(), { throttle: 0.42, turnGain: 1.65 });
  } else {
    const wallBias = opponentWall ? opponentWall.away.clone().negate().multiplyScalar(0.45) : new THREE.Vector3();
    const throttle = ai.mode === "strike" ? 0.86 : 0.55;
    input = steerTowardDirection(fighter, directionToOpponent.clone().add(wallBias).normalize(), { throttle, turnGain: ai.mode === "strike" ? 1.05 : 1.35 });
  }
  const spinner = fighter.weapon?.type === "bar" || fighter.weapon?.type === "drum";
  const held = isHeldArmWeapon(fighter.weapon);
  // A held arm is worked, not fired: bring it up as soon as the opponent is
  // close enough to be under it, and drop it again while closing so the forks
  // are DOWN on the approach. Without that a lifter drives the whole fight
  // with its plow parked over its own back.
  const weapon = spinner
    ? distance < AI_ENGAGE_DISTANCE + 1.5
    : held
      ? distance < AI_STRIKE_DISTANCE + 0.2
      : distance < AI_STRIKE_DISTANCE + 0.35 && ai.mode === "strike";
  // Saw motors and jaws run whenever the bot is fighting: they cost nothing to
  // leave on and a saw that only spins on contact never cuts.
  const weaponSecondary = Boolean(fighter.weapon?.subs?.length || fighter.weapon?.claw);
  fighter.aiState = { ...ai, distance, dt };
  return completeDriveInput({ ...input, weapon, weaponSecondary });
}

function serializableInput(input) {
  const drive = completeDriveInput(input || {});
  return {
    leftDrive: Number(drive.leftDrive.toFixed(3)),
    rightDrive: Number(drive.rightDrive.toFixed(3)),
    weapon: Boolean(input?.weapon),
    weaponSecondary: Boolean(input?.weaponSecondary),
    boostActive: Boolean(input?.boostActive),
    brakeActive: Boolean(input?.brakeActive),
  };
}

function inputSignature(input) {
  const payload = serializableInput(input);
  return `${payload.leftDrive}|${payload.rightDrive}|${Number(payload.weapon)}|${Number(payload.weaponSecondary)}|${Number(payload.boostActive)}|${Number(payload.brakeActive)}`;
}

function pruneAcknowledgedInputs(ackSeq = 0) {
  const acknowledged = Number(ackSeq || 0);
  if (!Number.isFinite(acknowledged) || acknowledged <= 0) return;
  online.pendingInputs = online.pendingInputs.filter((entry) => entry.seq > acknowledged);
}

function publishOnlineInput(input) {
  if (online.role !== "joiner" || !online.room || online.state !== "playing") return;
  const now = performance.now();
  const payload = serializableInput(input);
  const signature = inputSignature(payload);
  const changed = signature !== online.lastSentInputSignature;
  if (!changed && now - online.lastInputSentAt < ONLINE_INPUT_SEND_MS) return;
  const seq = online.nextInputSeq;
  online.nextInputSeq += 1;
  online.lastInputSentAt = now;
  online.lastSentInputSignature = signature;
  online.pendingInputs.push({
    seq,
    frame: online.lastFrame,
    input: payload,
    sentAt: now,
  });
  if (online.pendingInputs.length > ONLINE_MAX_PENDING_INPUTS) {
    online.pendingInputs.splice(0, online.pendingInputs.length - ONLINE_MAX_PENDING_INPUTS);
  }
  online.room.publishTopic("input", {
    clientId: onlineClientId,
    seq,
    frame: online.lastFrame,
    input: payload,
    sentAt: Date.now(),
  });
}

function serializeRigidBody(rb) {
  const p = rb.translation();
  const r = rb.rotation();
  const lin = rb.linvel();
  const ang = rb.angvel();
  return {
    p: [p.x, p.y, p.z],
    r: [r.x, r.y, r.z, r.w],
    lin: [lin.x, lin.y, lin.z],
    ang: [ang.x, ang.y, ang.z],
  };
}

function serializeDamageEvents(fighter) {
  const now = performance.now() / 1000;
  fighterDamageEventsForRender(fighter, now);
  return (fighter.damageEvents || [])
    .filter((event) => event?.expiresAt > now)
    .slice(-8)
    .map((event) => ({
      id: String(event.id || ""),
      amount: Number(event.amount) || 0,
      label: event.label || "",
      major: Boolean(event.major),
      notable: Boolean(event.notable),
      duration: Number(event.duration) || DAMAGE_EVENT_DISPLAY_SECONDS,
      createdAgo: Math.max(0, now - (Number(event.createdAt) || now)),
      remaining: Math.max(0, (Number(event.expiresAt) || now) - now),
    }));
}

function serializeFighterDamageState(fighter) {
  return {
    damageTotal: Number(fighter.damageTotal) || 0,
    damageParts: { ...defaultDamageParts(), ...(fighter.damageParts || {}) },
    knockedOut: Boolean(fighter.knockedOut),
    systemLossPercent: {
      leftDrive: physicalDamageSystemLossPercent(fighter, "leftDrive"),
      rightDrive: physicalDamageSystemLossPercent(fighter, "rightDrive"),
      weapon: physicalDamageSystemLossPercent(fighter, "weapon"),
      leftSide: physicalDamageSystemLossPercent(fighter, "leftSide"),
      centerSide: physicalDamageSystemLossPercent(fighter, "centerSide"),
      rightSide: physicalDamageSystemLossPercent(fighter, "rightSide"),
    },
    damageEvents: serializeDamageEvents(fighter),
  };
}

function serializeFighter(fighter) {
  return {
    ...serializeRigidBody(fighter.rb),
    weapon: fighter.weapon ? {
      currentSpeed: fighter.weapon.currentSpeed || 0,
      toggledOn: Boolean(fighter.weapon.toggledOn),
      rotation: fighter.weapon.object ? [fighter.weapon.object.rotation.x, fighter.weapon.object.rotation.y, fighter.weapon.object.rotation.z] : null,
    } : null,
    damage: serializeFighterDamageState(fighter),
  };
}

function serializeOnlineArenaState() {
  return {
    matchTimeRemaining: arena?.matchTimeRemaining ?? MATCH_DURATION_SECONDS,
    knockoutPending: Boolean(arena?.knockoutPending),
    knockoutLoserIndex: arena?.knockoutLoser ? arena.fighters.indexOf(arena.knockoutLoser) : -1,
    knockoutWinnerIndex: arena?.knockoutWinner ? arena.fighters.indexOf(arena.knockoutWinner) : -1,
    roundOver: Boolean(arena?.roundOver),
    roundEndReason: arena?.roundEndReason || "",
    winnerIndex: arena?.winner ? arena.fighters.indexOf(arena.winner) : -1,
    winnerText: arena?.winnerText || "",
    paused: Boolean(arenaPaused),
  };
}

function serializeKillSawPairs() {
  return (arena?.killSawPairs || []).map((pair) => ({
    id: pair.id,
    initialized: Boolean(pair.initialized),
    state: pair.state || "down",
    elapsed: Number(pair.elapsed) || 0,
    duration: Number(pair.duration) || 0,
    exposure: Number(pair.exposure) || 0,
  }));
}

function publishOnlineSnapshot(force = false) {
  if (online.role !== "host" || !online.room || online.state !== "playing" || !arena?.world) return;
  const now = performance.now();
  if (!force && now - online.lastSnapshotSentAt < ONLINE_SNAPSHOT_SEND_MS) return;
  online.lastSnapshotSentAt = now;
  online.room.publishTopic("snapshot", {
    hostClientId: onlineClientId,
    frame: online.lastFrame,
    lastProcessedJoinerInputSeq: online.lastProcessedJoinerInputSeq,
    rules: gameRulesPayload(),
    arenaState: serializeOnlineArenaState(),
    killSawPairs: serializeKillSawPairs(),
    fighters: arena.fighters.map(serializeFighter),
    props: arena.props.map((prop) => serializeRigidBody(prop.rb)),
    sentAt: Date.now(),
  });
}

function clearOnlineRuntimeState() {
  online.lastInputSentAt = 0;
  online.lastSnapshotSentAt = 0;
  online.lastFrame = 0;
  online.nextInputSeq = 1;
  online.lastSentInputSignature = "";
  online.pendingInputs = [];
  online.lastProcessedJoinerInputSeq = 0;
  online.remoteSnapshotBuffer = [];
  online.latestSnapshot = null;
  online.lastAppliedSnapshotFrame = -1;
}

function applyRigidBodySnapshot(target, snapshot, visualOffset = 0) {
  if (!target?.rb || !snapshot?.p || !snapshot?.r) return;
  target.rb.setTranslation({ x: snapshot.p[0], y: snapshot.p[1], z: snapshot.p[2] }, true);
  target.rb.setRotation({ x: snapshot.r[0], y: snapshot.r[1], z: snapshot.r[2], w: snapshot.r[3] }, true);
  if (snapshot.lin) target.rb.setLinvel({ x: snapshot.lin[0], y: snapshot.lin[1], z: snapshot.lin[2] }, true);
  if (snapshot.ang) target.rb.setAngvel({ x: snapshot.ang[0], y: snapshot.ang[1], z: snapshot.ang[2] }, true);
  const p = target.rb.translation();
  const r = target.rb.rotation();
  const visual = target.group || target.mesh;
  if (target.group) visual.position.copy(bodyPositionToVisualPosition(target, p));
  else visual.position.set(p.x, p.y + visualOffset, p.z);
  visual.quaternion.set(r.x, r.y, r.z, r.w);
}

function keepDamageDebrisInArena(prop) {
  if (!prop?.boundedArenaDebris || !prop.rb) return;
  if (prop.quantumJawAttachment) return;
  const isBotDamagePiece = prop.kind === "botDamagePiece";
  const p = prop.rb.translation();
  const v = prop.rb.linvel();
  const margin = 0.32;
  const minX = -ARENA_HALF_WIDTH + margin;
  const maxX = ARENA_HALF_WIDTH - margin;
  const minZ = -ARENA_HALF_LENGTH + margin;
  const maxZ = ARENA_HALF_LENGTH - margin;
  const minY = ARENA_PHYSICS_FLOOR_Y + 0.08;
  const maxY = ARENA_CEILING_HEIGHT - margin;
  let x = p.x;
  let y = p.y;
  let z = p.z;
  let vx = v.x;
  let vy = v.y;
  let vz = v.z;
  let corrected = false;
  const bounce = isBotDamagePiece ? 0.28 : 0.46;
  if (x < minX) {
    x = minX;
    vx = Math.abs(vx) * bounce;
    corrected = true;
  } else if (x > maxX) {
    x = maxX;
    vx = -Math.abs(vx) * bounce;
    corrected = true;
  }
  if (z < minZ) {
    z = minZ;
    vz = Math.abs(vz) * bounce;
    corrected = true;
  } else if (z > maxZ) {
    z = maxZ;
    vz = -Math.abs(vz) * bounce;
    corrected = true;
  }
  if (y < minY) {
    y = minY;
    vy = Math.max(0.05, Math.abs(vy) * 0.22);
    corrected = true;
  } else if (y > maxY) {
    y = maxY;
    vy = -Math.abs(vy) * bounce;
    corrected = true;
  }
  const horizontalSpeed = Math.hypot(vx, vz);
  const maxHorizontalSpeed = isBotDamagePiece ? 3.1 : 11;
  if (horizontalSpeed > maxHorizontalSpeed) {
    const scale = maxHorizontalSpeed / horizontalSpeed;
    vx *= scale;
    vz *= scale;
    corrected = true;
  }
  const maxVerticalSpeed = isBotDamagePiece ? 2.4 : 11;
  if (Math.abs(vy) > maxVerticalSpeed) {
    vy = Math.sign(vy) * maxVerticalSpeed;
    corrected = true;
  }
  const angular = isBotDamagePiece ? prop.rb.angvel?.() : null;
  const angularSpeed = angular ? Math.hypot(angular.x, angular.y, angular.z) : 0;
  const maxAngularSpeed = 5.5;
  const clampAngular = isBotDamagePiece && angularSpeed > maxAngularSpeed;
  if (!corrected && !clampAngular) return;
  prop.rb.setTranslation({ x, y, z }, true);
  prop.rb.setLinvel({ x: vx, y: vy, z: vz }, true);
  if (clampAngular) {
    const scale = maxAngularSpeed / angularSpeed;
    prop.rb.setAngvel({ x: angular.x * scale, y: angular.y * scale, z: angular.z * scale }, true);
  }
}

function updateQuantumJawDebrisAttachment(prop) {
  const attachment = prop?.quantumJawAttachment;
  const weapon = attachment?.attacker?.weapon;
  const jaw = attachment?.jaw;
  if (!attachment || !prop?.rb || !prop?.mesh || !weapon?.object || !jaw) return;
  const neutral = Math.abs(signedAngleDelta(weapon.object.rotation.x, weapon.baseRotation || 0)) <= QUANTUM_BITE_DEBRIS_NEUTRAL_EPSILON;
  if (neutral) {
    prop.quantumJawAttachment = null;
    prop.rb.setLinvel({ x: 0, y: -0.18, z: 0 }, true);
    prop.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    return;
  }
  attachment.attacker.group?.updateMatrixWorld(true);
  jaw.updateMatrixWorld(true);
  const jawWorldPosition = new THREE.Vector3();
  const jawWorldQuaternion = new THREE.Quaternion();
  jaw.getWorldPosition(jawWorldPosition);
  jaw.getWorldQuaternion(jawWorldQuaternion);
  const worldPosition = attachment.localPosition.clone().applyQuaternion(jawWorldQuaternion).add(jawWorldPosition);
  const worldQuaternion = jawWorldQuaternion.clone().multiply(attachment.localQuaternion);
  prop.rb.setTranslation({ x: worldPosition.x, y: worldPosition.y, z: worldPosition.z }, true);
  prop.rb.setRotation({ x: worldQuaternion.x, y: worldQuaternion.y, z: worldQuaternion.z, w: worldQuaternion.w }, true);
  prop.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
  prop.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

function lerpArray(a = [], b = [], alpha = 0) {
  return a.map((value, index) => THREE.MathUtils.lerp(value, b[index] ?? value, alpha));
}

function interpolateRigidBodySnapshot(a, b, alpha = 0) {
  if (!a || !b) return a || b || null;
  const rotation = new THREE.Quaternion(a.r[0], a.r[1], a.r[2], a.r[3])
    .slerp(new THREE.Quaternion(b.r[0], b.r[1], b.r[2], b.r[3]), alpha);
  return {
    p: lerpArray(a.p, b.p, alpha),
    r: [rotation.x, rotation.y, rotation.z, rotation.w],
    lin: a.lin && b.lin ? lerpArray(a.lin, b.lin, alpha) : b.lin || a.lin,
    ang: a.ang && b.ang ? lerpArray(a.ang, b.ang, alpha) : b.ang || a.ang,
  };
}

function appendOnlineSnapshot(snapshot) {
  if (!snapshot) return;
  snapshot.receivedAt = performance.now();
  online.latestSnapshot = snapshot;
  online.remoteSnapshotBuffer.push(snapshot);
  online.remoteSnapshotBuffer.sort((a, b) => Number(a.frame || 0) - Number(b.frame || 0));
  if (online.remoteSnapshotBuffer.length > ONLINE_MAX_SNAPSHOT_BUFFER) {
    online.remoteSnapshotBuffer.splice(0, online.remoteSnapshotBuffer.length - ONLINE_MAX_SNAPSHOT_BUFFER);
  }
}

function applyFighterWeaponSnapshot(fighter, fighterSnapshot) {
  if (!fighter?.weapon || !fighterSnapshot?.weapon) return;
  fighter.weapon.currentSpeed = fighterSnapshot.weapon.currentSpeed || 0;
  fighter.weapon.toggledOn = Boolean(fighterSnapshot.weapon.toggledOn);
  if (fighter.weapon.object && fighterSnapshot.weapon.rotation) fighter.weapon.object.rotation.set(...fighterSnapshot.weapon.rotation);
}

function applyFighterDamageSnapshot(fighter, damage = null) {
  if (!fighter || !damage) return;
  fighter.damageTotal = Number(damage.damageTotal) || 0;
  fighter.damageParts = { ...defaultDamageParts(), ...(damage.damageParts || {}) };
  fighter.knockedOut = Boolean(damage.knockedOut);
  fighter.onlineDamageState = {
    systemLossPercent: { ...(damage.systemLossPercent || {}) },
  };
  const now = performance.now() / 1000;
  fighter.damageEvents = (damage.damageEvents || []).map((event) => {
    const remaining = Math.max(0, Number(event.remaining) || 0);
    const duration = Math.max(0.001, Number(event.duration) || DAMAGE_EVENT_DISPLAY_SECONDS);
    const createdAt = now - Math.max(0, Number(event.createdAgo) || 0);
    return {
      id: event.id || `${now}-${Math.random().toString(36).slice(2)}`,
      amount: Number(event.amount) || 0,
      label: event.label || "",
      major: Boolean(event.major),
      notable: Boolean(event.notable),
      duration,
      createdAt,
      expiresAt: now + remaining,
    };
  }).filter((event) => event.amount > 0 && event.expiresAt > now);
}

function applyOnlineArenaStateSnapshot(state = null) {
  if (!state || !arena) return;
  const previousRemaining = arena.matchTimeRemaining ?? MATCH_DURATION_SECONDS;
  arena.matchTimeRemaining = Number.isFinite(state.matchTimeRemaining)
    ? state.matchTimeRemaining
    : arena.matchTimeRemaining;
  maybeShowKillSawActivationCallout(previousRemaining, arena.matchTimeRemaining);
  arena.knockoutPending = Boolean(state.knockoutPending);
  arena.knockoutLoser = arena.fighters[Number(state.knockoutLoserIndex)] || null;
  arena.knockoutWinner = arena.fighters[Number(state.knockoutWinnerIndex)] || null;
  arena.roundOver = Boolean(state.roundOver);
  arena.roundEndReason = state.roundEndReason || "";
  arena.winner = arena.fighters[Number(state.winnerIndex)] || null;
  arena.winnerText = state.winnerText || (arena.winner ? `${fighterDisplayName(arena.winner, "Winner")} Wins!` : "");
  if (knockoutBanner) knockoutBanner.textContent = arena.knockoutPending ? "Knockout!" : "";
  if (arena.roundOver) {
    document.body.dataset.roundOver = "true";
    if (roundEndTitle) roundEndTitle.textContent = arena.winnerText || "Round over";
    if (roundEndImage && arena.winner) {
      roundEndImage.src = botWinnerImageSrc(arena.winner);
      roundEndImage.alt = `${fighterDisplayName(arena.winner, "Winner")} reference`;
    }
    if (roundEndOverlay) roundEndOverlay.hidden = false;
  }
}

function applyKillSawPairsSnapshot(pairs = []) {
  if (!arena?.killSawHazards?.length || !pairs.length) return;
  updateKillSawHazardVisuals({ arena, enabled: true, dt: 0 });
  const localPairs = arena.killSawPairs || [];
  pairs.forEach((snapshot, index) => {
    const pair = localPairs.find((candidate) => candidate.id === snapshot.id) || localPairs[index];
    if (!pair) return;
    pair.initialized = Boolean(snapshot.initialized);
    pair.state = snapshot.state || "down";
    pair.elapsed = Number(snapshot.elapsed) || 0;
    pair.duration = Number(snapshot.duration) || 0;
    pair.exposure = Number(snapshot.exposure) || 0;
  });
  updateKillSawHazardVisuals({ arena, enabled: true, dt: 0 });
}

function reconcilePredictedFighter(fighter, fighterSnapshot, snapshot = null) {
  if (!fighter?.rb || !fighterSnapshot?.p || !fighterSnapshot?.r) return;
  pruneAcknowledgedInputs(snapshot?.lastProcessedJoinerInputSeq);
  const current = fighter.rb.translation();
  const target = new THREE.Vector3(fighterSnapshot.p[0], fighterSnapshot.p[1], fighterSnapshot.p[2]);
  const error = target.distanceTo(new THREE.Vector3(current.x, current.y, current.z));
  if (error > ONLINE_RECONCILE_HARD_DISTANCE) {
    applyRigidBodySnapshot(fighter, fighterSnapshot, fighterVisualOffsetY(fighter));
    return;
  }
  if (error > ONLINE_RECONCILE_SOFT_DISTANCE) {
    const blend = THREE.MathUtils.clamp((error - ONLINE_RECONCILE_SOFT_DISTANCE) / (ONLINE_RECONCILE_HARD_DISTANCE - ONLINE_RECONCILE_SOFT_DISTANCE), 0.18, 0.55);
    const nextPosition = new THREE.Vector3(current.x, current.y, current.z).lerp(target, blend);
    const currentRotation = fighter.rb.rotation();
    const nextRotation = new THREE.Quaternion(currentRotation.x, currentRotation.y, currentRotation.z, currentRotation.w)
      .slerp(new THREE.Quaternion(fighterSnapshot.r[0], fighterSnapshot.r[1], fighterSnapshot.r[2], fighterSnapshot.r[3]), blend);
    fighter.rb.setTranslation({ x: nextPosition.x, y: nextPosition.y, z: nextPosition.z }, true);
    fighter.rb.setRotation({ x: nextRotation.x, y: nextRotation.y, z: nextRotation.z, w: nextRotation.w }, true);
  }
  if (fighterSnapshot.lin) fighter.rb.setLinvel({ x: fighterSnapshot.lin[0], y: fighterSnapshot.lin[1], z: fighterSnapshot.lin[2] }, true);
  if (fighterSnapshot.ang) fighter.rb.setAngvel({ x: fighterSnapshot.ang[0], y: fighterSnapshot.ang[1], z: fighterSnapshot.ang[2] }, true);
  syncFighterVisualFromBody(fighter);
}

function applyOnlineSnapshot(snapshot) {
  if (!snapshot || !arena?.world) return;
  if (Number(snapshot.frame ?? -1) <= online.lastAppliedSnapshotFrame) return;
  online.lastAppliedSnapshotFrame = Number(snapshot.frame ?? online.lastAppliedSnapshotFrame);
  const predictedIndex = online.role === "joiner" ? 1 : -1;
  applyGameRulesPayload(snapshot.rules);
  snapshot.fighters?.forEach((fighterSnapshot, index) => {
    const fighter = arena.fighters[index];
    if (!fighter) return;
    if (index === predictedIndex) reconcilePredictedFighter(fighter, fighterSnapshot, snapshot);
    else if (online.remoteSnapshotBuffer.length < 2) applyRigidBodySnapshot(fighter, fighterSnapshot, fighterVisualOffsetY(fighter));
    applyFighterWeaponSnapshot(fighter, fighterSnapshot);
    applyFighterDamageSnapshot(fighter, fighterSnapshot.damage);
  });
  applyOnlineArenaStateSnapshot(snapshot.arenaState);
  applyKillSawPairsSnapshot(snapshot.killSawPairs);
  updateDamageHud();
  if (online.remoteSnapshotBuffer.length < 2) {
    snapshot.props?.forEach((propSnapshot, index) => {
      const prop = arena.props[index];
      if (prop) applyRigidBodySnapshot(prop, propSnapshot, 0);
    });
  }
}

function applyInterpolatedOnlineSnapshots() {
  if (online.role !== "joiner" || !arena?.world || online.remoteSnapshotBuffer.length < 2) return;
  const renderAt = performance.now() - ONLINE_INTERPOLATION_DELAY_MS;
  while (online.remoteSnapshotBuffer.length > 2 && online.remoteSnapshotBuffer[1].receivedAt <= renderAt) {
    online.remoteSnapshotBuffer.shift();
  }
  const older = online.remoteSnapshotBuffer[0];
  const newer = online.remoteSnapshotBuffer[1];
  if (!older || !newer) return;
  const span = Math.max(1, newer.receivedAt - older.receivedAt);
  const alpha = THREE.MathUtils.clamp((renderAt - older.receivedAt) / span, 0, 1);
  const remoteFighter = arena.fighters[0];
  const olderFighter = older.fighters?.[0];
  const newerFighter = newer.fighters?.[0];
  if (remoteFighter && olderFighter && newerFighter) {
    applyRigidBodySnapshot(remoteFighter, interpolateRigidBodySnapshot(olderFighter, newerFighter, alpha), fighterVisualOffsetY(remoteFighter));
    applyFighterWeaponSnapshot(remoteFighter, alpha < 0.5 ? olderFighter : newerFighter);
  }
  arena.props.forEach((prop, index) => {
    const olderProp = older.props?.[index];
    const newerProp = newer.props?.[index];
    if (olderProp && newerProp) applyRigidBodySnapshot(prop, interpolateRigidBodySnapshot(olderProp, newerProp, alpha), 0);
  });
}

function updatePropVisuals(dt = 0) {
  arena?.props?.forEach((prop) => {
    updateQuantumJawDebrisAttachment(prop);
    keepDamageDebrisInArena(prop);
    const p = prop.rb.translation();
    const r = prop.rb.rotation();
    prop.mesh.position.set(p.x, p.y, p.z);
    prop.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  });
}

function predictJoinerPhysics(joinerInput, dt) {
  const host = arena?.fighters?.[0];
  const joiner = arena?.fighters?.[1];
  if (!host?.rb || !joiner?.rb || !arena?.world) return;
  const hostInput = applyDamageToInput(host, { weapon: false });
  const effectiveJoinerInput = applyDamageToInput(joiner, joinerInput);
  updateDrivetrain(joiner, effectiveJoinerInput, dt, joiner.visualScale);
  updateWeapon(joiner, dt, effectiveJoinerInput.weapon);
  const clampedDt = Math.min(dt, FIXED_PHYSICS_DT * MAX_PHYSICS_SUBSTEPS);
  const substeps = Math.max(1, Math.min(MAX_PHYSICS_SUBSTEPS, Math.ceil(clampedDt / FIXED_PHYSICS_DT)));
  const stepDt = clampedDt / substeps;
  for (let step = 0; step < substeps; step += 1) {
    physics.updateWedgeStates(arena, stepDt);
    physics.driveFighter(host, hostInput, stepDt);
    physics.driveFighter(joiner, effectiveJoinerInput, stepDt);
    updateWeapon(joiner, stepDt, effectiveJoinerInput.weapon);
    physics.applySpinnerGyro(joiner, effectiveJoinerInput, stepDt);
    updateWeaponSpinHaptics(joiner);
    syncWeaponColliderBindings(joiner);
    const preStepMotion = new Map(arena.fighters.map((fighter) => [fighter, captureFighterMotion(fighter)]));
    arena.world.integrationParameters.dt = stepDt;
    arena.world.step();
    physics.afterStep({
      arena,
      fighters: [host, joiner],
      inputs: [hostInput, effectiveJoinerInput],
      preStepMotion,
      dt: stepDt,
      callbacks: {},
    });
  }
  arena.fighters.forEach((fighter) => syncFighterVisualFromBody(fighter));
  updatePropVisuals(dt);
}

function updateOnlineHeartbeat() {
  if (online.role !== "host" || !online.recordId) return;
  const now = performance.now();
  if (now - online.lastHeartbeatAt < ONLINE_HEARTBEAT_MS) return;
  online.lastHeartbeatAt = now;
  transactOnlineRoom({ status: online.state === "playing" ? "playing" : "waiting", paused: arenaPaused, pauseOwnerClientId: online.pauseOwnerClientId });
}

function updateArena(dt) {
  if (!arena?.world) return;
  updateOnlineHeartbeat();
  const playerInput = testArenaInputs?.[0] || readControls();
  if (online.role === "joiner" && online.state === "playing") {
    const joinerInput = readControls(0);
    if (arena.roundOver && joinerInput.anyButtonPressed) restartArenaMatch();
    if (joinerInput.pausePressed) toggleArenaPaused();
    publishOnlineInput(joinerInput);
    applyOnlineSnapshot(online.latestSnapshot);
    if (!arenaPaused) {
      applyInterpolatedOnlineSnapshots();
      predictJoinerPhysics(joinerInput, dt);
    }
    return;
  }
  const localSecondControllerAllowed = !onlineIsPlaying();
  const rivalGamepad = localSecondControllerAllowed ? getConnectedGamepads()[1] || null : null;
  const sandboxMode = !damageEnabled();
  const rivalInput = testArenaInputs?.[1] || ((rivalGamepad || (sandboxMode && localSecondControllerAllowed)) ? readControls(1) : null);
  if (arena.roundOver && (playerInput.anyButtonPressed || rivalInput?.anyButtonPressed)) {
    restartArenaMatch();
    return;
  }
  if (playerInput.pausePressed) toggleArenaPaused();
  if (rivalInput?.pausePressed) toggleArenaPaused();
  if (playerInput.confirmPressed) skipFightIntroToFinalBeat();
  if (arenaPaused) return;
  if (damageEffectsEnabled() && !arena.roundOver) {
    if (!arena.knockoutPending) {
      const previousRemaining = arena.matchTimeRemaining ?? MATCH_DURATION_SECONDS;
      arena.matchTimeRemaining = Math.max(0, previousRemaining - dt);
      maybeShowKillSawActivationCallout(previousRemaining, arena.matchTimeRemaining);
    }
    updateRoundOverState();
    updateMatchHud();
    if (arena.roundOver) return;
  }
  const killSawsEnabled = damageEffectsEnabled()
    && !arena.roundOver
    && (arena.matchTimeRemaining ?? MATCH_DURATION_SECONDS) <= KILL_SAW_START_REMAINING_SECONDS;
  updateKillSawHazardVisuals({
    arena,
    enabled: killSawsEnabled,
    dt,
  });
  killSawAmbient(killSawsEnabled);
  const player = arena.fighters[0];
  const rival = arena.fighters[1];
  if (!player?.rb || !rival?.rb) return;
  let activeRivalInput = online.role === "host" && online.state === "playing" ? online.remoteInput : rivalInput;
  if (online.role === "host" && online.state === "playing" && performance.now() - online.lastRemoteInputAt > 850) {
    activeRivalInput = completeDriveInput({ weapon: false });
  }
  if (!activeRivalInput && !sandboxMode && !onlineIsActive() && arena.testOptions?.aiEnabled !== false) {
    activeRivalInput = computeArenaAiInput(rival, player, dt);
  }
  if (!activeRivalInput) activeRivalInput = completeDriveInput({ weapon: false });
  const effectivePlayerInput = applyDamageToInput(player, playerInput);
  const effectiveRivalInput = applyDamageToInput(rival, activeRivalInput);

  updateDrivetrain(player, effectivePlayerInput, dt, player.visualScale);
  updateDrivetrain(rival, effectiveRivalInput, dt, rival.visualScale);
  updateFighterSoundLoops(player, effectivePlayerInput, 0);
  updateFighterSoundLoops(rival, effectiveRivalInput, 1);

  const clampedDt = Math.min(dt, FIXED_PHYSICS_DT * MAX_PHYSICS_SUBSTEPS);
  const substeps = Math.max(1, Math.min(MAX_PHYSICS_SUBSTEPS, Math.ceil(clampedDt / FIXED_PHYSICS_DT)));
  const stepDt = clampedDt / substeps;
  for (let step = 0; step < substeps; step += 1) {
    const playerWeaponPressed = consumeWeaponPressEdge(player, effectivePlayerInput.weapon);
    const rivalWeaponPressed = consumeWeaponPressEdge(rival, effectiveRivalInput.weapon);
    if (playerWeaponPressed && !isWeaponBroken(player)) weaponFire(player.weapon?.type);
    if (rivalWeaponPressed && !isWeaponBroken(rival)) weaponFire(rival.weapon?.type);
    const result = stepPhysicsArena({
      physics,
      world: arena.world,
      arena,
      fighters: [player, rival],
      inputs: [effectivePlayerInput, effectiveRivalInput],
      dt: stepDt,
      updateWeapon,
      stabilizeFighter: stabilizeSelfRightingFighter,
      afterGyro: (fighter, index) => applyBroncoSelfRighting(fighter, index === 0 ? playerWeaponPressed : rivalWeaponPressed),
      afterStabilize: updateWeaponSpinHaptics,
      syncWeaponColliderBindings,
      beforeWeaponImpacts: () => {
        arena.props.forEach((prop) => {
          if (prop.jawPressure) prop.jawPressure = Math.max(0, prop.jawPressure - stepDt * 0.35);
          if (prop.stress) prop.stress = Math.max(0, prop.stress - stepDt * 0.06);
          if (prop.breakable && !prop.broken) {
            const velocity = prop.rb.linvel();
            const angular = prop.rb.angvel();
            const horizontalSpeed = Math.hypot(velocity.x, velocity.z);
            const angularSpeed = Math.hypot(angular.x, angular.y, angular.z);
            const pressure = Math.max(0, horizontalSpeed - 2.6) * 0.08 + Math.max(0, angularSpeed - 4.2) * 0.045;
            if (pressure > 0) addChairStress(prop, pressure * CHAIR_PHYSICS_STRESS_RATE * stepDt, new THREE.Vector3(velocity.x, 0.1, velocity.z));
          }
        });
      },
      weaponActiveForImpact: (fighter, input) => {
        // A ported arm is only dangerous once it has actually travelled — an
        // arm at rest is bodywork, and a saw that is not turning is a bracket.
        if (isNewArmWeapon(fighter.weapon)) {
          return !isWeaponBroken(fighter) && isArmWeaponEngaged(fighter.weapon, {
            strokeActive: isWeaponImpulseStrokeActive(fighter, IMPULSE_WEAPON_IMPACT_DELAY_SECONDS),
          });
        }
        const weaponInput = isImpulseWeapon(fighter.weapon)
          ? !isWeaponBroken(fighter) && isWeaponImpulseStrokeActive(fighter, IMPULSE_WEAPON_IMPACT_DELAY_SECONDS)
          : input.weapon;
        return isWeaponImpactActive(fighter, weaponInput);
      },
      weaponImpactCallbacksFor: () => ({
        spawnSparks,
        recordWeaponEvent: (event) => recordPhysicsLogEvent("weapon", event),
        // Physics-frame callback: recordBotDamage must enqueue physical breaks only.
        // Mesh selection, bounds work, preview building, and split prep belong off-frame.
        recordDamage: (event) => recordBotDamage(event.fighter, event),
        recordQuantumBiteDamage: recordCrusherBiteDamage,
      }),
      afterStepCallbacks: {
        // Physics-frame callback: keep this path free of geometry-heavy damage work.
        recordDamage: (event) => recordBotDamage(event.fighter, event),
      },
    });
    const preStepMotion = result?.preStepMotion || new Map();
    applyScrewHazardEffects({
      arena,
      fighters: [player, rival],
      dt: stepDt,
      preStepMotion,
      floorY: ARENA_VISUAL_FLOOR_Y,
      horizontalBodyRadius,
      rigidBodyMass,
      recordBotDamage,
      spawnSparks: (point, count) => {
        spawnSparks(point, count);
        hazardGrind("screw", point, (count || 12) / 24);
      },
      markFighterUnstable,
    });
    applyKillSawHazardEffects({
      arena,
      fighters: [player, rival],
      dt: stepDt,
      preStepMotion,
      floorY: ARENA_VISUAL_FLOOR_Y,
      rigidBodyMass,
      recordBotDamage,
      spawnSparks: (point, count) => {
        spawnSparks(point, count);
        hazardGrind("killSaw", point, (count || 12) / 24);
      },
      markFighterUnstable,
    });
    recordPhysicsLogSample({
      stepDt,
      substep: step,
      substeps,
      inputs: [effectivePlayerInput, effectiveRivalInput],
      preStepMotion,
    });
    arena.fighters.forEach((fighter) => updateCollisionHaptics(fighter, preStepMotion.get(fighter)));
  }

  arena.fighters.forEach((fighter) => {
    syncFighterVisualFromBody(fighter);
  });
  updatePropVisuals(dt);
  for (let i = arena.sparks.children.length - 1; i >= 0; i -= 1) {
    const spark = arena.sparks.children[i];
    spark.userData.life -= dt;
    spark.userData.velocity.y -= 8 * dt;
    spark.position.addScaledVector(spark.userData.velocity, dt);
    spark.material.opacity = Math.max(0, spark.userData.life);
    if (spark.userData.life <= 0) arena.sparks.remove(spark);
  }
  online.lastFrame += 1;
  publishOnlineSnapshot();
}

function broncoUnderFlipContact(attacker, target, localForward, localRight, localVertical, forward, right) {
  const assist = PHYSICS_ASSISTS.broncoUnderFlipper;
  if (!assist?.enabled || attacker.spec?.id !== "bronco") return null;
  if (attacker.weapon?.type !== "flipper" && attacker.weapon?.type !== "meshFlipper") return null;
  if (!target.fighter) return null;
  const inLiftZone = (
    localForward >= assist.forwardMin &&
    localForward <= assist.forwardMax &&
    Math.abs(localRight) <= assist.lateralHalfWidth &&
    localVertical >= assist.verticalMin &&
    localVertical <= assist.verticalMax
  );
  if (!inLiftZone) return null;
  const origin = attacker.rb.translation();
  const contactForward = THREE.MathUtils.clamp(localForward, assist.forwardMin, assist.forwardMax);
  const contactRight = THREE.MathUtils.clamp(localRight, -assist.lateralHalfWidth, assist.lateralHalfWidth);
  const point = new THREE.Vector3(origin.x, origin.y + assist.contactHeight, origin.z)
    .addScaledVector(forward, contactForward)
    .addScaledVector(right, contactRight);
  return { point, assist };
}

function applyBroncoUnderFlip(attacker, target, forward, right, contact) {
  const assist = contact.assist;
  const targetStrength = (target.kind === "bot" ? 1 : 0.55) * weaponDamageEffectiveness(attacker);
  if (targetStrength <= 0) return;
  markFighterUnstable(attacker, 1.5);
  if (target.fighter) markFighterUnstable(target.fighter, 2.1);
  const impulse = {
    x: forward.x * BRONCO_FLIPPER_FORWARD_IMPULSE * assist.forwardMultiplier * targetStrength,
    y: BRONCO_FLIPPER_LIFT_IMPULSE * assist.liftMultiplier * targetStrength,
    z: forward.z * BRONCO_FLIPPER_FORWARD_IMPULSE * assist.forwardMultiplier * targetStrength,
  };
  const point = { x: contact.point.x, y: contact.point.y, z: contact.point.z };
  if (target.rb.applyImpulseAtPoint) {
    target.rb.applyImpulseAtPoint(impulse, point, true);
  } else {
    target.rb.applyImpulse(impulse, true);
    const pitchTorque = right.clone().multiplyScalar(BRONCO_FLIPPER_ROLL_TORQUE * assist.fallbackPitchTorqueMultiplier * targetStrength);
    target.rb.applyTorqueImpulse({ x: pitchTorque.x, y: 0.25 * targetStrength, z: pitchTorque.z }, true);
  }
}

function applyWeaponImpacts(attacker, active, dt = 0) {
  if (!active || !PHYSICS_ASSISTS.scriptedWeaponImpulses) return;
  const isSpinner = attacker.weapon?.type === "bar" || attacker.weapon?.type === "drum";
  if (isSpinner && weaponDamageEffectiveness(attacker) <= 0) return;
  const effectiveness = isSpinner ? 1 : weaponDamageEffectiveness(attacker);
  if (effectiveness <= 0) return;
  const origin = attacker.rb.translation();
  const yaw = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(attacker.rb.rotation().x, attacker.rb.rotation().y, attacker.rb.rotation().z, attacker.rb.rotation().w),
    "YXZ",
  ).y;
  const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  const isFlipper = attacker.weapon?.type === "flipper" || attacker.weapon?.type === "meshFlipper";
  const isCrusher = attacker.weapon?.type === "crusher";
  const hitOrigin = new THREE.Vector3(origin.x, origin.y + 0.15, origin.z).addScaledVector(forward, isSpinner ? 0.45 : 1.15);
  if (isSpinner && attacker.weapon?.object) attacker.weapon.object.getWorldPosition(hitOrigin);
  const rawSpinnerSpeed = attacker.weapon?.currentSpeed ?? attacker.weapon?.speed ?? 0;
  const spinnerSpeed = Number.isFinite(rawSpinnerSpeed) ? Math.abs(rawSpinnerSpeed) : 0;
  const spinnerVisualSpeed = spinnerEffectiveVisualSpeed(attacker);
  const spinnerBreakSpeed = spinnerVisualSpeed * HUGE_SPINNER_BREAK_SPEED_RATIO;
  const spinnerPower = isSpinner ? THREE.MathUtils.clamp(spinnerSpeed / Math.max(1, spinnerVisualSpeed || 1), 0.18, 1.5) : 1;
  const spinnerReach = isSpinner && Number.isFinite(attacker.spec?.spinnerReach)
    ? attacker.spec.spinnerReach
    : isSpinner && attacker.weapon?.object?.children?.[0]?.geometry?.boundingSphere
    ? attacker.weapon.object.children[0].geometry.boundingSphere.radius * (attacker.group?.scale.x || 1) + 0.55
    : 1.25;
  const targets = [
    ...arena.fighters.filter((fighter) => fighter !== attacker).map((fighter) => ({ rb: fighter.rb, kind: "bot", fighter })),
    ...arena.props.map((prop) => ({ rb: prop.rb, kind: "prop", prop })),
  ];
  targets.forEach((target) => {
    const p = target.rb.translation();
    const toTarget = new THREE.Vector3(p.x - origin.x, 0, p.z - origin.z);
    const localForward = toTarget.dot(forward);
    const localRight = toTarget.dot(right);
    const localVertical = p.y - origin.y;
    const delta = new THREE.Vector3(p.x - hitOrigin.x, 0, p.z - hitOrigin.z);
    const distance = delta.length();
    const broncoUnderFlip = broncoUnderFlipContact(attacker, target, localForward, localRight, localVertical, forward, right);
    if (broncoUnderFlip) {
      if (!canApplyWeaponHit(attacker, target)) return;
      applyBroncoUnderFlip(attacker, target, forward, right, broncoUnderFlip);
      if (target.fighter) {
        recordBotDamage(target.fighter, {
          amount: 12.5,
          point: broncoUnderFlip.point,
          normal: forward.clone().negate(),
          kind: "flipper",
          source: attacker,
        });
      }
      return;
    }
    if (distance > (isFlipper || isCrusher ? 1.6 : spinnerReach)) return;
    const facing = delta.lengthSq() > 0.0001 ? delta.normalize().dot(forward) : 1;
    if (facing < -0.2) return;
    const side = delta.lengthSq() > 0.0001 ? delta : forward;
    const strength = target.kind === "bot" ? 1 : 0.55;
    const weightedStrength = strength * momentumScale(attacker, target) * effectiveness;
    if (isFlipper) {
      if (!canApplyWeaponHit(attacker, target)) return;
      markFighterUnstable(attacker, 1.4);
      if (target.fighter) markFighterUnstable(target.fighter, 1.6);
      target.rb.applyImpulse({
        x: side.x * BRONCO_FLIPPER_FORWARD_IMPULSE * weightedStrength,
        y: BRONCO_FLIPPER_LIFT_IMPULSE * weightedStrength,
        z: side.z * BRONCO_FLIPPER_FORWARD_IMPULSE * weightedStrength,
      }, true);
      target.rb.applyTorqueImpulse({
        x: BRONCO_FLIPPER_ROLL_TORQUE * 0.42 * weightedStrength,
        y: 0.25,
        z: -BRONCO_FLIPPER_ROLL_TORQUE * 0.38 * weightedStrength,
      }, true);
      if (target.fighter) {
        recordBotDamage(target.fighter, {
          amount: 12.5 * weightedStrength,
          point: new THREE.Vector3(p.x, p.y + 0.25, p.z),
          normal: side.clone().negate(),
          kind: "flipper",
          source: attacker,
        });
      }
      recordBotDamage(attacker, {
        amount: 1.75 * weightedStrength,
        point: hitOrigin,
        normal: side,
        kind: "flipperRecoil",
        source: target.fighter || target.prop || null,
      });
    } else if (isSpinner) {
      if (!canApplyWeaponHit(attacker, target)) return;
      markFighterUnstable(attacker, 1.2);
      if (target.fighter) markFighterUnstable(target.fighter, 1.8);
      const inertiaType = attacker.spec?.weaponRotationalInertiaType || "vertical-front";
      const biases = weaponInertiaBiases(inertiaType);
      const energy = spinnerEnergy(attacker);
      const energyScale = THREE.MathUtils.clamp(Math.sqrt(energy) / 10, 0.22, 3.15);
      const hitImpulse = weightedStrength * spinnerPower * energyScale * spinnerSpeedPowerMultiplier(attacker);
      const kickback = hitImpulse * WEAPON_KICKBACK_SCALE * biases.kickback;
      const targetImpulseScale = attacker.spec?.spinnerTargetImpulseScale ?? SPINNER_TARGET_IMPULSE_SCALE;
      const attackerKickbackScale = attacker.spec?.spinnerKickbackScale ?? 1;
      const targetLiftScale = attacker.spec?.spinnerTargetLiftScale ?? SPINNER_TARGET_LIFT_SCALE;
      const attackerMass = rigidBodyMass(attacker.rb, 1);
      const receiverMass = rigidBodyMass(target.rb, attackerMass);
      const massStability = THREE.MathUtils.clamp(attackerMass / Math.max(1, receiverMass), 0.45, 1.35);
      const isDamageDebrisTarget = target.prop?.kind === "botDamagePiece";
      const debrisImpulseScale = isDamageDebrisTarget ? 0.72 : 1;
      const debrisLiftScale = isDamageDebrisTarget ? 0.55 : 1;
      const debrisTorqueScale = isDamageDebrisTarget ? 0.22 : 1;
      const targetRadius = target.fighter ? Math.max(0.35, horizontalBodyRadius(target.fighter) * 0.82) : Math.max(0.35, target.prop?.radius || 1);
      const targetContactPoint = new THREE.Vector3(p.x, p.y + 0.35, p.z).addScaledVector(side, -targetRadius);
      const plow = spinnerPlowDefence(attacker, target, targetContactPoint);
      const hitDirection = spinnerHitDirection(attacker, side);
      const pushHitImpulse = hitImpulse * plow.pushFactor;
      const liftHitImpulse = hitImpulse * plow.liftFactor;
      const torqueHitImpulse = hitImpulse * plow.torqueFactor;
      const damageHitImpulse = hitImpulse * plow.damageFactor;
      const reflectionKickback = kickback * plow.pushFactor * plow.attackerReflectionBoost;
      target.rb.applyImpulse({
        x: hitDirection.x * 1.65 * pushHitImpulse * targetImpulseScale * debrisImpulseScale,
        y: 0.36 * biases.lift * liftHitImpulse * targetLiftScale * debrisLiftScale,
        z: hitDirection.z * 1.65 * pushHitImpulse * targetImpulseScale * debrisImpulseScale,
      }, true);
      target.rb.applyTorqueImpulse({
        x: 0.75 * biases.pitch * torqueHitImpulse * SPINNER_TARGET_TORQUE_SCALE * debrisTorqueScale,
        y: 1.45 * biases.yaw * torqueHitImpulse * SPINNER_TARGET_TORQUE_SCALE * debrisTorqueScale,
        z: -0.75 * biases.pitch * torqueHitImpulse * SPINNER_TARGET_TORQUE_SCALE * debrisTorqueScale,
      }, true);
      if (isDamageDebrisTarget) keepDamageDebrisInArena(target.prop);
      attacker.rb.applyImpulse({
        x: -hitDirection.x * reflectionKickback * attackerKickbackScale / massStability,
        y: -0.05 * biases.lift * kickback * plow.liftFactor * attackerKickbackScale / massStability,
        z: -hitDirection.z * reflectionKickback * attackerKickbackScale / massStability,
      }, true);
      attacker.rb.applyTorqueImpulse({
        x: -0.42 * biases.pitch * kickback * plow.torqueFactor * SPINNER_ATTACKER_TORQUE_SCALE * attackerKickbackScale,
        y: -0.78 * biases.yaw * reflectionKickback * SPINNER_ATTACKER_TORQUE_SCALE * attackerKickbackScale,
        z: 0.42 * biases.pitch * kickback * plow.torqueFactor * SPINNER_ATTACKER_TORQUE_SCALE * attackerKickbackScale,
      }, true);
      const weightRatio = THREE.MathUtils.clamp(targetWeight(target) / Math.max(1, attacker.spec?.weaponWeightLbs || MOMENTUM_REFERENCE_WEIGHT_LBS), 0.35, 2.5);
      drainSpinnerEnergy(attacker, WEAPON_SPIN_LOSS_SCALE * weightRatio * Math.min(1.2, damageHitImpulse / Math.max(0.4, weightedStrength)));
      const hapticHit = THREE.MathUtils.clamp(damageHitImpulse / 4.5, 0.18, 1);
      const heavySpinnerHit = attacker.spec?.id === "minotaur" || attacker.spec?.id === "tombstone";
      if (target.fighter) {
        const targetWeaponHit = fighterPartsAtWorldPoint(target.fighter, targetContactPoint).some((part) => part.part === "weapon");
        recordBotDamage(target.fighter, {
            amount: damageHitImpulse * 3.2,
            point: targetContactPoint,
            normal: hitDirection.clone().negate(),
            kind: "spinner",
            source: attacker,
          directWeaponHit: targetWeaponHit,
        });
      }
      recordBotDamage(attacker, {
        amount: damageHitImpulse * 0.65,
        point: hitOrigin,
        normal: hitDirection,
        kind: "weaponRecoil",
        source: target.fighter || target.prop || null,
      });
      if (!isDamageDebrisTarget) spawnSparks(targetContactPoint, 24 + Math.round(hapticHit * 18));
      triggerFighterHaptic(attacker, "collision", {
        duration: heavySpinnerHit ? 300 : 150 + hapticHit * 110,
        strong: heavySpinnerHit ? 1 : 0.82 + hapticHit * 0.18,
        weak: heavySpinnerHit ? 1 : 0.72 + hapticHit * 0.28,
      });
      triggerFighterHaptic(target.fighter, "collision", {
        duration: heavySpinnerHit ? 320 : 150 + hapticHit * 130,
        strong: heavySpinnerHit ? 1 : 0.86 + hapticHit * 0.14,
        weak: heavySpinnerHit ? 1 : 0.76 + hapticHit * 0.24,
      });
      if (attacker.spec?.id === "huge" && target.prop?.breakable && spinnerSpeed >= spinnerBreakSpeed) {
        addChairStress(target.prop, 0.85 * spinnerPower * momentumScale(attacker, target, 0.8), side.clone().multiplyScalar(1.6 * damageHitImpulse));
        spawnSparks(targetContactPoint, 22);
      }
    } else if (isCrusher && target.fighter) {
      markFighterUnstable(attacker, 1.05);
      markFighterUnstable(target.fighter, 1.15);
      target.rb.applyImpulse({ x: side.x * 0.08 * weightedStrength, y: 0.025 * weightedStrength, z: side.z * 0.08 * weightedStrength }, true);
      attacker.rb.applyImpulse({ x: -side.x * 0.035 * weightedStrength, y: 0, z: -side.z * 0.035 * weightedStrength }, true);
      const targetRadius = Math.max(0.35, horizontalBodyRadius(target.fighter) * 0.82);
      const targetBitePoint = new THREE.Vector3(p.x, p.y + 0.28, p.z).addScaledVector(side, -targetRadius);
      recordCrusherBiteDamage(attacker, target, targetBitePoint, side.clone().negate(), dt);
    } else if (isCrusher && target.prop?.breakable) {
      markFighterUnstable(attacker, 1.2);
      target.prop.jawPressure = (target.prop.jawPressure || 0) + dt;
      target.rb.applyImpulse({ x: side.x * 0.24 * weightedStrength, y: 0.08 * weightedStrength, z: side.z * 0.24 * weightedStrength }, true);
      attacker.rb.applyImpulse({ x: -side.x * 0.06 * weightedStrength, y: 0, z: -side.z * 0.06 * weightedStrength }, true);
      if (target.prop.jawPressure > QUANTUM_CHAIR_BREAK_SECONDS) {
        addChairStress(target.prop, 1.05, side.clone().multiplyScalar(0.8));
        spawnSparks(new THREE.Vector3(p.x, p.y + 0.35, p.z), 14);
        triggerFighterHaptic(attacker, "collision", { duration: 210, strong: 0.9, weak: 0.82, priority: 0.92 });
      }
    }
  });
}

function clampArenaTarget() {
  if (mode !== "arena") return;
  orbitTarget.x = THREE.MathUtils.clamp(orbitTarget.x, -ARENA_HALF_WIDTH + 1.1, ARENA_HALF_WIDTH - 1.1);
  orbitTarget.y = THREE.MathUtils.clamp(orbitTarget.y, 0.25, ARENA_CEILING_HEIGHT - 1.2);
  orbitTarget.z = THREE.MathUtils.clamp(orbitTarget.z, -ARENA_HALF_LENGTH + 1.1, ARENA_HALF_LENGTH - 1.1);
}

function clampCameraInsideArena() {
  if (mode !== "arena") return;
  camera.position.x = THREE.MathUtils.clamp(camera.position.x, -ARENA_HALF_WIDTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_WIDTH + CAMERA_OUTSIDE_MARGIN);
  camera.position.y = THREE.MathUtils.clamp(camera.position.y, 0.75, ARENA_CEILING_HEIGHT - 0.5);
  camera.position.z = THREE.MathUtils.clamp(camera.position.z, -ARENA_HALF_LENGTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_LENGTH + CAMERA_OUTSIDE_MARGIN);
  const outsideX = Math.max(0, Math.abs(camera.position.x) - (ARENA_HALF_WIDTH - CAMERA_BOUND_PADDING));
  const outsideZ = Math.max(0, Math.abs(camera.position.z) - (ARENA_HALF_LENGTH - CAMERA_BOUND_PADDING));
  if (outsideX > outsideZ) {
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, -ARENA_HALF_LENGTH + CAMERA_BOUND_PADDING, ARENA_HALF_LENGTH - CAMERA_BOUND_PADDING);
  } else if (outsideZ > 0) {
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, -ARENA_HALF_WIDTH + CAMERA_BOUND_PADDING, ARENA_HALF_WIDTH - CAMERA_BOUND_PADDING);
  }
}

function syncArenaWallVisibility() {
  const wallMeshes = arena?.root?.userData?.wallMeshes;
  if (!wallMeshes) return;
  Object.values(wallMeshes).flat().forEach((mesh) => {
    mesh.visible = true;
  });
  if (mode !== "arena") return;
  let hiddenSide = null;
  if (camera.position.x < -ARENA_HALF_WIDTH + CAMERA_BOUND_PADDING) hiddenSide = "west";
  if (camera.position.x > ARENA_HALF_WIDTH - CAMERA_BOUND_PADDING) hiddenSide = "east";
  if (camera.position.z < -ARENA_HALF_LENGTH + CAMERA_BOUND_PADDING) hiddenSide = "north";
  if (camera.position.z > ARENA_HALF_LENGTH - CAMERA_BOUND_PADDING) hiddenSide = "south";
  wallMeshes[hiddenSide]?.forEach((mesh) => {
    mesh.visible = false;
  });
}

function dampAngle(current, target, lambda, dt) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * (1 - Math.exp(-lambda * dt));
}

function rotateAroundY(vector, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const x = vector.x * c - vector.z * s;
  const z = vector.x * s + vector.z * c;
  vector.x = x;
  vector.z = z;
  return vector;
}

function setCameraFov(nextFov) {
  if (Math.abs(camera.fov - nextFov) < 0.01) return;
  camera.fov = nextFov;
  camera.updateProjectionMatrix();
}

function fightIntroNumberConfig(key, fallback, min = 0) {
  return Math.max(min, Number(GAME_CONFIG.fightIntro?.[key] ?? fallback) || fallback);
}

function fightIntroPreviewOrbitSeconds() {
  return fightIntroNumberConfig("previewOrbitSeconds", 5, 0);
}

function fightIntroBeatSeconds() {
  return fightIntroNumberConfig("countdownBeatSeconds", 2, 0.1);
}

function fightIntroFinalCalloutSeconds() {
  return fightIntroNumberConfig("finalCalloutSeconds", 2, 0.1);
}

function fightIntroFinalReleaseProgress() {
  return THREE.MathUtils.clamp(Number(GAME_CONFIG.fightIntro?.finalCalloutReleaseProgress ?? 0.68) || 0.68, 0, 1);
}

function fightIntroMessageStartProgress() {
  return THREE.MathUtils.clamp(Number(GAME_CONFIG.fightIntro?.messageStartProgress ?? 0.3) || 0.3, 0, 0.95);
}

function fightIntroOrbitSpeed() {
  return fightIntroNumberConfig("orbitSpeed", 0.34, 0);
}

function setFightIntroMessage(message = "") {
  if (!fightIntroOverlay) return;
  if (fightIntroOverlay.textContent !== message && message) {
    fightIntroOverlay.style.animation = "none";
    fightIntroOverlay.offsetHeight;
    fightIntroOverlay.style.animation = "";
  }
  fightIntroOverlay.textContent = message;
  fightIntroOverlay.hidden = !message;
}

function endFightIntro({ startMatch = true } = {}) {
  fightIntro = null;
  document.body.dataset.fightIntro = "false";
  document.body.dataset.fightIntroPaused = "false";
  setFightIntroMessage("");
  if (startMatch && mode === "arena") setArenaPaused(false);
  if (mode === "arena" && !arena?.roundOver) music.play("battle");
}

function toggleFightIntroPaused() {
  if (!fightIntro || fightIntro.matchReleased) return false;
  const now = performance.now();
  fightIntro.userPaused = !fightIntro.userPaused;
  document.body.dataset.fightIntroPaused = String(fightIntro.userPaused);
  if (fightIntro.userPaused) {
    fightIntro.pausedAt = now;
    if (pauseOverlay) pauseOverlay.textContent = "Paused";
    return true;
  }
  if (fightIntro.pausedAt && fightIntro.startedAt !== null && fightIntro.phase === "beats") {
    fightIntro.startedAt += now - fightIntro.pausedAt;
  }
  fightIntro.pausedAt = 0;
  if (pauseOverlay) pauseOverlay.textContent = pauseOverlayText();
  return true;
}

function fightIntroFinalBeatStartOffset() {
  const beats = fightIntro?.beats || [];
  if (beats.length <= 1) return 0;
  return beats.slice(0, -1).reduce((total, beat) => total + (Number(beat.duration) || 0), 0);
}

function skipFightIntroToFinalBeat() {
  if (!fightIntro || fightIntro.phase !== "beats" || fightIntro.matchReleased) return false;
  const now = performance.now();
  fightIntro.startedAt = now - fightIntroFinalBeatStartOffset() * 1000;
  fightIntro.pausedAt = 0;
  fightIntro.userPaused = false;
  fightIntro.gameCameraSynced = false;
  document.body.dataset.fightIntroPaused = "false";
  if (pauseOverlay) pauseOverlay.textContent = pauseOverlayText();
  return true;
}

function arenaOrbitCameraPose(yaw = Math.PI / 2, pitch = 0.44, distance = 23.5) {
  const target = new THREE.Vector3(0, 1.05, 0);
  const position = new THREE.Vector3(
    target.x + Math.sin(yaw) * Math.cos(pitch) * distance,
    target.y + Math.sin(pitch) * distance,
    target.z + Math.cos(yaw) * Math.cos(pitch) * distance,
  );
  position.x = THREE.MathUtils.clamp(position.x, -ARENA_HALF_WIDTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_WIDTH + CAMERA_OUTSIDE_MARGIN);
  position.y = THREE.MathUtils.clamp(position.y, 1.1, ARENA_CEILING_HEIGHT - 0.5);
  position.z = THREE.MathUtils.clamp(position.z, -ARENA_HALF_LENGTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_LENGTH + CAMERA_OUTSIDE_MARGIN);
  return { position, target, fov: 60 };
}

function fighterIntroCameraPose(index = 0, distance = 5.2, height = 1.85, sideOffset = 1.25) {
  const fighter = arena?.fighters?.[index];
  if (!fighter?.rb) return null;
  const p = fighter.rb.translation();
  const r = fighter.rb.rotation();
  const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w), "YXZ").y;
  const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(index === 0 ? sideOffset : -sideOffset);
  const target = new THREE.Vector3(p.x, p.y + 0.55, p.z).addScaledVector(forward, -0.35);
  const position = target.clone()
    .addScaledVector(forward, distance)
    .add(side)
    .add(new THREE.Vector3(0, height, 0));
  position.x = THREE.MathUtils.clamp(position.x, -ARENA_HALF_WIDTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_WIDTH + CAMERA_OUTSIDE_MARGIN);
  position.y = THREE.MathUtils.clamp(position.y, 1.0, ARENA_CEILING_HEIGHT - 0.5);
  position.z = THREE.MathUtils.clamp(position.z, -ARENA_HALF_LENGTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_LENGTH + CAMERA_OUTSIDE_MARGIN);
  target.x = THREE.MathUtils.clamp(target.x, -ARENA_HALF_WIDTH + 0.8, ARENA_HALF_WIDTH - 0.8);
  target.z = THREE.MathUtils.clamp(target.z, -ARENA_HALF_LENGTH + 0.8, ARENA_HALF_LENGTH - 0.8);
  return { position, target, fov: 46 };
}

function battleIntroCameraPose(distanceBoost = 1.2, heightBoost = 0.55, fovBoost = 2) {
  const pose = currentBattleCameraPose();
  if (!pose) return null;
  const direction = pose.position.clone().sub(pose.target).normalize();
  return {
    position: pose.position.clone().addScaledVector(direction, distanceBoost).add(new THREE.Vector3(0, heightBoost, 0)),
    target: pose.target.clone(),
    fov: pose.fov + fovBoost,
  };
}

function fightIntroCloseupZoomDistance() {
  return 1.4;
}

function fightIntroWideZoomDistance() {
  return 2.0;
}

function zoomBeatPose(basePose, progress = 0, zoomDistance = 0.75) {
  if (!basePose) return null;
  const direction = basePose.position.clone().sub(basePose.target).normalize();
  return {
    position: basePose.position.clone().addScaledVector(direction, zoomDistance * (1 - progress)),
    target: basePose.target.clone(),
    fov: basePose.fov,
  };
}

function zoomOutBeatPose(basePose, progress = 0, zoomDistance = 1.0) {
  if (!basePose) return null;
  const direction = basePose.position.clone().sub(basePose.target).normalize();
  return {
    position: basePose.position.clone().addScaledVector(direction, -zoomDistance * (1 - progress)),
    target: basePose.target.clone(),
    fov: basePose.fov,
  };
}

function applyFightIntroPose(pose) {
  if (!pose) return false;
  setCameraFov(pose.fov);
  camera.position.copy(pose.position);
  camera.lookAt(pose.target);
  return true;
}

function firstCountdownIntroPose() {
  return zoomBeatPose(fighterIntroCameraPose(0), 0, fightIntroCloseupZoomDistance());
}

function warmIntroGameArenaOffscreen() {
  const pose = firstCountdownIntroPose();
  if (!pose) return false;
  fightIntroWarmRenderTarget ||= new THREE.WebGLRenderTarget(2, 2, { depthBuffer: true, stencilBuffer: false });
  const previousTarget = renderer.getRenderTarget();
  const previousPosition = camera.position.clone();
  const previousQuaternion = camera.quaternion.clone();
  const previousFov = camera.fov;
  const previousAutoClear = renderer.autoClear;
  try {
    applyFightIntroPose(pose);
    renderer.compile(scene, camera);
    renderer.setRenderTarget(fightIntroWarmRenderTarget);
    renderer.autoClear = true;
    renderer.clear();
    renderer.render(scene, camera);
    return true;
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;
    camera.position.copy(previousPosition);
    camera.quaternion.copy(previousQuaternion);
    setCameraFov(previousFov);
  }
}

function syncGameCameraToPose(pose) {
  if (!pose) return;
  const selectedMode = cameraModeSelect?.value || "bot";
  camera.position.copy(pose.position);
  camera.lookAt(pose.target);
  setCameraFov(pose.fov);
  if (selectedMode === "bot") {
    const player = arena?.fighters?.[localArenaFighterIndex()];
    const r = player?.rb?.rotation?.();
    if (r) {
      const bodyYaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w), "YXZ").y;
      followCameraYaw = bodyYaw + followCameraYawOffset;
    }
    followCameraNeedsSnap = true;
    return;
  }
  if (selectedMode === "battle") {
    battleCameraPosition.copy(pose.position);
    battleCameraTarget.copy(pose.target);
    return;
  }
  orbitTarget.copy(pose.target);
}

function currentThirdPersonCameraPose() {
  const player = arena?.fighters?.[localArenaFighterIndex()];
  if (!player?.rb) return null;
  const p = player.rb.translation();
  const r = player.rb.rotation();
  const bodyYaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w), "YXZ").y;
  const distance = pairedRangeNumberValue(cameraDistanceInput, cameraDistanceNumberInput, GAME_CONFIG.ui.cameraDistance);
  const height = THREE.MathUtils.clamp(
    pairedRangeNumberValue(cameraHeightInput, cameraHeightNumberInput, GAME_CONFIG.ui.cameraHeight) + followCameraPitchOffset,
    Number(cameraHeightInput?.min || 0.8),
    Number(cameraHeightInput?.max || 8),
  );
  const target = new THREE.Vector3(p.x, p.y + 0.42, p.z);
  target.x = THREE.MathUtils.clamp(target.x, -ARENA_HALF_WIDTH + 1, ARENA_HALF_WIDTH - 1);
  target.z = THREE.MathUtils.clamp(target.z, -ARENA_HALF_LENGTH + 1, ARENA_HALF_LENGTH - 1);
  const yaw = bodyYaw + followCameraYawOffset;
  const backOffset = new THREE.Vector3(Math.sin(yaw) * distance, 0, Math.cos(yaw) * distance);
  const position = new THREE.Vector3(target.x + backOffset.x, target.y + height, target.z + backOffset.z);
  position.x = THREE.MathUtils.clamp(position.x, -ARENA_HALF_WIDTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_WIDTH + CAMERA_OUTSIDE_MARGIN);
  position.y = THREE.MathUtils.clamp(position.y, 0.75, ARENA_CEILING_HEIGHT - 0.5);
  position.z = THREE.MathUtils.clamp(position.z, -ARENA_HALF_LENGTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_LENGTH + CAMERA_OUTSIDE_MARGIN);
  return { position, target, fov: 60 };
}

function currentBattleCameraPose() {
  const player = arena?.fighters?.[0];
  const rival = arena?.fighters?.[1];
  if (!player?.rb || !rival?.rb) return null;
  const a = player.rb.translation();
  const b = rival.rb.translation();
  const p1 = new THREE.Vector3(a.x, a.y, a.z);
  const p2 = new THREE.Vector3(b.x, b.y, b.z);
  const midpoint = p1.clone().add(p2).multiplyScalar(0.5);
  const separation = p2.clone().sub(p1).length();
  const viewSide = new THREE.Vector3(1, 0, 0);
  rotateAroundY(viewSide, battleCameraYawOffset);
  const target = midpoint.clone().add(battleCameraPanOffset);
  target.y = THREE.MathUtils.clamp(Math.max(a.y, b.y) + 0.62, 0.85, ARENA_CEILING_HEIGHT - 1.8);
  target.x = THREE.MathUtils.clamp(target.x, -ARENA_HALF_WIDTH + 1.4, ARENA_HALF_WIDTH - 1.4);
  target.z = THREE.MathUtils.clamp(target.z, -ARENA_HALF_LENGTH + 1.4, ARENA_HALF_LENGTH - 1.4);
  const distance = THREE.MathUtils.clamp(5.6 + separation * 0.46 + battleCameraDistanceOffset, 5.2, 23.5);
  const height = THREE.MathUtils.clamp(3.0 + separation * 0.13 + battleCameraPitchOffset, 3.0, 6.2);
  const position = target.clone().addScaledVector(viewSide, distance);
  position.y = target.y + height;
  position.x = THREE.MathUtils.clamp(position.x, -ARENA_HALF_WIDTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_WIDTH + CAMERA_OUTSIDE_MARGIN);
  position.y = THREE.MathUtils.clamp(position.y, 1.1, ARENA_CEILING_HEIGHT - 0.5);
  position.z = THREE.MathUtils.clamp(position.z, -ARENA_HALF_LENGTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_LENGTH + CAMERA_OUTSIDE_MARGIN);
  const outsideX = Math.max(0, Math.abs(position.x) - (ARENA_HALF_WIDTH - CAMERA_BOUND_PADDING));
  const outsideZ = Math.max(0, Math.abs(position.z) - (ARENA_HALF_LENGTH - CAMERA_BOUND_PADDING));
  if (outsideX > outsideZ) {
    position.z = THREE.MathUtils.clamp(position.z, -ARENA_HALF_LENGTH + CAMERA_BOUND_PADDING, ARENA_HALF_LENGTH - CAMERA_BOUND_PADDING);
  } else if (outsideZ > 0) {
    position.x = THREE.MathUtils.clamp(position.x, -ARENA_HALF_WIDTH + CAMERA_BOUND_PADDING, ARENA_HALF_WIDTH - CAMERA_BOUND_PADDING);
  }
  return { position, target, fov: THREE.MathUtils.clamp(50 + separation * 2.1, 52, 90) };
}

function currentSelectedArenaCameraPose() {
  const selectedMode = cameraModeSelect?.value || "bot";
  if (selectedMode === "battle") return currentBattleCameraPose();
  if (selectedMode === "bot") return currentThirdPersonCameraPose();
  const distance = Number.isFinite(orbitDistance) ? orbitDistance : 18.4;
  const target = orbitTarget.clone();
  const position = new THREE.Vector3(
    target.x + Math.sin(orbitYaw) * Math.cos(orbitPitch) * distance,
    target.y + Math.sin(orbitPitch) * distance,
    target.z + Math.cos(orbitYaw) * Math.cos(orbitPitch) * distance,
  );
  position.x = THREE.MathUtils.clamp(position.x, -ARENA_HALF_WIDTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_WIDTH + CAMERA_OUTSIDE_MARGIN);
  position.y = THREE.MathUtils.clamp(position.y, 0.75, ARENA_CEILING_HEIGHT - 0.5);
  position.z = THREE.MathUtils.clamp(position.z, -ARENA_HALF_LENGTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_LENGTH + CAMERA_OUTSIDE_MARGIN);
  return { position, target, fov: pairedRangeNumberValue(arenaFovInput, arenaFovNumberInput, GAME_CONFIG.ui.arenaFov) };
}

function beginEmptyArenaIntro() {
  const startedAt = performance.now();
  fightIntro = {
    phase: "empty",
    startedAt,
    userPaused: false,
    pausedAt: 0,
    yaw: Math.PI * 0.72,
  };
  setArenaPaused(true, { publish: false, autoExpandPanel: false });
  document.body.dataset.fightIntro = "true";
  document.body.dataset.fightIntroPaused = "false";
  setFightIntroMessage("");
}

function beginFightCountdownIntro() {
  const playerPose = fighterIntroCameraPose(0);
  const rivalPose = fighterIntroCameraPose(1);
  const bothPose = battleIntroCameraPose();
  const finalPose = currentSelectedArenaCameraPose();
  if (!playerPose || !rivalPose || !bothPose || !finalPose) {
    endFightIntro();
    return;
  }
  fightIntro = {
    phase: "beats",
    startedAt: null,
    gameCameraSynced: false,
    matchReleased: false,
    userPaused: fightIntro?.userPaused || false,
    pausedAt: fightIntro?.userPaused ? performance.now() : 0,
    beats: [
      { message: "3", duration: fightIntroBeatSeconds(), poseAt: (progress) => zoomBeatPose(playerPose, progress, fightIntroCloseupZoomDistance()) },
      { message: "2", duration: fightIntroBeatSeconds(), poseAt: (progress) => zoomBeatPose(rivalPose, progress, fightIntroCloseupZoomDistance()) },
      { message: "1", duration: fightIntroBeatSeconds(), poseAt: (progress) => zoomOutBeatPose(bothPose, progress, fightIntroWideZoomDistance()) },
      { message: "it's robot fighting time!", duration: fightIntroFinalCalloutSeconds(), gamePose: finalPose, useGameCamera: true, releaseMatch: true },
    ],
  };
  setArenaPaused(true, { publish: false, autoExpandPanel: false });
  music.play("countdown", { loop: false });
  document.body.dataset.fightIntro = "true";
  document.body.dataset.fightIntroPaused = String(fightIntro.userPaused);
}

function updateFightIntroCamera() {
  if (mode !== "arena" || !fightIntro) return false;
  const now = performance.now();
  if (fightIntro.phase === "empty") {
    const elapsed = (now - fightIntro.startedAt) / 1000;
    const pose = arenaOrbitCameraPose(fightIntro.yaw + elapsed * fightIntroOrbitSpeed(), 0.42, 23.5);
    fightIntro.currentTarget = pose.target;
    setCameraFov(pose.fov);
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    return true;
  }
  if (fightIntro.startedAt === null) fightIntro.startedAt = now;
  if (fightIntro.userPaused) {
    if (!fightIntro.pausedAt) fightIntro.pausedAt = now;
    return true;
  }
  const elapsed = (now - fightIntro.startedAt) / 1000;
  const beats = fightIntro.beats || [];
  let cursor = 0;
  for (const beat of beats) {
    const nextCursor = cursor + beat.duration;
    if (elapsed < nextCursor) {
      const progress = THREE.MathUtils.clamp((elapsed - cursor) / beat.duration, 0, 1);
      const eased = progress * progress * (3 - 2 * progress);
      const messageProgress = fightIntroMessageStartProgress();
      const showBeatMessage = progress >= messageProgress;
      const messageDuration = beat.duration * Math.max(0.05, 1 - messageProgress);
      if (beat.useGameCamera) {
        if (!fightIntro.gameCameraSynced) {
          fightIntro.gameCameraSynced = true;
          syncGameCameraToPose(beat.gamePose);
        }
        fightIntroOverlay?.style.setProperty("--fight-intro-beat-seconds", `${messageDuration}s`);
        setFightIntroMessage(showBeatMessage ? beat.message : "");
        if (beat.releaseMatch && !fightIntro.matchReleased && progress >= fightIntroFinalReleaseProgress()) {
          fightIntro.matchReleased = true;
          setArenaPaused(false);
        }
        return false;
      }
      const pose = beat.poseAt?.(eased);
      applyFightIntroPose(pose);
      fightIntroOverlay?.style.setProperty("--fight-intro-beat-seconds", `${messageDuration}s`);
      setFightIntroMessage(showBeatMessage ? beat.message : "");
      if (beat.releaseMatch && !fightIntro.matchReleased && progress >= fightIntroFinalReleaseProgress()) {
        fightIntro.matchReleased = true;
        setArenaPaused(false);
      }
      if (beat.releaseMatch && pose) {
        followCameraPosition.copy(pose.position);
        followCameraTarget.copy(pose.target);
        battleCameraPosition.copy(pose.position);
        battleCameraTarget.copy(pose.target);
        followCameraNeedsSnap = false;
      }
      return true;
    }
    cursor = nextCursor;
  }
  const finalBeat = beats[beats.length - 1];
  const finalPose = finalBeat?.gamePose || finalBeat?.poseAt?.(1);
  if (finalPose) {
    followCameraPosition.copy(finalPose.position);
    followCameraTarget.copy(finalPose.target);
    battleCameraPosition.copy(finalPose.position);
    battleCameraTarget.copy(finalPose.target);
    followCameraNeedsSnap = false;
  }
  endFightIntro({ startMatch: !fightIntro.matchReleased });
  return true;
}

function updateThirdPersonCamera(dt) {
  const player = arena?.fighters?.[localArenaFighterIndex()];
  if (!player?.rb) return false;
  const p = player.rb.translation();
  const r = player.rb.rotation();
  const bodyYaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w), "YXZ").y;
  const targetYaw = bodyYaw + followCameraYawOffset;
  followCameraYaw = dampAngle(followCameraYaw, targetYaw, 3.2, dt);
  const distance = pairedRangeNumberValue(cameraDistanceInput, cameraDistanceNumberInput, GAME_CONFIG.ui.cameraDistance);
  const height = THREE.MathUtils.clamp(
    pairedRangeNumberValue(cameraHeightInput, cameraHeightNumberInput, GAME_CONFIG.ui.cameraHeight) + followCameraPitchOffset,
    Number(cameraHeightInput?.min || 0.8),
    Number(cameraHeightInput?.max || 8),
  );
  const desiredTarget = new THREE.Vector3(p.x, p.y + 0.42, p.z);
  desiredTarget.x = THREE.MathUtils.clamp(desiredTarget.x, -ARENA_HALF_WIDTH + 1, ARENA_HALF_WIDTH - 1);
  desiredTarget.z = THREE.MathUtils.clamp(desiredTarget.z, -ARENA_HALF_LENGTH + 1, ARENA_HALF_LENGTH - 1);

  const backOffset = new THREE.Vector3(Math.sin(followCameraYaw) * distance, 0, Math.cos(followCameraYaw) * distance);
  const desiredPosition = new THREE.Vector3(
    desiredTarget.x + backOffset.x,
    desiredTarget.y + height,
    desiredTarget.z + backOffset.z,
  );
  desiredPosition.x = THREE.MathUtils.clamp(desiredPosition.x, -ARENA_HALF_WIDTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_WIDTH + CAMERA_OUTSIDE_MARGIN);
  desiredPosition.y = THREE.MathUtils.clamp(desiredPosition.y, 0.75, ARENA_CEILING_HEIGHT - 0.5);
  desiredPosition.z = THREE.MathUtils.clamp(desiredPosition.z, -ARENA_HALF_LENGTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_LENGTH + CAMERA_OUTSIDE_MARGIN);

  if (followCameraNeedsSnap) {
    followCameraPosition.copy(desiredPosition);
    followCameraTarget.copy(desiredTarget);
    followCameraNeedsSnap = false;
  }

  const blend = 1 - Math.exp(-dt * 9);
  followCameraPosition.lerp(desiredPosition, blend);
  followCameraTarget.lerp(desiredTarget, blend);
  camera.position.copy(followCameraPosition);
  camera.lookAt(followCameraTarget);
  return true;
}

function updateBattleCamera(dt) {
  const player = arena?.fighters?.[0];
  const rival = arena?.fighters?.[1];
  if (!player?.rb || !rival?.rb) return false;
  const a = player.rb.translation();
  const b = rival.rb.translation();
  const p1 = new THREE.Vector3(a.x, a.y, a.z);
  const p2 = new THREE.Vector3(b.x, b.y, b.z);
  const midpoint = p1.clone().add(p2).multiplyScalar(0.5);
  const between = p2.clone().sub(p1);
  const separation = between.length();
  const viewSide = new THREE.Vector3(1, 0, 0);
  rotateAroundY(viewSide, battleCameraYawOffset);
  const target = midpoint.clone().add(battleCameraPanOffset);
  target.y = THREE.MathUtils.clamp(Math.max(a.y, b.y) + 0.62, 0.85, ARENA_CEILING_HEIGHT - 1.8);
  target.x = THREE.MathUtils.clamp(target.x, -ARENA_HALF_WIDTH + 1.4, ARENA_HALF_WIDTH - 1.4);
  target.z = THREE.MathUtils.clamp(target.z, -ARENA_HALF_LENGTH + 1.4, ARENA_HALF_LENGTH - 1.4);

  const distance = THREE.MathUtils.clamp(5.6 + separation * 0.46 + battleCameraDistanceOffset, 5.2, 23.5);
  const height = THREE.MathUtils.clamp(3.0 + separation * 0.13 + battleCameraPitchOffset, 3.0, 6.2);
  const desiredPosition = target.clone().addScaledVector(viewSide, distance);
  desiredPosition.y = target.y + height;
  desiredPosition.x = THREE.MathUtils.clamp(desiredPosition.x, -ARENA_HALF_WIDTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_WIDTH + CAMERA_OUTSIDE_MARGIN);
  desiredPosition.y = THREE.MathUtils.clamp(desiredPosition.y, 1.1, ARENA_CEILING_HEIGHT - 0.5);
  desiredPosition.z = THREE.MathUtils.clamp(desiredPosition.z, -ARENA_HALF_LENGTH - CAMERA_OUTSIDE_MARGIN, ARENA_HALF_LENGTH + CAMERA_OUTSIDE_MARGIN);
  const outsideX = Math.max(0, Math.abs(desiredPosition.x) - (ARENA_HALF_WIDTH - CAMERA_BOUND_PADDING));
  const outsideZ = Math.max(0, Math.abs(desiredPosition.z) - (ARENA_HALF_LENGTH - CAMERA_BOUND_PADDING));
  if (outsideX > outsideZ) {
    desiredPosition.z = THREE.MathUtils.clamp(desiredPosition.z, -ARENA_HALF_LENGTH + CAMERA_BOUND_PADDING, ARENA_HALF_LENGTH - CAMERA_BOUND_PADDING);
  } else if (outsideZ > 0) {
    desiredPosition.x = THREE.MathUtils.clamp(desiredPosition.x, -ARENA_HALF_WIDTH + CAMERA_BOUND_PADDING, ARENA_HALF_WIDTH - CAMERA_BOUND_PADDING);
  }

  const blend = 1 - Math.exp(-dt * 5.2);
  setCameraFov(THREE.MathUtils.clamp(50 + separation * 2.1, 52, 90));
  battleCameraPosition.lerp(desiredPosition, blend);
  battleCameraTarget.lerp(target, blend);
  if (!mouseDown && performance.now() - lastCameraInputAt > 3000) {
    const settle = 1 - Math.exp(-dt * 1.2);
    battleCameraYawOffset = THREE.MathUtils.damp(battleCameraYawOffset, 0, 1.2, dt);
    battleCameraPitchOffset = THREE.MathUtils.damp(battleCameraPitchOffset, 0, 1.2, dt);
    battleCameraDistanceOffset = THREE.MathUtils.damp(battleCameraDistanceOffset, 0, 1.2, dt);
    battleCameraPanOffset.multiplyScalar(1 - settle);
  }
  camera.position.copy(battleCameraPosition);
  camera.lookAt(battleCameraTarget);
  return true;
}

function setDefaultArenaOrbit() {
  orbitTarget.set(0, 0.85, 0);
  orbitYaw = Math.PI / 2;
  orbitPitch = 0.4;
  orbitDistance = 18.4;
}

function updateOrbitCamera() {
  const target = orbitTarget;
  clampArenaTarget();
  const dist = orbitDistance;
  const yaw = orbitYaw;
  const pitch = orbitPitch;
  camera.position.set(
    target.x + Math.sin(yaw) * Math.cos(pitch) * dist,
    target.y + Math.sin(pitch) * dist,
    target.z + Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  clampCameraInsideArena();
  if (mode === "viewer" && camera.position.y < 0.32) camera.position.y = 0.32;
  camera.lookAt(target);
}

function dollyArenaOrbit(deltaY) {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  const distanceScale = THREE.MathUtils.clamp(orbitDistance, 4, 18);
  const step = -deltaY * ARENA_WHEEL_DOLLY_SPEED * distanceScale;
  const yaw = orbitYaw;
  const pitch = orbitPitch;
  const cameraOffset = new THREE.Vector3(
    Math.sin(yaw) * Math.cos(pitch) * orbitDistance,
    Math.sin(pitch) * orbitDistance,
    Math.cos(yaw) * Math.cos(pitch) * orbitDistance,
  );
  camera.position.addScaledVector(forward, step);
  clampCameraInsideArena();
  orbitTarget.copy(camera.position).sub(cameraOffset);
  clampArenaTarget();
}

function updateCamera(dt) {
  if (updateFightIntroCamera()) {
    syncArenaWallVisibility();
    return;
  }
  if (mode === "arena" && cameraModeSelect?.value !== "battle") {
    setCameraFov(cameraModeSelect?.value === "arena" ? pairedRangeNumberValue(arenaFovInput, arenaFovNumberInput, GAME_CONFIG.ui.arenaFov) : 60);
  }
  if (mode !== "arena") setCameraFov(48);
  if (mode === "arena") {
    if (cameraModeSelect?.value === "battle" && updateBattleCamera(dt)) {
      syncArenaWallVisibility();
      return;
    }
    if ((cameraModeSelect?.value || "bot") === "bot" && updateThirdPersonCamera(dt)) {
      syncArenaWallVisibility();
      return;
    }
  }
  updateOrbitCamera();
  syncArenaWallVisibility();
}

function applyRenderMode() {
  const arenaMode = mode === "arena";
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, arenaMode ? 1.25 : 2));
  renderer.shadowMap.enabled = true;
  keyLight.castShadow = true;
}

function updateSceneLayout() {
  const panelRect = panel?.getBoundingClientRect();
  const mobilePanel = window.matchMedia("(max-width: 780px)").matches;
  const collapsed = document.body.classList.contains("panel-collapsed");
  const sceneRight = panelRect && !mobilePanel && !collapsed ? Math.ceil(panelRect.width + 20) : 0;
  document.documentElement.style.setProperty("--scene-right", `${sceneRight}px`);
  requestAnimationFrame(() => {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    applyRenderMode();
    renderer.setSize(width, height, false);
  });
}

function syncCameraControls() {
  document.body.dataset.cameraMode = cameraModeSelect?.value || "arena";
}

function syncBattleToggle() {
  if (!battleToggleButton) return;
  const inBattle = mode === "arena";
  battleToggleButton.textContent = inBattle ? "Stop Battle" : "Start Battle";
  battleToggleButton.classList.toggle("active", inBattle);
  battleToggleButton.setAttribute("aria-pressed", String(inBattle));
}

function pauseOverlayText() {
  if (arena?.roundOver) return `${arena.winnerText || "Round over"}\nPress any button to restart`;
  return arenaPaused && online.role === "host" && online.state === "waiting"
    ? ONLINE_WAITING_MESSAGE
    : "Paused";
}

function restartArenaMatch() {
  if (mode !== "arena") return false;
  if (online.role === "joiner") {
    onlineSetMessage("Only the host can reset an online arena");
    return false;
  }
  setArenaPaused(false);
  buildArena();
  return true;
}

function applyOnlinePauseState(paused, ownerClientId = null) {
  online.pauseOwnerClientId = paused ? ownerClientId : null;
  setArenaPaused(paused, { publish: false, autoExpandPanel: false });
}

function publishOnlinePauseState(paused) {
  if (!onlineIsActive() || !online.room || online.state !== "playing") return;
  online.pauseOwnerClientId = paused ? onlineClientId : null;
  transactOnlineRoom({ paused: Boolean(paused), pauseOwnerClientId: online.pauseOwnerClientId });
  online.room.publishTopic("pauseState", {
    clientId: onlineClientId,
    hostClientId: online.hostClientId,
    paused: Boolean(paused),
    sentAt: Date.now(),
  });
}

function setArenaPaused(paused, { publish = false, autoExpandPanel = true } = {}) {
  const wasPaused = arenaPaused;
  arenaPaused = paused;
  if (wasPaused !== arenaPaused) recordPhysicsLogEvent("pause", { paused: arenaPaused, publish: Boolean(publish) });
  document.body.dataset.paused = String(arenaPaused);
  if (pauseOverlay) {
    pauseOverlay.textContent = pauseOverlayText();
  }
  if (mode === "arena" && autoExpandPanel && arenaPaused && !wasPaused && document.body.classList.contains("panel-collapsed")) {
    panelAutoExpandedForPause = true;
    setPanelCollapsed(false);
  } else if (mode === "arena" && !arenaPaused && wasPaused && panelAutoExpandedForPause) {
    panelAutoExpandedForPause = false;
    setPanelCollapsed(true);
  } else if (!arenaPaused) {
    panelAutoExpandedForPause = false;
  }
  if (mode === "arena") controllerStatus.textContent = arenaPaused ? pauseOverlay?.textContent || "Arena paused" : onlineIsActive() ? online.message : "Controller waiting";
  if (publish && wasPaused !== arenaPaused) publishOnlinePauseState(arenaPaused);
}

function toggleArenaPaused() {
  if (mode !== "arena") return;
  if (arena?.roundOver) return;
  if (toggleFightIntroPaused()) return;
  setArenaPaused(!arenaPaused, { publish: onlineIsActive() });
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.033);
  if (mode === "viewer" && viewerBot) {
    const viewerInput = readViewerControls();
    if (viewerInput.pausePressed) {
      startArenaFromViewerIntro();
    } else if (!mouseDown) {
      orbitYaw -= viewerInput.orbitX * dt * 2.2;
      const pitchDirection = invertOrbitYInput?.checked ? 1 : -1;
      orbitPitch = THREE.MathUtils.clamp(orbitPitch + viewerInput.orbitY * pitchDirection * dt * 1.6, -0.18, 1.1);
    }
    if (mode === "viewer") {
      const weapon = viewerBot.userData.weapon;
      const viewerWeaponEdge = consumeWeaponPressEdge({ weapon }, viewerInput.weapon);
      const viewerWeaponActive = isImpulseWeapon(weapon) ? viewerWeaponEdge : viewerInput.weapon;
      updateWeapon({ weapon }, dt, viewerWeaponActive);
      updateDrivetrain({ userData: viewerBot.userData, spec: selected }, viewerInput, dt, viewerBot.scale.x);
    }
  }
  if (mode === "arena") {
    updateArena(dt);
    updatePhysicalDamagePreviewMeshes();
  }
  updateDamageEventHud();
  if (!arenaPaused) {
    arena?.hazards?.forEach((hazard, i) => {
      const speed = arenaNumber(hazard.userData.rotationSpeed, screwHazardRotationSpeed(ARENA_LAYOUT));
      const direction = i % 2 ? -1 : 1;
      if (hazard.userData.rotationAxis === "x") hazard.rotation.x += dt * speed;
      else {
        hazard.rotation.y += dt * speed * direction;
        hazard.rotation.z += dt * 1.5;
      }
    });
  }
  const lighting = pairedRangeNumberValue(lightingInput, lightingNumberInput, GAME_CONFIG.ui.lighting);
  hemi.intensity = 0.8 + lighting * 1.45;
  keyLight.intensity = 1.1 + lighting * 3.2;
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function setMode(next, { runIntro = false } = {}) {
  mode = next;
  if (mode !== "arena") music.stop({ fadeOut: 0.6 });
  if (mode !== "arena" && physicsLogRecorder.active) stopPhysicsLogRecording();
  document.body.dataset.mode = mode;
  syncArenaObjectControls();
  if (mode === "arena") setPanelCollapsed(true);
  syncCameraControls();
  modeButtons.forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  syncBattleToggle();
  if (mode === "viewer") {
    endFightIntro({ startMatch: false });
    setArenaPaused(false);
    applyRenderMode();
    floor.visible = true;
    orbitTarget.set(-1.2, 0.75, 0);
    orbitYaw = -0.55;
    orbitPitch = 0.28;
    orbitDistance = 7.6;
    showViewerBot();
    preloadArenaFighterModels({ foreground: false });
    warmBattleBoxArena();
    syncGlobalColliderOverlay();
  }
  if (mode === "arena") {
    setArenaPaused(false);
    applyRenderMode();
    floor.visible = false;
    if (cameraModeSelect && !cameraModeExplicitlySet) cameraModeSelect.value = defaultArenaCameraMode();
    syncCameraControls();
    setDefaultArenaOrbit();
    followCameraYawOffset = 0;
    followCameraPitchOffset = 0;
    followCameraYaw = orbitYaw;
    followCameraPosition.set(0, 3.2, 7);
    followCameraTarget.set(0, 0.8, 0);
    followCameraNeedsSnap = true;
    battleCameraPosition.set(0, 4.2, 9);
    battleCameraTarget.set(0, 0.9, 0);
    battleCameraYawOffset = 0;
    battleCameraPitchOffset = 0;
    battleCameraDistanceOffset = 0;
    battleCameraPanOffset.set(0, 0, 0);
    buildArena({ runIntro });
    syncGlobalColliderOverlay();
    syncDebugInfoControls();
  }
}

function setPanelCollapsed(collapsed) {
  document.body.classList.toggle("panel-collapsed", collapsed);
  if (panelToggle) {
    panelToggle.textContent = collapsed ? "‹" : "Hide";
    panelToggle.title = collapsed ? "Restore Bot Lab" : "Minimize Bot Lab";
    panelToggle.setAttribute("aria-label", collapsed ? "Restore Bot Lab" : "Minimize Bot Lab");
    panelToggle.setAttribute("aria-expanded", String(!collapsed));
  }
  updateSceneLayout();
  requestAnimationFrame(updateSceneLayout);
  window.setTimeout(updateSceneLayout, 220);
}

function syncFullscreenButton() {
  if (!fullscreenToggleButton) return;
  const active = Boolean(document.fullscreenElement);
  fullscreenToggleButton.textContent = active ? "Exit fullscreen" : "Fullscreen";
  fullscreenToggleButton.setAttribute("aria-pressed", String(active));
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen?.();
    else await document.documentElement.requestFullscreen?.();
  } catch {
    // Browsers may reject fullscreen outside a trusted gesture or in unsupported contexts.
  } finally {
    syncFullscreenButton();
    updateSceneLayout();
  }
}

function createBattleBotTestRig() {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFrame = () => {
    if (mode === "arena" && arena?.world) {
      const wasPaused = arenaPaused;
      arenaPaused = false;
      updateArena(FIXED_PHYSICS_DT);
      arenaPaused = wasPaused;
      return Promise.resolve();
    }
    return new Promise((resolve) => requestAnimationFrame(resolve));
  };
  const findBot = (id) => bots.find((bot) => bot.id === id);

  const waitFrames = async (count, onFrame = null) => {
    for (let frame = 0; frame < count; frame += 1) {
      await waitFrame();
      onFrame?.(frame);
    }
  };

  const waitForModels = async (ids, timeoutMs = 12000) => {
    const started = performance.now();
    while (!ids.every((id) => isBotModelReady(id))) {
      if (performance.now() - started > timeoutMs) return false;
      await wait(50);
    }
    return true;
  };

  const fighterState = (fighter) => {
    const p = fighter.rb.translation();
    const r = fighter.rb.rotation();
    const linvel = fighter.rb.linvel();
    const angvel = fighter.rb.angvel();
    const angularSpeed = Math.hypot(angvel.x, angvel.y, angvel.z);
    return {
      id: fighter.spec.id,
      position: { x: p.x, y: p.y, z: p.z },
      rotation: { x: r.x, y: r.y, z: r.z, w: r.w },
      linvel: { x: linvel.x, y: linvel.y, z: linvel.z },
      angvel: { x: angvel.x, y: angvel.y, z: angvel.z },
      angularSpeed,
      mass: rigidBodyMass(fighter.rb),
      upY: fighterUpVector(fighter).y,
      traction: physics.tractionForFighter(fighter),
      stableDrive: fighter.stableDrive ? {
        active: fighter.stableDrive.active,
        unstableUntil: fighter.stableDrive.unstableUntil,
      } : null,
      physics: fighter.physics ? {
        lastDrive: fighter.physics.lastDrive || null,
        wedgeTractionPenalty: fighter.physics.wedgeTractionPenalty || 0,
      } : null,
      aiState: fighter.aiState ? {
        mode: fighter.aiState.mode,
        distance: fighter.aiState.distance,
        side: fighter.aiState.side,
      } : null,
    };
  };

  const snapshot = (label = "") => ({
    label,
    mode,
    paused: arenaPaused,
    aiEnabled: arena?.testOptions?.aiEnabled !== false,
    physicsVersion: "2",
    fighters: (arena?.fighters || []).map(fighterState),
  });

  const setPose = (fighter, position, yaw = 0, linvel = { x: 0, y: 0, z: 0 }, angvel = { x: 0, y: 0, z: 0 }) => {
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0));
    setFighterBodyPose(fighter, position, { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w }, linvel, angvel);
    markFighterUnstable(fighter, 1.2);
  };

  const setArenaBots = async (playerId = "biteforce", rivalId = "minotaur", options = {}) => {
    const playerBot = findBot(playerId);
    const rivalBot = findBot(rivalId);
    if (!playerBot || !rivalBot) return { error: "Unknown bot id", playerId, rivalId };
    if (!(await waitForModels([playerId, rivalId]))) return { error: "Timed out waiting for model-backed bots", playerId, rivalId };
    selected = playerBot;
    opponent = rivalBot.id === playerBot.id ? bots.find((bot) => bot.id !== playerBot.id) || rivalBot : rivalBot;
    syncOpponentSelect();
    syncBotTuningControls();
    if (arenaObjectModeSelect) arenaObjectModeSelect.value = options.objects || "none";
    syncArenaObjectControls();
    setMode("arena");
    await waitFrames(5);
    if (!arena?.world || arena.fighters.length < 2) return { error: "Arena did not initialize", playerId, rivalId };
    arena.testOptions.aiEnabled = options.aiEnabled !== false;
    return snapshot("setup");
  };

  const runAiProbe = async (frames = 150) => {
    const setup = await setArenaBots("biteforce", "minotaur", { aiEnabled: true, objects: "none" });
    if (setup.error) return setup;
    const start = snapshot("ai-start");
    const modeCounts = {};
    await waitFrames(frames, () => {
      const modeName = arena.fighters[1]?.aiState?.mode || "none";
      modeCounts[modeName] = (modeCounts[modeName] || 0) + 1;
    });
    const end = snapshot("ai-end");
    const a = start.fighters[0].position;
    const b = start.fighters[1].position;
    const c = end.fighters[0].position;
    const d = end.fighters[1].position;
    const startDistance = Math.hypot(a.x - b.x, a.z - b.z);
    const endDistance = Math.hypot(c.x - d.x, c.z - d.z);
    return {
      start,
      end,
      checks: {
        aiMovedTowardPlayer: endDistance < startDistance - 0.2,
        cycledBehavior: Object.keys(modeCounts).filter((key) => modeCounts[key] > 0).length >= 3,
        startDistance,
        endDistance,
        modeCounts,
      },
    };
  };

  const runDropProbe = async (height = 3, frames = 90) => {
    const setup = await setArenaBots("biteforce", "minotaur", { aiEnabled: false, objects: "none" });
    if (setup.error) return setup;
    arena.testOptions.aiEnabled = false;
    const fighter = arena.fighters[0];
    const restingY = fighter.rb.translation().y;
    setPose(fighter, { x: -1.8, y: restingY + height, z: 0 }, 0);
    await waitFrames(3);
    const start = snapshot("drop-start");
    let lowestY = start.fighters[0].position.y;
    await waitFrames(frames, () => {
      lowestY = Math.min(lowestY, arena.fighters[0].rb.translation().y);
    });
    const end = snapshot("drop-end");
    return {
      start,
      end,
      checks: {
        fellAtLeastOneMeter: start.fighters[0].position.y - lowestY > 1,
        didNotHoverNearStart: end.fighters[0].position.y < start.fighters[0].position.y - 1,
        lowestY,
      },
    };
  };

  const runCollisionProbe = async (frames = 120) => {
    const setup = await setArenaBots("biteforce", "minotaur", { aiEnabled: false, objects: "none" });
    if (setup.error) return setup;
    const player = arena.fighters[0];
    const rival = arena.fighters[1];
    const playerY = player.rb.translation().y;
    const rivalY = rival.rb.translation().y;
    setPose(player, { x: -2.2, y: playerY, z: 0 }, -Math.PI / 2, { x: 4.5, y: 0, z: 0 });
    setPose(rival, { x: 2.2, y: rivalY, z: 0 }, Math.PI / 2, { x: -4.5, y: 0, z: 0 });
    await waitFrames(3);
    const start = snapshot("collision-start");
    const startDistance = Math.hypot(start.fighters[0].position.x - start.fighters[1].position.x, start.fighters[0].position.z - start.fighters[1].position.z);
    let minimumDistance = Infinity;
    let peakAngularSpeed = 0;
    await waitFrames(frames, () => {
      const pa = arena.fighters[0].rb.translation();
      const pb = arena.fighters[1].rb.translation();
      minimumDistance = Math.min(minimumDistance, Math.hypot(pa.x - pb.x, pa.z - pb.z));
      arena.fighters.forEach((fighter) => {
        const angular = fighter.rb.angvel();
        peakAngularSpeed = Math.max(peakAngularSpeed, Math.hypot(angular.x, angular.y, angular.z));
      });
    });
    const end = snapshot("collision-end");
    return {
      start,
      end,
      checks: {
        closedDistanceByOneMeter: startDistance - minimumDistance > 1,
        collisionChangedMotion: Math.abs(end.fighters[0].linvel.x - start.fighters[0].linvel.x) > 0.6 || peakAngularSpeed > 0.25,
        startDistance,
        minimumDistance,
        peakAngularSpeed,
      },
    };
  };

  const runHugeDriveProbe = async (frames = 120) => {
    const setup = await setArenaBots("huge", "biteforce", { aiEnabled: false, objects: "none" });
    if (setup.error) return setup;
    const huge = arena.fighters[0];
    await waitFrames(20);
    const start = snapshot("huge-drive-start");
    const input = completeDriveInput({ leftDrive: 1, rightDrive: 1, weapon: false });
    const idle = completeDriveInput({ leftDrive: 0, rightDrive: 0, weapon: false });
    let peakGrounded = 0;
    let peakLift = 0;
    let finalHorizontalSpeed = 0;
    testArenaInputs = [input, idle];
    try {
      for (let frame = 0; frame < frames; frame += 1) {
        await waitFrame();
        peakGrounded = Math.max(peakGrounded, huge.wheelTraction?.grounded || 0);
        const p = huge.rb.translation();
        const velocity = huge.rb.linvel();
        peakLift = Math.max(peakLift, p.y - start.fighters[0].position.y);
        finalHorizontalSpeed = Math.hypot(velocity.x, velocity.z);
      }
    } finally {
      testArenaInputs = null;
    }
    const end = snapshot("huge-drive-end");
    const startPos = start.fighters[0].position;
    const endPos = end.fighters[0].position;
    const moved = Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z);
    return {
      start,
      end,
      checks: {
        hugeMoved: moved > 0.45,
        didNotJump: peakLift < 0.42,
        didNotStall: finalHorizontalSpeed > 0.35,
        retainedTraction: peakGrounded > 0.35,
        moved,
        peakLift,
        peakGrounded,
        finalHorizontalSpeed,
      },
    };
  };

  const runArenaDriveProbe = async ({
    playerId = "biteforce",
    rivalId = "minotaur",
    frames = 95,
    turnFrames = 80,
  } = {}) => {
    const setup = await setArenaBots(playerId, rivalId, { aiEnabled: false, objects: "none" });
    if (setup.error) return setup;
    const fighter = arena.fighters[0];
    const rival = arena.fighters[1];
    const idle = completeDriveInput({ leftDrive: 0, rightDrive: 0, weapon: false });
    const forwardInput = completeDriveInput({ leftDrive: 1, rightDrive: 1, weapon: false });
    const turnInput = completeDriveInput({ leftDrive: 1, rightDrive: -1, weapon: false });
    setPose(fighter, { x: 0, y: fighterGroundedBodyY(fighter), z: 6.2 }, 0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    setPose(rival, { x: 7, y: fighterGroundedBodyY(rival), z: 7 }, Math.PI, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    await waitFrames(10);
    const start = snapshot("physics-drive-start");
    let peakGrounded = 0;
    let peakSpeed = 0;
    testArenaInputs = [forwardInput, idle];
    await waitFrames(frames, () => {
      peakGrounded = Math.max(peakGrounded, fighter.wheelTraction?.grounded || 0);
      const velocity = fighter.rb.linvel();
      peakSpeed = Math.max(peakSpeed, Math.hypot(velocity.x, velocity.z));
    });
    const afterForward = snapshot("physics-drive-forward");
    testArenaInputs = null;
    setPose(fighter, { x: 0, y: fighterGroundedBodyY(fighter), z: 0 }, 0, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    if (fighter.physics) {
      fighter.physics.wedgeUntil = 0;
      fighter.physics.wedgeTractionPenalty = 0;
    }
    await waitFrames(6);
    const yawBeforeTurn = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(
      fighter.rb.rotation().x,
      fighter.rb.rotation().y,
      fighter.rb.rotation().z,
      fighter.rb.rotation().w,
    ), "YXZ").y;
    testArenaInputs = [turnInput, idle];
    await waitFrames(turnFrames, () => {
      peakGrounded = Math.max(peakGrounded, fighter.wheelTraction?.grounded || 0);
    });
    testArenaInputs = null;
    const end = snapshot("physics-drive-end");
    const startPos = start.fighters[0].position;
    const forwardPos = afterForward.fighters[0].position;
    const endRot = arena.fighters[0].rb.rotation();
    const yawAfterTurn = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(endRot.x, endRot.y, endRot.z, endRot.w), "YXZ").y;
    const moved = Math.hypot(forwardPos.x - startPos.x, forwardPos.z - startPos.z);
    const yawDelta = Math.abs(Math.atan2(Math.sin(yawAfterTurn - yawBeforeTurn), Math.cos(yawAfterTurn - yawBeforeTurn)));
    const expectedSpeed = botGroundSpeedFeetPerSecond(fighter.spec, "maxSpeed", TANK_DRIVE_MAX_SPEED) * 0.6;
    const expectedTurn = fighter.spec?.id === "huge" ? 0.1 : 0.25;
    return {
      setup,
      start,
      afterForward,
      end,
      checks: {
        movedForward: moved > 0.85,
        reachedSpeed: peakSpeed > expectedSpeed,
        turned: yawDelta > expectedTurn,
        retainedTraction: peakGrounded > 0.25,
        moved,
        peakSpeed,
        expectedSpeed,
        expectedTurn,
        yawDelta,
        peakGrounded,
      },
    };
  };

  const runPhysicsRosterDriveProbe = async () => {
    const results = {};
    for (const bot of bots) {
      const rivalId = bot.id === "biteforce" ? "minotaur" : "biteforce";
      results[bot.id] = await runArenaDriveProbe({ playerId: bot.id, rivalId });
    }
    const failed = Object.entries(results)
      .filter(([, result]) => result.error || !result.checks?.movedForward || !result.checks?.reachedSpeed || !result.checks?.turned || !result.checks?.retainedTraction)
      .map(([id]) => id);
    return {
      results,
      checks: {
        allDriveAndTurn: failed.length === 0,
        failed,
      },
    };
  };

  const physicsLocalColliderCorners = (fighter) => {
    const parts = fighter.physics?.parts?.length ? fighter.physics.parts : activeColliderPartsForMode(fighter.group, fighter.spec.id);
    const visualScale = fighter.visualScale || 1;
    const corners = [];
    parts.forEach((part) => {
      const halfExtents = (part.halfExtents || [0.4, 0.15, 0.4]).map((value) => value * visualScale);
      const position = new THREE.Vector3(...(part.position || [0, 0, 0])).multiplyScalar(visualScale);
      const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(part.rotation || [0, 0, 0])));
      for (const x of [-halfExtents[0], halfExtents[0]]) {
        for (const y of [-halfExtents[1], halfExtents[1]]) {
          for (const z of [-halfExtents[2], halfExtents[2]]) {
            corners.push(new THREE.Vector3(x, y, z).applyQuaternion(rotation).add(position));
          }
        }
      }
    });
    return corners;
  };

  const physicsLocalColliderBounds = (fighter) => {
    const corners = physicsLocalColliderCorners(fighter);
    const bounds = {
      min: new THREE.Vector3(Infinity, Infinity, Infinity),
      max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
    };
    corners.forEach((corner) => {
      bounds.min.min(corner);
      bounds.max.max(corner);
    });
    return Number.isFinite(bounds.min.x) ? bounds : colliderPartsBounds(activeColliderPartsForMode(fighter.group, fighter.spec.id), fighter.visualScale || 1);
  };

  const setPhysicsCornerTeeterPose = (fighter, {
    yawDeg = 25,
    pitchDeg = 25,
    rollDeg = -25,
    heightOffset = 0,
    position = { x: 0, z: 0 },
    linvel = { x: 0, y: 0, z: 0 },
    angvel = { x: 0, y: 0, z: 0 },
  } = {}) => {
    const bounds = physicsLocalColliderBounds(fighter);
    const corner = new THREE.Vector3(bounds.min.x, bounds.min.y, bounds.min.z);
    const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      THREE.MathUtils.degToRad(pitchDeg),
      THREE.MathUtils.degToRad(yawDeg),
      THREE.MathUtils.degToRad(rollDeg),
      "YXZ",
    ));
    const rotatedCorner = corner.clone().applyQuaternion(rotation);
    const pivot = new THREE.Vector3(position.x, fighterFloorY(fighter) + heightOffset, position.z);
    const bodyPosition = pivot.sub(rotatedCorner);
    setFighterBodyPose(fighter, { x: bodyPosition.x, y: bodyPosition.y, z: bodyPosition.z }, { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w });
    const minY = fighterGroundContactInfo(fighter).minY;
    const desiredMinY = fighterFloorY(fighter) + heightOffset;
    if (Number.isFinite(minY)) {
      const p = fighter.rb.translation();
      setFighterBodyPose(fighter, { x: p.x, y: p.y + desiredMinY - minY, z: p.z }, null);
    }
    fighter.rb.setLinvel(linvel, true);
    fighter.rb.setAngvel(angvel, true);
    if (fighter.physics) {
      fighter.physics.wedgeUntil = 0;
      fighter.physics.wedgeTractionPenalty = 0;
    }
    markFighterUnstable(fighter, 2.5);
    return {
      bounds: {
        min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
        max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
      },
      corner: { x: corner.x, y: corner.y, z: corner.z },
      height: bounds.max.y - bounds.min.y,
      heightOffset,
    };
  };

  const runPhysicsDriveAfterSettle = async (fighter, frames = 80) => {
    const idle = completeDriveInput({ leftDrive: 0, rightDrive: 0, weapon: false });
    const forwardInput = completeDriveInput({ leftDrive: 1, rightDrive: 1, weapon: false });
    const currentRotation = fighter.rb.rotation();
    const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(
      currentRotation.x,
      currentRotation.y,
      currentRotation.z,
      currentRotation.w,
    ), "YXZ").y;
    setPose(fighter, { x: 0, y: fighter.rb.translation().y + 0.05, z: -7 }, Math.PI, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    await waitFrames(6);
    const start = fighter.rb.translation();
    let peakGrounded = 0;
    let peakSolidGrounded = 0;
    let peakSpeed = 0;
    let speedAtHalfSecond = 0;
    let speedAtOneSecond = 0;
    const driveStartedAt = performance.now();
    testArenaInputs = [forwardInput, idle];
    try {
      await waitFrames(frames, () => {
        const elapsed = (performance.now() - driveStartedAt) / 1000;
        const traction = physics.tractionForFighter(fighter);
        peakGrounded = Math.max(peakGrounded, traction.grounded || 0);
        peakSolidGrounded = Math.max(peakSolidGrounded, traction.solidGrounded || 0);
        const velocity = fighter.rb.linvel();
        const speed = Math.hypot(velocity.x, velocity.z);
        peakSpeed = Math.max(peakSpeed, speed);
        if (!speedAtHalfSecond && elapsed >= 0.5) speedAtHalfSecond = speed;
        if (!speedAtOneSecond && elapsed >= 1.0) speedAtOneSecond = speed;
      });
    } finally {
      testArenaInputs = null;
    }
    const end = fighter.rb.translation();
    const maxSpeed = botGroundSpeedFeetPerSecond(fighter.spec, "maxSpeed", TANK_DRIVE_MAX_SPEED);
    const expectedHalfSecondSpeed = maxSpeed * 0.72;
    const expectedOneSecondSpeed = maxSpeed * 0.84;
    return {
      moved: Math.hypot(end.x - start.x, end.z - start.z),
      peakGrounded,
      peakSolidGrounded,
      peakSpeed,
      speedAtHalfSecond,
      speedAtOneSecond,
      expectedHalfSecondSpeed,
      expectedOneSecondSpeed,
      reachedExpectedSpeed: speedAtHalfSecond >= expectedHalfSecondSpeed && speedAtOneSecond >= expectedOneSecondSpeed,
    };
  };

  const runPhysicsTeeterProbe = async ({
    playerId = "biteforce",
    rivalId = "minotaur",
    frames = 190,
    driveFrames = 80,
    impulse = false,
    elevated = false,
  } = {}) => {
    const setup = await setArenaBots(playerId, rivalId, { aiEnabled: false, objects: "none" });
    if (setup.error) return setup;
    await waitFrames(10);
    const fighter = arena.fighters[0];
    const rival = arena.fighters[1];
    setPose(rival, { x: 7, y: rival.rb.translation().y, z: 7 }, Math.PI);
    const previewBounds = physicsLocalColliderBounds(fighter);
    const botHeight = Math.max(0.45, previewBounds.max.y - previewBounds.min.y);
    const heightOffset = elevated ? Math.max(2.0, botHeight) : 0;
    const placement = setPhysicsCornerTeeterPose(fighter, {
      heightOffset,
      linvel: impulse ? { x: 1.5, y: 0.18, z: -2.1 } : { x: 0, y: 0, z: 0 },
      angvel: impulse ? { x: -0.9, y: 0.7, z: 1.1 } : { x: 0, y: 0, z: 0 },
    });
    if (impulse) {
      physics.markHit(fighter, 0.45);
      fighter.rb.applyImpulse({ x: 2.6, y: 1.15, z: -1.7 }, true);
      fighter.rb.applyTorqueImpulse({ x: -1.8, y: 0.85, z: 2.15 }, true);
    }
    await waitFrames(3);
    const start = snapshot(elevated ? "physics-drop-teeter-start" : impulse ? "physics-impulse-teeter-start" : "physics-teeter-start");
    let peakLift = 0;
    let peakSpeed = 0;
    let peakAngularSpeed = 0;
    let firstGroundFrame = null;
    let firstSolidGroundFrame = null;
    let bounceCount = 0;
    let wasFalling = false;
    let peakReboundHeight = 0;
    let bestGravityError = Infinity;
    let gravitySampleCount = 0;
    let previousVerticalVelocity = fighter.rb.linvel().y;
    let previousGravitySampleAt = performance.now();
    const startBodyY = fighter.rb.translation().y;
    await waitFrames(frames, (frame) => {
      const now = performance.now();
      const sampleDt = Math.max(0.001, (now - previousGravitySampleAt) / 1000);
      previousGravitySampleAt = now;
      const p = fighter.rb.translation();
      const v = fighter.rb.linvel();
      const a = fighter.rb.angvel();
      const traction = physics.tractionForFighter(fighter);
      const solidGrounded = traction.solidGrounded || 0;
      if (solidGrounded < 0.08 && firstGroundFrame === null) {
        const verticalAcceleration = (v.y - previousVerticalVelocity) / sampleDt;
        if (Math.abs(v.y) > 0.08 || elevated) {
          bestGravityError = Math.min(bestGravityError, Math.abs(verticalAcceleration - arenaGravityY()));
          gravitySampleCount += 1;
        }
      }
      previousVerticalVelocity = v.y;
      peakLift = Math.max(peakLift, p.y - startBodyY);
      peakSpeed = Math.max(peakSpeed, Math.hypot(v.x, v.y, v.z));
      peakAngularSpeed = Math.max(peakAngularSpeed, Math.hypot(a.x, a.y, a.z));
      if (traction.grounded > 0.25 && firstGroundFrame === null) firstGroundFrame = frame;
      if (solidGrounded > 0.25 && firstSolidGroundFrame === null) firstSolidGroundFrame = frame;
      if (firstGroundFrame !== null) peakReboundHeight = Math.max(peakReboundHeight, p.y - startBodyY + heightOffset);
      if (v.y < -0.18) wasFalling = true;
      if (wasFalling && v.y > 0.16 && traction.grounded > 0.08) {
        bounceCount += 1;
        wasFalling = false;
      }
    });
    await waitFrames(10);
    const settled = snapshot(elevated ? "physics-drop-teeter-settled" : impulse ? "physics-impulse-teeter-settled" : "physics-teeter-settled");
    const drive = await runPhysicsDriveAfterSettle(fighter, driveFrames);
    const end = snapshot(elevated ? "physics-drop-teeter-drive-end" : impulse ? "physics-impulse-teeter-drive-end" : "physics-teeter-drive-end");
    const settledFighter = settled.fighters[0];
    const finalVerticalSpeed = Math.abs(settledFighter.linvel.y);
    const finalHorizontalSpeed = Math.hypot(settledFighter.linvel.x, settledFighter.linvel.z);
    const grounded = settledFighter.traction?.grounded || 0;
    const solidGrounded = settledFighter.traction?.solidGrounded || 0;
    const gravityLikeFall = elevated
      ? gravitySampleCount >= 8 && bestGravityError < Math.abs(arenaGravityY()) * 0.25
      : firstGroundFrame !== null && peakAngularSpeed > 0.08;
    const observedBounceCount = bounceCount || (elevated && peakReboundHeight > 0.04 ? 1 : 0);
    const expectedDropImpactSpeed = elevated ? Math.sqrt(Math.abs(arenaGravityY()) * heightOffset * 2) : 0;
    const forcefulFall = elevated
      ? peakSpeed > expectedDropImpactSpeed * 0.68
      : peakAngularSpeed > 1.0 && peakSpeed > 1.0 && firstSolidGroundFrame !== null && firstSolidGroundFrame < 90;
    const reasonableBounce = !elevated || (
      firstGroundFrame !== null
      && observedBounceCount >= 1
      && observedBounceCount <= 5
      && peakReboundHeight >= 0
      && peakReboundHeight < Math.max(0.5, heightOffset * 0.85)
    );
    return {
      setup,
      start,
      settled,
      end,
      placement,
      checks: {
        settledFlat: settledFighter.upY > 0.93,
        gravityLikeFall,
        forcefulFall,
        settledOnGround: grounded > 0.35 && solidGrounded > 0.25 && finalVerticalSpeed < 0.28,
        notSkiddingAway: finalHorizontalSpeed < (impulse ? 1.2 : 0.45),
        canDriveAfterSettle: drive.moved > 0.45 && drive.peakGrounded > 0.25 && drive.peakSolidGrounded > 0.25 && drive.reachedExpectedSpeed,
        passesDynamics: gravityLikeFall && forcefulFall,
        reasonableBounce,
        firstGroundFrame,
        firstSolidGroundFrame,
        bounceCount: observedBounceCount,
        sampledBounceCount: bounceCount,
        peakReboundHeight,
        peakLift,
        peakSpeed,
        expectedDropImpactSpeed,
        peakAngularSpeed,
        finalVerticalSpeed,
        finalHorizontalSpeed,
        grounded,
        solidGrounded,
        bestGravityError: Number.isFinite(bestGravityError) ? bestGravityError : null,
        gravitySampleCount,
        driveMoved: drive.moved,
        drivePeakGrounded: drive.peakGrounded,
        drivePeakSolidGrounded: drive.peakSolidGrounded,
        drivePeakSpeed: drive.peakSpeed,
        driveSpeedAtHalfSecond: drive.speedAtHalfSecond,
        driveSpeedAtOneSecond: drive.speedAtOneSecond,
        expectedHalfSecondSpeed: drive.expectedHalfSecondSpeed,
        expectedOneSecondSpeed: drive.expectedOneSecondSpeed,
        reachedExpectedDriveSpeed: drive.reachedExpectedSpeed,
      },
    };
  };

  const runPhysicsTeeterImpulseProbe = (options = {}) => runPhysicsTeeterProbe({ ...options, impulse: true });
  const runPhysicsDropBounceProbe = (options = {}) => runPhysicsTeeterProbe({ ...options, elevated: true, frames: options.frames || 230 });

  const runPhysicsAirborneDriveIsolationProbe = async ({
    playerId = "biteforce",
    rivalId = "minotaur",
    frames = 12,
  } = {}) => {
    const setup = await setArenaBots(playerId, rivalId, { aiEnabled: false, objects: "none" });
    if (setup.error) return setup;
    await waitFrames(10);
    const fighter = arena.fighters[0];
    const rival = arena.fighters[1];
    setPose(rival, { x: 7, y: rival.rb.translation().y, z: 7 }, Math.PI);
    const bounds = physicsLocalColliderBounds(fighter);
    const heightOffset = Math.max(4.3, (bounds.max.y - bounds.min.y) * 4.0);
    setPhysicsCornerTeeterPose(fighter, {
      pitchDeg: 0,
      rollDeg: 0,
      yawDeg: 0,
      heightOffset,
      linvel: { x: 0, y: 0, z: 0 },
      angvel: { x: 0, y: 0, z: 0 },
    });
    await waitFrames(2);
    const start = snapshot("physics-airborne-drive-start");
    const activeInput = completeDriveInput({ leftDrive: 1, rightDrive: -1, weapon: false });
    const idle = completeDriveInput({ leftDrive: 0, rightDrive: 0, weapon: false });
    const yawStart = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(
      fighter.rb.rotation().x,
      fighter.rb.rotation().y,
      fighter.rb.rotation().z,
      fighter.rb.rotation().w,
    ), "YXZ").y;
    let maxHorizontalSpeed = 0;
    let maxYawDelta = 0;
    let bestGravityError = Infinity;
    let gravitySampleCount = 0;
    let previousVerticalVelocity = fighter.rb.linvel().y;
    let previousGravitySampleAt = performance.now();
    let peakGrounded = 0;
    let peakSolidGrounded = 0;
    let maxDriveImpulse = 0;
    testArenaInputs = [completeDriveInput({ leftDrive: 1, rightDrive: 0, weapon: false }), idle];
    try {
      await waitFrames(frames, () => {
        const now = performance.now();
        const sampleDt = Math.max(0.001, (now - previousGravitySampleAt) / 1000);
        previousGravitySampleAt = now;
        const velocity = fighter.rb.linvel();
        const traction = physics.tractionForFighter(fighter);
        const rotation = fighter.rb.rotation();
        const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w), "YXZ").y;
        const verticalAcceleration = (velocity.y - previousVerticalVelocity) / sampleDt;
        previousVerticalVelocity = velocity.y;
        maxHorizontalSpeed = Math.max(maxHorizontalSpeed, Math.hypot(velocity.x, velocity.z));
        maxYawDelta = Math.max(maxYawDelta, Math.abs(Math.atan2(Math.sin(yaw - yawStart), Math.cos(yaw - yawStart))));
        peakGrounded = Math.max(peakGrounded, traction.grounded || 0);
        peakSolidGrounded = Math.max(peakSolidGrounded, traction.solidGrounded || 0);
        maxDriveImpulse = Math.max(maxDriveImpulse, Math.abs(fighter.physics?.lastDrive?.driveImpulse || 0));
        if ((traction.grounded || 0) < 0.05) {
          bestGravityError = Math.min(bestGravityError, Math.abs(verticalAcceleration - arenaGravityY()));
          gravitySampleCount += 1;
        }
      });
    } finally {
      testArenaInputs = null;
    }
    const end = snapshot("physics-airborne-drive-end");
    return {
      setup,
      start,
      end,
      checks: {
        gravityOnlyWhileAirborne: gravitySampleCount >= 8 && bestGravityError < Math.abs(arenaGravityY()) * 0.25,
        noAirborneDriveTranslation: maxHorizontalSpeed < 0.35 && maxDriveImpulse < 0.001,
        noAirborneYawControl: maxYawDelta < 0.05,
        stayedAirborneDuringSample: peakGrounded < 0.05 && peakSolidGrounded < 0.05,
        maxHorizontalSpeed,
        maxDriveImpulse,
        maxYawDelta,
        peakGrounded,
        peakSolidGrounded,
        bestGravityError: Number.isFinite(bestGravityError) ? bestGravityError : null,
        gravitySampleCount,
      },
    };
  };

  const runPhysicsInvertedDriveProbe = async ({
    frames = 95,
    invertedBotId = "minotaur",
    nonInvertedBotId = "bronco",
  } = {}) => {
    const setup = await setArenaBots(invertedBotId, nonInvertedBotId, { aiEnabled: false, objects: "none" });
    if (setup.error) return setup;
    const invertedDriver = arena.fighters[0];
    const disabledDriver = arena.fighters[1];
    const invertedRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    const placeInverted = (fighter, x) => {
      const p = fighter.rb.translation();
      fighter.rb.setTranslation({ x, y: p.y + 0.7, z: 0 }, true);
      fighter.rb.setRotation({ x: invertedRotation.x, y: invertedRotation.y, z: invertedRotation.z, w: invertedRotation.w }, true);
      fighter.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      fighter.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      correctFighterAboveFloor(fighter, 0.08);
      physics.markHit(fighter, 0.2);
    };
    placeInverted(invertedDriver, -2);
    placeInverted(disabledDriver, 2);
    await waitFrames(12);
    const start = snapshot("physics-inverted-drive-start");
    const active = completeDriveInput({ leftDrive: 1, rightDrive: 1, weapon: false });
    testArenaInputs = [active, active];
    let invertedPeakSpeed = 0;
    let disabledPeakSpeed = 0;
    try {
      await waitFrames(frames, () => {
        const a = invertedDriver.rb.linvel();
        const b = disabledDriver.rb.linvel();
        invertedPeakSpeed = Math.max(invertedPeakSpeed, Math.hypot(a.x, a.z));
        disabledPeakSpeed = Math.max(disabledPeakSpeed, Math.hypot(b.x, b.z));
      });
    } finally {
      testArenaInputs = null;
    }
    const end = snapshot("physics-inverted-drive-end");
    return {
      start,
      end,
      checks: {
        invertedBotCanDrive: invertedPeakSpeed > 1.2,
        nonInvertedBotCannotDriveUpsideDown: disabledPeakSpeed < 0.45,
        invertedPeakSpeed,
        disabledPeakSpeed,
      },
    };
  };

  const runPhysicsSideEdgeDriveProbe = async ({
    playerId = "biteforce",
    rivalId = "minotaur",
    frames = 80,
  } = {}) => {
    const setup = await setArenaBots(playerId, rivalId, { aiEnabled: false, objects: "none" });
    if (setup.error) return setup;
    const fighter = arena.fighters[0];
    const rival = arena.fighters[1];
    setPose(rival, { x: 7, y: rival.rb.translation().y, z: 7 }, Math.PI);
    setPhysicsCornerTeeterPose(fighter, {
      yawDeg: 0,
      pitchDeg: 0,
      rollDeg: 65,
      heightOffset: 0,
      linvel: { x: 0, y: 0, z: 0 },
      angvel: { x: 0, y: 0, z: 0 },
    });
    physics.markHit(fighter, 0.2);
    await waitFrames(10);
    const start = snapshot("physics-side-edge-drive-start");
    const active = completeDriveInput({ leftDrive: 1, rightDrive: 0, weapon: false });
    const idle = completeDriveInput({ leftDrive: 0, rightDrive: 0, weapon: false });
    const startRot = fighter.rb.rotation();
    const yawStart = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(startRot.x, startRot.y, startRot.z, startRot.w), "YXZ").y;
    let maxDriveImpulse = 0;
    let maxYawDelta = 0;
    let peakSpeed = 0;
    testArenaInputs = [active, idle];
    try {
      await waitFrames(frames, () => {
        const velocity = fighter.rb.linvel();
        peakSpeed = Math.max(peakSpeed, Math.hypot(velocity.x, velocity.z));
        maxDriveImpulse = Math.max(maxDriveImpulse, Math.abs(fighter.physics?.lastDrive?.driveImpulse || 0));
        const r = fighter.rb.rotation();
        const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w), "YXZ").y;
        maxYawDelta = Math.max(maxYawDelta, Math.abs(Math.atan2(Math.sin(yaw - yawStart), Math.cos(yaw - yawStart))));
      });
    } finally {
      testArenaInputs = null;
    }
    const end = snapshot("physics-side-edge-drive-end");
    const startPos = start.fighters[0].position;
    const endPos = end.fighters[0].position;
    const moved = Math.hypot(endPos.x - startPos.x, endPos.z - startPos.z);
    return {
      start,
      end,
      checks: {
        gotEdgeWheelForce: maxDriveImpulse > 0.02 && moved > 0.04,
        didNotUseYawDrive: maxYawDelta < 0.18,
        stayedControlled: peakSpeed < 3.5,
        maxDriveImpulse,
        maxYawDelta,
        peakSpeed,
        moved,
      },
    };
  };

  const runPhysicsAngleRecoveryProbe = async ({
    playerId = "biteforce",
    rivalId = "minotaur",
    frames = 180,
  } = {}) => {
    const setup = await setArenaBots(playerId, rivalId, { aiEnabled: false, objects: "none" });
    if (setup.error) return setup;
    const fighter = arena.fighters[0];
    const rival = arena.fighters[1];
    const cases = [
      { name: "left-edge", pitchDeg: 0, rollDeg: 42, yawDeg: 0, angvel: { x: -0.45, y: 0.05, z: 0.7 } },
      { name: "right-edge", pitchDeg: 0, rollDeg: -42, yawDeg: 0, angvel: { x: 0.42, y: -0.04, z: -0.72 } },
      { name: "front-corner", pitchDeg: 24, rollDeg: -22, yawDeg: 25, angvel: { x: -0.65, y: 0.18, z: 0.55 } },
      { name: "rear-corner", pitchDeg: -24, rollDeg: 22, yawDeg: -20, angvel: { x: 0.62, y: -0.15, z: -0.58 } },
    ];
    const results = [];
    for (const angleCase of cases) {
      setPose(rival, { x: 7, y: rival.rb.translation().y, z: 7 }, Math.PI);
      setPhysicsCornerTeeterPose(fighter, {
        yawDeg: angleCase.yawDeg,
        pitchDeg: angleCase.pitchDeg,
        rollDeg: angleCase.rollDeg,
        heightOffset: 0.025,
        linvel: { x: 0.08, y: 0.02, z: -0.06 },
        angvel: angleCase.angvel,
      });
      await waitFrames(frames);
      const traction = physics.tractionForFighter(fighter);
      const p = fighter.rb.translation();
      const v = fighter.rb.linvel();
      const a = fighter.rb.angvel();
      const upY = fighterUpVector(fighter).y;
      const horizontalSpeed = Math.hypot(v.x, v.z);
      const angularSpeed = Math.hypot(a.x, a.y, a.z);
      results.push({
        name: angleCase.name,
        checks: {
          recoveredStablePosture: upY > 0.82,
          settledOnGround: (traction.grounded || 0) > 0.25 && (traction.solidGrounded || 0) > 0.18,
          stoppedTumbling: angularSpeed < 1.4,
          notSkiddingAway: horizontalSpeed < 1.2 && Math.hypot(p.x, p.z) < 3.5,
          upY,
          grounded: traction.grounded || 0,
          solidGrounded: traction.solidGrounded || 0,
          horizontalSpeed,
          angularSpeed,
          position: { x: p.x, y: p.y, z: p.z },
        },
      });
    }
    const failed = results
      .filter((result) => !result.checks.recoveredStablePosture || !result.checks.settledOnGround || !result.checks.stoppedTumbling || !result.checks.notSkiddingAway)
      .map((result) => result.name);
    return {
      setup,
      results,
      checks: {
        allRecovered: failed.length === 0,
        failed,
      },
    };
  };

  const runPhysicsStabilityProbe = async () => ({
    rosterDrive: await runPhysicsRosterDriveProbe(),
    broncoSelfRight: await runBroncoSelfRightProbe(),
    angleRecovery: await runPhysicsAngleRecoveryProbe(),
    teeter: await runPhysicsTeeterProbe(),
    teeterImpulse: await runPhysicsTeeterImpulseProbe(),
    dropBounce: await runPhysicsDropBounceProbe(),
    airborneDriveIsolation: await runPhysicsAirborneDriveIsolationProbe(),
    invertedDrive: await runPhysicsInvertedDriveProbe(),
    broncoUnderFlip: await runBroncoUnderFlipProbe(),
  });

  const runBroncoSelfRightProbe = async (options = {}) => {
    const frames = typeof options === "number" ? options : options.frames || 190;
    const setup = await setArenaBots("bronco", "biteforce", { aiEnabled: false, objects: "none" });
    if (setup.error) return setup;
    const bronco = arena.fighters[0];
    const p = bronco.rb.translation();
    const inverted = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    bronco.rb.setTranslation({ x: 0, y: p.y + 0.65, z: 0 }, true);
    bronco.rb.setRotation({ x: inverted.x, y: inverted.y, z: inverted.z, w: inverted.w }, true);
    bronco.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    bronco.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    correctFighterAboveFloor(bronco, 0.08);
    await waitFrames(10);
    const start = snapshot("bronco-self-right-start");
    let minColliderY = Infinity;
    let maxUpY = fighterUpVector(bronco).y;
    for (let frame = 0; frame < frames; frame += 1) {
      updateWeapon(bronco, FIXED_PHYSICS_DT, frame < 46);
      applyBroncoSelfRighting(bronco, frame % 24 === 0);
      stabilizeSelfRightingFighter(bronco);
      await waitFrame();
      minColliderY = Math.min(minColliderY, fighterColliderWorldMinY(bronco));
      maxUpY = Math.max(maxUpY, fighterUpVector(bronco).y);
    }
    const end = snapshot("bronco-self-right-end");
    const endTraction = physics.tractionForFighter(bronco);
    return {
      start,
      end,
      checks: {
        didNotSink: minColliderY > ARENA_PHYSICS_FLOOR_Y - 0.06,
        startedRighting: maxUpY > -0.05,
        canPotentiallyRecover: maxUpY > 0.25 || end.fighters[0].upY > -0.2,
        recoveredUpright: end.fighters[0].upY > 0.62 && (endTraction.grounded || 0) > 0.18,
        startUpY: start.fighters[0].upY,
        endUpY: end.fighters[0].upY,
        grounded: endTraction.grounded || 0,
        maxUpY,
        minColliderY,
      },
    };
  };

  const runBroncoUnderFlipProbe = async (frames = 95) => {
    const setup = await setArenaBots("bronco", "biteforce", { aiEnabled: false, objects: "none" });
    if (setup.error) return setup;
    const bronco = arena.fighters[0];
    const target = arena.fighters[1];
    const broncoY = bronco.rb.translation().y;
    const targetY = target.rb.translation().y;
    setPose(bronco, { x: 0, y: broncoY, z: 0.25 }, 0, { x: 0, y: 0, z: 0 });
    setPose(target, { x: 0, y: targetY + 0.1, z: -0.72 }, Math.PI, { x: 0, y: 0, z: 0 });
    bronco.weapon.hitCooldowns?.clear?.();
    physics.markHit(bronco, 3);
    physics.markHit(target, 3);
    await waitFrames(6);
    const start = snapshot("bronco-under-flip-start");
    let maxLift = 0;
    let maxVerticalSpeed = 0;
    let minUpY = fighterUpVector(target).y;
    let maxAngularSpeed = 0;
    const active = completeDriveInput({ leftDrive: 0, rightDrive: 0, weapon: true });
    const idle = completeDriveInput({ leftDrive: 0, rightDrive: 0, weapon: false });
    testArenaInputs = [active, idle];
    try {
      await waitFrames(frames, (frame) => {
        if (frame === 24) testArenaInputs = [idle, idle];
        const p = target.rb.translation();
        const linear = target.rb.linvel();
        const angular = target.rb.angvel();
        maxLift = Math.max(maxLift, p.y - targetY);
        maxVerticalSpeed = Math.max(maxVerticalSpeed, linear.y);
        minUpY = Math.min(minUpY, fighterUpVector(target).y);
        maxAngularSpeed = Math.max(maxAngularSpeed, Math.hypot(angular.x, angular.y, angular.z));
      });
    } finally {
      testArenaInputs = null;
    }
    const end = snapshot("bronco-under-flip-end");
    return {
      start,
      end,
      checks: {
        targetLaunched: maxLift > 0.65,
        targetGotSelfRightingScaleKick: maxVerticalSpeed > 3.7 || maxLift > 1.2,
        targetRotated: minUpY < 0.82 || maxAngularSpeed > 1.2,
        maxLift,
        maxVerticalSpeed,
        minUpY,
        maxAngularSpeed,
      },
    };
  };

  const runSpinnerHitProbe = async (frames = 130) => {
    const setup = await setArenaBots("minotaur", "biteforce", { aiEnabled: false, objects: "none" });
    if (setup.error) return setup;
    const attacker = arena.fighters[0];
    const target = arena.fighters[1];
    const attackerY = attacker.rb.translation().y;
    const targetY = target.rb.translation().y;
    setPose(attacker, { x: 0, y: attackerY, z: 0.75 }, 0, { x: 0, y: 0, z: 0 });
    setPose(target, { x: 0, y: targetY, z: -0.55 }, Math.PI, { x: 0, y: 0, z: 0 });
    markFighterUnstable(attacker, 4);
    markFighterUnstable(target, 4);
    attacker.weapon.currentSpeed = attacker.weapon.visualSpeed || attacker.weapon.activeSpeed || attacker.weapon.speed || 150;
    attacker.weapon.lastHitTimes?.clear?.();
    await waitFrames(6);
    attacker.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    attacker.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    target.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    target.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    markFighterUnstable(attacker, 4);
    markFighterUnstable(target, 4);
    const start = snapshot("spinner-hit-start");
    const initialAttackerSpeed = Math.hypot(start.fighters[0].linvel.x, start.fighters[0].linvel.y, start.fighters[0].linvel.z);
    const initialTargetSpeed = Math.hypot(start.fighters[1].linvel.x, start.fighters[1].linvel.y, start.fighters[1].linvel.z);
    let maxAttackerLift = 0;
    let maxTargetLift = 0;
    let maxAttackerSpeed = 0;
    let maxTargetSpeed = 0;
    await waitFrames(frames, (frame) => {
      updateWeapon(attacker, FIXED_PHYSICS_DT, true);
      syncWeaponColliderBindings(attacker);
      if (frame < 18) applyWeaponImpacts(attacker, true, FIXED_PHYSICS_DT);
      const ap = attacker.rb.translation();
      const tp = target.rb.translation();
      const av = attacker.rb.linvel();
      const tv = target.rb.linvel();
      maxAttackerLift = Math.max(maxAttackerLift, ap.y - attackerY);
      maxTargetLift = Math.max(maxTargetLift, tp.y - targetY);
      maxAttackerSpeed = Math.max(maxAttackerSpeed, Math.hypot(av.x, av.y, av.z));
      maxTargetSpeed = Math.max(maxTargetSpeed, Math.hypot(tv.x, tv.y, tv.z));
    });
    const end = snapshot("spinner-hit-end");
    return {
      start,
      end,
      checks: {
        targetTookMoreSpeed: Math.max(0, maxTargetSpeed - initialTargetSpeed) > Math.max(0, maxAttackerSpeed - initialAttackerSpeed) * 1.15,
        attackerStayedWeighty: maxAttackerLift < Math.max(0.75, maxTargetLift * 0.85),
        attackerSpeedGain: Math.max(0, maxAttackerSpeed - initialAttackerSpeed),
        targetSpeedGain: Math.max(0, maxTargetSpeed - initialTargetSpeed),
        maxAttackerLift,
        maxTargetLift,
        maxAttackerSpeed,
        maxTargetSpeed,
      },
    };
  };

  const runPhysicsProbe = async () => ({
    ai: await runAiProbe(),
    drop: await runDropProbe(),
    collision: await runCollisionProbe(),
    hugeDrive: await runHugeDriveProbe(),
    broncoSelfRight: await runBroncoSelfRightProbe(),
    broncoUnderFlip: await runBroncoUnderFlipProbe(),
    spinnerHit: await runSpinnerHitProbe(),
  });

  return {
    snapshot,
    setArenaBots,
    setAiEnabled(enabled) {
      if (arena) arena.testOptions.aiEnabled = Boolean(enabled);
      return snapshot("ai-toggle");
    },
    runAiProbe,
    runDropProbe,
    runCollisionProbe,
    runArenaDriveProbe,
    runHugeDriveProbe,
    runBroncoSelfRightProbe,
    runBroncoUnderFlipProbe,
    runSpinnerHitProbe,
    runPhysicsRosterDriveProbe,
    runPhysicsTeeterProbe,
    runPhysicsTeeterImpulseProbe,
    runPhysicsDropBounceProbe,
    runPhysicsAirborneDriveIsolationProbe,
    runPhysicsInvertedDriveProbe,
    runPhysicsSideEdgeDriveProbe,
    runPhysicsAngleRecoveryProbe,
    runPhysicsStabilityProbe,
    runPhysicsProbe,
    forcePhysicalDamageBreak(
      fighterIndex = 1,
      amount = 120,
      hits = pairedRangeNumberValue(
        physicalDamageHitsRequiredInput,
        physicalDamageHitsRequiredValue,
        DEFAULT_PHYSICAL_DAMAGE_OPTIONS.significantHitsRequired,
      ),
    ) {
      const fighter = arena?.fighters?.[fighterIndex] || arena?.fighters?.[0];
      if (!fighter?.rb) return { error: "No arena fighter available" };
      const p = fighter.rb.translation();
      const q = fighter.rb.rotation();
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
      const point = new THREE.Vector3(p.x, p.y + 0.45, p.z).addScaledVector(forward, 0.55);
      const hit = {
        amount,
        point,
        normal: forward.clone().negate(),
        kind: "physicalDamageTest",
        source: "testRig",
      };
      for (let i = 0; i < Math.max(1, Math.round(hits)); i += 1) recordBotDamage(fighter, hit);
      return {
        id: fighter.spec?.id,
        pieces: fighter.physicalDamagePieces || 0,
        primed: fighter.physicalDamagePrimedBreaks?.filter((candidate) => !candidate.committed).length || 0,
        props: arena?.props?.filter((prop) => prop.kind === "botDamagePiece").length || 0,
        damageTotal: fighter.damageTotal || 0,
      };
    },
  };
}

window.__battleBotTestRig = createBattleBotTestRig();
window.__battleBotViewerAudit = viewerColliderAudit;
window.__battleBotArenaFloorAudit = (fighterIndex = 0) => {
  const fighter = arena?.fighters?.[fighterIndex] || null;
  const box = fighter?.group ? new THREE.Box3().setFromObject(fighter.group) : null;
  const rbPosition = fighter?.rb?.translation?.();
  const lastStep = fighter?.physics?.lastStep;
  return {
    hasArena: Boolean(arena),
    hasFighter: Boolean(fighter),
    id: fighter?.spec?.id || null,
    mode,
    visualMinY: box?.min?.y ?? null,
    visualMaxY: box?.max?.y ?? null,
    visualGap: box ? box.min.y - ARENA_FLOOR_Y : null,
    rbY: rbPosition?.y ?? null,
    floorY: ARENA_FLOOR_Y,
    physicsFloorY: ARENA_PHYSICS_FLOOR_Y,
    visualFloorY: ARENA_VISUAL_FLOOR_Y,
    groundedStableFor: fighter?.physics?.groundedStableFor ?? null,
    groundMinY: lastStep?.ground?.minY ?? null,
    upY: lastStep?.upY ?? null,
  };
};
document.body.dataset.testRig = "ready";
async function runPhysicsProbeToDom() {
  document.body.dataset.physicsProbeStatus = "running";
  document.body.dataset.physicsProbeResult = "";
  try {
    const result = await window.__battleBotTestRig.runPhysicsProbe();
    document.body.dataset.physicsProbeResult = JSON.stringify(result);
    document.body.dataset.physicsProbeStatus = "complete";
  } catch (error) {
    document.body.dataset.physicsProbeResult = JSON.stringify({ error: error?.message || String(error) });
    document.body.dataset.physicsProbeStatus = "error";
  }
}
document.addEventListener("battlebot:runPhysicsProbe", runPhysicsProbeToDom);
async function runDriveProbeToDom(event) {
  document.body.dataset.driveProbeStatus = "running";
  document.body.dataset.driveProbeResult = "";
  try {
    const options = event?.detail || {};
    const result = await window.__battleBotTestRig.runArenaDriveProbe(options);
    document.body.dataset.driveProbeResult = JSON.stringify(result);
    document.body.dataset.driveProbeStatus = "complete";
  } catch (error) {
    document.body.dataset.driveProbeResult = JSON.stringify({ error: error?.message || String(error) });
    document.body.dataset.driveProbeStatus = "error";
  }
}
document.addEventListener("battlebot:runDriveProbe", runDriveProbeToDom);
async function runPhysicsStabilityProbeToDom(event) {
  document.body.dataset.physicsStabilityProbeStatus = "running";
  document.body.dataset.physicsStabilityProbeResult = "";
  try {
    const options = event?.detail || {};
    const result = await window.__battleBotTestRig.runPhysicsStabilityProbe(options);
    document.body.dataset.physicsStabilityProbeResult = JSON.stringify(result);
    document.body.dataset.physicsStabilityProbeStatus = "complete";
  } catch (error) {
    document.body.dataset.physicsStabilityProbeResult = JSON.stringify({ error: error?.message || String(error) });
    document.body.dataset.physicsStabilityProbeStatus = "error";
  }
}
document.addEventListener("battlebot:runPhysicsStabilityProbe", runPhysicsStabilityProbeToDom);
async function runPhysicsFocusedProbeToDom() {
  document.body.dataset.physicsFocusedProbeStatus = "running";
  document.body.dataset.physicsFocusedProbeResult = "";
  try {
    const result = {
      rosterDrive: await window.__battleBotTestRig.runPhysicsRosterDriveProbe(),
      broncoSelfRight: await window.__battleBotTestRig.runBroncoSelfRightProbe(),
      invertedDrive: await window.__battleBotTestRig.runPhysicsInvertedDriveProbe(),
      angleRecovery: await window.__battleBotTestRig.runPhysicsAngleRecoveryProbe(),
      broncoUnderFlip: await window.__battleBotTestRig.runBroncoUnderFlipProbe(),
    };
    document.body.dataset.physicsFocusedProbeResult = JSON.stringify(result);
    document.body.dataset.physicsFocusedProbeStatus = "complete";
  } catch (error) {
    document.body.dataset.physicsFocusedProbeResult = JSON.stringify({ error: error?.message || String(error) });
    document.body.dataset.physicsFocusedProbeStatus = "error";
  }
}
document.addEventListener("battlebot:runPhysicsFocusedProbe", runPhysicsFocusedProbeToDom);
function runPhysicalDamageProbeToDom() {
  document.body.dataset.physicalDamageProbeStatus = "running";
  document.body.dataset.physicalDamageProbeResult = "";
  try {
    const wasPhysicalDamage = Boolean(physicalDamageToggleInput?.checked);
    const previousHitsRequired = physicalDamageHitsRequiredInput?.value;
    if (physicalDamageToggleInput) physicalDamageToggleInput.checked = true;
    if (physicalDamageHitsRequiredInput) physicalDamageHitsRequiredInput.value = "2";
    if (physicalDamageHitsRequiredValue) physicalDamageHitsRequiredValue.value = "2";
    syncPhysicsModeUi();
    syncDamageVisibility();
    if (mode !== "arena") setMode("arena");
    let attempts = 0;
    const runWhenArenaReady = () => {
      try {
        const fighter = arena?.fighters?.[1] || arena?.fighters?.[0];
        const hasDamageableMesh = Boolean(fighter?.group) && fighterGeometryMeshes(fighter).length > 0;
        const stillLoading = document.body.dataset.loading === "true";
        if ((!fighter?.rb || !hasDamageableMesh || stillLoading) && attempts < 50) {
          attempts += 1;
          window.setTimeout(runWhenArenaReady, 250);
          return;
        }
        if (!fighter?.rb) throw new Error("No arena fighter available");
        if (!hasDamageableMesh) throw new Error("No damageable mesh available");
        if (physicalDamageToggleInput) physicalDamageToggleInput.checked = true;
        if (physicalDamageHitsRequiredInput) physicalDamageHitsRequiredInput.value = "2";
        if (physicalDamageHitsRequiredValue) physicalDamageHitsRequiredValue.value = "2";
        syncPhysicsModeUi();
        syncDamageVisibility();
        const p = fighter.rb.translation();
        const q = fighter.rb.rotation();
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w));
        const point = new THREE.Vector3(p.x, p.y + 0.45, p.z).addScaledVector(forward, 0.55);
        const gateBeforeHit = {
          damage: damageEnabled(),
          physicalToggle: physicalDamageToggleInput?.checked === true,
          physical: physicalDamageEnabled(),
          meshes: fighterGeometryMeshes(fighter).length,
        };
        const hit = {
          amount: 120,
          point,
          normal: forward.clone().negate(),
          kind: "physicalDamageProbe",
          source: "probe",
        };
        recordBotDamage(fighter, hit);
        const afterPrime = {
          pieces: fighter.physicalDamagePieces || 0,
          primed: fighter.physicalDamagePrimedBreaks?.filter((candidate) => !candidate.committed).length || 0,
          lastResult: fighter.physicalDamageLastResult || null,
        };
        recordBotDamage(fighter, hit);
        let settleAttempts = 0;
        const finishWhenSettled = () => {
          const solidFillCounts = { body: 0, debris: 0 };
          arena?.root?.traverse?.((child) => {
            if (child.name === "physicalDamageColliderSolidFill") solidFillCounts.body += 1;
            if (child.name === "physicalDamageDebrisSolidFill") solidFillCounts.debris += 1;
          });
          const result = {
            id: fighter.spec?.id,
            gateBeforeHit,
            afterPrime,
            pieces: fighter.physicalDamagePieces || 0,
            primed: fighter.physicalDamagePrimedBreaks?.filter((candidate) => !candidate.committed).length || 0,
            lastResult: fighter.physicalDamageLastResult || null,
            colliderAdjustment: fighter.physicalDamageLastColliderAdjustment || null,
            systemLoss: {
              leftDrive: physicalDamageSystemLossPercent(fighter, "leftDrive"),
              rightDrive: physicalDamageSystemLossPercent(fighter, "rightDrive"),
              weapon: physicalDamageSystemLossPercent(fighter, "weapon"),
              leftSide: physicalDamageSystemLossPercent(fighter, "leftSide"),
              centerSide: physicalDamageSystemLossPercent(fighter, "centerSide"),
              rightSide: physicalDamageSystemLossPercent(fighter, "rightSide"),
              threshold: physicalDamageFailureThreshold(),
            },
            debrisProps: arena?.props?.filter((prop) => prop.kind === "botDamagePiece").length || 0,
            debrisColliders: arena?.props
              ?.filter((prop) => prop.kind === "botDamagePiece")
              .map((prop) => ({ colliderCount: prop.colliderCount || 0, handles: prop.colliderHandles?.length || 0 })) || [],
            solidFillCounts,
            damageTotal: fighter.damageTotal || 0,
          };
          const stillCalculating = result.lastResult?.status === "calculating" || result.lastResult?.status === "queued";
          if (!result.pieces && (stillCalculating || result.primed > 0) && settleAttempts < 60) {
            settleAttempts += 1;
            window.setTimeout(finishWhenSettled, 100);
            return;
          }
          document.body.dataset.physicalDamageProbeResult = JSON.stringify(result);
          document.body.dataset.physicalDamageProbeStatus = "complete";
        };
        finishWhenSettled();
      } catch (error) {
        document.body.dataset.physicalDamageProbeResult = JSON.stringify({ error: error?.message || String(error) });
        document.body.dataset.physicalDamageProbeStatus = "error";
      } finally {
        if (physicalDamageToggleInput) physicalDamageToggleInput.checked = wasPhysicalDamage;
        if (physicalDamageHitsRequiredInput && previousHitsRequired !== undefined) physicalDamageHitsRequiredInput.value = previousHitsRequired;
        if (physicalDamageHitsRequiredValue && previousHitsRequired !== undefined) physicalDamageHitsRequiredValue.value = previousHitsRequired;
        syncPhysicsModeUi();
        syncDamageVisibility();
      }
    };
    window.setTimeout(runWhenArenaReady, 250);
  } catch (error) {
    document.body.dataset.physicalDamageProbeResult = JSON.stringify({ error: error?.message || String(error) });
    document.body.dataset.physicalDamageProbeStatus = "error";
  }
}
document.addEventListener("battlebot:runPhysicalDamageProbe", runPhysicalDamageProbeToDom);
const physicsProbeButton = document.createElement("button");
physicsProbeButton.id = "physics-probe-runner";
physicsProbeButton.type = "button";
physicsProbeButton.textContent = "Run physics probe";
physicsProbeButton.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.001;z-index:1;padding:0;border:0;overflow:hidden;";
physicsProbeButton.addEventListener("click", runPhysicsProbeToDom);
document.body.append(physicsProbeButton);
const driveProbeButton = document.createElement("button");
driveProbeButton.id = "drive-probe-runner";
driveProbeButton.type = "button";
driveProbeButton.textContent = "Run drive probe";
driveProbeButton.style.cssText = "position:fixed;left:3px;top:0;width:2px;height:2px;opacity:0.001;z-index:1;padding:0;border:0;overflow:hidden;";
driveProbeButton.addEventListener("click", () => runDriveProbeToDom({
  detail: { playerId: "bronco", rivalId: "biteforce", frames: 120, turnFrames: 80 },
}));
document.body.append(driveProbeButton);
const physicsStabilityProbeButton = document.createElement("button");
physicsStabilityProbeButton.id = "physics-stability-probe-runner";
physicsStabilityProbeButton.type = "button";
physicsStabilityProbeButton.textContent = "Run physics stability probe";
physicsStabilityProbeButton.style.cssText = "position:fixed;left:6px;top:0;width:2px;height:2px;opacity:0.001;z-index:1;padding:0;border:0;overflow:hidden;";
physicsStabilityProbeButton.addEventListener("click", runPhysicsStabilityProbeToDom);
document.body.append(physicsStabilityProbeButton);
const physicsFocusedProbeButton = document.createElement("button");
physicsFocusedProbeButton.id = "physics-focused-probe-runner";
physicsFocusedProbeButton.type = "button";
physicsFocusedProbeButton.textContent = "Run physics focused probe";
physicsFocusedProbeButton.style.cssText = "position:fixed;left:10px;top:0;width:2px;height:2px;opacity:0.001;z-index:1;padding:0;border:0;overflow:hidden;";
physicsFocusedProbeButton.addEventListener("click", runPhysicsFocusedProbeToDom);
document.body.append(physicsFocusedProbeButton);
const physicalDamageProbeButton = document.createElement("button");
physicalDamageProbeButton.id = "physical-damage-probe-runner";
physicalDamageProbeButton.type = "button";
physicalDamageProbeButton.textContent = "Run Physical Damage probe";
physicalDamageProbeButton.style.cssText = "position:fixed;left:14px;top:0;width:2px;height:2px;opacity:0.001;z-index:1;padding:0;border:0;overflow:hidden;";
physicalDamageProbeButton.addEventListener("click", runPhysicalDamageProbeToDom);
document.body.append(physicalDamageProbeButton);

createPicker();
subscribeOnlineLobby();
syncPhysicsModeUi();
syncDamageVisibility();
syncArenaObjectControls();
restoreLastPhysicsLog();
bindImmediateControlFeedback(panel || document);
loadBotModel(selected.id, { foreground: true }).finally(startLazyModelQueue);
setSelected(selected);
setMode("viewer");
updateSceneLayout();
RAPIER.init().then(() => {
  rapierReady = true;
  if (mode === "arena") buildArena({ runIntro: Boolean(fightIntro) });
});
animate();

modeButtons.forEach((button) => button.addEventListener("click", () => setMode(button.dataset.mode)));
battleToggleButton?.addEventListener("click", () => {
  if (mode === "arena") {
    setMode("viewer");
    return;
  }
  startArenaFromViewerIntro();
});
opponentSelect.addEventListener("change", () => {
  if (onlineIsActive()) {
    opponentSelect.value = opponent.id;
    onlineSetMessage("Opponent is locked during online play");
    return;
  }
  opponent = bots.find((bot) => bot.id === opponentSelect.value) || opponent;
  syncBotUrlState();
  if (mode === "viewer") preloadArenaFighterModels({ foreground: false });
  if (mode === "arena") buildArena();
});
arenaObjectModeSelect?.addEventListener("change", () => {
  syncArenaObjectControls();
  if (mode === "arena") buildArena();
});
bindRangeNumber(arenaObjectCountInput, arenaObjectCountNumberInput, () => {
  if (mode === "arena") buildArena();
});
spinnerKnockbackToggleInput?.addEventListener("change", syncPhysicsModeUi);
plowDefenceToggleInput?.addEventListener("change", syncPhysicsModeUi);
showAllBotsInput?.addEventListener("change", syncGameBotVisibility);
teeterAssistToggleInput?.addEventListener("change", syncPhysicsModeUi);
softFloorCorrectionToggleInput?.addEventListener("change", syncPhysicsModeUi);
enableDamageToggleInput?.addEventListener("change", () => {
  syncDamageVisibility();
  syncArenaObjectControls();
  syncPhysicsModeUi();
  if (mode === "arena") buildArena();
});
physicalDamageToggleInput?.addEventListener("change", () => {
  syncDamageVisibility();
  syncPhysicsModeUi();
});
showDamageEventsInput?.addEventListener("change", updateDamageEventHud);
colliderComToggleInput?.addEventListener("change", () => {
  syncPhysicsModeUi();
  if (mode === "arena") buildArena();
});
physicsLogToggleButton?.addEventListener("click", () => {
  if (physicsLogRecorder.active) stopPhysicsLogRecording();
  else startPhysicsLogRecording();
});
bindRangeNumber(cameraDistanceInput, cameraDistanceNumberInput);
bindRangeNumber(cameraHeightInput, cameraHeightNumberInput);
bindRangeNumber(arenaFovInput, arenaFovNumberInput);
bindRangeNumber(lightingInput, lightingNumberInput);
bindRangeNumber(gravityInput, gravityNumberInput, applyArenaGravity);
bindRangeNumber(groundSpeedInput, groundSpeedValue, () => applySelectedBotTuning("maxSpeed"));
bindRangeNumber(driveAccelerationInput, driveAccelerationValue, () => applySelectedBotTuning("driveAcceleration"));
bindRangeNumber(turningTightnessInput, turningTightnessValue, () => applySelectedBotTuning("turningTightness"));
bindRangeNumber(yawDampingInput, yawDampingValue, () => applySelectedBotTuning("yawDamping"));
bindRangeNumber(weaponSpinupInput, weaponSpinupValue, () => applySelectedBotTuning("weaponSpinUpSeconds"));
bindRangeNumber(spinnerImpactCapInput, spinnerImpactCapValue, () => applySelectedBotTuning("spinnerImpactCap"));
bindRangeNumber(spinnerImpactScaleInput, spinnerImpactScaleValue, () => applySelectedBotTuning("spinnerImpactScale"));
bindRangeNumber(spinnerGyroScaleInput, spinnerGyroScaleValue, () => applySelectedBotTuning("spinnerGyroScale"));
bindRangeNumber(physicalDamageThresholdInput, physicalDamageThresholdValue, syncDamageVisibility);
bindRangeNumber(physicalDamageHitsRequiredInput, physicalDamageHitsRequiredValue, syncDamageVisibility);
bindRangeNumber(physicalDamageResilienceInput, physicalDamageResilienceValue, syncDamageVisibility);
bindRangeNumber(physicalDamageRadiusInput, physicalDamageRadiusValue, syncDamageVisibility);
bindRangeNumber(physicalDamageMatchRadiusInput, physicalDamageMatchRadiusValue, syncDamageVisibility);
bindRangeNumber(physicalDamageMaxRadiusInput, physicalDamageMaxRadiusValue, syncDamageVisibility);
bindRangeNumber(physicalDamageMaxMatchRadiusInput, physicalDamageMaxMatchRadiusValue, syncDamageVisibility);
bindRangeNumber(physicalDamageMaxRadiusMultiplierInput, physicalDamageMaxRadiusMultiplierValue, syncDamageVisibility);
bindRangeNumber(physicalDamageImpulseInput, physicalDamageImpulseValue, syncDamageVisibility);
bindRangeNumber(physicalDamageMaxPiecesInput, physicalDamageMaxPiecesValue, syncDamageVisibility);
bindRangeNumber(physicalDamageFailureThresholdInput, physicalDamageFailureThresholdValue, syncDamageVisibility);
physicalDamageConvexInput?.addEventListener("change", syncDamageVisibility);
botWeightInput?.addEventListener("input", () => applySelectedBotTuning("weightLbs"));
weaponWeightInput?.addEventListener("input", () => applySelectedBotTuning("weaponWeightLbs"));
controlSchemeSelect?.addEventListener("change", () => applySelectedBotTuning("controlScheme"));
weaponRotationalInertiaInput?.addEventListener("input", () => applySelectedBotTuning("weaponRotationalInertia"));
spinnerImpactCapEnabledInput?.addEventListener("change", () => applySelectedBotTuning("spinnerImpactCapEnabled"));
showCollidersInput?.addEventListener("change", syncGlobalColliderOverlay);
colliderViewModeSelect?.addEventListener("change", syncGlobalColliderOverlay);
testHapticsButton?.addEventListener("click", runHapticsTest);
debugInfo?.addEventListener("toggle", () => {
  debugInfoOpenByBot.set(selected.id, debugInfo.open);
  syncDebugInfoControls();
});
arenaResetButton?.addEventListener("click", () => {
  restartArenaMatch();
});
hostArenaButton?.addEventListener("click", () => {
  hostOnlineArena().catch((error) => {
    console.error(error);
    stopOnlineSession({ notify: false, message: `Could not host arena: ${error?.message || error}` });
  });
});
joinArenaButton?.addEventListener("click", () => {
  joinOnlineArena().catch((error) => {
    console.error(error);
    stopOnlineSession({ notify: false, message: `Could not join arena: ${error?.message || error}` });
  });
});
leaveOnlineButton?.addEventListener("click", () => stopOnlineSession({ notify: true }));
cameraModeSelect?.addEventListener("change", () => {
  cameraModeExplicitlySet = true;
  if (mode === "arena") {
    if (cameraModeSelect.value === "arena") {
      setDefaultArenaOrbit();
    } else if (cameraModeSelect.value === "battle") {
      battleCameraPosition.set(ARENA_HALF_WIDTH - CAMERA_BOUND_PADDING, 5.4, 0);
      battleCameraTarget.set(0, 1.1, 0);
      battleCameraYawOffset = 0;
      battleCameraPitchOffset = 0;
      battleCameraDistanceOffset = 0;
      battleCameraPanOffset.set(0, 0, 0);
      lastCameraInputAt = 0;
    } else {
      followCameraYawOffset = 0;
      followCameraPitchOffset = 0;
      followCameraYaw = orbitYaw;
      followCameraNeedsSnap = true;
    }
  }
  syncCameraControls();
});
const gameKeyCodes = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "Space", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"]);
window.addEventListener("keydown", (event) => {
  if (gameKeyCodes.has(event.code)) event.preventDefault();
  if (event.code === "Escape" && !event.repeat) toggleArenaPaused();
  keys.add(event.code);
});
window.addEventListener("keyup", (event) => {
  if (gameKeyCodes.has(event.code)) event.preventDefault();
  keys.delete(event.code);
});
window.addEventListener("resize", () => {
  updateSceneLayout();
});
window.addEventListener("beforeunload", () => {
  if (!onlineIsActive()) return;
  try {
    if (online.role === "host") online.room?.publishTopic("hostStopped", { clientId: onlineClientId });
    else online.room?.publishTopic("playerLeft", { clientId: onlineClientId, role: online.role });
    if (online.role === "host" && online.recordId) {
      onlineDb.transact(onlineDb.tx[ONLINE_ROOM_ENTITY][online.recordId].update({ status: "closed", updatedAt: Date.now() }));
    }
  } catch {
    // Best-effort cleanup during page teardown.
  }
});
panelToggle?.addEventListener("click", (event) => {
  event.stopPropagation();
  setPanelCollapsed(!document.body.classList.contains("panel-collapsed"));
});
panel?.addEventListener("click", (event) => {
  if (!document.body.classList.contains("panel-collapsed")) return;
  if (event.target === panel || event.target.closest(".brand")) setPanelCollapsed(false);
});
fullscreenToggleButton?.addEventListener("click", toggleFullscreen);
function syncSoundToggleButton() {
  if (!soundToggleButton) return;
  const active = isSoundEnabled();
  soundToggleButton.textContent = active ? "Sound: On" : "Sound: Off";
  soundToggleButton.setAttribute("aria-pressed", String(active));
}
soundToggleButton?.addEventListener("click", () => {
  setSoundEnabled(!isSoundEnabled());
  syncSoundToggleButton();
  music.setEnabled(isSoundEnabled());
  // Turning sound on mid-match should pick the music back up where the round is.
  if (isSoundEnabled() && mode === "arena" && arena && !arena.roundOver) {
    music.play(fightIntro ? "countdown" : "battle", { loop: !fightIntro });
  }
});
syncSoundToggleButton();
document.addEventListener("fullscreenchange", () => {
  syncFullscreenButton();
  updateSceneLayout();
});
canvas.addEventListener("pointerdown", (event) => {
  mouseDown = true;
  panMode = event.shiftKey || event.button === 1 || event.button === 2;
  lastCameraInputAt = performance.now();
  lastPointer.set(event.clientX, event.clientY);
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!mouseDown) return;
  const dx = event.clientX - lastPointer.x;
  const dy = event.clientY - lastPointer.y;
  const cameraMode = mode === "arena" ? cameraModeSelect?.value || "arena" : "viewer";
  lastCameraInputAt = performance.now();
  if (panMode || event.shiftKey) {
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const scale = (cameraMode === "bot"
      ? pairedRangeNumberValue(cameraDistanceInput, cameraDistanceNumberInput, GAME_CONFIG.ui.cameraDistance)
      : orbitDistance) * 0.0012;
    if (cameraMode === "battle") {
      battleCameraPanOffset.addScaledVector(right, -dx * scale);
      battleCameraPanOffset.addScaledVector(up, dy * scale);
    } else if (cameraMode === "bot") {
      followCameraPitchOffset = THREE.MathUtils.clamp(followCameraPitchOffset + dy * 0.012, -1.4, 1.8);
    } else {
      orbitTarget.addScaledVector(right, -dx * scale);
      orbitTarget.addScaledVector(up, dy * scale);
      clampArenaTarget();
    }
  } else {
    const yawDelta = -dx * 0.006;
    const pitchDirection = invertOrbitYInput?.checked ? 1 : -1;
    const pitchDelta = dy * 0.005 * pitchDirection;
    if (cameraMode === "battle") {
      battleCameraYawOffset += yawDelta;
      battleCameraPitchOffset = THREE.MathUtils.clamp(battleCameraPitchOffset + pitchDelta * 5.5, -1.8, 1.8);
    } else if (cameraMode === "bot") {
      followCameraYawOffset += yawDelta;
      followCameraPitchOffset = THREE.MathUtils.clamp(followCameraPitchOffset + pitchDelta * 3.6, -1.4, 1.8);
    } else {
      orbitYaw += yawDelta;
      const maxPitch = mode === "arena" ? 0.72 : 1.1;
      orbitPitch = THREE.MathUtils.clamp(orbitPitch + pitchDelta, -0.18, maxPitch);
    }
  }
  lastPointer.set(event.clientX, event.clientY);
});
canvas.addEventListener("pointerup", () => {
  mouseDown = false;
  panMode = false;
});
canvas.addEventListener("contextmenu", (event) => event.preventDefault());
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    lastCameraInputAt = performance.now();
    const cameraMode = mode === "arena" ? cameraModeSelect?.value || "arena" : "viewer";
    if (mode === "arena" && cameraMode === "bot" && cameraDistanceInput) {
      const nextDistance = THREE.MathUtils.clamp(
        pairedRangeNumberValue(cameraDistanceInput, cameraDistanceNumberInput, GAME_CONFIG.ui.cameraDistance) + event.deltaY * 0.008,
        Number(cameraDistanceInput.min),
        Number(cameraDistanceInput.max),
      );
      syncRangeNumber(cameraDistanceInput, cameraDistanceNumberInput, nextDistance.toFixed(1));
      return;
    }
    if (mode === "arena" && cameraMode === "battle") {
      battleCameraDistanceOffset = THREE.MathUtils.clamp(battleCameraDistanceOffset + event.deltaY * 0.008, -3.2, 4.5);
      return;
    }
    if (mode === "arena") {
      dollyArenaOrbit(event.deltaY);
      return;
    }
    const maxDistance = mode === "arena" ? 13.5 : 18;
    orbitDistance = THREE.MathUtils.clamp(orbitDistance + event.deltaY * 0.004, 2.4, maxDistance);
  },
  { passive: false },
);
