// BattleBot Arena v2 — boot + wiring. Owns the frame loop and connects
// ui ← game ← sim through the shared event bus. See ARCHITECTURE.md.
import * as THREE from "three";
import { createEventBus, EV } from "./shared/events.js";
import { settings } from "./shared/settings.js";
import { createRenderer } from "./engine/renderer.js";
import { createCameraDirector, createChaseCamera } from "./engine/cameras.js";
import { createEffects, spawnBotFlame } from "./engine/effects.js";
import { createArenaVisuals } from "./engine/arena.js";
import { createBotPreview } from "./engine/botPreview.js";
import { syncBotVisual, updateWeaponSub } from "./engine/botAnimation.js";
import { buildTrackParts } from "./engine/tracks.js";

// Written by the parallel build agents; wired here at integration time.
import { createUI } from "./ui/ui.js";
import { createLoader } from "./ui/loader.js";
import { getBotSpec } from "./assets/catalog.js";
import { loadBotModel } from "./assets/models.js";
import { createSim } from "./sim/sim.js";
import { createMatch } from "./game/match.js";
import { computeAiInput, resetAiState } from "./game/ai.js";
import { createInput } from "./game/input.js";
import { createGameAudio } from "./game/audio.js";
import { createMusic } from "./game/music.js";
import { PAUSE_DUCK } from "./shared/musicPlayer.js";
import { CONFIG } from "./config.js";
import { createWeaponInputShaper } from "./game/weaponControls.js";

const bus = createEventBus();
const stage = createRenderer(document.querySelector("#scene"));
const cameraDirector = createCameraDirector(stage.camera);
// One chase camera per local player. chaseCameras[0] drives stage.camera (the
// same object the director uses when nobody is split-screening), so player one
// keeps the audio listener and the wall-culling reference wherever they are.
const chaseCameras = stage.playerCameras.map((camera) => createChaseCamera(camera));
// The odd cell in a three-player grid: a wide shot of the whole fight, pinned
// to battle framing regardless of what the camera setting says.
const overviewDirector = createCameraDirector(stage.overviewCamera, { forceMode: "battle" });
const effects = createEffects(stage.scene);
// LOCAL PLAYERS. One per pad, up to four; a player exists exactly when their
// pad is plugged in. Player one also has the keyboard, which is why a match
// with no pads at all is still playable — bot 1 stays AI-driven there.
const inputs = [0, 1, 2, 3].map((i) => createInput({ on: bus.on, playerIndex: i, gamepadIndex: i }));
const input = inputs[0];

/** Pads connected right now, dense — the same order game/input.js indexes by. */
function padCount() {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return 0;
  return Array.from(navigator.getGamepads() || []).filter(Boolean).length;
}
/** How many machines a match started NOW would have. Three and four pads make
 *  three- and four-way fights; anything less is the classic pair. There is no
 *  AI for the extra slots by design — a third machine exists because a third
 *  person is holding a controller. */
function matchBotCount() {
  return Math.min(4, Math.max(2, padCount()));
}
// Music is app-level, not per-session: it follows EV.MATCH phases on the bus.
const music = createMusic(bus);

const loader = createLoader();
// 3D showcase on the bot select screen: each chosen bot renders on a lit
// turntable inside its pod. ui.js only emits selection actions; the routing
// to this module happens below (UI never imports three.js).
// The pod is a showcase and a controller test bench, nothing more: its weapons
// run off the pad's own triggers, the same ones the match reads. It used to
// carry three on-screen test buttons as well, which could only ever cover the
// channels someone remembered to add a button for — Dragon King has four
// mechanisms and there were three buttons.
const podEls = (side) => ({
  view: document.querySelector(`#pod-view-${side}`),
  controls: document.querySelector(`#pod-controls-${side}`),
  poster: document.querySelector(`#pod-poster-${side}`),
});
const botPreview = createBotPreview({
  canvas: document.querySelector("#preview-canvas"),
  // Four bays, built up front. The pods for players three and four are hidden
  // until that many pads are plugged in, and a hidden pod measures zero, which
  // the preview loop already treats as "scrolled away" and skips — so an unused
  // bay costs a plinth in a scene nobody renders.
  pods: [podEls("player"), podEls("rival"), podEls("p3"), podEls("p4")],
});
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
  music.player.setDuck?.(paused ? PAUSE_DUCK : 1, CONFIG.music.fade.pauseDuckSeconds);
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

/**
 * @param {{ botIds?: string[], playerBotId?: string, rivalBotId?: string,
 *           humanCount?: number, difficulty?: string }} action
 * `botIds` is the general form (2-4 machines, in bot order). The two named ids
 * are the 1v1 shorthand the UI used before there were more than two, and the
 * dev console still starts fights with them.
 */
async function startMatch({ botIds, playerBotId, rivalBotId, humanCount, difficulty }) {
  await endMatch();
  // Free the showcase's GPU copies while the arena runs; ui.js re-emits the
  // selection whenever the select screen is re-entered, so they reload from
  // cache on the way back.
  botPreview.unload();
  const ids = botIds?.length >= 2 ? botIds.slice(0, 4) : [playerBotId, rivalBotId];
  const specs = ids.map((id) => getBotSpec(id));
  // Who is a person. Everything past `humans` is AI — which in practice is only
  // ever bot 1 in a solo game, because three- and four-ways only exist when
  // three and four pads are plugged in.
  const humans = Math.min(specs.length, Math.max(0, humanCount ?? padCount()));

  // Bot models are the long pole: 10-17MB each, and both are needed before the
  // match can start. Aggregate the two downloads into one bar; if either
  // response has no content-length (chunked/gzipped) the whole bar goes
  // indeterminate rather than reporting a half-truth.
  loader.show({ title: "Loading Bots", detail: specs.map((s) => s.name).join(" vs "), progress: 0 });
  const modelProgress = specs.map(() => 0);
  const reportModels = () => {
    const known = modelProgress.every((p) => typeof p === "number");
    const total = modelProgress.reduce((sum, p) => sum + p, 0) / modelProgress.length;
    // Models occupy the first 80% of the bar; setup takes the rest.
    loader.setProgress(known ? total * 0.8 : null);
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
        // A tracked bot's band is built from the loaded geometry rather than
        // shipped in the GLB — see engine/tracks.js for why the scan cannot
        // provide one. Built once here; botAnimation only scrolls it.
        buildTrackParts(visual, spec);
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
  // Where the start boxes go depends on how many machines are in the box.
  arenaVisuals.setBotCount(specs.length);

  loader.setDetail("Starting physics");
  loader.setProgress(0.9);
  await nextFrame();
  const sim = await createSim({ bots: specs, emit: bus.emit });
  const match = createMatch({ sim, specs, emit: bus.emit, on: bus.on });
  const audio = createGameAudio(bus, { specs });
  audio.setListenerProvider?.(() => stage.camera);
  resetAiState();
  playerWeapons.reset();
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
  const idleInputs = specs.map(() => idleInput);
  for (let i = 0; i < 150; i += 1) sim.stepFrame(1 / 60, idleInputs);
  // Average the last 30 frames so residual suspension oscillation cancels.
  const settleSum = specs.map(() => 0);
  for (let i = 0; i < 30; i += 1) {
    sim.stepFrame(1 / 60, idleInputs);
    const state = sim.getRenderState();
    specs.forEach((_, b) => {
      settleSum[b] += state[b].position.y;
    });
  }
  botVisuals.forEach((visual, i) => {
    const drop = settleSum[i] / 30;
    visual.__groundDrop = drop; // dev observability
    visual.group.children.forEach((child) => {
      child.position.y -= drop;
    });
  });
  sim.reset();
  session = { sim, match, botVisuals, specs, difficulty, audio, humans, botIds: ids };
  // Frame the cameras around the bots that are actually in this match. The
  // radius comes off the LOADED model, not the catalog: bodyDims describe the
  // shell, and a bot's silhouette is mostly weapon — Mammoth's disc rides a
  // truss well outside its chassis, and at the fixed follow distance you could
  // not see your own machine.
  const radii = botVisuals.map((visual) => {
    const sphere = new THREE.Box3().setFromObject(visual.group).getBoundingSphere(new THREE.Sphere());
    return sphere.radius || 0;
  });
  radii.forEach((radius, i) => chaseCameras[i]?.setSubjectRadius(radius));
  cameraDirector.setSubjectRadius(Math.max(...radii));
  overviewDirector.setSubjectRadius(Math.max(...radii));
  const spawned = sim.getRenderState();
  cameraDirector.snapTo(spawned);
  overviewDirector.snapTo(spawned);
  spawned.forEach((state, i) => chaseCameras[i]?.snapTo(state));
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
        botIds: session.botIds,
        humanCount: session.humans,
        difficulty: session.difficulty,
      });
      else if (action.type === "previewSelection") {
        // What the bot select screen wants staged in each bay. This is NOT the
        // selection: an unclaimed bay stages whatever the cursor is over, so
        // the ids arrive already resolved (and "random" already reduced to
        // nothing, since a mystery opponent has no model to show).
        (action.showIds || []).forEach((id, slot) => {
          if (id) botPreview.showBot(slot, getBotSpec(id));
          else botPreview.clearBot(slot);
        });
        botPreview.setControl({ duo: action.duo, focusSlot: action.focusSlot });
        // A bay that just went from browsed to claimed spins and lights up. The
        // model is usually already loaded — browsing put it there — so this is
        // the only thing that distinguishes the press from the hover.
        if (typeof action.claimSlot === "number") botPreview.claimBot(action.claimSlot);
      }
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
// syncBotVisual / updateWeaponSub live in engine/botAnimation.js, shared with
// the bot-select showcase so a test-fired weapon moves exactly like the match.

// --- Player weapon semantics (v1 parity) -----------------------------------
// The rules themselves live in game/weaponControls.js, shared with the
// bot-select practice viewer so a weapon you learn on the plinth is driven the
// same way in the arena.
const playerWeapons = createWeaponInputShaper();
let lastInputs = null;
const shapePlayerInput = (raw, spec, slot) => playerWeapons.shape(raw, spec, slot);
let splitActive = false;
let splitViews = 0;

/** The machine an AI-driven bot should be looking at: whoever is closest. With
 *  two bots that is the other one, which is all this was ever asked for. */
function nearestOther(states, self) {
  let best = self === 0 ? 1 : 0;
  let bestDistance = Infinity;
  for (let i = 0; i < states.length; i += 1) {
    if (i === self) continue;
    const dx = states[i].position.x - states[self].position.x;
    const dz = states[i].position.z - states[self].position.z;
    const distance = dx * dx + dz * dz;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return states[best];
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (session) {
    const botCount = session.specs.length;
    // A player exists while their pad does. Player one is the exception: they
    // have the keyboard too, so slot 0 is always human.
    const raw = session.specs.map((_, i) =>
      (i === 0 || inputs[i].hasGamepad()) ? inputs[i].readInput() : null);
    if (raw.some((r) => r?.pausePressed)) setPaused(!paused);

    if (!paused) {
      const renderNow = session.sim.getRenderState();
      const frameInputs = session.specs.map((spec, i) => {
        if (raw[i]) return shapePlayerInput(raw[i], spec, i);
        // AI only ever fills bot 1 of a solo game — a third or fourth machine
        // exists because a third or fourth person is holding a controller.
        // Keyed by SLOT as well as by bot: with more than two machines the same
        // model can appear twice, and a shared brain makes them one machine in
        // two bodies.
        return computeAiInput(renderNow[i], nearestOther(renderNow, i), spec, session.difficulty, dt, `${spec.id}#${i}`);
      });
      const filtered = session.match.filterInputs ? session.match.filterInputs(frameInputs) : frameInputs;
      lastInputs = filtered;
      session.sim.stepFrame(dt, filtered);
      session.match.update?.(dt);
      session.audio.updateFrame?.(filtered, renderNow);
      filtered.forEach((filteredInput, i) => updateWeaponSub(session.botVisuals[i], session.specs[i], dt, Boolean(filteredInput?.sawActive)));
    }

    const renderState = session.sim.getRenderState();
    renderState.forEach((state, i) => syncBotVisual(session.botVisuals[i], session.specs[i], state, dt));
    // Flamethrowers. The sim reports the burn as weaponSubAngle (0..1), so the
    // jet is driven from render state like any other moving part rather than
    // from the input, and it keeps burning through the frames where the input
    // has already been consumed.
    if (!paused) {
      renderState.forEach((state, i) => {
        // __groundDrop is the shift startMatch() put into the model's CONTENTS
        // to stand it on the floor; the nozzles are body-local like every other
        // catalog point, so without it the jet leaves from that far above the
        // muzzle it was measured against.
        spawnBotFlame(effects, session.specs[i], state, state.weaponSubAngle ?? 0, session.botVisuals[i].__groundDrop ?? 0);
      });
    }
    arenaVisuals?.updateHazards(session.sim.getHazardState?.(), paused ? 0 : dt);

    // SPLIT SCREEN. Two humans split only when the bot camera is selected —
    // a shared battle cam frames a 1v1 perfectly well and some people prefer
    // it. Three and four do not have that choice: one camera cannot follow
    // four machines, and the whole reason a third player exists is that they
    // are driving one of them.
    splitViews = session.humans >= 3 ? session.humans : (session.humans >= 2 && settings.cameraMode === "bot" ? 2 : 0);
    splitActive = splitViews >= 2;
    const centre = { x: 0, y: 0.6, z: 0 };
    for (const state of renderState) {
      centre.x += state.position.x / renderState.length;
      centre.z += state.position.z / renderState.length;
    }
    if (splitActive) {
      const views = [];
      for (let i = 0; i < splitViews; i += 1) {
        chaseCameras[i].update(dt, renderState[i]);
        views.push({ position: stage.playerCameras[i].position, target: renderState[i].position });
      }
      // Three players leave a quadrant over; it holds a wide shot of everyone.
      if (splitViews === 3) {
        overviewDirector.update(dt, renderState);
        views.push({ position: stage.overviewCamera.position, target: centre });
      }
      // Every viewport contributes: a wall blocking ANY player's shot hides.
      arenaVisuals?.updateVisibility(views);
    } else if (settings.cameraMode === "bot") {
      // Single-player bot cam uses the same v1-damped chase as split screen.
      chaseCameras[0].update(dt, renderState[0]);
      arenaVisuals?.updateVisibility({ position: stage.camera.position, target: renderState[0].position });
    } else {
      cameraDirector.update(dt, renderState);
      arenaVisuals?.updateVisibility({ position: stage.camera.position, target: centre });
    }
  } else {
    splitActive = false;
    splitViews = 0;
    cameraDirector.update(dt, null);
  }
  effects.update(paused ? 0 : dt);
  if (splitActive) stage.renderSplit(splitViews);
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
  // How many machines a match started right now would have, and how the screen
  // would be carved up for them. Both are pad-count derived and invisible from
  // the DOM, so a probe has no other way to check them.
  matchBotCount,
  padCount,
  get splitViews() {
    return splitViews;
  },
  botPreview,
  music,
  effects,
  // Boot straight into a fight without clicking through the menus, so a
  // headless browser can verify that a bot actually renders and drives rather
  // than only that its catalog entry parses.
  startMatch,
  // Drive one bot's animation directly, at a state of the caller's choosing, and
  // draw a frame from it. A moving part that is only reachable through the match
  // loop can only be checked at whatever speed the match happens to be running;
  // tools/track-probe.mjs needs a KNOWN wheel speed and successive frames that
  // differ by nothing else. THREE rides along so a probe can measure the model
  // it is looking at without importing its own copy.
  THREE,
  syncBotVisual,
  updateWeaponSub,
  // The inputs the loop last acted on, AFTER shaping and after match.filterInputs.
  // A mechanism that does not move has three places to be lost — the pad read,
  // the per-bot shaping, and the damage/phase filter — and only the last of them
  // is visible from the sim. Exposed so a probe can say WHICH.
  get lastInputs() {
    return lastInputs;
  },
  render: () => stage.render(),
};
