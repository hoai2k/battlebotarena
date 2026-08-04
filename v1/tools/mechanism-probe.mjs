// The mechanisms that are NOT the weapon, exercised one bot at a time.
//
//   node v1/tools/mechanism-probe.mjs [ids...]
//
// A bot's weapon type says what it swings. It says nothing about Tantrum's drum
// riding a carriage, Kraken's flamethrower waiting for the jaw to shut, Duck's
// plow parking half way up, Glitch strafing sideways without turning, Rusty
// stopping dead because it runs on tracks, or Beta shoving itself back onto its
// wheels. Each of those is a separate mechanism with a separate way of failing
// silently, so each gets measured here rather than assumed.
//
// Every check reports a NUMBER as well as a verdict, because "the carriage
// moved" is only interesting next to how far.
import { createHeadlessPhysicsSim, headlessTestUtils } from "../src/headlessPhysicsRig.js";
import { MODEL_PART_CONFIG } from "../src/modelPartConfig.js";
import { BOT_CONFIG } from "../src/botConfig.js";

const { THREE, fighterColliderWorldMinY, fighterUpVector } = headlessTestUtils;

/** Bots that carry each mechanism, straight off the ported data. */
export function botsWithMechanism(name) {
  return Object.keys(MODEL_PART_CONFIG).filter((id) => {
    const config = MODEL_PART_CONFIG[id];
    const weapon = config?.weapon || {};
    if (name === "drive") return BOT_CONFIG[id]?.driveType;
    if (name === "aux") return Boolean(config?.aux);
    return weapon[name] !== undefined;
  });
}

async function withSim(playerId, rivalId, fn) {
  const sim = await createHeadlessPhysicsSim({ playerId, rivalId: rivalId === playerId ? "bronco" : rivalId });
  try {
    return await fn(sim, sim.fighters[0], sim.fighters[1]);
  } finally {
    sim.dispose();
  }
}

const drive = (extra = {}) => ({ leftDrive: 0, rightDrive: 0, ...extra });

/** Tantrum: the drum winches back up its rails and fires forward again. */
export async function trackReport(id) {
  return withSim(id, "quantum", (sim, fighter, rival) => {
    sim.setPose(rival, { x: 30, y: rival.restingBodyY, z: 30 }, Math.PI);
    sim.setInput(0, drive({ weapon: true, weaponSecondary: true }));
    let wound = 0;
    sim.stepFrames(60, () => { wound = Math.max(wound, fighter.weapon.carriage || 0); });
    sim.setInput(0, drive({ weapon: true, weaponSecondary: false }));
    let fling = 1;
    let released = wound;
    sim.stepFrames(30, () => {
      fling = Math.max(fling, fighter.weapon.flingScale || 1);
      released = Math.min(released, fighter.weapon.carriage || 0);
    });
    return { wound, released, fling, hitBoost: MODEL_PART_CONFIG[id].weapon.track.hitBoost };
  });
}

/** Tantrum: the punch arms swing up and shove what is against the front. */
export async function fistsReport(id) {
  return withSim(id, "quantum", (sim, fighter, rival) => {
    sim.setPose(fighter, { x: 0, y: fighter.restingBodyY, z: 2.6 }, 0);
    sim.setPose(rival, { x: 0, y: rival.restingBodyY, z: -0.6 }, Math.PI);
    sim.stepFrames(10);
    const damage = [];
    sim.weaponImpactCallbacks = { recordDamage: (event) => { if (event.kind === "fists") damage.push(event.amount); } };
    let stroke = 0;
    for (let frame = 0; frame < 150; frame += 1) {
      sim.setInput(0, drive({ leftDrive: 1, rightDrive: 1, weaponAux: frame % 24 < 9 }));
      sim.stepFrame();
      stroke = Math.max(stroke, fighter.weapon.fistStroke || 0);
    }
    return { stroke, punches: damage.length, damage: damage.reduce((sum, value) => sum + value, 0) };
  });
}

/** Kraken, Free Shipping: fire burns what is in front, and pushes nothing. */
export async function flameReport(id) {
  return withSim(id, "quantum", (sim, fighter, rival) => {
    sim.setPose(fighter, { x: 0, y: fighter.restingBodyY, z: 2.6 }, 0);
    sim.setPose(rival, { x: 0, y: rival.restingBodyY, z: -0.6 }, Math.PI);
    sim.stepFrames(10);
    const start = rival.rb.translation();
    const damage = [];
    sim.weaponImpactCallbacks = { recordDamage: (event) => { if (event.kind === "flame") damage.push(event.amount); } };
    sim.setInput(0, drive({ leftDrive: 1, rightDrive: 1, weapon: true, weaponSecondary: true }));
    let burning = 0;
    sim.stepFrames(150, () => { burning = Math.max(burning, fighter.weapon.burning || 0); });
    const end = rival.rb.translation();
    return {
      burning,
      ticks: damage.length,
      damage: damage.reduce((sum, value) => sum + value, 0),
      requiresGrip: Boolean(MODEL_PART_CONFIG[id].weapon.flame.requiresGrip),
      shoved: Math.hypot(end.x - start.x, end.z - start.z),
    };
  });
}

/** Duck: RT up, RB down, and it HOLDS wherever it is let go. */
export async function twoWayArmReport(id) {
  return withSim(id, "quantum", (sim, fighter, rival) => {
    sim.setPose(rival, { x: 30, y: rival.restingBodyY, z: 30 }, Math.PI);
    sim.setInput(0, drive({ weapon: true }));
    sim.stepFrames(28);
    const raised = fighter.weapon.stroke || 0;
    sim.setInput(0, drive({}));
    sim.stepFrames(45);
    const parked = fighter.weapon.stroke || 0;
    sim.setInput(0, drive({ weaponSecondary: true }));
    sim.stepFrames(60);
    const lowered = fighter.weapon.stroke || 0;
    return { raised, parked, lowered, held: Math.abs(parked - raised) };
  });
}

/** Claw Viper, Overhaul: jaw shut plus forks down is a HOLD, not a shove. */
export async function gripReport(id) {
  return withSim(id, "quantum", (sim, fighter, rival) => {
    sim.setPose(fighter, { x: 0, y: fighter.restingBodyY, z: 2.4 }, 0);
    sim.setPose(rival, { x: 0, y: rival.restingBodyY, z: -0.4 }, Math.PI);
    sim.stepFrames(10);
    let gripped = 0;
    let maxLift = 0;
    const startY = rival.rb.translation().y;
    sim.setInput(0, drive({ leftDrive: 1, rightDrive: 1, weapon: true, weaponSecondary: true }));
    sim.stepFrames(150, () => {
      if (fighter.weapon.gripHeld) gripped += 1;
      maxLift = Math.max(maxLift, rival.rb.translation().y - startY);
    });
    // Open the jaw: what it was carrying leaves with the arm's speed.
    const beforeRelease = rival.rb.linvel();
    sim.setInput(0, drive({ weapon: true, weaponSecondary: false }));
    sim.stepFrames(20);
    const afterRelease = rival.rb.linvel();
    return {
      grippedFrames: gripped,
      maxLift,
      releaseKick: afterRelease.y - beforeRelease.y,
    };
  });
}

/** Glitch, Shatter: the omniwheels move it sideways without turning it. */
export async function holonomicReport(id) {
  return withSim(id, "quantum", (sim, fighter, rival) => {
    sim.setPose(rival, { x: 30, y: rival.restingBodyY, z: 30 }, Math.PI);
    sim.setPose(fighter, { x: 0, y: fighter.restingBodyY, z: 0 }, 0);
    sim.stepFrames(20);
    const start = fighter.rb.translation();
    const yawOf = () => {
      const q = fighter.rb.rotation();
      return new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w), "YXZ").y;
    };
    const startYaw = yawOf();
    sim.setInput(0, drive({ strafe: 1 }));
    sim.stepFrames(90);
    const end = fighter.rb.translation();
    return {
      sideways: Math.abs(end.x - start.x),
      forward: Math.abs(end.z - start.z),
      yawDrift: Math.abs(Math.atan2(Math.sin(yawOf() - startYaw), Math.cos(yawOf() - startYaw))),
    };
  });
}

/** Rusty, Dragon King: tracks do not coast. */
export async function trackedStopReport(id) {
  const roll = async (throttleFrames, coastFrames) => withSim(id, "quantum", (sim, fighter, rival) => {
    sim.setPose(rival, { x: 30, y: rival.restingBodyY, z: 30 }, Math.PI);
    sim.setInput(0, drive({ leftDrive: 1, rightDrive: 1 }));
    sim.stepFrames(throttleFrames);
    const before = fighter.rb.linvel();
    sim.setInput(0, drive({}));
    sim.stepFrames(coastFrames);
    const after = fighter.rb.linvel();
    return {
      before: Math.hypot(before.x, before.z),
      after: Math.hypot(after.x, after.z),
    };
  });
  const result = await roll(120, 18);
  return { ...result, stopped: result.after / Math.max(0.001, result.before) };
}

/** Beta and the arms: shove yourself back onto your wheels. */
export async function srimechReport(id) {
  return withSim(id, "quantum", (sim, fighter, rival) => {
    sim.setPose(rival, { x: 30, y: rival.restingBodyY, z: 30 }, Math.PI);
    const upsideDown = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI));
    sim.setRotation(fighter, upsideDown);
    // Drop it from ITS OWN height, measured: a machine on its back rests on
    // whatever sticks up furthest, and Rusty is 2ft tall, so a fixed drop
    // spawns it a foot inside the floor where the solver eats every impulse
    // it is given and the srimech looks broken.
    fighter.rb.setTranslation({ x: 0, y: fighter.restingBodyY, z: 0 }, true);
    const invertedMinY = fighterColliderWorldMinY(fighter);
    fighter.rb.setTranslation({ x: 0, y: fighter.restingBodyY - invertedMinY + 0.05, z: 0 }, true);
    sim.setInput(0, drive({}));
    sim.stepFrames(60);
    const beforeUpY = fighterUpVector(fighter).y;
    let bestUpY = beforeUpY;
    let lifted = 0;
    const restY = fighter.rb.translation().y;
    for (let frame = 0; frame < 200; frame += 1) {
      // Work the arm the way a player would: fire, let it return, fire again.
      sim.setInput(0, drive({ weapon: frame % 50 < 22 }));
      sim.stepFrame();
      bestUpY = Math.max(bestUpY, fighterUpVector(fighter).y);
      lifted = Math.max(lifted, fighter.rb.translation().y - restY);
    }
    return { beforeUpY, bestUpY, lifted, recovered: bestUpY > 0.5 };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv.slice(2);
  const want = (id) => !only.length || only.includes(id);
  const line = (label, id, data) => console.log(`${label.padEnd(11)} ${id.padEnd(13)} ${JSON.stringify(data)}`);

  for (const id of botsWithMechanism("track")) if (want(id)) line("carriage", id, await trackReport(id));
  for (const id of botsWithMechanism("fists")) if (want(id)) line("fists", id, await fistsReport(id));
  for (const id of botsWithMechanism("flame")) if (want(id)) line("flame", id, await flameReport(id));
  for (const id of botsWithMechanism("twoWayArm")) if (want(id)) line("two-way", id, await twoWayArmReport(id));
  for (const id of botsWithMechanism("grip")) if (want(id)) line("grip", id, await gripReport(id));
  for (const id of botsWithMechanism("drive")) {
    if (!want(id)) continue;
    if (BOT_CONFIG[id].driveType === "holonomic") line("holonomic", id, await holonomicReport(id));
    else line("tracked", id, await trackedStopReport(id));
  }
  for (const id of botsWithMechanism("selfRight")) if (want(id)) line("srimech", id, await srimechReport(id));
}
