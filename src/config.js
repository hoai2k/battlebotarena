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
    sfx: 0.6,

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

    /** How the crowd decides whether a thing is worth reacting to.
     *
     *  They react to ESCALATION, not to events: the first big hit is enormous,
     *  the fourth identical one barely registers, and what earns the fifth is
     *  being WORSE than the fourth. Raise `escalation` and only a real step up
     *  gets a full-blooded roar; lower it and they are easily impressed.
     *
     *  The tell that these are wrong: a long exchange at one level either
     *  sounds like a stuck sample (too generous) or like an empty room (too
     *  mean). It should sound like people getting hoarse. */
    crowd: {
      /** Seconds. Nothing gets a second reaction inside this, however good. */
      minGapSeconds: 1.2,
      /** Seconds a repeat at the SAME level has to wait for its smaller cheer. */
      steadyGapSeconds: 2.6,
      /** How much more extreme (0..1) a hit must be to cut in immediately. */
      escalation: 0.12,
      /** Seconds over which the last reaction's bar decays back to nothing —
       *  i.e. how long a hit stays the thing to beat. Only governs what is
       *  now BENEATH them; a repeat at the same level is judged against the
       *  bar as set, so a steady beating never drifts into counting as
       *  escalation just because time passed. */
      memorySeconds: 14,
      /** Below this share of the current bar, a repeat is beneath them. */
      repeatFloorRatio: 0.6,
      /** Quietest a fatigued repeat gets, as a share of full. Never 0: a crowd
       *  going completely silent mid-fight reads as a bug. */
      repeatGainFloor: 0.45,
      /** How much each reaction dulls the next, and how fast that wears off. */
      fatigueStep: 0.22,
      fatigueRecoverySeconds: 9,
      /** An escalation plays at full voice whatever the fatigue, and adds only
       *  this share of it — being shown something genuinely bigger cuts
       *  through a hoarse crowd, and costs them less than a repeat. */
      escalationFatigueShare: 0.35,
    },

    /** Announcer voice lines (public/sfx/vo). OFF: the takes in the repo came
     *  out of a text-to-SOUND model, not a speech model, so they approximate a
     *  shouted callout rather than saying the word. Turn this on once real
     *  takes replace them — see public/sfx/vo/README.md. */
    announcerVoice: false,
  },

  // --------------------------------------------------------------------- text
  // EVERY WORD THE GAME SAYS. Change one here and it changes on screen; there
  // is no build step and nothing to keep in sync.
  //
  // The markup still contains the default copy, because a screen that renders
  // blank when a key is missing is worse than one showing the old wording —
  // anything with a `data-text-key` gets overwritten from here at start-up, and
  // falls back to what is in the HTML if the key does not exist.
  //
  // `{braces}` are substitutions filled in by the game. Keep them, move them,
  // or drop them; text with no braces just loses the number.
  //
  // NOT here: the roster copy in `ui/botCards.js` — bot names, taglines and
  // weapon labels. That is 28 machines' worth of description sitting next to
  // the stat bars and accent colours it belongs with, and splitting a bot's
  // name from its card is how the two drift apart. Edit it there.
  text: {
    documentTitle: "BattleBot Arena",

    /** The very first overlay, before any module has loaded. */
    boot: {
      title: "BATTLEBOT ARENA",
      detail: "Warming up the pit…",
    },

    /** The progress overlay: bot models are 10-17MB each, so it is on screen
     *  for real time and the wording is read. */
    loading: {
      title: "LOADING",
      bots: "Loading Bots",
      arena: "Preparing Arena",
      buildingArena: "Building the arena",
      startingPhysics: "Starting physics",
      calibratingChassis: "Calibrating chassis",
      /** Between the two machines on the loading screen. */
      versus: " vs ",
    },

    title: {
      kicker: "ROBOT COMBAT LEAGUE",
      logoMain: "BATTLEBOT",
      logoSub: "ARENA",
      tagline: "3 MINUTES · 2 MACHINES · 1 LEFT STANDING",
      play: "ENTER THE ARENA",
      settings: "SETTINGS",
      soundOn: "SOUND: ON",
      soundOff: "SOUND: OFF",
      controls: "W/S DRIVE · A/D TURN · SPACE WEAPON · GAMEPAD READY",
    },

    select: {
      stepPlayer: "STEP 1 — CHOOSE YOUR BOT",
      stepOpponent: "STEP 2 — CHOOSE THE OPPONENT",
      /** Shown instead of the steps when people bring their own controllers. */
      duoPair: "TWO CONTROLLERS — EACH PLAYER PICKS THEIR OWN BOT",
      duoMany: "{count} CONTROLLERS — EVERY PLAYER PICKS THEIR OWN BOT",
      aiLevel: "AI LEVEL",
      easy: "EASY",
      normal: "NORMAL",
      hard: "HARD",
      emptyPlayer: "PICK<br />YOUR BOT",
      emptyOpponent: "PICK THE<br />OPPONENT",
      emptyP3: "P3 — PRESS A<br />TO PICK",
      emptyP4: "P4 — PRESS A<br />TO PICK",
      openBay: "— OPEN BAY —",
      versus: "VS",
      fight: "FIGHT",
      back: "◀ EXIT",
      rosterLabel: "Bot roster",
      statSpeed: "SPD",
      statPower: "PWR",
      statArmor: "ARM",
    },

    hud: {
      standBy: "STAND BY",
      getReady: "GET READY",
      phaseFight: "FIGHT",
      phaseKnockout: "KNOCKOUT",
      phaseTimeExpired: "TIME EXPIRED",
      /** The countdown before it has a number to show. */
      ready: "READY",
      /** THE START OF THE FIGHT — the big flash as the countdown lands. Long
       *  copy is fine: the HUD shrinks and wraps it to fit. */
      fightFlash: "It's Robot Fighting Time!",
      bannerKo: "KO!",
      bannerTime: "TIME!",
      killSaws: "KILL SAWS ACTIVE",
      hint: "SPACE — WEAPON · SHIFT — BRAKE · ESC — PAUSE",
      /** Name plates before the roster is known. */
      playerFallback: "PLAYER",
      rivalFallback: "RIVAL",
      /** Tags that disambiguate two people who brought the same machine. */
      youTag: "YOU",
      rivalTag: "RIVAL",
      playerTag: "P{number}",
      /** The damage ticker. */
      zoneBody: "BODY",
      zoneWeapon: "WEAPON",
      zoneDrive: "DRIVE",
      zoneUnknown: "HIT",
      breakWeapon: "WEAPON OUT",
      breakDrive: "DRIVE DAMAGE",
      breakBody: "ARMOR BREACH",
      breakOut: "ELIMINATED",
      breakUnknown: "PART",
    },

    pause: {
      title: "PAUSED",
      resume: "RESUME",
      settings: "SETTINGS",
      exit: "EXIT TO MENU",
      hint: "START / ESC TO RESUME",
    },

    results: {
      victory: "VICTORY",
      defeat: "DEFEAT",
      fullTime: "FULL TIME",
      draw: "DRAW",
      winsByKnockout: "WINS BY KNOCKOUT",
      winsByDecision: "WINS BY JUDGES DECISION",
      judgesEven: "JUDGES CALL IT EVEN",
      finalDamage: "FINAL DAMAGE — {scores}",
      finalDamageEntry: "{name} {damage}%",
      finalDamageSeparator: " · ",
      rematch: "REMATCH",
      changeBots: "CHANGE BOTS",
      exit: "EXIT",
    },

    settings: {
      title: "Settings",
      close: "CLOSE",
      on: "ON",
      off: "OFF",
      sound: "Sound",
      soundHint: "Everything: impacts, motors, crowd, menus",
      sampled: "Sampled audio",
      sampledHint: "Recorded hits and motors, not the synth",
      haptics: "Haptics",
      hapticsHint: "Gamepad rumble on hits",
      damageTicker: "Damage ticker",
      damageTickerHint: "Per-hit callouts in the HUD",
      camera: "Camera",
      cameraLabel: "Camera mode",
      cameraBattle: "Battle",
      cameraBot: "Bot",
      cameraArena: "Arena",
      difficultyLabel: "AI difficulty",
    },

    fullscreen: {
      title: "Fullscreen",
      label: "Toggle fullscreen",
    },
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
