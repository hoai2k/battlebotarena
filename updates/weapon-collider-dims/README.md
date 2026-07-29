# Update — spinner colliders ignore `weapon.dims` and `weapon.axis`

**Status:** ready to apply. **Area:** `v2/src/sim/weapons.js` (SIM). Small,
independent of the [weapon-tuning](../weapon-tuning/README.md) update, but worth
applying first — tuning per-bot hit strength is moot while the hit *volumes* are
wrong.

## The bug

`createSpinner()` builds the blade collider from two fields that no bot has:

```js
const halfLength = (w.length ?? 1.6) / 2;                     // w.length: never set
desc = RAPIER.ColliderDesc.cuboid(w.barHalfLength ?? 2.0, 0.08, radius);  // never set
```

so every drum gets the same 1.6 ft length, and every bar gets the same 4 ft ×
0.16 ft × 2·radius slab — with no reference to `weapon.axis`, which is what says
whether the blade sweeps about X (HUGE's vertical bar) or Y (Tombstone's
horizontal bar). The catalog has the right numbers in `weapon.dims` (half
extents) and `weapon.radius`; the sim just never reads them.

| bot | axis | collider today | should be |
|---|---|---|---|
| Bite Force | X | cylinder(0.80, r 0.42) | cylinder(0.85, r 0.42) |
| Hypershock | X | cylinder(0.80, r 0.44) | cylinder(0.50, r 0.44) |
| Minotaur | X | cylinder(0.80, r 0.27) | cylinder(0.39, r 0.27) |
| HUGE | X | cuboid(2.00, 0.08, 1.29) | cylinder(0.15, r 1.29) about X |
| Tombstone | Y | cuboid(2.00, 0.08, 1.21) | cylinder(0.12, r 1.21) about Y |

Minotaur's drum is twice as wide as its model; HUGE's and Tombstone's blades are
4 ft wide slabs that stick out ~0.8 ft past the real blade on each side and, for
Tombstone, present a 2.4 ft deep face where the blade is 0.6 ft deep. Bots get
hit by geometry that isn't there, and the "reach" of each weapon has nothing to
do with its model.

## The fix

The spinning blade's swept volume is a disc about `weapon.axis` — one shape for
both types, from data the catalog already has. In `createSpinner`, replace
everything from `const isDrum = …` through the `if (isDrum) { … } else { … }`
block (i.e. the `isDrum` / `radius` / `halfLength` declarations and the shape
branch, but not the `desc.setTranslation(…)` chain that follows) with:

```js
  // Swept volume of the spinning blade: a disc about weapon.axis, sized from
  // the catalog half extents (thickness along the axis) and radius.
  const axis = w.axis ?? { x: 1, y: 0, z: 0 };
  const alongX = Math.abs(axis.x) > 0.5;
  const alongY = Math.abs(axis.y) > 0.5;
  const halfThickness = alongX ? w.dims.x : alongY ? w.dims.y : w.dims.z;
  const radius = w.radius ?? Math.max(w.dims.y, w.dims.z);

  const desc = RAPIER.ColliderDesc.cylinder(halfThickness, radius);
  if (alongX) desc.setRotation(m.qFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2));
  else if (!alongY) desc.setRotation(m.qFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2));
  // (Rapier cylinders are Y-axis by default, so the Y case needs no rotation.)
```

The rest of the descriptor chain (`setTranslation(w.pivot…)`, density 0,
`WEAPON_GROUPS`, active events) is unchanged — it already reads `desc`, now a
`const`. `isDrum`, `w.length` and `w.barHalfLength` disappear with this block;
nothing else uses them.

Note this makes a drum's collider the *swept* disc, which for a drum is the same
as its physical shape, and for a bar is the disc it sweeps — correct for a
collider that does not rotate with the blade (the current design).

Sawblaze is unaffected: `hammerSaw` has no collider at all, it is zone-based.
Its `tuning.sawCenter` is used by `models.js` for the visual only.

## Verify

```bash
node v2/tools/sim-tests.mjs
```

Then eyeball it: Tombstone and HUGE should no longer connect while visibly a
foot short of the target, and Minotaur's drum should stop hitting from outside
its own body width.
