// Arena constants for the v2 sim, copied from v1 src/arenaConfig.js ARENA_LAYOUT.
// Distances in feet, angles in degrees where noted, speeds in ft/s or rad/s.
// The sim builds all arena colliders from these numbers; visuals (engine layer)
// should read getHazardState() rather than duplicating them.

export const GRAVITY_Y = -32.174; // ft/s^2, matches v1 feet units

export const ARENA = {
  width: 48, // x extent (v1 dimensions.width)
  length: 48, // z extent (v1 dimensions.length)
  floorY: 0,
  floorHalfHeight: 0.05, // v1 physicsFloorHalfHeight
  ceilingHeight: 9.45, // v1 dimensions.ceilingHeight
  wallThickness: 0.5,
};

// Spawn poses from v1 startBox elements (player z 19 yaw 0, rival z -18.7 yaw 180).
// yaw 0 faces -Z, so the two bots face each other. Spawn height is computed by
// the sim from each bot's suspension rest height.
export const SPAWNS = [
  { x: 0, z: 19, yaw: 0 },
  { x: 0, z: -18.7, yaw: Math.PI },
];

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
