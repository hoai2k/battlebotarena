// Arena constants for the v2 sim, copied from v1 src/arenaConfig.js ARENA_LAYOUT.
// Distances in feet, angles in degrees where noted, speeds in ft/s or rad/s.
// The sim builds all arena colliders from these numbers; visuals (engine layer)
// should read getHazardState() rather than duplicating them.

export const GRAVITY_Y = -32.174; // ft/s^2, matches v1 feet units

export const ARENA = {
  width: 48, // x extent (v1 dimensions.width)
  length: 48, // z extent (v1 dimensions.length)
  floorY: 0,
  // The slab's TOP is at y=0 whatever this is — world.js centres it at
  // -floorHalfHeight — so this is depth below the driving surface and nothing
  // else. v1 shipped 0.05, a 0.1ft skin, and that was a trap.
  //
  // sim/vehicle.js recovers a bot that has been driven into the floor by
  // relying on a SOLID raycast that starts inside the slab reporting a
  // time-of-impact of 0, which reads as full compression and pushes the corner
  // back out. That recovery only works while a probe anchor is still inside the
  // slab. Through a 0.1ft skin a bot clears it in a single step — 250lb taking
  // a hard downward hit moves further than that in 1/60s — and once every
  // anchor is underneath, the probes cast down into empty space, the suspension
  // reads airborne, the drive cuts out and there is no force left that can ever
  // bring it back up. HUGE did exactly that and sat a foot under the floor,
  // wheels buried, throttle doing nothing.
  //
  // 2.0 gives the existing recovery four feet of slab to catch an anchor in. A
  // static cuboid costs nothing to make deeper, and a bot further under than
  // that is beyond saving anyway.
  floorHalfHeight: 2.0,
  ceilingHeight: 9.45, // v1 dimensions.ceilingHeight
  wallThickness: 0.5,
};

// ---------------------------------------------------------------- spawn boxes
//
// yaw 0 faces -Z. Spawn HEIGHT is computed by the sim from each bot's
// suspension rest height, so a layout is only ever a floor position and a
// facing. `color` rides along because the arena paints a decal under each one
// (engine/arenaVisuals.js) and the box you start on is how a player finds
// their own machine in the first second of a four-way.
//
// The 2-bot poses are v1's startBox elements (player z 19 yaw 0, rival z -18.7
// yaw 180) and must not move: every camera angle, every AI approach and every
// tuned opening exchange in the game was measured from them.

const RED = "#e1322a";
const BLUE = "#3aa9e8";
const PURPLE = "#a45cf0";

/** Half-extents of a start-box decal, in feet (v1 startBox sizes). */
export const SPAWN_BOX = { x: 5.2, z: 4.7 };

const SPAWN_2 = [
  { x: 0, z: 19, yaw: 0, color: RED },
  { x: 0, z: -18.7, yaw: Math.PI, color: BLUE },
];

// THREE BOTS. The two originals stay exactly where they are and a third box
// goes on the west wall, in front of the one screw that is not the upper deck's
// — SCREWS.list[0] at x -23.15 — at the same stand-off from its screw as the
// other two have from theirs (~3.9ft toward the middle). Facing +X, so the new
// machine looks at the upper deck across the arena from the side opposite the
// deck's own screw, which is the mirror of what the other two boxes look at.
const SPAWN_3 = [
  ...SPAWN_2,
  { x: -19.3, z: 0.8, yaw: -Math.PI / 2, color: PURPLE },
];

// FOUR BOTS. Two a side rather than one, so nobody spawns nose-to-nose with
// two machines at once. Out to x +-12 — halfway from the middle to each side
// wall — which also takes them off the end screws (those only span x -5.5..6.3),
// and with no screw in front of them any more they sit 2ft further back toward
// their own wall than the head-to-head boxes do. Reds face -Z, blues +Z; the
// pairs are DIAGONAL so P1 and P2 still open the round looking at each other.
const SPAWN_4 = [
  { x: -12, z: 21, yaw: 0, color: RED },
  { x: 12, z: -21, yaw: Math.PI, color: BLUE },
  { x: 12, z: 21, yaw: 0, color: RED },
  { x: -12, z: -21, yaw: Math.PI, color: BLUE },
];

/** Every supported layout, by how many machines are in the box. */
export const SPAWN_SETS = { 2: SPAWN_2, 3: SPAWN_3, 4: SPAWN_4 };

export const MAX_BOTS = 4;

/**
 * The start boxes for a match of `count` machines. Anything outside 2..4 is
 * clamped rather than refused: a caller that gets this wrong should put bots on
 * the floor facing each other, not throw in the middle of match setup.
 */
export function spawnsFor(count) {
  return SPAWN_SETS[Math.min(MAX_BOTS, Math.max(2, count | 0))];
}

/** The head-to-head pair, still the default everywhere that has no count. */
export const SPAWNS = SPAWN_2;

// v1 upper-deck element: position (18.4, -0.2), size 9.9 x 15.8. Height and ramp
// length are v2 choices (v1 kept them in mesh data); the ramp descends toward -x.
export const UPPER_DECK = {
  x: 18.4,
  z: -0.2,
  sizeX: 9.9,
  sizeZ: 15.8,
  height: 1.55,
  rampLength: 6.5,
};

// Kill saws: v1 killSawHazards constants + the deduped killSaw element list
// (v1 kill-saw-5/6 are exact duplicates; one copy kept). All slots are 1.82 x 0.82,
// giving bladeRadius = clamp(0.55 * 0.91, 0.52, 0.82) = 0.52.
export const KILL_SAWS = {
  rotationSpeed: 30, // rad/s blade spin (visual + grind direction)
  riseSeconds: 0.42,
  sinkSeconds: 0.42,
  holdSeconds: 1.1, // v1 randomizes hold; v2 uses fixed + per-saw phase offsets
  downSeconds: 1.0,
  phaseStagger: 0.4, // seconds between adjacent saws' cycles
  stowedDepth: 0.08,
  bladeThickness: 0.12,
  bladeRadius: 0.52,
  exposureFraction: 0.5, // fraction of blade *diameter* above the floor when risen
  slots: [
    { x: -16.094, z: -5.354, yawDeg: 0 },
    { x: -16.094, z: -7.1, yawDeg: 0 },
    { x: -9.459, z: -11.077, yawDeg: 90 },
    { x: -7.8, z: -11.077, yawDeg: 270 },
    { x: -16.094, z: 7.277, yawDeg: 0 },
    { x: -16.094, z: 5.323, yawDeg: 0 },
    { x: -9.459, z: 11.077, yawDeg: 270 },
    { x: -7.9, z: 11.077, yawDeg: 90 },
    { x: 7.9, z: 11.077, yawDeg: 90 },
    { x: 9.459, z: 11.077, yawDeg: 270 },
    { x: 7.8, z: -11.077, yawDeg: 270 },
    { x: 9.459, z: -11.077, yawDeg: 90 },
  ],
};

// Screws: v1 screwHazards constants + screw elements. Each is a kinematic
// cylinder lying along its slot direction (yawDeg rotates the +x axis).
export const SCREWS = {
  rotationSpeed: 5.2, // rad/s about the long axis
  radius: 0.56, // v1 minBladeRadius (bladeRadiusScale * 0.78 clamps up to this)
  axisY: 0.46, // v1 minAxisY
  friction: 1.3, // high so the spinning surface conveys bots
  list: [
    { x: -23.153, z: 0.8, yawDeg: 270, length: 13.5 },
    { x: 12.9, z: -0.185, yawDeg: 90, length: 15.5 },
    { x: -0.1, z: -22.7, yawDeg: 180, length: 11.8 },
    { x: 0.4, z: 22.7, yawDeg: 0, length: 11.8 },
  ],
};
