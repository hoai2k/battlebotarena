// BattleBot Arena v2 — bot-select 3D showcase (integrator-owned).
//
// createBotPreview({ canvas, pods }) -> { showBot, clearBot, unload, setControl, dispose }
//
// Each CHOSEN bot on the select screen gets a live 3D turntable inside its
// pod's view window. One transparent WebGL canvas spans the whole screen and
// every pod is a scissored viewport into a shared scene with one lit "bay"
// per slot, so two previews cost one context. The pod's owner drives it like
// a standard 3D camera: right stick orbits, LT leans in, RT test-fires the
// weapon — mouse users drag/wheel the window and hold the TEST WEAPON button.
//
// Pad->pod routing mirrors the rest of the game: with two pads each pad owns
// its own pod (dense getGamepads() order, same people as sim bots 0/1); solo,
// every pad drives the pod the pick flow is focused on (ui.js reports it via
// setControl). ui.js never sees any of this — it only emits selection actions;
// main.js routes them here (UI must not import three.js, see ARCHITECTURE.md).
//
// Weapon test-fires reuse the exact match-time animation path (botAnimation's
// syncBotVisual over a synthesized render state), so the flip you try here is
// the flip you get in the arena. The per-frame pane-rect reads are deliberate
// and contained: this loop only does real work on the botSelect screen, never
// during a match, so the "no DOM reads in the frame loop" rule for match
// performance is unaffected.

import * as THREE from "three";
import { loadBotModel } from "../assets/models.js";
import { syncBotVisual, updateWeaponSub } from "./botAnimation.js";

const BAY_SPACING = 30; // ft between the two bays; far enough that neither bot ever shows in the other's window
const PLINTH_RADIUS = 3.1;
const PLINTH_HEIGHT = 0.32;
const STICK_DEADZONE = 0.18;
const ORBIT_YAW_SPEED = 2.6; // rad/s at full stick
const ORBIT_PITCH_SPEED = 1.7;
const PITCH_MIN = -0.06;
const PITCH_MAX = 1.25;
const ZOOM_MIN = 0.55;
const ZOOM_MAX = 1.9;
const AUTO_SPIN_AFTER = 2.5; // s of no camera input before the turntable drift resumes
const AUTO_SPIN_SPEED = 0.22; // rad/s
const SPINNER_VISUAL_OMEGA = 34; // rad/s cap — faster is just shimmer at 60fps
// One-shot pulse lengths (pad A / keyboard on the TEST button): a spinner
// needs time to visibly wind up and coast; an arm just fires and returns.
const PULSE_SPINNER_S = 2.8;
const PULSE_ARM_S = 1.0;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const SPINNER_TYPES = new Set(["bar", "drum"]);

/** Per-type stroke rates (1/s): how fast the arm goes up while held / returns. */
function strokeRates(type) {
  switch (type) {
    case "flipper": return { up: 13, down: 2.8 }; // snap out, pneumatic return
    case "hammer": return { up: 9, down: 2.0 };
    case "hammerSaw": return { up: 3.4, down: 2.2 };
    case "crusher": return { up: 2.4, down: 1.6 };
    default: return { up: 2.4, down: 1.8 }; // lifters, grapplers
  }
}

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
    return { showBot: async () => {}, clearBot: () => {}, unload: () => {}, setControl: () => {}, dispose: () => {} };
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

  scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x15130f, 1.65));
  const key = new THREE.DirectionalLight(0xffffff, 3.1);
  key.position.set(-8, 15, 10);
  key.castShadow = true;
  // Half the match renderer's resolution: the frustum only spans two plinths,
  // and the map re-renders for every pod pass, every frame.
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -(BAY_SPACING / 2 + 8);
  key.shadow.camera.right = BAY_SPACING / 2 + 8;
  key.shadow.camera.top = 16;
  key.shadow.camera.bottom = -16;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88b4ff, 0.85);
  rim.position.set(9, 7, -12);
  scene.add(rim);

  // ------------------------------------------------------------------- bays
  const plinthMaterial = new THREE.MeshStandardMaterial({ color: 0x14171c, metalness: 0.55, roughness: 0.5 });

  function buildBay(slot) {
    const x = (slot === 0 ? -1 : 1) * (BAY_SPACING / 2);
    const deco = new THREE.Group();
    deco.position.set(x, 0, 0);
    deco.visible = false;
    const plinth = new THREE.Mesh(
      new THREE.CylinderGeometry(PLINTH_RADIUS, PLINTH_RADIUS + 0.25, PLINTH_HEIGHT, 48),
      plinthMaterial,
    );
    plinth.position.y = PLINTH_HEIGHT / 2;
    plinth.receiveShadow = true;
    deco.add(plinth);
    // Accent ring around the plinth lip, recolored per bot.
    const ringMaterial = new THREE.MeshStandardMaterial({
      color: 0x888c94,
      emissive: 0x888c94,
      emissiveIntensity: 0.55,
      metalness: 0.3,
      roughness: 0.4,
    });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(PLINTH_RADIUS + 0.06, 0.045, 10, 64), ringMaterial);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = PLINTH_HEIGHT - 0.02;
    deco.add(ring);
    // Soft contact shadow pool around the plinth.
    const floor = new THREE.Mesh(new THREE.CircleGeometry(PLINTH_RADIUS + 4.5, 48), new THREE.ShadowMaterial({ opacity: 0.42 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.001;
    floor.receiveShadow = true;
    deco.add(floor);
    scene.add(deco);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 120);
    return {
      slot,
      x,
      deco,
      ringMaterial,
      camera,
      visual: null,
      spec: null,
      token: 0,
      viewEl: pods[slot]?.view || null,
      testEl: pods[slot]?.test || null,
      loadingEl: pods[slot]?.view?.querySelector?.(".pod-loading") || null,
      // Orbit state: yaw mirrored so both bots open on a facing 3/4 view.
      orbit: { yaw: slot === 0 ? 0.7 : -0.7, pitch: 0.4, zoom: 1, dist: 9, targetY: 1.1, lean: 0, idleFor: 99 },
      // Synthesized render state fed through the match animation path.
      anim: { spinAngle: 0, spinSpeed: 0, stroke: 0, subPulse: 0 },
      state: {
        position: new THREE.Vector3(x, PLINTH_HEIGHT, 0),
        quaternion: new THREE.Quaternion(),
        weaponAngle: 0,
        weaponSubAngle: 0,
      },
      weaponHeld: false, // pointer hold on the TEST button
      weaponPadHeld: false, // RT on the owning pad
      pulseUntil: 0,
      cleanups: /** @type {Function[]} */ ([]),
    };
  }

  const bays = [buildBay(0), buildBay(1)];
  const control = { duo: false, focusSlot: 0 };

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

    const test = bay.testEl;
    if (test) {
      // Hold to run the weapon; a plain click (pad A / keyboard Enter on the
      // focused button) fires a one-shot pulse long enough to see a spinner
      // wind up. The click that follows a real hold is swallowed.
      let heldAt = 0;
      const onDown = () => {
        heldAt = now();
        bay.weaponHeld = true;
      };
      const release = () => {
        bay.weaponHeld = false;
      };
      const onClick = () => {
        if (heldAt && now() - heldAt > 300) return; // was a hold, not a tap
        const isSpinner = SPINNER_TYPES.has(bay.spec?.weapon?.type);
        bay.pulseUntil = now() + (isSpinner ? PULSE_SPINNER_S : PULSE_ARM_S) * 1000;
      };
      test.addEventListener("pointerdown", onDown);
      test.addEventListener("pointerup", release);
      test.addEventListener("pointerleave", release);
      test.addEventListener("pointercancel", release);
      test.addEventListener("click", onClick);
      bay.cleanups.push(() => {
        test.removeEventListener("pointerdown", onDown);
        test.removeEventListener("pointerup", release);
        test.removeEventListener("pointerleave", release);
        test.removeEventListener("pointercancel", release);
        test.removeEventListener("click", onClick);
      });
    }
  });

  // ------------------------------------------------------------- gamepads
  function connectedPads() {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
    return [...navigator.getGamepads()].filter(Boolean);
  }

  /** Route pad camera/weapon input to the pod each pad owns. */
  function readPads(dt) {
    const pads = connectedPads();
    bays.forEach((bay) => {
      bay.weaponPadHeld = false;
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
      const rt = (pad.buttons?.[7]?.value ?? 0) > 0.2 || Boolean(pad.buttons?.[7]?.pressed);
      bay.weaponPadHeld = bay.weaponPadHeld || rt;
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

  // ------------------------------------------------------ weapon animation
  function updateWeaponAnim(bay, dt) {
    const spec = bay.spec;
    const type = spec?.weapon?.type;
    if (!type) return;
    const active = bay.weaponHeld || bay.weaponPadHeld || now() < bay.pulseUntil;
    bay.testEl?.classList.toggle("is-live", active);
    const anim = bay.anim;
    if (SPINNER_TYPES.has(type)) {
      // Spin-up toward the visual cap while active, long coast-down after.
      anim.spinSpeed += ((active ? SPINNER_VISUAL_OMEGA : 0) - anim.spinSpeed) * Math.min(1, dt * (active ? 1.1 : 0.45));
      anim.spinAngle += anim.spinSpeed * dt;
      bay.state.weaponAngle = anim.spinAngle;
      // Tantrum: rhythmic punches ride on top while the drum runs.
      if (spec.weapon.fists) {
        anim.subPulse = active ? anim.subPulse + dt : 0;
        bay.state.weaponSubAngle = active ? Math.abs(Math.sin(anim.subPulse * 3.2)) : Math.max(0, (bay.state.weaponSubAngle || 0) - dt * 3);
      }
    } else {
      const rates = strokeRates(type);
      anim.stroke = clamp(anim.stroke + (active ? rates.up : -rates.down) * dt, 0, 1);
      bay.state.weaponAngle = anim.stroke;
      // Grappler jaw / any sub that rides the stroke closes with the arm.
      bay.state.weaponSubAngle = anim.stroke;
    }
    // Sawblaze's saw / Whiplash's disc spin whenever the arm test is live.
    updateWeaponSub(bay.visual, spec, dt, active);
  }

  // --------------------------------------------------------------- camera
  function updateCamera(bay, dt, rect) {
    const orbit = bay.orbit;
    orbit.idleFor += dt;
    if (orbit.idleFor > AUTO_SPIN_AFTER) orbit.yaw += AUTO_SPIN_SPEED * dt; // showcase drift
    const dist = orbit.dist * orbit.zoom * (1 - 0.42 * clamp(orbit.lean, 0, 1));
    const target = new THREE.Vector3(bay.x, orbit.targetY, 0);
    bay.camera.position.set(
      bay.x + dist * Math.cos(orbit.pitch) * Math.sin(orbit.yaw),
      orbit.targetY + dist * Math.sin(orbit.pitch),
      dist * Math.cos(orbit.pitch) * Math.cos(orbit.yaw),
    );
    bay.camera.lookAt(target);
    const aspect = rect.width / Math.max(rect.height, 1);
    if (Math.abs(bay.camera.aspect - aspect) > 0.001) {
      bay.camera.aspect = aspect;
      bay.camera.updateProjectionMatrix();
    }
  }

  /** Frame the freshly loaded model: orbit target/distance from its bounds. */
  function frameModel(bay) {
    const box = new THREE.Box3().setFromObject(bay.visual.group);
    if (box.isEmpty()) return;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const radius = size.length() / 2;
    bay.orbit.targetY = center.y + size.y * 0.06; // a touch high: weapons swing UP
    bay.orbit.dist = clamp(radius * 2.2, 3.5, 26);
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

    const { height: canvasHeight } = resizeToDisplay();
    readPads(dt);

    renderer.setScissorTest(false);
    renderer.clear();
    canvasClean = false;

    for (const bay of bays) {
      if (!bay.visual || !bay.viewEl) continue;
      // The screen slides during its enter transition, so the window's rect is
      // read fresh each frame — this loop never runs during a match, where the
      // no-DOM-reads rule matters.
      const rect = bay.viewEl.getBoundingClientRect();
      if (rect.width < 12 || rect.height < 12) continue;
      updateWeaponAnim(bay, dt);
      syncBotVisual(bay.visual, bay.spec, bay.state);
      updateCamera(bay, dt, rect);
      const x = rect.left;
      const y = canvasHeight - rect.bottom; // GL origin is bottom-left
      renderer.setViewport(x, y, rect.width, rect.height);
      renderer.setScissor(x, y, rect.width, rect.height);
      renderer.setScissorTest(true);
      renderer.render(scene, bay.camera);
    }
    renderer.setScissorTest(false);
  }
  raf = requestAnimationFrame(frame);

  // ------------------------------------------------------------ public API
  function setLoading(bay, loading) {
    if (bay.loadingEl) bay.loadingEl.hidden = !loading;
    bay.viewEl?.classList.toggle("is-preview-loading", loading);
  }

  function removeVisual(bay) {
    if (!bay.visual) return;
    scene.remove(bay.visual.group);
    disposeObject(bay.visual.group);
    bay.visual = null;
    bay.deco.visible = false;
  }

  function resetBayState(bay) {
    bay.anim.spinAngle = 0;
    bay.anim.spinSpeed = 0;
    bay.anim.stroke = 0;
    bay.anim.subPulse = 0;
    bay.state.weaponAngle = 0;
    bay.state.weaponSubAngle = 0;
    bay.pulseUntil = 0;
    bay.orbit.yaw = bay.slot === 0 ? 0.7 : -0.7;
    bay.orbit.pitch = 0.4;
    bay.orbit.idleFor = 99; // start on the slow showcase drift
  }

  /** Load spec's model into the slot's bay (no-op if it is already showing). */
  async function showBot(slot, spec) {
    const bay = bays[slot];
    if (!bay || !spec) return;
    if (bay.spec?.id === spec.id && bay.visual) return;
    const token = ++bay.token;
    removeVisual(bay);
    bay.spec = spec;
    setLoading(bay, true);
    let visual = null;
    try {
      visual = await loadBotModel(spec); // THREE.Cache makes the later match load a re-parse, not a re-download
    } catch (error) {
      console.warn(`[preview] model load failed for ${spec.id}`, error);
    }
    if (token !== bay.token) {
      // Player picked something else while this one downloaded.
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
    resetBayState(bay);
    frameModel(bay);
  }

  function clearBot(slot) {
    const bay = bays[slot];
    if (!bay) return;
    bay.token += 1; // cancels an in-flight load
    bay.spec = null;
    setLoading(bay, false);
    removeVisual(bay);
  }

  /** Drop every model (match start): frees GPU memory while the arena runs.
   *  ui.js re-emits the selection whenever the screen is re-entered, so the
   *  bays repopulate from cache on the way back. */
  function unload() {
    bays.forEach((bay) => clearBot(bay.slot));
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
  return { showBot, clearBot, unload, setControl, dispose, _debug: { bays, control } };
}
