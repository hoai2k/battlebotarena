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
            spinUpSeconds?: number, inertia?: number, maxOmega?: number,
            budgetCap?: number, radius?: number,
            dims: {x:number,y:number,z:number},
            pivot: {x:number,y:number,z:number},
            axis: {x:number,y:number,z:number},
            tuning?: object },
  colliders: {shape:'box'|'cylinder'|'hull', offset:{x:number,y:number,z:number}}[],
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
    weightLbs: 250,
    weaponWeightLbs: 40,
    bodyDims: { x: 2.88, y: 1.4, z: 2.39 }, // v1 fit 3.2x1.55x2.65 * scale 0.9
    wheelAnchors: [
      { x: -1.18, y: 0.3, z: -0.75 },
      { x: 1.18, y: 0.3, z: -0.75 },
      { x: -1.18, y: 0.3, z: 0.75 },
      { x: 1.18, y: 0.3, z: 0.75 },
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
      radius: 0.526,
      dims: { x: 0.85, y: 0.526, z: 0.526 },
      pivot: { x: 0, y: 0.64, z: -0.24 },
      axis: { x: 1, y: 0, z: 0 },
      tuning: { efficiency: 0.5, impulseScale: 13.8, liftScale: 32.0, liftVelocity: 4.5, liftClearance: 0.55, gyroScale: 0.75, damageScale: 1.65 },
    },
    // The fork row is a WEDGE, not a box: opponents ride up it into the drum,
    // which is the whole point of the machine. Squared off into a level box it
    // was a bumper holding every opponent 0.5ft outside the drum.
    colliders: [
      { shape: "wedge", halfExtents: { x: 1.05, y: 0.21, z: 0.285 }, offset: { x: 0, y: 0.21, z: -0.945 }, tipY: 0.03 }, // front fork wedge (MEASURED slope)
      { shape: "box", halfExtents: { x: 1.237, y: 0.171, z: 0.873 }, offset: { x: 0.012, y: 0.175, z: 0.301 } },
      { shape: "box", halfExtents: { x: 0.354, y: 0.16, z: 0.738 }, offset: { x: -0.003, y: 0.495, z: 0.268 } },
      { shape: "box", halfExtents: { x: 0.198, y: 0.294, z: 0.79 }, offset: { x: -1.185, y: 0.294, z: 0.175 } }, // left pod
      { shape: "box", halfExtents: { x: 0.198, y: 0.294, z: 0.79 }, offset: { x: 1.184, y: 0.294, z: 0.175 } }, // right pod
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
    modelScale: 3.4,
    weightLbs: 250,
    weaponWeightLbs: 80,
    bodyDims: { x: 3.34, y: 1.67, z: 3.34 }, // v1 fit 2.9x1.45x2.9 * scale 1.15
    wheelAnchors: [
      { x: -0.94, y: 0.29, z: -0.59 },
      { x: 0.94, y: 0.29, z: -0.59 },
      { x: -0.94, y: 0.29, z: 1.01 },
      { x: 0.94, y: 0.29, z: 1.01 },
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
      dims: { x: 0.9, y: 0.11, z: 1.25 },
      pivot: { x: 0, y: 0.48, z: 0.6 }, // hinge at rear of flipper plate
      axis: { x: 1, y: 0, z: 0 },
      tuning: { strokeSeconds: 0.18, returnSeconds: 2, liftVelocity: 23.0, pitchVelocity: 10.2 },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 0.888, y: 0.25, z: 1.237 }, offset: { x: -0.023, y: 0.342, z: 0.167 } },
      { shape: "box", halfExtents: { x: 1.037, y: 0.141, z: 0.492 }, offset: { x: -0.016, y: 0.447, z: 1.026 } },
      { shape: "wedge", halfExtents: { x: 0.9, y: 0.29, z: 0.315 }, offset: { x: 0, y: 0.29, z: -1.385 }, tipY: 0.03 }, // front wedge (MEASURED slope)
      { shape: "box", halfExtents: { x: 0.577, y: 0.137, z: 0.523 }, offset: { x: -0.57, y: 0.163, z: 1.145 } },
      { shape: "box", halfExtents: { x: 0.57, y: 0.136, z: 0.605 }, offset: { x: 0.578, y: 0.163, z: 1.062 } },
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
    weightLbs: 250,
    weaponWeightLbs: 30,
    bodyDims: { x: 5.07, y: 2.86, z: 3.77 }, // v1 fit 3.9x2.2x2.9 * scale 1.3
    // Two real wheels; probes doubled front/rear inside each wheel footprint.
    wheelAnchors: [
      { x: -1.78, y: 0.5, z: -0.9 },
      { x: 1.78, y: 0.5, z: -0.9 },
      { x: -1.78, y: 0.5, z: 0.9 },
      { x: 1.78, y: 0.5, z: 0.9 },
    ],
    maxSpeedFps: mph(3.682), // 5.40
    accel: 8.4,
    turnRate: 0.72,
    accent: "#3f7bff",
    accentDark: "#e8e9ec",
    weapon: {
      type: "bar",
      spinUpSeconds: 5,
      inertia: 0.75,
      maxOmega: 352,
      budgetCap: 280,
      // MEASURED swept radius: max perpendicular distance from the axle over
      // every blade vertex. 1.29 was the bbox guess and left 3in of visible
      // blade outside the collider.
      radius: 1.539,
      dims: { x: 0.15, y: 1.539, z: 0.2 }, // vertical bar, disc plane Y-Z
      pivot: { x: -0.1, y: 1.35, z: -0.04 },
      axis: { x: 1, y: 0, z: 0 },
      tuning: {
        efficiency: 0.76, impulseScale: 10.0, liftScale: 36.0, liftVelocity: 4.5, liftClearance: 0.55,
        gyroScale: 0.55, halfSpeedPowerMultiplier: 4.0, fullSpeedPowerMultiplier: 2.15, hapticScale: 2.0,
      damageScale: 1.11,
        impactScale: 1.05,
      },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 1.898, y: 0.312, z: 0.284 }, offset: { x: -0.005, y: 1.511, z: 0.065 } }, // bridge
      { shape: "cylinder", axis: "x", radius: 1.462, halfHeight: 0.26, offset: { x: -1.775, y: 1.463, z: 0 } }, // left wheel
      { shape: "cylinder", axis: "x", radius: 1.422, halfHeight: 0.26, offset: { x: 1.685, y: 1.422, z: 0 } }, // right wheel
    ],
  },

  quantum: {
    id: "quantum",
    name: "Quantum",
    tagline: "Hydraulic jaws. Once it bites, it keeps biting.",
    referenceImage: "./public/reference/quantum.png",
    modelPath: "./public/models/quantum.glb",
    modelYaw: Math.PI, // GLB authoring facing -> game -Z forward
    weightLbs: 250,
    weaponWeightLbs: 250, // v1 value: jaw assembly modeled as massive
    bodyDims: { x: 3.0, y: 1.65, z: 2.7 }, // v1 fit, scale 1
    wheelAnchors: [
      { x: -0.83, y: 0.42, z: -0.49 },
      { x: 0.83, y: 0.42, z: -0.49 },
      { x: -0.83, y: 0.42, z: 0.84 },
      { x: 0.83, y: 0.42, z: 0.84 },
    ],
    maxSpeedFps: mph(7.5), // 11.00
    accel: 6.2,
    turnRate: 0.84,
    accent: "#2244cc",
    accentDark: "#101528",
    weapon: {
      type: "crusher",
      spinUpSeconds: 0.2, // jaw close response
      fireAngle: -0.95, // GLB jaw baked OPEN (=rest); full stroke brings the tooth down onto the front wedge palette
      budgetCap: 90,
      dims: { x: 0.14, y: 0.39, z: 0.78 },
      pivot: { x: 0, y: 0.95, z: 0.5 }, // jaw hinge, rear-top
      axis: { x: 1, y: 0, z: 0 },
      tuning: { holdDamagePerSecond: 6, holdReach: 1.1, holdStrength: 14, holdDamping: 1, holdImpulseCap: 70 },
    },
    colliders: [
      // Wedge height is NOT the reason the bite used to slip: measured at rest
      // its underside sits 0.035ft off the deck, and dropping it further just
      // parks the chassis on the wedge and unloads the suspension probes
      // (2s of full throttle moved 0.13ft instead of 19ft).
      { shape: "box", halfExtents: { x: 1.011, y: 0.245, z: 0.747 }, offset: { x: 0, y: 0.352, z: -0.92 } }, // front wedge
      { shape: "box", halfExtents: { x: 0.921, y: 0.118, z: 0.895 }, offset: { x: 0, y: 0.207, z: 0.455 } },
      { shape: "box", halfExtents: { x: 0.95, y: 0.22, z: 0.85 }, offset: { x: 0, y: 0.52, z: 0.25 } }, // merged mid+rear decks
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
    modelScale: 2.35,
    weightLbs: 250,
    weaponWeightLbs: 43,
    // The v1 fit (3.25x1.55x2.35 * 1.2 = 3.9x1.86x2.82) does not describe THIS
    // bot: its fitted colliders span 1.38x0.69x2.45 and the model at
    // modelScale 2.35 is 1.43x0.65x2.35. bodyDims only feeds inertia, damage
    // zones and placeholders, so the stale figure showed up as roll inertia
    // ~7x too high on a 1.28ft track — a slow underdamped wallow every time you
    // turned. Matched to the collider shell instead.
    bodyDims: { x: 1.5, y: 0.85, z: 2.5 },
    // Four equal wheels sit at one height; the 0.15/0.18 split was fit noise
    // and left the rear springs statically under-compressed, adding a pitch
    // bias on top of the roll.
    wheelAnchors: [
      { x: -0.64, y: 0.17, z: -0.4 },
      { x: 0.64, y: 0.17, z: -0.4 },
      { x: -0.64, y: 0.17, z: 0.8 },
      { x: 0.64, y: 0.17, z: 0.8 },
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
      radius: 0.44,
      dims: { x: 0.5, y: 0.44, z: 0.44 },
      pivot: { x: 0, y: 0.38, z: -0.69 },
      axis: { x: 1, y: 0, z: 0 },
      tuning: { efficiency: 0.52, impulseScale: 8.5, liftScale: 30.0, liftVelocity: 4.5, liftClearance: 0.55, gyroScale: 0.85, damageScale: 0.87 },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 0.691, y: 0.213, z: 0.943 }, offset: { x: -0.001, y: 0.304, z: 0.252 } },
      { shape: "wedge", halfExtents: { x: 0.691, y: 0.21, z: 0.18 }, offset: { x: -0.001, y: 0.21, z: -1.0 }, tipY: 0.03 }, // front wedge (MEASURED slope)
      { shape: "box", halfExtents: { x: 0.691, y: 0.133, z: 0.133 }, offset: { x: -0.001, y: 0.651, z: -0.32 } }, // fin rail
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
    weightLbs: 250,
    weaponWeightLbs: 70,
    bodyDims: { x: 2.1, y: 0.81, z: 1.72 }, // v1 fit 3x1.15x2.45 * scale 0.7
    wheelAnchors: [
      { x: -0.6, y: 0.26, z: -0.3 },
      { x: 0.6, y: 0.26, z: -0.3 },
      { x: -0.6, y: 0.26, z: 0.6 },
      { x: 0.6, y: 0.26, z: 0.6 },
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
      radius: 0.34,
      dims: { x: 0.39, y: 0.34, z: 0.34 },
      pivot: { x: 0, y: 0.27, z: -0.56 },
      axis: { x: 1, y: 0, z: 0 },
      tuning: { efficiency: 0.26, impulseScale: 4.4, kickbackScale: 0.12, liftScale: 18.0, liftVelocity: 4.0, liftClearance: 0.35, gyroScale: 1.45, damageScale: 0.62 },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 0.686, y: 0.163, z: 0.694 }, offset: { x: -0.001, y: 0.271, z: 0.142 } },
      { shape: "box", halfExtents: { x: 0.162, y: 0.256, z: 0.487 }, offset: { x: -0.6, y: 0.256, z: 0.167 } }, // left pod
      { shape: "box", halfExtents: { x: 0.162, y: 0.256, z: 0.546 }, offset: { x: 0.599, y: 0.256, z: 0.108 } }, // right pod
      { shape: "wedge", halfExtents: { x: 0.56, y: 0.15, z: 0.1 }, offset: { x: 0, y: 0.15, z: -0.89 }, tipY: 0.03 }, // fork row (MEASURED slope)
    ],
  },

  sawblaze: {
    id: "sawblaze",
    name: "Sawblaze",
    tagline: "Scoop, trap, and bring the saw down.",
    referenceImage: "./public/reference/sawblaze.png",
    modelPath: "./public/models/sawblaze.glb",
    modelYaw: Math.PI / 2, // GLB authoring facing -> game -Z forward
    weightLbs: 250,
    weaponWeightLbs: 30,
    bodyDims: { x: 2.6, y: 1.8, z: 2.0 }, // v1 fit 3.25x2.25x2.5 * scale 0.8
    wheelAnchors: [
      { x: -0.55, y: 0.2, z: -0.75 }, // front skids under the pan
      { x: 0.55, y: 0.2, z: -0.75 },
      { x: -0.95, y: 0.32, z: 0.73 }, // rear drive wheels
      { x: 0.95, y: 0.32, z: 0.73 },
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
      radius: 0.46,
      // Whole arc rotated ~18deg back from the v1 numbers (1.7 / -0.85): at the
      // old fireAngle the saw's rim swung to 0.09ft BELOW the floor plane and
      // disappeared into it at the bottom of every chop.
      restAngle: 2.02, // rest: arm raked back past vertical, saw hanging behind (GLB baked pose is mid-swing)
      fireAngle: -0.53, // full stroke chops down-forward into the fork zone, rim stopping just above the floor
      dims: { x: 0.09, y: 0.46, z: 0.46 }, // saw disc at arm tip
      pivot: { x: 0, y: 1.1, z: 0.35 }, // arm hinge, rear-top; saw center ~(0,0.93,-0.52)
      axis: { x: 1, y: 0, z: 0 },
      tuning: { sawTouchCap: 10, sawCenter: { x: 0, y: 0.935, z: -0.52 }, swingSeconds: 0.35, grindDamagePerSecond: 5, gyroScale: 0.8 },
    },
    colliders: [
      { shape: "wedge", halfExtents: { x: 1.023, y: 0.185, z: 0.215 }, offset: { x: 0, y: 0.185, z: -0.855 }, tipY: 0.03 }, // front wedge (MEASURED slope)
      { shape: "box", halfExtents: { x: 1.023, y: 0.143, z: 0.82 }, offset: { x: 0, y: 0.226, z: 0.18 } }, // merged pan floor
      { shape: "box", halfExtents: { x: 1.009, y: 0.154, z: 0.507 }, offset: { x: 0.005, y: 0.53, z: 0.474 } },
      { shape: "box", halfExtents: { x: 0.283, y: 0.328, z: 0.471 }, offset: { x: -0.031, y: 1.171, z: -0.164 } }, // tower
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
    weightLbs: 250,
    weaponWeightLbs: 80,
    bodyDims: { x: 2.68, y: 0.98, z: 2.04 }, // v1 fit 3.35x1.22x2.55 * scale 0.8
    wheelAnchors: [
      { x: -0.5, y: 0.25, z: -0.55 }, // front blade-support skids
      { x: 0.5, y: 0.25, z: -0.55 },
      { x: -1.05, y: 0.39, z: 0.36 }, // rear tires
      { x: 1.04, y: 0.39, z: 0.36 },
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
      radius: 1.359, // MEASURED swept radius (bbox guess was 1.21)
      dims: { x: 1.359, y: 0.12, z: 0.3 }, // horizontal bar, spins around Y
      pivot: { x: 0, y: 0.22, z: -0.72 },
      axis: { x: 0, y: 1, z: 0 },
      tuning: {
        efficiency: 0.86, impulseScale: 18.0, kickbackScale: 1.45, liftScale: 7.0, liftVelocity: 4.5, liftClearance: 0.55,
        gyroScale: 1.35, reach: 2.25, impactScale: 1.55, damageScale: 0.92,
        floorLaunch: { enabled: true, angleDeg: 30, scale: 1.15, cap: 180 },
      },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 0.708, y: 0.283, z: 0.557 }, offset: { x: -0.025, y: 0.438, z: 0.425 } },
      { shape: "box", halfExtents: { x: 0.366, y: 0.132, z: 0.6 }, offset: { x: -0.025, y: 0.549, z: -0.348 } }, // front spine
      { shape: "box", halfExtents: { x: 0.285, y: 0.394, z: 0.48 }, offset: { x: -1.051, y: 0.389, z: 0.363 } }, // left tire block
      { shape: "box", halfExtents: { x: 0.29, y: 0.395, z: 0.49 }, offset: { x: 1.039, y: 0.385, z: 0.363 } }, // right tire block
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
    modelScale: 2.9,
    // Beta's wheels live inside the shell and did not segment out, so the
    // procedural fallback would poke cylinders through the bodywork.
    hideWheels: true,
    weightLbs: 250,
    weaponWeightLbs: 24, // 11 kg head
    bodyDims: { x: 2.77, y: 1.09, z: 2.49 }, // MEASURED shell at modelScale 2.9
    wheelAnchors: [
      { x: -0.95, y: 0.2, z: -0.85 },
      { x: 0.95, y: 0.2, z: -0.85 },
      { x: -0.95, y: 0.2, z: 0.65 },
      { x: 0.95, y: 0.2, z: 0.65 },
    ],
    maxSpeedFps: mph(8), // 11.73
    accel: 7.0,
    turnRate: 0.95,
    accent: "#b9bcc0",
    accentDark: "#17181c",
    weapon: {
      type: "hammer",
      pivot: { x: 0.04, y: 0.87, z: -0.41 }, // MEASURED gearbox hinge, game space
      axis: { x: 1, y: 0, z: 0 },
      restAngle: 0, // GLB is baked cocked: head up and back over the tail
      // MEASURED through the loader (game space, model grounded): at -2.72 the
      // head bottoms out 0.05ft above the floor, ~1ft past the nose; a shade
      // further and it digs in. Negative because modelYaw PI flips the model's
      // lateral axis relative to the catalog's +X convention.
      fireAngle: -2.72,
      budgetCap: 320, // heavy single impact
      dims: { x: 0.16, y: 0.5, z: 0.16 },
      downforce: 120, // lbf of magnet, held on while grounded
      reactionScale: 0.15, // magnets eat the strike reaction
      selfRightRate: 5.5, // rad/s of pitch when fired while inverted
      tuning: { strokeSeconds: 0.22, returnSeconds: 0.9, reach: 1.8 },
    },
    colliders: [
      // Truncated pyramid, four stacked slabs (MEASURED y-slices of the shell).
      { shape: "wedge", halfExtents: { x: 1.3, y: 0.225, z: 0.325 }, offset: { x: 0, y: 0.225, z: -0.925 }, tipY: 0.03 }, // front wedge (MEASURED slope)
      { shape: "box", halfExtents: { x: 1.3, y: 0.14, z: 0.74 }, offset: { x: 0, y: 0.14, z: 0.14 } },
      { shape: "box", halfExtents: { x: 0.95, y: 0.16, z: 1.0 }, offset: { x: 0, y: 0.44, z: -0.05 } },
      { shape: "box", halfExtents: { x: 0.6, y: 0.13, z: 0.7 }, offset: { x: 0, y: 0.73, z: -0.15 } },
      { shape: "box", halfExtents: { x: 0.25, y: 0.12, z: 0.2 }, offset: { x: 0, y: 0.97, z: -0.3 } }, // hammer gearbox
    ],
  },

  whiplash: {
    id: "whiplash",
    name: "Whiplash",
    tagline: "Lift them, then bury the disc.",
    referenceImage: "./public/reference/whiplash.png",
    modelPath: "./public/models/whiplash.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X, game wants -Z
    modelScale: 3.19, // colliders below are authored at this scale
    weightLbs: 250,
    weaponWeightLbs: 22, // the disc
    bodyDims: { x: 2.2, y: 1.15, z: 3.1 }, // MEASURED shell at modelScale 3.19
    // Four exposed wheels, MEASURED from the GLB wheel pivots. Both pairs sit
    // in the rear half — the front of the chassis is all arm and forks.
    wheelAnchors: [
      { x: -1.07, y: 0.23, z: -0.14 },
      { x: 1.07, y: 0.23, z: -0.14 },
      { x: -1.08, y: 0.23, z: 1.12 },
      { x: 1.08, y: 0.23, z: 1.12 },
    ],
    maxSpeedFps: 16.0, // known for its driving
    accel: 8.5,
    turnRate: 1.1,
    accent: "#d8e021",
    accentDark: "#141414",
    weapon: {
      type: "lifterDisc",
      pivot: { x: 0, y: 0.88, z: 1.4 }, // MEASURED rear hinge, game space
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
      dims: { x: 0.14, y: 0.42, z: 0.42 },
      disc: {
        spinUpSeconds: 1.4,
        maxOmega: 380,
        inertia: 0.55,
        budgetCap: 90, // moderate per-hit; damage comes from repetition
        contactDamagePerSecond: 14,
      },
      tuning: { strokeSeconds: 0.5, reach: 1.5, hapticScale: 1.2 },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 1.05, y: 0.285, z: 1.28 }, offset: { x: 0, y: 0.35, z: 0.32 } }, // chassis
      { shape: "box", halfExtents: { x: 0.53, y: 0.28, z: 0.45 }, offset: { x: 0, y: 0.89, z: 1.05 } }, // arm tower
      { shape: "wedge", halfExtents: { x: 0.59, y: 0.13, z: 0.345 }, offset: { x: 0, y: 0.13, z: -1.255 }, tipY: 0.03 }, // fork plate (MEASURED slope)
    ],
  },

  clawviper: {
    id: "clawviper",
    name: "Claw Viper",
    tagline: "Grab, lift, suplex.",
    referenceImage: "./public/reference/clawviper.png",
    modelPath: "./public/models/clawviper.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X (weaponAxis [0,0,1] pre-yaw)
    modelScale: 3.2, // colliders below are authored at this scale
    weightLbs: 250,
    weaponWeightLbs: 40,
    bodyDims: { x: 2.2, y: 0.9, z: 2.9 }, // MEASURED shell
    // Both wheel pairs sit in the rear half — the front is all forks.
    wheelAnchors: [
      { x: -0.78, y: 0.22, z: 0.06 },
      { x: 0.78, y: 0.22, z: 0.06 },
      { x: -0.78, y: 0.22, z: 1.34 },
      { x: 0.78, y: 0.22, z: 1.34 },
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
      pivot: { x: 0, y: 0.581, z: 0.61 }, // game space, via the loader
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED through the loader (game space, model grounded). The baked
      // pose already has the forks flat on the deck, and the arm lifts on
      // POSITIVE angle here — the drop's -2.1 drove the forks under the floor.
      restAngle: 0, // forks flat on the deck — they are also the wedge
      liftAngle: 1.5, // ~86deg: past vertical for the suplex, arm still clear of the floor
      liftSeconds: 0.7,
      lowerSeconds: 0.9,
      gripReach: 1.6, // where a gripped bot rides: on the fork blades
      gripHeight: 0.4,
      gripStrength: 16,
      throwScale: 0.6, // share of the arm's tip speed handed over on release
      downforceLbs: 250, // magnets: very hard to shove or flip
      dims: { x: 0.2, y: 0.2, z: 0.5 },
      // MEASURED: at -0.9 the jaw shuts onto the red fork tip it grips against.
      claw: { openAngle: 0, closedAngle: -0.9, clampSeconds: 0.25 },
      tuning: { reach: 1.4, holdDamagePerSecond: 3 },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 1.0, y: 0.24, z: 1.32 }, offset: { x: 0, y: 0.27, z: 0.22 } },
      { shape: "box", halfExtents: { x: 0.6, y: 0.16, z: 0.7 }, offset: { x: 0, y: 0.68, z: 0.6 } },
    ],
  },

  deepsix: {
    id: "deepsix",
    name: "Deep Six",
    tagline: "Banned for hitting too hard.",
    referenceImage: "./public/reference/deepsix.png",
    modelPath: "./public/models/deepsix.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 3.6,
    // Splayed forks make it wider than it is long — that is the real machine.
    hideWheels: true, // 2WD tucked inside the shell; nothing segmented out
    weightLbs: 250,
    weaponWeightLbs: 80, // post-rule-change blade
    bodyDims: { x: 3.6, y: 1.84, z: 2.75 }, // MEASURED shell
    // The outrigger forks ARE the support base, so the probes ride on them.
    wheelAnchors: [
      { x: -1.3, y: 0.2, z: -0.9 },
      { x: 1.3, y: 0.2, z: -0.9 },
      { x: -1.3, y: 0.2, z: 0.9 },
      { x: 1.3, y: 0.2, z: 0.9 },
    ],
    maxSpeedFps: 12.0,
    accel: 7.0,
    turnRate: 0.9,
    accent: "#b1642f",
    accentDark: "#141414",
    weapon: {
      type: "bar",
      pivot: { x: 0.08, y: 1.62, z: -0.02 }, // MEASURED hub, game space
      axis: { x: 1, y: 0, z: 0 },
      spinUpSeconds: 4.5, // enormous inertia: slow, dramatic spool-up
      inertia: 1.9,
      maxOmega: 420,
      budgetCap: 620, // the hardest hit in the game
      // MEASURED swept radius: the max perpendicular distance from the axle
      // over every blade vertex, NOT the bbox at the baked pose. The S-blade is
      // asymmetric, so its bbox reads 1.26 and undersized the collider until it
      // sat entirely inside the chassis and could not touch anything.
      radius: 1.368,
      dims: { x: 0.06, y: 1.368, z: 1.368 },
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
      { shape: "box", halfExtents: { x: 1.8, y: 0.25, z: 0.79 }, offset: { x: 0, y: 0.25, z: 0.59 } }, // chassis pan
      { shape: "box", halfExtents: { x: 0.46, y: 0.68, z: 0.33 }, offset: { x: 0, y: 1.18, z: 0.23 } }, // blade tower
    ],
  },

  hydra: {
    id: "hydra",
    name: "Hydra",
    tagline: "Sends them to the ceiling.",
    referenceImage: "./public/reference/hydra.png",
    modelPath: "./public/models/hydra.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 3.3,
    hideWheels: true, // drive is enclosed under a very low chassis
    weightLbs: 250,
    weaponWeightLbs: 45,
    bodyDims: { x: 2.65, y: 0.92, z: 3.15 }, // MEASURED shell — very low and flat
    wheelAnchors: [
      { x: -1.0, y: 0.2, z: -1.0 },
      { x: 1.0, y: 0.2, z: -1.0 },
      { x: -1.0, y: 0.2, z: 1.0 },
      { x: 1.0, y: 0.2, z: 1.0 },
    ],
    maxSpeedFps: 16.5,
    accel: 9.0,
    turnRate: 1.1,
    accent: "#6b3fa0",
    accentDark: "#12141a",
    weapon: {
      type: "flipper",
      pivot: { x: 0, y: 0.64, z: 0.79 }, // MEASURED rear hinge, game space
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED through the loader (game space, model grounded): -0.55 is
      // where the plate's lip reaches the floor (arm low point -0.003), so it
      // rests as a wedge along the deck. The baked pose (0) is fired.
      restAngle: -0.55,
      fireAngle: 0,
      budgetCap: 520, // 450+ lb of flip
      dims: { x: 1.1, y: 0.09, z: 1.5 },
      selfRight: true, // hydraulics only right it by firing against the floor
      tuning: { strokeSeconds: 0.1, returnSeconds: 4.0, reach: 1.9, liftVelocity: 30.0 },
    },
    colliders: [
      { shape: "wedge", halfExtents: { x: 1.25, y: 0.12, z: 0.23 }, offset: { x: 0, y: 0.12, z: -1.33 }, tipY: 0.03 }, // front wedge (MEASURED slope)
      { shape: "box", halfExtents: { x: 1.25, y: 0.2, z: 1.35 }, offset: { x: 0, y: 0.2, z: 0.25 } },
      { shape: "box", halfExtents: { x: 1.0, y: 0.26, z: 1.0 }, offset: { x: 0, y: 0.66, z: 0.6 } },
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
    modelScale: 3.2,
    weightLbs: 250,
    weaponWeightLbs: 40,
    bodyDims: { x: 2.59, y: 1.34, z: 3.2 }, // MEASURED shell
    // Only the rear pair segmented out; the fronts are inboard under the deck.
    wheelAnchors: [
      { x: -0.95, y: 0.3, z: -0.85 },
      { x: 0.95, y: 0.3, z: -0.85 },
      { x: -0.95, y: 0.3, z: 0.85 },
      { x: 0.95, y: 0.3, z: 0.85 },
    ],
    maxSpeedFps: 17.0,
    accel: 9.5,
    turnRate: 1.1,
    accent: "#2f6fd0",
    accentDark: "#14161b",
    weapon: {
      type: "flipper",
      pivot: { x: 0, y: 0.61, z: 0.85 }, // MEASURED rear hinge, game space
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED through the loader: the plate is baked FLAT in the deck (0)
      // and 1.15 stands it on end. Blip throws straight up off a flywheel, so
      // there is no forward reach in the stroke — it is all elevation.
      restAngle: 0,
      fireAngle: 1.15,
      budgetCap: 200,
      dims: { x: 0.46, y: 0.1, z: 0.64 },
      selfRight: true,
      tuning: { strokeSeconds: 0.06, returnSeconds: 0.7, reach: 1.5, liftVelocity: 26.0, pitchVelocity: 11.0 },
    },
    colliders: [
      // The forks. MEASURED at y 0.17-0.32 in the model, but authored down to
      // the floor: on the real machine they scrape, and a fork a fifth of a foot
      // in the air is a fork nothing can climb.
      { shape: "wedge", halfExtents: { x: 0.62, y: 0.17, z: 0.44 }, offset: { x: 0, y: 0.17, z: -1.16 }, tipY: 0.03 },
      // The whole shell IS a wedge: MEASURED 0.53ft tall at z=-0.6 climbing to
      // 1.34 at the tail.
      { shape: "wedge", halfExtents: { x: 1.29, y: 0.6, z: 0.8 }, offset: { x: 0, y: 0.6, z: 0.2 }, tipY: 0.3 },
      { shape: "box", halfExtents: { x: 1.29, y: 0.67, z: 0.3 }, offset: { x: 0, y: 0.67, z: 1.3 } },
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
    modelScale: 3.3,
    canDriveInverted: true, // symmetrical drum bot; it fights either way up
    weightLbs: 250,
    weaponWeightLbs: 50,
    // MEASURED shell. The two whiskers reaching 2.08 are its antennae, not
    // structure, so the height here is the deck, not the bounding box.
    bodyDims: { x: 3.17, y: 1.45, z: 3.27 },
    wheelAnchors: [
      { x: -1.3, y: 0.5, z: -0.9 },
      { x: 1.3, y: 0.5, z: -0.9 },
      { x: -1.3, y: 0.5, z: 0.9 },
      { x: 1.3, y: 0.5, z: 0.9 },
    ],
    maxSpeedFps: 14.0,
    accel: 8.0,
    turnRate: 1.0,
    accent: "#c1743a",
    accentDark: "#16181c",
    weapon: {
      type: "drum",
      pivot: { x: 0.04, y: 0.71, z: -0.96 }, // MEASURED drum axle, game space
      axis: { x: 1, y: 0, z: 0 },
      spinUpSeconds: 1.6,
      inertia: 1.25,
      maxOmega: 560,
      budgetCap: 340,
      radius: 0.545, // MEASURED swept radius about the axle
      dims: { x: 0.9, y: 0.545, z: 0.545 },
      tuning: { efficiency: 0.58, impulseScale: 10.5, liftScale: 30.0, liftVelocity: 4.5, gyroScale: 1.0 },
    },
    // NOTHING in front of z=-0.36, which is where the drum's sweep ends. The
    // model does carry a deck lip out to z=-1.6, but it sits at y 1.02-1.23 —
    // level with the top of the drum — so a collider there would be a pure
    // stand-off: opponents would stop on the lip with the drum still a foot
    // short of them. Same call as Deep Six, for the same reason.
    colliders: [
      { shape: "box", halfExtents: { x: 1.55, y: 0.62, z: 0.98 }, offset: { x: 0, y: 0.65, z: 0.62 } },
    ],
  },

  duck: {
    id: "duck",
    name: "Duck",
    tagline: "Never counted out.",
    referenceImage: "./public/reference/duck.png",
    modelPath: "./public/models/duck.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelRoll: Math.PI, // MEASURED: Tripo built it upside down (wheels on top)
    modelScale: 4.2,
    weightLbs: 250,
    weaponWeightLbs: 35,
    bodyDims: { x: 3.21, y: 0.92, z: 2.75 }, // MEASURED shell — very flat
    wheelAnchors: [
      { x: -1.45, y: 0.3, z: -0.95 },
      { x: 1.45, y: 0.3, z: -0.95 },
      { x: -1.45, y: 0.3, z: 1.13 },
      { x: 1.45, y: 0.3, z: 1.13 },
    ],
    maxSpeedFps: 13.0,
    accel: 7.5,
    turnRate: 0.95,
    accent: "#d8b62c",
    accentDark: "#1a1a1a",
    weapon: {
      type: "lifter",
      pivot: { x: 0.23, y: 0.88, z: -1.02 }, // MEASURED scoop hinge, game space
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED: the scoop is baked DOWN (0 rests its lip on the floor at
      // y 0.008) and 1.1 stands it up over the nose. That resting pose is why
      // the front collider below is a wedge.
      restAngle: 0,
      fireAngle: 1.1,
      liftImpulse: 190,
      liftRecoil: 0.5,
      lowerSeconds: 0.6,
      dims: { x: 1.4, y: 0.12, z: 0.5 },
      selfRight: true,
      tuning: { strokeSeconds: 0.45, reach: 1.7 },
    },
    colliders: [
      // The scoop at rest. MEASURED z -2.03..-1.03 climbing from the floor to
      // 0.56 — the flattest, longest wedge in the game, which is the whole bot.
      { shape: "wedge", halfExtents: { x: 1.6, y: 0.28, z: 0.5 }, offset: { x: 0, y: 0.28, z: -1.53 }, tipY: 0.02 },
      { shape: "box", halfExtents: { x: 1.61, y: 0.28, z: 1.21 }, offset: { x: 0, y: 0.28, z: 0.17 } },
      { shape: "box", halfExtents: { x: 1.0, y: 0.46, z: 0.18 }, offset: { x: 0, y: 0.46, z: -1.13 } }, // hinge block
    ],
  },

  endgame: {
    id: "endgame",
    name: "Endgame",
    tagline: "Teardrop disc, and it never misses twice.",
    referenceImage: "./public/reference/endgame.png",
    modelPath: "./public/models/endgame.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 3.4,
    hideWheels: true, // drive is inboard; segmentation never saw a wheel
    weightLbs: 250,
    weaponWeightLbs: 55,
    bodyDims: { x: 3.4, y: 1.76, z: 2.31 }, // MEASURED shell
    wheelAnchors: [
      { x: -1.3, y: 0.25, z: -0.7 },
      { x: 1.3, y: 0.25, z: -0.7 },
      { x: -1.3, y: 0.25, z: 0.7 },
      { x: 1.3, y: 0.25, z: 0.7 },
    ],
    maxSpeedFps: 15.0,
    accel: 8.5,
    turnRate: 1.05,
    accent: "#e8502a",
    accentDark: "#191c24",
    weapon: {
      type: "drum",
      pivot: { x: 0.07, y: 0.82, z: -0.41 }, // MEASURED disc axle, game space
      axis: { x: 1, y: 0, z: 0 },
      spinUpSeconds: 0.9,
      inertia: 1.4,
      maxOmega: 640,
      budgetCap: 400,
      // MEASURED swept radius. The blade is a TEARDROP: its axle is at the fat
      // end, so the bbox centre is 0.29ft off the real hub and the swept
      // circle is set by the tip, not by half the height.
      radius: 0.777,
      dims: { x: 0.36, y: 0.777, z: 0.777 },
      tuning: { efficiency: 0.6, impulseScale: 11.5, liftScale: 30.0, liftVelocity: 5.0, gyroScale: 1.1 },
    },
    colliders: [
      // The two lettered forks, LEFT and RIGHT of the disc with a clear gap
      // between them: the disc sweeps down to y 0.04 and out to z -0.91, and
      // anything spanning the centreline there would hold opponents off it.
      { shape: "wedge", halfExtents: { x: 0.6, y: 0.42, z: 0.4 }, offset: { x: -1.1, y: 0.42, z: -0.75 }, tipY: 0.05 },
      { shape: "wedge", halfExtents: { x: 0.6, y: 0.42, z: 0.4 }, offset: { x: 1.1, y: 0.42, z: -0.75 }, tipY: 0.05 },
      { shape: "box", halfExtents: { x: 1.58, y: 0.5, z: 0.75 }, offset: { x: 0, y: 0.5, z: 0.41 } },
    ],
  },

  freeshipping: {
    id: "freeshipping",
    name: "Free Shipping",
    tagline: "Forklift in front, flame out the back.",
    referenceImage: "./public/reference/freeshipping.png",
    modelPath: "./public/models/freeshipping.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 3.4,
    weightLbs: 250,
    weaponWeightLbs: 45,
    bodyDims: { x: 2.19, y: 0.9, z: 3.25 }, // MEASURED shell
    wheelAnchors: [
      { x: -0.86, y: 0.3, z: -1.0 },
      { x: 0.86, y: 0.3, z: -1.0 },
      { x: -0.8, y: 0.3, z: 1.33 },
      { x: 0.8, y: 0.3, z: 1.33 },
    ],
    maxSpeedFps: 14.5,
    accel: 8.0,
    turnRate: 1.0,
    accent: "#d94b2b",
    accentDark: "#17181b",
    weapon: {
      type: "lifter",
      pivot: { x: 0, y: 0.63, z: 0.61 }, // MEASURED mast hinge, game space
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED: the GLB bakes the mast RAISED, so rest is -0.43 (fork tips
      // on the floor at y 0.00) and 0.30 hoists them to about 1.7ft — a
      // forklift, not a flipper.
      restAngle: -0.43,
      fireAngle: 0.3,
      liftImpulse: 165,
      liftRecoil: 0.5,
      lowerSeconds: 0.7,
      dims: { x: 0.26, y: 0.12, z: 1.2 },
      selfRight: true,
      // The flamethrowers. Static geometry on the model, so they are a damage
      // cone on the alt channel rather than a rigged part: no shove, no
      // knockdown, just a steady burn on whatever is held in front.
      flame: { damagePerSecond: 9, reach: 3.2 },
      tuning: { strokeSeconds: 0.5, reach: 1.8 },
    },
    colliders: [
      // MEASURED wedge: the nose is on the floor at z=-1.62 and 0.54 tall by
      // z=-0.88. This is the cleanest wedge in the drop.
      { shape: "wedge", halfExtents: { x: 1.02, y: 0.27, z: 0.37 }, offset: { x: 0, y: 0.27, z: -1.25 }, tipY: 0.02 },
      { shape: "box", halfExtents: { x: 0.96, y: 0.33, z: 0.64 }, offset: { x: 0, y: 0.33, z: -0.24 } },
      { shape: "box", halfExtents: { x: 0.93, y: 0.45, z: 0.62 }, offset: { x: 0, y: 0.45, z: 1.01 } },
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
    modelScale: 3.0,
    weightLbs: 250,
    weaponWeightLbs: 40,
    bodyDims: { x: 2.64, y: 3.0, z: 2.42 }, // MEASURED frame
    wheelAnchors: [
      { x: -1.2, y: 0.25, z: -0.9 },
      { x: 1.2, y: 0.25, z: -0.9 },
      { x: -1.16, y: 0.25, z: 0.57 },
      { x: 1.16, y: 0.25, z: 0.57 },
    ],
    maxSpeedFps: 11.0,
    accel: 5.5,
    turnRate: 0.7,
    accent: "#8a5a2c",
    accentDark: "#1b1c20",
    weapon: {
      type: "bar",
      pivot: { x: 0, y: 1.59, z: -0.48 }, // MEASURED hub, game space
      axis: { x: 1, y: 0, z: 0 },
      spinUpSeconds: 2.4,
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
      radius: 1.0,
      dims: { x: 0.3, y: 1.0, z: 1.0 },
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
      { shape: "wedge", halfExtents: { x: 1.3, y: 0.62, z: 0.5 }, offset: { x: 0, y: 0.62, z: -0.7 }, tipY: 0.05 },
      // Chassis stops at y 1.04 so the disc's lower sweep is clear.
      { shape: "box", halfExtents: { x: 1.32, y: 0.52, z: 0.55 }, offset: { x: 0, y: 0.52, z: 0.2 } },
      // Truss, sitting BEHIND the disc so the disc's leading face is exposed.
      { shape: "box", halfExtents: { x: 0.62, y: 0.98, z: 0.4 }, offset: { x: 0, y: 2.02, z: 0.05 } },
      { shape: "box", halfExtents: { x: 0.88, y: 0.36, z: 0.23 }, offset: { x: 0, y: 0.83, z: 0.98 } }, // rear outriggers
    ],
  },

  overhaul: {
    id: "overhaul",
    name: "Overhaul",
    tagline: "Grab it, lift it, hold it.",
    referenceImage: "./public/reference/overhaul.png",
    modelPath: "./public/models/overhaul.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 3.8,
    weightLbs: 250,
    weaponWeightLbs: 45,
    bodyDims: { x: 2.94, y: 1.48, z: 3.17 }, // MEASURED shell
    wheelAnchors: [
      { x: -1.14, y: 0.44, z: -0.95 },
      { x: 1.14, y: 0.44, z: -0.95 },
      { x: -1.14, y: 0.42, z: 1.07 },
      { x: 1.14, y: 0.42, z: 1.07 },
    ],
    maxSpeedFps: 15.5,
    accel: 8.5,
    turnRate: 1.05,
    accent: "#cf3b3b",
    accentDark: "#17171a",
    weapon: {
      type: "grappler",
      pivot: { x: 0, y: 0.9, z: 0.25 }, // MEASURED lift hinge, game space
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED: the arm is baked RAISED, so -0.26 drops the fork tips to the
      // floor and 0.55 hoists them. Grabbing needs the forks DOWN, which is why
      // the sim only takes a grip below a third of the lift stroke.
      restAngle: -0.26,
      liftAngle: 0.55,
      liftSeconds: 0.6,
      lowerSeconds: 0.8,
      gripReach: 1.6,
      gripHeight: 0.4,
      gripStrength: 15,
      throwScale: 0.55,
      dims: { x: 0.2, y: 0.2, z: 0.5 },
      selfRight: true,
      claw: { openAngle: 0, closedAngle: -0.9, clampSeconds: 0.3 },
      tuning: { reach: 1.6, holdDamagePerSecond: 3 },
    },
    colliders: [
      // MEASURED front skirt: z -1.58..-0.86 at y 0.20-0.44, authored down to
      // the floor so opponents can climb it into the forks.
      { shape: "wedge", halfExtents: { x: 1.27, y: 0.22, z: 0.36 }, offset: { x: 0, y: 0.22, z: -1.22 }, tipY: 0.02 },
      { shape: "box", halfExtents: { x: 1.47, y: 0.52, z: 0.63 }, offset: { x: 0, y: 0.52, z: -0.23 } },
      { shape: "box", halfExtents: { x: 0.99, y: 0.74, z: 0.63 }, offset: { x: 0, y: 0.74, z: 0.42 } },
      { shape: "box", halfExtents: { x: 1.01, y: 0.35, z: 0.27 }, offset: { x: 0, y: 0.35, z: 1.31 } },
    ],
  },

  shatter: {
    id: "shatter",
    name: "Shatter",
    tagline: "One hammer, straight down.",
    referenceImage: "./public/reference/shatter.png",
    modelPath: "./public/models/shatter.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 3.2,
    hideWheels: true, // omni drive enclosed by the side armour
    weightLbs: 250,
    weaponWeightLbs: 50,
    bodyDims: { x: 1.88, y: 0.86, z: 3.2 }, // MEASURED shell — long and narrow
    wheelAnchors: [
      { x: -0.75, y: 0.25, z: -0.9 },
      { x: 0.75, y: 0.25, z: -0.9 },
      { x: -0.75, y: 0.25, z: 1.1 },
      { x: 0.75, y: 0.25, z: 1.1 },
    ],
    maxSpeedFps: 14.0,
    accel: 8.0,
    turnRate: 1.15,
    accent: "#8f6fd0",
    accentDark: "#141019",
    weapon: {
      type: "hammer",
      pivot: { x: 0, y: 0.67, z: 0.1 }, // MEASURED gearbox hinge, game space
      axis: { x: 1, y: 0, z: 0 },
      // MEASURED: the GLB bakes the hammer COCKED — up and back over the tail —
      // so rest is 0 and -2.45 brings the head over the top and down onto the
      // floor at the nose (arm low point 0.00, tip out at z -1.53).
      restAngle: 0,
      fireAngle: -2.45,
      budgetCap: 300,
      dims: { x: 0.16, y: 0.5, z: 0.16 },
      selfRight: true,
      tuning: { strokeSeconds: 0.2, returnSeconds: 0.85, reach: 1.9 },
    },
    colliders: [
      // The two front forks — MEASURED thin (|x| <= 0.39) and on the floor.
      { shape: "wedge", halfExtents: { x: 0.39, y: 0.145, z: 0.5 }, offset: { x: 0, y: 0.145, z: -1.1 }, tipY: 0.02 },
      // The body is itself a wedge: 0.28 tall where the forks meet it, 0.86 by
      // the time it reaches the hammer's gearbox.
      { shape: "wedge", halfExtents: { x: 0.94, y: 0.43, z: 0.4 }, offset: { x: 0, y: 0.43, z: -0.2 }, tipY: 0.28 },
      { shape: "box", halfExtents: { x: 0.85, y: 0.43, z: 0.7 }, offset: { x: 0, y: 0.43, z: 0.9 } },
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
    modelScale: 3.4,
    hideWheels: true, // drive enclosed by the side pods
    weightLbs: 250,
    weaponWeightLbs: 40,
    bodyDims: { x: 2.8, y: 1.01, z: 3.2 }, // MEASURED shell
    wheelAnchors: [
      { x: -1.1, y: 0.25, z: -0.9 },
      { x: 1.1, y: 0.25, z: -0.9 },
      { x: -1.1, y: 0.25, z: 0.9 },
      { x: 1.1, y: 0.25, z: 0.9 },
    ],
    maxSpeedFps: 15.0,
    accel: 8.5,
    turnRate: 1.05,
    accent: "#e2701f",
    accentDark: "#141a1c",
    weapon: {
      type: "drum",
      pivot: { x: 0.02, y: 0.74, z: -1.41 }, // MEASURED axle, game space
      axis: { x: 1, y: 0, z: 0 },
      spinUpSeconds: 1.1,
      inertia: 1.0,
      maxOmega: 600,
      budgetCap: 300,
      // Tripo built the drum as a SLIM BAR: swept radius measures 0.145, which
      // is a third of the real machine's drum and would leave it unable to
      // touch anything with 0.6ft of air under the axle. 0.30 is the radius the
      // reference photo's drum actually has. Same call as Minotaur's unmodelled
      // notches — the collider follows the robot, not the segmentation.
      radius: 0.3,
      dims: { x: 0.51, y: 0.3, z: 0.3 },
      // The fists punch on the alt channel, independent of the drum.
      fists: {
        openAngle: 0, punchAngle: -0.85, punchSeconds: 0.18,
        impulse: 90, damagePerHit: 2.5, reach: 1.1,
        axis: { x: 1, y: 0, z: 0 },
      },
      tuning: { efficiency: 0.55, impulseScale: 10.0, liftScale: 28.0, liftVelocity: 4.5, gyroScale: 1.0 },
    },
    // Nothing forward of z=-1.20: the drum sweeps down to y 0.44 and out to
    // z -1.71, and the model's nose shroud sits at y 0.50-1.00, right across
    // the sweep. Leaving it out is what lets the drum reach.
    colliders: [
      { shape: "box", halfExtents: { x: 1.4, y: 0.5, z: 0.98 }, offset: { x: 0, y: 0.5, z: -0.22 } },
      { shape: "box", halfExtents: { x: 0.68, y: 0.21, z: 0.42 }, offset: { x: 0, y: 0.31, z: 1.18 } },
    ],
  },

  witchdoctor: {
    id: "witchdoctor",
    name: "Witch Doctor",
    tagline: "Every season. Every time.",
    referenceImage: "./public/reference/witchdoctor.png",
    modelPath: "./public/models/witchdoctor.glb",
    modelYaw: Math.PI / 2, // MEASURED: model faces +X
    modelScale: 3.1,
    // "Bunny ear" appendages work either way up, so it keeps driving inverted.
    canDriveInverted: true,
    weightLbs: 250,
    weaponWeightLbs: 47,
    bodyDims: { x: 2.7, y: 1.2, z: 3.1 }, // MEASURED shell
    wheelAnchors: [
      { x: -1.03, y: 0.22, z: -0.31 },
      { x: 1.03, y: 0.22, z: -0.31 },
      { x: -1.05, y: 0.22, z: 1.27 },
      { x: 1.05, y: 0.22, z: 1.27 },
    ],
    maxSpeedFps: 15.0,
    accel: 8.5,
    turnRate: 1.05,
    accent: "#7fd430",
    accentDark: "#1a1024",
    weapon: {
      type: "drum", // vertical disc: same swept volume, same maths
      pivot: { x: 0.02, y: 0.56, z: -0.36 }, // MEASURED disc axle, game space
      axis: { x: 1, y: 0, z: 0 },
      spinUpSeconds: 2.2,
      inertia: 1.1,
      maxOmega: 620,
      budgetCap: 260,
      radius: 0.772, // MEASURED swept radius (bbox guess was 0.6)
      dims: { x: 0.1, y: 0.772, z: 0.772 },
      tuning: {
        efficiency: 0.54, impulseScale: 11.0, liftScale: 30.0, liftVelocity: 4.5,
        gyroScale: 0.9, impactScale: 1.1, damageScale: 0.66,
      },
    },
    // Front wedge is a WEDGE, not a box, so opponents ride up it into the disc.
    colliders: [
      { shape: "wedge", halfExtents: { x: 0.8, y: 0.15, z: 0.36 }, offset: { x: 0, y: 0.15, z: -1.18 }, tipY: 0.03 }, // front wedge (MEASURED slope)
      { shape: "box", halfExtents: { x: 1.3, y: 0.16, z: 1.19 }, offset: { x: 0, y: 0.16, z: 0.19 } },
      { shape: "box", halfExtents: { x: 1.15, y: 0.19, z: 1.15 }, offset: { x: 0, y: 0.51, z: 0.35 } },
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
