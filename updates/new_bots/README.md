# Bot update drop — Deep Six, Claw Viper, Witch Doctor & Hydra

Four new bots generated and segmented, ready to move into the game. **Nothing
here is wired into `v2/` yet** — the game is untouched.

- **[BOT_SPECS.md](BOT_SPECS.md)** — real-world mechanics, what moves and how,
  ready-to-paste catalog entries, and the sim work each bot needs.
- **[SEGMENTATION.md](SEGMENTATION.md)** — how the models were cut up, what
  each part is, and what was verified.

Earlier drops (Beta and Whiplash, plus the weapon-tuning and
weapon-collider-dims changes) live in [`../../completed_updates/`](../../completed_updates).

## Contents

```
reference/<id>.png      studio photo — also the UI bot-card image
models/<id>.glb         game-ready model (modelBody / modelWeapon / modelWheel-N)
part-maps/<id>.json     segmentation part -> game part mapping
raw/<id>_seg.glb        Tripo segmentation output (regeneration input)
```

| Bot | Weapon | New sim type needed? |
|---|---|---|
| Deep Six | Oversized vertical bar spinner | No — reuses `bar`, but wants a `gyroScale` so big hits tumble *it* |
| Claw Viper | Grappling claw + lifter | **Yes — `grappler`** (holding a carried opponent is the hard part) |
| Witch Doctor | Vertical disc spinner | No — reuses `drum` |
| Hydra | Hydraulic flipper | No — reuses `flipper` with a much stronger impulse and a 4 s reload |

## Installing a bot

```bash
cp v2/updates/new-bots/models/deepsix.glb      v2/public/models/
cp v2/updates/new-bots/reference/deepsix.png   v2/public/reference/
cp v2/updates/new-bots/part-maps/deepsix.json  v2/tools/part-maps/
```

Then add the catalog entry from BOT_SPECS.md to `v2/src/assets/catalog.js` and
a card to `v2/src/ui/botCards.js`.

Until the sim supports a bot's weapon type, it will still **load and drive** —
the model loader falls back gracefully and unknown weapon types simply don't
fire.

## Re-cutting a model

If a part map needs changing, re-run the partition step against the raw
segmentation (no need to spend Tripo credits again):

```bash
cd v2
node tools/glb-partition.mjs updates/new-bots/raw/deepsix_seg.glb \
     updates/new-bots/part-maps/deepsix.json updates/new-bots/models/deepsix.glb
node tools/glb-texture-optimize.mjs updates/new-bots/models/deepsix.glb /tmp/d.glb 92 \
  && mv /tmp/d.glb updates/new-bots/models/deepsix.glb
```

Inspect with `tools/viewer.html?src=../updates/new-bots/models/<id>.glb`
(serve from `v2/`; add `&spin=1` to animate the weapon,
`&parts=1&src=../updates/new-bots/raw/<id>_seg.glb` for the rainbow part view).
`tools/glb-part-bounds.mjs` reports combined bounds for a set of parts, which
is how every pivot in these maps was measured.
