// v2 background music. Two things drive it, and they own different stretches of
// the game so they never fight over the player:
//
//   THE SCREEN drives the menus. Title and bot select play the anthem, quietly
//   — it is behind a screen you are reading and clicking around, not the thing
//   you are doing, so the "menu" cue gets a lower share of the master level
//   than the fight does. Every level and fade time here comes from
//   config.js (CONFIG.music) — tune it there, not in this file.
//
//   EV.MATCH drives the fight. Countdown track for the 3-2-1, battle track once
//   fighting starts, silence at KO / time-up so the results screen lands in it.
//
// The match SCREEN is deliberately not in the screen list: the menu cue keeps
// playing across the switch and through the model load, which is several
// seconds of nothing else happening, and the countdown cue takes over from it
// with a crossfade when the match is actually ready.

import { EV } from "../shared/events.js";
import { settings, onSettingChanged } from "../shared/settings.js";
import { createMusicPlayer } from "../shared/musicPlayer.js";
import { CONFIG } from "../config.js";

const { fade } = CONFIG.music;

/** Screens the menu cue belongs under. Results is not one of them — the round
 *  ends in silence and that is the point of it. */
const MENU_SCREENS = new Set(["title", "botSelect"]);

export function createMusic(bus) {
  const player = createMusicPlayer({
    basePath: "./public/music/",
    volume: CONFIG.music.masterVolume,
    isEnabled: () => settings.soundEnabled,
  });

  let phase = "idle";

  const unsubscribe = bus.on(EV.MATCH, (event) => {
    if (!event?.phase || event.phase === phase) return;
    phase = event.phase;
    if (phase === "countdown") player.play("countdown", { loop: false, fadeIn: fade.countdownIn });
    else if (phase === "fight") player.play("battle", { loop: true, fadeIn: fade.battleIn });
    else if (phase === "ko" || phase === "timeUp") player.stop({ fadeOut: fade.koOut });
    else if (phase === "results" || phase === "idle") player.stop({ fadeOut: 0.5 });
  });

  // The active screen is published on <body data-screen>, which ui/screens.js
  // sets on every transition — the same signal engine/botPreview.js watches to
  // know when to draw. Observing it keeps this module out of the UI's business:
  // it needs to know WHICH screen, not how anyone got there.
  const screenName = () => document.body.dataset.screen || null;
  // Starts null, NOT at the current screen. The title screen is already up when
  // this module is built, so seeding it here made the first syncScreen() a
  // no-op and the anthem never started at all — the one screen the menu cue
  // most obviously belongs under was the one it could never reach.
  let screen = null;

  function syncScreen() {
    const next = screenName();
    if (next === screen) return;
    screen = next;
    if (MENU_SCREENS.has(next)) player.play("menu", { loop: true, fadeIn: fade.menuIn });
    else if (next === "results") player.stop({ fadeOut: fade.screenOut });
    // "match" is left alone; the phase handler above owns it from here.
  }

  const observer = typeof MutationObserver === "function"
    ? new MutationObserver(syncScreen)
    : null;
  observer?.observe(document.body, { attributes: true, attributeFilter: ["data-screen"] });
  syncScreen();

  const unwatch = onSettingChanged("soundEnabled", (enabled) => {
    player.setEnabled(enabled);
    // Re-enter the current cue so toggling sound on is not silence until the
    // next thing happens. Turning it on ON the title screen is also the first
    // gesture the page has had, which is what lets the anthem start at all —
    // autoplay is blocked before one.
    if (!enabled) return;
    if (phase === "fight") player.play("battle", { loop: true });
    else if (phase === "countdown") player.play("countdown", { loop: false });
    else if (MENU_SCREENS.has(screen)) player.play("menu", { loop: true, fadeIn: 0.4 });
  });

  return {
    player,
    dispose() {
      unsubscribe?.();
      unwatch?.();
      observer?.disconnect();
      player.stop({ fadeOut: 0.2 });
    },
  };
}
