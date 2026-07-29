// Frozen contract — see v2/ARCHITECTURE.md. Do not edit without updating the doc.
// Central settings store: plain object reads in the frame loop, localStorage
// persistence, change notifications. No DOM access here.

const STORAGE_PREFIX = "bba2-";

const DEFAULTS = Object.freeze({
  soundEnabled: true,
  hapticsEnabled: true,
  cameraMode: "bot", // battle | bot | arena
  aiDifficulty: "normal", // easy | normal | hard
  showDamageEvents: true,
});

const listeners = new Map();

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export const settings = {};
for (const [key, value] of Object.entries(DEFAULTS)) settings[key] = load(key, value);

export function setSetting(key, value) {
  if (!(key in DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
  settings[key] = value;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  } catch {
    // Private browsing: in-session value still applies.
  }
  listeners.get(key)?.forEach((fn) => fn(value));
}

export function onSettingChanged(key, fn) {
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(fn);
  return () => listeners.get(key).delete(fn);
}
