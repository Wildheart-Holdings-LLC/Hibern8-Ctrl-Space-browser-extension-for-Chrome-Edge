# Hibern8 Ctrl+Space - Privacy & Security Statement

**Publisher:** Wildheart Holdings LLC
**Products covered:** Hibern8 Ctrl+Space (Chrome/Edge build), Hibern8 Ctrl+Space (Firefox build), and Hibern8 Ctrl+Space Lite
**Version:** 0.6.0
**Effective date:** June 30, 2026
**Contact:** steve@wildheartholdingsllc.com

---

## 1. Summary (plain-language)

Hibern8 Ctrl+Space helps you hibernate idle browser tabs to free memory, find and mute tabs
playing sound, and - optionally - hold traffic on untrusted networks. **Hibern8 Ctrl+Space does
not collect, transmit, sell, rent, or share any personal information or browsing data.**
It has no servers, no analytics, no advertising, no telemetry, and no third-party code.
Everything it does happens locally, inside your own browser profile on your own device.

Hibern8 Ctrl+Space requests **no host permissions and never reads or edits the content of any web page**.
Optional features (the screen-time timer and Safe-Hold) are **off by default and opt-in**, and
everything they do also stays on your device.

---

## 2. Data that leaves your device (collected, transmitted, or sold)

**None.** Hibern8 Ctrl+Space sends nothing off your device - not to Wildheart Holdings LLC and
not to anyone else. This section is about data *leaving* your device; the settings
Hibern8 Ctrl+Space saves *on* your device are covered separately in Section 3, and those never
leave either. Specifically, Hibern8 Ctrl+Space does **not**:

- collect, log, or transmit your browsing history, tab contents, URLs, page text, keystrokes, or search terms;
- send any data to Wildheart Holdings LLC or to any third party;
- use analytics, tracking pixels, advertising identifiers, fingerprinting, or telemetry;
- include any third-party SDKs, remote scripts, or hosted code;
- create user accounts or require sign-in.

Because there is no transmission, there is no server-side retention, no data sale, and
no data sharing.

---

## 3. Settings Hibern8 Ctrl+Space saves on your device (and why)

To clarify the point above: Hibern8 Ctrl+Space does save a small amount of information, but **only on
your own device** - these are your own settings and state, not data collected *about* you.
Nothing here is ever sent to Wildheart Holdings LLC or any third party, so saving it is not
"data collection" in the sense of Section 2. It uses the browser's own local extension
storage (`storage.local`), in-session storage (`storage.session`), and per-page
`localStorage`. You can erase all of it at any time by removing the extension.

| Stored item | Purpose | Location |
|---|---|---|
| UI preferences (theme, accent color/hue, font, sort order, auto-unmute, dismissed notices) | Remember how you like the panel to look and behave | `localStorage` (extension page) |
| Default idle threshold | Configure how long a tab sits idle before Auto-snooze | `storage.local` |
| Screen-time timer settings and today's counter (opt-in) | Run the optional break reminder; resets daily | `storage.local` |
| Safe-Hold preferences and the current hold state | Remember your Safe-Hold choices and whether traffic is currently held | `storage.local` / `storage.session` |

Hibern8 Ctrl+Space reads tab information the browser already exposes to it (title, URL, audible
state, discarded/pinned/active state) **at runtime to render the panel and perform the
action you request**. This information is used in memory to draw the interface and is not
recorded, profiled, or transmitted.

---

## 4. Permissions and why each is requested

Hibern8 Ctrl+Space follows least-privilege: it requests the minimum permissions needed. It requests
**no host permissions and never reads or edits the content of any web page.**

### Full build (Chrome / Edge)

| Permission | Why it is needed |
|---|---|
| `tabs` | List, hibernate (discard), mute, close, and switch to tabs, and read their title/URL/state to render the panel |
| `tabGroups` | Mirror your existing browser tab groups in the panel |
| `favicon` | Show site icons drawn from the browser's **own local icon cache** (no network request) |
| `storage` | Save the local preferences and state described in Section 3 |
| `bookmarks` | Create or remove a bookmark when you click the bookmark control on a tab |
| `alarms` | Run the once-a-minute tick for the optional screen-time timer |
| `idle` | Detect whether you are active so the screen-time timer counts only active time (opt-in) |
| `notifications` | Show the optional screen-time break reminder |
| `declarativeNetRequest` | During Safe-Hold, block the browser's own outbound page requests. This is a **block-only** rule; Hibern8 Ctrl+Space does not read, log, or modify request contents |
| `downloads` | Pause in-progress downloads while Safe-Hold is engaged, and resume them on release, so a hold also freezes the file-transfer queue. Hibern8 Ctrl+Space does not read, open, or move your files |
| `incognito: spanning` | Lets bulk Mute/Hibernate and the private audio/video view reach private windows **only if you separately enable "Allow in Incognito."** Per-tab controls are never applied to private tabs |

Hibern8 Ctrl+Space requests **no host permissions** - no `*://*/*` or per-site access - and does not use the `scripting` API or inject any code into web pages.

### Firefox build

Same as above **except** it does not use `tabGroups` or `favicon`. Favicons in the Firefox
build come from the site's own icon URL provided by the browser.

### Lite build

| Permission | Why it is needed |
|---|---|
| `tabs` | Hibernate, mute, close, and list tabs |
| `storage` | Remember the two Safe-Hold toggles |
| `declarativeNetRequest` | Block-only traffic hold during Safe-Hold |
| `downloads` | Pause/resume in-progress downloads with Safe-Hold; does not read or open files |

Hibern8 Ctrl+Space Lite requests **no host permissions** and has no screen-time, or bookmark features.

---

## 5. Security measures

- **No remote code.** Hibern8 Ctrl+Space contains no `eval`, no `new Function`, no `importScripts`, and loads no scripts from any server. All code ships inside the package and is reviewable.
- **Strict Content-Security-Policy.** Every extension page runs under a locked-down CSP - `default-src 'self'; script-src 'self'; object-src 'none'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'` (with `img-src` scoped to the extension's own icons/data, plus `https:` on Firefox for site favicons). This blocks any inline or remotely-hosted script from ever executing, and `connect-src 'self'` keeps network access limited to the extension's own packaged resources.
- **Injection watchdog.** If the CSP ever blocks an attempted script injection, Hibern8 Ctrl+Space detects the browser's report and (a) shows a persistent in-panel warning naming the blocked source, (b) logs it, and (c) on the full builds raises a system notification urging you to run your antivirus/security scan. (Browser extensions cannot signal antivirus software directly, so this user alert is how a scan is prompted.)
- **No network calls.** The extension makes no `fetch`, `XMLHttpRequest`, `sendBeacon`, or WebSocket requests. It transmits nothing.
- **Output escaping.** All dynamic text placed into the interface (tab titles, hostnames, URLs, group names, error messages) is HTML-escaped (including quotes and backticks) to prevent script or markup injection from page-supplied values.
- **Safe navigation.** Any URL Hibern8 Ctrl+Space navigates to (for example, releasing a held tab) is scheme-validated to `http`/`https` only, so a crafted value can never invoke a `javascript:` or `data:` URL in the extension's context.
- **Least privilege & opt-in.** Hibern8 Ctrl+Space requests no host permissions and reads no page content. Optional capabilities (the screen-time timer and Safe-Hold traffic blocking) are off by default and require your explicit action.
- **Local-only storage.** All preferences and state live in your browser profile on your device.

---

## 6. Feature-specific notes and honest limitations

- **Waking a hibernated tab** reloads that page from its own source over the network. That is the tab's normal traffic when you choose to reload it - Hibern8 Ctrl+Space is not sending your data anywhere.
- **Favicons** (Chrome/Edge) are served from the browser's local icon cache; (Firefox) from the site's icon URL the browser provides. Neither involves Hibern8 Ctrl+Space contacting a server on your behalf.
- **Safe-Hold** blocks the browser's outbound page traffic while engaged and is released **manually**. It also **pauses in-progress browser downloads** (and any new ones started while held) and resumes them on release, so the file-transfer queue is frozen too. Note that the network gate blocks *new* requests but does not tear down a connection already streaming - the download pause is what freezes in-flight transfers; it applies to browser downloads only, not to transfers by other applications. Safe-Hold is a browser-level, defense-in-depth convenience - **not a substitute** for your VPN client's own kill-switch or your operating-system firewall, which protect all applications system-wide.
- **VPN presence is not auto-detected.** A browser extension has no API to detect a VPN or read network interfaces. The "require VPN" option is therefore a **manual confirmation**: when enabled, releasing the hold requires you to confirm your VPN is connected - Hibern8 Ctrl+Space cannot verify it for you.
- **On-screen memory and power figures are illustrative estimates,** not measurements. Your browser's task manager shows the true numbers.

---

## 7. Children's privacy

Hibern8 Ctrl+Space is a general-purpose utility that collects no personal information from anyone,
including children. It is not directed to children and gathers no data on which an age
determination could be made.

---

## 8. Store data-disclosure declarations

For the Chrome Web Store / Microsoft Edge Add-ons data-use disclosures, Hibern8 Ctrl+Space declares:
**no user data is collected or transmitted.** Wildheart Holdings LLC further certifies, as
applicable to those programs, that it does **not** sell user data, does **not** use or
transfer user data for purposes unrelated to the extension's single purpose, and does
**not** use or transfer user data to determine creditworthiness or for lending purposes.

For Firefox Add-ons (AMO), Hibern8 Ctrl+Space declares that it does not collect or transmit personal
data. Any human-readable source requested during AMO review is provided privately to
Mozilla reviewers and does not constitute public disclosure or open-source licensing.

---

## 9. Changes to this statement

If a future version changes what data is stored or how permissions are used, this
statement and the store listing will be updated before or with that release, and the
effective date above will change accordingly.

---

## 10. Provisions, warranty disclaimer, and limitation of liability

The following provisions apply to your use of Hibern8 Ctrl+Space and are provided in addition to the
End-User License Agreement (`EULA.md`).

- **As-is; no warranty.** Hibern8 Ctrl+Space is provided "AS IS" and "AS AVAILABLE," without warranty of any kind, express or implied, including merchantability, fitness for a particular purpose, title, and non-infringement. It is not a certified, security-attested, or independently audited product.
- **Best-effort features.** Safe-Hold and the memory/power estimates are provided on a best-effort, illustrative basis and must not be relied upon as guarantees of privacy, security, network protection, or energy savings.
- **User responsibility.** You are responsible for complying with the acceptable-use, security, and privacy policies of any network, employer, school, or jurisdiction in which you use the extension, and for maintaining independent protections (such as a VPN kill-switch and OS firewall) appropriate to your risk.
- **Indemnification.** As set out in the EULA, you (and, where applicable, the organization deploying the extension across its devices or people) agree to defend and hold Wildheart Holdings LLC harmless from third-party claims arising out of your use, configuration, or deployment of the Software, your breach of the license, or your violation of law or third-party rights - except for the Licensor's own gross negligence or willful misconduct, or where such indemnification is prohibited by law.
- **Limitation of liability.** To the maximum extent permitted by law, Wildheart Holdings LLC will not be liable for any indirect, incidental, special, consequential, or punitive damages, or for any loss of data, profits, or goodwill, arising from the use of or inability to use Hibern8 Ctrl+Space, even if advised of the possibility of such damages.
- **Substantiation studies billed to the requester.** The figures and statements in this document and in Hibern8 Ctrl+Space (including memory, power, and energy estimates) are provided on an illustrative, good-faith basis. If any party requests that a claim, statement, estimate, or figure be independently proven, benchmarked, audited, or validated through a formal study or test, that work is a separate professional engagement - it is quoted, **billed to, and paid for by the requesting party in advance**, and is undertaken only after payment is received and a written agreement is in place.
- **No professional advice.** This statement is provided for informational and store-compliance purposes and is not legal advice.

---

*Copyright 2026 Wildheart Holdings LLC. All rights reserved. Hibern8 Ctrl+Space is provided under the terms of its EULA. This document should be reviewed by qualified counsel before publication if it will serve as your binding privacy policy.*
