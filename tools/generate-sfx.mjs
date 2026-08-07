// Generate the game's sound-effect bank with the ElevenLabs text-to-sound API.
//
//   ELEVENLABS_API_KEY=sk_... node tools/generate-sfx.mjs [--force] [--only <substr>]
//
// The manifest below IS the spec in docs/SOUND_EFFECTS.md, in machine-readable
// form: every entry is one asset ID, its prompt, its target duration and how
// many takes to render. Output lands in public/sfx/<dir>/<id>_<n>.mp3 and the
// index the game loads is written to public/sfx/manifest.json.
//
// Re-running is cheap and safe: an entry whose files already exist is skipped
// unless --force is passed, so a partial run (rate limit, dropped connection)
// resumes by just running it again. Nothing here runs at play time.
//
// MP3 rather than WAV on purpose — these download during gameplay, and the
// whole bank has to stay small enough to preload without stalling a match.

import { mkdir, writeFile, access, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "public", "sfx");
const API = "https://api.elevenlabs.io/v1/sound-generation";
const MODEL = "eleven_text_to_sound_v2";
const FORMAT = "mp3_44100_128";

// Appended to every prompt except the ones that WANT a room (crowd beds) —
// reverb baked into a sample cannot be removed, and the arena's reverb is
// applied in engine. See docs/SOUND_EFFECTS.md § "Global rules".
const DRY = "Dry, close-miked, no reverb tail, no room ambience, no music, no voice-over, starts immediately with no lead-in silence.";

/**
 * @typedef {object} SfxEntry
 * @property {string} id        asset id, "<dir>/<name>" — also the runtime key
 * @property {string} prompt    text-to-sound prompt
 * @property {number} seconds   target duration
 * @property {number} [takes]   variants to render (default 1)
 * @property {boolean} [loop]   render as a seamless loop
 * @property {number} [influence] prompt_influence 0..1 (default 0.6)
 * @property {boolean} [roomy]  skip the dry suffix (crowd beds)
 * @property {boolean} [optional] excluded from the runtime manifest by default
 */

/** @type {SfxEntry[]} */
const MANIFEST = [
  // --- 1. Impacts (EV.IMPACT) ------------------------------------------------
  { id: "impact/bot_light", takes: 4, seconds: 1,
    prompt: "Two heavy steel plates knocking together at low speed, a short dull metallic bonk with a brief ring, heavy armour plate, industrial." },
  { id: "impact/bot_medium", takes: 4, seconds: 1.5,
    prompt: "A heavy armoured steel robot slamming into another metal robot at moderate speed: a deep low-frequency thud followed by a bright metallic ring and a short high-frequency crack of scraping plate. Industrial, weighty." },
  { id: "impact/bot_heavy", takes: 4, seconds: 2,
    prompt: "A massive full-speed collision between two 250-pound armoured combat robots. A huge sub-bass impact thump, a violent metallic clang, torn sheet metal, and a long decaying ring of vibrating steel plate. Brutal, like a car crash made of armour plate." },
  { id: "impact/wall_light", takes: 3, seconds: 1,
    prompt: "A heavy steel object bumping a thick polycarbonate and steel arena wall. Dull low boom with a plastic panel flex, very little ring." },
  { id: "impact/wall_heavy", takes: 3, seconds: 2,
    prompt: "A heavy combat robot thrown at high speed into a bulletproof Lexan arena wall. Enormous low boom, the wall panel booming and flexing, rattling steel frame, deep sub-bass." },
  { id: "impact/floor", takes: 4, seconds: 1.2,
    prompt: "A heavy steel robot landing flat on a steel arena floor after being launched into the air. Deep floor boom, chassis rattle, short scrape." },
  { id: "impact/prop", takes: 3, seconds: 1,
    prompt: "A light hollow metal object being knocked and skittering across a steel floor. Bright, thin, clattering." },

  // --- 2. Weapon hits (EV.WEAPON_HIT) ---------------------------------------
  { id: "weapon/spinner_hit_glance", takes: 5, seconds: 1,
    prompt: "A fast-spinning steel weapon blade glancing off armour plate: a short sharp metallic zing with a rising whoosh and sparks skittering. Bright, aggressive." },
  { id: "weapon/spinner_hit_solid", takes: 5, seconds: 1.5,
    prompt: "A spinning steel bar weapon on a battle robot connecting hard with an opponent's armour. Percussive metallic bang, a gunshot-like crack, torn metal, and the whoosh of the blade continuing through. Aggressive, industrial." },
  { id: "weapon/spinner_hit_massive", takes: 5, seconds: 2.5,
    prompt: "A 30-pound steel spinning bar at full RPM hitting a robot squarely, the biggest hit in a robot combat match. An explosive metallic detonation like a shotgun blast inside a steel drum, sheet metal tearing, debris scattering, deep sub-bass thump, long shimmering metallic decay. Devastating." },
  { id: "weapon/hammer_hit", takes: 3, seconds: 1.2,
    prompt: "A heavy pneumatic sledgehammer slamming down onto steel plate. Sharp anvil-like impact, dense low thud, short metallic ring." },
  { id: "weapon/crusher_bite", takes: 3, seconds: 1.8,
    prompt: "A hydraulic crusher jaw piercing through steel armour plate: slow groaning metal strain, then a sharp crunching punch-through and tearing sheet metal. Slow, mechanical." },
  { id: "weapon/saw_bite", takes: 3, seconds: 1.2,
    prompt: "A spinning circular saw blade biting into steel plate: screeching grind, high metallic squeal, sparks spitting. Harsh and bright." },
  { id: "weapon/flame_tick", takes: 3, seconds: 1,
    prompt: "A propane flamethrower jet washing over metal: a low roaring whoosh with a sharp gassy hiss and crackle." },

  // --- 3. Weapon mechanisms (EV.WEAPON_FIRED) -------------------------------
  { id: "weapon/flipper_fire", takes: 3, seconds: 1.2,
    prompt: "A high-pressure CO2 pneumatic flipper firing on a combat robot: an explosive burst of compressed gas, a hard mechanical thunk as the ram reaches full extension, and a metallic clank. Violent and instantaneous." },
  { id: "weapon/flipper_reset", takes: 2, seconds: 1,
    prompt: "A pneumatic ram retracting: a soft descending hiss of venting gas and a light metallic latch click." },
  { id: "weapon/hammer_swing", takes: 3, seconds: 1,
    prompt: "A heavy steel hammer arm swinging fast through the air, a deep whoosh with a mechanical actuator whine underneath, no impact." },
  { id: "weapon/crusher_actuate", takes: 2, seconds: 1.5,
    prompt: "A hydraulic ram driving a crusher jaw closed: a low pressurised groan rising in pitch, servo whine, creaking steel under load. Slow and heavy." },
  { id: "weapon/jaw_grip", takes: 2, seconds: 1,
    prompt: "A steel jaw clamping shut and locking onto metal: a firm metallic bite and a ratchet click." },
  { id: "weapon/grappler_fire", takes: 2, seconds: 1.2,
    prompt: "A spring-loaded steel grabber arm snapping closed on a metal target: a fast mechanical snap, clanking linkage, latch engaging." },
  { id: "weapon/lifter_raise", takes: 2, seconds: 1.4,
    prompt: "An electric lifting arm on a heavy robot raising under load: a strained gearbox whine rising in pitch with the creak of steel taking weight." },

  // --- 4. Continuous loops ---------------------------------------------------
  // Rendered flat and steady at ONE operating point: the game pitches, filters
  // and fades them from the live spin ratio / throttle. A loop with its own
  // swell fights the parameter it is driven by.
  { id: "loop/spinner_bar", loop: true, seconds: 5,
    prompt: "Seamless loop: a massive steel spinning bar weapon at full speed on a combat robot. Deep electric motor whine, a heavy rhythmic air whoosh from the bar sweeping past, low resonant hum. Steady and unchanging, no build-up." },
  { id: "loop/spinner_drum", loop: true, seconds: 5,
    prompt: "Seamless loop: a horizontal spinning drum weapon on a battle robot at full RPM. High motor whine, a fast fluttering blade-pass rhythm, mechanical hum. Constant level." },
  { id: "loop/spinner_shell", loop: true, seconds: 5,
    prompt: "Seamless loop: an enormous rotating armoured shell spinning around a robot. Deep slow gyroscopic roar with heavy air displacement and a huge low motor hum. Menacing and steady." },
  { id: "loop/spinner_hammersaw", loop: true, seconds: 5,
    prompt: "Seamless loop: a circular saw blade on a powered arm spinning at full speed in free air. High metallic whine and a thin airy whistle. Steady." },
  { id: "loop/crusher_pump", loop: true, seconds: 4,
    prompt: "Seamless loop: a hydraulic power pack under load, a low chugging pump groan with a strained whine and a faint pressurised hiss. Steady and industrial." },
  { id: "loop/drive_motor", loop: true, seconds: 4,
    prompt: "Seamless loop: two large brushless electric drive motors on a heavy combat robot running at steady throttle. Low detuned electrical buzz with a gearbox whine. Flat and constant, no acceleration." },
  { id: "loop/drive_rumble", loop: true, seconds: 4,
    prompt: "Seamless loop: heavy rubber wheels and a steel chassis rolling fast across a scratched steel floor. Low rumble, grit, faint chassis rattle. Constant." },
  { id: "loop/killsaw_ambient", loop: true, seconds: 6,
    prompt: "Seamless loop: large industrial saw blades idling in a pit beneath a steel arena floor, a distant steady blade whine and motor hum, no contact and no cutting. Low level and ominous." },
  { id: "loop/killsaw_grind", loop: true, seconds: 3,
    prompt: "Seamless loop: a spinning steel kill saw blade grinding hard against a robot's armour plate. Screaming metal-on-metal grind, showering sparks, high sizzling squeal, low motor strain. Harsh and intense, constant level." },
  { id: "loop/screw_grind", loop: true, seconds: 3,
    prompt: "Seamless loop: a large steel auger screw dragging against a heavy metal chassis. Deep grinding scrape and low rumbling churn, duller and lower than a saw. Steady." },
  { id: "loop/flame_jet", loop: true, seconds: 4,
    prompt: "Seamless loop: a propane flamethrower firing continuously, a steady roaring jet of burning gas with a crackling edge and a hissing nozzle. Constant, no ignition and no shutoff." },
  { id: "loop/crowd_ambient", loop: true, seconds: 10, roomy: true, influence: 0.4,
    prompt: "Seamless loop: a large indoor arena crowd of a few thousand people during a robot combat event, in a lull between big moments. Murmur, scattered shouts, general hall noise, no chanting, no rhythmic clapping, no music, no announcer. Distant and roomy, constant level." },

  // --- 5. Damage, breaks and hazards ----------------------------------------
  { id: "damage/part_break_weapon", takes: 3, seconds: 2,
    prompt: "A robot's weapon assembly failing catastrophically: steel tearing, a bolt shearing, a heavy component snapping free and clanging to the floor. Violent mechanical destruction." },
  { id: "damage/part_break_drive", takes: 3, seconds: 2,
    prompt: "A robot's drivetrain being destroyed: a gearbox stripping with a grinding crunch, a motor seizing, a wheel assembly tearing loose and clattering." },
  { id: "damage/debris_clatter", takes: 4, seconds: 1.5,
    prompt: "Small pieces of broken metal and torn armour scattering and bouncing across a steel floor. Bright, irregular tumbling clatter dying away." },
  { id: "damage/sparks", takes: 4, seconds: 1,
    prompt: "A shower of sparks from steel grinding on steel: a bright crackling sizzle with fine spitting transients. Thin and high-frequency." },
  { id: "damage/smoke_hiss", takes: 2, seconds: 2.5,
    prompt: "A damaged electric motor venting smoke: an electrical crackle, a rising hiss and a faint acrid sputter." },
  { id: "hazard/killsaw_launch", takes: 3, seconds: 1.5,
    prompt: "A spinning arena kill saw catching a heavy robot and hurling it into the air: a violent metallic catch and shriek, then the whoosh of mass being thrown." },
  { id: "hazard/killsaw_deploy", takes: 1, seconds: 2,
    prompt: "Large industrial saw blades rising up through slots in a steel arena floor: hydraulic actuators driving, heavy panels sliding open, blade whine spinning up. Mechanical and threatening." },

  // --- 6. Match callouts and crowd (EV.MATCH) -------------------------------
  { id: "match/countdown_beep", takes: 1, seconds: 0.6, influence: 0.7,
    prompt: "A single short electronic countdown beep, a clean mid-pitched tone like a stadium start timer. One beep only." },
  { id: "match/countdown_beep_final", takes: 1, seconds: 0.8, influence: 0.7,
    prompt: "A single longer higher-pitched electronic countdown tone signalling the start of a match. Clean and urgent. One tone only." },
  { id: "match/results_sting", takes: 1, seconds: 2.5, influence: 0.5,
    prompt: "A short broadcast sting closing out a fight: an industrial metallic hit with a low sub-drop and a brief tail. No melody, no music bed. Punchy." },
  { id: "crowd/cheer_big", takes: 3, seconds: 5, roomy: true, influence: 0.4,
    prompt: "A large indoor arena crowd erupting into a huge cheer and roar after a spectacular hit, building fast then settling. A few thousand people, no chanting, no music, no announcer. Roomy." },
  { id: "crowd/gasp", takes: 2, seconds: 3, roomy: true, influence: 0.4,
    prompt: "A large arena crowd drawing a collective gasp and letting out a scattered ooh at a near miss. A few thousand people, no cheering, no music, no announcer. Roomy." },

  // Announcer voice. The text-to-sound model is not a speech model and this key
  // has no text_to_speech permission, so these are APPROXIMATIONS — they are
  // generated but left out of the runtime manifest (optional: true) until a
  // human take or a real TTS render replaces them. See public/sfx/vo/README.md.
  { id: "vo/three", takes: 1, seconds: 1, optional: true, influence: 0.3,
    prompt: "A male sports announcer shouting the single word THREE into a stadium microphone, hyped robot combat commentator." },
  { id: "vo/two", takes: 1, seconds: 1, optional: true, influence: 0.3,
    prompt: "A male sports announcer shouting the single word TWO into a stadium microphone, hyped robot combat commentator." },
  { id: "vo/one", takes: 1, seconds: 1, optional: true, influence: 0.3,
    prompt: "A male sports announcer shouting the single word ONE into a stadium microphone, hyped robot combat commentator." },
  { id: "vo/fight", takes: 2, seconds: 1.5, optional: true, influence: 0.3,
    prompt: "A male sports announcer screaming the single word FIGHT into a stadium microphone, hyped robot combat commentator." },
  { id: "vo/killsaws", takes: 2, seconds: 1.5, optional: true, influence: 0.3,
    prompt: "A male sports announcer shouting the words KILL SAWS into a stadium microphone, hyped robot combat commentator." },
  { id: "vo/ko", takes: 2, seconds: 1.5, optional: true, influence: 0.3,
    prompt: "A male sports announcer screaming the single word KNOCKOUT into a stadium microphone, hyped robot combat commentator." },
  { id: "vo/time", takes: 1, seconds: 1.2, optional: true, influence: 0.3,
    prompt: "A male sports announcer shouting the single word TIME into a stadium microphone, hyped robot combat commentator." },

  // --- 7. UI -----------------------------------------------------------------
  { id: "ui/nav_move", takes: 2, seconds: 0.5, influence: 0.7,
    prompt: "A very short quiet mechanical user interface tick for moving a menu selection, a small metallic relay click with a faint electronic edge. Crisp and tiny." },
  { id: "ui/confirm", takes: 1, seconds: 0.6, influence: 0.7,
    prompt: "A short positive mechanical interface confirmation: a solid switch clunk with a brief bright electronic accent. Industrial." },
  { id: "ui/back", takes: 1, seconds: 0.6, influence: 0.7,
    prompt: "A short low mechanical interface cancel sound: a muted switch clunk with a slight downward electronic sweep." },
  { id: "ui/bot_hover", takes: 2, seconds: 0.5, influence: 0.7,
    prompt: "A quiet electronic hover blip with a faint metallic scrape underneath, like a targeting reticle settling on a machine. Short." },
  { id: "ui/bot_lock", takes: 1, seconds: 1, influence: 0.6,
    prompt: "A heavy mechanical lock engaging: a servo whir, a solid metal clamp thunking closed and a confirming electronic tone. Industrial." },
  { id: "ui/bot_unlock", takes: 1, seconds: 0.8, influence: 0.6,
    prompt: "A mechanical clamp releasing: a metal latch popping open with a short pneumatic hiss." },
  { id: "ui/fight_button", takes: 1, seconds: 2, influence: 0.5,
    prompt: "A dramatic interface transition into a fight: a rising mechanical whoosh, heavy steel doors slamming and a deep sub-bass impact. Aggressive and broadcast styled." },
  { id: "ui/pad_connect", takes: 1, seconds: 0.8, influence: 0.7,
    prompt: "A short two-note ascending electronic chime signalling a game controller connecting. Clean, synthetic and friendly." },
  { id: "ui/toggle", takes: 1, seconds: 0.5, influence: 0.7,
    prompt: "A small physical toggle switch flipping, a crisp plastic and metal click. Very short." },
  { id: "ui/error", takes: 1, seconds: 0.6, influence: 0.7,
    prompt: "A short low blunt electronic error buzz, dull and unmelodic, not harsh." },
  { id: "ui/loading_done", takes: 1, seconds: 1.2, influence: 0.6,
    prompt: "A short industrial ready signal: a pressurised hiss releasing, a solid metallic clunk and a clean confirming tone." },
];

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const onlyIndex = args.indexOf("--only");
const ONLY = onlyIndex >= 0 ? args[onlyIndex + 1] : null;

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error("ELEVENLABS_API_KEY is not set.");
  process.exit(1);
}

const exists = (p) => access(p).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let creditsSpent = 0;
let generated = 0;
let skipped = 0;
const failures = [];

/** One generation, with retry/backoff on rate limits and transient failures. */
async function generate(entry, take, path) {
  const body = {
    text: entry.roomy ? entry.prompt : `${entry.prompt} ${DRY}`,
    model_id: MODEL,
    duration_seconds: entry.seconds,
    prompt_influence: entry.influence ?? 0.6,
    output_format: FORMAT,
  };
  if (entry.loop) body.loop = true;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (attempt) await sleep(2000 * 2 ** (attempt - 1));
    let res;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      console.warn(`  retry ${entry.id} take ${take}: ${err.message}`);
      continue;
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.warn(`  retry ${entry.id} take ${take}: HTTP ${res.status} ${detail.slice(0, 160)}`);
      // 4xx that is not a rate limit will not fix itself.
      if (res.status !== 429 && res.status >= 400 && res.status < 500) break;
      continue;
    }
    const cost = Number(res.headers.get("character-cost") || 0);
    creditsSpent += Number.isFinite(cost) ? cost : 0;
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(path, buf);
    generated += 1;
    console.log(`  ok ${path.replace(`${ROOT}/`, "")} (${(buf.length / 1024).toFixed(0)} KB, ${cost} credits)`);
    return true;
  }
  failures.push(`${entry.id} take ${take}`);
  return false;
}

/** Run tasks with a small concurrency cap — the API is happier and a failure
 *  storm stays small enough to read. */
async function pool(tasks, limit = 4) {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await queue.shift()();
  });
  await Promise.all(workers);
}

const entries = MANIFEST.filter((e) => !ONLY || e.id.includes(ONLY));
const tasks = [];

for (const entry of entries) {
  const [dir, name] = entry.id.split("/");
  await mkdir(join(OUT_DIR, dir), { recursive: true });
  const takes = entry.takes ?? 1;
  for (let take = 1; take <= takes; take += 1) {
    const file = takes > 1 ? `${name}_${take}.mp3` : `${name}.mp3`;
    const path = join(OUT_DIR, dir, file);
    if (!FORCE && (await exists(path))) {
      skipped += 1;
      continue;
    }
    tasks.push(() => generate(entry, take, path));
  }
}

console.log(`${entries.length} entries, ${tasks.length} files to generate, ${skipped} already present.`);
await pool(tasks);

// The runtime index: id -> files actually on disk. Written from a directory
// listing rather than from the manifest, so a partial run produces a manifest
// the game can still load (missing ids fall back to synthesis).
const index = {};
for (const entry of MANIFEST) {
  if (entry.optional) continue;
  const [dir, name] = entry.id.split("/");
  const listing = await readdir(join(OUT_DIR, dir)).catch(() => []);
  const files = listing
    .filter((f) => f === `${name}.mp3` || new RegExp(`^${name}_\\d+\\.mp3$`).test(f))
    .sort()
    .map((f) => `${dir}/${f}`);
  if (files.length) index[entry.id] = { files, loop: !!entry.loop };
}
await writeFile(join(OUT_DIR, "manifest.json"), `${JSON.stringify(index, null, 2)}\n`);

console.log(`\ngenerated ${generated}, skipped ${skipped}, failed ${failures.length}`);
if (failures.length) console.log(`failed: ${failures.join(", ")}`);
console.log(`manifest: ${Object.keys(index).length} ids`);
console.log(`credits spent this run: ${creditsSpent}`);
