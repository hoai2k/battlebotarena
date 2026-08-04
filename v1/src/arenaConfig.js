export const ARENA_LAYOUT = {
  "version": 1,
  // Distances are feet. Speeds are per second. Damage values are hp.
  "units": "feet",
  "dimensions": {
    "width": 48,
    "length": 48,
    "floorY": 0,
    "visualFloorThickness": 0.16,
    "physicsFloorHalfHeight": 0.05,
    "ceilingHeight": 9.45,
    "wallBaseY": 0.58
  },
  "wallBarriers": {
    "capOffset": 0.0
  },
  "screwHazards": {
    // Screw dimensions are feet; rotationSpeed is radians per second.
    "depth": 2,
    "rotationSpeed": 5.2,
    "capLength": 0.72,
    "capHeight": 1.29,
    "minCapDepth": 1.08,
    "capDepthPadding": 0.28,
    "bladeRadiusScale": 0.375,
    "minBladeRadius": 0.56,
    "maxBladeRadius": 1.1,
    "axisRadiusScale": 0.36,
    "minAxisY": 0.46,
    "axisYOffset": 0.08,
    "pitch": 1.1,
    // impactSpeedThreshold is ft/s; impactDamageScale is hp per ft/s above that threshold.
    "impactSpeedThreshold": 0.85,
    "impactDamageScale": 5.2,
    // Held-contact damage rates are hp per second at full pressure.
    "pressureDamageBase": 18.889,
    // Adds hp per second for each ft/s of screw surface speed at full pressure.
    "pressureDamageSpeedScale": 4.167,
    // Cooldowns and unstable durations are seconds.
    "damageCooldown": 0.18,
    // Match the damage recorder minimum so screw sparks and recorded screw damage stay in sync.
    "minRecordedDamage": 0.22,
    // Ignore shallow overlap below this normalized pressure so proximity/grazing does not cause chip damage.
    "contactPressureThreshold": 0.18,
    "pressureSparkThreshold": 0.35,
    "sparkCooldown": 0.24,
    "baseInwardImpulse": 0.026,
    "speedInwardImpulseScale": 0.012,
    "maxInwardImpulse": 11,
    "baseLiftImpulse": 0.018,
    "speedLiftImpulseScale": 0.008,
    "maxLiftImpulse": 7.5,
    "radialImpulseScale": 0.026,
    "maxRadialImpulse": 5.5,
    "unstableSeconds": 1.1,
    "unstablePressureSeconds": 0.8,
    "torqueXScale": 0.008,
    "torqueYScale": 0.005,
    "torqueZScale": 0.012
  },
  "killSawHazards": {
    // Kill-saw dimensions are feet; hold timing is randomized per pair in code; rotationSpeed is radians per second.
    "bladeRadiusScale": 0.55,
    "minBladeRadius": 0.52,
    "maxBladeRadius": 0.82,
    "bladeThickness": 0.12,
    "maxExposureFraction": 0.5,
    "stowedDepth": 0.08,
    "riseSeconds": 0.42,
    "sinkSeconds": 0.42,
    "rotationSpeed": 30,
    "contactPressureThreshold": 0.05,
    "damageCooldown": 0.1,
    "damageRate": 34,
    "speedDamageScale": 0.42,
    "damageMultiplier": 10,
    "minRecordedDamage": 0.18,
    "basePushImpulse": 0.034,
    "speedPushImpulseScale": 0.0032,
    "maxPushImpulse": 8.5,
    "liftImpulseScale": 0.018,
    "maxLiftImpulse": 4.5,
    "rideLiftImpulseScale": 0.04,
    "maxRideLiftImpulse": 9,
    "risingLiftImpulseScale": 0.032,
    "maxRisingLiftImpulse": 7,
    "torqueScale": 0.006,
    "unstableSeconds": 0.72,
    "sparkCooldown": 0.12,
    "sparkSurfaceThreshold": 0.08
  },
  "elements": [
    {
      "id": "player-start",
      "type": "startBox",
      "label": "Player start",
      "side": "player",
      "position": {
        "x": 0,
        "z": 19
      },
      "size": {
        "x": 5.2,
        "z": 4.7
      },
      "rotation": 0,
      "color": "#e1322a",
      "visibleInGame": true,
      "spawn": {
        "y": 0.55,
        "yaw": 0
      }
    },
    {
      "id": "rival-start",
      "type": "startBox",
      "label": "Rival start",
      "side": "rival",
      "position": {
        "x": 0,
        "z": -18.7
      },
      "size": {
        "x": 5.2,
        "z": 5
      },
      "rotation": 180,
      "color": "#3aa9e8",
      "visibleInGame": true,
      "spawn": {
        "y": 0.55,
        "yaw": 180
      }
    },
    {
      "id": "arena-logo",
      "type": "logo",
      "label": "BattleBox logo",
      "position": {
        "x": 0.847,
        "z": 0.277
      },
      "size": {
        "x": 8.3,
        "z": 5.55
      },
      "rotation": 0,
      "visibleInGame": true
    },
    {
      "id": "screw-left",
      "type": "screw",
      "label": "Left screw placeholder",
      "position": {
        "x": -23.153,
        "z": 0.8
      },
      "size": {
        "x": 13.5,
        "z": 0.78
      },
      "rotation": 270,
      "color": "#8a5cf6",
      "visibleInGame": true
    },
    {
      "id": "upper-deck",
      "type": "upperDeck",
      "label": "Upper deck placeholder",
      "position": {
        "x": 18.4,
        "z": -0.2
      },
      "size": {
        "x": 9.9,
        "z": 15.8
      },
      "rotation": 180,
      "color": "#2dd4bf",
      "visibleInGame": true
    },
    {
      "id": "kill-saw-nw",
      "type": "killSaw",
      "label": "Kill saw NW",
      "position": {
        "x": -16.094,
        "z": -5.354
      },
      "size": {
        "x": 1.82,
        "z": 0.82
      },
      "rotation": 0,
      "visibleInGame": true,
      "color": "#d9dde0"
    },
    {
      "id": "kill-saw-se",
      "type": "killSaw",
      "label": "Kill saw SE",
      "position": {
        "x": -16.094,
        "z": -7.1
      },
      "size": {
        "x": 1.82,
        "z": 0.82
      },
      "rotation": 0,
      "visibleInGame": true,
      "color": "#d9dde0"
    },
    {
      "id": "pulverizer-placeholder",
      "type": "pulverizer",
      "label": "Pulverizer placeholder",
      "position": {
        "x": 20.9,
        "z": -21
      },
      "size": {
        "x": 4.2,
        "z": 4.1
      },
      "rotation": 0,
      "color": "#f97316",
      "visibleInGame": false
    },
    {
      "id": "screw-1",
      "type": "screw",
      "label": "Left screw placeholder copy",
      "position": {
        "x": 12.9,
        "z": -0.185
      },
      "size": {
        "x": 15.5,
        "z": 0.78
      },
      "rotation": 90,
      "color": "#8a5cf6",
      "visibleInGame": true
    },
    {
      "id": "kill-saw-1",
      "type": "killSaw",
      "label": "Kill saw NW mirror",
      "position": {
        "x": -9.459,
        "z": -11.077
      },
      "size": {
        "x": 1.82,
        "z": 0.82
      },
      "rotation": 90,
      "visibleInGame": true,
      "color": "#d9dde0"
    },
    {
      "id": "kill-saw-2",
      "type": "killSaw",
      "label": "Kill saw SW mirror",
      "position": {
        "x": -7.8,
        "z": -11.077
      },
      "size": {
        "x": 1.82,
        "z": 0.82
      },
      "rotation": 270,
      "visibleInGame": true,
      "color": "#d9dde0"
    },
    {
      "id": "kill-saw-3",
      "type": "killSaw",
      "label": "Kill saw SE mirror",
      "position": {
        "x": -16.094,
        "z": 7.277
      },
      "size": {
        "x": 1.82,
        "z": 0.82
      },
      "rotation": 0,
      "visibleInGame": true,
      "color": "#d9dde0"
    },
    {
      "id": "kill-saw-4",
      "type": "killSaw",
      "label": "Kill saw NW mirror",
      "position": {
        "x": -16.094,
        "z": 5.323
      },
      "size": {
        "x": 1.82,
        "z": 0.82
      },
      "rotation": 0,
      "visibleInGame": true,
      "color": "#d9dde0"
    },
    {
      "id": "kill-saw-5",
      "type": "killSaw",
      "label": "Kill saw NW mirror mirror",
      "position": {
        "x": -9.459,
        "z": 11.077
      },
      "size": {
        "x": 1.82,
        "z": 0.82
      },
      "rotation": 270,
      "visibleInGame": true,
      "color": "#d9dde0"
    },
    {
      "id": "kill-saw-6",
      "type": "killSaw",
      "label": "Kill saw NW mirror mirror",
      "position": {
        "x": -9.459,
        "z": 11.077
      },
      "size": {
        "x": 1.82,
        "z": 0.82
      },
      "rotation": 270,
      "visibleInGame": true,
      "color": "#d9dde0"
    },
    {
      "id": "kill-saw-7",
      "type": "killSaw",
      "label": "Kill saw SW mirror mirror",
      "position": {
        "x": -7.9,
        "z": 11.077
      },
      "size": {
        "x": 1.82,
        "z": 0.82
      },
      "rotation": 90,
      "visibleInGame": true,
      "color": "#d9dde0"
    },
    {
      "id": "kill-saw-8",
      "type": "killSaw",
      "label": "Kill saw SW mirror mirror mirror",
      "position": {
        "x": 7.9,
        "z": 11.077
      },
      "size": {
        "x": 1.82,
        "z": 0.82
      },
      "rotation": 90,
      "visibleInGame": true,
      "color": "#d9dde0"
    },
    {
      "id": "kill-saw-9",
      "type": "killSaw",
      "label": "Kill saw NW mirror mirror mirror",
      "position": {
        "x": 9.459,
        "z": 11.077
      },
      "size": {
        "x": 1.82,
        "z": 0.82
      },
      "rotation": 270,
      "visibleInGame": true,
      "color": "#d9dde0"
    },
    {
      "id": "kill-saw-10",
      "type": "killSaw",
      "label": "Kill saw SW mirror mirror",
      "position": {
        "x": 7.8,
        "z": -11.077
      },
      "size": {
        "x": 1.82,
        "z": 0.82
      },
      "rotation": 270,
      "visibleInGame": true,
      "color": "#d9dde0"
    },
    {
      "id": "kill-saw-11",
      "type": "killSaw",
      "label": "Kill saw NW mirror mirror",
      "position": {
        "x": 9.459,
        "z": -11.077
      },
      "size": {
        "x": 1.82,
        "z": 0.82
      },
      "rotation": 90,
      "visibleInGame": true,
      "color": "#d9dde0"
    },
    {
      "id": "screw-2",
      "type": "screw",
      "label": "Screw 21",
      "position": {
        "x": -0.1,
        "z": -22.7
      },
      "size": {
        "x": 11.8,
        "z": 1
      },
      "rotation": 180,
      "visibleInGame": true,
      "color": "#8a5cf6"
    },
    {
      "id": "screw-3",
      "type": "screw",
      "label": "Screw 21 mirror",
      "position": {
        "x": 0.4,
        "z": 22.7
      },
      "size": {
        "x": 11.8,
        "z": 0.78
      },
      "rotation": 0,
      "visibleInGame": true,
      "color": "#8a5cf6"
    },
    {
      "id": "pulverizer-1",
      "type": "pulverizer",
      "label": "Pulverizer placeholder mirror",
      "position": {
        "x": 20.9,
        "z": 21
      },
      "size": {
        "x": 4.2,
        "z": 4.1
      },
      "rotation": 0,
      "color": "#f97316",
      "visibleInGame": false
    }
  ]
};
