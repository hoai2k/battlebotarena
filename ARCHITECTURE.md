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
- `EV.WEAPON_HIT` — `{ attackerIndex, targetIndex|null, point, normal, impulse, appliedImpulse, energyBefore, heavy }` scripted weapon hits. `impulse` is the DAMAGE proxy (what `match.js` scales); `appliedImpulse` is the physical impulse the body received (effects, haptics).
- `EV.WEAPON_FIRED` — `{ botIndex, weaponType }` flipper stroke / hammer swing start.
- `EV.WEAPON_SPIN` — `{ botIndex, weaponType, ratio, hapticScale }` emitted when spin ratio changes ≥0.01.
- `EV.HAZARD_CONTACT` — `{ botIndex, kind: 'killSaw'|'screw', point, intensity }` continuous while grinding.
- `EV.HAZARD_LAUNCH` — `{ botIndex, kind, point, impulse }` the big saw pop.
- `EV.DAMAGE` — `{ botIndex, amount, zone: 'body'|'weapon'|'drive', kind, point }` game layer, post-scaling.
- `EV.PART_BREAK` — `{ botIndex, zone, point }` weapon/drive disabled threshold crossed.
- `EV.MATCH` — `{ phase: 'countdown'|'fight'|'ko'|'timeUp'|'results', ... }` match state transitions.

## Settings store (v2/src/shared/settings.js — already written, frozen)

`settings` plain object + `onSettingChanged(key, fn)` + `setSetting(key, value)`
with localStorage persistence under `bba2-*` keys. Defaults include
`soundEnabled: false`, `hapticsEnabled: true`, `cameraMode: 'bot'`,
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
- `DriveInput = { leftDrive: -1..1, rightDrive: -1..1, weapon: bool, sawActive: bool, brake: bool }`
  — `sawActive` is the secondary (RB) channel: Sawblaze's saw motor, Whiplash's disc.
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
6b. **Hammer** (beta): fast stroke, slow re-cock, and the strike lands LATE in
   the arc — the head is worth `stroke²` of the budget, so a graze near the top
   is nothing. Standing `downforce` (magnets) and a damped strike reaction keep
   it from throwing itself over; firing while inverted self-rights it.
6c. **Lifter + disc** (whiplash): the arm is HELD at an angle rather than
   fired, so lift spreads across the stroke and an opponent can be carried at
   whatever height the player holds. The disc is an independent spinner on the
   `sawActive` channel dealing continuous contact damage.
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
  canDriveInverted?,                       // keeps driving upside down (Witch Doctor)
  hideWheels?,                             // no procedural wheel fallback (enclosed drive)
  weapon: { type: 'bar'|'drum'|'flipper'|'crusher'|'hammerSaw'
                 |'hammer'|'lifterDisc'|'grappler',
            spinUpSeconds?, inertia?, maxOmega?, budgetCap?,
            pivot: {x,y,z}, axis: {x,y,z} },   // body-local, placeholder until models land
  colliders: [{ shape:'box'|'cylinder'|'hull', ...dims, offset }],
}} BotSpec */
```

All 8 v1 bots must be present with sane numbers (copy v1 values; estimate
wheel anchors from reference images / v1 collider configs). The roster has
since grown to 14; `BOT_IDS` is the single source of truth for it, and both
the sim tests and the roster grid size themselves off it.

### Weapon types beyond v1's five

- `hammer` (Beta) — one heavy overhead stroke on a slow re-cock. The hit lands
  near the BOTTOM of the arc (`strikeAt`), scaled by `stroke²`; firing at first
  possible contact instead delivers about a tenth of the power.
- `lifterDisc` (Whiplash) — a lifting arm plus an arm-mounted disc on its own
  channel. The disc motor rides `input.sawActive`, not the weapon button.
- `grappler` (Claw Viper) — forks on the weapon button, jaw on `sawActive`.
  It takes a grip when the jaw is shut, the forks are DOWN and the foe is in
  the front zone, then servos the victim onto a grip point that sweeps with the
  arm, reacting the pull back into the hinge. Opening the jaw releases and
  hands over the arm tip's speed, so a lift past vertical throws.
- `weapon.selfRight` lets a flipper right itself by firing against the floor;
  its `getRatio()` doubles as a reload meter (0 while cocked, ramping to 1 as
  the stroke returns).
- `tuning.ownerPitchScale > 0` (Deep Six) makes a spinner's own hits tumble it
  — the reason the biggest weapon in the game is not simply the best.

## Weapon tuning (v2/src/sim/weaponTuning.js — SIM)

The catalog nests per-bot weapon numbers under `weapon.tuning`. `weapons.js`
does not read them directly: `resolveWeaponTuning(spec)` flattens the block
(tuning wins over weapon-level wins over defaults) and `createSpinnerModel(spec)`
runs v1's spinner shaping chain over it. The numbers are raw v1 values in v1
units, so the module also owns the bridge — v1 rigid bodies used
`mass = weightLbs * 0.075`, v2 uses true slugs, so a v1 impulse ports across at
`V1_IMPULSE_TO_V2` (0.41441) and torque impulses port by the per-bot
angular-inertia ratio.

Consequences worth knowing before touching it:

- `weapon.budgetCap` is v1's `spinnerImpactCap`, applied INSIDE the chain
  before `impulseScale` and the unit bridge. It is in v1 impulse units.
- `EV.WEAPON_HIT.impulse` is a DAMAGE proxy (v1's pre-`impulseScale` hit
  strength); `appliedImpulse` is what the body actually received. `match.js`
  reads the former, effects/haptics the latter.
- `DAMAGE_CALIBRATION` sets match pace; `WEAPON_TUNING.hitCooldownSeconds`
  sets hit rate. Those two are the knobs, in that order.
- `tuning.gyroBoost` (v2-only, default 1) multiplies the gyro reaction. v1's
  chain is all but inert here — v2's raycast suspension resists roll and pitch
  far harder than v1's did, and the yaw servo eats the rest, so even at
  `gyroScale`'s ceiling of 4 a grounded bot moves a fraction of a degree. Deep
  Six runs 40, which takes its lean under a hard turn from 7.8° to 9.9° and
  leaves the straight line untouched. Left at 1 the chain is exactly v1's.

### Weapon reach — the two ways a spinner ends up unable to hit anything

`weapon.radius` sizes the swept-disc collider, and it must be the **swept**
radius: the max perpendicular distance from the axle over every blade vertex,
measured through the loader. The bbox at the baked pose understates an
asymmetric blade — Deep Six's S-blade reads 1.26 that way against a true 1.368.

Check the weapon part is the WHOLE weapon before trusting that measurement.
Tripo segmented only a sliver of Bite Force's and Hypershock's drums, so their
swept numbers are lower bounds, not truth; render the part against the collider
(`tools/viewer.html`) rather than reading the number off a script. HUGE,
Tombstone, Witch Doctor, Minotaur and Deep Six segmented cleanly and their
measurements are real.

More important, **the body collider in front of a spinner decides whether the
blade can ever reach**. A disc only reaches far forward at its own axle height;
the low part of its sweep is deep inside the machine. So any solid forward of
that is a stand-off that keeps opponents outside the disc entirely. Deep Six,
Bite Force and Witch Doctor all shipped that way and could not land a single
head-on hit; the front wedges and fork rows now carry no collider at all, and
bots drive over them the way they do on the real machines. Nothing can climb a
wedge in this sim: `SUSPENSION_RAY_GROUPS` excludes `GROUP.BOT`, so probes only
ever stand on the arena, and adding a mere 0.04ft pad in front of Deep Six
takes his hit count across nine test opponents from 10 back to 2.

The invariant — every spinner's swept circle must reach further forward than
any of its own body colliders — is asserted in `tools/sim-tests.mjs`. Aim for
0.1-0.2ft of protrusion; that leaves a wedge bot able to get under a drum that
rides high, which is a matchup, not a bug (Whiplash still slides under Bite
Force, Minotaur under Witch Doctor).

Fixing reach changes hit RATE, never hit STRENGTH — `model.hit()` never sees a
collider. Over four 30s AI matches per bot the repair took Bite Force from 3
hits to 35, Witch Doctor from 1 to 29 and Hypershock from 31 to 60, with
per-hit damage identical on the `weapon-tuning-verify` ladder.

`node tools/weapon-tuning-verify.mjs` prints the hit ladder per spinner —
today's sim, the v1 reference, and what the module produces — against the real
catalog. Re-run it after any tuning edit.

## Model contract (v2/src/assets/models.js — GAME agent)

`loadBotModel(spec, { onProgress } = {})` → `{ group, parts: { body,
weapon|null, wheels: [] } }`. `onProgress(fraction|null)` reports GLB download
progress — a 0..1 fraction while the response carries a total, `null` when it
does not (chunked/gzipped responses), which callers render as an indeterminate
bar. Parsed responses are cached, so a rematch does not re-download.
GLBs have nodes named `modelBody`, `modelWeapon`, `modelWheel-0…N`, plus
`modelWeaponSub-<name>` for a part that swings with the arm AND turns on its
own (Sawblaze's saw, Whiplash's disc, Claw Viper's jaw — its
`extras.pivotLocal` is honoured when present, since a jaw hinges at its
knuckle while a disc turns about its bbox centre) and `modelAux-<name>` for a part
anchored at its base and scaled (Bronco's ram). `tools/part-maps/README.md`
documents the contract from the segmentation side. `hideWheels: true` skips
the procedural wheel fallback for a bot whose real wheels are enclosed by its
shell (Beta, Deep Six, Hydra) — the suspension still runs off `wheelAnchors`.

**Weapon arm angles (`restAngle` / `fireAngle`) must be measured in GAME
space, through the loader** — after `modelYaw`, `modelScale` and grounding.
Measuring in raw GLB space is off by enough to bury a fork half a foot in the
floor. Measure the arm's TRANSFORMED VERTICES, not `Box3.setFromObject`: that
returns the AABB of the arm's rotated AABB, which on a pitched arm reads up to
0.7ft low and makes an arm resting cleanly on the deck look buried. (Grounding
the whole model is unaffected — `modelYaw` is a rotation about Y, which leaves
y extents exact.) **Until
real GLBs land, and whenever a file/part is missing, build placeholder
geometry from `bodyDims` + weapon type** (box chassis, cylinder drum/bar, box
flipper plate) with per-bot accent colors — the game must be fully playable
with placeholders. Weapon pivot/axis from catalog; when a GLB weapon part
exists, its bbox center may override pivot.

### Model repair tools (v2/tools/)

The GLBs are photogrammetry, so they carry scan artefacts the reference photos
could not see around. Repairs are re-runnable steps over the *shipped* GLB
(they need the `model*` group nodes, so they run after `glb-partition`), each
driven by a checked-in spec so the edit is reviewable and repeatable:

| Tool | Spec | Fixes |
|---|---|---|
| `glb-add-panels.mjs` | `tools/repairs/tombstone-panels.json` | surfaces the scan never saw — Tombstone had no rear panel and no floor, so you could see into the chassis from behind or below |
| `glb-erase-decal.mjs` | `tools/repairs/huge-eyes.json` | livery mirrored onto the wrong side — HUGE's eyes are bolted to the front of the frame only, but the scan painted (and embossed) them on the rear faces too |
| `glb-carve.mjs` | `tools/repairs/hypershock-weapon.json` | parts the segmenter mis-assigned — Hypershock's `modelWeapon` had swallowed the front scoop and a fin, which then counter-rotated with the drum |

`glb-erase-decal.mjs` needs `sharp` (`npm i --no-save sharp`) and takes an
optional debug directory that dumps what it saw and what it selected.

A panel's coordinates have to respect the parts that MOVE. Tombstone's floor
pan sits below the bar's swept disc rather than at skirt height, because the
bar pivots at its own centre and sweeps most of the chassis footprint — a pan
at the height of the side skirts had the blade passing straight through it.

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

`loader.js` owns the shared wait overlay (`#asset-loader`): `createLoader()` →
`{ show, setTitle, setDetail, setProgress, hide }`. The integrator drives it
around anything the player waits on — chiefly `startMatch()`, which pulls two
10-17MB GLBs and boots the physics engine. `setProgress(null)` switches the bar
to an indeterminate sweep. A separate boot gate is baked into `index.html` and
removed once the module graph resolves, so the first paint is never blank.

**Two-controller bot select.** With two pads connected, `gamepadNav` gives each
pad its own cursor (`duoScreens: ["botSelect"]`) and reports the presser to
`onActivate(el, player)` / `onBack(screen, player)`; pad slot order is the dense
`getGamepads()` order, matching `game/input.js`, so menu P1/P2 are the same
people as sim bots 0/1. Each player claims and releases only their own slot —
A on a free card takes it, A on your own card drops it, A on the other player's
card does nothing. With 0-1 pads the screen keeps the sequential YOU → RIVAL
flow, and mouse/keyboard always act as player 1. Only cursor 0 takes real DOM
focus; cursor 1 is a class-only ring, since a document has one active element.

## What v2 deliberately drops (v1 had it)

Online multiplayer, collider tweaker, sandbox object spawner, runtime mesh
fracture (replaced by spark bursts + prefab debris chunks + part-disable),
per-bot debug sliders. Don't port them.
