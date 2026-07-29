// Frozen contract — see v2/ARCHITECTURE.md. Do not edit without updating the doc.
// Tiny typed event bus connecting sim → game → ui/audio/fx/haptics.

export const EV = Object.freeze({
  IMPACT: "impact",
  WEAPON_HIT: "weaponHit",
  WEAPON_FIRED: "weaponFired",
  WEAPON_SPIN: "weaponSpin",
  HAZARD_CONTACT: "hazardContact",
  HAZARD_LAUNCH: "hazardLaunch",
  DAMAGE: "damage",
  PART_BREAK: "partBreak",
  MATCH: "match",
});

export function createEventBus() {
  const listeners = new Map();
  return {
    /** Subscribe; returns an unsubscribe function. */
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type)?.delete(fn);
    },
    emit(type, payload) {
      listeners.get(type)?.forEach((fn) => fn(payload));
    },
    clear() {
      listeners.clear();
    },
  };
}
