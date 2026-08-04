// A circular saw blade, as geometry.
//
// The arena's kill saws are a photograph on a plane — public/arena/kill_saw_alpha.png
// on an alpha-tested quad, which is exactly right for something that spends most
// of the fight below the floor and is never seen edge-on. A blade bolted to a
// robot is seen from every angle, all the time, and a texture on a plane
// disappears when you look along it. So this is the same silhouette built as a
// solid: thirty hooked teeth, a concave gullet behind each one, and a bore.
//
// The shape is authored in the XY plane and extruded along +Z, because that is
// what THREE.ExtrudeGeometry does; the caller turns it to face its own axle.

import * as THREE from "three";

const TEETH = 30; // counted off kill_saw_alpha.png
const ROOT_SCALE = 0.76; // gullet depth: where the teeth stop and the plate starts
const BORE_SCALE = 0.1; // arbor hole
const RISE_SAMPLES = 5; // points along the back of each tooth
const HOOK = 0.80; // fraction of a tooth's pitch spent climbing to the tip

/**
 * Outline of one blade, tip to tip.
 *
 * Each tooth climbs from the gullet to the tip over most of its pitch and then
 * drops back on a steep face — that asymmetry is the whole reason a saw blade
 * reads as a saw blade rather than as a gear, and it is what says which way the
 * thing is turning. The climb is a power curve rather than a straight line, so
 * the gullet is scooped instead of chamfered.
 */
function bladeShape(radius, teeth) {
  const shape = new THREE.Shape();
  const root = radius * ROOT_SCALE;
  const pitch = (Math.PI * 2) / teeth;
  for (let i = 0; i < teeth; i++) {
    const base = i * pitch;
    for (let k = 0; k <= RISE_SAMPLES; k++) {
      const t = k / RISE_SAMPLES;
      const angle = base + t * pitch * HOOK;
      const r = root + (radius - root) * t ** 0.55;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      if (i === 0 && k === 0) shape.moveTo(x, y);
      else shape.lineTo(x, y);
    }
    // The cutting face: back down to the next gullet, undercut slightly so the
    // tooth leans forward into its own direction of travel.
    const next = base + pitch;
    shape.lineTo(Math.cos(next) * root, Math.sin(next) * root);
  }
  shape.closePath();

  const bore = new THREE.Path();
  bore.absarc(0, 0, radius * BORE_SCALE, 0, Math.PI * 2, true);
  shape.holes.push(bore);
  return shape;
}

/**
 * @param {object} opts
 * @param {number} opts.radius     swept radius, tip to centre, in feet
 * @param {number} opts.thickness  plate thickness in feet
 * @param {number} [opts.teeth]
 * @returns {THREE.ExtrudeGeometry} centred on the origin, faces along Z
 */
export function sawBladeGeometry({ radius, thickness, teeth = TEETH }) {
  const geometry = new THREE.ExtrudeGeometry(bladeShape(radius, teeth), {
    depth: thickness,
    bevelEnabled: true,
    // A hair of bevel, not a chamfer: it is what catches the arena lights along
    // the teeth. Without it the rim is a hard edge that goes black at any angle
    // where neither face is lit.
    bevelThickness: thickness * 0.18,
    bevelSize: thickness * 0.18,
    bevelSegments: 1,
    curveSegments: 8,
  });
  geometry.translate(0, 0, -thickness / 2); // spin about the plate's middle
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * The blade as a mesh, already turned so its face is perpendicular to `axis`.
 * The caller's group does the spinning, about that same axis, so the static
 * orientation has to live on the mesh — a group that both aims and spins cannot
 * do either.
 */
export function buildSawBlade({ radius, thickness, teeth, axis, material }) {
  const mesh = new THREE.Mesh(sawBladeGeometry({ radius, thickness, teeth }), material);
  mesh.name = "sawBlade";
  const to = new THREE.Vector3(axis?.x ?? 1, axis?.y ?? 0, axis?.z ?? 0).normalize();
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), to);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
