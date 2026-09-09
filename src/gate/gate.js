/**
 * THE PORTABLE COPY OF THE DOOR — the reference implementation the other games
 * carry, kept here beside `Code.gs` so the whole gate lives in one place.
 *
 * This repository does not load this file: it is a Vite/TypeScript site and
 * uses `src/gate/gate.ts`, which is the same door in the same shape. The other
 * six games are no-build static sites and carry this one byte-identically.
 * IF YOU CHANGE ONE, CHANGE BOTH — they are two expressions of one design, and
 * the moment they disagree the games start disagreeing about who is let in.
 *
 * ---
 *
 * The door: a one-time invite code in front of the game.
 *
 * Self-contained on purpose — no imports, no build step, no dependencies. Drop
 * this file in, call `openGate()` before the game boots, and that is the whole
 * integration. It is the same door as `src/gate/gate.ts` in the `mando` repo,
 * written as plain ES module JavaScript for the no-build sites.
 *
 * IT IS A DOORMAN, NOT A LOCK. These are static sites in public repositories:
 * everything here ships to the browser, and anyone willing to open devtools can
 * set the pass by hand and walk in. What it does is keep the games off the open
 * web for passers-by, and tell the owner who is playing. Nothing behind it is a
 * secret and no check here should be mistaken for one.
 *
 * "FRIENDS SEE THIS ONCE" is the constraint everything bends to:
 *
 *  - An invite link (`?invite=CODE`) redeems itself on arrival — nothing to
 *    click, nothing to type — and is then wiped from the address bar, which is
 *    the least private place on a computer: screenshots, bookmarks,
 *    autocomplete, and links pasted into group chats by somebody meaning to
 *    share the game rather than their own invite.
 *  - The pass is stored with NO EXPIRY, under a key that is NOT this game's.
 *    Every game on this origin shares it — GitHub Pages project sites differ
 *    only by path and localStorage is keyed by origin — so one invite admits a
 *    friend to all of them, and a friend who already plays one game walks
 *    straight into a new one without ever seeing this.
 *  - The code itself is never stored. The endpoint answers with an id and a
 *    name, and those are what is kept, so the browser holds no reusable secret.
 *
 * TO SEE THE DOOR AGAIN once you hold a pass — which the owner needs whenever
 * testing an invite, and nobody else ever needs — add `?gatereset=1` to the
 * URL, or call `gateReset()` in the console. Both forget this browser's pass
 * and put the door back. Neither is a way *in*: forgetting a pass can only ever
 * cost you the door you were through, so there is nothing to protect here.
 *
 * IT IS OFF WHEN RUN LOCALLY. On localhost, a file:// page, or a private LAN
 * address, `openGate` resolves immediately and this file may as well not exist
 * — so `npm start`, the test tooling and any local automation never meet it.
 * Append `?gatetest=1` to see the real door on a local server.
 */

/** Where the guest list lives. Not a secret: it ships in this file either way. */
const ENDPOINT = 'https://script.google.com/macros/s/AKfycbx5Jp9z8XG0nnk60z5zccDoIy8MdkFDr0Cn61p84fcqKyKzhZ_700c_zCJVqjwsNfvlsQ/exec';

/**
 * Deliberately not namespaced to any one game — see the header. Changing this
 * string in one game and not the others would quietly split the guest list into
 * per-game sign-ins, which is exactly what it exists to prevent.
 */
const PASS_STORE = 'gate.pass';

const INVITE_PARAM = 'invite';
/** Forget this browser's pass and show the door again. For testing invites. */
const RESET_PARAM = 'gatereset';

/** Hosts where the door stands open: local development and local automation. */
function isLocal() {
  const h = location.hostname;
  return h === '' || h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0'
    || h.endsWith('.local') || /^192\.168\./.test(h) || /^10\./.test(h);
}

/** On for a real deployment; off locally unless deliberately being tested. */
function gateEnabled() {
  try {
    if (new URL(location.href).searchParams.has('gatetest')) return true;
  } catch { /* an exotic URL is not worth failing a boot over */ }
  return !isLocal();
}

// ---------- the stored pass ----------

export function readPass() {
  try {
    const raw = localStorage.getItem(PASS_STORE);
    if (!raw) return null;
    const p = JSON.parse(raw);
    // A blob that predates a field, or one typed in by hand, should read as
    // "no pass" rather than crash the boot before the game exists.
    if (!p || typeof p.id !== 'string' || p.id === '') return null;
    return { id: p.id, name: typeof p.name === 'string' ? p.name : p.id, since: p.since || Date.now() };
  } catch {
    return null;   // private mode, or storage disabled entirely
  }
}

function writePass(p) {
  try { localStorage.setItem(PASS_STORE, JSON.stringify(p)); } catch { /* private mode */ }
}

export function clearPass() {
  try { localStorage.removeItem(PASS_STORE); } catch { /* private mode */ }
}

// ---------- the endpoint ----------

/**
 * Posted as text/plain on purpose. A JSON content-type makes the browser send a
 * CORS preflight, and an Apps Script web app cannot answer one — the body is
 * still JSON, the header just keeps the request "simple" so it goes straight
 * through.
 */
async function post(body) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body),
  });
  return await res.json();
}

/**
 * What the browser can say about itself, sent only with an invite attempt so
 * the owner can see the shape of anything odd at the door.
 *
 * ALL OF IT IS SELF-REPORTED AND TRIVIALLY FORGED. Apps Script hands its
 * doPost the body and nothing else — no client IP, no headers — so there is no
 * server-side truth to compare against and no real location to be had. The
 * timezone is the useful field in practice: a coarse "roughly where", not
 * something a casual guesser thinks to change.
 */
function clientInfo() {
  const safe = (f, fallback) => { try { return f(); } catch { return fallback; } };
  return {
    tz: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone, ''),
    lang: safe(() => navigator.language, ''),
    screen: safe(() => `${screen.width}x${screen.height}`, ''),
    ua: safe(() => navigator.userAgent, '').slice(0, 300),
    ref: safe(() => document.referrer, '').slice(0, 300),
  };
}

/** Fire-and-forget. Carries an id, never a code, so it cannot be replayed in. */
function pingSession(pass, game) {
  const body = JSON.stringify({ kind: 'session', game, id: pass.id, name: pass.name });
  try {
    const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
    if (navigator.sendBeacon(ENDPOINT, blob)) return;
  } catch { /* fall through to fetch */ }
  fetch(ENDPOINT, {
    method: 'POST', keepalive: true,
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body,
  }).catch(() => { /* the log is never worth failing a boot over */ });
}

// ---------- the invite in the address bar ----------

function codeFromUrl() {
  try {
    const v = new URL(location.href).searchParams.get(INVITE_PARAM);
    return v && v.trim() !== '' ? v.trim() : null;
  } catch { return null; }
}

/**
 * Take the gate's own parameters back out of the address bar once they are
 * spent.
 *
 * An invite link is a small secret and the address bar is the least private
 * place on a computer: screenshotted, read over shoulders, bookmarked,
 * autocompleted, and pasted into group chats by people meaning to share the
 * game rather than their own invite. Wiping it costs nothing — the pass is
 * stored by the time this runs — and leaves a clean URL to share.
 *
 * `gatereset` is stripped for a duller reason: left in place it would fire
 * again on the next reload, and testing an invite would mean being thrown back
 * to the door every time.
 */
function stripGateParams(...names) {
  try {
    const url = new URL(location.href);
    if (!names.some((n) => url.searchParams.has(n))) return;
    for (const n of names) url.searchParams.delete(n);
    history.replaceState(null, '', url.pathname + (url.search || '') + url.hash);
  } catch { /* nothing worth failing a boot over */ }
}

// ---------- the screen ----------

const CSS = `
.gate-veil {
  position: fixed; inset: 0; z-index: 2147483000;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px;
  background: radial-gradient(ellipse at 50% 35%, #1d222b 0%, #07090c 70%);
  font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: #e6ebf2;
  text-align: center; padding: 24px;
}
.gate-veil h1 {
  font-size: clamp(22px, 4.2vw, 40px); font-weight: 600; letter-spacing: 0.14em;
  text-transform: uppercase; color: #7fd1ff; margin: 0 0 2px;
}
.gate-veil p { max-width: 30rem; line-height: 1.55; font-size: 14px; color: #9fb0c4; margin: 0; }
.gate-veil .gate-slot { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: center; }
.gate-veil input {
  background: rgba(8,10,14,0.8); border: 1px solid #33506b; border-radius: 4px;
  color: #eef4ff; font: inherit; font-size: 15px; letter-spacing: 0.12em;
  text-transform: uppercase; padding: 9px 14px; width: 15rem; text-align: center;
}
.gate-veil input:focus { outline: none; border-color: #7fd1ff; }
.gate-veil button {
  background: linear-gradient(180deg, #2f6b96, #1d4363); border: 1px solid #33506b;
  color: #eef4ff; font: inherit; font-size: 14px; padding: 9px 18px; border-radius: 4px; cursor: pointer;
}
.gate-veil button:hover { background: linear-gradient(180deg, #7fd1ff, #2f6b96); }
.gate-veil button:disabled { opacity: 0.5; cursor: default; }
.gate-veil .gate-back { background: transparent; border-color: transparent; opacity: 0.65; }
.gate-veil .gate-back:hover { background: transparent; opacity: 1; text-decoration: underline; }
.gate-veil .gate-note { font-size: 12px; color: #71808f; max-width: 26rem; min-height: 1.2em; }
.gate-veil .gate-bad { color: #ff9a7a; }
`;

function buildDoor(opts) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const veil = document.createElement('div');
  veil.className = 'gate-veil';
  // textContent for the host-supplied strings: they are configuration, and
  // configuration should not be able to inject markup into the page.
  veil.innerHTML = '<h1></h1><p class="gate-blurb"></p><div class="gate-slot"></div><p class="gate-note"></p>';
  veil.querySelector('h1').textContent = opts.title;
  veil.querySelector('.gate-blurb').textContent = opts.blurb;
  document.body.appendChild(veil);

  return {
    veil,
    slot: veil.querySelector('.gate-slot'),
    note: veil.querySelector('.gate-note'),
    close() { veil.remove(); style.remove(); },
  };
}

// ---------- the gate ----------

/**
 * Resolves when the player may pass. Never rejects: a door that throws on the
 * boot path is a white screen, so every failure ends at a retry.
 *
 * `opts.dismissible` offers a way out of the door. A game has nothing behind
 * its door, so there is nowhere to go back to and no button to draw. A page
 * that uses the door as a *redeem box* — the arcade library, which is public
 * and merely hides the locked cards — does have something behind it, and
 * stranding a visitor on a veil they cannot dismiss would be a bug rather than
 * a policy. When set, `openGate` resolves on "Back" WITHOUT a pass, so a caller
 * that cares must check `readPass()` rather than assume resolution means
 * admission.
 *
 * @param {{title: string, blurb: string, game: string, dismissible?: boolean, warm?: (signal: AbortSignal) => void}} opts
 */
export function openGate(opts) {
  // A console escape hatch for the owner, always available: forget this
  // browser's pass and come back to the door. Handy when testing an invite,
  // and harmless — forgetting a pass cannot let anybody in.
  try { window.gateReset = () => { clearPass(); location.reload(); }; } catch { /* sealed window */ }

  if (!gateEnabled()) return Promise.resolve();

  // `?gatereset=1` before anything reads the pass, so this turn sees no pass
  // and puts the door up.
  try {
    if (new URL(location.href).searchParams.has(RESET_PARAM)) {
      clearPass();
      // Strip it now rather than on the way through the door: the reset has
      // already happened, and left in the bar it would fire again on every
      // reload — so testing an invite would mean being thrown back to the door
      // each time. An `invite` alongside it is left alone; it has not been
      // spent yet.
      stripGateParams(RESET_PARAM);
    }
  } catch { /* an exotic URL is not worth failing a boot over */ }

  const pass = readPass();
  if (pass) {
    pingSession(pass, opts.game);
    stripGateParams(INVITE_PARAM, RESET_PARAM);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const door = buildDoor(opts);
    let settled = false;

    // The door is up and the connection is idle: somebody here is about to
    // play, so let the host start pulling down what comes next. Refusing a
    // visitor aborts it; being admitted deliberately does not.
    const warming = new AbortController();
    try { if (opts.warm) opts.warm(warming.signal); } catch (e) { console.warn('[gate] warm hook threw', e); }

    const admit = (p) => {
      if (settled) return;
      settled = true;
      writePass(p);
      pingSession(p, opts.game);
      stripGateParams(INVITE_PARAM, RESET_PARAM);
      door.close();
      resolve();
    };

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'invite code';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'invite code');
    const go = document.createElement('button');
    go.textContent = 'Enter';
    door.slot.append(input, go);

    const submit = () => {
      const code = input.value.trim();
      if (code === '') { input.focus(); return; }
      redeem(code, { door, opts, admit, warming, input, go });
    };
    go.onclick = submit;
    input.onkeydown = (e) => { if (e.key === 'Enter') submit(); };

    if (opts.dismissible) {
      const back = document.createElement('button');
      back.textContent = 'Back';
      back.className = 'gate-back';
      back.onclick = () => {
        if (settled) return;
        settled = true;
        warming.abort();
        door.close();
        resolve();          // resolved WITHOUT a pass — see GateOptions.dismissible
      };
      door.slot.append(back);
    }

    const fromLink = codeFromUrl();
    if (fromLink) {
      // An invite link spends itself. The form stays underneath so a bad code
      // lands somewhere the visitor can correct it.
      input.value = fromLink;
      redeem(fromLink, { door, opts, admit, warming, input, go });
    } else {
      input.focus();
    }
  });
}

async function redeem(code, ctx) {
  const { door, opts, admit, warming, input, go } = ctx;
  const busy = (on) => { input.disabled = on; go.disabled = on; };
  busy(true);
  door.note.className = 'gate-note';
  door.note.textContent = 'Checking your invite…';
  try {
    const r = await post({ kind: 'invite', game: opts.game, code, client: clientInfo() });
    if (r && r.ok && typeof r.id === 'string' && r.id !== '') {
      admit({ id: r.id, name: r.name || r.id, since: Date.now() });
      return;
    }
    // A definite no. Stop pulling down a game this visitor will not play.
    warming.abort();
    busy(false);
    door.note.className = 'gate-note gate-bad';
    door.note.textContent = (r && r.reason) === 'revoked'
      ? 'That invite has been turned off. Ask for a new one.'
      : "That invite code isn't recognised. Check it, or ask for a new one.";
    input.focus();
    input.select();
  } catch {
    // No answer at all. This does NOT open the door: the endpoint is the guest
    // list, and admitting everyone whenever a request fails would make the list
    // optional for anyone able to drop one. Friends already in hold a pass and
    // never reach this.
    busy(false);
    door.note.className = 'gate-note gate-bad';
    door.note.textContent = 'Could not reach the guest list just now. Try again in a moment.';
    input.focus();
  }
}
