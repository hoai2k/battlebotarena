# Update — wire `weapon.tuning` into the sim (and make the numbers mean something)

**Status:** ready to apply, nothing in `v2/` is touched.
**Area:** `v2/src/sim/` (SIM), one line in `v2/src/sim/sim.js`, one optional
value in `v2/src/assets/catalog.js` (GAME).

```
weaponTuning.js   -> copy to v2/src/sim/weaponTuning.js
verify.mjs        -> node v2/updates/weapon-tuning/verify.mjs   (before/after numbers)
README.md         -> this file: why, what changes, how to apply
```

## The bug

`v2/src/sim/weapons.js` reads `w.efficiency`, `w.impulseScale`,
`w.strokeSeconds`, `w.returnSeconds`, `w.swingSeconds`, `w.kickbackScale`,
`w.reach`, `w.clampForce` off the weapon object. The catalog nests all of them
under `weapon.tuning`. Every bot therefore runs on the generic defaults, and the
per-bot numbers ported from v1 never reach the sim.

Two exceptions already read the nested block correctly and work today:
`models.js` (`tuning.sawCenter`) and `ai.js` (`tuning.returnSeconds`) — which
means the AI's reload estimate and the sim's actual reload currently disagree
(AI assumes Bronco's 2.0s, the sim uses the 1.2s default).

## Why "just read `w.tuning.x`" is the wrong fix

The tuning values are raw v1 numbers, and v1 fed them through a different chain
in different units. Reading them as-is makes the sim *worse*:

| | today | naive `tuning.impulseScale` |
|---|---|---|
| Bite Force | budget cap binds above 20% spin | binds above **1.3%** spin |
| Hypershock | binds above 16% | binds above 1.6% |
| Minotaur | binds above 8% | binds above 2.3% |
| Tombstone | never binds | binds above 4.1% |

`tuning.impulseScale` (4.4–18) is v1's `spinnerTargetImpulseScale`, which v1
applied **after** its cap; v2 applies its cap after all multipliers (per
ARCHITECTURE.md), so feeding it in pins every hit at `budgetCap` from the moment
the blade starts moving.

That also exposes the state of things today: all three drums already sit on the
cap above ~10–20% spin, so Bite Force, Hypershock and Minotaur currently deal
**the same flat hit** (11.8–12.7 ft/s launch, 4.2–4.5% damage) at every spin
speed above idle. There is no spin-up ramp and no per-bot character.

## What this update does

`weaponTuning.js` ports v1's whole spinner chain (`src/physics.js`
`applySpinnerHit` / `applySpinnerOwnerReflection` / `applySpinnerGyro` /
`drainSpinner`) and bridges the units:

> v1 rigid bodies used `mass = weightLbs * 0.075` (18.75 for a 250 lb bot);
> v2 uses true slugs, `weightLbs / 32.174` (7.77). Same feet, same gravity — so
> a v1 impulse ports across by the mass ratio, **× 0.41441**. Torque impulses
> port by the angular-inertia ratio (per bot, per axis) via `toV2Torque()`.

With that bridge the v1 numbers are usable verbatim and reproduce v1's feel
exactly. `node verify.mjs` prints this (target launch ft/s, damage % per hit):

```
Bite Force  (drum, cap 120)          Tombstone  (bar, cap 500)
 spin    now          new             spin    now          new
 0.25  CAP 11.8  4.2%   3.9  0.8%     0.25    14.4  3.2%   14.4  0.8%
 0.50  CAP 11.8  4.2%  10.2  1.0%     0.50    28.8  6.5%   38.0  1.2%
 0.75  CAP 11.8  4.2%  19.1  2.0%     0.75    43.2 12.1%   70.8  2.4%
 1.00  CAP 11.8  4.2%  30.4  3.4%     1.00    57.6 16.2%  112.7  4.1%
```

Behaviour that comes back with it:

- **Spin-up matters.** Hits scale from a nudge to a launch instead of being
  flat-capped; `bite` also rewards head-on closing speed.
- **Bots differ.** Minotaur becomes the damage dealer with little knockback
  (`impulseScale` 4.4, `kickbackScale` 0.12); Tombstone becomes the launcher
  (`impulseScale` 18, `impactScale` 1.55) that yaws itself hard on every hit;
  HUGE gets its mid-spin power hump (`halfSpeedPowerMultiplier` 4.0).
- **Spinners bleed speed on contact.** v1 kept 3–28% of blade speed after a
  hit, so a big hit costs you the spin-up. v2 currently loses ~4% of *energy*
  per hit, i.e. the blade never slows. This is the single biggest feel change.
- **Vertical spinners pop bots up.** `liftVelocity` (4.0–4.5 ft/s floor) is
  applied as a top-up impulse, not v1's `setLinvel` — v2's no-teleport rule
  holds. `liftClearance` is deliberately dropped (it was v1's re-collision
  guard; v2's 90 ms per-pair cooldown already covers it).
- **Gyro.** A spun-up weapon fights the drive (`gyroScale` 0.55–1.45): pitch
  under throttle, roll/yaw into turns. Optional, see step 4.

Tombstone's 112 ft/s full-spin launch is real v1 behaviour; `vehicle.js`'s
60 ft/s safety rail clamps it, which is a reasonable ceiling — no change needed.

## How to apply

### 1. Drop in the module

```bash
cp v2/updates/weapon-tuning/weaponTuning.js v2/src/sim/weaponTuning.js
```

### 2. `v2/src/sim/weapons.js` — spinner

Import it:

```js
import { createSpinnerModel, resolveWeaponTuning, damageImpulseForRate } from "./weaponTuning.js";
```

In `createSpinner`, after `const w = spec.weapon;`:

```js
  const model = createSpinnerModel(spec);
  const tuning = model.tuning;
```

Replace the body of `hitTarget` with:

```js
  function hitTarget(foe, contact, simTime) {
    const energyBefore = energy();
    const h = horizontalBetween(vehicle.body.translation(), foe.body.translation());
    const rel = m.sub(foe.body.linvel(), vehicle.body.linvel());
    const hit = model.hit({
      ratio: omega / w.maxOmega,
      targetSpec: foe.spec,
      approachSpeed: Math.max(0, -m.dot(rel, h)),
    });
    if (hit.push < 1) return;

    // Target: horizontal push + lift at the real contact point.
    foe.body.applyImpulseAtPoint(
      m.add(m.scale(h, hit.push), m.scale(UP, hit.lift)),
      contact.point,
      true,
    );
    // v1 forced a minimum upward velocity here (setLinvel). Impulse top-up
    // instead — same result, no teleport.
    const vy = foe.body.linvel().y;
    if (hit.liftVelocityFloor > vy) {
      foe.body.applyImpulse(m.scale(UP, (hit.liftVelocityFloor - vy) * foe.mass), true);
    }
    const right = m.norm(m.cross(UP, h), { x: 1, y: 0, z: 0 });
    foe.body.applyTorqueImpulse({
      x: right.x * hit.targetPitchTorque,
      y: hit.targetYawTorque,
      z: right.z * hit.targetPitchTorque,
    }, true);

    // Attacker: kickback along -h, a little downward, plus counter-yaw.
    vehicle.body.applyImpulseAtPoint(
      m.add(m.scale(h, -hit.kickback), m.scale(UP, -hit.kickbackLift)),
      pivotWorld(),
      true,
    );
    vehicle.body.applyTorqueImpulse({ x: 0, y: -hit.ownerYawTorque, z: 0 }, true);

    // v1 drained blade *speed*, not energy — a solid hit costs the spin-up.
    omega *= hit.spinRetained;

    emit(EV.WEAPON_HIT, {
      attackerIndex: index,
      targetIndex: foe.index,
      point: contact.point,
      normal: contact.normal,
      impulse: hit.damageImpulse,   // damage proxy: v1's pre-scale hit strength
      appliedImpulse: hit.push,     // what the body actually got, for effects/haptics
      energyBefore,
      heavy: hit.push / foe.mass >= 12, // "heavy" = it launched them (ft/s), not "it capped"
    });
    lastHitAt.set("foe", simTime);
  }
```

`hitArena` keeps its shape; swap `w.efficiency ?? 0.4` for `tuning.efficiency`.

In `update()`, gate on the tuning reach/ratio as before — no change needed —
and, if you want the gyro (step 4), add it there.

> **Damage note.** The event's `impulse` is now v1's *pre-`impulseScale`* hit
> strength × `(1.55 + 0.55·ratio)` × `DAMAGE_CALIBRATION` (0.6), not the applied
> impulse. That is deliberate: v1 damaged off the raw hit and launched off the
> scaled one, which is why Minotaur hurts without shoving and Tombstone throws
> you across the box. `match.js` needs no change; 0.6 keeps the hardest hit in
> the game at ~4.5%, i.e. today's ceiling. Move that one constant to change
> match pace. Consider also raising `TU.hitCooldownSeconds` 0.09 → 0.18 (v1's),
> or the ramp just doubles the hit rate.

### 3. `v2/src/sim/weapons.js` — flipper, crusher, hammer-saw

Replace the per-weapon `w.x ?? default` reads with the resolver:

```js
  const t = resolveWeaponTuning(spec);
  // flipper
  const strokeSeconds = t.strokeSeconds;   // bronco 0.18
  const returnSeconds = t.returnSeconds;   // bronco 2.0 (was silently 1.2 — ai.js already assumes 2.0)
  const zone = t.zone ?? frontZone(spec, t.reach ?? 1.8);
  // hammer-saw
  const swingSeconds = t.swingSeconds;     // sawblaze 0.35 (was 0.4)
```

Crusher hold damage and saw grind damage have tuning values that are rates, so
express them as event impulses:

```js
  // crusher, per tick, instead of the hard-coded clampForce * tick:
  impulse: damageImpulseForRate(t.holdDamagePerSecond || 6, TU.crusherTickSeconds),
  // hammer-saw grind, instead of TU.hammerGrindImpulse:
  impulse: damageImpulseForRate(t.grindDamagePerSecond || 5, TU.hammerGrindTickSeconds),
```

(That mirrors `match.js`'s `WEAPON_HIT_DAMAGE_PER_IMPULSE`. If you'd rather not
duplicate the constant, add an optional `damagePercent` to the `EV.WEAPON_HIT`
payload and have `match.js` prefer it when present — one line each side.)

Bronco's `budgetCap` 180 already equals `liftVelocity` 23 ft/s × 7.77 slugs, so
the flip strength is correct as-is. `tuning.pitchVelocity` (10.2) is still
unmodelled; if you want the backflip to be explicit rather than emergent from
the offset contact point, add
`foe.body.applyTorqueImpulse({x: right.x * t.pitchVelocity * foe.inertia.x, ...})`.

### 4. Gyro (optional, one line in `sim.js`)

`weapons[i].update()` only gets the weapon button, so the gyro needs the drive
axes. In `v2/src/sim/sim.js`:

```js
      weapons[i].update(FIXED_DT, inputs[i].weapon, {
        foe: vehicles[1 - i],
        simTime,
        world,
        input: inputs[i],        // <- add
      });
```

and in the spinner's `update()`:

```js
      const gyro = model.gyroTorque({
        ratio,
        throttle: ((ctx.input?.leftDrive ?? 0) + (ctx.input?.rightDrive ?? 0)) / 2,
        turn: ((ctx.input?.leftDrive ?? 0) - (ctx.input?.rightDrive ?? 0)) / 2,
        dt,
      });
      if (gyro) vehicle.body.applyTorqueImpulse(gyro, true);
```

### 5. Catalog (GAME area) — one dropped value

`huge.weapon.tuning` is missing `impactScale: 1.05` (v1 `spinnerImpactScale`).
Every other spinner's v1 tuning is present and correct. Also fix the stale
comment on `budgetCap` in the catalog header: it is v1's `spinnerImpactCap`,
which v1 applied *before* `targetImpulseScale`, so it is not "same units as sim
impulses" — with this update it is applied at the same point v1 applied it.

Unrelated but noticed while diffing: `yawDamping`, `maxBoostSpeed` and
`canDriveInverted` exist in v1 `botConfig.js` for every bot and have no catalog
equivalent.

### 6. Verify

```bash
node v2/updates/weapon-tuning/verify.mjs
node v2/tools/sim-tests.mjs
```

`verify.mjs` reads the real catalog, so re-run it after any tuning edit. The
sim-tests "spinner hit ladder" case (impulse grows with energy, capped) is the
one that should now actually exercise a ladder rather than a flat line — expect
to re-baseline its thresholds.

## Risk

This changes how all eight bots hit. It is a feel change, not a bug fix, and it
is meant to be played before it is trusted. The two constants worth turning
first are `DAMAGE_CALIBRATION` (match pace) and `TU.hitCooldownSeconds`
(0.09 → 0.18 restores v1's hit rate).
