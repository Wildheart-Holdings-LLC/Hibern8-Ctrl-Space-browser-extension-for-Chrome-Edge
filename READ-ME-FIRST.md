# Hibern8 — what's in this folder

A quick map so you can tell everything apart. Items are grouped: KEEP (the real deliverables),
SCAFFOLDING (used to build things; safe to delete), and JUNK (temp/duplicate; safe to delete).

---

## ✅ KEEP — Chrome / Edge extension (these files ARE the extension)
Put these together in one folder, then Load unpacked in chrome://extensions or edge://extensions.

- `manifest.json` ............ extension manifest (JSON)
- `background.js` ............ service worker — opens the dashboard, runs the screen-time timer and Safe-Hold engine
- `dashboard.html` ........... the Hibern8 Ctrl+Space panel page
- `dashboard.css` ............ panel styles
- `dashboard.js` ............. panel logic  ← the big one
- `options.html` ............. settings page (idle default, screen-time timer, Safe-Hold options)
- `options.js` ............... settings logic
- `hold.html` / `hold.js` .... the local "traffic held" page shown for held tabs (required for Safe-Hold)

Companion docs that should travel with the package / store listing:
- `PRIVACY-AND-SECURITY.md` .. the publishable privacy & security statement
- `EULA.md` .................. the end-user license agreement

> Tip: the two "dashboard" and two "options" entries in Explorer look like duplicates but aren't —
> each name has TWO files with different types: an HTML page ("Microsoft Edge HTML") and its
> matching `.js` / `.css`. They all belong together.

## ✅ KEEP — Firefox extension
- `hibern8-firefox/` .......... the complete Firefox build (its own manifest, dashboard, options,
  background, and README-FIREFOX.md). Load via about:debugging → Load Temporary Add-on.

## ✅ KEEP — White paper (latest only)
- `Hibern8_White_Paper_v0_9.docx` .... CURRENT white paper. Use this one.

## ✅ KEEP (optional) — original concept demo
- `hibern8` (Microsoft Edge HTML, ~29 KB) = `hibern8.html`, the standalone *simulation* from the
  very start. Not the extension; keep only if you want the original mockup/demo.

---

## 🧹 SCAFFOLDING — safe to delete (used to generate the white paper)
- `build_whitepaper.js`, `build_wp2.js`, `build_wp3.js`, `build_wp4.js`, `build_wp5.js`, `build_wp6.js`
- `package.json`, `package-lock.json`
- `node_modules/` (folder) — the npm library used to generate the .docx

## 🧹 SUPERSEDED white-paper drafts — safe to delete
- `Hibern8_White_Paper_v0_7.docx`, `Hibern8_White_Paper_v0_8.docx`  (older than v0_9)
- `Hibern8_White_Paper.docx`  (the original v0.6 draft)

## 🧹 JUNK / temp — safe to delete
- `Hibern8_White_Paper.pdf`, `.~lock.Hibern8_White_Paper.pdf#`, `lu41b2g9r.tmp`, `wp_page-1.jpg`

---

## TL;DR
- **Install on Chrome/Edge:** the files at the top → one folder → Load unpacked.
- **Install on Firefox:** the `hibern8-firefox/` folder.
- **Read/share:** `Hibern8_White_Paper_v0_9.docx`.
- Everything in the 🧹 sections can be deleted without affecting the extension.

---

## 🧪 QA checklist (Chrome / Edge — full build)
Run once per browser before publishing. Load unpacked, then:

**Safe-Hold**
1. ⚙ Settings → check **Engage Safe-Hold automatically at startup** (and optionally **Require a VPN…**). Save.
2. Click **🛡 Suspend session**. Expect: red "Traffic held" banner in the panel, a **HOLD** badge on the toolbar icon, and open web tabs become discarded.
3. Click any held web tab → it shows the local **hold.html** page, not the site.
4. In a held tab, try to load a normal site → it does **not** load until you release.
5. Click **Release now**. Banner and badge clear; pages load again.
6. With **Require VPN** on: the release button reads **✓ VPN connected — release** — a manual confirmation, since a browser extension can't auto-detect a VPN. Connect your VPN, then click it to release.

**Restore ordering**
1. Set the browser to reopen the last session (Chrome/Edge: Settings → On startup → **Continue where you left off**).
2. Open several sites plus Hibern8 Ctrl+Space, then quit the browser completely.
3. Relaunch. Expect: Hibern8 opens as the **first (leftmost), active/focused tab** — it should hold that position even a second after restore finishes.
4. If **prompt on session restore** is enabled, expect the restore banner ("Restored N tabs… safe to load, or VPN first?") with **Load now / Hold until VPN / Keep held**; verify each button behaves.

**General**
1. Toolbar icon (or **Ctrl+Space**) opens/focuses Hibern8 Ctrl+Space.
2. Hibernate all except audio/video, Mute all, and per-tab controls work; the ❔ Help panel opens and closes (✕, "Got it", backdrop, Esc).
3. Color/greyscale: the hue + saturation sliders recolor the accent and the toolbar icon; ↺ resets. Font selector applies; Bubble reads rounded.

**Security posture (for reviewers)**
- Strict CSP (`default-src 'self'; script-src 'self'; object-src 'none'; connect-src 'self'; frame-ancestors 'none'; form-action 'none'`) — no inline/remote script can execute.
- No host permissions; the extension never reads or edits web-page content. Injection watchdog: if a script injection is ever blocked, a red in-panel banner names the source and a system notification prompts an antivirus scan. Full details in `PRIVACY-AND-SECURITY.md`.
- Optional developer check: paste `var s=document.createElement('script');s.src='https://example.com/x.js';document.body.appendChild(s);` into the panel's console — the CSP blocks it and the watchdog banner/notification fires; nothing executes.
