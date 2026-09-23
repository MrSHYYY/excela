// Persistent Firefox background: jobs survive popup/tab closure (not browser shutdown).
// Only the site preference is saved to disk. Tokens and jobs stay in memory.
const SITES = ["https://excela.cfat.site", "https://localhost:3000"];
const accounts = new Map();
const accountRequests = new Map();
const jobs = new Map();
const emptyJob = () => ({ busy: false, failed: false, message: "" });

async function sessionToken(site) {
  const cookie = await browser.cookies.get({ url: `${site}/`, name: "excela_session" });
  return cookie?.value || null;
}

async function request(site, token, path, body) {
  const response = await fetch(`${site}${path}`, {
    method: body ? "POST" : "GET", credentials: "omit", redirect: "error", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(body ? 90000 : 15000),
  });
  if (response.status === 404 && path === "/api/extension/session") {
    throw new Error("Deploy the updated Excela website first. This extension needs the new extension session endpoint.");
  }
  if (response.status === 413) throw new Error("The attachment is too large. Try a smaller image.");
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("Excela returned an unexpected page. Check the selected site and deploy the updated website.");
  }
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 || data.code === "auth" || data.code === "setup_required") accounts.delete(site);
    throw new Error(data.error || "Excela could not complete the request.");
  }
  return data;
}

async function account(site, token) {
  if (!token) { accounts.delete(site); return { authenticated: false }; }
  const cached = accounts.get(site);
  if (cached?.token === token && cached.expires > Date.now()) return cached.session;
  const pending = accountRequests.get(site);
  if (pending?.token === token) return pending.promise;
  const promise = (async () => {
    const session = await request(site, token, "/api/extension/session");
    // Ignore stale responses if the user signed out or changed accounts meanwhile.
    if (await sessionToken(site) === token) {
      if (session.authenticated && session.sheet && session.hasApiKey && session.googleAccess) {
        accounts.set(site, { token, session, expires: Date.now() + 60000 });
      } else accounts.delete(site);
    }
    return session;
  })();
  accountRequests.set(site, { token, promise });
  try { return await promise; }
  finally { if (accountRequests.get(site)?.promise === promise) accountRequests.delete(site); }
}

async function warmAccount(site) {
  try { await account(site, await sessionToken(site)); }
  catch { /* The popup shows connection errors when opened; never open a tab here. */ }
}

async function inject(site, token, message, job) {
  let writing = false;
  try {
    const session = await account(site, token);
    if (!session.authenticated) throw new Error("Sign in to Excela first.");
    if (!session.sheet || !session.hasApiKey || !session.googleAccess) throw new Error("Complete setup on Excela first.");
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const data = await request(site, token, "/api/ai", { message: message.text, pipeline: message.pipeline, today, ...(message.image ? { image: message.image } : {}) });
    const events = data.response?.events;
    const action = data.response?.action;
    const completionDate = ["complete_day", "uncomplete_day"].includes(action) && typeof data.response.date === "string" ? data.response.date : null;
    if (!completionDate && (!Array.isArray(events) || !events.length)) {
      job.message = "Declined — no supported planner action found. Nothing changed.";
      return;
    }
    if (await sessionToken(site) !== token) throw new Error("Your login changed. Sign in and try again.");
    job.message = completionDate ? (action === "uncomplete_day" ? "Marking completed tasks pending…" : "Marking pending tasks complete…") : "Writing to your planner…";
    writing = true;
    const result = await request(site, token, "/api/sync", completionDate ? { action, date: completionDate } : { action: "add_events", events });
    job.message = completionDate
      ? action === "uncomplete_day"
        ? (result.uncompleted ? `Marked pending: ${result.uncompleted} task(s) on ${completionDate}.` : `No completed blue tasks on ${completionDate}. Nothing changed.`)
        : (result.completed ? `Completed: ${result.completed} task(s) on ${completionDate}.` : `No pending red tasks on ${completionDate}. Nothing changed.`)
      : `Injected: ${result.written} event(s) written, ${result.skipped} already present.`;
  } catch (error) {
    job.failed = true;
    job.message = (error.message || "Injection failed.") + (writing ? " Check your sheet before retrying." : "");
  } finally { job.busy = false; }
}

browser.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (cookie.name !== "excela_session") return;
  for (const site of SITES) {
    if (new URL(site).hostname === cookie.domain.replace(/^\./, "")) {
      accounts.delete(site);
      if (!jobs.get(site)?.busy) jobs.delete(site);
      if (!removed) void warmAccount(site);
    }
  }
});

browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") return browser.tabs.create({ url: SITES[0] });
});

browser.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== browser.runtime.id || sender.url !== browser.runtime.getURL("popup.html")) return;
  return (async () => {
    try {
      const site = message.site;
      if (!SITES.includes(site)) throw new Error("Choose Live or Local in the extension.");
      if (message.type === "open") {
        await browser.tabs.create({ url: `${site}${message.setup ? "/setup" : "/"}` });
        return { ok: true };
      }
      const token = await sessionToken(site);
      const currentJob = jobs.get(site);
      const job = currentJob?.token === token ? currentJob : emptyJob();
      const publicJob = () => ({ busy: job.busy, failed: job.failed, message: job.message });
      // Local-only snapshot: allow drafting before the network account check finishes.
      if (message.type === "snapshot") return { canCompose: Boolean(token), job: publicJob() };
      if (message.type === "job") return { job: publicJob() };
      if (message.type === "status") return { session: await account(site, token), job: publicJob() };
      if (message.type !== "inject") throw new Error("Unknown command.");
      if (!token) throw new Error("Sign in to Excela first.");
      if (currentJob?.busy) return { error: "An injection is already running. Wait for it to finish." };
      if (message.image && (!["image/png", "image/jpeg", "image/webp"].includes(message.image.mimeType) || typeof message.image.data !== "string" || !message.image.data.length || message.image.data.length > 4 * 1024 * 1024)) {
        throw new Error("Paste one PNG, JPEG or WebP image up to 3 MB.");
      }
      if (typeof message.text !== "string" || (!message.text.trim() && !message.image) || message.text.length > 20000 || !["general", "academic"].includes(message.pipeline)) {
        throw new Error("Enter a message or paste an image.");
      }
      const nextJob = { token, busy: true, failed: false, message: "Reading your announcement…" };
      jobs.set(site, nextJob);
      void inject(site, token, message, nextJob);
      return { job: { busy: true, failed: false, message: nextJob.message } };
    } catch (error) {
      return { error: error.message || "Could not connect to Excela. Check the selected site and try again." };
    }
  })();
});

// Start the account lookup before the popup opens, without periodic server polling.
void browser.storage.local.get("site").then(({ site }) => warmAccount(SITES.includes(site) ? site : SITES[0])).catch(() => {});
