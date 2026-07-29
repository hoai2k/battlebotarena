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

const FOCUS_CLASS = "is-nav-focus";

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
 * @param {(screen: string|null) => boolean} [opts.onBack] return true if handled
 * @param {(screen: string|null) => boolean} [opts.onStart] return true if handled
 * @param {HTMLElement|null} [opts.modal] settings modal element
 */
export function createGamepadNav({ screens, onBack, onStart, modal = null } = {}) {
  const modalEl = modal || document.getElementById("settings-modal");

  /** @type {HTMLElement|null} */
  let currentEl = null;
  /** @type {HTMLElement|null} */
  let modalReturnEl = null;
  let running = false;
  let rafId = 0;
  let lastScreenKey = "";

  // Edge/repeat state for one virtual "direction" + face buttons.
  const held = { dir: /** @type {string|null} */ (null), since: 0, next: 0 };
  const btnPrev = { a: false, b: false, start: false, select: false };

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

  // -------------------------------------------------------------------- focus

  function clearFocusClass() {
    document.querySelectorAll(`.${FOCUS_CLASS}`).forEach((el) => el.classList.remove(FOCUS_CLASS));
  }

  function setFocus(el, { scroll = true } = {}) {
    clearFocusClass();
    currentEl = el || null;
    if (!el) return;
    el.classList.add(FOCUS_CLASS);
    try {
      el.focus({ preventScroll: true });
    } catch {
      el.focus?.();
    }
    if (scroll) el.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }

  /** Re-validate the tracked element; re-seed a default if it went away. */
  function ensureFocus() {
    const list = items();
    if (!list.length) {
      currentEl = null;
      clearFocusClass();
      return null;
    }
    if (currentEl && list.includes(currentEl)) {
      if (!currentEl.classList.contains(FOCUS_CLASS)) currentEl.classList.add(FOCUS_CLASS);
      return currentEl;
    }
    setFocus(defaultTarget(list));
    return currentEl;
  }

  function defaultTarget(list) {
    if (modalOpen()) return list[0];
    const sel = DEFAULT_FOCUS_BY_SCREEN[activeScreenName()];
    if (sel) {
      const el = /** @type {HTMLElement|null} */ (document.querySelector(sel));
      if (el && list.includes(el)) return el;
    }
    return list[0];
  }

  // ------------------------------------------------------------ spatial move

  /**
   * Pick the nearest candidate in `dir` using bounding rects; this makes the
   * 4-column bot grid, the difficulty row, the button stacks and the results
   * row all behave without any hardcoded layout knowledge.
   */
  function spatialNext(dir) {
    const list = items();
    if (!list.length) return null;
    const from = currentEl && list.includes(currentEl) ? currentEl : null;
    if (!from) return defaultTarget(list);

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

  function move(dir) {
    if (inert()) return;
    ensureFocus();
    // Consoles change <select> values with left/right instead of leaving it.
    if (currentEl instanceof HTMLSelectElement && (dir === "left" || dir === "right")) {
      cycleSelect(currentEl, dir === "right" ? 1 : -1);
      return;
    }
    const next = spatialNext(dir);
    if (next) setFocus(next);
  }

  function cycleSelect(sel, step) {
    const n = sel.options.length;
    if (!n) return;
    sel.selectedIndex = (sel.selectedIndex + step + n) % n;
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ------------------------------------------------------------------ actions

  function activate() {
    if (inert()) return;
    const el = ensureFocus();
    if (!el) return;
    if (el instanceof HTMLSelectElement) {
      cycleSelect(el, 1); // no way to open a native dropdown from a pad
      return;
    }
    el.click();
  }

  function back() {
    if (inert()) return;
    if (modalOpen()) {
      closeModalViaButton();
      return;
    }
    const screen = activeScreenName();
    if (typeof onBack === "function" && onBack(screen)) return;
    if (screen === "botSelect") document.getElementById("btn-select-back")?.click();
    else if (screen === "results") document.getElementById("btn-res-title")?.click();
  }

  function closeModalViaButton() {
    const closeBtn = document.getElementById("btn-settings-close");
    if (closeBtn) closeBtn.click();
    else if (modalEl) modalEl.hidden = true;
  }

  function start() {
    if (inert()) return;
    if (modalOpen()) {
      closeModalViaButton();
      return;
    }
    const screen = activeScreenName();
    if (typeof onStart === "function" && onStart(screen)) return;
    const sel = PRIMARY_BY_SCREEN[screen];
    if (!sel) return;
    const el = /** @type {HTMLButtonElement|null} */ (document.querySelector(sel));
    if (el && !el.disabled) el.click();
  }

  // ------------------------------------------------------- screen/modal watch

  /** Key that changes whenever the focus context changes. */
  function contextKey() {
    return `${activeScreenName()}|${modalOpen() ? "modal" : "-"}`;
  }

  function syncContext() {
    const key = contextKey();
    if (key === lastScreenKey) return;
    const wasModal = lastScreenKey.endsWith("modal");
    const isModal = modalOpen();
    lastScreenKey = key;

    if (isModal && !wasModal) {
      modalReturnEl = /** @type {HTMLElement|null} */ (document.activeElement);
      currentEl = null;
      setTimeout(() => {
        currentEl = null;
        ensureFocus();
      }, 0);
      return;
    }
    if (!isModal && wasModal) {
      currentEl = null;
      clearFocusClass();
      const back = modalReturnEl;
      modalReturnEl = null;
      // Modal fades out over ~220ms; restore after it is gone.
      setTimeout(() => {
        if (back && document.contains(back) && isVisible(back)) setFocus(back);
        else ensureFocus();
      }, 0);
      return;
    }
    // Plain screen change: seed the screen's default focus.
    currentEl = null;
    clearFocusClass();
    setTimeout(() => ensureFocus(), 0);
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

  function poll() {
    rafId = requestAnimationFrame(poll);
    syncContext();

    const list = pads();
    if (!list.length) {
      held.dir = null;
      btnPrev.a = btnPrev.b = btnPrev.start = btnPrev.select = false;
      return;
    }

    // Merge all connected pads so either controller can drive the menus.
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

    const t = now();
    if (!dir) {
      held.dir = null;
    } else if (held.dir !== dir) {
      held.dir = dir;
      held.since = t;
      held.next = t + REPEAT_DELAY_MS;
      if (!inert()) move(dir);
    } else if (t >= held.next) {
      held.next = t + REPEAT_RATE_MS;
      if (!inert()) move(dir);
    }

    if (inert()) {
      btnPrev.a = a;
      btnPrev.b = b;
      btnPrev.start = st;
      btnPrev.select = se;
      return;
    }

    if (a && !btnPrev.a) activate();
    if (b && !btnPrev.b) back();
    if (se && !btnPrev.select) back();
    if (st && !btnPrev.start) start();
    btnPrev.a = a;
    btnPrev.b = b;
    btnPrev.start = st;
    btnPrev.select = se;
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
      const el = currentEl;
      if (el instanceof HTMLSelectElement) return; // native dropdown
      if (document.activeElement === el) return; // native click will fire
      ev.preventDefault();
      activate();
    }
  }

  /** Keep the visual ring in sync when the user clicks/tabs with mouse+kb. */
  function onFocusIn(ev) {
    const el = ev.target;
    if (!(el instanceof HTMLElement)) return;
    if (el === currentEl) return;
    if (!items().includes(el)) return;
    clearFocusClass();
    currentEl = el;
    el.classList.add(FOCUS_CLASS);
  }

  function onPointerDown(ev) {
    // A mouse click should move the "cursor" too, so pad input resumes there.
    const el = ev.target instanceof Element ? ev.target.closest(FOCUSABLE_SELECTOR) : null;
    if (el instanceof HTMLElement && items().includes(el)) {
      clearFocusClass();
      currentEl = el;
    }
  }

  function onGamepadConnected() {
    ensureFocus();
  }

  // ------------------------------------------------------------------ control

  function startNav() {
    if (running || !hasWindow) return;
    running = true;
    lastScreenKey = "";
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("gamepadconnected", onGamepadConnected);
    observer?.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-screen", "hidden", "class"],
      subtree: true,
    });
    syncContext();
    ensureFocus();
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
    window.removeEventListener("gamepadconnected", onGamepadConnected);
    observer?.disconnect();
  }

  function dispose() {
    stopNav();
    clearFocusClass();
    currentEl = null;
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
    focused: () => currentEl,
    isInert: inert,
  };
}
