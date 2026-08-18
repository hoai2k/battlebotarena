// Menu pad input, checked against the thing that actually breaks it: a screen
// that is too busy to draw. A gamepad has no events — a press exists only in
// the samples that catch it — and bot select renders four lit 3D bays, so its
// animation frames arrive seconds apart on a slow GPU. Anything that samples
// the pad per animation frame drops whole presses there, which looked like
// "player two's pick sometimes does not register".
//
// Drives fake pads through window.__bba2Select() (ui.js dev hook):
//   node server.mjs &
//   node tools/menu-input-probe.mjs
//
// Checks, in order:
//   taps     — a brisk tap from every pad claims a bot, N players, N times
//   wake     — the press that WAKES a controller (the browser hides a pad until
//              a button is pressed on it) joins without also picking a bot
//   stick    — a pad that has only ever moved its stick still browses
import { chromium } from "playwright";

const URL = process.env.BBA_URL || "http://localhost:4173/index.html";
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--no-sandbox"];

const browser = await chromium.launch({ executablePath: CHROME, args: ARGS });
const failures = [];
const report = (name, ok, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(34)} ${detail}`);
  if (!ok) failures.push(name);
};

/** A page with `pads` fake controllers, sitting on the bot select screen.
 *  `gated` reproduces the browser withholding pads until a button is pressed. */
async function botSelect(pads, { gated = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 900, height: 560 } });
  await page.addInitScript(([n, gate]) => {
    const mk = (i) => ({
      index: i, id: `Fake Pad ${i}`, connected: true, mapping: "standard",
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      timestamp: 0,
    });
    const list = Array.from({ length: n }, (_, i) => mk(i));
    window.__pads = list;
    window.__gated = gate;
    navigator.getGamepads = () => {
      if (window.__gated) {
        if (!list.some((p) => p.buttons.some((b) => b.pressed))) return [];
        window.__gated = false;
      }
      return list;
    };
  }, [pads, gated]);
  await page.goto(URL);
  await page.waitForFunction("window.__bba2 !== undefined", null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.click("#btn-title-fight");
  await page.waitForTimeout(700);
  const set = (player, mutate) => page.evaluate(([i, fn]) => {
    // eslint-disable-next-line no-new-func
    new Function("pad", fn)(window.__pads[i]);
  }, [player, mutate]);
  return {
    page,
    state: () => page.evaluate(() => window.__bba2Select()),
    async tap(player, button = 0, holdMs = 60) {
      await set(player, `pad.buttons[${button}].pressed = true;`);
      await page.waitForTimeout(holdMs);
      await set(player, `pad.buttons[${button}].pressed = false;`);
      await page.waitForTimeout(300);
    },
    async stick(player, x, y) {
      await set(player, `pad.axes[0] = ${x}; pad.axes[1] = ${y};`);
      await page.waitForTimeout(400);
      await set(player, "pad.axes[0] = 0; pad.axes[1] = 0;");
      await page.waitForTimeout(200);
    },
  };
}

// --- taps: every player's brisk tap lands, however slowly the screen draws ---
for (const players of [2, 3]) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const sel = await botSelect(players);
    for (let p = 0; p < players; p += 1) await sel.tap(p);
    const state = await sel.state();
    report(
      `taps: ${players} players claim (run ${attempt})`,
      state.picks.every(Boolean) && state.fightEnabled,
      JSON.stringify(state.picks),
    );
    await sel.page.close();
  }
}

// --- wake: the press that reveals the pad joins, it does not pick ---
{
  const sel = await botSelect(2, { gated: true });
  const before = await sel.state();
  await sel.tap(0);
  const after = await sel.state();
  report("wake: press joins without picking", before.playerCount === 0 && after.playerCount === 2
    && after.picks.every((p) => p === null), `${before.playerCount} -> ${after.playerCount} players, picks ${JSON.stringify(after.picks)}`);
  // And the NEXT press is a real pick.
  await sel.tap(0);
  const picked = await sel.state();
  report("wake: the next press picks", Boolean(picked.picks[0]), JSON.stringify(picked.picks));
  await sel.page.close();
}

// --- stick: a pad that has never pressed a button still browses ---
{
  const sel = await botSelect(2);
  const before = await sel.state();
  await sel.stick(1, 1, 0);
  const after = await sel.state();
  report("stick: moves a player's browse", before.browsing[1] !== after.browsing[1] && Boolean(after.browsing[1]),
    `${before.browsing[1]} -> ${after.browsing[1]}`);
  await sel.page.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED: ${failures.join(", ")}` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
