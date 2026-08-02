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
  // Round, not square: a billboarded quad with a hard edge reads as a card,
  // and there is no texture in this project to soften it with.
  const flameGeometry = new THREE.CircleGeometry(0.5, 10);
  const scratchColor = new THREE.Color();
  // Puffs face the camera; main.js hands the current one in each frame.
  const billboard = new THREE.Quaternion();
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
      const material = new THREE.MeshBasicMaterial({
        color: FLAME_RAMP[0],
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const puff = new THREE.Mesh(flameGeometry, material);
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
      puff.quaternion.copy(billboard);
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

  function faceCamera(camera) {
    if (camera) billboard.copy(camera.quaternion);
  }

  return { spawnSparks, spawnDebris, spawnFlame, faceCamera, update };
}
