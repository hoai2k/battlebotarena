// What each ported bot's weapon actually DOES in v1 physics, printed as a
// table.
//
//   node v1/tools/weapon-mechanism-probe.mjs [ids...]
//
// Two questions, per bot:
//
// mechanism  Does the thing move? A spinner has to reach its full rendered
//            speed within its spin-up time; an arm has to travel from rest to
//            its stop while the button is held (or fired, for the ones that
//            commit); a nested rotor — Sawblaze's disc, Whiplash's disc, Dragon
//            King's blades — has to spin up on the SECOND channel, and a jaw
//            has to close on it.
// bite       Does it reach an opponent? The bot is parked nose-to-nose with a
//            reference foe, the weapon is run, and what comes back is the
//            damage v1's own damage pipeline recorded and how far the victim
//            was moved. A weapon that reports a stroke but never lands is the
//            failure this catches — it is the one that looks fine on screen.
import { createHeadlessPhysicsSim, headlessTestUtils } from "../src/headlessPhysicsRig.js";
import { MODEL_PART_CONFIG } from "../src/modelPartConfig.js";
import { PORTED_BOT_IDS } from "../src/portedBots.js";
import { isArmWeaponEngaged, isNewArmWeapon } from "../src/armWeapons.js";

const { THREE, bots } = headlessTestUtils;
const REFERENCE_FOE = "quantum";

export async function weaponMechanism(id) {
  const sim = await createHeadlessPhysicsSim({ playerId: id, rivalId: id === REFERENCE_FOE ? "bronco" : REFERENCE_FOE });
  try {
    const fighter = sim.fighters[0];
    const target = sim.fighters[1];
    const weapon = fighter.weapon;
    const config = MODEL_PART_CONFIG[id]?.weapon || {};
    // Set up a few feet apart and DRIVEN into the foe, rather than parked
    // nose-to-nose: two solid machines cannot start inside each other's reach,
    // they shove apart on the first step, and a weapon that only lands while
    // its owner is pushing is a weapon working normally.
    sim.setPose(fighter, { x: 0, y: fighter.restingBodyY, z: 3.4 }, 0);
    sim.setPose(target, { x: 0, y: target.restingBodyY, z: -0.6 }, Math.PI);
    sim.stepFrames(15);

    const startTarget = target.rb.translation();
    const damage = [];
    sim.weaponImpactCallbacks = {
      recordDamage: (event) => {
        if (event?.fighter !== target) return;
        damage.push({ kind: event.kind, amount: Number(event.amount) || 0 });
      },
      // A crusher reports its bite down its own channel (the game turns it into
      // the initial bite damage), so count it the same way.
      recordQuantumBiteDamage: (attacker, hit) => {
        if (hit?.fighter !== target) return;
        damage.push({ kind: "crusherBite", amount: 0.25 });
      },
    };
    let engagedFrames = 0;
    let maxStroke = 0;
    let maxSubRatio = 0;
    let maxClaw = 0;
    let maxSpin = 0;
    let maxTargetLift = 0;
    let maxTargetSpeed = 0;
    let closestCentres = Infinity;
    let closestWeapon = Infinity;
    const scratch = new THREE.Vector3();

    sim.setInput(0, { weapon: true, weaponSecondary: true });
    sim.setInput(1, {});
    const frames = 150;
    for (let frame = 0; frame < frames; frame += 1) {
      // Impulse arms (hammer, flipper) fire on a press edge and are committed
      // until they return, so the button is pulsed rather than held.
      // A committed arm (hammer, flipper) has to be RELEASED to fire again, so
      // its button is pulsed; everything else is held, which is how it is
      // played.
      const config = weapon?.arm || weapon || {};
      const committed = !config.holdStroke
        && (weapon?.type === "hammer" || weapon?.type === "flipper" || weapon?.type === "meshFlipper");
      // A two-way arm spends its second channel driving the arm back DOWN, so
      // holding both buttons holds it still — which is the mechanism working,
      // and not what this is trying to measure.
      sim.setInput(0, {
        leftDrive: 1,
        rightDrive: 1,
        weapon: committed ? frame % 50 < 14 : true,
        weaponSecondary: config.twoWayArm ? false : true,
        // The third channel. On Dragon King it is the ARM — the trigger there
        // is the jaw — so it is held like any other arm's button; on Tantrum it
        // is the punch arms, which are pulsed because a punch is a stroke.
        weaponAux: weapon?.type === "sawArms" ? true : frame % 40 < 12,
        // NOT the fourth: rearing the body up takes the tracks off the floor,
        // which is the mechanism working and the opposite of driving into
        // something. It is measured on its own, in mechanism-probe.mjs.
        weaponLift: false,
      });
      sim.stepFrame();
      if (weapon) {
        maxStroke = Math.max(maxStroke, weapon.stroke || 0);
        maxSubRatio = Math.max(maxSubRatio, weapon.subRatio || 0);
        maxClaw = Math.max(maxClaw, weapon.clawAmount || 0);
        maxSpin = Math.max(maxSpin, Math.abs(weapon.currentSpeed || 0));
        if (isNewArmWeapon(weapon) && isArmWeaponEngaged(weapon, { strokeActive: true })) engagedFrames += 1;
      }
      const p = target.rb.translation();
      const v = target.rb.linvel();
      maxTargetLift = Math.max(maxTargetLift, p.y - startTarget.y);
      maxTargetSpeed = Math.max(maxTargetSpeed, Math.hypot(v.x, v.z));
      const a = fighter.rb.translation();
      closestCentres = Math.min(closestCentres, Math.hypot(p.x - a.x, p.z - a.z));
      if (weapon?.object) {
        weapon.object.getWorldPosition(scratch);
        closestWeapon = Math.min(closestWeapon, Math.hypot(p.x - scratch.x, p.z - scratch.z));
      }
    }
    const endTarget = target.rb.translation();
    return {
      id,
      type: config.type || null,
      spinnerFullSpeed: Math.abs(config.visualSpeed || 0),
      maxSpin,
      maxStroke,
      maxSubRatio,
      maxClaw,
      hasSub: Boolean(config.sub),
      hasClaw: Boolean(config.claw),
      engagedFrames,
      targetPushed: Math.hypot(endTarget.x - startTarget.x, endTarget.z - startTarget.z),
      maxTargetLift,
      maxTargetSpeed,
      closestCentres,
      closestWeapon,
      reach: MODEL_PART_CONFIG[id]?.weapon?.reach ?? null,
      hits: damage.length,
      damageTotal: damage.reduce((sum, event) => sum + event.amount, 0),
      damageKinds: [...new Set(damage.map((event) => event.kind))],
    };
  } finally {
    sim.dispose();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const ids = args.length ? args : [...PORTED_BOT_IDS];
  console.log([
    "bot".padEnd(13), "weapon".padEnd(12), "spin".padEnd(12), "stroke".padEnd(8),
    "sub".padEnd(8), "jaw".padEnd(6), "engaged".padEnd(8), "pushed".padEnd(8), "lift".padEnd(7), "hits".padEnd(6), "damage".padEnd(8), "kinds",
  ].join(" "));
  for (const id of ids) {
    const r = await weaponMechanism(id);
    console.log([
      id.padEnd(13),
      String(r.type).padEnd(12),
      (r.spinnerFullSpeed ? `${r.maxSpin.toFixed(0)}/${r.spinnerFullSpeed.toFixed(0)}` : "-").padEnd(12),
      r.maxStroke.toFixed(2).padEnd(8),
      (r.hasSub ? r.maxSubRatio.toFixed(2) : "-").padEnd(8),
      (r.hasClaw ? r.maxClaw.toFixed(2) : "-").padEnd(6),
      String(r.engagedFrames).padEnd(8),
      r.targetPushed.toFixed(2).padEnd(8),
      r.maxTargetLift.toFixed(2).padEnd(7),
      String(r.hits).padEnd(6),
      r.damageTotal.toFixed(1).padEnd(8),
      r.damageKinds.join(",") || "-",
      `gap ${r.closestCentres.toFixed(2)}${Number.isFinite(r.closestWeapon) ? `/w ${r.closestWeapon.toFixed(2)}` : ""}`,
    ].join(" "));
  }
}
