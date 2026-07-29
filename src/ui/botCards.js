// UI presentation data for the bot select screen.
// The game layer's catalog (v2/src/assets/catalog.js) is the single source of
// physics truth; this file owns display copy only — names, taglines, weapon
// badges, 1-5 stat ratings, and accent colors. Ratings are editorial (lore +
// v1 tuning numbers), not simulation inputs.

/** @typedef {{
 *   id: string,
 *   name: string,
 *   tagline: string,
 *   weaponType: string,          // badge copy, e.g. "DRUM SPINNER"
 *   weaponClass: 'spinner'|'flipper'|'crusher'|'hammerSaw',
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
    stats: { speed: 3, power: 4, armor: 3 },
    accent: "#ff453a",
    image: "./public/reference/bronco.png",
  },
  {
    id: "biteforce",
    name: "Bite Force",
    tagline: "Champion pedigree. Zero mercy.",
    weaponType: "VERTICAL SPINNER",
    weaponClass: "spinner",
    stats: { speed: 3, power: 5, armor: 5 },
    accent: "#9fc2ff",
    image: "./public/reference/biteforce.png",
  },
  {
    id: "huge",
    name: "HUGE",
    tagline: "Too tall to hit. Too weird to stop.",
    weaponType: "OVERHEAD BAR",
    weaponClass: "spinner",
    stats: { speed: 1, power: 3, armor: 4 },
    accent: "#58a6ff",
    image: "./public/reference/huge.png",
  },
  {
    id: "quantum",
    name: "Quantum",
    tagline: "Bites through armor like foil.",
    weaponType: "HYDRAULIC CRUSHER",
    weaponClass: "crusher",
    stats: { speed: 3, power: 5, armor: 4 },
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
    stats: { speed: 3, power: 3, armor: 4 },
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
export function pickRandomBotId(excludeId = null) {
  const pool = BOT_CARDS.filter((c) => c.id !== excludeId);
  return pool[Math.floor(Math.random() * pool.length)].id;
}
