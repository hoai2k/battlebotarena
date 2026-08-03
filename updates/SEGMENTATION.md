# Segmentation notes

How each bot's Tripo segmentation was mapped onto the v2 model contract
(`modelBody` / `modelWeapon` / `modelWeaponSub-*` / `modelAux-*` / `modelWheel-N`),
and what is imperfect about it.

Part numbers refer to `tripo_part_N` in `raw/<bot>_seg.glb`. Every number was
read off the model, not guessed from the reference photo. Pivots are in **model
space** — the coordinates `glb-parts-report.mjs` and the rainbow viewer report.

Re-cut any bot for free (the paid Tripo artifacts in `raw/` are pristine):

```bash
BOT_DROP=updates node tools/bot-pipeline.mjs advance <bot>
```

---

## Orientation and axes

Tripo picks a different forward axis per bot; the catalog's `modelYaw` squares
each one up at runtime, so the GLB stays untouched.

| Bot | Model forward | Weapon axis | Evidence |
|---|---|---|---|
| Glitch | **+Z** | `[1,0,0]` | wedge nose bits at z ≈ +0.46; drum axle spans X |
| Kraken | **+X** | `[0,0,1]` | wheels at x = −0.33 (rear), fangs at x = +0.36 |
| Gigabyte | n/a (radial) | **`[0,1,0]`** | full-body shell spins about **vertical** |
| Rusty | **+X** | `[0,0,-1]` | dome at x = +0.23, hammer yoke reaches back to x = −0.46 |
| Dragon King | **+Z** | `[1,0,0]` | jaw assembly at z = +0.41; track pods at x = ±0.24 |

Two sign notes that the rig checker earned its keep on:

- **Rusty needs `[0,0,-1]`.** Its hammer head sits at the *rear* (x = −0.44) with
  the pivot at the front of the yoke, so a positive rotation about `+Z` would
  drive the head into the floor instead of lifting it over the top.
- **Gigabyte spins about `[0,1,0]`.** Every other bot in the project spins or
  hinges about a horizontal axis; a full-body shell spinner is the exception.

Verify any model without opening a browser:

```bash
node tools/glb-rig-check.mjs updates/models/*.glb
node tools/glb-rig-check.mjs --expect-drop updates/models/dragonking.glb
```

---

## Per-bot mapping

### Gigabyte — the whole shell is the weapon
```json
{ "weapon": [7, 0, 1, 9, 2, 6], "wheels": [], "weaponAxis": [0, 1, 0] }
```
This is the inverse of every other bot in the project. Part 7 is the entire
176k-vertex dome; parts 0/1/9/2/6 are the rim teeth and skirts that spin with
it. **`modelBody` is only four parts** — the antenna mast and a few internal
brackets — and that is correct: on a full-body spinner the only thing you can
see that *doesn't* rotate is the central self-righting pole.

Segmentation fusing the dome and chassis into one part would normally be a
defect. Here it is harmless: the chassis is entirely hidden under the shell, so
spinning the fused part is visually identical to spinning the real shell.

The pole is passive on the real robot — it stops the bot resting inverted and
gives the driver an orientation cue against the blur of the spinning shell. Do
**not** bind a self-right button to it.

### Kraken — upper jaw, lower jaw fixed
```json
{ "weapon": [12, 16, 6, 13], "wheels": [[0], [19]], "weaponAxis": [0, 0, 1],
  "pivotOverride": [-0.30, 0.12, 0] }
```
Part 12 is the whole upper-jaw shell, 16 and 6 are the two fangs, and 13 is the
anglerfish lure that rides on top of it. The **lower jaw (part 10) stays in the
body** — on the real robot it is a V-scoop welded rigidly to the chassis, and
only the upper jaw moves.

The hinge is at the **top-rear** of the body, above the drive axle, which is
where the real air-bag actuator pushes against the jaw lever. The model is
baked jaw-**open**, so the weapon stroke *closes* it: catalog `restAngle: 0`
with a negative `fireAngle`.

**Known flag:** `glb-rig-check` reports Kraken's two wheels as unpaired. That is
real — Tripo placed them at z = +0.30 and z = −0.24, about a 10% asymmetry.
It is a generation artifact, not a mapping error, and is not worth re-cutting;
noted here so nobody "fixes" the part map chasing it.

### Rusty — the hammer that isn't in the front view
```json
{ "weapon": [2, 22, 12], "wheels": [], "weaponAxis": [0, 0, -1],
  "pivotOverride": [0.28, 0.05, 0] }
```
Rusty's hammer is genuinely invisible in front-on photographs — in the rest
pose the arm lies back almost horizontally across the rear deck with the head
hanging over the tail, hidden behind the silhouette of the domed head.

Parts 2 and 22 are the two long drilled plate-steel bars, one per side, and
part 12 is the head fin that joins them at the rear — together a **U-shaped
yoke** that pivots at its *front* end, just behind the head, and swings the
rear head up and over the top to strike in front. That matches both the
reference photo (the pivot boss is visible beside the dome) and the published
description of the gantry.

The chrome dome (part 13) is **static** and stays in the body. It is an
inverted stainless kitchen mixing bowl bolted on as a helmet — decorative
armour, not a mechanism.

**No animated wheels: Rusty is tracked.** Parts 0 and 23 are the two rubber
track units and stay in the body. See "Tracked bots" below.

### Dragon King — five groups, the most complex rig in the project
```json
{ "weapon": [12, 13, 14, 16],
  "weaponSub": { "name": "saws", "parts": [10, 11], "pivotOverride": [0, 0.24, -0.10] },
  "wheels": [], "weaponAxis": [1, 0, 0], "pivotOverride": [0, 0.05, -0.12],
  "aux": { "jaw":  { "parts": [1, 0], "axis": [1,0,0], "pivotOverride": [0, 0.0, 0.12] },
           "pods": { "parts": [6, 7], "axis": [1,0,0], "pivotOverride": [0, -0.05, -0.03] } } }
```
Produces `modelBody`, `modelWeapon`, `modelWeaponSub-saws`, `modelAux-jaw` and
`modelAux-pods` — four independently animated groups.

- **`modelWeapon`** = the two saw arms. They rest raised (near vertical) and
  swing *down* onto a held opponent, so a positive stroke **drops** — check with
  `--expect-drop`, same as a hammer.
- **`modelWeaponSub-saws`** = the two blades, nested inside the arms so they
  keep spinning as the arms move. Both blades share one X axis line (identical
  y and z, mirrored x), so a single sub node drives both correctly.
- **`modelAux-pods`** = the two tracked drive pods. On the real robot these
  **rotate about their mounting arms** — used to reposition the wheelbase, to
  lift the body, and to self-right. Rigging them as a group means the game
  *can* reproduce that; if you don't want a fourth input, drive it automatically
  on inversion.

**Imperfect:** the dragon's articulating upper jaw did not separate cleanly.
`modelAux-jaw` is the front grabber assembly (the neck arm and its roller) —
hinging it reads as a clamp, but it is not literally the upper jaw. Candidate
for a `glb-carve` pass if the jaw needs to be exact.

### Glitch — drum only
```json
{ "weapon": [6], "wheels": [], "weaponAxis": [1, 0, 0],
  "pivotOverride": [0.05, 0.04, 0.21] }
```
Part 6 is the eggbeater drum with its axle, cleanly separated from the big
delta-wing wedge (part 10). Everything else is body.

**No animated wheels: Glitch runs four omniwheels in an X-drive**, tucked under
the wedge, and segmentation never produced clean mirrored pairs. Invisible in
play. The interesting part of Glitch's drive is holonomic strafing, which is a
sim feature rather than a model feature — see BOT_SPECS.md.

---

## Tracked bots — new to this drop

**Rusty and Dragon King are tracked, not wheeled.** The model contract has no
track primitive, and rotating a track unit like a wheel looks wrong, so both
ship with **no `modelWheel-N` nodes** and their track units left in the body.

Three ways to handle it, cheapest first:

1. **Leave them static.** Correct silhouette, no motion. This is what ships.
2. **Scroll the track texture** — offset the track material's UVs by ground
   speed each frame. Cheap and convincing; needs the track submesh named.
3. **Rig the road wheels** individually — a lot of work for something largely
   hidden behind the track guards.

Dragon King additionally needs its **pods** to rotate as whole units, which is
already rigged as `modelAux-pods` and is a different thing from track motion.

---

## Bots with no animated wheels

Five bots across this drop and the last now ship without wheel nodes:
Shatter, Endgame, Tantrum (enclosed drives), Glitch (omniwheels under the
wedge) and Gigabyte (wheels under the shell), plus the two tracked bots above.

This is normal and is not a mapping failure — on these machines the drive is
genuinely not visible. The loader falls back gracefully for missing parts.

---

## Tooling added this round

- **`tools/glb-rig-check.mjs` (new)** — rotates a weapon's authored bounds about
  its authored pivot and reports whether a positive stroke lifts or drops, plus
  wheel-pair symmetry. Catches reversed `weaponAxis` signs in milliseconds
  instead of by eye in the browser. It knows a rotationally symmetric weapon
  (any spinner, especially Gigabyte's vertical-axis shell) can't change its own
  top height, and reports those as "spinner, lift test N/A" rather than a
  false alarm.
- **`tools/bot-pipeline.mjs`** now takes the drop folder from **`BOT_DROP`**
  instead of hardcoding one round's path, so a new round never disturbs a
  finished one.
