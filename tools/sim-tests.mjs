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
