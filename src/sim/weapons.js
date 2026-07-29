// Weapon systems. Spinners carry a scalar energy budget (E = 1/2 I w^2) and a
// thin solid collider; hits are scripted impulses at the real contact point,
// capped AFTER all multipliers, with equal-and-opposite kickback and energy
// drain. Flipper/crusher/hammer use stroke windows + zone checks.

import { EV } from "../shared/events.js";
import { RAPIER, WEAPON_GROUPS, tagCollider } from "./world.js";
import { contactPointBetween } from "./contacts.js";
import * as m from "./math.js";

export const WEAPON_TUNING = Object.freeze({
  spinDownFactor: 2.5, // spin-down time = spinUpSeconds * this
  minHitRatio: 0.12, // below this spin ratio the blade is harmless
  hitCooldownSeconds: 0.09, // per target pair
  wallHitCooldownSeconds: 0.16,
  wallImpulseFactor: 0.4, // of the raw budget, before the 0.6*cap wall cap
  liftFactor: { drum: 0.85, bar: 0.25 }, // vertical component mixed into hits
  kickbackLiftFraction: 0.25, // attacker downward share of target lift
  heavyHitCapFraction: 0.5, // J >= cap*this flags the hit "heavy"
  flipperImpulseDir: { up: 1, forward: 0.45 },
  flipperRecoilFraction: 0.3,
  crusherTickSeconds: 0.25,
  crusherDragBlendRate: 3.5, // 1/s velocity bleed while clamped
  hammerContactAfter: 0.35, // fraction of swing before the head can connect
  hammerGrindTickSeconds: 0.3,
  hammerGrindImpulse: 8,
});

const TU = WEAPON_TUNING;
const UP = { x: 0, y: 1, z: 0 };

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
  const radius = w.radius ?? 0.55;

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

  let omega = 0;
  let angle = 0;
  let lastEmittedRatio = -1;
  const lastHitAt = new Map(); // "foe" | "arena" -> simTime

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

  function hitTarget(foe, contact, simTime) {
    const e = energy();
    const mEff = (vehicle.mass * foe.mass) / (vehicle.mass + foe.mass);
    const efficiency = w.efficiency ?? 0.4;
    const raw = Math.sqrt(2 * mEff * e * efficiency) * (w.impulseScale ?? 1);
    const impulse = Math.min(raw, w.budgetCap); // cap AFTER all multipliers
    if (impulse < 1) return;

    const lift = w.liftFactor ?? TU.liftFactor[w.type] ?? 0.5;
    const h = horizontalBetween(vehicle.body.translation(), foe.body.translation());
    const dir = m.norm(m.add(h, m.scale(UP, lift)));
    foe.body.applyImpulseAtPoint(m.scale(dir, impulse), contact.point, true);

    // Equal-and-opposite kickback (scaled per weapon), lift mostly cancelled so
    // the attacker recoils instead of being slammed into the floor.
    const kick = w.kickbackScale ?? 0.7;
    const kickDir = m.norm(m.add(m.scale(h, -1), m.scale(UP, -lift * TU.kickbackLiftFraction)));
    vehicle.body.applyImpulseAtPoint(m.scale(kickDir, impulse * kick), pivotWorld(), true);

    drainEnergy((impulse * impulse) / (2 * mEff) / efficiency);
    emit(EV.WEAPON_HIT, {
      attackerIndex: index,
      targetIndex: foe.index,
      point: contact.point,
      normal: contact.normal,
      impulse,
      energyBefore: e,
      heavy: impulse >= w.budgetCap * TU.heavyHitCapFraction,
    });
    lastHitAt.set("foe", simTime);
  }

  function hitArena(contact, simTime) {
    const e = energy();
    const efficiency = w.efficiency ?? 0.4;
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
      const spinDownRate = w.maxOmega / Math.max(0.05, w.spinUpSeconds * TU.spinDownFactor);
      if (fire) omega = Math.min(w.maxOmega, omega + spinUpRate * dt);
      else omega = Math.max(0, omega - spinDownRate * dt);
      angle += omega * dt;

      const ratio = omega / w.maxOmega;
      if (Math.abs(ratio - lastEmittedRatio) >= 0.01) {
        lastEmittedRatio = ratio;
        // hapticScale rides along so the pad rumble can be per-bot without the
        // input layer having to know the catalog.
        emit(EV.WEAPON_SPIN, {
          botIndex: index,
          weaponType: w.type,
          ratio,
          hapticScale: w.tuning?.hapticScale ?? w.hapticScale ?? 1,
        });
      }
      if (ratio > TU.minHitRatio) checkContacts(ctx);
    },
    getAngle: () => angle,
    getRatio: () => omega / w.maxOmega,
    setOmega(value) {
      omega = m.clamp(value, 0, w.maxOmega);
    },
    reset() {
      omega = 0;
      angle = 0;
      lastEmittedRatio = -1;
      lastHitAt.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// Flipper (bronco)
// ---------------------------------------------------------------------------

function createFlipper({ vehicle, index, emit }) {
  const spec = vehicle.spec;
  const w = spec.weapon;
  const strokeSeconds = w.strokeSeconds ?? 0.18;
  const returnSeconds = w.returnSeconds ?? 1.2;
  const zone = w.zone ?? frontZone(spec, w.reach ?? 1.8);

  let phase = "idle"; // idle | firing | returning
  let t = 0;
  let hitThisStroke = false;

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
    getRatio() {
      return this.getAngle();
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
  const zone = w.zone ?? frontZone(spec, w.reach ?? 1.2, { pad: -0.2, maxY: 1.0 });
  // Releasing on the same zone that engaged means the tiniest wobble at the
  // boundary drops the bite; the hold zone is deliberately looser.
  const holdZone = w.holdZone ?? frontZone(spec, (w.reach ?? 1.2) + 1.6, { pad: 0.5, maxY: 1.6 });
  const clampForce = w.clampForce ?? 380; // lbf held at the jaw
  const tuning = w.tuning ?? {};
  // Where a bitten bot is carried: straight ahead of the jaw, on the deck.
  const holdPoint = { x: 0, y: 0.25, z: -(spec.bodyDims.z / 2 + (tuning.holdReach ?? 1.2)) };
  const holdStrength = tuning.holdStrength ?? 6; // 1/s spring toward the hold point
  const holdDamping = tuning.holdDamping ?? 1; // share of the carrier's velocity matched

  let engaged = false;
  let stroke = 0;
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
      stroke = m.clamp(stroke + (fire ? dt / 0.25 : -dt / 0.4), 0, 1);
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
          impulse: clampForce * TU.crusherTickSeconds,
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
  const swingSeconds = w.swingSeconds ?? 0.4;
  const returnSeconds = w.returnSeconds ?? 0.5;
  const zone = w.zone ?? frontZone(spec, w.reach ?? 2.4, { maxY: 1.6 });

  let phase = "idle"; // idle | swinging | held | returning
  let t = 0;
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
      impulse: TU.hammerGrindImpulse,
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

/** Create the weapon system for one bot from its BotSimSpec. */
export function createWeapon(args) {
  const type = args.vehicle.spec.weapon?.type;
  if (type === "bar" || type === "drum") return createSpinner(args);
  if (type === "flipper") return createFlipper(args);
  if (type === "crusher") return createCrusher(args);
  if (type === "hammerSaw") return createHammerSaw(args);
  // Weaponless fallback (keeps the sim robust to partial specs).
  return {
    type: "none",
    update() {},
    getAngle: () => 0,
    getRatio: () => 0,
    reset() {},
  };
}
