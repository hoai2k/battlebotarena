// Track bands for tracked bots.
//
// WHY THIS EXISTS, because the obvious approach is the one that does not work.
//
// The first attempt scrolled the track unit's TEXTURE: offset the material's UVs
// by the accumulated wheel rotation and let the tread appear to travel. That
// cannot work on these assets, and the reason is worth writing down.
//
// Dragon King's two track units are ONE MESH EACH — tripo_part_6 and _7, 69k and
// 67k vertices, road wheels and sprockets and frame and band all baked together
// by the scan with a single material. There is no track-band geometry to address
// separately. Worse, the unwrap is a photogrammetry atlas: measured over the
// outer envelope of a pod, the correlation between UV and angle around the track
// loop is -0.21 in u and -0.29 in v, i.e. neither axis runs along the band. It is
// not a bad axis choice or a bad scale — adjacent triangles land in unrelated
// corners of the atlas, so ANY uniform offset moves the texture in a different
// direction on every triangle. On screen that is a smear that crawls across the
// wheels and the frame as readily as the track, which is exactly what it looked
// like. Rusty was worse: its config named no aux node, so the scroll walked
// modelBody and dragged the whole robot's textures around.
//
// So the band is built, not borrowed. A tensioned track is taut around the
// outside of its road wheels, which means its path IS the convex hull of the
// unit's silhouette — that is not an approximation, it is what tension does. The
// hull of Dragon King's pod comes out as a rounded rectangle with flat top and
// bottom runs and a sprocket radius at each end, which is a tank track. A ribbon
// is swept along it with UVs that mean something: u is distance travelled around
// the loop, v is across the width. Then scrolling u is the band moving along
// itself, it wraps seamlessly because the loop is closed, and it cannot touch
// the wheels because it is not the wheels' geometry.

import * as THREE from "three";

const SEGMENTS = 160; // samples around the loop; the hull is smooth by then
const OUTSET = 0.004; // fraction of perimeter the band sits proud of the hull
const WIDTH_INSET = 0.82; // of the unit's width, so the band reads inside the frame
const TREAD_FT = 0.32; // ground travel per tread plate; the tile IS one plate

/** Convex hull of 2D points (monotone chain). The taut path around the wheels. */
function hull2d(points) {
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Resample a closed polygon to `count` points at even arc length. */
function resample(loop, count) {
  const segs = loop.map((p, i) => {
    const q = loop[(i + 1) % loop.length];
    return { p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) };
  });
  const total = segs.reduce((sum, s) => sum + s.len, 0);
  const out = [];
  let seg = 0;
  let used = 0;
  for (let i = 0; i < count; i++) {
    let want = (i / count) * total;
    while (seg < segs.length - 1 && used + segs[seg].len < want) { used += segs[seg].len; seg++; }
    const t = segs[seg].len > 0 ? (want - used) / segs[seg].len : 0;
    out.push([
      segs[seg].p[0] + (segs[seg].q[0] - segs[seg].p[0]) * t,
      segs[seg].p[1] + (segs[seg].q[1] - segs[seg].p[1]) * t,
    ]);
  }
  return { points: out, perimeter: total };
}

/**
 * A looping tread strip. Cleats run ACROSS the band, so they read as plates
 * crossing the track and the seam at u=1 meets u=0 exactly.
 */
function treadTexture(color) {
  // One plate per tile, so TREAD_FT means what it says. A tile holding four
  // plates quadruples the count for free and the tread comes out as fine ribs.
  const w = 16;
  const h = 16;
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
  if (!canvas) return null;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const base = new THREE.Color(color);
  const dark = base.clone().multiplyScalar(0.25);
  const light = base.clone().multiplyScalar(2.1);
  // The gap between plates is what makes the direction of travel readable, so
  // it is drawn as a real shadow line rather than left to the lighting.
  ctx.fillStyle = `#${dark.getHexString()}`;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = `#${base.getHexString()}`;
  ctx.fillRect(2, 0, w - 4, h);
  ctx.fillStyle = `#${light.getHexString()}`;
  ctx.fillRect(2, 0, 2, h);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 4;
  return texture;
}

/**
 * Build a band around one track unit mesh and add it alongside that mesh, so it
 * inherits the same transform without the caller having to know where the unit
 * ended up after normalization.
 * @returns {{material: THREE.Material, map: THREE.Texture, repeats: number, perimeterFt: number}|null}
 */
function bandFor(mesh, spec) {
  const pos = mesh.geometry?.getAttribute("position");
  if (!pos) return null;
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  const size = box.getSize(new THREE.Vector3());
  // Which axis the sprocket axles run along — i.e. the width of the tread. It is
  // configured, not inferred, because no cheap rule gets it right: Dragon King's
  // pod is 0.356 across, 0.137 tall and 0.514 long, so "the thinnest axis" picks
  // its HEIGHT and sweeps the band around the plan view instead of the track
  // loop, which comes out as a slab the size of the whole pod. The loop is the
  // plane the hull looks like a track in — flat runs top and bottom, a sprocket
  // radius at each end — and on this bot that is (z, y).
  const wide = spec.tracks?.widthAxis ?? "x";
  const [a, b] = ["x", "y", "z"].filter((k) => k !== wide);

  const flat = [];
  for (let i = 0; i < pos.count; i++) flat.push([pos.getComponent(i, "xyz".indexOf(a)), pos.getComponent(i, "xyz".indexOf(b))]);
  const loop = hull2d(flat);
  if (loop.length < 8) return null;
  const { points, perimeter } = resample(loop, SEGMENTS);

  // Push the band out along the hull's own outward normal so it sits on the
  // surface of the unit rather than inside it.
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  const outset = perimeter * OUTSET;
  const ring = points.map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * outset, y + (dy / len) * outset, dx / len, dy / len];
  });

  const halfWidth = (size[wide] / 2) * WIDTH_INSET;
  const midWide = (box.min[wide] + box.max[wide]) / 2;
  const scale = spec.modelScale ?? 1;
  const perimeterFt = perimeter * scale;
  const repeats = Math.max(1, Math.round(perimeterFt / TREAD_FT));

  const verts = [];
  const norms = [];
  const uvs = [];
  const index = [];
  const put = (p, side, u) => {
    const v = { x: 0, y: 0, z: 0 };
    v[a] = p[0];
    v[b] = p[1];
    v[wide] = midWide + side * halfWidth;
    verts.push(v.x, v.y, v.z);
    const n = { x: 0, y: 0, z: 0 };
    n[a] = p[2];
    n[b] = p[3];
    norms.push(n.x, n.y, n.z);
    uvs.push(u, side > 0 ? 1 : 0);
  };
  for (let i = 0; i <= SEGMENTS; i++) {
    const p = ring[i % SEGMENTS];
    const u = (i / SEGMENTS) * repeats;
    put(p, -1, u);
    put(p, 1, u);
  }
  for (let i = 0; i < SEGMENTS; i++) {
    const k = i * 2;
    index.push(k, k + 1, k + 3, k, k + 3, k + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(norms, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);

  const map = treadTexture(spec.tracks?.tint ?? spec.accentDark ?? "#20242a");
  const material = new THREE.MeshStandardMaterial({
    map,
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.15,
    side: THREE.DoubleSide,
  });
  const band = new THREE.Mesh(geometry, material);
  band.name = `trackBand:${mesh.name}`;
  band.castShadow = mesh.castShadow;
  (mesh.parent ?? mesh).add(band);
  band.position.copy(mesh.position);
  band.quaternion.copy(mesh.quaternion);
  band.scale.copy(mesh.scale);
  return { material, map, repeats, perimeterFt };
}

/**
 * Attach bands to every track unit named by spec.tracks.parts. Returns the list
 * for syncBotVisual to scroll; empty when the bot has no tracks or the named
 * meshes are not in the model (a placeholder bot, or a re-cut that renamed them).
 */
export function buildTrackBands(visual, spec) {
  const cfg = spec.tracks;
  if (!cfg?.parts?.length) return [];
  const bands = [];
  for (const name of cfg.parts) {
    const mesh = visual.group.getObjectByName(name);
    if (!mesh?.isMesh) continue;
    const band = bandFor(mesh, spec);
    if (band) bands.push(band);
  }
  return bands;
}

/**
 * Advance every band by the ground distance the bot has travelled. wheelSpin is
 * accumulated wheel rotation in radians, so the band and the bot agree about
 * speed for free — including while it is being shoved backwards.
 */
export function scrollTrackBands(bands, spec, wheelSpin) {
  if (!bands?.length) return;
  const spins = wheelSpin;
  const spin = spins?.length ? spins.reduce((a, b) => a + b, 0) / spins.length : 0;
  const feet = spin * (spec.wheelRadius ?? 0.35);
  for (const band of bands) {
    band.map.offset.x = -((feet / band.perimeterFt) * band.repeats) % band.repeats;
  }
}
