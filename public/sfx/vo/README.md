# Announcer voice — generated, NOT shipped

These eleven files are off by default (`CONFIG.audio.announcerVoice: false`)
and are deliberately absent from `manifest.json`, so the game cannot reach them
even if the flag is flipped without regenerating the index.

They were produced by ElevenLabs' text-to-**sound** model, which is not a
speech model. It was asked for "a male sports announcer shouting the word
FIGHT"; what it returns is a shouted vocal *texture* in roughly the right
register and energy. Whether any given take says the word is not something the
prompt controls, and it was not verified here — the API key available when
these were generated had neither `text_to_speech` (to synthesise the lines
properly) nor `speech_to_text` (to check what came back), so these takes are
unaudited by anyone.

Shipping an announcer who might be yelling nothing is worse than shipping no
announcer, which is why the callouts are silent by default and the HUD banners
(`FIGHT!`, `KO!`, `TIME!`) still carry those moments on their own.

## To make the announcer real

1. Record a person, or render the lines through a proper TTS voice — for
   ElevenLabs that is `POST /v1/text-to-speech/{voice_id}`, on a key with the
   `text_to_speech` permission.
2. Drop the takes in here as `three.mp3`, `two.mp3`, `one.mp3`, `fight_1.mp3`,
   `fight_2.mp3`, `killsaws_1.mp3`, `killsaws_2.mp3`, `ko_1.mp3`, `ko_2.mp3`,
   `time.mp3`.
3. Add them to `manifest.json` (drop `optional: true` from the `vo/` entries in
   `tools/generate-sfx.mjs` and re-run it, which rewrites the index).
4. Set `CONFIG.audio.announcerVoice: true`.

The wiring is already in place: `announce()` in `src/game/audio.js` fires on
the countdown ticks, the fight start, the kill-saw callout, the KO and time-up.
Two takes for `fight`, `ko` and `killsaws` because back-to-back rematches
otherwise sound identical.

Levels come from `CONFIG.mix.announcer`, which sits slightly hot on purpose: a
callout that loses to a spinner is a callout nobody hears.
