// Impact sparks + debris chunks. Fed by the event bus in main.js.
import * as THREE from "three";

const SPARK_COLORS = [0xffd77a, 0xffb347, 0xfff2c4];
const MAX_SPARKS = 260;
const MAX_DEBRIS = 40;

export function createEffects(scene) {
  const sparkGroup = new THREE.Group();
  const debrisGroup = new THREE.Group();
  scene.add(sparkGroup, debrisGroup);
  const sparkGeometry = new THREE.PlaneGeometry(0.09, 0.028);
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

  function update(dt) {
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

  return { spawnSparks, spawnDebris, update };
}
