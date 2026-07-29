# Bot update drop — Beta & Whiplash

Two new bots generated and segmented, ready to move into the game. **Nothing
here is wired into `v2/` yet** — the game is untouched.

- **[BOT_SPECS.md](BOT_SPECS.md)** — real-world mechanics, what moves and how,
  ready-to-paste catalog entries, and the sim work each bot needs.
- **[SEGMENTATION.md](SEGMENTATION.md)** — how the models were cut up, what
  each part is, and what was verified.

## Contents

```
reference/<id>.png      studio photo — also the UI bot-card image
models/<id>.glb         game-ready model (modelBody / modelWeapon / modelWheel-N)
part-maps/<id>.json     segmentation part -> game part mapping
raw/<id>_seg.glb        Tripo segmentation output (regeneration input)
```

## Installing a bot

```bash
cp v2/updates/new-bots/models/beta.glb          v2/public/models/
cp v2/updates/new-bots/reference/beta.png       v2/public/reference/
cp v2/updates/new-bots/part-maps/beta.json      v2/tools/part-maps/
```

Then add the catalog entry from BOT_SPECS.md to `v2/src/assets/catalog.js` and
a card to `v2/src/ui/botCards.js`. Both bots need a new weapon type in the sim
(`hammer` for Beta, `lifterDisc` for Whiplash) — BOT_SPECS.md describes what
each needs and which existing type is closest.

Until the sim supports those types, a bot will still **load and drive** — the
model loader falls back gracefully and unknown weapon types simply don't fire.

## Re-cutting a model

If a part map needs changing, re-run the partition step against the raw
segmentation (no need to spend Tripo credits again):

```bash
cd v2
node tools/glb-partition.mjs updates/new-bots/raw/beta_seg.glb \
     updates/new-bots/part-maps/beta.json updates/new-bots/models/beta.glb
node tools/glb-texture-optimize.mjs updates/new-bots/models/beta.glb /tmp/beta.glb 92 \
  && mv /tmp/beta.glb updates/new-bots/models/beta.glb
```

Inspect with `tools/viewer.html?bot=<id>` (serve from `v2/`; add `&spin=1` to
animate the weapon, `&parts=1&src=../updates/new-bots/raw/<id>_seg.glb` for the rainbow
part view).
