# BattleBot Arena — Sound Effect Manifest & Generation Prompts

Every sound the game needs, what triggers it, and the prompt that produced it.

## Status: generated and wired

**All 131 files in this manifest exist**, in `public/sfx/` (~4 MB of MP3). They
were generated from the prompts below with ElevenLabs' text-to-sound API by
`tools/generate-sfx.mjs`, which holds the same manifest in machine-readable
form — that script, not this file, is what a regeneration reads. Editing a
prompt here without editing it there changes nothing.

One exception, called out again in § 6: the **announcer voice lines are off by
default**. They came out of a text-to-*sound* model rather than a speech model
and nobody has verified they say the words. See `public/sfx/vo/README.md`.

The synthesis in `src/game/audio.js` — Web Audio oscillators, filtered noise,
keep-alive loops — is still there, underneath. It was the right call for a
no-bundler prototype and it is now the fallback: it covers any sound with no
sample, any sample still downloading, and the "Sampled audio" switch being off.
Deleting `public/sfx/` entirely leaves a game that still makes every sound it
made before. Samples are a layer over the synthesis, never a dependency of it.

Music is out of scope here — it already ships as real audio in `public/music/`
and is driven by `src/shared/musicPlayer.js`. What the two share is the mix:
`CONFIG.mix` sets the SFX/music/crowd/announcer/UI balance in one place.

## How to read the tables

| Column | Meaning |
|---|---|
| **ID** | Proposed asset filename stem, under `public/sfx/<category>/` |
| **Trigger** | The event and payload that fires it — see `src/shared/events.js` |
| **Length** | Target duration of the rendered file |
| **Variants** | How many distinct takes to generate; the player round-robins them so repeats don't machine-gun |

Two kinds of asset appear below:

- **One-shots** — fire and forget, pitched/gained by the caller from the event
  payload (`relSpeed`, `impulse`, `amount`).
- **Loops** — seamless, must start and end at the same phase and level. These
  are driven by the existing keep-alive pattern in `audio.js`: a loop that
  stops being refreshed each frame fades out within ~0.3 s, which is what makes
  pause and match-end go quiet without explicit teardown. Generate them
  **flat and steady** — the game does the filtering, pitch-shifting and
  ducking. A loop with its own dramatic swell will fight the ratio parameter.

### Global rules for every prompt

Append these to any prompt below if the tool tends to over-produce:

> Dry, close-mic'd, no music, no reverb tail, no room ambience, no voice-over,
> mono, starts immediately with no lead-in silence.

Reverb is applied in-engine (the arena box is a hard-walled concrete-and-Lexan
room); baked-in reverb cannot be removed and will double up. Render at 48 kHz,
deliver as `.ogg` (with `.m4a` fallback for Safari), peak-normalised to −1 dBFS
and *not* loudness-compressed — the game needs the dynamic range between a
scrape and a full-speed spinner hit.

---

## 1. Impacts — `EV.IMPACT`

Fired by `src/sim/contacts.js` with a `surface` and `relSpeed`. The engine maps
surface → profile and computes `intensity = sqrt(relSpeed / scale)`, clamped to
1. Provide **three intensity tiers** per surface (light / medium / heavy) rather
than one sample gain-staged: a light tap and a full-speed slam differ in
spectrum, not just level.

| ID | Trigger | Length | Variants |
|---|---|---|---|
| `impact/bot_light` | `surface: "bot"`, intensity < 0.35 | 0.3 s | 4 |
| `impact/bot_medium` | `surface: "bot"`, 0.35–0.7 | 0.6 s | 4 |
| `impact/bot_heavy` | `surface: "bot"`, > 0.7 | 1.2 s | 4 |
| `impact/wall_light` | `surface: "wall"` | 0.4 s | 3 |
| `impact/wall_heavy` | `surface: "wall"` / `"ceiling"` | 1.4 s | 3 |
| `impact/floor` | `surface: "floor"` — landing after air time | 0.5 s | 4 |
| `impact/prop` | `surface: "prop"` — loose arena furniture | 0.4 s | 3 |

**Prompts**

- `impact/bot_light` — "Two heavy steel plates knocking together at low speed, a
  short dull metallic bonk with a brief ring, close-mic'd in a concrete room,
  no reverb tail, dry, mono."
- `impact/bot_medium` — "Heavy armoured steel robot slamming into another metal
  robot at moderate speed: a deep low-frequency thud followed by a bright
  metallic ring and a short high-frequency crack of scraping plate. Industrial,
  weighty, dry, close-mic'd."
- `impact/bot_heavy` — "Massive full-speed collision between two 250-pound
  armoured combat robots. A huge sub-bass impact thump, a violent metallic
  clang, torn sheet metal, and a long decaying ring of vibrating steel plate.
  Brutal and heavy, like a car crash made of armour plate. Dry, close-mic'd, no
  music."
- `impact/wall_light` — "A heavy steel object bumping a thick polycarbonate and
  steel arena wall. Dull low boom with a plastic-panel flex, very little ring.
  Dry, close, mono."
- `impact/wall_heavy` — "A heavy combat robot thrown at high speed into a
  bulletproof Lexan arena wall. Enormous low boom, the whole wall panel
  booming and flexing, rattling steel frame, deep sub-bass. Cinematic weight,
  dry recording, no reverb."
- `impact/floor` — "A heavy steel robot landing flat on a steel arena floor
  after being launched into the air. Deep floor boom, chassis rattle, short
  scrape. Dry, close-mic'd."
- `impact/prop` — "A light hollow metal object being knocked and skittering
  across a steel floor. Bright, thin, clattering. Dry, mono, short."

---

## 2. Weapon hits — `EV.WEAPON_HIT`

Fired by `src/sim/weapons.js` with `impulse` and a `heavy` flag. This is the
single most important sound in the game — it is the payoff for every approach
and every dodge, and if it does not feel violent the fight does not read.

| ID | Trigger | Length | Variants |
|---|---|---|---|
| `weapon/spinner_hit_glance` | Low `impulse`, weapon spinning | 0.5 s | 5 |
| `weapon/spinner_hit_solid` | Mid `impulse` | 1.0 s | 5 |
| `weapon/spinner_hit_massive` | High `impulse`, `heavy: true` | 2.0 s | 5 |
| `weapon/hammer_hit` | `weaponType: "hammer"` / `"hammerSaw"` | 0.8 s | 3 |
| `weapon/crusher_bite` | `weaponType: "crusher"` — jaw penetrating armour | 1.2 s | 3 |
| `weapon/saw_bite` | `weaponType: "sawArms"` — blade catching plate | 0.7 s | 3 |
| `weapon/flame_tick` | `src/sim/flamethrower.js` damage tick | 0.4 s | 3 |

**Prompts**

- `weapon/spinner_hit_glance` — "A fast-spinning steel weapon blade glancing off
  armour plate: a short sharp metallic zing with a rising whoosh, sparks
  skittering. Bright, aggressive, dry, close-mic'd."
- `weapon/spinner_hit_solid` — "A spinning steel bar weapon on a battle robot
  connecting hard with an opponent's armour. Percussive metallic BANG, a
  gunshot-like crack, torn metal, and the whoosh of the blade continuing
  through. Aggressive, industrial, dry, no reverb, no music."
- `weapon/spinner_hit_massive` — "A 30-pound steel spinning bar at full RPM
  hitting a robot squarely — the biggest hit in a robot combat match. An
  explosive metallic detonation like a shotgun blast in a steel drum, sheet
  metal tearing, debris scattering, deep sub-bass thump, long shimmering
  metallic decay. Devastating, cinematic, dry, close-mic'd."
- `weapon/hammer_hit` — "A heavy pneumatic sledgehammer slamming down onto steel
  plate. Sharp anvil-like impact, dense low thud, short metallic ring. Dry,
  close, mono."
- `weapon/crusher_bite` — "A hydraulic crusher jaw piercing through steel
  armour plate: slow groaning metal strain, then a sharp crunching punch-through
  and tearing sheet metal. Slow, mechanical, painful-sounding. Dry, close-mic'd."
- `weapon/saw_bite` — "A spinning circular saw blade biting into steel plate:
  screeching grind, high metallic squeal, sparks spitting. Harsh, bright,
  short. Dry, mono."
- `weapon/flame_tick` — "A propane flamethrower jet washing over metal: a low
  roaring whoosh with a sharp gassy hiss and crackle. Dry, close-mic'd, mono."

---

## 3. Weapon mechanisms — `EV.WEAPON_FIRED`

One-shots fired at the moment a mechanism actuates. Weapon types come from
`src/assets/catalog.js`.

| ID | Trigger | Length | Variants |
|---|---|---|---|
| `weapon/flipper_fire` | `weaponType: "flipper"` (3 bots) | 0.8 s | 3 |
| `weapon/flipper_reset` | Flipper arm returning to rest | 0.5 s | 2 |
| `weapon/hammer_swing` | `weaponType: "hammer"` — swing before contact | 0.6 s | 3 |
| `weapon/crusher_actuate` | `weaponType: "crusher"` — jaw closing | 1.0 s | 2 |
| `weapon/jaw_grip` | `weaponType: "jaw"` — clamp achieved | 0.4 s | 2 |
| `weapon/grappler_fire` | `weaponType: "grappler"` (2 bots) | 0.7 s | 2 |
| `weapon/lifter_raise` | `weaponType: "lifter"` / `"lifterDisc"` | 0.9 s | 2 |

**Prompts**

- `weapon/flipper_fire` — "A high-pressure CO2 pneumatic flipper firing on a
  combat robot: an explosive burst of compressed gas, a hard mechanical THUNK
  as the ram reaches full extension, and a metallic clank. Violent and
  instantaneous. Dry, close-mic'd, mono."
- `weapon/flipper_reset` — "A pneumatic ram retracting: a soft descending hiss
  of venting gas and a light metallic latch click. Dry, close, short."
- `weapon/hammer_swing` — "A heavy steel hammer arm swinging fast through air —
  a deep whoosh with a mechanical actuator whine underneath, no impact. Dry,
  mono."
- `weapon/crusher_actuate` — "A hydraulic ram driving a crusher jaw closed: a
  low pressurised groan rising in pitch, servo whine, creaking steel under
  load. Slow, heavy, mechanical. Dry, close-mic'd."
- `weapon/jaw_grip` — "A steel jaw clamping shut and locking onto metal: a firm
  metallic bite and a ratchet click. Short, dry, mono."
- `weapon/grappler_fire` — "A spring-loaded steel grabber arm snapping closed on
  a metal target: a fast mechanical snap, clanking linkage, latch engaging.
  Dry, close, mono."
- `weapon/lifter_raise` — "An electric lifting arm on a heavy robot raising
  under load: a strained gearbox whine rising in pitch with the creak of steel
  taking weight. Dry, close-mic'd."

---

## 4. Continuous loops

Seamless, steady, no swell. The engine cross-fades and pitch-shifts these from
the live `ratio` / `level` parameters, so record them at **one representative
operating point** and let the game do the rest. Every loop must be gapless:
matched start/end amplitude and phase, no fade in or out baked in.

| ID | Trigger | Length | Notes |
|---|---|---|---|
| `loop/spinner_bar` | `EV.WEAPON_SPIN`, `weaponType: "bar"` (4 bots) | 4 s | Record at full RPM; engine pitches down for spin-up |
| `loop/spinner_drum` | `EV.WEAPON_SPIN`, `weaponType: "drum"` (8 bots) | 4 s | Tighter, higher blade-pass rate than the bar |
| `loop/spinner_shell` | `weaponType: "shellSpinner"` (1 bot) | 4 s | Big slow mass; heavy air displacement |
| `loop/spinner_hammersaw` | `weaponType: "hammerSaw"` (1 bot) | 4 s | Saw blade whine, not a bar whoosh |
| `loop/crusher_pump` | `weaponType: "crusher"` while held | 3 s | Hydraulic pump groan |
| `loop/drive_motor` | Per-frame drive input in `updateFrame` | 3 s | Pitched by throttle; keep it neutral |
| `loop/drive_rumble` | Per-frame chassis speed | 3 s | Wheels/tracks on steel floor |
| `loop/killsaw_ambient` | `EV.MATCH` callout `"killSaws"` | 6 s | Idle blades, sits low under everything |
| `loop/killsaw_grind` | `EV.HAZARD_CONTACT`, `kind: "killSaw"` | 2 s | Refreshed per contact; has a longer tail |
| `loop/screw_grind` | `EV.HAZARD_CONTACT`, `kind: "screw"` | 2 s | Lower and duller than the saw |
| `loop/flame_jet` | Flamethrower held on (`weapon.flame`) | 3 s | Steady propane roar |
| `loop/crowd_ambient` | Whole match, ducked under callouts | 30 s | The room the fight happens in |

**Prompts**

- `loop/spinner_bar` — "Seamless loop: a massive steel spinning bar weapon at
  full speed on a combat robot. A deep electric motor whine, a heavy rhythmic
  air whoosh from the bar sweeping past, and a low resonant hum. Steady and
  unchanging, no build-up, no fade in or out, loops perfectly. Dry, mono."
- `loop/spinner_drum` — "Seamless loop: a horizontal spinning drum weapon on a
  battle robot at full RPM. Higher-pitched motor whine than a bar spinner, a
  fast fluttering blade-pass rhythm, mechanical hum. Constant level, perfectly
  loopable, dry, mono."
- `loop/spinner_shell` — "Seamless loop: an enormous rotating armoured shell
  spinning around a robot. Deep, slow, gyroscopic roar with a heavy air
  displacement wub and a huge low motor hum. Menacing, steady, perfectly
  loopable, dry."
- `loop/spinner_hammersaw` — "Seamless loop: a circular saw blade on a powered
  arm spinning at full speed in free air. High metallic whine and a thin airy
  whistle. Steady, loopable, dry, mono."
- `loop/crusher_pump` — "Seamless loop: a hydraulic power pack under load — a
  low chugging pump groan with a strained whine and a faint pressurised hiss.
  Steady, industrial, perfectly loopable, dry."
- `loop/drive_motor` — "Seamless loop: two large brushless electric drive motors
  on a heavy combat robot running at steady throttle. Low detuned electrical
  buzz with a gearbox whine. Flat and constant, no acceleration, perfectly
  loopable, dry, mono."
- `loop/drive_rumble` — "Seamless loop: heavy rubber wheels and a steel chassis
  rolling fast across a scratched steel floor. Low rumble, grit, faint chassis
  rattle. Constant, loopable, dry."
- `loop/killsaw_ambient` — "Seamless loop: large industrial saw blades idling in
  a pit beneath a steel arena floor — a distant steady blade whine and motor
  hum, no contact, no cutting. Low-level, ominous, perfectly loopable, dry."
- `loop/killsaw_grind` — "Seamless loop: a spinning steel kill saw blade
  grinding hard against a robot's armour plate. Screaming metal-on-metal
  grind, showering sparks, high sizzling squeal, low motor strain. Harsh,
  intense, constant level, loopable, dry."
- `loop/screw_grind` — "Seamless loop: a large steel auger screw dragging
  against a heavy metal chassis. Deep grinding scrape, low rumbling churn,
  duller and lower than a saw. Steady, loopable, dry."
- `loop/flame_jet` — "Seamless loop: a propane flamethrower firing continuously
  — steady roaring jet of burning gas with a crackling edge and a hissing
  nozzle. Constant, no ignition, no shutoff, perfectly loopable, dry, mono."
- `loop/crowd_ambient` — "Seamless loop: a large indoor arena crowd of a few
  thousand people during a robot combat event, in a lull between big moments.
  Murmur, scattered shouts, general hall noise, no chanting, no clapping
  rhythm, no music. Distant and roomy, constant level, perfectly loopable,
  stereo."

---

## 5. Damage, breaks and hazards

| ID | Trigger | Length | Variants |
|---|---|---|---|
| `damage/part_break_weapon` | `EV.PART_BREAK`, `zone: "weapon"` | 1.5 s | 3 |
| `damage/part_break_drive` | `EV.PART_BREAK`, `zone: "drive"` | 1.5 s | 3 |
| `damage/debris_clatter` | Layered under every part break | 1.0 s | 4 |
| `damage/sparks` | Sustained grind and heavy hits | 0.6 s | 4 |
| `damage/smoke_hiss` | Bot at high accumulated damage | 2.0 s | 2 |
| `hazard/killsaw_launch` | `EV.HAZARD_LAUNCH`, `kind: "killSaw"` | 1.0 s | 3 |
| `hazard/killsaw_deploy` | Saws rising into the arena on callout | 1.5 s | 1 |

**Prompts**

- `damage/part_break_weapon` — "A robot's weapon assembly failing catastrophically:
  steel tearing, a bolt shearing, a heavy component snapping free and clanging
  to the floor. Violent mechanical destruction. Dry, close-mic'd, mono."
- `damage/part_break_drive` — "A robot's drivetrain being destroyed: a gearbox
  stripping with a grinding crunch, a motor seizing, a wheel assembly tearing
  loose and clattering. Dry, close, mono."
- `damage/debris_clatter` — "Small pieces of broken metal and torn armour
  scattering and bouncing across a steel floor. Bright, irregular, tumbling
  clatter that dies away. Dry, mono."
- `damage/sparks` — "A shower of sparks from steel grinding on steel: a bright
  crackling sizzle with fine spitting transients. Thin, high-frequency, dry,
  mono."
- `damage/smoke_hiss` — "A damaged electric motor venting smoke: an electrical
  crackle, a rising hiss, and a faint acrid sputter. Dry, close, mono."
- `hazard/killsaw_launch` — "A spinning arena kill saw catching a heavy robot
  and hurling it into the air: a violent metallic catch and shriek, then the
  whoosh of mass being thrown. Dry, close-mic'd."
- `hazard/killsaw_deploy` — "Large industrial saw blades rising up through slots
  in a steel arena floor: hydraulic actuators driving, heavy panels sliding
  open, blade whine coming up to speed. Mechanical and threatening. Dry."

---

## 6. Announcer and match callouts — `EV.MATCH`

The match emits `phase` (`countdown` → `fight` → `ko` / `timeUp` → `results`)
and callouts. The HUD already shows `3 · 2 · 1 · FIGHT!`, `KO!` and `TIME!` —
these are the audio for those moments. Voice lines want a **real voice**: a
generated one that has to say "FIGHT!" over a battle track is the one place in
this list where TTS tends to disappoint. If generating, use a voice-cloning
tool with a hyped sports-announcer reference rather than a text-to-SFX model.

| ID | Trigger | Length | Variants |
|---|---|---|---|
| `match/countdown_beep` | `phase: "countdown"`, per `count` tick | 0.3 s | 1 |
| `match/countdown_beep_final` | Final tick before FIGHT | 0.5 s | 1 |
| `vo/three`, `vo/two`, `vo/one` | Countdown ticks | 0.6 s each | 1 |
| `vo/fight` | `phase: "fight"` start | 1.0 s | 2 |
| `vo/killsaws` | `callout: "killSaws"` | 1.2 s | 2 |
| `vo/ko` | `phase: "ko"` | 1.2 s | 2 |
| `vo/time` | `phase: "timeUp"` | 1.0 s | 1 |
| `crowd/cheer_big` | Big hit, KO, part break | 4 s | 3 |
| `crowd/gasp` | Near-miss, bot launched by a hazard | 2 s | 2 |
| `match/results_sting` | `phase: "results"` | 2.5 s | 1 |

**Prompts**

- `match/countdown_beep` — "A single short electronic countdown beep, a clean
  mid-pitched tone like a stadium start timer. Dry, mono, no reverb."
- `match/countdown_beep_final` — "A single longer, higher-pitched electronic
  countdown tone signalling the start of a match. Clean, urgent, dry, mono."
- `vo/*` — voice, not SFX: "Male sports announcer, hyped, shouting over a loud
  arena, aggressive robot-combat commentator energy. Line: `FIGHT!`" — and the
  same treatment for `THREE`, `TWO`, `ONE`, `KILL SAWS!`, `KNOCKOUT!`, `TIME!`.
  Record two takes of the emotional lines (`FIGHT`, `KO`) so back-to-back
  rematches don't sound identical.
- `crowd/cheer_big` — "A large indoor arena crowd erupting into a huge cheer and
  roar after a spectacular hit, building fast then settling. A few thousand
  people, no chanting, no music, no announcer. Roomy, stereo."
- `crowd/gasp` — "A large arena crowd drawing a collective gasp and letting out
  a scattered 'ooh' at a near-miss. A few thousand people, no cheering, no
  music. Roomy, stereo."
- `match/results_sting` — "A short broadcast-style sting to close out a fight:
  an industrial metallic hit with a low sub-drop and a brief tail. No melody,
  no music bed. Punchy, dry-ish."

---

## 7. UI

None of these exist today — the menus are silent, which is why the title screen
feels like a web page rather than the front end of a broadcast. Keep them
short, quiet and unmusical; they play under the anthem.

| ID | Trigger | Length | Variants |
|---|---|---|---|
| `ui/nav_move` | Gamepad/keyboard focus change (`src/ui/gamepadNav.js`) | 0.15 s | 2 |
| `ui/confirm` | A / activate on a button | 0.25 s | 1 |
| `ui/back` | B / back, close settings | 0.25 s | 1 |
| `ui/bot_hover` | Bot card focused on the select screen | 0.2 s | 2 |
| `ui/bot_lock` | Bot confirmed into a bay | 0.6 s | 1 |
| `ui/bot_unlock` | Bot released from a bay | 0.4 s | 1 |
| `ui/fight_button` | FIGHT pressed, transition to match | 1.5 s | 1 |
| `ui/pad_connect` | A controller joins, bay count changes | 0.5 s | 1 |
| `ui/toggle` | Settings switch flipped | 0.2 s | 1 |
| `ui/error` | Rejected input (e.g. bay full) | 0.3 s | 1 |
| `ui/loading_done` | Models finished loading, match ready | 0.8 s | 1 |

**Prompts**

- `ui/nav_move` — "A very short, quiet mechanical UI tick for moving a menu
  selection — a small metallic relay click with a faint electronic edge. Crisp,
  dry, mono, under 150 milliseconds."
- `ui/confirm` — "A short, positive, mechanical UI confirmation: a solid switch
  clunk with a brief bright electronic accent. Industrial, dry, mono."
- `ui/back` — "A short, low, mechanical UI cancel sound: a muted switch clunk
  with a slight downward electronic sweep. Dry, mono."
- `ui/bot_hover` — "A quiet electronic hover blip with a faint metallic scrape
  underneath, like a targeting reticle settling on a machine. Short, dry, mono."
- `ui/bot_lock` — "A heavy mechanical lock engaging: a servo whir, a solid metal
  clamp thunking closed, and a confirming electronic tone. Industrial, dry,
  mono."
- `ui/bot_unlock` — "A mechanical clamp releasing: a metal latch popping open
  with a short pneumatic hiss. Dry, mono, short."
- `ui/fight_button` — "A dramatic UI transition into a fight: a rising
  mechanical whoosh, heavy steel doors slamming, and a deep sub-bass impact.
  Aggressive and broadcast-style, dry-ish, stereo."
- `ui/pad_connect` — "A short two-note ascending electronic chime signalling a
  game controller connecting. Clean, synthetic, friendly, dry, mono."
- `ui/toggle` — "A small physical toggle switch flipping — a crisp plastic and
  metal click. Dry, mono, very short."
- `ui/error` — "A short, low, blunt electronic error buzz — dull and
  unmelodic, not harsh. Dry, mono."
- `ui/loading_done` — "A short industrial ready-signal: a pressurised hiss
  releasing followed by a solid metallic clunk and a clean confirming tone.
  Dry, mono."

---

## What shipped, versus what this document asked for

Two things came out different from the brief above, both because of what the
generator can actually deliver:

- **Everything is 44.1 kHz stereo**, not 48 kHz mono. That is what the API
  returns; there is no mono or 48 kHz option on the endpoint. Positioned
  sounds are panned in engine anyway, and a stereo source panned is a slightly
  wider image than a mono one, not a broken one.
- **The announcer is not real.** See § 6 and `public/sfx/vo/README.md`.

Everything else — the tiers, the variant counts, the loop treatment, the dry
no-reverb rule appended to every prompt — is as specified.

## Delivery checklist

- [ ] 48 kHz, 16-bit source; ship `.ogg` (q5) plus `.m4a` fallback
- [ ] Mono for anything positioned in the arena (the engine pans it); stereo
      only for crowd beds and the results sting
- [ ] Loops verified gapless — play them back-to-back 20× and listen for a seam
- [ ] Peak-normalised to −1 dBFS, no bus compression or limiting
- [ ] No baked reverb, no lead-in silence, trimmed to the first transient
- [ ] Filenames match the IDs above exactly, under `public/sfx/<category>/`,
      with variants suffixed `_1`, `_2`, …
- [ ] Total budget: keep the full set under ~6 MB compressed so first load
      stays fast; loops and impacts are the only ones worth preloading, the
      rest can stream on first use

## How they are wired (done)

| File | Role |
|---|---|
| `src/game/sfxBank.js` | Fetches `manifest.json`, decodes takes on demand, rotates variants. Every failure path returns null so the caller falls back to synthesis. |
| `src/game/audio.js` | Sample-first, synth-second at every call site; owns the crowd bed and the match callouts. |
| `src/game/uiAudio.js` | Menu and HUD sound, via delegated document listeners rather than a play() call in every button handler. |
| `src/config.js` | `CONFIG.mix` (the SFX/music balance), `CONFIG.audio.useSamples`, pitch jitter, `announcerVoice`. |
| `settings.sampledSfx` | The player's switch — Settings → **Sampled audio**, default ON. |
| `tools/generate-sfx.mjs` | Regenerates the bank. |
| `tools/sfx-probe.mjs` | Proves the bank actually loads and plays in the real page. |

The sampled/synth choice is made per sound, per call, not once at start-up.
Turning the switch off mid-match drops the running loops so the change is
audible immediately; turning it on triggers the preload.

Two notes for the next person in here:

- **Loops use separate cache keys** (`sample:spin:0` vs `spin:0`), so when a
  sample finishes downloading mid-fight the synth loop simply stops being
  refreshed and fades out through the existing keep-alive path. There is no
  crossfade code, and there should not be.
- **`MAX_VOICES` went 14 → 24.** A 2.5-second heavy impact holds a voice far
  longer than the 0.3-second synth ping the old ceiling was measured against.

### The original notes, kept because they still describe the design

`src/game/audio.js` owns the whole soundscape and is the only file that needed
to change. The existing structure already fitted samples:

- `playImpactProfile()` becomes a sample picker (surface + intensity tier →
  variant round-robin) instead of an oscillator builder. Keep the `throttled()`
  minimum-gap logic — it is what stops a contact-heavy frame from firing forty
  overlapping clangs.
- `acquireLoop()` / `keepAlive()` stay exactly as they are; only the `builder`
  callback changes, swapping oscillators for an `AudioBufferSourceNode` with
  `loop = true`. The keep-alive fade is what makes pause and match-end work, so
  don't replace it with explicit stop calls.
- `spatialize()` and the `outputChain()` positioning stay untouched.
- `MAX_VOICES` matters more with samples than with oscillators — a 2-second
  heavy impact holds a voice far longer than a 0.3-second synth ping. Re-tune
  it once real assets are in.
- Everything stays behind `settings.soundEnabled` and `CONFIG.audio.sfxVolume`;
  the crowd bed got its own level (`CONFIG.mix.crowd`) since it is the one
  sound a player will predictably want quieter without touching the rest.

Synthesis stays as the fallback for anything not recorded — the two coexist
per-sound, which is what let the whole bank land in one pass instead of a
staged migration.
