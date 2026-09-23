const field = document.getElementById("message");
const button = document.getElementById("inject");
const setup = document.getElementById("setup");
const status = document.getElementById("status");
const pipeline = document.getElementById("pipeline");
const sitePicker = document.getElementById("site");
let site = "https://excela.cfat.site";
let checking = true;
let refreshId = 0;
const send = (message) => browser.runtime.sendMessage({ ...message, site });
let ready = false;
let canCompose = false;
let busy = false;
let authenticated = false;
let timer;
let sending = false;
let image = null;
let readingImage = false;
const removeImage = document.getElementById("remove-image");

function updateControls() {
  sitePicker.disabled = busy || readingImage || sending;
  document.getElementById("loading").hidden = !checking || canCompose;
  document.getElementById("form").hidden = !canCompose;
  document.getElementById("keyboard-hint").hidden = !canCompose;
  button.textContent = busy ? "Injecting…" : checking ? "Connecting…" : "Inject ↗";
  button.disabled = !ready || busy || readingImage || checking;
  field.disabled = !canCompose || busy;
  field.required = !image;
  pipeline.disabled = busy;
  removeImage.disabled = busy || readingImage;
}

async function attachImage(file) {
  if (!canCompose || busy || readingImage) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || !file.size || file.size > 3 * 1024 * 1024) {
    status.textContent = "Paste one PNG, JPEG or WebP image up to 3 MB.";
    status.dataset.error = "true";
    return;
  }
  readingImage = true;
  status.textContent = "Reading image…";
  status.dataset.error = "false";
  updateControls();
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read the image. Try another file."));
      reader.readAsDataURL(file);
    });
    image = { mimeType: file.type, data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
    document.getElementById("preview").src = dataUrl;
    document.getElementById("filename").textContent = file.name || "Pasted screenshot";
    document.getElementById("attachment").hidden = false;
    field.placeholder = "Add context (optional)…";
    status.textContent = ready && !checking ? "Image attached. Ready to inject." : "Image attached. Checking your connection…";
    status.dataset.error = "false";
  } catch (error) {
    status.textContent = error.message;
    status.dataset.error = "true";
  } finally {
    readingImage = false;
    updateControls();
  }
}

removeImage.addEventListener("click", () => {
  image = null;
  document.getElementById("preview").removeAttribute("src");
  document.getElementById("attachment").hidden = true;
  field.placeholder = "Quiz 4 on Sept 27…";
  status.textContent = "";
  updateControls();
});
document.getElementById("form").addEventListener("paste", (event) => {
  const images = Array.from(event.clipboardData.items).filter((item) => item.kind === "file" && item.type.startsWith("image/"));
  if (!images.length) return;
  event.preventDefault();
  if (images.length !== 1) {
    status.textContent = "Attach one image at a time.";
    status.dataset.error = "true";
    return;
  }
  const file = images[0].getAsFile();
  if (file) void attachImage(file);
});

function renderJob(job) {
  busy = Boolean(job?.busy);
  button.textContent = busy ? "Injecting…" : "Inject ↗";
  updateControls();
  status.textContent = job?.message || "";
  status.dataset.error = String(Boolean(job?.failed));
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
    renderJob(authenticated ? result.job : null);
    if (busy) timer = setTimeout(pollJob, 1000);
  } catch (error) {
    if (id !== refreshId) return;
    ready = false;
    renderJob({ failed: true, message: error.message });
    setup.hidden = false;
    document.getElementById("planner").textContent = "Could not connect";
    document.getElementById("retry").hidden = false;
  } finally {
    if (id === refreshId) { checking = false; updateControls(); }
  }
}

// Poll memory in the background, not the database, while a job is running.
async function pollJob() {
  try {
    const result = await send({ type: "job" });
    if (result.error) throw new Error(result.error);
    renderJob(result.job);
    if (busy) timer = setTimeout(pollJob, 1000);
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
    renderJob(snapshot.job);
    if (canCompose) {
      document.getElementById("planner").textContent = "Start typing — connecting in the background…";
      field.focus();
    }
  } catch { /* Fall through to the normal account check and its error UI. */ }
  if (id === refreshId) await refresh();
}

document.getElementById("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ready || busy || sending || readingImage || checking || (!field.value.trim() && !image)) return;
  sending = true;
  clearTimeout(timer);
  renderJob({ busy: true, message: "Starting…" });
  try {
    const result = await send({ type: "inject", text: field.value.trim(), pipeline: pipeline.value, ...(image ? { image } : {}) });
    if (result.error) throw new Error(result.error);
    renderJob(result.job);
    timer = setTimeout(pollJob, 1000);
  } catch (error) { renderJob({ failed: true, message: error.message }); }
  finally { sending = false; updateControls(); }
});
field.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    document.getElementById("form").requestSubmit();
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
  removeImage.click();
  setup.hidden = true;
  document.getElementById("planner").textContent = "Connecting to Excela…";
  try { await browser.storage.local.set({ site }); }
  catch { /* Selection still works for this popup if saving fails. */ }
  await prepare();
});
async function initialize() {
  try {
    const saved = await browser.storage.local.get("site");
    if (["https://excela.cfat.site", "https://localhost:3000"].includes(saved.site)) site = saved.site;
  } catch { /* Default to the live site. */ }
  sitePicker.value = site;
  await prepare();
}
void initialize();
