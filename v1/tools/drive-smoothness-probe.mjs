// Drive quality for every bot on the roster, printed as a table.
//
//   node v1/tools/drive-smoothness-probe.mjs [ids...]
//
// The same measurements the "roster drives smoothly" check in
// physics-headless-tests.mjs asserts, but printed rather than thresholded — run
// this when a bot fails that check, or after touching a collider stack, to see
// which part of driving it lost.
//
// rest       does it sit still? (jitter per frame, upright)
// cruise     does it reach and HOLD its top speed, or hunt around it?
// straight   does full-forward go straight, or crab and yaw off line?
// flat       does it stay level under acceleration instead of teetering?
// stop       does releasing the stick bring it to a halt without hopping?
// turn       does it spin in place, both ways?
import { botGroundSpeedFeetPerSecond } from "../src/botConfig.js";
import { createHeadlessPhysicsSim, headlessTestUtils } from "../src/headlessPhysicsRig.js";
import { PORTED_BOT_IDS } from "../src/portedBots.js";

const { THREE, bots, fighterUpVector } = headlessTestUtils;

export async function driveSmoothness(id) {
  const rivalId = id === "biteforce" ? "minotaur" : "biteforce";
  const sim = await createHeadlessPhysicsSim({ playerId: id, rivalId });
  try {
    const fighter = sim.fighters[0];
    const rival = sim.fighters[1];
    // The rival is parked far away: this is about the machine, not a fight.
    sim.setPose(rival, { x: 40, y: rival.restingBodyY, z: 40 }, Math.PI);
    sim.setPose(fighter, { x: 0, y: fighter.restingBodyY, z: 10 }, 0);
    sim.setInput(0, {});
    sim.setInput(1, {});
    sim.stepFrames(45);

    const yawOf = () => {
      const q = fighter.rb.rotation();
      return new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w), "YXZ").y;
    };
    const tiltDeg = () => Math.acos(Math.min(1, Math.max(-1, Math.abs(fighterUpVector(fighter).y)))) * 180 / Math.PI;

    // --- at rest ---
    let restJitter = 0;
    let previous = fighter.rb.translation();
    sim.stepFrames(60, () => {
      const p = fighter.rb.translation();
      restJitter = Math.max(restJitter, Math.hypot(p.x - previous.x, p.y - previous.y, p.z - previous.z));
      previous = p;
    });
    const restTilt = tiltDeg();

    // --- straight line ---
    const startYaw = yawOf();
    const start = fighter.rb.translation();
    const startPoint = { x: start.x, z: start.z };
    let maxTilt = 0;
    let minGrounded = Infinity;
    const cruise = [];
    sim.setInput(0, { leftDrive: 1, rightDrive: 1 });
    sim.stepFrames(150, (frame) => {
      maxTilt = Math.max(maxTilt, tiltDeg());
      minGrounded = Math.min(minGrounded, sim.physics.tractionForFighter(fighter).driveSolidGrounded || 0);
      if (frame < 90) return;
      const v = fighter.rb.linvel();
      cruise.push(Math.hypot(v.x, v.z));
    });
    const end = fighter.rb.translation();
    const travelled = { x: end.x - startPoint.x, z: end.z - startPoint.z };
    const forward = { x: -Math.sin(startYaw), z: -Math.cos(startYaw) };
    const along = travelled.x * forward.x + travelled.z * forward.z;
    const lateral = Math.abs(travelled.x * -forward.z + travelled.z * forward.x);
    const headingDrift = Math.abs(Math.atan2(Math.sin(yawOf() - startYaw), Math.cos(yawOf() - startYaw))) * 180 / Math.PI;
    const cruiseMin = Math.min(...cruise);
    const cruiseMax = Math.max(...cruise);
    const cruiseMean = cruise.reduce((sum, value) => sum + value, 0) / cruise.length;
    const maxSpeed = botGroundSpeedFeetPerSecond(fighter.spec, "maxSpeed", 3.682);

    // --- stopping ---
    const stopBaseY = fighter.rb.translation().y;
    let stopHop = 0;
    sim.setInput(0, {});
    sim.stepFrames(75, () => {
      stopHop = Math.max(stopHop, fighter.rb.translation().y - stopBaseY);
    });
    const stopped = Math.hypot(fighter.rb.linvel().x, fighter.rb.linvel().z);

    // --- turning, both ways ---
    // Accumulated, not endpoint-to-endpoint: most of this roster turns more than
    // half a circle in the window, and a wrapped angle reads a 360-degree spin
    // as standing still.
    const turn = (left, right) => {
      let previousYaw = yawOf();
      let total = 0;
      sim.setInput(0, { leftDrive: left, rightDrive: right });
      sim.stepFrames(75, () => {
        const yaw = yawOf();
        total += Math.atan2(Math.sin(yaw - previousYaw), Math.cos(yaw - previousYaw));
        previousYaw = yaw;
      });
      sim.setInput(0, {});
      sim.stepFrames(10);
      return total;
    };
    const turnRight = turn(1, -1);
    const turnLeft = turn(-1, 1);

    return {
      id,
      restJitter,
      restTilt,
      cruiseMean,
      cruiseRipple: cruiseMean > 0.01 ? (cruiseMax - cruiseMin) / cruiseMean : 0,
      cruiseFraction: cruiseMean / maxSpeed,
      along,
      lateral,
      headingDrift,
      maxTilt,
      minGrounded,
      stopHop,
      stopped,
      turnRight,
      turnLeft,
    };
  } finally {
    sim.dispose();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const ids = args.length ? args : (args.includes("--all") ? bots.map((bot) => bot.id) : [...PORTED_BOT_IDS]);
  console.log([
    "bot".padEnd(13), "rest".padEnd(8), "cruise".padEnd(14), "ripple".padEnd(8),
    "lateral".padEnd(8), "headΔ".padEnd(7), "tilt".padEnd(7), "grip".padEnd(6),
    "hop".padEnd(7), "stop".padEnd(7), "turn R/L",
  ].join(" "));
  for (const id of ids) {
    const result = await driveSmoothness(id);
    console.log([
      id.padEnd(13),
      result.restJitter.toFixed(4).padEnd(8),
      `${result.cruiseMean.toFixed(2)}/${(result.cruiseFraction * 100).toFixed(0)}%`.padEnd(14),
      result.cruiseRipple.toFixed(4).padEnd(8),
      result.lateral.toFixed(3).padEnd(8),
      result.headingDrift.toFixed(2).padEnd(7),
      result.maxTilt.toFixed(2).padEnd(7),
      result.minGrounded.toFixed(2).padEnd(6),
      result.stopHop.toFixed(3).padEnd(7),
      result.stopped.toFixed(3).padEnd(7),
      `${result.turnRight.toFixed(2)}/${result.turnLeft.toFixed(2)}`,
    ].join(" "));
  }
}
