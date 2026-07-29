import { createSim } from "./src/sim/sim.js";
import { getBotSpec, BOT_IDS } from "./src/assets/catalog.js";
const idle = { leftDrive: 0, rightDrive: 0, weapon: false, brake: false };
const tilt = (b) => { const q = b.rotation(); return Math.acos(Math.max(-1, Math.min(1, 1 - 2*(q.x*q.x+q.z*q.z)))) * 180/Math.PI; };
console.log("bot          spin@5s  maxTilt(drive+turn, spun up)  finalTilt  speed");
for (const id of BOT_IDS) {
  const spec = getBotSpec(id);
  if (!["bar","drum"].includes(spec.weapon?.type)) continue;
  const sim = await createSim({ bots: [spec, getBotSpec("minotaur")], emit: () => {} });
  const b = sim._test.body(0);
  for (let i = 0; i < 180; i += 1) sim.stepFrame(1/60, [idle, idle]);
  sim._test.setPose(0, { x: 0, z: 10 }, 0);
  sim._test.setPose(1, { x: 25, z: -20 }, 0);
  for (let i = 0; i < 300; i += 1) sim.stepFrame(1/60, [{ ...idle, weapon: true }, idle]);
  const spin = sim._test.weapons[0].getRatio();
  let maxTilt = 0, maxSpeed = 0;
  const drive = { leftDrive: 1, rightDrive: 0.2, weapon: true, brake: false };
  for (let i = 0; i < 300; i += 1) {
    sim.stepFrame(1/60, [drive, idle]);
    maxTilt = Math.max(maxTilt, tilt(b));
    const v = b.linvel(); maxSpeed = Math.max(maxSpeed, Math.hypot(v.x, v.z));
  }
  console.log(`${spec.name.padEnd(12)} ${(spin*100).toFixed(0).padStart(4)}%   ${maxTilt.toFixed(1).padStart(6)}deg                  ${tilt(b).toFixed(1).padStart(5)}deg  ${maxSpeed.toFixed(1)}ft/s`);
  sim.dispose();
}
// Head-on: does a hit cost the attacker its spin?
const sim = await createSim({ bots: [getBotSpec("tombstone"), getBotSpec("biteforce")], emit: () => {} });
for (let i = 0; i < 180; i += 1) sim.stepFrame(1/60, [idle, idle]);
sim._test.setPose(0, { x: 0, z: 8 }, 0);
sim._test.setPose(1, { x: 0, z: 0 }, Math.PI);
for (let i = 0; i < 400; i += 1) sim.stepFrame(1/60, [{ ...idle, weapon: true }, idle]);
const before = sim._test.weapons[0].getRatio();
for (let i = 0; i < 150; i += 1) sim.stepFrame(1/60, [{ leftDrive: 1, rightDrive: 1, weapon: true }, idle]);
console.log(`\nTombstone spin ${(before*100).toFixed(0)}% -> ${(sim._test.weapons[0].getRatio()*100).toFixed(0)}% after charging Bite Force`);
const t = sim._test.body(1).translation();
console.log(`Bite Force knocked to x=${t.x.toFixed(1)} z=${t.z.toFixed(1)} (spawned at 0,0)`);
sim.dispose();
