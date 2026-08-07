# Sound effect bank

131 MP3s, ~4 MB, generated with the ElevenLabs text-to-sound API from the
prompts in [`docs/SOUND_EFFECTS.md`](../../docs/SOUND_EFFECTS.md).

`manifest.json` is the index the game loads: asset id → the takes on disk. It
is written by the generator, not by hand — a file that is not in the manifest
is not reachable at play time.

## Regenerating

```
ELEVENLABS_API_KEY=sk_... node tools/generate-sfx.mjs            # fills gaps
ELEVENLABS_API_KEY=sk_... node tools/generate-sfx.mjs --force    # redoes all
ELEVENLABS_API_KEY=sk_... node tools/generate-sfx.mjs --only impact/
```

Existing files are skipped unless `--force`, so a run interrupted by a rate
limit resumes by simply running it again. Editing a prompt in the generator and
re-running with `--only <id>` is the way to iterate on a single sound. The full
bank costs roughly 2,600 ElevenLabs credits.

The key needs the `sound_generation` permission. It does **not** need any
other; the generator reads no account state.

## Layout

| Directory | What is in it |
|---|---|
| `impact/` | Chassis collisions by surface and intensity tier |
| `weapon/` | Weapon hits and mechanism actuations |
| `loop/` | Seamless loops — spinners, drive, hazards, flame, crowd bed |
| `damage/` | Part breaks, debris, sparks, smoke |
| `hazard/` | Kill saw launch and deploy |
| `match/` | Countdown beeps, results sting |
| `crowd/` | Cheers and gasps |
| `ui/` | Menu and HUD |
| `vo/` | Announcer — **not shipped**, see `vo/README.md` |

## How the game uses these

`src/game/sfxBank.js` fetches and decodes on demand; `src/game/audio.js` plays
them and falls back to its synthesis for anything the bank cannot serve — a
sound with no sample, a sample still downloading, or the bank switched off in
Settings → Sampled audio. Nothing here is a hard dependency: delete this whole
directory and the game still makes every sound it made before, synthesised.

Loops are rendered flat and steady at one operating point on purpose. The game
drives them with playback rate and gain from the live spin ratio and throttle,
so a loop with its own dramatic swell fights the parameter that is meant to be
shaping it.
