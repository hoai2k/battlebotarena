// Impact sparks, debris chunks and flame. Fed by the event bus in main.js.
import * as THREE from "three";

const SPARK_COLORS = [0xffd77a, 0xffb347, 0xfff2c4];
const MAX_SPARKS = 260;
const MAX_DEBRIS = 40;
const MAX_FLAME = 220;
// A flame's colour is its temperature over time: white at the nozzle, yellow,
// orange, then dull red smoke as it cools. Interpolating along this ramp by
// AGE — not by distance — is what makes a jet read as burning gas rather than
// as orange confetti.
const FLAME_RAMP = [0xfff6d8, 0xffd24a, 0xff8c1a, 0xd83a12, 0x4a2a24];

export function createEffects(scene) {
  const sparkGroup = new THREE.Group();
  const debrisGroup = new THREE.Group();
  const flameGroup = new THREE.Group();
  scene.add(sparkGroup, debrisGroup, flameGroup);
  const sparkGeometry = new THREE.PlaneGeometry(0.09, 0.028);
  const scratchColor = new THREE.Color();
  // Flame puffs are SPRITES, not billboarded quads. A quad has to be turned to
  // face the camera, which means being told which camera — and there is not one
  // camera. The arena draws split-screen from two, the bot-select screen draws
  // two bays from two more, and the frame loop can only hand over one, so every
  // other view got the jet edge-on and saw nothing. A sprite is oriented by the
  // renderer at draw time, per camera, so it is correct in all of them without
  // anyone having to know how many there are.
  const debrisGeometry = new THREE.BoxGeometry(0.16, 0.07, 0.12);
  const debrisMaterial = new THREE.MeshStandardMaterial({ color: 0x777c82, metalness: 0.85, roughness: 0.42 });

  function spawnSparks(point, count = 18, speed = 7) {
    const budget = Math.min(count, MAX_SPARKS - sparkGroup.children.length);
    for (let i = 0; i < budget; i += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: SPARK_COLORS[(Math.random() * SPARK_COLORS.length) | 0],
        transparent: true,
        depthWrite: false,
      });
      const spark = new THREE.Mesh(sparkGeometry, material);
      spark.position.set(point.x, point.y + 0.1, point.z);
      const theta = Math.random() * Math.PI * 2;
      const up = 2.2 + Math.random() * 4.4;
      spark.userData = {
        velocity: new THREE.Vector3(Math.cos(theta) * speed * (0.3 + Math.random() * 0.7), up, Math.sin(theta) * speed * (0.3 + Math.random() * 0.7)),
        life: 0.35 + Math.random() * 0.4,
      };
      spark.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      sparkGroup.add(spark);
    }
  }

  function spawnDebris(point, count = 3) {
    const budget = Math.min(count, MAX_DEBRIS - debrisGroup.children.length);
    for (let i = 0; i < budget; i += 1) {
      const chunk = new THREE.Mesh(debrisGeometry, debrisMaterial);
      chunk.position.set(point.x, point.y + 0.2, point.z);
      chunk.scale.setScalar(0.6 + Math.random() * 1.3);
      chunk.castShadow = true;
      const theta = Math.random() * Math.PI * 2;
      chunk.userData = {
        velocity: new THREE.Vector3(Math.cos(theta) * (2 + Math.random() * 5), 4 + Math.random() * 5, Math.sin(theta) * (2 + Math.random() * 5)),
        spin: new THREE.Vector3(Math.random() * 9, Math.random() * 9, Math.random() * 9),
        life: 2.2 + Math.random() * 1.4,
      };
      debrisGroup.add(chunk);
    }
  }

  /**
   * One puff of burning fuel. `origin` and `forward` are world-space; `spread`
   * is how wide the cone opens. Called every frame while a flamethrower is lit,
   * a few particles at a time, so the jet is a stream rather than a burst.
   */
  function spawnFlame(origin, forward, { count = 3, speed = 11, spread = 0.2, scale = 1 } = {}) {
    const budget = Math.min(count, MAX_FLAME - flameGroup.children.length);
    for (let i = 0; i < budget; i += 1) {
      const material = new THREE.SpriteMaterial({
        color: FLAME_RAMP[0],
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const puff = new THREE.Sprite(material);
      puff.position.copy(origin);
      const velocity = forward.clone().multiplyScalar(speed * (0.7 + Math.random() * 0.6));
      velocity.x += (Math.random() - 0.5) * speed * spread;
      velocity.y += (Math.random() - 0.5) * speed * spread + 1.6;
      velocity.z += (Math.random() - 0.5) * speed * spread;
      puff.userData = { velocity, life: 0.2 + Math.random() * 0.16, age: 0, scale };
      puff.scale.setScalar(0.16 * scale);
      flameGroup.add(puff);
    }
  }

  function update(dt) {
    for (let i = flameGroup.children.length - 1; i >= 0; i -= 1) {
      const puff = flameGroup.children[i];
      const data = puff.userData;
      data.age += dt;
      data.life -= dt;
      // Burning gas slows fast and then rises: drag first, buoyancy after.
      data.velocity.multiplyScalar(1 - Math.min(1, 3.4 * dt));
      data.velocity.y += 9 * dt;
      puff.position.addScaledVector(data.velocity, dt);
      const t = Math.min(1, data.age / 0.34);
      const stop = Math.min(FLAME_RAMP.length - 1, t * (FLAME_RAMP.length - 1));
      const lo = FLAME_RAMP[Math.floor(stop)];
      const hi = FLAME_RAMP[Math.ceil(stop)];
      puff.material.color.setHex(lo).lerp(scratchColor.setHex(hi), stop - Math.floor(stop));
      // Additive blending saturates fast, so the per-puff alpha has to stay low
      // or a handful of them stack into a white slab.
      puff.material.opacity = Math.max(0, (1 - t) * 0.34);
      puff.scale.setScalar((0.16 + t * 0.5) * data.scale);
      if (data.life <= 0) {
        puff.material.dispose();
        flameGroup.remove(puff);
      }
    }
    for (let i = sparkGroup.children.length - 1; i >= 0; i -= 1) {
      const spark = sparkGroup.children[i];
      spark.userData.life -= dt;
      spark.userData.velocity.y -= 22 * dt;
      spark.position.addScaledVector(spark.userData.velocity, dt);
      spark.material.opacity = Math.max(0, spark.userData.life * 2.4);
      if (spark.userData.life <= 0 || spark.position.y < 0) {
        spark.material.dispose();
        sparkGroup.remove(spark);
      }
    }
    for (let i = debrisGroup.children.length - 1; i >= 0; i -= 1) {
      const chunk = debrisGroup.children[i];
      chunk.userData.life -= dt;
      chunk.userData.velocity.y -= 32 * dt;
      chunk.position.addScaledVector(chunk.userData.velocity, dt);
      if (chunk.position.y < 0.06) {
        chunk.position.y = 0.06;
        chunk.userData.velocity.y *= -0.32;
        chunk.userData.velocity.x *= 0.7;
        chunk.userData.velocity.z *= 0.7;
      }
      chunk.rotation.x += chunk.userData.spin.x * dt;
      chunk.rotation.y += chunk.userData.spin.y * dt;
      chunk.rotation.z += chunk.userData.spin.z * dt;
      if (chunk.userData.life <= 0) debrisGroup.remove(chunk);
    }
  }

  /** Drop everything currently alive. The bot-select viewer owns one of these
   *  per bay and has to empty it when the bay's bot changes, or the last jet a
   *  player lit hangs in the air over the next bot they pick. */
  function clear() {
    for (const group of [flameGroup, sparkGroup]) {
      for (const child of [...group.children]) {
        child.material?.dispose?.();
        group.remove(child);
      }
    }
    debrisGroup.clear(); // shared geometry + material, nothing per-chunk to free
  }

  return { spawnSparks, spawnDebris, spawnFlame, update, clear };
}

// --- flamethrower jet --------------------------------------------------------
// Both the match loop and the bot-select practice viewer draw a lit flamethrower
// from the same render state, so the shaping lives here rather than in either
// caller. The viewer used to draw NOTHING: `weapon.flame` was a damage cone in
// the sim and a ramp in previewWeapon, and the only thing that ever turned it
// into pixels was main.js — so on the plinth Free Shipping's second channel
// latched, lit its meter and produced no fire at all.
const jetOrigin = new THREE.Vector3();
const jetDir = new THREE.Vector3();

/**
 * One frame of jet for every nozzle on `spec`, if it has any and is lit.
 * @param {{spawnFlame:Function}} effects
 * @param {object} spec catalog bot spec
 * @param {{position:{x:number,y:number,z:number}, quaternion:THREE.Quaternion}} state
 * @param {number} lit 0..1 burn ramp (the sim's `burning`, reported as weaponSubAngle)
 * @param {number} groundDrop model-content y shift applied by the match's chassis
 *        calibration; the nozzles are body-local like every other catalog point,
 *        so the jet has to follow the DRAWN geometry rather than the physics origin.
 */
const jetPivot = new THREE.Vector3();
const jetAxis = new THREE.Vector3();
const jetSwing = new THREE.Quaternion();

export function spawnBotFlame(effects, spec, state, lit, groundDrop = 0) {
  const flame = spec?.weapon?.flame;
  if (!flame || !(lit > 0.05)) return;
  const dir = flame.dir || { x: 0, y: 0.07, z: -1 };
  // ridesWeapon: the emitter is bolted to the moving part, not the chassis.
  // Kraken's nozzle is in its throat, so as the jaw closes the jet has to swing
  // with it — a flame that keeps pointing where the BOT points while the mouth
  // shuts comes out through the side of the head.
  const w = spec.weapon;
  const swinging = flame.ridesWeapon && w?.pivot;
  if (swinging) {
    const rest = w.restAngle ?? 0;
    const fire = w.fireAngle ?? 0;
    const angle = rest + (fire - rest) * (state.weaponAngle ?? 0);
    jetAxis.set(w.axis?.x ?? 1, w.axis?.y ?? 0, w.axis?.z ?? 0).normalize();
    jetSwing.setFromAxisAngle(jetAxis, angle);
    jetPivot.set(w.pivot.x, w.pivot.y - groundDrop, w.pivot.z);
  }
  for (const nozzle of flame.nozzles || [{ x: 0, y: 0.66, z: -0.5 }]) {
    jetOrigin.set(nozzle.x, nozzle.y - groundDrop, nozzle.z);
    jetDir.set(dir.x, dir.y, dir.z).normalize();
    if (swinging) {
      jetOrigin.sub(jetPivot).applyQuaternion(jetSwing).add(jetPivot);
      jetDir.applyQuaternion(jetSwing);
    }
    jetOrigin.applyQuaternion(state.quaternion).add(state.position);
    jetDir.applyQuaternion(state.quaternion);
    effects.spawnFlame(jetOrigin, jetDir, {
      count: Math.round(2 + lit * 4),
      speed: 11 * (0.6 + lit * 0.4),
      scale: flame.scale ?? 1,
    });
  }
}
