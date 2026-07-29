// Gamepad + keyboard menu navigation for the v2 UI.
//
// createGamepadNav({ screens, onBack, onStart }) -> { start, stop, dispose, ... }
//
// Pure DOM: no three/rapier/sim imports (see ARCHITECTURE.md layering).
// Polls navigator.getGamepads() on rAF while a MENU screen is active. On the
// "match" screen it goes inert so it never fights game/input.js, which owns the
// pad during play.
//
// Button mapping (standard mapping, matching game/input.js conventions):
//   axes[0]/axes[1]  left stick  -> directional move (deadzone 0.5)
//   buttons[12..15]  d-pad       -> up / down / left / right
//   axes[9] (hat)    d-pad fallback for non-standard mappings
//   buttons[0]  A    -> activate focused element (.click())
//   buttons[1]  B    -> back (modal close / botSelect->title / results->title)
//   buttons[9]  Start-> primary action of the screen
//   buttons[8]  Back/Select -> same as B (convenience)
//
// Keyboard mirrors the same focus model: arrows + WASD move, Enter/Space
// activate (native button behaviour), Escape/Backspace go back. Mouse and the
// existing ui.js listeners are untouched.
//
// DUO MODE. On screens listed in `duoScreens`, when two pads are connected,
// each pad gets its OWN independent cursor so both players can drive the menu
// at once (bot select: each person picks and unpicks their own bot). Pad slot
// order matches game/input.js — dense getGamepads() order, so menu P1/P2 are
// the same people as sim bot 0/1. Only cursor 0 takes real DOM focus; cursor 1
// is a class-only ring, since the document has exactly one focused element.

const FOCUS_CLASS = "is-nav-focus";
/** Per-player ring classes, applied alongside FOCUS_CLASS in duo mode. */
const PLAYER_FOCUS_CLASS = ["is-nav-p1", "is-nav-p2"];
const MAX_CURSORS = 2;

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[data-bot-id]",
  "[data-difficulty]",
  "select",
  "[data-toggle-key]",
  "button[data-toggle-label]",
  ".switch-btn",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** Tags that can actually take DOM focus without an explicit tabindex. */
const NATIVELY_FOCUSABLE = new Set(["BUTTON", "SELECT", "INPUT", "TEXTAREA", "A"]);

const DEADZONE = 0.5;
const REPEAT_DELAY_MS = 450;
const REPEAT_RATE_MS = 160;

const BTN_A = 0;
const BTN_B = 1;
const BTN_SELECT = 8;
const BTN_START = 9;
const DPAD = { up: 12, down: 13, left: 14, right: 15 };

const hasWindow = typeof window !== "undefined";
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Primary (Start-button) action per screen — resolved lazily, may be absent. */
const PRIMARY_BY_SCREEN = {
  title: "#btn-title-fight",
  botSelect: "#btn-fight",
  results: "#btn-rematch",
};

/** Default focus target when a screen becomes active. */
const DEFAULT_FOCUS_BY_SCREEN = {
  title: "#btn-title-fight",
  botSelect: "#bot-grid .bot-card:not(.is-disabled)",
  results: "#btn-rematch",
};

function isFocusable(el) {
  if (NATIVELY_FOCUSABLE.has(el.tagName)) return true;
  const ti = el.getAttribute("tabindex");
  return ti !== null && ti !== "-1";
}

function isVisible(el) {
  if (!el || el.hidden) return false;
  if (el.disabled) return false;
  if (el.classList?.contains("is-disabled")) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none" || style.pointerEvents === "none") return false;
  return true;
}

function centerOf(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, rect: r };
}

/**
 * @param {object} opts
 * @param {{ current(): string|null, goTo(name:string): void }} opts.screens
 * @param {(screen: string|null, player: number) => boolean} [opts.onBack] return true if handled
 * @param {(screen: string|null, player: number) => boolean} [opts.onStart] return true if handled
 * @param {(el: HTMLElement, player: number) => boolean} [opts.onActivate] return true if handled
 * @param {(count: number) => void} [opts.onPlayerCountChange] fires when the connected-pad count changes
 * @param {string[]} [opts.duoScreens] screens that give each pad its own cursor
 * @param {HTMLElement|null} [opts.modal] settings modal element
 */
export function createGamepadNav({
  screens,
  onBack,
  onStart,
  onActivate,
  onPlayerCountChange,
  duoScreens = [],
  modal = null,
} = {}) {
  const modalEl = modal || document.getElementById("settings-modal");
  const duoScreenSet = new Set(duoScreens);

  /** One tracked element per cursor; index 0 is the shared/solo cursor. */
  const cursors = /** @type {(HTMLElement|null)[]} */ (new Array(MAX_CURSORS).fill(null));
  /** @type {HTMLElement|null} */
  let modalReturnEl = null;
  let running = false;
  let rafId = 0;
  let lastScreenKey = "";
  let padCount = 0;

  // Edge/repeat state per cursor: direction repeat + face-button edges.
  const padState = Array.from({ length: MAX_CURSORS }, () => ({
    held: { dir: /** @type {string|null} */ (null), since: 0, next: 0 },
    btnPrev: { a: false, b: false, start: false, select: false },
  }));

  // ------------------------------------------------------------------ context

  function modalOpen() {
    return !!modalEl && !modalEl.hidden;
  }

  const pauseEl = document.getElementById("pause-overlay");

  /** The in-match pause menu behaves like a modal: it owns focus while open. */
  function pauseOpen() {
    return !!pauseEl && !pauseEl.hidden;
  }

  function activeScreenName() {
    return screens?.current?.() || document.body.dataset.screen || null;
  }

  /** Root element that owns focus right now (modal > pause menu > screen). */
  function root() {
    if (modalOpen()) return modalEl;
    if (pauseOpen()) return pauseEl;
    const name = activeScreenName();
    return (
      document.querySelector(`.screen.is-active`) ||
      (name ? document.querySelector(`[data-screen-name="${name}"]`) : null)
    );
  }

  /** Fresh list of focusables in DOM order for the active root. */
  function items() {
    const r = root();
    if (!r) return [];
    const found = Array.from(r.querySelectorAll(FOCUSABLE_SELECTOR));
    /** @type {HTMLElement[]} */
    const out = [];
    for (const el of found) {
      if (out.includes(el)) continue;
      if (!isFocusable(el)) continue;
      if (!isVisible(el)) continue;
      out.push(/** @type {HTMLElement} */ (el));
    }
    return out;
  }

  /** Navigation is inert during the match (game/input.js owns the pad). */
  function inert() {
    return activeScreenName() === "match" && !modalOpen() && !pauseOpen();
  }

  /** Two independent cursors: two pads, on a screen that asked for it, with
   *  nothing modal on top (a modal has one cursor no matter who opened it). */
  function duo() {
    return padCount >= 2 && duoScreenSet.has(activeScreenName()) && !modalOpen() && !pauseOpen();
  }

  /** How many cursors are live right now. */
  function cursorCount() {
    return duo() ? MAX_CURSORS : 1;
  }

  // -------------------------------------------------------------------- focus

  function clearFocusClass(player = null) {
    const classes = player === null ? [FOCUS_CLASS, ...PLAYER_FOCUS_CLASS] : [PLAYER_FOCUS_CLASS[player]];
    classes.forEach((cls) => {
      document.querySelectorAll(`.${cls}`).forEach((el) => el.classList.remove(cls));
    });
    if (player === null) return;
    // The shared ring only comes off if no other cursor is still on that node.
    document.querySelectorAll(`.${FOCUS_CLASS}`).forEach((el) => {
      if (!cursors.some((c, i) => i !== player && c === el)) el.classList.remove(FOCUS_CLASS);
    });
  }

  function paintFocus(el, player) {
    if (!el) return;
    el.classList.add(FOCUS_CLASS);
    if (duo()) el.classList.add(PLAYER_FOCUS_CLASS[player]);
  }

  function setFocus(el, { scroll = true, player = 0 } = {}) {
    clearFocusClass(player);
    cursors[player] = el || null;
    if (!el) return;
    paintFocus(el, player);
    // Only the primary cursor owns real DOM focus — there is just one
    // document.activeElement, and stealing it would break P1's keyboard.
    if (player === 0) {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus?.();
      }
    }
    if (scroll) el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  /** Re-validate the tracked element; re-seed a default if it went away. */
  function ensureFocus(player = 0) {
    const list = items();
    if (!list.length) {
      cursors[player] = null;
      clearFocusClass(player);
      return null;
    }
    const current = cursors[player];
    if (current && list.includes(current)) {
      paintFocus(current, player);
      return current;
    }
    setFocus(defaultTarget(list, player), { player });
    return cursors[player];
  }

  function defaultTarget(list, player = 0) {
    if (modalOpen()) return list[0];
    const sel = DEFAULT_FOCUS_BY_SCREEN[activeScreenName()];
    if (sel) {
      const matches = /** @type {HTMLElement[]} */ (Array.from(document.querySelectorAll(sel))).filter((el) =>
        list.includes(el)
      );
      // In duo mode start the two cursors apart so P2 does not appear to be
      // sitting on P1's card.
      if (matches.length) return matches[Math.min(player, matches.length - 1)] || matches[0];
    }
    return list[Math.min(player, list.length - 1)] || list[0];
  }

  // ------------------------------------------------------------ spatial move

  /**
   * Pick the nearest candidate in `dir` using bounding rects; this makes the
   * 4-column bot grid, the difficulty row, the button stacks and the results
   * row all behave without any hardcoded layout knowledge.
   */
  function spatialNext(dir, player = 0) {
    const list = items();
    if (!list.length) return null;
    const current = cursors[player];
    const from = current && list.includes(current) ? current : null;
    if (!from) return defaultTarget(list, player);

    const a = centerOf(from);
    const horizontal = dir === "left" || dir === "right";
    const sign = dir === "right" || dir === "down" ? 1 : -1;

    // Tier 1: candidates that overlap on the cross axis (same row / column).
    // Tier 2: anything else lying in the pressed direction, cost-weighted.
    let aligned = null;
    let alignedScore = Infinity;
    let loose = null;
    let looseScore = Infinity;

    for (const el of list) {
      if (el === from) continue;
      const b = centerOf(el);
      const primary = (horizontal ? b.x - a.x : b.y - a.y) * sign;
      const cross = horizontal ? b.y - a.y : b.x - a.x;
      // Must actually lie in the pressed direction (tolerate sub-pixel noise).
      if (primary <= 4) continue;

      const overlap = horizontal
        ? Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top)
        : Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
      const extent = horizontal
        ? Math.min(a.rect.height, b.rect.height)
        : Math.min(a.rect.width, b.rect.width);

      if (overlap > 0 && overlap >= extent * 0.25) {
        const score = primary + Math.abs(cross) * 0.05;
        if (score < alignedScore) {
          alignedScore = score;
          aligned = el;
        }
      } else {
        const score = primary + Math.abs(cross) * 2.5;
        if (score < looseScore) {
          looseScore = score;
          loose = el;
        }
      }
    }
    if (aligned) return aligned;
    if (loose) return loose;

    // Fallback: DOM order. Left/right wraps (so the end of a grid row rolls
    // into the next one); up/down clamps so the edges feel like walls.
    const i = list.indexOf(from);
    const step = dir === "right" || dir === "down" ? 1 : -1;
    if (!horizontal) return list[i + step] || from;
    return list[(i + step + list.length) % list.length];
  }

  function move(dir, player = 0) {
    if (inert()) return;
    ensureFocus(player);
    // Consoles change <select> values with left/right instead of leaving it.
    const current = cursors[player];
    if (current instanceof HTMLSelectElement && (dir === "left" || dir === "right")) {
      cycleSelect(current, dir === "right" ? 1 : -1);
      return;
    }
    const next = spatialNext(dir, player);
    if (next) setFocus(next, { player });
  }

  function cycleSelect(sel, step) {
    const n = sel.options.length;
    if (!n) return;
    sel.selectedIndex = (sel.selectedIndex + step + n) % n;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ------------------------------------------------------------------ actions

  function activate(player = 0) {
    if (inert()) return;
    const el = ensureFocus(player);
    if (!el) return;
    if (el instanceof HTMLSelectElement) {
      cycleSelect(el, 1); // no way to open a native dropdown from a pad
      return;
    }
    // Screens that care WHO pressed A (bot select) intercept here; a plain
    // .click() carries no player identity.
    if (typeof onActivate === "function" && onActivate(el, player)) return;
    el.click();
  }

  function back(player = 0) {
    if (inert()) return;
    if (modalOpen()) {
      closeModalViaButton();
      return;
    }
    const screen = activeScreenName();
    if (typeof onBack === "function" && onBack(screen, player)) return;
    if (screen === "botSelect") document.getElementById("btn-select-back")?.click();
    else if (screen === "results") document.getElementById("btn-res-title")?.click();
  }

  function closeModalViaButton() {
    const closeBtn = document.getElementById("btn-settings-close");
    if (closeBtn) closeBtn.click();
    else if (modalEl) modalEl.hidden = true;
  }

  function start(player = 0) {
    if (inert()) return;
    if (modalOpen()) {
      closeModalViaButton();
      return;
    }
    const screen = activeScreenName();
    if (typeof onStart === "function" && onStart(screen, player)) return;
    const sel = PRIMARY_BY_SCREEN[screen];
    if (!sel) return;
    const el = /** @type {HTMLButtonElement|null} */ (document.querySelector(sel));
    if (el && !el.disabled) el.click();
  }

  // ------------------------------------------------------- screen/modal watch

  /** Key that changes whenever the focus context changes. Duo-ness is part of
   *  it: plugging in a second pad re-seeds both cursors. */
  function contextKey() {
    return `${activeScreenName()}|${modalOpen() ? "modal" : "-"}|${duo() ? "duo" : "solo"}`;
  }

  function resetCursors() {
    cursors.fill(null);
    clearFocusClass();
  }

  function seedCursors() {
    for (let i = 0; i < cursorCount(); i += 1) ensureFocus(i);
  }

  function syncContext() {
    const key = contextKey();
    if (key === lastScreenKey) return;
    const wasModal = lastScreenKey.split("|")[1] === "modal";
    const isModal = modalOpen();
    lastScreenKey = key;

    if (isModal && !wasModal) {
      modalReturnEl = /** @type {HTMLElement|null} */ (document.activeElement);
      resetCursors();
      setTimeout(() => {
        resetCursors();
        seedCursors();
      }, 0);
      return;
    }
    if (!isModal && wasModal) {
      resetCursors();
      const back = modalReturnEl;
      modalReturnEl = null;
      // Modal fades out over ~220ms; restore after it is gone.
      setTimeout(() => {
        if (back && document.contains(back) && isVisible(back)) setFocus(back, { player: 0 });
        seedCursors();
      }, 0);
      return;
    }
    // Plain screen (or solo/duo) change: seed each cursor's default focus.
    resetCursors();
    setTimeout(() => seedCursors(), 0);
  }

  const observer = hasWindow ? new MutationObserver(() => syncContext()) : null;

  // -------------------------------------------------------------- pad polling

  function readDirection(pad) {
    const ax = pad.axes || [];
    let x = typeof ax[0] === "number" ? ax[0] : 0;
    let y = typeof ax[1] === "number" ? ax[1] : 0;
    const btn = (i) => Boolean(pad.buttons?.[i]?.pressed) || (pad.buttons?.[i]?.value || 0) > 0.5;

    if (btn(DPAD.up)) y = -1;
    if (btn(DPAD.down)) y = 1;
    if (btn(DPAD.left)) x = -1;
    if (btn(DPAD.right)) x = 1;

    // Hat-switch fallback (axes[9]) for pads without a standard mapping.
    if (Math.abs(x) < DEADZONE && Math.abs(y) < DEADZONE && typeof ax[9] === "number" && ax[9] <= 1.01) {
      const h = ax[9];
      if (h > -1.5 && h < 1.01) {
        const deg = ((h + 1) * 180) % 360;
        if (deg > 337.5 || deg <= 22.5) y = -1;
        else if (deg > 22.5 && deg <= 67.5) { y = -1; x = 1; }
        else if (deg > 67.5 && deg <= 112.5) x = 1;
        else if (deg > 112.5 && deg <= 157.5) { y = 1; x = 1; }
        else if (deg > 157.5 && deg <= 202.5) y = 1;
        else if (deg > 202.5 && deg <= 247.5) { y = 1; x = -1; }
        else if (deg > 247.5 && deg <= 292.5) x = -1;
        else { y = -1; x = -1; }
      }
    }

    const ax0 = Math.abs(x);
    const ay0 = Math.abs(y);
    if (ax0 < DEADZONE && ay0 < DEADZONE) return null;
    if (ax0 >= ay0) return x > 0 ? "right" : "left";
    return y > 0 ? "down" : "up";
  }

  function pads() {
    if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
    return Array.from(navigator.getGamepads() || []).filter(Boolean);
  }

  /** Collapse a set of pads into one virtual controller. */
  function readPads(list) {
    let dir = null;
    let a = false;
    let b = false;
    let st = false;
    let se = false;
    for (const pad of list) {
      dir = dir || readDirection(pad);
      const down = (i) => Boolean(pad.buttons?.[i]?.pressed) || (pad.buttons?.[i]?.value || 0) > 0.5;
      a = a || down(BTN_A);
      b = b || down(BTN_B);
      st = st || down(BTN_START);
      se = se || down(BTN_SELECT);
    }
    return { dir, a, b, st, se };
  }

  /** Apply one virtual controller's frame to one cursor. */
  function applyPad(player, { dir, a, b, st, se }) {
    const state = padState[player];
    const { held, btnPrev } = state;
    const t = now();
    if (!dir) {
      held.dir = null;
    } else if (held.dir !== dir) {
      held.dir = dir;
      held.since = t;
      held.next = t + REPEAT_DELAY_MS;
      if (!inert()) move(dir, player);
    } else if (t >= held.next) {
      held.next = t + REPEAT_RATE_MS;
      if (!inert()) move(dir, player);
    }

    if (!inert()) {
      if (a && !btnPrev.a) activate(player);
      if (b && !btnPrev.b) back(player);
      if (se && !btnPrev.select) back(player);
      if (st && !btnPrev.start) start(player);
    }
    btnPrev.a = a;
    btnPrev.b = b;
    btnPrev.start = st;
    btnPrev.select = se;
  }

  function clearPadState(player) {
    padState[player].held.dir = null;
    const p = padState[player].btnPrev;
    p.a = p.b = p.start = p.select = false;
  }

  function poll() {
    rafId = requestAnimationFrame(poll);

    const list = pads();
    if (list.length !== padCount) {
      padCount = list.length;
      onPlayerCountChange?.(padCount);
    }
    // Runs after the pad count is known so a plug/unplug re-seeds cursors.
    syncContext();

    if (!list.length) {
      for (let i = 0; i < MAX_CURSORS; i += 1) clearPadState(i);
      return;
    }

    if (!duo()) {
      // Solo: merge every connected pad, so either controller drives the menu.
      applyPad(0, readPads(list));
      clearPadState(1);
      return;
    }
    // Duo: pad slot i drives cursor i, independently. Slot order is the dense
    // getGamepads() order, matching game/input.js's gamepadIndex.
    for (let i = 0; i < MAX_CURSORS; i += 1) applyPad(i, readPads(list.slice(i, i + 1)));
  }

  // ----------------------------------------------------------------- keyboard

  const KEY_DIRS = {
    ArrowUp: "up",
    ArrowDown: "down",
    ArrowLeft: "left",
    ArrowRight: "right",
    KeyW: "up",
    KeyS: "down",
    KeyA: "left",
    KeyD: "right",
  };

  function onKeyDown(ev) {
    if (inert()) return;
    if (ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const target = ev.target;
    // Never hijack real text entry.
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;

    const dir = KEY_DIRS[ev.code];
    if (dir) {
      // A focused <select> would natively change value on up/down — we own it.
      ev.preventDefault();
      move(dir);
      return;
    }
    if (ev.code === "Escape" || ev.code === "Backspace") {
      // ui.js already closes the modal on Escape; only handle the rest here so
      // we do not double-fire.
      if (modalOpen() && ev.code === "Escape") return;
      ev.preventDefault();
      back();
      return;
    }
    if (ev.code === "Enter" || ev.code === "NumpadEnter" || ev.code === "Space") {
      // Buttons activate natively when focused; only step in when focus was
      // lost (e.g. right after a screen change) or the target is a <select>.
      const el = cursors[0];
      if (el instanceof HTMLSelectElement) return; // native dropdown
      // In duo mode a raw click carries no player identity, so route keyboard
      // activation through activate() (as player 1) instead of the native path.
      if (!duo() && document.activeElement === el) return; // native click will fire
      ev.preventDefault();
      activate();
    }
  }

  /** Keep the visual ring in sync when the user clicks/tabs with mouse+kb. */
  function onFocusIn(ev) {
    const el = ev.target;
    if (!(el instanceof HTMLElement)) return;
    if (el === cursors[0]) return;
    if (!items().includes(el)) return;
    clearFocusClass(0);
    cursors[0] = el;
    paintFocus(el, 0);
  }

  function onPointerDown(ev) {
    // A mouse click should move the "cursor" too, so pad input resumes there.
    // Mouse and keyboard always act as player 1.
    const el = ev.target instanceof Element ? ev.target.closest(FOCUSABLE_SELECTOR) : null;
    if (el instanceof HTMLElement && items().includes(el)) {
      clearFocusClass(0);
      cursors[0] = el;
    }
  }

  function onGamepadChange() {
    padCount = pads().length;
    onPlayerCountChange?.(padCount);
    syncContext();
    seedCursors();
  }

  // ------------------------------------------------------------------ control

  function startNav() {
    if (running || !hasWindow) return;
    running = true;
    lastScreenKey = "";
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("gamepadconnected", onGamepadChange);
    window.addEventListener("gamepaddisconnected", onGamepadChange);
    observer?.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-screen", "hidden", "class"],
      subtree: true,
    });
    padCount = pads().length;
    onPlayerCountChange?.(padCount);
    syncContext();
    seedCursors();
    rafId = requestAnimationFrame(poll);
  }

  function stopNav() {
    if (!running) return;
    running = false;
    cancelAnimationFrame(rafId);
    rafId = 0;
    window.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    window.removeEventListener("gamepadconnected", onGamepadChange);
    window.removeEventListener("gamepaddisconnected", onGamepadChange);
    observer?.disconnect();
  }

  function dispose() {
    stopNav();
    clearFocusClass();
    cursors.fill(null);
  }

  return {
    start: startNav,
    stop: stopNav,
    dispose,
    // --- debug / test surface (also used by tooling; harmless in production)
    move,
    activate,
    back,
    startAction: start,
    refresh: ensureFocus,
    items,
    screens,
    focused: (player = 0) => cursors[player],
    padCount: () => padCount,
    isDuo: duo,
    isInert: inert,
  };
}
