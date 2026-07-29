// Driving-feel probe: quantifies response/smoothness for a real catalog bot so
// "sticky" reports can be measured instead of guessed at.
// Usage: node tools/feel-probe.mjs [botId]
import { createSim, FIXED_DT } from "../src/sim/sim.js";
import { getBotSpec } from "../src/assets/catalog.js";

const botId = process.argv[2] || "bronco";
const spec = getBotSpec(botId);
const rival = getBotSpec(botId === "tombstone" ? "minotaur" : "tombstone");
const sim = await createSim({ bots: [spec, rival], emit: () => {} });
const idle = { leftDrive: 0, rightDrive: 0, weapon: false, brake: false };

function run(frames, input) {
  const samples = [];
  for (let i = 0; i < frames; i++) {
    sim.stepFrame(FIXED_DT, [input, idle]);
    const b = sim._test.body(0);
    const v = b.linvel();
    const w = b.angvel();
    samples.push({ speed: Math.hypot(v.x, v.z), yawRate: w.y, t: i * FIXED_DT });
  }
  return samples;
}

function jerkScore(samples) {
  // RMS of per-tick speed delta changes: high = oscillating/notchy motion.
  let sum = 0;
  for (let i = 2; i < samples.length; i++) {
    const a1 = samples[i].speed - samples[i - 1].speed;
    const a0 = samples[i - 1].speed - samples[i - 2].speed;
    sum += (a1 - a0) ** 2;
  }
  return Math.sqrt(sum / Math.max(1, samples.length - 2));
}

// Settle first
run(60, idle);

// 1. Step response: full forward
let s = run(240, { leftDrive: 1, rightDrive: 1, weapon: false, brake: false });
const top = Math.max(...s.map((x) => x.speed));
const t90 = s.find((x) => x.speed >= 0.9 * spec.maxSpeedFps)?.t;
console.log(`[${botId}] top speed ${top.toFixed(1)} / ${spec.maxSpeedFps} fps; 0->90% in ${t90?.toFixed(2) ?? ">2"} s; cruise jerk ${jerkScore(s.slice(120)).toFixed(4)}`);

// 2. Release: coast profile (should ease out, not slam)
s = run(120, idle);
const stopT = s.find((x) => x.speed < 0.3)?.t;
console.log(`[${botId}] release: ${s[0].speed.toFixed(1)} fps -> <0.3 fps in ${stopT?.toFixed(2) ?? ">1"} s`);

// 3. Spin in place
s = run(180, { leftDrive: 1, rightDrive: -1, weapon: false, brake: false });
const peakYaw = Math.max(...s.map((x) => Math.abs(x.yawRate)));
console.log(`[${botId}] spin-in-place peak ${peakYaw.toFixed(2)} rad/s (${(peakYaw * 57.3).toFixed(0)} deg/s)`);
run(90, idle);

// 4. Turning while driving (arc)
run(120, { leftDrive: 1, rightDrive: 1, weapon: false, brake: false });
s = run(120, { leftDrive: 1, rightDrive: 0.2, weapon: false, brake: false });
const arcYaw = Math.abs(s[s.length - 1].yawRate);
const arcSpeed = s[s.length - 1].speed;
console.log(`[${botId}] arc turn: ${arcYaw.toFixed(2)} rad/s at ${arcSpeed.toFixed(1)} fps; turn jerk ${jerkScore(s).toFixed(4)}`);

// 5. Micro-input twitch (was the "sticky" complaint: small corrections snap)
run(60, idle);
s = run(90, { leftDrive: 0.25, rightDrive: 0.25, weapon: false, brake: false });
console.log(`[${botId}] 25% throttle: ${s[s.length - 1].speed.toFixed(1)} fps (expect ~${(0.25 * spec.maxSpeedFps).toFixed(1)}), jerk ${jerkScore(s.slice(30)).toFixed(4)}`);
