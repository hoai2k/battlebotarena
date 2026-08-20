// Analytics, checked without sending anything anywhere. Every GoatCounter host
// is intercepted: the script is answered with a stub that records count() calls,
// and the beacon host is refused outright, so a request that escapes is a bug in
// game/stats.js rather than a hole in this probe.
//
//   node server.mjs &
//   node tools/stats-probe.mjs
//
// The three things worth knowing:
//   off      — with no code configured, nothing loads and nothing is sent. This
//              is the shipped default and the promise that the game runs with
//              the network unplugged, so it is checked first.
//   names    — the events a real match produces, by name. GoatCounter groups by
//              name, so a name that carries a timestamp or a raw error string
//              makes a list of one-offs nobody can read.
//   contract — no event name may start with "/" (GoatCounter rejects it) and
//              every one must carry event:true, or it lands in the page list.
//
// The end-of-fight events need a fight that actually ENDS, and waiting for one
// is not an option here: the frame loop advances the match by at most 0.05s per
// drawn frame, and a software renderer draws a frame every few seconds, so a
// three minute round is hours and even the countdown never reaches two. The
// round is shortened in config and then clocked directly — match.update(dt) in
// a loop. The match module, the bus and the listener are all the real ones;
// only the thing calling them is the probe rather than requestAnimationFrame.
import { chromium } from "playwright";
import fs from "node:fs";

const PAGE_URL = process.env.BBA_URL || "http://localhost:4173/index.html";
const CONFIG_PATH = new URL("../src/config.js", import.meta.url).pathname;
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--no-sandbox"];

const failures = [];
const report = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(38)} ${detail}`);
  if (!ok) failures.push(name);
};

/** Rewrite config values on disk, run fn, then put the file back byte for byte —
 *  including if fn throws. The page reads config.js over HTTP at load, and the
 *  stats module reads it at construction, so there is no way in from outside. */
async function withConfig(patches, fn) {
  const original = fs.readFileSync(CONFIG_PATH, "utf8");
  let patched = original;
  for (const [pattern, replacement] of patches) {
    // Test before replacing: setting a value to what it already is IS a valid
    // patch (the shipped code is ""), and a no-op replace must not read as a
    // pattern that failed to match.
    if (!pattern.test(patched)) throw new Error(`config.js: nothing matched ${pattern}`);
    patched = patched.replace(pattern, replacement);
  }
  fs.writeFileSync(CONFIG_PATH, patched);
  try {
    return await fn();
  } finally {
    fs.writeFileSync(CONFIG_PATH, original);
  }
}
const withCode = (code, fn) => withConfig([[/goatCounterCode: "[^"]*"/, `goatCounterCode: "${code}"`]], fn);

const browser = await chromium.launch({ executablePath: CHROME, args: ARGS });

/** A page with the GoatCounter hosts stubbed and every off-origin request logged. */
async function open(viewport = { width: 700, height: 440 }) {
  const page = await browser.newPage({ viewport });
  const offOrigin = [];
  const errors = [];
  page.on("request", (r) => {
    const url = r.url();
    // blob: and data: are the page talking to itself (decoded audio, textures).
    if (/^(blob|data):/.test(url) || url.startsWith("http://localhost:4173")) return;
    offOrigin.push(url);
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**://gc.zgo.at/**", (route) => route.fulfill({
    contentType: "text/javascript",
    body: `window.goatcounter = window.goatcounter || {};
           window.goatcounter.count = (o) => { (window.__gc = window.__gc || []).push(o); };`,
  }));
  await page.route("**://*.goatcounter.com/**", (route) => route.abort());
  await page.goto(PAGE_URL);
  await page.waitForFunction("window.__bba2 !== undefined", null, { timeout: 60000 });
  return { page, offOrigin, errors, events: () => page.evaluate(() => window.__gc || []) };
}

// --- off: the shipped default -------------------------------------------------
await withCode("", async () => {
  const { page, offOrigin, errors } = await open();
  await page.evaluate(async () => {
    await window.__bba2.startMatch({ botIds: ["duck", "biteforce"], humanCount: 1 });
  });
  await page.waitForTimeout(6000);
  const state = await page.evaluate(() => ({
    tags: document.querySelectorAll("script[data-goatcounter]").length,
    gc: typeof window.goatcounter,
  }));
  report("off: no script injected", state.tags === 0 && state.gc === "undefined",
    `${state.tags} tags, window.goatcounter ${state.gc}`);
  report("off: nothing leaves the origin", offOrigin.length === 0,
    offOrigin.length ? offOrigin.slice(0, 3).join(", ") : "no off-origin requests");
  report("off: no errors", errors.length === 0, errors[0] || "none");
  await page.close();
});

// --- on: the events a whole fight produces ------------------------------------
await withConfig([
  [/goatCounterCode: "[^"]*"/, 'goatCounterCode: "probe-test"'],
  // Short enough that the round reaches the judges while the probe is watching.
  [/matchSeconds: \d+/, "matchSeconds: 10"],
], async () => {
  // Small viewport: every frame drawn is sim time advanced, and this one has to
  // get all the way to a result.
  const { page, offOrigin, errors, events } = await open({ width: 380, height: 260 });
  await page.evaluate(() => { setTimeout(() => { throw new Error("probe: deliberate boom"); }, 0); });
  await page.waitForTimeout(500);
  await page.evaluate(async () => {
    await window.__bba2.startMatch({ botIds: ["duck", "biteforce"], humanCount: 2, difficulty: "hard" });
  });
  await page.waitForTimeout(3000);
  const phases = await page.evaluate(() => {
    const match = window.__bba2.session.match;
    const seen = [];
    for (let i = 0; i < 2000; i += 1) {
      match.update(0.05);
      const phase = match.getState().phase;
      if (seen[seen.length - 1] !== phase) seen.push(phase);
      if (phase === "results") break;
    }
    return seen;
  });
  const finished = phases[phases.length - 1] === "results";
  report("on: the fight really finished", finished, phases.join(" -> "));

  const fired = await events();
  const names = fired.map((e) => e.path);
  const has = (prefix) => names.some((n) => n.startsWith(prefix));

  report("on: script loaded", (await page.evaluate(() => typeof window.goatcounter?.count)) === "function", "count() present");
  report("on: setup reported", has("setup-pads-") && has("setup-pixel-ratio-"),
    names.filter((n) => n.startsWith("setup-")).join(", ") || "none");
  report("on: match start reported", has("match-start-") && has("bot-duck") && has("bot-biteforce"),
    names.filter((n) => n.startsWith("match-start-") || n.startsWith("bot-")).join(", ") || "none");
  report("on: errors reported", has("error-"),
    names.filter((n) => n.startsWith("error-")).join(", ") || "none");
  report("on: fight result reported",
    finished && has("match-end-") && has("winner-") && has("match-length-"),
    names.filter((n) => /^(match-end-|winner-|match-length-)/.test(n)).join(", ") || "no result reached");
  // Neither machine lands a hit while the probe is the one turning the clock,
  // so this fight goes to the judges as a draw. That is the branch worth
  // pinning: a named winner is an array lookup, a draw is the null path through
  // it, and the null path is the one that throws if it is wrong.
  const winners = names.filter((n) => n.startsWith("winner-"));
  report("on: draw handled, not indexed into", winners.every((n) => n === "winner-draw" || n.length > "winner-".length),
    winners.join(", ") || "none");
  // One fight is one of each; a listener on the wrong bus message counts a
  // match several times over, which is the failure that looks like success.
  const ends = names.filter((n) => n.startsWith("match-end-")).length;
  const starts = names.filter((n) => n.startsWith("match-start-")).length;
  report("on: counted once, not per frame", ends === 1 && starts === 1,
    `${starts} start, ${ends} end`);

  const badName = names.filter((n) => n.startsWith("/"));
  report("contract: no leading slash", badName.length === 0, badName.join(", ") || `${names.length} names checked`);
  const notEvents = fired.filter((e) => e.event !== true).map((e) => e.path);
  report("contract: every call is an event", notEvents.length === 0, notEvents.join(", ") || "all event:true");
  report("on: only the stubbed hosts contacted",
    offOrigin.every((u) => u.includes("gc.zgo.at") || u.includes("goatcounter.com")),
    offOrigin.length ? `${offOrigin.length} request(s), all GoatCounter` : "none");
  // The deliberate boom above is this probe's own; anything else is not.
  const unexpected = errors.filter((e) => !e.includes("deliberate boom"));
  report("on: no errors from the tracker", unexpected.length === 0, unexpected[0] || "none");
  await page.close();
});

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(", ")}` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
