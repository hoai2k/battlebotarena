// v2 background music: subscribes to EV.MATCH and drives the shared music
// player. Countdown track for the 3-2-1, battle track once fighting starts,
// fade out at KO / time-up so the results screen lands in silence.

import { EV } from "../shared/events.js";
import { settings, onSettingChanged } from "../shared/settings.js";
import { createMusicPlayer } from "../shared/musicPlayer.js";

export function createMusic(bus) {
  const player = createMusicPlayer({
    basePath: "./public/music/",
    volume: 0.5,
    isEnabled: () => settings.soundEnabled,
  });

  let phase = "idle";

  const unsubscribe = bus.on(EV.MATCH, (event) => {
    if (!event?.phase || event.phase === phase) return;
    phase = event.phase;
    if (phase === "countdown") player.play("countdown", { loop: false, fadeIn: 0.2 });
    else if (phase === "fight") player.play("battle", { loop: true, fadeIn: 0.5 });
    else if (phase === "ko" || phase === "timeUp") player.stop({ fadeOut: 1.6 });
    else if (phase === "results" || phase === "idle") player.stop({ fadeOut: 0.5 });
  });

  const unwatch = onSettingChanged("soundEnabled", (enabled) => {
    player.setEnabled(enabled);
    // Re-enter the current cue so toggling sound on mid-match is not silent
    // until the next phase change.
    if (enabled && phase === "fight") player.play("battle", { loop: true });
    else if (enabled && phase === "countdown") player.play("countdown", { loop: false });
  });

  return {
    player,
    dispose() {
      unsubscribe?.();
      unwatch?.();
      player.stop({ fadeOut: 0.2 });
    },
  };
}
