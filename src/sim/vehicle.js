// Raycast-suspension vehicle: 4 probes, spring/damper, velocity-servo drive
// (v1 servo shape), friction-circle lateral grip, yaw assist/damping.
// Forces and impulses only — never teleports or velocity writes during play.

import { RAPIER, BOT_GROUPS, SUSPENSION_RAY_GROUPS, tagCollider } from "./world.js";
import { ARENA, GRAVITY_Y } from "./arenaSpec.js";
import * as m from "./math.js";

const G = -GRAVITY_Y; // 32.174 ft/s^2

export const VEHICLE_TUNING = Object.freeze({
  probeTravel: 0.45, // ft of suspension ray travel below each wheel anchor
  restCompression: 0.22, // ft compressed at rest -> spring k = m*g/(4*rest)
  dampingZeta: 0.4,
  maxSuspensionForceFactor: 6, // x corner weight, explosion guard
  tireMu: 1.1, // friction-circle limit |F| <= mu * Fn
  wheelRadius: 0.35, // render wheel spin only
  // Yaw command shape ported from v1 driveFighter: target rate =
  // turn * baseTurnRate * (maxSpeed / baseSpeed) * turningTightness, with a
  // counter-rotate boost when spinning in place. spec.turnRate is the
  // TIGHTNESS MULTIPLIER (~1.0), not a rad/s rate.
  baseTurnRate: 3.8, // rad/s at baseSpeed with tightness 1 (v1 DEFAULTS.turnRate)
  baseSpeed: 5.4, // ft/s reference (v1 DEFAULTS.maxSpeed)
  counterRotateBoost: 1.45, // spin-in-place multiplier (v1)
  counterRotateCap: 6.5, // rad/s clamp when counter-rotating (v1)
  yawAssistRate: 14, // 1/s servo toward turn-input yaw rate
  yawSettleRate: 18, // 1/s damping when no turn input
  maxYawAccel: 42, // rad/s^2 clamp on yaw servo authority
  latGripRate: 12, // 1/s exponential lateral slip kill (v1 tire scrub was 10.5/s)
  airAngularDamp: 1.6, // 1/s, airborne only
  uprightMinUpY: 0.35, // suspension cutoff (flipped bots don't hover)
  driveMinUpY: 0.55, // drive cutoff
  brakeBlendBoost: 2.2, // brake servo closes the gap faster
  idleBrakeBoost: 1.35, // gentle no-input settle; v1 coasts, it doesn't pin
  speedCap: 60, // ft/s safety rail
  escapeMargin: 0.5, // ft outside walls before inward nudge kicks in
  escapeAccel: 25, // ft/s^2 gentle inward push
});

const T = VEHICLE_TUNING;

/** Complete a possibly-partial DriveInput. */
export function completeInput(input = {}) {
  return {
    leftDrive: m.clamp(input.leftDrive ?? 0, -1, 1),
    rightDrive: m.clamp(input.rightDrive ?? 0, -1, 1),
    // Holonomic translation, used only by drive.type === "holonomic".
    strafe: m.clamp(input.strafe ?? 0, -1, 1),
    spin: m.clamp(input.spin ?? 0, -1, 1),
    weapon: Boolean(input.weapon),
    // Secondary weapon channel (RB): Sawblaze's saw motor, Whiplash's disc.
    // This used to be dropped here, so the only consumers were the renderer
    // and the audio layer — the sim never saw the toggle at all.
    sawActive: Boolean(input.sawActive),
    // Aux weapon channel (LB): Tantrum's punch arms, which are a separate
    // machine from its drum carriage and so cannot share the saw channel.
    auxActive: Boolean(input.auxActive),
    brake: Boolean(input.brake),
  };
}

/**
 * @param {object} args
 * @param {import("@dimforge/rapier3d-compat").World} args.world
 * @param {Map} args.meta collider metadata registry
 * @param {object} args.spec BotSimSpec (weightLbs, bodyDims, wheelAnchors,
 *   maxSpeedFps, accel, turnRate, colliders, weapon)
 * @param {number} args.index bot index (0/1)
 * @param {{x:number, z:number, yaw:number}} args.spawn
 */
export function createVehicle({ world, meta, spec, index, spawn }) {
  const mass = spec.weightLbs / G; // slugs (feet units)
  const dims = spec.bodyDims;
  const anchors = spec.wheelAnchors.map((a) => m.clone(a));
  const minAnchorY = Math.min(...anchors.map((a) => a.y));
  const restCenterHeight = (T.probeTravel - T.restCompression) - minAnchorY;

  // Single mass source: additional mass properties; colliders contribute 0.
  // Yaw inertia reduced to ~0.7x pitch/roll (contract: snappier turning).
  const ix = (mass / 12) * (dims.y * dims.y + dims.z * dims.z);
  const iy = 0.7 * (mass / 12) * (dims.x * dims.x + dims.z * dims.z);
  const iz = (mass / 12) * (dims.x * dims.x + dims.y * dims.y);
  const com = { x: 0, y: -0.15 * dims.y, z: 0.08 * dims.z }; // low, slightly rear (+z)

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, restCenterHeight + 0.15, spawn.z)
      .setRotation(m.qFromYaw(spawn.yaw))
      .setCcdEnabled(true)
      .setCanSleep(false)
      .setAdditionalMassProperties(mass, com, { x: ix, y: iy, z: iz }, m.qIdentity()),
  );

  const wedgeColliders = [];
  // Colliders that RIDE THE ARM rather than the chassis. A lifter's plow is
  // part of the machine at rest and the collider stack has always covered it
  // there — but the moment the arm came up, the solid stayed behind and the
  // plow became a hologram you could drive a bot through. These keep their
  // authored pose (so the rest-pose invariants in tools/sim-tests.mjs still
  // measure the real thing) and the weapon re-poses them about its own pivot
  // every step.
  const armColliders = [];
  for (const c of spec.colliders) {
    let desc;
    if (c.shape === "cylinder") {
      // Rapier's cylinder stands on Y. `axis` says which way the round face
      // points: "x" for a wheel (HUGE's two 40in tyres), "y" for a disc lying
      // flat, which is what a full-body shell spinner is. The field was already
      // being authored and silently ignored, so HUGE's wheels were being built
      // as 2.9ft pancakes lying in the floor instead of standing up.
      desc = RAPIER.ColliderDesc.cylinder(c.halfHeight, c.radius);
      const axis = c.axis ?? "y";
      if (axis === "x") desc.setRotation(m.qFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2));
      else if (axis === "z") desc.setRotation(m.qFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2));
    } else if (c.shape === "wedge") {
      // A right triangular prism: flat on the floor, its top face climbing from
      // a knife edge at the front (-z, y = tipY) to `halfExtents.y * 2` at the
      // back. This is the shape a real wedge presents, and the reason the game
      // has wedges at all — an opponent's suspension can find the slope and
      // ride up it, which a stack of level boxes never allows.
      const { x: hx, y: hy, z: hz } = c.halfExtents;
      const tip = c.tipY ?? 0;
      desc = RAPIER.ColliderDesc.convexHull(new Float32Array([
        -hx, -hy, -hz, hx, -hy, -hz, // front bottom edge
        -hx, -hy + tip, -hz, hx, -hy + tip, -hz, // front top edge (knife edge at tipY = 0)
        -hx, -hy, hz, hx, -hy, hz, // back bottom edge
        -hx, hy, hz, hx, hy, hz, // back top edge
      ]));
      if (!desc) throw new Error(`${spec.id}: degenerate wedge collider`);
    } else {
      desc = RAPIER.ColliderDesc.cuboid(c.halfExtents.x, c.halfExtents.y, c.halfExtents.z);
    }
    desc
      .setDensity(0)
      .setFriction(c.friction ?? 0.5)
      .setRestitution(c.restitution ?? 0.18)
      .setCollisionGroups(BOT_GROUPS)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(120);
    if (c.offset) desc.setTranslation(c.offset.x, c.offset.y, c.offset.z);
    if (c.rotation) desc.setRotation(c.rotation);
    const collider = world.createCollider(desc, body);
    const surface = c.shape === "wedge" ? "wedge" : "bot";
    tagCollider(meta, collider, { kind: "bot", botIndex: index, surface });
    if (surface === "wedge") wedgeColliders.push(collider);
    if (c.ridesArm) {
      armColliders.push({
        collider,
        offset: { x: c.offset?.x ?? 0, y: c.offset?.y ?? 0, z: c.offset?.z ?? 0 },
        rotation: c.rotation ?? m.qIdentity(),
      });
    }
  }

  // Per-probe static load share (bilinear over the anchor rectangle) so springs
  // preload for the COM position and the chassis settles level — a rear COM on
  // uniform springs pitches the body and the tilted normal force makes it creep.
  const xMin = Math.min(...anchors.map((a) => a.x));
  const xMax = Math.max(...anchors.map((a) => a.x));
  const zMin = Math.min(...anchors.map((a) => a.z));
  const zMax = Math.max(...anchors.map((a) => a.z));
  const loadShare = anchors.map((a) => {
    const sx = xMax > xMin ? (a.x === xMin ? 1 - (com.x - xMin) / (xMax - xMin) : (com.x - xMin) / (xMax - xMin)) : 0.5;
    const sz = zMax > zMin ? (a.z === zMin ? 1 - (com.z - zMin) / (zMax - zMin) : (com.z - zMin) / (zMax - zMin)) : 0.5;
    return sx * sz * 2; // sx,sz each split a pair; total sums to 1
  });
  const springs = loadShare.map((share) => {
    const load = mass * G * share;
    const k = load / T.restCompression;
    const c = 2 * T.dampingZeta * Math.sqrt(k * mass * share);
    return { k, c, maxForce: load * T.maxSuspensionForceFactor };
  });

  // Upside down, a bot that can still drive is standing on the OTHER side of
  // its wheels, and the probe anchors have to move with them or the rays never
  // reach the floor. Mirroring the anchor about the collider stack's top puts
  // the probe the same distance above the contact patch as it is when upright.
  const colliderTop = Math.max(
    ...spec.colliders.map((c) => (c.offset?.y ?? 0) + (c.halfExtents?.y ?? c.halfHeight ?? 0)),
  );
  const invertedAnchorY = colliderTop - (T.probeTravel - T.restCompression);

  const ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
  const probeState = anchors.map(() => ({ grounded: false, compression: 0, normalForce: 0, longForce: 0 }));
  const wheelSpin = anchors.map(() => 0);
  const leftIdx = anchors.map((a, i) => i).filter((i) => anchors[i].x < 0);
  const rightIdx = anchors.map((a, i) => i).filter((i) => anchors[i].x >= 0);

  // WHERE THE BOT TURNS. A tracked machine pivots about the centre of its
  // contact patches — throw one side forward and the other back and it spins
  // about the middle of its wheels, not about its centre of mass and not about
  // whatever point the model happens to call the origin. Those are three
  // different places on most of this roster: the COM is deliberately low and
  // slightly rear (see `com`), and a bot like Tombstone carries skids up front
  // and tyres at the back, so its wheel centre sits well ahead of both. Driving
  // yaw about the COM put the pivot a third of a foot behind where the wheels
  // say it is, which reads as the nose swinging wide.
  //
  // Everything that commands or corrects a turn measures its moment arms from
  // here: the per-side speed target, the lateral-slip reference, and the yaw
  // servo (which pairs its torque with the linear impulse that holds this point
  // still). y is the contact plane, so the arm is the same one the tyres have.
  const wheelCenter = {
    x: anchors.reduce((sum, a) => sum + a.x, 0) / anchors.length,
    y: minAnchorY,
    z: anchors.reduce((sum, a) => sum + a.z, 0) / anchors.length,
  };
  const wheelCenterOffset = m.sub(wheelCenter, com); // body-local, COM -> pivot

  function pointVelocity(worldPoint, pos, rot, linvel, angvel) {
    const comWorld = m.add(pos, m.qRotate(rot, com));
    return m.add(linvel, m.cross(angvel, m.sub(worldPoint, comWorld)));
  }

  function updateSuspension(dt, pos, rot, linvel, angvel, up, inverted = false) {
    const worldAnchors = [];
    for (let i = 0; i < anchors.length; i++) {
      const anchor = inverted ? { ...anchors[i], y: invertedAnchorY } : anchors[i];
      const worldAnchor = m.add(pos, m.qRotate(rot, anchor));
      worldAnchors.push(worldAnchor);
      const state = probeState[i];
      state.grounded = false;
      state.compression = 0;
      state.normalForce = 0;
      state.longForce = 0;
      if (up.y < T.uprightMinUpY) continue;
      ray.origin = worldAnchor;
      ray.dir = m.scale(up, -1);
      const hit = world.castRay(ray, T.probeTravel, true, undefined, SUSPENSION_RAY_GROUPS, undefined, body);
      if (!hit) continue;
      const toi = hit.timeOfImpact ?? hit.toi;
      // A solid raycast that STARTS inside a shape reports toi 0, which reads
      // as full compression and therefore maximum spring force. On the floor
      // that is the recovery we want. On another bot it is a pump: the corner
      // is buried in the opponent, there is no surface under it, and the two
      // colliders are already pushing each other apart. Standing on a bot only
      // counts when there is real geometry BELOW the probe.
      if (toi <= 0.01 && meta.get(hit.collider?.handle)?.kind === "bot") continue;
      const compression = T.probeTravel - toi;
      if (compression <= 0.005) continue;
      const vUp = m.dot(pointVelocity(worldAnchor, pos, rot, linvel, angvel), up);
      const spring = springs[i];
      const force = m.clamp(spring.k * compression - spring.c * vUp, 0, spring.maxForce);
      state.grounded = true;
      state.compression = compression;
      state.normalForce = force;
      body.applyImpulseAtPoint(m.scale(up, force * dt), worldAnchor, true);
    }
    return worldAnchors;
  }

  function driveSide(dt, sideIdx, targets, basis, worldAnchors) {
    const { fwdH } = basis;
    const groundedIdx = sideIdx.filter((i) => probeState[i].grounded);
    const sideGrip = groundedIdx.length / sideIdx.length;
    const sideN = groundedIdx.reduce((sum, i) => sum + probeState[i].normalForce, 0);
    const sideX = sideIdx.reduce((sum, i) => sum + anchors[i].x, 0) / sideIdx.length;
    // Moment arm from the pivot, not from the model origin: a bot whose wheels
    // are not centred on x=0 would otherwise be commanded two side speeds that
    // describe a rotation about a point it has no wheels at.
    const targetSpeed = targets.forward + targets.yawRate * (sideX - wheelCenter.x);

    const sidePoint = m.add(basis.pos, m.qRotate(basis.rot, { x: sideX, y: minAnchorY + 0.15, z: 0 }));
    const current = m.dot(pointVelocity(sidePoint, basis.pos, basis.rot, basis.linvel, basis.angvel), fwdH);
    // Visual roll rate matches ground speed via the bot's REAL wheel radius
    // (v1 had this per-bot for HUGE: giant wheels must turn slowly).
    const wheelRadius = spec.wheelRadius ?? T.wheelRadius;
    for (const i of sideIdx) wheelSpin[i] += (current / wheelRadius) * dt;
    if (groundedIdx.length === 0) return;

    // v1 velocity-servo shape: close the speed gap by dt*accel*grip per tick,
    // then clamp by tire traction (the longitudinal half of the friction circle).
    // Idle/brake gets a stronger blend: tires hold position statically.
    const idle = Math.abs(targets.forward) < 0.05 && Math.abs(targets.yawRate) < 0.05;
    const boost = targets.brake ? T.brakeBlendBoost : idle ? T.idleBrakeBoost : 1;
    const blend = Math.min(1, dt * spec.accel * sideGrip * boost);
    let impulse = (targetSpeed - current) * (mass / 2) * blend;
    const tractionCap = T.tireMu * sideN * dt;
    impulse = m.clamp(impulse, -tractionCap, tractionCap);
    const perProbe = impulse / groundedIdx.length;
    for (const i of groundedIdx) {
      probeState[i].longForce = Math.abs(perProbe) / dt;
      body.applyImpulseAtPoint(m.scale(fwdH, perProbe), worldAnchors[i], true);
    }
  }

  function applyLateralGrip(dt, basis, worldAnchors, yawTarget, strafeTarget = 0) {
    const { rightH } = basis;
    const pivotWorld = m.add(basis.pos, m.qRotate(basis.rot, wheelCenter));
    for (let i = 0; i < anchors.length; i++) {
      const state = probeState[i];
      if (!state.grounded) continue;
      const vLat = m.dot(pointVelocity(worldAnchors[i], basis.pos, basis.rot, basis.linvel, basis.angvel), rightH);
      // Lateral SLIP relative to the commanded rotation about the WHEEL CENTRE:
      // pure rotation at the target yaw rate is not slip, so grip doesn't fight
      // the turn (or pin the pivot to the grippier axle and make the bot orbit).
      const r = m.sub(worldAnchors[i], pivotWorld);
      // An omniwheel's rollers let it slide sideways freely, so on a holonomic
      // bot "lateral slip" is not slip at all — it is a commanded velocity, and
      // the servo tracks it instead of killing it. That single change is what
      // turns the tyre model into an X-drive.
      const vLatDesired = m.dot(m.cross({ x: 0, y: yawTarget, z: 0 }, r), rightH) + strafeTarget;
      const slip = vLat - vLatDesired;
      // Friction circle: lateral capacity is what the longitudinal force left over.
      // Omniwheels pay for that freedom with grip: only the roller contact
      // patch carries load, and half of each diagonal pair's force is cancelling
      // the other. gripScale is the documented weakness — a heavy pusher moves
      // Glitch around at will, which is exactly how it loses.
      const muN = T.tireMu * state.normalForce * gripScale;
      const latCapForce = Math.sqrt(Math.max(0, muN * muN - state.longForce * state.longForce));
      // Exponential scrub (v1's tuned tire feel), NOT a one-tick slip kill —
      // killing all slip per step made every micro-slide snap and read "sticky".
      const scrub = Math.min(1, dt * T.latGripRate);
      const impulse = m.clamp(-slip * (mass / 4) * scrub, -latCapForce * dt, latCapForce * dt);
      if (Math.abs(impulse) > 1e-6) {
        body.applyImpulseAtPoint(m.scale(rightH, impulse), worldAnchors[i], true);
      }
    }
  }

  function applyYawServo(dt, turnInput, yawTarget, grip, angvel, rot) {
    const wy = angvel.y;
    const maxImpulse = iy * T.maxYawAccel * dt;
    let impulse;
    if (Math.abs(turnInput) > 0.1) {
      impulse = (yawTarget - wy) * iy * Math.min(0.5, dt * T.yawAssistRate * Math.max(grip, 0.2));
    } else {
      impulse = -wy * iy * Math.min(0.5, dt * T.yawSettleRate * Math.max(grip, 0.2));
    }
    impulse = m.clamp(impulse, -maxImpulse, maxImpulse);
    if (Math.abs(impulse) <= 1e-6) return;
    body.applyTorqueImpulse({ x: 0, y: impulse, z: 0 }, true);
    // A torque impulse alone spins the body about its CENTRE OF MASS — that is
    // what a free rigid body does, and it is not what a bot on wheels does. The
    // servo's job is to turn the machine about its wheel centre, so it pairs
    // the torque with the linear impulse that leaves that point's velocity
    // untouched: dw x d is what the pivot would otherwise pick up, so cancel it.
    const d = m.qRotate(rot, wheelCenterOffset);
    const dw = impulse / iy;
    body.applyImpulse({ x: -mass * dw * d.z, y: 0, z: mass * dw * d.x }, true);
  }

  function applySafetyRails(dt, pos, linvel) {
    const speed = m.length(linvel);
    if (speed > T.speedCap) {
      // Impulse (not a velocity write) pulling halfway back to the cap per tick.
      const desired = m.scale(linvel, T.speedCap / speed);
      body.applyImpulse(m.scale(m.sub(desired, linvel), mass * 0.5), true);
    }
    const hw = ARENA.width / 2 + T.escapeMargin;
    const hl = ARENA.length / 2 + T.escapeMargin;
    const push = { x: 0, y: 0, z: 0 };
    if (pos.x > hw) push.x = -1;
    else if (pos.x < -hw) push.x = 1;
    if (pos.z > hl) push.z = -1;
    else if (pos.z < -hl) push.z = 1;
    if (push.x !== 0 || push.z !== 0) {
      body.applyImpulse(m.scale(m.norm(push), mass * T.escapeAccel * dt), true);
    }
  }

  // Omnidirectional drive. An X-drive mounts four omniwheels at 45 degrees; the
  // pairs resolve into translation along both chassis axes AND yaw, all three
  // independently. In this model that reduces to two things: the lateral servo
  // tracks a commanded sideways velocity instead of killing slip, and grip is
  // scaled back because omniwheels have far less of it.
  const holonomic = spec.drive?.type === "holonomic";
  const strafeRatio = spec.drive?.strafeRatio ?? 0.9;
  const gripScale = holonomic ? (spec.drive?.pushForceScale ?? 0.55) : 1;

  // Yaw authority, scaled down by a spun-up rotor. 1 = full. Only Gigabyte's
  // shell spinner drives this today; every other bot leaves it alone.
  let gyroYawScale = 1;

  return {
    body,
    spec,
    index,
    mass,
    setGyroYawScale(v) { gyroYawScale = m.clamp(v, 0.15, 1); },
    inertia: { x: ix, y: iy, z: iz },
    restCenterHeight,
    wedgeColliders,
    armColliders,

    /** Apply one fixed step of suspension + drive forces (before world.step). */
    update(dt, rawInput) {
      const input = completeInput(rawInput);
      const pos = body.translation();
      const rot = body.rotation();
      const linvel = body.linvel();
      const angvel = body.angvel();
      // Bots with appendages that work either way up (Witch Doctor's "bunny
      // ears") keep driving when inverted: flip the effective up so the
      // suspension probes cast toward whichever face is against the floor.
      // Steering mirrors, exactly as it does on the real machine.
      let up = m.qRotate(rot, { x: 0, y: 1, z: 0 });
      const inverted = spec.canDriveInverted && up.y < 0;
      if (inverted) up = m.scale(up, -1);
      const fwdH = m.flatNorm(m.qRotate(rot, { x: 0, y: 0, z: -1 }));

      const worldAnchors = updateSuspension(dt, pos, rot, linvel, angvel, up, inverted);
      const grounded = probeState.some((p) => p.grounded);

      if (grounded && up.y > T.driveMinUpY && fwdH) {
        const throttle = (input.leftDrive + input.rightDrive) / 2;
        const turnInput = (input.leftDrive - input.rightDrive) / 2;
        // v1 yaw command: scales with the bot's speed and its tightness
        // multiplier, boosted (and capped) when spinning in place.
        const counterRotating = Math.abs(turnInput) > 0.55 && Math.abs(throttle) < 0.18;
        const turnScale = (spec.maxSpeedFps / T.baseSpeed) * m.clamp(spec.turnRate || 1, 0.45, 1.35);
        // A spun-up rotor resists being yawed. Gigabyte's shell is the only one
        // heavy enough for it to matter, and it is most of why the bot loses
        // control the moment it is up to speed: gyroYawScale is driven down by
        // its weapon in proportion to spin ratio.
        let yawRate = -turnInput * T.baseTurnRate * turnScale * gyroYawScale
          * (counterRotating ? T.counterRotateBoost : 1);
        if (counterRotating) yawRate = m.clamp(yawRate, -T.counterRotateCap, T.counterRotateCap);
        // Holonomic: the stick is a translation VECTOR, not a tank pair. Yaw
        // comes off its own channel, so the bot can hold its weapon square on
        // an opponent while circling — which is the entire reason a combat
        // robot fits omniwheels, and why Glitch is "always pointed at you".
        if (holonomic) {
          yawRate = -input.spin * T.baseTurnRate * turnScale
            * (Math.abs(input.spin) > 0.55 ? T.counterRotateBoost : 1);
          // Same ceiling the tank pair gets when it counter-rotates. Without it
          // a fast X-drive on full stick was commanded nearly three revolutions
          // a second — the rate is the product of the bot's top speed and its
          // tightness, and on Glitch both are high.
          yawRate = m.clamp(yawRate, -T.counterRotateCap, T.counterRotateCap);
        }
        const targets = {
          forward: input.brake ? 0 : throttle * spec.maxSpeedFps,
          yawRate,
          brake: input.brake,
        };
        const basis = { pos, rot, linvel, angvel, fwdH, rightH: m.cross(fwdH, { x: 0, y: 1, z: 0 }) };
        driveSide(dt, leftIdx, targets, basis, worldAnchors);
        driveSide(dt, rightIdx, targets, basis, worldAnchors);
        const strafeTarget = holonomic && !input.brake
          ? input.strafe * spec.maxSpeedFps * strafeRatio
          : 0;
        applyLateralGrip(dt, basis, worldAnchors, targets.yawRate, strafeTarget);
        // Turning about a point that is not the centre of mass means the COM is
        // travelling in a circle, and something has to supply m*w^2*d to hold it
        // there. Left to the grip servos it comes out of SLIP — they are
        // proportional, so a standing demand buys a standing error, and the
        // pivot creeps back toward the COM the faster the bot spins. Handing
        // them the known term up front leaves them only the disturbances, which
        // is what they are for.
        const wy = angvel.y;
        if (Math.abs(wy) > 0.1) {
          const d = m.qRotate(rot, wheelCenterOffset);
          body.applyImpulse({ x: mass * wy * wy * d.x * dt, y: 0, z: mass * wy * wy * d.z * dt }, true);
        }
        const grip = probeState.filter((p) => p.grounded).length / probeState.length;
        applyYawServo(dt, holonomic ? input.spin : turnInput, targets.yawRate, grip, angvel, rot);
      } else if (!grounded) {
        // Airborne: no drive forces, light angular damping only.
        const damp = Math.min(0.3, dt * T.airAngularDamp);
        body.applyTorqueImpulse(
          { x: -angvel.x * ix * damp, y: -angvel.y * iy * damp, z: -angvel.z * iz * damp },
          true,
        );
      }
      applySafetyRails(dt, pos, linvel);
    },

    /**
     * Is the chassis close enough to the floor to shove off it? Unlike
     * isGrounded() this does not care which way up the bot is — the suspension
     * probes switch off when it is inverted, which is exactly when a srimech
     * needs to know the ground is there.
     */
    touchingGround(margin = 0.4) {
      ray.origin = body.translation();
      ray.dir = { x: 0, y: -1, z: 0 };
      // Full body height, not half: a bot on its back rests on whatever sticks
      // up furthest, so its centre sits higher than half its own depth. Half a
      // height was short enough that Hydra and Sawblaze read as airborne while
      // lying on the floor.
      const reach = spec.bodyDims.y + margin;
      return Boolean(world.castRay(ray, reach, true, undefined, SUSPENSION_RAY_GROUPS, undefined, body));
    },

    isGrounded() {
      return probeState.some((p) => p.grounded);
    },
    probeCompression() {
      return probeState.map((p) => p.compression / T.probeTravel);
    },
    getWheelSpin() {
      return wheelSpin.slice();
    },

    /** Reset pose/velocity (match reset only — never called during play). */
    resetTo(spawnPose) {
      body.setTranslation({ x: spawnPose.x, y: restCenterHeight + 0.15, z: spawnPose.z }, true);
      body.setRotation(m.qFromYaw(spawnPose.yaw), true);
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      for (let i = 0; i < wheelSpin.length; i++) wheelSpin[i] = 0;
    },
  };
}
