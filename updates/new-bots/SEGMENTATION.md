# Segmentation notes

How each bot's Tripo segmentation was mapped onto the v2 model contract
(`modelBody` / `modelWeapon` / `modelWeaponSub-*` / `modelAux-*` / `modelWheel-N`),
and what is imperfect about it.

Part numbers below refer to `tripo_part_N` in `raw/<bot>_seg.glb`. Every number
was read off the model in `tools/viewer.html?src=…&parts=1`, not guessed from
the reference photo. Pivots are in **model space**, the same coordinates the
rainbow viewer reports.

Re-cut any bot without spending Tripo credits:

```bash
node tools/glb-partition.mjs raw/<bot>_seg.glb part-maps/<bot>.json models/<bot>.glb
```

or just `node tools/bot-pipeline.mjs advance <bot>` after editing its part map.

---

## Model orientation

Tripo does not pick a consistent forward axis, so it differs per bot. The
catalog's `modelYaw` is what squares each one up at runtime — the GLB stays
pristine.

| Bot | Model forward | Weapon axis | Why |
|---|---|---|---|
| Overhaul | **+X** | `[0,0,1]` | wheels sit at z = ±0.30, forks reach to x = +0.50 |
| Free Shipping | **+X** | `[0,0,1]` | wheel pairs at x = +0.09 / −0.41, z = ±0.25 |
| Shatter | **+X** | `[0,0,1]` | front forks (2, 14) at x = +0.28 |
| Duck | **+X** | `[0,0,1]` | beak plate at x = +0.22, wheels at z = ±0.34 |
| Mammoth | **±Z** | `[1,0,0]` | wheels at x = ±0.38, so the transverse axis is X |
| Copperhead | **+X** | `[0,0,1]` | drum and forks forward of the two wheels at z = ±0.39 |
| Endgame | **+X** | `[0,0,1]` | the two lettered wedges (9, 39) at x = +0.23, z = ±0.29 |
| Blip | **+Z** | `[1,0,0]` | forks (0, 1) at z = +0.33, so transverse is X |
| Tantrum | **+Z** | `[1,0,0]` | fist arms at x = ±0.30, drum bar spans X at z = +0.39 |

**Blip, Tantrum and Mammoth need `weaponAxis: [1,0,0]`** — they came out of
Tripo rotated 90° from the others. Getting this wrong makes a flipper hinge
sideways instead of lifting.

---

## Per-bot mapping

### Overhaul — nested clamp (the only two-stage weapon in this drop)
```json
"weapon": [30, 11, 19], "weaponSub": { "name": "claw", "parts": [21, 12, 28, 13] }
```
Overhaul's clamp jaw pivots **on** the lift arm, not on the chassis, so it is a
`weaponSub` nested inside `modelWeapon` — the same construction as Sawblaze's
saw disc. Parts 11 and 30 are the two forward-swept lifting blades and 19 is
the pivot block they share; 21 is the C-shaped clamp arch, with 12/28 its
top horns and 13 its rear plate.

- lift arm hinge `[-0.15, -0.04, 0]`, clamp hinge `[-0.12, -0.06, 0]`
- wheels 2/35 (front, x = −0.08) and 1/34 (rear, x = −0.36)
- **Maps to RT = lift, RB = clamp.**

### Free Shipping — lifter, flamethrowers are static geometry
```json
"weapon": [11, 9]
```
Part 11 is the diagonal lifting arm, 9 the fork carriage it carries; they
rotate together about `[-0.20, -0.05, 0]`. The front wedges (17, 4, 12) are
fixed. Four wheels: 1/20 front, 2/19 rear.

The **flame nozzles are not separate parts** and do not need to be — nothing
about them moves. Firing them is a VFX + audio effect anchored to the nozzle
positions, not a rigged animation. See BOT_SPECS.md for the RB mapping.

### Shatter — hammer only, no animated wheels
```json
"weapon": [6], "wheels": []
```
Part 6 is the hammer arm, a thin plate standing in the XY plane, hinged at
`[-0.03, -0.13, 0]` with the head arcing back over the chassis.

**Shatter has no `modelWheel-N` nodes.** Its drive is completely enclosed by
the two side armour panels (parts 1 and 16), so segmentation never saw a wheel
to isolate — which matches the real robot, where the wheels are hidden inside
the wedge body. Nothing is lost visually. The loader falls back gracefully for
missing wheel nodes.

### Duck — beak scoop
```json
"weapon": [6, 4]
```
Part 6 is the full-width scoop plate; part 4 is the beak tip that sits on it
and must lift with it. Hinge at the scoop's rear edge, `[0.17, -0.10, 0]`.
Four clean wheels: 1/9 front (x = 0), 0/10 rear (x = −0.34).

### Mammoth — **weakest mapping in this drop**
```json
"weapon": [28, 29], "wheels": [[7], [8], [14], [16]]
```
The four wheels are clean (two per side, x = ±0.38, matching the real robot's
tandem pairs). The **weapon is not**: Mammoth's trunk/disc did not separate
from the tall truss frame — part 23 swallowed the frame and most of the
weapon structure, leaving only the central hub cluster (28, 29) isolatable.
It spins about `[0, 0.03, -0.16]`, which reads as a rotating element at the
right place in the frame, but it is a hub, not the arm.

**This is the one bot in the drop worth another pass** — either a
`glb-carve` cylinder out of part 23, or a regeneration from a square-on side
reference where the trunk is unambiguous. Credits are not the constraint
(575 remain); it just needs the carve region measured.

### Copperhead — drum carved out of the chassis
```json
"weapon": [901, 12, 14, 18, 24, 32, 16]
```
Segmentation fused the copper drum shell into the 253k-triangle chassis part
(13) and only broke out the internal bearing blocks. Part **901 is synthetic**
— `glb-carve` extracts it as a cylinder about the drum axis:

```json
{ "part": 13, "mode": "extract", "newPart": 901,
  "region": { "type": "cylinder", "axis": 2, "center": [0.29, 0.10, -0.01],
              "radius": 0.125, "halfLength": 0.27 } }
```

kept in `carve-ops/copperhead.json`. The pipeline now prefers
`raw/<bot>_carved.glb` when it exists, so **`copperhead_seg.glb` stays the
pristine paid Tripo artifact** and the carve can be redone or retuned for free.

Two false starts are worth recording so nobody repeats them: a cylinder at
radius 0.155 swallowed the top deck and forks, and my first centre
(`[-0.006, 0.114, -0.028]`, taken from part 15) was a **rear pulley**, not the
drum — the drum is at the front, x ≈ 0.29. Isolating a candidate and looking
at it beats reasoning from the bounds table.

Two wheels only (0 and 37, at z = ±0.39), which is correct — Copperhead is 2WD.

### Endgame — teardrop disc, srimech left static
```json
"weapon": [16, 24], "wheels": []
```
Parts 16 and 24 together form the teardrop disc and its hub, spinning about
`[0.12, 0.05, 0.02]`.

Two known gaps:
- **No animated wheels.** Endgame's wheels are inboard and never separated;
  same situation as Shatter, and equally invisible in play.
- **The self-righting arm (part 32) is left in the body.** It is a real,
  separately-hinged mechanism at the rear, but it cannot be a `weaponSub` —
  subs are nested *inside* `modelWeapon`, so it would spin with the disc.
  If it should articulate, it needs an `aux` group like Tantrum's fists.

### Tantrum — two independent weapon groups
```json
"weapon": [0], "aux": { "fists": { "parts": [10, 11], "axis": [1,0,0] } }
```
This is the first bot in the project needing two *independent* animated
mechanisms, which `weaponSub` cannot express (a sub inherits the weapon's
rotation). The fists therefore go in an **`aux` group** — a sibling of
`modelBody`, not a child of `modelWeapon`.

- `modelWeapon` = part 0, the drum bar, spinning about X at `[-0.046, 0.059, 0.387]`.
  Parts 1 and 3 are its bearing blocks and correctly stay in the body.
- `modelAux-fists` = parts 10 and 11, the two arms, hinged at `[0, 0.10, -0.05]`.

Caveat: Tripo modelled the drum **slim** — part 0 is a 0.30 × 0.075 × 0.05 bar
rather than a chunky drum. It spins correctly and reads as a bar spinner, but
it is under-scaled against the reference. A second candidate for a carve pass.

`aux` groups now carry `pivotLocal` (and optional `auxAxis`) so a swinging aux
group has a hinge; previously they only carried `auxBounds`, which suited
Bronco's scaling ram but not a rotating arm.

### Blip — the flipper is the deck plate
```json
"weapon": [9], "weaponAxis": [1,0,0], "pivotOverride": [0, -0.02, -0.266]
```
Part 9 is the elongated rectangular plate down the centreline of the top deck —
about a third of the deck's width, exactly as described. **The front forks
(parts 0 and 1) are not the weapon** and stay in the body, which is correct:
on the real robot they are passive, swappable ground-game hardware.

The hinge is at the plate's **rear** edge (z = −0.266) with the front edge
sweeping up — Blip is a rear-hinged launcher, so hinging it at the front would
be backwards.

Only one clean wheel pair separated (11 and 12); the rest of the drive stayed
in the shell, which is fine as Blip's wheels are inboard.

---

## Tooling changes made for this drop

Both are in `tools/` and are general, not bot-specific:

1. **`glb-carve.mjs` gained a `cylinder` region.** A box around a drum
   inevitably swallows the chassis at its corners; a cylinder about the spin
   axis does not. Fields: `axis` (0/1/2), `center`, `radius`, `halfLength`.
2. **`glb-partition.mjs` writes `pivotLocal` on `aux` groups**, with optional
   `pivotOverride` and `axis` in the map, so an aux group can swing as well as
   scale.
3. **`bot-pipeline.mjs` prefers `raw/<bot>_carved.glb`** over `<bot>_seg.glb`,
   keeping paid Tripo artifacts pristine.

## A note on the viewer

`tools/viewer.html` tints `modelWeapon` red and `modelWheel-*` blue **by
default** so the rig is visible at a glance. That is a debug overlay, not the
model's texture — add **`&tint=0`** to see real materials. Worth remembering
before concluding a model's colours are broken.

---

## As integrated — what this file got wrong

Corrections found by measuring each model **in game space, through the loader**
(`node tools/rig-inspect.mjs <id>`), which is not a check the segmentation pass
makes. Kept here rather than edited into the tables above, because the tables
are an accurate record of what the pipeline produced.

**Nothing above looks at which way is UP.** The orientation table settles the
forward axis and stops. Two models came out of Tripo upside down and needed
`modelRoll: Math.PI` in the catalog:

- **Copperhead** — wheels centred at y 1.57 on a 2.08ft-tall bot, i.e. resting
  on the roof, with the deck underneath.
- **Duck** — wheels sitting on top of the deck plate, logo facing the floor.

**Two models carried geometry the robot does not have**, and both of them
were what the model rested on, so every other part floated:

- **Endgame** — a sculpted pair of support legs under the rear held the chassis
  up with the END/GAME forks 0.53ft clear of the floor. Carved out in
  `tools/repairs/endgame-stand.json`.
- **Tantrum** — the reference photo was shot on a polished floor and the scan
  modelled the reflection as solid geometry: a mirrored ghost bot hanging
  underneath. Carved out in `tools/repairs/tantrum-reflection.json`. The slant
  on its side panels is NOT a tilt; that is the real robot's wedge skirt.

**Mammoth's and Tantrum's under-built weapons** are called out above as needing
a carve. Neither got one — you cannot carve geometry that is not there. Both
instead carry a collider radius larger than the animated part, documented at
the catalog entry: Mammoth 0.6 against a 0.43 hub, Tantrum 0.30 against a
0.145 bar. Mammoth also drops to `modelScale: 3.0`, because at the scale its
frame implies the disc sweeps down only to y 1.4 and reaches nothing.

**The measured swept radii** (game space, at the catalog's scale) are the
numbers the catalog now carries. Notably Endgame's blade is a TEARDROP: its
axle is at the fat end, so its bbox centre is 0.29ft off the real hub and the
swept circle is set by the tip, not by half the height.
