// What the crowd does, printed. `node tools/crowd-probe.mjs`
//
// The crowd's reaction rules (src/game/crowdMood.js) are the kind of thing that
// is easy to write, plausible to read, and very hard to hear: the difference
// between "they get hoarse" and "they stop caring" is a couple of exponentials.
// This runs the decision half against scripted fights and prints one line per
// event, so the behaviour can be read instead of guessed at.
//
// It also asserts the properties the behaviour was asked for, and exits
// non-zero if one breaks:
//
//   1. an identical repeat right after a reaction is suppressed
//   2. a notably bigger hit cuts straight in, at full voice
//   3. a steady beating still gets a reaction, quieter each time, never silent
//   4. a lull brings them back to full strength

import { freshCrowd, crowdVerdict } from "../src/game/crowdMood.js";
import { CONFIG } from "../src/config.js";

const TUNING = CONFIG.audio.crowd;
const failures = [];

/**
 * @param {string} title
 * @param {Array<[number, number]>} events [secondsFromStart, magnitude]
 * @returns {Array<{at: number, magnitude: number, play: boolean, gain: number}>}
 */
function run(title, events) {
  console.log(`\n${title}`);
  let mood = freshCrowd();
  const out = [];
  for (const [at, magnitude] of events) {
    const verdict = crowdVerdict(mood, magnitude, at, TUNING);
    mood = verdict.mood;
    out.push({ at, magnitude, play: verdict.play, gain: verdict.gain });
    const bar = verdict.play
      ? "#".repeat(Math.max(1, Math.round(verdict.gain * 20)))
      : "· silent";
    console.log(`  t=${at.toFixed(1)}s  hit ${magnitude.toFixed(2)}  ${
      verdict.play ? `cheer ${verdict.gain.toFixed(2)} ` : "          "}${bar}`);
  }
  return out;
}

function check(label, condition) {
  if (!condition) failures.push(label);
  console.log(`  ${condition ? "ok  " : "FAIL"} ${label}`);
}

// 1 + 2 — the same hit twice, then something genuinely bigger.
const escalation = run("Identical repeat, then a real escalation", [
  [0, 0.85], [2.0, 0.85], [4.0, 0.85], [6.0, 1.0],
]);
check("first big hit cheers", escalation[0].play);
check("an identical hit 2s later is suppressed", !escalation[1].play);
check("a bigger hit cuts in", escalation[3].play);
check("the escalation is louder than the steady repeat",
  escalation[3].gain > escalation[2].gain);

// 3 — a machine taking a steady beating at one level.
const steady = run("Steady punishment, one hit every 3s at the same level",
  Array.from({ length: 7 }, (_, i) => [i * 3, 0.85]));
const cheered = steady.filter((e) => e.play);
check("they keep reacting", cheered.length >= 4);
check("each reaction is quieter than the last",
  cheered.every((e, i) => i === 0 || e.gain <= cheered[i - 1].gain + 1e-9));
check("they never go silent", cheered.every((e) => e.gain >= TUNING.repeatGainFloor - 1e-9));
check("the last one is much quieter than the first",
  cheered.at(-1).gain < cheered[0].gain * 0.75);

// 4 — the same beating, but with a lull in the middle.
const lull = run("The same, with a 25s lull in the middle", [
  [0, 0.85], [3, 0.85], [6, 0.85], [9, 0.85], [34, 0.85], [37, 0.85],
]);
check("the hit after the lull is back to full voice", lull[4].gain > 0.95);

// 5 — a shove after a spinner hit is beneath them.
const beneath = run("A big hit, then a nudge", [[0, 1.0], [4, 0.2]]);
check("the nudge earns nothing", !beneath[1].play);

console.log(`\n${failures.length ? `FAILED: ${failures.join("; ")}` : "all crowd properties hold"}`);
process.exit(failures.length ? 1 : 0);
