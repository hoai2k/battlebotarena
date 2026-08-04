// BattleBot Arena v2 — bot-select 3D showcase (integrator-owned).
//
// createBotPreview({ canvas, pods }) -> { showBot, clearBot, unload, setControl, dispose }
//
// Each CHOSEN bot on the select screen gets a live 3D turntable inside its
// pod's view window. One transparent WebGL canvas spans the whole screen and
// every pod is a scissored viewport into a shared scene with one lit "bay"
// per slot, so two previews cost one context. The pod's owner drives it like
// a standard 3D camera: right stick orbits, LT leans in — mouse users drag and
// wheel the window.
//
// It is a PRACTICE viewer, not a showreel: the weapon buttons feed RAW input
// through the same game/weaponControls.js shaper the match loop uses, and
// engine/previewWeapon.js mirrors the sim's stroke machines with the real
// per-bot timings. So HUGE's bar latches on with one press and takes its full
// five seconds to wind up, Bronco's flipper makes you wait out the reload, and
// Sawblaze's arm holds out while the trigger is down — the same as in a fight.
// Pad RT/RB map to the same two channels the arena uses.
//
// Pad->pod routing mirrors the rest of the game: with two pads each pad owns
// its own pod (dense getGamepads() order, same people as sim bots 0/1); solo,
// every pad drives the pod the pick flow is focused on (ui.js reports it via
// setControl). ui.js never sees any of this — it only emits selection actions;
// main.js routes them here (UI must not import three.js, see ARCHITECTURE.md).
//
// Motion goes through the exact match-time animation path (botAnimation's
// syncBotVisual over a synthesized render state), so the flip you try here is
// the flip you get in the arena. The per-frame pane-rect reads are deliberate
// and contained: this loop only does real work on the botSelect screen, never
// during a match, so the "no DOM reads in the frame loop" rule for match
// performance is unaffected.

import * as THREE from "three";
import { loadBotModel } from "../assets/models.js";
import { syncBotVisual, updateWeaponSub } from "./botAnimation.js";
import { createEffects, spawnBotFlame } from "./effects.js";
import {
  PREVIEW_FOV, PLINTH_HEIGHT, RING_EMISSIVE, START_YAW, START_PITCH,
  addPreviewLights, buildPlinth, frameRadius, fitDistance, placeCamera,
} from "./previewStage.js";
import { SETTLE_MS, loadPosterIndex, posterMeta, posterUrl } from "./posters.js";
import { createPreviewWeapon } from "./previewWeapon.js";
import { createWeaponInputShaper, describeWeaponControls } from "../game/weaponControls.js";

const BAY_SPACING = 30; // ft between the two bays; far enough that neither bot ever shows in the other's window
const STICK_DEADZONE = 0.18;
const ORBIT_YAW_SPEED = 2.6; // rad/s at full stick
const ORBIT_PITCH_SPEED = 1.7;
const PITCH_MIN = -0.06;
const PITCH_MAX = 1.25;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 1.9;
const AUTO_SPIN_AFTER = 2.5; // s of no camera input before the turntable drift resumes
const AUTO_SPIN_SPEED = 0.22; // rad/s
// The claim flourish. Browsing already puts a bot in the bay, so the pod looks
// the same the instant before you press A as the instant after — without this
// the one moment the whole screen exists for reads as nothing happening. A full
// turn is unmistakable at a glance and lands back exactly where it started, so
// it costs the player nothing: whatever angle they were studying is the angle
// they get back.
const CLAIM_SECONDS = 0.85;
const CLAIM_RING_FLASH = 3.4; // x the ring's resting emissive at the peak
// A click (pad A / keyboard Enter) with no pointer hold behind it still has to
// produce a real button press, so it is replayed as a short raw pulse. On a
// LATCHING channel one pulse is one edge, which is exactly one toggle; on a
// momentary one it is a tap of the trigger.
// Minimum press length, counted in FRAMES rather than seconds. A press has to
// be observed by the loop to become a rising edge, and on a latching channel a
// missed edge is a button that silently does nothing; a seconds-based floor
// loses that race whenever a frame runs long. Two frames is always enough and
// is never perceptible.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function disposeObject(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry?.dispose?.();
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    materials.forEach((material) => {
      if (!material) return;
      material.map?.dispose?.();
      material.normalMap?.dispose?.();
      material.roughnessMap?.dispose?.();
      material.metalnessMap?.dispose?.();
      material.emissiveMap?.dispose?.();
      material.aoMap?.dispose?.();
      material.dispose?.();
    });
  });
}

/**
 * @param {object} opts
 * @param {HTMLCanvasElement} opts.canvas full-screen transparent canvas inside the select section
 * @param {{ view: HTMLElement, test?: HTMLElement|null }[]} opts.pods one per slot (0 = player, 1 = rival)
 */
export function createBotPreview({ canvas, pods = [] } = {}) {
  if (!canvas || pods.length === 0) {
    // Preview-less boot (tests, stripped DOM): every method is a no-op.
    return { showBot: async () => {}, clearBot: () => {}, claimBot: () => {}, unload: () => {}, setControl: () => {}, dispose: () => {} };
  }

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = false; // two scissored passes per frame; cleared manually
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene(); // transparent background: the screen's carbon backdrop shows through
  // Lights, plinth and camera fit all come from engine/previewStage.js, which
  // the poster baker uses too — see engine/posters.js for why they must agree.
  addPreviewLights(scene, renderer, { span: BAY_SPACING / 2 + 8 });

  // ------------------------------------------------------------------- bays
  function buildBay(slot) {
    const x = (slot === 0 ? -1 : 1) * (BAY_SPACING / 2);
    const { group: deco, ringMaterial } = buildPlinth();
    deco.position.set(x, 0, 0);
    deco.visible = false;
    scene.add(deco);

    // Particle FX for this bay only. One effects instance PER BAY, each rooted
    // in its own group: the two bots share a scene, and a jet spawned at the
    // player's plinth would otherwise hang in the rival's window too (showOnly
    // can hide a group, not a subset of one shared particle pool). It also
    // gives each bay its own billboard camera, which is the whole point of a
    // scissored two-viewport render.
    const fxRoot = new THREE.Group();
    scene.add(fxRoot);

    const camera = new THREE.PerspectiveCamera(PREVIEW_FOV, 1, 0.05, 120);
    return {
      slot,
      x,
      deco,
      fxRoot,
      fx: createEffects(fxRoot),
      ringMaterial,
      camera,
      visual: null,
      spec: null,
      token: 0,
      viewEl: pods[slot]?.view || null,
      // The pod has no test buttons any more: a controller runs the weapons
      // here exactly as it does in the arena, and a fixed row of buttons could
      // only ever cover the channels someone remembered to add one for — Dragon
      // King has four mechanisms and there were three buttons. What is on
      // screen instead is a read-only legend of THIS bot's channels, which can
      // list all four.
      controlsEl: pods[slot]?.controls || null,
      loadingEl: pods[slot]?.view?.querySelector?.(".pod-loading") || null,
      posterEl: pods[slot]?.poster || null,
      /** Timer for the deferred model build; see posters.js SETTLE_MS. */
      settle: 0,
      // Orbit state: both bays open on the same front three-quarter (START_YAW).
      orbit: { yaw: START_YAW, pitch: START_PITCH, zoom: 1, dist: 9, targetY: 1.1, lean: 0, idleFor: 99 },
      /** Claim flourish: seconds into the spin-and-flash, or -1 when idle. */
      claim: -1,
      /** Mirrors the sim's weapon stroke machine for this bot. */
      weapon: null,
      controls: { primary: null, secondary: null, aux: null, lift: null },
      state: {
        position: new THREE.Vector3(x, PLINTH_HEIGHT, 0),
        quaternion: new THREE.Quaternion(),
        weaponAngle: 0,
        weaponSubAngle: 0,
        weaponTrack: 0,
        weaponRatio: 0,
      },
      // RAW (pre-latch) button state per channel, from pointer holds, click
      // pulses and the pad. The shaper turns these into shaped weapon input.
      raw: {
        primaryPad: false,
        secondaryPad: false,
        auxPad: false,
      },
      cleanups: /** @type {Function[]} */ ([]),
    };
  }

  const bays = [buildBay(0), buildBay(1)];
  // Fire-and-forget: until it resolves posterMeta() returns null and every bay
  // falls back to the spinner, which is exactly the behaviour before posters
  // existed. Nothing waits on it.
  loadPosterIndex();
  const control = { duo: false, focusSlot: 0 };
  // Same shaper the match loop runs, so the latches behave identically. It is
  // this viewer's OWN instance — the match keeps its own, and neither should
  // inherit the other's toggle state.
  const shaper = createWeaponInputShaper();

  // ------------------------------------------------------------ DOM wiring
  const now = () => performance.now();

  bays.forEach((bay) => {
    const view = bay.viewEl;
    if (view) {
      // Mouse/touch orbit: drag the window. The pod's claim/clear button is a
      // separate element, so a drag here never doubles as a click.
      let dragId = null;
      const onDown = (ev) => {
        if (!bay.visual) return;
        dragId = ev.pointerId;
        view.setPointerCapture?.(ev.pointerId);
        view.classList.add("is-orbiting");
      };
      const onMove = (ev) => {
        if (dragId !== ev.pointerId || !bay.visual) return;
        bay.orbit.yaw -= ev.movementX * 0.008;
        bay.orbit.pitch = clamp(bay.orbit.pitch + ev.movementY * 0.006, PITCH_MIN, PITCH_MAX);
        bay.orbit.idleFor = 0;
      };
      const onUp = (ev) => {
        if (dragId !== ev.pointerId) return;
        dragId = null;
        view.classList.remove("is-orbiting");
      };
      const onWheel = (ev) => {
        if (!bay.visual) return;
        ev.preventDefault();
        bay.orbit.zoom = clamp(bay.orbit.zoom * Math.exp(ev.deltaY * 0.001), ZOOM_MIN, ZOOM_MAX);
        bay.orbit.idleFor = 0;
      };
      view.addEventListener("pointerdown", onDown);
      view.addEventListener("pointermove", onMove);
      view.addEventListener("pointerup", onUp);
      view.addEventListener("pointercancel", onUp);
      view.addEventListener("wheel", onWheel, { passive: false });
      bay.cleanups.push(() => {
        view.removeEventListener("pointerdown", onDown);
        view.removeEventListener("pointermove", onMove);
        view.removeEventListener("pointerup", onUp);
        view.removeEventListener("pointercancel", onUp);
        view.removeEventListener("wheel", onWheel);
      });
    }

  });

  // ------------------------------------------------------------- gamepads
  function connectedPads() {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
    return [...navigator.getGamepads()].filter(Boolean);
  }

  /** Route pad camera/weapon input to the pod each pad owns. RT/RB are the
   *  same two weapon channels game/input.js reads during a match. */
  function readPads(dt) {
    const pads = connectedPads();
    bays.forEach((bay) => {
      bay.raw.primaryPad = false;
      bay.raw.secondaryPad = false;
      bay.raw.auxPad = false;
      bay.orbit.lean = 0;
    });
    const feed = (bay, pad) => {
      if (!bay?.visual || !pad) return;
      const rx = pad.axes?.[2] ?? 0;
      const ry = pad.axes?.[3] ?? 0;
      if (Math.abs(rx) > STICK_DEADZONE) {
        bay.orbit.yaw -= rx * ORBIT_YAW_SPEED * dt;
        bay.orbit.idleFor = 0;
      }
      if (Math.abs(ry) > STICK_DEADZONE) {
        bay.orbit.pitch = clamp(bay.orbit.pitch + ry * ORBIT_PITCH_SPEED * dt, PITCH_MIN, PITCH_MAX);
        bay.orbit.idleFor = 0;
      }
      const lt = pad.buttons?.[6]?.value ?? (pad.buttons?.[6]?.pressed ? 1 : 0);
      bay.orbit.lean = Math.max(bay.orbit.lean, lt);
      // Same buttons as game/input.js: RT (7) weapon, RB (5) secondary,
      // LB (4) aux.
      const rt = (pad.buttons?.[7]?.value ?? 0) > 0.2 || Boolean(pad.buttons?.[7]?.pressed);
      const rb = Boolean(pad.buttons?.[5]?.pressed) || (pad.buttons?.[5]?.value ?? 0) > 0.5;
      const lb = Boolean(pad.buttons?.[4]?.pressed) || (pad.buttons?.[4]?.value ?? 0) > 0.5;
      bay.raw.primaryPad = bay.raw.primaryPad || rt;
      bay.raw.secondaryPad = bay.raw.secondaryPad || rb;
      bay.raw.auxPad = bay.raw.auxPad || lb;
    };
    if (control.duo) {
      // Pad slot i owns pod i — same dense order as game/input.js.
      feed(bays[0], pads[0]);
      feed(bays[1], pads[1]);
    } else {
      // Solo: every pad drives the pod the pick flow is focused on.
      const bay = bays[control.focusSlot] || bays[0];
      pads.forEach((pad) => feed(bay, pad));
    }
  }

  // ------------------------------------------------------ weapon behaviour
  /** Collapse this frame's raw button sources into one press per channel. */
  function readRawButtons(bay) {
    const raw = bay.raw;
    const press = {
      leftDrive: 0,
      rightDrive: 0,
      brake: false,
      weapon: raw.primaryPad,
      weaponAlt: raw.secondaryPad,
      weaponAux: raw.auxPad,
    };
    return press;
  }

  function updateWeaponAnim(bay, dt) {
    if (!bay.spec?.weapon || !bay.weapon) return;
    // RAW press -> the game's own latch rules -> the sim's own stroke machine.
    // Nothing here knows whether a given weapon toggles or is held; that lives
    // in one place and the arena reads it from the same place.
    const shaped = shaper.shape(readRawButtons(bay), bay.spec, bay.slot);
    bay.weapon.update(dt, shaped);
    bay.state.weaponAngle = bay.weapon.state.weaponAngle;
    bay.state.weaponSubAngle = bay.weapon.state.weaponSubAngle;
    // A weapon that slides along a track (Tantrum's drum carriage) reports how
    // far along it is, and botAnimation moves the pivot from that — the same
    // field the sim publishes, so the plinth and the arena slide identically.
    bay.state.weaponTrack = bay.weapon.state.weaponTrack ?? 0;
    // Flamethrower (Free Shipping): the sim reports the burn as weaponSubAngle
    // and main.js draws the jet from it. previewWeapon keeps the same ramp but
    // only publishes it through subRatio(), so mirror it into the render state
    // the viewer draws from — then the jet is spawned by the SAME code the
    // match uses, from the same catalog nozzles.
    if (bay.spec.weapon?.flame) bay.state.weaponSubAngle = bay.weapon.subRatio();
    // weaponRatio is not optional: botAnimation draws a spinner's rotation from
    // the RATIO and ignores weaponAngle entirely for bar/drum, so leaving it off
    // this copy left every rotor in the viewer dead however long RT was held.
    bay.state.weaponRatio = bay.weapon.state.weaponRatio ?? 0;
    // Sawblaze's saw / Whiplash's disc: the visual sub-spinner rides the same
    // sawActive channel it does in the match.
    updateWeaponSub(bay.visual, bay.spec, dt, Boolean(shaped.sawActive));

  }

  // --------------------------------------------------------------- camera
  function updateCamera(bay, dt, rect) {
    const orbit = bay.orbit;
    orbit.idleFor += dt;
    if (orbit.idleFor > AUTO_SPIN_AFTER) orbit.yaw += AUTO_SPIN_SPEED * dt; // showcase drift
    if (bay.claim >= 0) {
      // Ease-out over exactly one turn, then stop dead. Driven off the ANGLE
      // rather than by adding a rate each frame, so the flourish ends on the
      // yaw it started from however the frame times fall — an accumulated
      // spin leaves the bot a few degrees off and the pod looks nudged.
      const before = bay.claim;
      bay.claim += dt;
      const ease = (t) => 1 - (1 - Math.min(1, t / CLAIM_SECONDS)) ** 3;
      orbit.yaw += (ease(bay.claim) - ease(before)) * Math.PI * 2;
      if (bay.claim >= CLAIM_SECONDS) {
        bay.claim = -1;
        // The flash is computed from `claim` earlier in the same frame, so put
        // the ring back here rather than leaving it a frame bright.
        bay.ringMaterial.emissiveIntensity = RING_EMISSIVE;
      }
      orbit.idleFor = 0; // no turntable drift on top of the flourish
    }
    // Distance that fits the model's bounding sphere in BOTH axes. Vertical FOV
    // is fixed; the horizontal one falls out of the aspect, and a wide bot in a
    // wide-but-short window is limited by the vertical one — so take whichever
    // demands more room.
    const aspect = rect.width / Math.max(rect.height, 1);
    if (orbit.fitRadius) orbit.dist = clamp(fitDistance(orbit.fitRadius, aspect, bay.camera.fov), 3.5, 40);
    const dist = orbit.dist * orbit.zoom * (1 - 0.42 * clamp(orbit.lean, 0, 1));
    placeCamera(bay.camera, { x: bay.x, yaw: orbit.yaw, pitch: orbit.pitch, dist, targetY: orbit.targetY });
    if (Math.abs(bay.camera.aspect - aspect) > 0.001) {
      bay.camera.aspect = aspect;
      bay.camera.updateProjectionMatrix();
    }
  }

  /** Frame the freshly loaded model: orbit target/distance from its bounds. */
  function frameModel(bay) {
    const framed = frameRadius(bay.visual.group);
    if (!framed) return;
    const { radius, targetY } = framed;
    bay.orbit.targetY = targetY;
    // Store the RADIUS, not a distance: the pod's aspect changes with layout
    // (and the bay grows when a bot is picked), and a distance that fits a tall
    // narrow window crops a wide one. updateCamera solves it per frame against
    // the live aspect so the whole bot is always inside the frame.
    bay.orbit.fitRadius = radius;
    bay.orbit.dist = clamp(radius * 2.2, 3.5, 26); // seed until the first frame
    bay.orbit.zoom = 1;
  }

  // ------------------------------------------------------------ frame loop
  const clock = new THREE.Clock();
  let raf = 0;
  let canvasClean = true; // avoid re-clearing a canvas nothing draws on
  let disposed = false;

  function screenActive() {
    return document.body.dataset.screen === "botSelect";
  }

  /** Hide every bay but this one for the duration of its render pass. */
  function showOnly(active) {
    for (const bay of bays) {
      const mine = bay === active;
      bay.deco.visible = mine && Boolean(bay.visual);
      bay.fxRoot.visible = mine;
      if (bay.visual) bay.visual.group.visible = mine;
    }
  }

  /** Put the scene back the way the rest of the module expects to find it. */
  function restoreBays() {
    for (const bay of bays) {
      bay.deco.visible = Boolean(bay.visual);
      bay.fxRoot.visible = true;
      if (bay.visual) bay.visual.group.visible = true;
    }
  }

  function resizeToDisplay() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    const size = renderer.getSize(new THREE.Vector2());
    if (size.x !== width || size.y !== height) renderer.setSize(width, height, false);
    return { width, height };
  }

  function frame() {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!screenActive()) {
      if (!canvasClean) {
        renderer.setScissorTest(false);
        renderer.clear();
        canvasClean = true;
      }
      return;
    }
    const hasBot = bays.some((bay) => bay.visual);
    if (!hasBot) {
      if (!canvasClean) {
        renderer.setScissorTest(false);
        renderer.clear();
        canvasClean = true;
      }
      return;
    }

    resizeToDisplay();
    readPads(dt);

    // Weapons advance for every staged bot, whether or not its pod is on
    // screen: a press consumed here must never depend on scroll position, and
    // a latched rotor has to keep spinning while you scroll down the roster.
    for (const bay of bays) {
      if (!bay.visual) continue;
      // Light up with the spin: the plinth ring is already this bot's accent
      // colour, so driving its emissive is a flash in the bot's OWN colour
      // rather than a generic white pop, and it needs no extra geometry.
      const flash = bay.claim >= 0 ? Math.sin((bay.claim / CLAIM_SECONDS) * Math.PI) : 0;
      bay.ringMaterial.emissiveIntensity = RING_EMISSIVE * (1 + (CLAIM_RING_FLASH - 1) * flash);
      updateWeaponAnim(bay, dt);
      syncBotVisual(bay.visual, bay.spec, bay.state);
      // A lit flamethrower is drawn here, from the same helper and the same
      // catalog nozzles the match uses. The billboard is this bay's own camera
      // (one frame stale, which is invisible on a facing quad).
      spawnBotFlame(bay.fx, bay.spec, bay.state, bay.state.weaponSubAngle ?? 0);
      bay.fx.update(dt);
    }

    renderer.setScissorTest(false);
    renderer.clear();
    canvasClean = false;

    // Rects are measured against the CANVAS, not the viewport: the screen is
    // scrollable and slides during its enter transition, and a transformed
    // ancestor would break viewport-absolute maths. This loop never runs during
    // a match, where the no-DOM-reads-in-the-frame-loop rule matters.
    const canvasRect = canvas.getBoundingClientRect();

    for (const bay of bays) {
      if (!bay.visual || !bay.viewEl) continue;
      const rect = bay.viewEl.getBoundingClientRect();
      // Clip to the canvas: a pod scrolled half off-screen must not hand GL a
      // rect that runs past the framebuffer.
      const left = Math.max(rect.left, canvasRect.left);
      const right = Math.min(rect.right, canvasRect.right);
      const top = Math.max(rect.top, canvasRect.top);
      const bottom = Math.min(rect.bottom, canvasRect.bottom);
      if (right - left < 12 || bottom - top < 12) continue; // fully or nearly scrolled away
      updateCamera(bay, dt, rect);
      // Viewport spans the pod's FULL rect (so the projection is unchanged by
      // clipping) while the scissor is the visible part of it.
      const vx = rect.left - canvasRect.left;
      const vy = canvasRect.bottom - rect.bottom; // GL origin is bottom-left
      renderer.setViewport(vx, vy, rect.width, rect.height);
      renderer.setScissor(left - canvasRect.left, canvasRect.bottom - bottom, right - left, bottom - top);
      renderer.setScissorTest(true);
      // Only this bay exists for its own camera. Both bots live in one scene
      // (one context, one set of lights), and 30ft apart the far one was
      // showing up in the back of the near one's window at some orbit angles.
      showOnly(bay);
      renderer.render(scene, bay.camera);
    }
    renderer.setScissorTest(false);
    restoreBays();
  }
  raf = requestAnimationFrame(frame);

  // ------------------------------------------------------------ public API
  function setLoading(bay, loading) {
    if (bay.loadingEl) bay.loadingEl.hidden = !loading;
    bay.viewEl?.classList.toggle("is-preview-loading", loading);
  }

  function removeVisual(bay) {
    bay.fx.clear(); // a jet the player left burning must not outlive its bot
    if (!bay.visual) return;
    scene.remove(bay.visual.group);
    disposeObject(bay.visual.group);
    bay.visual = null;
    bay.deco.visible = false;
  }

  function resetBayState(bay) {
    bay.weapon?.reset();
    shaper.reset(bay.slot); // a fresh bot arrives with its rotor off
    bay.fx.clear();
    bay.state.weaponAngle = 0;
    bay.state.weaponSubAngle = 0;
    bay.state.weaponTrack = 0;
    bay.orbit.yaw = START_YAW;
    bay.orbit.pitch = START_PITCH;
    bay.orbit.idleFor = 99; // start on the slow showcase drift
  }

  // Which pad control and which key run each channel. Naming the CHANNEL as
  // well as the mechanism is the point: "FLAME" says what a button does but not
  // which trigger it is, and a bot whose interesting mechanism is on the second
  // channel (Free Shipping's flamethrower) gets reported as broken when the
  // player holds RT and nothing burns.
  const CHANNEL_KEYS = {
    primary: { pad: "RT", key: "Space" },
    secondary: { pad: "RB", key: "R" },
    aux: { pad: "LB", key: "F" },
    lift: { pad: "LT", key: "C" },
  };

  /** Write this bot's channels into the pod as a read-only legend. */
  function applyControls(bay, spec) {
    const controls = describeWeaponControls(spec);
    bay.controls = controls;
    const el = bay.controlsEl;
    if (!el) return;
    el.textContent = "";
    for (const name of ["primary", "secondary", "aux", "lift"]) {
      const channel = controls[name];
      if (!channel) continue;
      const { pad, key } = CHANNEL_KEYS[name];
      const row = document.createElement("span");
      row.className = "pod-control";
      const chan = document.createElement("b");
      chan.textContent = pad;
      row.append(chan, `\u00a0${channel.label}\u00a0`);
      // Toggle vs hold is the single most useful thing to tell the player here.
      const mode = document.createElement("i");
      mode.textContent = channel.toggle ? "(toggle)" : "(hold)";
      row.append(mode);
      row.title = `${channel.label} — ${pad} / ${key}, ${channel.toggle ? "toggles on and off" : "hold"}`;
      el.append(row);
    }
  }

  /** Show a bot's baked stand-in immediately. Returns false when it has no
   *  poster, so the caller can fall back to the spinner. */
  function showPoster(bay, spec) {
    if (!bay.posterEl || !posterMeta(spec.id)) return false;
    bay.posterEl.src = posterUrl(spec.id);
    bay.posterEl.hidden = false;
    return true;
  }

  function hidePoster(bay) {
    if (!bay.posterEl) return;
    bay.posterEl.hidden = true;
    bay.posterEl.removeAttribute("src");
  }

  /**
   * Stage a bot in a slot: its picture goes up at once, its model is built
   * after the choice has held still (see posters.js). No-op if it is already
   * the bot in that bay.
   */
  async function showBot(slot, spec) {
    const bay = bays[slot];
    if (!bay || !spec) return;
    if (bay.spec?.id === spec.id && (bay.visual || bay.settle)) return;
    const token = ++bay.token;
    clearTimeout(bay.settle);
    removeVisual(bay);
    bay.spec = spec;
    bay.weapon = null;
    // The control legend comes off the SPEC, so it is right from the first
    // frame — reading it does not need the geometry to have arrived.
    applyControls(bay, spec);
    // The spinner is only for a bot with no poster. With one, the pod is
    // already showing the bot, and a spinner on top of it says "nothing here".
    const posted = showPoster(bay, spec);
    setLoading(bay, !posted);
    // Deferred so that running the cursor along a row of cards costs nothing:
    // each new bot cancels the last one's timer, and only the one you stop on
    // is ever downloaded.
    bay.settle = setTimeout(() => {
      bay.settle = 0;
      buildBot(bay, spec, token);
    }, SETTLE_MS);
  }

  /** Build the model for a staged bot and hand the pod over to it. */
  async function buildBot(bay, spec, token) {
    if (token !== bay.token) return;
    let visual = null;
    try {
      visual = await loadBotModel(spec); // THREE.Cache makes the later match load a re-parse, not a re-download
    } catch (error) {
      console.warn(`[preview] model load failed for ${spec.id}`, error);
    }
    if (token !== bay.token) {
      // Player moved on while this one downloaded.
      if (visual) disposeObject(visual.group);
      return;
    }
    setLoading(bay, false);
    if (!visual) return;
    bay.visual = visual;
    visual.group.position.set(bay.x, PLINTH_HEIGHT, 0);
    scene.add(visual.group);
    bay.deco.visible = true;
    bay.ringMaterial.color.set(spec.accent || "#888c94");
    bay.ringMaterial.emissive.set(spec.accent || "#888c94");
    bay.weapon = createPreviewWeapon(spec);
    resetBayState(bay);
    frameModel(bay);
    // Last, so the picture is never taken down before the model that replaces
    // it has been framed — otherwise the pod blinks empty for a frame.
    hidePoster(bay);
  }

  function clearBot(slot) {
    const bay = bays[slot];
    if (!bay) return;
    bay.token += 1; // cancels an in-flight load
    clearTimeout(bay.settle);
    bay.settle = 0;
    hidePoster(bay);
    bay.spec = null;
    bay.weapon = null;
    bay.claim = -1; // a bay being emptied is not a bay being claimed
    bay.ringMaterial.emissiveIntensity = RING_EMISSIVE;
    setLoading(bay, false);
    applyControls(bay, null);
    removeVisual(bay);
  }

  /** Drop every model (match start): frees GPU memory while the arena runs.
   *  ui.js re-emits the selection whenever the screen is re-entered, so the
   *  bays repopulate from cache on the way back. */
  function unload() {
    bays.forEach((bay) => clearBot(bay.slot));
  }

  /** This bay's bot has just been CLAIMED, as opposed to merely browsed to.
   *  Runs the spin-and-flash. Set even when the model is still downloading:
   *  everything that advances it is gated on `bay.visual`, so an unfinished
   *  load simply means the flourish starts when the bot appears rather than
   *  being swallowed. */
  function claimBot(slot) {
    const bay = bays[slot];
    if (!bay) return;
    bay.claim = 0;
    // A claim IS the settle: there is nothing left to wait for, so stop
    // holding the model back.
    if (bay.settle) {
      clearTimeout(bay.settle);
      bay.settle = 0;
      buildBot(bay, bay.spec, bay.token);
    }
  }

  /** @param {{ duo?: boolean, focusSlot?: number|null }} next */
  function setControl(next = {}) {
    control.duo = Boolean(next.duo);
    if (typeof next.focusSlot === "number") control.focusSlot = next.focusSlot === 1 ? 1 : 0;
  }

  function dispose() {
    disposed = true;
    cancelAnimationFrame(raf);
    unload();
    bays.forEach((bay) => bay.cleanups.forEach((fn) => fn()));
    renderer.dispose();
  }

  // _debug: read-only inspection surface for tooling (mirrors gamepadNav's
  // debug exports); nothing in the app reads it.
  return {
    showBot,
    clearBot,
    claimBot,
    unload,
    setControl,
    dispose,
    _debug: {
      bays,
      control,
      get shaperState() {
        return [0, 1].map((slot) => ({
          weapon: shaper.isWeaponLatched(slot),
          alt: shaper.isAltLatched(slot),
        }));
      },
    },
  };
}
