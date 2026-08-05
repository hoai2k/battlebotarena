// Headless scenario tests for the v2 sim. Run: node tools/sim-tests.mjs
// TAP-ish output, exits 1 on any failure. Uses placeholder BotSimSpecs
// (a 250 lb drum spinner and a 250 lb flipper) — the real catalog lives with
// the GAME agent; the sim only ever sees specs like these as input.

import { createSim, FIXED_DT } from "../src/sim/sim.js";
import { EV } from "../src/shared/events.js";
import { V1_IMPULSE_TO_V2 } from "../src/sim/weaponTuning.js";

// ---------------------------------------------------------------------------
// Placeholder specs
// ---------------------------------------------------------------------------

function drumSpec() {
  return {
    id: "test-drum",
    weightLbs: 250,
    weaponWeightLbs: 70,
    bodyDims: { x: 3.2, y: 1.0, z: 3.8 },
    wheelAnchors: [
      { x: -1.25, y: -0.5, z: -1.3 },
      { x: 1.25, y: -0.5, z: -1.3 },
      { x: -1.25, y: -0.5, z: 1.3 },
      { x: 1.25, y: -0.5, z: 1.3 },
    ],
    maxSpeedFps: 14,
    accel: 8,
    turnRate: 1.0, // turning TIGHTNESS multiplier (v1 semantics), not rad/s,
    weapon: {
      type: "drum",
      spinUpSeconds: 1.6,
      inertia: 1.15, // slug*ft^2
      maxOmega: 160, // rad/s
      budgetCap: 150, // slug*ft/s, applied AFTER multipliers
      efficiency: 0.45,
      impulseScale: 1,
      kickbackScale: 0.7,
      pivot: { x: 0, y: 0.1, z: -2.05 },
      axis: { x: 1, y: 0, z: 0 },
      radius: 0.55,
      length: 1.6,
    },
    colliders: [
      { shape: "box", halfExtents: { x: 1.6, y: 0.42, z: 1.9 }, offset: { x: 0, y: 0, z: 0 } },
    ],
  };
}

function flipperSpec() {
  return {
    id: "test-flipper",
    weightLbs: 250,
    weaponWeightLbs: 80,
    bodyDims: { x: 3.4, y: 0.9, z: 3.6 },
    wheelAnchors: [
      { x: -1.3, y: -0.45, z: -1.2 },
      { x: 1.3, y: -0.45, z: -1.2 },
      { x: -1.3, y: -0.45, z: 1.2 },
      { x: 1.3, y: -0.45, z: 1.2 },
    ],
    maxSpeedFps: 11,
    accel: 7,
    turnRate: 3.0,
    weapon: {
      type: "flipper",
      strokeSeconds: 0.18,
      returnSeconds: 1.2,
      budgetCap: 105, // CO2 impulse budget, slug*ft/s
      reach: 1.8,
      pivot: { x: 0, y: 0.2, z: -1.6 },
      axis: { x: 1, y: 0, z: 0 },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 1.7, y: 0.38, z: 1.8 }, offset: { x: 0, y: 0, z: 0 } },
    ],
  };
}

function crusherSpec() {
  const spec = flipperSpec();
  spec.id = "test-crusher";
  spec.weapon = {
    type: "crusher",
    reach: 1.4,
    clampForce: 380,
    budgetCap: 60,
    pivot: { x: 0, y: 0.2, z: -1.6 },
    axis: { x: 1, y: 0, z: 0 },
  };
  return spec;
}

function hammerSpec() {
  const spec = flipperSpec();
  spec.id = "test-hammer";
  spec.weapon = {
    type: "hammerSaw",
    swingSeconds: 0.4,
    returnSeconds: 0.5,
    reach: 2.4,
    budgetCap: 60,
    pivot: { x: 0, y: 0.5, z: -0.5 },
    axis: { x: 1, y: 0, z: 0 },
  };
  return spec;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const results = [];

function check(cond, label, detail = "") {
  if (!cond) throw new Error(`${label}${detail ? ` — ${detail}` : ""}`);
}

async function withSim(specs, fn) {
  const events = [];
  const emit = (type, payload) => events.push({ type, payload });
  const sim = await createSim({ bots: specs, emit });
  try {
    return await fn(sim, events);
  } finally {
    sim.dispose();
  }
}

/**
 * A match wired to a REAL event bus. Passing a stub `on` builds a match that
 * receives nothing the sim emits and therefore reports no damage whatever
 * happens — a green test that checks nothing.
 */
async function wiredMatch(specs, fn) {
  const { createMatch } = await import("../src/game/match.js");
  const events = [];
  const handlers = new Map();
  const on = (type, handler) => {
    if (!handlers.has(type)) handlers.set(type, []);
    handlers.get(type).push(handler);
    return () => {};
  };
  const emit = (type, payload) => {
    events.push({ type, payload });
    (handlers.get(type) || []).forEach((handler) => handler(payload));
  };
  const sim = await createSim({ bots: specs, emit });
  const match = createMatch({ sim, specs, emit, on });
  match.start();
  const tick = (inputs = specs.map(() => ({}))) => {
    sim.stepFrame(1 / 60, match.filterInputs(inputs));
    match.update(1 / 60);
  };
  try { return await fn({ sim, match, tick, events, busEmit: emit }); } finally { sim.dispose(); }
}

const IDLE = [{}, {}];

function frames(sim, count, inputs = IDLE, onFrame = null) {
  for (let f = 0; f < count; f++) {
    sim.stepFrame(1 / 60, inputs);
    if (onFrame) onFrame(f);
  }
}

function speedXZ(body) {
  const v = body.linvel();
  return Math.hypot(v.x, v.z);
}

function yawFromQuat(q) {
  const x = q.x, y = q.y, z = q.z, w = q.w;
  // rotate (0,0,-1)
  const fx = -(2 * x * z + 2 * w * y);
  const fz = -(1 - 2 * x * x - 2 * y * y);
  return Math.atan2(-fx, -fz);
}

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`ok ${results.length} - ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`not ok ${results.length} - ${name}`);
    console.log(`  ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Scenarios (the 8 from ARCHITECTURE.md + extras)
// ---------------------------------------------------------------------------

await test("settle: bots rest still with no jitter", () =>
  withSim([drumSpec(), flipperSpec()], (sim) => {
    frames(sim, 120); // 2s to settle
    const ref = [0, 1].map((i) => ({ ...sim._test.body(i).translation() }));
    let maxDrift = 0;
    frames(sim, 60, IDLE, () => {
      for (const i of [0, 1]) {
        const p = sim._test.body(i).translation();
        maxDrift = Math.max(
          maxDrift,
          Math.abs(p.x - ref[i].x),
          Math.abs(p.y - ref[i].y),
          Math.abs(p.z - ref[i].z),
        );
      }
    });
    check(maxDrift < 0.01, "settled bots jitter", `drift ${maxDrift.toFixed(5)} ft (limit 0.01)`);
    for (const i of [0, 1]) {
      const state = sim.getRenderState()[i];
      const groundedProbes = state.probeCompression.filter((c) => c > 0.05).length;
      check(groundedProbes === 4, `bot ${i} probes grounded`, `${groundedProbes}/4`);
    }
  }));

await test("drive straight: reaches ~maxSpeed and holds heading", () =>
  withSim([drumSpec(), flipperSpec()], (sim) => {
    sim._test.setPose(0, { x: 0, z: 14 }, 0);
    sim._test.setPose(1, { x: 20, z: -18 }, 0); // out of the way
    frames(sim, 30);
    const start = { ...sim._test.body(0).translation() };
    let peak = 0;
    frames(sim, 150, [{ leftDrive: 1, rightDrive: 1 }, {}], () => {
      peak = Math.max(peak, speedXZ(sim._test.body(0)));
    });
    const end = sim._test.body(0).translation();
    const dz = Math.abs(end.z - start.z);
    const dx = Math.abs(end.x - start.x);
    const maxSpeed = drumSpec().maxSpeedFps;
    check(peak > maxSpeed * 0.9, "reached speed", `peak ${peak.toFixed(2)} vs max ${maxSpeed}`);
    check(peak < maxSpeed * 1.15, "did not overshoot", `peak ${peak.toFixed(2)}`);
    check(dz > 15, "travelled forward", `dz ${dz.toFixed(2)}`);
    check(dx < dz * 0.05, "heading held within 5%", `dx ${dx.toFixed(2)} over dz ${dz.toFixed(2)}`);
  }));

await test("turn in place: yaws fast without wandering", () =>
  withSim([drumSpec(), flipperSpec()], (sim) => {
    sim._test.setPose(0, { x: 0, z: 5 }, 0);
    sim._test.setPose(1, { x: 20, z: -18 }, 0);
    frames(sim, 30);
    const start = { ...sim._test.body(0).translation() };
    const yaw0 = yawFromQuat(sim._test.body(0).rotation());
    let accumulated = 0;
    let lastYaw = yaw0;
    frames(sim, 90, [{ leftDrive: 1, rightDrive: -1 }, {}], () => {
      const yaw = yawFromQuat(sim._test.body(0).rotation());
      let d = yaw - lastYaw;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      accumulated += d;
      lastYaw = yaw;
    });
    const end = sim._test.body(0).translation();
    const drift = Math.hypot(end.x - start.x, end.z - start.z);
    check(Math.abs(accumulated) > Math.PI / 2, "turned > 90 deg in 1.5s", `${((accumulated * 180) / Math.PI).toFixed(1)} deg`);
    check(drift < 1.5, "stayed in place", `drift ${drift.toFixed(2)} ft`);
  }));

await test("wall crash: no penetration, bounces back, IMPACT emitted", () =>
  withSim([drumSpec(), flipperSpec()], (sim, events) => {
    // Head at the west wall (x=-24) at z=-15: a lane clear of screws and deck.
    sim._test.setPose(0, { x: -12, z: -15 }, Math.PI / 2); // forward -> -x
    sim._test.setPose(1, { x: 20, z: 18 }, 0);
    frames(sim, 30);
    const chassisHalf = 1.9;
    const wallFace = -24;
    const minAllowedX = wallFace + chassisHalf - 0.05;
    let minX = Infinity;
    let bouncedBack = false;
    frames(sim, 240, [{ leftDrive: 1, rightDrive: 1 }, {}], () => {
      const p = sim._test.body(0).translation();
      const v = sim._test.body(0).linvel();
      minX = Math.min(minX, p.x);
      if (p.x < -19 && v.x > 0.5) bouncedBack = true;
    });
    check(minX >= minAllowedX, "no wall penetration > 0.05", `minX ${minX.toFixed(3)} vs limit ${minAllowedX.toFixed(3)}`);
    check(bouncedBack, "bounced back off the wall");
    const impacts = events.filter((e) => e.type === EV.IMPACT && e.payload.surface === "wall" && e.payload.botIndex === 0);
    check(impacts.length >= 1, "EV.IMPACT with surface wall emitted");
    check(impacts[0].payload.force > 0, "impact force positive");
  }));

const ladder = []; // shared with the final report
// The payload's `impulse` is now v1's damage proxy, not the impulse the body
// got — `appliedImpulse` is that. The cap likewise binds inside the v1 chain,
// before the unit bridge, so the ceiling on the applied push is
// budgetCap x impulseScale x V1_IMPULSE_TO_V2. What this test is really for is
// the SHAPE: a real ladder, not the flat always-capped line v2 used to have.
await test("spinner hit ladder: impulse grows with energy and is capped", async () => {
  const spec = drumSpec();
  const appliedCeiling = spec.weapon.budgetCap * (spec.weapon.impulseScale ?? 1) * V1_IMPULSE_TO_V2;
  for (const ratio of [0.25, 0.5, 1.0]) {
    await withSim([drumSpec(), flipperSpec()], (sim, events) => {
      // Drum front reach is z=-2.6; park the target just out of contact and
      // drive in so the blade meets the chassis at a realistic closing speed.
      sim._test.setPose(0, { x: 0, z: 0 }, 0);
      sim._test.setPose(1, { x: 0, z: -4.75 }, Math.PI);
      frames(sim, 30);
      let peakTargetSpeed = 0;
      frames(sim, 90, [{ leftDrive: 0.6, rightDrive: 0.6 }, {}], () => {
        // Pin the spin until first contact so the rung tests an exact energy.
        const hitYet = events.some((e) => e.type === EV.WEAPON_HIT && e.payload.targetIndex === 1);
        if (!hitYet) sim._test.setWeaponOmega(0, spec.weapon.maxOmega * ratio);
        const v = sim._test.body(1).linvel();
        peakTargetSpeed = Math.max(peakTargetSpeed, Math.hypot(v.x, v.y, v.z));
      });
      const hits = events.filter((e) => e.type === EV.WEAPON_HIT && e.payload.attackerIndex === 0 && e.payload.targetIndex === 1);
      check(hits.length >= 1, `hit registered at ratio ${ratio}`);
      ladder.push({
        ratio,
        impulse: hits[0].payload.impulse,
        applied: hits[0].payload.appliedImpulse,
        peakTargetSpeed,
        energyBefore: hits[0].payload.energyBefore,
      });
    });
  }
  check(ladder[0].applied < ladder[1].applied, "applied impulse grows 25% -> 50%", `${ladder[0].applied.toFixed(1)} vs ${ladder[1].applied.toFixed(1)}`);
  check(ladder[1].applied < ladder[2].applied, "applied impulse grows 50% -> 100%", `${ladder[1].applied.toFixed(1)} vs ${ladder[2].applied.toFixed(1)}`);
  check(ladder[0].impulse < ladder[2].impulse, "damage grows with spin", `${ladder[0].impulse.toFixed(1)} vs ${ladder[2].impulse.toFixed(1)}`);
  // A flat line would satisfy "grows" within float noise; the ramp is the point.
  check(ladder[2].applied >= ladder[0].applied * 3, "full spin hits far harder than quarter spin",
    `${ladder[0].applied.toFixed(1)} -> ${ladder[2].applied.toFixed(1)}`);
  for (const rung of ladder) {
    check(rung.applied <= appliedCeiling + 1e-6, `applied impulse capped at ${appliedCeiling.toFixed(1)}`, `got ${rung.applied.toFixed(1)}`);
  }
  check(ladder[2].peakTargetSpeed > ladder[0].peakTargetSpeed, "target is thrown harder at full spin",
    `${ladder[0].peakTargetSpeed.toFixed(1)} -> ${ladder[2].peakTargetSpeed.toFixed(1)} ft/s`);
  check(ladder[2].peakTargetSpeed < 60, "target speed stays sane", `${ladder[2].peakTargetSpeed.toFixed(1)} ft/s`);
});

// The cap still has to bind — with a budget low enough to clamp the raw hit,
// every rung should land on the same applied ceiling.
await test("spinner cap: a low budget clamps every rung to the same impulse", async () => {
  const capped = [];
  for (const ratio of [0.5, 1.0]) {
    const attacker = drumSpec();
    attacker.weapon.budgetCap = 4; // v1 impulse units, well below the raw hit
    await withSim([attacker, flipperSpec()], (sim, events) => {
      sim._test.setPose(0, { x: 0, z: 0 }, 0);
      sim._test.setPose(1, { x: 0, z: -4.75 }, Math.PI);
      frames(sim, 30);
      frames(sim, 90, [{ leftDrive: 0.6, rightDrive: 0.6 }, {}], () => {
        const hitYet = events.some((e) => e.type === EV.WEAPON_HIT && e.payload.targetIndex === 1);
        if (!hitYet) sim._test.setWeaponOmega(0, attacker.weapon.maxOmega * ratio);
      });
      const hits = events.filter((e) => e.type === EV.WEAPON_HIT && e.payload.targetIndex === 1);
      check(hits.length >= 1, `capped hit registered at ratio ${ratio}`);
      capped.push(hits[0].payload.appliedImpulse);
    });
  }
  const ceiling = 4 * V1_IMPULSE_TO_V2;
  check(Math.abs(capped[0] - ceiling) < 1e-6, "half spin sits on the cap", `${capped[0].toFixed(3)} vs ${ceiling.toFixed(3)}`);
  check(Math.abs(capped[1] - ceiling) < 1e-6, "full spin sits on the cap", `${capped[1].toFixed(3)} vs ${ceiling.toFixed(3)}`);
});

await test("spinner: spin-up emits WEAPON_SPIN, hit drains energy, attacker recoils", () =>
  withSim([drumSpec(), flipperSpec()], (sim, events) => {
    sim._test.setPose(0, { x: 0, z: 0 }, 0);
    sim._test.setPose(1, { x: 15, z: -15 }, Math.PI); // far away during spin-up
    frames(sim, 30);
    frames(sim, 120, [{ weapon: true }, {}]); // 2s of spin-up
    const spins = events.filter((e) => e.type === EV.WEAPON_SPIN && e.payload.botIndex === 0);
    check(spins.length > 10, "WEAPON_SPIN stream emitted", `${spins.length} events`);
    const topRatio = spins[spins.length - 1].payload.ratio;
    check(topRatio > 0.9, "spun up past 90%", `ratio ${topRatio.toFixed(2)}`);

    // Bring the target in front and drive into it at full spin.
    sim._test.setPose(1, { x: 0, z: -4.75 }, Math.PI);
    const ratioBefore = sim._test.weapons[0].getRatio();
    let attackerRecoil = 0;
    let ratioAfterHit = null;
    frames(sim, 90, [{ leftDrive: 0.6, rightDrive: 0.6, weapon: true }, {}], () => {
      const v = sim._test.body(0).linvel();
      const hit = events.some((e) => e.type === EV.WEAPON_HIT && e.payload.targetIndex === 1);
      if (hit) {
        attackerRecoil = Math.max(attackerRecoil, Math.hypot(v.x, v.z));
        if (ratioAfterHit === null) ratioAfterHit = sim._test.weapons[0].getRatio();
      }
    });
    const hits = events.filter((e) => e.type === EV.WEAPON_HIT && e.payload.attackerIndex === 0 && e.payload.targetIndex === 1);
    check(hits.length >= 1, "contact hit landed");
    check(ratioAfterHit !== null && ratioAfterHit < ratioBefore - 0.05, "hit drained spinner energy", `${ratioBefore.toFixed(2)} -> ${ratioAfterHit?.toFixed(2)}`);
    check(attackerRecoil > 2, "attacker kicked back", `${attackerRecoil.toFixed(1)} ft/s`);
  }));

await test("saw launch: parked bot pops off an active kill saw", () =>
  withSim([drumSpec(), flipperSpec()], (sim, events) => {
    sim._test.setPose(0, { x: -16.094, z: -5.354 }, 0); // on kill-saw-nw slot
    sim._test.setPose(1, { x: 20, z: 18 }, 0);
    frames(sim, 60);
    const restY = sim._test.body(0).translation().y;
    sim.setKillSawsActive(true);
    let peakVy = 0;
    let peakY = restY;
    let airborne = false;
    frames(sim, 300, IDLE, () => {
      peakVy = Math.max(peakVy, sim._test.body(0).linvel().y);
      peakY = Math.max(peakY, sim._test.body(0).translation().y);
      const compression = sim.getRenderState()[0].probeCompression;
      if (compression.every((c) => c === 0)) airborne = true;
    });
    check(peakVy > 3, "upward launch velocity", `peak vy ${peakVy.toFixed(1)} ft/s`);
    check(peakY > restY + 0.25, "bot left the floor", `rose ${(peakY - restY).toFixed(2)} ft`);
    check(airborne, "all probes left the ground");
    check(events.some((e) => e.type === EV.HAZARD_LAUNCH && e.payload.kind === "killSaw" && e.payload.botIndex === 0), "EV.HAZARD_LAUNCH emitted");
    check(events.some((e) => e.type === EV.HAZARD_CONTACT && e.payload.kind === "killSaw" && e.payload.botIndex === 0), "EV.HAZARD_CONTACT emitted");
  }));

await test("airborne: no drive forces while off the ground", () =>
  withSim([drumSpec(), flipperSpec()], (sim) => {
    sim._test.setPose(0, { x: 0, z: 5 }, 0);
    sim._test.setPose(1, { x: 20, z: -18 }, 0);
    frames(sim, 30);
    const mass = 250 / 32.174;
    sim._test.applyImpulse(0, { x: 0, y: mass * 16, z: 0 }); // pop straight up
    frames(sim, 6); // leave the ground
    const state = sim.getRenderState()[0];
    check(state.probeCompression.every((c) => c === 0), "airborne after pop");
    const v0 = speedXZ(sim._test.body(0));
    let stillAirborneFrames = 0;
    let horizGain = 0;
    frames(sim, 40, [{ leftDrive: 1, rightDrive: 1 }, {}], () => {
      const comp = sim.getRenderState()[0].probeCompression;
      if (comp.every((c) => c === 0)) {
        stillAirborneFrames++;
        horizGain = Math.max(horizGain, speedXZ(sim._test.body(0)) - v0);
      }
    });
    check(stillAirborneFrames > 20, "stayed airborne long enough to measure", `${stillAirborneFrames} frames`);
    check(horizGain < 0.8, "full throttle gained no meaningful speed mid-air", `gain ${horizGain.toFixed(2)} ft/s`);
  }));

await test("flip: flipper launches the target on weapon press at contact", () =>
  withSim([flipperSpec(), drumSpec()], (sim, events) => {
    sim._test.setPose(0, { x: 0, z: 0 }, 0); // flipper facing -z
    sim._test.setPose(1, { x: 0, z: -2.9 }, Math.PI); // in the flip zone
    frames(sim, 30);
    const targetY0 = sim._test.body(1).translation().y;
    let peakVy = 0;
    let peakY = targetY0;
    frames(sim, 60, [{ weapon: true }, {}], () => {
      peakVy = Math.max(peakVy, sim._test.body(1).linvel().y);
      peakY = Math.max(peakY, sim._test.body(1).translation().y);
    });
    check(events.some((e) => e.type === EV.WEAPON_FIRED && e.payload.botIndex === 0 && e.payload.weaponType === "flipper"), "EV.WEAPON_FIRED emitted");
    const hits = events.filter((e) => e.type === EV.WEAPON_HIT && e.payload.attackerIndex === 0 && e.payload.targetIndex === 1);
    check(hits.length === 1, "one flip hit per stroke", `${hits.length} hits`);
    check(peakVy > 6, "target launched upward", `peak vy ${peakVy.toFixed(1)} ft/s`);
    check(peakY > targetY0 + 0.5, "target left the floor", `rose ${(peakY - targetY0).toFixed(2)} ft`);
  }));

await test("crusher: clamp engages and ticks damage events", () =>
  withSim([crusherSpec(), drumSpec()], (sim, events) => {
    sim._test.setPose(0, { x: 0, z: 0 }, 0);
    sim._test.setPose(1, { x: 0, z: -2.9 }, Math.PI);
    frames(sim, 30);
    frames(sim, 75, [{ weapon: true }, {}]); // 1.25s hold
    check(events.some((e) => e.type === EV.WEAPON_FIRED && e.payload.weaponType === "crusher"), "EV.WEAPON_FIRED emitted");
    const ticks = events.filter((e) => e.type === EV.WEAPON_HIT && e.payload.attackerIndex === 0 && e.payload.targetIndex === 1);
    check(ticks.length >= 3, "clamp ticks while engaged", `${ticks.length} ticks`);
    check(ticks.every((t) => !t.payload.heavy), "clamp ticks are not heavy hits");
  }));

await test("crusher: a jaw already shut does not bite what it drives into", () =>
  // A bite is the jaw CLOSING on something. Held down, the trigger parked the
  // mouth closed and every bot Kraken bumped into counted as bitten — a crusher
  // that does its damage by driving into people. The gesture is press, and the
  // gesture has to happen ON the target.
  withSim([crusherSpec(), drumSpec()], (sim, events) => {
    sim._test.setPose(0, { x: 0, z: 0 }, 0);
    sim._test.setPose(1, { x: 0, z: -14 }, Math.PI); // well out of reach
    frames(sim, 30);
    frames(sim, 90, [{ weapon: true }, {}]); // shut the jaw on nothing and hold it
    events.length = 0;
    // Now drive it into them, trigger still down the whole way.
    frames(sim, 240, [{ weapon: true, leftDrive: 1, rightDrive: 1 }, {}]);
    const gap = Math.abs(sim._test.body(0).translation().z - sim._test.body(1).translation().z);
    check(gap < 6, "it did reach them", `${gap.toFixed(1)}ft apart`);
    const bitten = events.filter((e) => e.type === EV.WEAPON_HIT && e.payload.attackerIndex === 0);
    check(bitten.length === 0, "a closed jaw driven into a bot bites nothing", `${bitten.length} clamp ticks`);

    // Let go, keep driving so they stay in the mouth, and press again: it bites.
    frames(sim, 40, [{ leftDrive: 1, rightDrive: 1 }, {}]);
    events.length = 0;
    frames(sim, 90, [{ weapon: true, leftDrive: 1, rightDrive: 1 }, {}]);
    const now = events.filter((e) => e.type === EV.WEAPON_HIT && e.payload.attackerIndex === 0);
    check(now.length > 0, "opening and shutting it on them does", `${now.length} clamp ticks`);
  }));

await test("hammer-saw: swing connects, then grinds while held", () =>
  withSim([hammerSpec(), drumSpec()], (sim, events) => {
    sim._test.setPose(0, { x: 0, z: 0 }, 0);
    sim._test.setPose(1, { x: 0, z: -3.2 }, Math.PI);
    frames(sim, 30);
    // Swing, then keep the saw held down while creeping after the target.
    frames(sim, 90, [{ weapon: true, leftDrive: 0.35, rightDrive: 0.35 }, {}]);
    check(events.some((e) => e.type === EV.WEAPON_FIRED && e.payload.weaponType === "hammerSaw"), "EV.WEAPON_FIRED emitted");
    const hits = events.filter((e) => e.type === EV.WEAPON_HIT && e.payload.attackerIndex === 0);
    check(hits.length >= 1, "swing landed");
    check(hits[0].payload.heavy, "first slam is the heavy hit");
    check(hits.length >= 3, "grind ticks while held on target", `${hits.length} hits`);
    const angle = sim.getRenderState()[0].weaponAngle;
    check(angle > 0.9, "stroke angle held at full extension", `angle ${angle.toFixed(2)}`);
  }));

await test("screws: grinding a corner screw emits HAZARD_CONTACT", () =>
  withSim([drumSpec(), flipperSpec()], (sim, events) => {
    sim._test.setPose(0, { x: -20, z: 0.8 }, Math.PI / 2); // face -x toward west screw
    sim._test.setPose(1, { x: 20, z: 18 }, 0);
    frames(sim, 30);
    frames(sim, 180, [{ leftDrive: 1, rightDrive: 1 }, {}]);
    const grinds = events.filter((e) => e.type === EV.HAZARD_CONTACT && e.payload.kind === "screw" && e.payload.botIndex === 0);
    check(grinds.length >= 1, "screw contact events emitted", `${grinds.length}`);
    check(grinds[0].payload.intensity > 0 && grinds[0].payload.intensity <= 1, "intensity normalized");
  }));

await test("render state: interpolation and shape are sane", () =>
  withSim([drumSpec(), flipperSpec()], (sim) => {
    frames(sim, 90, [{ leftDrive: 1, rightDrive: 1, weapon: true }, {}]);
    const state = sim.getRenderState();
    check(state.length === 2, "two bots");
    for (const s of state) {
      for (const k of ["x", "y", "z"]) check(Number.isFinite(s.position[k]), `finite position.${k}`);
      for (const k of ["x", "y", "z", "w"]) check(Number.isFinite(s.quaternion[k]), `finite quaternion.${k}`);
      check(s.wheelSpin.length === 4, "wheelSpin per wheel");
      check(s.probeCompression.length === 4, "probeCompression per probe");
      check(Number.isFinite(s.weaponAngle) && Number.isFinite(s.weaponRatio), "weapon scalars finite");
    }
    check(state[0].weaponAngle > 0, "spinner accumulated angle");
    check(Math.abs(state[0].wheelSpin[0]) > 1, "wheels spun while driving");
    const hazardState = sim.getHazardState();
    check(hazardState.killSaws.length === 12, "12 kill saws");
    check(hazardState.screws.length === 4, "4 screws");
    sim.reset();
    const after = sim.getRenderState();
    check(Math.abs(after[0].position.z - 19) < 0.5, "reset restored spawn");
  }));

await test("srimech: an overturned bot gets itself back onto its wheels", async () => {
  // Two ways off your back: shove the arm into the floor, or — with a rotor
  // lit — throw the drive lock to lock and let the reaction walk you over.
  // Both need the bot to be ON something; neither works in mid-air.
  const onBack = (sim) => {
    const body = sim._test.body(0);
    body.setTranslation({ x: 0, y: 1.6, z: 0 }, true);
    body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    frames(sim, 90);
  };
  const upY = (sim) => {
    const q = sim._test.body(0).rotation();
    return 1 - 2 * (q.x * q.x + q.z * q.z);
  };

  await withSim([flipperSpec(), drumSpec()], (sim) => {
    sim._test.setPose(1, { x: 16, z: 16 }, 0);
    onBack(sim);
    check(upY(sim) < -0.5, "starts on its back", upY(sim).toFixed(2));
    for (let i = 0; i < 240 && upY(sim) < 0.5; i += 1) {
      frames(sim, 1, [{ weapon: Math.floor(i / 60) % 2 === 0 }, {}]);
    }
    check(upY(sim) > 0.5, "flipper fired itself over", upY(sim).toFixed(2));
  });

  await withSim([drumSpec(), flipperSpec()], (sim) => {
    sim._test.setPose(1, { x: 16, z: 16 }, 0);
    onBack(sim);
    sim._test.setWeaponOmega(0, drumSpec().weapon.maxOmega);
    for (let i = 0; i < 480 && upY(sim) < 0.5; i += 1) {
      const lock = Math.floor(i / 20) % 2 === 0 ? 1 : -1;
      frames(sim, 1, [{ leftDrive: lock, rightDrive: -lock, weapon: true }, {}]);
    }
    check(upY(sim) > 0.5, "spinner walked itself over on the sticks", upY(sim).toFixed(2));
  });

  // Upright and hammering every control at once, nothing may launch it.
  await withSim([flipperSpec(), drumSpec()], (sim) => {
    sim._test.setPose(1, { x: 16, z: 16 }, 0);
    frames(sim, 60);
    const rest = sim._test.vehicles[0].restCenterHeight;
    let peak = 0;
    for (let i = 0; i < 480; i += 1) {
      const lock = Math.floor(i / 20) % 2 === 0 ? 1 : -1;
      frames(sim, 1, [{ leftDrive: lock, rightDrive: -lock, weapon: true, sawActive: true }, {}]);
      peak = Math.max(peak, sim._test.body(0).translation().y - rest);
    }
    check(peak < 0.6, "no srimech while upright", `${peak.toFixed(2)}ft hop`);
  });
});

await test("catalog: nothing but a wedge sits in front of a spinner", async () => {
  // A disc only reaches far forward at its own axle height, so a LEVEL box
  // ahead of the swept circle is a stand-off that keeps opponents outside the
  // blade entirely — Deep Six, Bite Force and Witch Doctor all shipped that
  // way and could not land a single head-on hit. A WEDGE ahead of it is the
  // opposite: opponents ride up the slope into the blade, which is what those
  // machines are built to do. So the invariant is about shape, not distance.
  const { CATALOG } = await import("../src/assets/catalog.js");
  for (const spec of Object.values(CATALOG)) {
    const w = spec.weapon;
    if (w?.type !== "bar" && w?.type !== "drum") continue;
    const radius = w.radius ?? Math.max(w.dims?.y ?? 0, w.dims?.z ?? 0);
    const discFront = w.pivot.z - radius;
    const blockers = spec.colliders.filter((c) => {
      const front = (c.offset?.z ?? 0) - (c.halfExtents?.z ?? c.radius ?? 0);
      return front < discFront && c.shape !== "wedge";
    });
    check(blockers.length === 0, `${spec.id}: only wedges lead the blade`,
      `${blockers.length} level collider(s) ahead of disc front ${discFront.toFixed(2)}`);
  }
});

await test("catalog: every bot's colliders clear the floor at rest", async () => {
  // The suspension parks a bot's ORIGIN at (probeTravel - restCompression) minus
  // its lowest wheel anchor. Colliders are authored in that origin's frame from
  // y=0 up, so an anchor set too high buries the chassis in the floor: it takes
  // the load off the wheels and the bot cannot drive. Copperhead sat 0.24ft
  // under and did not move at all; Overhaul at 0.19ft could turn on the spot but
  // not go anywhere, which reads as a drive bug rather than a geometry one.
  const { CATALOG } = await import("../src/assets/catalog.js");
  const { VEHICLE_TUNING } = await import("../src/sim/vehicle.js");
  for (const spec of Object.values(CATALOG)) {
    const minAnchorY = Math.min(...spec.wheelAnchors.map((a) => a.y));
    const originY = (VEHICLE_TUNING.probeTravel - VEHICLE_TUNING.restCompression) - minAnchorY;
    // A cylinder's vertical half-extent depends on which way it points: a wheel
    // (axis x) is as tall as its radius, a disc lying flat (axis y, Gigabyte's
    // shell) only as tall as its half-height.
    const lowest = Math.min(...spec.colliders.map((c) => (c.offset?.y ?? 0)
      - (c.shape === "cylinder"
        ? ((c.axis ?? "y") === "y" ? c.halfHeight : c.radius)
        : (c.halfExtents?.y ?? 0))));
    const clearance = originY + lowest;
    check(clearance > -0.02 && clearance < 0.12, `${spec.id}: rests on its wheels`,
      `lowest collider sits ${clearance.toFixed(3)}ft from the floor`);
  }
});

await test("posters: every bot has one, and no poster outlives its bot", async () => {
  // The select screen shows a baked picture while a model downloads
  // (src/engine/posters.js). A bot with no poster silently falls back to a
  // spinner over an empty bay, which is the behaviour the posters exist to
  // replace and looks like nothing is happening — and it is invisible from
  // anywhere else, because everything still works. A new bot added to the
  // roster is exactly when it happens.
  const fs = await import("node:fs");
  const { CATALOG } = await import("../src/assets/catalog.js");
  const dir = new URL("../public/posters/", import.meta.url);
  let index = {};
  try {
    index = JSON.parse(fs.readFileSync(new URL("posters.json", dir), "utf8"))?.bots || {};
  } catch { /* never generated */ }
  const ids = Object.keys(CATALOG);
  const missing = ids.filter((id) => !index[id] || !fs.existsSync(new URL(`${id}.png`, dir)));
  check(missing.length === 0, "every bot in the catalog has a poster",
    `${missing.join(", ")} — run: node server.mjs & node tools/posters.mjs ${missing.join(" ")}`);
  const orphans = Object.keys(index).filter((id) => !CATALOG[id]);
  check(orphans.length === 0, "no poster is left over from a bot that is gone",
    `${orphans.join(", ")} — delete them from public/posters/`);
});

await test("start boxes: 2, 3 and 4 machines each stand clear of everything", async () => {
  // The arena's start boxes move with the head count (sim/arenaSpec.js): the
  // classic pair, plus a third on the west wall for three, and a spread-out
  // four. A box laid over a screw, a kill-saw slot, the upper deck or another
  // box is a machine that starts the round already being thrown around — and
  // it is invisible until somebody plays that head count, because nothing else
  // in the game reads these numbers.
  const { spawnsFor, SPAWN_BOX, ARENA, SCREWS, UPPER_DECK, KILL_SAWS } = await import("../src/sim/arenaSpec.js");
  const halfBox = Math.hypot(SPAWN_BOX.x, SPAWN_BOX.z) / 2; // worst case, any facing
  /** The box's own footprint at its facing — half-extents, rotated. */
  const extent = (spawn) => {
    const c = Math.abs(Math.cos(spawn.yaw));
    const s = Math.abs(Math.sin(spawn.yaw));
    return { x: (SPAWN_BOX.x / 2) * c + (SPAWN_BOX.z / 2) * s, z: (SPAWN_BOX.x / 2) * s + (SPAWN_BOX.z / 2) * c };
  };
  const hw = ARENA.width / 2;
  const hl = ARENA.length / 2;

  /** Distance from a point to a screw's axis, treated as the segment it is. */
  const screwDistance = (screw, x, z) => {
    const yaw = (screw.yawDeg * Math.PI) / 180;
    const dx = Math.cos(yaw);
    const dz = -Math.sin(yaw);
    const half = screw.length / 2;
    const t = Math.max(-half, Math.min(half, (x - screw.x) * dx + (z - screw.z) * dz));
    return Math.hypot(x - (screw.x + dx * t), z - (screw.z + dz * t));
  };

  for (const count of [2, 3, 4]) {
    const spawns = spawnsFor(count);
    check(spawns.length === count, `${count} machines get ${count} boxes`, `got ${spawns.length}`);
    spawns.forEach((spawn, i) => {
      const label = `${count}-bot box ${i}`;
      const box = extent(spawn);
      check(Math.abs(spawn.x) + box.x < hw && Math.abs(spawn.z) + box.z < hl,
        `${label} is inside the arena`, `(${spawn.x}, ${spawn.z})`);
      for (const screw of SCREWS.list) {
        const gap = screwDistance(screw, spawn.x, spawn.z);
        check(gap > SCREWS.radius + SPAWN_BOX.x / 2,
          `${label} is not sitting on a screw`, `${gap.toFixed(2)}ft from the screw at (${screw.x}, ${screw.z})`);
      }
      const onDeck = Math.abs(spawn.x - UPPER_DECK.x) < UPPER_DECK.sizeX / 2 + halfBox
        && Math.abs(spawn.z - UPPER_DECK.z) < UPPER_DECK.sizeZ / 2 + halfBox;
      check(!onDeck, `${label} is not under the upper deck`, `(${spawn.x}, ${spawn.z})`);
      for (const saw of KILL_SAWS.slots) {
        const gap = Math.hypot(spawn.x - saw.x, spawn.z - saw.z);
        check(gap > halfBox + 0.6, `${label} is not over a kill saw`, `${gap.toFixed(2)}ft from (${saw.x}, ${saw.z})`);
      }
      spawns.forEach((other, j) => {
        if (j <= i) return;
        const gap = Math.hypot(spawn.x - other.x, spawn.z - other.z);
        check(gap > halfBox * 2, `${label} does not overlap box ${j}`, `${gap.toFixed(2)}ft apart`);
      });
    });
  }

  // The 1v1 poses are load-bearing — every camera angle and every tuned opening
  // exchange was measured from them — so they must survive adding head counts.
  const pair = spawnsFor(2);
  check(pair[0].x === 0 && pair[0].z === 19 && pair[0].yaw === 0
    && pair[1].x === 0 && pair[1].z === -18.7 && Math.abs(pair[1].yaw - Math.PI) < 1e-9,
    "the head-to-head pair has not moved", JSON.stringify(pair));
  check(spawnsFor(3).slice(0, 2).every((s, i) => s.x === pair[i].x && s.z === pair[i].z),
    "adding a third machine does not move the first two");

  // The third box faces the upper deck from the far side of the arena, which is
  // what "in front of the screw that is not the deck's" means in coordinates:
  // it is on the -x side, and it is looking at +x.
  const third = spawnsFor(3)[2];
  const forward = { x: -Math.sin(third.yaw), z: -Math.cos(third.yaw) };
  check(third.x < 0 && UPPER_DECK.x > 0, "the third box is across the arena from the deck",
    `box x ${third.x}, deck x ${UPPER_DECK.x}`);
  check(forward.x > 0.99 && Math.abs(forward.z) < 0.01, "and it is pointed at the deck",
    `forward (${forward.x.toFixed(2)}, ${forward.z.toFixed(2)})`);
  const westScrew = SCREWS.list.reduce((a, b) => (a.x < b.x ? a : b));
  check(screwDistance(westScrew, third.x, third.z) < 4.5, "and it stands in front of the west screw",
    `${screwDistance(westScrew, third.x, third.z).toFixed(2)}ft`);

  // Four is two a side: two red boxes facing one way, two blue facing the other.
  const four = spawnsFor(4);
  const colours = new Map();
  four.forEach((s) => colours.set(s.color, (colours.get(s.color) || 0) + 1));
  check(colours.size === 2 && [...colours.values()].every((n) => n === 2),
    "four machines get two boxes of each colour", JSON.stringify([...colours]));
  four.forEach((s) => {
    const same = four.filter((o) => o.color === s.color);
    check(same.every((o) => Math.abs(o.yaw - s.yaw) < 1e-9), "same colour, same facing");
    check(Math.abs(Math.abs(s.x) - 12) < 1e-9, "and they sit halfway out to each side wall", `x ${s.x}`);
  });
});

await test("three and four machines all stand up in their boxes", async () => {
  // The sim was written around a pair and says so in a dozen places (foe
  // selection, input completion, reset). Three and four have to be the same
  // thing with more of it, and the way that fails is quiet: a bot spawned into
  // geometry sinks, and a bot with no foe throws inside a weapon update.
  const { spawnsFor } = await import("../src/sim/arenaSpec.js");
  const { CATALOG } = await import("../src/assets/catalog.js");
  // The biggest machine on the roster included on purpose. A start box is a
  // POINT, and how much room it needs is a property of what stands on it — the
  // four-way boxes sit closer to the walls than the head-to-head pair does, and
  // Mammoth is the bot that finds out whether that was too close. Geometry
  // cannot answer this (its bar sweeps well outside its chassis and high above
  // the floor), so it is measured: settle it and see if it moved.
  const biggest = Object.values(CATALOG).reduce((a, b) => ((a.radius ?? 0) > (b.radius ?? 0) ? a : b));
  const specs4 = [drumSpec(), flipperSpec(), drumSpec(), flipperSpec()];
  for (const count of [3, 4]) {
    const specs = specs4.slice(0, count).map((spec, i) => ({ ...spec, id: `${spec.id}-${i}` }));
    const spawns = spawnsFor(count);
    await withSim(specs, (sim) => {
      frames(sim, 240, specs.map(() => ({})));
      const state = sim.getRenderState();
      check(state.length === count, `${count} machines are in the sim`, `got ${state.length}`);
      state.forEach((bot, i) => {
        check(bot.position.y > 0, `bot ${i} is above the floor`, `y ${bot.position.y.toFixed(2)}`);
        check(bot.position.y < 4, `bot ${i} is not in the air`, `y ${bot.position.y.toFixed(2)}`);
        const drift = Math.hypot(bot.position.x - spawns[i].x, bot.position.z - spawns[i].z);
        check(drift < 3, `bot ${i} settled where it spawned`, `${drift.toFixed(2)}ft away`);
      });
      // And a weapon fired with three or four machines around finds a target
      // rather than reading vehicles[1 - i] off the end of the array.
      frames(sim, 120, specs.map(() => ({ weapon: true })));
      check(sim.getRenderState().every((bot) => Number.isFinite(bot.position.x)),
        `${count} machines can all run their weapons`);
    });

    // Same layout, filled with the largest bot in the game. A box too near a
    // wall shows up here as a machine that gets shoved off it before anyone has
    // touched the controls.
    const giants = Array.from({ length: count }, () => biggest);
    await withSim(giants, (sim) => {
      frames(sim, 300, giants.map(() => ({})));
      sim.getRenderState().forEach((bot, i) => {
        const drift = Math.hypot(bot.position.x - spawns[i].x, bot.position.z - spawns[i].z);
        check(drift < 1, `${biggest.id} fits on box ${i} of ${count}`, `pushed ${drift.toFixed(2)}ft`);
      });
    });
  }
});

await test("a three-way ends when one is left, not when the first one dies", async () => {
  // With two machines "somebody reached 100%" and "the round is over" are the
  // same event, and the match was written on that. They are not the same event
  // in a three-way: the first machine out leaves two people still fighting, and
  // ending there would hand the win to whoever happened to be nearest.
  const specs = [drumSpec(), flipperSpec(), { ...drumSpec(), id: "test-drum-3" }];
  await wiredMatch(specs, ({ match, tick, busEmit }) => {
    for (let i = 0; i < 300; i++) tick();
    check(match.getState().phase === "fight", "the match reached fight", match.getState().phase);
    check(match.getState().botCount === 3, "the match knows there are three of them");

    const destroy = (index) => {
      for (let i = 0; i < 60 && match.getState().bots[index].total < 100; i++) {
        busEmit(EV.WEAPON_HIT, { targetIndex: index, point: null, impulse: 900, heavy: true });
        tick();
      }
    };

    destroy(0);
    check(match.getState().bots[0].eliminated, "the first machine is out", JSON.stringify(match.getState().bots[0]));
    check(match.getState().phase === "fight", "and the round carries on", match.getState().phase);
    // A wreck stops driving, so what is left of it is an obstacle and nothing else.
    const wreck = match.filterInputs([{ leftDrive: 1, rightDrive: 1, weapon: true }, {}, {}])[0];
    check(wreck.leftDrive === 0 && wreck.rightDrive === 0 && wreck.weapon === false,
      "and it takes no more input", JSON.stringify(wreck));

    destroy(1);
    const state = match.getState();
    check(state.phase === "ko", "the second one out ends it", state.phase);
    check(state.winnerIndex === 2, "and the machine left standing wins", `winner ${state.winnerIndex}`);
  });
});

await test("config: the knobs file is a leaf, and nobody keeps a private copy", async () => {
  // src/config.js is the file a person opens to change a volume or a round
  // length. Two things make it worth having and both are quiet when broken.
  //
  // (1) It must import NOTHING. Everything imports it — ui, game, engine,
  //     shared — so the moment it imports back the graph has a cycle, and an
  //     ES-module cycle here shows up as a `CONFIG` that is `undefined` at
  //     module-evaluation time in whichever file happened to load second.
  // (2) The numbers must not be duplicated back into the modules. The round
  //     length used to live in BOTH ui/ui.js and game/match.js, which is a HUD
  //     clock that disagrees with the sim clock the first time one changes and
  //     looks like a bug in the timer rather than a stale literal.
  const fs = await import("node:fs");
  const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  const config = read("src/config.js");
  const imports = [...config.matchAll(/^\s*import\s/gm)];
  check(imports.length === 0, "config.js imports nothing (it is a leaf, so it cannot cycle)",
    `found ${imports.length} import statement(s)`);

  const { CONFIG } = await import("../src/config.js");
  check(CONFIG?.music?.masterVolume > 0 && CONFIG?.match?.matchSeconds > 0,
    "config.js exports the knobs the game reads");
  check(CONFIG.music.cueVolume.menu === CONFIG.music.pauseDuck,
    "the menu cue sits at the pause level (both read one number)",
    `menu ${CONFIG.music.cueVolume.menu} vs pause ${CONFIG.music.pauseDuck}`);

  for (const rel of ["src/ui/ui.js", "src/game/match.js"]) {
    const src = read(rel);
    check(/CONFIG\.match\.matchSeconds|matchSeconds:\s*MATCH_SECONDS/.test(src),
      `${rel} takes the round length from config.js`);
    check(!/MATCH_SECONDS\s*=\s*\d/.test(src),
      `${rel} does not keep its own copy of the round length`,
      "put it in src/config.js — a second copy is a clock that lies");
  }
});

await test("models: every authored panel is still in the GLB that needs it", async () => {
  // Repairs are not all the same KIND of edit, and that is the trap. A carve
  // rewrites the GLB from a saved input; a panel is APPENDED to whatever the
  // GLB already was. So a later carve that starts from a pre-panel baseline
  // silently drops the panel and nothing complains — the spec is still in the
  // tree, the model still loads, and the hole comes back. It has happened
  // twice: Claw Viper's interior box went in with the spec and was gone by the
  // next commit that touched the model, and Blip's bay floor was authored but
  // never applied at all. Both were only caught by someone looking at the bot.
  // This is the cheap version of looking at the bot.
  const fs = await import("node:fs");
  const specDir = new URL("./repairs/", import.meta.url);
  const modelDir = new URL("../public/models/", import.meta.url);
  const nodeNames = (file) => {
    const b = fs.readFileSync(new URL(file, modelDir));
    const json = JSON.parse(b.toString("utf8", 20, 20 + b.readUInt32LE(12)).trim());
    return new Set(json.nodes.filter((n) => n.name).map((n) => n.name));
  };
  const cache = new Map();
  for (const file of fs.readdirSync(specDir).filter((f) => f.endsWith(".json"))) {
    let spec;
    try { spec = JSON.parse(fs.readFileSync(new URL(file, specDir), "utf8")); } catch { continue; }
    if (!Array.isArray(spec?.panels)) continue;
    // Specs are named <bot>-<what>.json and add panels to public/models/<bot>.glb.
    const model = `${file.split("-")[0]}.glb`;
    if (!fs.existsSync(new URL(model, modelDir))) {
      check(false, `${file}: names a model that exists`, `no ${model}`);
      continue;
    }
    if (!cache.has(model)) cache.set(model, nodeNames(model));
    const names = cache.get(model);
    const missing = spec.panels.map((p) => p.name).filter((n) => !names.has(n));
    check(missing.length === 0, `${file}: its panels are in ${model}`,
      `absent: ${missing.join(", ")} — re-run tools/glb-add-panels.mjs`);
  }
});

await test("no bot ends up under the floor", async () => {
  // A bot driven hard into the floor has to come back out of it. The recovery
  // is in sim/vehicle.js: a SOLID raycast that starts inside the floor slab
  // reports a time-of-impact of 0, which reads as full compression and pushes
  // that corner back up. It only works while a probe anchor is still INSIDE the
  // slab, so the slab's depth is the whole margin — through v1's 0.1ft skin a
  // 250lb machine taking a hard downward hit cleared it in one step, and once
  // every anchor was underneath the probes cast into empty space, the
  // suspension read airborne, the drive cut out, and nothing left in the sim
  // could bring it back. HUGE sat a foot under with its wheels buried and full
  // throttle doing nothing.
  //
  // Run over the whole roster because "which bot does this happen to" is not
  // something anyone can predict from the spec — HUGE was the only one that
  // fell through, and nothing about its numbers says so in advance.
  const { CATALOG } = await import("../src/assets/catalog.js");
  const sunk = [];
  for (const spec of Object.values(CATALOG)) {
    await withSim([spec, CATALOG.bronco], async (sim) => {
      sim._test.setPose(1, { x: 0, z: 25 }, 0);
      sim._test.setPose(0, { x: 0, z: 0 }, 0);
      frames(sim, 120);
      frames(sim, 120, [{ leftDrive: 1, rightDrive: 1 }, {}]);
      sim._test.setPose(0, { x: 0, y: 3.0, z: 0 }, 0); // land from a flip
      frames(sim, 180);
      frames(sim, 120, [{ leftDrive: 1, rightDrive: 1 }, {}]);
      sim._test.applyImpulse(0, { x: 0, y: -250, z: 0 }); // and take one downward
      frames(sim, 190);
      const y = sim._test.body(0).translation().y;
      const comp = sim.getRenderState()[0].probeCompression;
      if (y < -0.05 || comp.every((c) => c === 0)) {
        sunk.push(`${spec.id} at y ${y.toFixed(2)}, probes [${comp.map((c) => c.toFixed(2)).join(", ")}]`);
      }
    });
  }
  check(sunk.length === 0, "every bot came back up and its suspension found the floor",
    sunk.join(" | "));
});

await test("lifter: the plow's solid swings with the arm", async () => {
  // A lifter has to LIFT AND PUSH other machines. That sounds too obvious to
  // test, and it is exactly why it went unnoticed for so long: Duck's plow
  // collider sat where the catalog parked it and never moved, so the moment the
  // arm came off its rest the plow was drawn halfway over the roof while its
  // solid stayed on the floor. Bringing the arm down on an opponent went
  // straight through them. The only thing that ever touched them was the lift
  // impulse's zone test, which the player can neither see nor aim.
  //
  // What is asserted is the MECHANISM, not the outcome. "A foe gets lifted this
  // far" looked like the better test and is not one: measured over eight
  // opponents the same scoop is worth anywhere from 0.02ft to 1.11ft, and for
  // two of them a hologram plow scored HIGHER than a solid one, because what
  // dominates is where the contact happens to bite. There is no threshold in
  // there that means anything. The arc is exact, so that is what is checked —
  // and it is the wiring, which is the part that silently comes undone.
  const { CATALOG } = await import("../src/assets/catalog.js");
  const m = await import("../src/sim/math.js");
  const riders = Object.values(CATALOG).filter((s) => s.colliders?.some((c) => c.ridesArm));
  check(riders.length > 0, "some bot's plow rides its arm",
    "no collider in the catalog carries ridesArm - the mechanism is unreachable");
  for (const spec of riders) {
    const foe = Object.values(CATALOG).find((s) => s.id !== spec.id);
    await withSim([spec, foe], async (sim) => {
      const body = sim._test.body(0);
      // Collider poses in the BODY's frame, so a bot that has settled a degree
      // off level does not read as a plow that has moved.
      const local = () => {
        const out = [];
        for (let i = 0; i < body.numColliders(); i += 1) {
          out.push(m.qRotateInv(body.rotation(), m.sub(body.collider(i).translation(), body.translation())));
        }
        return out;
      };
      sim._test.setPose(0, { x: 0, z: 0 }, 0);
      sim._test.setPose(1, { x: 0, z: -30 }, 0);
      frames(sim, 90);
      const rest = local();
      // The arm is on the primary channel for every lifter; a two-way arm holds
      // where it is let go, which is why this drives it and then reads.
      frames(sim, 150, [{ weapon: true }, {}]);
      const raised = local();
      const w = spec.weapon;
      const turn = m.qFromAxisAngle(m.norm(w.axis ?? { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }),
        (w.fireAngle ?? 0) - (w.restAngle ?? 0));
      spec.colliders.forEach((c, i) => {
        const offset = { x: c.offset?.x ?? 0, y: c.offset?.y ?? 0, z: c.offset?.z ?? 0 };
        const want = c.ridesArm ? m.add(w.pivot, m.qRotate(turn, m.sub(offset, w.pivot))) : offset;
        const off = m.length(m.sub(raised[i], want));
        check(off < 0.05, `${spec.id}: collider ${i} is where the arm puts it at full lift`,
          `sits ${off.toFixed(3)}ft from the pose the arm's own arc gives it`);
        if (c.ridesArm) {
          const travel = m.length(m.sub(raised[i], rest[i]));
          check(travel > 0.5, `${spec.id}: collider ${i} actually travels`,
            `moved ${travel.toFixed(3)}ft - the plow is a hologram once the arm lifts`);
        }
      });
    });
  }
});

await test("roster: the catalog, the display order and the select cards agree", async () => {
  // Three lists have to name the same bots and nothing checks them against each
  // other. CATALOG is physics, BOT_IDS is display order, BOT_CARDS is the
  // select screen — and the select screen is built from BOT_CARDS alone, so a
  // bot can be fully integrated, measured, rigged, armed and AI-driven and
  // still be invisible to the player because one list was not touched. That is
  // exactly what happened to all five of Glitch, Kraken, Gigabyte, Rusty and
  // Dragon King: they fought fine in the roster probe and never appeared in the
  // game.
  const { CATALOG, BOT_IDS } = await import("../src/assets/catalog.js");
  const { BOT_CARDS } = await import("../src/ui/botCards.js");
  const catalog = new Set(Object.keys(CATALOG));
  const ids = new Set(BOT_IDS);
  const cards = new Set(BOT_CARDS.map((c) => c.id));
  const missing = (from, to) => [...from].filter((id) => !to.has(id));
  check(missing(catalog, ids).length === 0, "every catalog bot is in BOT_IDS",
    `absent: ${missing(catalog, ids).join(", ")}`);
  check(missing(catalog, cards).length === 0, "every catalog bot has a select card",
    `absent from BOT_CARDS, so unreachable in game: ${missing(catalog, cards).join(", ")}`);
  check(missing(cards, catalog).length === 0, "every select card has a catalog bot",
    `card with no bot behind it: ${missing(cards, catalog).join(", ")}`);

  // The select screen's speed bar is derived from the sim, so the two must not
  // be able to disagree: a faster bot may never carry a lower speed rating.
  // Nothing stops someone editing one file and not the other, and the card is
  // what the player picks on.
  const ranked = BOT_CARDS
    .map((c) => ({ id: c.id, fps: CATALOG[c.id].maxSpeedFps, stat: c.stats.speed }))
    .sort((a, b) => b.fps - a.fps);
  const inversions = [];
  for (let i = 1; i < ranked.length; i++) {
    const [faster, slower] = [ranked[i - 1], ranked[i]];
    if (faster.fps > slower.fps && faster.stat < slower.stat) {
      inversions.push(`${slower.id} (${slower.fps}ft/s, rated ${slower.stat}) outranks ${faster.id} (${faster.fps}ft/s, rated ${faster.stat})`);
    }
    if (faster.fps === slower.fps && faster.stat !== slower.stat) {
      inversions.push(`${faster.id} and ${slower.id} are the same speed but rated ${faster.stat} vs ${slower.stat}`);
    }
  }
  check(inversions.length === 0, "the card speed ratings agree with the sim",
    inversions.join(" | "));
});

// ---------------------------------------------------------------------------
// Gigabyte — the full-body shell
// ---------------------------------------------------------------------------

// Drive a spinner into a parked target with its rotor pinned at `ratio` until
// the moment of contact, so the hit under test is at an exact speed. Returns
// the first hit on the target and the rotor speed on the frame after it.
async function spinnerRunIn(attackerId, ratio = 1, opts = {}) {
  const { CATALOG } = await import("../src/assets/catalog.js");
  const attacker = CATALOG[attackerId];
  const target = opts.target ?? CATALOG.bronco;
  return withSim([attacker, target], (sim, events) => {
    sim._test.setPose(0, { x: 0, z: 0 }, 0);
    sim._test.setPose(1, { x: 0, z: -5.4 }, Math.PI);
    frames(sim, 30);
    let rotorAfter = null;
    let rotorEnd = 0;
    const drive = { leftDrive: 0.6, rightDrive: 0.6, weapon: Boolean(opts.holdTrigger) };
    frames(sim, 120, [drive, {}], () => {
      const landed = events.some((e) => e.type === EV.WEAPON_HIT && e.payload.targetIndex === 1);
      if (!landed) sim._test.setWeaponOmega(0, attacker.weapon.maxOmega * ratio);
      else if (rotorAfter === null) rotorAfter = sim._test.weapons[0].getRatio();
      rotorEnd = sim._test.weapons[0].getRatio();
    });
    const hits = events.filter((e) => e.type === EV.WEAPON_HIT && e.payload.targetIndex === 1);
    check(hits.length >= 1, `${attackerId} landed a hit at ratio ${ratio}`);
    return { hit: hits[0].payload, rotorAfter, rotorEnd };
  });
}

await test("gigabyte: six seconds of wind-up, then it hits harder than the bar", async () => {
  // The wind-up IS the machine. Six seconds is the published figure and it is
  // the whole risk: until it is up, Gigabyte is a 250lb dome on two wheels.
  const { CATALOG } = await import("../src/assets/catalog.js");
  await withSim([CATALOG.gigabyte, CATALOG.bronco], (sim) => {
    sim._test.setPose(0, { x: 0, z: 0 }, 0);
    sim._test.setPose(1, { x: 0, z: 20 }, 0); // out of the way
    frames(sim, 60);
    frames(sim, 180, [{ weapon: true }, {}]);
    const half = sim._test.weapons[0].getRatio();
    check(Math.abs(half - 0.5) < 0.05, "half speed at three seconds", `ratio ${half.toFixed(2)}`);
    frames(sim, 180, [{ weapon: true }, {}]);
    check(sim._test.weapons[0].getRatio() > 0.99, "full speed at six seconds",
      `ratio ${sim._test.weapons[0].getRatio().toFixed(2)}`);
  });

  // And what six seconds buys: the same KIND of hit as Tombstone's bar — a
  // horizontal spinner that throws you sideways — only harder. Both are run
  // into the same target at full spin, so the only difference is the weapon.
  const shell = await spinnerRunIn("gigabyte");
  const bar = await spinnerRunIn("tombstone");
  check(shell.hit.appliedImpulse > bar.hit.appliedImpulse,
    "the shell shoves harder than the bar",
    `${shell.hit.appliedImpulse.toFixed(0)} vs ${bar.hit.appliedImpulse.toFixed(0)}`);
  check(shell.hit.impulse > bar.hit.impulse, "and hurts more",
    `${shell.hit.impulse.toFixed(0)} vs ${bar.hit.impulse.toFixed(0)}`);
});

await test("gigabyte: a hit costs the shell speed, the more so the harder it lands", async () => {
  // v1 drained 72-97% of blade SPEED on every hit whatever it was worth. On a
  // six-second rotor that means one graze ends the fight, so Gigabyte's drain is
  // proportional to the hit instead (weapon.tuning.spinLossScale). A clean
  // connection has to cost it seconds; a glance must not.
  const light = await spinnerRunIn("gigabyte", 0.3);
  const heavy = await spinnerRunIn("gigabyte", 1.0);
  const lightRetained = light.rotorAfter / 0.3;
  const heavyRetained = heavy.rotorAfter / 1.0;
  check(heavyRetained < lightRetained, "the bigger hit takes more spin with it",
    `kept ${(heavyRetained * 100).toFixed(0)}% at full spin vs ${(lightRetained * 100).toFixed(0)}% at 30%`);
  check(heavyRetained > 0.3 && heavyRetained < 0.85,
    "a hard hit staggers the shell without stopping it",
    `kept ${(heavyRetained * 100).toFixed(0)}%`);

  // ...and it winds back up, which is the other half of the mechanic.
  const held = await spinnerRunIn("gigabyte", 1.0, { holdTrigger: true });
  check(held.rotorEnd > held.rotorAfter + 0.1, "the shell recovers with the trigger held",
    `${held.rotorAfter.toFixed(2)} -> ${held.rotorEnd.toFixed(2)}`);
});

await test("weapon on weapon: one clash, both machines hit, both rotors slowed", async () => {
  // Weapon colliders used to pass through each other — two live rotors met and
  // nothing happened until one of them reached the other's chassis. A clash is
  // one exchange that lands on BOTH bots, resolved once for the pair however
  // many contact pairs the step reports.
  const { CATALOG } = await import("../src/assets/catalog.js");
  await withSim([CATALOG.gigabyte, CATALOG.tombstone], (sim, events) => {
    sim._test.setPose(0, { x: 0, z: 0 }, 0);
    sim._test.setPose(1, { x: 0, z: -8 }, Math.PI);
    frames(sim, 30);
    const drive = { leftDrive: 0.5, rightDrive: 0.5, weapon: true };
    frames(sim, 150, [drive, drive], () => {
      // Pinned until first contact so both arrive at a known speed.
      if (!events.some((e) => e.type === EV.WEAPON_HIT)) {
        sim._test.setWeaponOmega(0, CATALOG.gigabyte.weapon.maxOmega);
        sim._test.setWeaponOmega(1, CATALOG.tombstone.weapon.maxOmega);
      }
    });
    const onShell = events.filter((e) => e.type === EV.WEAPON_HIT && e.payload.targetIndex === 0);
    const onBar = events.filter((e) => e.type === EV.WEAPON_HIT && e.payload.targetIndex === 1);
    check(onShell.length >= 1, "Gigabyte took damage from the clash");
    check(onBar.length >= 1, "Tombstone took damage from the clash");
    check(onShell[0].payload.attackerIndex === 1 && onBar[0].payload.attackerIndex === 0,
      "each hit is credited to the other bot");
    // One exchange, not one per contact pair: a full-body shell's weapon and
    // chassis colliders are the same steel and both pairs report together.
    check(onShell.length <= 2 && onBar.length <= 2, "the pair resolves once, not once per collider",
      `${onBar.length} on the bar, ${onShell.length} on the shell`);
    check(sim._test.weapons[0].getRatio() < 0.95 && sim._test.weapons[1].getRatio() < 0.95,
      "both rotors came out of it slower",
      `${sim._test.weapons[0].getRatio().toFixed(2)} / ${sim._test.weapons[1].getRatio().toFixed(2)}`);
  });
});

await test("hammer on the shell: the rotor stops dead and has to start again", async () => {
  // The one way into a spun-up full-body spinner that does not involve
  // out-hitting it. The shell IS the roof, so a hammer that comes down square on
  // it drives the rim into the chassis. Only a weapon that declares
  // weapon.overheadStall can be stopped this way — every other rotor presents an
  // edge up there and an overhead blow glances off.
  const { CATALOG } = await import("../src/assets/catalog.js");
  await withSim([CATALOG.rusty, CATALOG.gigabyte], (sim, events) => {
    sim._test.setPose(0, { x: 0, z: 0 }, 0);
    sim._test.setPose(1, { x: 0, z: -3.6 }, 0); // under the head, out of shell reach
    frames(sim, 30);
    frames(sim, 30, [{}, { weapon: true }], () => {
      sim._test.setWeaponOmega(1, CATALOG.gigabyte.weapon.maxOmega);
    });
    check(sim._test.weapons[1].getRatio() > 0.99, "the shell is up to speed before the swing");

    // Swing, and hold Gigabyte's trigger down the whole way: a jammed rotor
    // stays jammed, so leaning on the button must not get it back.
    frames(sim, 60, [{ weapon: true }, { weapon: true }]);
    const hits = events.filter((e) => e.type === EV.WEAPON_HIT && e.payload.targetIndex === 1);
    check(hits.length >= 1, "the hammer landed");
    check(hits.some((h) => h.payload.stalledWeapon), "and it landed on the spinning face");
    check(hits[0].payload.impulse > 0, "the hit still deals its damage",
      `impulse ${hits[0].payload.impulse.toFixed(0)}`);
    check(sim._test.weapons[1].getRatio() === 0, "the shell stopped",
      `ratio ${sim._test.weapons[1].getRatio().toFixed(2)}`);

    frames(sim, 30, [{}, { weapon: true }]);
    check(sim._test.weapons[1].getRatio() === 0, "and stays stopped while it is jammed");
    frames(sim, 150, [{}, { weapon: true }]);
    check(sim._test.weapons[1].getRatio() > 0.05, "then winds up again from nothing",
      `ratio ${sim._test.weapons[1].getRatio().toFixed(2)}`);
  });
});

// ---------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------

await test("turning pivots on the wheel centre, not the centre of mass", async () => {
  // Throw one side forward and the other back and a tracked machine spins about
  // the middle of its contact patches. It used to spin about its centre of mass,
  // which the model deliberately puts low and slightly rear — and on a bot with
  // skids up front and tyres at the back those are a third of a foot apart, so
  // the nose swung wide of where the wheels say it should go.
  //
  // Measured as the INSTANTANEOUS CENTRE OF ROTATION, read straight off the
  // body: the point whose velocity is zero, in the bot's own frame. That is
  // where the machine is actually turning, whatever the servos were asked for.
  const { CATALOG } = await import("../src/assets/catalog.js");
  const m = await import("../src/sim/math.js");
  for (const id of ["tombstone", "beta", "huge"]) {
    const spec = CATALOG[id];
    const a = spec.wheelAnchors;
    const wheelCentre = {
      x: a.reduce((s, p) => s + p.x, 0) / a.length,
      z: a.reduce((s, p) => s + p.z, 0) / a.length,
    };
    const com = { x: 0, z: 0.08 * spec.bodyDims.z }; // mirrors sim/vehicle.js
    const apart = Math.abs(wheelCentre.z - com.z);
    check(apart > 0.2, `${id}'s wheel centre and com are far enough apart to tell apart`,
      `${apart.toFixed(2)}ft`);
    await withSim([spec, CATALOG.bronco], (sim) => {
      sim._test.setPose(1, { x: 0, z: 25 }, 0);
      sim._test.setPose(0, { x: 0, z: 0 }, 0);
      frames(sim, 60);
      frames(sim, 90, [{ leftDrive: 1, rightDrive: -1 }, {}]); // settle to a steady yaw
      const body = sim._test.body(0);
      const w = body.angvel().y;
      const v = body.linvel();
      check(Math.abs(w) > 1, `${id} is turning`, `${w.toFixed(2)} rad/s`);
      // v + w x r = 0 about the COM, so r = (v.z/w, 0, -v.x/w) in world.
      const icr = m.add(
        m.qRotateInv(body.rotation(), { x: v.z / w, y: 0, z: -v.x / w }),
        { x: com.x, y: 0, z: com.z },
      );
      const toWheel = Math.hypot(icr.x - wheelCentre.x, icr.z - wheelCentre.z);
      const toCom = Math.hypot(icr.x - com.x, icr.z - com.z);
      check(toWheel < toCom, `${id} turns about its wheel centre, not its com`,
        `pivot at z ${icr.z.toFixed(3)}: ${toWheel.toFixed(3)}ft from the wheel centre, ${toCom.toFixed(3)}ft from the com`);
      check(toWheel < 0.15, `${id}'s pivot sits on its wheel centre`,
        `${toWheel.toFixed(3)}ft away (wheel centre z ${wheelCentre.z.toFixed(3)}, pivot z ${icr.z.toFixed(3)})`);
    });
  }
});

await test("omni bots: left stick translates, right stick rotates", async () => {
  // Glitch and Shatter are X-drives: the omniwheels resolve into movement along
  // both chassis axes AND yaw, independently. A tank pair cannot express that,
  // so their sticks are mapped differently — and the mapping lives with the
  // other per-bot control semantics, not in the input layer.
  const { CATALOG } = await import("../src/assets/catalog.js");
  const { createWeaponInputShaper, usesHolonomicSticks } = await import("../src/game/weaponControls.js");
  const omni = Object.values(CATALOG).filter((s) => usesHolonomicSticks(s)).map((s) => s.id).sort();
  check(omni.join(",") === "glitch,shatter", "the omni bots are the ones we think they are",
    `got ${omni.join(",") || "none"}`);

  const shaper = createWeaponInputShaper();
  // Left stick hard over: forward on Y, right on X. Right stick: rotate left.
  // The tank pair the pad also produces must NOT reach an omni bot's tracks.
  const raw = { throttle: 1, leftDrive: 1, rightDrive: -1, strafe: 0.5, spin: -0.8 };
  const omniShaped = shaper.shape({ ...raw }, CATALOG.glitch, 0);
  check(omniShaped.leftDrive === 1 && omniShaped.rightDrive === 1,
    "both sides take the left stick's throttle, undivided by any tank turn",
    `${omniShaped.leftDrive} / ${omniShaped.rightDrive}`);
  check(omniShaped.strafe === 0.5 && omniShaped.spin === -0.8, "strafe and rotate pass through");
  const tankShaped = shaper.shape({ ...raw }, CATALOG.tombstone, 1);
  check(tankShaped.leftDrive === 1 && tankShaped.rightDrive === -1,
    "a tank bot's two sticks are still its two sides");

  // And in the sim: each channel does its own thing and nothing else's.
  const yawOf = (sim) => yawFromQuat(sim._test.body(0).rotation());
  await withSim([CATALOG.glitch, CATALOG.bronco], async (sim) => {
    sim._test.setPose(1, { x: 0, z: 25 }, 0);
    for (const [label, input, expect] of [
      ["forward", { leftDrive: 1, rightDrive: 1 }, "z"],
      ["strafe", { leftDrive: 0, rightDrive: 0, strafe: 1 }, "x"],
      ["rotate", { leftDrive: 0, rightDrive: 0, spin: 1 }, "yaw"],
    ]) {
      sim._test.setPose(0, { x: 0, z: 0 }, 0);
      frames(sim, 60);
      const from = { ...sim._test.body(0).translation() };
      // Accumulated, not the wrapped difference: a bot that spins a full turn
      // and a bot that does not move both read zero on the wrapped one.
      let turned = 0;
      let lastYaw = yawOf(sim);
      frames(sim, 90, [input, {}], () => {
        let d = yawOf(sim) - lastYaw;
        if (d > Math.PI) d -= 2 * Math.PI;
        if (d < -Math.PI) d += 2 * Math.PI;
        turned += d;
        lastYaw = yawOf(sim);
      });
      const to = sim._test.body(0).translation();
      const dx = Math.abs(to.x - from.x);
      const dz = Math.abs(to.z - from.z);
      const dyaw = Math.abs(turned);
      if (expect === "z") {
        check(dz > 2 && dx < dz * 0.25, "the left stick's Y drives forward", `dz ${dz.toFixed(2)} dx ${dx.toFixed(2)}`);
      } else if (expect === "x") {
        check(dx > 2 && dz < dx * 0.25, "the left stick's X strafes sideways", `dx ${dx.toFixed(2)} dz ${dz.toFixed(2)}`);
        check(dyaw < 0.4, "and does not turn the bot", `${((dyaw * 180) / Math.PI).toFixed(0)} deg`);
      } else {
        check(dyaw > 1.0, "the right stick's X spins it on the spot", `${((dyaw * 180) / Math.PI).toFixed(0)} deg`);
        check(Math.hypot(dx, dz) < 1.5, "without driving it anywhere",
          `moved ${Math.hypot(dx, dz).toFixed(2)}ft`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Dragon King — four mechanisms, four buttons
// ---------------------------------------------------------------------------

await test("omni bots: the right stick's X is the turn rate, all the way down", async () => {
  // Yaw on its own axis is the whole reason a combat robot fits omniwheels, and
  // the axis had a cliff in the middle of it: the rate jumped by
  // counterRotateBoost the moment |spin| crossed 0.55, so one o'clock and two
  // o'clock asked for the same rotation until you crossed the line and then it
  // leapt. Twelve holds it straight, three turns it as fast as it turns, and
  // everything between is the fraction it looks like.
  const { CATALOG } = await import("../src/assets/catalog.js");
  const rateAt = async (spin) => withSim([CATALOG.glitch, CATALOG.bronco], (sim) => {
    sim._test.setPose(0, { x: 0, z: 0 }, 0);
    sim._test.setPose(1, { x: 0, z: 30 }, 0); // out of the way
    frames(sim, 60);
    let peak = 0;
    for (let i = 0; i < 150; i++) {
      frames(sim, 1, [{ throttle: 1, spin }, {}]);
      peak = Math.max(peak, Math.abs(sim._test.body(0).angvel().y));
    }
    return peak;
  });
  // Clock positions: X is sin of the angle off twelve.
  const noon = await rateAt(0);
  const one = await rateAt(0.5);
  const two = await rateAt(0.87);
  const three = await rateAt(1);
  check(noon < 0.05, "straight up the stick holds it straight", `${noon.toFixed(3)} rad/s`);
  check(one > 0.5 && two > one && three > two, "and it turns faster the further round you go",
    `${one.toFixed(2)} / ${two.toFixed(2)} / ${three.toFixed(2)} rad/s`);
  // Linear, which is what "no cliff" means as a number: each rate over its own
  // stick deflection is the same constant.
  const perUnit = [one / 0.5, two / 0.87, three / 1];
  const spread = Math.max(...perUnit) - Math.min(...perUnit);
  check(spread < Math.max(...perUnit) * 0.08, "in proportion, with no step in it",
    `rad/s per unit of stick: ${perUnit.map((v) => v.toFixed(2)).join(", ")}`);
  // And slower than it was. The old rule ran the base rate x counterRotateBoost
  // at full stick; this is half the base rate, everywhere.
  const T = (await import("../src/sim/vehicle.js")).VEHICLE_TUNING;
  const spinScale = CATALOG.glitch.drive.spinScale ?? 0.5;
  check(spinScale <= 0.5, "at half the rate it used to turn", `spinScale ${spinScale}`);
  check(three < 5.5, "and nowhere near the arena's spin cap", `${three.toFixed(2)} rad/s vs cap ${T.counterRotateCap}`);
});

await test("dragon king: each of its four channels drives its own machine", async () => {
  // This bot is four separate machines and none of them means anything alone:
  // the jaw is the grip, the saws only cut what the jaw is holding, the arms
  // decide where the saws point, and the lift is the only thing that reaches
  // behind the robot. It used to share Sawblaze's single-swing mechanism, which
  // could express none of that — and its jaw was pointed at a piece of geometry
  // out the BACK, so the bite never once moved the mouth.
  const { CATALOG } = await import("../src/assets/catalog.js");
  const { createWeaponInputShaper } = await import("../src/game/weaponControls.js");
  const spec = CATALOG.dragonking;
  const shaper = createWeaponInputShaper();
  await withSim([spec, CATALOG.bronco], (sim) => {
    sim._test.setPose(1, { x: 0, z: 25 }, 0);
    sim._test.setPose(0, { x: 0, z: 0 }, 0);
    const drive = (raw, count) => frames(sim, count, [shaper.shape(raw, spec, 0), {}]);
    const state = () => sim.getRenderState()[0];
    drive({}, 90);
    check(state().weaponAuxAngle < 0.05, "the jaw rests shut");

    // RT LATCHES: one press opens, the next shuts. A hold is one press.
    drive({ weapon: true }, 1);
    drive({}, 40);
    check(state().weaponAuxAngle > 0.95, "one press of RT opens the jaw",
      `${state().weaponAuxAngle.toFixed(2)}`);
    drive({ weapon: true }, 1);
    drive({}, 40);
    check(state().weaponAuxAngle < 0.05, "the next press shuts it",
      `${state().weaponAuxAngle.toFixed(2)}`);

    // RB latches the saw motors; LB holds the arm tilt and lets go.
    drive({ weaponAlt: true }, 1);
    drive({}, 90);
    check(state().weaponSubAngle > 0.95, "RB spins the saws up and they stay up",
      `${state().weaponSubAngle.toFixed(2)}`);
    drive({ weaponAux: true }, 40);
    check(state().weaponAngle > 0.95, "LB tilts the arms forward", `${state().weaponAngle.toFixed(2)}`);
    drive({}, 70);
    check(state().weaponAngle < 0.05, "and they rake back when it is released",
      `${state().weaponAngle.toFixed(2)}`);
  });
});

await test("dragon king: LT rears the body up and lets it back down", async () => {
  // The pivot is the axle at the back of the pods, so the pods stay flat and
  // the body swings up over them — which is the only way the saws reach a bot
  // BEHIND the robot. Run as a real pitch servo, not an animation, because the
  // point of the gesture is that what comes over the top hits things.
  const { CATALOG } = await import("../src/assets/catalog.js");
  const { createWeaponInputShaper } = await import("../src/game/weaponControls.js");
  const spec = CATALOG.dragonking;
  const shaper = createWeaponInputShaper();
  await withSim([spec, CATALOG.bronco], (sim) => {
    sim._test.setPose(1, { x: 0, z: 25 }, 0);
    sim._test.setPose(0, { x: 0, z: 0 }, 0);
    const drive = (raw, count) => frames(sim, count, [shaper.shape(raw, spec, 0), {}]);
    // Nose-up pitch, off the body's own forward vector.
    const pitchDeg = () => {
      const q = sim._test.body(0).rotation();
      const y = -(2 * (q.y * q.z - q.w * q.x));
      return (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI;
    };
    drive({}, 90);
    check(Math.abs(pitchDeg()) < 3, "it sits level", `${pitchDeg().toFixed(1)} deg`);
    drive({ weaponLift: true }, 150);
    check(pitchDeg() > 70, "holding LT rears it up onto its tail", `${pitchDeg().toFixed(1)} deg`);
    check(sim.getRenderState()[0].auxPodAngle > 0.75,
      "and the pods are told how far, so they can stay flat",
      `${sim.getRenderState()[0].auxPodAngle.toFixed(2)}`);
    drive({}, 150);
    check(Math.abs(pitchDeg()) < 5, "letting go brings it back down", `${pitchDeg().toFixed(1)} deg`);
  });

  // WHAT it pivots ON, measured by following two body-local points through the
  // whole gesture: the rear axle and the centre of mass. If the machine is
  // hinged at the axle the axle stays where it is and the com swings up over it;
  // if it is not, the axle sweeps an arc of its own and the bar at the back digs
  // into the floor and jacks the robot up on it — which is what it used to do.
  //
  // Most of what holds the axle down here is the ground, not the servo: the pods
  // are on the floor and the suspension and friction pin them. lift.pivot is
  // still the number that DEFINES the axle — it is what the renderer's pod
  // counter-rotation cancels about — so this is the check that it names a point
  // the robot really turns around and not one 0.7ft away.
  const m = await import("../src/sim/math.js");
  const com = { x: 0, y: -0.15 * spec.bodyDims.y, z: 0.08 * spec.bodyDims.z }; // mirrors sim/vehicle.js
  const axle = spec.lift.pivot;
  const apart = Math.hypot(axle.y - com.y, axle.z - com.z);
  check(apart > 0.5, "the axle and the com are far enough apart to tell apart", `${apart.toFixed(2)}ft`);
  await withSim([spec, CATALOG.bronco], (sim) => {
    sim._test.setPose(1, { x: 0, z: 25 }, 0);
    sim._test.setPose(0, { x: 0, z: 0 }, 0);
    const body = () => sim._test.body(0);
    const worldOf = (p) => m.add(body().translation(), m.qRotate(body().rotation(), p));
    const drive = (raw, count) => frames(sim, count, [shaper.shape(raw, spec, 0), {}]);
    drive({}, 90);
    const axle0 = worldOf(axle);
    const com0 = worldOf(com);
    drive({ weaponLift: true }, 150);
    const axleMoved = m.length(m.sub(worldOf(axle), axle0));
    const comMoved = m.length(m.sub(worldOf(com), com0));
    check(comMoved > 1, "the body really did swing up", `com travelled ${comMoved.toFixed(2)}ft`);
    check(axleMoved < comMoved / 3, "the rear axle stays put while the body swings over it",
      `axle ${axleMoved.toFixed(2)}ft vs com ${comMoved.toFixed(2)}ft`);
  });
});

await test("dragon king: the saws come down in FRONT, and each turns about its own axle", async () => {
  // Two things the eye catches immediately and no physics assertion would.
  //
  // LB drops the saw arms. About +X a positive angle carries the top of the arms
  // toward +Z, which is the TAIL — the blades were tipping backwards over the
  // engine deck, away from anything the jaw could be holding. Forward is -Z, and
  // the gesture is: bite, then bring the saws down on what you have got.
  //
  // And the two blades do not share an axle. They lean 6.9 degrees off horizontal
  // in opposite directions; spun about one common axis each disc precesses rather
  // than turns, which reads as a bent blade wobbling.
  const { CATALOG } = await import("../src/assets/catalog.js");
  const spec = CATALOG.dragonking;
  const w = spec.weapon;
  check(w.fireAngle < 0, "the saw stroke swings the arms forward, not back",
    `restAngle ${w.restAngle} -> fireAngle ${w.fireAngle}`);
  // Where the blade ENDS UP, not just the sign: rotate its measured centre about
  // the arm pivot by fireAngle and it has to finish ahead of where it started.
  const blade = { y: w.sub.pivot.y - w.pivot.y, z: w.sub.pivot.z - w.pivot.z };
  const c = Math.cos(w.fireAngle);
  const s = Math.sin(w.fireAngle);
  const swungZ = w.pivot.z + (blade.y * s + blade.z * c);
  check(swungZ < w.sub.pivot.z - 0.5, "the blades finish forward of where they rest",
    `z ${w.sub.pivot.z.toFixed(2)} -> ${swungZ.toFixed(2)} (forward is -z)`);

  // The blades are DRAWN, not scanned (assets/sawBlade.js): photogrammetry
  // resolved a 30-tooth rim as a disc with nubs on it. What matters here is that
  // the drawing and the sim measure the same blade — sub.radius is what decides
  // both how big the picture is and what the saws can reach, and a blade config
  // that overrode one without the other would put teeth where nothing cuts.
  check(w.sub.blade, "the saws are drawn rather than scanned", "no weapon.sub.blade");
  check(w.sub.blade.radius === undefined || w.sub.blade.radius === w.sub.radius,
    "and the blade that is drawn is the blade the sim cuts with",
    `drawn ${w.sub.blade.radius} vs cut ${w.sub.radius}`);
  check(w.sub.blade.thickness > 0 && w.sub.blade.thickness < w.sub.radius,
    "a blade is thinner than it is wide", `${w.sub.blade.thickness}ft thick, ${w.sub.radius}ft radius`);

  const axes = w.sub.axes;
  check(axes && Object.keys(axes).length === 2, "both blades have an axle of their own",
    `${Object.keys(axes || {}).join(", ") || "none"}`);
  const [a, b] = Object.values(axes);
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const apartDeg = (Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI;
  check(apartDeg > 5, "and the two axles are genuinely different lines",
    `${apartDeg.toFixed(1)} degrees apart`);
  for (const [name, axis] of Object.entries(axes)) {
    const len = Math.hypot(axis.x, axis.y, axis.z);
    check(Math.abs(len - 1) < 0.01, `${name}'s axle is a unit vector`, `|axis| = ${len.toFixed(4)}`);
  }
  // The names have to be the GLB group suffixes or botAnimation silently falls
  // back to the shared weapon axis and the wobble comes straight back.
  const { readFileSync } = await import("node:fs");
  const glb = readFileSync(new URL(`../public${spec.modelPath.replace("./public", "")}`, import.meta.url));
  const json = JSON.parse(glb.toString("utf8", 20, 20 + glb.readUInt32LE(12)).trim());
  const reachable = new Set();
  const walk = (i) => { reachable.add(json.nodes[i].name); (json.nodes[i].children || []).forEach(walk); };
  json.scenes[0].nodes.forEach(walk);
  for (const name of Object.keys(axes)) {
    check(reachable.has(`modelWeaponSub-${name}`), `modelWeaponSub-${name} is in the model`,
      `groups: ${[...reachable].filter((n) => n?.startsWith("modelWeaponSub-")).join(", ")}`);
  }
});

// Bounding-box centre of the triangles a GLB primitive actually DRAWS, read
// through its index buffer. Needed because a carved-out part shares its donor's
// vertex attributes, so the accessor's own min/max describes the donor.
function boundsOfDrawnTriangles(json, node) {
  const prim = json.meshes[node.mesh].primitives[0];
  const bin = boundsOfDrawnTriangles.bin;
  const pos = json.accessors[prim.attributes.POSITION];
  const posView = json.bufferViews[pos.bufferView];
  const posOff = bin.start + (posView.byteOffset || 0) + (pos.byteOffset || 0);
  const posStride = posView.byteStride || 12;
  const idx = json.accessors[prim.indices];
  const idxView = json.bufferViews[idx.bufferView];
  const idxOff = bin.start + (idxView.byteOffset || 0) + (idx.byteOffset || 0);
  const size = idx.componentType === 5125 ? 4 : idx.componentType === 5123 ? 2 : 1;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < idx.count; i++) {
    const o = idxOff + i * size;
    const v = size === 4 ? bin.buf.readUInt32LE(o) : size === 2 ? bin.buf.readUInt16LE(o) : bin.buf.readUInt8(o);
    for (let k = 0; k < 3; k++) {
      const c = bin.buf.readFloatLE(posOff + v * posStride + k * 4);
      if (c < min[k]) min[k] = c;
      if (c > max[k]) max[k] = c;
    }
  }
  return [0, 1, 2].map((k) => (min[k] + max[k]) / 2);
}

/**
 * Size of the geometry a whole GLB actually DRAWS, in raw model units, walking
 * the scene graph so node translations count. Deliberately reads the INDICES:
 * carving leaves orphaned vertices behind in the position attribute, so a bot
 * measured from its accessors reads bigger than the robot on screen — Tantrum
 * measured 3.29ft that way against 3.00 drawn, and chasing that phantom is how
 * you shrink a bot that was the right size all along. models.js measures the
 * same way (drawnLocalBox), which is why this can check its answer.
 */
function drawnModelSize(glb) {
  const jsonLen = glb.readUInt32LE(12);
  const json = JSON.parse(glb.toString("utf8", 20, 20 + jsonLen).trim());
  const start = 20 + ((jsonLen + 3) & ~3) + 8;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const walk = (i, t) => {
    const n = json.nodes[i];
    const at = [0, 1, 2].map((k) => t[k] + (n.translation ? n.translation[k] : 0));
    if (n.mesh !== undefined) {
      boundsOfDrawnTriangles.bin = { buf: glb, start };
      for (let pi = 0; pi < json.meshes[n.mesh].primitives.length; pi++) {
        const box = drawnPrimitiveBox(json, json.meshes[n.mesh].primitives[pi], { buf: glb, start });
        if (!box) continue;
        for (let k = 0; k < 3; k++) {
          if (box.min[k] + at[k] < min[k]) min[k] = box.min[k] + at[k];
          if (box.max[k] + at[k] > max[k]) max[k] = box.max[k] + at[k];
        }
      }
    }
    (n.children || []).forEach((c) => walk(c, at));
  };
  json.scenes[0].nodes.forEach((r) => walk(r, [0, 0, 0]));
  return Number.isFinite(min[0]) ? [0, 1, 2].map((k) => max[k] - min[k]) : null;
}

function drawnPrimitiveBox(json, prim, bin) {
  if (prim.indices === undefined) return null;
  const pos = json.accessors[prim.attributes.POSITION];
  const posView = json.bufferViews[pos.bufferView];
  const posOff = bin.start + (posView.byteOffset || 0) + (pos.byteOffset || 0);
  const posStride = posView.byteStride || 12;
  const idx = json.accessors[prim.indices];
  const idxView = json.bufferViews[idx.bufferView];
  const idxOff = bin.start + (idxView.byteOffset || 0) + (idx.byteOffset || 0);
  const size = idx.componentType === 5125 ? 4 : idx.componentType === 5123 ? 2 : 1;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < idx.count; i++) {
    const o = idxOff + i * size;
    const v = size === 4 ? bin.buf.readUInt32LE(o) : size === 2 ? bin.buf.readUInt16LE(o) : bin.buf.readUInt8(o);
    for (let k = 0; k < 3; k++) {
      const c = bin.buf.readFloatLE(posOff + v * posStride + k * 4);
      if (c < min[k]) min[k] = c;
      if (c > max[k]) max[k] = c;
    }
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

await test("sizing: every bot is drawn at the width its catalog entry claims", async () => {
  // The SIZING contract at the top of the catalog: a bot's GLB is scaled so its
  // MEASURED WIDTH in game space equals realWorld.size.widthFt, and every other
  // length in the entry — colliders, pivots, anchors, reaches — was measured
  // after that scale. So a modelScale that does not land on widthFt is not a
  // cosmetic mismatch: it means the solid does not match the picture, and every
  // number in the entry describes a different robot from the one on screen.
  //
  // Only bots with an explicit modelScale can drift. The rest derive their scale
  // from bodyDims, so this also catches a bodyDims.x edited without a resize.
  const { CATALOG, BOT_IDS } = await import("../src/assets/catalog.js");
  const { readFileSync } = await import("node:fs");
  // No exceptions. Gigabyte used to be one — drawn 3.6% wider than it claimed,
  // with its colliders authored to the drawn 3.47 so the solid and the picture
  // agreed and only widthFt was the odd one out — and it was resized to the
  // 3.35 it always said it was.
  const KNOWN = {};
  for (const id of BOT_IDS) {
    const spec = CATALOG[id];
    const glb = readFileSync(new URL(`../public${spec.modelPath.replace("./public", "")}`, import.meta.url));
    const size = drawnModelSize(glb);
    if (!size) continue;
    // The wrapper takes yaw then roll, and every bot in the catalog uses a
    // quarter-turn multiple, so this is an axis swap rather than a rotation.
    let [sx, sy, sz] = size;
    if (Math.abs(Math.cos(spec.modelYaw ?? 0)) < 0.5) { const t = sx; sx = sz; sz = t; }
    if (Math.abs(Math.cos(spec.modelRoll ?? 0)) < 0.5) { const t = sx; sx = sy; sy = t; }
    const scale = spec.modelScale ?? ((spec.bodyDims.x / sx) + (spec.bodyDims.z / sz)) / 2;
    const want = spec.realWorld.size.widthFt;
    const ratio = (sx * scale) / want;
    const allowed = KNOWN[id] ?? 1;
    check(Math.abs(ratio / allowed - 1) < 0.01,
      `${id} is drawn at its stated width`,
      `${(sx * scale).toFixed(3)}ft drawn vs widthFt ${want} — ratio ${ratio.toFixed(3)}, expected ${allowed}`);
  }
});

await test("tracked bots: the drive sprockets are real parts that can turn", async () => {
  // A scanned track pod is ONE mesh — frame, band and wheels on a single atlas —
  // so nothing inside it can move. Dragon King's band has been scrolling over
  // four yellow sprockets that were nailed in place, bolt heads and all. They
  // are cut out into their own parts now (tools/repairs/dragonking-sprockets.json)
  // and this is the check that they are still there and still findable by name.
  const { CATALOG } = await import("../src/assets/catalog.js");
  const { readFileSync } = await import("node:fs");
  for (const spec of Object.values(CATALOG)) {
    const names = spec.tracks?.sprockets;
    if (!names?.length) continue;
    const glb = readFileSync(new URL(`../public${spec.modelPath.replace("./public", "")}`, import.meta.url));
    const jsonLen = glb.readUInt32LE(12);
    const json = JSON.parse(glb.toString("utf8", 20, 20 + jsonLen).trim());
    boundsOfDrawnTriangles.bin = { buf: glb, start: 20 + ((jsonLen + 3) & ~3) + 8 };
    const reachable = new Map();
    const walk = (i) => { reachable.set(json.nodes[i].name, json.nodes[i]); (json.nodes[i].children || []).forEach(walk); };
    json.scenes[0].nodes.forEach(walk);
    for (const name of names) {
      const node = reachable.get(name);
      check(node?.mesh !== undefined, `${spec.id}: ${name} is a drawn mesh in the model`,
        node ? "in the scene but has no mesh" : "not reachable from the scene");
      const tris = node ? json.accessors[json.meshes[node.mesh].primitives[0].indices].count / 3 : 0;
      check(tris > 1000, `${spec.id}: ${name} is a whole wheel, not a sliver`, `${tris} triangles`);
      // The trap this part is FOR. glb-carve extracts a part by giving it its
      // own index buffer while SHARING the donor's vertex attributes, so the
      // POSITION accessor on a sprocket still describes the whole pod — and
      // anything that measures the part from the attribute rather than from the
      // indices (THREE.Box3.setFromObject, for one) puts the wheel's pivot at
      // the pod's centre and swings it around the outside of its own track.
      // This is the check that the two answers are far enough apart for that
      // mistake to be the visible disaster it was, rather than a near miss.
      const acc = json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION];
      const shared = [0, 1, 2].map((i) => (acc.min[i] + acc.max[i]) / 2);
      const own = boundsOfDrawnTriangles(json, node);
      const apart = Math.hypot(...[0, 1, 2].map((i) => own[i] - shared[i]));
      check(apart > 0.05, `${spec.id}: ${name}'s own centre is nowhere near its donor's`,
        `${apart.toFixed(3)} model units apart — measure this part from its indices, not its attributes`);
    }
    // The band advances the distance travelled whatever wheelRadius says, but the
    // sprocket turns by wheelSpin — which is that distance over wheelRadius. If
    // this is not the measured sprocket radius the wheels and the track disagree.
    check(spec.wheelRadius !== undefined, `${spec.id} states a wheel radius for its sprockets to use`,
      `${spec.wheelRadius}`);
  }
});

await test("dragon king: the jaw grips and tows, and the saws cut what they touch", async () => {
  const { CATALOG } = await import("../src/assets/catalog.js");
  const spec = CATALOG.dragonking;
  await withSim([spec, CATALOG.bronco], (sim, events) => {
    sim._test.setPose(0, { x: 0, z: 0 }, 0);
    sim._test.setPose(1, { x: 0, z: -3.4 }, Math.PI);
    frames(sim, 60);
    const weapon = sim._test.weapons[0];
    check(!weapon.isGripping(), "a shut mouth does not grab what wanders into it");

    frames(sim, 40, [{ weapon: true }, {}]); // open
    frames(sim, 30, [{ weapon: true, leftDrive: 0.5, rightDrive: 0.5 }, {}]); // drive on
    frames(sim, 40, [{ weapon: false }, {}]); // bite
    check(weapon.isGripping(), "shutting it on a bot in the mouth grips");

    // Tow: reverse hard and the held bot has to come along.
    const before = { ...sim._test.body(1).translation() };
    frames(sim, 120, [{ leftDrive: -1, rightDrive: -1 }, {}]);
    const towed = sim._test.body(1).translation().z - before.z;
    check(towed > 1.5, "a bitten bot gets hauled, not just pinned", `moved ${towed.toFixed(2)}ft`);

    // Arms raked back over the deck: the blades are nowhere near a bot held out
    // in front of the mouth, so nothing should be cut.
    events.length = 0;
    frames(sim, 180, [{ sawActive: true, auxActive: false }, {}]);
    const armsUp = events.filter((e) => e.type === EV.WEAPON_HIT).length;
    // Arms down on it.
    events.length = 0;
    frames(sim, 180, [{ sawActive: true, auxActive: true }, {}]);
    const armsDown = events.filter((e) => e.type === EV.WEAPON_HIT).length;
    check(armsDown > armsUp * 3, "the saws cut when the arms are down on the held bot",
      `${armsDown} hits with the arms down vs ${armsUp} with them up`);
  });

  // And they cut what they merely TOUCH. They used to cut only what the jaw was
  // holding, so a blade could pass clean through an opponent and do nothing —
  // the bite is hard to land, and the two mechanisms are not the same machine.
  await withSim([spec, CATALOG.bronco], (sim, events) => {
    sim._test.setPose(0, { x: 0, z: 0 }, 0);
    sim._test.setPose(1, { x: 0, z: -3.0 }, Math.PI);
    frames(sim, 60);
    check(!sim._test.weapons[0].isGripping(), "nothing is held");
    events.length = 0;
    // Drive into it with the blades running and the arms down on it. The saws
    // reach barely past the head, so this is a shove-and-cut, not a stand-off.
    frames(sim, 300, [{ sawActive: true, auxActive: true, leftDrive: 1, rightDrive: 1 }, {}]);
    const hits = events.filter((e) => e.type === EV.WEAPON_HIT && e.payload.targetIndex === 1);
    check(hits.length > 0, "a bot the blades reach takes damage without being bitten",
      `${hits.length} hits`);
    // Blades stopped: touching is not enough on its own. Let the spin bleed off
    // first — it coasts down over 1.6s and still cuts on the way.
    frames(sim, 150, [{ sawActive: false, auxActive: true }, {}]);
    events.length = 0;
    frames(sim, 300, [{ sawActive: false, auxActive: true, leftDrive: 1, rightDrive: 1 }, {}]);
    const idle = events.filter((e) => e.type === EV.WEAPON_HIT && e.payload.targetIndex === 1).length;
    check(idle === 0, "and stationary blades cut nothing", `${idle} hits with the saws off`);
  });
});

await test("tracked bots stop when you let go; wheeled ones coast", async () => {
  // A tracked machine does not freewheel: the contact patch is the whole length
  // of the track rather than four small circles, and the drive is geared down
  // far enough to resist being back-driven at all. Let go of the sticks and it
  // stops where it is — which is why neither tracked bot needs a brake, and why
  // Dragon King can spend LT on its body lift instead.
  //
  // It used to be the other way round: Dragon King took 0.48s to stop from
  // 6.7 ft/s while Tombstone took 0.32s from 8.8, because the stop is servo'd at
  // a rate proportional to spec.accel and the tracked bots are the slowest bots
  // in the game.
  const { CATALOG } = await import("../src/assets/catalog.js");
  const coast = async (id) => {
    const spec = CATALOG[id];
    return withSim([spec, CATALOG.bronco], (sim) => {
      sim._test.setPose(1, { x: 18, z: 18 }, 0);
      sim._test.setPose(0, { x: 0, z: 17 }, 0); // forward is -z: start at the far end
      frames(sim, 90);
      frames(sim, 100, [{ leftDrive: 1, rightDrive: 1 }, {}]);
      const speed = speedXZ(sim._test.body(0));
      const from = { ...sim._test.body(0).translation() };
      let ticks = 0;
      for (let f = 0; f < 600; f++) {
        frames(sim, 1);
        ticks++;
        if (speedXZ(sim._test.body(0)) < 0.3) break;
      }
      const to = sim._test.body(0).translation();
      return { speed, feet: Math.hypot(to.x - from.x, to.z - from.z), seconds: ticks / 60 };
    });
  };
  const dragon = await coast("dragonking");
  const rusty = await coast("rusty");
  const tombstone = await coast("tombstone");
  check(dragon.speed > 3 && tombstone.speed > 3, "both got up to speed first",
    `${dragon.speed.toFixed(1)} and ${tombstone.speed.toFixed(1)} ft/s`);
  for (const [id, r] of [["dragon king", dragon], ["rusty", rusty]]) {
    check(r.seconds < tombstone.seconds * 0.7, `${id} stops quicker than a wheeled bot`,
      `${r.seconds.toFixed(2)}s from ${r.speed.toFixed(1)}ft/s vs tombstone ${tombstone.seconds.toFixed(2)}s from ${tombstone.speed.toFixed(1)}ft/s`);
    check(r.feet < 0.6, `${id} stops in under an inch or two`, `${r.feet.toFixed(2)}ft`);
  }
  // Deceleration-only: it must not have made them quicker or grippier.
  const spec = CATALOG.dragonking;
  await withSim([spec, CATALOG.bronco], (sim) => {
    sim._test.setPose(1, { x: 18, z: 18 }, 0);
    sim._test.setPose(0, { x: 0, z: 17 }, 0);
    frames(sim, 90);
    let peak = 0;
    frames(sim, 150, [{ leftDrive: 1, rightDrive: 1 }, {}], () => {
      peak = Math.max(peak, speedXZ(sim._test.body(0)));
    });
    check(peak < spec.maxSpeedFps * 1.1, "and it is no faster than its own top speed",
      `${peak.toFixed(1)} vs ${spec.maxSpeedFps}`);
  });
});

await test("every animated weapon type is wired to something that moves it", async () => {
  // Dragon King's saw discs never turned and its arms never tilted, and neither
  // failure could be seen from the sim: the rotor spun, the grind damage gated
  // on it, and the two lists that decide what the RENDERER animates — the arm
  // types in models.weaponVisualAngle and the sub-spinner types in
  // botAnimation.updateWeaponSub — simply did not mention "sawArms". A type
  // added to the catalog and to the sim but to neither list is invisible.
  const { CATALOG, BOT_IDS } = await import("../src/assets/catalog.js");
  const fs = await import("node:fs");
  const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const armTypes = read("../src/assets/models.js");
  const subTypes = read("../src/engine/botAnimation.js");
  // Types whose visual angle is a 0..1 STROKE the renderer has to map onto an
  // arc; a spinner reports a real angle and needs no entry.
  const stroked = new Set(["flipper", "hammer", "hammerSaw", "sawArms", "crusher",
    "lifter", "lifterDisc", "grappler"]);
  const missingArm = [];
  const missingSub = [];
  for (const id of BOT_IDS) {
    const spec = CATALOG[id];
    const type = spec.weapon?.type;
    if (!type) continue;
    if (stroked.has(type) && !armTypes.includes(`"${type}"`)) missingArm.push(`${id} (${type})`);
    // A weapon with a `sub` block has a nested spinner the renderer must turn.
    if (spec.weapon.sub && !subTypes.includes(`"${type}"`)) missingSub.push(`${id} (${type})`);
  }
  check(missingArm.length === 0, "every stroke weapon is in models.weaponVisualAngle",
    missingArm.join(", "));
  check(missingSub.length === 0, "every weapon with a sub-spinner is in updateWeaponSub",
    missingSub.join(", "));
});

await test("a weapon channel survives the whole way from the pad to the renderer", async () => {
  // Three layers sit between a trigger and a moving part, and each one can eat
  // a channel silently: game/weaponControls shapes the press, game/match's
  // filterInputs gates it on the match phase and on damage, and main.js hands
  // the result to the renderer. Dragon King's saws were dead at the LAST of
  // those, and every check that stopped short of it said the feature worked.
  const { CATALOG } = await import("../src/assets/catalog.js");
  const { createWeaponInputShaper } = await import("../src/game/weaponControls.js");
  const { createMatch } = await import("../src/game/match.js");
  const spec = CATALOG.dragonking;
  await withSim([spec, CATALOG.bronco], (sim, events) => {
    const shaper = createWeaponInputShaper();
    const match = createMatch({ sim, specs: [spec, CATALOG.bronco], emit: () => {}, on: () => () => {} });
    match.start();
    // Out of the countdown, which zeroes every channel — the reason a probe that
    // never reaches "fight" reports every mechanism as broken.
    for (let i = 0; i < 300; i++) match.update(1 / 60);
    check(match.getState().phase === "fight", "the match reached fight",
      `phase ${match.getState().phase}`);

    // A pad press, through the real shaper and the real filter.
    const press = (raw) => match.filterInputs([shaper.shape(raw, spec, 0), {}])[0];
    let out = press({ weaponAlt: true }); // RB down: rising edge latches the saws
    check(out.sawActive === true, "RB reaches the sim as sawActive", JSON.stringify(out.sawActive));
    out = press({}); // and stays latched after release
    check(out.sawActive === true, "and stays latched when the button comes up");
    out = press({ weaponAux: true });
    check(out.auxActive === true, "LB reaches it as auxActive");
    out = press({ weaponLift: true });
    check(out.liftActive === true, "LT reaches it as liftActive, not as the brake");
    check(out.brake !== true, "and does not also brake this bot");
    out = press({ weapon: true }); // RT: the jaw latch
    check(out.weapon === true, "RT reaches it as the jaw latch");
  });
});

await test("claw viper: driving does not hurt it, holding does not hurt them", async () => {
  const { CATALOG } = await import("../src/assets/catalog.js");
  const { createMatch } = await import("../src/game/match.js");
  const spec = CATALOG.clawviper;


  // 1. Sliding along a surface is not hitting it. 250lbf of magnets keep Claw
  //    Viper's floor pan in contact the whole time it moves and its 17ft/s top
  //    speed runs right at the 14ft/s floor-slam threshold, so with the slam
  //    judged on the pair's total relative speed rather than on the speed INTO
  //    the floor, anything that nudged it over billed it for driving.
  await wiredMatch([spec, CATALOG.bronco], ({ sim, match, tick, events, busEmit }) => {
    sim._test.setPose(1, { x: 0, z: 40 }, 0); // far away: nothing to run into
    for (let i = 0; i < 300; i++) tick(); // out of the countdown
    check(match.getState().phase === "fight", "the match reached fight");
    const clean = match.getState().bots[0].total;
    events.length = 0;
    for (let lap = 0; lap < 4; lap++) {
      for (let i = 0; i < 90; i++) tick([{ leftDrive: 1, rightDrive: 1 }, {}]);
      for (let i = 0; i < 30; i++) tick([{ leftDrive: 1, rightDrive: -1 }, {}]);
    }
    const took = match.getState().bots[0].total - clean;
    check(took < 1, "driving around costs Claw Viper nothing", `took ${took.toFixed(1)}% over 8s of driving`);
    // And the sim reported the distinction rather than the match hiding it: the
    // floor contacts are fast ACROSS the floor and slow into it.
    const floor = events.filter((e) => e.type === EV.IMPACT && e.payload.surface === "floor");
    check(floor.length > 0, "it really was scraping the floor", `${floor.length} floor contacts`);
    const fastest = Math.max(...floor.map((e) => e.payload.relSpeed));
    const hardest = Math.max(...floor.map((e) => e.payload.normalSpeed));
    check(hardest < fastest / 2, "a fast slide reads as a slide, not as a slam",
      `${fastest.toFixed(1)}ft/s across the floor, ${hardest.toFixed(1)}ft/s into it`);
    // And the match's rule, stated directly: same pair of speeds, opposite
    // meanings. Driving flat out across the floor is free; landing on it hurts.
    const emitImpact = (payload) => busEmit(EV.IMPACT, payload);
    check(match.getState().phase === "fight", "still fighting", match.getState().phase);
    for (let i = 0; i < 30; i++) tick(); // clear any impact cooldown from the drive
    const slideBase = match.getState().bots[0].total;
    emitImpact({ botIndex: 0, otherIndex: null, surface: "floor", point: null, relSpeed: 30, normalSpeed: 1 });
    check(match.getState().bots[0].total === slideBase, "a 30ft/s slide across the floor does no damage",
      `took ${(match.getState().bots[0].total - slideBase).toFixed(1)}%`);
    emitImpact({ botIndex: 0, otherIndex: null, surface: "floor", point: null, relSpeed: 1, normalSpeed: 30 });
    check(match.getState().bots[0].total > slideBase, "a 30ft/s drop onto it does",
      `took ${(match.getState().bots[0].total - slideBase).toFixed(1)}%`);
  });

  // 2. Holding a bot is not an attack. The forks are blunt; the damage comes
  //    from what you do WITH what you have picked up.
  check((spec.weapon.tuning?.holdDamagePerSecond ?? 0) === 0,
    "a grappler's hold does no damage of its own",
    `holdDamagePerSecond ${spec.weapon.tuning?.holdDamagePerSecond}`);
  const grapplers = Object.values(CATALOG).filter((b) => b.weapon?.type === "grappler");
  for (const bot of grapplers) {
    check((bot.weapon.tuning?.holdDamagePerSecond ?? 0) === 0, `${bot.id}: same`,
      `holdDamagePerSecond ${bot.weapon.tuning?.holdDamagePerSecond}`);
  }

  // 3. What it clamps rides ON the forks. A soft servo leaves a 250lb machine
  //    lagging the fork tip through a turn and keeping whatever spin it arrived
  //    with, which reads as floating in front of the arm rather than held by it.
  await withSim([spec, CATALOG.bronco], (sim) => {
    const m = sim._test;
    m.setPose(0, { x: 0, z: 0 }, 0);
    m.setPose(1, { x: 0, z: -3.0 }, Math.PI);
    frames(sim, 60);
    const weapon = m.weapons[0];
    // Drive on with the jaw closing, then lift.
    frames(sim, 90, [{ sawActive: true, leftDrive: 1, rightDrive: 1 }, {}]);
    check(weapon.isGripping(), "it gets a grip");
    frames(sim, 120, [{ sawActive: true, weapon: true }, {}]); // hold the clamp, raise the arm
    // Now turn hard and see whether the victim comes with it.
    let worstGap = 0;
    let worstSpinGap = 0;
    for (let i = 0; i < 120; i++) {
      sim.stepFrame(1 / 60, [{ sawActive: true, weapon: true, leftDrive: 1, rightDrive: -1 }, {}]);
      if (!weapon.isGripping()) break;
      const carrier = m.body(0);
      const victim = m.body(1);
      const gap = Math.hypot(
        victim.translation().x - carrier.translation().x,
        victim.translation().z - carrier.translation().z,
      );
      worstGap = Math.max(worstGap, gap);
      const a = carrier.angvel();
      const b = victim.angvel();
      worstSpinGap = Math.max(worstSpinGap, Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
    }
    check(weapon.isGripping(), "and keeps it through a hard turn");
    check(worstGap < spec.weapon.gripReach + 1.6, "the victim stays on the forks, not trailing behind them",
      `worst gap ${worstGap.toFixed(2)}ft against a ${spec.weapon.gripReach.toFixed(2)}ft reach`);
    check(worstSpinGap < 3.5, "and turns with the carrier instead of lolling",
      `worst angular gap ${worstSpinGap.toFixed(2)} rad/s`);
  });
});

await test("wedges: a bot rides up one, and two wedges stalemate", async () => {
  // A wedge is how a bot with no spinner gets an opponent off the floor and into
  // whatever it does have — Kraken's jaw, Quantum's jaw, Glitch's drum. Two of
  // those three had no working wedge: Kraken's was 0.76ft across, a quarter of
  // its nose and just the red tongue in the reference photo rather than the
  // sloped face that runs the width of it; Quantum had none at all, its plow
  // authored as a box with a comment calling it a wedge.
  const { CATALOG } = await import("../src/assets/catalog.js");

  // Every bot whose weapon can only reach what has come UP to it needs one.
  for (const id of ["kraken", "quantum", "glitch", "clawviper"]) {
    const spec = CATALOG[id];
    const wedge = spec.colliders.find((c) => c.shape === "wedge");
    check(wedge, `${id} has a wedge at all`, "no wedge collider");
    const ratio = wedge.halfExtents.x / (spec.bodyDims.x / 2);
    check(ratio > 0.6, `${id}'s wedge is most of the width of its nose`,
      `${(ratio * 100).toFixed(0)}% of the half-width`);
    const base = (wedge.offset?.y ?? 0) - wedge.halfExtents.y;
    check(base < 0.12, `${id}'s wedge starts at the floor, which is where a wedge works`,
      `leading edge at y ${base.toFixed(3)}`);
  }

  const charge = async (wedgeId, victimId, dx, yaw) => {
    const spec = CATALOG[wedgeId];
    return withSim([spec, CATALOG[victimId]], (sim) => {
      sim._test.setPose(0, { x: 0, z: 6 }, 0);
      sim._test.setPose(1, { x: dx, z: -1 }, yaw);
      frames(sim, 60);
      const rest = sim._test.body(1).translation().y;
      let rose = 0;
      let tilt = 0;
      for (let i = 0; i < 220; i++) {
        frames(sim, 1, [{ leftDrive: 1, rightDrive: 1 }, {}]);
        const body = sim._test.body(1);
        rose = Math.max(rose, body.translation().y - rest);
        const q = body.rotation();
        const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
        tilt = Math.max(tilt, (Math.acos(Math.max(-1, Math.min(1, upY))) * 180) / Math.PI);
      }
      return { rose, tilt };
    });
  };

  // Kraken into a bot with nothing sticking out the front of it. The ceiling
  // here is GEOMETRIC — you cannot ride higher than the ramp is tall — so this
  // is looking for the nose coming up, not for a flip.
  const straight = await charge("kraken", "bronco", 0, Math.PI);
  check(straight.tilt > 8, "a bot driven into a wedge comes up onto it",
    `nose up ${straight.tilt.toFixed(0)} degrees, chassis up ${straight.rose.toFixed(2)}ft`);
  const angled = await charge("kraken", "bronco", 1.1, Math.PI * 0.75);
  check(angled.tilt > 8, "and off-centre it still finds a way under",
    `nose up ${angled.tilt.toFixed(0)} degrees`);

  // Two wedges meeting is a stalemate, not a ride. Both are on the floor,
  // neither can get under the other, and in the sport that is exactly what
  // happens — they bounce off and go round for a better angle. Without the rule,
  // every wedge-on-wedge exchange was a pair of bots levitating each other.
  await withSim([CATALOG.duck, CATALOG.blip], (sim) => {
    sim._test.setPose(0, { x: 0, z: 5 }, 0);
    sim._test.setPose(1, { x: 0, z: -5 }, Math.PI);
    frames(sim, 60);
    const rest = [0, 1].map((i) => sim._test.body(i).translation().y);
    let worst = 0;
    for (let i = 0; i < 200; i++) {
      frames(sim, 1, [{ leftDrive: 1, rightDrive: 1 }, { leftDrive: 1, rightDrive: 1 }]);
      for (const k of [0, 1]) worst = Math.max(worst, sim._test.body(k).translation().y - rest[k]);
    }
    // Not zero: full-width wedges are never perfectly matched, and one of them
    // getting a lip under the other's CHASSIS is a real thing that happens and
    // still counts. What must not happen is the two slopes lifting each other,
    // which is worth 2.7ft of levitation without the rule against 0.9 with it.
    check(worst < 1.5, "nose to nose, two wedge bots mostly stay on the floor",
      `one of them rose ${worst.toFixed(2)}ft`);
  });
});

await test("ramming: it shoves them, it hurts them, and the back hurts most", async () => {
  // Ramming used to be free, and the reason was one line in the wrong place.
  // Contact force events are drained after world.step, so by the time anything
  // read the two machines' velocities the solver had already resolved the
  // collision and spent the closing speed: a 27ft/s head-on measured as 1.2.
  // The approach speed is now snapshotted before the step (sim/contacts.js),
  // and the normal comes off the force event rather than off a manifold that no
  // longer exists by then.
  const { CATALOG } = await import("../src/assets/catalog.js");
  const { createMatch } = await import("../src/game/match.js");
  // A flat-nosed attacker on purpose. Claw Viper is faster, but its forks are a
  // WEDGE, and a wedge does not ram — it gets under you and the closing speed
  // goes into lifting instead of into the hit, which is the whole point of
  // fitting one. Tantrum has no wedge and hits with its face.
  const attacker = CATALOG.tantrum;
  const victim = CATALOG.bronco;

  const chargeInto = async (yaw) => {
    const handlers = new Map();
    const on = (type, handler) => {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(handler);
      return () => {};
    };
    const events = [];
    const emit = (type, payload) => {
      events.push({ type, payload });
      (handlers.get(type) || []).forEach((handler) => handler(payload));
    };
    const sim = await createSim({ bots: [attacker, victim], emit });
    try {
      const match = createMatch({ sim, specs: [attacker, victim], emit, on });
      match.start();
      const tick = (inputs = [{}, {}]) => {
        sim.stepFrame(1 / 60, match.filterInputs(inputs));
        match.update(1 / 60);
      };
      for (let i = 0; i < 300; i++) tick();
      sim._test.setPose(0, { x: -5, z: 9 }, 0); // a clear run at it, away from the screws
      sim._test.setPose(1, { x: -5, z: -3 }, yaw);
      for (let i = 0; i < 10; i++) tick();
      const before = match.getState().bots.map((b) => b.total);
      events.length = 0;
      let approach = 0;
      let shoved = 0;
      let struckAt = -1;
      for (let i = 0; i < 120; i++) {
        // Throttle cut the instant it lands, so `shoved` is the KNOCKBACK and not
        // the bulldozing that follows it. The victim never moves a wheel.
        tick([struckAt >= 0 ? {} : { leftDrive: 1, rightDrive: 1 }, {}]);
        const hits = events.filter((e) => e.type === EV.IMPACT && e.payload.surface === "bot");
        if (hits.length && struckAt < 0) struckAt = i;
        for (const hit of hits) approach = Math.max(approach, hit.payload.approachSpeed);
        if (struckAt >= 0 && i <= struckAt + 20) {
          const v = sim._test.body(1).linvel();
          shoved = Math.max(shoved, Math.hypot(v.x, v.z));
        }
      }
      const took = match.getState().bots.map((b, k) => b.total - before[k]);
      // The screws run down the middle of the arena; only impact damage counts.
      const impact = [0, 1].map((k) => events
        .filter((e) => e.type === EV.DAMAGE && e.payload.botIndex === k && e.payload.kind === "impact")
        .reduce((sum, e) => sum + e.payload.amount, 0));
      return { approach, shoved, took, impact };
    } finally { sim.dispose(); }
  };

  const nose = await chargeInto(Math.PI); // victim facing the hit
  const tail = await chargeInto(0); // victim facing away — rammed in the back
  const flank = await chargeInto(Math.PI / 2);

  check(nose.approach > 12, "a full-speed ram reports the speed it was actually doing",
    `${nose.approach.toFixed(1)}ft/s of closing speed`);
  check(nose.shoved > 8.5, "and it MOVES the bot it hits",
    `the victim peaked at ${nose.shoved.toFixed(1)}ft/s after the attacker let go`);
  check(nose.impact[0] > 0 && nose.impact[1] > 0, "both machines pay for it",
    `${nose.impact[0].toFixed(1)}% and ${nose.impact[1].toFixed(1)}%`);
  check(nose.impact[1] < 4, "a hit on the plate you built to take it is cheap",
    `${nose.impact[1].toFixed(1)}% through the front`);
  check(tail.impact[1] > flank.impact[1] && flank.impact[1] > nose.impact[1],
    "and it costs more the less armour is in the way: back > side > front",
    `front ${nose.impact[1].toFixed(1)}%, side ${flank.impact[1].toFixed(1)}%, back ${tail.impact[1].toFixed(1)}%`);
  check(tail.impact[1] > nose.impact[1] * 2, "getting caught from behind is a real punishment",
    `${tail.impact[1].toFixed(1)}% vs ${nose.impact[1].toFixed(1)}%`);

  // Both machines charging: the hardest hit in the game, and the one the old
  // code got most wrong. The contact manifold is queried after world.step and on
  // exactly this frame it is routinely already gone, so the router fell back to
  // a hardcoded straight-up normal and a 27ft/s head-on measured as 2.5. The
  // normal now comes off the force event, which the step cannot take away.
  // Claw Viper for this one: it is the fastest machine here, and what is being
  // measured is whether the number survives the step at all rather than what the
  // hit is worth.
  await withSim([CATALOG.clawviper, victim], (sim, events) => {
    sim._test.setPose(0, { x: -5, z: 8 }, 0);
    sim._test.setPose(1, { x: -5, z: -8 }, Math.PI);
    frames(sim, 60);
    events.length = 0;
    let closing = 0;
    let approach = 0;
    for (let i = 0; i < 150; i++) {
      const a = sim._test.body(0).linvel();
      const b = sim._test.body(1).linvel();
      closing = Math.max(closing, Math.hypot(a.x, a.z) + Math.hypot(b.x, b.z));
      frames(sim, 1, [{ leftDrive: 1, rightDrive: 1 }, { leftDrive: 1, rightDrive: 1 }]);
    }
    for (const e of events) {
      if (e.type === EV.IMPACT && e.payload.surface === "bot") approach = Math.max(approach, e.payload.approachSpeed);
    }
    check(closing > 25, "the two of them really were closing that fast", `${closing.toFixed(1)}ft/s`);
    check(approach > closing * 0.4, "and the head-on is measured at the speed it happened",
      `reported ${approach.toFixed(1)}ft/s against ${closing.toFixed(1)}ft/s of closing speed`);
  });

  // Ramming another robot is a thing you DO. Being thrown into the floor by a
  // spinner is a thing that happens to you after that spinner has already been
  // paid for its hit, and pricing both the same made the weapon's own damage the
  // smaller half of its effect: over a full AI fight, floor and ceiling slams
  // alone came to four times the weapon damage in the match.
  await wiredMatch([attacker, victim], ({ match, tick, busEmit }) => {
    for (let i = 0; i < 300; i++) tick();
    const hit = (surface) => {
      const before = match.getState().bots[0].total;
      busEmit(EV.IMPACT, { botIndex: 0, otherIndex: null, surface, point: null, approachSpeed: 26 });
      for (let i = 0; i < 40; i++) tick(); // clear the per-bot cooldown
      return match.getState().bots[0].total - before;
    };
    const rammed = hit("bot");
    const slammed = hit("floor");
    check(rammed > 0 && slammed > 0, "both a ram and a slam are worth something",
      `${rammed.toFixed(1)}% and ${slammed.toFixed(1)}%`);
    check(slammed < rammed / 2, "but a slam is worth much less than a ram at the same speed",
      `slam ${slammed.toFixed(1)}% vs ram ${rammed.toFixed(1)}%`);
  });
});

await test("a drum turns about its own axle, not its bounding box", async () => {
  // A rotor part is never just the rotor: Tantrum's drum comes with the attack
  // lip standing proud of the barrel, and the lip drags the bounding box off
  // the axis. The partitioner has nothing better to offer — it uses the box
  // centre — so a drum whose pivot was never corrected turns about a line it is
  // not mounted on and wobbles. Fitting the barrel's own cross-section finds the
  // real axle, and the fit is decisive rather than a judgement call: the points
  // that disagree with it ARE the lip.
  const fs = await import("node:fs");
  const { CATALOG, BOT_IDS } = await import("../src/assets/catalog.js");

  const readGlb = (file) => {
    const buf = fs.readFileSync(new URL(`../public/models/${file}`, import.meta.url));
    const jsonLen = buf.readUInt32LE(12);
    const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen).trim());
    const binStart = 20 + ((jsonLen + 3) & ~3) + 8;
    const COMP = { 5121: [Uint8Array, 1], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
    const NUM = { SCALAR: 1, VEC2: 2, VEC3: 3 };
    const positions = (node) => {
      const acc = json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION];
      const view = json.bufferViews[acc.bufferView];
      const [Ctor, bytes] = COMP[acc.componentType];
      const n = NUM[acc.type];
      const start = binStart + (view.byteOffset || 0) + (acc.byteOffset || 0);
      const stride = view.byteStride || bytes * n;
      const t = node.translation || [0, 0, 0];
      const out = [];
      for (let i = 0; i < acc.count; i++) {
        const at = start + i * stride;
        out.push([0, 1, 2].map((c) => new Ctor(buf.buffer, buf.byteOffset + at + c * bytes, 1)[0] + t[c]));
      }
      return out;
    };
    return { json, positions };
  };

  // Kasa circle fit, re-fitted while rejecting points off the circle. What it
  // rejects is the lip; what it keeps is the barrel.
  const fitCircle = (points) => {
    let sel = points;
    let c = [0, 0];
    let r = 0;
    for (let pass = 0; pass < 6; pass++) {
      let Sx = 0, Sy = 0, Sxx = 0, Syy = 0, Sxy = 0, Sxxx = 0, Syyy = 0, Sxyy = 0, Sxxy = 0;
      for (const [x, y] of sel) {
        Sx += x; Sy += y; Sxx += x * x; Syy += y * y; Sxy += x * y;
        Sxxx += x * x * x; Syyy += y * y * y; Sxyy += x * y * y; Sxxy += x * x * y;
      }
      const n = sel.length;
      const A = n * Sxx - Sx * Sx, B = n * Sxy - Sx * Sy, C = n * Syy - Sy * Sy;
      const D = 0.5 * (n * Sxyy - Sx * Syy + n * Sxxx - Sx * Sxx);
      const E = 0.5 * (n * Sxxy - Sy * Sxx + n * Syyy - Sy * Syy);
      const det = A * C - B * B;
      if (!det) break;
      c = [(D * C - B * E) / det, (A * E - B * D) / det];
      r = sel.reduce((sum, [x, y]) => sum + Math.hypot(x - c[0], y - c[1]), 0) / n;
      const keep = points.filter(([x, y]) => Math.abs(Math.hypot(x - c[0], y - c[1]) - r) < r * 0.18);
      if (keep.length < 40) break;
      sel = keep;
    }
    return { c, r, inliers: sel.length };
  };

  const checked = [];
  const offenders = [];
  for (const id of BOT_IDS) {
    const spec = CATALOG[id];
    if (spec.weapon?.type !== "drum") continue;
    const { json, positions } = readGlb(`${id}.glb`);
    const weapon = json.nodes.find((n) => n.name === "modelWeapon");
    const pivot = weapon?.extras?.pivotLocal;
    if (!pivot || !weapon.children?.length) continue;
    // The biggest child is the barrel; the rest are pulleys and brackets.
    const parts = weapon.children.map((i) => json.nodes[i]).filter((n) => n.mesh !== undefined);
    if (!parts.length) continue;
    const barrel = parts.reduce((best, n) => {
      const count = json.accessors[json.meshes[n.mesh].primitives[0].attributes.POSITION].count;
      return count > best.count ? { node: n, count } : best;
    }, { node: null, count: 0 }).node;
    const axis = weapon.extras.weaponAxis || [1, 0, 0];
    // The two axes the rotor turns IN are the ones the axle is not along.
    const along = axis.map((v) => Math.abs(v)).indexOf(Math.max(...axis.map((v) => Math.abs(v))));
    const plane = [0, 1, 2].filter((a) => a !== along);
    const flat = positions(barrel).map((p) => [p[plane[0]], p[plane[1]]]);
    const fit = fitCircle(flat);
    if (fit.inliers < flat.length * 0.5) continue; // not a solid of revolution
    const off = Math.hypot(pivot[plane[0]] - fit.c[0], pivot[plane[1]] - fit.c[1]);
    const scale = spec.modelScale ?? 1;
    checked.push(`${id} ${(off * scale).toFixed(4)}ft (${((off / fit.r) * 100).toFixed(0)}% of r)`);
    if (off >= fit.r * 0.06) {
      offenders.push(`${id}: ${(off * scale).toFixed(4)}ft off a ${(fit.r * scale).toFixed(3)}ft axle`
        + ` — ${((off / fit.r) * 100).toFixed(0)}% of the drum radius. Fitted axle`
        + ` [${plane[0]}]=${fit.c[0].toFixed(4)} [${plane[1]}]=${fit.c[1].toFixed(4)}`);
    }
  }
  check(checked.length > 0, "at least one drum was measurable", "no drum had a fittable barrel");
  check(offenders.length === 0, "every drum turns about its own axle", offenders.join(" | "));
});

// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (ladder.length === 3) {
  console.log(
    "spinner ladder:",
    ladder.map((l) => `ratio ${l.ratio}: J=${l.impulse.toFixed(1)} dv=${l.peakTargetSpeed.toFixed(1)}`).join("  |  "),
  );
}
if (failed.length > 0) {
  process.exitCode = 1;
}
