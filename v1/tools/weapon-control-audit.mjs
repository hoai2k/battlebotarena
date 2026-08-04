// Which button does what, per bot, checked against v2 rather than against
// itself.
//
//   node v1/tools/weapon-control-audit.mjs [ids...]
//
// A weapon can be measured moving, landing hits and doing damage — every check
// in weapon-mechanism-probe.mjs green — and still be unplayable, because none
// of those measurements presses a button the way a player does. Holding a saw
// motor down is not the same as latching it; a jaw you have to keep hold of
// while both hands drive cannot live on a button you have to keep pressed; and
// an arm that shares its channel with the jaw that has to be shut before it can
// cut anything is a bot with three mechanisms on two buttons.
//
// v2 already decided all of this, in src/game/weaponControls.js, and that
// module is pure JS. So this imports BOTH definitions and compares them:
//
//   labels    what each channel is called and whether it LATCHES, v1's
//             describeWeaponControls against v2's
//   channels  a scripted press/release trace pushed through v1's
//             resolveWeaponControls and v2's input shaper, compared frame by
//             frame on the three channels they express the same way
//
// The primary is compared on its LATCHING rule only, not frame by frame: v2
// latches spinners and Dragon King's jaw inside the shaper, and v1 latches the
// same two things one layer down (a spinner in updateWeapon's toggle, the jaw
// in updateWeaponMechanisms) because in v1 those latches predate the channel
// layer. Same behaviour, different seam.
import { CATALOG } from "../../src/assets/catalog.js";
import {
  describeWeaponControls as describeV2,
  createWeaponInputShaper,
} from "../../src/game/weaponControls.js";
import { MODEL_PART_CONFIG } from "../src/modelPartConfig.js";
import { PORTED_BOT_IDS } from "../src/portedBots.js";
import {
  describeWeaponControls as describeV1,
  resolveWeaponControls,
  secondaryLatches,
  usesAuxChannel,
  usesLiftChannel,
} from "../src/armWeapons.js";

/** The shape armWeapons.js reads, built from the ported data alone. */
function v1WeaponState(id) {
  const config = MODEL_PART_CONFIG[id];
  const weapon = config?.weapon;
  if (!weapon) return null;
  return {
    type: weapon.type,
    arm: weapon,
    aux: config.aux || null,
    claw: weapon.claw || null,
    subs: weapon.sub ? [{ ratio: 0 }] : [],
    toggle: weapon.type === "bar" || weapon.type === "drum",
  };
}

// Press, hold, release, press again, hold, release. Everything a latch and a
// hold disagree about happens somewhere in here: a latch is still on at frame
// 6 and off again at frame 12, a hold is off at both.
const TRACE = [
  { down: false, frames: 2 },
  { down: true, frames: 3 },
  { down: false, frames: 4 },
  { down: true, frames: 3 },
  { down: false, frames: 4 },
];

function traceFrames() {
  const frames = [];
  for (const step of TRACE) for (let i = 0; i < step.frames; i += 1) frames.push(step.down);
  return frames;
}

export function auditControls(id) {
  const weapon = v1WeaponState(id);
  const spec = CATALOG[id];
  if (!weapon || !spec) return { id, skipped: true, issues: [] };
  const issues = [];

  const v1 = describeV1(weapon);
  const v2 = describeV2(spec);
  const channelNames = ["primary", "secondary", "aux", "lift"];
  for (const channel of channelNames) {
    const mine = v1[channel];
    const theirs = v2[channel];
    if (Boolean(mine) !== Boolean(theirs)) {
      issues.push(`${channel}: v1 ${mine ? `"${mine.label}"` : "none"} vs v2 ${theirs ? `"${theirs.label}"` : "none"}`);
      continue;
    }
    if (!mine) continue;
    if (mine.toggle !== theirs.toggle) {
      issues.push(`${channel}: v1 ${mine.toggle ? "latches" : "momentary"} vs v2 ${theirs.toggle ? "latches" : "momentary"}`);
    }
  }

  // The channel that carries a bot's second mechanism, pressed the way a player
  // presses it. This is the check that catches "RB turns the saws on, but only
  // while pressed instead of toggling".
  const shaper = createWeaponInputShaper();
  const frames = traceFrames();
  const mineTrace = [];
  const theirsTrace = [];
  for (const down of frames) {
    // v1's third and fourth channels ARE the brake and boost buttons — LB and
    // LT — so the trace presses those, and the check is that a bot with a
    // mechanism on one of them stops braking with it and a bot without one
    // keeps braking. v2 spells the same two buttons weaponAux/weaponLift and
    // folds them back into `brake` itself.
    const resolved = resolveWeaponControls(weapon, {
      weapon: false,
      weaponSecondary: down,
      brakeActive: down,
      boostActive: down,
    });
    const shaped = shaper.shape(
      { weapon: false, weaponAlt: down, weaponAux: down, weaponLift: down, brake: false },
      spec,
      0,
    );
    mineTrace.push([resolved.secondary, resolved.aux, resolved.lift, resolved.brakeActive || resolved.boostActive]);
    theirsTrace.push([Boolean(shaped.sawActive), Boolean(shaped.auxActive), Boolean(shaped.liftActive), Boolean(shaped.brake)]);
  }
  const labels = ["secondary", "aux", "lift", "brake"];
  for (let channel = 0; channel < labels.length; channel += 1) {
    // v2 reports auxActive on every bot and folds it into the brake for the
    // ones with nothing on that button; v1 reports it only where it is spent,
    // which is the same decision expressed once instead of twice. Compare the
    // channel only where the bot actually has something on it.
    if (labels[channel] === "aux" && !usesAuxChannel(weapon)) continue;
    if (labels[channel] === "lift" && !usesLiftChannel(weapon)) continue;
    const mine = mineTrace.map((row) => Number(row[channel])).join("");
    const theirs = theirsTrace.map((row) => Number(row[channel])).join("");
    if (mine !== theirs) issues.push(`${labels[channel]} trace: v1 ${mine} vs v2 ${theirs}`);
  }

  return {
    id,
    skipped: false,
    type: weapon.type,
    latchesSecondary: secondaryLatches(weapon),
    aux: usesAuxChannel(weapon),
    lift: usesLiftChannel(weapon),
    labels: channelNames.map((name) => (v1[name] ? `${name.slice(0, 3).toUpperCase()}=${v1[name].label}${v1[name].toggle ? "*" : ""}` : null)).filter(Boolean).join(" "),
    issues,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const ids = args.length ? args : [...PORTED_BOT_IDS];
  let failed = 0;
  console.log(`${"bot".padEnd(13)} ${"weapon".padEnd(12)} ${"RB".padEnd(9)} ${"LB".padEnd(4)} ${"LT".padEnd(4)} channels (* = latches)`);
  for (const id of ids) {
    const report = auditControls(id);
    if (report.skipped) continue;
    console.log([
      id.padEnd(13),
      String(report.type).padEnd(12),
      (report.latchesSecondary ? "toggle" : "hold").padEnd(9),
      (report.aux ? "yes" : "-").padEnd(4),
      (report.lift ? "yes" : "-").padEnd(4),
      report.labels,
    ].join(" "));
    for (const issue of report.issues) {
      failed += 1;
      console.log(`  ! ${issue}`);
    }
  }
  console.log("");
  console.log(failed ? `${failed} disagreement(s) with v2` : "every channel matches v2");
  process.exitCode = failed ? 1 : 0;
}
