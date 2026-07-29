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
  const sel = {
    stage: /** @type {"player"|"rival"} */ ("player"),
    playerBotId: /** @type {string|null} */ (null),
    rivalBotId: /** @type {string|null} */ (null), // may be "random"
  };
  /** Concrete ids of the match in flight; index 0 = player, 1 = rival. */
  let lastMatch = /** @type {{ playerBotId: string, rivalBotId: string }|null} */ (null);

  const grid = $("bot-grid");
  const stepEl = $("sel-step");
  const fightBtn = /** @type {HTMLButtonElement} */ ($("btn-fight"));
  const slotPlayer = $("slot-player");
  const slotRival = $("slot-rival");

  function statRow(label, value) {
    let pips = "";
    for (let i = 1; i <= 5; i += 1) pips += `<i class="pip${i <= value ? " on" : ""}"></i>`;
    return `<span class="stat stat-${label.toLowerCase()}"><b class="stat-label">${label}</b><span class="pips">${pips}</span></span>`;
  }

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
      <span class="bot-card-badge">${card.weaponType}</span>
      <span class="bot-card-stats">
        ${statRow("SPD", card.stats.speed)}
        ${statRow("PWR", card.stats.power)}
        ${statRow("ARM", card.stats.armor)}
      </span>`;
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
      <span class="bot-card-badge">${RANDOM_CARD.weaponType}</span>
      <span class="bot-card-stats"><span class="random-note">ANY OF THE EIGHT<br />REVEALED AT THE BOX</span></span>`;
    return el;
  }

  if (grid) {
    BOT_CARDS.forEach((card) => grid.appendChild(buildCard(card)));
    grid.appendChild(buildRandomCard());
    grid.addEventListener("click", (ev) => {
      const cardEl = /** @type {HTMLElement} */ (ev.target instanceof Element ? ev.target.closest(".bot-card") : null);
      if (!cardEl || cardEl.classList.contains("is-disabled")) return;
      const id = cardEl.dataset.botId;
      if (sel.stage === "player") {
        if (id === "random") return;
        sel.playerBotId = id;
        if (sel.rivalBotId === id) sel.rivalBotId = null; // no mirror match via direct pick collision
        sel.stage = "rival";
      } else {
        sel.rivalBotId = id;
      }
      refreshSelect();
    });
  }

  function fillSlot(slotEl, card, emptyCopy) {
    const body = slotEl.querySelector(".vs-slot-body");
    if (!card) {
      body.innerHTML = `<span class="vs-slot-empty">${emptyCopy}</span>`;
      slotEl.classList.remove("is-filled");
      return;
    }
    slotEl.classList.add("is-filled");
    slotEl.style.setProperty("--accent", card.accent);
    const img =
      card.id === "random"
        ? `<span class="vs-slot-img vs-slot-random">?</span>`
        : `<span class="vs-slot-img"><img src="${card.image}" alt="" draggable="false" /></span>`;
    body.innerHTML = `${img}
      <span class="vs-slot-meta">
        <b class="vs-slot-name">${card.name}</b>
        <span class="vs-slot-tag">${card.tagline}</span>
      </span>`;
  }

  function refreshSelect() {
    if (!grid) return;
    grid.querySelectorAll(".bot-card").forEach((el) => {
      const id = el.dataset.botId;
      el.classList.toggle("is-player", id === sel.playerBotId);
      el.classList.toggle("is-rival", id === sel.rivalBotId);
      el.classList.toggle("is-disabled", sel.stage === "player" && id === "random");
    });
    fillSlot(slotPlayer, sel.playerBotId ? getBotCard(sel.playerBotId) : null, "PICK<br />YOUR BOT");
    fillSlot(
      slotRival,
      sel.rivalBotId ? (sel.rivalBotId === "random" ? RANDOM_CARD : getBotCard(sel.rivalBotId)) : null,
      "PICK THE<br />OPPONENT"
    );
    slotPlayer.classList.toggle("is-armed", sel.stage === "player");
    slotRival.classList.toggle("is-armed", sel.stage === "rival");
    stepEl.textContent = sel.stage === "player" ? "STEP 1 — CHOOSE YOUR BOT" : "STEP 2 — CHOOSE THE OPPONENT";
    fightBtn.disabled = !(sel.playerBotId && sel.rivalBotId);
  }

  slotPlayer?.addEventListener("click", () => {
    sel.stage = "player";
    refreshSelect();
  });
  slotRival?.addEventListener("click", () => {
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
    onBack: (screen) => {
      // On bot select, B first rewinds the pick stage before leaving the screen.
      if (screen === "botSelect" && sel.stage === "rival") {
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
