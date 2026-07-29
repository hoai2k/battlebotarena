# BattleBot Arena

A BattleBots-style 3D robot combat game that runs in the browser with **no build
step** — plain ES modules, [three.js](https://threejs.org) for rendering and
[Rapier](https://rapier.rs) for physics, both vendored locally so the game works
completely offline.

Eight bots, each with a real weapon system (drum and bar spinners, a pneumatic
flipper, a hydraulic crusher, a hammer-saw), fight in the BattleBox with live
kill saws and corner screws.

## Run it

```bash
node server.mjs
```

Then open <http://127.0.0.1:4173>. Nothing to install — the browser gets three.js
and Rapier from `vendor/`.

To run the physics tests you do need the Rapier package for Node:

```bash
npm install && npm test
```

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Drive | `W`/`S` + `A`/`D` (`Q`/`E` for extra turn) | Left stick / right stick (tank) |
| Weapon | `Space` | `RT` |
| Secondary weapon (Sawblaze's saw motor) | `R` | `RB` |
| Brake | `Shift` | `LB` |
| Pause | `Esc` | `Start` |
| Menus | Arrows/WASD, `Enter`, `Esc` | D-pad/stick, `A`, `B`, `Start` |

Weapon behavior differs by bot: spinners **toggle** on and off, Bronco's flipper
**fires** per press, Quantum's crusher **bites while held**, and Sawblaze holds
his arm forward while `RT` is down with `RB` toggling the saw motor.

Plug in a second gamepad and it takes over the rival bot automatically. With the
**bot camera** selected in Settings, two players get split-screen chase cams.

## Layout

```
index.html          Game shell + screens
server.mjs          Static file server (streams, range requests)
src/
  main.js           Boot + frame loop; wires everything together
  shared/           Event bus, settings store, music player
  sim/              Physics: Rapier world, vehicles, weapons, hazards (headless,
                    no DOM or three.js — this is what the tests exercise)
  game/             Match state, AI, input, audio, music
  assets/           Bot catalog (stats) + GLB loader with placeholder fallback
  engine/           Renderer, cameras, effects, arena visuals
  ui/               Screens, HUD, gamepad menu navigation
public/
  models/           Part-segmented bot GLBs (modelBody / modelWeapon / modelWheel-N)
  reference/        Bot photos used by the UI
  arena/            Arena textures and decals
  music/            Soundtrack
vendor/             three.js + Rapier (so the game needs no network)
tools/              Dev utilities: sim tests, model pipeline, model viewer
```

Architecture contracts — module boundaries, the event bus, and the physics
blueprint — are documented in [ARCHITECTURE.md](ARCHITECTURE.md).

## Development

```bash
node tools/sim-tests.mjs          # 13 headless physics scenarios
node tools/feel-probe.mjs bronco  # driving response/smoothness metrics
```

Open `tools/viewer.html?bot=minotaur` in the browser to inspect a bot model
(`&spin=1` animates its weapon, `&parts=1` shows raw segmentation parts).

### Bot models

Models are generated with [Tripo](https://www.tripo3d.ai) image-to-3D and then
**mesh-segmented** so each bot's weapon and wheels are separate geometry that the
game animates independently. The pipeline lives in `tools/`:

1. Generate + segment from a reference photo (see `tools/tripo.mjs` in the
   original project) into `tripo_out/<bot>_seg.glb`.
2. Author `tools/part-maps/<bot>.json` — which segmentation parts are the weapon,
   the wheels, and any auxiliary animated pieces.
3. `node tools/glb-partition.mjs tripo_out/<bot>_seg.glb tools/part-maps/<bot>.json public/models/<bot>.glb`

`tools/glb-carve.mjs` does triangle-level surgery (deleting junk geometry or
extracting a sub-part like a saw disc) when segmentation fuses things together.

The game never requires these: any bot with a missing GLB or missing part falls
back to procedural placeholder geometry and stays fully playable.

## Credits

Bot designs are inspired by real BattleBots competitors. Built as a personal
project.
