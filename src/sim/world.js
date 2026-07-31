// Rapier world construction + arena colliders + collision groups.
// Headless-safe: only Rapier and plain math, no DOM/three.js.

import RAPIER from "@dimforge/rapier3d-compat";
import { ARENA, GRAVITY_Y, UPPER_DECK } from "./arenaSpec.js";
import { qFromAxisAngle } from "./math.js";

export { RAPIER };

/** Collision group memberships (16-bit). */
export const GROUP = Object.freeze({
  FLOOR: 0x0001,
  ARENA: 0x0002, // walls, ceiling, deck, ramp ("prop"-ish solids)
  BOT: 0x0004,
  WEAPON: 0x0008,
  HAZARD: 0x0010,
});

/** Pack Rapier interaction groups: high 16 bits membership, low 16 filter. */
export function packGroups(membership, filter) {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

export const BOT_GROUPS = packGroups(
  GROUP.BOT,
  GROUP.FLOOR | GROUP.ARENA | GROUP.BOT | GROUP.WEAPON | GROUP.HAZARD,
);
// Weapon colliders hit opponents and arena solids, never the floor or hazards.
export const WEAPON_GROUPS = packGroups(GROUP.WEAPON, GROUP.ARENA | GROUP.BOT);
export const HAZARD_GROUPS = packGroups(GROUP.HAZARD, GROUP.BOT);
// Suspension rays stand on floor, arena solids (deck/ramp), risen hazards — and
// on the OTHER BOT. Without that last one a wedge is just a bumper: opponents
// shove against its face and never climb it, which is most of what wedges are
// for. The ray already excludes the caster's own body.
export const SUSPENSION_RAY_GROUPS = packGroups(
  GROUP.BOT,
  GROUP.FLOOR | GROUP.ARENA | GROUP.HAZARD | GROUP.BOT,
);

let rapierReady = null;

/** Initialize the Rapier WASM module once. */
export function initRapier() {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

/**
 * Create the physics world, event queue, and collider metadata registry.
 * meta maps collider.handle -> { kind, surface, botIndex?, hazardIndex?, collider }.
 */
export function createWorld() {
  const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
  world.numSolverIterations = 12;
  world.timestep = 1 / 120;
  const eventQueue = new RAPIER.EventQueue(true);
  /** @type {Map<number, object>} */
  const meta = new Map();
  return { world, eventQueue, meta };
}

/** Register collider metadata for event routing. */
export function tagCollider(meta, collider, info) {
  meta.set(collider.handle, { ...info, collider });
}

function addStaticBox(ctx, { pos, half, rot = null, friction, restitution, surface, groups }) {
  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
  if (rot) bodyDesc.setRotation(rot);
  const body = ctx.world.createRigidBody(bodyDesc);
  const collider = ctx.world.createCollider(
    RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setDensity(0)
      .setFriction(friction)
      .setRestitution(restitution)
      .setCollisionGroups(groups),
    body,
  );
  tagCollider(ctx.meta, collider, { kind: "arena", surface });
  return collider;
}

/** Build floor, walls, ceiling, upper deck slab, and deck ramp. */
export function buildArena(ctx) {
  const hw = ARENA.width / 2;
  const hl = ARENA.length / 2;
  const wallHalfY = ARENA.ceilingHeight / 2;
  const t = ARENA.wallThickness / 2;
  const floorGroups = packGroups(GROUP.FLOOR, GROUP.BOT);
  const arenaGroups = packGroups(GROUP.ARENA, GROUP.BOT | GROUP.WEAPON);

  addStaticBox(ctx, {
    pos: { x: 0, y: -ARENA.floorHalfHeight, z: 0 },
    half: { x: hw + 1, y: ARENA.floorHalfHeight, z: hl + 1 },
    friction: 0.85,
    restitution: 0.05,
    surface: "floor",
    groups: floorGroups,
  });

  const walls = [
    { pos: { x: hw + t, y: wallHalfY, z: 0 }, half: { x: t, y: wallHalfY, z: hl + 1 } },
    { pos: { x: -hw - t, y: wallHalfY, z: 0 }, half: { x: t, y: wallHalfY, z: hl + 1 } },
    { pos: { x: 0, y: wallHalfY, z: hl + t }, half: { x: hw + 1, y: wallHalfY, z: t } },
    { pos: { x: 0, y: wallHalfY, z: -hl - t }, half: { x: hw + 1, y: wallHalfY, z: t } },
  ];
  for (const wall of walls) {
    addStaticBox(ctx, { ...wall, friction: 0.3, restitution: 0.4, surface: "wall", groups: arenaGroups });
  }

  addStaticBox(ctx, {
    pos: { x: 0, y: ARENA.ceilingHeight + 0.12, z: 0 },
    half: { x: hw + 1, y: 0.12, z: hl + 1 },
    friction: 0.4,
    restitution: 0.1,
    surface: "ceiling",
    groups: arenaGroups,
  });

  // Upper deck slab.
  addStaticBox(ctx, {
    pos: { x: UPPER_DECK.x, y: UPPER_DECK.height / 2, z: UPPER_DECK.z },
    half: { x: UPPER_DECK.sizeX / 2, y: UPPER_DECK.height / 2, z: UPPER_DECK.sizeZ / 2 },
    friction: 0.85,
    restitution: 0.05,
    surface: "prop",
    groups: arenaGroups,
  });

  // Ramp up the -x edge of the deck (rotated slab meeting the deck top).
  const deckEdgeX = UPPER_DECK.x - UPPER_DECK.sizeX / 2;
  const rampAngle = Math.atan2(UPPER_DECK.height, UPPER_DECK.rampLength);
  const rampHalfLen = Math.hypot(UPPER_DECK.height, UPPER_DECK.rampLength) / 2;
  addStaticBox(ctx, {
    pos: { x: deckEdgeX - UPPER_DECK.rampLength / 2, y: UPPER_DECK.height / 2 - 0.14, z: UPPER_DECK.z },
    half: { x: rampHalfLen, y: 0.15, z: UPPER_DECK.sizeZ / 2 },
    rot: qFromAxisAngle({ x: 0, y: 0, z: 1 }, rampAngle),
    friction: 0.85,
    restitution: 0.05,
    surface: "prop",
    groups: arenaGroups,
  });
}
