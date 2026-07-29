// BattleBot Arena v2 — boot + wiring. Owns the frame loop and connects
// ui ← game ← sim through the shared event bus. See ARCHITECTURE.md.
import * as THREE from "three";
import { createEventBus, EV } from "./shared/events.js";
import { settings } from "./shared/settings.js";
import { createRenderer } from "./engine/renderer.js";
import { createCameraDirector, createChaseCamera } from "./engine/cameras.js";
import { createEffects } from "./engine/effects.js";
import { createArenaVisuals } from "./engine/arena.js";

// Written by the parallel build agents; wired here at integration time.
import { createUI } from "./ui/ui.js";
import { createLoader } from "./ui/loader.js";
import { getBotSpec } from "./assets/catalog.js";
import { loadBotModel, weaponVisualAngle } from "./assets/models.js";
import { createSim } from "./sim/sim.js";
import { createMatch } from "./game/match.js";
import { computeAiInput, resetAiState } from "./game/ai.js";
import { createInput } from "./game/input.js";
import { createGameAudio } from "./game/audio.js";
import { createMusic } from "./game/music.js";

const bus = createEventBus();
const stage = createRenderer(document.querySelector("#scene"));
const cameraDirector = createCameraDirector(stage.camera);
const chaseCameraA = createChaseCamera(stage.camera);
const chaseCameraB = createChaseCamera(stage.cameraB);
const effects = createEffects(stage.scene);
const input = createInput({ on: bus.on, playerIndex: 0, gamepadIndex: 0 });
// Second local player: activates automatically whenever a second gamepad is
// connected; otherwise the rival stays AI-driven.
const inputP2 = createInput({ on: bus.on, playerIndex: 1, gamepadIndex: 1 });
// Music is app-level, not per-session: it follows EV.MATCH phases on the bus.
const music = createMusic(bus);

const loader = createLoader();
let arenaVisuals = null;
let session = null; // { sim, match, botVisuals: [{group, parts, spec}], raf }
let paused = false;
const pauseOverlay = document.querySelector("#pause-overlay");
const clock = new THREE.Clock();

function setPaused(value) {
  paused = Boolean(value);
  session?.sim.setPaused?.(paused);
  if (pauseOverlay) pauseOverlay.hidden = !paused;
  // Music dips instead of stopping so unpause feels seamless.
  music.player.setDuck?.(paused ? 0.25 : 1, 0.3);
  // Tell the HUD so its wall-time clock freezes/resumes with the match.
  const matchState = session?.match.getState?.();
  bus.emit(EV.MATCH, {
    phase: matchState?.phase ?? "fight",
    paused,
    timeRemaining: matchState?.timeRemaining ?? undefined,
  });
}

// Pause menu + fullscreen chrome ---------------------------------------------
document.querySelector("#btn-pause-resume")?.addEventListener("click", () => setPaused(false));
document.querySelector("#btn-pause-settings")?.addEventListener("click", () => {
  // The settings modal is global; the title screen's opener works from anywhere.
  document.querySelector("#btn-title-settings")?.click();
});
document.querySelector("#btn-pause-exit")?.addEventListener("click", async () => {
  setPaused(false);
  music.player.stop({ fadeOut: 0.5 });
  await endMatch();
  ui.goTo?.("title");
});
document.querySelector("#btn-fullscreen")?.addEventListener("click", () => {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.();
});

// --- Event routing: sim/game events → effects, camera shake ---------------
// event.force is a Rapier contact force (thousands); relSpeed (ft/s) is the
// better perceptual measure for shake/sparks.
bus.on(EV.IMPACT, (event) => {
  const strength = Math.min(1, Math.max(0, ((event.relSpeed || 0) - 5) / 16));
  if (strength > 0.1) {
    effects.spawnSparks(event.point, Math.round(6 + strength * 14), 5 + strength * 5);
    cameraDirector.addShake(strength * 0.4);
  }
});
bus.on(EV.WEAPON_HIT, (event) => {
  const strength = Math.min(1, (event.impulse || 0) / 150);
  effects.spawnSparks(event.point, Math.round(16 + strength * 26), 7 + strength * 8);
  if (strength > 0.4) effects.spawnDebris(event.point, Math.round(1 + strength * 3));
  cameraDirector.addShake(0.2 + strength * 0.65);
});
bus.on(EV.HAZARD_CONTACT, (event) => {
  effects.spawnSparks(event.point, 6, 6);
});
bus.on(EV.HAZARD_LAUNCH, (event) => {
  effects.spawnSparks(event.point, 26, 9);
  cameraDirector.addShake(0.5);
});
bus.on(EV.PART_BREAK, (event) => {
  effects.spawnDebris(event.point, 4);
  cameraDirector.addShake(0.4);
});

// --- Match session lifecycle ----------------------------------------------
/** Yield to the browser so the loading overlay actually paints between the
 *  synchronous chunks of match setup (model parsing, the settle loop). */
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

async function startMatch({ playerBotId, rivalBotId, difficulty }) {
  await endMatch();
  const specs = [getBotSpec(playerBotId), getBotSpec(rivalBotId)];

  // Bot models are the long pole: 10-17MB each, and both are needed before the
  // match can start. Aggregate the two downloads into one bar; if either
  // response has no content-length (chunked/gzipped) the whole bar goes
  // indeterminate rather than reporting a half-truth.
  loader.show({ title: "Loading Bots", detail: `${specs[0].name} vs ${specs[1].name}`, progress: 0 });
  const modelProgress = [0, 0];
  const reportModels = () => {
    const known = modelProgress.every((p) => typeof p === "number");
    // Models occupy the first 80% of the bar; setup takes the rest.
    loader.setProgress(known ? ((modelProgress[0] + modelProgress[1]) / 2) * 0.8 : null);
  };
  const botVisuals = await Promise.all(
    specs.map((spec, i) =>
      loadBotModel(spec, {
        onProgress: (fraction) => {
          modelProgress[i] = fraction;
          reportModels();
        },
      }).then((visual) => {
        modelProgress[i] = 1;
        reportModels();
        return visual;
      })
    )
  );
  botVisuals.forEach((visual) => stage.scene.add(visual.group));

  loader.setTitle("Preparing Arena");
  loader.setDetail("Building the arena");
  loader.setProgress(0.84);
  await nextFrame();
  if (!arenaVisuals) arenaVisuals = createArenaVisuals(stage.scene);

  loader.setDetail("Starting physics");
  loader.setProgress(0.9);
  await nextFrame();
  const sim = await createSim({ bots: specs, emit: bus.emit });
  const match = createMatch({ sim, specs, emit: bus.emit, on: bus.on });
  const audio = createGameAudio(bus, { specs });
  audio.setListenerProvider?.(() => stage.camera);
  resetAiState();
  weaponLatch[0] = weaponLatch[1] = false;
  sawActive[0] = sawActive[1] = false;
  setPaused(false);
  // Align each model's ground line with the physics floor by MEASUREMENT:
  // settle the sim silently for a moment, read where each body actually rests
  // (this captures floor-collider thickness, suspension preload, and colliders
  // that bottom out — the analytic prediction missed ~0.1 ft of it), then
  // reset to spawn. Shifting the model CONTENTS (not the group) keeps
  // rotations centered on the body.
  const idleInput = { leftDrive: 0, rightDrive: 0, weapon: false, brake: false };
  loader.setDetail("Calibrating chassis");
  loader.setProgress(0.96);
  await nextFrame();
  for (let i = 0; i < 150; i += 1) sim.stepFrame(1 / 60, [idleInput, idleInput]);
  // Average the last 30 frames so residual suspension oscillation cancels.
  const settleSum = [0, 0];
  for (let i = 0; i < 30; i += 1) {
    sim.stepFrame(1 / 60, [idleInput, idleInput]);
    const state = sim.getRenderState();
    settleSum[0] += state[0].position.y;
    settleSum[1] += state[1].position.y;
  }
  botVisuals.forEach((visual, i) => {
    const drop = settleSum[i] / 30;
    visual.__groundDrop = drop; // dev observability
    visual.group.children.forEach((child) => {
      child.position.y -= drop;
    });
  });
  sim.reset();
  session = { sim, match, botVisuals, specs, difficulty, audio };
  cameraDirector.snapTo(sim.getRenderState());
  chaseCameraA.snapTo(sim.getRenderState()[0]);
  chaseCameraB.snapTo(sim.getRenderState()[1]);
  loader.setProgress(1);
  loader.hide();
  match.start?.();
}

async function endMatch() {
  if (!session) return;
  session.match.dispose?.();
  session.audio.dispose?.();
  session.sim.dispose?.();
  session.botVisuals.forEach((visual) => stage.scene.remove(visual.group));
  session = null;
}

const ui = createUI({
  bus,
  onAction: async (action) => {
    try {
      if (action.type === "startMatch") await startMatch(action);
      else if (action.type === "rematch" && session) await startMatch({
        playerBotId: session.specs[0].id,
        rivalBotId: session.specs[1].id,
        difficulty: session.difficulty,
      });
      else if (action.type === "toTitle" || action.type === "changeBots") {
        loader.hide();
        music.player.stop({ fadeOut: 0.5 });
        await endMatch();
      }
    } catch (error) {
      // A half-built match must never leave the loading overlay up with no way
      // out — surface it and drop the player back to the roster.
      console.error("[BBA2] match setup failed", error);
      loader.hide();
      await endMatch();
      ui.goTo?.("botSelect");
    }
  },
});

// --- Frame loop ------------------------------------------------------------
const scratchAxis = new THREE.Vector3();

function syncBotVisual(visual, spec, state) {
  visual.group.position.copy(state.position);
  visual.group.quaternion.copy(state.quaternion);
  if (visual.parts.weapon && state.weaponAngle !== undefined) {
    scratchAxis.set(spec.weapon.axis.x, spec.weapon.axis.y, spec.weapon.axis.z).normalize();
    visual.parts.weapon.quaternion.setFromAxisAngle(scratchAxis, weaponVisualAngle(visual, spec, state));
  }
  // Negated: wheelSpin accumulates ground speed along forward (-Z), and a wheel
  // on the +X axle rolling the bot toward -Z turns NEGATIVE about +X. Without
  // the sign the tyres spin backwards — invisible on small dark wheels, glaring
  // on HUGE's six-foot spoked ones.
  visual.parts.wheels?.forEach((wheel, i) => {
    const spinIndex = wheel.userData.spinIndex ?? i;
    wheel.rotation.x = -(state.wheelSpin?.[spinIndex] ?? 0);
  });
  // Bronco's pneumatic ram compresses with the flipper: fully shortened at
  // rest (arm down over it), full length at the top of the stroke. The aux
  // anchor sits at the ram's base, so scaling never pokes below the mount.
  const ram = visual.parts.aux?.ram;
  if (ram && spec.weapon?.type === "flipper") {
    const stroke = THREE.MathUtils.clamp(state.weaponAngle ?? 0, 0, 1);
    ram.scale.y = 0.35 + 0.65 * stroke;
  }
}

// Nested sub-spinner inside a weapon arm (Sawblaze's saw, Whiplash's disc).
// Spins up while the RB toggle is on, coasts down when off; rides the arm's
// swing either way.
// Negative: the disc cuts on the DOWNSWING, so the teeth travel toward the
// target as the arm chops rather than away from it.
const SAW_DISC_SPEED = -67.2; // rad/s at full speed (was 42, +60%)
function updateWeaponSub(visual, spec, slot, dt, active) {
  const sub = visual.parts.weaponSub;
  if (!sub || !["hammerSaw", "lifterDisc"].includes(spec.weapon?.type)) return;
  const state = (visual.__subSpin ||= { angle: 0, speed: 0 });
  const target = active ? SAW_DISC_SPEED : 0;
  state.speed += (target - state.speed) * Math.min(1, dt * (active ? 2.2 : 1.1));
  state.angle += state.speed * dt;
  scratchAxis.set(spec.weapon.axis.x, spec.weapon.axis.y, spec.weapon.axis.z).normalize();
  sub.quaternion.setFromAxisAngle(scratchAxis, state.angle);
}

// --- Player weapon semantics (v1 parity) -----------------------------------
// Spinners (bar/drum): RT/Space TOGGLES the spinner on press. Flipper: press
// to fire (momentary). Crusher: hold to bite. HammerSaw: RT held swings the
// arm forward; RB toggles the saw motor (drives audio + the disc feel).
const weaponLatch = [false, false];
const sawActive = [false, false];
const prevWeaponDown = [false, false];
const prevAltDown = [false, false];
let splitActive = false;

function shapePlayerInput(raw, spec, slot) {
  const type = spec.weapon?.type;
  const weaponEdge = raw.weapon && !prevWeaponDown[slot];
  const altEdge = raw.weaponAlt && !prevAltDown[slot];
  prevWeaponDown[slot] = raw.weapon;
  prevAltDown[slot] = raw.weaponAlt;
  if (type === "bar" || type === "drum") {
    if (weaponEdge) weaponLatch[slot] = !weaponLatch[slot];
    return { ...raw, weapon: weaponLatch[slot] };
  }
  // hammerSaw and lifterDisc both split their controls: the trigger drives the
  // arm, RB toggles the disc motor.
  if (type === "hammerSaw" || type === "lifterDisc") {
    if (altEdge) sawActive[slot] = !sawActive[slot];
    return { ...raw, sawActive: sawActive[slot] };
  }
  return raw; // flipper fires on press, crusher bites while held
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (session) {
    const rawP1 = input.readInput();
    const p2Human = inputP2.hasGamepad();
    const rawP2 = p2Human ? inputP2.readInput() : null;
    if (rawP1.pausePressed || rawP2?.pausePressed) setPaused(!paused);

    if (!paused) {
      const renderNow = session.sim.getRenderState();
      const inputs = [
        shapePlayerInput(rawP1, session.specs[0], 0),
        p2Human
          ? shapePlayerInput(rawP2, session.specs[1], 1)
          : computeAiInput(renderNow[1], renderNow[0], session.specs[1], session.difficulty, dt),
      ];
      const filtered = session.match.filterInputs ? session.match.filterInputs(inputs) : inputs;
      session.sim.stepFrame(dt, filtered);
      session.match.update?.(dt);
      session.audio.updateFrame?.(filtered, renderNow);
      filtered.forEach((filteredInput, i) => updateWeaponSub(session.botVisuals[i], session.specs[i], i, dt, Boolean(filteredInput?.sawActive)));
    }

    const renderState = session.sim.getRenderState();
    renderState.forEach((state, i) => syncBotVisual(session.botVisuals[i], session.specs[i], state));
    arenaVisuals?.updateHazards(session.sim.getHazardState?.(), paused ? 0 : dt);

    // Split-screen when both players are human AND bot camera is selected;
    // otherwise the single director camera runs.
    splitActive = p2Human && settings.cameraMode === "bot";
    const mid = {
      x: (renderState[0].position.x + renderState[1].position.x) / 2,
      y: 0.6,
      z: (renderState[0].position.z + renderState[1].position.z) / 2,
    };
    if (splitActive) {
      chaseCameraA.update(dt, renderState[0]);
      chaseCameraB.update(dt, renderState[1]);
      // Both viewports contribute: a wall blocking EITHER player's shot hides.
      arenaVisuals?.updateVisibility([
        { position: stage.camera.position, target: renderState[0].position },
        { position: stage.cameraB.position, target: renderState[1].position },
      ]);
    } else if (settings.cameraMode === "bot") {
      // Single-player bot cam uses the same v1-damped chase as split screen.
      chaseCameraA.update(dt, renderState[0]);
      arenaVisuals?.updateVisibility({ position: stage.camera.position, target: renderState[0].position });
    } else {
      cameraDirector.update(dt, renderState);
      arenaVisuals?.updateVisibility({ position: stage.camera.position, target: mid });
    }
  } else {
    splitActive = false;
    cameraDirector.update(dt, null);
  }
  effects.update(paused ? 0 : dt);
  if (splitActive) stage.renderSplit();
  else stage.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// Dev observability: lets the browser console inspect the live session.
window.__bba2 = {
  get session() {
    return session;
  },
  get renderState() {
    return session?.sim.getRenderState();
  },
  get matchState() {
    return session?.match.getState?.();
  },
  camera: stage.camera,
};
