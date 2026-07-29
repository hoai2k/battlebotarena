# BattleBot Arena v2 — Architecture Contracts

Ground-up redesign of the game in `/v2`, focused on being a playable game (not a
sandbox). Same core fantasy as v1 — drive a real BattleBot, smash the other one,
dodge kill saws — but with a proper simulation, part-separated Tripo models, and
a broadcast-styled UI. v1 stays untouched at the repo root.

## Non-negotiables

- **Feel**: snappy yet weighty. Instant control response, heavy consequences.
- **No bundler**: ES modules via importmap (same pins as v1: three@0.165.0,
  @dimforge/rapier3d-compat@0.14.0 from esm.sh). Serve with root `server.mjs`.
- **No DOM reads inside the frame loop.** Settings flow through the settings
  store; the loop reads plain objects.
- **No `setTranslation`/`setLinvel` writes to dynamic bodies during play** —
  forces and impulses only (the v1 review traced most jitter/penetration bugs
  to mid-contact teleports).
- **One mass source**: `RigidBodyDesc.setAdditionalMassProperties` from the
  catalog; collider densities contribute 0.
- **Plain JS + JSDoc types.** No TypeScript syntax in .js files.

## Directory layout & file ownership

Each area has exactly one owner; do not edit files outside your area.

| Path | Owner | Contents |
|---|---|---|
| `v2/index.html`, `v2/styles/*.css`, `v2/src/ui/*` | UI agent | screens, HUD DOM, styling |
| `v2/src/sim/*` | SIM agent | Rapier world, vehicle, weapons, impacts, hazards |
| `v2/tools/sim-tests.mjs` | SIM agent | headless scenario tests (node) |
| `v2/src/game/*`, `v2/src/assets/*` | GAME agent | match state, AI, input, audio, damage, model loading, bot catalog |
| `v2/src/engine/*`, `v2/src/main.js` | integrator (Claude, later) | renderer, arena visuals, cameras, boot/wiring |
| `v2/src/shared/*` | frozen (already written) | event types, settings store — import, don't edit |
| `v2/public/models/*` | model pipeline | part-named GLBs (arrive later) |

## Layering (imports allowed →)

```
ui  →  game  →  sim
        ↓        (sim never imports upward)
      assets
engine ← main wires everything; ui never imports sim or three.js
```

`shared/` may be imported by anyone. `sim/` must run headless under node
(no DOM, no three.js — plain math + Rapier only) so tests work.

## Event bus (v2/src/shared/events.js — already written, frozen)

The sim and game emit typed events through a tiny emitter; audio, effects, HUD,
and haptics subscribe. This replaces v1's tangled direct calls.

Event payloads (all positions world-space `{x,y,z}`):

- `EV.IMPACT` — `{ botIndex, otherIndex|null, surface: 'bot'|'wall'|'floor'|'ceiling'|'prop', point, normal, force, relSpeed }` from contact force events.
- `EV.WEAPON_HIT` — `{ attackerIndex, targetIndex|null, point, normal, impulse, energyBefore, heavy }` scripted spinner/flipper/crusher budget hits.
- `EV.WEAPON_FIRED` — `{ botIndex, weaponType }` flipper stroke / hammer swing start.
- `EV.WEAPON_SPIN` — `{ botIndex, weaponType, ratio }` emitted when spin ratio changes ≥0.01.
- `EV.HAZARD_CONTACT` — `{ botIndex, kind: 'killSaw'|'screw', point, intensity }` continuous while grinding.
- `EV.HAZARD_LAUNCH` — `{ botIndex, kind, point, impulse }` the big saw pop.
- `EV.DAMAGE` — `{ botIndex, amount, zone: 'body'|'weapon'|'drive', kind, point }` game layer, post-scaling.
- `EV.PART_BREAK` — `{ botIndex, zone, point }` weapon/drive disabled threshold crossed.
- `EV.MATCH` — `{ phase: 'countdown'|'fight'|'ko'|'timeUp'|'results', ... }` match state transitions.

## Settings store (v2/src/shared/settings.js — already written, frozen)

`settings` plain object + `onSettingChanged(key, fn)` + `setSetting(key, value)`
with localStorage persistence under `bba2-*` keys. Defaults include
`soundEnabled: false`, `hapticsEnabled: true`, `cameraMode: 'battle'`,
`aiDifficulty: 'normal'`.

## Sim public API (v2/src/sim/sim.js)

```js
export async function createSim({ bots, emit }) // bots: [BotSimSpec, BotSimSpec]
// -> {
//   stepFrame(frameDtSeconds, inputs),  // inputs: [DriveInput, DriveInput]
//   getRenderState(),   // -> [{ position, quaternion, weaponAngle|weaponRatio, wheelSpin, probeCompression[] }, ...]
//   setPaused(bool), reset(), dispose(),
//   getHazardState(),   // saw positions/blade spin for visuals
//   setKillSawsActive(bool),
// }
```

- Fixed timestep 1/120s accumulator inside `stepFrame`; render state is
  interpolated between the last two ticks. Cap 8 substeps per frame.
- `DriveInput = { leftDrive: -1..1, rightDrive: -1..1, weapon: bool, brake: bool }`
- `BotSimSpec` comes from the catalog (below): masses, dims, wheel probe
  anchors, weapon type/params, collider spec.
- Arena colliders (floor/walls/ceiling/deck slab/saw slots/screw shafts) are
  built inside the sim from `v2/src/sim/arenaSpec.js` constants matching v1's
  ARENA_LAYOUT dims (48ft × 40ft floor, walls, upper deck ramp — copy numbers
  from v1 `src/arenaConfig.js`).

### Physics blueprint (from the v1 review — implement, don't re-litigate)

1. **World**: `numSolverIterations 12`, CCD enabled on bots, gravity −32.174
   (feet units, like v1). `EventQueue(true)`; colliders get
   `ActiveEvents.COLLISION_EVENTS | CONTACT_FORCE_EVENTS` with a force
   threshold; drain per step and translate into `EV.IMPACT` (dedupe/throttle
   per pair, ~60ms).
2. **Vehicle** (per bot): 4 raycast probes at wheel anchors cast along −up,
   travel ~0.45ft. Suspension: spring `k = m·g / (4·restCompression)`,
   damping ζ≈0.4, force via `applyImpulseAtPoint` at the probe. Longitudinal:
   velocity-servo toward `drive * maxSpeed` (accel-limited, the v1 servo shape
   — keep it, it feels controllable), applied as force at grounded probes,
   split per side for tank steering. Lateral: friction-circle clamp
   `|F_lat| ≤ μ·F_n` (μ≈1.1) — no velocity scrubbing. Extra yaw damping torque
   when no turn input. Airborne: no drive forces, light angular damping only.
3. **Spinners** (bar/drum): spin state is scalar energy `E = ½Iω²`; weapon
   mesh spins visually. Weapon collider is a thin solid cuboid/cylinder in its
   own collision group (hits opponent + props, not floor). On contact with
   opponent: impulse budget `J = √(2·m_eff·E·η)`, **cap applied after all
   multipliers**, `applyImpulseAtPoint` at the real contact point (lift
   component included, tuned per weapon type vertical/horizontal), equal-and-
   opposite kickback to attacker, subtract transferred energy from E and
   recompute ω. Per-hit cooldown ~90ms per pair.
4. **Flipper** (bronco): press → stroke window (~0.18s); if opponent chassis
   overlaps the flip zone AABB during stroke, apply upward+forward impulse at
   contact (budget from CO2 pressure param), then return/reload delay.
5. **Crusher** (quantum): hold → clamp force at jaw contact + `EV.DAMAGE`
   ticks while engaged.
6. **Hammer-saw** (sawblaze): arc swing on press; contact during swing =
   medium impulse + grind damage ticks while held on target.
7. **Kill saws**: solid kinematic cuboids animated with
   `setNextKinematicTranslation` rising from floor slots — Rapier launches
   bots for free; add tangential grind impulse + `EV.HAZARD_CONTACT` from
   contact events. Active only when game layer calls `setKillSawsActive(true)`.
8. **Screws** (corner spinners): kinematic cylinders with
   `setNextKinematicRotation`; surface friction conveys bots; grind events on
   contact.
9. **Mass/COM**: from catalog — total weight, COM low and slightly rear,
   yaw inertia < pitch/roll (~0.7×). No density stacking.
10. **Safety rails**: velocity cap ~60ft/s, arena escape clamp = gentle
    inward impulse (not teleport) if outside walls.

### Headless tests (v2/tools/sim-tests.mjs, `node v2/tools/sim-tests.mjs`)

TAP-ish output, exit 1 on failure: settle (bot rests still, no jitter > 0.01),
drive straight (reaches ~maxSpeed, ±5% heading), turn in place, wall crash
(no penetration > 0.05, bounces back), spinner hit ladder (impulse grows with
energy, capped), saw launch (bot leaves floor when parked on active saw),
airborne no-drive, flip (bronco flips target with weapon press at contact).

## Bot catalog (v2/src/assets/catalog.js — GAME agent)

Port stats from v1 `src/botConfig.js` (speeds, weights, weapon params) into:

```js
/** @typedef {{
  id, name, tagline,                      // UI strings
  referenceImage,                          // ../public/reference/<id>.png (reuse v1 images)
  modelPath,                               // ./public/models/<id>.glb (may not exist yet)
  weightLbs, weaponWeightLbs,
  bodyDims: {x,y,z},                      // footprint ft — also placeholder box dims
  wheelAnchors: [{x,y,z}...],             // probe positions, body-local
  maxSpeedFps, accel, turnRate,
  weapon: { type: 'bar'|'drum'|'flipper'|'crusher'|'hammerSaw',
            spinUpSeconds?, inertia?, maxOmega?, budgetCap?,
            pivot: {x,y,z}, axis: {x,y,z} },   // body-local, placeholder until models land
  colliders: [{ shape:'box'|'cylinder'|'hull', ...dims, offset }],
}} BotSpec */
```

All 8 v1 bots must be present with sane numbers (copy v1 values; estimate
wheel anchors from reference images / v1 collider configs).

## Model contract (v2/src/assets/models.js — GAME agent)

`loadBotModel(spec)` → `{ group, parts: { body, weapon|null, wheels: [] } }`.
GLBs have nodes named `modelBody`, `modelWeapon`, `modelWheel-0…N`. **Until
real GLBs land, and whenever a file/part is missing, build placeholder
geometry from `bodyDims` + weapon type** (box chassis, cylinder drum/bar, box
flipper plate) with per-bot accent colors — the game must be fully playable
with placeholders. Weapon pivot/axis from catalog; when a GLB weapon part
exists, its bbox center may override pivot.

## Game layer (v2/src/game/ — GAME agent)

- `match.js`: `createMatch({ sim, specs, emit, on })` — countdown (3-2-1-FIGHT),
  3:00 timer, kill saws activate at final 60s (emit MATCH event for callout),
  damage bookkeeping from EV.WEAPON_HIT / EV.IMPACT / EV.HAZARD_* (convert to
  EV.DAMAGE with zone from contact point height/side), KO at 100% or
  immobilized 10s, results. Damage disables: weapon at threshold (spin decay),
  drive sides at threshold (that side's force × 0.4).
- `ai.js`: port v1 `computeArenaAiInput` shape — pursue/face/attack with
  weapon-type-aware behavior (spinner keeps weapon toward foe; flipper waits
  for proximity), difficulty scales speed/aggression.
- `input.js`: keyboard (W/S/A/D + Q/E split, Space weapon, Shift brake) +
  gamepad (v1 mapping: sticks tank, RT weapon, LB brake) + haptics on
  EV.IMPACT/EV.WEAPON_HIT strength.
- `audio.js`: port root `src/gameAudio.js` verbatim synthesis, but subscribe
  to the event bus instead of exported hook functions; keep keep-alive loop
  pattern; storage key `bba2-sound` via settings store; default off.

## UI (v2/index.html + v2/src/ui/ — UI agent)

Screens as DOM sections toggled by a tiny screen manager: `title`,
`botSelect`, `match` (HUD overlay on canvas), `results`. BattleBots-broadcast
energy: dark carbon/steel textures, bold italic condensed type, red/yellow
accent angle-cut panels, subtle scanline/glow. Title: "BATTLEBOT ARENA" logo
treatment + Fight / Settings. Bot select: 8-card grid using
`../public/reference/*.png`, stat bars (speed/power/armor), weapon type badge,
opponent pick + AI difficulty. HUD: damage bars top corners with bot names,
center match clock, event ticker, KO banner, kill-saw callout. Results:
winner card + Rematch / Change Bots / Title. Sound toggle visible on title +
settings; wire to settings store. UI never imports three/rapier/sim; exposes
`createUI({ onAction })` and reacts to EV.MATCH / EV.DAMAGE via `on`.
Canvas element `#scene` sits behind HUD; integrator owns its context.

## What v2 deliberately drops (v1 had it)

Online multiplayer, collider tweaker, sandbox object spawner, runtime mesh
fracture (replaced by spark bursts + prefab debris chunks + part-disable),
per-bot debug sliders. Don't port them.
