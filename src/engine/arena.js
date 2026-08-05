// Arena visuals: builds the BattleBox (arenaVisuals.js) from the layout data
// (arenaLayout.js) plus the hazard mesh factories (hazardElements.js), then
// mirrors the SIM's hazard state onto those meshes each frame — the sim owns
// all saw/screw motion, this module only reflects it.
import { createArenaVisualRoot } from "./arenaVisuals.js";
import { ARENA_LAYOUT } from "./arenaLayout.js";
import { createScrewHazardElement, createKillSawHazardElement, screwHazardRotationSpeed } from "./hazardElements.js";
import { spawnsFor, SPAWN_BOX } from "../sim/arenaSpec.js";

// Matches a sim hazard to its visual by arena position; the sim deduplicates
// some layout entries, so indices are not interchangeable.
function nearestByPosition(list, x, z, getPos) {
  let best = null;
  let bestDistance = Infinity;
  for (const item of list) {
    const pos = getPos(item);
    const distance = (pos.x - x) ** 2 + (pos.z - z) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = item;
    }
  }
  // Guard against a layout/spec mismatch silently animating the wrong hazard.
  return bestDistance <= 1.5 ? best : null;
}

/** A spawn pose plus the decal size every start box shares. */
const withBoxSize = (spawn) => ({ ...spawn, sizeX: SPAWN_BOX.x, sizeZ: SPAWN_BOX.z });

export function createArenaVisuals(scene) {
  const root = createArenaVisualRoot({
    layout: ARENA_LAYOUT,
    hazards: { createScrewHazardElement, createKillSawHazardElement },
    assetBase: "./",
  });
  scene.add(root);

  const killSawHazards = root.userData.killSawHazards || [];
  const screwCores = root.userData.hazards || [];
  const screwSpin = screwHazardRotationSpeed(ARENA_LAYOUT);
  let sawLinks = null;
  let screwLinks = null;

  function linkSaws(simSaws) {
    sawLinks = simSaws.map((saw) => nearestByPosition(
      killSawHazards, saw.x, saw.z, (hazard) => hazard.position,
    ));
  }

  function linkScrews(simScrews) {
    screwLinks = simScrews.map((screw) => nearestByPosition(
      screwCores, screw.x, screw.z, (core) => ({ x: core.parent?.position.x ?? 0, z: core.parent?.position.z ?? 0 }),
    ));
  }

  const halfWidth = (ARENA_LAYOUT.dimensions?.width ?? 48) / 2;
  const halfLength = (ARENA_LAYOUT.dimensions?.length ?? 48) / 2;
  const ceilingHeight = ARENA_LAYOUT.dimensions?.ceilingHeight ?? 9.45;
  const wallMeshes = root.userData.wallMeshes || {};
  const ceilingMeshes = root.userData.ceilingMeshes || [];

  // Paint the head-to-head pair up front so the arena is never boxless; a
  // match with three or four machines replaces them through setBotCount.
  root.userData.setStartBoxes?.(spawnsFor(2).map(withBoxSize));

  return {
    group: root,

    /**
     * How many machines this match has, which is the whole of what decides
     * where the start boxes go and what colour they are (sim/arenaSpec.js).
     * The arena is built ONCE and reused across matches, so this has to be a
     * setter rather than a construction argument.
     */
    setBotCount(count) {
      root.userData.setStartBoxes?.(spawnsFor(count).map(withBoxSize));
    },

    /**
     * Nothing may block a shot. Accepts one or more views — in split screen
     * every viewport contributes, and a wall hides if it blocks ANY of them
     * (visibility is scene-global, so the union is the only correct answer).
     * Each view: { position, target } (THREE vectors or plain xyz).
     *
     * A wall blocks a view when its plane lies between the camera and its
     * look target, or when the camera is squeezed right up against it. The
     * ceiling hides when any camera is above it.
     */
    updateVisibility(views) {
      const list = Array.isArray(views) ? views : [views];
      const pad = 0.42;
      const hidden = { west: false, east: false, north: false, south: false };
      let ceilingHidden = false;
      for (const view of list) {
        const cam = view.position;
        const tgt = view.target || { x: 0, y: 0.5, z: 0 };
        if (!cam) continue;
        ceilingHidden ||= cam.y > ceilingHeight - 0.35;
        const crosses = (camCoord, tgtCoord, plane) =>
          (camCoord - plane) * (tgtCoord - plane) < 0 || Math.abs(camCoord) > Math.abs(plane) - pad;
        hidden.west ||= cam.x < 0 && crosses(cam.x, tgt.x, -halfWidth);
        hidden.east ||= cam.x > 0 && crosses(cam.x, tgt.x, halfWidth);
        hidden.north ||= cam.z < 0 && crosses(cam.z, tgt.z, -halfLength);
        hidden.south ||= cam.z > 0 && crosses(cam.z, tgt.z, halfLength);
      }
      ceilingMeshes.forEach((mesh) => {
        mesh.visible = !ceilingHidden;
      });
      for (const [side, meshes] of Object.entries(wallMeshes)) {
        const visible = !hidden[side];
        meshes.forEach((mesh) => {
          mesh.visible = visible;
        });
      }
    },

    /** hazardState from sim.getHazardState(); sim owns the motion, we mirror it. */
    updateHazards(hazardState, dt = 0) {
      if (!hazardState) return;
      const saws = hazardState.killSaws || [];
      const screws = hazardState.screws || [];
      if (!sawLinks && saws.length) linkSaws(saws);
      if (!screwLinks && screws.length) linkScrews(screws);

      saws.forEach((saw, index) => {
        const hazard = sawLinks?.[index];
        if (!hazard?.blade) return;
        // The visual blade's radius (from the v1 hazard builder) can exceed
        // the sim blade's. Align the blade TOPS, not centers — otherwise the
        // oversized visual pokes through the floor while "stowed".
        const simTop = saw.y + (saw.radius ?? 0.52);
        hazard.blade.position.y = simTop - (hazard.radius ?? 0.52) - (hazard.floorY || 0);
        hazard.blade.rotation.z = saw.bladeAngle || 0;
        hazard.exposure = saw.exposure ?? 0;
        hazard.active = Boolean(saw.active);
      });

      screws.forEach((screw, index) => {
        const core = screwLinks?.[index];
        if (!core) return;
        // v1 spins screw cores about their local X; mirror the sim's angle so
        // the visible thread direction matches the conveying force.
        if (core.userData?.rotationAxis === "x") core.rotation.x = screw.angle || 0;
        else {
          core.rotation.y = screw.angle || 0;
          core.rotation.z += dt * 1.5;
        }
      });

      // Screws with no sim counterpart still idle-spin so the arena looks alive.
      if (screwLinks) {
        screwCores.forEach((core, index) => {
          if (screwLinks.includes(core)) return;
          if (core.userData?.rotationAxis === "x") core.rotation.x += dt * screwSpin;
          else core.rotation.y += dt * screwSpin * (index % 2 ? -1 : 1);
        });
      }
    },

    dispose() {
      scene.remove(root);
      root.userData.disposeTextures?.();
    },
  };
}
