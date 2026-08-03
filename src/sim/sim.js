// Sim public API (see v2/ARCHITECTURE.md "Sim public API").
// Fixed 1/120s accumulator inside stepFrame; render state interpolated between
// the last two ticks; max 8 substeps per frame. Headless-safe (node + browser).

import { initRapier, createWorld, buildArena } from "./world.js";
import { SPAWNS } from "./arenaSpec.js";
import { createVehicle, completeInput } from "./vehicle.js";
import { createWeapon } from "./weapons.js";
import { createHazards } from "./hazards.js";
import { createWedges } from "./wedges.js";
import { createContactRouter } from "./contacts.js";
import * as m from "./math.js";

export const FIXED_DT = 1 / 120;
const MAX_SUBSTEPS = 8;
const MAX_FRAME_DT = 0.25;

/**
 * @typedef {{leftDrive:number, rightDrive:number, weapon:boolean, brake:boolean}} DriveInput
 *
 * @param {object} args
 * @param {object[]} args.bots two BotSimSpec objects from the catalog
 * @param {(type:string, payload:object) => void} args.emit event bus emit
 */
export async function createSim({ bots, emit }) {
  await initRapier();
  const ctx = createWorld();
  const { world, eventQueue, meta } = ctx;
  buildArena(ctx);

  const vehicles = bots.map((spec, index) =>
    createVehicle({ world, meta, spec, index, spawn: SPAWNS[index] }),
  );
  const weapons = vehicles.map((vehicle, index) =>
    createWeapon({ world, meta, vehicle, index, emit }),
  );
  const hazards = createHazards({ world, meta, emit, getVehicle: (i) => vehicles[i] });
  const contacts = createContactRouter({ world, meta, emit });
  const wedges = createWedges({ world, meta, vehicles });

  let paused = false;
  let accumulator = 0;
  let simTime = 0;

  function snapshotBot(i) {
    const body = vehicles[i].body;
    return {
      position: m.clone(body.translation()),
      quaternion: m.qClone(body.rotation()),
      weaponAngle: weapons[i].getAngle(),
      weaponSubAngle: weapons[i].getSubAngle?.() ?? 0,
      // 0..1 along a sliding weapon's track (Tantrum's drum carriage).
      weaponTrack: weapons[i].getTrack?.() ?? 0,
      // Named aux mechanisms (Dragon King's jaw and its rotating track pods).
      // The jaw follows the aux button; the pods are driven by the sim itself,
      // because pod rotation is how this machine self-rights and asking the
      // player for a fourth button to stand back up is not a mechanic.
      weaponAuxAngle: weapons[i].getAuxAngle?.() ?? 0,
      auxPodAngle: vehicles[i].podAngle?.() ?? 0,
      weaponRatio: weapons[i].getRatio(),
      wheelSpin: vehicles[i].getWheelSpin(),
      probeCompression: vehicles[i].probeCompression(),
    };
  }

  let prev = vehicles.map((v, i) => snapshotBot(i));
  let curr = vehicles.map((v, i) => snapshotBot(i));

  function tick(inputs) {
    hazards.update(FIXED_DT, simTime);
    for (let i = 0; i < vehicles.length; i++) {
      vehicles[i].update(FIXED_DT, inputs[i]);
    }
    for (let i = 0; i < weapons.length; i++) {
      weapons[i].update(FIXED_DT, inputs[i].weapon, {
        foe: vehicles[1 - i],
        // Weapons that can act ON another weapon (a rotor clash, a hammer coming
        // down on a spinning shell) need the other machine's mechanism, not just
        // its body.
        foeWeapon: weapons[1 - i],
        simTime,
        world,
        // Spinner gyro and the lifter's disc toggle both need more than the
        // weapon button, so the whole input rides along.
        input: inputs[i],
      });
    }
    // Wedges act on the contacts the last step produced, before this one.
    wedges.update(FIXED_DT);
    world.step(eventQueue);
    contacts.process(eventQueue, simTime);
    simTime += FIXED_DT;
    prev = curr;
    curr = vehicles.map((v, i) => snapshotBot(i));
  }

  function alpha() {
    return m.clamp(accumulator / FIXED_DT, 0, 1);
  }

  const sim = {
    /**
     * Advance the sim by one render frame.
     * @param {number} frameDtSeconds
     * @param {[DriveInput, DriveInput]} inputs
     */
    stepFrame(frameDtSeconds, inputs) {
      if (paused) return;
      const completed = [completeInput(inputs?.[0]), completeInput(inputs?.[1])];
      accumulator += m.clamp(frameDtSeconds, 0, MAX_FRAME_DT);
      // Cap substeps; drop overflow time rather than spiraling.
      accumulator = Math.min(accumulator, MAX_SUBSTEPS * FIXED_DT + FIXED_DT * 0.999);
      let steps = 0;
      while (accumulator >= FIXED_DT && steps < MAX_SUBSTEPS) {
        tick(completed);
        accumulator -= FIXED_DT;
        steps++;
      }
    },

    /** Interpolated transforms + weapon/wheel state for the renderer. */
    getRenderState() {
      const t = alpha();
      return vehicles.map((v, i) => ({
        position: m.lerpV3(prev[i].position, curr[i].position, t),
        quaternion: m.qNlerp(prev[i].quaternion, curr[i].quaternion, t),
        weaponAngle: m.lerp(prev[i].weaponAngle, curr[i].weaponAngle, t),
        weaponSubAngle: m.lerp(prev[i].weaponSubAngle, curr[i].weaponSubAngle, t),
        weaponTrack: m.lerp(prev[i].weaponTrack, curr[i].weaponTrack, t),
        weaponAuxAngle: m.lerp(prev[i].weaponAuxAngle, curr[i].weaponAuxAngle, t),
        auxPodAngle: m.lerp(prev[i].auxPodAngle, curr[i].auxPodAngle, t),
        weaponRatio: m.lerp(prev[i].weaponRatio, curr[i].weaponRatio, t),
        wheelSpin: curr[i].wheelSpin.map((s, w) => m.lerp(prev[i].wheelSpin[w], s, t)),
        probeCompression: curr[i].probeCompression.slice(),
        // Body-center height above the ground plane at suspension rest: the
        // renderer aligns the model's visual ground line with y=0 using this
        // (position.y is the BODY CENTER, not the underside of the bot).
        restCenterHeight: v.restCenterHeight,
      }));
    },

    getHazardState() {
      return hazards.getState(alpha());
    },

    setKillSawsActive(active) {
      hazards.setKillSawsActive(active);
    },

    setPaused(value) {
      paused = Boolean(value);
    },

    /** Restore spawn poses and clear all transient state (between plays only). */
    reset() {
      vehicles.forEach((vehicle, i) => vehicle.resetTo(SPAWNS[i]));
      weapons.forEach((weapon) => weapon.reset());
      hazards.reset();
      contacts.reset();
      accumulator = 0;
      prev = vehicles.map((v, i) => snapshotBot(i));
      curr = vehicles.map((v, i) => snapshotBot(i));
    },

    dispose() {
      eventQueue.free();
      world.free();
    },
  };

  // Test-only hooks (headless scenario rigging; not part of the public contract).
  sim._test = {
    world,
    vehicles,
    weapons,
    hazards,
    simTime: () => simTime,
    body: (i) => vehicles[i].body,
    setPose(i, pos, yaw = 0) {
      const body = vehicles[i].body;
      body.setTranslation({ x: pos.x, y: pos.y ?? vehicles[i].restCenterHeight, z: pos.z }, true);
      body.setRotation(m.qFromYaw(yaw), true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    },
    applyImpulse(i, impulse) {
      vehicles[i].body.applyImpulse(impulse, true);
    },
    setWeaponOmega(i, omega) {
      weapons[i].setOmega?.(omega);
    },
  };

  return sim;
}
