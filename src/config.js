// ============================================================================
// BattleBot Arena — hand-editable game config.
//
// THE KNOBS YOU ARE MEANT TO TURN. Everything in here is a matter of TASTE:
// how loud, how long, how snappy. Change a number, reload the page, hear or
// see the difference. No build step, no rebuild of anything.
//
// WHAT IS DELIBERATELY NOT IN HERE, and why. This file is not a dumping ground
// for every constant in the game. A number belongs here only if a person could
// reasonably want it different and would know they got it wrong by playing.
// Numbers that were MEASURED stay where they were measured, next to the comment
// explaining the measurement:
//
//   sim/vehicleTuning.js, sim/weaponTuning.js  physics that was tuned against
//                                              real behaviour; a "nicer" number
//                                              here is a bot that drives wrong
//   sim/arenaSpec.js                           the box the fight happens in,
//                                              incl. the floor slab depth that
//                                              stops bots falling through it
//   assets/catalog.js                          per-bot rig geometry, measured
//                                              through tools/rig-inspect.mjs
//   engine/previewStage.js START_YAW/PITCH     BAKED INTO THE POSTER IMAGES.
//                                              Changing it means re-running
//                                              tools/posters.mjs or the picture
//                                              and the model no longer line up.
//
// This module imports nothing and is imported by everyone (ui, game, engine,
// tools). Keep it that way: it is a leaf, so it can never introduce a cycle.
// ============================================================================

export const CONFIG = {
  // -------------------------------------------------------------------- music
  // Levels are 0..1. The cue levels are FRACTIONS OF `masterVolume`, not
  // absolute — so raising the master lifts the whole score and keeps the mix.
  music: {
    /** Peak level for the loudest cue (the fight). Everything else is under it. */
    masterVolume: 0.5,

    /** Each cue's share of the master. 1 = as loud as the master allows. */
    cueVolume: {
      // The menu anthem is BEHIND something — a screen you are reading and
      // clicking around — rather than the thing you are doing, so it sits
      // where a paused game sits (see `pauseDuck` below; they are the same
      // level on purpose and both come from this file so they cannot drift).
      menu: 0.25,
      countdown: 1,
      battle: 1,
    },

    /** How far music drops while the game is paused, as a fraction of peak. */
    pauseDuck: 0.25,

    /** Seconds. Crossfade shape when a cue starts, and when the duck moves. */
    fade: {
      menuIn: 0.8,       // arriving at the title / bot select
      countdownIn: 0.2,  // 3-2-1 — short, it has three seconds to exist
      battleIn: 0.5,
      koOut: 1.6,        // the fight ending; long enough to feel like an ending
      screenOut: 0.6,    // leaving a menu screen
      pauseDuckSeconds: 0.3,
    },
  },

  // -------------------------------------------------------------------- audio
  audio: {
    /** Master level for the procedural sound effects, 0..1. Independent of
     *  `music.masterVolume` — this is the lever for "the clangs are drowning
     *  out the soundtrack" (or the other way round). The sound ON/OFF toggle in
     *  the game is separate and still wins: off is off. */
    sfxVolume: 1,
  },

  // -------------------------------------------------------------------- match
  match: {
    /** Length of a round, in seconds. Read by BOTH the sim clock and the HUD
     *  countdown — they used to hold their own copies of this number, which is
     *  a HUD that lies the moment one of them changes. */
    matchSeconds: 180,

    /** The 3-2-1 before the fight. */
    countdownSeconds: 3,

    /** Seconds the KO / time-up callout holds before the results screen. */
    resultsDelaySeconds: 3,

    /** Seconds remaining when the arena's kill saws come up. */
    killSawSecondsLeft: 60,
  },

  // --------------------------------------------------------------- bot select
  botSelect: {
    /** ms a browsed bot must sit under the cursor before its real model starts
     *  loading. This is what buys "run the cursor across the roster with no lag
     *  at all": below it you get the baked poster and nothing is downloaded.
     *  Raise it if scrubbing still stutters; lower it if the real model feels
     *  slow to arrive when you settle. */
    posterDwellMs: 700,

    /** Loaded models kept per pod, most-recently-used first, so going back to a
     *  bot you already looked at is instant. Each entry is a parsed 10-17MB GLB
     *  sitting in GPU memory, so this trades memory for that. */
    modelCache: 4,

    /** The claim flourish: one full turn of the turntable when a bot is picked,
     *  landing back exactly where it started. */
    claimSpinSeconds: 0.85,
    /** x the plinth ring's resting glow at the peak of that turn. */
    claimRingFlash: 3.4,

    /** The turntable's idle drift: seconds of no camera input before it resumes,
     *  and how fast it goes round (rad/s). Set the speed to 0 to hold still. */
    idleSpinAfterSeconds: 2.5,
    idleSpinSpeed: 0.22,
  },
};

export default CONFIG;
