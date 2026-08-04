// The bot-select plinth, as a thing two different renderers can both build.
//
// engine/botPreview.js draws it live inside each pod. tools/poster-shot.html
// draws the SAME stage off-screen to bake the transparent stand-in images the
// pod shows while a model downloads (see engine/posters.js). If the two ever
// drew it differently the swap from picture to model would be a visible jump —
// a light moving, a plinth resizing, a bot half a degree round — so neither of
// them owns any of this. They both call in here.
//
// The camera contract is the important half. `fitDistance` places the camera so
// the model's bounding SPHERE exactly fills the tighter of the two field-of-view
// angles, which is what lets a poster rendered once serve every window size:
// a sphere's angular size does not depend on which way round the frame is, so
// the picture is correct in any pod whose short side matches the render's. See
// engine/posters.js for how the runtime uses that.
import * as THREE from "three";
import { arenaEnvironment } from "./environment.js";

export const PREVIEW_FOV = 38; // degrees, vertical
export const PLINTH_RADIUS = 3.1;
export const PLINTH_HEIGHT = 0.32;
/** 8% of air around the bounding sphere so nothing kisses the frame edge. */
export const FIT_MARGIN = 1.08;
export const RING_EMISSIVE = 0.55;

// The angle every bay opens on, and the angle every poster is baked at, so the
// swap from picture to model is a change of nothing you can see.
//
// It used to be +-0.7, mirrored, which put both machines' NOSES away from the
// camera — a rear three-quarter. These bots are built to be looked at from the
// front: that is where the weapon, the wedge and the livery are. A quarter turn
// on top brings the front round with a little of the near side still showing.
// Both bays take the SAME angle rather than mirroring it, because "front, half
// a step to the right" is a pose, not a direction, and a mirrored pair means
// one of the two is always the wrong way round.
export const START_YAW = 0.7 + Math.PI / 2;
export const START_PITCH = 0.4;

/** The lights every preview is lit by. `span` is the half-width the shadow
 *  camera has to cover — one plinth off-screen, both of them in the pod. */
export function addPreviewLights(scene, renderer, { span = 8 } = {}) {
  scene.environment = arenaEnvironment(renderer);
  scene.environmentIntensity = 0.8;
  scene.add(new THREE.HemisphereLight(0xdbe8ff, 0x15130f, 1.65));
  const key = new THREE.DirectionalLight(0xffffff, 3.1);
  key.position.set(-8, 15, 10);
  key.castShadow = true;
  // The map re-renders for every pod pass, every frame, so it is half the match
  // renderer's resolution.
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -span;
  key.shadow.camera.right = span;
  key.shadow.camera.top = 16;
  key.shadow.camera.bottom = -16;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x88b4ff, 0.85);
  rim.position.set(9, 7, -12);
  scene.add(rim);
  return { key, rim };
}

/** One plinth: the drum, its accent ring and the shadow pool under it. The
 *  ring's material is returned because it is recoloured per bot and flashed on
 *  a claim. */
export function buildPlinth() {
  const group = new THREE.Group();
  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(PLINTH_RADIUS, PLINTH_RADIUS + 0.25, PLINTH_HEIGHT, 48),
    new THREE.MeshStandardMaterial({ color: 0x14171c, metalness: 0.55, roughness: 0.5 }),
  );
  plinth.position.y = PLINTH_HEIGHT / 2;
  plinth.receiveShadow = true;
  group.add(plinth);
  const ringMaterial = new THREE.MeshStandardMaterial({
    color: 0x888c94,
    emissive: 0x888c94,
    emissiveIntensity: RING_EMISSIVE,
    metalness: 0.3,
    roughness: 0.4,
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(PLINTH_RADIUS + 0.06, 0.045, 10, 64), ringMaterial);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = PLINTH_HEIGHT - 0.02;
  group.add(ring);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(PLINTH_RADIUS + 4.5, 48),
    new THREE.ShadowMaterial({ opacity: 0.42 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.001;
  floor.receiveShadow = true;
  group.add(floor);
  return { group, ringMaterial };
}

/** What a loaded model needs the camera to know: how big a sphere it fills and
 *  where to point. Kept here so the poster bakes from the same measurement the
 *  pod frames from. */
export function frameRadius(object3D) {
  const box = new THREE.Box3().setFromObject(object3D);
  if (box.isEmpty()) return null;
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return {
    radius: size.length() / 2,
    targetY: center.y + size.y * 0.06, // a touch high: weapons swing UP
  };
}

/**
 * Distance that fits a sphere of `radius` in BOTH axes. The vertical fov is
 * fixed and the horizontal one falls out of the aspect, so a wide bot in a
 * wide-but-short window is limited by the vertical one — take whichever demands
 * more room. This is also the whole reason a single baked poster fits every
 * window: the constraint is the SMALLER angle, which for any pod wider than it
 * is tall is the vertical one, exactly as it is in a square render.
 */
export function fitDistance(radius, aspect, fovDeg = PREVIEW_FOV) {
  const vFov = (fovDeg * Math.PI) / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
  return (radius / Math.sin(Math.min(vFov, hFov) / 2)) * FIT_MARGIN;
}

/** Put an orbit camera on its arc around (x, targetY, 0). */
export function placeCamera(camera, { x = 0, yaw, pitch, dist, targetY }) {
  camera.position.set(
    x + dist * Math.cos(pitch) * Math.sin(yaw),
    targetY + dist * Math.sin(pitch),
    dist * Math.cos(pitch) * Math.cos(yaw),
  );
  camera.lookAt(new THREE.Vector3(x, targetY, 0));
}
