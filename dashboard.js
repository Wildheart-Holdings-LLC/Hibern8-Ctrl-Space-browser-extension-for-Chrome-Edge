/* ============================================================
   Hibern8 — dashboard logic (real tab hibernation)
   Uses chrome.tabs.discard() — the browser's native mechanism
   for unloading a tab and releasing its working memory.
   ============================================================ */

const EST_MB_PER_TAB = 220;   // illustrative estimate only; Task Manager shows the truth
const EST_W_PER_TAB = 0.5;    // representative continuous background power a live tab would draw (W)

// Translate the instantaneous watts saved into relatable, everyday terms.
// Continuous watts -> kWh/year (W * 24 * 365 / 1000). Reference values are typical, illustrative.
function updatePowerRel(dormCount) {
  const el = document.getElementById("powerRel");
  if (!el) return;
  const w = dormCount * EST_W_PER_TAB;
  if (w <= 0) { el.textContent = "hibernate tabs to start saving"; return; }
  const kwhYr = w * 8.76;                 // kWh per year if sustained
  const bulbs = w / 9;                    // ~9 W LED bulbs kept off
  const phones = (kwhYr * 1000) / 12;     // ~12 Wh per full phone charge
  const evMiles = kwhYr / 0.30;           // EV at ~0.30 kWh per mile (~3.3 mi/kWh)
  const fmt = (n) => n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(n < 10 ? 1 : 0);
  el.textContent =
    `≈ ${fmt(bulbs)} LED bulb${bulbs >= 1.5 ? "s" : ""} off · ~${fmt(kwhYr)} kWh/yr ` +
    `≈ ${fmt(phones)} phone charges or ~${fmt(evMiles)} EV miles a year`;
}
let mode = "manual";          // manual | auto
let idleLimit = 60;           // seconds
let sortMode = "default";     // default | az | za
let accentHue = null;         // ROYGBIV custom hue 0-360 (null = use theme default accent)
let accentSat = null;         // accent saturation 0-100 (null = theme default; 0 = greyscale)
let autoUnmute = true;        // after Mute all, auto-unmute a tab when it becomes active / starts audio
const mutedByUs = new Set();  // tab ids muted by "Mute all" (only these are eligible for auto-unmute)
let selfTabId = null;         // this dashboard's own tab id (never hibernate it)
let selfWindowId = null;      // the window that holds this dashboard
const openWindows = new Set();// window ids whose "Explore tabs" dropdown is expanded (persists across re-renders)

const $ = (id) => document.getElementById(id);

const GROUP_COLORS = {
  grey: "#9aa0a6", blue: "#4f8cff", red: "#ff5d5d", yellow: "#ffcf4d",
  green: "#2ec47a", pink: "#ff5d8f", purple: "#7c5cff", cyan: "#3fc7d4", orange: "#ff9f43",
};
const TAB_GROUP_ID_NONE = -1;

/* ---- which tabs can we hibernate? ---- */
function isDiscardable(t) {
  if (t.id === selfTabId) return false;
  if (t.active) return false;
  if (t.discarded) return false;
  if (t.pinned) return false;
  if (t.audible) return false;  // skips audio + video-with-sound
  return /^https?:\/\//i.test(t.url || "");
}

/* ---- logging (in-memory only; entries auto-expire) ---- */
const LOG_TTL_MS = 10 * 60 * 1000;   // activity-log entries expire after 10 minutes
const LOG_MAX = 50;                  // and are hard-capped at this many
function log(msg, cls = "") {
  const el = $("log");
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const d = document.createElement("div");
  d.dataset.ts = String(Date.now());
  d.innerHTML = `<span class="time">${time}</span> <span class="${cls}">${msg}</span>`;
  el.prepend(d);
  while (el.children.length > LOG_MAX) el.removeChild(el.lastChild);
}
// Sweep expired log lines so nothing lingers on screen indefinitely.
function sweepLog() {
  const el = $("log"); if (!el) return;
  const now = Date.now();
  [...el.children].forEach((d) => { if (now - (+d.dataset.ts || now) > LOG_TTL_MS) d.remove(); });
}

/* ---- query helpers ---- */
async function getTabs() {
  const allWindows = $("allWindows").checked;
  const q = allWindows ? {} : { currentWindow: true };
  const tabs = await chrome.tabs.query(q);
  // Private-browsing tabs are intentionally excluded from the normal sections; only their
  // sound/video tabs surface (in getAudioTabs), and only bulk Mute all / Hibernate all act on them.
  return tabs.filter((t) => t.url && !t.url.startsWith(chrome.runtime.getURL("")) && !t.incognito);
}

// Every tab currently playing audio, across ALL windows (ignores the scope toggle).
async function getAudioTabs() {
  let list = [];
  try { list = await chrome.tabs.query({ audible: true }); } catch (e) {}
  // Private tabs are never shown in the command center; bulk Mute all / Hibernate all still act on them.
  return list.filter((t) => t.id !== selfTabId && t.url && !t.url.startsWith(chrome.runtime.getURL("")) && !t.incognito);
}

// Does the extension currently have access to private (incognito / InPrivate) windows?
function incognitoAllowed() {
  return new Promise((res) => {
    try { chrome.extension.isAllowedIncognitoAccess((a) => res(!!a)); } catch (e) { res(false); }
  });
}

/* ---- sort + grouping helpers ---- */
function tabKey(t) { return (t.title || host(t) || "").toLowerCase(); }
// numeric-aware compare: orders 0-9 before A-Z and sorts "2" before "10"
function cmpKey(a, b) { return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }); }
function sortTabs(list) {
  const a = [...list];
  if (sortMode === "az") a.sort((x, y) => cmpKey(tabKey(x), tabKey(y)));
  else if (sortMode === "za") a.sort((x, y) => cmpKey(tabKey(y), tabKey(x)));
  return a;
}
function colorDot(color) {
  return `<span class="cdot" style="background:${GROUP_COLORS[color] || "#9aa0a6"}"></span>`;
}
async function getGroups() {
  const map = {};
  try {
    if (typeof chrome.tabGroups === "undefined") return map;
    const groups = await chrome.tabGroups.query({});
    groups.forEach((g) => { map[g.id] = { title: g.title, color: g.color }; });
  } catch (e) { /* tabGroups unavailable */ }
  return map;
}

/* ---- favicon (safe DOM build) + helpers ---- */
// Favicons are served from the browser's OWN local cache (chrome _favicon API),
// so nothing is fetched from third-party hosts (no remote egress / referrer leak),
// and they load instantly which also reduces visual churn on refresh.
function applyFav(node, t) {
  if (!node) return;
  node.textContent = "";
  let src = "";
  try {
    const u = new URL(chrome.runtime.getURL("/_favicon/"));
    u.searchParams.set("pageUrl", t.url || "");
    u.searchParams.set("size", "32");
    src = u.toString();
  } catch (e) { /* fall back to letter */ }
  if (src) {
    const img = document.createElement("img");
    img.alt = "";
    img.decoding = "async";
    img.onerror = () => { node.textContent = initial(t); };
    img.src = src;
    node.appendChild(img);
  } else {
    node.textContent = initial(t);
  }
}
function isMuted(t) { return !!(t.mutedInfo && t.mutedInfo.muted); }
function initial(t) {
  try { return new URL(t.url).hostname.replace(/^www\./, "")[0].toUpperCase(); }
  catch { return (t.title || "?")[0].toUpperCase(); }
}
function host(t) { try { return new URL(t.url).hostname.replace(/^www\./, ""); } catch { return t.url; } }
function escapeHtml(s) { return String(s).replace(/[&<>"'`]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "`": "&#96;" }[c])); }

/* ============================================================
   INJECTION WATCHDOG
   Hibern8's Content-Security-Policy already blocks any inline or
   remote script (script-src 'self'), so an injection attempt never
   executes. This listener catches the browser's report of that
   block and (1) shows a persistent in-panel warning, (2) records
   the source, and (3) raises a system notification urging an
   antivirus/security scan. Note: browser extensions have no API to
   signal antivirus software directly, so the user notification is
   the mechanism by which we prompt a scan.
   ============================================================ */
let _secLastNotify = 0;
function showSecBanner(text) {
  let b = document.getElementById("secBanner");
  if (!b) {
    b = document.createElement("div");
    b.id = "secBanner";
    b.style.cssText = "position:sticky;top:0;z-index:70;background:#5a1616;color:#ffdede;border-bottom:2px solid #ff6a3a;padding:10px 16px;font-size:13px;font-weight:600;line-height:1.4";
    document.body.prepend(b);
  }
  b.textContent = text;   // textContent — never HTML, so the report itself can't inject
  b.hidden = false;
}
function onSecurityViolation(e) {
  try {
    const dir = e.effectiveDirective || e.violatedDirective || "";
    // Only care about code-execution directives (a blocked script/object/frame), not styling/images.
    if (dir && !/script|object|frame|default|worker/.test(dir)) return;
    const blocked = String(e.blockedURI || "inline script").slice(0, 160);
    const source = String(e.sourceFile || location.href).slice(0, 160);
    const line = e.lineNumber ? `:${e.lineNumber}` : "";
    log(`⚠ SECURITY: blocked a script-injection attempt — <b>${escapeHtml(blocked)}</b> via ${escapeHtml(dir || "script-src")} (source ${escapeHtml(source)}${line}). It did NOT run.`, "r");
    showSecBanner(`⚠ Hibern8 blocked a script-injection attempt (${blocked}) from ${source}${line}. Nothing was executed. As a precaution, please run your antivirus / security scan.`);
    const now = Date.now();
    if (now - _secLastNotify > 5000) {   // throttle
      _secLastNotify = now;
      try {
        chrome.notifications.create("hibern8-sec-" + now, {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icon48.png"),
          title: "Hibern8 blocked a script-injection attempt",
          message: `A script (${blocked}) was blocked by Hibern8's security policy and did not run. Source: ${source}${line}. As a precaution, please run your antivirus / security scan.`,
          priority: 2,
        });
      } catch (e2) {}
    }
  } catch (e3) {}
}
document.addEventListener("securitypolicyviolation", onSecurityViolation);

/* Load user settings (default idle threshold) from the options page. */
async function loadSettings() {
  try {
    const r = await chrome.storage.local.get(["idleDefault"]);
    if (r.idleDefault) {
      idleLimit = +r.idleDefault;
      const ir = document.getElementById("idleRange");
      if (ir) { ir.value = idleLimit; const v = document.getElementById("idleVal"); if (v) v.textContent = idleLimit; }
    }
  } catch (e) {}
}

/* ============================================================
   UI STATE PRESERVATION
   Keep scroll position and keyboard focus stable across the
   frequent re-renders (live sync + auto mode), so the user can
   scroll to a section and work without being thrown around.
   ============================================================ */
function captureUiState() {
  const ae = document.activeElement;
  return {
    x: window.scrollX,
    y: window.scrollY,
    key: ae && ae.dataset ? ae.dataset.key || null : null,
  };
}
function restoreUiState(s) {
  if (!s) return;
  if (s.key) {
    let el = null;
    // CSS.escape + try/catch so a crafted tab title can never form a malformed or unintended selector.
    try { el = document.querySelector(`[data-key="${(window.CSS && CSS.escape) ? CSS.escape(s.key) : ""}"]`); } catch (e) {}
    if (el) { try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); } }
  }
  window.scrollTo(s.x, s.y);
}

/* ============================================================
   WHOLE-WINDOW HIBERNATION + EXPLORER
   ============================================================ */
function isDiscardableInWindow(t, windowIsFocused) {
  if (t.id === selfTabId) return false;
  if (t.discarded) return false;
  if (!/^https?:\/\//i.test(t.url || "")) return false;
  if (windowIsFocused && t.active) return false;
  return true;
}

async function getWindows() {
  return await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] });
}

async function hibernateWindow(winId) {
  let win;
  try { win = await chrome.windows.get(winId, { populate: true }); }
  catch (e) { log(`window ${winId} not found: ${escapeHtml(e.message)}`, "r"); return; }

  const focused = !!win.focused;
  const targets = (win.tabs || []).filter((t) => isDiscardableInWindow(t, focused));
  if (!targets.length) { log(`window ${winId}: nothing eligible to hibernate`, "y"); return; }

  let n = 0, skipped = 0;
  for (const t of targets) {
    try { await chrome.tabs.discard(t.id); n++; }
    catch (e) { skipped++; }
  }
  const label = winId === selfWindowId ? "this window" : `window ${winId}`;
  log(`hibernated <b>${n}</b> tab(s) in ${label}` +
      (skipped ? ` (${skipped} skipped)` : "") +
      ` — ≈${n * EST_MB_PER_TAB} MB reclaimed`, "g");
  render();
}

function windowLabel(win) {
  const tabs = win.tabs || [];
  const active = tabs.find((t) => t.active);
  const lead = active ? (active.title || host(active)) : (tabs[0] ? (tabs[0].title || host(tabs[0])) : "empty");
  const more = Math.max(0, tabs.length - 1);
  return escapeHtml(lead.slice(0, 40)) + (more ? ` <span style="color:var(--faint)">+${more} more</span>` : "");
}

async function windowsSection() {
  const wins = (await getWindows()).filter((w) => !w.incognito);  // private windows excluded from the explorer
  const groups = await getGroups();   // id -> {title,color} for frame highlighting in the explorer
  const sec = document.createElement("div");
  sec.className = "group";
  sec.innerHTML = `<div class="grouphead"><h3>🪟 Windows</h3>
    <span class="ct">${wins.length} open · hibernate or explore an entire window (even one you're not using)</span></div>
    <div class="grid wgrid"></div>`;
  const grid = sec.querySelector(".grid");

  wins.forEach((win, i) => {
    const tabs = win.tabs || [];
    const focused = !!win.focused;
    const isSelf = win.id === selfWindowId;
    const dormCount = tabs.filter((t) => t.discarded).length;
    const eligible = tabs.filter((t) => isDiscardableInWindow(t, focused)).length;

    const wc = document.createElement("div");
    wc.className = "card wcard" + (focused ? " focused" : "");
    const tags = [];
    if (isSelf) tags.push(`<span class="tag pin">this window</span>`);
    if (focused) tags.push(`<span class="tag focus">focused</span>`);
    if (dormCount) tags.push(`<span class="tag dorm">${dormCount} hibernated</span>`);

    wc.innerHTML = `
      <div class="fav">🪟</div>
      <div class="meta">
        <div class="t">Window ${i + 1} — ${tabs.length} tab(s)</div>
        <div class="s">${windowLabel(win)} ${tags.join(" ")}</div>
      </div>`;
    const btn = document.createElement("button");
    btn.className = "act";
    btn.dataset.key = `winhib:${win.id}`;
    btn.textContent = `💤 Hibernate window (${eligible})`;
    btn.disabled = eligible === 0;
    btn.title = eligible
      ? `Discard ${eligible} tab(s) in this window and free their memory`
      : "No eligible tabs (already hibernated, pinned to the visible tab, or non-web pages)";
    btn.onclick = () => hibernateWindow(win.id);
    wc.appendChild(btn);

    // expandable explorer — view & act on this window's tabs (awake + hibernated)
    const det = document.createElement("details");
    det.className = "wtabs";
    det.open = openWindows.has(win.id);
    det.addEventListener("toggle", () => {
      if (det.open) openWindows.add(win.id); else openWindows.delete(win.id);
    });
    // clicking the "Window N" title also expands/collapses the tab dropdown
    const titleEl = wc.querySelector(".meta .t");
    if (titleEl) {
      titleEl.classList.add("wtoggle");
      titleEl.title = "Click to expand or collapse this window's tabs";
      titleEl.onclick = () => { det.open = !det.open; };
    }
    const sum = document.createElement("summary");
    sum.dataset.key = `winsum:${win.id}`;
    sum.innerHTML = `Explore tabs <span class="ct">(${tabs.length} · ${dormCount} hibernated)</span>`;
    det.appendChild(sum);
    const listEl = document.createElement("div");
    listEl.className = "wtablist";
    if (!tabs.length) {
      listEl.innerHTML = `<div class="empty" style="padding:14px 0">No tabs.</div>`;
    } else {
      // active tab(s) first, then the rest (each group still honoring the sort selector)
      const sorted = sortTabs(tabs);
      const ordered = [...sorted.filter((t) => t.active), ...sorted.filter((t) => !t.active)];
      ordered.forEach((t) => listEl.appendChild(windowTabRow(t, groups, focused)));
    }
    det.appendChild(listEl);

    const block = document.createElement("div");
    block.className = "wblock";
    block.appendChild(wc);
    block.appendChild(det);
    grid.appendChild(block);
  });

  return sec;
}

// Compact row used inside a window's "Explore tabs" dropdown.
function windowTabRow(t, groups, windowFocused) {
  const grouped = t.groupId != null && t.groupId !== TAB_GROUP_ID_NONE;
  const g = grouped && groups ? groups[t.groupId] : null;
  const gColor = g ? (GROUP_COLORS[g.color] || "#9aa0a6") : null;

  const row = document.createElement("div");
  row.className = "wrow" + (t.discarded ? " dorm" : "") + (t.active ? " activetab" : "") +
    (t.audible && !t.discarded ? " audiolive" : "") + (grouped ? " grouped" : "");
  // frame-highlight the row with the tab group's color
  if (gColor) row.style.setProperty("--gcol", gColor);

  const tags = [];
  if (grouped) {
    const gname = g && g.title && g.title.trim() ? escapeHtml(g.title) : "group";
    tags.push(`<span class="tag group" style="background:${gColor}22;color:${gColor}">${colorDot(g ? g.color : "grey")} ${gname}</span>`);
  }
  if (t.discarded) tags.push(`<span class="tag dorm">shell</span>`);
  if (t.audible) tags.push(`<span class="tag audio">🔊</span>`);
  if (isMuted(t)) tags.push(`<span class="tag mute">🔇</span>`);
  if (t.pinned) tags.push(`<span class="tag pin">📌</span>`);
  if (t.active) tags.push(`<span class="tag focus">active</span>`);

  row.innerHTML = `
    <span class="fav"></span>
    <span class="rmeta">
      <span class="rt">${escapeHtml(t.title || host(t))}</span>
      <span class="rs">${escapeHtml(host(t))} ${tags.join(" ")}</span>
    </span>`;
  applyFav(row.querySelector(".fav"), t);

  if (t.id !== selfTabId) {
    const go = document.createElement("button");
    go.className = "act go mini";
    go.dataset.key = `wgo:${t.id}`;
    go.textContent = "Go ↗";
    go.title = "Switch to this tab";
    go.onclick = () => switchTo(t.id);
    row.appendChild(go);
  }
  if (t.audible || isMuted(t)) {
    const m = document.createElement("button");
    m.className = "act mute mini";
    m.dataset.key = `wmute:${t.id}`;
    m.textContent = isMuted(t) ? "🔊" : "🔇";
    m.title = isMuted(t) ? "Unmute this tab" : "Mute this tab";
    m.onclick = () => toggleMute(t.id);
    row.appendChild(m);
  }
  if (t.discarded) {
    const w = document.createElement("button");
    w.className = "act wake mini";
    w.dataset.key = `wwake:${t.id}`;
    w.textContent = "Wake ↑";
    w.onclick = () => wake(t.id);
    row.appendChild(w);
  } else if (t.id !== selfTabId) {
    const canHibernate = isDiscardableInWindow(t, windowFocused);
    const h = document.createElement("button");
    h.className = "act mini hib";
    h.dataset.key = `whib:${t.id}`;
    h.textContent = "💤";
    h.disabled = !canHibernate;
    h.title = canHibernate ? "Hibernate this tab"
      : (windowFocused && t.active ? "Can't hibernate the visible tab of the focused window"
        : "This tab type can't be hibernated");
    h.onclick = () => hibernate(t.id);
    row.appendChild(h);
  }
  if (t.id !== selfTabId) {
    const c = document.createElement("button");
    c.className = "act close mini";
    c.dataset.key = `wclose:${t.id}`;
    c.textContent = "✕";
    c.title = "Close this tab";
    c.onclick = () => closeTab(t.id);
    row.appendChild(c);
  }
  return row;
}

/* ---- Active Tabs section (the active tab of every normal window) ---- */
async function activeTabsSection() {
  let wins = [];
  try { wins = await chrome.windows.getAll({ populate: true, windowTypes: ["normal"] }); } catch (e) {}
  const rows = [];
  wins.forEach((w) => {
    if (w.incognito) return;
    const act = (w.tabs || []).find((t) => t.active);
    if (act && act.id !== selfTabId && /^https?:\/\//i.test(act.url || "")) rows.push({ tab: act, focused: !!w.focused });
  });
  if (!rows.length) return null;

  const sec = document.createElement("div");
  sec.className = "group activesec";
  sec.innerHTML = `<div class="grouphead"><h3>🎯 Active Tabs</h3>
    <span class="ct">${rows.length} window(s) · go, hibernate, or bookmark the tab you're on</span></div><div class="grid"></div>`;
  const grid = sec.querySelector(".grid");
  rows.forEach(({ tab, focused }) => grid.appendChild(activeCard(tab, focused)));
  return sec;
}

function activeCard(t, focused) {
  const el = document.createElement("div");
  el.className = "card activetab";
  const tags = [`<span class="tag focus">active</span>`];
  if (focused) tags.push(`<span class="tag focus">focused window</span>`);
  if (t.audible) tags.push(`<span class="tag audio">🔊 audio</span>`);
  el.innerHTML = `
    <div class="fav"></div>
    <div class="meta">
      <div class="t">${escapeHtml(t.title || host(t))}</div>
      <div class="s">${escapeHtml(host(t))} ${tags.join(" ")}</div>
    </div>`;
  applyFav(el.querySelector(".fav"), t);

  const canHib = isDiscardableInWindow(t, focused);
  const ic = (cls, icon, title, fn, disabled) => {
    const b = document.createElement("button");
    b.className = "act ic" + (cls ? " " + cls : "");
    b.textContent = icon;
    b.title = title;
    if (disabled) b.disabled = true;
    b.onclick = fn;
    el.appendChild(b);
  };
  ic("go", "↗", "Go to this tab", () => switchTo(t.id));
  const bmOn = _bm.has(t.url);
  ic("bm" + (bmOn ? " on" : ""), bmOn ? "★" : "☆", bmOn ? "Remove bookmark" : "Bookmark this tab", () => toggleBookmark(t));
  ic("", "💤", canHib ? "Hibernate (Zzz)" : "Can't hibernate the visible tab of the focused window", () => hibernate(t.id), !canHib);
  if (t.id !== selfTabId) ic("close", "✕", "Close this tab", () => closeTab(t.id));

  return el;
}

// Track which URLs are already bookmarked so the star renders filled (★) vs. empty (☆).
let _bm = new Set();
async function loadBookmarks() {
  _bm = new Set();
  try {
    const tree = await chrome.bookmarks.getTree();
    (function walk(nodes) { for (const n of nodes) { if (n.url) _bm.add(n.url); if (n.children) walk(n.children); } })(tree);
  } catch (e) {}
}
// Toggle: add the tab to bookmarks, or remove it if already bookmarked.
async function toggleBookmark(t) {
  try {
    const existing = await chrome.bookmarks.search({ url: t.url });
    if (existing && existing.length) {
      for (const b of existing) { try { await chrome.bookmarks.remove(b.id); } catch (e) {} }
      log(`removed bookmark <b>${escapeHtml((t.title || host(t)).slice(0, 28))}</b>`, "y");
    } else {
      await chrome.bookmarks.create({ title: t.title || t.url, url: t.url });
      log(`bookmarked <b>${escapeHtml((t.title || host(t)).slice(0, 28))}</b>`, "g");
    }
  } catch (e) {
    log(`bookmark error: ${escapeHtml(e.message)}`, "r");
  }
  await loadBookmarks();
  render();
}

/* ---- generic section builder ---- */
function sectionEl(titleHtml, ctText, tabsArr, dorm, opts = {}) {
  const sec = document.createElement("div");
  sec.className = "group" + (opts.cls ? " " + opts.cls : "");
  if (opts.gcolor) sec.style.setProperty("--gcolor", opts.gcolor);
  sec.innerHTML = `<div class="grouphead"><h3>${titleHtml}</h3><span class="ct">${ctText}</span></div><div class="grid"></div>`;
  const grid = sec.querySelector(".grid");
  sortTabs(tabsArr).forEach((t) => grid.appendChild(card(t, dorm, opts)));
  return sec;
}

// Private (incognito / InPrivate) tabs that are playing audio/video — shown in their own
// section (never mixed with normal or hibernated tabs), identify-only, with a per-window close.
async function privateSection() {
  let list = [];
  try { list = await chrome.tabs.query({ audible: true }); } catch (e) {}
  const priv = list.filter((t) => t.incognito && t.url && !t.url.startsWith(chrome.runtime.getURL("")));
  if (!priv.length) return null;

  const sec = document.createElement("div");
  sec.className = "group privsec";
  sec.innerHTML = `<div class="grouphead"><h3>🕶 Private — Audio / Video</h3>
    <span class="ct">${priv.length} private tab(s) playing sound/video · identify &amp; close only</span></div>`;

  const byWin = {};
  priv.forEach((t) => { (byWin[t.windowId] = byWin[t.windowId] || []).push(t); });
  Object.keys(byWin).forEach((wid, i) => {
    const wrap = document.createElement("div");
    wrap.className = "privwin";
    const head = document.createElement("div");
    head.className = "privwinhead";
    const title = document.createElement("span");
    title.className = "privwintitle";
    title.textContent = `Private window ${i + 1} — ${byWin[wid].length} audio/video tab(s)`;
    const closeBtn = document.createElement("button");
    closeBtn.className = "act close";
    closeBtn.textContent = "✕ Close window";
    closeBtn.title = "Close this private browsing window";
    closeBtn.onclick = () => closeWindow(+wid);
    head.appendChild(title);
    head.appendChild(closeBtn);
    wrap.appendChild(head);
    const grid = document.createElement("div");
    grid.className = "grid";
    sortTabs(byWin[wid]).forEach((t) => grid.appendChild(card(t, false)));
    wrap.appendChild(grid);
    sec.appendChild(wrap);
  });
  return sec;
}

/* ---- render ---- */
async function render() {
  const ui = captureUiState();

  await loadBookmarks();
  const tabs = await getTabs();
  const awake = tabs.filter((t) => !t.discarded);
  const dorm = tabs.filter((t) => t.discarded);

  $("awakeCt").textContent = awake.length;
  $("dormCt").textContent = dorm.length;
  $("estFreed").textContent = dorm.length * EST_MB_PER_TAB;
  { const ep = $("estPower"); if (ep) ep.textContent = (dorm.length * EST_W_PER_TAB).toFixed(1); }
  updatePowerRel(dorm.length);

  const view = $("view");
  // Build everything off-screen, then swap it in atomically (replaceChildren) so the
  // page never flashes blank — gentler on the eyes and avoids photosensitive flicker.
  const frag = document.createDocumentFragment();

  // 1) Audio / Video tabs — every tab playing audio, across ALL windows (TOP of page)
  const audio = await getAudioTabs();
  if (audio.length) {
    frag.appendChild(sectionEl(
      `🔊 Audio / Video Tabs`,
      `${audio.length} active · across all windows · never auto-hibernated`,
      audio, false, { cls: "audiosec", audioOnly: true }
    ));
  }

  // 1b) Private (incognito/InPrivate) audio/video tabs — separate section
  const privSec = await privateSection();
  if (privSec) frag.appendChild(privSec);

  // 1c) Active Tabs — the active tab of every window, right under audio/video
  const activeSec = await activeTabsSection();
  if (activeSec) frag.appendChild(activeSec);

  // 2) Windows — whole-window hibernation + explorer
  frag.appendChild(await windowsSection());

  // 3) Tab-group sections — mirror the user's browser tab groups
  const groups = await getGroups();
  const groupedAwake = awake.filter((t) => !t.audible && t.groupId != null && t.groupId !== TAB_GROUP_ID_NONE);
  const byGroup = {};
  groupedAwake.forEach((t) => { (byGroup[t.groupId] = byGroup[t.groupId] || []).push(t); });
  Object.keys(byGroup).forEach((gid) => {
    const g = groups[gid] || { title: "", color: "grey" };
    const name = g.title && g.title.trim() ? escapeHtml(g.title) : "Unnamed group";
    frag.appendChild(sectionEl(
      `${colorDot(g.color)} ${name}`,
      `${byGroup[gid].length} tab(s) · your browser tab group`,
      byGroup[gid], false, { cls: "groupsec", gcolor: GROUP_COLORS[g.color] || "#9aa0a6" }
    ));
  });

  // 4) Other Tabs — awake, ungrouped, non-audio
  const other = awake.filter((t) => !t.audible && (t.groupId == null || t.groupId === TAB_GROUP_ID_NONE));
  frag.appendChild(sectionEl(
    `🟢 Other Tabs`,
    `${other.length} open · using full memory`,
    other, false
  ));

  // 5) Hibernated — all dormant tabs (alphabetizable)
  if (!dorm.length) {
    const sec = document.createElement("div");
    sec.className = "group";
    sec.innerHTML = `<div class="grouphead"><h3>🗂️ Hibernated</h3><span class="ct">0 dormant</span></div>
      <div class="empty">Nothing hibernated yet. Hibernate a tab and watch its memory drop in Task Manager.</div>`;
    frag.appendChild(sec);
  } else {
    frag.appendChild(sectionEl(
      `🗂️ Hibernated`,
      `${dorm.length} dormant · holding only a lightweight shell`,
      dorm, true
    ));
  }

  view.replaceChildren(frag);   // single atomic DOM swap — no intermediate blank state
  _lastRender = Date.now();
  restoreUiState(ui);
}

function card(t, dorm, opts = {}) {
  const el = document.createElement("div");
  el.className = "card" + (dorm ? " dorm" : "") +
    (t.active && !dorm ? " activetab" : "") +
    (t.audible && !dorm ? " audiolive" : "");

  const tags = [];
  if (dorm) tags.push(`<span class="tag dorm">shell</span>`);
  if (t.audible) tags.push(`<span class="tag audio">🔊 audio</span>`);
  if (isMuted(t)) tags.push(`<span class="tag mute">🔇 muted</span>`);
  if (t.pinned) tags.push(`<span class="tag pin">📌 pinned</span>`);
  if (t.active) tags.push(`<span class="tag focus">active</span>`);
  if (t.incognito) tags.push(`<span class="tag private">🕶 private</span>`);
  if (t.windowId != null && t.windowId !== selfWindowId) tags.push(`<span class="tag other">⧉ other window</span>`);

  const eligible = isDiscardable(t);
  let idleHtml = "";
  if (!dorm && mode === "auto" && !t.active && !t.audible) {
    const idle = (Date.now() - (t.lastAccessed || Date.now())) / 1000;
    const pct = Math.min(100, (idle / idleLimit) * 100);
    idleHtml = `<div class="idlebar"><i style="width:${pct}%;background:${pct > 70 ? "var(--bad)" : "var(--warn)"}"></i></div>`;
  }

  el.innerHTML = `
    <div class="fav"></div>
    <div class="meta">
      <div class="t">${escapeHtml(t.title || host(t))}</div>
      <div class="s">${escapeHtml(host(t))} ${tags.join(" ")}</div>
      ${idleHtml}
    </div>`;
  applyFav(el.querySelector(".fav"), t);

  // Private-browsing tabs: identify sound/video only — no per-tab controls.
  // They are acted on only via the top-level "Mute all" / "Hibernate all" buttons.
  if (t.incognito) return el;

  // compact icon action buttons that fit within the tab card
  const ic = (cls, icon, title, fn, disabled) => {
    const b = document.createElement("button");
    b.className = "act ic" + (cls ? " " + cls : "");
    b.dataset.key = (cls || "hib") + ":" + t.id;
    b.textContent = icon;
    b.title = title;
    if (disabled) b.disabled = true;
    b.onclick = fn;
    el.appendChild(b);
  };
  const bmOn = _bm.has(t.url);
  if (dorm) {
    ic("wake", "↑", "Wake & reload", () => wake(t.id));
    ic("bm" + (bmOn ? " on" : ""), bmOn ? "★" : "☆", bmOn ? "Remove bookmark" : "Bookmark this tab", () => toggleBookmark(t));
    if (t.id !== selfTabId) ic("close", "✕", "Close this tab", () => closeTab(t.id));
  } else {
    if (t.id !== selfTabId) ic("go", "↗", "Go to this tab", () => switchTo(t.id));
    if (t.audible || isMuted(t)) ic("mute", isMuted(t) ? "🔊" : "🔇", isMuted(t) ? "Unmute this tab" : "Mute this tab", () => toggleMute(t.id));
    ic("bm" + (bmOn ? " on" : ""), bmOn ? "★" : "☆", bmOn ? "Remove bookmark" : "Bookmark this tab", () => toggleBookmark(t));
    if (!opts.audioOnly) {
      ic("", "💤", eligible ? "Hibernate (Zzz)" : (t.active ? "Can't hibernate the active tab" : "This tab type can't be hibernated"), () => hibernate(t.id), !eligible);
      if (t.id !== selfTabId) ic("close", "✕", "Close this tab", () => closeTab(t.id));
    }
  }
  return el;
}

/* ---- actions ---- */
async function hibernate(id) {
  try {
    const t = await chrome.tabs.get(id);
    await chrome.tabs.discard(id);
    log(`hibernated <b>${escapeHtml((t.title || host(t)).slice(0, 34))}</b> — released to OS, ≈${EST_MB_PER_TAB} MB`, "g");
  } catch (e) {
    log(`couldn't hibernate tab ${id}: ${escapeHtml(e.message)}`, "r");
  }
  render();
}

// Navigate to (focus) a tab — activates it and brings its window forward, even if
// that tab lives in a different window. Auto-refreshes ~1s later so the command
// center reflects the new active tab / state.
async function switchTo(id) {
  try {
    const t = await chrome.tabs.get(id);
    await chrome.tabs.update(id, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
    log(`switched to <b>${escapeHtml((t.title || host(t)).slice(0, 34))}</b>`, "b");
  } catch (e) {
    log(`couldn't switch to tab ${id}: ${escapeHtml(e.message)}`, "r");
  }
  setTimeout(render, 900);
}

// Close an entire window (used for private/InPrivate windows from their A/V section).
async function closeWindow(winId) {
  try {
    await chrome.windows.remove(winId);
    log(`closed private window`, "y");
  } catch (e) {
    log(`couldn't close window ${winId}: ${escapeHtml(e.message)}`, "r");
  }
  scheduleRender();
}

// Close a tab outright from the command center (any window).
async function closeTab(id) {
  try {
    const t = await chrome.tabs.get(id);
    const name = escapeHtml((t.title || host(t)).slice(0, 34));
    await chrome.tabs.remove(id);
    log(`closed <b>${name}</b>`, "y");
  } catch (e) {
    log(`couldn't close tab ${id}: ${escapeHtml(e.message)}`, "r");
  }
  setTimeout(render, 200);
}

// Mute / unmute a tab from the control panel. The browser keeps the real mute state,
// so toggling the tab's own speaker icon will sync back here on the next refresh.
async function toggleMute(id) {
  try {
    const t = await chrome.tabs.get(id);
    const muted = !(t.mutedInfo && t.mutedInfo.muted);
    await chrome.tabs.update(id, { muted });
    if (!muted) mutedByUs.delete(id);   // manual unmute clears tracking
    log(`${muted ? "muted" : "unmuted"} <b>${escapeHtml((t.title || host(t)).slice(0, 30))}</b>`, "y");
  } catch (e) {
    log(`couldn't mute tab ${id}: ${escapeHtml(e.message)}`, "r");
  }
  setTimeout(render, 150);
}

async function wake(id) {
  try {
    const t = await chrome.tabs.get(id);
    await chrome.tabs.update(id, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
    log(`woke <b>${escapeHtml((t.title || host(t)).slice(0, 34))}</b> — reloading from shell`, "b");
  } catch (e) {
    log(`couldn't wake tab ${id}: ${escapeHtml(e.message)}`, "r");
  }
  setTimeout(render, 400);
}

async function hibernateAll() {
  // Always operate across EVERY window. Keeps audio/video (audible), pinned & active tabs.
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (e) {}
  const targets = tabs.filter((t) => t.url && !t.url.startsWith(chrome.runtime.getURL("")) && isDiscardable(t));
  if (!targets.length) { log("no eligible tabs to hibernate right now", "y"); return; }
  let n = 0;
  for (const t of targets) {
    try { await chrome.tabs.discard(t.id); n++; } catch (e) { /* skip */ }
  }
  log(`hibernated <b>${n}</b> tab(s) across all windows (kept audio/video, pinned & active) — ≈${n * EST_MB_PER_TAB} MB reclaimed`, "g");
  render();
}

// After Mute all, unmute a tab once it becomes the active tab (or starts new audio while
// active). Only tabs that WE muted are eligible — tabs the user muted by hand are left alone.
async function unmuteActiveIfTracked(tabId) {
  if (!autoUnmute || !mutedByUs.has(tabId)) return;
  try {
    const t = await chrome.tabs.get(tabId);
    if (t && t.active && t.mutedInfo && t.mutedInfo.muted) {
      await chrome.tabs.update(tabId, { muted: false });
      mutedByUs.delete(tabId);
      log(`auto-unmuted active tab <b>${escapeHtml((t.title || host(t)).slice(0, 28))}</b>`, "g");
      scheduleRender();
    }
  } catch (e) { /* tab gone */ }
}

// Mute every tab currently producing sound, across all windows (incl. private tabs).
async function muteAll() {
  let list = [];
  try { list = await chrome.tabs.query({ audible: true }); } catch (e) {}
  let n = 0, priv = 0;
  for (const t of list) {
    if (t.id === selfTabId) continue;
    try { await chrome.tabs.update(t.id, { muted: true }); mutedByUs.add(t.id); n++; if (t.incognito) priv++; } catch (e) { /* skip */ }
  }
  const allowed = await incognitoAllowed();
  let msg = n ? `muted <b>${n}</b> sounding tab(s)` + (priv ? ` (incl. ${priv} private)` : "") : "no audible tabs in reach";
  if (!allowed) msg += ` — private/InPrivate tabs are NOT included until you enable “Allow in Incognito/InPrivate” for Hibern8 (chrome://extensions → Details)`;
  log(msg, n ? "y" : "b");
  scheduleRender();
}

/* ---- auto-snooze loop ---- */
async function autoTick() {
  if (mode !== "auto") return;   // Manual mode relies on live listeners + actions to refresh
  const tabs = await getTabs();
  let changed = false;
  for (const t of tabs) {
    if (!isDiscardable(t)) continue;
    const idle = (Date.now() - (t.lastAccessed || Date.now())) / 1000;
    if (idle >= idleLimit) {
      try {
        await chrome.tabs.discard(t.id);
        log(`auto-snooze: <b>${escapeHtml((t.title || host(t)).slice(0, 28))}</b> idle ${Math.round(idle)}s ≥ ${idleLimit}s`, "b");
        changed = true;
      } catch (e) { /* skip */ }
    }
  }
  if (changed) scheduleRender();   // only repaint when something actually hibernated
}

/* ---- appearance / theme ---- */
function applyTheme() {
  let pref = "auto";
  try { pref = localStorage.getItem("hibern8-theme") || "auto"; } catch (e) {}
  const sysLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  const effLight = pref === "light" || (pref === "auto" && sysLight);
  document.body.classList.toggle("lighttheme", effLight);
  document.body.dataset.theme = pref;
  const sel = $("themeSel");
  if (sel) sel.value = pref;
  applyHue();   // re-derive custom accent for the current light/dark theme
}

// ROYGBIV hue control: tints text, accents, and icon colors via the CSS custom properties.
// Lightness is theme-aware so contrast stays readable in both light and dark.
// Paint the toolbar (action) icon to match the currently-selected accent color.
// Greyscale is simply a low saturation; the default (no custom hue) uses the neon-green brand icon.
function drawActionIcon(size, fill) {
  const c = new OffscreenCanvas(size, size), x = c.getContext("2d");
  const r = Math.round(size * 0.22);
  x.clearRect(0, 0, size, size);
  x.beginPath();
  x.moveTo(r, 0);
  x.arcTo(size, 0, size, size, r); x.arcTo(size, size, 0, size, r);
  x.arcTo(0, size, 0, 0, r); x.arcTo(0, 0, size, 0, r);
  x.closePath();
  x.fillStyle = fill; x.fill();
  x.fillStyle = "#0b1020"; x.textAlign = "center"; x.textBaseline = "middle";
  x.font = `bold ${Math.round(size * 0.72)}px Arial`;
  x.fillText("8", size / 2, size / 2 + Math.round(size * 0.06));
  return x.getImageData(0, 0, size, size);
}
function updateActionIcon() {
  try {
    const sat = accentSat == null ? 90 : accentSat;   // 0 = greyscale
    const fill = accentHue == null ? "#39FF14" : `hsl(${accentHue} ${sat}% 55%)`;
    chrome.action.setIcon({ imageData: { 16: drawActionIcon(16, fill), 32: drawActionIcon(32, fill) } });
  } catch (e) {}
}
function applyHue() {
  const s = document.body.style;
  if (accentHue == null) {
    s.removeProperty("--accent"); s.removeProperty("--accent2"); s.removeProperty("--txt"); s.removeProperty("--outline");
    updateActionIcon(); return;
  }
  const h = accentHue, h2 = (h + 35) % 360, inv = (h + 180) % 360;   // text uses the inverse (complementary) hue
  const light = document.body.classList.contains("lighttheme");
  const sat1 = accentSat == null ? (light ? 72 : 90) : accentSat;    // accentSat 0 => greyscale accent
  const sat2 = accentSat == null ? (light ? 66 : 85) : accentSat;
  if (light) {
    s.setProperty("--accent", `hsl(${h} ${sat1}% 38%)`);
    s.setProperty("--accent2", `hsl(${h2} ${sat2}% 44%)`);
    s.setProperty("--txt", `hsl(${inv} 35% 12%)`);   // inverse-hue tint, near-black for WCAG-grade contrast on light bg
    s.setProperty("--outline", `hsl(${inv} 45% 97%)`);   // near-white halo (inverse of the dark text) for definition
  } else {
    s.setProperty("--accent", `hsl(${h} ${sat1}% 67%)`);
    s.setProperty("--accent2", `hsl(${h2} ${sat2}% 71%)`);
    s.setProperty("--txt", `hsl(${inv} 30% 95%)`);   // inverse-hue tint, near-white for WCAG-grade contrast on dark bg
    s.setProperty("--outline", `hsl(${inv} 35% 7%)`);    // near-black halo (inverse of the light text) for definition
  }
  updateActionIcon();
}

/* ---- live sync: re-render (preserving scroll/focus) on real browser changes ----
   Coalesced + rate-limited so bursts of tab events never cause rapid repaints
   (gentler UX, avoids flicker / photosensitive flashing). Skips when hidden. */
let _renderTimer = null;
let _lastRender = 0;
const RENDER_MIN_GAP = 800;   // never repaint more often than this (ms)
function scheduleRender() {
  if (document.hidden) return;
  clearTimeout(_renderTimer);
  const wait = Math.max(450, RENDER_MIN_GAP - (Date.now() - _lastRender));
  _renderTimer = setTimeout(() => render(), wait);
}
function wireLiveListeners() {
  const t = chrome.tabs, w = chrome.windows;
  ["onUpdated", "onActivated", "onRemoved", "onCreated", "onMoved", "onAttached", "onDetached"].forEach((ev) => {
    try { t[ev] && t[ev].addListener(scheduleRender); } catch (e) {}
  });
  try { w.onFocusChanged && w.onFocusChanged.addListener(scheduleRender); } catch (e) {}
  // auto-unmute the active tab after Mute all (on activation, or new audio while active)
  try { t.onActivated.addListener((info) => unmuteActiveIfTracked(info.tabId)); } catch (e) {}
  try { t.onUpdated.addListener((tabId, ch, tab) => { if ((ch.audible || ch.mutedInfo) && tab && tab.active) unmuteActiveIfTracked(tabId); }); } catch (e) {}
  try { t.onRemoved.addListener((tabId) => mutedByUs.delete(tabId)); } catch (e) {}
  if (typeof chrome.tabGroups !== "undefined") {
    ["onCreated", "onUpdated", "onRemoved", "onMoved"].forEach((ev) => {
      try { chrome.tabGroups[ev] && chrome.tabGroups[ev].addListener(scheduleRender); } catch (e) {}
    });
  }
}

// Gentle visual cue when the user clicks Refresh — a brief icon spin and a soft fade-in of
// the view. Both are disabled automatically for users with reduced-motion enabled.
async function manualRefresh() {
  const b = $("refreshBtn"), v = $("view");
  b.classList.add("spin");
  v.classList.remove("refreshing"); void v.offsetWidth; v.classList.add("refreshing");
  await render();
  setTimeout(() => b.classList.remove("spin"), 650);
  setTimeout(() => v.classList.remove("refreshing"), 520);
}

// Social-media screen-time banner (reads the background timer's daily state)
let _socialDismissed = 0;
async function refreshSocialBanner() {
  const note = document.getElementById("socialNote"); if (!note) return;
  let st = null;
  try { const r = await chrome.storage.local.get("socialState"); st = r.socialState; } catch (e) {}
  const today = new Date().toISOString().slice(0, 10);
  if (!st || st.day !== today || st.seconds < 1800 || (st.lastThreshold && st.lastThreshold <= _socialDismissed)) { note.hidden = true; return; }
  const m = Math.floor(st.seconds / 60);
  const hh = String(Math.floor(m / 60)).padStart(2, "0"), mm = String(m % 60).padStart(2, "0");
  const el = document.getElementById("socialMsg");
  if (el) el.textContent = `You've been on social media & entertainment sites for ${hh}:${mm} today.`;
  note.hidden = false;
}

/* ---- wiring ---- */
$("snoozeAll").onclick = hibernateAll;
$("muteAll").onclick = muteAll;
$("refreshBtn").onclick = manualRefresh;

// in-command-center Help / About overlay
const _help = $("helpOverlay");
const openHelp = () => { _help.hidden = false; };
const closeHelp = () => { _help.hidden = true; };
$("helpBtn").onclick = openHelp;
$("helpClose").onclick = closeHelp;
$("helpCloseBtn").onclick = closeHelp;
_help.onclick = (e) => { if (e.target === _help) closeHelp(); };
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !_help.hidden) closeHelp(); });

// Open Hibern8 in its own standalone window (popup-type, no tab strip).
$("popoutBtn").onclick = () => {
  try { chrome.windows.create({ url: chrome.runtime.getURL("dashboard.html"), type: "popup", width: 1180, height: 860 }); } catch (e) {}
};

// Settings (options page) + incognito first-run guidance
$("settingsBtn").onclick = () => { try { chrome.runtime.openOptionsPage(); } catch (e) {} };
$("incogDismiss").onclick = () => { try { localStorage.setItem("hibern8-incog-dismissed", "1"); } catch (e) {} $("incogNote").hidden = true; };
$("incogOpen").onclick = () => { try { chrome.tabs.create({ url: "chrome://extensions" }); } catch (e) {} };

// Screen-time banner controls + live refresh
const _sn = document.getElementById("socialNote");
if (_sn) {
  document.getElementById("socialDismiss").onclick = async () => {
    try { const r = await chrome.storage.local.get("socialState"); _socialDismissed = (r.socialState && r.socialState.lastThreshold) || 99999; } catch (e) {}
    _sn.hidden = true;
  };
  document.getElementById("socialReset").onclick = async () => {
    try { await chrome.storage.local.set({ socialState: { day: new Date().toISOString().slice(0, 10), seconds: 0, lastThreshold: 0 } }); } catch (e) {}
    _socialDismissed = 0; _sn.hidden = true;
    log(`screen-time timer reset`, "y");
  };
}
try { chrome.storage.onChanged.addListener((ch, area) => { if (area === "local" && ch.socialState) refreshSocialBanner(); }); } catch (e) {}
setInterval(refreshSocialBanner, 20000);

/* ---- Safe-Hold / Suspend-session banner ---- */
function bg(msg) {
  return new Promise((res) => { try { chrome.runtime.sendMessage(msg, (r) => res(r || {})); } catch (e) { res({}); } });
}
function mkBtn(label, cls, fn) {
  const b = document.createElement("button"); b.className = "btn " + (cls || ""); b.textContent = label; b.onclick = fn; return b;
}
async function doRelease(force) {
  const r = await bg({ type: "sh:release", force: !!force });
  if (r && r.ok) { log("traffic hold released — pages and downloads may resume", "g"); refreshHoldBanner(); render(); }
  else if (r && r.reason === "vpn") { log("release needs your confirmation that a VPN is connected", "y"); refreshHoldBanner(); }
}
async function refreshHoldBanner() {
  const note = document.getElementById("holdNote"); if (!note) return;
  const st = await bg({ type: "sh:get" });
  const sh = (st && st.sh) || { active: false };
  if (!sh.active) { note.hidden = true; return; }
  const msg = document.getElementById("holdMsg");
  const btns = document.getElementById("holdBtns");
  btns.replaceChildren();
  const requireVpn = st.prefs && st.prefs.requireVpn;
  const held = st.held || sh.held || 0;

  if (sh.needPrompt) {
    // Session-restore prompt: are these tabs safe to load on this network?
    msg.innerHTML = `🔒 <b>Restored ${held} tab(s) from your last session.</b> Are they safe to load on this network, or do you want your VPN up first?`;
    btns.appendChild(mkBtn("Load now (I'm protected)", "primary", async () => { await bg({ type: "sh:clearPrompt" }); await doRelease(true); }));
    btns.appendChild(mkBtn("Keep held — release manually", "ghost", async () => { await bg({ type: "sh:clearPrompt" }); refreshHoldBanner(); }));
    note.hidden = false;
    return;
  }

  // Active hold state. VPN presence can't be auto-detected by an extension, so "require VPN"
  // is a manual confirmation: the release button asks you to confirm your VPN is connected.
  msg.innerHTML = `🔒 <b>Traffic held</b> — ${held} tab(s) suspended and downloads paused; nothing loads until you release.`;
  if (requireVpn) {
    btns.appendChild(mkBtn("✓ VPN connected — release", "primary", () => doRelease(true)));
  } else {
    btns.appendChild(mkBtn("Release now", "primary", () => doRelease(false)));
  }
  note.hidden = false;
}
const _suspend = document.getElementById("suspendBtn");
if (_suspend) _suspend.onclick = async () => { await bg({ type: "sh:suspend" }); log("session suspended — all page traffic is held until you release", "y"); refreshHoldBanner(); render(); };
setInterval(refreshHoldBanner, 5000);

// Auto-unmute active tab (after Mute all) — persisted, default on.
const _au = $("autoUnmute");
try { autoUnmute = localStorage.getItem("hibern8-autounmute") !== "0"; } catch (e) {}
_au.checked = autoUnmute;
_au.onchange = () => {
  autoUnmute = _au.checked;
  try { localStorage.setItem("hibern8-autounmute", autoUnmute ? "1" : "0"); } catch (e) {}
  log(`auto-unmute active tab <b>${autoUnmute ? "ON" : "OFF"}</b>`, "y");
};
$("allWindows").onchange = render;
$("sortSel").onchange = (e) => { sortMode = e.target.value; render(); };

$("themeSel").onchange = (e) => {
  try { localStorage.setItem("hibern8-theme", e.target.value); } catch (err) {}
  applyTheme();
};

// ROYGBIV color slider — tints text, accents & icons; reset returns to the theme default.
const _hue = $("hueSlider");
const _sat = $("satSlider");
try { const hv = localStorage.getItem("hibern8-hue"); if (hv !== null && hv !== "") { accentHue = +hv; _hue.value = accentHue; } } catch (e) {}
try { const sv = localStorage.getItem("hibern8-sat"); if (sv !== null && sv !== "" && _sat) { accentSat = +sv; _sat.value = accentSat; } } catch (e) {}
applyHue();
_hue.oninput = () => {
  accentHue = +_hue.value;
  try { localStorage.setItem("hibern8-hue", String(accentHue)); } catch (e) {}
  applyHue();
};
if (_sat) _sat.oninput = () => {
  accentSat = +_sat.value;
  try { localStorage.setItem("hibern8-sat", String(accentSat)); } catch (e) {}
  // A saturation change is only meaningful once a hue is chosen; adopt the slider's hue if none yet.
  if (accentHue == null) { accentHue = +_hue.value; try { localStorage.setItem("hibern8-hue", String(accentHue)); } catch (e) {} }
  applyHue();
};
$("hueReset").onclick = () => {
  accentHue = null; accentSat = null;
  try { localStorage.removeItem("hibern8-hue"); localStorage.removeItem("hibern8-sat"); } catch (e) {}
  const ps = $("paletteSel"); if (ps) ps.value = "";
  if (_sat) _sat.value = 90;
  applyHue();
};

// Classic palette presets -> set the accent hue
const _pal = $("paletteSel");
_pal.onchange = () => {
  const v = _pal.value;
  if (v === "") { accentHue = null; try { localStorage.removeItem("hibern8-hue"); } catch (e) {} }
  else { accentHue = +v; try { localStorage.setItem("hibern8-hue", v); } catch (e) {} if ($("hueSlider")) $("hueSlider").value = v; }
  applyHue();
};

// Font selector — robotic, refined, exact, dreamy, marshmallow
const FONTS = {
  system: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Arial,sans-serif',
  robotic: '"Lucida Console","Consolas",ui-monospace,monospace',
  refined: '"Harlow Solid Italic","Segoe Script","Brush Script MT",cursive',
  exact: '"Berlin Sans FB","Century Gothic",Futura,"Trebuchet MS",sans-serif',
  dreamy: '"Broadway","Modern No. 20",Impact,fantasy',
  bubble: '"Arial Rounded MT Bold",ui-rounded,"Chalkboard SE","Baloo 2","Fredoka","Comic Sans MS",sans-serif',
  marshmallow: '"Jumble","Comic Sans MS","Comic Neue",cursive',
};
function applyFont(key) {
  document.body.style.fontFamily = FONTS[key] || FONTS.system;
  // Outline prominent text in the inverse color so decorative/thin faces stay crisp and defined.
  document.body.classList.toggle("fontoutline", key && key !== "system");
  // Bubble: extra billowy/rounded feel — heavier weight and airy letter-spacing.
  document.body.classList.toggle("fontbubble", key === "bubble");
}
const _font = $("fontSel");
try { const fv = localStorage.getItem("hibern8-font"); if (fv && FONTS[fv]) _font.value = fv; } catch (e) {}
applyFont(_font.value);
_font.onchange = () => { try { localStorage.setItem("hibern8-font", _font.value); } catch (e) {} applyFont(_font.value); };

// refresh once when the panel becomes visible again (we skip repaints while hidden)
document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });

/* ---- boot ---- */
(async () => {
  applyTheme();
  await loadSettings();
  try {
    const self = await chrome.tabs.getCurrent();
    selfTabId = self ? self.id : null;
    selfWindowId = self ? self.windowId : null;
  } catch {}
  log("Hibern8 ready — using native chrome.tabs.discard()", "g");
  wireLiveListeners();
  await render();
  // First-run guidance: if private-window access isn't granted, surface a dismissible note.
  try {
    const allowed = await incognitoAllowed();
    let dismissed = false;
    try { dismissed = localStorage.getItem("hibern8-incog-dismissed") === "1"; } catch (e) {}
    const note = document.getElementById("incogNote");
    if (note && !allowed && !dismissed) note.hidden = false;
  } catch (e) {}
  refreshSocialBanner();
  refreshHoldBanner();
})();

setInterval(autoTick, 2500);
setInterval(sweepLog, 30000);   // expire stale activity-log lines