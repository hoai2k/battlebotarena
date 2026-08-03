// Renderer + scene + lighting setup. Owns the WebGL context and resize.
import * as THREE from "three";
import { arenaEnvironment } from "./environment.js";

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  // Second camera for split-screen local multiplayer (left = P1, right = P2).
  const cameraB = new THREE.PerspectiveCamera(52, 8 / 9, 0.05, 140);

  return {
    renderer,
    scene,
    camera,
    cameraB,
    resize,
    render() {
      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, canvas.width, canvas.height);
      renderer.render(scene, camera);
    },
    renderSplit() {
      const w = canvas.width;
      const h = canvas.height;
      const half = Math.floor(w / 2);
      renderer.setScissorTest(true);
      camera.aspect = half / h;
      camera.updateProjectionMatrix();
      renderer.setViewport(0, 0, half, h);
      renderer.setScissor(0, 0, half, h);
      renderer.render(scene, camera);
      cameraB.aspect = (w - half) / h;
      cameraB.updateProjectionMatrix();
      renderer.setViewport(half, 0, w - half, h);
      renderer.setScissor(half, 0, w - half, h);
      renderer.render(scene, cameraB);
      renderer.setScissorTest(false);
    },
    dispose() {
      window.removeEventListener("resize", resize);
      renderer.dispose();
    },
  };
}
