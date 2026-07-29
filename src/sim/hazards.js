// Arena hazards: kill saws (kinematic cuboids rising from floor slots via
// setNextKinematicTranslation — Rapier launches bots for free, plus a scripted
// pop) and corner screws (kinematic spinning cylinders that convey bots).

import { EV } from "../shared/events.js";
import { RAPIER, HAZARD_GROUPS, tagCollider } from "./world.js";
import { KILL_SAWS, SCREWS } from "./arenaSpec.js";
import { contactPointBetween } from "./contacts.js";
import * as m from "./math.js";

export const HAZARD_TUNING = Object.freeze({
  sawLaunchSpeed: 7.0, // ft/s of extra upward pop on a rising-saw hit
  sawLaunchCooldownSeconds: 0.8, // per saw-bot pair
  sawGrindImpulse: 1.8, // slug*ft/s tangential kick per grind tick
  sawGrindLift: 0.6,
  sawGrindCooldownSeconds: 0.09,
  contactEventThrottleSeconds: 0.08,
  screwInwardImpulse: 0.9, // gentle push back toward the arena
  screwLiftImpulse: 0.5,
  screwGrindCooldownSeconds: 0.12,
});

const HT = HAZARD_TUNING;
const Z_AXIS = { x: 0, y: 0, z: 1 };

function slotDirection(yawDeg) {
  const yaw = m.degToRad(yawDeg);
  return { x: Math.cos(yaw), y: 0, z: -Math.sin(yaw) };
}

export function createHazards({ world, meta, emit, getVehicle }) {
  let sawsActive = false;

  // --- Kill saws -----------------------------------------------------------
  const r = KILL_SAWS.bladeRadius;
  const stowedY = -r - KILL_SAWS.stowedDepth;
  const risenY = KILL_SAWS.exposureFraction * 2 * r - r; // blade top = 2r*fraction above floor
  const travel = risenY - stowedY;
  const riseRate = travel / KILL_SAWS.riseSeconds;
  const sinkRate = travel / KILL_SAWS.sinkSeconds;
  const cycleSeconds =
    KILL_SAWS.riseSeconds + KILL_SAWS.holdSeconds + KILL_SAWS.sinkSeconds + KILL_SAWS.downSeconds;

  const saws = KILL_SAWS.slots.map((slot, i) => {
    const yaw = m.degToRad(slot.yawDeg);
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(slot.x, stowedY, slot.z)
        .setRotation(m.qFromAxisAngle({ x: 0, y: 1, z: 0 }, yaw)),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(r, r, KILL_SAWS.bladeThickness / 2)
        .setDensity(0)
        .setFriction(0.4)
        .setRestitution(0.1)
        .setCollisionGroups(HAZARD_GROUPS),
      body,
    );
    const saw = {
      slot,
      body,
      collider,
      dir: slotDirection(slot.yawDeg),
      phase: i * KILL_SAWS.phaseStagger,
      y: stowedY,
      prevY: stowedY,
      bladeAngle: 0,
      prevBladeAngle: 0,
      lastLaunchAt: new Map(), // botIndex -> simTime
      lastGrindAt: new Map(),
      lastEventAt: new Map(),
    };
    tagCollider(meta, collider, { kind: "hazard", hazard: "killSaw", hazardRef: saw });
    return saw;
  });

  function sawTargetY(saw, simTime) {
    if (!sawsActive) return stowedY;
    const t = (simTime + saw.phase) % cycleSeconds;
    if (t < KILL_SAWS.riseSeconds) return risenY; // rising toward exposed
    if (t < KILL_SAWS.riseSeconds + KILL_SAWS.holdSeconds) return risenY;
    return stowedY;
  }

  function updateSaw(saw, dt, simTime) {
    saw.prevY = saw.y;
    saw.prevBladeAngle = saw.bladeAngle;
    const target = sawTargetY(saw, simTime);
    const rate = target > saw.y ? riseRate : sinkRate;
    const dy = m.clamp(target - saw.y, -rate * dt, rate * dt);
    saw.y += dy;
    saw.body.setNextKinematicTranslation({ x: saw.slot.x, y: saw.y, z: saw.slot.z });
    if (sawsActive || saw.y > stowedY + 0.001) {
      saw.bladeAngle += KILL_SAWS.rotationSpeed * dt;
    }
    if (saw.y > stowedY + 0.02) grindSaw(saw, dt, simTime, dy > 1e-6);
  }

  function grindSaw(saw, dt, simTime, rising) {
    world.contactPairsWith(saw.collider, (other) => {
      const info = meta.get(other.handle);
      if (!info || info.kind !== "bot") return;
      const vehicle = getVehicle(info.botIndex);
      const contact = contactPointBetween(world, saw.collider, other);
      if (!contact) return;
      const body = vehicle.body;

      // The big pop: rising blade under a bot. Kinematic contact already shoves
      // it; this scripted boost makes the launch read on camera.
      const lastLaunch = saw.lastLaunchAt.get(info.botIndex) ?? -Infinity;
      if (rising && simTime - lastLaunch >= HT.sawLaunchCooldownSeconds && body.linvel().y < 3) {
        saw.lastLaunchAt.set(info.botIndex, simTime);
        const impulse = vehicle.mass * HT.sawLaunchSpeed;
        body.applyImpulseAtPoint(m.scale({ x: 0, y: 1, z: 0 }, impulse), contact.point, true);
        emit(EV.HAZARD_LAUNCH, { botIndex: info.botIndex, kind: "killSaw", point: contact.point, impulse });
      }

      // Continuous grind: tangential kick along the blade direction + sparks event.
      const lastGrind = saw.lastGrindAt.get(info.botIndex) ?? -Infinity;
      if (simTime - lastGrind >= HT.sawGrindCooldownSeconds) {
        saw.lastGrindAt.set(info.botIndex, simTime);
        const tangent = m.add(m.scale(saw.dir, HT.sawGrindImpulse), m.scale({ x: 0, y: 1, z: 0 }, HT.sawGrindLift));
        body.applyImpulseAtPoint(tangent, contact.point, true);
      }

      const lastEvent = saw.lastEventAt.get(info.botIndex) ?? -Infinity;
      if (simTime - lastEvent >= HT.contactEventThrottleSeconds) {
        saw.lastEventAt.set(info.botIndex, simTime);
        emit(EV.HAZARD_CONTACT, {
          botIndex: info.botIndex,
          kind: "killSaw",
          point: contact.point,
          intensity: m.clamp(m.length(body.linvel()) / 12 + 0.4, 0, 1),
        });
      }
    });
  }

  // --- Screws --------------------------------------------------------------
  const screws = SCREWS.list.map((entry) => {
    const yaw = m.degToRad(entry.yawDeg);
    // Cylinder local axis is +y; lay it along the slot direction, then yaw.
    const baseRot = m.qMul(m.qFromAxisAngle({ x: 0, y: 1, z: 0 }, yaw), m.qFromAxisAngle(Z_AXIS, Math.PI / 2));
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(entry.x, SCREWS.axisY, entry.z)
        .setRotation(baseRot),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cylinder(entry.length / 2, SCREWS.radius)
        .setDensity(0)
        .setFriction(SCREWS.friction)
        .setRestitution(0.05)
        .setCollisionGroups(HAZARD_GROUPS),
      body,
    );
    const screw = { entry, body, collider, baseRot, angle: 0, prevAngle: 0, lastEventAt: new Map() };
    tagCollider(meta, collider, { kind: "hazard", hazard: "screw", hazardRef: screw });
    return screw;
  });

  function updateScrew(screw, dt, simTime) {
    screw.prevAngle = screw.angle;
    screw.angle += SCREWS.rotationSpeed * dt;
    // Spin about the cylinder's own long axis (local +y): right-multiply.
    screw.body.setNextKinematicRotation(
      m.qMul(screw.baseRot, m.qFromAxisAngle({ x: 0, y: 1, z: 0 }, screw.angle)),
    );
    world.contactPairsWith(screw.collider, (other) => {
      const info = meta.get(other.handle);
      if (!info || info.kind !== "bot") return;
      const vehicle = getVehicle(info.botIndex);
      const contact = contactPointBetween(world, screw.collider, other);
      if (!contact) return;
      const last = screw.lastEventAt.get(info.botIndex) ?? -Infinity;
      if (simTime - last < HT.screwGrindCooldownSeconds) return;
      screw.lastEventAt.set(info.botIndex, simTime);
      // Gentle inward push + lift so bots ride the screw instead of wedging.
      const inward = m.flatNorm(m.scale(screw.body.translation(), -1)) ?? { x: 0, y: 0, z: 0 };
      vehicle.body.applyImpulseAtPoint(
        m.add(m.scale(inward, HT.screwInwardImpulse), m.v3(0, HT.screwLiftImpulse, 0)),
        contact.point,
        true,
      );
      emit(EV.HAZARD_CONTACT, {
        botIndex: info.botIndex,
        kind: "screw",
        point: contact.point,
        intensity: m.clamp(m.length(vehicle.body.linvel()) / 10 + 0.3, 0, 1),
      });
    });
  }

  return {
    /** Advance hazard kinematics + grind checks (call before world.step). */
    update(dt, simTime) {
      for (const saw of saws) updateSaw(saw, dt, simTime);
      for (const screw of screws) updateScrew(screw, dt, simTime);
    },
    setKillSawsActive(active) {
      sawsActive = Boolean(active);
    },
    killSawsActive: () => sawsActive,
    /** Interpolated snapshot for visuals. */
    getState(alpha) {
      return {
        killSaws: saws.map((saw) => ({
          x: saw.slot.x,
          z: saw.slot.z,
          y: m.lerp(saw.prevY, saw.y, alpha),
          yawDeg: saw.slot.yawDeg,
          radius: r,
          bladeAngle: m.lerp(saw.prevBladeAngle, saw.bladeAngle, alpha),
          exposure: m.clamp((m.lerp(saw.prevY, saw.y, alpha) - stowedY) / travel, 0, 1),
          active: sawsActive,
        })),
        screws: screws.map((screw) => ({
          x: screw.entry.x,
          z: screw.entry.z,
          y: SCREWS.axisY,
          yawDeg: screw.entry.yawDeg,
          length: screw.entry.length,
          radius: SCREWS.radius,
          angle: m.lerp(screw.prevAngle, screw.angle, alpha),
        })),
      };
    },
    reset() {
      sawsActive = false;
      for (const saw of saws) {
        saw.y = saw.prevY = stowedY;
        saw.bladeAngle = saw.prevBladeAngle = 0;
        saw.body.setNextKinematicTranslation({ x: saw.slot.x, y: stowedY, z: saw.slot.z });
        saw.lastLaunchAt.clear();
        saw.lastGrindAt.clear();
        saw.lastEventAt.clear();
      }
      for (const screw of screws) {
        screw.angle = screw.prevAngle = 0;
        screw.lastEventAt.clear();
      }
    },
  };
}
