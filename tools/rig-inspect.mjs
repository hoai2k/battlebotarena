// Measure a catalog bot in GAME space, through the game's own loader, with the
// model grounded. Every rig number in the catalog — modelYaw, modelRoll,
// modelScale, bodyDims, weapon.pivot, weapon.radius, restAngle/fireAngle,
// collider extents — should come from here rather than from the GLB's own
// coordinates or from a segmentation note.
//
//   node server.mjs &                     # the page loads from localhost:4173
//   node tools/rig-inspect.mjs <ids> [outDir] [views] [flags]
//
//   ids      comma-separated catalog ids
//   views    comma-separated: side front back iso top low   (default side,iso)
//
//   --tint             weapon red, nested sub orange, wheels blue, aux green
//   --colliders        draw spec.colliders as green wireframes
//   --sweep            draw the weapon's swept circle at its pivot
//   --solo <part>      show only weapon | body | wheels | aux
//   --part <name>      highlight one tripo_part_N red and grey everything else
//   --axle [name]      best-fit spin axle + swept radius for the weapon (or one part)
//   --arm <angle>      pose the arm at one angle before shooting
//   --arc <from,to,step>  sweep the arm and print a table (no screenshots)
//   --toglb <x,y,z>    convert a game-space point into the GLB's own space,
//                      which is the space tools/glb-carve.mjs regions are in
//
// It also prints a Z and a Y occupancy profile of the body: which slabs carry
// geometry, how tall each is and how wide. That is what a collider stack gets
// authored from, and it is how a hollow shell or a nose held off the floor
// shows up as a number instead of as a hunch.
import { chromium } from "playwright";
import fs from "node:fs";

const has = (name) => process.argv.includes(name);
const opt = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const positional = (index, fallback) => {
  const v = process.argv[index];
  return v && !v.startsWith("--") ? v : fallback;
};

const ids = (process.argv[2] || "").split(",").filter(Boolean);
const outDir = positional(3, "/tmp/rig-inspect");
const views = positional(4, "side,iso").split(",").filter(Boolean);
const arc = opt("--arc");
const armAngle = opt("--arm");
const toGlb = opt("--toglb");
const solo = opt("--solo");
const screenshots = !arc;
if (screenshots) fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-gpu-sandbox", "--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 760, height: 600 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://localhost:4173/tools/rig-inspect.html");
await page.waitForFunction("window.__ready === true", null, { timeout: 60000 });

const f = (n) => (typeof n === "number" ? n.toFixed(3) : String(n));
const report = {};
for (const id of ids) {
  const r = await page.evaluate((i) => window.__load(i), id);
  report[id] = r;

  console.log(`\n=== ${id}  yaw=${f(r.modelYaw)} roll=${f(r.modelRoll)} scale=${r.modelScale} ===`);
  const box = (label, b) => b && console.log(
    `  ${label.padEnd(13)} x[${f(b.min[0])},${f(b.max[0])}] y[${f(b.min[1])},${f(b.max[1])}]`
    + ` z[${f(b.min[2])},${f(b.max[2])}]  size ${b.size.map(f).join(" x ")}`,
  );
  box("all", r.all);
  box("body", r.body);
  if (r.bodyIsPlaceholder) console.log("  !! BODY IS PLACEHOLDER — the GLB did not load");
  if (r.weaponIsPlaceholder) console.log("  !! WEAPON IS PLACEHOLDER — no modelWeapon node");
  console.log(`  catalog bodyDims ${f(r.bodyDims.x)} x ${f(r.bodyDims.y)} x ${f(r.bodyDims.z)}`);
  if (r.weapon) {
    console.log(`  weaponPivot ${r.weaponPivot.map(f).join(", ")}`);
    box("weapon", r.weapon);
    console.log(`  sweptRadius ${f(r.swept.radius)} (catalog ${f(r.catalogRadius)})  farthest ${r.swept.far.map(f).join(", ")}`);
    (r.weaponMeshes || []).forEach((mesh) => box(`  ${mesh.name}`, mesh.box));
  }
  if (r.weaponSub) { console.log(`  sub @ ${r.weaponSub.world.map(f).join(", ")}`); box("sub", r.weaponSub.box); }
  for (const [name, a] of Object.entries(r.aux || {})) {
    console.log(`  aux ${name} @ ${a.pos.map(f).join(", ")}`);
    box("  box", a.box);
  }
  r.wheels.forEach((w, i) => console.log(
    `  wheel${i} @ ${w.pos.map(f).join(", ")} -> probe ${w.spinIndex}  size ${w.box ? w.box.size.map(f).join(" x ") : "?"}`,
  ));

  const showProfile = (p, axis) => {
    if (!p) return;
    const max = Math.max(...p.counts);
    console.log(`  body ${axis} profile ${f(p.lo)} -> ${f(p.hi)}`);
    p.counts.forEach((c, i) => {
      const t = p.lo + (i + 0.5) * (p.hi - p.lo) / p.bins;
      const bar = "#".repeat(Math.round((c / max) * 24));
      const other = axis === "Z" ? `yTop=${f(p.oMax[i])} yBot=${f(p.oMin[i])}` : `zFwd=${f(p.oMin[i])} zAft=${f(p.oMax[i])}`;
      console.log(`    ${axis}=${f(t).padStart(7)} ${bar.padEnd(24)} ${other} |x|<=${f(Math.max(Math.abs(p.xMin[i]), Math.abs(p.xMax[i])))}`);
    });
  };
  showProfile(r.profileZ, "Z");
  showProfile(r.profileY, "Y");

  if (toGlb) {
    const g = await page.evaluate((q) => window.__toGlb(q), toGlb.split(",").map(Number));
    console.log(`  game ${toGlb} -> GLB ${g.map((n) => n.toFixed(4)).join(", ")}`);
  }

  if (arc) {
    const [from, to, step] = arc.split(",").map(Number);
    console.log("  angle    armYmin  armYmax  armZmin  armZmax");
    for (let a = from; a <= to + 1e-9; a += step) {
      const s = await page.evaluate((v) => window.__armAt(v), Number(a.toFixed(4)));
      const b = s.box;
      console.log(
        `  ${a.toFixed(2).padStart(6)}  ${b.min[1].toFixed(3).padStart(7)}  ${b.max[1].toFixed(3).padStart(7)}`
        + `  ${b.min[2].toFixed(3).padStart(7)}  ${b.max[2].toFixed(3).padStart(7)}`,
      );
    }
    continue;
  }

  const partList = await page.evaluate(() => window.__parts());
  const owners = {};
  for (const m of partList) (owners[m.owner] ||= []).push(m.name);
  for (const [owner, names] of Object.entries(owners)) {
    console.log(`  ${owner.padEnd(10)} ${names.join(" ")}`);
  }

  const axleOf = opt("--axle");
  if (axleOf !== null) {
    const a = await page.evaluate((n) => window.__axle(n || null), axleOf === "" ? null : axleOf);
    if (a) console.log(`  best-fit axle ${a.axle.map(f).join(", ")}  radius ${f(a.radius)}`);
  }

  if (has("--lowest")) {
    const lo = await page.evaluate(() => window.__lowest());
    if (lo) console.log(`  weapon lowest vertex ${lo.map(f).join(", ")}`);
  }
  const subArc = opt("--subarc");
  if (subArc) {
    const [from, to, step] = subArc.split(",").map(Number);
    console.log("  sub      Ymin     Ymax     Zmin     Zmax");
    for (let a = from; a <= to + 1e-9; a += step) {
      const r = await page.evaluate((v) => window.__subAt(v), Number(a.toFixed(4)));
      if (!r) break;
      const b = r.box;
      console.log(`  ${a.toFixed(2).padStart(6)}  ${b.min[1].toFixed(3).padStart(7)}  ${b.max[1].toFixed(3).padStart(7)}`
        + `  ${b.min[2].toFixed(3).padStart(7)}  ${b.max[2].toFixed(3).padStart(7)}`);
    }
  }
  const subAt = opt("--sub");
  if (subAt !== null) await page.evaluate((v) => window.__subAt(Number(v)), subAt);

  const part = opt("--part");
  if (part) await page.evaluate((n) => window.__part(n, "highlight"), part);
  if (has("--colliders")) await page.evaluate(() => window.__colliders(true));
  if (has("--sweep")) await page.evaluate(() => window.__sweep(true));
  if (has("--tint")) await page.evaluate(() => window.__tint(true));
  if (solo) await page.evaluate((w) => window.__solo(w), solo);
  if (armAngle !== null) {
    const s = await page.evaluate((v) => window.__armAt(v), Number(armAngle));
    console.log(`  arm @ ${armAngle}: y[${f(s.box.min[1])},${f(s.box.max[1])}] z[${f(s.box.min[2])},${f(s.box.max[2])}]`);
  }
  for (const v of views) {
    await page.evaluate((n) => window.__view(n), v);
    await page.screenshot({ path: `${outDir}/${id}-${v}.png` });
  }
}
await browser.close();
if (screenshots) {
  fs.writeFileSync(`${outDir}/report.json`, JSON.stringify(report, null, 1));
  console.log(`\nscreenshots + report.json -> ${outDir}`);
}
