// The environment every metal surface in the game reflects.
//
// A robot combat game is made almost entirely of metal, and metal in a PBR
// renderer has NO diffuse term — its colour is whatever it reflects. With
// scene.environment unset there is nothing to reflect, so a fully metallic
// material renders black and the only way to keep a polished part looking
// bright is to lie about its metalness. That is how Rusty's helmet, which is a
// spun steel bowl, ended up reading as white plastic: dropped to metalness 0.45
// so the diffuse term would carry it, which is the look of a painted dome.
//
// So: one small generated environment, built once and shared by the arena and
// the bot-select plinth. It is not a photograph of anywhere — it is the arena's
// own lighting written as an image, which is all a reflection needs to be
// convincing: a bright cool sky, a warm dark floor, and a band of house lights
// around the middle for the horizontal streak that reads as "polished".
//
// Deliberately low resolution and blurred by the PMREM pass anyway, so it costs
// one small render target and nothing per frame.
import * as THREE from "three";

let cached = null;

function gradientCanvas() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0.0, "#9fb6d8"); // ceiling, cool
  sky.addColorStop(0.45, "#54607a");
  sky.addColorStop(0.52, "#2a2f38");
  sky.addColorStop(1.0, "#14120f"); // floor, warm dark
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // The house lights. A horizontal bright band is what a curved polished
  // surface smears into the long highlight that says "metal" rather than
  // "shiny plastic", and it is the one feature worth putting in by hand.
  ctx.fillStyle = "rgba(255, 246, 226, 0.85)";
  ctx.fillRect(0, canvas.height * 0.40, canvas.width, canvas.height * 0.045);
  ctx.fillStyle = "rgba(190, 214, 255, 0.35)";
  ctx.fillRect(0, canvas.height * 0.30, canvas.width, canvas.height * 0.02);
  return canvas;
}

/**
 * The shared prefiltered environment. Built on first use because it needs a
 * live WebGL context; every later caller gets the same texture.
 * @param {THREE.WebGLRenderer} renderer
 * @returns {THREE.Texture}
 */
export function arenaEnvironment(renderer) {
  if (cached) return cached;
  const source = new THREE.CanvasTexture(gradientCanvas());
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  cached = pmrem.fromEquirectangular(source).texture;
  pmrem.dispose();
  source.dispose();
  return cached;
}
