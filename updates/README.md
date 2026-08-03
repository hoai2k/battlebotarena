# New bots — Glitch, Kraken, Gigabyte, Rusty, Dragon King

Five part-segmented bot models ready to drop into the v2 game, plus the
research and integration notes to wire them up.

| Bot | Weapon | RT | RB | LB |
|---|---|---|---|---|
| **Glitch** | 58 lb S7 eggbeater drum, X-drive | drum spin | — | — |
| **Kraken** | pneumatic air-bag crusher + in-mouth flamethrower | jaw crush | flame | — |
| **Gigabyte** | 120 lb full-body shell spinner | shell spin | — | — |
| **Rusty** | rear-gantry pneumatic hammer, tracked | swing | retract / re-cock | — |
| **Dragon King** | twin saws on articulated arms + clamping jaw, rotating track pods | saw blades | jaw clamp | arms raise/lower |

## What's here

```
models/       finished GLBs — modelBody / modelWeapon / modelWeaponSub-* / modelAux-* / modelWheel-N
reference/    the source photos, also the bot-select card art
raw/          the Tripo segmentations they were cut from (re-cut for free)
part-maps/    which segmentation parts became which game part
BOT_SPECS.md  research, catalog entries, control mappings, sim work
SEGMENTATION.md  how each model was mapped and what is imperfect
PIPELINE_STATE.json  resumable Tripo pipeline state for this round
```

## Applying it

1. Copy `models/*.glb` → `v2/public/models/`.
2. Copy `reference/*.png` → `v2/public/reference/`.
3. Add the catalog entries from **BOT_SPECS.md** to `src/assets/catalog.js`.
4. Wire the extra controls: Kraken's flamethrower (RB), Rusty's manual retract
   (RB), and Dragon King's jaw (RB) and saw arms (LB).

Any bot with a missing GLB or missing part falls back to procedural placeholder
geometry and stays playable, so a partial apply is safe.

## Honest status

All five weapons are rigged and verified. Two caveats, detailed in
SEGMENTATION.md:

- **Dragon King** — the dragon's articulating upper jaw did not separate
  cleanly, so `modelAux-jaw` is the front grabber assembly rather than
  literally the upper jaw. It reads as a clamp; a `glb-carve` pass would make
  it exact. Everything else on this bot (twin saws, saw arms, both track pods)
  is clean, and it is the most complex rig in the project — five animated groups.
- **Kraken** — its two wheels are ~10% asymmetric (z = +0.30 vs −0.24). That is
  a Tripo generation artifact, not a mapping error, and `glb-rig-check` flags it
  by design.

**Three bots ship with no animated wheels**, all correctly: Glitch's omniwheels
sit under the wedge, Gigabyte's wheels under the shell, and **Rusty and Dragon
King are tracked** — the model contract has no track primitive, so their track
units stay in the body. Options for animating tracks are in SEGMENTATION.md.

Gigabyte deserves a specific note: its "everything fused into one part"
segmentation is normally a defect but is exactly right here — on a full-body
spinner the only visible thing that *doesn't* rotate is the central
self-righting pole, which is correctly left in `modelBody`.

## Re-cutting without spending credits

The paid Tripo artifacts in `raw/` are pristine. Edit a part map and re-run:

```bash
BOT_DROP=updates node tools/bot-pipeline.mjs advance <bot>
```

Verify a rig without opening a browser:

```bash
node tools/glb-rig-check.mjs updates/models/*.glb
node tools/glb-rig-check.mjs --expect-drop updates/models/dragonking.glb
```

Inspect visually with `tools/viewer.html?src=…` plus `&parts=1` (rainbow part
IDs), `&spin=1` (animate the weapon), or `&tint=0` (real textures — the viewer
tints the weapon red and wheels blue by default).

## Cost

350 Tripo credits (5 × generate 30 + segment 40), from a starting balance of
465. Every task id is recorded in `PIPELINE_STATE.json` as soon as it is paid
for, so an interrupted round resumes without buying anything twice.
