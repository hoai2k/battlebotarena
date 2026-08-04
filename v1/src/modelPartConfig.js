// GLB orientation contract:
// - +Y is up.
// - Bot forward is local -Z.
// - Bot left/right spans local X.
// - Runtime may scale, center, and ground the model, but GLBs should not need
//   yaw correction. `fit.scale` defaults to 1 and multiplies the fitted size.
//   Weapon and wheel regions are authored against this canonical local
//   orientation. Collider pieces in `collider.parts` are authored in the
//   fitted visual model's local coordinates. If a bot has no authored collider
//   parts, the runtime can still generate colliders from the visual model.
// Bots ported from v2 arrive with segmented GLBs and collider stacks measured
// in the same frame v1 authors in, so their entries are generated rather than
// hand-tweaked. See portedBots.js.
import { PORTED_MODEL_PART_CONFIG } from "./portedBots.js";

export const MODEL_PART_CONFIG = {
  biteforce: {
    path: './public/models/biteforce_3d.glb',
    fit: {
      width: 3.2,
      height: 1.55,
      depth: 2.65,
      scale: 0.9
    },
    collider: {
      parts: [
        {
          type: 'wedge',
          part: 'wedge',
          position: [-1.009752, 0.148482, -0.865],
          halfExtents: [0.180116, 0.144181, 0.305],
          density: 4.3,
          friction: 0.58
        },
        {
          type: 'wedge',
          part: 'wedge',
          position: [-0.57058, 0.148482, -0.865],
          halfExtents: [0.17398, 0.144181, 0.305],
          density: 4.3,
          friction: 0.58
        },
        {
          type: 'wedge',
          part: 'wedge',
          position: [0.573836, 0.148482, -0.865],
          halfExtents: [0.168675, 0.144181, 0.305],
          density: 4.3,
          friction: 0.58
        },
        {
          type: 'wedge',
          part: 'wedge',
          position: [1.027275, 0.148482, -0.865],
          halfExtents: [0.182234, 0.144181, 0.305],
          density: 4.3,
          friction: 0.58
        },
        {
          type: 'box',
          part: 'body',
          position: [-0.003678, 0.190827, 0.518793],
          halfExtents: [0.35347, 0.123559, 0.673707],
          density: 4
        },
        {
          type: 'box',
          part: 'body',
          position: [-0.00349, 0.495423, 0.268133],
          halfExtents: [0.353699, 0.159526, 0.738436],
          density: 4
        },
        {
          type: 'box',
          part: 'body',
          position: [-0.003678, 0.945662, 0.002968],
          halfExtents: [0.35347, 0.268992, 0.157883],
          density: 4
        },
        {
          type: 'box',
          part: 'body',
          position: [0.012259, 0.175496, 0.301423],
          halfExtents: [1.237285, 0.171195, 0.872684],
          density: 4
        },
        {
          type: 'cylinder',
          part: 'weapon',
          position: [0, 0.635989, -0.2385],
          halfExtents: [0.122097, 0.437737, 0.848736],
          rotation: [0, 0, 1.570796],
          density: 3.2,
          nonBlockingSpinner: true,
          ignoreLocalBottomFloorContact: true
        },
        {
          type: 'box',
          part: 'driveContact',
          position: [-1.184967, 0.074458, 0],
          halfExtents: [0.198, 0.293534, 0.966504],
          side: 'left',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        },
        {
          type: 'box',
          part: 'driveContact',
          position: [1.183977, 0.074458, 0],
          halfExtents: [0.198, 0.293534, 0.966504],
          side: 'right',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        }
      ]
    },
    weapon: {
      type: 'drum',
      spinAxis: 'x',
      colliderShape: 'split',
      visualSpeed: 136,
      pivot: {
        x: 0.5,
        y: 0.52,
        z: 0.4
      },
      mirrorDiagonal: true,
      mirrorDiagonalAngle: 3.141593,
      mirrorDiagonalFrontAxis: 'z',
      mirrorDiagonalFrontSign: -1,
      regions: [
        {
          x: [0.45, 0.55],
          y: [0.3, 0.86],
          z: [0.12, 0.47]
        }
      ]
    }
  },
  bronco: {
    path: './public/models/bronco_3d.glb',
    fit: {
      width: 2.9,
      height: 1.45,
      depth: 2.9,
      scale: 1.15
    },
    collider: {
      parts: [
        {
          type: 'box',
          part: 'body',
          position: [-0.023409, 0.342149, 0.166512],
          halfExtents: [0.888098, 0.250423, 1.236662],
          density: 4
        },
        {
          type: 'box',
          part: 'body',
          position: [-0.570246, 0.162587, 1.14462],
          halfExtents: [0.577382, 0.136889, 0.522575],
          density: 4
        },
        {
          type: 'box',
          part: 'body',
          position: [0.577565, 0.163249, 1.062237],
          halfExtents: [0.570063, 0.136126, 0.605263],
          density: 4
        },
        {
          type: 'box',
          part: 'body',
          position: [-0.015762, 0.447033, 1.026267],
          halfExtents: [1.03691, 0.140891, 0.491579],
          density: 4
        },
        {
          type: 'wedge',
          part: 'wedge',
          position: [0, 0.274033, -1.248461],
          halfExtents: [0.895149, 0.236925, 0.229297],
          density: 4.3,
          friction: 0.58
        },
        {
          type: 'convex',
          part: 'weapon',
          position: [-0.005025, 0.464433, -1.029907],
          halfExtents: [0.165272, 0.212809, 0.593441],
          density: 3.4,
          ignoreGroundContact: true,
          ignoreLocalBottomFloorContact: true,
          vertices: [
            [-0.165272, -0.432001, -0.593441],
            [-0.165272, -0.432001, 0.593441],
            [-0.165272, -0.432001, 0.593441],
            [-0.165272, 0.432001, 0.593441],
            [0.165272, -0.432001, -0.593441],
            [0.165272, -0.432001, 0.593441],
            [0.165272, -0.432001, 0.593441],
            [0.165272, 0.432001, 0.593441]
          ]
        },
        {
          type: 'box',
          part: 'weapon',
          position: [-0.004504, 0.511018, 0.251674],
          halfExtents: [0.168987, 0.212809, 0.642639],
          density: 3,
          ignoreGroundContact: true,
          ignoreLocalBottomFloorContact: true
        },
        {
          type: 'cylinder',
          part: 'driveContact',
          position: [-0.935382, 0.288087, -0.592034],
          halfExtents: [0.18, 0.42, 0.42],
          rotation: [0, 0, 1.570796],
          side: 'left',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        },
        {
          type: 'cylinder',
          part: 'driveContact',
          position: [-0.935382, 0.288087, 1.014915],
          halfExtents: [0.18, 0.42, 0.42],
          rotation: [0, 0, 1.570796],
          side: 'left',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        },
        {
          type: 'cylinder',
          part: 'driveContact',
          position: [0.935382, 0.288087, -0.592034],
          halfExtents: [0.18, 0.42, 0.42],
          rotation: [0, 0, 1.570796],
          side: 'right',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        },
        {
          type: 'cylinder',
          part: 'driveContact',
          position: [0.935382, 0.288087, 1.014915],
          halfExtents: [0.18, 0.42, 0.42],
          rotation: [0, 0, 1.570796],
          side: 'right',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        }
      ]
    },
    weapon: {
      type: 'flipper'
    }
  },
  huge: {
    path: './public/models/huge_3d.glb',
    fit: {
      width: 3.9,
      height: 2.2,
      depth: 2.9,
      scale: 1.3
    },
    collider: {
      parts: [
        {
          type: 'box',
          part: 'body',
          position: [-0.004769, 1.510642, 0.065225],
          halfExtents: [1.898189, 0.312298, 0.284074],
          density: 4.2,
          friction: 0.62
        },
        {
          type: 'cylinder',
          part: 'body',
          position: [-1.845301, 1.492977, -0.000072],
          halfExtents: [0.130152, 1.492833, 1.492833],
          side: 'left',
          rotation: [0, 0, 1.570796],
          density: 3.8,
          friction: 0.72,
          restitution: 0
        },
        {
          type: 'cylinder',
          part: 'body',
          position: [1.737719, 1.451461, 0],
          halfExtents: [0.130152, 1.451461, 1.451461],
          side: 'right',
          rotation: [0, 0, 1.570796],
          density: 3.8,
          friction: 0.72,
          restitution: 0
        },
        {
          type: 'box',
          part: 'weapon',
          position: [-0.098939, 1.353777, -0.036766],
          halfExtents: [0.152694, 1.291786, 0.195399],
          rotation: [0.471019, 0, 0],
          density: 3.2
        },
        {
          type: 'cylinder',
          part: 'driveContact',
          position: [-1.774694, 1.462511, -0.000072],
          halfExtents: [0.26, 1.462367, 1.462367],
          side: 'left',
          rotation: [0, 0, 1.570796],
          density: 1.7,
          friction: 0.92,
          restitution: 0
        },
        {
          type: 'cylinder',
          part: 'driveContact',
          position: [1.684827, 1.421839, 0],
          halfExtents: [0.26, 1.421839, 1.421839],
          side: 'right',
          rotation: [0, 0, 1.570796],
          density: 1.7,
          friction: 0.92,
          restitution: 0
        }
      ]
    },
    weapon: {
      type: 'bar',
      spinAxis: 'x',
      colliderShape: 'split',
      orientedBoxCollider: true,
      colliderThinScale: 0.64
    }
  },
  quantum: {
    path: './public/models/quantum_3d.glb',
    fit: {
      width: 3,
      height: 1.65,
      depth: 2.7,
      scale: 1
    },
    collider: {
      parts: [
        {
          type: 'wedge',
          part: 'body',
          position: [0, 0.352055, -0.92042],
          halfExtents: [1.010811, 0.244675, 0.747355],
          density: 4,
          friction: 0.58
        },
        {
          type: 'box',
          part: 'body',
          position: [-0.000165, 0.206758, 0.454505],
          halfExtents: [0.920503, 0.117847, 0.895495],
          density: 4
        },
        {
          type: 'box',
          part: 'body',
          position: [0.001524, 0.439045, -0.009554],
          halfExtents: [0.973773, 0.110897, 0.448073],
          density: 4
        },
        {
          type: 'box',
          part: 'body',
          position: [0, 0.440136, 0.795012],
          halfExtents: [0.827806, 0.110052, 0.356493],
          density: 4
        },
        {
          type: 'box',
          part: 'body',
          position: [0.000906, 0.654179, 0.237943],
          halfExtents: [0.590831, 0.100345, 0.676586],
          density: 4
        },
        {
          type: 'box',
          part: 'body',
          position: [-0.000865, 0.900208, 0.145102],
          halfExtents: [0.373384, 0.140431, 0.589142],
          density: 4
        },
        {
          type: 'wedge',
          part: 'weapon',
          position: [0.000041, 1.302318, -0.295605],
          halfExtents: [0.13918, 0.391893, 0.776361],
          rotation: [0.785398, 0, 0],
          density: 3.2
        },
        {
          type: 'cylinder',
          part: 'driveContact',
          position: [-0.825929, 0.42, -0.488216],
          halfExtents: [0.18, 0.42, 0.42],
          rotation: [0, 0, 1.570796],
          side: 'left',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        },
        {
          type: 'cylinder',
          part: 'driveContact',
          position: [-0.825929, 0.42, 0.836942],
          halfExtents: [0.18, 0.42, 0.42],
          rotation: [0, 0, 1.570796],
          side: 'left',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        },
        {
          type: 'cylinder',
          part: 'driveContact',
          position: [0.825929, 0.42, -0.488216],
          halfExtents: [0.18, 0.42, 0.42],
          rotation: [0, 0, 1.570796],
          side: 'right',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        },
        {
          type: 'cylinder',
          part: 'driveContact',
          position: [0.825929, 0.42, 0.836942],
          halfExtents: [0.18, 0.42, 0.42],
          rotation: [0, 0, 1.570796],
          side: 'right',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        }
      ]
    },
    weapon: {
      type: 'crusher',
      colliderShape: 'wedge'
    }
  },
  hypershock: {
    path: './public/models/hypershock_3d.glb',
    fit: {
      width: 3.25,
      height: 1.55,
      depth: 2.35,
      scale: 1.2
    },
    collider: {
      parts: [
        {
          type: 'box',
          part: 'body',
          position: [-0.000775, 0.304158, 0.251782],
          halfExtents: [0.691122, 0.213298, 0.942682],
          density: 4
        },
        {
          type: 'wedge',
          part: 'wedge',
          position: [-0.000775, 0.19063, -0.973705],
          halfExtents: [0.691122, 0.098791, 0.282805],
          density: 4,
          friction: 0.58
        },
        {
          type: 'cylinder',
          part: 'weapon',
          position: [0, 0.379661, -0.6909],
          halfExtents: [0.094379, 0.436769, 0.504543],
          rotation: [0, 0, 1.570796],
          density: 3.2,
          ignoreGroundContact: true,
          ignoreLocalBottomFloorContact: true
        },
        {
          type: 'cylinder',
          part: 'driveContact',
          position: [-0.642147, 0.125, -0.391216],
          halfExtents: [0.18, 0.266381, 0.266381],
          rotation: [0, 0, 1.570796],
          side: 'left',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        },
        {
          type: 'cylinder',
          part: 'driveContact',
          position: [-0.642147, 0.184325, 0.804265],
          halfExtents: [0.192298, 0.266381, 0.339954],
          rotation: [0, 0, 1.570796],
          side: 'left',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        },
        {
          type: 'cylinder',
          part: 'driveContact',
          position: [0.640753, 0.125, -0.376344],
          halfExtents: [0.18, 0.266381, 0.266381],
          rotation: [0, 0, 1.570796],
          side: 'right',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        },
        {
          type: 'cylinder',
          part: 'driveContact',
          position: [0.640753, 0.175261, 0.798909],
          halfExtents: [0.178084, 0.262062, 0.357773],
          rotation: [0, 0, 1.570796],
          side: 'right',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        },
        {
          type: 'box',
          part: 'body',
          position: [-0.000775, 0.650646, -0.319584],
          halfExtents: [0.691122, 0.13319, 0.13319],
          density: 4
        }
      ]
    },
    weapon: {
      type: 'drum',
      spinAxis: 'x',
      colliderShape: 'split',
      centerColliderOnPivot: true,
      visualSpeed: 128,
      pivot: {
        x: 0.5,
        y: 0.49,
        z: 0.255
      },
      mirrorDiagonal: true,
      mirrorDiagonalAngle: 3.141593,
      mirrorDiagonalFrontAxis: 'z',
      mirrorDiagonalFrontSign: -1,
      regions: [
        {
          x: [0.44, 0.56],
          y: [0.46, 1],
          z: [0.12, 0.36]
        }
      ]
    }
  },
  minotaur: {
    path: './public/models/minotaur_3d.glb',
    fit: {
      width: 3,
      height: 1.15,
      depth: 2.45,
      scale: 0.7
    },
    collider: {
      parts: [
        {
          type: 'box',
          part: 'body',
          position: [-0.000602, 0.270707, 0.141691],
          halfExtents: [0.686304, 0.16295, 0.693592],
          density: 4.4
        },
        {
          type: 'box',
          part: 'body',
          position: [-0.619882, 0.262615, 0.143287],
          halfExtents: [0.130888, 0.245237, 0.224135],
          density: 3
        },
        {
          type: 'box',
          part: 'body',
          position: [0.593807, 0.262615, 0.143287],
          halfExtents: [0.130888, 0.245237, 0.224135],
          density: 3
        },
        {
          type: 'wedge',
          part: 'wedge',
          position: [-0.446699, 0.16316, -0.753673],
          halfExtents: [0.109809, 0.055403, 0.100886],
          density: 4.4,
          friction: 0.58
        },
        {
          type: 'wedge',
          part: 'wedge',
          position: [0.445495, 0.16316, -0.753673],
          halfExtents: [0.109809, 0.055403, 0.100886],
          density: 4.4,
          friction: 0.58
        },
        {
          type: 'cylinder',
          part: 'weapon',
          position: [0, 0.271377, -0.557375],
          halfExtents: [0.393508, 0.157811, 0.204328],
          rotation: [0, 0, 1.570796],
          density: 3.2,
          ignoreLocalBottomFloorContact: true
        },
        {
          type: 'box',
          part: 'driveContact',
          position: [-0.60035, 0.256016, 0.166825],
          halfExtents: [0.161576, 0.256016, 0.486957],
          side: 'left',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        },
        {
          type: 'box',
          part: 'driveContact',
          position: [0.599327, 0.256016, 0.10826],
          halfExtents: [0.161576, 0.256016, 0.545522],
          side: 'right',
          density: 1.7,
          friction: 0.92,
          restitution: 0
        }
      ]
    },
    weapon: {
      type: 'drum',
      spinAxis: 'x',
      colliderShape: 'cylinder',
      visualSpeed: 150,
      pivot: {
        x: 0.5,
        y: 0.53,
        z: 0.175
      },
      mirrorDiagonal: true,
      mirrorDiagonalAngle: 3.141593,
      mirrorDiagonalFrontAxis: 'z',
      mirrorDiagonalFrontSign: -1,
      regions: [
        {
          x: [0.28, 0.72],
          y: [0.3, 0.9],
          z: [0.08, 0.26]
        }
      ]
    }
  },
  ...PORTED_MODEL_PART_CONFIG,
};
