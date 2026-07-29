// Contact-force event routing -> EV.IMPACT, plus shared contact-point helpers.

import { EV } from "../shared/events.js";
import * as m from "./math.js";

const IMPACT_THROTTLE_SECONDS = 0.06;
const MIN_IMPACT_FORCE = 40; // lbf; below this, contacts are inaudible scrapes

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
 * Routes Rapier contact force events into EV.IMPACT, deduped per collider pair.
 * Weapon and hazard colliders are skipped — those systems emit their own events.
 */
export function createContactRouter({ world, meta, emit }) {
  /** @type {Map<string, number>} pairKey -> last emit sim time */
  const lastEmit = new Map();

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
    const normal = contact ? contact.normal : { x: 0, y: 1, z: 0 };
    const relVel = m.sub(bodyVelocityAt(bot.collider), bodyVelocityAt(other.collider));
    emit(EV.IMPACT, {
      botIndex: other.kind === "bot" ? Math.min(bot.botIndex, other.botIndex) : bot.botIndex,
      otherIndex: other.kind === "bot" ? Math.max(bot.botIndex, other.botIndex) : null,
      surface: other.kind === "bot" ? "bot" : other.surface,
      point,
      normal,
      force,
      relSpeed: m.length(relVel),
    });
  }

  return {
    /** Drain the event queue for one fixed step. */
    process(eventQueue, simTime) {
      eventQueue.drainCollisionEvents(() => {});
      eventQueue.drainContactForceEvents((ev) => route(ev, simTime));
    },
    reset() {
      lastEmit.clear();
    },
  };
}
