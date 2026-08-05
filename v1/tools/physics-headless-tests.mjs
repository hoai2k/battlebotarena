import assert from "node:assert/strict";
import { BOT_CONFIG, botGroundSpeedFeetPerSecond } from "../src/botConfig.js";
import { HEADLESS_CEILING_HEIGHT, HEADLESS_FLOOR_Y, createHeadlessPhysicsSim, headlessTestUtils, setPhysicsCornerTeeterPose } from "../src/headlessPhysicsRig.js";
import { PORTED_BOT_IDS } from "../src/portedBots.js";
import { driveSmoothness } from "./drive-smoothness-probe.mjs";
import { weaponMechanism } from "./weapon-mechanism-probe.mjs";
import { auditControls } from "./weapon-control-audit.mjs";
import {
  botsWithMechanism,
  fistsReport,
  flameReport,
  gripReport,
  holonomicReport,
  srimechReport,
  liftReport,
  trackReport,
  trackedStopReport,
  twoWayArmReport,
} from "./mechanism-probe.mjs";

const { THREE, bots, correctFighterAboveFloor, fighterColliderWorldMinY, fighterUpVector } = headlessTestUtils;

// The rig's arena half-extent (src/headlessPhysicsRig.js).
const ARENA_HALF_LENGTH = 120;

async function withSim(options, fn) {
  const sim = await createHeadlessPhysicsSim(options);
  try {
    return await fn(sim);
  } finally {
    sim.dispose();
  }
}

async function driveProbe(playerId, {
  frames = 150,
  turnFrames = 80,
  rivalId = "biteforce",
} = {}) {
  if (rivalId === playerId) rivalId = "minotaur";
  return withSim({ playerId, rivalId }, (sim) => {
    const fighter = sim.fighters[0];
    const rival = sim.fighters[1];
    sim.setPose(fighter, { x: 0, y: fighter.restingBodyY, z: 6.2 }, 0);
    sim.setPose(rival, { x: 7, y: rival.restingBodyY, z: 7 }, Math.PI);
    sim.stepFrames(10);
    const start = sim.snapshot("drive-start");
    let peakGrounded = 0;
    let peakSpeed = 0;
    let speedAtOneSecond = 0;
    let speedAtTwoSeconds = 0;
    sim.setInput(0, { leftDrive: 1, rightDrive: 1 });
    sim.setInput(1, {});
    sim.stepFrames(frames, (frame) => {
      peakGrounded = Math.max(peakGrounded, fighter.wheelTraction?.grounded || 0);
      const velocity = fighter.rb.linvel();
      const speed = Math.hypot(velocity.x, velocity.z);
      peakSpeed = Math.max(peakSpeed, speed);
      if (frame === 59) speedAtOneSecond = speed;
      if (frame === 119) speedAtTwoSeconds = speed;
    });
    const afterForward = sim.snapshot("drive-forward");
    sim.setInput(0, {});
    sim.setPose(fighter, { x: 0, y: fighter.restingBodyY, z: 0 }, 0);
    sim.stepFrames(6);
    const yawBefore = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(
      fighter.rb.rotation().x,
      fighter.rb.rotation().y,
      fighter.rb.rotation().z,
      fighter.rb.rotation().w,
    ), "YXZ").y;
    sim.setInput(0, { leftDrive: 1, rightDrive: -1 });
    sim.stepFrames(turnFrames, () => {
      peakGrounded = Math.max(peakGrounded, fighter.wheelTraction?.grounded || 0);
    });
    sim.setInput(0, {});
    const yawAfter = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(
      fighter.rb.rotation().x,
      fighter.rb.rotation().y,
      fighter.rb.rotation().z,
      fighter.rb.rotation().w,
    ), "YXZ").y;
    const startPos = start.fighters[0].position;
    const forwardPos = afterForward.fighters[0].position;
    const moved = Math.hypot(forwardPos.x - startPos.x, forwardPos.z - startPos.z);
    const yawDelta = Math.abs(Math.atan2(Math.sin(yawAfter - yawBefore), Math.cos(yawAfter - yawBefore)));
    const maxSpeed = botGroundSpeedFeetPerSecond(fighter.spec, "maxSpeed", 3.682);
    const expectedPeakSpeed = maxSpeed * 0.82;
    const expectedCruiseSpeed = maxSpeed * 0.72;
    const expectedTurn = fighter.spec?.id === "huge" ? 0.1 : ["biteforce", "tombstone"].includes(fighter.spec?.id) ? 0.05 : 0.25;
    return {
      movedForward: moved > (fighter.spec?.id === "huge" ? 4.0 : 8.0),
      reachedSpeed: peakSpeed > expectedPeakSpeed && speedAtOneSecond > expectedCruiseSpeed && speedAtTwoSeconds > expectedCruiseSpeed,
      turned: yawDelta > expectedTurn,
      retainedTraction: peakGrounded > 0.25,
      moved,
      peakSpeed,
      speedAtOneSecond,
      speedAtTwoSeconds,
      expectedPeakSpeed,
      expectedCruiseSpeed,
      yawDelta,
      expectedTurn,
      peakGrounded,
    };
  });
}

async function rosterDriveProbe() {
  const results = {};
  for (const bot of bots) {
    results[bot.id] = await driveProbe(bot.id, { rivalId: bot.id === "biteforce" ? "minotaur" : "biteforce" });
  }
  const failed = Object.entries(results)
    .filter(([, checks]) => !checks.movedForward || !checks.reachedSpeed || !checks.turned || !checks.retainedTraction)
    .map(([id]) => id);
  return { allDriveAndTurn: failed.length === 0, failed, results };
}

async function normalDrivePostureProbe() {
  const results = {};
  for (const bot of bots) {
    await withSim({ playerId: bot.id, rivalId: bot.id === "biteforce" ? "minotaur" : "biteforce" }, (sim) => {
      const fighter = sim.fighters[0];
      const rival = sim.fighters[1];
      sim.setPose(fighter, { x: 0, y: fighter.restingBodyY, z: 5 }, 0);
      sim.setPose(rival, { x: 7, y: rival.restingBodyY, z: 7 }, Math.PI);
      sim.stepFrames(30);
      sim.setInput(0, { leftDrive: 1, rightDrive: 1 });
      sim.setInput(1, {});
      let maxTiltDeg = 0;
      let endTiltDeg = 0;
      let minDriveSolidGrounded = Infinity;
      sim.stepFrames(75, () => {
        const upY = fighterUpVector(fighter).y;
        endTiltDeg = Math.acos(Math.max(-1, Math.min(1, Math.abs(upY)))) * 180 / Math.PI;
        maxTiltDeg = Math.max(maxTiltDeg, endTiltDeg);
        const traction = sim.physics.tractionForFighter(fighter);
        minDriveSolidGrounded = Math.min(minDriveSolidGrounded, traction.driveSolidGrounded || 0);
      });
      results[bot.id] = {
        plantedByDriveContacts: minDriveSolidGrounded > (bot.id === "huge" ? 0.35 : 0.72),
        resistedTeeter: maxTiltDeg < (bot.id === "tombstone" ? 3.0 : 0.8),
        settledNearlyFlat: endTiltDeg < (bot.id === "tombstone" ? 1.7 : 0.8),
        maxTiltDeg,
        endTiltDeg,
        minDriveSolidGrounded,
      };
    });
  }
  const failed = Object.entries(results)
    .filter(([, checks]) => !checks.plantedByDriveContacts || !checks.resistedTeeter || !checks.settledNearlyFlat)
    .map(([id]) => id);
  return {
    allPlanted: failed.length === 0,
    failed,
    results,
  };
}

async function brakeProbe() {
  return withSim({ playerId: "biteforce", rivalId: "minotaur" }, (sim) => {
    const fighter = sim.fighters[0];
    const rival = sim.fighters[1];
    const restingBodyY = fighter.restingBodyY;
    sim.setPose(fighter, { x: 0, y: fighter.restingBodyY, z: 3 }, 0);
    sim.setPose(rival, { x: 6, y: rival.restingBodyY, z: 6 }, Math.PI);
    sim.stepFrames(10);
    sim.setInput(0, { leftDrive: 1, rightDrive: 1, boostActive: true });
    sim.setInput(1, {});
    sim.stepFrames(50);
    const before = fighter.rb.linvel();
    const speedBeforeBrake = -before.z;
    sim.setInput(0, { leftDrive: 1, rightDrive: 1, boostActive: true, brakeActive: true });
    let maxBrakeImpulse = 0;
    let maxBrakeTilt = 0;
    let minPitch = 0;
    let minColliderY = Infinity;
    sim.stepFrames(30, () => {
      maxBrakeImpulse = Math.max(maxBrakeImpulse, Math.abs(fighter.physics?.lastDrive?.driveImpulse || 0));
      maxBrakeTilt = Math.max(maxBrakeTilt, Math.abs(fighter.physics?.lastBrakeTilt?.amount || 0));
      minColliderY = Math.min(minColliderY, fighterColliderWorldMinY(fighter));
      const rotation = fighter.rb.rotation();
      const pitch = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w), "YXZ").x;
      minPitch = Math.min(minPitch, pitch);
    });
    const after = fighter.rb.linvel();
    const speedAfterBrake = Math.abs(after.z);
    const lastDrive = fighter.physics?.lastDrive || {};
    return {
      reachedChargeSpeed: speedBeforeBrake > 5,
      slowedSignificantly: speedAfterBrake < speedBeforeBrake * 0.42,
      brakeTargetedStop: lastDrive.brakeActive === true && Math.abs(lastDrive.targetSpeed || 0) < 0.001,
      brakeImpulseApplied: maxBrakeImpulse > 5,
      tiltTriggered: maxBrakeTilt > 0,
      tiltedForward: minPitch < -0.002,
      keptAboveFloor: minColliderY > HEADLESS_FLOOR_Y - 0.035,
      speedBeforeBrake,
      speedAfterBrake,
      maxBrakeImpulse,
      maxBrakeTilt,
      minPitch,
      minColliderY,
      lastDrive,
    };
  });
}

async function biteForceFloorClearanceProbe() {
  return withSim({ playerId: "biteforce", rivalId: "minotaur" }, (sim) => {
    const fighter = sim.fighters[0];
    const rival = sim.fighters[1];
    const restingBodyY = fighter.restingBodyY;
    sim.setPose(fighter, { x: 0, y: fighter.restingBodyY, z: 3 }, 0);
    sim.setPose(rival, { x: 6, y: rival.restingBodyY, z: 6 }, Math.PI);
    sim.stepFrames(20);

    const phases = [
      { name: "settle", input: {}, frames: 120 },
      { name: "drive", input: { leftDrive: 1, rightDrive: 1 }, frames: 180 },
      { name: "turn", input: { leftDrive: 1, rightDrive: -1 }, frames: 120 },
      { name: "weapon-drive", input: { leftDrive: 1, rightDrive: 1, weapon: true }, frames: 180 },
    ];
    const results = [];

    for (const phase of phases) {
      sim.setInput(0, phase.input);
      sim.setInput(1, {});
      let minColliderY = Infinity;
      let minGrounded = Infinity;
      let minSolidGrounded = Infinity;
      let maxFloorLift = 0;
      sim.stepFrames(phase.frames, () => {
        minColliderY = Math.min(minColliderY, fighterColliderWorldMinY(fighter));
        const traction = sim.physics.tractionForFighter(fighter);
        minGrounded = Math.min(minGrounded, traction.grounded || 0);
        minSolidGrounded = Math.min(minSolidGrounded, traction.solidGrounded || 0);
        maxFloorLift = Math.max(maxFloorLift, fighter.physics?.lastStep?.floorLift || 0);
      });
      results.push({
        name: phase.name,
        minColliderY,
        maxPenetration: Math.max(0, HEADLESS_FLOOR_Y - minColliderY),
        minGrounded,
        minSolidGrounded,
        maxFloorLift,
        bodyY: fighter.rb.translation().y,
      });
    }

    const failedClearance = results.filter((result) => result.minColliderY < HEADLESS_FLOOR_Y - 0.002);
    const failedTraction = results.filter((result) => result.minGrounded < 0.65 || result.minSolidGrounded < 0.35);
    return {
      didNotSink: failedClearance.length === 0,
      retainedTraction: failedTraction.length === 0,
      frameUsesChassisRestHeight: Math.abs(restingBodyY - HEADLESS_FLOOR_Y) < 0.05,
      restingBodyY,
      failedClearance,
      failedTraction,
      results,
    };
  });
}

async function broncoSelfRightProbe() {
  return withSim({ playerId: "bronco", rivalId: "biteforce" }, (sim) => {
    const bronco = sim.fighters[0];
    const inverted = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    bronco.rb.setTranslation({ x: 0, y: bronco.restingBodyY + 0.65, z: 0 }, true);
    bronco.rb.setRotation({ x: inverted.x, y: inverted.y, z: inverted.z, w: inverted.w }, true);
    bronco.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
    bronco.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    correctFighterAboveFloor(bronco, 0.08);
    sim.stepFrames(10);
    const start = sim.snapshot("bronco-self-right-start");
    let minColliderY = Infinity;
    let maxUpY = fighterUpVector(bronco).y;
    for (let frame = 0; frame < 190; frame += 1) {
      sim.setInput(0, { weapon: frame < 46 });
      sim.stepFrame();
      minColliderY = Math.min(minColliderY, fighterColliderWorldMinY(bronco));
      maxUpY = Math.max(maxUpY, fighterUpVector(bronco).y);
    }
    sim.setInput(0, {});
    const end = sim.snapshot("bronco-self-right-end");
    const traction = sim.physics.tractionForFighter(bronco);
    return {
      didNotSink: minColliderY > 0,
      startedRighting: maxUpY > -0.05,
      recoveredUpright: end.fighters[0].upY > 0.62 && (traction.grounded || 0) > 0.18,
      startUpY: start.fighters[0].upY,
      endUpY: end.fighters[0].upY,
      grounded: traction.grounded || 0,
      maxUpY,
      minColliderY,
    };
  });
}

async function broncoUnderFlipProbe() {
  return withSim({ playerId: "bronco", rivalId: "biteforce" }, (sim) => {
    const bronco = sim.fighters[0];
    const target = sim.fighters[1];
    sim.setPose(bronco, { x: 0, y: bronco.restingBodyY, z: 0.25 }, 0);
    sim.setPose(target, { x: 0, y: target.restingBodyY + 0.32, z: -1.03 }, Math.PI);
    sim.stepFrames(6);
    const targetStartY = target.rb.translation().y;
    const broncoStartY = bronco.rb.translation().y;
    let maxLift = 0;
    let maxVerticalSpeed = 0;
    let minUpY = 1;
    let maxAngularSpeed = 0;
    let maxBroncoLift = 0;
    let minBroncoUpY = 1;
    sim.setInput(0, { weapon: true });
    // Bronco's own recoil is measured over the stroke and the victim's flight,
    // NOT over the landing: Bite Force comes down on top of Bronco around frame
    // 73 and bounces it 0.27ft, which is the flip working rather than Bronco
    // launching itself.
    const RECOIL_WINDOW_FRAMES = 60;
    sim.stepFrames(95, (frame) => {
      const p = target.rb.translation();
      const v = target.rb.linvel();
      const a = target.rb.angvel();
      const broncoPosition = bronco.rb.translation();
      maxLift = Math.max(maxLift, p.y - targetStartY);
      maxVerticalSpeed = Math.max(maxVerticalSpeed, v.y);
      minUpY = Math.min(minUpY, fighterUpVector(target).y);
      maxAngularSpeed = Math.max(maxAngularSpeed, Math.hypot(a.x, a.y, a.z));
      if (frame > RECOIL_WINDOW_FRAMES) return;
      maxBroncoLift = Math.max(maxBroncoLift, broncoPosition.y - broncoStartY);
      minBroncoUpY = Math.min(minBroncoUpY, fighterUpVector(bronco).y);
    });
    return {
      targetLaunchedAtLeast3m: maxLift >= 0.5,
      targetGotSelfRightingScaleKick: maxLift > 0.2 || maxVerticalSpeed > 2.2,
      targetRotated: minUpY < 0.88 || maxAngularSpeed > 0.7,
      broncoStayedPlanted: maxBroncoLift < 0.12 && minBroncoUpY > 0.96,
      maxLift,
      maxVerticalSpeed,
      minUpY,
      maxAngularSpeed,
      maxBroncoLift,
      minBroncoUpY,
    };
  });
}

async function broncoFlipperReturnGateProbe() {
  return withSim({ playerId: "bronco", rivalId: "biteforce" }, (sim) => {
    const bronco = sim.fighters[0];
    const target = sim.fighters[1];
    const returnSeconds = bronco.weapon.returnSeconds;
    const returnFrames = Math.ceil((Math.max(0, returnSeconds) + 0.25) * 60);
    const placeTarget = (z = -1.03) => {
      sim.setPose(target, { x: 0, y: target.restingBodyY + 0.12, z }, Math.PI);
      target.rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      target.rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
    };
    sim.setPose(bronco, { x: 0, y: bronco.restingBodyY, z: 0.25 }, 0);
    placeTarget(-1.03);
    sim.stepFrames(6);

    sim.setInput(0, { weapon: true });
    sim.stepFrames(24);
    sim.setInput(0, { weapon: false });
    sim.stepFrames(4);

    placeTarget(-1.03);
    sim.stepFrames(2);
    const blockedStartY = target.rb.translation().y;
    let blockedMaxLift = 0;
    sim.setInput(0, { weapon: true });
    sim.stepFrames(45, () => {
      blockedMaxLift = Math.max(blockedMaxLift, target.rb.translation().y - blockedStartY);
    });

    sim.setInput(0, { weapon: false });
    sim.stepFrames(returnFrames);
    sim.setPose(bronco, { x: 0, y: bronco.restingBodyY, z: 0.25 }, 0);
    placeTarget(-0.72);
    sim.stepFrames(2);
    const allowedStartY = target.rb.translation().y;
    let allowedMaxLift = 0;
    sim.setInput(0, { weapon: true });
    sim.stepFrames(60, () => {
      allowedMaxLift = Math.max(allowedMaxLift, target.rb.translation().y - allowedStartY);
    });

    return {
      blockedDuringReturn: blockedMaxLift < 0.2,
      firedAfterReturn: allowedMaxLift > 0.5,
      blockedMaxLift,
      allowedMaxLift,
      returnSeconds,
      configuredReturnSeconds: bronco.spec?.weaponReturnSeconds,
      returnFrames,
    };
  });
}

async function invertedDriveProbe() {
  return withSim({ playerId: "minotaur", rivalId: "bronco" }, (sim) => {
    const invertedBot = sim.fighters[0];
    const disabledBot = sim.fighters[1];
    const invertedRotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    invertedBot.rb.setTranslation({ x: 0, y: invertedBot.restingBodyY + 0.55, z: 0 }, true);
    invertedBot.rb.setRotation({ x: invertedRotation.x, y: invertedRotation.y, z: invertedRotation.z, w: invertedRotation.w }, true);
    disabledBot.rb.setTranslation({ x: 4, y: disabledBot.restingBodyY + 0.55, z: 0 }, true);
    disabledBot.rb.setRotation({ x: invertedRotation.x, y: invertedRotation.y, z: invertedRotation.z, w: invertedRotation.w }, true);
    correctFighterAboveFloor(invertedBot, 0.08);
    correctFighterAboveFloor(disabledBot, 0.08);
    sim.stepFrames(4);
    let invertedPeakSpeed = 0;
    let disabledPeakSpeed = 0;
    sim.setInput(0, { leftDrive: 1, rightDrive: 1 });
    sim.setInput(1, { leftDrive: 1, rightDrive: 1 });
    sim.stepFrames(90, () => {
      const vi = invertedBot.rb.linvel();
      const vd = disabledBot.rb.linvel();
      invertedPeakSpeed = Math.max(invertedPeakSpeed, Math.hypot(vi.x, vi.z));
      if (fighterUpVector(disabledBot).y < -0.58) {
        disabledPeakSpeed = Math.max(disabledPeakSpeed, Math.hypot(vd.x, vd.z));
      }
    });
    return {
      invertedBotCanDrive: invertedPeakSpeed > 1.0,
      nonInvertedBotCannotDriveUpsideDown: disabledPeakSpeed < 0.35,
      invertedPeakSpeed,
      disabledPeakSpeed,
    };
  });
}

async function teeterRecoveryProbe() {
  const cases = [
    { name: "low-roll-left", rollDeg: 10, pitchDeg: 0, yawDeg: 0, angvel: { x: -0.04, y: 0, z: 0.04 } },
    { name: "low-roll-right", rollDeg: -10, pitchDeg: 0, yawDeg: 0, angvel: { x: 0.04, y: 0, z: -0.04 } },
    { name: "low-front-wedge", rollDeg: 0, pitchDeg: 10, yawDeg: 0, angvel: { x: -0.04, y: 0, z: 0 } },
    { name: "low-compound-corner", rollDeg: -12, pitchDeg: 8, yawDeg: 18, angvel: { x: -0.05, y: 0.01, z: 0.04 } },
    { name: "high-side", rollDeg: 82, pitchDeg: 0, yawDeg: 0, angvel: { x: -0.15, y: 0.02, z: 0.2 } },
    { name: "high-corner", rollDeg: -42, pitchDeg: 38, yawDeg: 22, angvel: { x: -0.25, y: 0.04, z: 0.18 } },
  ];
  const starts = [
    { name: "grounded", heightOffset: 0 },
    { name: "lifted", heightOffset: 0.35 },
  ];
  const results = [];

  for (const bot of bots) {
    await withSim({ playerId: bot.id, rivalId: bot.id === "biteforce" ? "minotaur" : "biteforce" }, (sim) => {
      for (const teeterCase of cases) {
        for (const start of starts) {
          const fighter = sim.fighters[0];
          setPhysicsCornerTeeterPose(sim, fighter, {
            ...teeterCase,
            heightOffset: start.heightOffset,
            linvel: { x: 0, y: 0, z: 0 },
          });
          sim.setInput(0, {});
          sim.setInput(1, {});
          // Where it STARTED, not the origin: the teeter pose stands the bot on
          // its lowest corner, so a big machine begins several feet out (Mammoth
          // 3.6ft) and would fail a from-origin drift test before it moved.
          const startPosition = fighter.rb.translation();
          const startX = startPosition.x;
          const startZ = startPosition.z;
          let maxHeight = fighter.rb.translation().y;
          let minGrounded = Infinity;
          sim.stepFrames(300, () => {
            maxHeight = Math.max(maxHeight, fighter.rb.translation().y);
            const traction = sim.physics.tractionForFighter(fighter);
            minGrounded = Math.min(minGrounded, traction.grounded || 0);
          });
          const p = fighter.rb.translation();
          const v = fighter.rb.linvel();
          const a = fighter.rb.angvel();
          const traction = sim.physics.tractionForFighter(fighter);
          const upY = fighterUpVector(fighter).y;
          const minY = fighterColliderWorldMinY(fighter);
          const angularSpeed = Math.hypot(a.x, a.y, a.z);
          const horizontalSpeed = Math.hypot(v.x, v.z);
          const recoveredStable = fighter.spec?.canDriveInverted ? Math.abs(upY) > 0.985 : upY > 0.985;
          const nearFloor = Math.abs(minY - HEADLESS_FLOOR_Y) < 0.12;
          const stableInverted = Boolean(fighter.spec?.canDriveInverted && upY < -0.985);
          const groundedStable =
            (((traction.grounded || 0) > 0.16 || (traction.solidGrounded || 0) > 0.16) && (traction.solidGrounded || 0) > 0.14) ||
            (recoveredStable && nearFloor && (traction.grounded || 0) > 0.16) ||
            (stableInverted && nearFloor && (traction.grounded || 0) > 0.16);
          const notHovering = nearFloor && (stableInverted || p.y < fighter.restingBodyY + 0.45);
          const stoppedTumbling = angularSpeed < 0.75;
          // Falling flat from 82 degrees moves a machine by a chunk of its own
          // width, so the drift allowance scales with the bot rather than being
          // one number that only suits a 3ft one.
          const footprint = fighter.frame?.tractionBounds
            ? Math.hypot(
              fighter.frame.tractionBounds.max.x - fighter.frame.tractionBounds.min.x,
              fighter.frame.tractionBounds.max.z - fighter.frame.tractionBounds.min.z,
            ) * 0.5
            : 1.8;
          const driftAllowed = Math.max(3.5, footprint * 1.2);
          const drift = Math.hypot(p.x - startX, p.z - startZ);
          const notSkiddingAway = drift < driftAllowed && horizontalSpeed < 0.8;
          const hugeIntentionalTeeter = bot.id === "huge" && (teeterCase.name === "high-side" || teeterCase.name === "high-corner");
          const stableHugeTeeter =
            hugeIntentionalTeeter &&
            nearFloor &&
            stoppedTumbling &&
            notSkiddingAway;
          const acceptable = stableHugeTeeter || (recoveredStable && groundedStable && notHovering && stoppedTumbling && notSkiddingAway);
          results.push({
            bot: bot.id,
            name: `${bot.id}/${teeterCase.name}/${start.name}`,
            case: teeterCase.name,
            start: start.name,
            acceptable,
            stableHugeTeeter,
            recoveredStable,
            groundedStable,
            notHovering,
            stoppedTumbling,
            notSkiddingAway,
            drift,
            driftAllowed,
            upY,
            grounded: traction.grounded || 0,
            solidGrounded: traction.solidGrounded || 0,
            minGrounded,
            minY,
            bodyY: p.y,
            restingBodyY: fighter.restingBodyY,
            maxHeight,
            angularSpeed,
            horizontalSpeed,
          });
        }
      }
    });
  }

  const failedDetails = results
    .filter((result) => !result.acceptable);
  const failed = failedDetails.map((result) => result.name);
  return {
    allRecovered: failed.length === 0,
    failed,
    failureCount: failed.length,
    totalCases: results.length,
    failedDetails,
    results,
  };
}

async function broncoPitchSettleProbe() {
  return withSim({ playerId: "bronco", rivalId: "biteforce" }, (sim) => {
    const bronco = sim.fighters[0];
    setPhysicsCornerTeeterPose(sim, bronco, {
      pitchDeg: 26.55,
      yawDeg: -1.05,
      rollDeg: 3.99,
      heightOffset: 0,
      linvel: { x: 0, y: 0, z: 0 },
      angvel: { x: 0, y: 0, z: 0 },
    });
    sim.setInput(0, {});
    sim.setInput(1, {});
    sim.stepFrames(520);
    const rotation = bronco.rb.rotation();
    const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w), "YXZ");
    const traction = sim.physics.tractionForFighter(bronco);
    const minY = fighterColliderWorldMinY(bronco);
    return {
      settledFlat: Math.abs(euler.x) < 0.025 && Math.abs(euler.z) < 0.018,
      frontSupported: (traction.front || 0) > 0.72,
      solidlyGrounded: (traction.solidGrounded || 0) > 0.72,
      bodySolidlyGrounded: (traction.bodySolidGrounded || 0) > 0.72,
      nearFloor: Math.abs(minY - HEADLESS_FLOOR_Y) < 0.02,
      pitch: euler.x,
      roll: euler.z,
      upY: fighterUpVector(bronco).y,
      front: traction.front || 0,
      back: traction.back || 0,
      left: traction.left || 0,
      right: traction.right || 0,
      solidGrounded: traction.solidGrounded || 0,
      bodySolidGrounded: traction.bodySolidGrounded || 0,
      minY,
    };
  });
}

async function broncoWeaponColliderIsolationProbe() {
  return withSim({ playerId: "bronco", rivalId: "biteforce" }, (sim) => {
    const bronco = sim.fighters[0];
    const parts = bronco.physics?.parts || [];
    const weaponParts = parts.filter((part) => part.part === "weapon");
    const bindings = bronco.rb.userData?.physicsColliderBindings || [];
    const weaponBindings = bindings.filter((binding) => binding.part?.part === "weapon");
    const frameMinY = bronco.frame?.colliderMinY ?? bronco.colliderMinY;
    const bodyMinY = parts
      .filter((part) => part.part !== "driveContact" && part.part !== "weapon" && !part.ignoreGroundContact)
      .reduce((min, part) => {
        const y = (part.position?.[1] || 0) - Math.abs(part.halfExtents?.[1] || 0);
        return Math.min(min, y);
      }, Infinity);
    const weaponMinY = weaponParts.reduce((min, part) => {
      const y = (part.position?.[1] || 0) - Math.abs(part.halfExtents?.[1] || 0);
      return Math.min(min, y);
    }, Infinity);
    return {
      weaponCollidersExist: weaponParts.length > 0 && weaponBindings.length === weaponParts.length,
      weaponGroundIgnored: weaponParts.every((part) => part.ignoreGroundContact && part.ignoreLocalBottomFloorContact),
      weaponCollidersAreSensors: weaponBindings.every((binding) => binding.collider?.isSensor?.() === true),
      restHeightIgnoresWeapon: Number.isFinite(frameMinY) && Math.abs(frameMinY - bodyMinY) < 0.0001,
      weaponPartCount: weaponParts.length,
      weaponBindingCount: weaponBindings.length,
      frameMinY,
      bodyMinY,
      weaponMinY,
    };
  });
}

async function wedgeSideBackAssistProbe() {
  async function runCase(name, targetYaw) {
    return withSim({ playerId: "bronco", rivalId: "biteforce" }, (sim) => {
      const attacker = sim.fighters[0];
      const target = sim.fighters[1];
      sim.setPose(attacker, { x: 0, y: attacker.restingBodyY, z: 2.0 }, 0);
      sim.setPose(target, { x: 0, y: target.restingBodyY, z: -0.15 }, targetYaw);
      sim.stepFrames(20);
      let maxPenalty = 0;
      let maxSideBackExposure = 0;
      let maxQuality = 0;
      let maxLift = 0;
      sim.setInput(0, { leftDrive: 1, rightDrive: 1 });
      sim.setInput(1, {});
      sim.stepFrames(180, () => {
        const position = target.rb.translation();
        const assist = target.physics?.lastWedgeAssist || {};
        maxPenalty = Math.max(maxPenalty, target.physics?.wedgeTractionPenalty || 0);
        maxSideBackExposure = Math.max(maxSideBackExposure, assist.sideBackExposure || 0);
        maxQuality = Math.max(maxQuality, assist.quality || 0);
        maxLift = Math.max(maxLift, position.y - target.restingBodyY);
      });
      return { name, maxPenalty, maxSideBackExposure, maxQuality, maxLift };
    });
  }
  const front = await runCase("front", Math.PI);
  const side = await runCase("side", Math.PI / 2);
  const back = await runCase("back", 0);
  return {
    front,
    side,
    back,
    sideDetected: side.maxSideBackExposure > 0.8,
    backDetected: back.maxSideBackExposure > 0.8,
    frontNotBoosted: front.maxSideBackExposure < 0.1,
    sideStrongerThanFront: side.maxPenalty > front.maxPenalty + 0.14,
    backStrongerThanFront: back.maxPenalty > front.maxPenalty + 0.14,
  };
}

async function fallingProbe() {
  return withSim({ playerId: "biteforce", rivalId: "minotaur" }, (sim) => {
    const fighter = sim.fighters[0];
    sim.setPose(fighter, { x: 0, y: fighter.restingBodyY + 3.5, z: 0 }, 0);
    sim.setInput(0, { leftDrive: 1, rightDrive: 1 });
    let maxAirborneHorizontalSpeed = 0;
    let touchedGround = false;
    let settled = false;
    sim.stepFrames(260, () => {
      const v = fighter.rb.linvel();
      const traction = sim.physics.tractionForFighter(fighter);
      if ((traction.grounded || 0) < 0.05) maxAirborneHorizontalSpeed = Math.max(maxAirborneHorizontalSpeed, Math.hypot(v.x, v.z));
      touchedGround ||= (traction.grounded || 0) > 0.2;
      settled ||= touchedGround && fighterUpVector(fighter).y > 0.88 && (traction.solidGrounded || 0) > 0.2 && Math.abs(v.y) < 0.35;
    });
    const p = fighter.rb.translation();
    const v = fighter.rb.linvel();
    const traction = sim.physics.tractionForFighter(fighter);
    return {
      fellUnderGravity: touchedGround,
      noAirborneDrive: maxAirborneHorizontalSpeed < 0.35,
      settledStable: settled && fighterUpVector(fighter).y > 0.82 && (traction.grounded || 0) > 0.25,
      finalBodyY: p.y,
      finalVerticalSpeed: v.y,
      maxAirborneHorizontalSpeed,
      grounded: traction.grounded || 0,
      solidGrounded: traction.solidGrounded || 0,
      upY: fighterUpVector(fighter).y,
    };
  });
}

async function spinnerSideHitProbe(attackerId, {
  targetId = "quantum",
  targetX = 0,
  targetYaw = Math.PI / 2,
  targetZ = -1.1,
  frames = 150,
  speedRatio = 1,
} = {}) {
  return withSim({ playerId: attackerId, rivalId: targetId }, (sim) => {
    const attacker = sim.fighters[0];
    const target = sim.fighters[1];
    sim.setPose(attacker, { x: 0, y: attacker.restingBodyY, z: 0.75 }, 0);
    sim.setPose(target, { x: 0, y: target.restingBodyY, z: -4.0 }, Math.PI);
    const fullSpeed = attacker.weapon.visualSpeed || attacker.weapon.activeSpeed || attacker.weapon.speed || 300;
    attacker.weapon.currentSpeed = fullSpeed * speedRatio;
    attacker.weapon.hitCooldowns?.clear?.();
    sim.physics.markHit(attacker, 4);
    sim.physics.markHit(target, 4);
    sim.stepFrames(6);
    sim.setPose(attacker, { x: 0, y: attacker.restingBodyY, z: 0.75 }, 0);
    sim.setPose(target, { x: targetX, y: target.restingBodyY, z: targetZ }, targetYaw);
    attacker.weapon.currentSpeed = fullSpeed * speedRatio;
    attacker.weapon.hitCooldowns?.clear?.();
    const start = sim.snapshot(`${attackerId}-side-spinner-hit-start`);
    const startPos = start.fighters[1].position;
    let maxTargetHorizontalSpeed = 0;
    let maxDistanceFromStart = 0;
    let maxDistanceFromAttacker = 0;
    let maxLift = 0;
    sim.setInput(0, { weapon: true });
    sim.setInput(1, {});
    sim.stepFrames(frames, (frame) => {
      if (frame === 18) sim.setInput(0, {});
      const attackerPos = attacker.rb.translation();
      const targetPos = target.rb.translation();
      const targetVel = target.rb.linvel();
      maxTargetHorizontalSpeed = Math.max(maxTargetHorizontalSpeed, Math.hypot(targetVel.x, targetVel.z));
      maxDistanceFromStart = Math.max(maxDistanceFromStart, Math.hypot(targetPos.x - startPos.x, targetPos.z - startPos.z));
      maxDistanceFromAttacker = Math.max(maxDistanceFromAttacker, Math.hypot(targetPos.x - attackerPos.x, targetPos.z - attackerPos.z));
      maxLift = Math.max(maxLift, targetPos.y - target.restingBodyY);
    });
    const end = sim.snapshot(`${attackerId}-side-spinner-hit-end`);
    return {
      attackerId,
      targetId,
      targetX,
      targetYaw,
      targetZ,
      targetStayedInSim: Number.isFinite(end.fighters[1].position.x) && Number.isFinite(end.fighters[1].position.z),
      maxDistanceFromStart,
      maxDistanceFromAttacker,
      maxTargetHorizontalSpeed,
      maxLift,
      start,
      end,
    };
  });
}

async function soloEscapeBoostProbe() {
  return withSim({ playerId: "biteforce", rivalId: "minotaur" }, (sim) => {
    const fighter = sim.fighters[0];
    const rival = sim.fighters[1];
    const side = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    sim.setPose(rival, { x: 8, y: rival.restingBodyY, z: 8 }, Math.PI);
    sim.setRotation(fighter, side, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    fighter.rb.setTranslation({ x: 0, y: fighter.restingBodyY + 0.2, z: 0 }, true);
    sim.setInput(0, { leftDrive: 1, rightDrive: 1 });
    sim.setInput(1, {});
    sim.stepFrames(230);
    const before = fighter.rb.linvel();
    const eligibleBeforeBoost = fighter.physics?.escapeEligible === true;
    sim.setInput(0, { leftDrive: 1, rightDrive: 1, boostActive: true });
    sim.stepFrames(4);
    const after = fighter.rb.linvel();
    return {
      becameEligible: eligibleBeforeBoost,
      boostedUpward: after.y > Math.max(before.y + 2.5, 2.0),
      boostedStraightUp: Math.hypot(after.x, after.z) < 0.35,
      recordedSoloBoost: fighter.physics?.lastEscapeBoost?.kind === "solo",
      beforeY: before.y,
      afterY: after.y,
      horizontalSpeed: Math.hypot(after.x, after.z),
      escapeStuckFor: fighter.physics?.escapeStuckFor || 0,
      lastEscapeBoost: fighter.physics?.lastEscapeBoost || null,
    };
  });
}

async function pairEscapeBoostProbe() {
  return withSim({ playerId: "biteforce", rivalId: "minotaur" }, (sim) => {
    const a = sim.fighters[0];
    const b = sim.fighters[1];
    sim.setPose(a, { x: 0, y: a.restingBodyY, z: 0 }, 0);
    sim.setPose(b, { x: 0, y: b.restingBodyY, z: 0.55 }, Math.PI);
    sim.stepFrames(10);
    sim.setInput(0, { leftDrive: 1, rightDrive: 1 });
    sim.setInput(1, { leftDrive: 1, rightDrive: 1 });
    sim.stepFrames(190);
    const pa = a.rb.translation();
    const pb = b.rb.translation();
    const beforeDistance = Math.hypot(pb.x - pa.x, pb.z - pa.z);
    const eligibleBeforeBoost = a.physics?.interlockEligible === true && b.physics?.interlockEligible === true;
    sim.setInput(0, { leftDrive: 1, rightDrive: 1, boostActive: true });
    sim.setInput(1, { leftDrive: 1, rightDrive: 1, boostActive: true });
    sim.stepFrames(4);
    const na = a.rb.translation();
    const nb = b.rb.translation();
    const va = a.rb.linvel();
    const vb = b.rb.linvel();
    const afterDistance = Math.hypot(nb.x - na.x, nb.z - na.z);
    return {
      becameEligible: eligibleBeforeBoost,
      separated: afterDistance > beforeDistance + 0.45,
      bothBoostedUpward: va.y > 1.5 && vb.y > 1.5,
      recordedPairBoost: a.physics?.lastEscapeBoost?.kind === "pair" && b.physics?.lastEscapeBoost?.kind === "pair",
      beforeDistance,
      afterDistance,
      aY: va.y,
      bY: vb.y,
      aBoost: a.physics?.lastEscapeBoost || null,
      bBoost: b.physics?.lastEscapeBoost || null,
      interlockFor: a.physics?.interlockFor || 0,
    };
  });
}

async function spinnerSideHitLadderProbe() {
  const cases = [
    { id: "huge", minDistance: 4.0, minSpeed: 10, minLift: 0.7, targetYaw: Math.PI / 2 },
    { id: "hypershock", minDistance: 4.0, minSpeed: 5, minLift: 0.25, targetYaw: Math.PI / 2 },
    { id: "biteforce", minDistance: 4.0, minSpeed: 5, minLift: 0.25, targetYaw: Math.PI / 2 },
    { id: "minotaur", minDistance: 0.75, minSpeed: 5, minLift: 0.25, targetYaw: Math.PI / 2, targetZ: -1.35 },
    // Tombstone's minimums are lower than they were, and the machine is not:
    // it still throws its victim at the 60ft/s velocity ceiling, three times
    // what anything else on this ladder manages (see impulseOrder below). The
    // ported model is bigger and its bar reaches from a pivot a foot further
    // forward, so the same hit lands flatter and the victim lands sooner.
    { id: "tombstone", minDistance: 7.5, minSeparation: 8.5, minSpeed: 45, minLift: 0.5, targetYaw: Math.PI / 2 },
  ];
  const results = {};
  for (const item of cases) {
    results[item.id] = await spinnerSideHitProbe(item.id, {
      targetYaw: item.targetYaw,
      targetZ: item.targetZ ?? -1.1,
    });
  }
  results.hugeHalfSpeed = await spinnerSideHitProbe("huge", { speedRatio: 0.5 });
  const minimumFailures = cases
    .filter((item) => {
      const result = results[item.id];
      return !result.targetStayedInSim ||
        result.maxDistanceFromStart < item.minDistance ||
        (Number.isFinite(item.minSeparation) && result.maxDistanceFromAttacker < item.minSeparation) ||
        result.maxTargetHorizontalSpeed < item.minSpeed ||
        result.maxLift < item.minLift;
    })
    .map((item) => item.id);
  const midTierSpinnerSpeed = Math.max(
    results.hypershock.maxTargetHorizontalSpeed,
    results.biteforce.maxTargetHorizontalSpeed,
    results.minotaur.maxTargetHorizontalSpeed,
  );
  const hypershockBiteforceSpeed = Math.max(
    results.hypershock.maxTargetHorizontalSpeed,
    results.biteforce.maxTargetHorizontalSpeed,
  );
  const impulseOrder = [
    Math.min(results.hypershock.maxTargetHorizontalSpeed, results.biteforce.maxTargetHorizontalSpeed, results.minotaur.maxTargetHorizontalSpeed),
    midTierSpinnerSpeed,
    results.huge.maxTargetHorizontalSpeed,
    results.tombstone.maxTargetHorizontalSpeed,
  ];
  const hugeFullExceedsMidTier = results.huge.maxTargetHorizontalSpeed >= midTierSpinnerSpeed * 1.15;
  const hugeHalfMatchesOldFullPower = results.hugeHalfSpeed.maxTargetHorizontalSpeed >= 6.5 && results.hugeHalfSpeed.maxLift >= 0.25;
  const minotaurMatchesMidTier = results.minotaur.maxTargetHorizontalSpeed <= hypershockBiteforceSpeed * 1.15;
  const orderedImpulse =
    impulseOrder[0] < impulseOrder[1] &&
    impulseOrder[1] < impulseOrder[2] &&
    impulseOrder[2] < impulseOrder[3];
  return {
    allMetMinimums: minimumFailures.length === 0,
    minimumFailures,
    orderedImpulse,
    hugeFullExceedsMidTier,
    hugeHalfMatchesOldFullPower,
    minotaurMatchesMidTier,
    impulseOrder,
    results,
    thresholds: cases,
  };
}

async function broncoTombstoneFlipperContactProbe() {
  async function runCase({ x, z }) {
    return withSim({ playerId: "bronco", rivalId: "tombstone" }, (sim) => {
      const bronco = sim.fighters[0];
      const tombstone = sim.fighters[1];
      sim.setPose(bronco, { x: 0, y: bronco.restingBodyY, z: 0.25 }, 0);
      sim.setPose(tombstone, { x, y: tombstone.restingBodyY + 0.08, z }, Math.PI);
      sim.stepFrames(2);
      const events = [];
      const damages = [];
      sim.physics.applyWeaponImpacts({
        arena: sim,
        attacker: bronco,
        active: true,
        dt: sim.dt,
        callbacks: {
          recordWeaponEvent: (event) => events.push(event),
          recordDamage: (damage) => damages.push({
            fighter: damage.fighter?.spec?.id || null,
            kind: damage.kind,
            amount: damage.amount,
          }),
        },
      });
      const beforeY = tombstone.rb.translation().y;
      let maxLift = 0;
      sim.stepFrames(55, () => {
        maxLift = Math.max(maxLift, tombstone.rb.translation().y - beforeY);
      });
      return { events, damages, maxLift };
    });
  }
  const weaponOnly = await runCase({ x: -0.9, z: -1.85 });
  const bodyHit = await runCase({ x: 0, z: -1.25 });
  return {
    weaponOnlyDamagesBronco: weaponOnly.events.some((event) => event.kind === "flipperWeaponHit") &&
      weaponOnly.damages.some((damage) => damage.fighter === "bronco" && damage.kind === "flipperWeaponHit") &&
      !weaponOnly.damages.some((damage) => damage.fighter === "tombstone" && damage.kind === "flipper"),
    weaponOnlyDoesNotLaunchTombstone: weaponOnly.maxLift < 0.55,
    bodyStillFlips: bodyHit.events.some((event) => event.kind === "flipperHit") &&
      bodyHit.damages.some((damage) => damage.fighter === "tombstone" && damage.kind === "flipper") &&
      bodyHit.maxLift > 0.55,
    weaponOnly,
    bodyHit,
  };
}

async function quantumCrusherTargetPointProbe() {
  return withSim({ playerId: "quantum", rivalId: "bronco" }, (sim) => {
    const quantum = sim.fighters[0];
    const bronco = sim.fighters[1];
    sim.setPose(quantum, { x: 0, y: quantum.restingBodyY, z: 0.4 }, 0);
    sim.setPose(bronco, { x: 0, y: bronco.restingBodyY, z: -1.0 }, Math.PI);
    sim.stepFrames(2);
    const bites = [];
    sim.physics.applyWeaponImpacts({
      arena: sim,
      attacker: quantum,
      active: true,
      dt: sim.dt,
      callbacks: {
        recordQuantumBiteDamage: (attacker, target, point, normal, dt) => {
          bites.push({
            point,
            normal,
            dt,
            targetPosition: target.rb.translation(),
            attackerPosition: attacker.rb.translation(),
          });
        },
      },
    });
    const bite = bites[0] || null;
    const targetDistance = bite ? Math.hypot(
      bite.point.x - bite.targetPosition.x,
      bite.point.z - bite.targetPosition.z,
    ) : Infinity;
    const attackerDistance = bite ? Math.hypot(
      bite.point.x - bite.attackerPosition.x,
      bite.point.z - bite.attackerPosition.z,
    ) : Infinity;
    return {
      recordedBite: bites.length > 0,
      pointIsOnTargetSide: targetDistance < attackerDistance * 0.35,
      targetDistance,
      attackerDistance,
      bite,
    };
  });
}

async function plowDefenceProbe() {
  async function runCase(attackerId, targetId, { targetX = 0, targetYaw = Math.PI, targetZ = -1.1, frames = 36, plowDefenceEnabled = true } = {}) {
    return withSim({ playerId: attackerId, rivalId: targetId }, (sim) => {
      sim.physics.setOptions({ plowDefenceEnabled });
      const attacker = sim.fighters[0];
      const target = sim.fighters[1];
      sim.setPose(attacker, { x: 0, y: attacker.restingBodyY, z: 0.75 }, 0);
      sim.setPose(target, { x: targetX, y: target.restingBodyY, z: targetZ }, targetYaw);
      const fullSpeed = attacker.weapon.visualSpeed || attacker.weapon.activeSpeed || attacker.weapon.speed || 300;
      attacker.weapon.currentSpeed = fullSpeed;
      attacker.weapon.hitCooldowns?.clear?.();
      if (target.physics) {
        target.physics.lastPlowDefence = null;
        target.physics.lastAppliedPlowDefence = null;
      }
      let maxTargetHorizontalSpeed = 0;
      let maxLift = 0;
      let maxAngularSpeed = 0;
      let maxAttackerHorizontalSpeed = 0;
      sim.setInput(0, { weapon: true });
      sim.setInput(1, {});
      sim.stepFrames(frames, (frame) => {
        if (frame === 18) sim.setInput(0, {});
        const attackerVelocity = attacker.rb.linvel();
        const velocity = target.rb.linvel();
        const angular = target.rb.angvel();
        const position = target.rb.translation();
        maxAttackerHorizontalSpeed = Math.max(maxAttackerHorizontalSpeed, Math.hypot(attackerVelocity.x, attackerVelocity.z));
        maxTargetHorizontalSpeed = Math.max(maxTargetHorizontalSpeed, Math.hypot(velocity.x, velocity.z));
        maxLift = Math.max(maxLift, position.y - target.restingBodyY);
        maxAngularSpeed = Math.max(maxAngularSpeed, Math.hypot(angular.x, angular.y, angular.z));
      });
      return {
        plow: target.physics?.lastAppliedPlowDefence || target.physics?.lastPlowDefence || null,
        maxAttackerHorizontalSpeed,
        maxTargetHorizontalSpeed,
        maxLift,
        maxAngularSpeed,
      };
    });
  }

  // The horizontal cases stand off 1.5ft rather than 1.1: Tombstone's bar now
  // reaches from a pivot a foot ahead of its chassis (v1's own bar was authored
  // as a stub near the body), so at the old spacing the contact lands past the
  // plow and inside the bodywork, which is not the thing under test.
  const horizontalOnHighWedge = await runCase("tombstone", "bronco", { targetZ: -1.5 });
  const horizontalWithPlowDisabled = await runCase("tombstone", "bronco", { targetZ: -1.5, plowDefenceEnabled: false });
  const horizontalOnBody = await runCase("tombstone", "bronco", { targetYaw: 0, targetZ: -1.5 });
  const verticalOnLowWedge = await runCase("biteforce", "biteforce", { targetX: -0.6, targetZ: -1.0 });
  const verticalOnBody = await runCase("biteforce", "biteforce", { targetX: 0, targetZ: -1.0 });
  return {
    horizontalWedgeApplied: horizontalOnHighWedge.plow?.applied === true &&
      horizontalOnHighWedge.plow.liftFactor < 0.24 &&
      horizontalOnHighWedge.plow.torqueFactor < 0.2 &&
      horizontalOnHighWedge.plow.attackerReflectionBoost > 1.35,
    bodyUnaffected: horizontalOnBody.plow?.applied !== true,
    disabledUnaffected: horizontalWithPlowDisabled.plow?.applied !== true &&
      horizontalWithPlowDisabled.plow?.liftFactor === 1 &&
      horizontalWithPlowDisabled.plow?.torqueFactor === 1,
    verticalWedgeApplied: verticalOnLowWedge.plow?.applied === true &&
      verticalOnLowWedge.plow.pushFactor === 1 &&
      verticalOnLowWedge.plow.liftFactor < 0.5 &&
      verticalOnLowWedge.plow.torqueFactor < 0.45,
    verticalPushPreserved: verticalOnLowWedge.maxTargetHorizontalSpeed >= verticalOnBody.maxTargetHorizontalSpeed * 0.82,
    verticalLiftReduced: verticalOnLowWedge.maxLift < verticalOnBody.maxLift * 0.72,
    horizontalOnHighWedge,
    horizontalWithPlowDisabled,
    horizontalOnBody,
    verticalOnLowWedge,
    verticalOnBody,
  };
}

async function spinnerWallReflectionProbe() {
  return withSim({ playerId: "tombstone", rivalId: "quantum" }, (sim) => {
    const attacker = sim.fighters[0];
    const rival = sim.fighters[1];
    // Park the bot with its NOSE just short of the wall rather than at a fixed
    // z: Tombstone's bar overhangs 1.5ft, so a hardcoded stand-off spawns the
    // machine inside the wall, where the solver holds it still and no recoil
    // can be measured.
    const nose = Math.abs(attacker.frame?.tractionBounds?.min?.z ?? 1);
    sim.setPose(attacker, { x: 0, y: attacker.restingBodyY + 0.62, z: -(ARENA_HALF_LENGTH - nose - 0.05) }, 0);
    sim.setPose(rival, { x: 0, y: rival.restingBodyY, z: 20 }, Math.PI);
    attacker.weapon.currentSpeed = attacker.weapon.visualSpeed || attacker.weapon.activeSpeed || attacker.weapon.speed || 300;
    attacker.weapon.hitCooldowns?.clear?.();
    const speedBefore = Math.abs(attacker.weapon.currentSpeed);
    let maxInwardSpeed = 0;
    let maxDownwardSpeed = 0;
    let maxReverseYaw = 0;
    sim.setInput(0, { weapon: true });
    sim.setInput(1, {});
    sim.stepFrames(24, () => {
      const velocity = attacker.rb.linvel();
      const angular = attacker.rb.angvel();
      maxInwardSpeed = Math.max(maxInwardSpeed, velocity.z);
      maxDownwardSpeed = Math.max(maxDownwardSpeed, -velocity.y);
      maxReverseYaw = Math.max(maxReverseYaw, -angular.y);
    });
    const speedAfter = Math.abs(attacker.weapon.currentSpeed);
    return {
      recoiledInward: maxInwardSpeed > 1.5,
      reflectedDownward: maxDownwardSpeed > 1.0,
      reversedYaw: maxReverseYaw > 0.02,
      drainedSpinner: speedAfter < speedBefore * 0.78,
      maxInwardSpeed,
      maxDownwardSpeed,
      maxReverseYaw,
      speedBefore,
      speedAfter,
      end: sim.snapshot("tombstone-spinner-wall-reflection-end"),
    };
  });
}

async function tombstoneLongReachProbe() {
  const result = await spinnerSideHitProbe("tombstone", { targetZ: -2.0, frames: 90 });
  return {
    ...result,
    longReachHit: result.maxTargetHorizontalSpeed > 16 && result.maxDistanceFromStart > 5,
  };
}

async function tombstoneSpinDirectionProbe() {
  async function runCase(speedSign) {
    return withSim({ playerId: "tombstone", rivalId: "quantum" }, (sim) => {
      const attacker = sim.fighters[0];
      const target = sim.fighters[1];
      sim.setPose(attacker, { x: 0, y: attacker.restingBodyY, z: 0.75 }, 0);
      sim.setPose(target, { x: 1.15, y: target.restingBodyY, z: -1.35 }, 0);
      const fullSpeed = Math.abs(attacker.weapon.visualSpeed || attacker.weapon.activeSpeed || attacker.weapon.speed || 300);
      attacker.weapon.currentSpeed = fullSpeed * speedSign;
      attacker.weapon.hitCooldowns?.clear?.();
      const events = [];
      sim.physics.applyWeaponImpacts({
        arena: sim,
        attacker,
        active: true,
        dt: sim.dt,
        callbacks: {
          recordWeaponEvent: (event) => events.push(event),
        },
      });
      const targetVelocity = target.rb.linvel();
      const attackerVelocity = attacker.rb.linvel();
      return {
        event: events[0] || null,
        targetVelocity: { x: targetVelocity.x, z: targetVelocity.z },
        attackerVelocity: { x: attackerVelocity.x, z: attackerVelocity.z },
      };
    });
  }
  const positive = await runCase(1);
  const negative = await runCase(-1);
  const positiveDirection = positive.event?.hitDirection || { x: 0, z: 0 };
  const negativeDirection = negative.event?.hitDirection || { x: 0, z: 0 };
  const directionDot = positiveDirection.x * negativeDirection.x + positiveDirection.z * negativeDirection.z;
  const targetVelocityDot = positive.targetVelocity.x * negative.targetVelocity.x + positive.targetVelocity.z * negative.targetVelocity.z;
  const attackerRecoilOpposesHit = negative.attackerVelocity.x * negativeDirection.x + negative.attackerVelocity.z * negativeDirection.z < -1;
  return {
    positiveSpinRecorded: positive.event?.spinDirection === 1,
    negativeSpinRecorded: negative.event?.spinDirection === -1,
    directionFlipped: directionDot < -0.75,
    targetVelocityFlipped: targetVelocityDot < -1200,
    attackerRecoilOpposesHit,
    positive,
    negative,
    directionDot,
    targetVelocityDot,
  };
}

async function uprightSpinnerFloorClearanceProbe() {
  const results = {};
  for (const id of ["biteforce", "hypershock", "minotaur", "tombstone"]) {
    results[id] = await withSim({ playerId: id, rivalId: "bronco" }, (sim) => {
      const fighter = sim.fighters[0];
      const rival = sim.fighters[1];
      sim.setPose(fighter, { x: 0, y: fighter.restingBodyY, z: 0 }, 0);
      sim.setPose(rival, { x: 8, y: rival.restingBodyY, z: 8 }, Math.PI);
      sim.stepFrames(8);
      const fullSpeed = fighter.weapon.visualSpeed || fighter.weapon.activeSpeed || fighter.weapon.speed || 300;
      fighter.weapon.currentSpeed = fullSpeed;
      fighter.weapon.hitCooldowns?.clear?.();
      sim.setInput(0, { weapon: true });
      sim.stepFrames(20);
      const floorHitAt = fighter.weapon.hitCooldowns?.get("__spinner_floor__") || 0;
      const speedRatio = Math.abs(fighter.weapon.currentSpeed || 0) / Math.max(1, Math.abs(fullSpeed));
      const traction = sim.physics.tractionForFighter(fighter);
      return {
        suppressedFloorHit: floorHitAt === 0,
        retainedSpinnerSpeed: speedRatio > 0.92,
        upright: fighterUpVector(fighter).y > 0.58,
        floorHitAt,
        speedRatio,
        solidGrounded: traction.solidGrounded || 0,
        grounded: traction.grounded || 0,
      };
    });
  }
  const failed = Object.entries(results)
    .filter(([, result]) => !result.suppressedFloorHit || !result.retainedSpinnerSpeed || !result.upright)
    .map(([id]) => id);
  return {
    allSuppressed: failed.length === 0,
    failed,
    results,
  };
}

async function spinnerFloorStrikeProbe() {
  return withSim({ playerId: "biteforce", rivalId: "bronco" }, (sim) => {
    const fighter = sim.fighters[0];
    const rival = sim.fighters[1];
    sim.setPose(rival, { x: 8, y: rival.restingBodyY, z: 8 }, Math.PI);
    const tilted = new THREE.Quaternion().setFromEuler(new THREE.Euler(1.15, 0, 0));
    fighter.rb.setTranslation({ x: 0, y: fighter.restingBodyY - 0.45, z: 0 }, true);
    sim.setRotation(fighter, tilted, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    fighter.stableDrive = { active: false };
    const fullSpeed = fighter.weapon.visualSpeed || fighter.weapon.activeSpeed || fighter.weapon.speed || 300;
    fighter.weapon.currentSpeed = fullSpeed;
    fighter.weapon.hitCooldowns?.clear?.();
    sim.setInput(0, { weapon: true });
    sim.stepFrames(20);
    const floorHitAt = fighter.weapon.hitCooldowns?.get("__spinner_floor__") || 0;
    const speedRatio = Math.abs(fighter.weapon.currentSpeed || 0) / Math.max(1, Math.abs(fullSpeed));
    return {
      struckFloor: floorHitAt > 0,
      drainedSpinnerSpeed: speedRatio < 0.92,
      floorHitAt,
      speedRatio,
    };
  });
}

async function tombstoneSpinnerFloorLaunchProbe() {
  return withSim({ playerId: "tombstone", rivalId: "quantum" }, (sim) => {
    const fighter = sim.fighters[0];
    const rival = sim.fighters[1];
    sim.setPose(rival, { x: 8, y: rival.restingBodyY, z: 8 }, Math.PI);
    // Nose DOWN onto the bar, which is the attitude a bar spinner launches
    // itself from, and buried by measurement rather than by a fixed drop: what
    // has to be in the floor is the WEAPON, and on a machine whose bodywork
    // hangs lower than its blade a stack-wide drop never gets the blade there.
    const tilted = new THREE.Quaternion().setFromEuler(new THREE.Euler(-55 * Math.PI / 180, 0, 0));
    fighter.rb.setTranslation({ x: 0, y: fighter.restingBodyY, z: 0 }, true);
    sim.setRotation(fighter, tilted, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    const weaponMinY = fighterColliderWorldMinY(fighter, (part) => part.part === "weapon");
    // 0.2ft in, which is past the 0.155 the floor-strike bite saturates at, so
    // the launch is measured at full bite instead of at whatever fraction a
    // given blade's geometry happens to reach.
    const bury = weaponMinY - (HEADLESS_FLOOR_Y - 0.2);
    fighter.rb.setTranslation({ x: 0, y: fighter.restingBodyY - bury, z: 0 }, true);
    sim.syncWeaponObjects?.();
    fighter.stableDrive = { active: false };
    const fullSpeed = fighter.weapon.visualSpeed || fighter.weapon.activeSpeed || fighter.weapon.speed || 300;
    fighter.weapon.currentSpeed = fullSpeed;
    fighter.weapon.hitCooldowns?.clear?.();
    const events = [];
    sim.physics.applyWeaponImpacts({
      arena: sim,
      attacker: fighter,
      active: true,
      dt: sim.dt,
      callbacks: {
        recordWeaponEvent: (event) => events.push(event),
      },
    });
    const launchVelocity = fighter.rb.linvel().y;
    const speedRatio = Math.abs(fighter.weapon.currentSpeed || 0) / Math.max(1, Math.abs(fullSpeed));
    return {
      launchedFromFloor: launchVelocity > 2.5,
      drainedSpinnerSpeed: speedRatio < 0.25,
      eventWasFloorLaunch: events.some((event) => event.kind === "spinnerFloorLaunch"),
      launchVelocity,
      speedRatio,
      events,
      upY: fighterUpVector(fighter).y,
    };
  });
}

async function spinnerInvertedFloorStrikeProbe() {
  return withSim({ playerId: "hypershock", rivalId: "bronco" }, (sim) => {
    const fighter = sim.fighters[0];
    const rival = sim.fighters[1];
    sim.setPose(rival, { x: 8, y: rival.restingBodyY, z: 8 }, Math.PI);
    const inverted = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));
    fighter.rb.setTranslation({ x: 0, y: fighter.restingBodyY + 0.05, z: 0 }, true);
    sim.setRotation(fighter, inverted, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
    fighter.stableDrive = { active: false };
    const fullSpeed = fighter.weapon.visualSpeed || fighter.weapon.activeSpeed || fighter.weapon.speed || 300;
    fighter.weapon.currentSpeed = fullSpeed;
    fighter.weapon.hitCooldowns?.clear?.();
    sim.setInput(0, { weapon: true });
    sim.stepFrames(30);
    const floorHitAt = fighter.weapon.hitCooldowns?.get("__spinner_floor__") || 0;
    const speedRatio = Math.abs(fighter.weapon.currentSpeed || 0) / Math.max(1, Math.abs(fullSpeed));
    return {
      struckFloor: floorHitAt > 0,
      drainedSpinnerSpeed: speedRatio < 0.92,
      floorHitAt,
      speedRatio,
      upY: fighterUpVector(fighter).y,
    };
  });
}

async function ceilingReleaseProbe() {
  return withSim({ playerId: "tombstone", rivalId: "quantum" }, (sim) => {
    const fighter = sim.fighters[0];
    // Measured against the rig's ceiling rather than a number that assumed one:
    // the release band is the top 0.46ft, so park the bot inside it.
    const releaseY = HEADLESS_CEILING_HEIGHT - 0.46;
    sim.setPose(fighter, { x: 0, y: releaseY + 0.34, z: 0 }, 0, { x: 0, y: 0.05, z: 0 });
    sim.physics.markHit(fighter, 0.5);
    sim.setInput(0, {});
    sim.stepFrames(8);
    const position = fighter.rb.translation();
    const velocity = fighter.rb.linvel();
    return {
      releasedFromCeiling: position.y < releaseY + 0.06,
      pushedDownward: velocity.y <= -1.0,
      y: position.y,
      verticalSpeed: velocity.y,
      end: sim.snapshot("physics-ceiling-release-end"),
    };
  });
}


// Every bot ported from v2 has to DRIVE like a v1 bot before anything else it
// does matters. Measured per machine (v1/tools/drive-smoothness-probe.mjs
// prints the same numbers): sit still at rest, reach and hold top speed without
// hunting, track straight, stay flat and gripped under acceleration, stop dead
// without hopping, and spin in place both ways.
//
// The thresholds are wide of what the roster measures — the tightest margin
// here is Tombstone's grip at 0.84 against a 0.6 floor — because this is a
// regression net for "did a collider stack or a drive contact move", not a
// tuning target.
async function portedDriveSmoothnessProbe() {
  const results = {};
  for (const id of PORTED_BOT_IDS) {
    const measured = await driveSmoothness(id);
    results[id] = {
      sitsStill: measured.restJitter < 0.01 && measured.restTilt < 1.5,
      reachesTopSpeed: measured.cruiseFraction > 0.85,
      holdsTopSpeed: measured.cruiseRipple < 0.12,
      tracksStraight: measured.lateral < 0.5 && measured.headingDrift < 3,
      staysFlat: measured.maxTilt < 2.5,
      keepsGrip: measured.minGrounded > 0.6,
      stopsCleanly: measured.stopHop < 0.08 && measured.stopped < 0.5,
      turnsBothWays: Math.abs(measured.turnRight) > 2.5 && Math.abs(measured.turnLeft) > 2.5
        && Math.sign(measured.turnRight) !== Math.sign(measured.turnLeft),
      measured,
    };
  }
  const failed = Object.entries(results)
    .filter(([, checks]) => Object.entries(checks).some(([key, value]) => key !== "measured" && !value))
    .map(([id]) => id);
  return { allSmooth: failed.length === 0, failed, results };
}

// And every ported bot has to be able to FIGHT: the mechanism moves, and it
// reaches an opponent it is driving into. Both halves matter — a stroke that
// never lands is the failure mode that looks fine on screen, and it is exactly
// what a wrong pivot or an under-sized reach produces.
async function portedWeaponMechanismProbe() {
  const results = {};
  for (const id of PORTED_BOT_IDS) {
    const measured = await weaponMechanism(id);
    const spinner = measured.type === "bar" || measured.type === "drum";
    const arm = !spinner;
    results[id] = {
      // A spinner has to get moving; the slowest wind-ups on the roster (Deep
      // Six 4.5s, Gigabyte 6s) are still climbing when the window closes, so
      // this asks for motion rather than for full speed.
      spinsUp: !spinner || measured.maxSpin > measured.spinnerFullSpeed * 0.1,
      // A flipper or a crusher is one of v1's ORIGINAL mechanisms and runs on
      // v1's own impulse path, which damps a rotation rather than reporting a
      // stroke; for those, landing the hit below is the proof it moved.
      armTravels: !arm || ["crusher", "flipper", "meshFlipper"].includes(measured.type) || measured.maxStroke > 0.9,
      subSpinsUp: !measured.hasSub || measured.maxSubRatio > 0.9,
      jawCloses: !measured.hasClaw || measured.maxClaw > 0.9,
      landsHits: measured.hits > 0,
      doesDamage: measured.damageTotal > 0 || measured.damageKinds.includes("crusherBite"),
      measured,
    };
  }
  const failed = Object.entries(results)
    .filter(([, checks]) => Object.entries(checks).some(([key, value]) => key !== "measured" && !value))
    .map(([id]) => id);
  return { allArmed: failed.length === 0, failed, results };
}


// The mechanisms that are not the weapon. Each of these is a v2 feature with
// its own way of failing silently — a carriage that never travels, fire that
// burns nothing, an arm that will not hold, a grip that only shoves, omniwheels
// that cannot go sideways, tracks that coast, a machine that cannot get off its
// back. One check per mechanism, per bot that has it, measured rather than
// assumed (v1/tools/mechanism-probe.mjs prints the same numbers).
async function portedMechanismProbe() {
  const results = {};
  const record = (label, id, checks, measured) => {
    results[`${label}/${id}`] = { ...checks, measured };
  };

  for (const id of botsWithMechanism("track")) {
    const measured = await trackReport(id);
    record("carriage", id, {
      windsBack: measured.wound > 0.9,
      firesForward: measured.released < 0.1,
      // The fling is worth what the catalog says it is worth, and only while
      // the carriage is actually travelling.
      boostsTheHit: Math.abs(measured.fling - measured.hitBoost) < 0.01,
    }, measured);
  }
  for (const id of botsWithMechanism("fists")) {
    const measured = await fistsReport(id);
    record("fists", id, { swingsUp: measured.stroke > 0.9, lands: measured.punches > 0, hurts: measured.damage > 0 }, measured);
  }
  for (const id of botsWithMechanism("flame")) {
    const measured = await flameReport(id);
    record("flame", id, { lights: measured.burning > 0.9, burns: measured.ticks > 0, hurts: measured.damage > 0 }, measured);
  }
  for (const id of botsWithMechanism("twoWayArm")) {
    const measured = await twoWayArmReport(id);
    record("two-way arm", id, {
      raises: measured.raised > 0.3,
      holdsWhereLeft: measured.held < 0.02,
      comesBackDown: measured.lowered < 0.05,
    }, measured);
  }
  for (const id of botsWithMechanism("grip")) {
    const measured = await gripReport(id);
    record("grip", id, { takesHold: measured.grippedFrames > 30, throwsOnRelease: measured.releaseKick > 0.1 }, measured);
  }
  for (const id of botsWithMechanism("drive")) {
    if (BOT_CONFIG[id].driveType === "holonomic") {
      const measured = await holonomicReport(id);
      record("holonomic", id, {
        goesSideways: measured.sideways > 2,
        withoutTurning: measured.yawDrift < 0.2,
        withoutDriftingForward: measured.forward < 0.5,
      }, measured);
    } else {
      const measured = await trackedStopReport(id);
      record("tracked stop", id, { rolls: measured.before > 3, stopsDead: measured.stopped < 0.1 }, measured);
    }
  }
  for (const id of botsWithMechanism("lift")) {
    const measured = await liftReport(id);
    record("body lift", id, {
      // It rears — most of the way to the commanded angle, which is all a
      // proportional servo holding against gravity can do.
      rearsUp: measured.maxDeg > measured.wantDeg * 0.5,
      holdsThere: measured.heldDeg > measured.wantDeg * 0.4,
      // The BODY goes up. A torque about the centre of mass pitches the nose up
      // by driving the tail down, which looks the same from the front.
      liftsTheBody: measured.rose > 0.4,
      // And the pods stay on the floor rather than being levered through it.
      staysAboveTheFloor: measured.sank > -0.05,
      comesBackDown: measured.settledDeg < 5,
    }, measured);
  }
  for (const id of botsWithMechanism("selfRight")) {
    const measured = await srimechReport(id);
    record("srimech", id, { startsInverted: measured.beforeUpY < -0.5, getsBackUp: measured.recovered }, measured);
  }

  const failed = Object.entries(results)
    .filter(([, checks]) => Object.entries(checks).some(([key, value]) => key !== "measured" && !value))
    .map(([name]) => name);
  return { allWorking: failed.length === 0, failed, results };
}

/**
 * Every ported bot's CONTROLS, against v2's own definition of them. A weapon
 * that moves, lands and hurts can still be unplayable — a saw motor you have to
 * hold down, a jaw on a button you cannot spare while driving — and none of the
 * other probes press a button the way a player does.
 */
async function portedControlAudit() {
  const results = {};
  const failed = [];
  for (const id of PORTED_BOT_IDS) {
    const report = auditControls(id);
    if (report.skipped) continue;
    results[id] = report;
    if (report.issues.length) failed.push(`${id}: ${report.issues.join("; ")}`);
  }
  return { allMatchV2: failed.length === 0, failed, results };
}

const checks = [
  ["ported weapon controls match v2", async () => {
    const result = await portedControlAudit();
    assert.equal(result.allMatchV2, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["ported roster drives smoothly", async () => {
    const result = await portedDriveSmoothnessProbe();
    assert.equal(result.allSmooth, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["ported mechanisms work", async () => {
    const result = await portedMechanismProbe();
    assert.equal(result.allWorking, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["ported roster weapons work", async () => {
    const result = await portedWeaponMechanismProbe();
    assert.equal(result.allArmed, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["roster drive/turn", async () => {
    const result = await rosterDriveProbe();
    assert.equal(result.allDriveAndTurn, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["normal drive posture", async () => {
    const result = await normalDrivePostureProbe();
    assert.equal(result.allPlanted, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["Bronco drive/turn", async () => {
    const result = await driveProbe("bronco", { rivalId: "biteforce", frames: 120, turnFrames: 80 });
    assert.equal(result.movedForward, true, JSON.stringify(result, null, 2));
    assert.equal(result.reachedSpeed, true, JSON.stringify(result, null, 2));
    assert.equal(result.turned, true, JSON.stringify(result, null, 2));
    assert.equal(result.retainedTraction, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["LB brake", async () => {
    const result = await brakeProbe();
    assert.equal(result.reachedChargeSpeed, true, JSON.stringify(result, null, 2));
    assert.equal(result.slowedSignificantly, true, JSON.stringify(result, null, 2));
    assert.equal(result.brakeTargetedStop, true, JSON.stringify(result, null, 2));
    assert.equal(result.brakeImpulseApplied, true, JSON.stringify(result, null, 2));
    assert.equal(result.tiltTriggered, true, JSON.stringify(result, null, 2));
    assert.equal(result.tiltedForward, true, JSON.stringify(result, null, 2));
    assert.equal(result.keptAboveFloor, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["Bite Force floor clearance", async () => {
    const result = await biteForceFloorClearanceProbe();
    assert.equal(result.didNotSink, true, JSON.stringify(result, null, 2));
    assert.equal(result.retainedTraction, true, JSON.stringify(result, null, 2));
    assert.equal(result.frameUsesChassisRestHeight, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["Bronco self-right", async () => {
    const result = await broncoSelfRightProbe();
    assert.equal(result.didNotSink, true, JSON.stringify(result, null, 2));
    assert.equal(result.startedRighting, true, JSON.stringify(result, null, 2));
    assert.equal(result.recoveredUpright, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["Bronco under-flip", async () => {
    const result = await broncoUnderFlipProbe();
    assert.equal(result.targetLaunchedAtLeast3m, true, JSON.stringify(result, null, 2));
    assert.equal(result.targetGotSelfRightingScaleKick, true, JSON.stringify(result, null, 2));
    assert.equal(result.targetRotated, true, JSON.stringify(result, null, 2));
    assert.equal(result.broncoStayedPlanted, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["Bronco flipper return gate", async () => {
    const result = await broncoFlipperReturnGateProbe();
    assert.equal(Number.isFinite(result.returnSeconds), true, JSON.stringify(result, null, 2));
    assert.equal(result.returnSeconds, result.configuredReturnSeconds, JSON.stringify(result, null, 2));
    assert.equal(result.blockedDuringReturn, true, JSON.stringify(result, null, 2));
    assert.equal(result.firedAfterReturn, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["Bronco pitch settle", async () => {
    const result = await broncoPitchSettleProbe();
    assert.equal(result.settledFlat, true, JSON.stringify(result, null, 2));
    assert.equal(result.frontSupported, true, JSON.stringify(result, null, 2));
    assert.equal(result.solidlyGrounded, true, JSON.stringify(result, null, 2));
    assert.equal(result.bodySolidlyGrounded, true, JSON.stringify(result, null, 2));
    assert.equal(result.nearFloor, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["Bronco weapon collider isolation", async () => {
    const result = await broncoWeaponColliderIsolationProbe();
    assert.equal(result.weaponCollidersExist, true, JSON.stringify(result, null, 2));
    assert.equal(result.weaponGroundIgnored, true, JSON.stringify(result, null, 2));
    assert.equal(result.weaponCollidersAreSensors, true, JSON.stringify(result, null, 2));
    assert.equal(result.restHeightIgnoresWeapon, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["wedge side/back assist", async () => {
    const result = await wedgeSideBackAssistProbe();
    assert.equal(result.sideDetected, true, JSON.stringify(result, null, 2));
    assert.equal(result.backDetected, true, JSON.stringify(result, null, 2));
    assert.equal(result.frontNotBoosted, true, JSON.stringify(result, null, 2));
    assert.equal(result.sideStrongerThanFront, true, JSON.stringify(result, null, 2));
    assert.equal(result.backStrongerThanFront, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["inverted drive gating", async () => {
    const result = await invertedDriveProbe();
    assert.equal(result.invertedBotCanDrive, true, JSON.stringify(result, null, 2));
    assert.equal(result.nonInvertedBotCannotDriveUpsideDown, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["falling ignores drive until grounded", async () => {
    const result = await fallingProbe();
    assert.equal(result.fellUnderGravity, true, JSON.stringify(result, null, 2));
    assert.equal(result.noAirborneDrive, true, JSON.stringify(result, null, 2));
    assert.equal(result.settledStable, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["solo escape boost", async () => {
    const result = await soloEscapeBoostProbe();
    assert.equal(result.becameEligible, true, JSON.stringify(result, null, 2));
    assert.equal(result.boostedUpward, true, JSON.stringify(result, null, 2));
    assert.equal(result.boostedStraightUp, true, JSON.stringify(result, null, 2));
    assert.equal(result.recordedSoloBoost, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["pair escape boost", async () => {
    const result = await pairEscapeBoostProbe();
    assert.equal(result.becameEligible, true, JSON.stringify(result, null, 2));
    assert.equal(result.separated, true, JSON.stringify(result, null, 2));
    assert.equal(result.bothBoostedUpward, true, JSON.stringify(result, null, 2));
    assert.equal(result.recordedPairBoost, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["spinner side hit ladder", async () => {
    const result = await spinnerSideHitLadderProbe();
    assert.equal(result.allMetMinimums, true, JSON.stringify(result, null, 2));
    assert.equal(result.orderedImpulse, true, JSON.stringify(result, null, 2));
    assert.equal(result.hugeFullExceedsMidTier, true, JSON.stringify(result, null, 2));
    assert.equal(result.hugeHalfMatchesOldFullPower, true, JSON.stringify(result, null, 2));
    assert.equal(result.minotaurMatchesMidTier, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["spinner plow defence", async () => {
    const result = await plowDefenceProbe();
    assert.equal(result.horizontalWedgeApplied, true, JSON.stringify(result, null, 2));
    assert.equal(result.bodyUnaffected, true, JSON.stringify(result, null, 2));
    assert.equal(result.disabledUnaffected, true, JSON.stringify(result, null, 2));
    assert.equal(result.verticalWedgeApplied, true, JSON.stringify(result, null, 2));
    assert.equal(result.verticalPushPreserved, true, JSON.stringify(result, null, 2));
    assert.equal(result.verticalLiftReduced, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["bronco tombstone flipper contact", async () => {
    const result = await broncoTombstoneFlipperContactProbe();
    assert.equal(result.weaponOnlyDamagesBronco, true, JSON.stringify(result, null, 2));
    assert.equal(result.weaponOnlyDoesNotLaunchTombstone, true, JSON.stringify(result, null, 2));
    assert.equal(result.bodyStillFlips, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["quantum crusher target point", async () => {
    const result = await quantumCrusherTargetPointProbe();
    assert.equal(result.recordedBite, true, JSON.stringify(result, null, 2));
    assert.equal(result.pointIsOnTargetSide, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["spinner wall reflection", async () => {
    const result = await spinnerWallReflectionProbe();
    assert.equal(result.recoiledInward, true, JSON.stringify(result, null, 2));
    assert.equal(result.reflectedDownward, true, JSON.stringify(result, null, 2));
    assert.equal(result.reversedYaw, true, JSON.stringify(result, null, 2));
    assert.equal(result.drainedSpinner, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["tombstone long reach hit", async () => {
    const result = await tombstoneLongReachProbe();
    assert.equal(result.longReachHit, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["tombstone spin direction", async () => {
    const result = await tombstoneSpinDirectionProbe();
    assert.equal(result.positiveSpinRecorded, true, JSON.stringify(result, null, 2));
    assert.equal(result.negativeSpinRecorded, true, JSON.stringify(result, null, 2));
    assert.equal(result.directionFlipped, true, JSON.stringify(result, null, 2));
    assert.equal(result.targetVelocityFlipped, true, JSON.stringify(result, null, 2));
    assert.equal(result.attackerRecoilOpposesHit, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["upright spinner floor clearance", async () => {
    const result = await uprightSpinnerFloorClearanceProbe();
    assert.equal(result.allSuppressed, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["spinner floor strike", async () => {
    const result = await spinnerFloorStrikeProbe();
    assert.equal(result.struckFloor, true, JSON.stringify(result, null, 2));
    assert.equal(result.drainedSpinnerSpeed, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["tombstone spinner floor launch", async () => {
    const result = await tombstoneSpinnerFloorLaunchProbe();
    assert.equal(result.launchedFromFloor, true, JSON.stringify(result, null, 2));
    assert.equal(result.drainedSpinnerSpeed, true, JSON.stringify(result, null, 2));
    assert.equal(result.eventWasFloorLaunch, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["spinner inverted floor strike", async () => {
    const result = await spinnerInvertedFloorStrikeProbe();
    assert.equal(result.struckFloor, true, JSON.stringify(result, null, 2));
    assert.equal(result.drainedSpinnerSpeed, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["ceiling release", async () => {
    const result = await ceilingReleaseProbe();
    assert.equal(result.releasedFromCeiling, true, JSON.stringify(result, null, 2));
    assert.equal(result.pushedDownward, true, JSON.stringify(result, null, 2));
    return result;
  }],
  ["teeter recovery", async () => {
    const result = await teeterRecoveryProbe();
    assert.equal(result.allRecovered, true, JSON.stringify(result, null, 2));
    return result;
  }],
];

const started = performance.now();
const summary = {};
const failures = [];
for (const [name, run] of checks) {
  try {
    const result = await run();
    summary[name] = result;
    console.log(`ok - ${name}`);
  } catch (error) {
    failures.push({ name, message: error?.message || String(error) });
    summary[name] = { error: error?.message || String(error) };
    console.error(`not ok - ${name}`);
    console.error(error?.message || error);
  }
}
const elapsedMs = Math.round(performance.now() - started);
console.log(JSON.stringify({ ok: failures.length === 0, elapsedMs, failures, summary }, null, 2));
if (failures.length) process.exitCode = 1;
