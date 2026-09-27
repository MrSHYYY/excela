"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import styles from "./dashboard.module.css";
import Landing from "./landing";
import PageSkeleton from "./page-skeleton";
import PendingLink from "./pending-link";
import { startGoogleSignIn } from "./google-sign-in";
import { useAuth } from "./auth-context";
import type { Session } from "@/lib/session-payload";
import type { AgentMessage } from "@/lib/agent/agent";

type SmartChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

function localToday() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const signInMessages: Record<string, string> = {
  denied: "Google permission was not granted. Continue with Google again and allow access to files you create or select with Excela.",
  invalid_state: "Sign-in expired or was opened in a different browser. Please try again.",
  unverified: "That Google account's email is not verified. Use a verified Google account.",
  database: "Signed in with Google, but Excela could not reach its database. Check MONGODB_URI and Atlas network access.",
  failed: "Google sign-in failed. Check the OAuth credentials and the registered redirect URL.",
};

export default function HomeClient({ initialSession }: { initialSession: Session | null }) {
  const { session: currentSession, setSession } = useAuth();
  const session = currentSession !== null ? currentSession : initialSession;

  const [error, setError] = useState("");
  const notice = "";

  // Smart Chat state
  const [smartChat, setSmartChat] = useState<SmartChatMessage[]>([]);
  const [smartHistory, setSmartHistory] = useState<AgentMessage[]>([]);
  const [smartInput, setSmartInput] = useState("");
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartError, setSmartError] = useState("");
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const smartInputRef = useRef<HTMLTextAreaElement>(null);
  const smartMsgCounter = useRef(0);
  const prevSmartLoading = useRef(false);

  useEffect(() => {
    chatMessagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [smartChat, smartLoading]);

  useEffect(() => {
    if (prevSmartLoading.current && !smartLoading) {
      smartInputRef.current?.focus();
    }
    prevSmartLoading.current = smartLoading;
  }, [smartLoading]);

  useEffect(() => {
    smartInputRef.current?.focus();
  }, []);

  // Handle query param errors from Google OAuth callback
  useEffect(() => {
    let active = true;
    const status = new URLSearchParams(window.location.search).get("google");
    if (status) {
      window.history.replaceState(null, "", window.location.pathname);
      if (status !== "connected") {
        queueMicrotask(() => {
          if (active) setError(signInMessages[status] || "Please sign in with Google again.");
        });
      }
    }
    return () => {
      active = false;
    };
  }, []);

  function handleAuthCode(code?: string) {
    if (code === "auth") setSession({ authenticated: false });
    if (code === "reauth") setSession((current) => (current?.authenticated ? { ...current, googleAccess: false } : current));
    if (code === "no_sheet") setSession((current) => (current?.authenticated ? { ...current, sheet: null } : current));
    if (code === "setup_required") setSession((current) => (current?.authenticated ? { ...current, hasApiKey: false } : current));
  }

  async function handleSmartSend(textToSend?: string) {
    const raw = typeof textToSend === "string" ? textToSend : smartInput;
    const trimmed = raw.trim();
    if (!trimmed || smartLoading || !session?.authenticated || !session.sheet || !session.hasApiKey || !session.googleAccess) return;

    const userMsg: SmartChatMessage = {
      id: ++smartMsgCounter.current,
      role: "user",
      content: trimmed,
    };

    setSmartChat((prev) => [...prev, userMsg]);
    setSmartInput("");
    setSmartLoading(true);
    setSmartError("");

    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: smartHistory,
          today: localToday(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        handleAuthCode(data.code);
        throw new Error(data.error || "Unable to reach Excela.");
      }

      const assistantMsg: SmartChatMessage = {
        id: ++smartMsgCounter.current,
        role: "assistant",
        content: typeof data.reply === "string" ? data.reply : "",
      };

      setSmartChat((prev) => [...prev, assistantMsg]);
      if (Array.isArray(data.history)) {
        setSmartHistory(data.history);
      }
    } catch (err) {
      setSmartError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSmartLoading(false);
      setTimeout(() => {
        smartInputRef.current?.focus();
      }, 0);
    }
  }

  if (session === null) return <PageSkeleton />;

  if (!session.authenticated) {
    return <Landing pending={false} error={error} notice={notice} />;
  }

  const setupComplete = Boolean(session.sheet && session.hasApiKey);

  return (
    <div className={styles.content}>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {!session.googleAccess && (
        <p role="alert" className={styles.warning}>
          Reconnect Google to access your planner.{" "}
          <a
            href="/api/google/connect?consent=1"
            onClick={(event) => {
              event.preventDefault();
              startGoogleSignIn(true);
            }}
          >
            Sign in with Google again ↗
          </a>
        </p>
      )}

      <div className={styles.workspaceGate}>
        <div
          className={`${styles.workspace} ${styles.smartWorkspace}`}
          data-locked={!setupComplete}
          inert={!setupComplete}
          aria-hidden={!setupComplete}
        >
          <section className={styles.smartPanel} aria-labelledby="smart-heading">
            <div className={styles.tabBar}>
              <div className={styles.smartHeaderTitle}>
                <h2 id="smart-heading">Excela</h2>
                <span className={styles.smartBadge}>Planner Agent</span>
              </div>
            </div>

            <div className={styles.chatScroll} ref={chatScrollRef}>
              {smartChat.length === 0 ? (
                <div className={styles.chatEmptyState}>
                  <div className={styles.chatEmptyIcon}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <h3>Talk to Excela</h3>
                  <p>Ask about your schedule, add assignments, reschedule dates, or complete tasks conversationally.</p>
                  <div className={styles.chatSuggestions}>
                    <button type="button" onClick={() => void handleSmartSend("What do I have today?")}>
                      What do I have today?
                    </button>
                    <button type="button" onClick={() => void handleSmartSend("What's on this week?")}>
                      What&apos;s on this week?
                    </button>
                    <button type="button" onClick={() => void handleSmartSend("What upcoming deadlines do I have?")}>
                      Upcoming deadlines
                    </button>
                  </div>
                </div>
              ) : (
                <div className={styles.chatList}>
                  {smartChat.map((msg) => (
                    <div key={msg.id} className={msg.role === "user" ? styles.userMessageRow : styles.assistantMessageRow}>
                      <div className={msg.role === "user" ? styles.userBubble : styles.assistantBubble}>
                        <div className={styles.bubbleAuthor}>
                          {msg.role === "user" ? "You" : "Excela"}
                        </div>
                        <div className={styles.bubbleText}>
                          {msg.content}
                        </div>
                      </div>
                    </div>
                  ))}
                  {smartLoading && (
                    <div className={styles.assistantMessageRow}>
                      <div className={`${styles.assistantBubble} ${styles.thinkingBubble}`}>
                        <div className={styles.bubbleAuthor}>Excela</div>
                        <div className={styles.thinkingText}>
                          <span className={styles.thinkingDot} />
                          <span className={styles.thinkingDot} />
                          <span className={styles.thinkingDot} />
                          <span style={{ marginLeft: "8px" }}>Thinking…</span>
                        </div>
                      </div>
                    </div>
                  )}
                  {smartError && (
                    <div className={styles.chatError}>
                      <span>{smartError}</span>
                    </div>
                  )}
                  <div ref={chatMessagesEndRef} />
                </div>
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSmartSend();
              }}
              className={styles.chatForm}
            >
              <div className={styles.chatInputWrapper}>
                <textarea
                  ref={smartInputRef}
                  value={smartInput}
                  onChange={(e) => setSmartInput(e.target.value)}
                  onKeyDown={(event) => {
                    const touchKeyboard = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
                    if (!touchKeyboard && event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder={session?.sheet ? "Message Excela, e.g. \u2018add CSE340 quiz tomorrow at 10 AM\u2019 or \u2018what do I have today\u2019\u2026" : "Connect a planner to start chatting…"}
                  rows={1}
                  disabled={smartLoading || !session?.sheet || !session?.googleAccess}
                  maxLength={4000}
                  className={styles.chatTextarea}
                />
                <button
                  type="submit"
                  className={styles.chatSendButton}
                  disabled={smartLoading || !smartInput.trim() || !session?.sheet || !session?.googleAccess}
                  aria-label="Send message"
                >
                  {smartLoading ? "…" : "Send ↗"}
                </button>
              </div>
              <p className={styles.chatHint}>
                {session?.sheet ? (
                  <>
                    <span className={styles.desktopKeyboardHint}>Press Enter to send · Shift+Enter for a new line.</span>
                    <span className={styles.touchKeyboardHint}>Tap Send when ready.</span>
                  </>
                ) : (
                  "Connect or generate a planner to get started."
                )}
              </p>
            </form>
          </section>
        </div>

        {!setupComplete && (
          <div className={styles.setupOverlay}>
            <div className={styles.setupPrompt}>
              <h2>A little setup. Then you are ready.</h2>
              <p>Connect your planner and your personal Ollama API key.</p>
              <PendingLink href="/setup" className={styles.primary}>Complete setup ↗</PendingLink>
            </div>
          </div>
        )}
      </div>

      <footer className={styles.footer}>
        <span>Your sheet. A little less to remember.</span>
        <nav aria-label="Legal">
          <Link href="/privacy">Privacy policy</Link>
          <Link href="/terms">Terms of service</Link>
        </nav>
      </footer>
    </div>
  );
}
