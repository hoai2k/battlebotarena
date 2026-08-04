// Every bot in the catalog, driven by the AI against a reference opponent, so
// "it loads" is never mistaken for "it fights". Reports per bot: hits landed,
// damage dealt, and the fraction of the fight it spent on its back.
// usage: node tools/_roster-probe.mjs [seconds]
import { createSim, FIXED_DT } from "../src/sim/sim.js";
import { CATALOG, BOT_IDS } from "../src/assets/catalog.js";
import { computeAiInput } from "../src/game/ai.js";
import { EV } from "../src/shared/events.js";

const SECONDS = Number(process.argv[2] || 12);
const FOE = "biteforce";

function upY(q) {
  return 1 - 2 * (q.x * q.x + q.z * q.z);
}

const rows = [];
for (const id of BOT_IDS) {
  const specs = [CATALOG[id], CATALOG[id === FOE ? "tombstone" : FOE]];
  const hits = [0, 0];
  let damage = 0;
  const sim = await createSim({
    bots: specs,
    emit: (type, payload) => {
      if (type !== EV.WEAPON_HIT) return;
      hits[payload.attackerIndex] += 1;
      if (payload.attackerIndex === 0) damage += payload.impulse;
    },
  });
  let inverted = 0;
  let sunk = 0;
  const steps = Math.round(SECONDS / FIXED_DT);
  for (let i = 0; i < steps; i += 1) {
    const state = sim.getRenderState();
    const inputs = [
      computeAiInput(state[0], state[1], specs[0], "hard", FIXED_DT),
      computeAiInput(state[1], state[0], specs[1], "hard", FIXED_DT),
    ];
    sim.stepFrame(FIXED_DT, inputs);
    if (upY(state[0].quaternion) < 0.25) inverted += 1;
    if (state[0].position.y < -0.5) sunk += 1;
  }
  rows.push({
    id,
    hits: hits[0],
    taken: hits[1],
    damage: Math.round(damage),
    inverted: (inverted / steps) * 100,
    sunk: (sunk / steps) * 100,
  });
  sim.dispose?.();
}

console.log("bot            hits  taken   dmg   inverted%   sunk%");
for (const r of rows) {
  console.log(
    `${r.id.padEnd(14)}${String(r.hits).padStart(5)}${String(r.taken).padStart(7)}`
    + `${String(r.damage).padStart(6)}${r.inverted.toFixed(1).padStart(11)}${r.sunk.toFixed(1).padStart(8)}`,
  );
}
