/* Hibern8 background service worker (MV3)
   Opens (or focuses) the dashboard page when the toolbar icon is clicked. */

chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("dashboard.html");
  const existing = await chrome.tabs.query({ url });
  if (existing.length) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
});

/* ============================================================
   SOCIAL-MEDIA / ENTERTAINMENT SCREEN-TIME TIMER
   Counts active time on social/entertainment sites (only while
   the user is active and the site is the focused tab). Alerts at
   30 min, then 60, then every 15 min. Resets daily. Surfaces a
   banner in the command center and a system notification.
   ============================================================ */
const SOCIAL = [
  "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "reddit.com",
  "youtube.com", "netflix.com", "hulu.com", "twitch.tv", "snapchat.com", "pinterest.com",
  "disneyplus.com", "max.com", "hbomax.com", "primevideo.com", "threads.net", "tumblr.com",
];
function isSocial(url, domains) {
  const list = (Array.isArray(domains) && domains.length) ? domains : SOCIAL;
  try { const h = new URL(url).hostname.replace(/^www\./, ""); return list.some((d) => h === d || h.endsWith("." + d)); }
  catch (e) { return false; }
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
// Notifications require an iconUrl — use the packaged icon (a data: URL is blocked by our CSP's connect-src).
const NOTE_ICON = chrome.runtime.getURL("icon48.png");

function ensureAlarm() { try { chrome.alarms.create("socialTick", { periodInMinutes: 1 }); } catch (e) {} }
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);
ensureAlarm();

// First-run prompt: open Hibern8 and tell the user about the Ctrl+Space shortcut and how to change it.
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason !== "install") return;
  try { await openDashboard(true); } catch (e) {}
  try {
    chrome.notifications.create("hibern8-shortcut", {
      type: "basic", iconUrl: NOTE_ICON,
      title: "Hibern8 is ready — press Ctrl+Space",
      message: "Open Hibern8 anytime with Ctrl+Space. Click here to change or reassign the shortcut.",
      priority: 1,
    });
  } catch (e) {}
});
// Clicking the first-run notification opens the browser's shortcut-customization page.
chrome.notifications.onClicked.addListener((id) => {
  if (id === "hibern8-shortcut") { try { chrome.tabs.create({ url: "chrome://extensions/shortcuts" }); } catch (e) {} }
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "socialTick") return;
  try {
    const cfg = await chrome.storage.local.get(["socialEnabled", "socialDomains", "socialState"]);
    if (!cfg.socialEnabled) return;                      // OPT-IN: do nothing unless the user enabled the timer
    let idle = "active";
    try { idle = await chrome.idle.queryState(60); } catch (e) {}
    if (idle !== "active") return;                       // only count when the user is actually active
    // Count this minute if EITHER the user is viewing a chosen site in the foreground,
    // OR a chosen entertainment site is actively playing audio/video in the background
    // (e.g. a movie left running in another window while you work). The idle check above
    // already prevents counting while you're away from the machine.
    let counts = false;
    const win = await chrome.windows.getLastFocused({ populate: true }).catch(() => null);
    if (win && win.focused && win.state !== "minimized") {
      const act = (win.tabs || []).find((t) => t.active);
      if (act && isSocial(act.url || "", cfg.socialDomains)) counts = true;   // foreground browsing
    }
    if (!counts) {
      try {
        const playing = await chrome.tabs.query({ audible: true });           // background media still playing sound
        if (playing.some((t) => !(t.mutedInfo && t.mutedInfo.muted) && isSocial(t.url || "", cfg.socialDomains))) counts = true;
      } catch (e) {}
    }
    if (!counts) return;

    let st = cfg.socialState || { day: todayStr(), seconds: 0, lastThreshold: 0 };
    if (st.day !== todayStr()) st = { day: todayStr(), seconds: 0, lastThreshold: 0 };
    st.seconds += 60;
    const mins = Math.floor(st.seconds / 60);

    let due = 0;
    if (mins >= 30 && st.lastThreshold < 30) due = 30;                       // first alert at 30 min
    else if (mins >= 60 && mins % 15 === 0 && mins > st.lastThreshold) due = mins;  // then 60, 75, 90, ...
    if (due) {
      st.lastThreshold = due;
      const hh = String(Math.floor(due / 60)).padStart(2, "0"), mm = String(due % 60).padStart(2, "0");
      try {
        chrome.notifications.create("hibern8-social-" + due, {
          type: "basic", iconUrl: NOTE_ICON, title: "Hibern8 - Screen-time check",
          message: `You've been on social media and entertainment sites for ${hh}:${mm} today. Time for a break?`,
        });
      } catch (e) {}
    }
    await chrome.storage.local.set({ socialState: st });
  } catch (e) {}
});

/* ============================================================
   SAFE-HOLD / SUSPEND SESSION  (public-network privacy gate)
   Holds ALL page traffic (via a declarativeNetRequest block rule)
   while suspended, keeps tabs discarded, and shows a local hold
   page instead of loading. Release is MANUAL; optionally gated on
   a best-effort VPN check. On session restore it can auto-hold and
   prompt "are these tabs safe to load, or do you need a VPN first?"
   Nothing about you leaves the device — this only blocks/paces the
   browser's own outbound requests.
   ============================================================ */
const GATE_RULE_ID = 9042;

function selfPrefix() { return chrome.runtime.getURL(""); }
function isHttp(u) { return /^https?:\/\//i.test(u || ""); }

async function getPrefs() {
  let r = {};
  try {
    r = await chrome.storage.local.get([
      "openStartup", "openAfterRestore", "promptOnRestore",
      "safeHoldEngageStartup", "requireVpn", "holdPrevSession",
    ]);
  } catch (e) {}
  return {
    openStartup: r.openStartup !== false,          // default: open at startup
    openAfterRestore: !!r.openAfterRestore,
    promptOnRestore: r.promptOnRestore !== false,  // default: prompt on restore
    safeHoldEngageStartup: !!r.safeHoldEngageStartup,
    requireVpn: !!r.requireVpn,
    holdPrevSession: !!r.holdPrevSession,
  };
}

// Runtime hold state lives in session storage (cleared when the browser closes).
async function getHold() {
  try { const { sh } = await chrome.storage.session.get("sh"); return sh || { active: false }; }
  catch (e) { try { const { sh } = await chrome.storage.local.get("sh"); return sh || { active: false }; } catch (e2) { return { active: false }; } }
}
async function setHold(sh) {
  try { await chrome.storage.session.set({ sh }); }
  catch (e) { try { await chrome.storage.local.set({ sh }); } catch (e2) {} }
}

// A browser extension has no API to detect a VPN or read network interfaces
// (chrome.system.network is only available to packaged apps, not extensions), so we
// cannot auto-detect a tunnel. This always returns false; the "require VPN" option is
// therefore a MANUAL confirmation gate — the user confirms their VPN is connected and
// releases. Kept as a function so the message API and UI can stay unchanged.
async function vpnDetected() { return false; }

async function setGate(on) {
  try {
    if (on) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [GATE_RULE_ID],
        addRules: [{
          id: GATE_RULE_ID, priority: 1, action: { type: "block" },
          condition: {
            regexFilter: "^https?:",
            resourceTypes: ["main_frame", "sub_frame", "stylesheet", "script", "image",
              "font", "object", "xmlhttprequest", "ping", "media", "websocket", "csp_report", "other"],
          },
        }],
      });
    } else {
      await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [GATE_RULE_ID] });
    }
  } catch (e) {}
}

async function badge(on) {
  try {
    await chrome.action.setBadgeText({ text: on ? "HOLD" : "" });
    await chrome.action.setBadgeBackgroundColor({ color: on ? "#c0392b" : "#000000" });
  } catch (e) {}
}

async function outsideTabs() {
  const pre = selfPrefix();
  let tabs = [];
  try { tabs = await chrome.tabs.query({}); } catch (e) {}
  return tabs.filter((t) => isHttp(t.url) && !(t.url || "").startsWith(pre));
}

async function discardOutside() {
  for (const t of await outsideTabs()) {
    if (!t.discarded && !t.active) { try { await chrome.tabs.discard(t.id); } catch (e) {} }
  }
}

// Pause any in-progress browser downloads/file transfers so a hold also freezes the
// download queue (the DNR gate only blocks NEW requests, not bytes already streaming).
// Returns the ids we paused, so we can resume exactly those on release.
async function holdDownloads() {
  const ids = [];
  try {
    if (chrome.downloads && chrome.downloads.search) {
      const items = await chrome.downloads.search({ state: "in_progress" });
      for (const d of items) {
        if (d.paused) continue;   // leave user-paused downloads alone
        try { await chrome.downloads.pause(d.id); ids.push(d.id); } catch (e) {}
      }
    }
  } catch (e) {}
  return ids;
}
async function resumeDownloads(ids) {
  if (!chrome.downloads || !chrome.downloads.resume) return;
  for (const id of (ids || [])) { try { await chrome.downloads.resume(id); } catch (e) {} }
}

async function engageHold(mode, needPrompt) {
  const held = (await outsideTabs()).length;
  const dl = await holdDownloads();            // freeze active file transfers too
  await setHold({ active: true, mode, needPrompt: !!needPrompt, held, dl });
  await setGate(true);
  await discardOutside();
  await badge(true);
}

async function releaseHold() {
  const sh = await getHold();
  await setHold({ active: false });
  await setGate(false);
  await resumeDownloads(sh.dl);                // resume exactly the transfers we paused
  await badge(false);
}

// While a hold is active, pause any newly-started download immediately and remember it.
try {
  if (chrome.downloads && chrome.downloads.onCreated) {
    chrome.downloads.onCreated.addListener(async (d) => {
      const sh = await getHold();
      if (!sh.active) return;
      try {
        await chrome.downloads.pause(d.id);
        const s = await getHold();
        s.dl = [...new Set([...(s.dl || []), d.id])];
        await setHold(s);
      } catch (e) {}
    });
  }
} catch (e) {}

async function openDashboard(atFront) {
  const url = chrome.runtime.getURL("dashboard.html");
  try {
    const existing = await chrome.tabs.query({ url });
    let tab;
    if (existing.length) { tab = existing[0]; try { await chrome.tabs.update(tab.id, { active: true }); } catch (e) {} }
    else { tab = await chrome.tabs.create({ url, index: atFront ? 0 : undefined, active: true }); }
    if (!tab) return;
    // Session restore can re-activate the previously-focused tab a beat after we open ours.
    // Re-assert Hibern8's position/focus a couple of times so it reliably lands first and
    // active in Chrome and Firefox (matching Edge), then leaves the user alone.
    const reassert = async () => {
      try {
        if (atFront) { try { await chrome.tabs.move(tab.id, { index: 0 }); } catch (e) {} }
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      } catch (e) {}
    };
    setTimeout(reassert, 350);
    setTimeout(reassert, 1200);
  } catch (e) {}
}

// Browser launch / session restore.
chrome.runtime.onStartup.addListener(async () => {
  const p = await getPrefs();
  const held = await outsideTabs();

  if (p.safeHoldEngageStartup) {
    await engageHold("startup", false);                 // auto-hold everything until released
  } else if (p.promptOnRestore && held.length) {
    await engageHold("restore", true);                  // hold + ask "safe to load, or VPN first?"
  } else if (p.holdPrevSession && held.length) {
    await engageHold("restore", false);                 // hold quietly until manual refresh
  }

  if (p.openStartup) await openDashboard(true);
  else if (p.openAfterRestore) await openDashboard(false);
});

// While held, redirect any activated web tab to the local hold page (no network),
// as a friendly complement to the network block.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const sh = await getHold();
  if (!sh.active) return;
  try {
    const t = await chrome.tabs.get(tabId);
    if (isHttp(t.url) && !(t.url || "").startsWith(selfPrefix())) {
      const hold = chrome.runtime.getURL("hold.html") + "?u=" + encodeURIComponent(t.url);
      await chrome.tabs.update(tabId, { url: hold });
    }
  } catch (e) {}
});

// Message API for the dashboard and the hold page.
chrome.runtime.onMessage.addListener((msg, sender, send) => {
  (async () => {
    try {
      if (!msg || !msg.type) return send({});
      if (msg.type === "sh:get") {
        const sh = await getHold(); const prefs = await getPrefs();
        const vpn = await vpnDetected(); const held = (await outsideTabs()).length;
        return send({ sh, prefs, vpn, held });
      }
      if (msg.type === "sh:suspend") { await engageHold("suspend", false); return send({ ok: true }); }
      if (msg.type === "sh:checkVpn") { return send({ vpn: await vpnDetected() }); }
      if (msg.type === "sh:clearPrompt") {
        const sh = await getHold(); if (sh.active) { sh.needPrompt = false; await setHold(sh); }
        return send({ ok: true });
      }
      if (msg.type === "sh:release") {
        const p = await getPrefs();
        if (p.requireVpn && !msg.force) {
          const v = await vpnDetected();
          if (!v) return send({ ok: false, reason: "vpn" });   // require VPN before releasing
        }
        await releaseHold();
        return send({ ok: true });
      }
    } catch (e) { return send({ ok: false, error: String(e) }); }
  })();
  return true;   // async response
});
