# Part maps — the model part contract, and how each bot was cut

One `<bot>.json` per bot, mapping raw Tripo segmentation parts onto the game's
part nodes. `glb-partition.mjs` consumes them; read this if a part ever needs
re-cutting.

Every bot below is integrated. Where these notes propose catalog values
(`modelYaw`, `restAngle` / `fireAngle`, colliders), the shipped catalog uses
figures MEASURED through the loader in game space instead — see the comments
there. The arm angles in particular differ: measuring in raw GLB space put
Whiplash's forks half a foot through the floor, and inverted the sign of Claw
Viper's lift.

## The part contract

The game loads a GLB by node name:

| Node | Meaning |
|---|---|
| `modelBody` | everything static |
| `modelWeapon` | the moving weapon assembly; `extras.pivotLocal` is its hinge/axle, `extras.weaponAxis` its rotation axis |
| `modelWeaponSub-<name>` | a part nested **inside** the weapon with its own pivot — swings with the arm *and* spins independently (Whiplash's disc, Sawblaze's saw) |
| `modelWheel-N` | a wheel, spun about its own centre |
| `modelAux-<name>` | an auxiliary animated part anchored at its **base**, scaled rather than rotated (Bronco's pneumatic ram) |

Part maps select which raw Tripo parts land in each group:

```json
{
  "weapon": [8, 11],
  "weaponSub": { "name": "disc", "parts": [900], "pivotOverride": [x, y, z] },
  "wheels": [[0], [13]],
  "weaponAxis": [1, 0, 0],
  "pivotOverride": [x, y, z]
}
```

`pivotOverride` matters for **arms**: the default is the part's bounding-box
centre, which is correct for a spinner (it rotates about its middle) but wrong
for a hinged arm, which must rotate about the hinge at one end.

---

## Whiplash — clean result ✅

Tripo read this bot well: the chassis, four wheels, yellow fork brackets and
the arm-mounted disc all came through recognisably. 24 segmentation parts.

**Model orientation:** the generated model faces **+X**, and its lateral axis
is **Z**. The game wants forward = −Z, so the catalog needs
`modelYaw: Math.PI / 2`. After that rotation the arm hinge and the disc axle
both become the game's X axis — hence `weaponAxis` is `[0,0,1]` in the part map
(authoring space) but `{x:1,y:0,z:0}` in the catalog (game space). This is the
same split Sawblaze uses; it has confused verification before, so check
`rotation.x`, not `.z`, when testing the disc spin.

| Group | Parts | Notes |
|---|---|---|
| `modelWeapon` (arm) | 14, 10 | 14 is the long beam (spans x −0.45…+0.24), 10 is the front housing with the arm's own prongs |
| `modelWeaponSub-disc` | 12 | The disc: 0.258 × 0.257 × 0.080 — round in XY, thin in Z, so its axle is Z. Pivot pinned to its measured centre `[0.118, 0.168, -0.006]` rather than the bbox default |
| `modelWheel-0..3` | 0, 1, 22, 23 | Four ~0.21 × 0.21 × 0.10 discs at y = −0.19, corners x ∈ {−0.35, +0.05}, z = ±0.34 |
| `modelBody` | everything else (17 parts) | Includes the **yellow front wedgelets** — those are chassis-mounted, not part of the lifting arm |

**Hinge:** `pivotOverride: [-0.44, -0.02, 0]` — the rear end of the arm beam.
This matters: the default bbox-centre pivot would make the arm rotate about its
middle and swing its own tail through the chassis. Whiplash is a *rear-hinged*
lifter, so the pivot belongs at the back.

**Verified:** loaded in the viewer with `&spin=1` — the arm sweeps about the
rear hinge carrying the disc with it, while the chassis, wheels and yellow
wedgelets stay put. All seven expected nodes present
(`modelBody`, `modelWeapon`, `modelWeaponSub-disc`, `modelWheel-0..3`).

**Not separated:** the disc's own hub is fused into the disc part (harmless — it
rotates with the disc anyway). The arm's prongs are inside part 10 and correctly
travel with the arm.

## Beta — usable hammer, weak body ⚠️

Beta needed **three generation attempts**. The first two, from the studio photo
originally supplied, both produced a flat slab with a bare rod where the hammer
should be — the truss arm and cylindrical head were lost entirely.

**Why that photo is hard:** the hammer arm extends out over *empty white
background* with no depth cues behind it, the bot is unpainted aluminium against
white (almost no contrast at the silhouette), and the heavy head reads as a
detached floating object rather than something attached to the arm.

| Attempt | Input | Result |
|---|---|---|
| 1 | Supplied studio photo, full frame | Flat slab, no arm |
| 2 | Same photo cropped tight to the subject | Flat slab with two rods |
| 3 | BattleBots 2022 press photo (1024 × 683, darker body, orange β, arm silhouetted against the body), cropped | **Recognisable Beta** — see below |

The reference image in `reference/beta.png` is the attempt-3 crop, i.e. the one
that actually produced the shipped model. If you'd rather the UI card used the
original photo you supplied, swap it — the card image and the generation input
don't have to match.

### What came out

| Group | Parts | Notes |
|---|---|---|
| `modelWeapon` (hammer) | 15, 20 | 15 is the truss arm (z −0.376…+0.151), 20 is the cylindrical head, sitting high and rearward (y up to 0.389, z −0.5…−0.3) |
| `modelBody` | everything else (19 parts) | The wedge shell and the exposed internals |
| wheels | **none** | Beta's wheels are enclosed by the shell and did not segment — see the integration note below |

**Hinge:** `pivotOverride: [-0.013, -0.09, 0.14]` — the arm's low forward end,
which sits exactly on the body's top surface (measured body top y = −0.097).
That is the real gearbox pivot: the head swings up and back when cocked, and
forward and down through the top when fired.

**Orientation:** the head points toward −Z when cocked, so the model's forward
is **+Z** → `modelYaw: Math.PI`. The hammer swings in the fore-aft vertical
plane, so its axis is lateral: `weaponAxis: [1,0,0]` in the part map.

**Verified:** the hammer swings as one rigid arm-plus-head assembly about the
hinge on the body, with the wedge staying put.

### Honest assessment

The **hammer is good** — clean, correctly hinged, right shape. The **body is
mediocre**: the wedge came out as a fairly flat plate rather than the deep
angular shell of the real robot, because the reference only shows it from one
side. At gameplay distance this reads acceptably, but it is clearly the weakest
of the ten bots.

Options if you want it better, cheapest first:

1. **Multiview generation.** Tripo accepts up to four views (front/back/left/
   right). Two or three angles of Beta would very likely fix the body outright.
   No code changes needed — the same pipeline handles the result.
2. **Hybrid**: keep this hammer and rebuild the wedge as simple procedural
   geometry. Beta's body is a handful of flat plates — trivial to author, and
   it would look sharper than the generated mesh.
3. **Ship as-is** and revisit; nothing about it blocks integration.

### The electronics bay is open

Beta's bay is reconstructed open: the orange beta plate, the motors and the
loom sit exposed between the armour walls with nothing over them.
`tools/repairs/beta-canopy.json` puts a lexan canopy over it — transparent, so
the parts stay visible, and tucked down between the shell's side walls so the
armour is still what protects it. It stops short of the hammer's gearbox, which
lives forward of the bay: a canopy over that would have the arm swinging
through glass.

`glb-add-panels` gained `material.alpha` for this. Two notes if another bot
needs a window: the panel must be **single-sided** (a doubleSided transparent
box blends its own back faces over its front ones and comes out milky — the
tool now defaults `doubleSided` to false whenever `alpha` is set), and alpha
below about 0.2 is invisible against light internals. 0.30 reads as clear
polycarbonate; 0.42 is already frosted.

### Integration note — Beta has no wheel parts

`models.js` falls back to procedural placeholder wheels when a GLB has no
`modelWheel-N` nodes, which would poke visible cylinders out of Beta's shell.
Since the real robot's wheels are hidden, either give Beta `wheelAnchors` tucked
well inside the shell so the placeholders stay concealed, or add a
`hideWheels: true` catalog flag and skip the fallback for it.

---

# Deep Six, Claw Viper, Witch Doctor & Hydra

Four bots cut in one round, all clean on the first generation. Weapon pivots
were measured from the segmentation geometry rather than eyeballed.

## Deep Six ✅

| Group | Parts | Notes |
|---|---|---|
| `modelWeapon` | 9, 7, 8 | The blade arrives as **three segments tracing the S-curve** — combined they span 0.678 × 0.653 × **0.033**, i.e. a large flat plate, confirming a vertical spinner |
| `modelBody` | 19 parts | Chassis, uprights, chain drive, forks |
| wheels | **none** | 2WD with small wheels tucked into the chassis; nothing segmented cleanly |

- **Pivot** `[0.006, 0.062, 0.022]` — the blade's combined centre, which for an
  S-blade wrapped around its hub is the axle.
- **Axis** `[0,0,1]`: the plate lies in XY and is thin in Z.
- **Verified:** blade spins as one rigid assembly about the hub; chassis static.
- **Wheel caveat (applies to Deep Six and Hydra, which have no wheel parts):**
  `models.js` falls back to procedural placeholder wheels when a GLB has no
  `modelWheel-N` nodes, which would poke visible cylinders out of the shell.
  Either give these bots `wheelAnchors` tucked inside the body so the
  placeholders stay concealed, or add a `hideWheels: true` catalog flag and
  skip the fallback for them.

## Claw Viper ✅ (two articulated joints)

| Group | Parts | Notes |
|---|---|---|
| `modelWeapon` (forks) | 14, 12, 7 | The lifting forks, which are also the wedge — span 0.563 × 0.225 × 0.248, low and forward |
| `modelWeaponSub-claw` | 10 | The snake-head jaw: 0.484 × 0.306 × **0.066**, elevated at y = 0.13 — a curved plate above the forks |
| `modelWheel-0..3` | 18, 1, 16, 3 | Four ~0.16 × 0.15 × 0.10 wheels at y = −0.21, corners x ∈ {−0.42, −0.02}, z = ±0.25 |
| `modelBody` | 11 parts | Chassis, armour belt, side rails |

- **Fork hinge** `[-0.05, -0.16, 0]` — the rear (chassis) end of the fork span.
- **Claw hinge** `[-0.14, 0.14, 0.002]` — the rear end of the jaw, so it rotates
  like a jaw rather than pivoting about its middle.
- The claw is **nested inside the weapon group**, so it rides up with the forks
  automatically — matching the real linkage — while still being independently
  rotatable for the RB control you asked for.
- **Verified:** all seven nodes present; forks and claw move with the arm,
  wheels and chassis static.

## Witch Doctor ✅

| Group | Parts | Notes |
|---|---|---|
| `modelWeapon` | 18 | The disc: 0.446 × 0.308 × 0.129 — round in the vertical fore-aft plane, thin laterally |
| `modelWheel-0..3` | 35, 2, 36, 1 | Four ~0.14 × 0.14 discs at the corners |
| `modelBody` | 33 parts | Chassis, side pods, wedge, livery panels |

- **Pivot** `[0.116, -0.014, 0.006]` — the disc's centre.
- Parts **23 and 11** are a symmetric pair flanking the disc at z = ∓0.07 —
  these are the **side pods / self-righter "bunny ears"**, deliberately left in
  the body. If you want the self-righter animated later, those are the parts.

## Hydra ✅

| Group | Parts | Notes |
|---|---|---|
| `modelWeapon` | 4 | The flipper arm: spans x −0.240 … +0.500, elevated — in the reference photo the arm is captured **raised**, so the GLB's baked pose is the fired position |
| `modelBody` | 10 parts | Wedge chassis, purple wedgelets, hydraulic cylinder |
| wheels | **none** | Hydra's drive is enclosed under a very low chassis; nothing segmented |

- **Pivot** `[-0.24, -0.02, 0]` — the arm's **rear** end. Correct: Hydra is
  rear-hinged and the arm forms the whole front wedge.
- Because the baked pose is *fired*, set `restAngle` to bring the arm down flat
  and leave `fireAngle` near the baked pose — the reverse of Bronco.
- **Verified:** arm swings about the rear hinge; body and wedgelets static.
- **Cosmetic:** the "HYDRA" lettering renders mirrored in the generated
  texture. Harmless at gameplay distance; a horizontal flip of the reference
  before regenerating would fix it if it bothers you.

## Summary

| Bot | Generation | Weapon parts | Wheels | Pivot measured |
|---|---|---|---|---|
| Deep Six | clean, 1st try | 3 (S-curve blade) | none | hub |
| Claw Viper | clean, 1st try | 3 + 1 nested claw | 4 | fork hinge + jaw hinge |
| Witch Doctor | clean, 1st try | 1 (disc) | 4 | disc axle |
| Hydra | clean, 1st try | 1 (arm) | none | rear hinge |


### Integration notes for this round

- **`modelYaw` is `Math.PI / 2` for all four.** Each model faces raw +X with
  its lateral axis on Z, so `weaponAxis: [0,0,1]` in authoring space becomes
  `{x:1,y:0,z:0}` in the catalog — the same split Whiplash and Sawblaze use.
- **Deep Six and Hydra ship `hideWheels: true`**, taking the second of the two
  options the notes above offer; the placeholder fallback is skipped for them.
- **Claw Viper's jaw hinge is honoured by the loader.** `weaponSub` used to be
  pivoted at its bounding-box centre unconditionally, which is right for a
  spinning disc and wrong for a jaw — it flew off its knuckle. `models.js` now
  prefers `extras.pivotLocal` when the partitioner baked one.
- **Arm angles were re-measured through the loader**, in game space, with the
  model grounded — see the catalog comments. Claw Viper lifts on a *positive*
  angle (`restAngle: 0`, `liftAngle: 1.5`); the proposed `-2.1` drove the forks
  under the floor. Hydra rests at `-0.45`, arm flat on the deck with its lip at
  the nose, and fires to the baked pose (`0`).
- **The mirrored HYDRA lettering is shipped as-is**, per the cosmetic note.

### Claw Viper's lifter — a second pass

The first integration moved only three parts with the arm, and the lifter read
as broken in game: the forks and claw swung while the black frame that carries
them stayed bolted to the chassis. Three separate faults, all fixed by
`tools/repairs/clawviper-lifter.json`:

1. **The frame was fused into the chassis mesh.** Part 11 is a single 308k-tri
   shell covering both the body and the whole lifter A-frame, and it has no
   internal connected components to split on — so the frame is carved out of it
   by region (two boxes: the beam above the deck, and the truss that dives to
   the fork ahead of the nose) and handed to `modelWeapon` as part 910.
2. **Three loose parts were filed under the body**: the fork hubs (5, 15) and
   the claw's axle boss (6). All three bolt to the lifter.
3. **Both pivots were wrong.** The lifter turns about the boss pair at the back
   of the arm's rear web (parts 8/13, so `[-0.237,-0.101,0]`), not the front of
   the chassis; the claw turns about the small boss at the base of its stub
   (part 6, `[-0.1385,-0.044,0.002]`). The claw's authored y of `0.14` was its
   bbox mid-height, a fifth of the model above the real knuckle.

The lesson for the next hinged arm: **find the axle in the geometry**. Tripo
segments the axle bosses as their own small parts, so the pivot is a part
centre to read off, not a number to estimate from a bbox.

Two follow-ups, both in the repair spec:

- **The carve took some of the chassis with it.** A few of the body's own blue
  livery rails ended up in the lifter and swung with the arm. They are not in a
  box you can draw around them, so `glb-carve` gained a `colour` region that
  samples the base-colour texel under each triangle's UV centroid. Match on
  HUE, not on a fixed RGB — the same paint in shadow is a fifth of the
  brightness, and an RGB-distance test caught less than half of it.
- **The shell is hollow.** Like most of these reconstructions Claw Viper is an
  open box: from behind you see straight through the chassis and out the front.
  `tools/repairs/clawviper-interior.json` fills the cavity with a plain dark
  panel, inset inside the blue bodywork on every side so the shell still frames
  it. The cavity was measured by voxel-scanning `modelBody` (floor at y=-0.25,
  deck underside at -0.15, side rails' inner faces around |z|=0.24) rather than
  eyeballed — a box sized by eye bled out past the rails and hid them.
