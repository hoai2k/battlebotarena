// Every user-facing string comes from CONFIG.text through here.
//
// Two ways in, and which one a piece of copy uses depends on whether it is
// STATIC (it is on the screen from the moment the markup parses) or DYNAMIC
// (the game decides it at run time):
//
//   static   mark it up as <span data-text-key="title.play">ENTER THE ARENA</span>
//            and applyStaticText() fills it in at start-up. The copy in the
//            HTML stays as the fallback, so a typo'd key shows the old wording
//            rather than an empty screen.
//   dynamic  t("results.finalDamage", { scores }) at the point of use.
//
// Substitution is {braces}. A brace with no matching value is left alone —
// visible, so it is obvious something was renamed — and a template that drops
// its braces entirely just loses the number, which is a legitimate edit.

import { CONFIG } from "../config.js";

/** Walk a dot path into CONFIG.text. Returns undefined for an unknown key. */
function lookup(path) {
  return String(path).split(".").reduce((node, key) => (
    node && typeof node === "object" ? node[key] : undefined
  ), CONFIG.text);
}

export function fill(template, values) {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => (
    key in values ? String(values[key]) : match
  ));
}

/**
 * Copy for `path`, with `{braces}` filled from `values`.
 *
 * @param {string} path dot path into CONFIG.text, e.g. "hud.fightFlash"
 * @param {Record<string, string|number>} [values]
 * @param {string} [fallback] returned when the key is missing
 */
export function t(path, values, fallback = "") {
  const value = lookup(path);
  if (typeof value !== "string") return fallback;
  return fill(value, values);
}

/**
 * Fill every `[data-text-key]` element under `root` from CONFIG.text.
 *
 * Some copy is deliberately two lines (`PICK<br />YOUR BOT`), so keys whose
 * value contains markup are written as HTML. Config is authored in this repo,
 * not fetched, which is what makes that safe here.
 */
export function applyStaticText(root = document) {
  root.querySelectorAll?.("[data-text-key]").forEach((el) => {
    const value = lookup(el.dataset.textKey);
    if (typeof value !== "string") return;
    const attr = el.dataset.textAttr;
    if (attr) el.setAttribute(attr, value);
    else if (value.includes("<")) el.innerHTML = value;
    else el.textContent = value;
  });
  const title = lookup("documentTitle");
  if (typeof title === "string" && root === document) document.title = title;
}
