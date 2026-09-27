"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@/lib/session-payload";
import { choosePlanner } from "@/lib/google-picker";
import { SIGN_IN_CHANNEL, startGoogleSignIn } from "./google-sign-in";
import { useAuth } from "./auth-context";
import styles from "./dashboard.module.css";
import setup from "./setup.module.css";
import loadingStyles from "./loading.module.css";
import PendingLink from "./pending-link";
import PageSkeleton from "./page-skeleton";

type SignedInSession = Extract<Session, { authenticated: true }>;

export default function SetupClient({ initialSession }: { initialSession: SignedInSession }) {
  const router = useRouter();
  const { session: currentAuthSession, updateSession } = useAuth();
  const session = (currentAuthSession?.authenticated ? currentAuthSession : initialSession) as SignedInSession;

  const [busy, setBusy] = useState<"choose" | "generate" | "reset" | "key" | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [navigating] = useTransition();
  const complete = Boolean(session.sheet && session.hasApiKey);

  useEffect(() => {
    let active = true;
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(SIGN_IN_CHANNEL);
    if (channel) channel.onmessage = async (event: MessageEvent<{ status?: string }>) => {
      if (event.data?.status !== "connected") { setError("Google sign-in did not finish. Please try again."); return; }
      setReconnecting(true);
      try {
        const result = await fetch("/api/google/status", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
        const next: Session = await result.json();
        if (active && result.ok && next.authenticated) {
          updateSession(() => next as SignedInSession);
          setError("");
        } else if (active) {
          setError("Could not refresh your connection. Please retry signing in.");
        }
      } catch {
        if (active) setError("Could not refresh your Google connection. Reload this page.");
      } finally {
        if (active) setReconnecting(false);
      }
    };
    return () => { active = false; channel?.close(); };
  }, [updateSession]);

  async function request(url: string, init: RequestInit) {
    const result = await fetch(url, { ...init, cache: "no-store" });
    const data = await result.json();
    if (!result.ok) {
      if (data.code === "auth") { router.replace("/"); router.refresh(); }
      if (data.code === "reauth") updateSession((current) => ({ ...current, googleAccess: false }));
      throw new Error(data.error || "Could not save your settings.");
    }
    return data;
  }

  async function savePlanner(action: "choose" | "generate" | "reset") {
    if (busy) return;
    setBusy(action); setError(""); setNotice("");
    try {
      let data;
      if (action === "choose") {
        const config = await request("/api/google/picker", { method: "POST" });
        const url = await choosePlanner(config);
        if (!url) return;
        data = await request("/api/sheet", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
      } else {
        data = await request(action === "generate" ? "/api/sheet/template" : "/api/sheet/reset", { method: "POST" });
      }
      updateSession((current) => ({ ...current, sheet: data.sheet, hasGeneratedPlanner: current.hasGeneratedPlanner || action !== "choose" }));
      setNotice(action === "reset" && data.oldTrashed === false
        ? "Your fresh planner is connected. The old file could not be moved to Drive trash; you can remove it in Drive."
        : "Your planner is saved to your account.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not connect your planner."); }
    finally { setBusy(null); setConfirmReset(false); }
  }

  async function saveKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !apiKey.trim()) return;
    setBusy("key"); setError(""); setNotice("");
    try {
      await request("/api/setup/key", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) });
      updateSession((current) => ({ ...current, hasApiKey: true }));
      setApiKey("");
      setNotice("Your API key is saved securely. AI requests will use your Ollama account.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save your API key."); }
    finally { setBusy(null); }
  }

  if (navigating) return <PageSkeleton />;

  return (
    <div className={setup.container}>
      <div>
        <p className={styles.eyebrow}>CONFIGURATION</p>
        <h1>Set up your workspace.</h1>
        <p className={setup.intro}>Your planner. Your AI account. Connect both to get started.</p>
      </div>

      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {reconnecting && <p role="status" className={styles.notice}><span className={loadingStyles.spinner} aria-hidden="true" /> Updating your Google connection…</p>}
      {!session.googleAccess && (
        <p className={styles.warning}>
          Reconnect Google to choose or generate a planner.{" "}
          <button type="button" onClick={() => startGoogleSignIn(true)} className={styles.textButton}>
            Reconnect Google ↗
          </button>
        </p>
      )}

      <div className={setup.progress} aria-label="Setup progress">
        <span data-done={Boolean(session.sheet)}>
          {session.sheet ? "✓" : "1"} Planner
        </span>
        <span data-done={session.hasApiKey}>
          {session.hasApiKey ? "✓" : "2"} Ollama API key
        </span>
      </div>

      <div className={setup.grid}>
        <section className={setup.card} aria-labelledby="planner-heading">
          <p className={styles.eyebrow}>01 / PLANNER</p>
          <h2 id="planner-heading">A place for your plans.</h2>
          <p className={styles.description}>
            Generate a planner from our template or choose your existing monthly planner from Google Drive.
          </p>
          {session.sheet && (
            <p className={setup.connected}>
              Connected: <a href={session.sheet.url} target="_blank" rel="noopener noreferrer">{session.sheet.title} ↗</a>
            </p>
          )}
          <div className={setup.actions}>
            <button
              type="button"
              className={styles.primary}
              disabled={Boolean(busy) || !session.googleAccess || session.hasGeneratedPlanner}
              onClick={() => savePlanner("generate")}
            >
              {busy === "generate" ? "Generating…" : session.hasGeneratedPlanner ? "Template already generated" : "Generate template +"}
            </button>
            <button
              type="button"
              className={styles.secondary}
              disabled={Boolean(busy) || !session.googleAccess}
              onClick={() => savePlanner("choose")}
            >
              {busy === "choose" ? "Choosing…" : "Use existing planner ↗"}
            </button>
          </div>
          <p className={styles.hint}>
            Existing planners need month tabs like “Sept 2026”. {session.hasGeneratedPlanner && "You can select your previously generated Excela planner from Drive."}
          </p>
          {session.sheet && session.sheet.generated && (
            <div className={setup.reset}>
              {confirmReset ? (
                <>
                  <p role="alert" className="text-sm font-medium text-red-400">
                    Reset this planner?
                  </p>
                  <p className={styles.hint}>
                    Excela will generate a fresh template and move your current planner to Google Drive trash.
                  </p>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => savePlanner("reset")}
                      style={{
                        padding: "8px 14px",
                        background: "#dc2626",
                        color: "#fff",
                        border: "none",
                        borderRadius: "6px",
                        fontSize: "13px",
                        cursor: "pointer",
                      }}
                    >
                      {busy === "reset" ? "Resetting…" : "Yes, reset planner"}
                    </button>
                    <button
                      type="button"
                      className={styles.secondary}
                      onClick={() => setConfirmReset(false)}
                      disabled={Boolean(busy)}
                    >
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmReset(true)}
                  className={styles.textButton}
                  style={{ color: "#ef4444" }}
                >
                  Reset planner template
                </button>
              )}
            </div>
          )}
        </section>

        <section className={setup.card} aria-labelledby="key-heading">
          <p className={styles.eyebrow}>02 / INTELLIGENCE</p>
          <h2 id="key-heading">Bring your own model.</h2>
          <p className={styles.description}>
            Excela uses Ollama to extract events and structure your schedule. Save your Ollama API key to use it.
          </p>
          {session.hasApiKey && (
            <p className={setup.connected}>
              ✓ API key saved to your account.
            </p>
          )}
          <form onSubmit={saveKey} className={setup.keyForm}>
            <label htmlFor="apiKey">Ollama API key</label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={session.hasApiKey ? "Paste a new key to replace it" : "Paste your Ollama key"}
              autoComplete="off"
              disabled={Boolean(busy)}
            />
            <button
              type="submit"
              className={styles.primary}
              disabled={Boolean(busy) || !apiKey.trim()}
            >
              {busy === "key" ? "Saving…" : session.hasApiKey ? "Update key" : "Save key"}
            </button>
          </form>
          <p className={styles.hint}>
            Your key is encrypted with AES-GCM before saving and decrypted only in memory when Excela runs a prompt.
          </p>
        </section>
      </div>

      <div className={setup.finish}>
        <p>
          {complete
            ? "Your workspace is ready. You can head back to the dashboard to start planning."
            : "Finish both steps above to begin using Excela."}
        </p>
        <PendingLink href="/" className={styles.primary}>
          {complete ? "Go to dashboard ↗" : "Return to dashboard"}
        </PendingLink>
      </div>
    </div>
  );
}
