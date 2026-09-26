"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import type { Session } from "@/lib/session-payload";
import styles from "./dashboard.module.css";
import brand from "./public.module.css";
import setup from "./setup.module.css";
import tgStyles from "./telegram.module.css";
import loadingStyles from "./loading.module.css";
import PendingLink from "./pending-link";
import PageSkeleton from "./page-skeleton";

type SignedInSession = Extract<Session, { authenticated: true }>;

type TelegramStatus = {
  connected: boolean;
  username?: string;
  firstName?: string;
  linkedAt?: string;
};

export default function TelegramClient({ initialSession }: { initialSession: SignedInSession }) {
  const router = useRouter();
  const [navigating] = useTransition();

  const [telegram, setTelegram] = useState<TelegramStatus>(
    initialSession.telegram ?? { connected: false },
  );

  const [linkingState, setLinkingState] = useState<{
    code: string;
    botUrl: string;
    expiresAt: string;
  } | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  // Poll for connection status ONLY while a linking code is actively on screen
  useEffect(() => {
    if (!linkingState || telegram.connected) return;

    let active = true;
    const checkStatus = async () => {
      try {
        const res = await fetch("/api/telegram/status", { cache: "no-store" });
        if (!res.ok || !active) return;
        const data: TelegramStatus = await res.json();
        if (!active) return;

        if (data.connected) {
          setTelegram(data);
          setLinkingState(null);
          setNotice("Your Telegram account is now connected!");
          setError("");
        }
      } catch {
        // Best-effort check
      }
    };

    const timer = setInterval(checkStatus, 3000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [linkingState, telegram.connected]);

  async function handleStartLinking() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/telegram/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not generate linking code.");
      }
      setLinkingState({
        code: data.code,
        botUrl: data.botUrl,
        expiresAt: data.expiresAt,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start linking.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/telegram/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Could not disconnect Telegram.");
      }
      setTelegram({ connected: false });
      setConfirmingDisconnect(false);
      setNotice("Telegram account disconnected.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect.");
    } finally {
      setBusy(false);
    }
  }

  function handleCopyCode() {
    if (!linkingState?.code) return;
    navigator.clipboard.writeText(linkingState.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (navigating) return <PageSkeleton />;

  return (
    <div className={setup.shell}>
      <header className={setup.header}>
        <Link href="/" className={brand.brand} aria-label="Excela home">
          <Image src="/excela-r.png" alt="" width={34} height={34} priority />
          excela<span className={brand.brandDot}>.</span>
        </Link>
        <PendingLink href="/" className={styles.textButton}>
          ← Dashboard
        </PendingLink>
      </header>

      <main className={setup.main}>
        <p className={styles.eyebrow}>INTEGRATIONS</p>
        <h1>Telegram Connection</h1>
        <p className={setup.intro}>
          Connect your Telegram account to interact with Excela on the go.
        </p>

        {error && <p role="alert" className={styles.error}>{error}</p>}
        {notice && <p role="status" className={styles.notice}>{notice}</p>}

        <div className={setup.grid} style={{ gridTemplateColumns: "1fr" }}>
          <section className={setup.card} aria-labelledby="telegram-heading">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
              <p className={styles.eyebrow}>OFFICIAL BOT</p>
              {telegram.connected ? (
                <div className={`${tgStyles.statusBadge} ${tgStyles.statusConnected}`}>
                  <span className={`${tgStyles.statusDot} ${tgStyles.statusDotConnected}`} />
                  Connected
                </div>
              ) : (
                <div className={`${tgStyles.statusBadge} ${tgStyles.statusDisconnected}`}>
                  <span className={`${tgStyles.statusDot} ${tgStyles.statusDotDisconnected}`} />
                  Not connected
                </div>
              )}
            </div>

            <h2 id="telegram-heading">@ExcelaPlannerBot</h2>

            {telegram.connected ? (
              <>
                <p className={styles.description}>
                  Your Telegram account is securely connected to Excela. In an upcoming phase, you will be able to converse with the Excela Smart Agent, view your schedule, and create events directly in Telegram.
                </p>

                <div className={tgStyles.detailsList}>
                  {telegram.username && (
                    <div className={tgStyles.detailRow}>
                      <span className={tgStyles.detailLabel}>Telegram Username</span>
                      <span className={tgStyles.detailValue}>@{telegram.username}</span>
                    </div>
                  )}
                  {telegram.firstName && (
                    <div className={tgStyles.detailRow}>
                      <span className={tgStyles.detailLabel}>Name</span>
                      <span className={tgStyles.detailValue}>{telegram.firstName}</span>
                    </div>
                  )}
                  {telegram.linkedAt && (
                    <div className={tgStyles.detailRow}>
                      <span className={tgStyles.detailLabel}>Connected Since</span>
                      <span className={tgStyles.detailValue}>
                        {new Date(telegram.linkedAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </span>
                    </div>
                  )}
                </div>

                {confirmingDisconnect ? (
                  <div className={tgStyles.disconnectConfirm}>
                    <p style={{ margin: 0, fontSize: "14px", color: "#fca5a5" }}>
                      Are you sure you want to disconnect Telegram? The bot will no longer recognize your account until reconnected.
                    </p>
                    <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
                      <button
                        type="button"
                        className={tgStyles.dangerButton}
                        disabled={busy}
                        onClick={handleDisconnect}
                      >
                        {busy ? "Disconnecting…" : "Yes, disconnect"}
                      </button>
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={busy}
                        onClick={() => setConfirmingDisconnect(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ marginTop: "12px", width: "100%" }}>
                    <button
                      type="button"
                      className={styles.textButton}
                      style={{ color: "#ef4444" }}
                      disabled={busy}
                      onClick={() => setConfirmingDisconnect(true)}
                    >
                      Disconnect Telegram
                    </button>
                  </div>
                )}
              </>
            ) : (
              <>
                <p className={styles.description}>
                  Connect your personal Telegram account to Excela using a one-time secure linking code.
                </p>

                {!linkingState ? (
                  <div className={setup.actions}>
                    <button
                      type="button"
                      className={styles.primary}
                      disabled={busy}
                      onClick={handleStartLinking}
                    >
                      {busy ? "Generating code…" : "Connect Telegram"}
                    </button>
                  </div>
                ) : (
                  <div style={{ width: "100%" }}>
                    <div className={tgStyles.instructionSteps}>
                      <div className={tgStyles.instructionStep}>
                        <span className={tgStyles.stepNumber}>1</span>
                        <span>Open our official bot in Telegram or tap the button below.</span>
                      </div>
                      <div className={tgStyles.instructionStep}>
                        <span className={tgStyles.stepNumber}>2</span>
                        <span>Click <strong>Start</strong> or send the linking code to link your account.</span>
                      </div>
                    </div>

                    <div className={tgStyles.codeBox}>
                      <span className={styles.eyebrow}>YOUR ONE-TIME LINKING CODE</span>
                      <div className={tgStyles.codeDisplay}>{linkingState.code}</div>
                      <div className={tgStyles.codeActions}>
                        <a
                          href={linkingState.botUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.primary}
                        >
                          Open in Telegram ↗
                        </a>
                        <button
                          type="button"
                          className={styles.secondary}
                          onClick={handleCopyCode}
                        >
                          {copied ? "Copied ✓" : "Copy code"}
                        </button>
                        <button
                          type="button"
                          className={styles.textButton}
                          onClick={() => setLinkingState(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>

                    <div className={tgStyles.pollingNotice}>
                      <span className={loadingStyles.spinner} aria-hidden="true" />
                      <span>Waiting for connection from Telegram… (expires in 10 minutes)</span>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
