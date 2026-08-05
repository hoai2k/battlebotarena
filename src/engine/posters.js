// Posters — the pre-baked pictures a pod shows while its model downloads, and
// the contract that keeps them interchangeable with the models themselves.
//
// WHY. A bot's GLB is 10-17MB. The select screen now stages whatever the cursor
// is over, so scrubbing across the roster used to mean a download and a parse
// per card — the pod sat empty for seconds and the browser queued work nobody
// asked for. So moving the cursor shows a PICTURE, which is instant, and the
// real model is only built once a choice has sat still for SETTLE_MS or been
// claimed outright. A model already in a bay stays there; its poster is never
// shown again.
//
// A POSTER IS A STAND-IN FOR THE GLB, not an illustration of the bot. The
// roster cards already carry studio photographs of the real machines, and those
// are exactly what a poster must NOT be: the pod shows the scanned model on a
// lit plinth, so that is what has to appear while the scan loads, or the swap
// is a different-looking robot rather than the same one arriving.
// tools/posters.mjs bakes each one by rendering the GLB through
// engine/previewStage.js — the same lights, the same plinth, the same start
// angle the live bay builds from — and refuses to write one that came out
// procedural, empty, or without an alpha channel. All three have happened.
//
// THE CORRELATION. The bay's camera puts the model's bounding SPHERE against
// the TIGHTER of its two field-of-view angles (previewStage.fitDistance). For a
// pod wider than it is tall that is the vertical one, which is exactly what a
// square render is constrained by — so a single square picture is correctly
// framed in a pod of any size, drawn into the largest centred square that fits.
// That is the whole placement rule, and it is why there is no per-bot rect in
// the index: the constraint is spherical, so it has no orientation to get wrong.
// (A pod TALLER than it is wide is constrained by the horizontal angle instead,
// and min(width, height) picks that up for free.)
//
// Regenerate after anything that changes how a bot looks on the plinth:
//     node server.mjs & node tools/posters.mjs

import { CONFIG } from "../config.js";

/** How long a browsed choice must sit still before its real model is built.
 *  Parsing a 10-17MB GLB is synchronous and janks the main thread, so the dwell
 *  is what buys "run the cursor across the roster with no lag at all": nothing
 *  is fetched and nothing is parsed for a bot you are only passing. */
export const SETTLE_MS = CONFIG.botSelect.posterDwellMs;

/** Loaded models kept per bay, most-recently-used first. Going back to a bot
 *  you have already looked at must be instant AND must not show its picture
 *  again — you have the real thing, showing a photograph of it is a downgrade.
 *  Capped because each entry is a parsed GLB sitting in GPU memory; four is
 *  enough to cover any back-and-forth a person actually does. */
export const MODEL_CACHE = CONFIG.botSelect.modelCache;

const POSTER_DIR = "./public/posters";
const POSTER_INDEX = `${POSTER_DIR}/posters.json`;

let indexPromise = null;
let index = null;

/** The generated index, or {} if the posters were never baked — every caller
 *  degrades to "no poster", which is the old behaviour and not a failure. */
export function loadPosterIndex() {
  if (!indexPromise) {
    indexPromise = fetch(new URL(POSTER_INDEX, document.baseURI))
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((json) => {
        index = json?.bots || {};
        return index;
      });
  }
  return indexPromise;
}

/** Synchronous lookup — null until loadPosterIndex() has resolved. */
export function posterMeta(id) {
  return (index && index[id]) || null;
}

export function posterUrl(id) {
  return new URL(`${POSTER_DIR}/${id}.png`, document.baseURI).href;
}
