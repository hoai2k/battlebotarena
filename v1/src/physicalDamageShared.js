export const PHYSICAL_DAMAGE_SYNC_NOTE =
  "Physical damage collider/fill behavior is mirrored in main.js and colliderTweaker.js; update both host integrations together.";

// Cake volume contract:
// - Treat GLB meshes as the visible outer shell of a solid bot, not as hollow surfaces.
// - Break caps should seal the exact break loop on both the remaining bot and debris.
// - Generated interior cap points may be clamped inside the logical cake volume; the boundary loop should not be moved.
// - The cake bottom comes from original body physics colliders only, excluding drive contacts, cylinders, weapon, and sensors.
// - The top is the mesh shell height at each X/Z point: a raycast from above
//   should hit the visible geometry there. If no ray hit is found inside the
//   shell bounds, interpolate from nearby mesh triangles instead of using the
//   global bounding-box top.
// - For vertical/top-style breaks, the break loop edge is the local roof:
//   generated interior cap rings should move down/inward from those edge
//   heights instead of raycasting every generated point or letting the cap grow
//   upward above the shell.
// - The front/back/left/right limits come from the target mesh shell and the break border.
// Keep the main game and collider tweaker fallback fill logic aligned with these rules.
export const PHYSICAL_DAMAGE_FILL = {
  searchRadiusMin: 0.65,
  localPatchRadiusScale: 0.55,
  localPatchRadiusMin: 0.16,
  localPatchRadiusMax: 0.42,
  cakeBoundsExpand: 0.025,
  cakeFloorOffset: 0.006,
  cutInsetFactor: 0.38,
  cutInsetMin: 0.04,
  bodySurfaceOffset: 0.01,
  sharedSurfaceOffset: 0.004,
  mainBodyPatchInflate: 1.08,
  tweakerBodyPatchInflate: 1.18,
  maxSourceParts: 8,
};

export const PHYSICAL_DAMAGE_COLLIDER_CARVE = {
  radiusMin: 0.24,
  radiusScale: 0.62,
  splitPatchRadiusScale: 1.35,
  subtractBoxExpand: 0.04,
  bodyCutPlaneFactor: 0.34,
  driveCutPlaneFactor: 0.72,
  bodyMinHalf: 0.12,
  driveMinHalf: 0.035,
  bodyMinWidthRatio: 0.48,
  driveMinWidthRatio: 0.12,
  bodySurfaceScoreMin: 0.55,
  driveSurfaceScoreMin: 0.35,
  forcedNearestSurfaceScoreMin: 0.62,
  forcedNearestHalfFactor: 0.24,
};
