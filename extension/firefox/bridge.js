// This isolated script is installed only in the extension's dedicated Excela tab.
// No window-message bridge, cookie access, API-key storage, or Google Sheets DOM access.
if (["https://excela.cfat.site", "https://localhost:3000"].includes(location.origin) && !globalThis.excelaBridgeInstalled) {
  globalThis.excelaBridgeInstalled = true;
  let job = { busy: false, message: "", failed: false };

  async function request(path, body) {
    const response = await fetch(new URL(path, location.origin), {
      method: body ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : {},
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(90000),
    });
    if (response.status === 413) throw new Error("The attachment is too large. Try a smaller image.");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Excela could not complete the request.");
    return data;
  }

  async function inject(message) {
    try {
      const session = await request("/api/google/status");
      if (!session.authenticated) throw new Error("Sign in to Excela first.");
      if (!session.sheet || !session.hasApiKey || !session.googleAccess) throw new Error("Complete setup on Excela first.");
      const today = new Date();
      const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      const data = await request("/api/ai", { message: message.text, pipeline: message.pipeline, today: date, ...(message.image ? { image: message.image } : {}) });
      const events = data.response?.events;
      if (!Array.isArray(events) || !events.length) {
        job = { busy: false, failed: false, message: "Declined — no dated events found. Nothing was written." };
        return;
      }
      job.message = "Writing to your planner…";
      const result = await request("/api/sync", { events });
      job = { busy: false, failed: false, message: `Injected: ${result.written} event(s) written, ${result.skipped} already present.` };
    } catch (error) {
      job = { busy: false, failed: true, message: `${error.message || "Injection failed."} If writing had started, check your sheet before retrying.` };
    }
  }

  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id || message.site !== location.origin) return;
    if (message.type === "status") {
      return request("/api/google/status").then((session) => ({ session, job })).catch((error) => ({ error: error.message, job }));
    }
    if (message.type === "inject") {
      if (job.busy) return Promise.resolve({ job });
      if (message.image && (!["image/png", "image/jpeg", "image/webp"].includes(message.image.mimeType) || typeof message.image.data !== "string" || !message.image.data.length || message.image.data.length > 4 * 1024 * 1024)) {
        return Promise.resolve({ error: "Attach one PNG, JPEG or WebP image up to 3 MB." });
      }
      if (typeof message.text !== "string" || (!message.text.trim() && !message.image) || message.text.length > 20000 || !["general", "academic"].includes(message.pipeline)) {
        return Promise.resolve({ error: "Enter a message of up to 20,000 characters or attach an image." });
      }
      job = { busy: true, failed: false, message: "Reading your announcement…" };
      // The job lives in the tab, so closing the popup does not cancel a write.
      void inject(message);
      return Promise.resolve({ job });
    }
  });
}
