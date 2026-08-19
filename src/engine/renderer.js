// Renderer + scene + lighting setup. Owns the WebGL context and resize.
import * as THREE from "three";
import { arenaEnvironment } from "./environment.js";

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  // Capped at 2: past that the fill rate costs more than the sharpness is worth
  // on a 4K panel. Re-read on every resize rather than fixed here, because it
  // MOVES — see watchPixelRatio.
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(pixelRatio());
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0e10);
  // What the metal reflects. Every bot in this game is made of it and had
  // nothing to mirror; see engine/environment.js. Kept off `background`, so it
  // shows up in reflections without becoming the sky.
  scene.environment = arenaEnvironment(renderer);
  scene.environmentIntensity = 0.8;
  // Far fog only — the battle camera can sit ~30-50ft from the far wall and
  // the whole 48ft arena must stay clearly readable.
  scene.fog = new THREE.Fog(0x0c0e10, 65, 150);

  const camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.05, 140);
  camera.position.set(0, 14, 26);

  const hemi = new THREE.HemisphereLight(0xdbe8ff, 0x15130f, 1.5);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 3.0);
  key.position.set(-9, 16, 11);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -30;
  key.shadow.camera.right = 30;
  key.shadow.camera.top = 30;
  key.shadow.camera.bottom = -30;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88b4ff, 0.9);
  rim.position.set(10, 9, -14);
  scene.add(rim);

  function resize() {
    const width = canvas.clientWidth || window.innerWidth;
    const height = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  // THE PIXEL RATIO MOVES, AND NO EVENT IS WORTH TRUSTING. Drag the window from
  // a laptop screen to a TV and devicePixelRatio changes under you — and if the
  // window keeps its CSS size across the move, NO resize event fires at all
  // (measured: ratio 1 -> 2, zero resize events; the matchMedia resolution
  // query flips its `matches` without dispatching `change` either). Left alone
  // the renderer keeps the ratio it booted with: half the TV's resolution for
  // the rest of the session in one direction, four times the pixels in the
  // other — and that one costs frames on a big panel.
  //
  // So the draw path asks instead of waiting to be told. One float compare per
  // frame, sitting in front of the only code that reads the canvas size, which
  // is the one place it cannot be checked too late.
  function syncPixelRatio() {
    if (renderer.getPixelRatio() !== pixelRatio()) resize();
  }

  // PER-PLAYER CAMERAS for local multiplayer, up to four of them.
  //
  // playerCameras[0] IS `camera`. The director and player one's chase cam never
  // run in the same frame — one of them owns the shot — so they share the
  // object, which keeps everything downstream that reads `stage.camera` (the
  // audio listener, arena wall culling) pointing at the view a person is
  // actually looking out of.
  const playerCameras = [
    camera,
    new THREE.PerspectiveCamera(52, 8 / 9, 0.05, 140),
    new THREE.PerspectiveCamera(52, 8 / 9, 0.05, 140),
    new THREE.PerspectiveCamera(52, 8 / 9, 0.05, 140),
  ];
  // The odd cell out. Three players in a 2x2 grid leaves one quadrant, and an
  // arena-wide shot of the whole fight is a better thing to put there than a
  // black rectangle — everyone can see where the other two went.
  const overviewCamera = new THREE.PerspectiveCamera(52, 1, 0.05, 140);

  // The size setViewport/setScissor speak, which is NOT canvas.width/height.
  // three multiplies whatever it is given by the renderer's pixel ratio, so a
  // rect measured in drawing-buffer pixels is scaled a SECOND time: on any
  // HiDPI display (pixel ratio 2) player one's half came out full-screen and
  // everyone else's landed off the edge, which read as "split screen is broken,
  // I only get one view". CSS pixels are the unit; three does the rest.
  const cssSize = new THREE.Vector2();
  function viewSize() {
    renderer.getSize(cssSize);
    return { w: Math.max(1, Math.round(cssSize.x)), h: Math.max(1, Math.round(cssSize.y)) };
  }

  /** Viewport rects, in CSS pixels with the GL origin (bottom-left), reading order. */
  function viewRects(count) {
    const { w, h } = viewSize();
    if (count <= 1) return [[0, 0, w, h]];
    // Two players get the full height each — a wide letterbox reads far better
    // for a chase camera than a quarter of the screen would.
    if (count === 2) {
      const half = Math.floor(w / 2);
      return [[0, 0, half, h], [half, 0, w - half, h]];
    }
    const halfW = Math.floor(w / 2);
    const halfH = Math.floor(h / 2);
    const right = w - halfW;
    const top = h - halfH;
    return [
      [0, halfH, halfW, top],        // P1 top-left
      [halfW, halfH, right, top],    // P2 top-right
      [0, 0, halfW, halfH],          // P3 bottom-left
      [halfW, 0, right, halfH],      // P4 bottom-right
    ];
  }

  function drawView(cam, [x, y, vw, vh]) {
    cam.aspect = vw / vh;
    cam.updateProjectionMatrix();
    renderer.setViewport(x, y, vw, vh);
    renderer.setScissor(x, y, vw, vh);
    renderer.render(scene, cam);
  }

  return {
    renderer,
    scene,
    camera,
    playerCameras,
    overviewCamera,
    /** Where each player's viewport lands, for anything that has to line up
     *  with them (HUD panels, on-screen labels). Fractions of the canvas, with
     *  y measured from the TOP so it can go straight into CSS. */
    viewLayout(count) {
      const { w, h } = viewSize();
      return viewRects(count).map(([x, y, vw, vh]) => ({
        left: x / w, top: (h - y - vh) / h, width: vw / w, height: vh / h,
      }));
    },
    resize,
    render() {
      syncPixelRatio();
      renderer.setScissorTest(false);
      const { w, h } = viewSize();
      renderer.setViewport(0, 0, w, h);
      renderer.render(scene, camera);
    },
    /**
     * One viewport per human. Three players fill the fourth quadrant with the
     * arena overview; four fill it with player four.
     * @param {number} count 2-4
     */
    renderSplit(count = 2) {
      syncPixelRatio();
      const players = Math.min(4, Math.max(2, count | 0));
      const rects = viewRects(players);
      renderer.setScissorTest(true);
      for (let i = 0; i < players; i += 1) drawView(playerCameras[i], rects[i]);
      if (players === 3) drawView(overviewCamera, rects[3]);
      renderer.setScissorTest(false);
    },
    dispose() {
      window.removeEventListener("resize", resize);
      renderer.dispose();
    },
  };
}
