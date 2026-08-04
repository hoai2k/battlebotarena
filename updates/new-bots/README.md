# New bots — nine-bot drop

Nine part-segmented bot models, ready to drop into the v2 game, plus the
research and integration notes needed to wire them up.

| Bot | Weapon | Controls |
|---|---|---|
| **Overhaul** | grappler + lifting forks | RT lift, **RB clamp** (nested claw) |
| **Free Shipping** | forklift lifter + flamethrowers | RT lift, **RB flame** |
| **Shatter** | hammer | RT swing |
| **Duck** | lifting beak | RT lift |
| **Mammoth** | trunk / disc on a tall truss | RT spin |
| **Copperhead** | 50 lb copper drum spinner | RT spin (toggle) |
| **Endgame** | teardrop vertical spinner | RT spin (toggle) |
| **Blip** | flywheel-launched deck flipper | RT fire |
| **Tantrum** | translating drum + fist arms | RT spin, **RB thrust**, **LT fists** |

## What's here

```
models/       finished GLBs — modelBody / modelWeapon / modelWheel-N, texture-optimized
reference/    the studio photos, also the bot-select card art
raw/          the Tripo segmentations they were cut from (re-cut for free)
part-maps/    which segmentation parts are the weapon, wheels and aux groups
carve-ops/    glb-carve regions, where segmentation fused a weapon into the chassis
BOT_SPECS.md  research + catalog entries + control mappings
SEGMENTATION.md  how each model was mapped, and what is imperfect about it
PIPELINE_STATE.json  resumable Tripo pipeline state for this round
```

## Applying it

1. Copy `models/*.glb` into `v2/public/models/`.
2. Copy `reference/*.png` into `v2/public/reference/` for the bot-select art.
3. Add the catalog entries from **BOT_SPECS.md** to `src/assets/botCatalog.js`.
4. Wire the extra controls listed in BOT_SPECS.md — three bots need input
   beyond the standard RT: Overhaul's clamp, Free Shipping's flame, and
   Tantrum's carriage thrust and fist arms.

Any bot with a missing GLB or missing part falls back to procedural
placeholder geometry and stays playable, so a partial apply is safe.

## Honest status

Seven of the nine are clean. Two are not, and are called out in detail in
SEGMENTATION.md:

- **Mammoth** — the trunk did not separate from the truss frame. Only the
  central hub spins. This is the one model worth another pass.
- **Tantrum** — the drum came out of Tripo as a slim bar rather than a chunky
  drum. It animates correctly but is under-scaled against the reference.

Neither is blocked on credits (575 remain); both need a `glb-carve` region
measured, the same way Copperhead's drum was recovered.

Three bots ship with no animated wheels (**Shatter**, **Endgame**, **Tantrum**)
because their drives are enclosed by bodywork and segmentation never saw a
wheel. That matches the real robots and is not visible in play.

## Re-cutting without spending credits

The paid Tripo artifacts in `raw/` are pristine. Edit a part map and re-run:

```bash
node tools/bot-pipeline.mjs advance <bot>
```

Inspect any result with `tools/viewer.html?src=…&parts=1` (rainbow part IDs),
`&spin=1` (animate the weapon) or `&tint=0` (real textures — the viewer tints
the weapon red and wheels blue by default).
