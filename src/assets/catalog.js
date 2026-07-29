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
  weapon: { type: 'bar'|'drum'|'flipper'|'crusher'|'hammerSaw'|'hammer'|'lifterDisc',
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
      radius: 0.42,
      dims: { x: 0.85, y: 0.42, z: 0.42 },
      pivot: { x: 0, y: 0.64, z: -0.24 },
      axis: { x: 1, y: 0, z: 0 },
      tuning: { efficiency: 0.5, impulseScale: 13.8, liftScale: 32.0, liftVelocity: 4.5, liftClearance: 0.55, gyroScale: 0.75 },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 1.237, y: 0.171, z: 0.873 }, offset: { x: 0.012, y: 0.175, z: 0.301 } },
      { shape: "box", halfExtents: { x: 0.354, y: 0.16, z: 0.738 }, offset: { x: -0.003, y: 0.495, z: 0.268 } },
      { shape: "box", halfExtents: { x: 1.05, y: 0.144, z: 0.305 }, offset: { x: 0, y: 0.148, z: -0.865 } }, // front fork row
      { shape: "box", halfExtents: { x: 0.198, y: 0.294, z: 0.967 }, offset: { x: -1.185, y: 0.294, z: 0 } }, // left pod
      { shape: "box", halfExtents: { x: 0.198, y: 0.294, z: 0.967 }, offset: { x: 1.184, y: 0.294, z: 0 } }, // right pod
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
      { shape: "box", halfExtents: { x: 0.895, y: 0.237, z: 0.229 }, offset: { x: 0, y: 0.274, z: -1.248 } }, // front wedge
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
      radius: 1.29,
      dims: { x: 0.15, y: 1.29, z: 0.2 }, // vertical bar, disc plane Y-Z
      pivot: { x: -0.1, y: 1.35, z: -0.04 },
      axis: { x: 1, y: 0, z: 0 },
      tuning: {
        efficiency: 0.76, impulseScale: 10.0, liftScale: 36.0, liftVelocity: 4.5, liftClearance: 0.55,
        gyroScale: 0.55, halfSpeedPowerMultiplier: 4.0, fullSpeedPowerMultiplier: 2.15, hapticScale: 2.0,
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
      tuning: { efficiency: 0.52, impulseScale: 8.5, liftScale: 30.0, liftVelocity: 4.5, liftClearance: 0.55, gyroScale: 0.85 },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 0.691, y: 0.213, z: 0.943 }, offset: { x: -0.001, y: 0.304, z: 0.252 } },
      { shape: "box", halfExtents: { x: 0.691, y: 0.099, z: 0.283 }, offset: { x: -0.001, y: 0.191, z: -0.974 } }, // front wedge
      { shape: "box", halfExtents: { x: 0.691, y: 0.133, z: 0.133 }, offset: { x: -0.001, y: 0.651, z: -0.32 } }, // fin rail
    ],
  },

  minotaur: {
    id: "minotaur",
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
      radius: 0.27,
      dims: { x: 0.39, y: 0.27, z: 0.27 },
      pivot: { x: 0, y: 0.27, z: -0.56 },
      axis: { x: 1, y: 0, z: 0 },
      tuning: { efficiency: 0.26, impulseScale: 4.4, kickbackScale: 0.12, liftScale: 18.0, liftVelocity: 4.0, liftClearance: 0.35, gyroScale: 1.45 },
    },
    colliders: [
      { shape: "box", halfExtents: { x: 0.686, y: 0.163, z: 0.694 }, offset: { x: -0.001, y: 0.271, z: 0.142 } },
      { shape: "box", halfExtents: { x: 0.162, y: 0.256, z: 0.487 }, offset: { x: -0.6, y: 0.256, z: 0.167 } }, // left pod
      { shape: "box", halfExtents: { x: 0.162, y: 0.256, z: 0.546 }, offset: { x: 0.599, y: 0.256, z: 0.108 } }, // right pod
      { shape: "box", halfExtents: { x: 0.56, y: 0.055, z: 0.101 }, offset: { x: 0, y: 0.163, z: -0.754 } }, // fork row
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
      { shape: "box", halfExtents: { x: 1.023, y: 0.143, z: 0.977 }, offset: { x: 0, y: 0.226, z: 0.023 } }, // merged pan floor
      { shape: "box", halfExtents: { x: 1.009, y: 0.154, z: 0.507 }, offset: { x: 0.005, y: 0.53, z: 0.474 } },
      { shape: "box", halfExtents: { x: 0.283, y: 0.328, z: 0.471 }, offset: { x: -0.031, y: 1.171, z: -0.164 } }, // tower
    ],
  },

  tombstone: {
    id: "tombstone",
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
      radius: 1.21,
      dims: { x: 1.21, y: 0.12, z: 0.3 }, // horizontal bar, spins around Y
      pivot: { x: 0, y: 0.22, z: -0.72 },
      axis: { x: 0, y: 1, z: 0 },
      tuning: {
        efficiency: 0.86, impulseScale: 18.0, kickbackScale: 1.45, liftScale: 7.0, liftVelocity: 4.5, liftClearance: 0.55,
        gyroScale: 1.35, reach: 2.25, impactScale: 1.55,
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
      { shape: "box", halfExtents: { x: 1.3, y: 0.14, z: 1.15 }, offset: { x: 0, y: 0.14, z: -0.27 } },
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
      // MEASURED through the loader (game space, model grounded): at -0.56 the
      // arm's fork plate lies flat on the deck pointing straight ahead, which
      // is the pose it scoops from; +1.0 stands the arm up with the disc
      // overhead. Sizing rest by "no part of the arm below y=0" instead lands
      // at -0.2 and leaves the forks a foot in the air — the arm's plate is
      // deeper than the forks, so a little of it passes under the deck at rest.
      // That is hidden: every camera sits above the floor (chase is bot.y+3.1,
      // battle 7.5+, arena 15), so the arena floor occludes it.
      restAngle: -0.56,
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
      { shape: "box", halfExtents: { x: 0.59, y: 0.07, z: 0.32 }, offset: { x: 0, y: 0.12, z: -1.27 } }, // chassis wedgelets
    ],
  },
};

/** Stable display order for UI grids. */
export const BOT_IDS = Object.freeze([
  "beta", "biteforce", "bronco", "huge", "hypershock",
  "minotaur", "quantum", "sawblaze", "tombstone", "whiplash",
]);

/** @returns {BotSpec} */
export function getBotSpec(id) {
  const spec = CATALOG[id];
  if (!spec) throw new Error(`Unknown bot id: ${id}`);
  return spec;
}
