# Bot integration specs

Real-world mechanics, what moves, the catalog entry to add, and the sim work
each bot needs. Measured values are marked **MEASURED** — they came off the
model in the viewer, not off the reference photo.

`colliders` are left as notes: they are fitted per bot against the arena the
same way the original eight were, and are the one thing that cannot be derived
from the GLB alone.

---

# Part 1 — Mammoth, Copperhead, Endgame, Blip, Tantrum

## Mammoth — the tallest bot in the field

**Team Mammoth (Ricky Willems, Baltimore, Maryland, USA).** Weapons operator
Brice Farrell since debut. WC IV–VII, plus Bounty Hunters and Champions I & II.

The defining feature is size: at its largest **8'9" long × 5'4" wide × 6'3"
tall**, the biggest competitor of the modern era. For WC VI the team cut eight
inches of height; WC VII went back up to ~6 ft. Because so much of the weight
budget goes into being that large, **the armour is minimal** — an open
triangular truss with exposed structure. That trade-off is the whole robot.

| Real spec | Value |
|---|---|
| Weight | 250 lb |
| Drive | **2 wheels**, 2× RV-100 motors, 13" foam-filled tyres |
| Speed | 22 mph — genuinely fast, and "surprisingly nimble" for its size |
| Weapon | "Trunk" — a long arm on a transverse axle at the **top** of the frame |
| Weapon drive | Chain (twin redundant chains from WC VI; they stretch up to 4" in one fight) |
| Invertible | No — self-rights with the trunk (from WC V) |

### What moves

| Part | Axis | Range |
|---|---|---|
| Trunk arm | transverse axle at the top of the frame | **continuous 360°**, reversible |
| 2 drive wheels | transverse | continuous, bidirectional |
| Front forks | — | fixed; passive catchment |

The trunk is not a hammer with a fixed arc — it rotates all the way around,
which is what lets it thwack, hook, scoop, lift and carry. Mammoth has thrown
opponents clean over the arena barrier.

### Game characterisation

A **displacement** weapon, not a damage weapon. It wins by being a shape
nobody has a plan for: opponents drive into the open frame, get caught, and
get swung and dropped. It loses to anything that can reach its wheels or drive
pods, and to fast low bots that simply refuse to drive in.

```js
mammoth: {
  id: "mammoth", name: "Mammoth", tagline: "Drive in if you dare.",
  referenceImage: "./public/reference/mammoth.png",
  modelPath: "./public/models/mammoth.glb",
  modelYaw: Math.PI,        // MEASURED: model faces +Z (forks at z=+0.33), game wants -Z
  weightLbs: 250, weaponWeightLbs: 40,
  bodyDims: { x: 5.3, y: 5.5, z: 8.0 },   // the tall/huge silhouette is the point
  maxSpeedFps: 32.3,        // 22 mph
  accel: 5.5, turnRate: 0.7,              // 2WD, wide turning envelope
  accent: "#b06a2c", accentDark: "#1b1c20",
  stats: { armor: 3, speed: 6, weapon: 3, control: 5 },
  weapon: {
    type: "spinner",        // continuous rotation, but LOW damage / HIGH launch
    pivot: { x: 0, y: 0.03, z: -0.16 },   // MEASURED (model space)
    axis:  { x: 1, y: 0, z: 0 },          // MEASURED transverse
    budgetCap: 90,          // displaces rather than destroys
    tuning: { launchBias: 1.9, damageScale: 0.35 },
  },
  colliders: [ /* tall open truss: low base box + two upright legs + front forks */ ],
}
```

**Sim note.** Mammoth should feel like a **launcher**, not a spinner: low damage
per hit, high vertical impulse. Its height also means its vitals sit above most
spinners' plane of attack — if the sim supports height-dependent hit
resolution, Mammoth is the bot that justifies it.

**Model caveat:** only the central hub animates — see SEGMENTATION.md.

---

## Copperhead — 50 lb of S7 tool steel

**Team Copperhead, formerly Caustic Creations (Denver, Colorado, USA).**
Designed by **Zach Goff**; later captains Robert Cowan, then Luke Quintal.
Long-serving weapons operator Chad New. WC IV–VII, Bounty Hunters, and the
2026 Pro League. Predecessor robot: Poison Arrow.

*(Attribution note: an earlier draft of this project's docs credited a
different builder. Zach Goff / Caustic Creations is what the sources say. The
wiki lists Denver as the hometown while its own prose says most of the team
hailed from Texas — a genuine inconsistency in the source.)*

| Real spec | Value |
|---|---|
| Weight | 250 lb |
| Weapon | Eggbeater-style **vertical drum**, single tooth, **S7 tool steel, 50 lb** |
| Tip speed | 160–180 mph originally; **detuned to 140 mph for WC VII to get better bite** |
| Drive | **2 wheels**, huge custom-cast polyurethane tyres, ~5" thick rubber |
| Invertible | **Yes** — fights the same either way up, no self-righter needed |
| Armour | AR500 steel top plate (from WC V) |

### What moves

| Part | Axis | Range |
|---|---|---|
| Drum | transverse, at the front | continuous, both directions |
| 2 drive wheels | single transverse axle line | continuous, works inverted |

Nothing else. No lifter, no hinged wedge, no self-righter.

### Game characterisation

The purest brawler in this drop. Invertibility means no bad orientation and no
self-righting to fail; the huge soft wheels give it a shove nobody expects from
a drum bot; the drum removes wheels and armour in single hits. It struggles
against bots that out-wedge it and deny the drum an edge.

The **140 mph detune is a design lesson worth modelling**: less tip speed, more
bite. In sim terms, prefer a lower spin rate with a higher grab/hook
coefficient over raw energy.

```js
copperhead: {
  id: "copperhead", name: "Copperhead", tagline: "Bite over speed.",
  referenceImage: "./public/reference/copperhead.png",
  modelPath: "./public/models/copperhead.glb",
  modelYaw: Math.PI / 2,    // MEASURED: model faces +X, game wants -Z
  weightLbs: 250, weaponWeightLbs: 50,    // real published drum mass
  bodyDims: { x: 2.9, y: 1.2, z: 3.2 },
  maxSpeedFps: 14.7, accel: 7.2, turnRate: 0.75,   // 2WD, strong push, wide arc
  accent: "#c8622f", accentDark: "#1a1a1d",
  stats: { armor: 7, speed: 6, weapon: 9, control: 5 },
  invertible: true,         // NEW FLAG — see sim work
  weapon: {
    type: "drum",
    pivot: { x: 0.29, y: 0.10, z: -0.01 },  // MEASURED drum axis (model space)
    axis:  { x: 0, y: 0, z: 1 },            // MEASURED
    dims: { x: 0.25, y: 0.25, z: 0.55 },
    budgetCap: 340,
    tuning: { spinUpSeconds: 1.6, biteCoefficient: 1.35 },  // detuned + grabby
  },
  colliders: [ /* low wide box + drum guard + front forks */ ],
}
```

**Sim work needed: `invertible`.** Copperhead is the first bot in the catalog
that genuinely does not care which way up it is. Today an upside-down bot
should trend toward immobilisation; Copperhead should be exempt, and its KO
condition should come only from mobility loss.

---

## Endgame — the benchmark damage bot

**Team End Game, formerly OYES Robotics (Auckland, New Zealand).** Captains
**Nick Mabey** and **Jack Barker**, affiliated with the University of Auckland.
WC III–VII, Champions I & II, 2026 Pro League. Evolved from the team's earlier
heavyweight Death Toll.

**The first non-US winner of the Giant Nut** (WC V, beating Whiplash in the
final), plus **two Golden Bolts** — among the most decorated robots in the
show's history.

| Real spec | Value |
|---|---|
| Weight | 250 lb |
| Weapon | Vertical spinner — interchangeable **teardrop disc / asymmetric bar / single-toothed flywheel** on a common shaft |
| Disc mass | **40–55 lb**; eight discs carried per season so every fight starts fresh |
| Speed | **6,000+ rpm, reached in under five seconds** |
| Drive | 4 wheels, 4× 6374-192 kV brushless, magnets for downforce |
| Chassis | 7050 aluminium (7075 in WC IV — brittle, cracks propagate, openly regretted) |
| Front end | Solid wedge, forks, eight-fork sets, or **nine-per-side piano keys** |

### What moves

| Part | Axis | Range |
|---|---|---|
| Vertical spinner | transverse, at the front | continuous, 6,000+ rpm, **reversible from WC VII** |
| Self-righting arm | transverse hinge, left of the weapon | ~0–180° |
| 4 drive wheels | transverse | continuous |
| Forks / piano keys | transverse hinge | passive float only |

### Game characterisation

Gets to speed faster than anything else and throws opponents into the ceiling
lights. Plays a patient ground game — the forks exist to guarantee the disc
meets an edge — then removes the opponent in one or two hits. Beaten by its own
reliability, by losing the ground game to a better wedge, and by weapon-to-weapon
variance.

```js
endgame: {
  id: "endgame", name: "Endgame", tagline: "Six thousand rpm in five seconds.",
  referenceImage: "./public/reference/endgame.png",
  modelPath: "./public/models/endgame.glb",
  modelYaw: Math.PI / 2,    // MEASURED: model faces +X, game wants -Z
  weightLbs: 250, weaponWeightLbs: 48,    // mid of the real 40–55 lb disc range
  bodyDims: { x: 2.8, y: 1.0, z: 3.4 },   // doubles in length with the long forks
  maxSpeedFps: 16.1, accel: 7.6, turnRate: 0.95,
  accent: "#f0561d", accentDark: "#16171a",
  stats: { armor: 7, speed: 7, weapon: 10, control: 7 },
  weapon: {
    type: "verticalSpinner",  // same family as hypershock
    pivot: { x: 0.12, y: 0.05, z: 0.02 },   // MEASURED disc hub (model space)
    axis:  { x: 0, y: 0, z: 1 },            // MEASURED
    dims: { x: 0.28, y: 0.28, z: 0.12 },
    budgetCap: 400,           // the hardest hitter in the catalog
    tuning: { spinUpSeconds: 0.9, launchBias: 1.5 },  // "under five seconds" — fastest spin-up
  },
  colliders: [ /* low box + two lettered wedge plates + fork rails */ ],
}
```

**Nice-to-have:** the self-righting arm exists as separate geometry but is
currently left in the body — it cannot be a `weaponSub` (those spin with the
weapon). If it should articulate, give it an `aux` group like Tantrum's fists.

---

## Blip — the flywheel launcher

**Seems Reasonable Robotics (Aren Hill and Sean Doherty, Mountain View,
California, USA).** WC VI and VII, re:MARS 2022, Champions II. Working name
during development: *Moonshot*. Sister robot to **Tantrum** — same team, shared
drivetrains and armour materials, and the two fought for real in WC VII (Blip
won, beating the reigning champion).

**Won the Grant Imahara Award for Best Design** in its rookie season.

### The flipper — the thing everyone gets wrong

**Blip is not pneumatic and uses no CO2.** It is an electrically-charged
**flywheel + clutch + cord launcher**, the only one of its kind in the class:

1. A **16 lb internal flywheel** spins continuously at **~9,000 rpm**, storing energy.
2. On trigger, **solenoids engage a clutch** connecting the flywheel to a spool.
3. The spool **twists a greased Dyneema cord** routed inside the chassis.
4. Twisting violently shortens the cord, which **yanks the flipper open**.
5. Total fire time: **~0.04 seconds**.

Because the flywheel recharges continuously, Blip can flip far more often than
a pneumatic bot with finite gas — it threw Whiplash **17 times in one fight**.

**And the flipper is the rectangular bolted plate in the middle of the top
deck — not the front forks.** The forks/wedges/"piano key" wedgelets are
passive, swappable ground-game hardware that never actuate. The plate:

- runs fore-and-aft down the **centreline** of the sloped top deck, and doubles
  as the robot's centre top armour;
- is about **one-third of the deck's width**, flanked by fixed blue panels whose
  two rows of black bolt heads visually define its long edges;
- is **rear-hinged** — the hinge is a transverse axis at the plate's back edge,
  and the **front** edge sweeps up and forward (same family as Hydra and Bronco);
- opens roughly **60–70°** *(estimated from fight footage — no published figure)*;
- is also the **self-righting mechanism**, fired against the floor.

| Real spec | Value |
|---|---|
| Weight | 250 lb; roughly **half the size of Hydra, a third of Bronco** |
| Drive | 4 wheels, 4WD, 2× TP5680 brushless; can wheelie on command |
| Underside | Titanium, with magnets for downforce |
| Invertible | No — must self-right by firing the flipper |

### What moves

| Part | Axis | Range |
|---|---|---|
| **Flipper plate** | transverse, at the plate's **rear** edge | ~0–65°, full sweep in 0.04 s |
| Internal flywheel | internal | continuous ~9,000 rpm |
| 4 drive wheels | transverse | continuous |
| Piano-key wedgelets | transverse hinge | passive float only |

### Game characterisation

Wins by control, not damage — drive under, walk them into a corner, fire, repeat.
Kills are beachings and hazard throws. Weak to high-energy vertical spinners
(End Game threw it; HUGE embedded a blade in the flipper panel), to losing the
ground game, and to gyro instability plus unreliable self-righting.

```js
blip: {
  id: "blip", name: "Blip", tagline: "Four hundredths of a second.",
  referenceImage: "./public/reference/blip.png",
  modelPath: "./public/models/blip.glb",
  modelYaw: Math.PI,        // MEASURED: model faces +Z (forks at z=+0.33), game wants -Z
  weightLbs: 250, weaponWeightLbs: 30,
  bodyDims: { x: 2.4, y: 0.85, z: 2.9 },  // compact for a flipper
  maxSpeedFps: 17.6, accel: 8.4, turnRate: 1.05,   // agile, 4WD
  accent: "#1f6fd0", accentDark: "#14161a",
  stats: { armor: 6, speed: 8, weapon: 4, control: 9 },
  weapon: {
    type: "flipper",
    pivot: { x: 0, y: -0.02, z: -0.266 },   // MEASURED rear hinge (model space)
    axis:  { x: -1, y: 0, z: 0 },           // MEASURED — see note below
    restAngle: 0, fireAngle: -1.15,          // ~65°
    dims: { x: 0.28, y: 0.05, z: 0.40 },
    budgetCap: 200,
    selfRight: true,
    tuning: { strokeSeconds: 0.05, returnSeconds: 0.7, liftVelocity: 26.0 },
  },
  colliders: [ /* low wedge body + fixed front forks (NOT the weapon) */ ],
}
```

**Axis sign matters here.** The plate extends toward **+Z** from a hinge behind
it, so a positive rotation about **+X** drives it *down* into the chassis. The
part map therefore uses `weaponAxis: [-1, 0, 0]` so a positive weapon stroke
lifts. This was verified in the viewer: with the sign flipped the plate's top
reaches y = 0.408 against a chassis top of ~0.19.

**Sim work: fast recharge.** Blip's whole identity is *shots per minute*. Its
`returnSeconds` should be much shorter than Bronco's 2.0 — it should be able to
fire again almost immediately, and that (not impulse) is what makes it feel right.

---

## Tantrum — the punching spinner

**Seems Reasonable Robotics (Mountain View, California, USA)** — Blip's sister
robot. Founded by Aren Hill and Sean Doherty; Alex Grant and Ginger Schmidt
took over as captains from WC VI, with **Dillon Carey** driving. WC III–VII,
Champions I & II.

**WC VI (2021) CHAMPION — Giant Nut winner**, undefeated, beating Witch Doctor
in the final. **August 2025: Honorable Mention, Combat Robot Hall of Fame**,
cited for optimising the punching-spinner concept.

### An accuracy correction worth reading

**Tantrum has one powered weapon, not two.** The "punch" *is* the spinner
translating forward — that is the entire mechanism. The **fists are not
powered punchers**: on the WC III bot they were purely decorative, and from
WC V they are the tips of the **rear self-righting arms** (which carried
flamethrowers in WC V and get knocked off by opponents).

This does not change the requested control scheme, only what to call it. Two
distinct things really do move, and both are worth having on the pad:

- **RB → drive the spinner carriage fore/aft on its rails.** This is the punch.
- **LT → swing the fist arms.** Real mechanism, real motion — it is the
  self-righter, not a punch attack. Labelling it "FISTS" in the HUD is fine;
  just don't give it an attack impulse of its own.

| Real spec | Value |
|---|---|
| Weight | 250 lb (235 lb in WC III) |
| Weapon | Vertical **drum** on a **linear sliding carriage** |
| Drum | **S7 tool steel, 18 lb** (WC VII), up to **8,500 rpm** |
| Rails | Two S7 tool steel linear rails running fore-and-aft inside the chassis |
| Stroke | ~6–10 in *(estimated from the team's published CAD — no published figure)* |
| Drive | 4 wheels, 2× TP5680 brushless, 4× 5.4 Ah 6S LiPo |
| Invertible | No — rear self-righting arms |

### What moves

| Part | Axis | Range |
|---|---|---|
| Drum | transverse | continuous, up to 8,500 rpm |
| **Drum carriage** | **linear translation, fore/aft** | ~6–10 in, retracted ↔ past the front bulkhead |
| Fist / self-righting arms | transverse hinge at the rear | ~0–180° |
| 4 drive wheels | transverse | continuous |

### Game characterisation

A grinder: small, dense, hard to break, and it wins by staying in the fight
while opponents wear out. The punch lets it initiate without a perfect drive-in,
so it can trade with bigger spinners. Weak to big verticals that outrange it
(End Game beat it twice), to flippers (Blip simply threw it around), and it has
a history of internal/electrical failures.

```js
tantrum: {
  id: "tantrum", name: "Tantrum", tagline: "The punch is the point.",
  referenceImage: "./public/reference/tantrum.png",
  modelPath: "./public/models/tantrum.glb",
  modelYaw: Math.PI,        // MEASURED: model faces +Z (drum bar at z=+0.39), game wants -Z
  weightLbs: 250, weaponWeightLbs: 18,     // real published drum mass
  bodyDims: { x: 2.5, y: 0.95, z: 2.7 },   // notably compact
  maxSpeedFps: 14.7, accel: 7.8, turnRate: 1.0,
  accent: "#e8571f", accentDark: "#141518",
  stats: { armor: 8, speed: 7, weapon: 7, control: 8 },
  weapon: {
    type: "drum",
    pivot: { x: -0.046, y: 0.059, z: 0.387 },  // MEASURED drum axis (model space)
    axis:  { x: 1, y: 0, z: 0 },               // MEASURED transverse
    dims: { x: 0.30, y: 0.08, z: 0.08 },
    budgetCap: 300,
    tuning: { spinUpSeconds: 1.1 },
    // NEW: the punch — carriage translation along the bot's forward axis
    thrust: { travel: 0.65, extendSeconds: 0.12, retractSeconds: 0.35, impulseBias: 1.6 },
  },
  aux: {
    fists: { node: "modelAux-fists", axis: { x: -1, y: 0, z: 0 },
             pivot: { x: 0, y: 0.10, z: -0.05 }, openAngle: 2.4, seconds: 0.5 },
  },
  colliders: [ /* compact box + front hinged wedge + rear arm stubs */ ],
}
```

### Sim work needed

1. **`weapon.thrust` — a translating weapon.** New to the codebase. The weapon
   node slides along the bot's forward axis while spinning; a hit landed while
   the carriage is extending should carry the linear momentum too (that is what
   makes the punch land where a normal drum would whiff). Contact geometry has
   to follow the carriage, not sit at a fixed offset.
2. **`aux.fists` — a swinging aux group.** `modelAux-fists` now carries a
   `pivotLocal` and `auxAxis`, so it just needs an input binding and a tween.
   No impulse — it is a self-righter.
3. **Control binding:** RT spin (toggle, like other spinners), **RB thrust**
   (momentary — extend while held, retract on release), **LT fists**. Fall back
   to LB if LT is already bound.

---

# Part 2 — Overhaul, Free Shipping, Shatter, Duck

## Overhaul — grapple and carry

**Equals Zero Robotics — Charles Guan (Atlanta, GA; originally Team JACD at
MIT).** "JACD" = Jamison Go, Adam Bercu, Charles Guan, Dane Kouttron. WC I–III
and VI–VII, plus Champions I & II. Descended from Guan's small-class
**Überclocker** clamp-lifters.

*(Attribution note: Overhaul is **not** a Team Whyachi bot and has no Wisconsin
connection — searching for it alongside Whyachi surfaces Son of Whyachi, Hydra
and Fusion, which are a different team entirely.)*

### The nested clamp — confirmed

**The model in this drop is correct: the clamp arm is carried on the lift arm,
not on the chassis.** Guan's own 2018 build report states the clamp mounts to
the lift forks rather than directly to the chassis, and it is the defining
feature of his whole Überclocker architecture — the clamp closes down *onto*
the forks, and when the forks rise the clamp rises with them so the grip
survives the lift.

| Mechanism | Pivot | Actuator |
|---|---|---|
| **Lower lift arm + forks** | transverse axis on the **chassis** | brushless via BaneBots BB220 gearboxes (rotary, from Overhaul 2 — the original ball-screw lift made 2,500 lb of force but was far too slow) |
| **Upper clamp arm** | transverse axis **on the lift arm** | separate electric ball-screw actuator; two-speed, **~2,500 lb of jaw force in low gear / 1,000 lb in high**, ~2.75" travel at the tooth tip |

Both screws are **non-backdriving** — the clamp holds its grip with the power
off. Angular ranges are described functionally but **never published
numerically**; roughly 0–45° lift and ~30° clamp close are inferred, not sourced.

### Game characterisation

A pure control bot: win the low ground with the wedges, slide the forks under a
flank, clamp down, and drive the opponent into the screws or saws for the full
pin allowance. Beaten by anything that reaches past the forks — vertical and
undercutting spinners repeatedly amputated the weapon arm — and by flippers,
since it cannot self-right. Career record is genuinely poor (4 wins from 18).

```js
overhaul: {
  id: "overhaul", name: "Overhaul", tagline: "Grab it, lift it, drive it into the saws.",
  referenceImage: "./public/reference/overhaul.png",
  modelPath: "./public/models/overhaul.glb",
  modelYaw: Math.PI / 2,    // MEASURED: model faces +X, game wants -Z
  weightLbs: 250, weaponWeightLbs: 55,
  bodyDims: { x: 2.8, y: 1.1, z: 3.5 },
  maxSpeedFps: 11.0, accel: 6.0, turnRate: 0.8,
  accent: "#17b6b0", accentDark: "#1a1c20",   // Overhaul teal
  stats: { armor: 4, speed: 4, weapon: 3, control: 8 },
  weapon: {
    type: "lifter",
    pivot: { x: -0.15, y: -0.04, z: 0 },      // MEASURED chassis hinge (model space)
    axis:  { x: 0, y: 0, z: 1 },              // MEASURED — positive stroke lifts
    restAngle: 0, fireAngle: 0.8,             // ~45°
    budgetCap: 150,           // holds rather than destroys
    tuning: { strokeSeconds: 0.55, returnSeconds: 0.8, holdsWithoutPower: true },
    sub: {                    // modelWeaponSub-claw — nested, rides the lift arm
      node: "modelWeaponSub-claw",
      pivot: { x: -0.12, y: -0.06, z: 0 },    // MEASURED
      axis:  { x: 0, y: 0, z: -1 },           // closes DOWN onto the forks
      closeAngle: 0.55, seconds: 0.4,
      clampForce: 2500,       // real published jaw force, lb
    },
  },
  colliders: [ /* low box + pontoon side rails + front wedge */ ],
}
```

**Controls: RT = lift, RB = clamp.** The clamp should **latch** — press to
close, press to release — because the real screw drive is non-backdriving and
holds without power. A grabbed opponent should stay grabbed while Overhaul
drives, which is the entire bot.

---

## Free Shipping — forklift and fire

**Team Special Delivery — Gary Gin (San Leandro, CA).** The flamethrower
subsystem was built by **Jim and Forrest Yeh**. WC III, IV, VI, VII, plus
re:MARS, Champions I & II and FaceOffs. Gin's pedigree is *Original Sin*, the
most decorated robot in RoboGames history; Free Shipping is essentially Original
Sin with a lifter added to satisfy the active-weapon requirement.

### Which build this is

There are three, and the distinction matters:

- **WC III (2018)** — the literal vertical forklift mast with an **exposed
  chain**. Iconic but a failure: 1-3, the wiki blames the mast for lacking
  leverage and the chain for being exposed.
- **WC IV / VI** — mast ditched for a **chain-driven lifting arm with forks at
  the end**. This is the competitive build and **the one modelled here**.
- **WC VII onward** — lifter abandoned entirely for a small vertical spinner,
  and the weight drops to 210 lb. Not this bot.

### Weapon

**Lifting arm**, AR400 abrasion-resistant steel, **electric via chain drive**,
pivoting about a single transverse axis at the rear of the arm with the forks
fixed at the far end — the whole arm sweeps as one rigid unit. No lift force,
angle or cycle time is published.

**Flamethrower — a separate driver control, and required to be.** BattleBots
rules mandate remote arm/disarm on an independent channel, cap the tank at
**16.4 oz** and the flame at **4 ft**, and forbid continuous operation beyond
one minute at max flow. Critically the rules state a flamethrower **does not
count as an active weapon** — which is exactly why the lifter has to exist
alongside it.

The nozzle **moved between builds**: WC III in an orange box on the chassis;
**WC IV mounted on the lifting arm itself**, so the flame aimed wherever the arm
pointed (this is the version that grilled HyperShock and Bronco); WC VI moved to
the front of the robot at BattleBots staff request on safety grounds.

**Count is not documented** — every source refers to *the* flamethrower in the
singular. Treat it as one forward emitter unless footage says otherwise.

Ignition is unreliable by nature: in its debut it visibly spewed unlit gas
before catching, and a bent nozzle twice set Free Shipping on fire itself.

```js
freeshipping: {
  id: "freeshipping", name: "Free Shipping", tagline: "Lift them, then light them.",
  referenceImage: "./public/reference/freeshipping.png",
  modelPath: "./public/models/freeshipping.glb",
  modelYaw: Math.PI / 2,    // MEASURED: model faces +X, game wants -Z
  weightLbs: 250, weaponWeightLbs: 45,
  bodyDims: { x: 2.9, y: 1.0, z: 3.6 },   // long, low, wide
  maxSpeedFps: 15.4, accel: 7.4, turnRate: 0.85,
  accent: "#f2c014", accentDark: "#1b1c1f",
  stats: { armor: 6, speed: 7, weapon: 3, control: 7 },
  weapon: {
    type: "lifter",
    pivot: { x: -0.20, y: -0.05, z: 0 },    // MEASURED hinge (model space)
    axis:  { x: 0, y: 0, z: 1 },            // MEASURED — positive stroke lifts
    restAngle: 0, fireAngle: 0.75,
    budgetCap: 140,
    tuning: { strokeSeconds: 0.5, returnSeconds: 0.7 },
  },
  flame: {                    // NEW SUBSYSTEM — RB
    nozzles: [ { x: 0.5, y: 0.05, z: 0 } ],   // MEASURED off the fork carriage
    range: 4.0,               // ft — the rule limit
    fuelSeconds: 60,          // rule limit at max flow
    ignitionFailChance: 0.08, // it really does spew unlit gas sometimes
    damagePerSecond: 6,       // pressure and spectacle, not a KO tool
  },
  colliders: [ /* long low box + three hinged wedgelets + fork carriage */ ],
}
```

**Sim work: `flame`.** A held-button cone emitter with a **fuel budget** that
depletes and does not refill mid-match, plus a small ignition-failure chance.
It should apply damage-over-time and drive the opponent's heat/panic, not
knockback. Pair it with the existing particle and audio systems rather than the
impact path — it is not a collision.

---

## Shatter — the holonomic hammer

**Bots FC — Adam Wrigley (captain), Eric Wrigley and Matt Bores (Brooklyn, NY).**
Every season since WC IV, plus Champions I & II. Predecessor: *Mega Melvin*.
The team claims three firsts: the first effective omnidirectional heavyweight,
the **first brushless-DC-powered hammer**, and pioneering **ablative armour**.

### Weapon

An **overhead hammer driven by a brushless DC motor** — not pneumatic, not
spring. The arm pivots about a transverse axis at its root on a raised rear
frame and swings the head over the top onto the opponent's top armour. Drive is
via **two chains** through a **friction slip-disc clutch** that absorbs impact
shock — a documented failure mode: Minotaur broke one chain, the clutch then
overheated, the hammer slowed after every swing, and the slip discs finally
burned up.

Heads are a **per-fight loadout choice**: *Ole Rusty* (steel, default), *Titan*
(titanium, anti-spinner), *Mary Special* (double-ended, serrated), *New Rusty*
(waterjet HARDOX, shock-mounted so it can fire straight into a spinner), and
*Paul Surprise*. No joule or swing-speed figures are published.

### Mecanum — confirmed, and it genuinely strafes

**Four wheels, each with its own brushless motor (4× Castle 2028)** —
independent per-wheel drive, the mathematical prerequisite for mecanum, with
**diagonally mounted rollers** rather than tyres. Each wheel is 115 parts.

The effect is **holonomic** motion: translation and rotation are decoupled, so
Shatter can strafe laterally across the BattleBox **while keeping the hammer
pointed at its opponent**. It was the first heavyweight in the rebooted era to
run mecanum, and reportedly the only team to use them effectively.

**The tradeoff must be modelled or the bot is overpowered:** mecanum rollers
have terrible traction *along* the drive direction. Every one of Shatter's
debut-season losses involved losing a shoving match. Excellent positioning,
near-zero shove.

```js
shatter: {
  id: "shatter", name: "Shatter", tagline: "Sideways, and still facing you.",
  referenceImage: "./public/reference/shatter.png",
  modelPath: "./public/models/shatter.glb",
  modelYaw: Math.PI / 2,    // MEASURED: model faces +X, game wants -Z
  weightLbs: 250, weaponWeightLbs: 35,
  bodyDims: { x: 2.7, y: 1.3, z: 3.2 },
  maxSpeedFps: 14.0, accel: 7.0, turnRate: 1.2,
  accent: "#8f7fd6", accentDark: "#17181b",
  stats: { armor: 5, speed: 6, weapon: 6, control: 9 },
  drive: { type: "holonomic", strafeRatio: 0.85, pushForceScale: 0.35 },  // NEW
  weapon: {
    type: "hammer",
    pivot: { x: -0.03, y: -0.13, z: 0 },   // MEASURED hinge (model space)
    axis:  { x: 0, y: 0, z: 1 },           // MEASURED
    restAngle: 0,             // GLB is baked cocked-back
    fireAngle: 2.4,           // POSITIVE here swings the head down and forward
    budgetCap: 300,
    selfRight: true,
    tuning: { strokeSeconds: 0.2, returnSeconds: 0.85 },
  },
  colliders: [ /* low wedge body + two side armour pods + front forks */ ],
}
```

**Sign convention:** unlike the lifters, a **positive** stroke about `[0,0,1]`
takes Shatter's hammer *down* — which is correct, because the stroke is the
strike. The analytic check in this drop flags Shatter as "dropping"; that is
the expected result for a hammer, not a bug.

### Sim work needed: holonomic drive

This is the largest piece of new sim work in the drop. The vehicle model is
currently differential/skid steer; Shatter needs **independent X/Y translation
plus yaw**, so lateral stick input strafes rather than turns. Two things keep it
balanced, and both are documented real behaviour:

- **`pushForceScale`** — heavily reduced force when driving into another body.
  This is Shatter's actual, documented weakness.
- Ablative armour panels are *designed* to shed on impact. If the damage model
  ever spawns debris, Shatter is the bot that should shed the most and care the
  least.

---

## Duck — the indestructible brick

**Team Black and Blue — Hal Rucker (Palo Alto, CA)**, a family team with Hannah
and Kathy Rucker. WC III, IV, VI and Champions I; withdrew from WC V; **retired
after WC VI**. Upgraded from Rucker's RoboGames entry *Whoops!*

A nice detail if the game ever models split control: **Hal drove while his
daughter Hannah operated the lifter** — it was a two-operator robot.

### The beak

**The lifter is the entire orange beak-shaped front plow** — not a small claw on
the nose. It is ¾" steel weighing 50 lb on its own by the 2019 build, with a
chisel-shaped wedge in the centre to get under opponents, rotating about a
single transverse axis carried on support arms either side of the chassis.

**The hinge moved between builds, and this is the important detail:**

- **WC III** — arms mounted **ahead of the front wheels**; limited arc.
- **WC IV (2019)** — arms **relocated inboard, between the wheels**, which
  "increased the range of motion dramatically". The beak could now rotate a
  **full 360°**: lowered it wrapped down and **protected the front wheels**, and
  a sharp black tip meant the over-the-top part of the rotation worked as an
  **overhead axe**. It over-delivered — firing the lifter could flip the whole
  chassis over.
- **WC VI** — same shape, but the beak was **split down the centre to open like
  a real bill**, with internal speakers quacking as it opened.

**So from 2019 it is a continuously rotating arm, not a limited-arc lifter** —
which is what makes Duck mechanically unusual and is worth keeping in the game.

Duck is **fully invertible**, milled from a single billet of 6061 aluminium
(later magnesium), extremely low, and reputationally one of the most durable
robots ever to compete. The WC VI loadout tradeoff is real: fitting the big
defensive plow meant **giving up two of the four drive motors** to make weight.

```js
duck: {
  id: "duck", name: "Duck", tagline: "Still driving. Still quacking.",
  referenceImage: "./public/reference/duck.png",
  modelPath: "./public/models/duck.glb",
  modelYaw: Math.PI / 2,    // MEASURED: model faces +X, game wants -Z
  weightLbs: 250, weaponWeightLbs: 50,     // real published beak mass
  bodyDims: { x: 2.9, y: 0.75, z: 3.3 },   // very low box
  maxSpeedFps: 13.2, accel: 6.8, turnRate: 0.9,
  accent: "#f0a022", accentDark: "#16171a",
  stats: { armor: 9, speed: 6, weapon: 2, control: 7 },
  invertible: true,         // same flag Copperhead needs
  weapon: {
    type: "lifter",
    pivot: { x: 0.17, y: -0.10, z: 0 },    // MEASURED hinge (model space)
    axis:  { x: 0, y: 0, z: 1 },           // MEASURED — positive stroke lifts
    restAngle: 0,
    fireAngle: 1.2,
    continuous: true,       // 2019+ beak rotates a full 360°
    budgetCap: 170,         // enough torque to flip Duck itself — that's authentic
    selfRight: true,
    tuning: { strokeSeconds: 0.4, returnSeconds: 0.6, selfFlipRisk: 0.15 },
  },
  colliders: [ /* very low wide box + beak plow */ ],
}
```

**Sim work:** `weapon.continuous` — a lifter that can rotate past vertical and
keep going, acting as an axe over the top and as wheel armour at the bottom.
Duck also wants `invertible: true` (shared with Copperhead) and benefits from a
much higher damage-resistance multiplier than anything else in the catalog.

---

## Summary of new engine work this drop implies

| Feature | Bots | Size |
|---|---|---|
| `invertible` — no penalty for running upside down | Copperhead, Duck | small |
| `weapon.sub` latching clamp that holds without power | Overhaul | small |
| `flame` — held emitter with a fuel budget, DoT, ignition failure | Free Shipping | medium |
| `weapon.continuous` — lifter that rotates through 360° | Duck | small |
| `weapon.thrust` — spinner that translates fore/aft on a carriage | Tantrum | medium |
| `aux` swinging group bound to its own input | Tantrum (fists), Endgame (srimech) | small |
| `drive.holonomic` — strafing, with a low push-force penalty | Shatter | **large** |

None of these are required to play the bots: with none of them implemented, all
nine still drive and swing their primary weapon on RT.

## Things the sources do not support — do not invent

- **No published top speeds** for Overhaul, Free Shipping, Shatter or Duck.
- **No published hammer energy or swing arc** for Shatter.
- **No published lift angles** for Overhaul, and no lift force for Duck.
- **Free Shipping's nozzle count is undocumented** — sources say "the
  flamethrower", singular.
- **Blip's flipper opening angle and plate dimensions, and Tantrum's carriage
  stroke, are estimates** read off photography and the team's published CAD.
