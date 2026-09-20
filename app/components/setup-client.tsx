"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Session } from "@/lib/session-payload";
import { choosePlanner } from "@/lib/google-picker";
import { SIGN_IN_CHANNEL, startGoogleSignIn } from "./google-sign-in";
import styles from "./dashboard.module.css";
import brand from "./public.module.css";
import setup from "./setup.module.css";
import loadingStyles from "./loading.module.css";
import PendingLink from "./pending-link";
import PageSkeleton from "./page-skeleton";

type SignedInSession = Extract<Session, { authenticated: true }>;

export default function SetupClient({ initialSession }: { initialSession: SignedInSession }) {
  const router = useRouter();
  const [session, setSession] = useState(initialSession);
  const [busy, setBusy] = useState<"choose" | "generate" | "reset" | "key" | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [navigating, startNavigation] = useTransition();
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
        if (active && result.ok && next.authenticated) { setSession(next); setError(""); }
        else if (active) setError("Could not refresh your connection. Please retry signing in.");
      } catch { if (active) setError("Could not refresh your Google connection. Reload this page."); }
      finally { if (active) setReconnecting(false); }
    };
    return () => { active = false; channel?.close(); };
  }, []);

  async function request(url: string, init: RequestInit) {
    const result = await fetch(url, { ...init, cache: "no-store" });
    const data = await result.json();
    if (!result.ok) {
      if (data.code === "auth") { router.replace("/"); router.refresh(); }
      if (data.code === "reauth") setSession((current) => ({ ...current, googleAccess: false }));
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
      setSession((current) => ({ ...current, sheet: data.sheet, hasGeneratedPlanner: current.hasGeneratedPlanner || action !== "choose" }));
      setNotice(action === "reset" && data.oldTrashed === false
        ? "Your fresh planner is connected. The old file could not be moved to Drive trash; you can remove it in Drive."
        : "Your planner is saved to your account.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not connect your planner."); }
    finally { setBusy(null); setConfirmReset(false); }
  }

  async function saveKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !apiKey.trim()) return;
    setBusy("key"); setError(""); setNotice("");
    try {
      await request("/api/setup/key", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey }) });
      setSession((current) => ({ ...current, hasApiKey: true }));
      setApiKey("");
      setNotice("Your API key is saved securely. AI requests will use your Ollama account.");
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save your API key."); }
    finally { setBusy(null); }
  }

  if (navigating) return <PageSkeleton />;

  return <div className={setup.shell}>
    <header className={setup.header}>
      <Link href="/" className={brand.brand} aria-label="Excela home"><Image src="/excela-r.png" alt="" width={34} height={34} priority />excela<span className={brand.brandDot}>.</span></Link>
      <PendingLink href="/" className={styles.textButton}>← Dashboard</PendingLink>
    </header>
    <main className={setup.main}>
      <p className={styles.eyebrow}>MAKE IT YOURS</p><h1>Set up your workspace.</h1>
      <p className={setup.intro}>Your planner. Your AI account. Connect both to get started.</p>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {reconnecting && <p role="status" className={styles.notice}><span className={loadingStyles.spinner} aria-hidden="true" /> Updating your Google connection…</p>}
      {!session.googleAccess && <p className={styles.warning}>Reconnect Google to choose or generate a planner. <button type="button" onClick={() => startGoogleSignIn(true)} className={styles.textButton}>Reconnect Google ↗</button></p>}
      <div className={setup.progress} aria-label="Setup progress"><span data-done={Boolean(session.sheet)}>{session.sheet ? "✓" : "1"} Planner</span><span data-done={session.hasApiKey}>{session.hasApiKey ? "✓" : "2"} Ollama API key</span></div>
      <div className={setup.grid}>
        <section className={setup.card} aria-labelledby="planner-heading">
          <p className={styles.eyebrow}>01 / PLANNER</p><h2 id="planner-heading">A place for your plans.</h2>
          <p className={styles.description}>Generate a planner from our template or choose your existing monthly planner from Google Drive.</p>
          {session.sheet && <p className={setup.connected}>Connected: <a href={session.sheet.url} target="_blank" rel="noopener noreferrer">{session.sheet.title} ↗</a></p>}
          <div className={setup.actions}>
            <button type="button" className={styles.primary} disabled={Boolean(busy) || !session.googleAccess || session.hasGeneratedPlanner} onClick={() => savePlanner("generate")}>{busy === "generate" ? "Generating…" : session.hasGeneratedPlanner ? "Template already generated" : "Generate template +"}</button>
            <button type="button" className={styles.secondary} disabled={Boolean(busy) || !session.googleAccess} onClick={() => savePlanner("choose")}>{busy === "choose" ? "Choosing…" : "Use existing planner ↗"}</button>
          </div>
          <p className={styles.hint}>Existing planners need month tabs like “Sept 2026”. {session.hasGeneratedPlanner && "You can select your previously generated Excela planner from Drive."}</p>
          {session.sheet?.generated && <div className={setup.reset}>
            {confirmReset ? <><p className={styles.description}>Reset replaces your planner with a fresh template and moves the old file to Drive trash. Existing entries will not be copied.</p><button type="button" className={styles.secondary} disabled={Boolean(busy) || !session.googleAccess} onClick={() => savePlanner("reset")}>{busy === "reset" ? "Resetting…" : "Yes, reset planner"}</button><button type="button" className={styles.textButton} disabled={Boolean(busy)} onClick={() => setConfirmReset(false)}>Keep my planner</button></>
              : <button type="button" className={styles.textButton} disabled={Boolean(busy)} onClick={() => setConfirmReset(true)}>Reset template</button>}
          </div>}
        </section>
        <section className={setup.card} aria-labelledby="api-heading">
          <p className={styles.eyebrow}>02 / YOUR AI ACCOUNT</p><h2 id="api-heading">Connect Ollama.</h2>
          <p className={styles.description}>Create a key in your Ollama account, then paste it below. AI requests use your account’s allowance.</p>
          <a href="https://ollama.com/settings/keys" target="_blank" rel="noopener noreferrer" className={styles.secondary}>Get API key ↗</a>
          <form onSubmit={saveKey} className={setup.keyForm}>
            <label htmlFor="ollama-key">Ollama API key</label>
            <input id="ollama-key" name="ollama-key" type="password" autoComplete="new-password" spellCheck={false} autoCapitalize="none" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={session.hasApiKey ? "Key saved — paste a new key to replace it" : "Paste your API key"} required maxLength={4096} disabled={busy === "key"} />
            <p className={styles.hint}>Encrypted before storage. Your saved key is never displayed. Saving makes no AI request; Ollama checks the key when you first use it.</p>
            <button type="submit" className={styles.primary} disabled={Boolean(busy) || !apiKey.trim()}>{busy === "key" ? "Saving…" : session.hasApiKey ? "Replace API key" : "Save API key"}</button>
          </form>
        </section>
      </div>
      <div className={setup.finish}><p>{complete ? "Your planner and API key are saved. You are ready." : "Connect a planner and save your API key to continue."}</p><button type="button" className={styles.primary} disabled={!complete || Boolean(busy) || reconnecting} onClick={() => startNavigation(() => router.push("/"))}>Go to dashboard ↗</button></div>
    </main>
  </div>;
}
