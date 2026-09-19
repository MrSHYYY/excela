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

type Session =
  | { authenticated: false }
  | {
      authenticated: true;
      user: { name: string; email: string; picture: string | null };
      sheet: { url: string; title: string } | null;
      googleAccess: boolean;
    };

const signInMessages: Record<string, string> = {
  denied: "Google permission was not granted. Continue with Google again and allow access to Google Sheets.",
  invalid_state: "Sign-in expired or was opened in a different browser. Please try again.",
  unverified: "That Google account's email is not verified. Use a verified Google account.",
  database: "Signed in with Google, but Excela could not reach its database. Check MONGODB_URI and Atlas network access.",
  failed: "Google sign-in failed. Check the OAuth credentials and the registered redirect URL.",
};

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
  const [viewLinks, setViewLinks] = useState<{ sheet: string; url: string }[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [sheetInput, setSheetInput] = useState("");
  const [savingSheet, setSavingSheet] = useState(false);
  const [editingSheet, setEditingSheet] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let active = true;
    const status = new URLSearchParams(window.location.search).get("google");
    if (status) {
      if (status !== "connected") setError(signInMessages[status] || "Please sign in with Google again.");
      window.history.replaceState(null, "", window.location.pathname);
    }
    async function loadSession() {
      try {
        const result = await fetch("/api/google/status", { cache: "no-store" });
        const data = await result.json();
        if (!active) return;
        if (!result.ok) {
          setError(data.error || "Could not load your session.");
          setSession({ authenticated: false });
          return;
        }
        setSession(data);
      } catch {
        if (!active) return;
        setError("Could not load your session. Check your connection and refresh.");
        setSession({ authenticated: false });
      }
    }
    void loadSession();
    return () => { active = false; };
  }, []);

  // Keeps the UI in step with what the server says about the session.
  function handleAuthCode(code?: string) {
    if (code === "auth") setSession({ authenticated: false });
    if (code === "reauth") setSession((current) => (current?.authenticated ? { ...current, googleAccess: false } : current));
    if (code === "no_sheet") setSession((current) => (current?.authenticated ? { ...current, sheet: null } : current));
  }

  function resetResults() {
    setViewLinks([]);
    setResponse("");
    setEvents([]);
    setSynced(false);
    setSyncMessage("");
  }

  async function handleSignOut() {
    try { await fetch("/api/auth/logout", { method: "POST" }); }
    catch { /* The server-side session expires on its own if this fails. */ }
    setSession({ authenticated: false });
    setMessage("");
    setNotice("");
    setConfirmingDelete(false);
    setError("");
    setEditingSheet(false);
    setSheetInput("");
    resetResults();
  }

  async function handleSaveSheet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = sheetInput.trim();
    if (!url || savingSheet || generating) return;
    setSavingSheet(true);
    setNotice("");
    setError("");
    try {
      const result = await fetch("/api/sheet", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await result.json();
      if (!result.ok) {
        handleAuthCode(data.code);
        throw new Error(data.error || "Unable to save your link.");
      }
      setViewLinks([]);
      setSession((current) => (current?.authenticated ? { ...current, sheet: data.sheet } : current));
      setEditingSheet(false);
      setSheetInput("");
      setSynced(false);
      setSyncMessage("");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save your link.");
    } finally {
      setSavingSheet(false);
    }
  }

  async function handleGenerateTemplate() {
    if (generating || savingSheet) return;
    setGenerating(true);
    setError("");
    setNotice("");
    try {
      const result = await fetch("/api/sheet/template", { method: "POST" });
      const data = await result.json();
      if (!result.ok) {
        handleAuthCode(data.code);
        throw new Error(data.error || "Unable to generate your template.");
      }
      setViewLinks([]);
      setSession((current) => (current?.authenticated ? { ...current, sheet: data.sheet } : current));
      setEditingSheet(false);
      setSheetInput("");
      setSynced(false);
      setSyncMessage("");
      setNotice("Your planner was created in your Google Drive and saved to your account. It will be used for future syncs.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to generate your template.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleDeleteAccount() {
    if (deleting) return;
    setDeleting(true);
    setError("");
    try {
      const result = await fetch("/api/account", { method: "DELETE" });
      const data = await result.json();
      if (!result.ok) {
        handleAuthCode(data.code);
        throw new Error(data.error || "Unable to delete your account.");
      }
      setSession({ authenticated: false });
      setMessage("");
      setEditingSheet(false);
      setSheetInput("");
      setConfirmingDelete(false);
      resetResults();
      setNotice("Your account and all data Excela stored about you were deleted.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to delete your account.");
    } finally {
      setDeleting(false);
    }
  }

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
      if (!result.ok) {
        handleAuthCode(data.code);
        throw new Error(data.error || "Unable to sync with Google Sheets.");
      }
      setSynced(true);
      setSyncMessage(`Synced: ${data.written} event(s) written, ${data.skipped} already present.`);
      setViewLinks(Array.isArray(data.links) ? data.links : []);
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
    resetResults();

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
        handleAuthCode(data.code);
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

        {error && (
          <p
            role="alert"
            className="text-red-600 dark:text-red-400"
          >
            {error}
          </p>
        )}

        {notice && (
          <p role="status" className="text-emerald-700 dark:text-emerald-400">
            {notice}
          </p>
        )}

        {session === null && (
          <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
            Loading…
          </p>
        )}

        {session && !session.authenticated && (
          <section className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="font-semibold">Sign in to continue</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Excela signs you in with Google and adds announcements to your own monthly planner in Google
              Sheets. Google will ask you to allow access to Google Sheets so it can do that.
            </p>
            <a
              href="/api/google/connect"
              className="inline-flex items-center gap-3 self-start rounded-lg border border-zinc-300 bg-white px-5 py-3 font-medium text-zinc-900 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              Continue with Google
            </a>
          </section>
        )}

        {session?.authenticated && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-3">
                {session.user.picture && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={session.user.picture}
                    alt=""
                    width={36}
                    height={36}
                    referrerPolicy="no-referrer"
                    className="h-9 w-9 rounded-full"
                  />
                )}
                <div className="text-sm">
                  <p className="font-medium">{session.user.name}</p>
                  <p className="text-zinc-600 dark:text-zinc-400">{session.user.email}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleSignOut}
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Sign out
              </button>
            </div>

            {!session.googleAccess && (
              <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
                Excela&apos;s access to your Google Sheets has expired.{" "}
                <a href="/api/google/connect?consent=1" className="font-medium underline">
                  Sign in with Google again
                </a>{" "}
                to keep syncing.
              </p>
            )}

            {(!session.sheet || editingSheet) && (
              <form
                onSubmit={handleSaveSheet}
                className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <label htmlFor="sheet" className="font-semibold">
                  {session.sheet ? "Change your planner link" : "Add your planner link"}
                </label>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  Paste the Google Sheets link of your monthly planner (tabs named like “Sept 2026”). Excela
                  saves it to your account, so you only do this once.
                </p>
                <input
                  id="sheet"
                  type="url"
                  required
                  value={sheetInput}
                  onChange={(event) => setSheetInput(event.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/…/edit"
                  disabled={savingSheet}
                  className="w-full rounded-xl border border-zinc-300 bg-white p-3 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950"
                />
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={savingSheet}
                    className="rounded-lg bg-blue-600 px-5 py-2.5 font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingSheet ? "Checking…" : "Save link"}
                  </button>
                  {session.sheet && (
                    <button
                      type="button"
                      disabled={savingSheet}
                      onClick={() => { setEditingSheet(false); setSheetInput(""); setError(""); }}
                      className="rounded-lg border border-zinc-300 px-5 py-2.5 font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                    >
                      Cancel
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    No planner yet? Excela can create one in your Google Drive from its template and use it for
                    future syncs.
                  </p>
                  <button
                    type="button"
                    onClick={handleGenerateTemplate}
                    disabled={generating || savingSheet}
                    className="self-start rounded-lg border border-zinc-300 px-5 py-2.5 font-medium hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    {generating ? "Generating… this can take a few seconds" : "Generate template"}
                  </button>
                </div>
              </form>
            )}

            {session.sheet && (
              <>
                {!editingSheet && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">
                    Planner:{" "}
                    <a
                      href={session.sheet.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-zinc-900 underline dark:text-zinc-100"
                    >
                      {session.sheet.title}
                    </a>
                    <button
                      type="button"
                      onClick={() => { setEditingSheet(true); setError(""); }}
                      className="ml-3 underline"
                    >
                      Change
                    </button>
                  </p>
                )}

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
                      setError("");
                      resetResults();
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
                      disabled={loading || syncing || synced || !session.googleAccess}
                      className="mt-5 rounded-lg bg-emerald-700 px-5 py-3 font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {syncing ? "Syncing…" : synced ? "Synced with planner" : "Sync with planner"}
                    </button>
                  )}
                  {syncMessage && <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{syncMessage}</p>}
                  {viewLinks.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-3">
                      {viewLinks.map((link) => (
                        <a
                          key={link.url}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg border border-emerald-700 px-5 py-3 font-medium text-emerald-800 hover:bg-emerald-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-950"
                        >
                          {viewLinks.length > 1 ? `View changes in ${link.sheet}` : "View changes"}
                        </a>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </div>
      {session?.authenticated && (
        <div className="mx-auto mt-12 w-full max-w-2xl border-t border-zinc-200 pt-6 dark:border-zinc-800">
          <h2 className="font-semibold">Delete account</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Permanently deletes your Excela account and everything Excela stores about you: your profile, your
            saved planner link, Google access and sign-in sessions. Your Google Sheets are not changed or deleted.
          </p>
          {confirmingDelete ? (
            <div className="mt-4 flex flex-col gap-3">
              <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">
                This cannot be undone. Delete your account?
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleDeleteAccount}
                  disabled={deleting}
                  className="rounded-lg bg-red-700 px-5 py-2.5 font-medium text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Yes, delete everything"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  className="rounded-lg border border-zinc-300 px-5 py-2.5 font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="mt-4 rounded-lg border border-red-700 px-5 py-2.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-950"
            >
              Delete account
            </button>
          )}
        </div>
      )}
    </main>
  );
}
