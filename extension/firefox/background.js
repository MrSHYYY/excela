// Only these origins may receive announcements; credentials remain on each site.
const SITES = ["https://excela.cfat.site", "https://localhost:3000"];
const connecting = new Map();

async function bridgeTab(site) {
  if (connecting.has(site)) return connecting.get(site);
  const BRIDGE = `${site}/?excela-extension=1`;
  const pending = (async () => {
    const tabs = await browser.tabs.query({ url: `https://${new URL(site).hostname}/*` });
    let tab = tabs.find((candidate) => candidate.url === BRIDGE);
    if (!tab) tab = await browser.tabs.create({ url: BRIDGE, active: false });
    for (let attempt = 0; attempt < 40; attempt++) {
      const current = await browser.tabs.get(tab.id);
      if (current.status === "complete") {
        if (new URL(current.url).origin !== site) throw new Error(`Open ${site} in Firefox first.`);
        await browser.scripting.executeScript({ target: { tabId: tab.id }, files: ["bridge.js"] });
        return tab.id;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Excela is still loading. Check ${site}, then reopen the extension.`);
  })();
  connecting.set(site, pending);
  try { return await pending; } finally { connecting.delete(site); }
}

browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") return browser.tabs.create({ url: `${SITES[0]}/?excela-extension=1` });
});

browser.runtime.onMessage.addListener((message, sender) => {
  // Accept commands only from this extension's popup, never from web pages.
  if (sender.id !== browser.runtime.id || sender.url !== browser.runtime.getURL("popup.html")) return;
  return (async () => {
    try {
      const site = message.site;
      if (!SITES.includes(site)) throw new Error("Choose Live or Local in the extension.");
      if (message.type === "open") {
        await browser.tabs.create({ url: `${site}${message.setup ? "/setup" : "/"}` });
        return { ok: true };
      }
      if (!["status", "inject"].includes(message.type)) throw new Error("Unknown command.");
      const tabId = await bridgeTab(site);
      return await browser.tabs.sendMessage(tabId, message);
    } catch (error) {
      return { error: error.message || "Could not connect to Excela. Open the selected site in Firefox and try again." };
    }
  })();
});
