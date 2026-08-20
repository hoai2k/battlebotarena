// Web analytics — off unless someone turns it on, and hosted by someone else.
//
// The game ships as a static site on GitHub Pages. There is no server of ours
// in front of it, so there is no access log and no way for the deployment to
// answer "is anyone out there" on its own. GoatCounter answers it from the
// browser instead: one script, no cookies, no localStorage, no IP stored and no
// tracker id — see https://www.goatcounter.com/help/privacy.
//
// NOTHING HAPPENS until CONFIG.stats.goatCounterCode is set: no script tag, no
// network request, no listeners. An unset code is the offline default the rest
// of the game is built around, and it is why this file can exist in a game that
// promises to run with the network unplugged.
//
// What the plain pageview already reports, without us sending anything:
// country, browser and OS, screen width, language, referrer. So this module
// only sends what that CANNOT know — how the game was actually played.
//
// Events are named, not free-form: GoatCounter groups by the event name, so a
// name carrying a timestamp or a raw error string makes a list of one-offs
// nobody can read. Everything below is bucketed on purpose.
import { EV } from "../shared/events.js";
import { CONFIG } from "../config.js";

const SCRIPT_SRC = "https://gc.zgo.at/count.js";
/** Errors are the one input the game does not control the volume of — a broken
 *  frame loop can throw sixty times a second. Enough to tell you what broke. */
const MAX_ERRORS = 5;
/** Events raised before the script finished loading. Bounded: if it never
 *  arrives (offline, blocked, typo'd code) this must not grow forever. */
const QUEUE_LIMIT = 40;

const hasWindow = typeof window !== "undefined";

/** Event names are a shared namespace with the dashboard's URL list, and a
 *  name cannot start with "/". Keep them short, lowercase and finite. */
function slug(value, max = 48) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max) || "unknown";
}

/** Fight length as something with a handful of possible answers. */
function lengthBucket(seconds) {
  if (!(seconds > 0)) return "unknown";
  if (seconds < 30) return "under-30s";
  if (seconds < 60) return "30-60s";
  if (seconds < 120) return "1-2min";
  return "over-2min";
}

function padCount() {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return 0;
  try {
    return Array.from(navigator.getGamepads() || []).filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * @param {object} options
 * @param {(type: string, fn: Function) => Function} options.on  event bus
 * @param {string} [options.code]  GoatCounter site code; empty disables everything
 */
export function createStats({ on, code = CONFIG.stats.goatCounterCode } = {}) {
  const noop = { matchStarted() {}, dispose() {}, enabled: false };
  if (!hasWindow || !code) return noop;

  let live = true;
  const queue = [];
  let errorsSent = 0;
  let setupSent = false;
  let botIds = [];
  let awaitingResult = false;
  const unsubscribes = [];

  function flush() {
    while (queue.length) {
      const [path, title] = queue.shift();
      emit(path, title);
    }
  }

  function emit(path, title) {
    try {
      window.goatcounter.count({ path, title, event: true });
    } catch {
      // A counter is never worth an exception in the caller's frame.
    }
  }

  function send(path, title) {
    if (!live) return;
    if (typeof window.goatcounter?.count !== "function") {
      if (queue.length < QUEUE_LIMIT) queue.push([path, title]);
      return;
    }
    emit(path, title);
  }

  // --- the script ------------------------------------------------------------
  const script = document.createElement("script");
  script.async = true;
  script.src = SCRIPT_SRC;
  script.dataset.goatcounter = `https://${code}.goatcounter.com/count`;
  script.addEventListener("load", flush);
  // Offline, blocked by an extension, or a code that does not exist: stop
  // queueing rather than holding events for a script that is not coming.
  script.addEventListener("error", () => {
    live = false;
    queue.length = 0;
  });
  document.head.appendChild(script);

  // --- errors ----------------------------------------------------------------
  // Reported by MESSAGE, bucketed to the first line: the file and line number
  // move with every deploy, and a name that changes is a name that never adds
  // up to a count.
  function reportError(message) {
    if (errorsSent >= MAX_ERRORS) return;
    errorsSent += 1;
    const text = String(message ?? "").split("\n")[0].slice(0, 120);
    send(`error-${slug(text, 64)}`, `Error: ${text}`);
  }
  const onError = (event) => reportError(event?.message || event?.error?.message);
  const onRejection = (event) => reportError(event?.reason?.message || event?.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  /** The setup, sent once, at the first fight rather than on load — a pad
   *  plugged in after the title screen is still the setup it was played on. */
  function reportSetup() {
    if (setupSent) return;
    setupSent = true;
    send(`setup-pads-${Math.min(4, padCount())}`, `Controllers connected: ${padCount()}`);
    // The pixel ratio is here because it is what hid the split-screen viewport
    // bug: every probe ran at 1, and 1 is the one value where it looked fine.
    const ratio = Math.round(window.devicePixelRatio || 1);
    send(`setup-pixel-ratio-${ratio}`, `Device pixel ratio: ${ratio}`);
  }

  // --- the match -------------------------------------------------------------
  unsubscribes.push(
    on(EV.MATCH, (state) => {
      // `results` is the one phase emitted exactly once per fight and carrying
      // the whole outcome. Everything else on this bus fires per frame, per
      // countdown tick or per pause, and would count a match many times over.
      if (state?.phase !== "results" || !awaitingResult) return;
      awaitingResult = false;
      send(`match-end-${slug(state.cause)}`, `Fight ended: ${state.cause}`);
      const winner = typeof state.winnerIndex === "number" ? botIds[state.winnerIndex] : null;
      send(winner ? `winner-${slug(winner)}` : "winner-draw", winner ? `Winner: ${winner}` : "Draw");
      send(`match-length-${lengthBucket(state.timeElapsed)}`, `Fight length: ${lengthBucket(state.timeElapsed)}`);
    }),
  );

  return {
    enabled: true,
    /**
     * A fight is starting. Called from the one place that knows both facts —
     * which machines are in the box and how many of them have a person behind
     * them — rather than inferred from the bus, where "a match began" and "the
     * pause overlay closed" look alike.
     * @param {{ botIds?: string[], humans?: number }} match
     */
    matchStarted({ botIds: ids = [], humans = 0 } = {}) {
      botIds = ids;
      awaitingResult = true;
      reportSetup();
      const players = Math.max(0, Math.min(4, humans | 0));
      send(`match-start-${players}p`, `Fight started: ${players} human player${players === 1 ? "" : "s"}`);
      // One per machine, so the dashboard's list of these IS the roster ranked
      // by how often people actually bring it.
      ids.forEach((id) => send(`bot-${slug(id)}`, `Machine in a fight: ${id}`));
    },
    dispose() {
      unsubscribes.forEach((off) => off?.());
      unsubscribes.length = 0;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    },
  };
}
