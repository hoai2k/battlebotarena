// Sampled sound-effect bank: the recorded half of the soundscape.
//
// `public/sfx/manifest.json` (written by tools/generate-sfx.mjs) maps an asset
// id like "impact/bot_heavy" to the MP3 takes on disk. This module fetches and
// decodes those on demand and hands out AudioBuffers; it does not play
// anything itself, because positioning, gain and the keep-alive loop logic all
// live in audio.js and there is no reason to have two of them.
//
// Everything here is BEST EFFORT by design. A missing manifest, a failed fetch,
// a sample that has not finished decoding yet — every one of them returns null,
// and every caller in audio.js falls back to the synthesis that was already
// there. That is what makes the whole sampled layer safe to switch off (or to
// ship half-generated): the game never waits on a download to make a sound.
//
// MP3 rather than WAV: these download while the player is in a match.

const BASE_PATH = "./public/sfx/";

/** Fetched and decoded before the first match rather than on first use. These
 *  are the sounds that fire in the opening seconds of a fight, where a lazy
 *  miss would be audible as a synth clang followed by a sampled one. */
const PRELOAD_PREFIXES = ["impact/", "loop/", "weapon/spinner_hit_", "ui/"];

/** @type {Record<string, {files: string[], loop: boolean}> | null} */
let manifest = null;
let manifestPromise = null;
/** @type {AudioContext | null} */
let ctx = null;

const buffers = new Map(); // file -> AudioBuffer
const failed = new Set(); // file -> do not retry
const inFlight = new Set(); // file
const cursors = new Map(); // id -> next variant index

/** Load the index. Safe to call repeatedly; the fetch happens once. */
export function loadSfxManifest() {
  if (manifestPromise) return manifestPromise;
  manifestPromise = fetch(`${BASE_PATH}manifest.json`)
    .then((res) => (res.ok ? res.json() : null))
    .then((json) => {
      manifest = json && typeof json === "object" ? json : {};
      return manifest;
    })
    .catch(() => {
      // No bank generated (or offline): the synthesised soundscape is the
      // whole soundscape, which is exactly how the game shipped before.
      manifest = {};
      return manifest;
    });
  return manifestPromise;
}

/** Give the bank the context to decode into. Downloads nothing on its own:
 *  a player with the sample bank switched off should not pay for it. */
export function attachSfxContext(audioContext) {
  if (!audioContext || ctx === audioContext) return;
  ctx = audioContext;
}

/** Fetch and decode the sounds that fire in the opening seconds of a fight.
 *  Called when the bank is switched on, not when the context appears. */
export function preloadSfx() {
  loadSfxManifest().then(() => {
    for (const id of Object.keys(manifest || {})) {
      if (PRELOAD_PREFIXES.some((prefix) => id.startsWith(prefix))) request(id);
    }
  });
}

/** True once the manifest lists this id — not that it has finished decoding. */
export function hasSample(id) {
  return Boolean(manifest?.[id]?.files?.length);
}

function fetchFile(file) {
  if (!ctx || buffers.has(file) || failed.has(file) || inFlight.has(file)) return;
  inFlight.add(file);
  fetch(BASE_PATH + file)
    .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
    // decodeAudioData's promise form is not universal on older Safari; the
    // callback form is, and it is the one branch worth carrying.
    .then((data) => new Promise((resolve, reject) => {
      const decoded = ctx.decodeAudioData(data, resolve, reject);
      if (decoded?.then) decoded.then(resolve, reject);
    }))
    .then((buffer) => {
      buffers.set(file, buffer);
    })
    .catch(() => {
      failed.add(file);
    })
    .finally(() => {
      inFlight.delete(file);
    });
}

/** Kick off loading for an id without needing a buffer back yet. */
function request(id) {
  manifest?.[id]?.files?.forEach(fetchFile);
}

/**
 * Next take for `id`, or null if the bank cannot serve it yet.
 *
 * Variants rotate rather than being picked at random: with three takes, random
 * choice plays the same one twice in a row a third of the time, and back-to-back
 * repeats are the exact artefact the variants exist to hide. The starting index
 * is offset per id so two bots that spawn together do not march in lockstep.
 *
 * @param {string} id asset id, e.g. "impact/bot_heavy"
 * @returns {AudioBuffer | null}
 */
export function takeSample(id) {
  const entry = manifest?.[id];
  if (!entry?.files?.length) return null;
  const { files } = entry;
  let cursor = cursors.get(id);
  if (cursor === undefined) cursor = Math.floor(Math.random() * files.length);

  // Walk from the cursor to the first take that is actually decoded, so a
  // partially-loaded id still sounds rather than falling back to synthesis.
  for (let step = 0; step < files.length; step += 1) {
    const file = files[(cursor + step) % files.length];
    const buffer = buffers.get(file);
    if (buffer) {
      cursors.set(id, (cursor + step + 1) % files.length);
      return buffer;
    }
  }
  request(id);
  return null;
}

/** Drop decoded audio. Called on teardown; the manifest is kept. */
export function clearSfxBuffers() {
  buffers.clear();
  failed.clear();
  cursors.clear();
  ctx = null;
}
