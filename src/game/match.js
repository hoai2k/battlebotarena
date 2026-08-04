// BattleBot Arena v2 — match state machine + damage bookkeeping.
//
// createMatch({ sim, specs, emit, on }) drives:
//   countdown (3-2-1-FIGHT) -> fight (180s, kill saws at <=60s left)
//   -> ko | timeUp -> results
//
// Damage model (all totals are PERCENT, 0..100; KO at >=100):
// - EV.WEAPON_HIT  -> amount = clamp(impulse * 0.028, 0.8, 15) * (heavy ? 1.25 : 1)
// - EV.IMPACT      -> amount = clamp((approachSpeed - 8) * 0.35, 0, 6) x a
//                     surface factor (bot 1, wall 0.55, floor/ceiling 0.3) x a
//                     face factor (front 0.6, x0.6 again if the bot has a
//                     wedge; side 1.0; rear 1.4), skipped under 0.4;
//                     floor/ceiling only count above approach 18 (slams);
//                     per-bot cooldown 0.35s. A bot-on-bot impact is charged to
//                     BOTH machines, each on the face it was hit.
// - EV.HAZARD_CONTACT -> continuous: killSaw 7%/s, screw 5%/s, x intensity
//                     (applied in update() while contact events stay fresh)
// - EV.HAZARD_LAUNCH  -> amount = clamp(impulse * 0.02, 2, 10)
// Every scaled hit re-emits as EV.DAMAGE { botIndex, amount, zone, kind, point }.
//
// Zones from the contact point in the target's local frame (yaw only):
// front third -> 'weapon', outer sides or low hits -> 'drive' (side tracked
// internally), otherwise 'body'. Zone thresholds emit EV.PART_BREAK once:
// weapon at 25%, each drive side at 16% — but ONLY once the bot is 75% gone
// overall. Systems failing is the endgame, not something that happens to you
// in the first exchange; the zone still decides WHICH system goes. The sim has
// no disable flag, so breakage is enforced through filterInputs(): broken
// weapon -> weapon input forced false (spin decays naturally in the sim);
// broken drive side -> that side's drive input x 0.4.
//
// KO: total >=100, or immobilized (speed < 0.35 ft/s) for 10s while the
// opponent has moved within the last 2s.

import { EV } from "../shared/events.js";

const MATCH_SECONDS = 180;
const KILL_SAW_SECONDS_LEFT = 60;
const COUNTDOWN_SECONDS = 3;
const RESULTS_DELAY_SECONDS = 3;

const WEAPON_HIT_DAMAGE_PER_IMPULSE = 0.028;
const WEAPON_HIT_MIN = 0.8;
const WEAPON_HIT_MAX = 15;
const HEAVY_HIT_MULTIPLIER = 1.25;

const IMPACT_SPEED_THRESHOLD = 8; // ft/s
const IMPACT_DAMAGE_PER_FPS = 0.35;
const IMPACT_MAX = 6;
const IMPACT_MIN = 0.4;
const IMPACT_COOLDOWN_SECONDS = 0.35;
const FLOOR_SLAM_SPEED = 18; // floor/ceiling hits below this are ignored

// What was hit. Ramming another robot is a thing you DO; being thrown into the
// floor by a spinner is a thing that happens to you AFTER that spinner has
// already been paid for its hit, and charging both at the same rate makes the
// weapon's own damage the smaller half of its effect. Measured over a full
// AI-vs-AI fight, floor and ceiling slams alone were four times the weapon
// damage in the match.
const IMPACT_SURFACE = { bot: 1, wall: 0.55, floor: 0.3, ceiling: 0.3 };

// Which FACE took the hit. Getting rammed in the back is not the same event as
// catching one on the plate you built to catch it with, and a game where both
// cost the same gives a driver no reason to keep their front toward the danger.
// Applied to every impact, not only bot-on-bot: reversing into a wall should
// cost more than nosing into one.
const IMPACT_FACE = { front: 0.6, side: 1.0, rear: 1.4 };
// A bot whose collider stack includes a wedge has a real armoured face there —
// it is the shape the whole machine is built around — so its front is worth
// more than the generic front factor.
const WEDGE_FRONT_SCALE = 0.6;

const HAZARD_RATE = { killSaw: 7, screw: 5 }; // %/s at intensity 1
const HAZARD_FRESH_WINDOW = 0.2; // seconds a HAZARD_CONTACT keeps ticking
const HAZARD_LAUNCH_SCALE = 0.02;

const WEAPON_BREAK_THRESHOLD = 25;
const DRIVE_SIDE_BREAK_THRESHOLD = 16;
// Nothing breaks until the bot is three-quarters destroyed. Zone damage alone
// used to do it, so a couple of clean hits to one side could cripple a bot
// that was otherwise barely marked.
const PART_BREAK_MIN_TOTAL = 75;
const BROKEN_DRIVE_SCALE = 0.4;

const KO_TOTAL = 100;
const IMMOBILE_SPEED = 0.35; // ft/s
const IMMOBILE_YAW_SPEED = 0.3; // rad/s — spinning in place is movement
const IMMOBILE_MIN_DAMAGE = 5; // percent — pristine parked bots aren't "knocked out"
const FOE_MOVING_SPEED = 0.6;
const IMMOBILE_KO_SECONDS = 10;
const FOE_MOVED_RECENT_SECONDS = 2;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function yawFromQuaternion(q) {
  const { x, y, z, w } = q || { x: 0, y: 0, z: 0, w: 1 };
  const fx = -(2 * (x * z + w * y));
  const fz = -(1 - 2 * (x * x + y * y));
  return Math.atan2(-fx, -fz);
}

function newBotDamage() {
  return {
    total: 0,
    zones: { body: 0, weapon: 0, drive: 0 },
    sides: { left: 0, right: 0 },
    weaponBroken: false,
    leftDriveBroken: false,
    rightDriveBroken: false,
  };
}

const ZERO_INPUT = Object.freeze({ leftDrive: 0, rightDrive: 0, weapon: false, brake: false });

/**
 * @param {object} args
 * @param {object} args.sim   sim public API (setKillSawsActive, getRenderState)
 * @param {import('../assets/catalog.js').BotSpec[]} args.specs [botA, botB]
 * @param {Function} args.emit event bus emit
 * @param {Function} args.on   event bus on
 */
export function createMatch({ sim, specs, emit, on }) {
  const damage = [newBotDamage(), newBotDamage()];
  const unsubscribes = [];

  let phase = "idle"; // idle | countdown | fight | ko | timeUp | results
  let clock = 0; // seconds within current phase
  let fightClock = 0; // seconds of fighting elapsed
  let countdownShown = -1;
  let killSawsOn = false;
  let winnerIndex = null;
  let endCause = null;

  // Per-bot bookkeeping refreshed each update from sim.getRenderState().
  const poses = [null, null];
  const lastImpactAt = [-1, -1];
  const hazard = [
    { kind: null, intensity: 0, at: -1, point: null },
    { kind: null, intensity: 0, at: -1, point: null },
  ];
  const lastMovedAt = [0, 0];
  const lastPositions = [null, null];

  function emitMatch(payload) {
    emit(EV.MATCH, payload);
  }

  function zoneForContact(botIndex, point) {
    const pose = poses[botIndex];
    const spec = specs[botIndex];
    if (!pose || !point || !spec) return { zone: "body", side: null };
    const dx = point.x - pose.position.x;
    const dz = point.z - pose.position.z;
    const relY = point.y - pose.position.y;
    const yaw = yawFromQuaternion(pose.quaternion);
    // Inverse yaw rotation into the bot's local frame (forward -Z, right +X).
    const cos = Math.cos(-yaw);
    const sin = Math.sin(-yaw);
    const localX = dx * cos + dz * sin;
    const localZ = -dx * sin + dz * cos;
    const dims = spec.bodyDims;
    if (-localZ > dims.z * 0.22) return { zone: "weapon", side: null }; // front third
    if (Math.abs(localX) > dims.x * 0.3 || relY < 0.35) {
      return { zone: "drive", side: localX >= 0 ? "right" : "left" };
    }
    return { zone: "body", side: null };
  }

  /**
   * front / side / rear, in the victim's own frame. Shares its geometry with
   * zoneForContact above; kept separate because they answer different
   * questions — that one is "which subsystem", this one is "how exposed".
   */
  function faceForContact(botIndex, point) {
    const pose = poses[botIndex];
    const spec = specs[botIndex];
    if (!pose || !point || !spec) return 1;
    const dx = point.x - pose.position.x;
    const dz = point.z - pose.position.z;
    const yaw = yawFromQuaternion(pose.quaternion);
    const localZ = -dx * Math.sin(-yaw) + dz * Math.cos(-yaw);
    const third = spec.bodyDims.z * 0.22;
    if (localZ < -third) {
      const wedged = (spec.colliders || []).some((c) => c.shape === "wedge");
      return IMPACT_FACE.front * (wedged ? WEDGE_FRONT_SCALE : 1);
    }
    if (localZ > third) return IMPACT_FACE.rear;
    return IMPACT_FACE.side;
  }

  function applyDamage(botIndex, amount, kind, point) {
    if (phase !== "fight" || !(amount > 0)) return;
    const bot = damage[botIndex];
    if (!bot || bot.total >= KO_TOTAL) return;
    const { zone, side } = zoneForContact(botIndex, point);
    bot.total = clamp(bot.total + amount, 0, KO_TOTAL);
    bot.zones[zone] += amount;
    if (zone === "drive" && side) bot.sides[side] += amount;
    emit(EV.DAMAGE, { botIndex, amount, zone, kind, point: point || null });
    checkPartBreaks(botIndex, point);
    if (bot.total >= KO_TOTAL) endFight("ko", 1 - botIndex, "damage");
  }

  function checkPartBreaks(botIndex, point) {
    const bot = damage[botIndex];
    if (bot.total < PART_BREAK_MIN_TOTAL) return;
    if (!bot.weaponBroken && bot.zones.weapon >= WEAPON_BREAK_THRESHOLD) {
      bot.weaponBroken = true;
      emit(EV.PART_BREAK, { botIndex, zone: "weapon", point: point || null });
    }
    if (!bot.leftDriveBroken && bot.sides.left >= DRIVE_SIDE_BREAK_THRESHOLD) {
      bot.leftDriveBroken = true;
      emit(EV.PART_BREAK, { botIndex, zone: "drive", side: "left", point: point || null });
    }
    if (!bot.rightDriveBroken && bot.sides.right >= DRIVE_SIDE_BREAK_THRESHOLD) {
      bot.rightDriveBroken = true;
      emit(EV.PART_BREAK, { botIndex, zone: "drive", side: "right", point: point || null });
    }
  }

  // --- bus subscriptions ----------------------------------------------------

  unsubscribes.push(on(EV.WEAPON_HIT, ({ targetIndex, point, impulse, heavy }) => {
    if (targetIndex === null || targetIndex === undefined) return;
    const base = clamp((impulse || 0) * WEAPON_HIT_DAMAGE_PER_IMPULSE, WEAPON_HIT_MIN, WEAPON_HIT_MAX);
    applyDamage(targetIndex, base * (heavy ? HEAVY_HIT_MULTIPLIER : 1), "weapon", point);
  }));

  unsubscribes.push(on(EV.IMPACT, ({ botIndex, otherIndex, surface, point, relSpeed, normalSpeed, approachSpeed }) => {
    if (botIndex === null || botIndex === undefined) return;
    // What the pair were CLOSING at, measured before the solver spent it — see
    // sim/contacts.js. Not speed across the surface: driving fast along the
    // floor is not a slam, falling onto it is, and the two are the same number
    // until you take the component along the contact normal. Claw Viper found
    // that half: 250lbf of magnets keep its pan on the floor and its 17fps top
    // speed runs right at the 14fps slam threshold, so anything that nudged it
    // over billed it for driving. Ramming found the other half — read after the
    // step, a 27fps head-on measured as 1.2fps and cost nobody anything.
    const speed = approachSpeed ?? normalSpeed ?? relSpeed ?? 0;
    if ((surface === "floor" || surface === "ceiling") && speed < FLOOR_SLAM_SPEED) return;
    const base = clamp((speed - IMPACT_SPEED_THRESHOLD) * IMPACT_DAMAGE_PER_FPS, 0, IMPACT_MAX)
      * (IMPACT_SURFACE[surface] ?? IMPACT_SURFACE.wall);
    if (base <= 0) return;
    // BOTH machines were in the collision. The router reports a bot-on-bot
    // impact once, under the LOWER of the two indices, and charging only that
    // one meant every ram in the game was paid for by player one — including
    // the rams they initiated, and never by player two.
    for (const i of otherIndex === null || otherIndex === undefined ? [botIndex] : [botIndex, otherIndex]) {
      if (fightClock - lastImpactAt[i] < IMPACT_COOLDOWN_SECONDS) continue;
      // Same collision, different price: the two machines were hit on different
      // faces of themselves, and that is most of what a ram is about.
      const amount = base * faceForContact(i, point);
      if (amount < IMPACT_MIN) continue;
      lastImpactAt[i] = fightClock;
      applyDamage(i, amount, "impact", point);
    }
  }));

  unsubscribes.push(on(EV.HAZARD_CONTACT, ({ botIndex, kind, point, intensity }) => {
    const slot = hazard[botIndex];
    if (!slot) return;
    slot.kind = kind;
    slot.intensity = clamp(intensity ?? 1, 0, 1.5);
    slot.at = fightClock;
    slot.point = point || null;
  }));

  unsubscribes.push(on(EV.HAZARD_LAUNCH, ({ botIndex, kind, point, impulse }) => {
    const amount = clamp((impulse || 0) * HAZARD_LAUNCH_SCALE, 2, 10);
    applyDamage(botIndex, amount, kind === "screw" ? "screw" : "killSaw", point);
  }));

  // --- phase control --------------------------------------------------------

  function start() {
    if (phase !== "idle" && phase !== "results") return;
    phase = "countdown";
    clock = 0;
    countdownShown = -1;
    emitCountdown();
  }

  function emitCountdown() {
    const count = COUNTDOWN_SECONDS - Math.floor(clock);
    if (count !== countdownShown && count >= 1) {
      countdownShown = count;
      emitMatch({ phase: "countdown", count });
    }
  }

  function beginFight() {
    phase = "fight";
    clock = 0;
    fightClock = 0;
    killSawsOn = false;
    lastMovedAt[0] = 0;
    lastMovedAt[1] = 0;
    emitMatch({ phase: "fight", timeRemaining: MATCH_SECONDS });
  }

  function endFight(endPhase, winner, cause) {
    if (phase !== "fight") return;
    phase = endPhase;
    clock = 0;
    winnerIndex = winner;
    endCause = cause;
    killSawsOn = false;
    sim?.setKillSawsActive?.(false);
    const payload = {
      phase: endPhase,
      winnerIndex: winner,
      loserIndex: winner === null ? null : 1 - winner,
      cause,
      totals: damage.map((d) => d.total),
    };
    emitMatch(payload);
  }

  function showResults() {
    phase = "results";
    clock = 0;
    emitMatch({
      phase: "results",
      winnerIndex,
      cause: endCause,
      timeElapsed: fightClock,
      totals: damage.map((d) => d.total),
      zones: damage.map((d) => ({ ...d.zones })),
    });
  }

  function updateMotionTracking(dt) {
    const renderState = sim?.getRenderState?.();
    if (!renderState) return;
    for (let i = 0; i < 2; i += 1) {
      const state = renderState[i];
      if (!state?.position) continue;
      poses[i] = state;
      const previous = lastPositions[i];
      if (previous && dt > 0) {
        const speed = Math.hypot(
          state.position.x - previous.x,
          state.position.z - previous.z,
        ) / dt;
        // Rotation counts as controlled movement too — a bot spinning in
        // place is very much alive, and translation-only tracking was KO'ing
        // players doing donuts or holding an angle in local 2P.
        let yawSpeed = 0;
        if (previous.qy !== undefined && state.quaternion) {
          const dot = Math.min(1, Math.abs(previous.qy * state.quaternion.y + previous.qw * state.quaternion.w));
          yawSpeed = (2 * Math.acos(dot)) / dt;
        }
        if (speed > IMMOBILE_SPEED || yawSpeed > IMMOBILE_YAW_SPEED) lastMovedAt[i] = fightClock;
      } else {
        lastMovedAt[i] = fightClock;
      }
      lastPositions[i] = {
        x: state.position.x,
        z: state.position.z,
        qy: state.quaternion?.y,
        qw: state.quaternion?.w,
      };
    }
  }

  function checkImmobilizedKo() {
    for (let i = 0; i < 2; i += 1) {
      const foe = 1 - i;
      const stuckFor = fightClock - lastMovedAt[i];
      const foeMovedRecently = fightClock - lastMovedAt[foe] < FOE_MOVED_RECENT_SECONDS;
      // Only bots that have actually been damaged can be counted out — a
      // healthy bot idling (common in casual local 2P) is not a knockout.
      const damagedEnough = damage[i].total >= IMMOBILE_MIN_DAMAGE;
      if (stuckFor >= IMMOBILE_KO_SECONDS && foeMovedRecently && damagedEnough) {
        endFight("ko", foe, "immobilized");
        return;
      }
    }
  }

  function applyHazardTicks(dt) {
    for (let i = 0; i < 2; i += 1) {
      const slot = hazard[i];
      if (!slot.kind || fightClock - slot.at > HAZARD_FRESH_WINDOW) continue;
      const rate = HAZARD_RATE[slot.kind] || HAZARD_RATE.killSaw;
      applyDamage(i, rate * slot.intensity * dt, slot.kind, slot.point);
    }
  }

  function update(dt) {
    const step = Math.max(0, dt || 0);
    clock += step;
    if (phase === "countdown") {
      emitCountdown();
      if (clock >= COUNTDOWN_SECONDS) beginFight();
      return;
    }
    if (phase === "fight") {
      fightClock += step;
      updateMotionTracking(step);
      applyHazardTicks(step);
      const timeRemaining = Math.max(0, MATCH_SECONDS - fightClock);
      if (!killSawsOn && timeRemaining <= KILL_SAW_SECONDS_LEFT) {
        killSawsOn = true;
        sim?.setKillSawsActive?.(true);
        emitMatch({ phase: "fight", callout: "killSaws", timeRemaining });
      }
      if (phase === "fight") checkImmobilizedKo();
      if (phase === "fight" && timeRemaining <= 0) {
        const [a, b] = damage.map((d) => d.total);
        endFight("timeUp", a === b ? null : (a < b ? 0 : 1), "judges");
      }
      return;
    }
    if ((phase === "ko" || phase === "timeUp") && clock >= RESULTS_DELAY_SECONDS) {
      showResults();
    }
  }

  // Part-disable + phase gating. The integrator passes raw [DriveInput,
  // DriveInput] through here every frame before sim.stepFrame.
  function filterInputs(inputs) {
    if (phase !== "fight") return [ZERO_INPUT, ZERO_INPUT];
    return inputs.map((input, index) => {
      const raw = input || ZERO_INPUT;
      const bot = damage[index];
      return {
        // Preserve extra channels (sawActive etc.) — audio and visuals read
        // them downstream of this filter; rebuilding from scratch ate them.
        ...raw,
        leftDrive: clamp(raw.leftDrive || 0, -1, 1) * (bot.leftDriveBroken ? BROKEN_DRIVE_SCALE : 1),
        rightDrive: clamp(raw.rightDrive || 0, -1, 1) * (bot.rightDriveBroken ? BROKEN_DRIVE_SCALE : 1),
        weapon: bot.weaponBroken ? false : Boolean(raw.weapon),
        brake: Boolean(raw.brake),
      };
    });
  }

  function getState() {
    return {
      phase,
      timeRemaining: phase === "fight" ? Math.max(0, MATCH_SECONDS - fightClock) : null,
      countdown: phase === "countdown" ? Math.max(1, COUNTDOWN_SECONDS - Math.floor(clock)) : null,
      killSawsOn,
      winnerIndex,
      cause: endCause,
      bots: damage.map((d) => ({
        total: d.total,
        percent: Math.round(d.total),
        zones: { ...d.zones },
        weaponBroken: d.weaponBroken,
        driveBroken: { left: d.leftDriveBroken, right: d.rightDriveBroken },
      })),
    };
  }

  function dispose() {
    unsubscribes.forEach((unsubscribe) => unsubscribe?.());
    unsubscribes.length = 0;
  }

  return { start, update, filterInputs, getState, dispose };
}
