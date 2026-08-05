// Wedge lift: what makes a wedge a weapon instead of a bumper.
//
// A sloped collider alone does not get anyone off the floor. Climbing a ramp
// under drive needs thrust > weight * tan(slope), and these bots have about
// 62 lbf of thrust against 250 lb, so anything steeper than ~14 degrees is a
// wall — while the models' noses measure 18 to 56. Rather than flatten every
// wedge into something that no longer matches its bot, the wedge does the work
// it does in the real sport: the machine driving forward converts that thrust
// into lift under whatever it has gotten beneath.
//
// So while a wedge collider is touching the opponent, this applies an upward
// impulse to the opponent at the contact point and the equal and opposite one
// to the wedge's owner, scaled by how hard the owner is actually driving into
// them. Park a wedge next to someone and nothing happens; drive it under them
// and they come up.

import { contactPointBetween } from "./contacts.js";
import * as m from "./math.js";

export const WEDGE_TUNING = Object.freeze({
  // Share of the victim's weight the wedge can carry at full closing speed. Below
  // 1 a wedge alone never fully lifts a bot — it unweights them, which is what
  // makes them easy to shove and easy to feed to a weapon.
  liftFraction: 1.15,
  closingSpeedFull: 5.0, // ft/s of approach for full effect
  minClosingSpeed: 0.6, // below this the wedge is just resting against them
  ownerReactionShare: 0.6, // how much of the reaction plants the wedge's owner
});

const T = WEDGE_TUNING;
const UP = { x: 0, y: 1, z: 0 };

/**
 * @param {object} args
 * @param {import("@dimforge/rapier3d-compat").World} args.world
 * @param {Map} args.meta collider metadata registry
 * @param {object[]} args.vehicles
 */
export function createWedges({ world, meta, vehicles }) {
  return {
    /** Run after vehicle/weapon updates, before world.step. */
    update(dt) {
      for (const vehicle of vehicles) {
        if (!vehicle.wedgeColliders.length) continue;
        const rot = vehicle.body.rotation();
        const forward = m.qRotate(rot, { x: 0, y: 0, z: -1 });

        for (const wedge of vehicle.wedgeColliders) {
          world.contactPairsWith(wedge, (other) => {
            const info = meta.get(other.handle);
            if (info?.kind !== "bot" || info.botIndex === vehicle.index) return;
            const foe = vehicles[info.botIndex];
            if (!foe) return;

            // Two wedges meeting is a stalemate, not a ride. Both are on the
            // floor, neither can get under the other, and in the sport that is
            // exactly what happens: they bounce off each other and go round for
            // a better angle. Lifting here made every wedge-on-wedge exchange a
            // pair of bots levitating each other.
            if (info.surface === "wedge") return;

            // Only the closing component counts, so a wedge cannot levitate a
            // bot it is being pushed away from.
            const closing = m.dot(m.sub(vehicle.body.linvel(), foe.body.linvel()), forward);
            if (closing < T.minClosingSpeed) return;
            const drive = m.clamp(closing / T.closingSpeedFull, 0, 1);

            // 0.06ft of slack: this runs BEFORE world.step, so it is asking
            // about last step's manifolds, and a pair that is genuinely riding
            // up a slope is frequently a hair apart at the moment it is asked.
            const contact = contactPointBetween(world, wedge, other, 0.06);
            if (!contact) return;

            const lift = foe.mass * 32.174 * T.liftFraction * drive * dt;
            foe.body.applyImpulseAtPoint(m.scale(UP, lift), contact.point, true);
            vehicle.body.applyImpulseAtPoint(
              m.scale(UP, -lift * T.ownerReactionShare),
              contact.point,
              true,
            );
          });
        }
      }
    },
  };
}
