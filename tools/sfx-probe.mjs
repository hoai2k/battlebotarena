// Does the sampled layer actually load and play? Boots the REAL page, runs a
// match, counts which sfx files the game asked for, and decodes a few takes
// in-page to prove the generated MP3s are readable by the browser.
//
// That last part is the reason this exists: sfxBank swallows fetch and decode
// failures by design (a missing sample must never break a match), which also
// means a bank of 131 unplayable files would sound EXACTLY like a bank that is
// working, with the synth quietly covering for it. This is what tells them
// apart from outside.
//
//   node server.mjs &
//   node tools/sfx-probe.mjs            # samples on  -> expect dozens of files
//   SAMPLES_OFF=1 node tools/sfx-probe.mjs   # samples off -> expect none
//
// One 404 for /favicon.ico is expected and predates the sound work.
import { chromium } from "playwright";

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--no-sandbox",
    "--autoplay-policy=no-user-gesture-required"],
});
const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
const errors = [];
const sfxRequests = new Set();
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("response", (r) => { if (r.status() >= 400) console.log(`HTTP ${r.status()} ${r.url()}`); });
page.on("requestfailed", (r) => console.log(`FAILED ${r.url()} ${r.failure()?.errorText}`));
page.on("request", (r) => { if (r.url().includes("/public/sfx/")) sfxRequests.add(r.url().split("/public/sfx/")[1]); });

await page.goto("http://localhost:4173/index.html");
if (process.env.SAMPLES_OFF) {
  await page.evaluate(() => localStorage.setItem("bba2-sampledSfx", "false"));
  await page.reload();
}
await page.waitForFunction("window.__bba2 !== undefined", null, { timeout: 60000 });

const decode = await page.evaluate(async () => {
  const ctx = new AudioContext();
  const files = ["impact/bot_heavy_1.mp3", "loop/spinner_bar.mp3", "ui/confirm.mp3", "crowd/cheer_big_1.mp3"];
  const out = [];
  for (const f of files) {
    try {
      const buf = await fetch(`./public/sfx/${f}`).then((r) => r.arrayBuffer());
      const audio = await ctx.decodeAudioData(buf);
      out.push(`${f}: ${audio.duration.toFixed(2)}s ${audio.numberOfChannels}ch ${audio.sampleRate}Hz`);
    } catch (err) {
      out.push(`${f}: FAILED ${err.message}`);
    }
  }
  return out;
});
console.log("decode check:");
decode.forEach((line) => console.log("  " + line));

await page.evaluate(() => window.__bba2.startMatch({ playerBotId: "tombstone", rivalBotId: "duck", difficulty: "hard" }));
await page.waitForTimeout(20000);

const state = await page.evaluate(() => ({
  screen: document.body.dataset.screen,
  sampled: JSON.parse(localStorage.getItem("bba2-sampledSfx") ?? "null"),
}));

console.log(`\nscreen=${state.screen} sampledSfx=${state.sampled}`);
console.log(`sfx files requested: ${sfxRequests.size}`);
console.log([...sfxRequests].sort().slice(0, 40).join("\n"));
console.log(`\nerrors: ${errors.length}`);
errors.slice(0, 10).forEach((e) => console.log("  " + e));
await browser.close();
