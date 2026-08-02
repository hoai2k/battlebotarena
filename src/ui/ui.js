// createUI({ bus, onAction }) — builds and wires the whole game UI.
// Emits user intent through onAction(action) and reacts to bus events
// (EV.MATCH / EV.DAMAGE / EV.PART_BREAK) to drive the HUD. Never imports
// three.js, rapier, or sim/game modules — DOM + shared contracts only.
//
// Action payloads emitted via onAction:
//   { type: "startMatch", playerBotId, rivalBotId, difficulty }  // rivalBotId always concrete (Random resolved here)
//   { type: "rematch" }
//   { type: "changeBots" }
//   { type: "toTitle" }

import { EV } from "../shared/events.js";
import { settings, setSetting, onSettingChanged } from "../shared/settings.js";
import { createScreens } from "./screens.js";
import { createGamepadNav } from "./gamepadNav.js";
import { BOT_CARDS, RANDOM_CARD, getBotCard, pickRandomBotId } from "./botCards.js";

const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

const ZONE_LABELS = { body: "BODY", weapon: "WEAPON", drive: "DRIVE" };
const BREAK_LABELS = { weapon: "WEAPON OUT", drive: "DRIVE DAMAGE", body: "ARMOR BREACH" };
const MATCH_SECONDS = 180;

/**
 * @param {{ bus?: { on(type:string, fn:Function): Function }, on?: Function, onAction?: (action: object) => void }} opts
 */
export function createUI({ bus, on, onAction = () => {} } = {}) {
  const subscribe = bus && typeof bus.on === "function" ? bus.on.bind(bus) : on || (() => () => {});
  const screens = createScreens({ initial: "title" });
  /** @type {Function[]} */
  const cleanups = [];

  // ---------------------------------------------------------------- selection
  // Two shapes of the same screen:
  //   solo (0-1 pads) — one cursor walks a two-step flow, YOU then RIVAL.
  //   duo  (2 pads)   — both players pick simultaneously, each owning one
  //                     slot; slot 0 is P1/bot 0, slot 1 is P2/bot 1, matching
  //                     main.js's pad->bot assignment.
  const sel = {
    stage: /** @type {"player"|"rival"} */ ("player"),
    playerBotId: /** @type {string|null} */ (null),
    rivalBotId: /** @type {string|null} */ (null), // may be "random"
  };
  /** True while two controllers are connected. */
  let duoMode = false;

  const SLOT_KEYS = /** @type {const} */ (["playerBotId", "rivalBotId"]);
  const getSlot = (slot) => sel[SLOT_KEYS[slot]];
  const setSlot = (slot, id) => {
    sel[SLOT_KEYS[slot]] = id;
  };
  /** Concrete ids of the match in flight; index 0 = player, 1 = rival. */
  let lastMatch = /** @type {{ playerBotId: string, rivalBotId: string }|null} */ (null);

  const grid = $("bot-grid");
  const stepEl = $("sel-step");
  const fightBtn = /** @type {HTMLButtonElement} */ ($("btn-fight"));
  const slotPlayer = $("slot-player");
  const slotRival = $("slot-rival");

  // Showcase pods: the big 3D windows the chosen bots render into. The UI owns
  // their DOM chrome (plate, badge, stats, empty copy); the integrator owns the
  // 3D itself via the previewSelection actions emitted from refreshSelect.
  const pods = [$("pod-player"), $("pod-rival")].map((root, i) => ({
    root,
    plate: i === 0 ? slotPlayer : slotRival,
    plateBody: (i === 0 ? slotPlayer : slotRival)?.querySelector(".pod-plate-body") || null,
    empty: root?.querySelector(".pod-empty") || null,
    badge: root?.querySelector(".pod-badge") || null,
    stats: root?.querySelector(".pod-stats") || null,
    test: root?.querySelector(".pod-test") || null,
  }));

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

  function statRow(label, value) {
    let pips = "";
    for (let i = 1; i <= 5; i += 1) pips += `<i class="pip${i <= value ? " on" : ""}"></i>`;
    return `<span class="stat stat-${label.toLowerCase()}"><b class="stat-label">${label}</b><span class="pips">${pips}</span></span>`;
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
    el.setAttribute("aria-label", "Random opponent");
    el.innerHTML = `
      <span class="bot-card-img"><span class="random-glyph">?</span></span>
      <span class="bot-card-name">${RANDOM_CARD.name}</span>
      <span class="bot-card-badge">ANY OF THE ${BOT_CARDS.length}</span>`;
    return el;
  }

  /**
   * Duo pick/unpick for one player. A on a free card claims it; A on the card
   * you already hold releases it; A on the other player's card does nothing
   * (whoever got there first keeps it).
   * @returns {boolean} true if the press was consumed
   */
  function duoToggle(slot, id) {
    if (!id || id === "random") return true; // random is solo-only
    const mine = getSlot(slot);
    const theirs = getSlot(slot === 0 ? 1 : 0);
    if (mine === id) setSlot(slot, null);
    else if (theirs === id) return true; // taken — ignore rather than steal
    else setSlot(slot, id);
    refreshSelect();
    return true;
  }

  /** Solo flow: the single cursor fills YOU, then RIVAL. */
  function soloPick(id) {
    if (sel.stage === "player") {
      if (id === "random") return;
      sel.playerBotId = id;
      if (sel.rivalBotId === id) sel.rivalBotId = null; // no mirror match via direct pick collision
      sel.stage = "rival";
    } else {
      sel.rivalBotId = id;
    }
    refreshSelect();
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
          : `${statRow("SPD", card.stats.speed)}${statRow("PWR", card.stats.power)}${statRow("ARM", card.stats.armor)}`;
      // Random has nothing to render or fire; a real pick gets the test rig.
      if (pod.test) pod.test.hidden = isRandom;
    } else {
      pod.root.style.removeProperty("--accent");
      if (pod.plateBody) pod.plateBody.innerHTML = `<span class="pod-plate-empty">— OPEN BAY —</span>`;
      if (pod.empty) pod.empty.innerHTML = emptyCopy;
      if (pod.badge) pod.badge.textContent = "";
      if (pod.stats) pod.stats.innerHTML = "";
      if (pod.test) pod.test.hidden = true;
    }
  }

  /** Tell the integrator what to stage in the 3D pods and who owns the
   *  camera sticks. Solo, focus follows the pick flow: your bay until you
   *  have picked a real rival, then theirs. */
  function emitSelection() {
    onAction({
      type: "previewSelection",
      playerBotId: sel.playerBotId,
      rivalBotId: sel.rivalBotId,
      duo: duoMode,
      focusSlot: duoMode
        ? null
        : sel.stage === "rival" && sel.rivalBotId && sel.rivalBotId !== "random"
          ? 1
          : 0,
    });
  }

  function refreshSelect() {
    if (!grid) return;
    grid.querySelectorAll(".bot-card").forEach((el) => {
      const id = el.dataset.botId;
      el.classList.toggle("is-player", id === sel.playerBotId);
      el.classList.toggle("is-rival", id === sel.rivalBotId);
      // Random is a stand-in for the AI opponent; with two humans, both sides
      // are real picks, so it is off the table entirely.
      el.classList.toggle("is-disabled", id === "random" && (duoMode || sel.stage === "player"));
    });
    document.body.classList.toggle("is-duo", duoMode);
    fillPod(
      0,
      sel.playerBotId ? getBotCard(sel.playerBotId) : null,
      duoMode ? "P1 — PRESS A<br />TO PICK" : "PICK<br />YOUR BOT"
    );
    fillPod(
      1,
      sel.rivalBotId ? (sel.rivalBotId === "random" ? RANDOM_CARD : getBotCard(sel.rivalBotId)) : null,
      duoMode ? "P2 — PRESS A<br />TO PICK" : "PICK THE<br />OPPONENT"
    );
    slotPlayer?.setAttribute("data-role", duoMode ? "P1" : "YOU");
    slotRival?.setAttribute("data-role", duoMode ? "P2" : "RIVAL");
    if (duoMode) {
      // Both sides are live at once, so both stay armed until they are filled.
      pods[0].root?.classList.toggle("is-armed", !sel.playerBotId);
      pods[1].root?.classList.toggle("is-armed", !sel.rivalBotId);
      stepEl.textContent = "TWO CONTROLLERS — EACH PLAYER PICKS THEIR OWN BOT";
    } else {
      pods[0].root?.classList.toggle("is-armed", sel.stage === "player");
      pods[1].root?.classList.toggle("is-armed", sel.stage === "rival");
      stepEl.textContent = sel.stage === "player" ? "STEP 1 — CHOOSE YOUR BOT" : "STEP 2 — CHOOSE THE OPPONENT";
    }
    fightBtn.disabled = !(sel.playerBotId && sel.rivalBotId);
    emitSelection();
  }

  /** Second pad plugged in / pulled out — reshape the screen around it. */
  function setDuoMode(active) {
    const next = Boolean(active);
    if (next === duoMode) return;
    duoMode = next;
    // Entering duo, a half-finished solo flow leaves the rival slot armed and
    // the stage mid-flight; the per-slot model does not use either.
    if (duoMode && sel.rivalBotId === "random") sel.rivalBotId = null;
    if (!duoMode) sel.stage = sel.playerBotId ? "rival" : "player";
    refreshSelect();
  }

  slotPlayer?.addEventListener("click", () => {
    if (duoMode) {
      duoToggle(0, sel.playerBotId); // clicking your filled slot clears it
      return;
    }
    sel.stage = "player";
    refreshSelect();
  });
  slotRival?.addEventListener("click", () => {
    if (duoMode) {
      duoToggle(1, sel.rivalBotId);
      return;
    }
    if (!sel.playerBotId) return;
    sel.stage = "rival";
    refreshSelect();
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
  const hud = {
    damage: [0, 0],
    broken: [new Set(), new Set()],
    names: ["—", "—"],
    clock: { remaining: MATCH_SECONDS, running: false, lastTs: 0, interval: /** @type {any} */ (null) },
    lastTick: [0, 0],
  };
  const hudEls = [
    { name: $("hud-player-name"), fill: $("hud-player-fill"), pct: $("hud-player-pct"), tags: $("hud-player-tags") },
    { name: $("hud-rival-name"), fill: $("hud-rival-fill"), pct: $("hud-rival-pct"), tags: $("hud-rival-tags") },
  ];
  const clockEl = $("hud-clock");
  const phaseEl = $("hud-phase");
  const tickerEl = $("hud-ticker");
  const calloutEl = $("hud-callout");
  const countdownEl = $("hud-countdown");
  const countdownNum = $("hud-countdown-num");
  const bannerEl = $("hud-banner");

  function botName(i) {
    return hud.names[i] || (i === 0 ? "PLAYER" : "RIVAL");
  }

  function updateDamage(i) {
    const pct = hud.damage[i];
    hudEls[i].fill.style.transform = `scaleX(${(pct / 100).toFixed(4)})`;
    hudEls[i].pct.textContent = `${Math.round(pct)}%`;
    const panel = hudEls[i].fill.closest(".hud-bot");
    panel?.classList.toggle("is-hurt", pct >= 55);
    panel?.classList.toggle("is-critical", pct >= 85);
  }

  function renderTags(i) {
    hudEls[i].tags.innerHTML = Array.from(hud.broken[i])
      .map((zone) => `<span class="hud-tag">${BREAK_LABELS[zone] || String(zone).toUpperCase()}</span>`)
      .join("");
  }

  function resetHud() {
    hud.damage = [0, 0];
    hud.broken = [new Set(), new Set()];
    hud.lastTick = [0, 0];
    updateDamage(0);
    updateDamage(1);
    renderTags(0);
    renderTags(1);
    tickerEl.innerHTML = "";
    bannerEl.hidden = true;
    calloutEl.hidden = true;
    countdownEl.hidden = true;
    setClock(MATCH_SECONDS);
    stopClock();
    setPhase("STAND BY");
  }

  function setHudNames() {
    hud.names = [
      lastMatch ? getBotCard(lastMatch.playerBotId)?.name.toUpperCase() || "PLAYER" : "PLAYER",
      lastMatch ? getBotCard(lastMatch.rivalBotId)?.name.toUpperCase() || "RIVAL" : "RIVAL",
    ];
    hudEls[0].name.textContent = hud.names[0];
    hudEls[1].name.textContent = hud.names[1];
    const pCard = lastMatch && getBotCard(lastMatch.playerBotId);
    const rCard = lastMatch && getBotCard(lastMatch.rivalBotId);
    if (pCard) hudEls[0].name.closest(".hud-bot")?.style.setProperty("--accent", pCard.accent);
    if (rCard) hudEls[1].name.closest(".hud-bot")?.style.setProperty("--accent", rCard.accent);
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
    countdownNum.textContent = value == null ? "READY" : String(value);
    countdownNum.classList.toggle("is-word", value == null || String(value).length > 2);
    countdownNum.classList.remove("pop");
    void countdownNum.offsetWidth;
    countdownNum.classList.add("pop");
  }

  function flashFight() {
    countdownEl.hidden = false;
    countdownNum.textContent = "FIGHT!";
    countdownNum.classList.add("is-word", "is-fight");
    countdownNum.classList.remove("pop");
    void countdownNum.offsetWidth;
    countdownNum.classList.add("pop");
    setTimeout(() => {
      countdownEl.hidden = true;
      countdownNum.classList.remove("is-fight");
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

    if (winnerIndex === 0 || winnerIndex === 1) {
      const id = winnerIndex === 0 ? lastMatch?.playerBotId : lastMatch?.rivalBotId;
      const card = id ? getBotCard(id) : null;
      kicker.textContent = winnerIndex === 0 ? "VICTORY" : "DEFEAT";
      kicker.dataset.tone = winnerIndex === 0 ? "win" : "loss";
      nameEl.textContent = card ? card.name.toUpperCase() : botName(winnerIndex);
      methodEl.textContent = isKO ? "WINS BY KNOCKOUT" : "WINS BY JUDGES DECISION";
      imgWrap.innerHTML = card ? `<img src="${card.image}" alt="${card.name}" draggable="false" />` : "";
      wireImage(imgWrap);
      if (card) imgWrap.style.setProperty("--accent", card.accent);
    } else {
      kicker.textContent = "FULL TIME";
      kicker.dataset.tone = "draw";
      nameEl.textContent = "DRAW";
      methodEl.textContent = "JUDGES CALL IT EVEN";
      imgWrap.innerHTML = "";
    }
    lineEl.textContent = `FINAL DAMAGE — ${botName(0)} ${Math.round(hud.damage[0])}% · ${botName(1)} ${Math.round(hud.damage[1])}%`;
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
        showCallout("KILL SAWS ACTIVE");
        ticker(`<b>HAZARD</b> — kill saws are live`, "tick-alert");
      }
      switch (p.phase) {
        case "countdown":
          if (screens.current() !== "match") screens.goTo("match");
          if (p.count === 3 || p.count === undefined) resetHud();
          stopClock();
          setClock(remaining !== undefined ? remaining : MATCH_SECONDS);
          setPhase("GET READY");
          showCountdown(typeof p.count === "number" ? p.count : null);
          break;
        case "fight":
          if (lastPhase !== "fight") {
            flashFight();
            setPhase("FIGHT");
          }
          startClock(remaining !== undefined ? remaining : hud.clock.remaining);
          break;
        case "ko":
          stopClock();
          setPhase("KNOCKOUT");
          showBanner("KO!");
          break;
        case "timeUp":
          stopClock();
          setPhase("TIME EXPIRED");
          showBanner("TIME!");
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
      if (i !== 0 && i !== 1) return;
      const amount = typeof p.amount === "number" ? p.amount : 0;
      hud.damage[i] = clamp(hud.damage[i] + amount, 0, 100);
      updateDamage(i);
      // Ticker only meaningful hits, throttled per bot so grinds don't spam.
      const now = performance.now();
      if (settings.showDamageEvents && amount >= 2 && now - hud.lastTick[i] > 700) {
        hud.lastTick[i] = now;
        ticker(`<b>${botName(i)}</b> — ${ZONE_LABELS[p.zone] || "HIT"} +${Math.round(amount)}`);
      }
    })
  );

  cleanups.push(
    subscribe(EV.PART_BREAK, (p = {}) => {
      const i = p.botIndex;
      if (i !== 0 && i !== 1) return;
      hud.broken[i].add(p.zone);
      renderTags(i);
      ticker(`<b>${botName(i)}</b> — ${BREAK_LABELS[p.zone] || "PART"} `, "tick-alert");
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

  bindToggle($("btn-title-sound"), "soundEnabled", "SOUND: ON", "SOUND: OFF");
  bindToggle($("set-sound"), "soundEnabled", "ON", "OFF");
  bindToggle($("set-haptics"), "hapticsEnabled", "ON", "OFF");
  bindToggle($("set-damage-events"), "showDamageEvents", "ON", "OFF");

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
    if (!sel.playerBotId || !sel.rivalBotId) return;
    const rivalBotId = sel.rivalBotId === "random" ? pickRandomBotId(sel.playerBotId) : sel.rivalBotId;
    lastMatch = { playerBotId: sel.playerBotId, rivalBotId };
    resetHud();
    setHudNames();
    screens.goTo("match");
    onAction({
      type: "startMatch",
      playerBotId: lastMatch.playerBotId,
      rivalBotId,
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
  const nav = createGamepadNav({
    screens,
    modal,
    // Bot select is the one screen where "who pressed the button" matters.
    duoScreens: ["botSelect"],
    onPlayerCountChange: (count) => setDuoMode(count >= 2),
    onActivate: (el, player) => {
      if (!duoMode || screens.current() !== "botSelect") return false;
      const card = el.closest?.(".bot-card");
      if (card && !card.classList.contains("is-disabled")) return duoToggle(player, card.dataset.botId);
      // Your own VS slot is a shortcut for "drop what I picked".
      if (el === slotPlayer) return duoToggle(0, sel.playerBotId);
      if (el === slotRival) return duoToggle(1, sel.rivalBotId);
      return false; // FIGHT, difficulty, back — either player may press these
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
      // Solo: B first rewinds the pick stage before leaving the screen.
      if (sel.stage === "rival") {
        sel.rivalBotId = null;
        sel.stage = "player";
        refreshSelect();
        return true;
      }
      return false;
    },
  });
  nav.start();
  if (typeof window !== "undefined") window.__bba2Nav = nav;

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
