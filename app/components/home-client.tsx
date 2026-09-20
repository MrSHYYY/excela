"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Landing from "./landing";
import { SIGN_IN_CHANNEL, startGoogleSignIn } from "./google-sign-in";
import type { Session } from "@/lib/session-payload";

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

const signInMessages: Record<string, string> = {
  denied: "Google permission was not granted. Continue with Google again and allow access to Google Sheets.",
  invalid_state: "Sign-in expired or was opened in a different browser. Please try again.",
  unverified: "That Google account's email is not verified. Use a verified Google account.",
  database: "Signed in with Google, but Excela could not reach its database. Check MONGODB_URI and Atlas network access.",
  failed: "Google sign-in failed. Check the OAuth credentials and the registered redirect URL.",
};

// `initialSession` comes from the server, so the right screen shows on the first paint.
// It is null only when the database could not be reached; then the browser asks again.
export default function HomeClient({ initialSession }: { initialSession: Session | null }) {
  const [message, setMessage] = useState("");
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState("ollama");
  const [events, setEvents] = useState<{ course: string; title: string; date: string }[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const [syncMessage, setSyncMessage] = useState("");
  const [viewLinks, setViewLinks] = useState<{ sheet: string; url: string }[]>([]);
  const [session, setSession] = useState<Session | null>(initialSession);
  const [sheetInput, setSheetInput] = useState("");
  const [savingSheet, setSavingSheet] = useState(false);
  const [editingSheet, setEditingSheet] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const status = new URLSearchParams(window.location.search).get("google");
    if (status) {
      if (status !== "connected") setError(signInMessages[status] || "Please sign in with Google again.");
      window.history.replaceState(null, "", window.location.pathname);
    }
    async function loadSession() {
      // When the server already told us who is signed in, this is a quiet background refresh
      // (it renews the session and picks up changes); a failure must not kick anyone out.
      const quiet = initialSession !== null;
      try {
        const result = await fetch("/api/google/status", { cache: "no-store" });
        const data = await result.json();
        if (!active) return;
        if (!result.ok) {
          if (quiet) return;
          setError(data.error || "Could not load your session.");
          setSession({ authenticated: false });
          return;
        }
        setSession(data);
      } catch {
        if (!active || quiet) return;
        setError("Could not load your session. Check your connection and refresh.");
        setSession({ authenticated: false });
      }
    }
    // The server already said nobody is signed in: nothing to fetch.
    if (!initialSession?.authenticated && initialSession !== null) return;
    void loadSession();
    return () => { active = false; };
  }, [initialSession]);

  // The sign-in popup reports the result here once Google sends the user back to Excela.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(SIGN_IN_CHANNEL);
    channel.onmessage = async (event: MessageEvent<{ status?: string }>) => {
      const status = event.data?.status;
      if (!status) return;
      if (status !== "connected") {
        setError(signInMessages[status] || "Please sign in with Google again.");
        return;
      }
      setError("");
      setNotice("");
      try {
        const result = await fetch("/api/google/status", { cache: "no-store" });
        const data = await result.json();
        if (result.ok) setSession(data);
        else setError(data.error || "Could not load your session.");
      } catch {
        setError("Could not load your session. Check your connection and refresh.");
      }
    };
    return () => channel.close();
  }, []);

  // Closes the settings menu on outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function closeMenu() {
      setMenuOpen(false);
      setConfirmingDelete(false);
    }
    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) closeMenu();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

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
    setMenuOpen(false);
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
      setMenuOpen(false);
      resetResults();
      setNotice("Your account and all data Excela stored about you were deleted.");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to delete your account.");
    } finally {
      setDeleting(false);
    }
  }

  // Writes events to the user's planner. Runs right after extraction (Inject) and for "Retry sync".
  async function runSync(list: { course: string; title: string; date: string }[]) {
    setSyncing(true);
    setSyncMessage("");
    setViewLinks([]);
    setError("");
    try {
      const result = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: list }),
      });
      const data = await result.json();
      if (!result.ok) {
        handleAuthCode(data.code);
        throw new Error(data.error || "Unable to sync with Google Sheets.");
      }
      setSynced(true);
      setSyncMessage(`Injected: ${data.written} event(s) written, ${data.skipped} already present.`);
      setViewLinks(Array.isArray(data.links) ? data.links : []);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to sync with Google Sheets.");
    } finally {
      setSyncing(false);
    }
  }

  // Retries only the planner step, so the AI isn't called (and charged) again after a failed sync.
  async function handleSync() {
    if (!events.length || syncing || synced || loading) return;
    await runSync(events);
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

      const extracted = Array.isArray(data.response?.events) ? data.response.events : [];
      setEvents(extracted);
      setResponse(
        typeof data.response === "string"
          ? data.response
          : JSON.stringify(data.response, null, 2)
      );
      // Inject = extract with AI, then write straight to the planner.
      if (extracted.length) await runSync(extracted);
      else setSyncMessage("No events were found in that message, so nothing was injected.");
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

  if (!session?.authenticated) {
    return <Landing pending={session === null} error={error} notice={notice} />;
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
              <div className="flex flex-wrap items-center gap-3">
                {session.sheet && (
                  <a
                    href="/api/sheet/open"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => {
                      // Pass the browser's local month so it matches the user's time zone.
                      event.preventDefault();
                      const now = new Date();
                      window.open(
                        `/api/sheet/open?y=${now.getFullYear()}&m=${now.getMonth() + 1}`,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    }}
                    className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
                  >
                    View your sheet
                  </a>
                )}
                <div ref={menuRef} className="relative">
                  <button
                    type="button"
                    aria-label="Settings"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    onClick={() => {
                      setMenuOpen((open) => !open);
                      setConfirmingDelete(false);
                    }}
                    className="rounded-lg border border-zinc-300 p-2 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    <svg
                      aria-hidden="true"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.5}
                      stroke="currentColor"
                      className="h-5 w-5"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.826a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"
                      />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                    </svg>
                  </button>
                  {menuOpen && (
                    <div
                      role="menu"
                      aria-label="Account settings"
                      className="absolute right-0 top-full z-10 mt-2 w-72 rounded-xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      {confirmingDelete ? (
                        <div className="flex flex-col gap-3 p-2">
                          <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">
                            Delete your account?
                          </p>
                          <p className="text-sm text-zinc-600 dark:text-zinc-400">
                            This permanently deletes your Excela account and everything Excela stores about you: your
                            profile, saved planner link, Google access and sign-in sessions. Your Google Sheets are not
                            changed or deleted. This cannot be undone.
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={handleDeleteAccount}
                              disabled={deleting}
                              className="rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {deleting ? "Deleting…" : "Yes, delete everything"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingDelete(false)}
                              disabled={deleting}
                              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={handleSignOut}
                            className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            Sign out
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => setConfirmingDelete(true)}
                            className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                          >
                            Delete account
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {!session.googleAccess && (
              <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
                Excela&apos;s access to your Google Sheets has expired.{" "}
                <a
                  href="/api/google/connect?consent=1"
                  onClick={(event) => {
                    event.preventDefault();
                    startGoogleSignIn(true);
                  }}
                  className="font-medium underline"
                >
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
                    <option value="ollama">
                      Ollama — gemma4:31b
                    </option>

                    <option value="gemini">
                      Gemini — Flash
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
                    disabled={loading || syncing || !session.googleAccess}
                    className="self-start rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {loading || syncing ? "Injecting…" : "Inject"}
                  </button>
                </form>

                <section
                  aria-live="polite"
                  aria-busy={loading || syncing}
                  className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900"
                >
                  {(loading || syncing || syncMessage || viewLinks.length > 0 || (events.length > 0 && !synced)) && (
                    <div className="mb-5 flex flex-col items-start gap-3">
                      {(loading || syncing) && (
                        <p role="status" className="text-sm text-zinc-600 dark:text-zinc-400">
                          {syncing ? "Writing to your planner…" : "Reading your announcement…"}
                        </p>
                      )}
                      {syncMessage && (
                        <p
                          role="status"
                          className={`text-sm ${synced ? "text-emerald-700 dark:text-emerald-400" : "text-zinc-600 dark:text-zinc-400"}`}
                        >
                          {syncMessage}
                        </p>
                      )}
                      {viewLinks.length > 0 && (
                        <div className="flex flex-wrap gap-3">
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
                      {events.length > 0 && !synced && !loading && !syncing && (
                        <button
                          type="button"
                          onClick={handleSync}
                          disabled={!session.googleAccess}
                          className="rounded-lg bg-emerald-700 px-5 py-3 font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Retry sync
                        </button>
                      )}
                    </div>
                  )}
                  <h2 className="font-semibold">
                    {provider === "ollama"
                      ? "Ollama"
                      : "Gemini"}{" "}
                    response
                  </h2>

                  <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-sm text-zinc-600 dark:text-zinc-300">
                    {loading && !response
                      ? "Processing your announcement…"
                      : response || "Your reply will appear here."}
                  </pre>
                </section>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
