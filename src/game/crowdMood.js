// How impressed the crowd currently is — the decision half of the crowd
// reactions, with no Web Audio in it so it can be run and read in node
// (tools/crowd-probe.mjs).
//
// A crowd does not respond to EVENTS, it responds to ESCALATION. The first big
// hit of a fight is enormous; the fourth identical one barely registers, and
// the way you earn the fifth is by being worse than the fourth. A flat throttle
// cannot express that — it either lets a repeat through at full blast or drops
// it entirely, and both read as a sample player rather than as people.
//
// Two pieces of state carry it:
//
//   bar      how impressive the last thing they reacted to was. To cut straight
//            in, an event has to beat it by a margin — measured against the bar
//            AS SET, not against a decayed copy of it, or an unchanging stream
//            of identical hits reads as a stream of escalations the moment the
//            decay outruns the gap between them. The decayed value is used for
//            the opposite question: what is now beneath them.
//   fatigue  how much they have already reacted lately. Steady punishment at
//            one level still gets a noise, just a progressively smaller one —
//            they are hoarse, not absent. Also recovers with time.
//
// Both are shared between cheers and gasps on purpose: a crowd has one
// attention, not one per sound.

/** @typedef {{bar: number, fatigue: number, lastAt: number}} CrowdMood */

/** @returns {CrowdMood} */
export function freshCrowd() {
  return { bar: 0, fatigue: 0, lastAt: -Infinity };
}

/**
 * Should they react, and how loudly?
 *
 * @param {CrowdMood} mood current state (not mutated)
 * @param {number} magnitude 0..1, how extreme the thing that just happened was
 * @param {number} now seconds, monotonic
 * @param {object} tuning CONFIG.audio.crowd
 * @param {boolean} [force] a bell-to-bell moment (fight start, KO, the chant).
 *   Those are not earned against the bar; they ARE the moment, so they reset
 *   the crowd's memory rather than spending it.
 * @returns {{play: boolean, gain: number, mood: CrowdMood}}
 */
export function crowdVerdict(mood, magnitude, now, tuning, force = false) {
  if (force) {
    return { play: true, gain: 1, mood: { bar: magnitude, fatigue: 0, lastAt: now } };
  }

  const elapsed = now - mood.lastAt;
  // Nobody reacts twice inside this, however good the second one was.
  if (elapsed < tuning.minGapSeconds) return { play: false, gain: 0, mood };

  const decayedBar = mood.bar * Math.exp(-elapsed / tuning.memorySeconds);
  const fatigue = mood.fatigue * Math.exp(-elapsed / tuning.fatigueRecoverySeconds);
  const escalated = magnitude >= mood.bar + tuning.escalation;

  if (!escalated) {
    // Not a step up. They will still make a noise for a steady beating, but
    // only once the last one has had room to breathe...
    if (elapsed < tuning.steadyGapSeconds) return { play: false, gain: 0, mood };
    // ...and not for something clearly weaker than what they have just seen.
    if (magnitude < decayedBar * tuning.repeatFloorRatio) return { play: false, gain: 0, mood };
  }

  // Something bigger than anything so far always finds full voice — that is
  // what "worse than the last one" buys. A repeat is governed by fatigue
  // instead, down to a floor: the crowd gets hoarse, it does not go home.
  const gain = escalated ? 1 : Math.max(tuning.repeatGainFloor, 1 - fatigue);

  return {
    play: true,
    gain,
    mood: {
      // The bar only ratchets up within a reaction: having been shown a spinner
      // hit, they are not re-impressed by a shove ten seconds later.
      bar: Math.max(magnitude, decayedBar),
      fatigue: Math.min(1, fatigue
        + tuning.fatigueStep * (escalated ? tuning.escalationFatigueShare : 1)),
      lastAt: now,
    },
  };
}
