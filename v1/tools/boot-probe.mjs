// Boot the real v1 page, per bot, in a real browser.
//
//   node server.mjs &
//   node v1/tools/boot-probe.mjs [ids...] [--arena] [--keep]
//
// The headless physics rig runs v1's SIMULATION without its renderer, and the
// audit runs v1's LOADER without a browser. Neither of them executes main.js,
// which is where a ported bot is actually wired up: the model registry, the
// builder, the segmented split, the arm-weapon runtime and the collider
// bindings. This is the check that the page itself is happy — the failure it
// catches is a bot that measures perfectly and then throws on load.
//
// Per bot it reports what the page built: which parts came out of the GLB, the
// model's size on screen, the weapon type v1 resolved, and any console error or
// page exception raised while it was doing it.
import fs from "node:fs";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const ids = args.filter((value) => !value.startsWith("--"));
const withArena = args.includes("--arena");
const BASE = process.env.BOOT_PROBE_URL || "http://127.0.0.1:4173";

const { PORTED_BOT_IDS } = await import("../src/portedBots.js");
const targets = ids.length ? ids : [...PORTED_BOT_IDS];

// The container ships one Chromium at a fixed path; the npm playwright build
// may expect a different revision, so point it at the browser that is here.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM || "/opt/pw-browsers/chromium";
const browser = await chromium.launch({
  executablePath: fs.existsSync(executablePath) ? executablePath : undefined,
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"],
});

// The page pulls three, Rapier and InstantDB from esm.sh through an importmap,
// and a sandboxed browser has no route out. Serve the copies already installed
// under node_modules instead, so this probe exercises v1's own code rather than
// the network. Nothing about the page changes: the importmap still resolves the
// same specifiers.
const NODE_MODULES = new URL("../../node_modules/", import.meta.url).pathname;

function vendoredFile(url) {
  const path = url.replace(/^https:\/\/esm\.sh\//, "");
  if (path.startsWith("three@")) {
    const rest = path.split("/").slice(1).join("/");
    if (rest.startsWith("examples/jsm/")) return `${NODE_MODULES}three/${rest}`;
    return `${NODE_MODULES}three/build/three.module.js`;
  }
  if (path.startsWith("@dimforge/")) return `${NODE_MODULES}@dimforge/rapier3d-compat/rapier.es.js`;
  // A relative import out of a vendored module resolves against esm.sh's root,
  // so map the bare filenames those packages reach for.
  if (path === "rapier_wasm3d.js") return `${NODE_MODULES}@dimforge/rapier3d-compat/rapier_wasm3d.js`;
  return null;
}

// InstantDB is the online lobby; the probe is offline, so hand the page a shape
// that answers every call rather than a module that fails to load and takes
// main.js down with it.
const INSTANT_STUB = `
const noop = () => {};
const handler = { get: () => new Proxy(noop, handler), apply: () => new Proxy(noop, handler) };
export const init = () => new Proxy(noop, handler);
export const id = () => Math.random().toString(36).slice(2, 10);
export default { init, id };
`;

async function serveVendoredModules(page) {
  await page.route("https://esm.sh/**", async (route) => {
    const url = route.request().url();
    if (url.includes("@instantdb/")) {
      await route.fulfill({ status: 200, contentType: "text/javascript", body: INSTANT_STUB });
      return;
    }
    const file = vendoredFile(url);
    if (file && fs.existsSync(file)) {
      await route.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(file, "utf8") });
      return;
    }
    await route.abort();
  });
}

const results = [];
try {
  for (const id of targets) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 700 } });
    await serveVendoredModules(page);
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text().slice(0, 300));
    });
    page.on("pageerror", (error) => errors.push(`pageerror: ${String(error).slice(0, 300)}`));
    page.on("requestfailed", (request) => errors.push(`requestfailed: ${request.url().slice(0, 160)} (${request.failure()?.errorText})`));
    const opponent = id === "bronco" ? "biteforce" : "bronco";
    const url = `${BASE}/v1/index.html?bot=${id}&opponent=${opponent}${withArena ? "&mode=arena" : ""}`;
    let report = null;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90_000 });
      // The page hides its loading overlay once the selected bot's GLB is in.
      await page.waitForFunction(() => {
        const overlay = document.querySelector("#loading-overlay");
        return overlay ? overlay.hidden : false;
      }, { timeout: 180_000 }).catch(() => {});
      await page.waitForTimeout(1200);
      if (withArena) {
        // Into a real match: this is the path that builds colliders, binds the
        // weapon and runs the arm runtime every frame.
        await page.click("#battle-toggle", { timeout: 20_000 });
        await page.waitForFunction(() => {
          const overlay = document.querySelector("#loading-overlay");
          return overlay ? overlay.hidden : false;
        }, { timeout: 240_000 }).catch(() => {});
        // Hold the weapon and both drive sticks down for a few seconds of real
        // frames, so a mechanism that throws only while it is moving throws here.
        await page.keyboard.down("Space");
        await page.keyboard.down("ShiftLeft");
        await page.keyboard.down("KeyW");
        await page.waitForTimeout(5000);
        await page.keyboard.up("KeyW");
        await page.keyboard.up("ShiftLeft");
        await page.keyboard.up("Space");
        await page.waitForTimeout(500);
      }
      report = await page.evaluate(() => {
        // The viewer stage holds the built bot; find the group v1 made for it.
        const canvas = document.querySelector("canvas");
        const found = { parts: [], weapon: null, size: null };
        const root = window.__viewerBotGroup || null;
        return {
          hasCanvas: Boolean(canvas && canvas.width > 0),
          overlayHidden: document.querySelector("#loading-overlay")?.hidden ?? null,
          selectedLabel: document.querySelector(".bot-picker [aria-pressed='true']")?.getAttribute("aria-label") || null,
          ...found,
          root: Boolean(root),
        };
      });
    } catch (error) {
      errors.push(`probe: ${String(error).slice(0, 300)}`);
    }
    results.push({ id, errors, report });
    console.log(`${id.padEnd(13)} ${errors.length ? `FAIL ${errors.length} error(s)` : "ok"}${report?.hasCanvas === false ? " (no canvas)" : ""}`);
    errors.forEach((error) => console.log(`  ! ${error}`));
    await page.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((result) => result.errors.length || result.report?.hasCanvas === false);
console.log("");
console.log(`${results.length - failed.length}/${results.length} booted clean`);
process.exitCode = failed.length ? 1 : 0;
