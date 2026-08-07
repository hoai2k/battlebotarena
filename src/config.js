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
  // ---------------------------------------------------------------------- mix
  // THE BALANCE BETWEEN THE SOUNDTRACK AND THE FIGHT. One place, because the
  // question a person actually has is never "how loud is the music" — it is
  // "how loud is the music COMPARED TO the hits", and answering that from two
  // numbers in two sections is how a mix drifts.
  //
  // Everything is 0..1 and everything below is a fraction of `master`, so
  // raising the master lifts the whole game and keeps the balance intact.
  // The sound ON/OFF toggle is a separate, harder gate: off is off.
  mix: {
    /** Everything the game plays sits under this. */
    master: 1,

    /** The fight: impacts, weapons, motors, hazards. Louder than the score
     *  because it is the thing you are DOING — the score is what it happens
     *  over. This is the number to drop if the clangs are burying the music. */
    sfx: 1,

    /** The soundtrack, as a share of the master. Half the level of the fight:
     *  a spinner hit has to be able to land ON something. */
    music: 0.5,

    /** The crowd bed. Deliberately quiet — it is the room the fight is in, not
     *  a participant, and it is the first thing that sounds fake when it is up
     *  too loud. Its own knob because it is the layer people most often want
     *  gone without touching anything else. */
    crowd: 0.35,

    /** Announcer callouts, over the top of both. Slightly hot on purpose:
     *  a callout that loses to a spinner is a callout nobody hears. */
    announcer: 0.9,

    /** Menu and HUD clicks. Under everything — UI that competes with the game
     *  is UI that gets turned off. */
    ui: 0.5,
  },

  // -------------------------------------------------------------------- music
  // Levels are 0..1. The cue levels are FRACTIONS OF `masterVolume`, not
  // absolute — so raising the master lifts the whole score and keeps the mix.
  music: {
    /** Peak level for the loudest cue (the fight). Derived from `mix` above so
     *  the music/SFX balance has exactly one home; override it here only if you
     *  want the score off the shared master entirely. */
    get masterVolume() {
      return CONFIG.mix.master * CONFIG.mix.music;
    },

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
    /** Master level for the sound effects, 0..1. Comes from `mix` above, which
     *  is where the SFX-vs-music balance is set. */
    get sfxVolume() {
      return CONFIG.mix.master * CONFIG.mix.sfx;
    },

    /** Crowd bed level, and the announcer's, on the same footing. */
    get crowdVolume() {
      return CONFIG.mix.master * CONFIG.mix.crowd;
    },
    get announcerVolume() {
      return CONFIG.mix.master * CONFIG.mix.announcer;
    },
    get uiVolume() {
      return CONFIG.mix.master * CONFIG.mix.ui;
    },

    /** Play the recorded sample bank (public/sfx) where one exists, instead of
     *  synthesising the sound. This is the DEFAULT for the build; the in-game
     *  "Sampled audio" switch is what a player flips, and it overrides this.
     *  With no bank generated, or a sample still downloading, the synthesised
     *  soundscape plays regardless — samples are a layer over it, never a
     *  dependency of it. */
    useSamples: true,

    /** How far a sampled one-shot may be pitched either side of unity, to keep
     *  a burst of the same impact from sounding like a copy-paste. 0 disables
     *  it. Above ~0.12 heavy impacts start to sound like a different, smaller
     *  object rather than the same one hit again. */
    samplePitchJitter: 0.08,

    /** Announcer voice lines (public/sfx/vo). OFF: the takes in the repo came
     *  out of a text-to-SOUND model, not a speech model, so they approximate a
     *  shouted callout rather than saying the word. Turn this on once real
     *  takes replace them — see public/sfx/vo/README.md. */
    announcerVoice: false,
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
