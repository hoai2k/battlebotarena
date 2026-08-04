// posters — bake every bot as a transparent PNG for the select screen to show
// while its model downloads.
//
//     node server.mjs &
//     node tools/posters.mjs                # the whole roster
//     node tools/posters.mjs huge bronco    # just these
//
// Writes public/posters/<id>.png and public/posters/posters.json. The runtime
// contract — what the image is, where it goes, and when it gives way to the
// model — is in src/engine/posters.js. The picture itself is rendered by
// tools/poster-shot.html through engine/previewStage.js, which is also what the
// live pod builds from, so the two cannot drift.
//
// Re-run it after anything that changes how a bot LOOKS on the plinth: a model
// repair, a modelYaw/modelScale change, the start angle, the plinth, the
// lights. A stale poster is a bot that visibly changes shape when it loads.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.BBA_URL || "http://localhost:4173";
const OUT = "public/posters";
const PX = 768;

const { CATALOG } = await import("../src/assets/catalog.js");
const roster = Object.keys(CATALOG);
const want = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const ids = want.length ? want : roster;
const unknown = ids.filter((id) => !roster.includes(id));
if (unknown.length) {
  console.error(`unknown bot id(s): ${unknown.join(", ")}`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

// START FROM THE INDEX ALREADY ON DISK. A named run re-bakes SOME bots and
// posters.json is one shared map: writing it from scratch would drop every
// entry this run did not touch, and a bot with no entry has no poster as far as
// the runtime is concerned. The .png on disk does not save it — the index is
// what says a poster exists.
let bots = {};
try {
  const prev = JSON.parse(fs.readFileSync(path.join(OUT, "posters.json"), "utf8"));
  if (prev?.bots) bots = prev.bots;
} catch { /* first run */ }

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--no-sandbox"],
});

let failed = 0;
for (const id of ids) {
  const page = await browser.newPage({ viewport: { width: PX, height: PX } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await page.goto(`${BASE}/tools/poster-shot.html?bot=${id}&px=${PX}`);
  let meta = null;
  // SwiftShader is slow and the GLB is 10-17MB; give it room.
  try {
    await page.waitForFunction("window.__poster !== undefined", null, { timeout: 180000 });
    meta = await page.evaluate(() => window.__poster);
  } catch { /* timed out; meta stays null */ }

  const fail = (why) => {
    console.log(`  ${id}: FAILED — ${why}${errors[0] ? ` · ${errors[0]}` : ""}`);
    failed += 1;
  };

  if (!meta) { fail("timed out"); await page.close(); continue; }
  if (meta.error) { fail(meta.error); await page.close(); continue; }
  // An empty scene renders a perfectly transparent PNG, which passes every
  // check below and shows the player nothing.
  if (!meta.parts) { fail("the model loaded with no parts"); await page.close(); continue; }
  // The bot that renders has to be the bot the pod will show. A GLB that 404s
  // comes back as procedural blocks with no error anywhere.
  if (meta.placeholder) { fail("rendered the PROCEDURAL stand-in, not the GLB"); await page.close(); continue; }

  const file = path.join(OUT, `${id}.png`);
  fs.writeFileSync(file, Buffer.from(meta.png.split(",")[1], "base64"));

  // A page background composited under the canvas gives a PNG with no alpha,
  // which reads as an opaque card sitting behind the bot.
  const { clearPct, drawnPct } = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let clear = 0, drawn = 0;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] < 8) clear += 1;
      else if (d[i] > 200) drawn += 1;
    }
    const n = d.length / 4;
    return { clearPct: (100 * clear) / n, drawnPct: (100 * drawn) / n };
  }, meta.png);

  if (clearPct < 5) { fail(`only ${clearPct.toFixed(1)}% transparent — no alpha channel`); await page.close(); continue; }
  // And the opposite failure: a poster that is all background is a bot that
  // rendered off-camera or at the wrong scale.
  if (drawnPct < 2) { fail(`only ${drawnPct.toFixed(1)}% of the frame is bot — nothing is in shot`); await page.close(); continue; }

  bots[id] = { px: meta.px, yaw: +meta.yaw.toFixed(4), pitch: +meta.pitch.toFixed(4), radius: +meta.radius.toFixed(4) };
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`  ${id}: ${meta.px}x${meta.px}  ${kb}KB  ${drawnPct.toFixed(0)}% bot  ${clearPct.toFixed(0)}% clear`);
  await page.close();
}

fs.writeFileSync(
  path.join(OUT, "posters.json"),
  `${JSON.stringify({
    note: "generated by tools/posters.mjs — see src/engine/posters.js for the contract",
    bots,
  }, null, 1)}\n`,
);
console.log(`\nwrote ${Object.keys(bots).length} posters to ${OUT}${failed ? ` (${failed} failed)` : ""}`);
await browser.close();
process.exit(failed ? 1 : 0);
