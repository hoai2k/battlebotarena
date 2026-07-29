# Segmentation notes — Beta & Whiplash

How each model was cut into moving parts, and what was checked. Read this
alongside the part maps in `part-maps/` if a part ever needs re-cutting.

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

### Integration note — Beta has no wheel parts

`models.js` falls back to procedural placeholder wheels when a GLB has no
`modelWheel-N` nodes, which would poke visible cylinders out of Beta's shell.
Since the real robot's wheels are hidden, either give Beta `wheelAnchors` tucked
well inside the shell so the placeholders stay concealed, or add a
`hideWheels: true` catalog flag and skip the fallback for it.
