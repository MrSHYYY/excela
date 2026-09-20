"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import styles from "./dashboard.module.css";
import publicStyles from "./public.module.css";
import Landing from "./landing";
import { SIGN_IN_CHANNEL, startGoogleSignIn } from "./google-sign-in";
import type { Session } from "@/lib/session-payload";
import { choosePlanner } from "@/lib/google-picker";

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
  denied: "Google permission was not granted. Continue with Google again and allow access to files you create or select with Excela.",
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
  const [savingSheet, setSavingSheet] = useState(false);
  const [editingSheet, setEditingSheet] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sidebarOpen) return;
    function closeSidebar(event: KeyboardEvent) {
      if (event.key === "Escape") setSidebarOpen(false);
    }
    document.addEventListener("keydown", closeSidebar);
    return () => document.removeEventListener("keydown", closeSidebar);
  }, [sidebarOpen]);

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
    setSidebarOpen(false);
    setError("");
    setEditingSheet(false);
    resetResults();
  }

  async function handleChooseSheet() {
    if (savingSheet || generating) return;
    setSavingSheet(true);
    setNotice("");
    setError("");
    try {
      const pickerResult = await fetch("/api/google/picker", { method: "POST", cache: "no-store" });
      const config = await pickerResult.json();
      if (!pickerResult.ok) {
        handleAuthCode(config.code);
        throw new Error(config.error || "Unable to open Google Drive.");
      }
      const url = await choosePlanner(config);
      if (!url) return;
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
    <div className={styles.dashboard} data-sidebar-open={sidebarOpen}>
      <a href="#dashboard-content" className={styles.skip}>Skip to dashboard</a>
      <header className={styles.navbar}>
        <nav className={styles.navigation} aria-label="Main navigation">
          <Link href="/" className={publicStyles.brand} aria-label="Excela home">
            <Image src="/excela-r.png" alt="" width={34} height={34} priority />
            excela<span className={publicStyles.brandDot}>.</span>
          </Link>
          <button
            type="button"
            className={styles.menuToggle}
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-expanded={sidebarOpen}
            aria-controls="dashboard-sidebar"
            onClick={() => setSidebarOpen((open) => !open)}
          >
            <span /><span /><span />
          </button>
        </nav>
        <span className={styles.navTitle}>Your workspace</span>
            <div className={styles.account}>
              <div className={styles.identity}>
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
                <div className={styles.identityText}>
                  <p className="font-medium">{session.user.name}</p>
                  <p className="text-zinc-400 dark:text-zinc-400">{session.user.email}</p>
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
                    className={styles.sheetLink}
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
                    className="rounded-lg border border-zinc-700 p-2 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 dark:border-zinc-700 dark:hover:bg-zinc-800"
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
                      className="absolute right-0 top-full z-10 mt-2 w-72 rounded-xl border border-zinc-800 bg-zinc-900 p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      {confirmingDelete ? (
                        <div className="flex flex-col gap-3 p-2">
                          <p role="alert" className="text-sm font-medium text-red-400 dark:text-red-400">
                            Delete your account?
                          </p>
                          <p className="text-sm text-zinc-400 dark:text-zinc-400">
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
                              className="rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-800 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
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
                            className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium hover:bg-zinc-800 dark:hover:bg-zinc-800"
                          >
                            Sign out
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => setConfirmingDelete(true)}
                            className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-red-400 hover:bg-red-950 dark:text-red-400 dark:hover:bg-red-950"
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


      </header>

      <aside id="dashboard-sidebar" aria-label="Sidebar" aria-hidden={!sidebarOpen} inert={!sidebarOpen} className={styles.sidebar}>
        <nav aria-label="Planner settings" className={styles.sidebarNav}>
          <button type="button" className={styles.sidebarAction} disabled={loading || syncing || savingSheet || generating} onClick={() => { setEditingSheet(true); setSidebarOpen(false); setError(""); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 7h15m-4-4 4 4-4 4M20 17H5m4-4-4 4 4 4" /></svg>
            {session.sheet ? "Change planner" : "Connect planner"}
          </button>
        </nav>
      </aside>
      {sidebarOpen && <button type="button" className={styles.backdrop} aria-label="Close sidebar" onClick={() => setSidebarOpen(false)} />}

      <main id="dashboard-content" className={styles.main}>
        <div className={styles.content}>
          <header className={styles.pageHeader}>
            <div>
              <p className={styles.eyebrow}>YOUR DAY, A LITTLE CLEARER</p>
              <h1>Make room for <span>what matters.</span></h1>
              <p className={styles.subtitle}>From the class chat to your planner. Paste it, plan it, get on with your day.</p>
            </div>
            <span className={styles.status} data-connected={Boolean(session.sheet && session.googleAccess)}>
              <span />{!session.googleAccess ? "Reconnect Google" : session.sheet ? "Planner connected" : "Connect a planner"}
            </span>
          </header>

          {error && <p role="alert" className={styles.error}>{error}</p>}
          {notice && <p role="status" className={styles.notice}>{notice}</p>}
          {!session.googleAccess && (
            <p role="alert" className={styles.warning}>
              Reconnect Google to access your planner.{" "}
              <a href="/api/google/connect?consent=1" onClick={(event) => { event.preventDefault(); startGoogleSignIn(true); }}>
                Sign in with Google again ↗
              </a>
            </p>
          )}

          {(!session.sheet || editingSheet) && (
            <section className={styles.connectPanel} aria-labelledby="planner-heading">
              <div>
                <p className={styles.eyebrow}>YOUR GOOGLE SHEET</p>
                <h2 id="planner-heading">{session.sheet ? "Choose a different planner." : "A place for everything."}</h2>
                <p className={styles.description}>Choose your monthly planner from Google Drive, or start fresh with our template.</p>
                <p className={styles.hint}>Existing planners need month tabs like “Sept 2026”.</p>
              </div>
              <div className={styles.connectActions}>
                <button type="button" className={styles.primary} onClick={handleChooseSheet} disabled={savingSheet || generating || !session.googleAccess}>
                  {savingSheet ? "Choosing planner…" : "Choose from Google Drive ↗"}
                </button>
                <button type="button" className={styles.secondary} onClick={handleGenerateTemplate} disabled={generating || savingSheet || !session.googleAccess}>
                  {generating ? "Generating your planner…" : "Generate template +"}
                </button>
                {session.sheet && <button type="button" className={styles.textButton} disabled={savingSheet || generating} onClick={() => { setEditingSheet(false); setError(""); }}>Cancel</button>}
              </div>
            </section>
          )}

          {session.sheet && !editingSheet && <div className={styles.workspace}>
            <section className={styles.panel} aria-labelledby="announcement-heading">
              <div className={styles.panelHeading}><span className={styles.eyebrow}>01 / THE ANNOUNCEMENT</span><span className={styles.smallMark} aria-hidden="true">↗</span></div>
              <h2 id="announcement-heading">What’s coming up?</h2>
              <p className={styles.description}>Paste a class announcement. We’ll find the course, event, and date.</p>
              <form onSubmit={handleSubmit} className={styles.form}>
                <label htmlFor="message">Announcement</label>
                <textarea id="message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="CSE340 Quiz 4 is on Sept 27. Don't forget!" rows={7} required disabled={loading || syncing || !session.sheet} />
                <div className={styles.formFooter}>
                  <div className={styles.modelField}>
                    <label htmlFor="provider">AI provider</label>
                    <select id="provider" value={provider} disabled={loading || syncing} onChange={(event) => { setProvider(event.target.value); setError(""); resetResults(); }}>
                      <option value="ollama">Ollama · gemma4:31b</option>
                      <option value="gemini">Gemini · Flash</option>
                    </select>
                  </div>
                  <button type="submit" className={styles.primary} disabled={loading || syncing || savingSheet || generating || !session.googleAccess || !session.sheet}>
                    {loading ? "Reading…" : syncing ? "Writing…" : "Inject ↗"}
                  </button>
                </div>
                <p className={styles.hint}>{session.sheet ? "Events go straight to the matching dates in your planner." : "Connect or generate a planner to get started."}</p>
              </form>
            </section>

            <section className={styles.panel} aria-labelledby="result-heading" aria-live="polite" aria-busy={loading || syncing}>
              <div className={styles.panelHeading}><span className={styles.eyebrow}>02 / YOUR PLANNER ENTRY</span><span className={styles.smallMark} aria-hidden="true">↙</span></div>
              <h2 id="result-heading">{synced ? "One less thing to remember." : "The details, sorted."}</h2>
              <p className={styles.description}>{synced ? "Your announcement is in your planner." : "Extracted events and sync results appear here."}</p>
              {(loading || syncing) && <p role="status" className={styles.processing}>{syncing ? "Writing to your planner…" : "Reading your announcement…"}</p>}
              {syncMessage && <p role="status" className={styles.notice}>{syncMessage}</p>}
              {response ? (
                <pre className={styles.response}>{response}</pre>
              ) : (
                <div className={styles.emptyState}>
                  <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true"><rect x="4" y="5" width="16" height="16" rx="3" /><path d="M8 3v4m8-4v4M4 11h16m-11 5h6" /></svg>
                  <p>Your next plan starts here.</p>
                  <span>Paste an announcement to turn it into a planner entry.</span>
                </div>
              )}
              <div className={styles.resultActions}>
                {viewLinks.map((link) => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className={styles.secondary}>{viewLinks.length > 1 ? 'View changes in ' + link.sheet : "View changes"} ↗</a>)}
                {events.length > 0 && !synced && !loading && !syncing && <button type="button" className={styles.primary} onClick={handleSync} disabled={!session.googleAccess}>Retry sync ↗</button>}
              </div>
            </section>
          </div>}
          <footer className={styles.footer}><span>Your sheet. A little less to remember.</span><nav aria-label="Legal"><Link href="/privacy">Privacy policy</Link><Link href="/terms">Terms of service</Link></nav></footer>
        </div>
      </main>
    </div>
  );
}
