// Weapon systems. Spinners carry a scalar energy budget (E = 1/2 I w^2) and a
// thin solid collider; hits are scripted impulses at the real contact point,
// capped AFTER all multipliers, with equal-and-opposite kickback and energy
// drain. Flipper/crusher/hammer use stroke windows + zone checks.

import { EV } from "../shared/events.js";
import { RAPIER, WEAPON_GROUPS, tagCollider } from "./world.js";
import { contactPointBetween } from "./contacts.js";
import { createSpinnerModel, resolveWeaponTuning, damageImpulseForRate } from "./weaponTuning.js";
import * as m from "./math.js";

export const WEAPON_TUNING = Object.freeze({
  // Coast-down, in seconds from full speed to stopped. This is v1's number.
  //
  // v1 gave every spinner its own wind-up but shared one coast: 1.1s across the
  // whole six-bot roster, with HUGE the single exception at 0.8s. That is not
  // physics — spin-up is set by motor power and coast-down by bearing friction
  // and windage, and real bar spinners genuinely coast for tens of seconds,
  // which is why teams fit brakes. It is a control decision. The wind-up is the
  // commitment the player is buying; making them wait through a proportional
  // coast just taxes them twice for the same choice, and a rotor that stays
  // live for ten seconds after the trigger comes off is not something anyone
  // can plan around. So spin-up varies per bot and spin-down does not, unless
  // a weapon states its own with weapon.spinDownSeconds.
  spinDownSeconds: 1.1,
  minHitRatio: 0.12, // below this spin ratio the blade is harmless
  hitCooldownSeconds: 0.18, // per target pair (v1's rate; the spin ramp doubles hits without it)
  wallHitCooldownSeconds: 0.16,
  wallImpulseFactor: 0.4, // of the raw budget, before the 0.6*cap wall cap
  heavyHitCapFraction: 0.5, // J >= cap*this flags a stroke weapon's hit "heavy"
  flipperImpulseDir: { up: 1, forward: 0.45 },
  flipperRecoilFraction: 0.3,
  crusherTickSeconds: 0.25,
  // --- self-righting ---------------------------------------------------------
  // A bot on its back is not out of the fight: any arm that can reach the floor
  // shoves against it, and a spun-up rotor can be walked over by throwing the
  // drive from lock to lock. Both need the bot to actually be ON something —
  // neither works in mid-air.
  srimechUpY: 0.25, // above this the bot is upright enough; do nothing
  // The srimech is ONE impulse per stroke, not a torque spread across it:
  // rolling a flat 250lb machine over its own edge has to beat m*g*halfWidth
  // the whole way, so a distributed torque just rocks it and it drops back. A
  // kick that leaves the floor finishes the rotation in the air. Its size is
  // derived rather than dialled — see srimechKickSpeed() — because a fixed
  // speed that turns a light bot half a revolution sends a heavy one to the
  // ceiling: at 11.5 ft/s flat, Bronco pulled 2.2 revolutions a second and
  // Deep Six peaked 7ft up.
  srimechTurns: 0.62, // revolutions to aim for while airborne (a bit past half)
  srimechCooldownSeconds: 0.6, // one kick per stroke, and no machine-gunning
  gyroSelfRightLift: 2.6, // ft/s^2 of unweighting while the rotor walks it over
  // Roll authority for a spun-up rotor being walked over on the sticks. Also
  // has to beat gravity's restoring torque, which for a 250lb bot about its own
  // edge is ~80 rad/s^2 of angular acceleration — hence the size of this.
  gyroSelfRightRate: 150,
  gyroSelfRightMinRatio: 0.25,
  gyroSelfRightMinEffort: 0.3,
  crusherDragBlendRate: 3.5, // 1/s velocity bleed while clamped
  hammerContactAfter: 0.35, // fraction of swing before the head can connect
  hammerGrindTickSeconds: 0.3,
});

const TU = WEAPON_TUNING;
const UP = { x: 0, y: 1, z: 0 };

/**
 * Drive a swinging arm into the floor to throw an overturned bot back over.
 * The impulse lands at the arm's business end, which is ahead of the centre of
 * mass, so the bot leaves the ground pitching — the roll finishes in the air.
 * Returns whether it fired, so a weapon can rate-limit itself.
 */
/**
 * How hard to kick, from the bot's own numbers. An impulse `m*v` at arm `r`
 * spins the bot at `w = m*v*r/I` and buys `t = 2v/g` of airtime, so it turns
 * `w*t/2pi = m*v^2*r/(pi*g*I)` revolutions. Solve that for the speed that turns
 * `srimechTurns`, and every bot lands the same way up regardless of its mass,
 * length or how far its arm reaches.
 */
function srimechKickSpeed(vehicle, arm) {
  const turns = TU.srimechTurns;
  return Math.sqrt((turns * Math.PI * 32.174 * vehicle.inertia.x) / (vehicle.mass * Math.max(0.2, arm)));
}

function armSrimech(vehicle, state, simTime, scale = 1) {
  const rot = vehicle.body.rotation();
  if (m.qRotate(rot, UP).y > TU.srimechUpY) return false;
  if (simTime - state.lastSrimechAt < TU.srimechCooldownSeconds) return false;
  if (!vehicle.touchingGround()) return false;
  state.lastSrimechAt = simTime;
  const spec = vehicle.spec;
  // Where the arm meets the floor: out at the nose, level with its hinge.
  const at = {
    x: spec.weapon.pivot?.x ?? 0,
    y: spec.weapon.pivot?.y ?? 0,
    z: -spec.bodyDims.z * 0.42,
  };
  const arm = Math.abs(at.z - 0.08 * spec.bodyDims.z); // about the COM, not the origin
  const point = m.add(vehicle.body.translation(), m.qRotate(rot, at));
  vehicle.body.applyImpulseAtPoint(
    m.scale(UP, vehicle.mass * srimechKickSpeed(vehicle, arm) * scale),
    point,
    true,
  );
  return true;
}

function horizontalBetween(fromPos, toPos) {
  return m.flatNorm(m.sub(toPos, fromPos)) ?? { x: 0, y: 0, z: -1 };
}

/** Transform a world point into a vehicle's body-local frame. */
function toLocal(vehicle, worldPoint) {
  return m.qRotateInv(vehicle.body.rotation(), m.sub(worldPoint, vehicle.body.translation()));
}

function localZoneContains(zone, p) {
  return (
    p.z >= zone.minZ && p.z <= zone.maxZ &&
    Math.abs(p.x) <= zone.halfX &&
    p.y >= zone.minY && p.y <= zone.maxY
  );
}

/** Default front zone reaching `reach` ft beyond the chassis nose (-z). */
function frontZone(spec, reach, extra = {}) {
  const halfZ = spec.bodyDims.z / 2;
  return {
    minZ: -(halfZ + reach),
    maxZ: -halfZ + (extra.overlap ?? 0.5),
    halfX: spec.bodyDims.x / 2 + (extra.pad ?? 0.4),
    minY: extra.minY ?? -0.7,
    maxY: extra.maxY ?? 1.3,
  };
}

// ---------------------------------------------------------------------------
// Spinner (bar / drum)
// ---------------------------------------------------------------------------

function createSpinner({ world, meta, vehicle, index, emit }) {
  const spec = vehicle.spec;
  const w = spec.weapon;
  const model = createSpinnerModel(spec);
  const tuning = model.tuning;
  const radius = w.radius ?? Math.max(w.dims?.y ?? 0.55, w.dims?.z ?? 0.55);

  // Thin solid collider glued to the chassis body (same body = no self-hits).
  // It stands in for the SWEPT volume, not the blade pose, because the collider
  // never rotates: a disc of the weapon's own radius, as thick as the weapon is
  // along its spin axis, centred on the pivot. Sizing it from the catalog
  // matters — the old fixed 4ft-wide slab was wider than Tombstone's whole
  // chassis and reached a foot past his tail, so he shouldered opponents and
  // walls away from empty air.
  const axis = w.axis ?? { x: 1, y: 0, z: 0 };
  const along = Math.abs(axis.x) > 0.5 ? "x" : Math.abs(axis.z) > 0.5 ? "z" : "y";
  const halfThickness = w.dims?.[along] ?? (w.length !== undefined ? w.length / 2 : 0.4);
  const desc = RAPIER.ColliderDesc.cylinder(halfThickness, radius);
  if (along === "x") desc.setRotation(m.qFromAxisAngle({ x: 0, y: 0, z: 1 }, Math.PI / 2));
  else if (along === "z") desc.setRotation(m.qFromAxisAngle({ x: 1, y: 0, z: 0 }, Math.PI / 2));
  desc
    .setTranslation(w.pivot.x, w.pivot.y, w.pivot.z)
    .setDensity(0)
    .setFriction(0.2)
    .setRestitution(0.1)
    .setCollisionGroups(WEAPON_GROUPS)
    .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS | RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
    .setContactForceEventThreshold(120);
  const collider = world.createCollider(desc, vehicle.body);
  tagCollider(meta, collider, { kind: "weapon", botIndex: index, surface: "bot" });

  const coastSeconds = w.spinDownSeconds ?? TU.spinDownSeconds;

  // Tantrum's drum is not bolted to the frame: it rides a carriage on the rails
  // down the middle of the bot. Holding the saw channel winches it back and up
  // the track to the far stop; letting go fires it forward again, and the whole
  // point of the mechanic is that the drum is TRAVELLING when it arrives.
  //
  // The collider is dragged along with it, which is the cost of the wind-up:
  // while the drum is parked at the back it is a foot behind where it can reach
  // anything. Moving a collider relative to its parent is not a teleport of a
  // dynamic body — the chassis body is untouched — so the no-setTranslation
  // rule is not in play here.
  const track = w.track ?? null;
  let carriage = 0; // 0 at the front stop where the drum rests, 1 parked at the back top
  let carriageRate = 0; // stroke per second, negative on the forward stroke

  function updateTrack(dt, ctx) {
    const pulling = Boolean(ctx.input?.sawActive);
    const rate = pulling
      ? 1 / Math.max(0.05, track.retractSeconds)
      : -1 / Math.max(0.05, track.flingSeconds);
    const next = m.clamp(carriage + rate * dt, 0, 1);
    carriageRate = (next - carriage) / dt;
    if (next === carriage) return;
    carriage = next;
    collider.setTranslationWrtParent({
      x: w.pivot.x + (track.offset.x ?? 0) * carriage,
      y: w.pivot.y + track.offset.y * carriage,
      z: w.pivot.z + track.offset.z * carriage,
    });
  }

  // How much harder the drum lands mid-fling. It is applied to the finished
  // impulses rather than fed into the spinner model's approach-speed term
  // because that term is inside the budget cap, and the cap is the ROTOR's
  // stored energy — the carriage's momentum is not part of it and should not be
  // swallowed by it. The multiplier is flat across the stroke since the
  // carriage runs at a constant rate.
  function flingScale() {
    if (!track || carriageRate >= 0) return 1;
    const moving = m.clamp(-carriageRate * track.flingSeconds, 0, 1);
    return 1 + (track.hitBoost - 1) * moving;
  }

  let omega = 0;
  let angle = 0;
  let lastEmittedRatio = -1;
  let lastEmittedPowered = false;
  const lastHitAt = new Map(); // "foe" | "arena" -> simTime

  // Tantrum's fist arms: a third, independent mechanism on the aux channel.
  // They hinge on the axle across the back of the bot and swing up through a
  // quarter turn, so their zone is short and high — they hit what is already
  // pressed against the front, which is exactly the moment the drum has stalled
  // against an opponent and needs help.
  const fists = w.fists ?? null;
  const fistZone = fists ? frontZone(spec, fists.reach ?? 1.0, { pad: -0.1, minY: -0.2, maxY: 1.6 }) : null;
  let fistStroke = 0; // 0 arms down at rest, 1 arms up at full lift
  let fistOut = false; // debounces one hit per punch
  function updateFists(dt, ctx) {
    const punching = Boolean(ctx.input?.auxActive);
    const seconds = Math.max(0.05, fists.punchSeconds ?? 0.18);
    fistStroke = m.clamp(fistStroke + (punching ? dt / seconds : -dt / (seconds * 2.2)), 0, 1);
    if (fistStroke < 0.85) { if (fistStroke < 0.4) fistOut = false; return; }
    if (fistOut) return;
    fistOut = true;
    const foe = ctx.foe;
    const local = toLocal(vehicle, foe.body.translation());
    if (!localZoneContains(fistZone, local)) return;
    const h = horizontalBetween(vehicle.body.translation(), foe.body.translation());
    const impulse = fists.impulse ?? 90;
    const point = m.add(foe.body.translation(), m.v3(0, 0.35, 0));
    foe.body.applyImpulseAtPoint(m.add(m.scale(h, impulse), m.scale(UP, impulse * 0.35)), point, true);
    vehicle.body.applyImpulse(m.scale(h, -impulse * 0.35), true);
    emit(EV.WEAPON_HIT, {
      attackerIndex: index,
      targetIndex: foe.index,
      point,
      normal: m.scale(h, -1),
      impulse: damageImpulseForRate(fists.damagePerHit ?? 2.5, 1),
      appliedImpulse: impulse,
      energyBefore: 0,
      heavy: false,
    });
  }

  function energy() {
    return 0.5 * w.inertia * omega * omega;
  }

  function drainEnergy(joules) {
    const e = Math.max(0, energy() - joules);
    omega = Math.sign(omega || 1) * Math.sqrt((2 * e) / w.inertia);
  }

  function pivotWorld() {
    return m.add(vehicle.body.translation(), m.qRotate(vehicle.body.rotation(), w.pivot));
  }

  // v1's shaping chain, bridged into v2 units by weaponTuning.js. The catalog's
  // per-bot numbers live under weapon.tuning, which nothing here used to read,
  // so every spinner ran on the generic defaults and all three drums sat on
  // their budget cap above ~10-20% spin — one flat hit at any speed.
  function hitTarget(foe, contact, simTime) {
    const energyBefore = energy();
    const h = horizontalBetween(vehicle.body.translation(), foe.body.translation());
    const rel = m.sub(foe.body.linvel(), vehicle.body.linvel());
    const hit = model.hit({
      ratio: omega / w.maxOmega,
      targetSpec: foe.spec,
      approachSpeed: Math.max(0, -m.dot(rel, h)),
    });
    if (hit.push < 1) return;
    // A drum on a carriage that is mid-fling arrives with the machine's own
    // closing speed added to it, and that is the whole reason to pull it back.
    const fling = flingScale();
    const push = hit.push * fling;
    const lift = hit.lift * fling;

    // Target: horizontal push + lift at the real contact point.
    foe.body.applyImpulseAtPoint(
      m.add(m.scale(h, push), m.scale(UP, lift)),
      contact.point,
      true,
    );
    // v1 forced a minimum upward velocity here (setLinvel). Impulse top-up
    // instead — same result, and the no-teleport rule holds.
    const vy = foe.body.linvel().y;
    if (hit.liftVelocityFloor > vy) {
      foe.body.applyImpulse(m.scale(UP, (hit.liftVelocityFloor - vy) * foe.mass), true);
    }
    const right = m.norm(m.cross(UP, h), { x: 1, y: 0, z: 0 });
    foe.body.applyTorqueImpulse({
      x: right.x * hit.targetPitchTorque,
      y: hit.targetYawTorque,
      z: right.z * hit.targetPitchTorque,
    }, true);

    // Attacker: kickback along -h, a little downward, plus counter-yaw.
    // recoilScale is Gigabyte's: every hit throws IT as hard as its target, and
    // that ricochet is why it loses control the moment it connects. Momentum
    // says a hit is equal and opposite whatever the weapon, so this is a
    // statement about how much of it the chassis absorbs rather than physics.
    const recoil = w.recoilScale ?? 1;
    vehicle.body.applyImpulseAtPoint(
      m.scale(m.add(m.scale(h, -hit.kickback), m.scale(UP, -hit.kickbackLift)), recoil),
      pivotWorld(),
      true,
    );
    vehicle.body.applyTorqueImpulse({ x: 0, y: -hit.ownerYawTorque * recoil, z: 0 }, true);
    if (hit.ownerPitchTorque) {
      // Tumble the attacker about its own lateral axis — Deep Six beaching
      // itself on a big hit is the whole reason it is not simply the best bot.
      const lateral = m.qRotate(vehicle.body.rotation(), { x: 1, y: 0, z: 0 });
      vehicle.body.applyTorqueImpulse(m.scale(lateral, hit.ownerPitchTorque), true);
    }

    // v1 drained blade SPEED, not energy — a solid hit costs you the spin-up.
    omega *= hit.spinRetained;

    emit(EV.WEAPON_HIT, {
      attackerIndex: index,
      targetIndex: foe.index,
      point: contact.point,
      normal: contact.normal,
      // Damage runs off v1's pre-impulseScale hit strength, not the applied
      // impulse: that split is why Minotaur hurts without shoving and Tombstone
      // throws you across the box without doing proportionate damage.
      impulse: hit.damageImpulse * fling,
      appliedImpulse: push, // what the body actually got, for effects/haptics
      energyBefore,
      heavy: push / foe.mass >= 12, // "heavy" = it launched them (ft/s), not "it capped"
    });
    lastHitAt.set("foe", simTime);
  }

  function hitArena(contact, simTime) {
    const e = energy();
    const efficiency = tuning.efficiency;
    const raw = Math.sqrt(2 * vehicle.mass * e * efficiency);
    const impulse = Math.min(raw * TU.wallImpulseFactor, w.budgetCap * 0.6);
    if (impulse < 2) return;
    // Wall sparks: bounce the attacker off, chew some stored energy.
    const away = m.norm({ x: -contact.normal.x, y: 0.15, z: -contact.normal.z });
    vehicle.body.applyImpulseAtPoint(m.scale(away, impulse), contact.point, true);
    drainEnergy((impulse * impulse) / (2 * vehicle.mass) / efficiency);
    emit(EV.WEAPON_HIT, {
      attackerIndex: index,
      targetIndex: null,
      point: contact.point,
      normal: contact.normal,
      impulse,
      energyBefore: e,
      heavy: false,
    });
    lastHitAt.set("arena", simTime);
  }

  function checkContacts(ctx) {
    const { foe, simTime } = ctx;
    world.contactPairsWith(collider, (other) => {
      const info = meta.get(other.handle);
      if (!info) return;
      if (info.kind === "bot" && info.botIndex === foe.index) {
        const last = lastHitAt.get("foe");
        if (last !== undefined && simTime - last < TU.hitCooldownSeconds) return;
        const contact = contactPointBetween(world, collider, other);
        if (contact) hitTarget(foe, contact, simTime);
      } else if (info.kind === "arena" && info.surface !== "floor") {
        const last = lastHitAt.get("arena");
        if (last !== undefined && simTime - last < TU.wallHitCooldownSeconds) return;
        const contact = contactPointBetween(world, collider, other);
        if (contact) hitArena(contact, simTime);
      }
    });
  }

  return {
    type: w.type,
    update(dt, fire, ctx) {
      const spinUpRate = w.maxOmega / Math.max(0.05, w.spinUpSeconds);
      const spinDownRate = w.maxOmega / Math.max(0.05, coastSeconds);
      if (fire) omega = Math.min(w.maxOmega, omega + spinUpRate * dt);
      else omega = Math.max(0, omega - spinDownRate * dt);
      angle += omega * dt;

      const ratio = omega / w.maxOmega;
      // A spun-up rotor fights the steering. Only a full-body shell is heavy
      // enough for this to be worth modelling, and on Gigabyte it is half the
      // character of the machine: six seconds of nearly helpless spin-up buys
      // the hardest hit in the game and costs most of the turning.
      if (w.gyroPenalty) vehicle.setGyroYawScale?.(1 - w.gyroPenalty * ratio);
      // Emit on a POWER change too, not just a speed change: the rumble has to
      // stop the instant the trigger does, and at a held full ratio there is no
      // speed change to carry the news.
      if (Math.abs(ratio - lastEmittedRatio) >= 0.01 || Boolean(fire) !== lastEmittedPowered) {
        lastEmittedRatio = ratio;
        lastEmittedPowered = Boolean(fire);
        // hapticScale rides along so the pad rumble can be per-bot without the
        // input layer having to know the catalog.
        emit(EV.WEAPON_SPIN, {
          botIndex: index,
          weaponType: w.type,
          ratio,
          // Whether the motor is DRIVING, which is not the same as whether the
          // rotor is turning: a big spinner coasts for many seconds after the
          // trigger comes off. The pad should follow the motor.
          powered: Boolean(fire),
          hapticScale: tuning.hapticScale,
        });
      }

      // Upside down with the rotor lit, throwing the drive from lock to lock
      // walks the bot over: the suspension is switched off at that attitude, so
      // there is nothing damping the roll the rotor's reaction puts in. This is
      // how a Minotaur gets off its back, and it costs the same stick work.
      if (ratio > TU.gyroSelfRightMinRatio && vehicle.touchingGround()) {
        const rot = vehicle.body.rotation();
        if (m.qRotate(rot, UP).y < TU.srimechUpY) {
          const left = ctx.input?.leftDrive ?? 0;
          const right = ctx.input?.rightDrive ?? 0;
          const steer = (left - right) / 2;
          const effort = m.clamp(Math.abs(steer) + Math.abs((left + right) / 2) * 0.4, 0, 1);
          if (effort >= TU.gyroSelfRightMinEffort) {
            const forward = m.qRotate(rot, { x: 0, y: 0, z: -1 });
            // gyroScale only leans the result: a bot tuned for a heavy gyro in
            // normal driving should not also be the one that rockets off its
            // back (Deep Six at 2.2 ran 330 rad/s^2 and left the floor).
            const rate = TU.gyroSelfRightRate * ratio * effort
              * m.clamp(tuning.gyroScale, 0.6, 1.4);
            vehicle.body.applyTorqueImpulse(
              m.scale(forward, Math.sign(steer || 1) * vehicle.inertia.z * rate * dt),
              true,
            );
            vehicle.body.applyImpulse(m.scale(UP, vehicle.mass * TU.gyroSelfRightLift * dt), true);
          }
        }
      }

      // Gyroscopic reaction: a spun-up rotor fights the drive, pitching the bot
      // under throttle and rolling/yawing it into turns. Needs the drive axes,
      // which is why sim.js passes the whole input through.
      const gyro = model.gyroTorque({
        ratio,
        throttle: ((ctx.input?.leftDrive ?? 0) + (ctx.input?.rightDrive ?? 0)) / 2,
        turn: ((ctx.input?.leftDrive ?? 0) - (ctx.input?.rightDrive ?? 0)) / 2,
        dt,
      });
      if (gyro) vehicle.body.applyTorqueImpulse(gyro, true);

      // Before the contact check, so a hit landing this step sees where the
      // carriage has actually got to and how fast it is travelling.
      if (track) updateTrack(dt, ctx);
      if (ratio > TU.minHitRatio) checkContacts(ctx);
      if (fists) updateFists(dt, ctx);
    },
    getAngle: () => angle,
    getSubAngle: () => fistStroke,
    getTrack: () => carriage,
    getRatio: () => omega / w.maxOmega,
    setOmega(value) {
      omega = m.clamp(value, 0, w.maxOmega);
    },
    reset() {
      omega = 0;
      angle = 0;
      lastEmittedRatio = -1;
      lastHitAt.clear();
      fistStroke = 0;
      fistOut = false;
      if (track) {
        carriage = 0;
        carriageRate = 0;
        collider.setTranslationWrtParent({ x: w.pivot.x, y: w.pivot.y, z: w.pivot.z });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Flipper (bronco)
// ---------------------------------------------------------------------------

function createFlipper({ vehicle, index, emit }) {
  const spec = vehicle.spec;
  const w = spec.weapon;
  // Bronco's 2.0s reload lives in weapon.tuning and never reached here, so the
  // sim silently used the 1.2s default while ai.js (which does read the nested
  // block) planned around 2.0 — the two disagreed about the same weapon.
  const tune = resolveWeaponTuning(spec);
  const strokeSeconds = tune.strokeSeconds;
  const returnSeconds = tune.returnSeconds;
  const zone = tune.zone ?? frontZone(spec, tune.reach ?? 1.8);

  let phase = "idle"; // idle | firing | returning
  let t = 0;
  let hitThisStroke = false;

  // Firing the plate against the floor is how a flipper gets off its back. It
  // is the srimech on the real machines too, which is why Hydra has no other.
  const srimech = { lastSrimechAt: -Infinity };

  function tryFlip(foe) {
    const local = toLocal(vehicle, foe.body.translation());
    if (!localZoneContains(zone, local)) return;
    hitThisStroke = true;
    const impulse = w.budgetCap; // CO2 budget, applied once per stroke
    const h = horizontalBetween(vehicle.body.translation(), foe.body.translation());
    const dir = m.norm(m.add(m.scale(UP, TU.flipperImpulseDir.up), m.scale(h, TU.flipperImpulseDir.forward)));
    // Contact point pulled toward the attacker and low, so the target backflips.
    const point = m.add(foe.body.translation(), m.add(m.scale(h, -0.6), m.v3(0, -0.25, 0)));
    foe.body.applyImpulseAtPoint(m.scale(dir, impulse), point, true);
    const pivotWorld = m.add(vehicle.body.translation(), m.qRotate(vehicle.body.rotation(), w.pivot));
    vehicle.body.applyImpulseAtPoint(m.scale(UP, -impulse * TU.flipperRecoilFraction), pivotWorld, true);
    emit(EV.WEAPON_HIT, {
      attackerIndex: index,
      targetIndex: foe.index,
      point,
      normal: m.clone(UP),
      impulse,
      energyBefore: (impulse * impulse) / (2 * foe.mass),
      heavy: true,
    });
  }

  return {
    type: "flipper",
    update(dt, fire, ctx) {
      if (phase === "idle" && fire) {
        phase = "firing";
        t = 0;
        hitThisStroke = false;
        emit(EV.WEAPON_FIRED, { botIndex: index, weaponType: "flipper" });
      }
      if (phase === "firing") {
        t += dt;
        if (!hitThisStroke) tryFlip(ctx.foe);
        armSrimech(vehicle, srimech, ctx.simTime, w.selfRightScale ?? 1);
        if (t >= strokeSeconds) {
          phase = "returning";
          t = 0;
        }
      } else if (phase === "returning") {
        t += dt;
        if (t >= returnSeconds) phase = "idle";
      }
      return undefined;
    },
    getAngle() {
      if (phase === "firing") return Math.min(1, t / strokeSeconds);
      if (phase === "returning") return Math.max(0, 1 - t / returnSeconds);
      return 0;
    },
    // The meter reads CHARGE, not arm position: a flipper's reload is the thing
    // the player needs to see. Bronco's 2s and Hydra's 4s recharge are both a
    // core part of their rhythm and were previously invisible.
    getRatio() {
      if (phase === "returning") return m.clamp(t / returnSeconds, 0, 1);
      return phase === "idle" ? 1 : 0;
    },
    reset() {
      phase = "idle";
      t = 0;
      hitThisStroke = false;
    },
  };
}

// ---------------------------------------------------------------------------
// Crusher (quantum)
// ---------------------------------------------------------------------------

function createCrusher({ vehicle, index, emit }) {
  const spec = vehicle.spec;
  const w = spec.weapon;
  const tune = resolveWeaponTuning(spec);
  const zone = tune.zone ?? frontZone(spec, tune.reach ?? 1.2, { pad: -0.2, maxY: 1.0 });
  // Releasing on the same zone that engaged means the tiniest wobble at the
  // boundary drops the bite; the hold zone is deliberately looser.
  const holdZone = w.holdZone ?? frontZone(spec, (tune.reach ?? 1.2) + 1.6, { pad: 0.5, maxY: 1.6 });
  const clampForce = tune.clampForce; // lbf held at the jaw
  const tuning = w.tuning ?? {};
  // Where a bitten bot is carried: straight ahead of the jaw, on the deck.
  const holdPoint = { x: 0, y: 0.25, z: -(spec.bodyDims.z / 2 + (tuning.holdReach ?? 1.2)) };
  const holdStrength = tuning.holdStrength ?? 6; // 1/s spring toward the hold point
  const holdDamping = tuning.holdDamping ?? 1; // share of the carrier's velocity matched

  let engaged = false;
  let stroke = 0;
  const srimech = { lastSrimechAt: -Infinity };
  let lastTickAt = -Infinity;

  return {
    type: "crusher",
    update(dt, fire, ctx) {
      const { foe, simTime } = ctx;
      const local = toLocal(vehicle, foe.body.translation());
      const inZone = fire && localZoneContains(zone, local);
      if (inZone && !engaged) {
        engaged = true;
        emit(EV.WEAPON_FIRED, { botIndex: index, weaponType: "crusher" });
      }
      // Once bitten, the jaw keeps its grip until the trigger is released or
      // the target is torn out of the wider hold zone.
      if (engaged && (!fire || !localZoneContains(holdZone, local))) engaged = false;
      const previousStroke = stroke;
      stroke = m.clamp(stroke + (fire ? dt / 0.25 : -dt / 0.4), 0, 1);
      // Closing the jaw against the floor is Quantum's srimech.
      if (stroke > previousStroke) armSrimech(vehicle, srimech, simTime, w.selfRightScale ?? 1);
      if (!engaged) return;

      const carrier = vehicle.body;
      const toFoe = horizontalBetween(carrier.translation(), foe.body.translation());
      // Clamp: the jaw closes on the edge of the target NEAREST the crusher, so
      // the bite pitches its nose down onto the wedge. Pressing straight down
      // through the target's own centre — which is what a centred contact point
      // does, torque-free — just bolts it to the floor, and the friction under
      // 380lbf of it cancelled almost exactly the traction Quantum needed to
      // tow anything: full throttle while biting moved it 0.01ft.
      const jawPoint = m.add(foe.body.translation(), m.add(m.scale(toFoe, -0.5), m.v3(0, 0.3, 0)));
      foe.body.applyImpulseAtPoint(m.scale(UP, -clampForce * dt), jawPoint, true);

      // Carry: servo the target toward a hold point in FRONT of the jaw so a
      // bitten bot gets hauled around instead of merely pinned in place. The
      // wanted velocity is the carrier's own plus a spring term, which is what
      // makes the pair move as one unit. Equal-and-opposite at the jaw —
      // dragging 250lb has to cost something, or the crusher tows for free.
      const target = m.add(carrier.translation(), m.qRotate(carrier.rotation(), holdPoint));
      const offset = m.sub(target, foe.body.translation());
      const wanted = m.add(m.scale(carrier.linvel(), holdDamping), m.scale(offset, holdStrength));
      const effective = (vehicle.mass * foe.mass) / (vehicle.mass + foe.mass);
      let pull = m.scale(m.sub(wanted, foe.body.linvel()), effective * Math.min(1, dt * 10));
      // Cap so a target that is somehow far away is tugged, not catapulted.
      const cap = effective * (tuning.holdImpulseCap ?? 60) * dt;
      const magnitude = m.length(pull);
      if (magnitude > cap) pull = m.scale(pull, cap / magnitude);
      foe.body.applyImpulse(pull, true);
      carrier.applyImpulseAtPoint(m.scale(pull, -1), m.add(carrier.translation(), m.qRotate(carrier.rotation(), w.pivot)), true);
      // Bleed the target toward the CARRIER's velocity, not toward zero. The
      // absolute bleed this replaces was the other half of the anchor: it
      // fought the tow every tick it was towed.
      const drag = Math.min(0.6, dt * TU.crusherDragBlendRate);
      foe.body.applyImpulse(m.scale(m.sub(carrier.linvel(), foe.body.linvel()), foe.mass * drag * 0.5), true);

      if (simTime - lastTickAt >= TU.crusherTickSeconds) {
        lastTickAt = simTime;
        emit(EV.WEAPON_HIT, {
          attackerIndex: index,
          targetIndex: foe.index,
          point: jawPoint,
          normal: m.v3(0, -1, 0),
          impulse: damageImpulseForRate(tune.holdDamagePerSecond || 6, TU.crusherTickSeconds),
          energyBefore: 0,
          heavy: false,
        });
      }
    },
    getAngle: () => stroke,
    getRatio: () => stroke,
    reset() {
      engaged = false;
      stroke = 0;
      lastTickAt = -Infinity;
    },
  };
}

// ---------------------------------------------------------------------------
// Hammer-saw (sawblaze)
// ---------------------------------------------------------------------------

function createHammerSaw({ vehicle, index, emit }) {
  const spec = vehicle.spec;
  const w = spec.weapon;
  const tune = resolveWeaponTuning(spec);
  const swingSeconds = tune.swingSeconds;
  const returnSeconds = tune.returnSeconds;
  const zone = tune.zone ?? frontZone(spec, tune.reach ?? 2.4, { maxY: 1.6 });

  let phase = "idle"; // idle | swinging | held | returning
  let t = 0;
  const srimech = { lastSrimechAt: -Infinity };
  let hitThisSwing = false;
  let lastGrindAt = -Infinity;

  function trySlam(foe) {
    const local = toLocal(vehicle, foe.body.translation());
    if (!localZoneContains(zone, local)) return;
    hitThisSwing = true;
    const impulse = w.budgetCap; // single medium hit
    const h = horizontalBetween(vehicle.body.translation(), foe.body.translation());
    // Overhead arc slams down onto the target's top — mostly downward so the
    // target gets pinned under the saw instead of shoved out of reach.
    const dir = m.norm(m.add(m.scale(h, 0.25), m.scale(UP, -0.9)));
    const point = m.add(foe.body.translation(), m.v3(0, 0.4, 0));
    foe.body.applyImpulseAtPoint(m.scale(dir, impulse), point, true);
    emit(EV.WEAPON_HIT, {
      attackerIndex: index,
      targetIndex: foe.index,
      point,
      normal: m.v3(0, -1, 0),
      impulse,
      energyBefore: 0,
      heavy: impulse >= w.budgetCap * TU.heavyHitCapFraction,
    });
  }

  function grind(foe, simTime) {
    const local = toLocal(vehicle, foe.body.translation());
    if (!localZoneContains(zone, local)) return;
    if (simTime - lastGrindAt < TU.hammerGrindTickSeconds) return;
    lastGrindAt = simTime;
    emit(EV.WEAPON_HIT, {
      attackerIndex: index,
      targetIndex: foe.index,
      point: m.add(foe.body.translation(), m.v3(0, 0.4, 0)),
      normal: m.v3(0, -1, 0),
      impulse: damageImpulseForRate(tune.grindDamagePerSecond || 5, TU.hammerGrindTickSeconds),
      energyBefore: 0,
      heavy: false,
    });
  }

  return {
    type: "hammerSaw",
    update(dt, fire, ctx) {
      if (phase === "idle" && fire) {
        phase = "swinging";
        t = 0;
        hitThisSwing = false;
        emit(EV.WEAPON_FIRED, { botIndex: index, weaponType: "hammerSaw" });
      }
      if (phase === "swinging") {
        t += dt;
        armSrimech(vehicle, srimech, ctx.simTime, w.selfRightScale ?? 1);
        if (!hitThisSwing && t >= swingSeconds * TU.hammerContactAfter) trySlam(ctx.foe);
        if (t >= swingSeconds) {
          phase = fire ? "held" : "returning";
          t = 0;
        }
      } else if (phase === "held") {
        grind(ctx.foe, ctx.simTime);
        if (!fire) {
          phase = "returning";
          t = 0;
        }
      } else if (phase === "returning") {
        t += dt;
        if (t >= returnSeconds) phase = "idle";
      }
    },
    getAngle() {
      if (phase === "swinging") return Math.min(1, t / swingSeconds);
      if (phase === "held") return 1;
      if (phase === "returning") return Math.max(0, 1 - t / returnSeconds);
      return 0;
    },
    getRatio() {
      return this.getAngle();
    },
    reset() {
      phase = "idle";
      t = 0;
      hitThisSwing = false;
      lastGrindAt = -Infinity;
    },
  };
}

// ---------------------------------------------------------------------------
// Hammer (beta)
// ---------------------------------------------------------------------------

// Beta is a hammerSaw without the disc, but the two things that make a hammer
// feel like a hammer are exactly what the hammerSaw stroke does not model:
// the swing is fast and the re-cock is slow, and the head is worth almost
// nothing at the top of the arc and everything at the bottom. Beta's magnets
// (~400kg of downforce on the real robot) are here too, as a standing
// down-impulse plus a damped strike reaction — it should neither be flipped
// easily nor throw itself over when the head lands.
function createHammer({ vehicle, index, emit }) {
  const spec = vehicle.spec;
  const w = spec.weapon;
  const tune = resolveWeaponTuning(spec);
  const strokeSeconds = tune.strokeSeconds; // fast strike
  const returnSeconds = tune.returnSeconds; // slow re-cock
  const zone = tune.zone ?? frontZone(spec, tune.reach ?? 1.6, { maxY: 1.5 });
  const downforce = w.downforce ?? 0; // lbf held onto the floor
  const reactionScale = w.reactionScale ?? 0.15;

  let phase = "idle"; // idle | swinging | returning
  let t = 0;
  let hitThisSwing = false;

  // The head is worth nothing near the top and everything at the bottom, so
  // the strike lands LATE in the stroke, not the instant the target is in
  // reach — firing at first contact handed out ~10% hits.
  const strikeAt = w.strikeAt ?? 0.82;
  const arcPower = (stroke) => m.clamp(stroke, 0, 1) ** 2;

  function trySlam(foe, stroke) {
    const local = toLocal(vehicle, foe.body.translation());
    if (!localZoneContains(zone, local)) return;
    const power = arcPower(stroke);
    if (power < 0.05) return;
    hitThisSwing = true;
    const impulse = w.budgetCap * power;
    const h = horizontalBetween(vehicle.body.translation(), foe.body.translation());
    // Overhead arc lands on the target's roof: almost straight down, so it gets
    // driven into the floor rather than shoved away.
    const dir = m.norm(m.add(m.scale(h, 0.2), m.scale(UP, -0.98)));
    const point = m.add(foe.body.translation(), m.v3(0, 0.45, 0));
    foe.body.applyImpulseAtPoint(m.scale(dir, impulse), point, true);
    // Magnets eat most of the reaction; without this Beta backflips off its own
    // hit, which is the single thing the real robot was built not to do.
    vehicle.body.applyImpulseAtPoint(
      m.scale(UP, impulse * reactionScale),
      m.add(vehicle.body.translation(), m.qRotate(vehicle.body.rotation(), w.pivot)),
      true,
    );
    emit(EV.WEAPON_HIT, {
      attackerIndex: index,
      targetIndex: foe.index,
      point,
      normal: m.v3(0, -1, 0),
      impulse,
      appliedImpulse: impulse,
      energyBefore: 0,
      heavy: power > 0.6,
    });
  }

  // Driving the head into the floor levers the body back over — the hammer is
  // Beta's srimech as much as its weapon.
  const srimech = { lastSrimechAt: -Infinity };

  return {
    type: "hammer",
    update(dt, fire, ctx) {
      if (downforce > 0 && vehicle.isGrounded()) {
        vehicle.body.applyImpulse(m.scale(UP, -downforce * dt), true);
      }
      if (phase === "idle" && fire) {
        phase = "swinging";
        t = 0;
        hitThisSwing = false;
        emit(EV.WEAPON_FIRED, { botIndex: index, weaponType: "hammer" });
      }
      if (phase === "swinging") {
        t += dt;
        const stroke = Math.min(1, t / strokeSeconds);
        if (!hitThisSwing && stroke >= strikeAt) trySlam(ctx.foe, stroke);
        armSrimech(vehicle, srimech, ctx.simTime, w.selfRightScale ?? 1);
        if (t >= strokeSeconds) {
          phase = "returning";
          t = 0;
        }
      } else if (phase === "returning") {
        t += dt;
        if (t >= returnSeconds) phase = "idle";
      }
    },
    getAngle() {
      if (phase === "swinging") return Math.min(1, t / strokeSeconds);
      if (phase === "returning") return Math.max(0, 1 - t / returnSeconds);
      return 0;
    },
    getRatio() {
      // The meter reads "ready to swing", which for a hammer is the re-cock.
      if (phase === "returning") return Math.max(0, 1 - t / returnSeconds);
      return phase === "idle" ? 1 : 0;
    },
    reset() {
      phase = "idle";
      t = 0;
      hitThisSwing = false;
    },
  };
}

// ---------------------------------------------------------------------------
// Lifter + disc (whiplash)
// ---------------------------------------------------------------------------

// Two weapons on one assembly: a rear-hinged arm the player HOLDS at an angle
// (not a one-shot stroke — the point is to get under an opponent and carry
// them), and a disc on that arm which spins independently on its own toggle,
// exactly the RT/RB split Sawblaze already uses.
// Also serves the plain `lifter` (Duck's beak, Free Shipping's forklift): same
// arm, no disc. Everything disc-shaped is gated on `weapon.disc` existing, so a
// lifter without one neither spins a phantom rotor nor chews the target on a
// channel its bot has no hardware for. Free Shipping instead spends that
// channel on `weapon.flame`.
function createLifterDisc({ vehicle, index, emit }) {
  const spec = vehicle.spec;
  const w = spec.weapon;
  // The plow's solid, swung about the arm's own pivot. Duck's plow is drawn on
  // an arm that reaches over the top of the machine, but its collider used to
  // sit where the catalog parked it and never move: raise the arm and the plow
  // became a hologram, so bringing it down on an opponent passed straight
  // through and the only thing that ever touched them was the lift impulse's
  // zone test. Marking a collider `ridesArm` in the catalog hands it to this.
  //
  // These are colliders on the bot's OWN body, so re-posing them relative to
  // that body is not a teleport of a dynamic body and the no-setTranslation
  // rule does not apply. Rapier resolves the new pose on the next step like any
  // other moving part.
  const armColliders = vehicle.armColliders ?? [];
  const armAxis = m.norm(w.axis ?? { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 });
  function poseArmColliders(stroke) {
    if (armColliders.length === 0) return;
    const angle = (w.restAngle ?? 0) + stroke * ((w.fireAngle ?? 0) - (w.restAngle ?? 0));
    const turn = m.qFromAxisAngle(armAxis, angle - (w.restAngle ?? 0));
    for (const ride of armColliders) {
      ride.collider.setTranslationWrtParent(
        m.add(w.pivot, m.qRotate(turn, m.sub(ride.offset, w.pivot))),
      );
      ride.collider.setRotationWrtParent(m.qMul(turn, ride.rotation));
    }
  }
  const tune = resolveWeaponTuning(spec);
  const disc = w.disc ?? null;
  const flame = w.flame ?? null;
  const raiseSeconds = tune.strokeSeconds;
  const lowerSeconds = w.lowerSeconds ?? tune.strokeSeconds * 1.3;
  // The lift zone sits LOW and close: the forks have to be under the target.
  const liftZone = tune.zone ?? frontZone(spec, tune.reach ?? 1.5, { minY: -0.9, maxY: 0.8 });
  // The disc rides high on the arm, so its reach is taller and a little longer.
  const discZone = w.discZone ?? frontZone(spec, (tune.reach ?? 1.5) + 0.5, { minY: -0.5, maxY: 1.8 });
  const liftImpulse = w.liftImpulse ?? 150;
  const discMaxOmega = disc?.maxOmega ?? 380;
  // The flame cone is long and narrow: it reaches well past the forks but only
  // burns what is roughly ahead, so it rewards facing the target rather than
  // being a free aura.
  const flameZone = flame
    ? frontZone(spec, flame.reach ?? 3.0, { pad: -0.2, minY: -0.6, maxY: 1.4 })
    : null;

  let stroke = 0; // 0 forks down, 1 arm fully raised
  let omega = 0;
  let carrying = false;
  // Hooked: the arm was brought DOWN onto a foe and has caught it, so the next
  // lift carries that foe even though it is no longer in the low fork zone.
  // Without this a two-way arm can only ever scoop something already lying in
  // front of the forks — you could drop the plow onto a bot and it would pass
  // straight through it. Duck's arm reaches over the top now, so coming down on
  // someone is a real move and has to mean something.
  let hooked = false;
  // Reaches higher and a little further than the fork zone: the plow catches an
  // opponent anywhere down its face, not only where it meets the floor.
  const hookZone = w.hookZone ?? frontZone(spec, (tune.reach ?? 1.5) + 0.4, { minY: -0.9, maxY: 1.5 });
  let lastEmittedRatio = -1;
  const srimech = { lastSrimechAt: -Infinity };
  let lastDiscHitAt = -Infinity;
  let lastLiftTickAt = -Infinity;
  let lastBurnAt = -Infinity;
  let burning = 0; // 0..1, drives the nozzle VFX through getSubAngle()

  function pivotWorld() {
    return m.add(vehicle.body.translation(), m.qRotate(vehicle.body.rotation(), w.pivot));
  }

  return {
    type: w.type,
    update(dt, fire, ctx) {
      const { foe, simTime } = ctx;
      const previous = stroke;
      // Two-way arm (Duck): `fire` drives it up, the secondary channel drives it
      // down, and it HOLDS where it is left. Every other lifter keeps the old
      // shape — held raises, released falls back — because their second channel
      // is spoken for by a disc or a flamethrower.
      const drop = w.twoWayArm ? Boolean(ctx.input?.sawActive) : !fire;
      const dir = w.twoWayArm ? (fire ? 1 : 0) - (drop ? 1 : 0) : (fire ? 1 : -1);
      stroke = m.clamp(stroke + (dir > 0 ? dt / raiseSeconds : dir < 0 ? -dt / lowerSeconds : 0), 0, 1);
      const rise = stroke - previous;
      // Carry the plow's solid with the arm before anything else this step, so
      // a contact resolving now sees the plow where it is drawn.
      if (rise !== 0) poseArmColliders(stroke);
      // Upside down, raising the forks drives them into the floor instead —
      // which is how a lifter gets back onto its wheels.
      if (rise > 0) armSrimech(vehicle, srimech, ctx.simTime, w.selfRightScale ?? 1);

      // Lift: spread over the whole stroke rather than fired in one impulse, so
      // holding the arm halfway holds the opponent halfway up.
      const local = toLocal(vehicle, foe.body.translation());
      const inZone = localZoneContains(liftZone, local);
      // Bringing the arm DOWN across a foe hooks it; it stays hooked while it
      // is still in front, and lets go the moment it is not.
      const inHookZone = localZoneContains(hookZone, local);
      if (rise < 0 && inHookZone) hooked = true;
      if (!inHookZone) hooked = false;
      if (rise > 0 && (inZone || hooked)) {
        if (!carrying) {
          carrying = true;
          emit(EV.WEAPON_FIRED, { botIndex: index, weaponType: w.type });
        }
        const share = rise * liftImpulse;
        const h = horizontalBetween(vehicle.body.translation(), foe.body.translation());
        // Lift at the target's near edge so it tips onto its back rather than
        // rising level off the floor.
        const point = m.add(foe.body.translation(), m.scale(h, -0.45));
        foe.body.applyImpulseAtPoint(m.scale(UP, share), point, true);
        vehicle.body.applyImpulseAtPoint(m.scale(UP, -share * (w.liftRecoil ?? 0.5)), pivotWorld(), true);
        // A lifter's job is control, not damage — but a bot that can NEVER
        // score cannot win a judged match, and Duck scored a flat zero across a
        // full fight before this. The forks grinding under an opponent tick a
        // small amount, the same way the grappler's carry does.
        if (simTime - lastLiftTickAt >= TU.crusherTickSeconds) {
          lastLiftTickAt = simTime;
          emit(EV.WEAPON_HIT, {
            attackerIndex: index,
            targetIndex: foe.index,
            point,
            normal: m.v3(0, -1, 0),
            impulse: damageImpulseForRate(tune.holdDamagePerSecond || 2.5, TU.crusherTickSeconds),
            appliedImpulse: share,
            energyBefore: 0,
            heavy: false,
          });
        }
      }
      if (!inZone) carrying = false;

      // Flamethrower (free shipping): the alt channel again, but it burns
      // rather than spins. Damage is continuous and small — it is a finisher
      // and a crowd-pleaser, not a way to win a fight on its own.
      if (flame) {
        const lit = Boolean(ctx.input?.sawActive);
        burning = m.clamp(burning + (lit ? dt / 0.12 : -dt / 0.25), 0, 1);
        if (lit && localZoneContains(flameZone, local)
          && simTime - lastBurnAt >= TU.hammerGrindTickSeconds) {
          lastBurnAt = simTime;
          emit(EV.WEAPON_HIT, {
            attackerIndex: index,
            targetIndex: foe.index,
            point: m.add(foe.body.translation(), m.v3(0, 0.25, 0)),
            normal: m.v3(0, -1, 0),
            impulse: damageImpulseForRate(flame.damagePerSecond ?? 8, TU.hammerGrindTickSeconds),
            appliedImpulse: 0, // fire pushes nothing over
            energyBefore: 0,
            heavy: false,
          });
        }
      }

      if (!disc) return;
      // Disc: its own toggle, spinning whatever the arm is doing.
      const spinning = Boolean(ctx.input?.sawActive);
      const spinUp = discMaxOmega / Math.max(0.05, disc.spinUpSeconds ?? 1.4);
      const spinDown = discMaxOmega / Math.max(0.05, disc.spinDownSeconds ?? TU.spinDownSeconds);
      omega = spinning
        ? Math.min(discMaxOmega, omega + spinUp * dt)
        : Math.max(0, omega - spinDown * dt);
      const ratio = omega / discMaxOmega;
      if (Math.abs(ratio - lastEmittedRatio) >= 0.01) {
        lastEmittedRatio = ratio;
        // Announced as a bar so the audio layer's spinner whine picks it up.
        emit(EV.WEAPON_SPIN, { botIndex: index, weaponType: "bar", ratio, hapticScale: tune.hapticScale });
      }

      // Disc contact: continuous chew, not one big spike. Damage comes from
      // holding it on them, which is what the lift is for.
      if (ratio > TU.minHitRatio && localZoneContains(discZone, local)
        && simTime - lastDiscHitAt >= TU.hammerGrindTickSeconds) {
        lastDiscHitAt = simTime;
        const h = horizontalBetween(vehicle.body.translation(), foe.body.translation());
        const push = (disc.budgetCap ?? 90) * ratio * 0.12;
        const point = m.add(foe.body.translation(), m.v3(0, 0.3, 0));
        foe.body.applyImpulseAtPoint(m.add(m.scale(h, push), m.scale(UP, push * 0.4)), point, true);
        emit(EV.WEAPON_HIT, {
          attackerIndex: index,
          targetIndex: foe.index,
          point,
          normal: m.v3(0, -1, 0),
          impulse: damageImpulseForRate(disc.contactDamagePerSecond ?? 14, TU.hammerGrindTickSeconds),
          appliedImpulse: push,
          energyBefore: 0,
          heavy: false,
        });
      }
    },
    getAngle: () => stroke,
    getSubAngle: () => burning,
    // The meter reads the disc when it is spinning, the arm otherwise.
    getRatio: () => Math.max(stroke, disc ? omega / discMaxOmega : burning),
    reset() {
      stroke = 0;
      omega = 0;
      carrying = false;
      hooked = false;
      poseArmColliders(0);
      lastEmittedRatio = -1;
      lastDiscHitAt = -Infinity;
      lastLiftTickAt = -Infinity;
      lastBurnAt = -Infinity;
      burning = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Grappler (claw viper)
// ---------------------------------------------------------------------------

// A control weapon, not a damage one. The forks lift on the trigger and the
// jaw clamps on the RB channel; the hard part is neither of those, it is
// HOLDING what you grabbed. A clamped opponent is servoed to a grip point that
// rides with the arm, so raising the forks raises the victim and swinging past
// vertical suplexes it — the whole point of the machine. Releasing hands the
// arm's tip velocity to the victim, which is what turns a lift into a throw.
function createGrappler({ vehicle, index, emit }) {
  const spec = vehicle.spec;
  const w = spec.weapon;
  const tune = resolveWeaponTuning(spec);
  const claw = w.claw ?? {};
  const liftSeconds = w.liftSeconds ?? tune.strokeSeconds;
  const lowerSeconds = w.lowerSeconds ?? liftSeconds * 1.3;
  const clampSeconds = claw.clampSeconds ?? 0.25;
  // Grab zone: low and right in front, where the forks actually are.
  const grabZone = w.zone ?? frontZone(spec, tune.reach ?? 1.4, { minY: -0.9, maxY: 0.9 });
  const downforce = w.downforceLbs ?? 0;
  const gripStrength = w.gripStrength ?? 16; // 1/s spring onto the grip point
  const gripImpulseCap = w.gripImpulseCap ?? 140;

  let lift = 0; // 0 forks down, 1 fully raised
  let clamp = 0; // 0 jaw open, 1 jaw shut
  let gripped = false;
  const srimech = { lastSrimechAt: -Infinity };
  let lastTickAt = -Infinity;

  /** Grip point in BODY-local space, carried around the fork hinge by `lift`. */
  function gripLocal() {
    const reach = w.gripReach ?? (spec.bodyDims.z / 2 + 0.7);
    const arm = { x: 0, y: (w.gripHeight ?? 0.35) - w.pivot.y, z: -reach - w.pivot.z };
    // The forks sweep about the lateral axis, so the grip point sweeps with it.
    const angle = (w.restAngle ?? 0) + lift * ((w.liftAngle ?? -2.1) - (w.restAngle ?? 0));
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
      x: w.pivot.x + arm.x,
      y: w.pivot.y + arm.y * cos - arm.z * sin,
      z: w.pivot.z + arm.y * sin + arm.z * cos,
    };
  }

  function armWorld(local) {
    return m.add(vehicle.body.translation(), m.qRotate(vehicle.body.rotation(), local));
  }

  return {
    type: "grappler",
    update(dt, fire, ctx) {
      const { foe, simTime } = ctx;
      if (downforce > 0 && vehicle.isGrounded()) {
        vehicle.body.applyImpulse(m.scale(UP, -downforce * dt), true);
      }
      const jawClosing = Boolean(ctx.input?.sawActive);
      const previousLift = lift;
      lift = m.clamp(lift + (fire ? dt / liftSeconds : -dt / lowerSeconds), 0, 1);
      if (lift > previousLift) armSrimech(vehicle, srimech, ctx.simTime, w.selfRightScale ?? 1);
      clamp = m.clamp(clamp + (jawClosing ? dt / clampSeconds : -dt / clampSeconds), 0, 1);

      const local = toLocal(vehicle, foe.body.translation());
      const inReach = localZoneContains(grabZone, local);
      if (!gripped && clamp > 0.6 && inReach && lift < 0.35) {
        gripped = true;
        emit(EV.WEAPON_FIRED, { botIndex: index, weaponType: "grappler" });
      }
      if (gripped && clamp < 0.4) {
        // Release: hand the victim the speed of the arm tip so a lift that ends
        // past vertical actually throws rather than just letting go.
        const swing = (previousLift - lift) / Math.max(dt, 1e-6);
        const tip = m.sub(armWorld(gripLocal()), vehicle.body.translation());
        const throwImpulse = m.scale(tip, -swing * foe.mass * (w.throwScale ?? 0.6));
        foe.body.applyImpulse(throwImpulse, true);
        gripped = false;
      }
      if (!gripped) return;

      // Carry: servo the victim onto the grip point, matching the carrier's own
      // velocity so the pair moves as one unit.
      const target = armWorld(gripLocal());
      const offset = m.sub(target, foe.body.translation());
      const wanted = m.add(vehicle.body.linvel(), m.scale(offset, gripStrength));
      const effective = (vehicle.mass * foe.mass) / (vehicle.mass + foe.mass);
      let pull = m.scale(m.sub(wanted, foe.body.linvel()), effective * Math.min(1, dt * 12));
      const cap = effective * gripImpulseCap * dt;
      const magnitude = m.length(pull);
      if (magnitude > cap) pull = m.scale(pull, cap / magnitude);
      foe.body.applyImpulse(pull, true);
      // Hoisting 250lb has to be felt at the hinge, or the lift is free.
      vehicle.body.applyImpulseAtPoint(m.scale(pull, -1), armWorld(w.pivot), true);

      if (simTime - lastTickAt >= TU.crusherTickSeconds) {
        lastTickAt = simTime;
        emit(EV.WEAPON_HIT, {
          attackerIndex: index,
          targetIndex: foe.index,
          point: target,
          normal: m.v3(0, -1, 0),
          impulse: damageImpulseForRate(tune.holdDamagePerSecond || 3, TU.crusherTickSeconds),
          appliedImpulse: 0,
          energyBefore: 0,
          heavy: false,
        });
      }
    },
    getAngle: () => lift,
    getSubAngle: () => clamp,
    getRatio: () => Math.max(lift, clamp),
    isGripping: () => gripped,
    reset() {
      lift = 0;
      clamp = 0;
      gripped = false;
      lastTickAt = -Infinity;
    },
  };
}

// ---------------------------------------------------------------------------

/** Create the weapon system for one bot from its BotSimSpec. */
export function createWeapon(args) {
  const type = args.vehicle.spec.weapon?.type;
  // A full-body shell spinner runs the same rotor machine; what makes Gigabyte
  // different is that createSpinner sizes the weapon collider from
  // weapon.radius and weapon.dims, and on this bot that IS the whole hull —
  // so there is no safe side and no weapon face to aim, which is the point.
  if (type === "bar" || type === "drum" || type === "shellSpinner") return createSpinner(args);
  if (type === "flipper") return createFlipper(args);
  if (type === "crusher") return createCrusher(args);
  // Dragon King's saw arms are Sawblaze's machine: the arm swings and HOLDS at
  // full extension while the trigger is down (that is the cut), and the blades
  // are their own latched channel. The difference is the jaw, which is an aux
  // group rather than part of the weapon.
  if (type === "hammerSaw" || type === "sawArms") return createHammerSaw(args);
  if (type === "hammer") return createHammer(args);
  if (type === "lifterDisc" || type === "lifter") return createLifterDisc(args);
  if (type === "grappler") return createGrappler(args);
  // Weaponless fallback (keeps the sim robust to partial specs).
  return {
    type: "none",
    update() {},
    getAngle: () => 0,
    getRatio: () => 0,
    reset() {},
  };
}
