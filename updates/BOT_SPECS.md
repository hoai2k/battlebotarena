# Bot integration specs — Glitch, Kraken, Gigabyte, Rusty, Dragon King

Real-world mechanics, what moves, the catalog entry to add, and the sim work
each bot needs. Values marked **MEASURED** came off the model; values marked
**[EST]** are estimates from photography or footage, not published figures.

`colliders` are left as notes — they get fitted per bot against the arena the
same way the original eight were, and cannot be derived from the GLB alone.

**Control convention for this drop:** primary weapon = **RT**, secondary = **RB**,
tertiary = **LB**.

| Bot | RT | RB | LB |
|---|---|---|---|
| Glitch | drum spin (toggle) | — | — |
| Gigabyte | shell spin (toggle) | — | — |
| Kraken | jaw crush | flamethrower | — |
| Rusty | hammer swing | retract / re-cock | — |
| Dragon King | saw blades | jaw clamp | saw arms raise/lower |

---

## Glitch — the aiming platform

**Combat Robotics at Berkeley — captain Kyle Miller (Berkeley, CA).** Driver
Anthony Moody. WC VI (2021, debut), Champions I, WC VII (2022), Champions II.

*Two source conflicts worth knowing: battlebots.com lists the hometown as
Berkeley and the wiki infobox says Roseville; Berkeley is the team's actual
base. And battlebots.com classes the weapon a "bar spinner (vertical)" while
the team and wiki call it an eggbeater drum — the hardware matches the drum
description.*

| Real spec | Value |
|---|---|
| Weight | 250 lb |
| Weapon | Asymmetric **eggbeater drum**, **58 lb S7 tool steel** |
| Tip speed | **130 mph** (2021) → **180 mph** (2022) |
| Drive | **4 omniwheels in an X-drive** — 4× Scorpion SII-4035-450KV |
| Armour | AR500 over a 6061 chassis — and the team admits the panels "have never been fully bolted on" |

RPM, drum diameter and impact energy are **not published**.

### What moves
| Part | Axis | Range |
|---|---|---|
| Eggbeater drum | transverse, front of chassis | continuous; direction set between fights, not live |
| 4 omniwheels | own hub axes, mounted at 45° | continuous — combine into holonomic translation + yaw |
| Bolt-on wedge / forks | — | static, swapped between fights |

### Game characterisation

Glitch wins by out-positioning: the X-drive lets it circle and strafe while
holding the drum square to the opponent, converting nearly every exchange into
a clean uppercut. It went 3-0 as a rookie and took Rookie of the Year 2021.
It loses to traction — omniwheels have poor grip, so a heavy pusher shoves it
around at will — and to harder-hitting verticals that win the weapon exchange.

```js
glitch: {
  id: "glitch", name: "Glitch", tagline: "Always pointed at you.",
  referenceImage: "./public/reference/glitch.png",
  modelPath: "./public/models/glitch.glb",
  modelYaw: Math.PI,        // MEASURED: model faces +Z, game wants -Z
  weightLbs: 250, weaponWeightLbs: 58,     // real published drum mass
  bodyDims: { x: 2.9, y: 1.0, z: 3.2 },    // delta planform, widest at the rear
  maxSpeedFps: 15.0, accel: 7.0, turnRate: 1.15,
  accent: "#7b3fd4", accentDark: "#15161a",
  stats: { armor: 6, speed: 7, weapon: 9, control: 9 },
  drive: { type: "holonomic", strafeRatio: 0.9, pushForceScale: 0.4 },  // X-drive
  weapon: {
    type: "drum",
    pivot: { x: 0.05, y: 0.04, z: 0.21 },   // MEASURED drum axis (model space)
    axis:  { x: 1, y: 0, z: 0 },            // MEASURED transverse
    dims: { x: 0.33, y: 0.23, z: 0.29 },
    budgetCap: 360,
    tuning: { spinUpSeconds: 1.3 },
  },
  colliders: [ /* flat delta wedge + drum guard */ ],
}
```

**Sim note.** Glitch shares Shatter's `drive.holonomic` requirement — strafing
plus a **low push-force penalty**. That penalty is its documented real weakness
and is what keeps it balanced. No secondary or tertiary control needed.

---

## Gigabyte — the biggest hammer in the box

**Robotic Death Company — built by John Mladenik (Oceanside, CA)**, with
captaincy passing to Derek Tran and Camden Wallraff at WC VII when Mladenik
moved to captain Cobalt. Every reboot season III–VII plus Bounty Hunters,
Champions I & II and Proving Ground. Successor to RDC's earlier shell spinner
**Megabyte**.

*Do not attribute Gigabyte to Hardcore Robotics or any Tombstone-adjacent team —
that is a common error.*

| Real spec | Value |
|---|---|
| Weight | 250 lb |
| Shell | **110 lb originally, 120 lb current** (a 130 lb option existed) |
| Shell material | 0.25" AR500, 0.1875" AR500, or **0.41" titanium** — four shells carried |
| Tip speed | ~170 mph early, **188 mph** confirmed 2023 |
| Spin-up | **~6 seconds** |
| Drive | **2 wheels**, Magmotors → TP5680 brushless; magnets added 2023 |

### The shell — confirmed full-body

The **entire outer dome rotates as one rigid piece about a single central
vertical axis**, bolted to a spindle rising from a flat polygonal baseplate,
belt-driven from a motor off to one side. The chassis does not rotate.

The **self-righting pole** through the shell's centre is **passive** — rigid,
non-powered. It stops the bot resting inverted and gives the driver an
orientation reference against the blur. Teeth are discrete bolt-ons and are a
documented failure point.

The weak link is the shell-to-spindle attachment: in its debut, Tombstone broke
the retainer and tore the shell off entirely — traced to a cast aluminium mast
supplied instead of the machined 6061 that was ordered.

### What moves
| Part | Axis | Range |
|---|---|---|
| Entire shell + teeth (one rigid body) | **vertical, through the chassis centre** | continuous |
| 2 drive wheels | transverse, at the periphery | continuous |
| Self-righting pole | **none** | static, passes through the shell centre |

### Game characterisation

It stores more kinetic energy than anything else in the box and dumps it in one
hit. Two or three connections strip wheels or kill drive. It is beaten by
wedges — a good wedge deflects the shell instead of absorbing it, robbing bite
while recoil sends Gigabyte bouncing off walls — and by its own hardware.
Career is roughly break-even with a very high KO rate: it either kills you or
it breaks.

```js
gigabyte: {
  id: "gigabyte", name: "Gigabyte", tagline: "One hit is all it needs.",
  referenceImage: "./public/reference/gigabyte.png",
  modelPath: "./public/models/gigabyte.glb",
  modelYaw: 0,              // radially symmetric — yaw is cosmetic
  weightLbs: 250, weaponWeightLbs: 120,    // real published shell mass
  bodyDims: { x: 3.0, y: 1.2, z: 3.0 },    // ~36" dome
  maxSpeedFps: 11.0, accel: 5.5, turnRate: 0.7,
  accent: "#d94a1e", accentDark: "#121214",
  stats: { armor: 7, speed: 5, weapon: 10, control: 3 },
  weapon: {
    type: "shellSpinner",   // NEW TYPE — see sim work
    pivot: { x: 0.06, y: -0.20, z: -0.02 }, // MEASURED shell centre (model space)
    axis:  { x: 0, y: 1, z: 0 },            // MEASURED — VERTICAL
    dims: { x: 0.82, y: 0.27, z: 0.96 },
    budgetCap: 460,         // the hardest-hitting weapon in the catalog
    tuning: { spinUpSeconds: 6.0, gyroPenalty: 0.55, recoilScale: 1.8 },
  },
  colliders: [ /* one low cylinder for the shell + a small inner chassis box */ ],
}
```

### Sim work needed: `shellSpinner`

A full-body spinner is genuinely different from a drum and needs three things:

1. **The whole hull is the weapon.** Contact anywhere on the perimeter should
   deal weapon damage while spun up — there is no safe side and no "weapon
   face" to aim.
2. **Recoil on the attacker.** Every hit throws *Gigabyte* as hard as its
   target. That ricochet is why it loses control after connecting, and it is
   most of what makes the bot feel right.
3. **Gyroscopic penalty while spun up** — reduced turning authority and a
   light-footed chassis. Paired with the **6-second spin-up**, this creates its
   real risk/reward: it is nearly helpless before it is up to speed.

Do not model per-tooth articulation. No secondary or tertiary control.

---

## Kraken — the only pneumatic crusher

**CE Robots — Matt Spurk (Titusville, FL)**, a large family team. Every season
since WC III. Themed as an **anglerfish** despite the name.

### The crusher

**Pneumatic, not hydraulic** — BattleBots called it "the only known pneumatic
crusher, ever". Every other crusher in the field (Quantum, Petunia) is
hydraulic. The actuator is an **air bag** — a pneumatic bladder, not a rod
cylinder — sitting between the chassis and the rear of the jaw lever. The
trade is speed over holding force: Kraken snaps shut far faster than a
hydraulic crusher.

- **Lower jaw is fixed** — a wide V-scoop welded rigidly to the chassis front.
- **Upper jaw** is a single long lever hinged on a transverse pin at the
  **top-rear of the body**, above the drive axle, running the full length of
  the robot to replaceable teeth and fangs at the front.
- Range **[EST] ~25–35°**, a 10–14" gape at the fangs, closing in well under a second.
- **Crush force grew across builds:** ~20,000 lbf (WC III) → **40,000 lbf**
  (WC IV) → **100,000 lbf** (WC VI), able to punch holes through ¼" steel.

### The flamethrower

**It fires from inside the mouth** — added in WC IV, aimed into the bite zone,
so it only does anything once the jaw is already clamped on a target. It is a
separate driver control (BattleBots rules require flame systems on their own
independently-armed channel).

A vulnerability worth modelling: Kraken's pneumatics are heat-sensitive. Gruff
once disabled the crusher by **melting a pneumatic line** with its own flamethrower.

*Kraken v2 (WC VII on) added an 18" 13 lb disc on the jaw tip and went 4WD at
18 mph. This drop models the classic crusher-plus-flame build.*

### What moves
| Part | Axis | Range |
|---|---|---|
| Upper jaw + teeth + fangs | transverse pin at the **top-rear** of the body | ~25–35° **[EST]** |
| Lower jaw / V-scoop | **none** | static |
| Air bag | expands vertically between chassis and jaw lever | inflate/deflate |
| Flamethrower nozzle | **none** — fixed inside the mouth | on/off |
| Drive wheels | transverse | continuous |

### Game characterisation

Grappling: drive the fixed lower wedge under an opponent, clamp, then cook them
while dragging them into hazards. When it lands it lands hard — it punched
holes in Witch Doctor for a shock upset. But it is one of the least successful
bots here: roughly a **21% win rate over 28 matches, six wins, all decisions,
zero KOs**. It is slow, tall, non-invertible and pneumatically fragile.

```js
kraken: {
  id: "kraken", name: "Kraken", tagline: "Bite first. Then light them up.",
  referenceImage: "./public/reference/kraken.png",
  modelPath: "./public/models/kraken.glb",
  modelYaw: Math.PI / 2,    // MEASURED: model faces +X, game wants -Z
  weightLbs: 249, weaponWeightLbs: 60,     // real listed weight
  bodyDims: { x: 2.6, y: 1.7, z: 4.0 },    // unusually long, tall dorsal hump
  maxSpeedFps: 8.8, accel: 5.2, turnRate: 0.7,   // 2WD NPC-T74, sluggish
  accent: "#3fa63f", accentDark: "#16181a",
  stats: { armor: 6, speed: 4, weapon: 4, control: 5 },
  weapon: {
    type: "crusher",        // same family as quantum — bites while held
    pivot: { x: -0.30, y: 0.12, z: 0 },     // MEASURED top-rear hinge (model space)
    axis:  { x: 0, y: 0, z: 1 },            // MEASURED
    restAngle: 0,           // GLB is baked jaw-OPEN
    fireAngle: -0.55,       // closes onto the fixed lower jaw, ~30°
    crushForce: 100000,     // real published, lbf
    budgetCap: 160,         // huge force, but it must get a grip first
    tuning: { strokeSeconds: 0.25, returnSeconds: 0.5, holdsWhileHeld: true },
  },
  flame: {                  // RB — reuse the Free Shipping subsystem
    nozzles: [ { x: 0.30, y: 0.0, z: 0 } ],  // in the mouth, rides the jaw
    ridesWeapon: true,      // NEW: emitter is parented to modelWeapon
    requiresGrip: true,     // NEW: only meaningful once clamped
    range: 4.0, fuelSeconds: 60, damagePerSecond: 8,
  },
  colliders: [ /* long low body + dorsal hump + fixed lower V-scoop */ ],
}
```

**Sim work.** Two additions to the `flame` subsystem specced for Free Shipping:
`ridesWeapon` (the emitter is parented to `modelWeapon`, so the flame aims
where the jaw points) and `requiresGrip` (damage gated on an active clamp).
Optionally, let flame damage **disable a pneumatic weapon** — that really
happened to Kraken and is a nice counter to give flame bots.

---

## Rusty — the scrapyard hammer

**Team Iron Force — Dave Eaton (Antioch, IL)**, a genuine **one-man team**.
WC V (rookie), WC VI, WC VII (alternate), FaceOffs 2024 (reserve).
**Inaugural Rookie of the Year, 2020** — the award presented as two nuts welded
to a metal plate. Eaton self-funded the build; his listed sponsors were "Hope,
Prayers, and Whatever is Available".

### What it is actually made of

The show is not exaggerating this, and it is worth keeping in the game's flavour:

- **The rust is real, not paint.**
- The head is a steel drum; **the chrome helmet is an inverted stainless kitchen
  mixing bowl** — it had been used as a popcorn bowl while Eaton watched BattleBots.
- **The battery tray is a cut street sign.**
- **The power switch — a mandatory safety component — is a nut welded to a bolt.**
- A scavenged titanium panel from the robot Gamma 9 braces the gas tank.

Mk.II (AR500, titanium, 5160 spring steel arms) is a real materials step up but
keeps the same worn look. Note Mk.II was built for WC VI but **never raced
there** — suppliers fell through, so Eaton brought Mk.I out of retirement.

### The hammer — and why it is invisible from the front

Pneumatic, off an onboard gas cylinder. The arm is a long flat plate-steel bar
drilled with lightening holes, hinged on a transverse pin on a **raised gantry
above and behind the head**. In the rest pose it **lies back almost horizontally
across the entire rear deck, with the head hanging over the tail** — directly
behind and below the silhouette of the domed head in any front-on photo. The
official WC VII hero shot has **no weapon arms fitted at all**.

Swing is **[EST] ~120–160°** from rear-cocked to forward strike. Head mass,
swing energy and system pressure are **not published**.

**Heads are modular** and swapped per fight: sledgehammer, a **pneumatic
reciprocating spike/drill** that works like a jackhammer, an axe, a chainsaw, a
sword, a welded-on lifting scoop (literally Lock-Jaw's rear plow), and a hinged
front fork.

**Retraction is the interesting failure mode.** The arm repeatedly swung and
failed to re-cock, leaving the head dragging — in one FaceOffs fight the
dragging axe fell into the killsaw slot and immobilised the robot.

### What moves
| Part | Axis | Range |
|---|---|---|
| Hammer arm + head | transverse pin at the **top of the rear gantry** | ~120–160° **[EST]** |
| Reciprocating spike (when fitted) | **linear**, along the arm at the tip | short pneumatic stroke, superimposed on the swing |
| 2 rubber tracks | own roller sets | continuous |
| Chrome dome | **none** | static |

```js
rusty: {
  id: "rusty", name: "Rusty", tagline: "Held together by hope and a welded nut.",
  referenceImage: "./public/reference/rusty.png",
  modelPath: "./public/models/rusty.glb",
  modelYaw: Math.PI / 2,    // MEASURED: model faces +X, game wants -Z
  weightLbs: 250, weaponWeightLbs: 30,
  bodyDims: { x: 2.6, y: 2.5, z: 3.0 },   // tall for its size, thanks to the dome
  maxSpeedFps: 7.0, accel: 4.2, turnRate: 0.6,   // tracked, slowest in the catalog
  accent: "#8a5a32", accentDark: "#2a2118",
  stats: { armor: 3, speed: 3, weapon: 3, control: 4 },
  drive: { type: "tracked" },   // see sim work
  weapon: {
    type: "hammer",
    pivot: { x: 0.28, y: 0.05, z: 0 },      // MEASURED front-of-yoke hinge (model space)
    axis:  { x: 0, y: 0, z: -1 },           // MEASURED — see SEGMENTATION.md on the sign
    restAngle: 0,           // GLB is baked cocked-back over the tail
    fireAngle: 2.4,         // ~140° forward and down
    budgetCap: 260,
    selfRight: true,
    manualRetract: true,    // NEW — RB re-cocks; see below
    tuning: { strokeSeconds: 0.25, returnSeconds: 1.4, jamChance: 0.12 },
  },
  colliders: [ /* low box hull + tall head drum + two track slabs */ ],
}
```

**Controls: RT swings, RB retracts.** Retraction should be a *separate* input
rather than automatic, because failing to re-cock is central to how Rusty
loses — and the same action doubles as its self-right. A `jamChance` on the
return makes that authentic rather than merely fiddly.

---

## Dragon King — grappler-cutter on rotating tracks

**Attribution is layered and both halves matter.** Originally designed and
built by **Jerome Miles** (Team Duct Tape, USA) as the successor to his
**Red Devil**, for the Chinese televised events *This Is Fighting Robots* and
*King of Bots II*; it was his final build before retiring in 2020. Bought by
the Skorpios team, it now competes as **Bot Bash Party Crew**, captained by
**Will Prater**, out of **Birmingham, Alabama**.

**Despite the Chinese-TV origin and dragon theming, this is an American robot
with an American builder and an American team.** WC VII as an alternate, plus
Proving Ground; announced for a 2026 Halloween-season fight.

### Weapons

- **Twin circular saws**, one per side, each at the tip of a long articulated
  arm, chain- or belt-driven along the arm's length. (Doomba tore a weapon chain
  off and instantly killed the right-hand saw.)
- **The arms articulate independently of the blades spinning** — two separate
  degrees of freedom. Each pivots at its base near the top of the head and
  swings from near-vertical down onto a held opponent, **[EST] ~70–90°**. The
  commentary record shows them worked one at a time.
- **A clamping jaw** forms the dragon's mouth: the **lower jaw is a fixed yellow
  wedge** that doubles as the get-under wedge, and the **upper jaw articulates**
  to pin a target. The jaw is the enabling weapon — the saws are useless
  without a grip.

Blade diameter, RPM, arm actuator type and the robot's **weight** are all
**not published**.

### The rotating track pods

**Two tracked drive pods mounted outboard on pivoting arms**, independently
powered — and **the pods themselves rotate**, which is genuinely unusual. The
WC VII record documents it repeatedly: pods pivoted "so that they sat behind the
front jaws", then "rotating its tracks back into their normal position", plus
repeated "self-lifting" of the weapon and track modules, and recovery after
being turned over. So pod rotation does three jobs: reconfigure stance, lift the
body, and self-right.

Because of this, **its bounding box and ride height change with pod position** —
don't use a fixed box.

### What moves
| Part | Axis | Range |
|---|---|---|
| Left / right saw blade | own axis at each arm tip | continuous |
| Left / right saw arm | transverse pivot at the arm base | ~70–90° **[EST]** |
| Upper jaw | transverse hinge at the top of the head | ~30–45° **[EST]** |
| Lower jaw / wedge | **none** | static |
| Left / right track pod (whole module) | rotates about its mounting axis | large arc — restance, self-lift, self-right |
| Tracks | own roller sets | continuous |

```js
dragonking: {
  id: "dragonking", name: "Dragon King", tagline: "Pin it, then cut it open.",
  referenceImage: "./public/reference/dragonking.png",
  modelPath: "./public/models/dragonking.glb",
  modelYaw: Math.PI,        // MEASURED: model faces +Z, game wants -Z
  weightLbs: 250, weaponWeightLbs: 40,     // weight not published; class limit assumed
  bodyDims: { x: 3.3, y: 1.7, z: 2.8 },    // varies with pod position
  maxSpeedFps: 8.0, accel: 4.5, turnRate: 0.65,
  accent: "#e8b21e", accentDark: "#141414",
  stats: { armor: 6, speed: 4, weapon: 5, control: 6 },
  drive: { type: "tracked" },
  weapon: {
    type: "sawArms",        // arms carry the blades — nested, like sawblaze
    pivot: { x: 0, y: 0.05, z: -0.12 },     // MEASURED arm base (model space)
    axis:  { x: 1, y: 0, z: 0 },            // MEASURED
    restAngle: 0,           // GLB baked arms-RAISED; the stroke lowers them
    fireAngle: 1.4,         // ~80° down onto a held opponent
    budgetCap: 180,
    sub: {                  // modelWeaponSub-saws — spins regardless of arm angle
      node: "modelWeaponSub-saws",
      pivot: { x: 0, y: 0.24, z: -0.10 },   // MEASURED — both blades share this axis line
      axis:  { x: 1, y: 0, z: 0 },
      spinUpSeconds: 1.0, damagePerSecond: 14, requiresGrip: true,
    },
  },
  aux: {
    jaw:  { node: "modelAux-jaw",  axis: { x: 1, y: 0, z: 0 },
            pivot: { x: 0, y: 0.0,  z: 0.12 }, closeAngle: 0.7, seconds: 0.4 },
    pods: { node: "modelAux-pods", axis: { x: 1, y: 0, z: 0 },
            pivot: { x: 0, y: -0.05, z: -0.03 }, range: 2.2, seconds: 0.8,
            drivesSelfRight: true },
  },
  colliders: [ /* central module box + fixed lower wedge + two pod slabs */ ],
}
```

### Controls and sim work

- **RT = saw blades** (toggle spin). Gate damage on an active grip — the saws do
  nothing without one, which is the whole shape of how this bot fights.
- **RB = jaw clamp.**
- **LB = saw arms raise/lower.**
- **Pod rotation** wants a fourth input it can't have. Drive it automatically:
  trigger on inversion for self-right, and optionally on a held brake for the
  self-lift stance. `drivesSelfRight: true` marks that.

Note the arms are baked **raised**, so a positive stroke **lowers** them —
verify with `glb-rig-check --expect-drop`, the same as a hammer.

---

## New engine work this drop implies

| Feature | Bots | Size |
|---|---|---|
| `drive.holonomic` — strafing with a low push-force penalty | Glitch (also Shatter, last drop) | **large** |
| `shellSpinner` — whole hull is the weapon, with recoil + gyro penalty | Gigabyte | medium |
| `flame.ridesWeapon` / `flame.requiresGrip` | Kraken | small |
| `weapon.manualRetract` + `jamChance` | Rusty | small |
| `drive.tracked` — track visuals and turn feel | Rusty, Dragon King | small–medium |
| `aux` group driven automatically on inversion | Dragon King (pods) | small |
| `sub.requiresGrip` — sub-weapon damage gated on a clamp | Dragon King, Kraken | small |

None are required to play these bots: with none implemented, all five drive and
run their primary weapon on RT.

## Figures that do not exist in any source — do not invent them

- **Footprints** for all five bots (every footprint above is an estimate).
- **Top speed** for Glitch, Gigabyte, Rusty and Dragon King (only Kraken v2's
  18 mph is published).
- **Rusty:** hammer head mass, swing energy, gas pressure, swing angle.
- **Glitch:** drum RPM and diameter, impact energy.
- **Gigabyte:** shell diameter, drive top speed.
- **Dragon King:** weight, blade diameter, saw RPM, arm actuator type, armour spec.

## Source conflicts, flagged rather than resolved

1. **Glitch hometown** — battlebots.com says Berkeley, CA; the wiki says Roseville, CA.
2. **Glitch weapon class** — battlebots.com "bar spinner (vertical)" vs team/wiki "eggbeater drum".
3. **Glitch honours** — it won the ROTATOR bracket of Champions I, *not* Champions
   overall, and has never won a Giant Nut. Rookie of the Year 2021 is real.
4. **Dragon King WC VII record** — 1-1 on the wiki (counting the Doomba
   exhibition) vs 0-1 on battlebots.com's official stats (excluding it).
5. **Gigabyte attribution** — Robotic Death Company, not Hardcore Robotics; and
   "the builder" (Mladenik) and "the WC VII captain" (Tran/Wallraff) are
   different people depending on the era depicted.
6. **Dragon King attribution** — Jerome Miles built it, Will Prater captains it.
   Crediting either alone is incomplete.
