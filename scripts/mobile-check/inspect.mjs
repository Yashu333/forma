// Functions run inside the page with `page.evaluate(fn, arg)` or
// `context.addInitScript(fn, arg)`. Each must be self-contained (Playwright
// sends the source text, not the closure), which is why the small helpers
// below are repeated inside each function.

/**
 * Init script: watches the page while it loads (every animation frame for the
 * first 10 s) and remembers the worst element sticking out past the right edge
 * whenever the document overflows.
 *
 * Why: a phone zooms the page out to fit content wider than the screen and
 * may stay zoomed out after that content shrinks again (a fallback, a
 * skeleton, a late layout pass). The document then still overflows at check
 * time while no element sticks out any more. This record names the culprit.
 */
export function recordOverflow(viewportWidth) {
  const vw = viewportWidth;
  const seen = { first: null, worst: null };
  window.__mobileCheckOverflow = seen;
  const describe = (el, r) => {
    const cls = typeof el.className === "string" ? el.className : el.getAttribute("class") || "";
    const parents = [];
    for (let p = el.parentElement; p && p !== document.body && parents.length < 3; p = p.parentElement) {
      const pc = typeof p.className === "string" ? p.className : p.getAttribute("class") || "";
      parents.push(`${p.tagName.toLowerCase()}${pc ? "." + pc.trim().split(/\s+/).slice(0, 6).join(".") : ""}`);
    }
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: cls.trim().replace(/\s+/g, " ").slice(0, 160),
      style: (el.getAttribute("style") || "").slice(0, 120) || undefined,
      width: Math.round(r.width),
      left: Math.round(r.left),
      right: Math.round(r.right),
      overflowBy: Math.round(r.right - vw),
      text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40) || undefined,
      parents: parents.join(" < ") || undefined,
    };
  };
  const check = () => {
    const root = document.documentElement;
    if (root && document.body && root.scrollWidth > vw + 1) {
      let best = null;
      let bestDepth = 0;
      for (const el of document.body.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.right <= vw + 1 || r.width === 0) continue;
        let depth = 0;
        for (let p = el; p; p = p.parentElement) depth++;
        if (!best || r.right > best.r.right + 0.5 || (Math.abs(r.right - best.r.right) <= 0.5 && depth < bestDepth)) {
          best = { el, r };
          bestDepth = depth;
        }
      }
      if (best) {
        const d = { ...describe(best.el, best.r), atMs: Math.round(performance.now()), docScrollWidth: root.scrollWidth };
        if (!seen.first) seen.first = d;
        if (!seen.worst || d.right > seen.worst.right) seen.worst = d;
      }
    }
  };
  const tick = () => {
    check();
    if (performance.now() < 10000) requestAnimationFrame(tick);
  };
  // Once per frame only: checking on every DOM change forces extra layouts
  // while the page parses, which changes whether the phone zooms out at all
  // (the probe would hide the very overflow it is looking for).
  requestAnimationFrame(tick);
}

/**
 * Horizontal overflow check (SPEC P0): the document and `main` must satisfy
 * scrollWidth <= viewport width + 1. Also names the worst offending elements:
 * ones whose box sticks out past the right edge and that aren't safely inside
 * their own horizontal scroller.
 *
 * `viewportWidth` is the device width the context was opened with. It is used
 * instead of the live `window.innerWidth`: on a mobile viewport, Chrome (like a
 * real phone) zooms out to fit a page wider than the screen, and innerWidth
 * grows to match the page, so `scrollWidth <= innerWidth` would always pass.
 */
export function checkOverflow(viewportWidth) {
  const vw = Math.min(viewportWidth || window.innerWidth, window.innerWidth, document.documentElement.clientWidth || Infinity);
  const doc = document.documentElement.scrollWidth;
  const mainEl = document.querySelector("main");
  const main = mainEl ? mainEl.scrollWidth : null;
  const overflow = doc > vw + 1 || (main !== null && main > vw + 1);

  const depthOf = (el) => {
    let d = 0;
    for (let p = el; p; p = p.parentElement) d++;
    return d;
  };
  const describe = (el) => {
    const r = el.getBoundingClientRect();
    const cls = typeof el.className === "string" ? el.className : el.getAttribute("class") || "";
    const text = (el.innerText || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 40);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || undefined,
      classes: cls.trim().replace(/\s+/g, " ").slice(0, 160),
      width: Math.round(r.width),
      left: Math.round(r.left),
      right: Math.round(r.right),
      overflowBy: Math.round(r.right - vw),
      text: text || undefined,
    };
  };

  // An element is fine if some ancestor between it and <main>/<body> scrolls
  // or clips horizontally and itself fits in the viewport.
  const contained = (el) => {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement && p !== mainEl; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox !== "visible" && p.getBoundingClientRect().right <= vw + 1) return true;
    }
    return false;
  };

  const offenders = [];
  if (overflow) {
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right <= vw + 1) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      if (contained(el)) continue;
      offenders.push({ el, overflow: r.right - vw, depth: depthOf(el) });
    }
  }
  // Worst first: furthest past the edge; among equals the outermost element,
  // since its children just inherit its width.
  offenders.sort((a, b) => b.overflow - a.overflow || a.depth - b.depth);
  // Skip offenders whose ancestor is already listed with the same overflow.
  const picked = [];
  for (const o of offenders) {
    if (picked.some((p) => p.el.contains(o.el) && Math.abs(p.overflow - o.overflow) < 1)) continue;
    picked.push(o);
    if (picked.length === 5) break;
  }
  // Nothing visible sticks out: look again with no filters, since hidden,
  // zero-height and contained boxes still add to scrollWidth.
  if (overflow && picked.length === 0) {
    let best = null;
    for (const el of document.body.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && (!best || r.right > best.right || (r.right === best.right && depthOf(el) < best.depth))) {
        best = { el, right: r.right, depth: depthOf(el) };
      }
    }
    if (best) {
      const cs = getComputedStyle(best.el);
      picked.push({ el: best.el, note: `found with filters off (visibility ${cs.visibility}, opacity ${cs.opacity}, position ${cs.position})` });
    }
  }

  // Info only (not part of the SPEC pass/fail): visible elements the user can
  // scroll sideways (overflow-x auto/scroll with wider content). A page's
  // `overflow-y-auto` wrapper also gets overflow-x auto, so a too-wide child
  // scrolls inside it and the document/main check can't see it. Intentional
  // sideways scrollers (the board) show up here too.
  const sideScrollers = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (el.scrollWidth <= el.clientWidth + 1 || el.clientWidth === 0) continue;
    const cs = getComputedStyle(el);
    if ((cs.overflowX !== "auto" && cs.overflowX !== "scroll") || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.right <= 0 || r.left >= vw || r.height === 0) continue;
    sideScrollers.push({ ...describe(el), overflowX: cs.overflowX, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
  }

  return {
    viewportWidth: vw,
    zoomedInnerWidth: window.innerWidth,
    docScrollWidth: doc,
    mainScrollWidth: main,
    overflow,
    offenders: picked.map((o) => ({ ...describe(o.el), ...(o.note ? { note: o.note } : {}) })),
    // What overflowed while the page loaded (see recordOverflow).
    duringLoad: window.__mobileCheckOverflow?.worst ?? null,
    sideScrollers,
  };
}

/**
 * Visible interactive elements smaller than `min` CSS px in either direction
 * (a warning, not a failure: the target is 44px, dense controls may go to 32).
 */
export function smallTargets({ min, viewportWidth, viewportHeight }) {
  // Device size, not innerWidth/innerHeight (see checkOverflow).
  const vw = viewportWidth || window.innerWidth;
  const vh = viewportHeight || window.innerHeight;
  const sel = [
    "a[href]",
    "button",
    "input:not([type=hidden])",
    "select",
    "textarea",
    "summary",
    "[role=button]",
    "[role=link]",
    "[role=tab]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=switch]",
    "[role=menuitem]",
    "[role=option]",
    "[tabindex]:not([tabindex='-1'])",
  ].join(",");
  const out = [];
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest("[aria-hidden=true], [inert]")) continue;
    if (el.disabled) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue; // off screen
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    if (r.width >= min && r.height >= min) continue;
    const label = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || el.getAttribute("placeholder") || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 40);
    const cls = typeof el.className === "string" ? el.className : el.getAttribute("class") || "";
    out.push({
      tag: el.tagName.toLowerCase(),
      label,
      width: Math.round(r.width),
      height: Math.round(r.height),
      classes: cls.trim().replace(/\s+/g, " ").slice(0, 100),
    });
  }
  return out;
}
