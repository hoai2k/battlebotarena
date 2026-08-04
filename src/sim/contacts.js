// Contact-force event routing -> EV.IMPACT, plus shared contact-point helpers,
// plus the ram: the one contact this file does not merely report.

import { EV } from "../shared/events.js";
import * as m from "./math.js";

const IMPACT_THROTTLE_SECONDS = 0.06;
const MIN_IMPACT_FORCE = 40; // lbf; below this, contacts are inaudible scrapes

// --- ram knockback -----------------------------------------------------------
// The solver already conserves momentum, so a hard ram does move the machine it
// hits; what it does not do is make the hit READ as a hit. This is an extra
// separating impulse along the contact normal, equal and opposite, on top of
// the solver's own answer — restitution by another name, but restitution that
// applies only between two robots and only when they were genuinely closing.
const RAM_MIN_APPROACH = 6; // ft/s; below this a ram is a nudge and stays one
// 0.4 of the closing momentum handed back as bounce. Measured with the
// attacker's throttle cut at the moment of contact, so the number is the bounce
// and not the shove that follows it: a 17ft/s ram used to leave the victim
// doing 8.8ft/s and now leaves it doing 13.2. Past about 0.8 the victim leaves
// faster than the attacker arrived, which is a pinball, not a robot.
const RAM_KNOCKBACK = 0.4;
const RAM_MAX_APPROACH = 30; // ft/s of approach the bonus stops growing at

/**
 * Find a representative world-space contact point/normal between two colliders.
 * Normal is oriented from colA toward colB. Returns null when not touching.
 */
export function contactPointBetween(world, colA, colB) {
  let out = null;
  world.contactPair(colA, colB, (manifold, flipped) => {
    if (out || manifold.numSolverContacts() === 0) return;
    const p = manifold.solverContactPoint(0);
    const n = manifold.normal();
    out = {
      point: { x: p.x, y: p.y, z: p.z },
      normal: flipped ? m.scale(n, -1) : { x: n.x, y: n.y, z: n.z },
    };
  });
  return out;
}

function bodyVelocityAt(collider) {
  const body = collider.parent();
  if (!body || !body.isDynamic()) return { x: 0, y: 0, z: 0 };
  return body.linvel();
}

/**
 * Velocity of a world POINT on a body, from a velocity snapshot rather than
 * from the body's current state — see captureVelocities below for why that
 * matters. Includes the angular term, so the corner of a bot that is spinning
 * as it arrives counts as moving.
 */
/**
 * Contact normal from the force event, oriented from `bot` toward `other`.
 * maxForceDirection has no documented orientation relative to collider1/2, so
 * it is flipped to agree with centre-to-centre — which is unambiguous for two
 * convex hulls that are touching.
 */
function forceNormal(ev, bot, other) {
  const dir = ev.maxForceDirection?.();
  if (!dir) return null;
  const length = Math.hypot(dir.x, dir.y, dir.z);
  if (!(length > 1e-6)) return null;
  const n = { x: dir.x / length, y: dir.y / length, z: dir.z / length };
  const toOther = m.sub(other.collider.translation(), bot.collider.translation());
  return m.dot(n, toOther) < 0 ? m.scale(n, -1) : n;
}

function pointVelocityFrom(snap, worldPoint) {
  if (!snap) return { x: 0, y: 0, z: 0 };
  return m.add(snap.linvel, m.cross(snap.angvel, m.sub(worldPoint, snap.com)));
}

/**
 * Routes Rapier contact force events into EV.IMPACT, deduped per collider pair.
 * Weapon and hazard colliders are skipped — those systems emit their own events.
 */
export function createContactRouter({ world, meta, emit }) {
  /** @type {Map<string, number>} pairKey -> last emit sim time */
  const lastEmit = new Map();
  /** @type {Map<number, {linvel: object, angvel: object, com: object}>} body handle -> pre-step motion */
  const before = new Map();

  /**
   * Snapshot every dynamic body's motion BEFORE the solver runs.
   *
   * Contact force events are drained after world.step, and by then the solver
   * has already resolved the collision — both machines have been pushed apart
   * and their closing speed is spent. Reading velocities at that point reports
   * a 17ft/s head-on as about 2.7ft/s of approach, which lands under every
   * damage threshold in the game: ramming was, measurably, free. The approach
   * speed a player would call the hit is the one from the instant BEFORE the
   * step, and this is the only place it still exists.
   */
  function captureVelocities(bodies) {
    before.clear();
    for (const body of bodies) {
      if (!body?.isDynamic?.()) continue;
      const com = body.worldCom ? body.worldCom() : body.translation();
      before.set(body.handle, {
        linvel: m.clone(body.linvel()),
        angvel: m.clone(body.angvel()),
        com: { x: com.x, y: com.y, z: com.z },
      });
    }
  }

  function route(ev, simTime) {
    const a = meta.get(ev.collider1());
    const b = meta.get(ev.collider2());
    if (!a || !b) return;
    if (a.kind === "hazard" || b.kind === "hazard") return;
    // Weapon-vs-bot contacts are scripted (EV.WEAPON_HIT). A weapon collider
    // slamming the arena is just the bot crashing — attribute it to the bot.
    const isBotish = (info) => info.kind === "bot" || info.kind === "weapon";
    const bot = isBotish(a) ? a : isBotish(b) ? b : null;
    if (!bot) return;
    const other = bot === a ? b : a;
    if (bot.kind === "weapon" && other.kind !== "arena") return;
    if (other.kind === "weapon") return;
    const force = ev.totalForceMagnitude();
    if (force < MIN_IMPACT_FORCE) return;

    const key = `${Math.min(ev.collider1(), ev.collider2())}:${Math.max(ev.collider1(), ev.collider2())}`;
    const last = lastEmit.get(key);
    if (last !== undefined && simTime - last < IMPACT_THROTTLE_SECONDS) return;
    lastEmit.set(key, simTime);

    const contact = contactPointBetween(world, bot.collider, other.collider);
    const point = contact ? contact.point : m.clone(bot.collider.translation());
    // The EVENT's own force direction first, the manifold second. The manifold
    // is queried after world.step and on the frame that matters — the one where
    // two machines meet at speed — it is routinely already gone, so the code
    // fell back to a hardcoded straight-up normal and a 27ft/s head-on measured
    // as 1.2. maxForceDirection is the axis the collision actually pushed along
    // and it is carried on the event, so it survives the step.
    const normal = forceNormal(ev, bot, other) ?? (contact ? contact.normal : { x: 0, y: 1, z: 0 });
    const relVel = m.sub(bodyVelocityAt(bot.collider), bodyVelocityAt(other.collider));
    // Closing speed at the contact point, taken from the pre-step snapshot. A
    // static wall or a kinematic hazard has no entry, and contributes nothing.
    // POSITIVE is closing: contactPointBetween orients the normal from `bot`
    // toward `other`, so the bot moving along it is the bot moving into the
    // thing it hit.
    const preRel = m.sub(
      pointVelocityFrom(before.get(bot.collider.parent()?.handle), point),
      pointVelocityFrom(before.get(other.collider.parent()?.handle), point),
    );
    const approach = Math.max(0, m.dot(preRel, normal));
    if (other.kind === "bot" && approach > RAM_MIN_APPROACH) ram(bot, other, normal, approach);
    emit(EV.IMPACT, {
      // What the pair were closing at when they met, in ft/s. The one number
      // that says how hard this was; everything below describes it after the
      // fact. Zero when they were already separating.
      approachSpeed: approach,
      // How fast the two things are closing ALONG THE CONTACT NORMAL. This is
      // the number that says whether something was hit; relSpeed below says how
      // fast the pair were moving relative to each other, which for anything
      // sliding is almost all tangential. Claw Viper is the case that made the
      // difference matter: 250lbf of magnets holding a 17fps chassis down means
      // its floor pan is in contact the whole time it drives, and judged on
      // relSpeed alone every one of those scrapes read as a 17fps floor slam.
      normalSpeed: Math.abs(m.dot(relVel, normal)),
      botIndex: other.kind === "bot" ? Math.min(bot.botIndex, other.botIndex) : bot.botIndex,
      otherIndex: other.kind === "bot" ? Math.max(bot.botIndex, other.botIndex) : null,
      surface: other.kind === "bot" ? "bot" : other.surface,
      point,
      normal,
      force,
      relSpeed: m.length(relVel),
    });
  }

  /**
   * Shove two machines apart harder than the solver alone would. Scaled by the
   * reduced mass so a heavy bot is not flung by a light one and a light one is
   * not immovable, and capped so a spinner-assisted 40ft/s closing speed does
   * not launch anybody into orbit.
   */
  function ram(bot, other, normal, approach) {
    const bodyA = bot.collider.parent();
    const bodyB = other.collider.parent();
    if (!bodyA?.isDynamic?.() || !bodyB?.isDynamic?.()) return;
    const massA = bodyA.mass();
    const massB = bodyB.mass();
    if (!(massA > 0) || !(massB > 0)) return;
    const reduced = (massA * massB) / (massA + massB);
    const speed = Math.min(approach, RAM_MAX_APPROACH) - RAM_MIN_APPROACH;
    const impulse = m.scale(normal, RAM_KNOCKBACK * reduced * speed);
    bodyA.applyImpulse(m.scale(impulse, -1), true); // the normal points A -> B
    bodyB.applyImpulse(impulse, true);
  }

  return {
    /** Snapshot motion before world.step, so the approach speed survives it. */
    capture: captureVelocities,
    /** Drain the event queue for one fixed step. */
    process(eventQueue, simTime) {
      eventQueue.drainCollisionEvents(() => {});
      eventQueue.drainContactForceEvents((ev) => route(ev, simTime));
    },
    reset() {
      lastEmit.clear();
      before.clear();
    },
  };
}
