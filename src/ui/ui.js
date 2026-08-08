// createUI({ bus, onAction }) — builds and wires the whole game UI.
// Emits user intent through onAction(action) and reacts to bus events
// (EV.MATCH / EV.DAMAGE / EV.PART_BREAK) to drive the HUD. Never imports
// three.js, rapier, or sim/game modules — DOM + shared contracts only.
//
// Action payloads emitted via onAction:
//   { type: "startMatch", botIds, humanCount, playerBotId, rivalBotId, difficulty }
//       botIds holds 2-4 concrete ids in bot order (Random is resolved here);
//       playerBotId/rivalBotId are the 1v1 shorthand for the same first two.
//   { type: "rematch" }
//   { type: "changeBots" }
//   { type: "toTitle" }

import { EV } from "../shared/events.js";
import { settings, setSetting, onSettingChanged } from "../shared/settings.js";
import { createScreens } from "./screens.js";
import { createGamepadNav } from "./gamepadNav.js";
import { BOT_CARDS, RANDOM_CARD, getBotCard, pickRandomBotId } from "./botCards.js";
import { CONFIG } from "../config.js";
import { t, applyStaticText } from "./text.js";

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Ticker copy, read through CONFIG.text like everything else the player sees.
const ZONE_LABELS = { body: "hud.zoneBody", weapon: "hud.zoneWeapon", drive: "hud.zoneDrive" };
const BREAK_LABELS = {
  weapon: "hud.breakWeapon", drive: "hud.breakDrive", body: "hud.breakBody", out: "hud.breakOut",
};
/** Shared with game/match.js via config.js — a HUD clock that disagrees with
 *  the sim clock is a HUD that lies. */
const MATCH_SECONDS = CONFIG.match.matchSeconds;

/**
 * @param {{ bus?: { on(type:string, fn:Function): Function }, on?: Function, onAction?: (action: object) => void }} opts
 */
export function createUI({ bus, on, onAction = () => {} } = {}) {
  const subscribe = bus && typeof bus.on === "function" ? bus.on.bind(bus) : on || (() => () => {});
  // Every string authored into index.html carrying a data-text-key is replaced
  // from CONFIG.text here, before anything is shown. The markup keeps the
  // default copy so a mistyped key degrades to the old wording, not to blank.
  applyStaticText();
  const screens = createScreens({ initial: "title" });
  /** @type {Function[]} */
  const cleanups = [];

  // ---------------------------------------------------------------- selection
  // Two shapes of the same screen:
  //   solo (0-1 pads) — one cursor walks a two-step flow, YOU then RIVAL.
  //   duo  (2-4 pads) — every player picks simultaneously, each owning one
  //                     slot; slot i is player i and bot i, matching main.js's
  //                     pad->bot assignment.
  //
  // THREE AND FOUR PLAYERS are the duo shape with more slots. There is no AI
  // for the extra machines and no way to ask for one: a third bay exists
  // because a third controller is plugged in, and it goes away when it is not.
  const MAX_SLOTS = 4;
  const sel = {
    stage: /** @type {"player"|"rival"} */ ("player"),
    /** One entry per slot; slot 1 may be "random" (the AI's mystery). */
    picks: /** @type {(string|null)[]} */ (new Array(MAX_SLOTS).fill(null)),
  };
  /** Controllers connected right now. */
  let playerCount = 0;
  /** True while two or more controllers are connected — every bay is a person. */
  let duoMode = false;
  /** How many bays the screen is showing. Always at least the classic pair:
   *  with nobody (or one person) holding a pad, bay 1 is the AI's. */
  let slotCount = 2;
  /** Per slot, the bot the cursor is currently over — shown in that bay until
   *  something is claimed there. Not part of `sel`: it is where the cursor is,
   *  not what anyone has chosen, and it never reaches startMatch. */
  const browsing = /** @type {(string|null)[]} */ (new Array(MAX_SLOTS).fill(null));
  /** Set by a pick, consumed by the next refreshSelect, so the 3D flourish
   *  fires once on a real claim and never on a re-render. */
  let claimSlot = /** @type {number|null} */ (null);
  /** The gamepad navigator, built near the bottom of this function. Declared
   *  here because a pick handler moves the cursor, and a `const` down there
   *  would be in the temporal dead zone for anything that runs on the way. */
  let nav = /** @type {ReturnType<typeof createGamepadNav>|null} */ (null);

  const getSlot = (slot) => sel.picks[slot];
  const setSlot = (slot, id) => {
    sel.picks[slot] = id;
  };
  /** Every slot on screen. */
  const slots = () => Array.from({ length: slotCount }, (_, i) => i);
  /** Bots picked by everyone EXCEPT this slot — what Random has to avoid. */
  const takenBy = (slot) => slots().filter((i) => i !== slot).map(getSlot).filter(Boolean);
  /** Concrete ids of the match in flight, in bot order, plus how many of them
   *  a person is driving (the rest are AI). */
  let lastMatch = /** @type {{ botIds: string[], humans: number }|null} */ (null);
  const matchId = (i) => lastMatch?.botIds?.[i] || null;

  const grid = $("bot-grid");
  const stepEl = $("sel-step");
  const fightBtn = /** @type {HTMLButtonElement} */ ($("btn-fight"));

  // Showcase pods: the big 3D windows the chosen bots render into. The UI owns
  // their DOM chrome (plate, badge, stats, empty copy); the integrator owns the
  // 3D and the weapon buttons via the previewSelection actions emitted from
  // refreshSelect.
  const stageEl = document.querySelector(".select-stage");
  const selectScreen = document.querySelector(".screen-select");
  const POD_KEYS = ["player", "rival", "p3", "p4"];
  const pods = POD_KEYS.map((key) => {
    const root = $(`pod-${key}`);
    const plate = $(`slot-${key}`);
    return {
      key,
      root,
      plate,
      plateBody: plate?.querySelector(".pod-plate-body") || null,
      empty: root?.querySelector(".pod-empty") || null,
      badge: root?.querySelector(".pod-badge") || null,
      stats: root?.querySelector(".pod-stats") || null,
    };
  });
  /** Card classes and plate labels, by slot. */
  const SLOT_CARD_CLASS = ["is-player", "is-rival", "is-p3", "is-p4"];
  /** The pod<->FIGHT nav hints authored into index.html, captured before
   *  anything strips them so a three- or four-pod stage can put them back. */
  const NAV_PAIR_HINTS = [
    [$("slot-player"), "data-nav-right"],
    [$("slot-rival"), "data-nav-left"],
    [fightBtn, "data-nav-left"],
    [fightBtn, "data-nav-right"],
  ].map(([el, attr]) => ({ el, attr, value: el?.getAttribute(attr) || "" })).filter((hint) => hint.value);

  /** Shimmer an image's container until the bitmap lands. The roster photos
   *  are ~2MB each, so the slot would otherwise read as broken while it
   *  downloads. No-op for images already in cache. */
  function wireImage(wrapper) {
    const img = wrapper?.querySelector("img");
    if (!img) return;
    if (img.complete && img.naturalWidth > 0) return;
    wrapper.classList.add("is-img-loading");
    const done = () => wrapper.classList.remove("is-img-loading");
    img.addEventListener("load", done, { once: true });
    img.addEventListener("error", done, { once: true });
  }

  // `key` picks the colour (.stat-spd / .stat-pwr / .stat-arm in screens.css)
  // and `label` is the copy. They were the same string until the labels moved
  // into CONFIG.text — at which point renaming SPD would have silently dropped
  // the bar's colour, which is not something a copy edit should be able to do.
  function statRow(key, label, value) {
    let pips = "";
    for (let i = 1; i <= 5; i += 1) pips += `<i class="pip${i <= value ? " on" : ""}"></i>`;
    return `<span class="stat stat-${key}"><b class="stat-label">${label}</b><span class="pips">${pips}</span></span>`;
  }

  // Dock cards are deliberately terse — thumbnail, name, weapon badge. The
  // full sell (stats, tagline, the bot itself in 3D) lives in the pod once a
  // card is picked, so the dock only has to be scannable.
  function buildCard(card) {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "bot-card";
    el.dataset.botId = card.id;
    el.style.setProperty("--accent", card.accent);
    el.setAttribute("aria-label", `${card.name} — ${card.weaponType}`);
    el.innerHTML = `
      <span class="bot-card-img"><img src="${card.image}" alt="" loading="lazy" draggable="false" /></span>
      <span class="bot-card-name">${card.name}</span>
      <span class="bot-card-badge">${card.weaponType}</span>`;
    wireImage(el.querySelector(".bot-card-img"));
    return el;
  }

  function buildRandomCard() {
    const el = document.createElement("button");
    el.type = "button";
    el.className = "bot-card bot-card-random";
    el.dataset.botId = RANDOM_CARD.id;
    el.style.setProperty("--accent", RANDOM_CARD.accent);
    el.setAttribute("aria-label", "Random bot");
    el.innerHTML = `
      <span class="bot-card-img"><span class="random-glyph">?</span></span>
      <span class="bot-card-name">${RANDOM_CARD.name}</span>
      <span class="bot-card-badge">ANY OF THE ${BOT_CARDS.length}</span>`;
    return el;
  }

  /**
   * What Random means depends on WHOSE bay it lands in. For a bay someone is
   * going to drive it has to resolve now — you cannot practise on a mystery,
   * and the whole point of the pod is that you can. Only the AI's bay in solo
   * keeps the card itself, because there the surprise IS the feature and it
   * resolves at the box (see the startMatch action).
   * @returns {string} a concrete bot id, or "random" to keep the mystery
   */
  function resolveRandom(id, { mystery = false, exclude = null } = {}) {
    if (id !== "random") return id;
    return mystery ? "random" : pickRandomBotId(exclude);
  }

  /**
   * Duo pick/unpick for one player. A on a card claims it; A on the card you
   * already hold releases it. Somebody else holding it does NOT stop you —
   * a mirror match is a thing people want, and refusing the press was worse
   * than the duplicate it prevented: A did nothing, with no way to tell that
   * apart from the screen being broken.
   * @returns {boolean} true if the press was consumed
   */
  function duoToggle(slot, id) {
    if (!id || slot >= slotCount) return true;
    // Random still ROLLS AROUND what everyone else holds — that is a courtesy,
    // not a restriction. Asking for a surprise and getting the machine next to
    // you is a worse surprise; deliberately picking it is a choice.
    // pickRandomBotId falls back to the whole roster if every bot is spoken for.
    const pick = resolveRandom(id, { exclude: takenBy(slot) });
    const mine = getSlot(slot);
    if (mine === pick && id !== "random") setSlot(slot, null);
    else setSlot(slot, pick);
    refreshAfterPick({ slot, player: slot, claimed: Boolean(getSlot(slot)) });
    return true;
  }

  /** Solo flow: the single cursor fills YOU, then RIVAL. */
  function soloPick(id) {
    let slot = 1;
    if (sel.stage === "player") {
      // Your own bay: Random rolls now, because you are about to drive it.
      sel.picks[0] = resolveRandom(id, { exclude: sel.picks[1] });
      // Picking the machine the opponent already has used to EMPTY their bay,
      // which looked like the screen losing your opponent for no reason. A
      // mirror match is allowed; only Random still steers around it, above.
      sel.stage = "rival";
      slot = 0;
    } else {
      // The AI's bay: Random stays Random and is rolled at the box.
      sel.picks[1] = resolveRandom(id, { mystery: true });
    }
    refreshAfterPick({ slot, player: 0, claimed: true });
  }

  if (grid) {
    // The roster is a single horizontally scrolling dock strip now, so it
    // needs no column math — flexbox lays out however many bots exist.
    BOT_CARDS.forEach((card) => grid.appendChild(buildCard(card)));
    grid.appendChild(buildRandomCard());
    grid.addEventListener("click", (ev) => {
      const cardEl = /** @type {HTMLElement} */ (ev.target instanceof Element ? ev.target.closest(".bot-card") : null);
      if (!cardEl || cardEl.classList.contains("is-disabled")) return;
      const id = cardEl.dataset.botId;
      // Mouse and keyboard always act as player 1; pad presses are routed by
      // the nav layer's onActivate hook instead, which knows who pressed.
      if (duoMode) duoToggle(0, id);
      else soloPick(id);
    });
    // Mouse users browse by hovering; pad and keyboard users browse by moving
    // the cursor, which arrives through the nav layer's onFocusChange instead.
    grid.addEventListener("pointerover", (ev) => {
      const cardEl = /** @type {HTMLElement} */ (ev.target instanceof Element ? ev.target.closest(".bot-card") : null);
      if (cardEl) browseTo(cardEl.dataset.botId, 0);
    });
  }

  /** Dress one pod's DOM chrome for a pick (or back to its empty state). The
   *  3D window itself is filled by the integrator off the previewSelection
   *  action — this only handles plate, badge, stats and the empty copy. */
  function fillPod(slot, card, emptyCopy) {
    const pod = pods[slot];
    if (!pod.root) return;
    const isRandom = card?.id === "random";
    pod.root.classList.toggle("is-filled", Boolean(card));
    pod.root.classList.toggle("is-random", isRandom);
    if (card) {
      pod.root.style.setProperty("--accent", card.accent);
      if (pod.plateBody)
        pod.plateBody.innerHTML = `<b class="pod-name">${card.name}</b><span class="pod-tag">${card.tagline}</span>`;
      if (pod.badge) pod.badge.textContent = card.weaponType;
      if (pod.stats)
        pod.stats.innerHTML = isRandom
          ? `<span class="random-note">REVEALED AT THE BOX</span>`
          : `${statRow("spd", t("select.statSpeed"), card.stats.speed)}${statRow("pwr", t("select.statPower"), card.stats.power)}${statRow("arm", t("select.statArmor"), card.stats.armor)}`;
    } else {
      pod.root.style.removeProperty("--accent");
      if (pod.plateBody) pod.plateBody.innerHTML = `<span class="pod-plate-empty">${t("select.openBay")}</span>`;
      if (pod.empty) pod.empty.innerHTML = emptyCopy;
      if (pod.badge) pod.badge.textContent = "";
      if (pod.stats) pod.stats.innerHTML = "";
    }
  }

  /** Which bay a given player is currently filling. Solo that is whichever
   *  step the flow is on; in duo everyone owns their own. */
  function armedSlot(player = 0) {
    if (duoMode) return Math.min(Math.max(0, player), slotCount - 1);
    return sel.stage === "rival" ? 1 : 0;
  }

  /**
   * The bot each bay should be DRAWING. A claimed bay draws its bot; an unclaimed
   * one draws whatever the cursor is currently over, so the roster is a live
   * catalogue rather than a wall of thumbnails you commit to blind. The AI's bay
   * in solo is the exception: "random" is a claim, and its whole point is that
   * you do not get to look at it.
   */
  function stageIds() {
    return slots().map((slot) => {
      const picked = getSlot(slot);
      if (picked) return picked === "random" ? null : picked;
      return browsing[slot];
    });
  }

  /** Tell the integrator what to stage in the 3D pods and who owns the
   *  camera sticks. Solo, focus follows the pick flow: your bay until you
   *  have picked a real rival, then theirs. */
  function emitSelection(claimed = null) {
    onAction({
      type: "previewSelection",
      showIds: stageIds(),
      // Which bay just went from browsed to CLAIMED, for the flourish. Only a
      // real claim sets this — re-emitting on screen entry must not replay it.
      claimSlot: claimed,
      duo: duoMode,
      // WHICH BAY THE STICKS AND TRIGGERS DRIVE, solo. It follows the bay you
      // are FILLING, not the one you have filled: choosing the opponent used to
      // leave the controls pointing at your own machine, so the bot in the
      // window you were looking at could not be turned or fired — the whole
      // point of staging it there. Once both are chosen it goes back to your
      // own bay, because that is the one you are about to drive and the pod is
      // a practice viewer. In duo there is nothing to decide: each pad owns its
      // own pod (botPreview.readPads).
      focusSlot: duoMode ? null : (sel.picks[0] && sel.picks[1] ? 0 : armedSlot(0)),
    });
  }

  function refreshSelect() {
    if (!grid) return;
    grid.querySelectorAll(".bot-card").forEach((el) => {
      const id = el.dataset.botId;
      SLOT_CARD_CLASS.forEach((cls, slot) => {
        el.classList.toggle(cls, slot < slotCount && id === getSlot(slot));
      });
      // Who holds this card, spelled out. With four players the pairings are a
      // combinatorial mess and one class per pairing is not a thing worth
      // writing down — the CSS reads this attribute instead.
      const owners = slots().filter((slot) => getSlot(slot) === id);
      if (duoMode && owners.length) {
        el.dataset.owners = owners.map((slot) => `P${slot + 1}`).join(" + ");
        // More than one person on one machine is allowed, and the per-slot ring
        // colours cannot say so — a card wearing two of them just looks like
        // the higher-numbered one. The count switches it to a shared ring.
        el.dataset.ownerCount = String(owners.length);
      } else {
        delete el.dataset.owners;
        delete el.dataset.ownerCount;
      }
      // Random is always pickable. It used to be greyed out for your own bay
      // and in duo — the card was there, it just refused — because it only knew
      // how to be the AI's mystery opponent. It resolves on the spot for a bay
      // a person is going to drive; see resolveRandom.
      el.classList.remove("is-disabled");
    });
    document.body.classList.toggle("is-duo", duoMode);
    // A bay with nothing claimed in it dresses itself for whatever the cursor
    // is over, so the plate and the stat pips describe the bot in the window
    // rather than sitting blank next to it. `is-preview` is what keeps that
    // readable as "this is what you would get", not "this is yours".
    const cardFor = (slot) => {
      const picked = getSlot(slot);
      if (picked) return picked === "random" ? RANDOM_CARD : getBotCard(picked);
      return browsing[slot] ? getBotCard(browsing[slot]) : null;
    };
    // Bays past the player count are not on screen at all, and the stage's
    // column count follows so three pods lay out as three rather than as two
    // with a gap.
    pods.forEach((pod, slot) => {
      if (pod.root) pod.root.hidden = slot >= slotCount;
    });
    stageEl?.setAttribute("data-pods", String(slotCount));
    // The data-nav hints are a TWO-POD arrangement: they exist so stepping
    // across the stage stops at FIGHT between the pair instead of jumping pod
    // to pod. With three or four pods FIGHT is not between anything — it sits
    // under the row — so the hints would send the cursor sideways past two bays
    // to reach it. Spatial navigation gets it right on its own from there.
    const pairwise = slotCount === 2;
    NAV_PAIR_HINTS.forEach(({ el, attr, value }) => {
      if (!el) return;
      if (pairwise) el.setAttribute(attr, value);
      else el.removeAttribute(attr);
    });
    slots().forEach((slot) => {
      const soloEmpty = ["PICK<br />YOUR BOT", "PICK THE<br />OPPONENT"];
      const empty = duoMode ? `P${slot + 1} — PRESS A<br />TO PICK` : soloEmpty[slot];
      fillPod(slot, cardFor(slot), empty);
      pods[slot].root?.classList.toggle("is-preview", !getSlot(slot) && Boolean(browsing[slot]));
      // Rendered as visible text by screens.css (content: attr(data-role)), so
      // it is copy like everything else.
      pods[slot].plate?.setAttribute("data-role", duoMode
        ? t("hud.playerTag", { number: slot + 1 })
        : t(slot === 0 ? "hud.youTag" : "hud.rivalTag"));
      // Every bay is live at once in duo, so each stays armed until it is
      // filled; solo, exactly the bay the flow is on is armed.
      pods[slot].root?.classList.toggle(
        "is-armed",
        duoMode ? !getSlot(slot) : (slot === 0) === (sel.stage === "player"),
      );
    });
    if (duoMode) {
      stepEl.textContent = playerCount > 2
        ? t("select.duoMany", { count: slotCount })
        : t("select.duoPair");
    } else {
      stepEl.textContent = t(sel.stage === "player" ? "select.stepPlayer" : "select.stepOpponent");
    }
    fightBtn.disabled = slots().some((slot) => !getSlot(slot));
    // Once anything is CLAIMED the screen changes job: it stops being a
    // catalogue and starts being a look at the machine you are taking in, so
    // the roster gives up a row and the bays take the height. Browsing does not
    // trigger it — the cursor is still in the grid and shrinking it under the
    // cursor would be the screen moving while you read it.
    selectScreen?.classList.toggle("is-showcase", slots().some((slot) => Boolean(getSlot(slot))));
    emitSelection(claimSlot);
    claimSlot = null;
  }

  /** refreshSelect() runs on every screen entry too; only a real PICK should
   *  move the cursor or replay the flourish, so pick handlers call this.
   *  @param {{slot:number, player:number, claimed:boolean}} pick */
  function refreshAfterPick({ slot, player = 0, claimed = true }) {
    // A bay you just filled has nothing left to browse into, and one you just
    // emptied should fall back to the cursor rather than to the bot that is no
    // longer yours.
    browsing[slot] = null;
    claimSlot = claimed ? slot : null;
    refreshSelect();
    // Once both bays are full there is exactly one thing left to do, so put the
    // cursor on it: the pick and the press that starts the match become one
    // gesture instead of a hunt back up the screen for FIGHT.
    if (!fightBtn.disabled) nav?.focus(fightBtn, player);
  }

  /**
   * The cursor moved onto a roster card, so the bay that player is filling
   * shows it. This is the difference between a wall of thumbnails and a
   * catalogue: the 3D window is already the best thing on the screen, and
   * before this it sat empty until you had committed to something.
   * @param {string|null} id the card under the cursor, null if it left the grid
   */
  function browseTo(id, player = 0) {
    const slot = armedSlot(player);
    // A claimed bay is not browsable — that bot is chosen and stays on screen
    // until it is dropped. Random has no model to show, so it browses as empty.
    if (getSlot(slot)) return;
    const next = id && id !== "random" ? id : null;
    if (browsing[slot] === next) return;
    browsing[slot] = next;
    refreshSelect();
  }

  /** A pad plugged in or pulled out — reshape the screen around the new count.
   *  Two pads is the duo screen; three and four add a bay each. */
  function setPlayerCount(count) {
    const next = Math.max(0, Math.min(MAX_SLOTS, count | 0));
    if (next === playerCount) return;
    playerCount = next;
    const wasDuo = duoMode;
    duoMode = playerCount >= 2;
    const previousSlots = slotCount;
    slotCount = Math.max(2, playerCount);
    // A pending "random" rival was the AI's mystery, and P2 is not the AI —
    // roll it into a real bot rather than emptying the bay someone is now
    // sitting in front of.
    if (duoMode && !wasDuo && sel.picks[1] === "random") {
      sel.picks[1] = resolveRandom("random", { exclude: takenBy(1) });
    }
    // Bays that just left the screen give their bots back, so a player who
    // unplugs does not keep a machine nobody can drive.
    for (let slot = slotCount; slot < previousSlots; slot += 1) {
      sel.picks[slot] = null;
      browsing[slot] = null;
    }
    if (!duoMode) sel.stage = sel.picks[0] ? "rival" : "player";
    refreshSelect();
  }

  // Clicking a bay's name plate: in duo it drops what that player picked, solo
  // it moves the two-step flow to that bay.
  pods.forEach((pod, slot) => {
    pod.plate?.addEventListener("click", () => {
      if (duoMode) {
        duoToggle(slot, getSlot(slot));
        return;
      }
      if (slot === 1 && !sel.picks[0]) return; // no opponent before you have a bot
      sel.stage = slot === 1 ? "rival" : "player";
      refreshSelect();
    });
  });

  // -------------------------------------------------------------- difficulty
  const diffButtons = Array.from(document.querySelectorAll("[data-difficulty]"));
  function syncDifficulty() {
    diffButtons.forEach((b) =>
      b.classList.toggle("is-active", b.dataset.difficulty === settings.aiDifficulty)
    );
  }
  diffButtons.forEach((b) =>
    b.addEventListener("click", () => setSetting("aiDifficulty", b.dataset.difficulty))
  );
  cleanups.push(onSettingChanged("aiDifficulty", syncDifficulty));
  syncDifficulty();

  // -------------------------------------------------------------------- HUD
  const HUD_KEYS = ["player", "rival", "p3", "p4"];
  const hud = {
    damage: new Array(MAX_SLOTS).fill(0),
    broken: Array.from({ length: MAX_SLOTS }, () => new Set()),
    names: new Array(MAX_SLOTS).fill("—"),
    clock: { remaining: MATCH_SECONDS, running: false, lastTs: 0, interval: /** @type {any} */ (null) },
    lastTick: new Array(MAX_SLOTS).fill(0),
    /** Machines in the match being shown. Two until a bigger one starts. */
    bots: 2,
  };
  const hudEls = HUD_KEYS.map((key) => ({
    name: $(`hud-${key}-name`),
    fill: $(`hud-${key}-fill`),
    pct: $(`hud-${key}-pct`),
    tags: $(`hud-${key}-tags`),
    panel: $(`hud-${key}-name`)?.closest(".hud-bot") || null,
  }));
  /** Every panel the current match uses. */
  const hudSlots = () => Array.from({ length: hud.bots }, (_, i) => i);
  const clockEl = $("hud-clock");
  const phaseEl = $("hud-phase");
  const tickerEl = $("hud-ticker");
  const calloutEl = $("hud-callout");
  const countdownEl = $("hud-countdown");
  const countdownNum = $("hud-countdown-num");
  const bannerEl = $("hud-banner");

  function botName(i) {
    return hud.names[i] || (i === 0 ? t("hud.playerFallback") : t("hud.playerTag", { number: i + 1 }));
  }

  function updateDamage(i) {
    const els = hudEls[i];
    if (!els?.fill) return;
    const pct = hud.damage[i];
    els.fill.style.transform = `scaleX(${(pct / 100).toFixed(4)})`;
    els.pct.textContent = `${Math.round(pct)}%`;
    els.panel?.classList.toggle("is-hurt", pct >= 55);
    els.panel?.classList.toggle("is-critical", pct >= 85);
  }

  function renderTags(i) {
    if (hudEls[i]?.tags) {
      hudEls[i].tags.innerHTML = Array.from(hud.broken[i])
        .map((zone) => `<span class="hud-tag">${BREAK_LABELS[zone] || String(zone).toUpperCase()}</span>`)
        .join("");
    }
  }

  const hudTop = document.querySelector(".hud-top");

  /** Panels for machines that are not in this match are not on the bar. The
   *  count goes on the bar itself so the CSS can move the extra panels down to
   *  the corners their viewports are in. */
  function syncHudPanels() {
    hudTop?.setAttribute("data-bots", String(hud.bots));
    hudEls.forEach((els, i) => {
      if (els.panel) els.panel.hidden = i >= hud.bots;
      els.panel?.classList.remove("is-out");
    });
  }

  function resetHud() {
    hud.bots = Math.max(2, lastMatch?.botIds?.length || 2);
    hud.damage = new Array(MAX_SLOTS).fill(0);
    hud.broken = Array.from({ length: MAX_SLOTS }, () => new Set());
    hud.lastTick = new Array(MAX_SLOTS).fill(0);
    syncHudPanels();
    hudEls.forEach((_, i) => {
      updateDamage(i);
      renderTags(i);
    });
    tickerEl.innerHTML = "";
    bannerEl.hidden = true;
    calloutEl.hidden = true;
    countdownEl.hidden = true;
    setClock(MATCH_SECONDS);
    stopClock();
    setPhase(t("hud.standBy"));
  }

  function setHudNames() {
    const fallback = [
      t("hud.playerFallback"), t("hud.rivalFallback"),
      t("hud.playerTag", { number: 3 }), t("hud.playerTag", { number: 4 }),
    ];
    // Several people may bring the SAME machine — a mirror match is allowed —
    // and four panels all reading TOMBSTONE tell you nothing about which bar is
    // yours. Only the duplicated ones get a player tag; a bot nobody else
    // brought keeps its plain name.
    const counts = new Map();
    hudSlots().forEach((i) => counts.set(matchId(i), (counts.get(matchId(i)) || 0) + 1));
    hudEls.forEach((els, i) => {
      const id = matchId(i);
      const card = id ? getBotCard(id) : null;
      const base = card?.name.toUpperCase() || fallback[i];
      // The tag speaks the screen's own language: with two or more people it is
      // P1..P4, and against the AI it is you and the rival.
      const tag = (lastMatch?.humans || 0) >= 2
        ? t("hud.playerTag", { number: i + 1 })
        : t(i === 0 ? "hud.youTag" : "hud.rivalTag");
      hud.names[i] = counts.get(id) > 1 ? `${tag} ${base}` : base;
      if (els.name) els.name.textContent = hud.names[i];
      if (card) els.panel?.style.setProperty("--accent", card.accent);
    });
  }

  function setPhase(text) {
    phaseEl.textContent = text;
  }

  // Clock: locally ticked between EV.MATCH updates; any MATCH payload carrying
  // a remaining-seconds field resyncs it, so either style of game layer works.
  function setClock(seconds) {
    hud.clock.remaining = clamp(seconds, 0, 59 * 60);
    const s = Math.max(0, Math.ceil(hud.clock.remaining));
    clockEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    clockEl.classList.toggle("is-final-minute", s <= 60 && s > 10);
    clockEl.classList.toggle("is-critical", s <= 10);
  }

  function startClock(fromSeconds) {
    if (typeof fromSeconds === "number") setClock(fromSeconds);
    stopClock();
    hud.clock.running = true;
    hud.clock.lastTs = performance.now();
    hud.clock.interval = setInterval(() => {
      const now = performance.now();
      const dt = (now - hud.clock.lastTs) / 1000;
      hud.clock.lastTs = now;
      setClock(hud.clock.remaining - dt);
      if (hud.clock.remaining <= 0) stopClock();
    }, 200);
  }

  function stopClock() {
    hud.clock.running = false;
    if (hud.clock.interval) clearInterval(hud.clock.interval);
    hud.clock.interval = null;
  }

  function ticker(text, cls = "") {
    if (!tickerEl) return;
    const line = document.createElement("div");
    line.className = `tick ${cls}`.trim();
    line.innerHTML = text;
    tickerEl.prepend(line);
    while (tickerEl.children.length > 5) tickerEl.lastElementChild.remove();
    setTimeout(() => {
      line.classList.add("is-leaving");
      setTimeout(() => line.remove(), 400);
    }, 4200);
  }

  let calloutTimer = null;
  function showCallout(text) {
    calloutEl.querySelector("span").textContent = text;
    calloutEl.hidden = false;
    calloutEl.classList.remove("is-in");
    void calloutEl.offsetWidth; // restart animation
    calloutEl.classList.add("is-in");
    if (calloutTimer) clearTimeout(calloutTimer);
    calloutTimer = setTimeout(() => {
      calloutEl.hidden = true;
    }, 3400);
  }

  function showCountdown(value) {
    countdownEl.hidden = false;
    const copy = value == null ? t("hud.ready") : String(value);
    countdownNum.textContent = copy;
    countdownNum.classList.toggle("is-word", value == null || String(value).length > 2);
    countdownNum.classList.toggle("is-long", copy.length > 10);
    countdownNum.classList.remove("pop");
    void countdownNum.offsetWidth;
    countdownNum.classList.add("pop");
  }

  function flashFight() {
    countdownEl.hidden = false;
    const flash = t("hud.fightFlash");
    countdownNum.textContent = flash;
    countdownNum.classList.add("is-word", "is-fight");
    // The flash is authored copy and can be a sentence rather than a word
    // ("It's Robot Fighting Time!"), which at the display size overflows the
    // screen. Past a handful of characters it wraps and steps down a size.
    countdownNum.classList.toggle("is-long", flash.length > 10);
    countdownNum.classList.remove("pop");
    void countdownNum.offsetWidth;
    countdownNum.classList.add("pop");
    setTimeout(() => {
      countdownEl.hidden = true;
      countdownNum.classList.remove("is-fight", "is-long");
    }, 900);
  }

  function showBanner(text) {
    bannerEl.textContent = text;
    bannerEl.hidden = false;
    bannerEl.classList.remove("slam");
    void bannerEl.offsetWidth;
    bannerEl.classList.add("slam");
  }

  // ----------------------------------------------------------------- results
  function fillResults(payload = {}) {
    const winnerIndex = Number.isInteger(payload.winnerIndex)
      ? payload.winnerIndex
      : Number.isInteger(payload.winner)
        ? payload.winner
        : null;
    const methodRaw = String(payload.method || payload.reason || "").toLowerCase();
    const isKO = methodRaw.includes("ko") || methodRaw.includes("knock");
    const kicker = $("res-kicker");
    const nameEl = $("res-winner-name");
    const methodEl = $("res-method");
    const imgWrap = $("res-image");
    const lineEl = $("res-line");

    if (winnerIndex !== null && winnerIndex >= 0 && winnerIndex < hud.bots) {
      const id = matchId(winnerIndex);
      const card = id ? getBotCard(id) : null;
      // VICTORY is you winning. With three or four machines everybody but P1
      // reads as a defeat FOR P1, which is the same question — whose screen is
      // this — so the test does not change.
      kicker.textContent = t(winnerIndex === 0 ? "results.victory" : "results.defeat");
      kicker.dataset.tone = winnerIndex === 0 ? "win" : "loss";
      // botName carries the player tag when the roster had duplicates, which is
      // the whole question on a results screen for a mirror match: which one.
      nameEl.textContent = botName(winnerIndex);
      methodEl.textContent = t(isKO ? "results.winsByKnockout" : "results.winsByDecision");
      imgWrap.innerHTML = card ? `<img src="${card.image}" alt="${card.name}" draggable="false" />` : "";
      wireImage(imgWrap);
      if (card) imgWrap.style.setProperty("--accent", card.accent);
    } else {
      kicker.textContent = t("results.fullTime");
      kicker.dataset.tone = "draw";
      nameEl.textContent = t("results.draw");
      methodEl.textContent = t("results.judgesEven");
      imgWrap.innerHTML = "";
    }
    lineEl.textContent = t("results.finalDamage", {
      scores: hudSlots()
        .map((i) => t("results.finalDamageEntry", {
          name: botName(i), damage: Math.round(hud.damage[i]),
        }))
        .join(t("results.finalDamageSeparator")),
    });
  }

  // -------------------------------------------------------------- bus wiring
  /** Last seen match phase, so repeated same-phase emits (clock syncs) don't
   *  re-trigger one-shot presentation like the FIGHT! flash. */
  let lastPhase = null;
  cleanups.push(
    subscribe(EV.MATCH, (p = {}) => {
      const remaining = [p.remaining, p.timeLeft, p.timeRemaining, p.clock, p.seconds].find(
        (v) => typeof v === "number" && Number.isFinite(v)
      );
      if (remaining !== undefined && p.phase !== "countdown") setClock(remaining);
      // Pause signal: freeze/resume the locally-ticked clock (it runs on wall
      // time and would otherwise keep counting through a paused match).
      if (typeof p.paused === "boolean") {
        if (p.paused) stopClock();
        else if (p.phase === "fight") startClock(remaining !== undefined ? remaining : hud.clock.remaining);
        return;
      }
      if (p.killSaws === true || p.killSawsActive === true || p.hazard === "killSaw" || p.phase === "killSaws") {
        showCallout(t("hud.killSaws"));
        ticker(`<b>HAZARD</b> — kill saws are live`, "tick-alert");
      }
      // A machine out of a three- or four-way, which is not the end of the
      // round any more. The panel stays on the bar greyed out — who is left is
      // the thing you most want to know at that moment.
      if (typeof p.eliminated === "number") {
        hud.broken[p.eliminated]?.add("out");
        hudEls[p.eliminated]?.panel?.classList.add("is-out");
        showCallout(`${botName(p.eliminated)} IS OUT`);
        ticker(`<b>${botName(p.eliminated)}</b> — eliminated · ${p.remainingBots} left`, "tick-alert");
      }
      switch (p.phase) {
        case "countdown":
          if (screens.current() !== "match") screens.goTo("match");
          if (p.count === 3 || p.count === undefined) resetHud();
          stopClock();
          setClock(remaining !== undefined ? remaining : MATCH_SECONDS);
          setPhase(t("hud.getReady"));
          showCountdown(typeof p.count === "number" ? p.count : null);
          break;
        case "fight":
          if (lastPhase !== "fight") {
            flashFight();
            setPhase(t("hud.phaseFight"));
          }
          startClock(remaining !== undefined ? remaining : hud.clock.remaining);
          break;
        case "ko":
          stopClock();
          setPhase(t("hud.phaseKnockout"));
          showBanner(t("hud.bannerKo"));
          break;
        case "timeUp":
          stopClock();
          setPhase(t("hud.phaseTimeExpired"));
          showBanner(t("hud.bannerTime"));
          break;
        case "results":
          stopClock();
          fillResults(p);
          screens.goTo("results");
          break;
        default:
          break;
      }
      if (typeof p.phase === "string") lastPhase = p.phase;
    })
  );

  cleanups.push(
    subscribe(EV.DAMAGE, (p = {}) => {
      const i = p.botIndex;
      if (!Number.isInteger(i) || i < 0 || i >= hud.bots) return;
      const amount = typeof p.amount === "number" ? p.amount : 0;
      hud.damage[i] = clamp(hud.damage[i] + amount, 0, 100);
      updateDamage(i);
      // Ticker only meaningful hits, throttled per bot so grinds don't spam.
      const now = performance.now();
      if (settings.showDamageEvents && amount >= 2 && now - hud.lastTick[i] > 700) {
        hud.lastTick[i] = now;
        ticker(`<b>${botName(i)}</b> — ${t(ZONE_LABELS[p.zone], null, t("hud.zoneUnknown"))} +${Math.round(amount)}`);
      }
    })
  );

  cleanups.push(
    subscribe(EV.PART_BREAK, (p = {}) => {
      const i = p.botIndex;
      if (!Number.isInteger(i) || i < 0 || i >= hud.bots) return;
      hud.broken[i].add(p.zone);
      renderTags(i);
      ticker(`<b>${botName(i)}</b> — ${t(BREAK_LABELS[p.zone], null, t("hud.breakUnknown"))} `, "tick-alert");
    })
  );

  // ---------------------------------------------------------------- settings
  const modal = $("settings-modal");
  function openSettings() {
    modal.hidden = false;
    void modal.offsetWidth; // flush styles so the opacity transition runs
    modal.classList.add("is-open");
  }
  function closeSettings() {
    modal.classList.remove("is-open");
    setTimeout(() => {
      modal.hidden = true;
    }, 220);
  }
  $("btn-title-settings")?.addEventListener("click", openSettings);
  $("btn-settings-close")?.addEventListener("click", closeSettings);
  modal?.addEventListener("click", (ev) => {
    if (ev.target === modal) closeSettings();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && modal && !modal.hidden) closeSettings();
  });

  /** Two-state toggle button bound to a boolean setting. */
  function bindToggle(el, key, labelOn, labelOff) {
    if (!el) return;
    const render = () => {
      const v = !!settings[key];
      el.setAttribute("aria-pressed", String(v));
      el.classList.toggle("is-on", v);
      const label = el.querySelector("[data-toggle-label]") || el;
      label.textContent = v ? labelOn : labelOff;
    };
    el.addEventListener("click", () => setSetting(key, !settings[key]));
    cleanups.push(onSettingChanged(key, render));
    render();
  }

  bindToggle($("btn-title-sound"), "soundEnabled", t("title.soundOn"), t("title.soundOff"));
  bindToggle($("set-sound"), "soundEnabled", t("settings.on"), t("settings.off"));
  bindToggle($("set-sampled-sfx"), "sampledSfx", t("settings.on"), t("settings.off"));
  bindToggle($("set-haptics"), "hapticsEnabled", t("settings.on"), t("settings.off"));
  bindToggle($("set-damage-events"), "showDamageEvents", t("settings.on"), t("settings.off"));

  const cameraSel = /** @type {HTMLSelectElement} */ ($("set-camera"));
  if (cameraSel) {
    cameraSel.value = settings.cameraMode;
    cameraSel.addEventListener("change", () => setSetting("cameraMode", cameraSel.value));
    cleanups.push(onSettingChanged("cameraMode", (v) => (cameraSel.value = v)));
  }

  // ----------------------------------------------------------------- buttons
  $("btn-title-fight")?.addEventListener("click", () => {
    screens.goTo("botSelect");
    refreshSelect();
  });
  $("btn-select-back")?.addEventListener("click", () => screens.goTo("title"));

  fightBtn?.addEventListener("click", () => {
    if (slots().some((slot) => !getSlot(slot))) return;
    // The AI's mystery opponent is rolled HERE, at the box, which is the whole
    // point of it. Every other bay already holds a concrete bot.
    // Everything already decided, so the mystery cannot roll a machine somebody
    // else is bringing.
    const taken = slots().map(getSlot).filter((id) => id && id !== "random");
    const botIds = slots().map((slot) => {
      const id = getSlot(slot);
      return id === "random" ? pickRandomBotId(taken) : id;
    });
    lastMatch = { botIds, humans: playerCount };
    resetHud();
    setHudNames();
    screens.goTo("match");
    onAction({
      type: "startMatch",
      botIds,
      // How many of those machines have a person behind them. main.js needs it
      // to know whether to split the screen and how many ways.
      humanCount: playerCount,
      // The 1v1 shorthand, still what the dev console and older callers read.
      playerBotId: botIds[0],
      rivalBotId: botIds[1],
      difficulty: settings.aiDifficulty,
    });
  });

  $("btn-rematch")?.addEventListener("click", () => {
    resetHud();
    setHudNames();
    screens.goTo("match");
    onAction({ type: "rematch" });
  });
  $("btn-change")?.addEventListener("click", () => {
    screens.goTo("botSelect");
    refreshSelect();
    onAction({ type: "changeBots" });
  });
  $("btn-res-title")?.addEventListener("click", () => {
    screens.goTo("title");
    onAction({ type: "toTitle" });
  });

  refreshSelect();
  resetHud();

  // ------------------------------------------------------- controller / keys
  // Full menu navigation from a gamepad (and arrows/WASD) — see gamepadNav.js.
  // Assigned below; refreshAfterPick reaches for it, and a `const` here would
  // be in the temporal dead zone for anything that runs during construction.
  nav = createGamepadNav({
    screens,
    modal,
    // Bot select is the one screen where "who pressed the button" matters.
    duoScreens: ["botSelect"],
    onPlayerCountChange: setPlayerCount,
    // The cursor IS the browse pointer on this screen. Moving it off the grid
    // leaves the last card staged rather than emptying the bay — the pod is
    // where you look at a bot, and blanking it because you reached for FIGHT
    // would be the screen taking the thing away as you go to act on it.
    onFocusChange: (el, player) => {
      if (screens.current() !== "botSelect") return;
      const card = el?.closest?.(".bot-card");
      if (card) browseTo(card.dataset.botId, player);
    },
    onActivate: (el, player) => {
      if (!duoMode || screens.current() !== "botSelect") return false;
      const card = el.closest?.(".bot-card");
      if (card && !card.classList.contains("is-disabled")) return duoToggle(player, card.dataset.botId);
      // Your own bay's name plate is a shortcut for "drop what I picked".
      const plateSlot = pods.findIndex((pod) => pod.plate && pod.plate === el);
      if (plateSlot >= 0 && plateSlot < slotCount) return duoToggle(plateSlot, getSlot(plateSlot));
      return false; // FIGHT, difficulty, back — any player may press these
    },
    onBack: (screen, player = 0) => {
      if (screen !== "botSelect") return false;
      if (duoMode) {
        // B drops your own pick; with nothing to drop, only P1 leaves the
        // screen so P2 cannot yank both players back to the title.
        if (getSlot(player)) {
          setSlot(player, null);
          refreshSelect();
          return true;
        }
        return player !== 0;
      }
      // Solo: B rewinds one pick at a time before it leaves the screen — the
      // opponent, then your own bot, then out. Dropping your own is what puts
      // the screen back to an empty stage and a full-size roster, and without
      // this step there was no way to get there short of leaving.
      if (sel.stage === "rival") {
        sel.picks[1] = null;
        sel.stage = "player";
        refreshSelect();
        return true;
      }
      if (sel.picks[0]) {
        sel.picks[0] = null;
        refreshSelect();
        return true;
      }
      return false;
    },
  });
  nav.start();
  if (typeof window !== "undefined") {
    window.__bba2Nav = nav;
    // Dev observability: the select screen's whole state in one object. Who
    // holds what is otherwise only visible through CSS classes, which is a
    // miserable thing to assert against from a probe.
    window.__bba2Select = () => ({
      playerCount, duoMode, slotCount, stage: sel.stage,
      picks: sel.picks.slice(0, slotCount), browsing: browsing.slice(0, slotCount),
      fightEnabled: !fightBtn.disabled,
    });
  }

  function dispose() {
    stopClock();
    nav.dispose();
    cleanups.forEach((fn) => {
      try {
        fn();
      } catch {
        /* listener already gone */
      }
    });
  }

  return { screens, goTo: screens.goTo, nav, dispose };
}
