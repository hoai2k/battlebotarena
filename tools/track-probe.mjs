// Watch a tracked bot's track band actually move.
//
//   node server.mjs &
//   node tools/track-probe.mjs dragonking /tmp/shots
//
// boot-probe.mjs answers "does this bot render and drive". It cannot answer
// "is the tread travelling along the track rather than smearing across the
// wheels", which needs the camera pressed against one pod and several frames at
// a known wheel speed. This drives syncBotVisual directly at a fixed spin so
// successive frames differ only by the animation under test, then reports where
// the pod's texture offsets ended up.
import { chromium } from "playwright";
import fs from "node:fs";

const id = process.argv[2] || "dragonking";
const out = process.argv[3] || "/tmp/track";
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
await page.evaluate(async (bot) => {
  await window.__bba2.startMatch({ playerBotId: bot, rivalBotId: "biteforce", difficulty: "hard" });
}, id);
await page.waitForTimeout(4000);

// Freeze the match loop. Pausing the sim is not enough — the render loop keeps
// running on rAF and puts the director camera back every frame, so a probe that
// positions the camera and then screenshots gets the director's view of the far
// side of the arena. Killing rAF makes the probe's own render() the last frame
// drawn, which is the one the screenshot captures.
await page.evaluate(() => {
  const s = window.__bba2.session;
  window.__probe = { visual: s.botVisuals[0], spec: s.specs[0] };
  s.sim.setPaused(true);
  window.requestAnimationFrame = () => 0;
});

for (const spin of [0, 2, 4, 6]) {
  const info = await page.evaluate((wheelSpin) => {
    const { visual, spec } = window.__probe;
    const three = visual.group;
    const state = {
      position: { x: 0, y: 0, z: 0 },
      quaternion: { x: 0, y: 0, z: 0, w: 1 },
      weaponAngle: 0, weaponSubAngle: 0, weaponRatio: 0, weaponTrack: 0,
      wheelSpin: [wheelSpin, wheelSpin, wheelSpin, wheelSpin],
      probeCompression: [1, 1, 1, 1],
      auxPodAngle: 0,
    };
    window.__bba2.syncBotVisual(visual, spec, state, 1 / 60);
    // Two readings, because both halves matter: where the BANDS have got to,
    // and that the track units' own textures have not moved at all — the whole
    // bug was the second one moving.
    const maps = (visual.trackBands || []).map((b, i) => ({ name: `band${i}`, u: +b.map.offset.x.toFixed(3), v: +b.map.offset.y.toFixed(3) }));
    let node = null;
    for (const name of spec.tracks?.parts || []) {
      const m = visual.group.getObjectByName(name);
      if (!m) continue;
      node = node || m;
      maps.push({ name, u: +m.material.map.offset.x.toFixed(3), v: +m.material.map.offset.y.toFixed(3) });
    }
    // Camera hard against the pod itself, not the whole bot: the band is a few
    // inches of a three-foot machine and it cannot be judged from across the box.
    const T = window.__bba2.THREE;
    const cam = window.__bba2.camera;
    const subject = node || three;
    const box = new T.Box3().setFromObject(subject);
    const c = box.getCenter(new T.Vector3());
    const r = box.getSize(new T.Vector3()).length();
    cam.position.set(c.x + r * 0.75, c.y + r * 0.25, c.z + r * 0.15);
    cam.lookAt(c.x, c.y, c.z);
    cam.updateProjectionMatrix();
    window.__bba2.render();
    return { maps: maps.slice(0, 6), total: maps.length, node: `${(visual.trackBands || []).length} bands`, found: Boolean(node) };
  }, spin);
  await page.waitForTimeout(120);
  await page.screenshot({ path: `${out}/${id}-spin${spin}.png` });
  console.log(`spin ${spin}: node ${info.node} ${info.found ? "found" : "MISSING"}, ${info.total} textured meshes; offsets ${info.maps.map((m) => `${m.name} ${m.u},${m.v}`).join("  |  ")}`);
}
if (errors.length) console.log("ERRORS:", errors.slice(0, 3).join(" | "));
await browser.close();
