# Deep Six, Claw Viper, Witch Doctor & Hydra — integration spec

Everything needed to drop these four bots into the game: real-world mechanics,
what moves and how, the catalog entry to add, and what the sim would need.

Files in this folder:

```
reference/<id>.png        studio photo (also the UI bot-card image)
models/<id>.glb           part-segmented model (modelBody / modelWeapon / …)
part-maps/<id>.json       which segmentation parts became which game part
raw/<id>_seg.glb          Tripo segmentation output (input to glb-partition)
```

To install a bot: copy `models/<id>.glb` → `v2/public/models/`,
`reference/<id>.png` → `v2/public/reference/`, `part-maps/<id>.json` →
`v2/tools/part-maps/`, then add the catalog entry below and a card in
`v2/src/ui/botCards.js`.

> **Research correction:** Deep Six is built by **Team Overboard (Dustin
> Esswein)**, not Zachary Lytle — Lytle builds *Skorpios*.

---

> Esswein)**, not Zachary Lytle — Lytle builds *Skorpios*. Noted because the
> misattribution came from the brief.

---

## Deep Six — oversized vertical bar spinner

**Team Overboard (Dustin Esswein), Norfolk VA.** The most brutally
over-powered spinner the sport has seen: it cut a hole in the arena floor and
was ultimately **banned on safety grounds**, prompting the weapon-mass cap
fans call "the Deep Six rule".

| Real spec | Value |
|---|---|
| Weapon | Vertical bar, **4 ft span**, AR500 steel |
| Weapon mass | **110 lb** (WCIV) → **80 lb** after the rule change |
| Tip speed | **206 mph** — among the fastest ever |
| Power | Electric (multiple ~10 hp motors); belt drive later **chain drive** |
| Drive | **Two-wheel**, with rear/side forks as stabilisers |
| Self-right | No in WCIV; yes after the chain-drive rebuild — using weapon torque against the floor, even with the bar stopped |

### What moves

**One part: the bar.** It rotates about a single horizontal axle transverse to
travel. A 4 ft span means a ~2 ft radius, so the hub sits high enough for the
blade to sweep all the way to the floor — the HUGE-like layout you described.
Nothing else articulates.

### Game characterisation

The heaviest hitter in the roster, with matching drawbacks. Long spin-up (huge
rotational inertia), enormous single-hit damage, and **severe gyroscopic
reaction** — big hits should tumble and beach *Deep Six itself*, which is its
signature real-world failure mode and makes it high-risk/high-reward rather
than simply the best bot.

```js
deepsix: {
  id: "deepsix", name: "Deep Six", tagline: "Banned for hitting too hard.",
  referenceImage: "./public/reference/deepsix.png",
  modelPath: "./public/models/deepsix.glb",
  modelYaw: 0,            // VERIFY — see Open questions
  weightLbs: 250, weaponWeightLbs: 80,
  bodyDims: { x: 2.6, y: 1.4, z: 3.4 },   // tall: the hub rides high
  maxSpeedFps: 12.0, accel: 7.0, turnRate: 0.9,
  accent: "#b1642f", accentDark: "#141414",   // copper blade on black
  weapon: {
    type: "bar",
    pivot: { x: 0.006, y: 0.062, z: 0.022 },  // MEASURED hub
    axis:  { x: 0, y: 0, z: 1 },              // pre-yaw; lateral in game space
    spinUpSeconds: 4.5,   // massive inertia — slow, dramatic spool-up
    inertia: 1.9, maxOmega: 420,
    budgetCap: 620,       // the hardest hit in the game
    gyroScale: 2.2,       // NEW: exaggerated gyroscopic reaction (see below)
  },
}
```

**Sim note:** the existing `bar` type covers this, but Deep Six wants a
`gyroScale` multiplier so impacts throw *it* around too. Without that it's
simply the strongest bot with no downside.

---

## Claw Viper — grappler / lifter

**Team Bad Ideas (Kevin Milczewski), Seattle.** A pure control bot: no
spinner. It gets under an opponent, clamps, lifts all 250 lb clear of the
floor, carries it, and suplexes it into a wall or hazard. 250+ lb of magnetic
downforce keeps it planted; four brushless weapon-class motors (one per wheel)
give it startling acceleration.

### What moves — important mechanical note

On the real robot the claw and lifter are **one mechanism with a single
actuated degree of freedom**: a four-bar linkage where raising the forks
*mechanically drives the top jaw down onto them*. The player cannot move them
independently.

**You asked for RT = lifter and RB = claw, so the model is segmented for two
independent controls** — that's a legitimate game-design choice (it gives the
player grab/release control, which is more fun than an automatic clamp). The
geometry supports either:

- **Two controls (as requested):** RT rotates `modelWeapon` (forks), RB rotates
  `modelWeaponSub-claw` (jaw).
- **Authentic single control:** drive the claw angle as a function of fork
  angle — `clawAngle = f(forkAngle)`, fully clamped by ~35% of lift travel —
  and ignore RB.

The claw is nested *inside* the weapon group either way, which is
anatomically right: it rides up with the forks as they lift.

```js
clawviper: {
  id: "clawviper", name: "Claw Viper", tagline: "Grab, lift, suplex.",
  referenceImage: "./public/reference/clawviper.png",
  modelPath: "./public/models/clawviper.glb",
  modelYaw: 0,            // VERIFY
  weightLbs: 250, weaponWeightLbs: 40,
  bodyDims: { x: 2.8, y: 0.9, z: 3.2 },
  maxSpeedFps: 17.0,      // weapon-class drive motors: very quick
  accel: 9.5, turnRate: 1.15,
  accent: "#3355cc", accentDark: "#141414",   // blue/purple, red fork tips
  weapon: {
    type: "grappler",     // NEW TYPE
    pivot: { x: -0.05, y: -0.16, z: 0 },      // MEASURED fork hinge
    axis:  { x: 0, y: 0, z: 1 },
    restAngle: 0.0,       // forks flat on the floor (they are also the wedge)
    liftAngle: -2.1,      // ~120°, past vertical for the suplex
    liftSeconds: 0.7,     // deliberate, powered lift (~1000 lb-ft at the base)
    carryCapacityLbs: 250,// can hoist a full-weight opponent
    claw: {               // modelWeaponSub-claw
      pivot: { x: -0.14, y: 0.14, z: 0.002 }, // MEASURED jaw hinge
      openAngle: 0.0, closedAngle: -0.8,
      clampSeconds: 0.25,
      gripHoldsOpponent: true,
    },
    downforceLbs: 250,    // magnets: very hard to shove or flip
  },
}
```

### Sim work needed

1. **A `grappler` type.** The hard part isn't the arm — it's **holding on to
   the opponent**. A clamped opponent should be constrained to the claw
   (a Rapier joint, or by directly driving its pose) until released, so
   carrying and suplexing work.
2. **Release physics** — dropping or throwing should impart the arm's angular
   velocity to the victim.
3. **Downforce** — raise its resistance to being flipped or shoved.
4. **Failure mode worth stealing from reality:** its **drive belts snap**, and
   its exposed linkage jams when hit by horizontal spinners.

---

## Witch Doctor — vertical spinner

**Team Witch Doctor (Andrea & Mike Gellatly), Miami.** The only robot to
compete in *every* BattleBots World Championship; 67% win rate, 49% KO rate.

| Real spec | Value |
|---|---|
| Weapon | Vertical disc, **47 lb**, two teeth, AR500 |
| Speed | **4,000 RPM / 200 mph** (WCIII) → the **250 mph legal maximum** (WCVII) |
| Power | Electric, belt-driven, **two weapon motors** for redundancy |
| Self-right | Powered arm through **~180°**; "bunny ear" appendages let it **keep fighting inverted** |

### What moves

**Two assemblies:** the disc (central horizontal transverse axle) and a
separate self-righting arm. Only the disc is segmented here — the self-righter
would need identifying separately if you want it animated.

```js
witchdoctor: {
  id: "witchdoctor", name: "Witch Doctor", tagline: "Every season. Every time.",
  referenceImage: "./public/reference/witchdoctor.png",
  modelPath: "./public/models/witchdoctor.glb",
  modelYaw: 0,            // VERIFY
  weightLbs: 250, weaponWeightLbs: 47,
  bodyDims: { x: 2.7, y: 0.9, z: 3.1 },
  maxSpeedFps: 15.0, accel: 8.5, turnRate: 1.05,
  accent: "#7fd430", accentDark: "#1a1024",   // toxic green on black/purple
  weapon: {
    type: "drum",         // vertical disc — closest existing type
    pivot: { x: 0.116, y: -0.014, z: 0.006 }, // MEASURED disc axle
    axis:  { x: 0, y: 0, z: 1 },
    spinUpSeconds: 2.2, inertia: 1.1, maxOmega: 620,
    budgetCap: 260,
  },
  canFightInverted: true, // "bunny ears" — keeps the weapon usable upside down
}
```

**Sim note:** vulnerable to flippers and lifters historically — worth giving it
a slightly higher centre of mass so Bronco/Hydra can get under it.

---

## Hydra — hydraulic flipper

**Team Whyachi (Jake Ewert), Abbotsford WI.** The hardest-hitting flipper in
the sport, and the only **hydraulic** one.

| Real spec | Value |
|---|---|
| Weapon | **Rear-hinged flipper** — the arm *is* the entire front wedge |
| Power | Hydraulic: a **spring-charged accumulator** dumped through a valve into a cylinder. The spring stores the energy; the fluid only transmits it — which is why it's both fast *and* effectively unlimited-shot |
| Recharge | **8 s originally → 4 s** by WCVI |
| Flip force | **450+ lb** demonstrated (launched a quad bike and the team van) |
| Peak | Flipped an opponent **15.3 ft** high; 20 flips in a single match |
| Drive | 4WD, plus **two rear wheels held 0.25 in off the floor** so it keeps drive if something gets underneath |

### What moves

**One part: the flipper arm**, about a horizontal transverse hinge at the
**rear**. At rest it lies flat as the robot's front wedge — Hydra drives
wedge-first and fires from that position.

```js
hydra: {
  id: "hydra", name: "Hydra", tagline: "Sends them to the ceiling.",
  referenceImage: "./public/reference/hydra.png",
  modelPath: "./public/models/hydra.glb",
  modelYaw: 0,            // VERIFY
  weightLbs: 250, weaponWeightLbs: 45,
  bodyDims: { x: 2.9, y: 0.7, z: 3.3 },   // very low and flat
  maxSpeedFps: 16.5, accel: 9.0, turnRate: 1.1,
  accent: "#6b3fa0", accentDark: "#12141a",  // purple wedgelets, dragon eyes
  weapon: {
    type: "flipper",
    pivot: { x: -0.24, y: -0.02, z: 0 },   // MEASURED rear hinge
    axis:  { x: 0, y: 0, z: 1 },
    restAngle: 0.0,       // flat on the floor — this IS the wedge
    fireAngle: -1.3,      // ~75° arc
    strokeSeconds: 0.10,  // near-instant: the hardest flip in the game
    reloadSeconds: 4.0,   // MUCH longer than Bronco — the real recharge time
    budgetCap: 520,       // flips 450+ lb
    selfRight: true,      // active only — must fire against the floor
  },
}
```

### Sim work needed

`flipper` already exists (Bronco), so Hydra mostly needs **tuning, not new
code** — a much stronger impulse and a much longer reload. Two extras worth
adding:

1. **Reload gating** — Bronco's flipper is effectively always ready; Hydra's
   4-second recharge is a core part of its rhythm and should be visible in the
   HUD.
2. **Active self-right** — it cannot right passively; firing the flipper
   against the floor must be the mechanism.
