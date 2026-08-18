// Boot the REAL game page, start a 2- and 3-human match, and capture the frame
// AT A HIDPI PIXEL RATIO. Split screen is viewport math, and viewport math is
// exactly the kind of thing that is right on the machine it was written on and
// wrong on a retina display: three's setViewport/setScissor take CSS pixels and
// scale by the renderer's pixel ratio itself, so a rect measured in
// drawing-buffer pixels comes out doubled and every viewport but the first
// lands off the edge of the canvas. That looked like "split screen does not
// work" and no probe running at ratio 1 could see it.
//
//   node server.mjs &
//   node tools/split-probe.mjs /tmp/split 2
//
// Drives window.__bba2.startMatch, the dev hook at the bottom of main.js.
import { chromium } from "playwright";
import fs from "node:fs";

const out = process.argv[2] || "/tmp/split";
const dpr = Number(process.argv[3] || 2);
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 }, deviceScaleFactor: dpr });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto("http://localhost:4173/index.html");
await page.waitForFunction("window.__bba2 !== undefined", null, { timeout: 60000 });

const ROSTERS = { 1: ["duck", "biteforce"], 2: ["duck", "biteforce"], 3: ["duck", "biteforce", "tombstone"] };
for (const humans of [1, 2, 3]) {
  errors.length = 0;
  await page.evaluate(async ([botIds, humanCount]) => {
    await window.__bba2.startMatch({ botIds, humanCount, difficulty: "easy" });
  }, [ROSTERS[humans], humans]);
  await page.waitForTimeout(5000);
  // Screenshot FIRST: a capture suspends the page's rAF for as long as it takes,
  // and reading splitViews across that pause reports the value from before the
  // match started rather than the one the frame it captured actually used.
  await page.screenshot({ path: `${out}/humans-${humans}.png`, timeout: 120000 });
  const state = await page.evaluate(() => {
    const canvas = document.querySelector("#scene");
    return {
      splitViews: window.__bba2.splitViews,
      humans: window.__bba2.session?.humans,
      dpr: window.devicePixelRatio,
      buffer: `${canvas.width}x${canvas.height}`,
      css: `${canvas.clientWidth}x${canvas.clientHeight}`,
    };
  });
  console.log(
    `${humans} human${humans === 1 ? " " : "s"}  views ${state.splitViews}`
    + `  dpr ${state.dpr}  buffer ${state.buffer}  css ${state.css}`
    + `  ${errors.length ? `ERRORS: ${errors.slice(0, 2).join(" | ")}` : "ok"}`,
  );
}
await browser.close();
