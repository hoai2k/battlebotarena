# Segmentation notes — Deep Six, Claw Viper, Witch Doctor & Hydra

How each model was cut into moving parts, and what was checked. Read this
alongside the part maps in `part-maps/` if a part ever needs re-cutting.

## The part contract

The game loads a GLB by node name:

| Node | Meaning |
|---|---|
| `modelBody` | everything static |
| `modelWeapon` | the moving weapon assembly; `extras.pivotLocal` is its hinge/axle, `extras.weaponAxis` its rotation axis |
| `modelWeaponSub-<name>` | a part nested **inside** the weapon with its own pivot — moves with the arm *and* rotates independently (Claw Viper's jaw, Sawblaze's saw) |
| `modelWheel-N` | a wheel, spun about its own centre |
| `modelAux-<name>` | an auxiliary animated part anchored at its **base**, scaled rather than rotated (Bronco's pneumatic ram) |

Part maps select which raw Tripo parts land in each group:

```json
{
  "weapon": [9, 7, 8],
  "weaponSub": { "name": "claw", "parts": [10], "pivotOverride": [x, y, z] },
  "wheels": [[18], [1], [16], [3]],
  "weaponAxis": [0, 0, 1],
  "pivotOverride": [x, y, z]
}
```

`pivotOverride` matters for **arms**: the default is the part's bounding-box
centre, which is correct for a spinner (it rotates about its middle) but wrong
for a hinged arm, which must rotate about the hinge at one end.

---

Beta. The black studio backgrounds in these references work well for
image-to-3D: strong silhouette separation is exactly what it needs.

Weapon pivots were measured directly from the segmentation geometry with
`tools/glb-part-bounds.mjs` (added this round — it reports combined bounds and
centre for a set of parts, so pivots can be picked without eyeballing them in
the 3D viewer).

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
