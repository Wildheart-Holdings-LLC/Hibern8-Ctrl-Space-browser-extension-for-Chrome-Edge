/* Hibern8 hold page — shown for a held tab. No network of its own. Firefox-compatible alias. */
var chrome = (typeof browser !== "undefined") ? browser : globalThis.chrome;

function target() {
  try { return decodeURIComponent(new URLSearchParams(location.search).get("u") || ""); } catch (e) { return ""; }
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return u || "the previous page"; } }

const url = target();
// Only ever navigate to a real web page. Reject javascript:, data:, blob:, file: or any
// non-http(s) scheme so a crafted ?u= value can never run code in the extension's origin.
const safeUrl = /^https?:\/\//i.test(url) ? url : "";
document.getElementById("host").textContent = safeUrl ? hostOf(safeUrl) : "the previous page";

document.getElementById("dashBtn").onclick = () => {
  location.href = chrome.runtime.getURL("dashboard.html");
};

document.getElementById("loadBtn").onclick = () => {
  const warn = document.getElementById("vpnwarn");
  warn.textContent = "";
  // Ask the background to release the hold. If a VPN is required and not detected, it refuses.
  chrome.runtime.sendMessage({ type: "sh:release" }, (resp) => {
    if (resp && resp.ok) {
      location.href = safeUrl || "about:blank";
    } else if (resp && resp.reason === "vpn") {
      warn.textContent = "A VPN connection is required before releasing, and none was detected. Connect your VPN, then try again — or release from the Hibern8 panel.";
    } else {
      warn.textContent = "Couldn't release the hold. Open Hibern8 to release it manually.";
    }
  });
};
