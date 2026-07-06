/* Hibern8 — options page (Chrome/Edge). Persists the default idle threshold, the screen-time
   timer settings, and the Safe-Hold preferences to chrome.storage.local. No host access is
   requested and no page content is ever read. */
const SOCIAL_DEFAULT = ["facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "reddit.com", "youtube.com", "netflix.com", "hulu.com", "twitch.tv", "snapchat.com", "pinterest.com", "threads.net", "tumblr.com"];
const IDLE_DEFAULT = 60;

const $ = (id) => document.getElementById(id);

function cleanDomains(text) {
  return [...new Set(
    text.split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, ""))
      .filter((s) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s))
  )];
}

async function load() {
  let r = {};
  try {
    r = await chrome.storage.local.get([
      "idleDefault", "socialEnabled", "socialDomains",
      "openStartup", "openAfterRestore", "promptOnRestore",
      "holdPrevSession", "safeHoldEngageStartup", "requireVpn",
    ]);
  } catch (e) {}
  $("idle").value = r.idleDefault || IDLE_DEFAULT;
  $("socialEnabled").checked = !!r.socialEnabled;
  const sd = (Array.isArray(r.socialDomains) && r.socialDomains.length) ? r.socialDomains : SOCIAL_DEFAULT;
  $("socialDomains").value = sd.join("\n");
  // Privacy & Safe-Hold (defaults: open at startup + prompt on restore = on)
  $("openStartup").checked = r.openStartup !== false;
  $("openAfterRestore").checked = !!r.openAfterRestore;
  $("promptOnRestore").checked = r.promptOnRestore !== false;
  $("holdPrevSession").checked = !!r.holdPrevSession;
  $("safeHoldEngageStartup").checked = !!r.safeHoldEngageStartup;
  $("requireVpn").checked = !!r.requireVpn;
}

async function save() {
  let idle = parseInt($("idle").value, 10);
  if (isNaN(idle)) idle = IDLE_DEFAULT;
  idle = Math.min(600, Math.max(10, idle));

  const socialEnabled = $("socialEnabled").checked;
  const socialDomains = cleanDomains($("socialDomains").value);
  const safeHold = {
    openStartup: $("openStartup").checked,
    openAfterRestore: $("openAfterRestore").checked,
    promptOnRestore: $("promptOnRestore").checked,
    holdPrevSession: $("holdPrevSession").checked,
    safeHoldEngageStartup: $("safeHoldEngageStartup").checked,
    requireVpn: $("requireVpn").checked,
  };
  try { await chrome.storage.local.set({ idleDefault: idle, socialEnabled, socialDomains, ...safeHold }); } catch (e) {}

  $("idle").value = idle;
  const s = $("status");
  s.textContent = `Saved · idle ${idle}s. Reopen Hibern8 to apply.`;
  s.style.color = "var(--good)";
  setTimeout(() => { s.textContent = ""; }, 5000);
}

async function reset() {
  try { await chrome.storage.local.set({ idleDefault: IDLE_DEFAULT }); } catch (e) {}
  $("idle").value = IDLE_DEFAULT;
  const s = $("status"); s.textContent = "Reset to defaults."; s.style.color = "var(--good)";
  setTimeout(() => { s.textContent = ""; }, 4000);
}

$("saveBtn").onclick = save;
$("resetBtn").onclick = reset;
load();
