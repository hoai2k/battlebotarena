// BattleBot Arena v2 — bot catalog. All stats ported from v1 src/botConfig.js
// and src/modelPartConfig.js (fitted collider data).
//
// UNITS
// - Distances/dimensions: feet. Weights: pounds. Durations: seconds.
// - Speeds: feet per second (v1 stored mph; converted here via 22/15).
// - Angular speeds (weapon maxOmega): radians per second.
// - weapon.inertia: the v1 dimensionless rotational-inertia scalar
//   (weaponRotationalInertia); spin energy E = 0.5 * inertia * omega^2 in the
//   same abstract units v1 used. budgetCap is v1's spinnerImpactCap and is
//   applied where v1 applied it — inside the shaping chain, BEFORE
//   impulseScale and the v1->v2 unit bridge (see sim/weaponTuning.js). It is
//   therefore in v1 impulse units, not sim impulse units.
//
// COORDINATES (body-local, matches v1 fitted-model space)
// - +Y up, forward is -Z, +X is the bot's right side.
// - Offsets/pivots are in the fitted visual model's local frame (v1
//   modelPartConfig collider parts, with fit.scale already applied). y=0 is
//   approximately the floor plane at rest, but individual pieces may dip
//   slightly below it — the sim should ground the assembled collider stack
//   (lowest point -> floor) when spawning.
//
// SIZING (how every length in this file got its absolute value)
// Each bot's GLB is scaled so that its MEASURED WIDTH in game space equals
// realWorld.size.widthFt. Width is the axis to match on: it is the one
// dimension no arm, fork or wedge can extend, so it means the same thing on
// every machine whatever pose its weapon is baked in. Length is then a CHECK,
// not a second target — a uniform scale cannot hit both, and a model whose
// length lands outside the class band is a model whose proportions are wrong
// (see HyperShock, which is scaled between the two instead).
//
// Real BattleBots do not publish overall dimensions, so size.source says where
// each number came from and there are only three grades:
//   published        off a source. Mammoth (8'9" x 5'4" x 6'3") and Deep Six
//                    (4ft span) are the only two.
//   wheel-calibrated HUGE, whose 40in wheels are published and are most of its
//                    outline. The GLB measured 3.367ft at the wheel against a
//                    real 3.333ft, i.e. it was already within 1% — which is the
//                    only independent check this whole pass has, and it passed.
//   class-estimate   everything else: placed inside the 2.4-4.0ft envelope that
//                    a 250lb machine built to the 8'x8' start box occupies,
//                    ranked by archetype against the three anchors above.
// Treat class-estimate widths as game balance, not as fact about the robot.
//
// Everything with units of length in an entry — bodyDims, collider extents and
// offsets, weapon pivots and radii, reach, gripReach — carries its bot's scale
// factor. wheelAnchors.y does NOT: it is a suspension probe origin measured
// against the fixed 0.45ft ray travel in sim/vehicle.js, and scaling it sinks
// the chassis to the floor and takes the wheels off the ground.
//
// MEASURE A MODEL THROUGH ITS INDICES, never through its position accessors.
// Carving a bot (tools/glb-carve.mjs) re-points a primitive at the triangles
// that survived and leaves the orphaned vertices in the buffer, so a bot
// measured off its accessors reads bigger than the robot on screen — Tantrum
// measures 3.29ft that way and is drawn at 3.00 — and chasing that phantom is
// how you shrink a bot that was the right size all along. models.js already
// does it right (drawnLocalBox); tools/sim-tests.mjs checks every bot's drawn
// width against its widthFt so a modelScale cannot quietly drift off it again.
//
// So a bot cannot be resized by editing widthFt alone — that leaves a machine
// whose colliders no longer match its model. Use tools/rescale-bot.mjs, which
// applies the one multiply to every length in the entry and then verifies it
// against a fresh import. Gigabyte (3.00 -> 3.35), Kraken (2.60 -> 2.90) and
// Rusty (2.60 -> 2.85) were resized that way, so their MEASURED values are
// re-derived rather than re-measured: the ratios between them are exactly as
// measured, the absolute numbers carry the new scale, and any parenthetical in
// those three entries quoting a figure not in this file is in the old scale.
//
// SPEEDS (how maxSpeedFps got its value)
// Chassis top speeds are published even more rarely than dimensions — a search
// across the roster turns up seven, and for most machines the only public fact
// about the drive is its motors. So speed is graded the same way size is:
//   published        off a source page. Claw Viper ("tops out at 20 mph",
//                    battlebots.com) and Mammoth (22).
//   builder-stated   off the team's own site. Kraken's 2022/23 rebuild: "over
//                    22hp of drive power", expected "around 20mph", up from 30lb
//                    of brushed motors making 3-4hp (cerobots.com). That rebuild
//                    is why Kraken is no longer the slowest wheeled bot here.
//   team-stated      a figure the team has given in interviews or on air:
//                    HyperShock 28, HUGE 15, Whiplash 15, Beta 12.
//   class-estimate   everything else, ranked by the drive hardware that IS
//                    recorded in realWorld.drive — four modern brushless motors
//                    beat two, brushed motors sit low, and tracks (Rusty, Dragon
//                    King) sit lowest. Treat these as game balance, not fact.
//
// The game runs at ARENA SCALE 0.58 of real: maxSpeedFps = mph(realMph * 0.58).
// One factor for the whole roster, so the ORDER and the RATIOS are the real
// ones; the factor itself is chosen to leave the roster's mean speed where it
// already was (~13 ft/s) while letting the spread be the real spread. A bot's
// game speed is therefore always derivable from the fact above it.
//
// Acceleration is NOT derived from top speed, because the sources repeatedly
// separate the two. HyperShock has the highest ceiling on the roster and, by
// its own team's account, takes about twice as long to reach it as Claw Viper —
// which is why Claw Viper carries the highest accel in the catalog (four
// RV-120E brushless motors and magnets holding it to the floor) and is the one
// machine HyperShock cannot outrun, despite giving away 8mph on paper.
//
// EXTENSIONS beyond the ARCHITECTURE.md typedef (all optional, documented):
// - accent / accentDark: hex colors for placeholder models + UI.
// - weapon.dims: half extents {x,y,z} of the weapon volume around the pivot
//   (thin solid collider + placeholder geometry). weapon.radius for round
//   drums/saws.
// - weapon.tuning: raw v1 spinner/flipper shaping numbers (efficiency,
//   impulseScale, liftScale, kickbackScale, ...) for the sim's budget-hit
//   vertical/horizontal split. Efficiency default is 0.5 when v1 had none.
// - wheelAnchors y is the probe origin height; the sim casts -Y with ~0.45ft
//   travel from there.

/** @typedef {{
  id: string, name: string, tagline: string,
  referenceImage: string, modelPath: string,
  weightLbs: number, weaponWeightLbs: number,
  bodyDims: {x:number,y:number,z:number},
  wheelAnchors: {x:number,y:number,z:number}[],
  maxSpeedFps: number, accel: number, turnRate: number,
  accent: string, accentDark: string,
  weapon: { type: 'bar'|'drum'|'flipper'|'crusher'|'hammerSaw'|'hammer'|'lifterDisc'|'grappler',
            spinUpSeconds?: number, spinDownSeconds?: number,
            inertia?: number, maxOmega?: number,
            budgetCap?: number, radius?: number,
            dims: {x:number,y:number,z:number},
            pivot: {x:number,y:number,z:number},
            axis: {x:number,y:number,z:number},
            tuning?: object },
  colliders: {shape:'box'|'cylinder'|'hull'|'wedge', offset:{x:number,y:number,z:number}}[],
  realWorld: {                             // the machine this bot is modelled on
    team: string, from: string,
    weightLbs: number, topSpeedMph: number|null, topSpeedSource?: string,
    size: {widthFt:number, lengthFt:number, heightFt:number, source:string},
    weapon: {name:string, weightLbs:number|null, tipSpeedMph:number|null, rpm:number|null},
    drive: string|null, power: string|null,
  },
}} BotSpec */

const FEET_PER_SECOND_PER_MPH = 22 / 15;
const mph = (v) => Number((v * FEET_PER_SECOND_PER_MPH).toFixed(2));

/** @type {Record<string, BotSpec>} */
export const CATALOG = {
  biteforce: {
    id: "biteforce",
    name: "Bite Force",
    tagline: "Four-time champ. Vertical spinner, zero mercy.",
    referenceImage: "./public/reference/biteforce.png",
    modelPath: "./public/models/biteforce.glb",
    modelYaw: Math.PI / 2, // GLB authoring facing -> game -Z forward
    // Bite Force's drive is inboard of its frame rails and segmentation never
    // saw a wheel, so the procedural fallback was bolting four blue drums to
    // the outside of a bot that does not have any.
    hideWheels: true,
    // --- the real machine ---------------------------------------------
    realWorld: {
      team: "Aptyx Designs", from: "Mountain View, CA",
      weightLbs: 250,
      topSpeedMph: 13, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 3.05, lengthFt: 2.66, heightFt: 1.43, source: "class-estimate" },
      weapon: { name: "Vertical bar spinner", weightLbs: 40, tipSpeedMph: null, rpm: null },
      drive: "2x S28-400 Magmotor (9hp)", power: "10x 5Ah 6S LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 40,
    bodyDims: { x: 3.1248, y: 1.519, z: 2.5932 }, // scaled to realWorld.size.widthFt
    wheelAnchors: [
      { x: -1.2803, y: 0.21, z: -0.8137 },
      { x: 1.2803, y: 0.21, z: -0.8137 },
      { x: -1.2803, y: 0.21, z: 0.8137 },
      { x: 1.2803, y: 0.21, z: 0.8137 },
    ],
    maxSpeedFps: mph(7.54), // 11.06 fps
    accel: 8.2,
    turnRate: 1.05,
    accent: "#3b82c4",
    accentDark: "#16283c",
    weapon: {
      type: "drum",
      spinUpSeconds: 1.8,
      inertia: 1.0,
      maxOmega: 487,
      budgetCap: 120,
      // Tripo only segmented a sliver of this drum, so the swept measurement is
      // a LOWER BOUND rather than the truth — but 0.526 still beats the 0.42
      // guess it replaces, and it drops the drum's ground clearance from 0.22ft
      // to 0.11ft, under the nose of every wedge that used to slide beneath it.
      radius: 0.5707,
      dims: { x: 0.9222, y: 0.5707, z: 0.5707 },
      pivot: { x: 0, y: 0.6944, z: -0.2604 },
      axis: { x: 1, y: 0, z: 0 },
      tuning: { efficiency: 0.5, impulseScale: 13.8, liftScale: 32.0, liftVelocity: 4.5, liftClearance: 0.5968, gyroScale: 0.75, damageScale: 1.65 },
    },
    // The fork row is a WEDGE, not a box: opponents ride up it into the drum,
    // which is the whole point of the machine. Squared off into a level box it
    // was a bumper holding every opponent 0.5ft outside the drum.
    colliders: [
      { shape: "wedge", halfExtents: { x: 1.1393, y: 0.2278, z: 0.3092 }, offset: { x: 0, y: 0.2278, z: -1.0253 }, tipY: 0.0325 }, // front fork wedge (MEASURED slope)
      { shape: "box", halfExtents: { x: 1.3421, y: 0.1855, z: 0.9472 }, offset: { x: 0.013, y: 0.1899, z: 0.3266 } },
      { shape: "box", halfExtents: { x: 0.3841, y: 0.1736, z: 0.8007 }, offset: { x: -0.0033, y: 0.5371, z: 0.2908 } },
      { shape: "box", halfExtents: { x: 0.2148, y: 0.319, z: 0.8571 }, offset: { x: -1.2857, y: 0.319, z: 0.1899 } }, // left pod
      { shape: "box", halfExtents: { x: 0.2148, y: 0.319, z: 0.8571 }, offset: { x: 1.2846, y: 0.319, z: 0.1899 } }, // right pod
    ],
  },

  bronco: {
    id: "bronco",
    name: "Bronco",
    tagline: "Pneumatic flipper. Everything is a launch pad.",
    referenceImage: "./public/reference/bronco.png",
    modelPath: "./public/models/bronco.glb",
    modelYaw: 0, // GLB authored facing -Z already = game forward
    // Auto scale (4.06) makes bronco longer than HUGE; 3.4 keeps the length
    // near bodyDims/colliders (~3.4ft) at the cost of slightly narrow width.
    modelScale: 4.2949,
    // --- the real machine ---------------------------------------------
    realWorld: {
      team: "Inertia Labs", from: "Sausalito, CA",
      weightLbs: 250,
      topSpeedMph: 12, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 3, lengthFt: 4.3, heightFt: 2.01, source: "class-estimate" },
      weapon: { name: "Pneumatic flipping arm", weightLbs: null, tipSpeedMph: null, rpm: null },
      drive: "4x brushed motors", power: null,
    },

    weightLbs: 250,
    weaponWeightLbs: 80,
    bodyDims: { x: 4.2191, y: 2.1095, z: 4.2191 }, // scaled to realWorld.size.widthFt
    wheelAnchors: [
      { x: -1.1874, y: 0.21, z: -0.7453 },
      { x: 1.1874, y: 0.21, z: -0.7453 },
      { x: -1.1874, y: 0.21, z: 1.2758 },
      { x: 1.1874, y: 0.21, z: 1.2758 },
    ],
    maxSpeedFps: mph(6.96), // 10.21 fps
    accel: 6.7,
    turnRate: 0.9,
    accent: "#c23b2e",
    accentDark: "#3a3d42",
    weapon: {
      type: "flipper",
      restAngle: -0.28, // GLB arm baked raised; rest folds it flat onto the front forks (rad about +X at the rear hinge)
      fireAngle: 0.16, // apex carries PAST the baked pose so the plate snaps over vertical
      spinUpSeconds: 0.2, // stroke arming time (v1 weaponSpinUpSeconds)
      budgetCap: 180, // ~ (250 lb / 32.174) slugs * 23 ft/s target lift velocity
      dims: { x: 1.1369, y: 0.139, z: 1.579 },
      pivot: { x: 0, y: 0.6063, z: 0.7579 }, // hinge at rear of flipper plate
      axis: { x: 1, y: 0, z: 0 },
      tuning: { strokeSeconds: 0.18, returnSeconds: 2, liftVelocity: 23.0, pitchVelocity: 10.2 },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 1.1217, y: 0.3158, z: 1.5626 }, offset: { x: -0.0291, y: 0.432, z: 0.211 } },
      { shape: "box", halfExtents: { x: 1.3099, y: 0.1781, z: 0.6215 }, offset: { x: -0.0202, y: 0.5647, z: 1.296 } },
      { shape: "wedge", halfExtents: { x: 1.1369, y: 0.3663, z: 0.3979 }, offset: { x: 0, y: 0.3663, z: -1.7495 }, tipY: 0.0379 }, // front wedge (MEASURED slope)
      { shape: "box", halfExtents: { x: 0.7289, y: 0.1731, z: 0.6607 }, offset: { x: -0.72, y: 0.2059, z: 1.4464 } },
      { shape: "box", halfExtents: { x: 0.72, y: 0.1718, z: 0.7642 }, offset: { x: 0.7301, y: 0.2059, z: 1.3415 } },
    ],
  },

  huge: {
    id: "huge",
    name: "HUGE",
    tagline: "Giant wheels. The bar hits where armor isn't.",
    referenceImage: "./public/reference/huge.png",
    modelPath: "./public/models/huge.glb",
    wheelRadius: 1.7, // ft — giant wheels; visual roll rate must match ground speed
    modelYaw: Math.PI / 2, // GLB authoring facing -> game -Z forward
    // --- the real machine ---------------------------------------------
    // 40in UHMW/Tegris wheels, ~30lb each — the published dimension the game
    // model is calibrated on.
    realWorld: {
      team: "Team HUGE", from: "South Windsor, CT",
      weightLbs: 250,
      topSpeedMph: 15, topSpeedSource: "team-stated",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 5.69, lengthFt: 3.34, heightFt: 3.34, source: "wheel-calibrated" },
      weapon: { name: "Vertical bar spinner", weightLbs: 35, tipSpeedMph: 180, rpm: null },
      drive: "2x Maytech 8085 brushless", power: "12x 6S 2.8Ah LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 30,
    bodyDims: { x: 5.0208, y: 2.8323, z: 3.7334 }, // scaled to realWorld.size.widthFt
    // Two real wheels; probes doubled front/rear inside each wheel footprint.
    wheelAnchors: [
      { x: -1.7627, y: 0.21, z: -0.8913 },
      { x: 1.7627, y: 0.21, z: -0.8913 },
      { x: -1.7627, y: 0.21, z: 0.8913 },
      { x: 1.7627, y: 0.21, z: 0.8913 },
    ],
    maxSpeedFps: mph(8.70), // 12.76 fps
    accel: 6,
    turnRate: 0.72,
    accent: "#3f7bff",
    accentDark: "#e8e9ec",
    weapon: {
      type: "bar",
      spinUpSeconds: 5,
      // v1 gave HUGE, and only HUGE, its own coast — 0.8s against the roster's
      // 1.1s. The longest wind-up in the game paired with the shortest stop.
      // It reads as deliberate: the bot you wait five seconds for is the one
      // you least want still live once you have let go.
      spinDownSeconds: 0.8,
      inertia: 0.75,
      maxOmega: 352,
      budgetCap: 280,
      // MEASURED swept radius: max perpendicular distance from the axle over
      // every blade vertex. 1.29 was the bbox guess and left 3in of visible
      // blade outside the collider.
      radius: 1.5241,
      dims: { x: 0.1485, y: 1.5241, z: 0.1981 }, // vertical bar, disc plane Y-Z
      pivot: { x: -0.099, y: 1.3369, z: -0.0396 },
      axis: { x: 1, y: 0, z: 0 },
      tuning: {
        efficiency: 0.76, impulseScale: 10.0, liftScale: 36.0, liftVelocity: 4.5, liftClearance: 0.5447,
        gyroScale: 0.55, halfSpeedPowerMultiplier: 4.0, fullSpeedPowerMultiplier: 2.15, hapticScale: 2.0,
      damageScale: 1.11,
        impactScale: 1.05,
      },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 1.8796, y: 0.309, z: 0.2812 }, offset: { x: -0.005, y: 1.4963, z: 0.0644 } }, // bridge
      { shape: "cylinder", axis: "x", radius: 1.4478, halfHeight: 0.2575, offset: { x: -1.7578, y: 1.4488, z: 0 } }, // left wheel
      { shape: "cylinder", axis: "x", radius: 1.4082, halfHeight: 0.2575, offset: { x: 1.6687, y: 1.4082, z: 0 } }, // right wheel
    ],
  },

  quantum: {
    id: "quantum",
    name: "Quantum",
    tagline: "Hydraulic jaws. Once it bites, it keeps biting.",
    referenceImage: "./public/reference/quantum.png",
    modelPath: "./public/models/quantum.glb",
    modelYaw: Math.PI, // GLB authoring facing -> game -Z forward
    // --- the real machine ---------------------------------------------
    // Beak quoted at 35,000lb of force, ~50,000lb toward the back.
    realWorld: {
      team: "Team Robo Challenge", from: "Birmingham, UK",
      weightLbs: 250,
      topSpeedMph: 12, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 2.9, lengthFt: 3.36, heightFt: 2.15, source: "class-estimate" },
      weapon: { name: "Hydraulic crusher", weightLbs: null, tipSpeedMph: null, rpm: null },
      drive: "4x brushed LEM", power: "14S LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 250, // v1 value: jaw assembly modeled as massive
    bodyDims: { x: 3.2646, y: 1.7955, z: 2.9381 }, // scaled to realWorld.size.widthFt
    wheelAnchors: [
      { x: -0.9032, y: 0.3069, z: -0.5332 },
      { x: 0.9032, y: 0.3069, z: -0.5332 },
      { x: -0.9032, y: 0.3069, z: 0.9141 },
      { x: 0.9032, y: 0.3069, z: 0.9141 },
    ],
    maxSpeedFps: mph(6.96), // 10.21 fps
    accel: 6.2,
    turnRate: 0.84,
    accent: "#2244cc",
    accentDark: "#101528",
    weapon: {
      type: "crusher",
      spinUpSeconds: 0.2, // jaw close response
      // THE JAW MUST CLOSE ONTO THE PALLET. Verify with:
      //   node tools/rig-inspect.mjs quantum --arc "-1.0,-0.5,0.05" --bite --bitez -1.05
      // `gap` is the tooth's clearance over the pallet forks; it must reach ~0.
      // Rotation ALONE cannot do it and never could: past about -0.85 the jaw
      // has no geometry left forward of the pallet at all (it has swung in
      // behind it), and the closest any angle gets is 0.132ft short at -0.70.
      // The old -0.95 looked "more closed" while actually holding the teeth
      // further back and higher over the forks than -0.75 does. Do not just
      // wind this number down again — that is what was tried before.
      // THE JAW MUST CLAMP ONTO QUANTUM'S OWN FRONT SLOPE. Verify with:
      //   node tools/rig-inspect.mjs quantum --arc "-1.3,-0.9,0.05" --bite --bitez -0.7
      // `gap` is the arm's closest approach to the bodywork under it; it must
      // cross zero at full stroke. -1.17 lands the tooth on the slope at
      // z=-1.52. The old -0.95 stopped a quarter of a foot short (gap 0.253),
      // which is what "the bite doesn't reach" looked like.
      //
      // This angle is only reachable because the hinge sits forward at z=-0.5.
      // Re-measure after ANY change to the pivot or the part map: with the
      // pivot back at z=+0.54 the arc missed the front entirely and NO angle
      // could reach it (closest 0.132 short), which sent a previous attempt off
      // into translating the whole assembly. Check the number before assuming
      // rotation is not enough.
      fireAngle: -1.17, // GLB jaw baked OPEN (=rest); full stroke clamps onto the front slope
      budgetCap: 90,
      dims: { x: 0.1523, y: 0.4244, z: 0.8488 },
      // MEASURED: the hinge is the white circular boss at the BOTTOM of the
      // beak — the shield over the axle — not the point up the casting that
      // segmentation wrote, where the beak scissors about its own middle
      // instead of biting. The grey block beside it is the hydraulic ram; the
      // scan resolved it as a stub, so it is rebuilt as a cylinder pushing up
      // and forward into the beak from behind the hinge.
      pivotFromCatalog: true,
      pivot: { x: 0, y: 1.03, z: -0.5 },
      arms: [
        { x: 0, radius: 0.13, attach: "body", from: { y: 0.5, z: 0.42 }, to: { y: 1.14, z: -0.24 }, color: "#9aa1ab" },
      ],
      axis: { x: 1, y: 0, z: 0 },
      tuning: { holdDamagePerSecond: 6, holdReach: 1.1, holdStrength: 14, holdDamping: 1, holdImpulseCap: 70 },
    },
    colliders: [
      // Wedge height is NOT the reason the bite used to slip: measured at rest
      // its underside sits 0.035ft off the deck, and dropping it further just
      // parks the chassis on the wedge and unloads the suspension probes
      // (2s of full throttle moved 0.13ft instead of 19ft).
      // A WEDGE, and the comment above it always said so — it was a box. The
      // lower jaw is a broad black scoop running the full width of the nose from
      // a knife edge on the floor up to the mouth, and it is how a crusher gets
      // anything into that mouth: the bot has to come UP the plow. As a box it
      // was a 0.53ft step that opponents bounced off. Base moved to the floor,
      // which is what a plow's edge does; the top is where it was.
      // Base at 0.09 rather than on the floor: Quantum rests lower than most of
      // the roster and a plow edge at y=0 scrapes through it (see the note above
      // about parking the chassis on its own wedge).
      { shape: "wedge", halfExtents: { x: 1.1002, y: 0.28, z: 0.8129 }, offset: { x: 0, y: 0.37, z: -1.0011 }, tipY: 0.02 },
      { shape: "box", halfExtents: { x: 1.0022, y: 0.1284, z: 0.9739 }, offset: { x: 0, y: 0.2253, z: 0.4951 } },
      { shape: "box", halfExtents: { x: 1.0338, y: 0.2394, z: 0.925 }, offset: { x: 0, y: 0.5659, z: 0.2721 } }, // merged mid+rear decks
    ],
  },

  hypershock: {
    id: "hypershock",
    canDriveInverted: true, // big exposed wheels reach the floor upside down
    name: "Hypershock",
    tagline: "Fastest thing in the box. Blink and it's behind you.",
    referenceImage: "./public/reference/hypershock.png",
    modelPath: "./public/models/hypershock.glb",
    modelYaw: Math.PI, // GLB authoring facing -> game -Z forward
    // Auto footprint scale distorts badly here (Tripo model is long+narrow,
    // v1 bodyDims wide+short: auto -> 4.6ft long vs 2.26ft collider). Match
    // the collider footprint instead: 2.35 -> ~1.4ft x 2.35ft.
    modelScale: 3.76,
    // --- the real machine ---------------------------------------------
    // Single 2.5in S7 disk 39.7lb; dual-disk options 40lb and 46lb. The GLB is
    // proportionally too narrow, so this one is scaled between its width and
    // its length rather than on width alone.
    realWorld: {
      team: "Team HyperShock", from: "Miami, FL",
      weightLbs: 250, // 238-250lbs
      topSpeedMph: 28, topSpeedSource: "team-stated",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 2.28, lengthFt: 3.76, heightFt: 1.04, source: "class-estimate" },
      weapon: { name: "Vertical spinner", weightLbs: 40, tipSpeedMph: null, rpm: null },
      drive: "2x NeuMotor 8038", power: "6x 8S 3Ah LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 43,
    // The v1 fit (3.25x1.55x2.35 * 1.2 = 3.9x1.86x2.82) does not describe THIS
    // bot: its fitted colliders span 1.38x0.69x2.45 and the model at
    // modelScale 2.35 is 1.43x0.65x2.35. bodyDims only feeds inertia, damage
    // zones and placeholders, so the stale figure showed up as roll inertia
    // ~7x too high on a 1.28ft track — a slow underdamped wallow every time you
    // turned. Matched to the collider shell instead.
    bodyDims: { x: 2.4, y: 1.36, z: 4 },
    // Four equal wheels sit at one height; the 0.15/0.18 split was fit noise
    // and left the rear springs statically under-compressed, adding a pitch
    // bias on top of the roll.
    wheelAnchors: [
      { x: -1.024, y: 0.21, z: -0.64 },
      { x: 1.024, y: 0.21, z: -0.64 },
      { x: -1.024, y: 0.21, z: 1.28 },
      { x: 1.024, y: 0.21, z: 1.28 },
    ],
    maxSpeedFps: mph(16.24), // 23.82 fps
    accel: 6,
    turnRate: 1.12,
    accent: "#7ad114",
    accentDark: "#1c2410",
    weapon: {
      type: "drum",
      spinUpSeconds: 2.1,
      inertia: 1.05,
      maxOmega: 650,
      budgetCap: 130,
      radius: 0.704,
      dims: { x: 0.8, y: 0.704, z: 0.704 },
      pivot: { x: 0, y: 0.608, z: -1.104 },
      axis: { x: 1, y: 0, z: 0 },
      tuning: { efficiency: 0.52, impulseScale: 8.5, liftScale: 30.0, liftVelocity: 4.5, liftClearance: 0.88, gyroScale: 0.85, damageScale: 0.87 },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 1.1056, y: 0.3408, z: 1.5088 }, offset: { x: -0.0016, y: 0.4864, z: 0.4032 } },
      { shape: "wedge", halfExtents: { x: 1.1056, y: 0.336, z: 0.288 }, offset: { x: -0.0016, y: 0.336, z: -1.6 }, tipY: 0.048 }, // front wedge (MEASURED slope)
      { shape: "box", halfExtents: { x: 1.1056, y: 0.2128, z: 0.2128 }, offset: { x: -0.0016, y: 1.0416, z: -0.512 } }, // fin rail
    ],
  },

  minotaur: {
    id: "minotaur",
    // Drum and wedge are symmetric about the deck, so it keeps driving on its
    // back — the wheels are the same wheels, and steering mirrors with them.
    canDriveInverted: true,
    name: "Minotaur",
    tagline: "The drum never stops. Neither does it.",
    referenceImage: "./public/reference/minotaur.png",
    modelPath: "./public/models/minotaur.glb",
    modelYaw: Math.PI / 2, // GLB authoring facing -> game -Z forward
    // --- the real machine ---------------------------------------------
    // Drum 60-70lb depending on configuration; 12,000rpm originally, cut to
    // 11,000 and later 9,000 to stay under the 250mph tip-speed limit.
    realWorld: {
      team: "Team RioBotz", from: "Rio de Janeiro, Brazil",
      weightLbs: 250, // 230-250lbs
      topSpeedMph: 17, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 3, lengthFt: 3.21, heightFt: 1.03, source: "class-estimate" },
      weapon: { name: "Drum spinner", weightLbs: 70, tipSpeedMph: 250, rpm: 12000 },
      drive: "2x Scorpion outrunner (weapon)", power: "MaxAmps LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 70,
    bodyDims: { x: 3.3999, y: 1.3114, z: 2.7847 }, // scaled to realWorld.size.widthFt
    wheelAnchors: [
      { x: -0.9714, y: 0.21, z: -0.4857 },
      { x: 0.9714, y: 0.21, z: -0.4857 },
      { x: -0.9714, y: 0.21, z: 0.9714 },
      { x: 0.9714, y: 0.21, z: 0.9714 },
    ],
    maxSpeedFps: mph(9.86), // 14.46 fps
    accel: 7.9,
    turnRate: 0.98,
    accent: "#b06a3a",
    accentDark: "#17181c",
    weapon: {
      type: "drum",
      spinUpSeconds: 1.8,
      inertia: 1.15,
      maxOmega: 1200,
      budgetCap: 130,
      // The drum measures 0.24 through the loader, but the scan smooths off the
      // outward notches that do the real work, so the collider is deliberately
      // generous — 0.34 gives it the bite the teeth should have.
      radius: 0.5505,
      dims: { x: 0.6314, y: 0.5505, z: 0.5505 },
      pivot: { x: 0, y: 0.4371, z: -0.9066 },
      axis: { x: 1, y: 0, z: 0 },
      tuning: { efficiency: 0.26, impulseScale: 4.4, kickbackScale: 0.12, liftScale: 18.0, liftVelocity: 4.0, liftClearance: 0.5666, gyroScale: 1.45, damageScale: 0.62 },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 1.1106, y: 0.2639, z: 1.1236 }, offset: { x: -0.0016, y: 0.4387, z: 0.2299 } },
      { shape: "box", halfExtents: { x: 0.2623, y: 0.4145, z: 0.7885 }, offset: { x: -0.9714, y: 0.4145, z: 0.2704 } }, // left pod
      { shape: "box", halfExtents: { x: 0.2623, y: 0.4145, z: 0.884 }, offset: { x: 0.9698, y: 0.4145, z: 0.1749 } }, // right pod
      { shape: "wedge", halfExtents: { x: 0.9066, y: 0.2428, z: 0.1619 }, offset: { x: 0, y: 0.2428, z: -1.4409 }, tipY: 0.0486 }, // fork row (MEASURED slope)
    ],
  },

  sawblaze: {
    id: "sawblaze",
    name: "Sawblaze",
    tagline: "Scoop, trap, and bring the saw down.",
    referenceImage: "./public/reference/sawblaze.png",
    modelPath: "./public/models/sawblaze.glb",
    modelYaw: Math.PI / 2, // GLB authoring facing -> game -Z forward
    // --- the real machine ---------------------------------------------
    realWorld: {
      team: "Team SawBlaze", from: "Cambridge, MA",
      weightLbs: 250,
      topSpeedMph: 12, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 2.8, lengthFt: 2.71, heightFt: 2.03, source: "class-estimate" },
      weapon: { name: "Hammer saw + flamethrower", weightLbs: null, tipSpeedMph: null, rpm: null },
      drive: "2x T&P brushless", power: "MaxAmps 14.4v 13.5Ah LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 30,
    bodyDims: { x: 3.1218, y: 2.1613, z: 2.4014 }, // scaled to realWorld.size.widthFt
    wheelAnchors: [
      { x: -0.6604, y: 0.21, z: -0.9005 }, // front skids under the pan
      { x: 0.6604, y: 0.21, z: -0.9005 },
      { x: -1.1407, y: 0.33, z: 0.8765 }, // rear drive wheels
      { x: 1.1407, y: 0.33, z: 0.8765 },
    ],
    maxSpeedFps: mph(6.96), // 10.21 fps
    accel: 7.5,
    turnRate: 1.0,
    accent: "#24b04c",
    accentDark: "#15161a",
    weapon: {
      type: "hammerSaw",
      spinUpSeconds: 2.4, // saw disc spin-up (v1)
      inertia: 0.7,
      maxOmega: 880,
      budgetCap: 60, // swing-impulse cap (v2 estimate; v1 saw-touch cap was 10)
      radius: 0.5523,
      // Whole arc rotated ~18deg back from the v1 numbers (1.7 / -0.85): at the
      // old fireAngle the saw's rim swung to 0.09ft BELOW the floor plane and
      // disappeared into it at the bottom of every chop.
      restAngle: 2.02, // rest: arm raked back past vertical, saw hanging behind (GLB baked pose is mid-swing)
      fireAngle: -0.53, // full stroke chops down-forward into the fork zone, rim stopping just above the floor
      dims: { x: 0.1081, y: 0.5523, z: 0.5523 }, // saw disc at arm tip
      pivot: { x: 0, y: 1.3208, z: 0.4202 }, // arm hinge, rear-top; saw center ~(0,0.93,-0.52)
      axis: { x: 1, y: 0, z: 0 },
      tuning: { sawTouchCap: 10, sawCenter: { x: 0, y: 1.1227, z: -0.6244 }, swingSeconds: 0.35, grindDamagePerSecond: 5, gyroScale: 0.8 },
    },
    colliders: [
      { shape: "wedge", halfExtents: { x: 1.2283, y: 0.2221, z: 0.2582 }, offset: { x: 0, y: 0.2221, z: -1.0266 }, tipY: 0.036 }, // front wedge (MEASURED slope)
      { shape: "box", halfExtents: { x: 1.2283, y: 0.1717, z: 0.9846 }, offset: { x: 0, y: 0.2714, z: 0.2161 } }, // merged pan floor
      { shape: "box", halfExtents: { x: 1.2115, y: 0.1849, z: 0.6088 }, offset: { x: 0.006, y: 0.6364, z: 0.5691 } },
      { shape: "box", halfExtents: { x: 0.3398, y: 0.3938, z: 0.5655 }, offset: { x: -0.0372, y: 1.406, z: -0.1969 } }, // tower
    ],
  },

  tombstone: {
    id: "tombstone",
    canDriveInverted: true, // flat slab, bar clear of the deck either way up
    name: "Tombstone",
    tagline: "The bar. You know the bar.",
    referenceImage: "./public/reference/tombstone.png",
    modelPath: "./public/models/tombstone.glb",
    modelYaw: Math.PI / 2, // GLB authoring facing -> game -Z forward
    // --- the real machine ---------------------------------------------
    // Bar 65-75lb across builds; the 2in aluminium blade is 71lb and was
    // clocked at 235mph against the 250mph cap. The bar IS the machine's
    // width, which is what the game scales to.
    realWorld: {
      team: "Hardcore Robotics", from: "Placerville, CA",
      weightLbs: 250,
      topSpeedMph: 11, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 3.9, lengthFt: 2.93, heightFt: 1.29, source: "class-estimate" },
      weapon: { name: "Horizontal bar spinner", weightLbs: 71, tipSpeedMph: 235, rpm: null },
      drive: "2x Maytech 8085 brushless outrunner", power: "8S 5.8Ah LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 80,
    bodyDims: { x: 3.8769, y: 1.4177, z: 2.9511 }, // scaled to realWorld.size.widthFt
    wheelAnchors: [
      { x: -0.7233, y: 0.1955, z: -0.7956 }, // front blade-support skids
      { x: 0.7233, y: 0.1955, z: -0.7956 },
      { x: -1.5189, y: 0.3355, z: 0.5208 }, // rear tires
      { x: 1.5045, y: 0.3355, z: 0.5208 },
    ],
    maxSpeedFps: mph(6.38), // 9.36 fps
    accel: 5.8,
    turnRate: 0.78,
    accent: "#c0392b",
    accentDark: "#232323",
    weapon: {
      type: "bar",
      spinUpSeconds: 3.0,
      inertia: 1.2,
      maxOmega: 338,
      budgetCap: 500,
      radius: 1.9659, // MEASURED swept radius (bbox guess was 1.21)
      dims: { x: 1.9659, y: 0.1736, z: 0.434 }, // horizontal bar, spins around Y
      pivot: { x: 0, y: 0.3183, z: -1.0416 },
      axis: { x: 0, y: 1, z: 0 },
      tuning: {
        efficiency: 0.86, impulseScale: 18.0, kickbackScale: 1.45, liftScale: 7.0, liftVelocity: 4.5, liftClearance: 0.7956,
        gyroScale: 1.35, reach: 3.2549, impactScale: 1.55, damageScale: 0.92,
        floorLaunch: { enabled: true, angleDeg: 30, scale: 1.15, cap: 180 },
      },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 1.0242, y: 0.4094, z: 0.8058 }, offset: { x: -0.0362, y: 0.6336, z: 0.6148 } },
      { shape: "box", halfExtents: { x: 0.5295, y: 0.191, z: 0.868 }, offset: { x: -0.0362, y: 0.7942, z: -0.5034 } }, // front spine
      { shape: "box", halfExtents: { x: 0.4123, y: 0.57, z: 0.6944 }, offset: { x: -1.5204, y: 0.5627, z: 0.5251 } }, // left tire block
      { shape: "box", halfExtents: { x: 0.4195, y: 0.5714, z: 0.7088 }, offset: { x: 1.503, y: 0.5569, z: 0.5251 } }, // right tire block
    ],
  },

  beta: {
    id: "beta",
    name: "Beta",
    tagline: "Comes in from the top.",
    referenceImage: "./public/reference/beta.png",
    modelPath: "./public/models/beta.glb",
    modelYaw: Math.PI, // MEASURED: model faces +Z, game wants -Z
    // The auto footprint fit is skewed by the hammer overhanging the tail; 2.9
    // sizes the SHELL to the real robot's 82cm x 80cm instead.
    modelScale: 3.034,
    // Beta's wheels live inside the shell and did not segment out, so the
    // procedural fallback would poke cylinders through the bodywork.
    hideWheels: true,
    // --- the real machine ---------------------------------------------
    // 16lb bladed head; the original alloy head was ~24lb with neodymium
    // magnets for downforce.
    realWorld: {
      team: "Team Hurtz", from: "Oxfordshire, UK",
      weightLbs: 250,
      topSpeedMph: 12, topSpeedSource: "team-stated",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 2.9, lengthFt: 3.03, heightFt: 2.36, source: "class-estimate" },
      weapon: { name: "Hammer", weightLbs: 16, tipSpeedMph: null, rpm: null },
      drive: "2x Maytech 6880 brushless", power: "12S LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 24, // 11 kg head
    bodyDims: { x: 2.898, y: 1.1404, z: 2.605 }, // MEASURED shell, then scaled to realWorld.size.widthFt, then scaled to realWorld.size.widthFt
    wheelAnchors: [
      { x: -0.9939, y: 0.21, z: -0.8893 },
      { x: 0.9939, y: 0.21, z: -0.8893 },
      { x: -0.9939, y: 0.21, z: 0.68 },
      { x: 0.9939, y: 0.21, z: 0.68 },
    ],
    maxSpeedFps: mph(6.96), // 10.21 fps
    accel: 7.0,
    turnRate: 0.95,
    accent: "#b9bcc0",
    accentDark: "#17181c",
    weapon: {
      type: "hammer",
      pivot: { x: 0.0418, y: 0.9102, z: -0.4289 }, // MEASURED gearbox hinge, game space
      axis: { x: 1, y: 0, z: 0 },
      restAngle: 0, // GLB is baked cocked: head up and back over the tail
      // MEASURED through the loader (game space, model grounded): at -2.72 the
      // head bottoms out 0.05ft above the floor, ~1ft past the nose; a shade
      // further and it digs in. Negative because modelYaw PI flips the model's
      // lateral axis relative to the catalog's +X convention.
      fireAngle: -2.72,
      budgetCap: 320, // heavy single impact
      dims: { x: 0.1674, y: 0.5231, z: 0.1674 },
      downforce: 120, // lbf of magnet, held on while grounded
      reactionScale: 0.15, // magnets eat the strike reaction
      selfRightRate: 5.5, // rad/s of pitch when fired while inverted
      tuning: { strokeSeconds: 0.22, returnSeconds: 0.9, reach: 1.8832 },
    },
    colliders: [
      // Truncated pyramid, four stacked slabs (MEASURED y-slices of the shell).
      { shape: "wedge", halfExtents: { x: 1.3601, y: 0.2354, z: 0.34 }, offset: { x: 0, y: 0.2354, z: -0.9677 }, tipY: 0.0314 }, // front wedge (MEASURED slope)
      { shape: "box", halfExtents: { x: 1.3601, y: 0.1465, z: 0.7742 }, offset: { x: 0, y: 0.1465, z: 0.1465 } },
      { shape: "box", halfExtents: { x: 0.9939, y: 0.1674, z: 1.0462 }, offset: { x: 0, y: 0.4603, z: -0.0523 } },
      { shape: "box", halfExtents: { x: 0.6277, y: 0.136, z: 0.7323 }, offset: { x: 0, y: 0.7637, z: -0.1569 } },
      { shape: "box", halfExtents: { x: 0.2616, y: 0.1255, z: 0.2092 }, offset: { x: 0, y: 1.0148, z: -0.3139 } }, // hammer gearbox
    ],
  },

  whiplash: {
    id: "whiplash",
    name: "Whiplash",
    tagline: "Lift them, then bury the disc.",
    referenceImage: "./public/reference/whiplash.png",
    modelPath: "./public/models/whiplash.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X, game wants -Z
    modelScale: 3.7696, // colliders below are authored at this scale
    // --- the real machine ---------------------------------------------
    realWorld: {
      team: "Team Fast Electric Robots", from: "Thousand Oaks, CA",
      weightLbs: 250,
      topSpeedMph: 15, topSpeedSource: "team-stated",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 2.9, lengthFt: 3.77, heightFt: 2.24, source: "class-estimate" },
      weapon: { name: "Lifter + arm-mounted disk", weightLbs: 22, tipSpeedMph: null, rpm: null },
      drive: "2x Mini Magmotor", power: null,
    },

    weightLbs: 250,
    weaponWeightLbs: 22, // the disc
    bodyDims: { x: 2.5997, y: 1.359, z: 3.6633 }, // MEASURED shell, then scaled to realWorld.size.widthFt, then scaled to realWorld.size.widthFt
    // Four exposed wheels, MEASURED from the GLB wheel pivots. Both pairs sit
    // in the rear half — the front of the chassis is all arm and forks.
    wheelAnchors: [
      { x: -1.2644, y: 0.21, z: -0.1654 },
      { x: 1.2644, y: 0.21, z: -0.1654 },
      { x: -1.2762, y: 0.21, z: 1.3235 },
      { x: 1.2762, y: 0.21, z: 1.3235 },
    ],
    maxSpeedFps: mph(8.70), // 12.76 fps // known for its driving
    accel: 8.5,
    turnRate: 1.1,
    accent: "#d8e021",
    accentDark: "#141414",
    weapon: {
      type: "lifterDisc",
      pivot: { x: 0, y: 1.0399, z: 1.6544 }, // MEASURED rear hinge, game space
      axis: { x: 1, y: 0, z: 0 }, // part-map axis is [0,0,1] pre-yaw
      // MEASURED through the loader (game space, model grounded): at -0.52 the
      // arm's fork plate lies flat on the deck pointing straight ahead, which
      // is the pose it scoops from; +1.0 stands the arm up with the disc
      // overhead. The earlier -0.56 came from Box3.setFromObject, which reports
      // the AABB of the arm's ROTATED AABB and so reads up to 0.7ft low on a
      // pitched arm — measure the transformed vertices instead.
      restAngle: -0.52,
      fireAngle: 1.0,
      lowerSeconds: 0.65,
      liftImpulse: 150, // enough to tip a 250 lb opponent, spread over the stroke
      liftRecoil: 0.5,
      dims: { x: 0.1654, y: 0.4963, z: 0.4963 },
      disc: {
        spinUpSeconds: 1.4,
        maxOmega: 380,
        inertia: 0.55,
        budgetCap: 90, // moderate per-hit; damage comes from repetition
        contactDamagePerSecond: 14,
      },
      tuning: { strokeSeconds: 0.5, reach: 1.7725, hapticScale: 1.2 },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 1.2408, y: 0.3368, z: 1.5126 }, offset: { x: 0, y: 0.4136, z: 0.3781 } }, // chassis
      { shape: "box", halfExtents: { x: 0.6263, y: 0.3309, z: 0.5318 }, offset: { x: 0, y: 1.0517, z: 1.2408 } }, // arm tower
      { shape: "wedge", halfExtents: { x: 0.6972, y: 0.1536, z: 0.4077 }, offset: { x: 0, y: 0.1536, z: -1.483 }, tipY: 0.0355 }, // fork plate (MEASURED slope)
    ],
  },

  clawviper: {
    id: "clawviper",
    name: "Claw Viper",
    tagline: "Grab, lift, suplex.",
    referenceImage: "./public/reference/clawviper.png",
    modelPath: "./public/models/clawviper.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X (weaponAxis [0,0,1] pre-yaw)
    modelScale: 4.2106, // colliders below are authored at this scale
    // --- the real machine ---------------------------------------------
    realWorld: {
      team: "Team Bad Ideas", from: "Seattle, WA",
      weightLbs: 250, // ~238lbs in WC V
      topSpeedMph: 20, topSpeedSource: "published",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 2.9, lengthFt: 4.21, heightFt: 2.38, source: "class-estimate" },
      weapon: { name: "Lifter + grappler", weightLbs: null, tipSpeedMph: null, rpm: null },
      drive: "4x RV-120E brushless", power: null,
    },

    weightLbs: 250,
    weaponWeightLbs: 40,
    bodyDims: { x: 2.8948, y: 1.1842, z: 3.8158 }, // MEASURED shell, then scaled to realWorld.size.widthFt
    // Both wheel pairs sit in the rear half — the front is all forks.
    wheelAnchors: [
      { x: -1.0263, y: 0.2495, z: 0.0789 },
      { x: 1.0263, y: 0.2495, z: 0.0789 },
      { x: -1.0263, y: 0.2495, z: 1.7632 },
      { x: 1.0263, y: 0.2495, z: 1.7632 },
    ],
    maxSpeedFps: mph(11.60), // 17.01 fps // weapon-class motor on every wheel
    accel: 14,
    turnRate: 1.15,
    accent: "#3355cc",
    accentDark: "#141414",
    weapon: {
      type: "grappler",
      // MEASURED: the lifter's axle is the boss pair at the back of the arm's
      // rear web (raw parts 8/13), not the front of the chassis.
      pivot: { x: 0, y: 0.7645, z: 0.8026 }, // game space, via the loader
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED through the loader (game space, model grounded). The baked
      // pose already has the forks flat on the deck, and the arm lifts on
      // POSITIVE angle here — the drop's -2.1 drove the forks under the floor.
      restAngle: 0, // forks flat on the deck — they are also the wedge
      liftAngle: 1.5, // ~86deg: past vertical for the suplex, arm still clear of the floor
      liftSeconds: 0.7,
      lowerSeconds: 0.9,
      gripReach: 2.1053, // where a gripped bot rides: on the fork blades
      gripHeight: 0.5263,
      // 16 -> 26, with the cap raised to match. At 16 a gripped 250lb bot lagged
      // the fork tip by most of a foot through a turn and looked magnetised to
      // the air in front of it; the arm is a clamp, so what it holds should ride
      // where the forks are.
      gripStrength: 26,
      gripImpulseCap: 220,
      gripAngularDamping: 11, // and it should not loll about while it is up there
      throwScale: 0.6, // share of the arm's tip speed handed over on release
      downforceLbs: 250, // magnets: very hard to shove or flip
      dims: { x: 0.2632, y: 0.2632, z: 0.6579 },
      // MEASURED: at -0.9 the jaw shuts onto the red fork tip it grips against.
      claw: { openAngle: 0, closedAngle: -0.9, clampSeconds: 0.25 },
      // holdDamagePerSecond 0: the forks are blunt and holding is not an attack.
      // Claw Viper's damage comes from what it does WITH a bot it has picked up
      // — set it down on the screws, carry it into a wall, drop it from the top
      // of the lift — all of which the arena hazards and the impact router
      // charge for already.
      tuning: { reach: 1.8421, holdDamagePerSecond: 0 },
    },
    colliders: [
      // restAngle says the forks lie flat on the deck and that they ARE the
      // wedge — and then the front of the machine was a box, so nothing could
      // ride them. The first 1ft of that box is now the slope it always
      // described; the rest of the chassis is the box it was, starting where the
      // forks end.
      { shape: "wedge", halfExtents: { x: 1.3158, y: 0.3355, z: 0.5 }, offset: { x: 0, y: 0.3355, z: -0.9474 }, tipY: 0.02 },
      { shape: "box", halfExtents: { x: 1.3158, y: 0.3158, z: 1.2369 }, offset: { x: 0, y: 0.3553, z: 0.7895 } },
      { shape: "box", halfExtents: { x: 0.7895, y: 0.2105, z: 0.9211 }, offset: { x: 0, y: 0.8947, z: 0.7895 } },
    ],
  },

  deepsix: {
    id: "deepsix",
    name: "Deep Six",
    tagline: "Banned for hitting too hard.",
    referenceImage: "./public/reference/deepsix.png",
    modelPath: "./public/models/deepsix.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 4,
    // Splayed forks make it wider than it is long — that is the real machine.
    hideWheels: true, // 2WD tucked inside the shell; nothing segmented out
    // --- the real machine ---------------------------------------------
    // Published 4ft span — one of only three dimensions in this roster that
    // comes off a source rather than off the class. Bar was 110lb on debut,
    // cut to the 80lb weapon limit.
    realWorld: {
      team: "Team Overboard", from: "Norfolk, VA",
      weightLbs: 250,
      topSpeedMph: 13, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 4, lengthFt: 3.06, heightFt: 3.11, source: "published" },
      weapon: { name: "Vertical bar spinner", weightLbs: 80, tipSpeedMph: 207, rpm: null },
      drive: "2x Castle 2028 brushless", power: "3.4Ah 6S LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 80, // post-rule-change blade
    bodyDims: { x: 4, y: 2.0444, z: 3.0555 }, // MEASURED shell, then scaled to realWorld.size.widthFt
    // The outrigger forks ARE the support base, so the probes ride on them.
    wheelAnchors: [
      { x: -1.4444, y: 0.21, z: -1 },
      { x: 1.4444, y: 0.21, z: -1 },
      { x: -1.4444, y: 0.21, z: 1 },
      { x: 1.4444, y: 0.21, z: 1 },
    ],
    maxSpeedFps: mph(7.54), // 11.06 fps
    accel: 7.0,
    turnRate: 0.9,
    accent: "#b1642f",
    accentDark: "#141414",
    weapon: {
      type: "bar",
      pivot: { x: 0.0889, y: 1.8, z: -0.0222 }, // MEASURED hub, game space
      axis: { x: 1, y: 0, z: 0 },
      spinUpSeconds: 4.5, // enormous inertia: slow, dramatic spool-up
      spinDownSeconds: 0.8, // the new roster's HUGE — v1's rule for that bot
      inertia: 1.9,
      maxOmega: 420,
      budgetCap: 620, // the hardest hit in the game
      // MEASURED swept radius: the max perpendicular distance from the axle
      // over every blade vertex, NOT the bbox at the baked pose. The S-blade is
      // asymmetric, so its bbox reads 1.26 and undersized the collider until it
      // sat entirely inside the chassis and could not touch anything.
      radius: 1.52,
      dims: { x: 0.0667, y: 1.52, z: 1.52 },
      tuning: {
        efficiency: 0.62, impulseScale: 9.0, kickbackScale: 1.5, liftScale: 26.0,
        liftVelocity: 5.0, gyroScale: 2.2, impactScale: 1.2, damageScale: 1.16,
        // 80 lb of blade at 420 rad/s has to be felt through the sticks. At the
        // stock boost of 1 it moves him 0.0 degrees; 40 takes his lean under a
        // hard turn from 7.8 to 9.9 degrees and leaves the straight line intact.
        gyroBoost: 40,
        // Its own hits tumble it — the signature failure mode, and the reason
        // the biggest weapon in the game is not simply the best.
        ownerPitchScale: 2.4,
      },
    },
    // Deep Six is the ONE bot with no front collider of any kind, wedge
    // included. Its disc reaches furthest forward at its own axle height —
    // 1.62ft up, over everything in the game — so the low part of the sweep
    // only opens up around z=-0.9, and anything in front of that is a
    // stand-off. A wedge there is no better than a box: measured across nine
    // opponents charging head-on, a full-length outrigger wedge scores 0/9 and
    // a shortened one still scores 0/9, against 9/9 bare. The outriggers are
    // what hold the blade up, not something to shove with; opponents drive
    // over them, which is what the real machine's forks are for.
    // Cost: pitched hard nose-down the wedge plate clips the arena floor. Every
    // camera sits above the floor, so it is occluded.
    colliders: [
      { shape: "box", halfExtents: { x: 2, y: 0.2778, z: 0.8778 }, offset: { x: 0, y: 0.2778, z: 0.6555 } }, // chassis pan
      { shape: "box", halfExtents: { x: 0.5111, y: 0.7555, z: 0.3667 }, offset: { x: 0, y: 1.3111, z: 0.2556 } }, // blade tower
    ],
  },

  hydra: {
    id: "hydra",
    name: "Hydra",
    tagline: "Sends them to the ceiling.",
    referenceImage: "./public/reference/hydra.png",
    modelPath: "./public/models/hydra.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 3.7544,
    hideWheels: true, // drive is enclosed under a very low chassis
    // --- the real machine ---------------------------------------------
    realWorld: {
      team: "Team Whyachi", from: "Dorchester, WI",
      weightLbs: 250,
      topSpeedMph: 17, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 3, lengthFt: 3.75, heightFt: 1.6, source: "class-estimate" },
      weapon: { name: "Hydraulic flipper", weightLbs: null, tipSpeedMph: null, rpm: null },
      drive: "4x brushless", power: "LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 45,
    bodyDims: { x: 3.0149, y: 1.0467, z: 3.5838 }, // MEASURED shell, then scaled to realWorld.size.widthFt — very low and flat
    wheelAnchors: [
      { x: -1.1377, y: 0.21, z: -1.1377 },
      { x: 1.1377, y: 0.21, z: -1.1377 },
      { x: -1.1377, y: 0.21, z: 1.1377 },
      { x: 1.1377, y: 0.21, z: 1.1377 },
    ],
    maxSpeedFps: mph(9.86), // 14.46 fps
    accel: 9.0,
    turnRate: 1.1,
    accent: "#6b3fa0",
    accentDark: "#12141a",
    weapon: {
      type: "flipper",
      pivot: { x: 0, y: 0.7281, z: 0.8988 }, // MEASURED rear hinge, game space
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED through the loader (game space, model grounded): -0.55 is
      // where the plate's lip reaches the floor (arm low point -0.003), so it
      // rests as a wedge along the deck. The baked pose (0) is fired.
      restAngle: -0.55,
      fireAngle: 0,
      budgetCap: 520, // 450+ lb of flip
      dims: { x: 1.2515, y: 0.1024, z: 1.7066 },
      selfRight: true, // hydraulics only right it by firing against the floor
      tuning: { strokeSeconds: 0.1, returnSeconds: 4.0, reach: 2.1616, liftVelocity: 30.0 },
    },
    colliders: [
      { shape: "wedge", halfExtents: { x: 1.4221, y: 0.1365, z: 0.2617 }, offset: { x: 0, y: 0.1365, z: -1.5131 }, tipY: 0.0341 }, // front wedge (MEASURED slope)
      { shape: "box", halfExtents: { x: 1.4221, y: 0.2275, z: 1.5359 }, offset: { x: 0, y: 0.2275, z: 0.2844 } },
      { shape: "box", halfExtents: { x: 1.1377, y: 0.2958, z: 1.1377 }, offset: { x: 0, y: 0.7509, z: 0.6826 } },
    ],
  },

  // ---------------------------------------------------------------------
  // Nine-bot drop. Every number below marked MEASURED came off the model
  // through the loader in GAME space, not out of the drop's notes.
  // ---------------------------------------------------------------------

  blip: {
    id: "blip",
    name: "Blip",
    tagline: "Flywheel launcher. Straight to the ceiling.",
    referenceImage: "./public/reference/blip.png",
    modelPath: "./public/models/blip.glb",
    modelYaw: Math.PI, // MEASURED: forks came out at +Z, so +Z is the nose
    modelScale: 3.6461,
    // --- the real machine ---------------------------------------------
    // A 16lb flywheel at ~9,000rpm stores the energy the flip spends. Heaviest
    // mass flipped: 946lb.
    realWorld: {
      team: "Seems Reasonable Robotics", from: "Mountain View, CA",
      weightLbs: 250,
      topSpeedMph: 18, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 2.95, lengthFt: 3.65, heightFt: 1.53, source: "class-estimate" },
      weapon: { name: "Flywheel flipper", weightLbs: 16, tipSpeedMph: null, rpm: 9000 },
      drive: "2x TP5680 brushless", power: null,
    },

    weightLbs: 250,
    weaponWeightLbs: 40,
    bodyDims: { x: 2.951, y: 1.5268, z: 3.6461 }, // MEASURED shell, then scaled to realWorld.size.widthFt
    // Only the rear pair segmented out; the fronts are inboard under the deck.
    wheelAnchors: [
      { x: -1.0824, y: 0.21, z: -0.9685 },
      { x: 1.0824, y: 0.21, z: -0.9685 },
      { x: -1.0824, y: 0.21, z: 0.9685 },
      { x: 1.0824, y: 0.21, z: 0.9685 },
    ],
    maxSpeedFps: mph(10.44), // 15.31 fps
    accel: 9.5,
    turnRate: 1.1,
    accent: "#2f6fd0",
    accentDark: "#14161b",
    weapon: {
      type: "flipper",
      // MEASURED white axle across the top, game space. Not the lid's rear edge:
      // that is where this sat, two thirds of a foot BELOW the panel, so firing
      // swung the lid up and back off the body and opened its interior.
      pivot: { x: 0, y: 1.34, z: 1.065 },
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED through the loader: the plate is baked FLAT in the deck (0)
      // and 1.15 stands it on end. Blip throws straight up off a flywheel, so
      // there is no forward reach in the stroke — it is all elevation.
      restAngle: 0,
      fireAngle: 1.15,
      budgetCap: 200,
      dims: { x: 0.5241, y: 0.1139, z: 0.7292 },
      selfRight: true,
      tuning: { strokeSeconds: 0.06, returnSeconds: 0.7, reach: 1.7091, liftVelocity: 26.0, pitchVelocity: 11.0 },
    },
    colliders: [
      // The forks. MEASURED at y 0.17-0.32 in the model, but authored down to
      // the floor: on the real machine they scrape, and a fork a fifth of a foot
      // in the air is a fork nothing can climb.
      { shape: "wedge", halfExtents: { x: 0.7064, y: 0.1937, z: 0.5013 }, offset: { x: 0, y: 0.1937, z: -1.3217 }, tipY: 0.0342 },
      // The whole shell IS a wedge: MEASURED 0.53ft tall at z=-0.6 climbing to
      // 1.34 at the tail.
      { shape: "wedge", halfExtents: { x: 1.4698, y: 0.6836, z: 0.9115 }, offset: { x: 0, y: 0.6836, z: 0.2279 }, tipY: 0.3418 },
      { shape: "box", halfExtents: { x: 1.4698, y: 0.7634, z: 0.3418 }, offset: { x: 0, y: 0.7634, z: 1.4812 } },
    ],
  },

  copperhead: {
    id: "copperhead",
    name: "Copperhead",
    tagline: "Fifty pounds of copper drum.",
    referenceImage: "./public/reference/copperhead.png",
    modelPath: "./public/models/copperhead.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    // NO modelRoll. This one carried `Math.PI` for a long time and it was
    // wrong: the scan is the right way up, hex deck on top exactly as in the
    // reference. What made it look upside down was scan junk under the belly —
    // five whiskers and four drips reaching a foot below the pan — which
    // grounding rested on, so the machine hung in the air and rolling it put
    // the wheels back on the floor by accident. With the junk carved
    // (tools/repairs/copperhead-strays.json) roll 0 grounds on the fork tips.
    modelScale: 3.2498,
    canDriveInverted: true, // symmetrical drum bot; it fights either way up
    // --- the real machine ---------------------------------------------
    // 50lb single-toothed S7 tool steel drum; 160-180mph originally, dialled
    // back to 140mph for more bite.
    realWorld: {
      team: "Team Copperhead", from: "Denver, CO",
      weightLbs: 250,
      topSpeedMph: 15, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      // lengthFt/heightFt were read off the model BEFORE the repair: 3.22 was
      // the mirrored rear forks and 2.05 was a scan whisker. Re-measured
      // through the loader the machine is 2.19 long and 1.16 tall — 2.44 was
      // the rear scan lumps, gone with tools/repairs/copperhead-rear-flat.json,
      // and 1.23 was the tyres standing proud of the deck before
      // copperhead-wheels.json dropped them onto the floor.
      size: { widthFt: 3.25, lengthFt: 2.19, heightFt: 1.16, source: "class-estimate" },
      weapon: { name: "Eggbeater drum spinner", weightLbs: 50, tipSpeedMph: 180, rpm: null },
      drive: "2x Maytech MTO6365", power: "5Ah 6S LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 50,
    // MEASURED shell through the loader after the stray-geometry carve. The
    // old numbers were the pre-repair bbox: 1.428 tall was a whisker and
    // 3.2203 long was the mirrored rear fork pair. z came down again from
    // 2.4177 with copperhead-rear-flat.json — the last 0.22ft of "machine" was
    // the two scan lumps hanging off the back of the bottom pan.
    bodyDims: { x: 3.1188, y: 1.1141, z: 2.1928 },
    // MEASURED. Copperhead is 2WD: the tyres are a single pair at z=+0.48 and
    // the front of the machine rides on its fork skids, so the probes go where
    // the machine actually touches down rather than on a symmetric rectangle
    // (same shape as Tombstone's front-skid/rear-tyre set). y stays 0.2395 —
    // it is a probe origin against the fixed 0.45ft ray travel, not a length
    // that scales with the model. Every z here moved +0.1125 when the rear
    // lumps came off: the loader centres the body on its OWN bbox, so shortening
    // the back walks the whole machine forward under the rig.
    wheelAnchors: [
      { x: -1.1002, y: 0.2395, z: -0.8372 }, // front fork skids
      { x: 1.1002, y: 0.2395, z: -0.8372 },
      { x: -1.27, y: 0.2395, z: 0.4775 }, // rear tyres
      { x: 1.27, y: 0.2395, z: 0.4775 },
    ],
    maxSpeedFps: mph(8.70), // 12.76 fps
    accel: 8.0,
    turnRate: 1.0,
    accent: "#c1743a",
    accentDark: "#16181c",
    weapon: {
      type: "drum",
      // The drum is parts 14 + 901 and nothing else: segmentation had five
      // bearing blocks and a pulley spinning with it, which is what made the
      // weapon read as a lump rather than a drum. Its far end also came out of
      // the scan ragged, so the good half is mirrored across the axle — the
      // real drum is symmetric. See tools/repairs/copperhead-drum-mirror.json.
      // The TOOTH inside each pocket is a separate part and only the +X one
      // survived the scan; copperhead-drum-tooth.json mirrors it too, and it
      // stays in modelBody — it is axle-line hardware, not rotor.
      pivotFromCatalog: true,
      // MEASURED with rig-inspect --axle after the strays carve. Both the sign
      // of x (the roll used to mirror it) and z (removing the rear forks moved
      // the model's own centre back 0.40ft) moved with the repair; z moved
      // again, +0.1125, when copperhead-rear-flat.json shortened the back, and
      // y +0.0444 when copperhead-wheels.json dropped the tyres — grounding now
      // lands on a tyre rather than on the pan, so the whole machine rides that
      // much higher in its own frame.
      pivot: { x: -0.04, y: 0.5584, z: -0.296 },
      axis: { x: 1, y: 0, z: 0 },
      spinUpSeconds: 1.6,
      inertia: 1.25,
      maxOmega: 560,
      budgetCap: 340,
      radius: 0.423, // MEASURED swept radius of the drum alone
      dims: { x: 0.891, y: 0.5367, z: 0.5367 }, // half the MEASURED 1.782ft drum length
      tuning: { efficiency: 0.58, impulseScale: 10.5, liftScale: 30.0, liftVelocity: 4.5, gyroScale: 1.0 },
    },
    // NOTHING in front of z=-0.588, and the drum's sweep reaches z=-0.719, so
    // the blade stands 0.13ft proud of the chassis. The forks ahead of that
    // carry no collider at all: they sit at the drum's own height, so a solid
    // there would be a pure stand-off and opponents would stop on the fork
    // tips with the drum still short of them. Same call as Deep Six.
    // RE-DERIVED after copperhead-rear-flat.json: the box used to run
    // z[-0.70,1.15] on a body that ended at z=1.209; the body now ends at
    // 1.097 and everything moved forward 0.1125, so it runs z[-0.588,1.037].
    // The TOP rose 0.0444 with copperhead-wheels.json — the deck went up with
    // the rest of the machine when grounding moved onto the tyres — but the
    // BOTTOM stays at 0.100. It never hugged the pan anyway (the pan was at
    // 0.000 and is now at 0.044), and the box has to reach down near the floor:
    // the tyres carry the machine through the suspension probes, not through a
    // collider, so a chassis box lifted clear of the floor is a bot that rests
    // on nothing the physics can feel.
    colliders: [
      { shape: "box", halfExtents: { x: 1.5264, y: 0.529, z: 0.8123 }, offset: { x: 0, y: 0.629, z: 0.2248 } },
    ],
  },

  duck: {
    id: "duck",
    name: "Duck",
    tagline: "Never counted out.",
    referenceImage: "./public/reference/duck.png",
    modelPath: "./public/models/duck.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    // NO modelRoll. Duck's wheels really do stand proud of its deck — look at
    // the reference — so "wheels above the deck plane" is not the upside-down
    // tell it is on other bots, and rolling it put thewhite deck on the floor.
    modelScale: 3.4999,
    // --- the real machine ---------------------------------------------
    // The plow is 3/4in steel and weighs 50lb — it is the widest part of the
    // machine, which is what the game scales to.
    realWorld: {
      team: "Team Black and Blue", from: "Palo Alto, CA",
      weightLbs: 250,
      topSpeedMph: 14, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 3.5, lengthFt: 2.88, heightFt: 0.76, source: "class-estimate" },
      weapon: { name: "Lifting plow", weightLbs: 50, tipSpeedMph: null, rpm: null },
      drive: "4x Maytech 65162 brushless", power: null,
    },

    weightLbs: 250,
    weaponWeightLbs: 35,
    bodyDims: { x: 2.6749, y: 0.7666, z: 2.2916 }, // MEASURED shell, then scaled to realWorld.size.widthFt — very flat
    wheelAnchors: [
      { x: -1.2083, y: 0.21, z: -0.7916 },
      { x: 1.2083, y: 0.21, z: -0.7916 },
      { x: -1.2083, y: 0.21, z: 0.9416 },
      { x: 1.2083, y: 0.21, z: 0.9416 },
    ],
    maxSpeedFps: mph(8.12), // 11.91 fps
    accel: 7.5,
    turnRate: 0.95,
    accent: "#d8b62c",
    accentDark: "#1a1a1a",
    weapon: {
      type: "lifter",
      // MEASURED off the reference, not off the GLB. The plow rides on two long
      // carrier bars back to a hinge between the axles; swinging it about its
      // own lip — which is the pivot segmentation wrote — rotates the scoop in
      // place instead of reaching. The bars themselves are built procedurally,
      // because photogrammetry resolved two thin tubes as nothing at all.
      pivotFromCatalog: true,
      // MEASURED off the wheels, AFTER the re-grounding in
      // tools/repairs/duck-underfloor.json dropped the model 0.277ft onto its
      // tyres: hubs now sit at y=0.229 (front) and 0.243 (rear), and on the
      // real machine the carrier bars run straight through that line into a
      // block between them.
      pivot: { x: 0, y: 0.233, z: 0.34 },
      // EVERY NUMBER BELOW IS PER SIDE, and it has to be: the scan is not
      // symmetric about the model origin. normalizeScene centres the model on
      // the BODY bounding box, which the wide front bodywork dominates, so the
      // chassis proper ends up offset — its side walls measure +0.843 and
      // -1.166, and its tyres reach +1.127 and -1.451. A single mirrored x
      // therefore cannot be right on both sides, and the old symmetric +-1.38
      // was wrong in two different ways at once: on the +x side the bar hung
      // outboard of everything in open air, on the -x side it ran straight
      // through the middle of both tyres.
      // Those tyre numbers came in by 0.147 a side when
      // tools/repairs/duck-rear-tyres.json narrowed the rear pair. The scan
      // built the rear tyres twice as wide as the front pair and 0.147 further
      // out, and since the lifter swings back over the rear wheels the bars
      // had to stand clear of THAT — which left them a fifth of a foot outboard
      // of the wheels they actually run beside, on brackets that had to reach
      // that far to hold them. One tyre line for all four wheels is what lets
      // the bars sit against the wheel.
      arms: [
        // The MOUNTING BOXES. Each is flush against the chassis flank on its
        // inboard face — MEASURED in the hub band over z 0.05..0.66 at +0.8431
        // and -1.1655, and the box is set 0.003 INTO that so the two surfaces
        // are never coplanar (a scan wall and a flat box face landing on the
        // same plane z-fight) — and reaches 0.146ft past that side's outermost
        // tyre (+x 1.127 -> 1.273, -x -1.451 -> -1.597), a little more than the
        // 0.10ft diameter of the bar it carries, so the bar has somewhere to
        // sit outboard of the wheel. Both come out ~0.43 wide, which is the
        // check that the two sides really are the same bracket: the machine is
        // symmetric about its own chassis, only not about the model origin.
        // z 0.66..0.06 threads the gap between the front tyres (z max -0.023)
        // and the rear (z min 0.692). attach: "body" — part of the frame, it
        // stays put while the arm swings.
        { x: -1.3798, shape: "box", width: 0.4345, height: 0.2, attach: "body",
          from: { y: 0.233, z: 0.66 }, to: { y: 0.233, z: 0.06 }, color: "#c3c7cc" },
        { x: 1.0566, shape: "box", width: 0.4329, height: 0.2, attach: "body",
          from: { y: 0.233, z: 0.66 }, to: { y: 0.233, z: 0.06 }, color: "#c3c7cc" },
        // The CARRIER BARS, at the outboard END of their own box: the bar's
        // outer face lands 0.006 short of the end of the bracket (flush, but
        // NOT coplanar — the bar's rear 0.3ft lives inside the box, and two
        // faces on the same plane put a z-fighting disc on the outside of the
        // bracket) and its inner face stands 0.04ft clear of the tyre — 0.040
        // off the -x pair at -1.451 and 0.041 off the +x pair at 1.127, which
        // is the same bar-to-wheel gap front and rear now that all four tyres
        // share one outer face. Nothing else is out here: counted with
        // glb-carve over the shipped GLB, the body has no triangle outboard of
        // x 1.16 in the bar's height band and none at all above it, so the bar
        // rises through clear air, and the -x side has nothing outboard of
        // -1.487 to begin with. Forward they run to the plow's rear surface
        // MEASURED at that bar's own x in the bar's own height band (a wall at
        // -1.083 on the -x side, -1.089 on the +x, found by counting plow
        // triangles aft of a plane in the bar's own 0.1ft column): the bars
        // stop 0.003 INTO it, so the end of the cylinder lands ON the panel,
        // not short of it and not buried through it. Aft they stop 0.02 behind
        // the hinge, so the cap turns on the spot inside the bracket.
        { x: -1.541, radius: 0.05, from: { y: 0.233, z: 0.36 }, to: { y: 0.233, z: -1.086 }, color: "#b9bdc4" },
        { x: 1.217, radius: 0.05, from: { y: 0.233, z: 0.36 }, to: { y: 0.233, z: -1.092 }, color: "#b9bdc4" },
      ],
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED: the scoop is baked DOWN and 1.1 stands it up over the nose.
      // That resting pose is why the front collider below is a wedge.
      // RE-MEASURED with `rig-inspect duck --arc "-0.010,0.006,0.002"` after
      // tools/repairs/duck-underfloor.json shaved the plow off at the tyre
      // line and dropped the machine 0.277ft onto its wheels: armYmin crosses
      // zero at -0.001 (-0.001 reads -0.001ft, 0.000 reads +0.002). The old
      // -0.118 was measured with the whole bot standing 0.277ft up on scan
      // junk, and applied to a grounded Duck it drove the lip through the
      // floor. Effectively the plow is baked resting flat now, which is what
      // a flat-shaved lip on a grounded machine means.
      restAngle: -0.001,
      // A full half turn from there, so the plow can be parked over the far
      // side of the body instead of only reaching forward. The arms sit
      // outboard of the TYRES (see the per-side numbers above) so they have
      // somewhere to go. An earlier note here blamed a lopsided scan for the
      // asymmetry; that was wrong. The chassis is symmetric — every tyre
      // stands 0.285ft proud of its own frame rail — and what is
      // off-centre is the model ORIGIN, because normalizeScene centres on the
      // body bounding box and Duck's wide front bodywork dominates it, putting
      // the chassis 0.161ft to -x of zero. That is why one mirrored x cannot
      // work and each side carries its own.
      fireAngle: 3.024,
      liftImpulse: 190,
      liftRecoil: 0.5,
      // Two-way arm: RT drives it up and back, RB drives it down and forward,
      // and it HOLDS wherever it is left. See game/weaponControls.js — a plain
      // lifter with this flag takes both channels as momentary directions
      // instead of "held = up, released = falls".
      twoWayArm: true,
      // Notably quicker than it was: the old 0.45s covered 0.6rad (1.3 rad/s),
      // this covers 3.14rad in 0.8s (3.9 rad/s). It has three times the travel
      // AND three times the speed, which is what makes placing it feel live.
      lowerSeconds: 0.7,
      dims: { x: 1.1666, y: 0.1, z: 0.4167 },
      selfRight: true,
      tuning: { strokeSeconds: 0.8, reach: 1.4166 },
    },
    colliders: [
      // The scoop at rest. RE-CHECKED against the grounded model: the plow now
      // measures z -1.689..-0.987 climbing from y 0.002 to 0.476, so the wedge
      // (z -1.692..-0.858, y 0..0.467) still wraps it — the flattest, longest
      // wedge in the game, which is the whole bot.
      //
      // ridesArm: the plow is on the ARM, so its solid has to swing with it.
      // Without this the collider stayed parked here while the plow was drawn
      // halfway over the roof, and bringing the arm down on an opponent passed
      // straight through them — the only thing that ever touched them was the
      // lift impulse's zone test, which is not something a player can see or
      // aim. Duck's arm reaches 173 degrees, so this is most of what the bot
      // does. Authored at REST, which is what the collider invariants in
      // tools/sim-tests.mjs measure; sim/weapons.js swings it from there.
      { shape: "wedge", halfExtents: { x: 1.3333, y: 0.2333, z: 0.4167 }, offset: { x: 0, y: 0.2333, z: -1.2749 }, tipY: 0.0167, ridesArm: true },
      // The chassis, MEASURED x -1.312..1.312, y 0.005..0.451, z -1.148..1.148.
      { shape: "box", halfExtents: { x: 1.3416, y: 0.2333, z: 1.0083 }, offset: { x: 0, y: 0.2333, z: 0.1417 } },
      // Hinge block. Its height came down from 0.767 to match the deck: that
      // number was authored when the model floated 0.277ft up on scan junk, and
      // once the bot sat down on its tyres it left a third of a foot of
      // invisible collider standing proud of the bodywork.
      { shape: "box", halfExtents: { x: 0.8333, y: 0.2333, z: 0.15 }, offset: { x: 0, y: 0.2333, z: -0.9416 } },
    ],
  },

  endgame: {
    id: "endgame",
    name: "Endgame",
    tagline: "Teardrop disc, and it never misses twice.",
    referenceImage: "./public/reference/endgame.png",
    modelPath: "./public/models/endgame.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 3.3,
    hideWheels: true, // drive is inboard; segmentation never saw a wheel
    // --- the real machine ---------------------------------------------
    // Disk options range 40-55lb; reaches 6,000rpm in under five seconds.
    realWorld: {
      team: "Team End Game", from: "Auckland, New Zealand",
      weightLbs: 250,
      topSpeedMph: 18, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 3.3, lengthFt: 2.24, heightFt: 1.71, source: "class-estimate" },
      weapon: { name: "Vertical spinner", weightLbs: 55, tipSpeedMph: null, rpm: 6000 },
      drive: "4x 6374-192kV", power: "2x 1.8Ah MaxAmps",
    },

    weightLbs: 250,
    weaponWeightLbs: 55,
    bodyDims: { x: 3.3, y: 1.7083, z: 2.2421 }, // MEASURED shell, then scaled to realWorld.size.widthFt
    wheelAnchors: [
      { x: -1.2618, y: 0.21, z: -0.6794 },
      { x: 1.2618, y: 0.21, z: -0.6794 },
      { x: -1.2618, y: 0.21, z: 0.6794 },
      { x: 1.2618, y: 0.21, z: 0.6794 },
    ],
    maxSpeedFps: mph(10.44), // 15.31 fps
    accel: 8.5,
    turnRate: 1.05,
    accent: "#e8502a",
    accentDark: "#191c24",
    weapon: {
      type: "drum",
      // The blade is tripo_part_20 — the DARK teardrop carrying the yellow
      // stripe. Segmentation filed a WHITE frame teardrop as the weapon
      // instead, so what spun was a piece of bodywork while the real blade sat
      // still; tools/repairs/endgame-weapon.json swaps them.
      // Axle and radius are the smallest circle that part sweeps, measured with
      // `rig-inspect --axle`: for a blade this shape the min-enclosing centre
      // IS the axle, and it lands 0.14ft off the bbox centre.
      pivotFromCatalog: true,
      pivot: { x: 0.006, y: 0.912, z: -0.268 },
      axis: { x: 1, y: 0, z: 0 },
      // v1's quickest wind-up was 1.8s. 0.9 sat so far under that the ramp was
      // over before the sound had finished; 1.4 keeps Endgame the fastest bot
      // on the roster without leaving v1's band.
      spinUpSeconds: 1.4,
      inertia: 1.4,
      maxOmega: 640,
      budgetCap: 400,
      radius: 0.471,
      dims: { x: 0.092, y: 0.471, z: 0.471 },
      tuning: { efficiency: 0.6, impulseScale: 11.5, liftScale: 30.0, liftVelocity: 5.0, gyroScale: 1.1 },
    },
    colliders: [
      // The two lettered forks, LEFT and RIGHT of the disc with a clear gap
      // between them: the disc sweeps down to y 0.04 and out to z -0.91, and
      // anything spanning the centreline there would hold opponents off it.
      { shape: "wedge", halfExtents: { x: 0.5824, y: 0.4077, z: 0.3882 }, offset: { x: -1.0677, y: 0.4077, z: -0.7279 }, tipY: 0.0485 },
      { shape: "wedge", halfExtents: { x: 0.5824, y: 0.4077, z: 0.3882 }, offset: { x: 1.0677, y: 0.4077, z: -0.7279 }, tipY: 0.0485 },
      { shape: "box", halfExtents: { x: 1.5335, y: 0.4853, z: 0.7279 }, offset: { x: 0, y: 0.4853, z: 0.3979 } },
    ],
  },

  freeshipping: {
    id: "freeshipping",
    name: "Free Shipping",
    tagline: "Forklift in front, flame out the back.",
    referenceImage: "./public/reference/freeshipping.png",
    modelPath: "./public/models/freeshipping.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 4.1993,
    // --- the real machine ---------------------------------------------
    realWorld: {
      team: "Team Special Delivery", from: "San Leandro, CA",
      weightLbs: 250, // 210lbs from WC VII
      topSpeedMph: 15, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 2.7, lengthFt: 4.2, heightFt: 1.97, source: "class-estimate" },
      weapon: { name: "Forklift lifter + flamethrowers", weightLbs: null, tipSpeedMph: null, rpm: null },
      drive: "brushless", power: null,
    },

    weightLbs: 250,
    weaponWeightLbs: 45,
    bodyDims: { x: 2.7049, y: 1.1116, z: 4.0141 }, // MEASURED shell, then scaled to realWorld.size.widthFt
    wheelAnchors: [
      { x: -1.0622, y: 0.21, z: -1.2351 },
      { x: 1.0622, y: 0.21, z: -1.2351 },
      { x: -0.9881, y: 0.21, z: 1.6427 },
      { x: 0.9881, y: 0.21, z: 1.6427 },
    ],
    maxSpeedFps: mph(8.70), // 12.76 fps
    accel: 8.0,
    turnRate: 1.0,
    accent: "#d94b2b",
    accentDark: "#17181b",
    weapon: {
      type: "lifter",
      pivot: { x: 0, y: 0.7781, z: 0.7534 }, // MEASURED mast hinge, game space
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED: the GLB bakes the mast RAISED, so rest is -0.455 (fork tips
      // on the floor at y 0.00) and 0.36 hoists them to 1.72ft — a forklift,
      // not a flipper. Both moved with tools/repairs/freeshipping-lifter.json:
      // widening the carriage and setting it back put the tines 0.19ft nearer
      // the hinge, which is 0.025rad of rest angle and 0.06rad of lift.
      restAngle: -0.455,
      fireAngle: 0.36,
      liftImpulse: 165,
      liftRecoil: 0.5,
      lowerSeconds: 0.7,
      dims: { x: 1.1039, y: 0.1482, z: 1.4821 }, // MEASURED fork carriage, post-repair
      selfRight: true,
      // The flamethrowers. Static geometry on the model, so they are a damage
      // cone on the alt channel rather than a rigged part: no shove, no
      // knockdown, just a steady burn on whatever is held in front.
      // Two nozzles on the front of the deck — the ones the yellow feed lines
      // run to (parts 6/16, whose forward ends stop at z=-0.18, x=+-0.64).
      // Body-local feet. MEASURED: the deck top over the nozzle column is
      // y=0.691, so the old y=0.78 hung the jet a tenth of a foot above the
      // bodywork and it lit up out of thin air; 0.66 starts it just inside the
      // deck so it comes out of the metal. `dir` is nearly flat — 4 degrees up,
      // where 10 threw the jet over the head of anything it was aimed at (the
      // puffs get their rise from buoyancy in effects.js, not from the aim).
      flame: {
        damagePerSecond: 9,
        reach: 3.9523,
        scale: 1.15,
        dir: { x: 0, y: 0.07, z: -1 },
        nozzles: [
          { x: -0.62, y: 0.66, z: -0.5 },
          { x: 0.62, y: 0.66, z: -0.5 },
        ],
      },
      tuning: { strokeSeconds: 0.5, reach: 2.2232 },
    },
    colliders: [
      // MEASURED wedge: the nose is on the floor at z=-1.62 and 0.54 tall by
      // z=-0.88. This is the cleanest wedge in the drop.
      { shape: "wedge", halfExtents: { x: 1.2598, y: 0.3335, z: 0.457 }, offset: { x: 0, y: 0.3335, z: -1.5439 }, tipY: 0.0247 },
      { shape: "box", halfExtents: { x: 1.1857, y: 0.4076, z: 0.7905 }, offset: { x: 0, y: 0.4076, z: -0.2964 } },
      { shape: "box", halfExtents: { x: 1.1486, y: 0.5558, z: 0.7658 }, offset: { x: 0, y: 0.5558, z: 1.2475 } },
    ],
  },

  mammoth: {
    id: "mammoth",
    name: "Mammoth",
    tagline: "Drive in if you dare.",
    referenceImage: "./public/reference/mammoth.png",
    modelPath: "./public/models/mammoth.glb",
    modelYaw: 0, // MEASURED: the disc end is the nose, and it starts at -Z
    // 3.0 makes Mammoth the tallest machine in the game while keeping its disc
    // usable. The disc hangs high on the truss — at this scale its sweep bottoms
    // out at y 1.16, which reaches every tall bot in the roster and nothing that
    // is built to go underneath. Bigger and it hits nobody; small enough to hit
    // everybody and it is not Mammoth any more.
    modelScale: 6.066,
    // --- the real machine ---------------------------------------------
    // The largest BattleBots competitor of the modern era: 8'9" long, 5'4"
    // wide, 6'3" tall on 13in foam-filled tyres. Scaled on width, the game
    // model lands at 5.33 x 4.88 x 6.07ft — width and height match, but the
    // GLB is proportionally far too short to reach 8'9".
    realWorld: {
      team: "Team Mammoth", from: "Baltimore, MD",
      weightLbs: 250,
      topSpeedMph: 22, topSpeedSource: "published",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 5.33, lengthFt: 8.75, heightFt: 6.25, source: "published" },
      weapon: { name: "Rotary lifting trunk", weightLbs: null, tipSpeedMph: null, rpm: null },
      drive: "2x RV-100", power: "MaxAmps LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 40,
    bodyDims: { x: 5.3381, y: 6.066, z: 4.8932 }, // MEASURED frame, then scaled to realWorld.size.widthFt
    wheelAnchors: [
      { x: -2.4264, y: 0.21, z: -1.8198 },
      { x: 2.4264, y: 0.21, z: -1.8198 },
      { x: -2.3455, y: 0.21, z: 1.1525 },
      { x: 2.3455, y: 0.21, z: 1.1525 },
    ],
    maxSpeedFps: mph(12.76), // 18.71 fps
    accel: 5.5,
    turnRate: 0.7,
    accent: "#8a5a2c",
    accentDark: "#1b1c20",
    weapon: {
      type: "bar",
      // The trunk disc was fused into the truss frame (part 23) and only a hub
      // cluster spun, which is why the weapon read as a chip off the edge of a
      // bar rather than a disc. tools/repairs/mammoth-rig.json cuts the disc
      // out with a cylinder about the spin axis; the axle below is the smallest
      // circle it sweeps. That file also hands parts 14 and 16 back to the
      // chassis — they were mapped as wheels, so a gearbox was rotating with
      // the tyres. tools/repairs/mammoth-bar.json then hands the two long
      // TRUNK ARMS (parts 23 and 30) to the weapon: they are the bar, they sit
      // opposite each other about the axle, and until that repair the hub
      // turned inside a bar that stood still.
      pivotFromCatalog: true,
      pivot: { x: -0.02, y: 3.317, z: -0.912 },
      axis: { x: 1, y: 0, z: 0 },
      spinUpSeconds: 2.4,
      spinDownSeconds: 0.9, // giant slow bar, so short of the 1.1s default
      inertia: 1.0,
      maxOmega: 300,
      budgetCap: 90,
      // MEASURED swept radius with the trunk arms attached: 3.012, weapon x
      // span [-0.765, 0.724] so the bar is 1.49ft thick and dims.x stays 0.74.
      // This is now the drawn geometry rather than a fudge — the hitbox used to
      // be 2.022 against a 0.428 hub because only the hub turned, and the two
      // numbers finally agree.
      //
      // The size is the point of the bot. The axle sits at y 3.317, above the
      // TOP of every collider stack in the roster, so a small radius meant
      // Mammoth swung over everything: measured over a full 40-second fight,
      // 0.6 landed 0 hits and 1.0 landed 7. At 3.012 the tip bottoms out at
      // y 0.305 — it reaches the floor, which is what a 6ft trunk on a 250lb
      // machine is supposed to do, and is why the wedge note below still holds
      // even though the blade no longer needs help to connect.
      radius: 3.012,
      dims: { x: 0.74, y: 3.012, z: 3.012 },
      // A displacement weapon: it throws opponents rather than cutting them, so
      // the lift is the largest in the game and the damage the smallest.
      tuning: { efficiency: 0.5, impulseScale: 9.0, liftScale: 46.0, liftVelocity: 7.0, gyroScale: 0.9, damageScale: 0.35 },
    },
    colliders: [
      // The nose is a RAMP, and it is the whole machine. Mammoth's disc hangs
      // at y 0.99-2.19, which is over the top of every collider stack in the
      // roster — measured, it landed exactly zero hits in a 40-second fight
      // with a short wedge. The frame is 1.85ft tall at z=-0.75, so the wedge
      // is authored to the frame rather than to the bottom bar: opponents ride
      // it up INTO the disc, which is the only way this weapon ever connects
      // and is what "drive in if you dare" is supposed to mean.
      { shape: "wedge", halfExtents: { x: 2.6286, y: 1.2536, z: 1.011 }, offset: { x: 0, y: 1.2536, z: -1.4154 }, tipY: 0.1011 },
      // Chassis stops at y 1.04 so the disc's lower sweep is clear.
      { shape: "box", halfExtents: { x: 2.669, y: 1.0514, z: 1.1121 }, offset: { x: 0, y: 1.0514, z: 0.4044 } },
      // Truss, sitting BEHIND the disc so the disc's leading face is exposed.
      { shape: "box", halfExtents: { x: 1.2536, y: 1.9816, z: 0.8088 }, offset: { x: 0, y: 4.0844, z: 0.1011 } },
      { shape: "box", halfExtents: { x: 1.7794, y: 0.7279, z: 0.4651 }, offset: { x: 0, y: 1.6783, z: 1.9816 } }, // rear outriggers
    ],
  },

  overhaul: {
    id: "overhaul",
    name: "Overhaul",
    tagline: "Grab it, lift it, hold it.",
    referenceImage: "./public/reference/overhaul.png",
    modelPath: "./public/models/overhaul.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 4.0109,
    // --- the real machine ---------------------------------------------
    realWorld: {
      team: "Equals Zero Robotics", from: "Atlanta, GA",
      weightLbs: 250, // 247lbs in Champions I
      topSpeedMph: 16, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 3.1, lengthFt: 4.01, heightFt: 2.21, source: "class-estimate" },
      weapon: { name: "Lifter + grabber", weightLbs: null, tipSpeedMph: null, rpm: null },
      drive: "2x 80mm brushless outrunner", power: "12S 6Ah LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 45,
    bodyDims: { x: 3.1032, y: 1.5621, z: 3.3459 }, // MEASURED shell, then scaled to realWorld.size.widthFt
    wheelAnchors: [
      { x: -1.2033, y: 0.23, z: -1.0027 },
      { x: 1.2033, y: 0.23, z: -1.0027 },
      { x: -1.2033, y: 0.21, z: 1.1294 },
      { x: 1.2033, y: 0.21, z: 1.1294 },
    ],
    maxSpeedFps: mph(9.28), // 13.61 fps
    accel: 8.5,
    turnRate: 1.05,
    accent: "#cf3b3b",
    accentDark: "#17171a",
    weapon: {
      type: "grappler",
      pivot: { x: 0, y: 0.95, z: 0.2639 }, // MEASURED lift hinge, game space
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED: the arm is baked RAISED, so -0.26 drops the fork tips to the
      // floor and 0.55 hoists them. Grabbing needs the forks DOWN, which is why
      // the sim only takes a grip below a third of the lift stroke.
      restAngle: -0.26,
      liftAngle: 0.55,
      liftSeconds: 0.6,
      lowerSeconds: 0.8,
      gripReach: 1.6888,
      gripHeight: 0.4222,
      gripStrength: 24, // see Claw Viper: a clamped bot rides where the forks are
      gripImpulseCap: 200,
      gripAngularDamping: 10,
      throwScale: 0.55,
      dims: { x: 0.2111, y: 0.2111, z: 0.5278 },
      selfRight: true,
      // MEASURED with `rig-inspect --subarc`: the baked pose curls the claw
      // forward over its own forks, which is mid-travel and can neither reach
      // nor clamp. 0.5 stands it up and open — the horse-head pose it carries
      // into a fight — and -0.2 brings it down onto the forks.
      claw: { openAngle: 0.5, closedAngle: -0.2, clampSeconds: 0.3 },
      tuning: { reach: 1.6888, holdDamagePerSecond: 0 }, // see Claw Viper: a grappler's hold is not an attack
    },
    colliders: [
      // MEASURED front skirt: z -1.58..-0.86 at y 0.20-0.44, authored down to
      // the floor so opponents can climb it into the forks.
      { shape: "wedge", halfExtents: { x: 1.3405, y: 0.2322, z: 0.38 }, offset: { x: 0, y: 0.2322, z: -1.2877 }, tipY: 0.0211 },
      { shape: "box", halfExtents: { x: 1.5516, y: 0.5489, z: 0.665 }, offset: { x: 0, y: 0.5489, z: -0.2428 } },
      { shape: "box", halfExtents: { x: 1.0449, y: 0.7811, z: 0.665 }, offset: { x: 0, y: 0.7811, z: 0.4433 } },
      { shape: "box", halfExtents: { x: 1.0661, y: 0.3694, z: 0.285 }, offset: { x: 0, y: 0.3694, z: 1.3827 } },
    ],
  },

  shatter: {
    id: "shatter",
    name: "Shatter",
    tagline: "One hammer, straight down.",
    referenceImage: "./public/reference/shatter.png",
    modelPath: "./public/models/shatter.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 4.177,
    hideWheels: true, // omni drive enclosed by the side armour
    // Four omniwheels. Same X-drive as Glitch: the left stick alone translates
    // in any direction and yaw is its own channel, so the hammer stays pointed
    // at what it is about to hit while the bot moves somewhere else.
    drive: { type: "holonomic", strafeRatio: 0.85, pushForceScale: 0.6 },
    // --- the real machine ---------------------------------------------
    realWorld: {
      team: "Bots FC", from: "Brooklyn, NY",
      weightLbs: 250,
      topSpeedMph: 14, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 2.45, lengthFt: 4.18, heightFt: 2.82, source: "class-estimate" },
      weapon: { name: "Hammer", weightLbs: null, tipSpeedMph: null, rpm: null },
      drive: "4x Castle 2028 brushless (omni)", power: null,
    },

    weightLbs: 250,
    weaponWeightLbs: 50,
    bodyDims: { x: 2.454, y: 1.1226, z: 4.177 }, // MEASURED shell, then scaled to realWorld.size.widthFt — long and narrow
    wheelAnchors: [
      { x: -0.979, y: 0.21, z: -1.1748 },
      { x: 0.979, y: 0.21, z: -1.1748 },
      { x: -0.979, y: 0.21, z: 1.4358 },
      { x: 0.979, y: 0.21, z: 1.4358 },
    ],
    maxSpeedFps: mph(8.12), // 11.91 fps
    accel: 8.0,
    turnRate: 1.15,
    accent: "#8f6fd0",
    accentDark: "#141019",
    weapon: {
      type: "hammer",
      pivot: { x: 0, y: 0.8746, z: 0.1305 }, // MEASURED gearbox hinge, game space
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED: the GLB bakes the hammer COCKED — up and back over the tail,
      // but still clear of the bodywork — and 0.65 lays it back onto the frame.
      // Swept aft in 0.05 steps, the closest approach between the arm and the
      // rear deck runs out at 0.65: the shaft's underside sits at y 0.773 over
      // a deck top of 0.777, so 0.004ft of overlap, with the head hanging just
      // past the tail at z 2.15 (the tail plane is z 2.088). At 0.70 the shaft
      // is 0.075ft into the deck. -2.45 carries the head over the top and down
      // onto the floor at the nose: arm low point 0.023, and one more step to
      // -2.50 puts it 0.078 under the floor. Rest to fire is 3.10rad, 178
      // degrees of swing.
      restAngle: 0.65,
      fireAngle: -2.45,
      budgetCap: 300,
      dims: { x: 0.2088, y: 0.6526, z: 0.2088 },
      selfRight: true,
      tuning: { strokeSeconds: 0.2, returnSeconds: 0.85, reach: 2.4801 },
    },
    colliders: [
      // The two front forks — MEASURED thin (|x| <= 0.39) and on the floor.
      { shape: "wedge", halfExtents: { x: 0.5091, y: 0.1893, z: 0.6526 }, offset: { x: 0, y: 0.1893, z: -1.4358 }, tipY: 0.0261 },
      // The body is itself a wedge: 0.28 tall where the forks meet it, 0.86 by
      // the time it reaches the hammer's gearbox.
      { shape: "wedge", halfExtents: { x: 1.227, y: 0.5613, z: 0.5221 }, offset: { x: 0, y: 0.5613, z: -0.2611 }, tipY: 0.3655 },
      { shape: "box", halfExtents: { x: 1.1095, y: 0.5613, z: 0.9137 }, offset: { x: 0, y: 0.5613, z: 1.1748 } },
    ],
  },

  tantrum: {
    id: "tantrum",
    name: "Tantrum",
    tagline: "Drum up front, fists on top.",
    referenceImage: "./public/reference/tantrum.png",
    modelPath: "./public/models/tantrum.glb",
    // MEASURED: the model already faces -Z. The half turn that used to be here
    // drove the bot backwards, tail first — the drum and the two fork teeth are
    // at GLB -z and the arms' axle at GLB +z, so a yaw of PI put the forks
    // behind and the axle out in front, which is also how the axle came to be
    // mistaken for the weapon.
    modelYaw: 0,
    // Tripo read this bot off a photo taken on a shiny floor and modelled the
    // REFLECTION as geometry; it is carved out in
    // tools/repairs/tantrum-reflection.json. The slant on the side panels is
    // the real robot's wedge skirt, not a tilt, and is left alone.
    modelScale: 3.4558,
    hideWheels: true, // drive enclosed by the side pods
    // --- the real machine ---------------------------------------------
    // 18lb S7 tool steel drum at up to 8,500rpm, on a carriage, with two
    // independent punching fist arms.
    realWorld: {
      team: "Seems Reasonable Robotics", from: "Mountain View, CA",
      weightLbs: 250,
      topSpeedMph: 16, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      //
      // 3.00 -> 2.85. Nothing was broken — the model was drawn at exactly the
      // 3.00 it claimed — it was just estimated too generously: at 3.00 Tantrum
      // was level with Minotaur and Hydra and wider than Blip and Witch Doctor,
      // and it is a smaller, denser machine than any of them. 2.85 puts it
      // between Sawblaze and Blip at 18 lb/cu ft, in with the compact box bots
      // where it belongs.
      size: { widthFt: 2.85, lengthFt: 3.2585, heightFt: 1.5295, source: "class-estimate" },
      weapon: { name: "Punching vertical spinner", weightLbs: 18, tipSpeedMph: null, rpm: 8500 },
      drive: "2x TP5680 brushless", power: "4x 5.4Ah 6S LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 40,
    bodyDims: { x: 2.8459, y: 1.0266, z: 3.2525 }, // MEASURED shell, then scaled to realWorld.size.widthFt
    wheelAnchors: [
      { x: -1.1181, y: 0.21, z: -0.9148 },
      { x: 1.1181, y: 0.21, z: -0.9148 },
      { x: -1.1181, y: 0.21, z: 0.9148 },
      { x: 1.1181, y: 0.21, z: 0.9148 },
    ],
    maxSpeedFps: mph(9.28), // 13.61 fps
    accel: 8.5,
    turnRate: 1.05,
    accent: "#e2701f",
    accentDark: "#141a1c",
    weapon: {
      type: "drum",
      // The weapon is the drum in the CENTRE of the machine (parts 24 and its
      // hub 23, moved onto modelWeapon by tools/repairs/tantrum-drum.json), not
      // the bar across the back that segmentation filed as modelWeapon — that
      // bar is the axle the punch arms hinge on.
      // MEASURED with rig-inspect --axle over the drum alone.
      // MEASURED, then corrected onto the drum's fitted axle: the old value was
      // the bounding-box centre of the barrel PLUS its attack lip, which sits
      // 0.05ft off the axis — 16% of the drum's radius, i.e. a visible wobble.
      // See repairs/tantrum-drum-axle.json for the circle fit; the same
      // correction is applied there to the RENDER pivot, so the collider and
      // the mesh turn about the same line.
      pivot: { x: 0.0039, y: 0.7214, z: -0.5353 },
      axis: { x: 1, y: 0, z: 0 },
      spinUpSeconds: 1.3, // second-quickest, just inside v1's band (see Endgame)
      inertia: 1.0,
      maxOmega: 600,
      budgetCap: 300,
      radius: 0.3563, // MEASURED swept radius of the drum alone
      dims: { x: 0.2173, y: 0.3563, z: 0.3563 }, // half the MEASURED 0.457ft barrel
      // The drum rides a carriage on the rails down the bot's centre, and the
      // rails climb: the centreline's top runs 0.696 at z=-0.2 to 0.932 at
      // z=+0.6, a slope of about 0.3. `offset` is where the carriage parks
      // relative to the resting pivot, so the drum ends up at (0.004, 1.040,
      // +0.392) — a foot back, sat on top of the track between the arms, which
      // is as far as it can go before the arms' own axle. Holding the button
      // winches it there; releasing fires it forward, and hitBoost is what the
      // stroke is worth: the carriage covers 1.044ft in 0.16s, i.e. 6.5ft/s of
      // closing speed on top of the rotor, which is not far off half the bot's
      // own top speed.
      track: {
        // The full length of the rail, not half of it. MEASURED: the centre rail
        // (part 16) runs from model z -0.128 to +0.365, which at this bot's
        // scale is 1.79ft — and the drum was being given 1.0, so it stopped
        // dead in the middle of a rail it visibly had more of. At full retract
        // the axle sits at z 1.23 and the drum's own radius reaches 1.60,
        // just inside the 1.71 tail; 2.0 of travel hangs it over the back.
        // The climb is gentler than the travel because a proportional one would
        // lift the axle to 1.3ft on a bot 1.08ft tall.
        offset: { x: 0, y: 0.3325, z: 1.7005 },
        retractSeconds: 0.55,
        flingSeconds: 0.16,
        hitBoost: 1.5,
      },
      // The fist arms lift on the aux channel, independent of the drum. They
      // hinge on the axle across the back (see the aux pivot in
      // tools/repairs/tantrum-drum.json), and the GLB has them baked 14.6deg
      // nose-up: openAngle takes that out so they lie flat along the deck at
      // rest, and punchAngle is a clean quarter turn up from there.
      fists: {
        openAngle: -0.255, punchAngle: 1.3158, punchSeconds: 0.18,
        impulse: 90, damagePerHit: 2.5, reach: 1.1181,
        axis: { x: 1, y: 0, z: 0 },
      },
      tuning: { efficiency: 0.55, impulseScale: 10.0, liftScale: 28.0, liftVelocity: 4.5, gyroScale: 1.0 },
    },
    // NOTHING in front of z=-0.813. Everything from there to the nose is the
    // two fork teeth, MEASURED thin (|x| 0.55 to 0.86) and low (y 0.23 to 0.44),
    // and they run either side of the drum rather than in front of it. A solid
    // on them would be a pure stand-off — opponents would stop on the tips with
    // the drum, whose sweep reaches z=-0.983, still short of them. Same call as
    // Copperhead and Deep Six. The tail box is the arms' axle and the deck it
    // is bolted through, MEASURED y 0.544 to 0.990 over z 1.284 to 1.714.
    colliders: [
      { shape: "box", halfExtents: { x: 1.423, y: 0.5083, z: 0.9961 }, offset: { x: 0, y: 0.5083, z: 0.2236 } },
      { shape: "box", halfExtents: { x: 1.0431, y: 0.2119, z: 0.2043 }, offset: { x: 0, y: 0.7287, z: 1.4241 } },
    ],
  },

  witchdoctor: {
    id: "witchdoctor",
    name: "Witch Doctor",
    tagline: "Every season. Every time.",
    referenceImage: "./public/reference/witchdoctor.png",
    modelPath: "./public/models/witchdoctor.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 3.3598,
    // "Bunny ear" appendages work either way up, so it keeps driving inverted.
    canDriveInverted: true,
    // --- the real machine ---------------------------------------------
    // 45-47lb disk; 200mph at 4,000rpm in WC III, later reworked to the 250mph
    // cap.
    realWorld: {
      team: "Team Witch Doctor", from: "Miami, FL",
      weightLbs: 250,
      topSpeedMph: 16, topSpeedSource: "class-estimate",
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 2.95, lengthFt: 3.36, heightFt: 1.31, source: "class-estimate" },
      weapon: { name: "Vertical disk spinner + flamethrower", weightLbs: 47, tipSpeedMph: 250, rpm: 4000 },
      drive: "2x Long Magmotor", power: null,
    },

    weightLbs: 250,
    weaponWeightLbs: 47,
    bodyDims: { x: 2.9263, y: 1.3006, z: 3.3598 }, // MEASURED shell, then scaled to realWorld.size.widthFt
    wheelAnchors: [
      { x: -1.1163, y: 0.21, z: -0.336 },
      { x: 1.1163, y: 0.21, z: -0.336 },
      { x: -1.138, y: 0.21, z: 1.3764 },
      { x: 1.138, y: 0.21, z: 1.3764 },
    ],
    maxSpeedFps: mph(9.28), // 13.61 fps
    accel: 8.5,
    turnRate: 1.05,
    accent: "#7fd430",
    accentDark: "#1a1024",
    weapon: {
      type: "drum", // vertical disc: same swept volume, same maths
      // The GLB carries no pivot for this disc, so the loader fell back to the
      // weapon part's bbox centre — and the part was the disc PLUS the cowl
      // fused behind it, which dragged that centre 0.29ft aft of the real axle
      // and made the whole assembly orbit a point in the bodywork. MEASURED:
      // the axle is the boss the white skull end cap sits in. That cap is BODY
      // geometry (it shows up in a --solo body render), so it holds still while
      // the disc turns, which is how you can tell it is the axle rather than
      // something painted on the rotor. tools/repairs/witchdoctor-disc.json
      // cuts the cowl back out of the weapon.
      pivotFromCatalog: true,
      pivot: { x: 0.0217, y: 0.647, z: -0.676 },
      axis: { x: 1, y: 0, z: 0 },
      spinUpSeconds: 2.2,
      inertia: 1.1,
      maxOmega: 620,
      budgetCap: 260,
      radius: 0.634, // MEASURED swept radius of the disc about its own axle
      dims: { x: 0.1084, y: 0.634, z: 0.634 },
      tuning: {
        efficiency: 0.54, impulseScale: 11.0, liftScale: 30.0, liftVelocity: 4.5,
        gyroScale: 0.9, impactScale: 1.1, damageScale: 0.66,
      },
    },
    // Front wedge is a WEDGE, not a box, so opponents ride up it into the disc.
    colliders: [
      { shape: "wedge", halfExtents: { x: 0.867, y: 0.1626, z: 0.3902 }, offset: { x: 0, y: 0.1626, z: -1.2789 }, tipY: 0.0325 }, // front wedge (MEASURED slope)
      { shape: "box", halfExtents: { x: 1.4089, y: 0.1734, z: 1.2897 }, offset: { x: 0, y: 0.1734, z: 0.2059 } },
      { shape: "box", halfExtents: { x: 1.2464, y: 0.2059, z: 1.2464 }, offset: { x: 0, y: 0.5527, z: 0.3793 } },
    ],
  },

  glitch: {
    id: "glitch",
    name: "Glitch",
    tagline: "Always pointed at you.",
    referenceImage: "./public/reference/glitch.png",
    modelPath: "./public/models/glitch.glb",
    // Clean Math.PI only because glitch-square.json baked the skew out of the
    // model. Before that this was 2.0361 — the arbitrary-looking angle that
    // made the drum's real axle transverse in game space.
    modelYaw: Math.PI,
    // glitch-mirror.json rebuilt the bot out of its own good half, which
    // changed its PROPORTIONS: 1.087 x 1.090 in the GLB became 1.205 x 1.062,
    // because the half Tripo under-resolved was the narrow one and doubling the
    // good half is what the machine actually measures. Scaling on width alone
    // (the usual rule, see SIZING) would then shrink Glitch 10% in every
    // direction to hold widthFt at an estimate that the scan contradicts. This
    // scale holds the PLANFORM AREA where it was — 8.40 sq ft before and after
    // — so the mirror changed Glitch's shape without changing how much arena he
    // takes up, and realWorld.size below now quotes the scan rather than the
    // class guess.
    modelScale: 3.4363,
    hideWheels: true, // four omniwheels in an X-drive, tucked under the wedge
    // --- the real machine ---------------------------------------------
    // battlebots.com files the weapon as a vertical bar spinner; the team and
    // the wiki both call it an eggbeater drum, and the hardware in the
    // reference photo is a drum. RPM, drum diameter and impact energy are not
    // published anywhere — only the tip speed is.
    realWorld: {
      team: "Combat Robotics at Berkeley", from: "Berkeley, CA",
      weightLbs: 250,
      topSpeedMph: 12, topSpeedSource: "class-estimate",
      // PROPORTIONS from the scan, SCALE from the class band. Was a 2.9 x 3.15
      // class guess, i.e. longer than wide; the scan says the opposite and the
      // reference photo agrees, so Glitch is a wide, flat arrowhead and the
      // shape here is the mirrored model's rather than the guess's.
      //
      // The absolute size was still the old guess, though, and it made Glitch
      // the densest machine on the roster by a distance: 8.39 sq ft of plan at
      // 9 inches tall is 6.4 cu ft for 250lb, or 39 lb/cu ft, against 33 for
      // Duck and 30 for Copperhead. Duck is the fair comparison — the only
      // other bot this flat — and Glitch has to fit everything Duck does PLUS a
      // 58lb drum and its motor into LESS box.
      //
      // 3.086 -> 3.45 on that reasoning, then 3.45 -> 4.14 on the look of it in
      // the arena, which is the check no arithmetic replaces. It is now the
      // third widest machine here behind HUGE and Mammoth and ahead of Deep
      // Six, at 16 lb/cu ft — mid-pack density rather than the outlier it was —
      // and still one of the shortest, which is the shape of the machine.
      size: { widthFt: 4.14, lengthFt: 3.649, heightFt: 1.0223, source: "scan" },
      weapon: { name: "Eggbeater drum", weightLbs: 58, tipSpeedMph: 180, rpm: null },
      drive: "4x Scorpion SII-4035-450KV (X-drive omni)", power: null,
    },

    weightLbs: 250,
    weaponWeightLbs: 58,
    bodyDims: { x: 4.14, y: 0.9001, z: 3.649 }, // MEASURED after glitch-mirror.json: flat delta, and the plate is only 8in thick
    // Moved with the body: x out by the same 6.4% the mirror widened it, z in
    // by the 5.7% it shortened. y is NOT a length on the bot — it is the
    // suspension probe origin against sim/vehicle.js's fixed 0.45ft travel —
    // so it does not scale with the model.
    wheelAnchors: [
      { x: -1.6421, y: 0.21, z: -1.3282 },
      { x: 1.6421, y: 0.21, z: -1.3282 },
      { x: -1.6421, y: 0.21, z: 1.3282 },
      { x: 1.6421, y: 0.21, z: 1.3282 },
    ],
    maxSpeedFps: mph(6.96), // 10.21 fps
    accel: 6,
    turnRate: 1.15,
    accent: "#7b3fd4",
    accentDark: "#15161a",
    // X-drive. Strafing is the whole bot: it circles while holding the drum
    // square, which is why nearly every exchange it takes is a clean uppercut.
    // The push penalty is the documented counter — omniwheels have no grip, so
    // a heavy pusher moves it at will.
    drive: { type: "holonomic", strafeRatio: 0.9, pushForceScale: 0.4 },
    weapon: {
      type: "drum",
      pivot: { x: 0, y: 0.5903, z: -0.322 }, // MEASURED best-fit drum axle, game space
      // MEASURED, and now exactly transverse with no residual tilt: after
      // glitch-mirror.json the drum is symmetric about the centreline, and a
      // shape symmetric about a plane perpendicular to X cannot carry an axle
      // tilted out of that plane. It used to be off-centre AND 3.25 degrees out
      // of square, both of which were scan error rather than the machine.
      //
      // The SIGN is the cutting direction, and this drum is UP-cutting: turning
      // about +X carries its leading face upward, so it meets an opponent on
      // the way up and throws them, where -X drove them into the floor. The
      // machine argues for the first one — the wedge exists to get UNDER a bot
      // and feed it back into the drum, and there is nothing to feed if the
      // drum is pushing down. Only the renderer reads the sign; sim/weapons.js
      // takes |axis| for the collider's orientation and the spinner bias key,
      // so flipping it is a visual and design change, not a physics one.
      axis: { x: 1, y: 0, z: 0 },
      // The wedge still extends AHEAD of the drum, which is the point of the
      // machine: Glitch gets under an opponent with the plate first and feeds
      // them back into the drum. The drum is not the leading edge.
      spinUpSeconds: 1.3,
      spinDownSeconds: 1.1,
      inertia: 1.2,
      maxOmega: 620,
      budgetCap: 360,
      // Re-measured after glitch-drum-lobes.json. The drum lost 0.008ft of
      // swept radius, which is not a change to the machine: the old figure came
      // off a single ragged spike in the sector the scan never resolved, and
      // that sector is now a copy of the lobe the scan DID resolve.
      radius: 0.5339, // MEASURED swept radius about the axle
      dims: { x: 0.4722, y: 0.432, z: 0.475 }, // MEASURED half-extents; only .x is read (half the drum's length along its axle)
    },
    // The nose is a WEDGE: it is the whole point of the machine, and test 16
    // requires nothing but a wedge ahead of the drum's leading edge, now
    // -0.646 (pivot.z - radius).
    //
    // Re-fitted rather than re-derived after glitch-mirror.json: the same
    // stack, with every extent and offset carried over by the factor its axis
    // moved (x 1.064, y 0.961, z 0.943), and every x OFFSET zeroed. Those
    // offsets — 0.10, 0.20 and 0.45 — existed only to chase geometry that sat
    // right of the centreline, and the bot no longer has a right and a left.
    // The third box is the drum bay, which is why it had the largest one.
    colliders: [
      { shape: "wedge", halfExtents: { x: 1.8553, y: 0.1543, z: 0.5058 }, offset: { x: 0, y: 0.1543, z: -1.5427 }, tipY: 0.0254 },
      { shape: "box", halfExtents: { x: 2.07, y: 0.2575, z: 1.0115 }, offset: { x: 0, y: 0.2575, z: 0.2026 } },
      { shape: "box", halfExtents: { x: 0.6426, y: 0.2575, z: 0.2536 }, offset: { x: 0, y: 0.7097, z: -0.4427 } },
    ],
  },

  gigabyte: {
    id: "gigabyte",
    name: "Gigabyte",
    tagline: "One hit is all it needs.",
    referenceImage: "./public/reference/gigabyte.png",
    modelPath: "./public/models/gigabyte.glb",
    // MEASURED: the self-righting pole's bend points 276.9 degrees at yaw 0,
    // i.e. straight out to the bot's left. The shell is radially symmetric so
    // yaw is cosmetic for the weapon, but the pole is the one part that does
    // NOT rotate and it wants to lie back over the tail rather than stick out
    // sideways where it reads as a broken antenna.
    modelYaw: 1.6912,
    modelScale: 4.1109,
    // The SHELL is what gets scaled to widthFt, not the overall bbox, and it is
    // also what the footprint centres on: modelBody here is the passive
    // self-righting pole, and that pole arcs out sideways far enough to shove
    // the spinning dome half a foot off the chassis origin.
    modelCenterOn: "modelWeapon",
    hideWheels: true, // two wheels, entirely under the shell
    // --- the real machine ---------------------------------------------
    // Robotic Death Company, built by John Mladenik — NOT Hardcore Robotics.
    // Successor to Megabyte. Four shells are carried; 120lb is the current one.
    realWorld: {
      team: "Robotic Death Company", from: "Oceanside, CA",
      weightLbs: 250,
      topSpeedMph: 12, topSpeedSource: "class-estimate",
      // 3.47 drawn -> 3.35. The model was scaled 3.6% wider than this entry
      // claimed, and every collider and pivot in it had been authored to the
      // drawn 3.47, so the numbers agreed with each other and disagreed with
      // widthFt. Everything moved together rather than widthFt alone.
      //
      // A round shell, so lengthFt IS the diameter and tracks widthFt; the
      // model's drawn z-extent is 3.87 only because the self-righting pole arcs
      // out behind the dome, and that pole is not the machine's footprint.
      size: { widthFt: 3.35, lengthFt: 3.35, heightFt: 1.1212, source: "class-estimate" },
      weapon: { name: "Full-body shell", weightLbs: 120, tipSpeedMph: 188, rpm: null },
      drive: "2x TP5680 brushless", power: null,
    },

    weightLbs: 250,
    weaponWeightLbs: 120,
    bodyDims: { x: 3.3562, y: 1.1212, z: 3.34 }, // MEASURED shell, after gigabyte-round.json made it circular
    wheelAnchors: [
      { x: -1.3476, y: 0.21, z: -0.593 },
      { x: 1.3476, y: 0.21, z: -0.593 },
      { x: -1.3476, y: 0.21, z: 0.593 },
      { x: 1.3476, y: 0.21, z: 0.593 },
    ],
    maxSpeedFps: mph(6.96), // 10.21 fps
    accel: 5.5,
    turnRate: 0.7,
    accent: "#d94a1e",
    accentDark: "#121214",
    weapon: {
      type: "shellSpinner",
      pivot: { x: -0.0129, y: 0.6997, z: -0.082 }, // MEASURED shell centre, game space
      axis: { x: 0, y: 1, z: 0 }, // VERTICAL — the only weapon in the game that is
      // Six seconds is the published spin-up and it is the whole risk of the
      // machine: before it is up it is a 250lb dome with two wheels.
      spinUpSeconds: 6.0,
      spinDownSeconds: 1.1,
      inertia: 2.2,
      maxOmega: 260,
      budgetCap: 460, // the hardest-hitting weapon in the catalog
      // Every hit throws Gigabyte as hard as its target, and being nearly
      // unsteerable once up to speed is the price of the six-second wind-up.
      recoilScale: 1.8,
      gyroPenalty: 0.55,
      radius: 1.671, // MEASURED shell radius x the 3.35ft resize (teeth reach 1.81)
      dims: { x: 1.6754, y: 0.5607, z: 1.6754 },
      // The shell is the roof, which is the one way in to a spun-up full-body
      // spinner: a hammer that comes down square on the rim drives it into the
      // chassis and the rotor stops dead. No other weapon in the catalog sets
      // this — everything else presents an edge or a bar up there, and an
      // overhead blow glances off it. `radius` is how far out from the bot's
      // centre the head still lands on the spinning face; it is the shell, not
      // the teeth, because a hit on the rim itself is a graze.
      overheadStall: { radius: 1.5093, minPower: 0.45, seconds: 2.0 },
      // Tombstone's chain, sized for a rotor half again as heavy. Gigabyte hits
      // harder than the bar does — that is the whole bot — but the hit is the
      // same KIND of hit: a horizontal spinner throws you sideways and doesn't
      // lift much (spinType comes off the vertical axis, so the horizontal bias
      // is already in play). It costs him more than it costs Tombstone: with
      // spinLossScale set, the rotor's drain is proportional to how hard the hit
      // landed instead of v1's flat 72-97%, so a graze barely marks the spin-up
      // while a clean connection buys the opponent three or four seconds of a
      // Gigabyte that is only a heavy dome on two wheels.
      tuning: {
        efficiency: 0.86, impulseScale: 12.5, kickbackScale: 1.45,
        liftScale: 6.0, liftVelocity: 4.0,
        gyroScale: 1.4, impactScale: 1.6, damageScale: 0.85,
        spinLossBase: 0.08, spinLossScale: 0.55,
      },
    },
    // The shell IS the collider — a disc lying flat, not a wheel, hence axis y.
    // The pole is the only part that does not rotate and it never reaches the
    // floor, so it gets no collider of its own.
    colliders: [
      { shape: "cylinder", axis: "y", radius: 1.671, halfHeight: 0.539, offset: { x: 0, y: 0.539, z: 0 } },
    ],
  },

  kraken: {
    id: "kraken",
    name: "Kraken",
    tagline: "Bite first. Then light them up.",
    referenceImage: "./public/reference/kraken.png",
    modelPath: "./public/models/kraken.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 3.5659,
    // --- the real machine ---------------------------------------------
    // The only pneumatic crusher ever built — an air BAG between chassis and
    // jaw lever, not a rod cylinder. It trades holding force for speed, and it
    // snaps shut far faster than a hydraulic crusher. Crush force grew
    // 20,000 -> 40,000 -> 100,000 lbf across builds.
    realWorld: {
      team: "CE Robots", from: "Titusville, FL",
      weightLbs: 249,
      topSpeedMph: 20, topSpeedSource: "builder-stated",
      size: { widthFt: 2.9, lengthFt: 3.5692, heightFt: 1.9073, source: "class-estimate" },
      weapon: { name: "Pneumatic crusher", weightLbs: 60, tipSpeedMph: null, rpm: null },
      // 2022/23 rebuild: four brushless motors (~20lb) making over 22hp,
      // replacing 30lb of brushed NPC-T74s making 3-4hp. That is the whole
      // reason this bot is no longer the slowest wheeled machine in the game.
      drive: "4x brushless (22hp); was 2x NPC-T74", power: null,
    },

    weightLbs: 249,
    weaponWeightLbs: 60,
    bodyDims: { x: 2.9, y: 1.904, z: 3.5659 }, // MEASURED
    wheelAnchors: [
      { x: -1.0038, y: 0.21, z: -0.6135 },
      { x: 1.0038, y: 0.21, z: -0.6135 },
      { x: -1.0596, y: 0.21, z: 1.0652 },
      { x: 1.0596, y: 0.21, z: 1.0652 },
    ],
    maxSpeedFps: mph(11.60), // 17.01 fps
    accel: 9,
    turnRate: 0.95,
    accent: "#3fa63f",
    accentDark: "#16181a",
    weapon: {
      type: "crusher",
      pivot: { x: 0, y: 1.7723, z: 0.9548 }, // MEASURED top-rear hinge, game space
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED: the GLB is baked jaw-OPEN, so the stroke CLOSES it onto the
      // fixed lower V-scoop. About 30 degrees, which matches the real gape.
      restAngle: 0,
      fireAngle: -0.55,
      spinUpSeconds: 0.2, // jaw close response
      budgetCap: 160, // enormous force, but it has to get a grip first
      dims: { x: 0.8365, y: 0.5577, z: 1.6218 },
      // The flamethrower fires from INSIDE the mouth — added in WC IV, aimed
      // into the bite zone. requiresGrip is not a balance lever, it is what the
      // weapon is: with the jaw open the jet goes past whatever is in front,
      // and it only does anything once the jaw is already shut on something.
      // MEASURED nozzle: the throat, on the jaw's centreline just behind the
      // fangs, so the jet leaves through the teeth. ridesWeapon parents the
      // emitter to modelWeapon, so it aims where the jaw points rather than
      // where the bot points. Nozzle, reach and jet scale all carry the 2.90ft
      // resize like every other length on this bot.
      flame: {
        nozzles: [{ x: 0, y: 1.5058, z: -1.1377 }],
        dir: { x: 0, y: -0.12, z: -1 },
        ridesWeapon: true,
        requiresGrip: true,
        reach: 3.5692, scale: 0.9481, damagePerSecond: 8,
      },
      tuning: { strokeSeconds: 0.25, returnSeconds: 0.5, gripReach: 2.1192 },
    },
    // The lower jaw is welded to the chassis and is the get-under wedge. Its
    // tip MEASURES 0.30 off the floor (0.27 before the 2.90ft resize), which is
    // a scan artifact rather than the machine — authored to the floor so it
    // works as the wedge it is.
    colliders: [
      // The lower jaw. It used to be 0.76ft wide — the red tongue in the
      // reference photo and nothing else — which is a quarter of the nose, so an
      // opponent met the vertical box behind it unless it happened to line up
      // with the middle of the mouth. The tongue is only the MIDDLE of a sloped
      // face that runs the width of the machine: green side wedges either side
      // of it, all climbing from a knife edge on the floor to the mouth. That
      // whole face is the wedge, and getting under a bot is how Kraken gets one
      // into the jaw at all.
      { shape: "wedge", halfExtents: { x: 1.22, y: 0.31, z: 0.62 }, offset: { x: 0, y: 0.31, z: -1.16 }, tipY: 0.02 },
      { shape: "box", halfExtents: { x: 1.0596, y: 0.6135, z: 0.6135 }, offset: { x: 0, y: 0.6135, z: -0.5019 } },
      { shape: "box", halfExtents: { x: 1.45, y: 0.5019, z: 0.6915 }, offset: { x: 0, y: 0.5019, z: 0.4685 } },
      { shape: "box", halfExtents: { x: 1.0262, y: 0.3681, z: 0.6469 }, offset: { x: 0, y: 0.3681, z: 1.3608 } },
    ],
  },

  rusty: {
    id: "rusty",
    name: "Rusty",
    tagline: "Held together by hope and a welded nut.",
    referenceImage: "./public/reference/rusty.png",
    modelPath: "./public/models/rusty.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 4.2553,
    hideWheels: true, // tracked — the two rubber track units stay in the body
    // --- the real machine ---------------------------------------------
    // A genuine one-man team, and the rust is real rather than paint. The
    // chrome helmet is an inverted stainless mixing bowl, the battery tray is a
    // cut street sign, and the mandatory power switch is a nut welded to a
    // bolt. Head mass, swing energy and gas pressure are not published.
    realWorld: {
      team: "Team Iron Force", from: "Antioch, IL",
      weightLbs: 250,
      topSpeedMph: 7, topSpeedSource: "class-estimate",
      size: { widthFt: 2.85, lengthFt: 4.2531, heightFt: 2.0279, source: "class-estimate" },
      weapon: { name: "Pneumatic hammer", weightLbs: 30, tipSpeedMph: null, rpm: null },
      drive: "2x rubber tracks", power: null,
    },

    weightLbs: 250,
    weaponWeightLbs: 30,
    bodyDims: { x: 2.85, y: 2.0257, z: 4.2553 }, // MEASURED
    wheelAnchors: [
      { x: -1.2606, y: 0.21, z: -1.4798 },
      { x: 1.2606, y: 0.21, z: -1.4798 },
      { x: -1.2606, y: 0.21, z: 1.4798 },
      { x: 1.2606, y: 0.21, z: 1.4798 },
    ],
    maxSpeedFps: mph(4.06), // 5.95 fps
    accel: 4.2,
    turnRate: 0.6,
    accent: "#8a5a32",
    accentDark: "#2a2118",
    drive: { type: "tracked" },
    // No `tracks` block: Rusty's tracks are buried under its armour and its
    // tread guards and are not visible from any angle the camera reaches, so
    // there is nothing for a band to add. It DID have one, which named no aux
    // node — so the scroll walked modelBody and dragged the texture on all 23
    // of Rusty's parts around, the helmet and the hammer yoke included.
    weapon: {
      type: "hammer",
      // MEASURED front-of-yoke hinge, game space. The yoke is a U: two drilled
      // plate-steel bars down the sides joined by the head fin at the tail, so
      // the pivot is at the FRONT beside the dome and the head hangs over the
      // tail at z 2.21 (2.02 before the 2.85ft resize). That is why the hammer is
      // invisible in front-on photos.
      pivot: { x: 0, y: 1.2255, z: -1.1005 },
      // Negative X: the head is BEHIND the pivot, so a positive rotation about
      // +X would drive it into the floor instead of lifting it over the top.
      axis: { x: -1, y: 0, z: 0 },
      restAngle: 0, // baked cocked-back over the tail
      // MEASURED by sweeping: at Math.PI the yoke has carried the head all the
      // way over the top and out to the front, horizontal, head leading. A full
      // half turn is the whole stroke this gantry has.
      fireAngle: Math.PI,
      spinUpSeconds: 0.2,
      budgetCap: 260,
      selfRight: true,
      // RT alone: hold and the head stays down at the bottom of the arc,
      // release and it re-cocks. Retraction is where Rusty actually loses
      // fights, so leaving the head down has to be something you can DO.
      holdStroke: true,
      dims: { x: 0.3288, y: 0.5985, z: 0.3288 },
      tuning: { strokeSeconds: 0.25, returnSeconds: 1.4, reach: 3.3213 },
    },
    colliders: [
      { shape: "wedge", halfExtents: { x: 0.6796, y: 0.2192, z: 0.3288 }, offset: { x: 0, y: 0.2192, z: -1.71 }, tipY: 0.0329 },
      { shape: "box", halfExtents: { x: 1.425, y: 0.3946, z: 1.699 }, offset: { x: 0, y: 0.3946, z: 0.2631 } },
      { shape: "box", halfExtents: { x: 0.855, y: 0.6796, z: 0.7235 }, offset: { x: 0, y: 1.3373, z: -0.9317 } },
      { shape: "box", halfExtents: { x: 1.4031, y: 0.3288, z: 0.6796 }, offset: { x: 0, y: 1.0085, z: 0.6796 } },
    ],
  },

  dragonking: {
    id: "dragonking",
    name: "Dragon King",
    tagline: "Pin it, then cut it open.",
    referenceImage: "./public/reference/dragonking.png",
    modelPath: "./public/models/dragonking.glb",
    // Was Math.PI, which had it driving tail-first. The grabber arm and the
    // dragon's head lead; the saw arms rake back over the body behind them.
    modelYaw: 0,
    modelScale: 4.7867,
    hideWheels: true, // tracked pods, rigged as modelAux-pods
    // --- the real machine ---------------------------------------------
    // Built by Jerome Miles (Team Duct Tape) as the successor to Red Devil, for
    // the Chinese televised events; now run by Bot Bash Party Crew under Will
    // Prater. Crediting either alone is incomplete. Weight, blade diameter, saw
    // RPM and arm actuator type are all unpublished.
    realWorld: {
      team: "Bot Bash Party Crew", from: "Birmingham, AL",
      weightLbs: 250,
      topSpeedMph: 8, topSpeedSource: "class-estimate",
      // 3.3 -> 4.0 wide. lengthFt is the CHECK (see SIZING) and this entry was
      // failing it badly: 4.19 claimed against 2.86 drawn. The model is not
      // wrong — a long black arm the scan invented was carved off the back — so
      // the robot really is that much shorter than the old estimate, and
      // scaling on width brings the whole machine up to a size that matches a
      // 250lb tracked bot with two pods and a head. Length and height are
      // re-quoted from the drawn model rather than carried through from the
      // estimate they falsified.
      size: { widthFt: 4, lengthFt: 3.4607, heightFt: 2.3592, source: "class-estimate" },
      weapon: { name: "Twin saws", weightLbs: null, tipSpeedMph: null, rpm: null },
      drive: "2x rotating tracked pods", power: null,
    },

    weightLbs: 250,
    weaponWeightLbs: 40,
    // MEASURED with the pods in their rest position. The real bounding box
    // CHANGES with pod angle — the pods rotate to reconfigure the stance, lift
    // the body and self-right — so this is the rest stance, not a fixed truth.
    // z re-measured off the drawn model (3.46) rather than carried through from
    // the old 4.19 estimate, which the model contradicts by a third — see the
    // note on realWorld.size. It is not cosmetic: bodyDims sets the pitch and
    // yaw inertia, puts the centre of mass at 0.08 * z, and sizes the weapon's
    // front zone, so a bot declared a foot and a half longer than it is drawn
    // turns like a longer machine and reaches further than it looks.
    bodyDims: { x: 4, y: 2.3588, z: 3.4607 },
    wheelAnchors: [
      { x: -1.5758, y: 0.21, z: -1.3333 },
      { x: 1.5758, y: 0.21, z: -1.3333 },
      { x: -1.5758, y: 0.21, z: 0.4242 },
      { x: 1.5758, y: 0.21, z: 0.4242 },
    ],
    maxSpeedFps: mph(4.64), // 6.81 fps
    accel: 4.5,
    turnRate: 0.65,
    accent: "#e8b21e",
    accentDark: "#141414",
    drive: { type: "tracked" },
    // The two track units, by mesh name. engine/tracks.js sweeps a band around
    // each one's silhouette — which for a tensioned track is its convex hull —
    // and scrolls that along its own length. Naming the meshes is the point:
    // the previous version scrolled the units' own UVs, and since each unit is
    // ONE scanned mesh holding wheels, frame and band on a single atlas, that
    // moved the texture in a different direction on every triangle.
    // `sprockets` are the four drive wheels, cut out of the two pods by
    // tools/repairs/dragonking-sprockets.json so they can turn inside the band
    // they drive. Nothing inside a scanned pod could move before that: the pod
    // is one mesh, so the yellow wheels and their bolt heads sat perfectly still
    // under a track that was visibly running.
    tracks: {
      parts: ["tripo_part_6", "tripo_part_7"], widthAxis: "x", tint: "#232629",
      sprockets: ["tripo_part_60", "tripo_part_61", "tripo_part_70", "tripo_part_71"],
    },
    // MEASURED to the outside of the band, by circle fit on each pod's own
    // silhouette (0.0742 model units x 3.949). It has to BE the sprocket radius
    // or the wheels and the track disagree: the band advances the distance
    // travelled whatever this says, but the sprocket turns by wheelSpin, which
    // is that distance divided by this.
    wheelRadius: 0.3552,
    weapon: {
      type: "sawArms",
      pivot: { x: 0.0085, y: 0.7988, z: 0.1297 }, // MEASURED arm base, game space
      axis: { x: 1, y: 0, z: 0 },
      restAngle: 0, // baked arms RAISED — the stroke DROPS them, like a hammer
      // NEGATIVE, because the saws come down in FRONT of him. A positive angle
      // about +X carries the top of the arms toward +Z, which is the tail: the
      // blades were tipping backwards over the engine deck, away from anything
      // the jaw could be holding. The gesture is bite, then bring the saws down
      // on what you have got, and that is forward.
      fireAngle: -1.4, // ~80 degrees down onto a held opponent
      spinUpSeconds: 1.0,
      budgetCap: 180,
      radius: 1.5648, // MEASURED swept radius of the arms about their base
      dims: { x: 0.8679, y: 0.7976, z: 0.6885 },
      // The blades keep spinning whatever the arms are doing, so they are their
      // own nested group. They do nothing without a grip — that IS the bot.
      sub: {
        node: "modelWeaponSub-sawLeft + modelWeaponSub-sawRight",
        pivot: { x: 0.0085, y: 1.7079, z: 0.2255 }, // MEASURED, both blades share this line
        axis: { x: 1, y: 0, z: 0 },
        // They do NOT share an axle. The blades lean 6.9 degrees off horizontal
        // in OPPOSITE directions — a shallow V, and symmetric to 0.002, which is
        // how you know it is the machine and not scan noise. Spun about a common
        // horizontal axis each disc precesses instead of turning, which reads as
        // a bent blade wobbling; each has to turn about its own normal.
        // MEASURED by PCA over each disc's vertices (the smallest-variance axis
        // of a disc IS its axle). They were partitioned as one group and had to
        // be split — see tools/glb-regroup.mjs --create.
        axes: {
          sawLeft: { x: 0.9927, y: 0.1204, z: 0.0034 },
          sawRight: { x: 0.9929, y: -0.1187, z: -0.0028 },
        },
        // MEASURED swept radius of one blade about its own axle: 0.1477 model
        // units against modelScale 4.7867. The sim tests the hub against the
        // victim's chassis box at this radius, which is what makes the blades
        // cut what they actually reach — including behind the robot when LT
        // rears it up and swings them over the top.
        radius: 0.707,
        // A bot the jaw is holding takes the full rate: it cannot drive away
        // from a running saw. Anything else the blades merely touch takes this
        // share of it.
        looseCutScale: 0.6,
        // The scan resolved these as discs with a ring of nubs, which is what a
        // 30-tooth rim looks like to photogrammetry that never found the
        // gullets. Drawn instead (assets/sawBlade.js), at the radius above, with
        // the kill saws' silhouette and the copper the real blades are — see the
        // reference photo, where they are polished bronze discs, not the dull
        // orange the scan baked.
        blade: { thickness: 0.09, color: "#c9873c", metalness: 1, roughness: 0.22, envMapIntensity: 1.9 },
        spinUpSeconds: 1.0, damagePerSecond: 14,
      },
      tuning: { strokeSeconds: 0.4, returnSeconds: 0.7, gripReach: 2.6667 },
    },
    // MEASURED aux pivots, game space. The jaw is the enabling weapon; the pods
    // rotate as whole units and drive the self-right.
    // Rearing the body up about the axle at the back of the pods. LT holds it;
    // the pods stay flat on the floor and the chassis swings up over them, which
    // is the only way the saws on its back reach anything BEHIND the robot. The
    // sim runs it as a real pitch servo on the chassis (sim/vehicle.js) rather
    // than as an animation, because the whole point of the gesture is that what
    // comes over the top collides with things.
    // MEASURED rear axle. A Kasa circle fit on the two cylinders that make up
    // the cross bar (parts 2 and 4) puts it at model y -0.050, z 0.141, and the
    // rear sprockets, fit independently off each pod's own silhouette, come out
    // at y -0.0481, z 0.1443. Four fits of two different things agreeing to
    // 0.003 is what says the bar IS the axle the tracks turn on, and therefore
    // what the body rears up about. Quoted here in game space, read back off the
    // loaded model rather than converted by hand: the authority is the GLB's
    // modelAux-pods pivotLocal (tools/repairs/dragonking-rear-axle.json), and
    // the model's own normalization decides where that lands.
    //
    // `pivot` makes the SIM turn the chassis about this point rather than about
    // its centre of mass — otherwise the tail swings down as the nose goes up
    // and the axle jacks the whole robot off the floor. The pods' aux pivot is
    // the same point, which is what makes the render's counter-rotation cancel
    // exactly instead of leaving the pods skating forward under a rising body.
    lift: {
      pivot: { x: 0.0036, y: 0.1552, z: 1.4 },
      maxAngleDeg: 90, seconds: 0.9, gain: 70, damping: 8.0, maxAccel: 150,
    },
    aux: {
      // MEASURED hinge: the back-top of the skull where it meets the neck. The
      // upper snout (part 20) is what swings; the yellow lower scoop (part 19)
      // is welded to the chassis and is what a bitten bot is pressed onto.
      // The mechanism's angle is how far OPEN it is — rest is shut — so the
      // snout swings UP off the scoop, which is +x about the hinge.
      jaw: { node: "modelAux-jaw", axis: { x: 1, y: 0, z: 0 },
             pivot: { x: 0, y: 0.1673, z: -1.1588 }, openAngle: 0.62, seconds: 0.4,
             reach: 2.303, clampForce: 260, holdStrength: 9, breakDistance: 3.2 },
      // Holds the pods AND the cross bar they are joined by (parts 2, 3 and 4,
      // moved here out of modelBody). The bar is the axle: it cannot be part of
      // what swings, or rearing up carries it down through the floor and stands
      // the robot on it. Pivot is the measured axle — the same point as
      // lift.pivot, which is what makes the counter-rotation cancel exactly
      // instead of leaving the pods skating forward as the body comes up.
      pods: { node: "modelAux-pods", axis: { x: 1, y: 0, z: 0 },
              pivot: { x: 0.0036, y: 0.1552, z: 1.4 }, range: 2.2, seconds: 0.8,
              drivesSelfRight: true },
    },
    // Re-authored for the flip: what used to be the tail leads now, so the
    // wedge moved to the OTHER end. A wedge's slope is baked front-to-back, so
    // mirroring its offset alone would have left it facing backwards.
    colliders: [
      { shape: "wedge", halfExtents: { x: 1.2727, y: 0.2424, z: 0.5455 }, offset: { x: 0, y: 0.2424, z: -1.3333 }, tipY: 0.0242 },
      { shape: "box", halfExtents: { x: 1.2727, y: 0.3394, z: 1.4545 }, offset: { x: 0, y: 0.3394, z: 0.2424 } },
      { shape: "box", halfExtents: { x: 0.8242, y: 0.6303, z: 0.8242 }, offset: { x: 0, y: 0.6303, z: 0.2061 } },
      { shape: "box", halfExtents: { x: 2, y: 0.3273, z: 1.2242 }, offset: { x: 0, y: 0.3273, z: 0.5455 } },
    ],
  },
};

/** Stable display order for UI grids. */
export const BOT_IDS = Object.freeze([
  "beta", "biteforce", "bronco", "clawviper", "deepsix", "huge",
  "hydra", "hypershock", "minotaur", "quantum", "sawblaze", "tombstone",
  "whiplash", "witchdoctor",
  "blip", "copperhead", "duck", "endgame", "freeshipping",
  "mammoth", "overhaul", "shatter", "tantrum",
  "dragonking", "gigabyte", "glitch", "kraken", "rusty",
]);

/** @returns {BotSpec} */
export function getBotSpec(id) {
  const spec = CATALOG[id];
  if (!spec) throw new Error(`Unknown bot id: ${id}`);
  return spec;
}
