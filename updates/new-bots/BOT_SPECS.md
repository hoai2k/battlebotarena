# Beta & Whiplash — integration spec

Everything needed to drop these two bots into the game: real-world mechanics,
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

---

## Beta — overhead hammer

**Team Hurtz (John Reid, UK).** A hammer bot whose whole design premise is
attacking the one surface opponents rarely armor: the top. Competed in Robot
Wars and BattleBots World Championships II, V and VII.

| Real spec | Value |
|---|---|
| Weight | 99.5 kg (~220 lb) |
| Footprint | 80 cm long × 82 cm wide |
| Speed | 8 mph |
| Drive | 2 × 36 V DC motors, 800 W each (brushless from WCVII) |
| Hammer head | 11 kg (~24 lb); aluminium alloy originally, AR500 steel later |
| Hammer drive | **Electric, geared** — not pneumatic |
| Notable | Neodymium magnets give ~400 kg of downforce so the bot doesn't throw itself over when the hammer lands |

### What moves

**One moving part: the hammer arm.** A single rigid assembly — truss arm plus
the cylindrical head at its end — hinged on a lateral (left-right) axis near
the middle/rear of the chassis.

- **Rest:** arm raised and cocked back over the rear of the robot (this is the
  pose in the reference photo).
- **Fire:** swings forward and down in a fast overhead arc, striking in front
  of the wedge. Sweep is roughly 150–180°.
- **Return:** motor drives it back to the cocked position; noticeably slower
  than the strike.
- The hammer doubles as a **self-righter** and a crude lifter — driving it into
  the floor levers the body up.

Everything else — the big steel wedge/plow body, the wheels (small, mostly
hidden inside the shell) — is static.

### Game characterisation

Closest existing analogue is **Sawblaze** (`hammerSaw`), minus the spinning
disc: a hold-to-swing arm with a heavy single impact. It is *not* a spinner —
there is no stored rotational energy, so the impulse should come from the
stroke, not from an energy budget.

- Slow-ish drive, very heavy hit, long recovery between swings.
- Big damage concentrated in one hit; nothing while the arm is recovering.
- The magnet detail is worth modelling as **high stability** — Beta should be
  hard to flip and shouldn't launch itself when it strikes.

```js
beta: {
  id: "beta", name: "Beta", tagline: "Comes in from the top.",
  referenceImage: "./public/reference/beta.png",
  modelPath: "./public/models/beta.glb",
  modelYaw: Math.PI,      // MEASURED: model faces +Z, game wants -Z
  weightLbs: 250, weaponWeightLbs: 24,
  bodyDims: { x: 2.7, y: 1.0, z: 2.6 },   // 82 cm × 80 cm
  maxSpeedFps: 11.7,      // 8 mph
  accel: 7.0, turnRate: 0.95,
  accent: "#b9bcc0", accentDark: "#17181c",
  weapon: {
    type: "hammer",       // NEW TYPE — see "Sim work needed"
    pivot: { x: -0.013, y: -0.09, z: 0.14 }, // MEASURED hinge (model space)
    axis:  { x: 1, y: 0, z: 0 },          // lateral: swings in the fore-aft plane
    restAngle: 0.0,       // set from the GLB's baked (cocked) pose
    fireAngle: -2.6,      // ~150° forward-and-down
    strokeSeconds: 0.22,  // fast strike
    returnSeconds: 0.9,   // slow re-cock
    budgetCap: 320,       // heavy single impact
    selfRight: true,      // hammer can right the bot
  },
  colliders: [ /* wedge body: a low box + front wedge ramp */ ],
}
```

### Sim work needed

`hammerSaw` already models "hold to swing, contact during swing = impulse", so
Beta can ship as a `hammerSaw` variant with no disc. A dedicated `hammer` type
would be better because Beta wants:

1. **Asymmetric stroke timing** — fast down, slow return (a hammer's whole
   feel). `hammerSaw` uses one stroke window.
2. **Impulse scaled by angular speed at contact**, so a hit at the bottom of
   the arc is much stronger than a graze near the top.
3. **Self-right**: if inverted, firing the hammer should right the bot (v1 has
   a precedent in Bronco's self-righting flip).
4. **Downforce**: raise its effective stability, and damp the reaction impulse
   on Beta itself so it doesn't backflip on every strike.

---

## Whiplash — articulated lifter with a spinning disc

**Team Fast Electric Robots (Matt Vasquez).** Competed every season since
World Championship III. Officially classed as an *articulated lifter / vertical
disc spinner* — genuinely two weapons in one.

| Real spec | Value |
|---|---|
| Weight class | Heavyweight (250 lb limit) |
| Weapon 1 | Rear-hinged lifter arm with front forks |
| Weapon 2 | 22 lb vertical spinning disc mounted **on** the arm |
| Arm travel | **180°** — lifts from the front, and can carry the disc overhead |
| Variant | Disc is sometimes swapped for an AR500 steel plate |
| Drive | 4-wheel, known for exceptional driving |

### What moves

**Three independent systems** — this is the interesting one:

1. **Lifter arm** — rear-hinged, lateral axis. Rests low with the forks on the
   floor to scoop under an opponent; raises through ~180°, which both flips
   the opponent and swings the disc over the top like a hammer saw.
2. **Spinning disc** — the yellow/green disc mounted on the arm. Spins about
   its own axle *continuously and independently* of the arm's position, so
   arm angle and disc spin must compose.
3. **Wheels** — four, exposed.

This is exactly the structure Sawblaze already uses: a `modelWeapon` group for
the arm with a nested `modelWeaponSub-*` for the disc. The loader wraps the
sub-part in its own pivot inside the arm, so it swings *and* spins.

The **front forks** are rigidly part of the arm assembly (they hinge with it),
not separate.

### Game characterisation

A hybrid that should feel distinct from every current bot: control-oriented
rather than pure damage. Good drivers use it to lift and carry opponents into
hazards, with the disc as opportunistic damage.

- Fast, agile drive (its real reputation).
- Lift is the primary tool — getting under an opponent should reliably tip them.
- Disc does moderate continuous damage on contact, not one big spike.
- Two separate controls: **RT** = lift/lower arm, **RB** = disc on/off toggle
  (same split Sawblaze already uses).

```js
whiplash: {
  id: "whiplash", name: "Whiplash", tagline: "Lift them, then bury the disc.",
  referenceImage: "./public/reference/whiplash.png",
  modelPath: "./public/models/whiplash.glb",
  modelYaw: Math.PI / 2,  // MEASURED: model faces +X, game wants -Z
  weightLbs: 250, weaponWeightLbs: 22,
  bodyDims: { x: 2.6, y: 0.85, z: 3.0 },
  maxSpeedFps: 16.0,      // agile
  accel: 8.5, turnRate: 1.1,
  accent: "#d8e021", accentDark: "#141414",
  weapon: {
    type: "lifterDisc",   // NEW TYPE — see "Sim work needed"
    pivot: { x: -0.44, y: -0.02, z: 0 },  // MEASURED rear hinge (model space)
    axis:  { x: 1, y: 0, z: 0 },          // lateral (part-map axis is [0,0,1] pre-yaw)
    restAngle: 0.0,       // forks down on the floor
    fireAngle: -3.0,      // ~180° to fully overhead
    strokeSeconds: 0.5,   // deliberate lift, not a snap
    liftImpulse: 150,     // enough to tip a 250 lb opponent
    disc: {               // nested sub-spinner (modelWeaponSub-disc)
      spinUpSeconds: 1.4,
      maxOmega: 380,
      inertia: 0.55,
      budgetCap: 90,      // moderate per-hit, damage comes from repetition
      contactDamagePerSecond: 14,
    },
  },
  colliders: [ /* low chassis box + fork prongs at the front */ ],
}
```

### Sim work needed

1. **A `lifterDisc` weapon type** combining the existing flipper-style lift
   (but sustained/held rather than impulsive) with a spinner energy budget for
   the disc.
2. **Lift must be a hold, not a fire** — the arm should hold whatever angle the
   player holds, so opponents can be carried. Existing flipper logic is a
   one-shot stroke; this needs a servo-to-angle instead.
3. **Two input channels**, already plumbed: `weapon` (arm) and `sawActive`
   (disc), matching Sawblaze.
4. **Damage split**: lifting deals almost none (it's positional); the disc
   deals continuous contact damage, with a bigger hit when the arm slams it
   down from overhead.

---

## Open questions to resolve when integrating

These need a pass in the viewer/game and are cheap to fix (all one-line):

- **`modelYaw`** — measured and filled in above (Beta π, Whiplash π/2), but
  worth one confirming look in-game that each drives nose-first.
- **`modelScale`** — the auto footprint fit can be skewed by Beta's long
  overhanging hammer; an explicit scale may be needed (Bronco and HyperShock
  both needed one for the same reason).
- **`restAngle` / `fireAngle` signs** — both models are generated in a specific
  arm pose (Beta cocked back, Whiplash raised); confirm visually which
  direction is "fire".
- **Collider boxes** — the `colliders` arrays above are placeholders. Author
  them against the real model bounds.
- **Wheel parts** — Whiplash's wheels should segment cleanly; Beta's are mostly
  enclosed by the shell and may not separate (fine — they barely show).
