const field = document.getElementById("message");
const sendButton = document.getElementById("send");
const setup = document.getElementById("setup");
const status = document.getElementById("status");
const sitePicker = document.getElementById("site");
const messagesEl = document.getElementById("messages");
const emptyState = document.getElementById("empty-state");
const includePage = document.getElementById("include-page");
const pageContextBox = document.getElementById("page-context");
const pageLabel = document.getElementById("page-label");
const newChatButton = document.getElementById("new-chat");
let site = "https://excela.cfat.site";
let checking = true;
let refreshId = 0;
const send = (message) => chrome.runtime.sendMessage({ ...message, site });
let ready = false;
let canCompose = false;
let busy = false;
let authenticated = false;
let timer;
let sending = false;
let activeTab = null; // { title, url } captured once per popup open via activeTab permission

function updateControls() {
  sitePicker.disabled = busy || sending;
  document.getElementById("loading").hidden = !checking || canCompose;
  document.getElementById("chat").hidden = !canCompose;
  document.getElementById("form").hidden = !canCompose;
  document.getElementById("keyboard-hint").hidden = !canCompose;
  newChatButton.hidden = !canCompose;
  sendButton.disabled = !ready || busy || checking || !field.value.trim();
  field.disabled = !canCompose || busy;
  pageContextBox.classList.toggle("unavailable", !activeTab);
  includePage.disabled = !activeTab || busy;
}

function renderTranscript(transcript) {
  messagesEl.innerHTML = "";
  emptyState.hidden = Boolean(transcript?.length);
  for (const entry of transcript || []) {
    if (entry.role === "user") {
      if (entry.page) {
        const chip = document.createElement("div");
        chip.className = "page-chip";
        chip.textContent = `↗ included ${entry.page.title || entry.page.url}`;
        messagesEl.appendChild(chip);
      }
      const bubble = document.createElement("div");
      bubble.className = "bubble user";
      bubble.textContent = entry.text;
      messagesEl.appendChild(bubble);
    } else {
      const bubble = document.createElement("div");
      bubble.className = "bubble assistant";
      if (entry.error) bubble.dataset.error = "true";
      bubble.textContent = entry.text;
      if (entry.tools?.length) {
        const chips = document.createElement("div");
        chips.className = "tool-chips";
        for (const tool of entry.tools) {
          const chip = document.createElement("span");
          chip.className = "tool-chip";
          chip.dataset.ok = String(tool.ok !== false);
          chip.textContent = tool.name;
          chips.appendChild(chip);
        }
        bubble.appendChild(chips);
      }
      messagesEl.appendChild(bubble);
    }
  }
  if (busy) {
    const thinking = document.createElement("div");
    thinking.className = "bubble thinking";
    thinking.innerHTML = "<span class=\"dot\"></span><span class=\"dot\"></span><span class=\"dot\"></span>";
    messagesEl.appendChild(thinking);
  }
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function renderJob(job, transcript) {
  busy = Boolean(job?.busy);
  status.textContent = job?.message || "";
  status.dataset.error = String(Boolean(job?.failed));
  if (transcript !== undefined) renderTranscript(transcript);
  updateControls();
}

async function captureActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && /^https?:\/\//.test(tab.url)) {
      activeTab = { title: tab.title || tab.url, url: tab.url };
      pageLabel.textContent = `Include this page (${new URL(tab.url).hostname})`;
    } else {
      activeTab = null;
      pageLabel.textContent = "Include this page";
    }
  } catch {
    activeTab = null;
  }
}

async function refresh() {
  const id = ++refreshId;
  clearTimeout(timer);
  checking = true;
  document.getElementById("retry").hidden = true;
  updateControls();
  try {
    const result = await send({ type: "status" });
    if (id !== refreshId) return;
    if (result.error) throw new Error(result.error);
    const session = result.session;
    authenticated = Boolean(session?.authenticated);
    ready = Boolean(authenticated && session.sheet && session.hasApiKey && session.googleAccess);
    canCompose = ready;
    setup.hidden = ready;
    setup.textContent = authenticated ? "Complete setup ↗" : "Sign in to Excela ↗";
    document.getElementById("planner").textContent = ready ? `Connected · ${session.sheet.title}` : authenticated ? "Complete your Excela setup to continue." : "Sign in to Excela to continue.";
    renderJob(authenticated ? result.job : null, result.transcript);
    if (busy) timer = setTimeout(pollJob, 900);
  } catch (error) {
    if (id !== refreshId) return;
    ready = false;
    renderJob({ failed: true, message: error.message }, []);
    setup.hidden = false;
    document.getElementById("planner").textContent = "Could not connect";
    document.getElementById("retry").hidden = false;
  } finally {
    if (id === refreshId) { checking = false; updateControls(); }
  }
}

// Poll memory in the background, not the database, while a reply is in flight.
async function pollJob() {
  try {
    const result = await send({ type: "job" });
    if (result.error) throw new Error(result.error);
    renderJob(result.job, result.transcript);
    if (busy) timer = setTimeout(pollJob, 900);
  } catch (error) {
    renderJob({ failed: true, message: error.message });
    document.getElementById("retry").hidden = false;
  }
}
document.getElementById("retry").addEventListener("click", refresh);

async function prepare() {
  const id = ++refreshId;
  try {
    const snapshot = await send({ type: "snapshot" });
    if (id !== refreshId) return;
    canCompose = Boolean(snapshot.canCompose);
    renderJob(snapshot.job, snapshot.transcript);
    if (canCompose) {
      document.getElementById("planner").textContent = "Start typing — connecting in the background…";
      field.focus();
    }
  } catch { /* Fall through to the normal account check and its error UI. */ }
  if (id === refreshId) await refresh();
}

document.getElementById("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = field.value.trim();
  if (!ready || busy || sending || checking || !text) return;
  sending = true;
  clearTimeout(timer);
  const pageContext = includePage.checked && activeTab ? activeTab : null;
  field.value = "";
  includePage.checked = false;
  renderJob({ busy: true, message: "" });
  try {
    const result = await send({ type: "send", text, pageContext });
    if (result.error) throw new Error(result.error);
    renderJob(result.job, result.transcript);
    timer = setTimeout(pollJob, 900);
  } catch (error) {
    field.value = text; // Give the message back so nothing typed is lost.
    renderJob({ failed: true, message: error.message });
  } finally { sending = false; updateControls(); }
});
field.addEventListener("input", updateControls);
field.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    document.getElementById("form").requestSubmit();
  }
});
newChatButton.addEventListener("click", async () => {
  if (busy) return;
  try {
    const result = await send({ type: "reset" });
    if (result.error) throw new Error(result.error);
    renderTranscript(result.transcript || []);
    status.textContent = "";
  } catch (error) {
    status.textContent = error.message;
    status.dataset.error = "true";
  }
});
setup.addEventListener("click", () => send({ type: "open", setup: authenticated }));
document.getElementById("website").addEventListener("click", () => send({ type: "open" }));
sitePicker.addEventListener("change", async () => {
  ++refreshId;
  clearTimeout(timer);
  site = sitePicker.value;
  ready = false;
  canCompose = false;
  authenticated = false;
  checking = true;
  field.value = "";
  includePage.checked = false;
  setup.hidden = true;
  document.getElementById("planner").textContent = "Connecting to Excela…";
  try { await chrome.storage.local.set({ site }); }
  catch { /* Selection still works for this popup if saving fails. */ }
  await prepare();
});
async function initialize() {
  try {
    const saved = await chrome.storage.local.get("site");
    if (["https://excela.cfat.site", "https://localhost:3000"].includes(saved.site)) site = saved.site;
  } catch { /* Default to the live site. */ }
  sitePicker.value = site;
  void captureActiveTab();
  await prepare();
}
void initialize();
