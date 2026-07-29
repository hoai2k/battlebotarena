// Screen manager: toggles the four DOM screen sections with CSS transitions.
// Screens are <section data-screen-name="..."> elements; visibility is pure
// CSS driven by the `is-active` class (opacity/transform/visibility), so the
// manager itself stays a few lines of class bookkeeping.

/**
 * @param {{ root?: Document|HTMLElement, initial?: string|null }} [opts]
 * @returns {{ goTo(name: string): void, current(): string|null, has(name: string): boolean }}
 */
export function createScreens({ root = document, initial = null } = {}) {
  /** @type {Map<string, HTMLElement>} */
  const sections = new Map();
  root.querySelectorAll("[data-screen-name]").forEach((el) => {
    sections.set(el.dataset.screenName, /** @type {HTMLElement} */ (el));
  });

  /** @type {string|null} */
  let current = null;

  function goTo(name) {
    const next = sections.get(name);
    if (!next) {
      console.warn(`[screens] unknown screen "${name}"`);
      return;
    }
    if (name === current) return;
    sections.forEach((el, key) => {
      const active = key === name;
      el.classList.toggle("is-active", active);
      el.setAttribute("aria-hidden", active ? "false" : "true");
    });
    // Lets CSS restyle globals per screen (canvas dim, body backdrop, etc.).
    document.body.dataset.screen = name;
    current = name;
  }

  if (initial) goTo(initial);

  return {
    goTo,
    current: () => current,
    has: (name) => sections.has(name),
  };
}
