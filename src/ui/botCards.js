// UI presentation data for the bot select screen.
// The game layer's catalog (v2/src/assets/catalog.js) is the single source of
// physics truth; this file owns display copy only — names, taglines, weapon
// badges, 1-5 stat ratings, and accent colors. Ratings are editorial (lore +
// v1 tuning numbers), not simulation inputs.
//
// One exception: `stats.speed` is DERIVED from the catalog's maxSpeedFps, not
// editorial. It maps the sim speed linearly onto 1-5 over the roster's 5th-95th
// percentile (min-to-max spends a whole band on HyperShock, which is 5mph clear
// of the next bot, and flattens everyone else into the middle). Bots on the same
// sim speed therefore carry the same rating, and tools/sim-tests.mjs asserts the
// two orderings never disagree — a card that says a bot is quick when the sim
// says otherwise is a card that lies to the player at the one moment they are
// choosing.

/** @typedef {{
 *   id: string,
 *   name: string,
 *   tagline: string,
 *   weaponType: string,          // badge copy, e.g. "DRUM SPINNER"
 *   weaponClass: 'spinner'|'drum'|'flipper'|'crusher'|'hammerSaw'|'hammer'|'lifterDisc'|'lifter'|'grappler',
 *   stats: { speed: number, power: number, armor: number }, // 1-5
 *   accent: string,              // CSS color for card edge / glow
 *   image: string,               // resolved relative to v2/index.html
 * }} BotCard */

/** @type {BotCard[]} */
export const BOT_CARDS = [
  {
    id: "bronco",
    name: "Bronco",
    tagline: "One flip and you're flying.",
    weaponType: "PNEUMATIC FLIPPER",
    weaponClass: "flipper",
    stats: { speed: 2, power: 4, armor: 3 },
    accent: "#ff453a",
    image: "./public/reference/bronco.png",
  },
  {
    id: "biteforce",
    name: "Bite Force",
    tagline: "Champion pedigree. Zero mercy.",
    weaponType: "VERTICAL SPINNER",
    weaponClass: "spinner",
    stats: { speed: 2, power: 5, armor: 5 },
    accent: "#9fc2ff",
    image: "./public/reference/biteforce.png",
  },
  {
    id: "huge",
    name: "HUGE",
    tagline: "Too tall to hit. Too weird to stop.",
    weaponType: "OVERHEAD BAR",
    weaponClass: "spinner",
    stats: { speed: 3, power: 3, armor: 4 },
    accent: "#58a6ff",
    image: "./public/reference/huge.png",
  },
  {
    id: "quantum",
    name: "Quantum",
    tagline: "Bites through armor like foil.",
    weaponType: "HYDRAULIC CRUSHER",
    weaponClass: "crusher",
    stats: { speed: 2, power: 5, armor: 4 },
    accent: "#4d7cff",
    image: "./public/reference/quantum.png",
  },
  {
    id: "hypershock",
    name: "Hypershock",
    tagline: "Miami speed. Maximum chaos.",
    weaponType: "VERTICAL SPINNER",
    weaponClass: "spinner",
    stats: { speed: 5, power: 4, armor: 2 },
    accent: "#8aff3d",
    image: "./public/reference/hypershock.png",
  },
  {
    id: "minotaur",
    name: "Minotaur",
    tagline: "The drum that never stops.",
    weaponType: "DRUM SPINNER",
    weaponClass: "spinner",
    stats: { speed: 4, power: 5, armor: 3 },
    accent: "#ff9a3d",
    image: "./public/reference/minotaur.png",
  },
  {
    id: "sawblaze",
    name: "SawBlaze",
    tagline: "Scoop first. Then the fire saw.",
    weaponType: "HAMMER SAW",
    weaponClass: "hammerSaw",
    stats: { speed: 2, power: 3, armor: 4 },
    accent: "#45ff9c",
    image: "./public/reference/sawblaze.png",
  },
  {
    id: "tombstone",
    name: "Tombstone",
    tagline: "The most feared bar in the sport.",
    weaponType: "HORIZONTAL BAR",
    weaponClass: "spinner",
    stats: { speed: 2, power: 5, armor: 2 },
    accent: "#c8ccd4",
    image: "./public/reference/tombstone.png",
  },
  {
    id: "beta",
    name: "Beta",
    tagline: "Comes in from the top.",
    weaponType: "OVERHEAD HAMMER",
    weaponClass: "hammer",
    stats: { speed: 2, power: 5, armor: 4 },
    accent: "#d8dbe0",
    image: "./public/reference/beta.png",
  },
  {
    id: "whiplash",
    name: "Whiplash",
    tagline: "Lift them, then bury the disc.",
    weaponType: "LIFTER + DISC",
    weaponClass: "lifterDisc",
    stats: { speed: 3, power: 3, armor: 3 },
    accent: "#d8e021",
    image: "./public/reference/whiplash.png",
  },
  {
    id: "clawviper",
    name: "Claw Viper",
    tagline: "Grab, lift, suplex.",
    weaponType: "GRAPPLING CLAW",
    weaponClass: "grappler",
    stats: { speed: 4, power: 3, armor: 4 },
    accent: "#3355cc",
    image: "./public/reference/clawviper.png",
  },
  {
    id: "deepsix",
    name: "Deep Six",
    tagline: "Banned for hitting too hard.",
    weaponType: "GIANT VERTICAL BAR",
    weaponClass: "bar",
    stats: { speed: 2, power: 5, armor: 2 },
    accent: "#b1642f",
    image: "./public/reference/deepsix.png",
  },
  {
    id: "hydra",
    name: "Hydra",
    tagline: "Sends them to the ceiling.",
    weaponType: "HYDRAULIC FLIPPER",
    weaponClass: "flipper",
    stats: { speed: 4, power: 5, armor: 4 },
    accent: "#6b3fa0",
    image: "./public/reference/hydra.png",
  },
  {
    id: "blip",
    name: "Blip",
    tagline: "Flywheel launcher. Straight to the ceiling.",
    weaponType: "FLYWHEEL FLIPPER",
    weaponClass: "flipper",
    stats: { speed: 4, power: 4, armor: 3 },
    accent: "#2f6fd0",
    image: "./public/reference/blip.png",
  },
  {
    id: "copperhead",
    name: "Copperhead",
    tagline: "Fifty pounds of copper drum.",
    weaponType: "DRUM SPINNER",
    weaponClass: "drum",
    stats: { speed: 3, power: 4, armor: 4 },
    accent: "#c1743a",
    image: "./public/reference/copperhead.png",
  },
  {
    id: "duck",
    name: "Duck",
    tagline: "Never counted out.",
    weaponType: "LIFTING BEAK",
    weaponClass: "lifter",
    stats: { speed: 3, power: 2, armor: 5 },
    accent: "#d8b62c",
    image: "./public/reference/duck.png",
  },
  {
    id: "endgame",
    name: "Endgame",
    tagline: "Teardrop disc, and it never misses twice.",
    weaponType: "VERTICAL DISC",
    weaponClass: "drum",
    stats: { speed: 4, power: 5, armor: 4 },
    accent: "#e8502a",
    image: "./public/reference/endgame.png",
  },
  {
    id: "freeshipping",
    name: "Free Shipping",
    tagline: "Forklift in front, flame out the back.",
    weaponType: "FORKLIFT + FLAME",
    weaponClass: "lifter",
    stats: { speed: 3, power: 3, armor: 3 },
    accent: "#d94b2b",
    image: "./public/reference/freeshipping.png",
  },
  {
    id: "mammoth",
    name: "Mammoth",
    tagline: "Drive in if you dare.",
    weaponType: "HIGH DISC ON A TRUSS",
    weaponClass: "spinner",
    stats: { speed: 5, power: 2, armor: 5 },
    accent: "#8a5a2c",
    image: "./public/reference/mammoth.png",
  },
  {
    id: "overhaul",
    name: "Overhaul",
    tagline: "Grab it, lift it, hold it.",
    weaponType: "GRAPPLING FORKS",
    weaponClass: "grappler",
    stats: { speed: 3, power: 3, armor: 4 },
    accent: "#cf3b3b",
    image: "./public/reference/overhaul.png",
  },
  {
    id: "shatter",
    name: "Shatter",
    tagline: "One hammer, straight down.",
    weaponType: "OVERHEAD HAMMER",
    weaponClass: "hammer",
    stats: { speed: 3, power: 4, armor: 3 },
    accent: "#8f6fd0",
    image: "./public/reference/shatter.png",
  },
  {
    id: "tantrum",
    name: "Tantrum",
    tagline: "Drum up front, fists on top.",
    weaponType: "DRUM + PUNCH ARMS",
    weaponClass: "drum",
    stats: { speed: 3, power: 3, armor: 4 },
    accent: "#e2701f",
    image: "./public/reference/tantrum.png",
  },
  {
    id: "witchdoctor",
    name: "Witch Doctor",
    tagline: "Every season. Every time.",
    weaponType: "VERTICAL DISC",
    weaponClass: "drum",
    stats: { speed: 3, power: 4, armor: 3 },
    accent: "#7fd430",
    image: "./public/reference/witchdoctor.png",
  },
  {
    id: "glitch",
    name: "Glitch",
    tagline: "Always pointed at you.",
    weaponType: "EGGBEATER DRUM",
    weaponClass: "drum",
    stats: { speed: 2, power: 4, armor: 3 },
    accent: "#7b3fd4",
    image: "./public/reference/glitch.png",
  },
  {
    id: "gigabyte",
    name: "Gigabyte",
    tagline: "One hit is all it needs.",
    weaponType: "FULL-BODY SHELL",
    weaponClass: "spinner",
    stats: { speed: 2, power: 5, armor: 4 },
    accent: "#d94a1e",
    image: "./public/reference/gigabyte.png",
  },
  {
    id: "kraken",
    name: "Kraken",
    tagline: "Bite first. Then light them up.",
    weaponType: "CRUSHER + FLAME",
    weaponClass: "crusher",
    stats: { speed: 4, power: 3, armor: 3 },
    accent: "#3fa63f",
    image: "./public/reference/kraken.png",
  },
  {
    id: "rusty",
    name: "Rusty",
    tagline: "Held together by hope and a welded nut.",
    weaponType: "PNEUMATIC HAMMER",
    weaponClass: "hammer",
    stats: { speed: 1, power: 3, armor: 2 },
    accent: "#8a5a32",
    image: "./public/reference/rusty.png",
  },
  {
    id: "dragonking",
    name: "Dragon King",
    tagline: "Pin it, then cut it open.",
    weaponType: "TWIN SAWS + JAW",
    weaponClass: "hammerSaw",
    stats: { speed: 1, power: 3, armor: 4 },
    accent: "#e8b21e",
    image: "./public/reference/dragonking.png",
  },
];

/** Sentinel card for the "surprise me" opponent pick. */
export const RANDOM_CARD = Object.freeze({
  id: "random",
  name: "Random",
  tagline: "Sealed until the box locks.",
  weaponType: "MYSTERY OPPONENT",
  accent: "#ffd23d",
});

const byId = new Map(BOT_CARDS.map((c) => [c.id, c]));

/** @param {string} id @returns {BotCard|undefined} */
export function getBotCard(id) {
  return byId.get(id);
}

/**
 * Pick a concrete bot id at random, excluding `excludeId` (no mirror matches
 * from the Random slot — a deliberate booking decision).
 * @param {string|null} excludeId
 */
/**
 * @param {string|string[]|null} exclude ids already taken. A LIST, because with
 *   three or four players there is more than one machine Random must not hand
 *   you — passing an array used to compare it against a string and match
 *   nothing, so a four-way could roll a bot somebody else already had.
 */
export function pickRandomBotId(exclude = null) {
  const taken = new Set(Array.isArray(exclude) ? exclude : exclude ? [exclude] : []);
  const pool = BOT_CARDS.filter((c) => !taken.has(c.id));
  const list = pool.length ? pool : BOT_CARDS;
  return list[Math.floor(Math.random() * list.length)].id;
}
