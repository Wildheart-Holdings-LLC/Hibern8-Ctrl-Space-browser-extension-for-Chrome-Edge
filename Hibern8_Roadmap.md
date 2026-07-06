# Hibern8 — Future Iterations Roadmap

Status of the requested items. ✅ = shipped this iteration · 🔜 = planned (scoped below) · ⚠️ = constraint to resolve.

---

## ✅ Open in new window
A "⧉ Open in window" toolbar button opens the command center as its own standalone popup-type
window (`chrome.windows.create({ type: "popup" })`), so it persists independently of the launching tab.
Shipped in both the Chrome/Edge and Firefox builds.

## ✅ Numeric-aware alphabetizing (0–9 then A–Z)
Sorting now uses `localeCompare(..., { numeric: true })`, so each section orders digits before letters
and sorts naturally ("2" before "10"). Applies to every section that honors the Sort selector.
Shipped in both builds.

---

## ⚠️ "Shift+Esc" button to open the Browser Task Manager — NOT POSSIBLE from an extension
There is no extension API to open Chrome/Edge's Task Manager, and a web/extension page cannot dispatch
the real `Shift+Esc` browser shortcut (only trusted, browser-level input can). So a button labeled to
"open the Task Manager" can't actually do it on Chromium — it would be a dead button.

What we do instead / options:
- The Help panel and the "Proof" banner already instruct the user to press **Shift+Esc** (Chrome/Edge).
- **Firefox:** `about:performance` is a real page; a button could attempt `tabs.create({ url: "about:performance" })`
  (subject to Firefox allowing extension navigation to that about: page — needs testing).
- Best honest UX: a small "How to check real memory" hint/tooltip rather than a button that implies it can launch the tool.

Tell me which of those you'd like and I'll wire it up.

---

## 🔜 User-adjustable color palettes (full spectrum)
Plan: add an **accent color picker** (HTML color input or a hue slider, 0–360°) to the Settings page.
On change, derive a small coherent palette from the chosen hue (accent + complementary highlight) and
apply it by overriding the CSS custom properties (`--accent`, `--accent2`, etc.); persist the choice in
`storage.local` and re-apply on load, layered on top of the existing Auto/Light/Dark theme.
Effort: medium. Decision needed: single accent hue (simple, safe contrast) vs. multiple independently
editable swatches (more control, but easy to create unreadable combinations — would need a contrast guard).

## 🔜 Per-window explorer ordering: recently viewed → active → hibernated → recently hibernated
Plan: bucket each window's "Explore tabs" list into those four groups, in that order.
- *Recently viewed* and *recently hibernated* require recency timestamps. Awake tabs already expose
  `lastAccessed`; for "recently hibernated" we'd record a `discardedAt` time when we hibernate a tab.
- ⚠️ Conflict to confirm: an earlier request was to list the **active tab first**. The new order puts
  "recently viewed" first and "active" second. I'll implement whichever you confirm — likely
  **Active → recently viewed → hibernated → recently hibernated** reads best, but it's your call.
Effort: medium.

## 🔜 Language setting — 10 major languages
Plan: a language selector backed by the WebExtensions `_locales` system (or an in-app string table),
persisted, defaulting to the browser locale. Proposed set (markets where Google/Microsoft operate widely):
1. English  2. Spanish  3. Chinese (Simplified)  4. Hindi  5. Arabic  6. Portuguese  7. Russian
8. Japanese  9. German  10. French.
Notes: **Arabic is right-to-left** — the layout needs an RTL pass (`dir="rtl"`, mirrored controls).
Effort: large — it means externalizing every UI string and producing 9 translation sets; machine
translation is a starting point but a native review is advisable before any public release. Confirm the
language list and whether machine-translated strings are acceptable for the initial release.

---

## Suggested order to build next
1. Color palettes (self-contained, high visible value).
2. Explorer ordering (small, once the active-first question is settled).
3. Language setting (largest; do last, after the UI strings are final so they aren't translated twice).
