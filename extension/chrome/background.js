// Chrome Manifest V3 service worker. Mirrors the Firefox extension's logic using Chrome's
// promise-based extension APIs. A chat turn keeps the service worker alive via the in-flight
// fetch; tokens, jobs, and conversation history are in-memory only and never written to disk.
const SITES = ["https://excela.cfat.site", "https://localhost:3000"];
const accounts = new Map();
const accountRequests = new Map();
const jobs = new Map();
// One active conversation per site: { token, history (raw API messages), transcript (for the popup UI) }.
const conversations = new Map();
const emptyJob = () => ({ busy: false, failed: false, message: "" });
const MAX_TRANSCRIPT = 40;

async function sessionToken(site) {
  const cookie = await chrome.cookies.get({ url: `${site}/`, name: "excela_session" });
  return cookie?.value || null;
}

async function request(site, token, path, body) {
  const response = await fetch(`${site}${path}`, {
    method: body ? "POST" : "GET", credentials: "omit", redirect: "error", cache: "no-store",
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(body ? 65000 : 15000),
  });
  if (response.status === 404 && path === "/api/extension/session") {
    throw new Error("Deploy the updated Excela website first. This extension needs the new extension session endpoint.");
  }
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
  catch { /* The popup shows connection errors when opened. */ }
}

function conversationFor(site, token) {
  const existing = conversations.get(site);
  if (existing?.token === token) return existing;
  const fresh = { token, history: [], transcript: [] };
  conversations.set(site, fresh);
  return fresh;
}

function pushTranscript(conversation, entry) {
  conversation.transcript.push(entry);
  if (conversation.transcript.length > MAX_TRANSCRIPT) conversation.transcript.splice(0, conversation.transcript.length - MAX_TRANSCRIPT);
}

async function chat(site, token, text, pageContext, job) {
  try {
    const session = await account(site, token);
    if (!session.authenticated) throw new Error("Sign in to Excela first.");
    if (!session.sheet || !session.hasApiKey || !session.googleAccess) throw new Error("Complete setup on Excela first.");
    const conversation = conversationFor(site, token);
    pushTranscript(conversation, { role: "user", text, page: pageContext ? { title: pageContext.title, url: pageContext.url } : null });

    const outgoing = pageContext
      ? `Page open in the browser: "${pageContext.title}" (${pageContext.url})\n\n${text}`
      : text;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const data = await request(site, token, "/api/agent", {
      messages: [...conversation.history, { role: "user", content: outgoing }],
      today,
    });
    if (await sessionToken(site) !== token) throw new Error("Your login changed. Sign in and try again.");
    conversation.history = Array.isArray(data.history) ? data.history : conversation.history;
    pushTranscript(conversation, {
      role: "assistant",
      text: data.reply || "",
      tools: Array.isArray(data.toolCalls) ? data.toolCalls : [],
    });
    job.message = "";
  } catch (error) {
    const conversation = conversationFor(site, token);
    pushTranscript(conversation, { role: "assistant", text: error.message || "Excela could not reply. Please try again.", error: true });
    job.failed = true;
    job.message = error.message || "Excela could not reply.";
  } finally {
    job.busy = false;
  }
}

chrome.cookies.onChanged.addListener(({ cookie, removed }) => {
  if (cookie.name !== "excela_session") return;
  for (const site of SITES) {
    if (new URL(site).hostname === cookie.domain.replace(/^\./, "")) {
      accounts.delete(site);
      conversations.delete(site); // Never let one Google account see another's chat history.
      if (!jobs.get(site)?.busy) jobs.delete(site);
      if (!removed) void warmAccount(site);
    }
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") void chrome.tabs.create({ url: SITES[0] });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL("popup.html")) return;
  return (async () => {
    try {
      const site = message.site;
      if (!SITES.includes(site)) throw new Error("Choose Live or Local in the extension.");
      if (message.type === "open") {
        await chrome.tabs.create({ url: `${site}${message.setup ? "/setup" : "/"}` });
        return { ok: true };
      }
      const token = await sessionToken(site);
      const currentJob = jobs.get(site);
      const job = currentJob?.token === token ? currentJob : emptyJob();
      const publicJob = () => ({ busy: job.busy, failed: job.failed, message: job.message });
      const transcriptFor = () => conversationFor(site, token).transcript;
      if (message.type === "snapshot") return { canCompose: Boolean(token), job: publicJob(), transcript: token ? transcriptFor() : [] };
      if (message.type === "job") return { job: publicJob(), transcript: transcriptFor() };
      if (message.type === "status") return { session: await account(site, token), job: publicJob(), transcript: transcriptFor() };
      if (message.type === "reset") {
        if (!token) throw new Error("Sign in to Excela first.");
        conversations.delete(site);
        return { transcript: [] };
      }
      if (message.type !== "send") throw new Error("Unknown command.");
      if (!token) throw new Error("Sign in to Excela first.");
      if (currentJob?.busy) return { error: "Excela is still replying. Wait for that to finish." };
      if (typeof message.text !== "string" || !message.text.trim() || message.text.length > 4000) {
        throw new Error("Enter a message up to 4,000 characters.");
      }
      const pageContext = message.pageContext && typeof message.pageContext.title === "string" && typeof message.pageContext.url === "string"
        ? { title: message.pageContext.title.slice(0, 300), url: message.pageContext.url.slice(0, 2000) }
        : null;
      const nextJob = { token, busy: true, failed: false, message: "" };
      jobs.set(site, nextJob);
      void chat(site, token, message.text.trim(), pageContext, nextJob);
      return { job: { busy: true, failed: false, message: "" }, transcript: transcriptFor() };
    } catch (error) {
      return { error: error.message || "Could not connect to Excela. Check the selected site and try again." };
    }
  })();
});

void chrome.storage.local.get("site").then(({ site }) => warmAccount(SITES.includes(site) ? site : SITES[0])).catch(() => {});
