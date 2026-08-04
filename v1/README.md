# BattleBot Arena v1

The original game. It runs the same way it always did — plain ES modules, no
build step — and it now fights the **full 28-bot roster**, because the machines
built for v2 (repo root) have been ported into it.

```bash
node server.mjs          # from the repo root, then open /v1/
node v1/server.mjs       # or from v1 itself; it serves the shared assets too
```

## The roster

| | bots | model | colliders |
|---|---|---|---|
| **v1 native** | Bite Force, Bronco, HUGE, Quantum, HyperShock, Minotaur | v1's own one-mesh GLBs, split at runtime by the fraction regions in `src/modelPartConfig.js` | hand-authored, hand-tweaked |
| **ported from v2** | the other 22, Sawblaze and Tombstone included | v2's part-segmented GLBs in `../public/models`, picked up by node name | generated from the v2 catalog |

Sawblaze and Tombstone were replaced rather than kept: v1's entries for those two
pointed at GLBs (`sawblaze_3d.glb`, `tombstone_3d.glb`) that were never in the
repo, so they were the two machines v1 could not actually draw.

## How the port works

`src/portedBots.js` is the whole bridge. It reads v2's catalog
(`../../src/assets/catalog.js`) — the researched sizes and speeds, the measured
rigs, the collider stacks — and emits the two shapes v1 runs on: a `BOT_CONFIG`
spec and a `MODEL_PART_CONFIG` entry. Nothing is duplicated by hand, so a fix to
a bot in v2 reaches v1 by re-reading the catalog.

It lines up because v2 authored its numbers in v1's frame. v2's catalog header
says so outright: "body-local, matches v1 fitted-model space" — +Y up, forward
-Z, y=0 the floor, feet. Offsets, pivots and extents port as numbers.

Four things do NOT port, and each is a decision rather than an omission:

- **Model fitting.** v1 scales a raw GLB into a `fit` box; a segmented v2 model
  carries its own scale. Ported entries are marked `segmented: true` and are
  normalized the way v2 does it — yaw, roll, uniform scale, ground the DRAWN
  geometry to y=0, centre on `modelBody`.
- **Mass.** v1 gives every bot the same rigid-body mass and lets collider
  density add the rest. v2's stacks are far more solid, so raw densities would
  have made Mammoth eight times heavier than Minotaur; densities are normalized
  per bot onto v1's own collider-mass band. The two bots that REPLACED a v1
  entry keep the mass that entry carried, so the fights v1 was tuned around
  still play the same.
- **Suspension.** v1 has none: traction comes from colliders marked
  `driveContact`, which are probes rather than solids. Those are synthesized
  from v2's `wheelAnchors`, with their contact patches on the floor plane the
  model rests on.
- **Reach.** v1 measures a spinner's reach to the TARGET'S CENTRE and defaults
  to 1.45ft, which suits its own compact machines. A ported bot takes v2's
  measured reach but never less than its own geometry needs — Witch Doctor's
  drum sits a foot behind a 3.4ft nose, and at v1's default its blade stopped
  short of everything it drove into.

## Mechanisms v1 gained

v1 shipped three weapon families: spinner (bar/drum), impulse flipper, and
Quantum's crusher. The ported roster needed four more, and they are all the same
thing underneath — a part on a hinge, driven to an angle, doing something to
whatever is in front of it. `src/armWeapons.js` owns their state and the shape of
their hits; `src/physics.js` applies them; `src/main.js` draws them.

| type | bots | behaviour |
|---|---|---|
| `hammer` | Beta, Shatter, Rusty | one committed stroke on a slow re-cock, weighted by `stroke²` so a graze near the top of the arc is worth almost nothing, driving DOWN rather than throwing |
| `hammerSaw` | Sawblaze | arm holds down, disc grinds continuously while it is there |
| `lifter` | Duck, Free Shipping | arm HELD at whatever angle it is let go at; lift spreads across the stroke and carries the victim while it stays up |
| `lifterDisc` | Whiplash | the same arm with a disc on its own channel |
| `grappler` | Claw Viper, Overhaul | forks plus a jaw that shuts on them |
| `sawArms` | Dragon King | two saws on a tilting arm |

### And the mechanisms that are not weapons

A weapon type says what a bot swings. It says nothing about the rest of what
these machines do, and every one of these is a separate mechanism with its own
way of failing silently, so every one of them is implemented and measured:

| mechanism | bots | what it does |
|---|---|---|
| carriage (`track`) | Tantrum | the drum rides rails down the middle of the bot: hold the second channel to winch it back and up, release and it fires forward. Its collider goes with it, so a wound-back drum is a foot behind where it can reach anything — and because it is TRAVELLING when it arrives, its hit is boosted after the budget cap |
| punch arms (`fists`) | Tantrum | a third mechanism on a third button, hinged on the axle across the back. Momentary, not latched — a toggle would leave the arms standing in the air |
| flamethrower (`flame`) | Kraken, Free Shipping | a damage cone with no shove, because fire pushes nothing over. Kraken's nozzle points into its own bite and does nothing until the jaw is shut on someone: a finisher, not a ranged attack |
| two-way arm | Duck | the plow swings a half turn, so one channel drives it up, the other down, and it HOLDS wherever it is let go |
| held stroke | Rusty | the axe stays DOWN while the trigger is down and re-cocks when you let go, on one button — the real machine's gantry failed at re-cocking often enough to leave the head dragging |
| grip | Claw Viper, Overhaul | jaw shut plus forks down is a hold: the victim is servoed onto a point that sweeps with the arm and its tumbling is damped, so it can be carried. Opening the jaw hands back the arm's speed, which is what makes a lift past vertical a throw |
| latched jaw + body lift | Dragon King | four mechanisms on four buttons: the jaw latches (you have to keep hold of something while both hands drive), the saws latch, the arms tilt, and the body rears up about the axle at the back of its track pods — the only way this machine reaches a bot BEHIND it. The pods counter-rotate so they stay flat on the floor |
| overhead stall | Gigabyte | its rotor IS its roof, so a hammer that lands square on it stops the shell dead and jams it for a beat. Only a weapon that declares it can be stopped this way |
| own-hit pitch | Deep Six | its own hits tumble it, which is why the biggest weapon in the game is not simply the best |
| magnets (`downforce`) | Beta | what stops a 24lb hammer head from throwing the machine over every time it lands |
| srimech | every arm that reaches the floor | one impulse per stroke at the arm's business end. Rolling a flat 250lb machine over its own edge has to beat its own weight the whole way, so a torque spread across the arm just rocks it |
| omniwheels | Glitch, Shatter | not tank-steered at all: the left stick translates (forward/back AND sideways), the right stick rotates, independently |
| tracks | Rusty, Dragon King | tracks do not coast — the stop is commanded in full the instant the input goes. Deceleration only: no extra acceleration, no extra grip in a turn. It is why neither needs a brake |

**Three more control channels** came with them:

| channel | gamepad | keyboard (P1 / P2) | what it runs |
|---|---|---|---|
| weapon | RT | Space / Enter | the primary mechanism |
| second | RB | Left Shift / Right Shift | saw motors, discs, jaws, Tantrum's carriage, the flamethrowers, Duck's plow on the way down |
| third | LB (brake) | F / `.` | Tantrum's punch arms |
| fourth | LT (boost) | G / `/` | Dragon King's body lift |

The third and fourth take over a driving button, but only for the machines that
have something to put there — Tantrum keeps its boost, Dragon King keeps its
brake, and both run on drivetrains that stop themselves anyway. One function
(`resolveWeaponControls`) decides, so nothing else has to know which bot is
which.

A grappler also does a little damage while it holds you, which v2 deliberately
gives it none of — v2 fights can be won on the judges' cards, and v1's cannot.

## Checking it

```bash
npm run test:physics                        # the whole physics suite, 30 checks
node v1/tools/ported-bot-audit.mjs          # orientation, size, rig, colliders
node v1/tools/drive-smoothness-probe.mjs    # per-bot drive quality
node v1/tools/weapon-mechanism-probe.mjs    # per-bot weapon + does it land
node v1/tools/mechanism-probe.mjs           # carriages, fire, grips, tracks, srimechs
node server.mjs & node v1/tools/boot-probe.mjs --arena   # the real page, per bot
```

The first two checks in the physics suite are the ported roster's own: every
ported bot has to drive like a v1 bot (sit still, reach and hold top speed, track
straight, stay flat and gripped, stop without hopping, spin both ways), and every
ported bot has to be able to fight (the mechanism moves, and it reaches an
opponent it is driving into). The audit measures the models through v1's own
loader and compares them with the catalog they came from; the boot probe loads
the real page in a real browser, because that is the only place `main.js` runs.
