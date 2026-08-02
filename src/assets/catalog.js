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
    weightLbs: number, topSpeedMph: number|null,
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
      topSpeedMph: null,
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
    maxSpeedFps: mph(8.182), // 12.00
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
      topSpeedMph: null,
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
    maxSpeedFps: mph(7.5), // 11.00
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
      topSpeedMph: 15,
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
    maxSpeedFps: mph(3.682), // 5.40
    accel: 8.4,
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
      topSpeedMph: null,
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
    maxSpeedFps: mph(7.5), // 11.00
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
      { shape: "box", halfExtents: { x: 1.1002, y: 0.2666, z: 0.8129 }, offset: { x: 0, y: 0.383, z: -1.0011 } }, // front wedge
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
      topSpeedMph: 28,
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
    maxSpeedFps: mph(13.636), // 20.00
    accel: 8.6,
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
      topSpeedMph: null,
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
    maxSpeedFps: mph(10.909), // 16.00
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
      topSpeedMph: null,
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
    maxSpeedFps: mph(7.773), // 11.40
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
      topSpeedMph: null,
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
    maxSpeedFps: mph(6.545), // 9.60
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
      topSpeedMph: 12,
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
    maxSpeedFps: mph(8), // 11.73
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
      topSpeedMph: 15,
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
    maxSpeedFps: 16.0, // known for its driving
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
      topSpeedMph: 20,
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
    maxSpeedFps: 17.0, // weapon-class motor on every wheel
    accel: 9.5,
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
      gripStrength: 16,
      throwScale: 0.6, // share of the arm's tip speed handed over on release
      downforceLbs: 250, // magnets: very hard to shove or flip
      dims: { x: 0.2632, y: 0.2632, z: 0.6579 },
      // MEASURED: at -0.9 the jaw shuts onto the red fork tip it grips against.
      claw: { openAngle: 0, closedAngle: -0.9, clampSeconds: 0.25 },
      tuning: { reach: 1.8421, holdDamagePerSecond: 3 },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 1.3158, y: 0.3158, z: 1.7369 }, offset: { x: 0, y: 0.3553, z: 0.2895 } },
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
      topSpeedMph: null,
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
    maxSpeedFps: 12.0,
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
      topSpeedMph: null,
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
    maxSpeedFps: 16.5,
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
      topSpeedMph: null,
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
    maxSpeedFps: 17.0,
    accel: 9.5,
    turnRate: 1.1,
    accent: "#2f6fd0",
    accentDark: "#14161b",
    weapon: {
      type: "flipper",
      pivot: { x: 0, y: 0.695, z: 0.9685 }, // MEASURED rear hinge, game space
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
    modelRoll: Math.PI, // MEASURED: Tripo built it upside down (wheels on top)
    modelScale: 3.2498,
    canDriveInverted: true, // symmetrical drum bot; it fights either way up
    // --- the real machine ---------------------------------------------
    // 50lb single-toothed S7 tool steel drum; 160-180mph originally, dialled
    // back to 140mph for more bite.
    realWorld: {
      team: "Team Copperhead", from: "Denver, CO",
      weightLbs: 250,
      topSpeedMph: null,
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 3.25, lengthFt: 3.22, heightFt: 2.05, source: "class-estimate" },
      weapon: { name: "Eggbeater drum spinner", weightLbs: 50, tipSpeedMph: 180, rpm: null },
      drive: "2x Maytech MTO6365", power: "5Ah 6S LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 50,
    // MEASURED shell. The two whiskers reaching 2.08 are its antennae, not
    // structure, so the height here is the deck, not the bounding box.
    bodyDims: { x: 3.1218, y: 1.428, z: 3.2203 },
    wheelAnchors: [
      { x: -1.2802, y: 0.2395, z: -0.8863 },
      { x: 1.2802, y: 0.2395, z: -0.8863 },
      { x: -1.2802, y: 0.2395, z: 0.8863 },
      { x: 1.2802, y: 0.2395, z: 0.8863 },
    ],
    maxSpeedFps: 14.0,
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
      pivotFromCatalog: true,
      pivot: { x: 0.04, y: 0.713, z: -0.81 },
      axis: { x: 1, y: 0, z: 0 },
      spinUpSeconds: 1.6,
      inertia: 1.25,
      maxOmega: 560,
      budgetCap: 340,
      radius: 0.423, // MEASURED swept radius of the drum alone
      dims: { x: 0.8863, y: 0.5367, z: 0.5367 },
      tuning: { efficiency: 0.58, impulseScale: 10.5, liftScale: 30.0, liftVelocity: 4.5, gyroScale: 1.0 },
    },
    // NOTHING in front of z=-0.36, which is where the drum's sweep ends. The
    // model does carry a deck lip out to z=-1.6, but it sits at y 1.02-1.23 —
    // level with the top of the drum — so a collider there would be a pure
    // stand-off: opponents would stop on the lip with the drum still a foot
    // short of them. Same call as Deep Six, for the same reason.
    colliders: [
      { shape: "box", halfExtents: { x: 1.5264, y: 0.6106, z: 0.9651 }, offset: { x: 0, y: 0.6401, z: 0.6106 } },
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
      topSpeedMph: null,
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
    maxSpeedFps: 13.0,
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
      pivot: { x: 0, y: 0.32, z: 0.34 },
      arms: [
        { x: -1.1, radius: 0.05, from: { y: 0.34, z: 0.34 }, to: { y: 0.3, z: -0.98 }, color: "#b9bdc4" },
        { x: 1.1, radius: 0.05, from: { y: 0.34, z: 0.34 }, to: { y: 0.3, z: -0.98 }, color: "#b9bdc4" },
      ],
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED: the scoop is baked DOWN (0 rests its lip on the floor at
      // y 0.008) and 1.1 stands it up over the nose. That resting pose is why
      // the front collider below is a wedge.
      restAngle: 0,
      fireAngle: 0.6, // MEASURED on the new hinge: plow tip up at 1.5ft, still reaching forward
      liftImpulse: 190,
      liftRecoil: 0.5,
      lowerSeconds: 0.6,
      dims: { x: 1.1666, y: 0.1, z: 0.4167 },
      selfRight: true,
      tuning: { strokeSeconds: 0.45, reach: 1.4166 },
    },
    colliders: [
      // The scoop at rest. MEASURED z -2.03..-1.03 climbing from the floor to
      // 0.56 — the flattest, longest wedge in the game, which is the whole bot.
      { shape: "wedge", halfExtents: { x: 1.3333, y: 0.2333, z: 0.4167 }, offset: { x: 0, y: 0.2333, z: -1.2749 }, tipY: 0.0167 },
      { shape: "box", halfExtents: { x: 1.3416, y: 0.2333, z: 1.0083 }, offset: { x: 0, y: 0.2333, z: 0.1417 } },
      { shape: "box", halfExtents: { x: 0.8333, y: 0.3833, z: 0.15 }, offset: { x: 0, y: 0.3833, z: -0.9416 } }, // hinge block
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
      topSpeedMph: null,
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
    maxSpeedFps: 15.0,
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
      topSpeedMph: null,
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
    maxSpeedFps: 14.5,
    accel: 8.0,
    turnRate: 1.0,
    accent: "#d94b2b",
    accentDark: "#17181b",
    weapon: {
      type: "lifter",
      pivot: { x: 0, y: 0.7781, z: 0.7534 }, // MEASURED mast hinge, game space
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED: the GLB bakes the mast RAISED, so rest is -0.43 (fork tips
      // on the floor at y 0.00) and 0.30 hoists them to about 1.7ft — a
      // forklift, not a flipper.
      restAngle: -0.43,
      fireAngle: 0.3,
      liftImpulse: 165,
      liftRecoil: 0.5,
      lowerSeconds: 0.7,
      dims: { x: 0.3211, y: 0.1482, z: 1.4821 },
      selfRight: true,
      // The flamethrowers. Static geometry on the model, so they are a damage
      // cone on the alt channel rather than a rigged part: no shove, no
      // knockdown, just a steady burn on whatever is held in front.
      // Two nozzles on the front of the deck — the ones the yellow feed lines
      // run to. Body-local feet; the jet leaves them forward and slightly up.
      flame: {
        damagePerSecond: 9,
        reach: 3.9523,
        scale: 1.15,
        nozzles: [
          { x: -0.62, y: 0.78, z: -0.5 },
          { x: 0.62, y: 0.78, z: -0.5 },
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
      topSpeedMph: 22,
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
    maxSpeedFps: 11.0,
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
      // the tyres.
      pivotFromCatalog: true,
      pivot: { x: -0.02, y: 3.317, z: -0.912 },
      axis: { x: 1, y: 0, z: 0 },
      spinUpSeconds: 2.4,
      spinDownSeconds: 0.9, // giant slow bar, so short of the 1.1s default
      inertia: 1.0,
      maxOmega: 300,
      budgetCap: 90,
      // MEASURED swept radius of the animated hub is 0.428 — but the hub is not
      // the weapon. Segmentation fused Mammoth's trunk into the truss and only
      // the centre spins (updates/new-bots/SEGMENTATION.md), so the part that
      // turns is a fraction of what the machine swings.
      //
      // 1.0 is also the number that makes this bot exist. Its axle sits at
      // y 1.59, higher than the TOP of every collider stack in the roster (Deep
      // Six is the tallest at 1.86 local, and rides low): measured over a full
      // 40-second fight, radius 0.6 landed 0 hits, 0.75 landed 1, 0.85 landed
      // 5 and 1.0 landed 7 — the same band as Beta and Deep Six. Below 1.0
      // Mammoth is a 250lb punching bag. The visual disc is smaller than the
      // hitbox, the same compromise Tantrum and Minotaur already ship.
      radius: 2.022,
      dims: { x: 0.74, y: 2.022, z: 2.022 },
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
      topSpeedMph: null,
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
    maxSpeedFps: 15.5,
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
      gripStrength: 15,
      throwScale: 0.55,
      dims: { x: 0.2111, y: 0.2111, z: 0.5278 },
      selfRight: true,
      // MEASURED with `rig-inspect --subarc`: the baked pose curls the claw
      // forward over its own forks, which is mid-travel and can neither reach
      // nor clamp. 0.5 stands it up and open — the horse-head pose it carries
      // into a fight — and -0.2 brings it down onto the forks.
      claw: { openAngle: 0.5, closedAngle: -0.2, clampSeconds: 0.3 },
      tuning: { reach: 1.6888, holdDamagePerSecond: 3 },
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
    // --- the real machine ---------------------------------------------
    realWorld: {
      team: "Bots FC", from: "Brooklyn, NY",
      weightLbs: 250,
      topSpeedMph: null,
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
    maxSpeedFps: 14.0,
    accel: 8.0,
    turnRate: 1.15,
    accent: "#8f6fd0",
    accentDark: "#141019",
    weapon: {
      type: "hammer",
      pivot: { x: 0, y: 0.8746, z: 0.1305 }, // MEASURED gearbox hinge, game space
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED: the GLB bakes the hammer COCKED — up and back over the tail —
      // so rest is 0 and -2.45 brings the head over the top and down onto the
      // floor at the nose (arm low point 0.00, tip out at z -1.53).
      restAngle: 0,
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
    modelYaw: Math.PI, // MEASURED: model faces +Z
    // Tripo read this bot off a photo taken on a shiny floor and modelled the
    // REFLECTION as geometry; it is carved out in
    // tools/repairs/tantrum-reflection.json. The slant on the side panels is
    // the real robot's wedge skirt, not a tilt, and is left alone.
    modelScale: 3.6377,
    hideWheels: true, // drive enclosed by the side pods
    // --- the real machine ---------------------------------------------
    // 18lb S7 tool steel drum at up to 8,500rpm, on a carriage, with two
    // independent punching fist arms.
    realWorld: {
      team: "Seems Reasonable Robotics", from: "Mountain View, CA",
      weightLbs: 250,
      topSpeedMph: null,
      // feet. widthFt is what the GLB is scaled to; see SIZING at the top.
      size: { widthFt: 3, lengthFt: 3.43, heightFt: 1.61, source: "class-estimate" },
      weapon: { name: "Punching vertical spinner", weightLbs: 18, tipSpeedMph: null, rpm: 8500 },
      drive: "2x TP5680 brushless", power: "4x 5.4Ah 6S LiPo",
    },

    weightLbs: 250,
    weaponWeightLbs: 40,
    bodyDims: { x: 2.9957, y: 1.0806, z: 3.4237 }, // MEASURED shell, then scaled to realWorld.size.widthFt
    wheelAnchors: [
      { x: -1.1769, y: 0.21, z: -0.9629 },
      { x: 1.1769, y: 0.21, z: -0.9629 },
      { x: -1.1769, y: 0.21, z: 0.9629 },
      { x: 1.1769, y: 0.21, z: 0.9629 },
    ],
    maxSpeedFps: 15.0,
    accel: 8.5,
    turnRate: 1.05,
    accent: "#e2701f",
    accentDark: "#141a1c",
    weapon: {
      type: "drum",
      pivot: { x: 0.0214, y: 0.7917, z: -1.5086 }, // MEASURED axle, game space
      axis: { x: 1, y: 0, z: 0 },
      spinUpSeconds: 1.3, // second-quickest, just inside v1's band (see Endgame)
      inertia: 1.0,
      maxOmega: 600,
      budgetCap: 300,
      // Tripo built the drum as a SLIM BAR: swept radius measures 0.145, which
      // is a third of the real machine's drum and would leave it unable to
      // touch anything with 0.6ft of air under the axle. 0.30 is the radius the
      // reference photo's drum actually has. Same call as Minotaur's unmodelled
      // notches — the collider follows the robot, not the segmentation.
      radius: 0.321,
      dims: { x: 0.5456, y: 0.321, z: 0.321 },
      // The fists punch on the alt channel, independent of the drum.
      fists: {
        openAngle: 0, punchAngle: -0.85, punchSeconds: 0.18,
        impulse: 90, damagePerHit: 2.5, reach: 1.1769,
        axis: { x: 1, y: 0, z: 0 },
      },
      tuning: { efficiency: 0.55, impulseScale: 10.0, liftScale: 28.0, liftVelocity: 4.5, gyroScale: 1.0 },
    },
    // Nothing forward of z=-1.20: the drum sweeps down to y 0.44 and out to
    // z -1.71, and the model's nose shroud sits at y 0.50-1.00, right across
    // the sweep. Leaving it out is what lets the drum reach.
    colliders: [
      { shape: "box", halfExtents: { x: 1.4979, y: 0.535, z: 1.0485 }, offset: { x: 0, y: 0.535, z: -0.2354 } },
      { shape: "box", halfExtents: { x: 0.7275, y: 0.2247, z: 0.4494 }, offset: { x: 0, y: 0.3317, z: 1.2625 } },
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
      topSpeedMph: null,
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
    maxSpeedFps: 15.0,
    accel: 8.5,
    turnRate: 1.05,
    accent: "#7fd430",
    accentDark: "#1a1024",
    weapon: {
      type: "drum", // vertical disc: same swept volume, same maths
      pivot: { x: 0.0217, y: 0.6069, z: -0.3902 }, // MEASURED disc axle, game space
      axis: { x: 1, y: 0, z: 0 },
      spinUpSeconds: 2.2,
      inertia: 1.1,
      maxOmega: 620,
      budgetCap: 260,
      radius: 0.8367, // MEASURED swept radius (bbox guess was 0.6)
      dims: { x: 0.1084, y: 0.8367, z: 0.8367 },
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
};

/** Stable display order for UI grids. */
export const BOT_IDS = Object.freeze([
  "beta", "biteforce", "bronco", "clawviper", "deepsix", "huge",
  "hydra", "hypershock", "minotaur", "quantum", "sawblaze", "tombstone",
  "whiplash", "witchdoctor",
  "blip", "copperhead", "duck", "endgame", "freeshipping",
  "mammoth", "overhaul", "shatter", "tantrum",
]);

/** @returns {BotSpec} */
export function getBotSpec(id) {
  const spec = CATALOG[id];
  if (!spec) throw new Error(`Unknown bot id: ${id}`);
  return spec;
}
