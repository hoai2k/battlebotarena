// Boot the REAL game page and start a match per bot, capturing a frame and any
// console error. Catches wiring neither sim-tests nor rig-inspect can see,
// because it is the only check that runs main.js: renderer posing, aux group
// hinges, input shaping, roster copy. It is how a plain `lifter` was caught
// rendering at its baked raised pose instead of its rest angle — the sim had
// the arm down, the render list of arm-angle weapon types did not include it.
//
//   node server.mjs &
//   node tools/boot-probe.mjs duck,freeshipping /tmp/shots
//
// Drives window.__bba2.startMatch, the dev hook at the bottom of main.js.
import { chromium } from "playwright";
import fs from "node:fs";

const ids = (process.argv[2] || "").split(",").filter(Boolean);
const out = process.argv[3] || "/tmp/boot";
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://localhost:4173/index.html");
await page.waitForFunction("window.__bba2 !== undefined", null, { timeout: 60000 });

for (const id of ids) {
  errors.length = 0;
  await page.evaluate(async (bot) => {
    await window.__bba2.startMatch({ playerBotId: bot, rivalBotId: "biteforce", difficulty: "hard" });
  }, id);
  await page.waitForTimeout(6000);
  const state = await page.evaluate(() => {
    const s = window.__bba2.renderState;
    return s && [{ p: s[0].position, w: s[0].weaponAngle, sub: s[0].weaponSubAngle }, { p: s[1].position }];
  });
  await page.screenshot({ path: `${out}/${id}.png` });
  const p = state?.[0]?.p;
  console.log(
    `${id.padEnd(14)} pos ${p ? `${p.x.toFixed(1)},${p.y.toFixed(2)},${p.z.toFixed(1)}` : "??"}`
    + `  weapon ${state?.[0]?.w?.toFixed(2)} sub ${state?.[0]?.sub?.toFixed(2)}`
    + `  ${errors.length ? `ERRORS: ${errors.slice(0, 2).join(" | ")}` : "ok"}`,
  );
}
await browser.close();
