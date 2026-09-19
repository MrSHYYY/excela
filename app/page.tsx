"use client";

import { useEffect, useState, type FormEvent } from "react";

const RELEVANT_KEYWORDS = [
  // Academic events
  "quiz",
  "quizzes",
  "test",
  "tests",
  "exam",
  "exams",
  "midterm",
  "midterms",
  "final",
  "finals",
  "assessment",
  "assessments",

  // Coursework
  "assignment",
  "assignments",
  "homework",
  "project",
  "projects",
  "lab",
  "labs",
  "laboratory",
  "practical",
  "practicals",
  "presentation",
  "presentations",
  "viva",

  // Academic schedule
  "class",
  "classes",
  "lecture",
  "lectures",
  "tutorial",
  "tutorials",
  "deadline",
  "deadlines",
  "submission",
  "submissions",
  "due",

  // Schedule changes
  "rescheduled",
  "reschedule",
  "postponed",
  "postpone",
  "cancelled",
  "canceled",
  "cancel",
  "moved",
  "extended",
  "extension",
];

function passesInputFilter(message: string): boolean {
  const normalized = message.toLowerCase();

  return RELEVANT_KEYWORDS.some((keyword) => {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Match whole words so things like "contest" don't accidentally
    // match "test".
    const regex = new RegExp(`\\b${escapedKeyword}(?=\\b|\\d)`, "i");

    return regex.test(normalized);
  });
}

export default function Home() {
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState("gemini");
  const [events, setEvents] = useState<{ course: string; title: string; date: string }[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [googleConnected, setGoogleConnected] = useState(false);

  useEffect(() => {
    let active = true;
    async function checkConnection() {
      try {
        const result = await fetch("/api/google/status", { cache: "no-store" });
        const data = await result.json();
        if (active) setGoogleConnected(data.connected === true);
      } catch { if (active) setGoogleConnected(false); }
    }
    const status = new URLSearchParams(window.location.search).get("google");
    if (status && status !== "connected") {
      const messages: Record<string, string> = {
        denied: "Google Sheets permission was not granted. Connect again and allow Sheets access.",
        invalid_state: "Google sign-in expired or was opened in a different browser. Please connect again.",
        failed: "Google sign-in failed. Check the OAuth credentials and registered redirect URL.",
      };
      setError(messages[status] || "Please connect Google again.");
    }
    void checkConnection();
    window.addEventListener("focus", checkConnection);
    return () => { active = false; window.removeEventListener("focus", checkConnection); };
  }, []);

  async function handleSync() {
    if (!events.length || syncing || synced || loading) return;
    setSyncing(true);
    setSyncMessage("");
    setError("");
    try {
      const result = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events }),
      });
      const data = await result.json();
      if (result.status === 401) setGoogleConnected(false);
      if (!result.ok) throw new Error(data.error || "Unable to sync with Google Sheets.");
      setSynced(true);
      setSyncMessage(`Synced: ${data.written} event(s) written, ${data.skipped} already present.`);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to sync with Google Sheets.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedMessage = message.trim();

    if (!trimmedMessage || loading || syncing) return;

    setError("");
    setResponse("");
    setEvents([]);
    setSynced(false);
    setSyncMessage("");

    // --------------------------------------------------
    // LOCAL PRE-FILTER
    // --------------------------------------------------
    // This happens BEFORE any request is sent to Gemini
    // or Ollama, so irrelevant messages cost zero AI tokens.
    // --------------------------------------------------
    if (!passesInputFilter(trimmedMessage)) {
      setResponse(
        "Rejected by input filter — this message does not appear to contain an academic event."
      );
      return;
    }

    setLoading(true);

    try {
      const result = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmedMessage,
          provider,
        }),
      });

      const data = await result.json();

      if (!result.ok) {
        throw new Error(data.error || "Unable to send your message.");
      }

      if (
        !data.response ||
        (typeof data.response !== "string" &&
          typeof data.response !== "object")
      ) {
        throw new Error("No response received. Please try again.");
      }

      setEvents(Array.isArray(data.response?.events) ? data.response.events : []);
      setResponse(
        typeof data.response === "string"
          ? data.response
          : JSON.stringify(data.response, null, 2)
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-16 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">
            Excela
          </h1>

          <p className="mt-2 text-zinc-600 dark:text-zinc-400">
            Turn a class announcement into JSON for Google Sheets.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/api/google/connect"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {googleConnected ? "Reconnect Google" : "Connect Google"}
          </a>
          <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
            {googleConnected ? "Google connected. Ready to sync." : "Connect your Google account to sync with the planner."}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-4"
        >
          <label htmlFor="provider" className="font-medium">
            AI model
          </label>

          <select
            id="provider"
            value={provider}
            disabled={loading || syncing}
            onChange={(event) => {
              setProvider(event.target.value);
              setResponse("");
              setError("");
              setEvents([]);
              setSynced(false);
              setSyncMessage("");
            }}
            className="w-full rounded-xl border border-zinc-300 bg-white p-3 focus:ring-2 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="gemini">
              Gemini — Flash
            </option>

            <option value="ollama">
              Ollama — gemma4:31b
            </option>
          </select>

          <label htmlFor="message" className="font-medium">
            Your message
          </label>

          <textarea
            id="message"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Example: CSE340 QUIZ4 SEPT 27"
            rows={5}
            required
            disabled={loading || syncing}
            className="w-full resize-y rounded-xl border border-zinc-300 bg-white p-4 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          />

          <button
            type="submit"
            disabled={loading || syncing}
            className="self-start rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Sending…" : "Send"}
          </button>
        </form>

        {error && (
          <p
            role="alert"
            className="text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}

        <section
          aria-live="polite"
          aria-busy={loading}
          className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h2 className="font-semibold">
            {provider === "ollama"
              ? "Ollama"
              : "Gemini"}{" "}
            response
          </h2>

          <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-sm text-zinc-600 dark:text-zinc-300">
            {loading
              ? "Processing your announcement…"
              : response || "Your reply will appear here."}
          </pre>
          {events.length > 0 && (
            <button
              type="button"
              onClick={handleSync}
              disabled={loading || syncing || synced || !googleConnected}
              className="mt-5 rounded-lg bg-emerald-700 px-5 py-3 font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {syncing ? "Syncing…" : synced ? "Synced with DOC" : "Sync with DOC"}
            </button>
          )}
          {syncMessage && <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{syncMessage}</p>}
        </section>
      </div>
    </main>
  );
}
