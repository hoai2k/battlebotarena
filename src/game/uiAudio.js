// Menu and HUD sound: the clicks, the lock-in thunk, the slam into a fight.
//
// This listens to the DOM at the document level rather than being called from
// ui/*, and that is deliberate. The UI layer owns screens and DOM; wiring a
// play() call into every button would put audio decisions in twenty places and
// mean UI code importing game code for something that is not gameplay. One
// delegated listener per interaction kind reads the same intent off the events
// the UI already fires — and a button added later makes a sound for free.
//
// Everything routes through playUiSound, so the sample bank switch and the
// sound toggle both govern it without this file knowing about either.

import { playUiSound } from "./audio.js";

/** Buttons whose sound is not the generic confirm. Keyed by element id. */
const BY_ID = {
  "btn-title-fight": "ui/confirm",
  "btn-fight": "ui/fight_button",
  "btn-select-back": "ui/back",
  "btn-settings-close": "ui/back",
  "btn-pause-exit": "ui/back",
  "btn-res-title": "ui/back",
  "btn-rematch": "ui/confirm",
  "btn-change": "ui/back",
};

const isInteractive = (el) => el instanceof Element
  && Boolean(el.closest("button, select, .bot-card, [data-nav]"));

/**
 * Wire menu audio. Returns a teardown for symmetry with the rest of the app —
 * the listeners are app-lifetime in practice.
 */
export function createUiAudio() {
  /** @type {Element | null} */
  let lastFocus = null;

  const onClick = (ev) => {
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target) return;

    const card = target.closest(".bot-card");
    if (card) {
      // A disabled card is a press that does nothing, and silence is how that
      // reads as broken rather than as refused.
      if (card.classList.contains("is-disabled")) playUiSound("ui/error", 0.8);
      else playUiSound("ui/bot_lock");
      return;
    }

    const button = target.closest("button");
    if (!button || button.disabled) return;
    if (button.classList.contains("switch-btn") || button.classList.contains("btn-toggle")) {
      playUiSound("ui/toggle");
      return;
    }
    playUiSound(BY_ID[button.id] || "ui/confirm");
  };

  // Focus moves for pad and keyboard navigation. Mouse hover over a bot card
  // gets the lighter blip instead: hovering is browsing, not choosing.
  const onFocusIn = (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    if (!isInteractive(el) || el === lastFocus) return;
    lastFocus = el;
    playUiSound(el.closest(".bot-card") ? "ui/bot_hover" : "ui/nav_move", 0.7);
  };

  const onPointerOver = (ev) => {
    const card = ev.target instanceof Element ? ev.target.closest(".bot-card") : null;
    if (!card || card === lastFocus) return;
    lastFocus = card;
    playUiSound("ui/bot_hover", 0.55);
  };

  const onPadConnect = () => playUiSound("ui/pad_connect");

  document.addEventListener("click", onClick, true);
  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("pointerover", onPointerOver, true);
  window.addEventListener("gamepadconnected", onPadConnect);

  return {
    /** The models are in and the match is about to start. */
    matchReady: () => playUiSound("ui/loading_done"),
    dispose() {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("pointerover", onPointerOver, true);
      window.removeEventListener("gamepadconnected", onPadConnect);
    },
  };
}
