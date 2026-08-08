// Shared "please wait" overlay (#asset-loader in index.html).
//
// createLoader() -> { show, setTitle, setDetail, setProgress, hide, isOpen }
//
// Pure DOM, no three/rapier/sim imports (see ARCHITECTURE.md layering). The
// integrator drives it around anything the player has to wait on — chiefly
// startMatch(), which pulls two 10-17MB GLBs and boots the physics engine.
//
// setProgress(null) switches the bar to an indeterminate sweep, which is what
// you want when the response has no usable content-length (GLBs served with
// transfer-encoding: chunked, e.g. behind gzip).

import { t } from "./text.js";

export function createLoader({ root = document } = {}) {
  const el = root.getElementById?.("asset-loader") || root.querySelector?.("#asset-loader") || null;
  const titleEl = el?.querySelector("#asset-loader-title") || null;
  const detailEl = el?.querySelector("#asset-loader-detail") || null;
  const barEl = el?.querySelector("#asset-loader-bar") || null;
  const fillEl = el?.querySelector("#asset-loader-fill") || null;
  const pctEl = el?.querySelector("#asset-loader-pct") || null;

  let open = false;
  let hideTimer = null;

  function setTitle(text) {
    if (titleEl) titleEl.textContent = String(text ?? "").toUpperCase();
  }

  function setDetail(text) {
    if (detailEl) detailEl.textContent = text ? String(text) : "";
  }

  /** @param {number|null} value 0..1, or null for "unknown duration". */
  function setProgress(value) {
    const known = typeof value === "number" && Number.isFinite(value);
    barEl?.classList.toggle("loader-bar-indeterminate", !known);
    if (!known) {
      if (fillEl) fillEl.style.transform = "";
      if (pctEl) pctEl.textContent = "";
      return;
    }
    const clamped = Math.min(1, Math.max(0, value));
    if (fillEl) fillEl.style.transform = `scaleX(${clamped.toFixed(4)})`;
    if (pctEl) pctEl.textContent = `${Math.round(clamped * 100)}%`;
  }

  function show({ title = t("loading.title"), detail = "", progress = null } = {}) {
    if (!el) return;
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
    setTitle(title);
    setDetail(detail);
    setProgress(progress);
    el.hidden = false;
    void el.offsetWidth; // flush styles so the fade-in transition runs
    el.classList.add("is-open");
    open = true;
  }

  function hide() {
    if (!el || !open) return;
    open = false;
    el.classList.remove("is-open");
    hideTimer = setTimeout(() => {
      el.hidden = true;
      hideTimer = null;
      // Reset so the next show() never flashes the previous run's bar.
      setProgress(null);
      setDetail("");
    }, 300);
  }

  return { show, hide, setTitle, setDetail, setProgress, isOpen: () => open };
}
