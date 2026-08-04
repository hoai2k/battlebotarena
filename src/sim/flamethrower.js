// Flamethrowers, as a subsystem rather than as a property of one weapon type.
//
// This started life inside createLifterDisc, because Free Shipping was the only
// bot that had one. That made it unreachable for every other machine: Kraken is
// a crusher with a flamethrower in its throat, and it could not have one,
// because the code that burns things only ran on the lifter path. Nothing about
// fire is specific to a lifting arm.
//
// So: a weapon of ANY type gets a flamethrower by declaring `weapon.flame`, and
// createWeapon composes it on. The weapon keeps owning its own mechanism; this
// owns the fire.
//
// Two options exist for jaws in particular:
//   requiresGrip  damage only lands while the weapon reports a hold. Kraken's
//                 nozzle points into the bite zone, so it does nothing until
//                 the jaw is already clamped on something — which is exactly
//                 how the real machine uses it and what makes it a finisher
//                 rather than a ranged attack.
//   ridesWeapon   the emitter is parented to the weapon rather than the
//                 chassis, so the jet aims where the jaw points instead of
//                 where the bot points. Read by the renderer, not here.
//
// BattleBots requires flame systems on their own independently-armed channel,
// which is why this is always the secondary (RB) and never folded into the
// primary trigger.

import { EV } from "../shared/events.js";
import { damageImpulseForRate } from "./weaponTuning.js";
import * as m from "./math.js";

/** Seconds to reach full jet, and to die back down. Fire is not instant. */
const LIGHT_SECONDS = 0.12;
const DOUSE_SECONDS = 0.25;

/**
 * @param {object} args
 * @param {object} args.spec bot spec (reads spec.weapon.flame)
 * @param {object} args.vehicle
 * @param {number} args.index bot index
 * @param {Function} args.emit
 * @param {Function} args.zoneFor builds the damage zone: (spec, reach) => zone
 * @param {Function} args.inZone (zone, localPoint) => boolean
 * @param {number} args.tickSeconds damage cadence
 */
export function createFlamethrower({ spec, vehicle, index, emit, zoneFor, inZone, tickSeconds }) {
  const flame = spec.weapon?.flame;
  if (!flame) return null;
  // Long and narrow: a jet reaches well past the bodywork but only along the
  // line it is pointing, so it gets negative side padding rather than the
  // generous pad a swung arm needs.
  const zone = zoneFor(spec, flame.reach ?? 3.0, { pad: -0.2, minY: -0.6, maxY: 1.4 });
  let burning = 0;
  let lastBurnAt = -Infinity;

  return {
    /**
     * @param {number} dt
     * @param {boolean} lit secondary channel, post-latch
     * @param {object} ctx { foe, simTime }
     * @param {boolean} gripped whether the carrying weapon has a hold right now
     */
    update(dt, lit, ctx, gripped) {
      burning = m.clamp(burning + (lit ? dt / LIGHT_SECONDS : -dt / DOUSE_SECONDS), 0, 1);
      if (!lit) return;
      if (flame.requiresGrip && !gripped) return;
      const { foe, simTime } = ctx;
      if (!foe) return;
      const local = m.qRotateInv(vehicle.body.rotation(),
        m.sub(foe.body.translation(), vehicle.body.translation()));
      if (!inZone(zone, local)) return;
      if (simTime - lastBurnAt < tickSeconds) return;
      lastBurnAt = simTime;
      emit(EV.WEAPON_HIT, {
        attackerIndex: index,
        targetIndex: foe.index,
        point: m.add(foe.body.translation(), m.v3(0, 0.25, 0)),
        normal: m.v3(0, -1, 0),
        impulse: damageImpulseForRate(flame.damagePerSecond ?? 8, tickSeconds),
        appliedImpulse: 0, // fire pushes nothing over
        energyBefore: 0,
        heavy: false,
      });
    },
    /** 0..1 jet ramp. The renderer reads this as weaponSubAngle. */
    getBurn: () => burning,
    reset() {
      burning = 0;
      lastBurnAt = -Infinity;
    },
  };
}
