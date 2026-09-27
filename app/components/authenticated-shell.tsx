"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "./auth-context";
import styles from "./shell.module.css";
import PageSkeleton from "./page-skeleton";

export default function AuthenticatedShell({
  children,
}: {
  children: ReactNode;
}) {
  const { session, setSession, sidebarOpen, toggleSidebar, closeSidebar } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Auto-close sidebar on route change on mobile/tablet
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      closeSidebar();
    }
  }, [pathname, closeSidebar]);

  // Close sidebar on Escape key
  useEffect(() => {
    if (!sidebarOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        closeSidebar();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [sidebarOpen, closeSidebar]);

  // Close settings menu on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
        setConfirmingDelete(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setConfirmingDelete(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  async function handleSignOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // server session handles expiration
    }
    setSession({ authenticated: false });
    setMenuOpen(false);
    closeSidebar();
    router.replace("/");
    router.refresh();
  }

  async function handleDeleteAccount() {
    if (deleting) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Unable to delete your account.");
      }
      setSession({ authenticated: false });
      setConfirmingDelete(false);
      setMenuOpen(false);
      closeSidebar();
      router.replace("/");
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Unable to delete your account.");
    } finally {
      setDeleting(false);
    }
  }

  // Still resolving initial authentication
  if (session === null) {
    return <PageSkeleton />;
  }

  // Not authenticated: render child directly (e.g. Landing on `/`, or redirect on protected routes)
  if (!session.authenticated) {
    return <>{children}</>;
  }

  // Page title resolution
  const pageTitle =
    pathname === "/"
      ? "Dashboard"
      : pathname === "/telegram"
      ? "Telegram Bot"
      : pathname === "/setup"
      ? "Planner & API Settings"
      : "Excela";

  const isHome = pathname === "/";
  const isTelegram = pathname === "/telegram";
  const isSetup = pathname === "/setup";

  return (
    <div className={styles.shell} data-sidebar-open={sidebarOpen}>
      <a href="#main-content" className={styles.skip}>
        Skip to main content
      </a>

      {/* Top persistent navigation bar */}
      <header className={styles.navbar}>
        <div className={styles.navLeft}>
          <Link href="/" className={styles.brandLink} aria-label="Excela home">
            <Image src="/excela-r.png" alt="" width={32} height={32} priority />
            <span>
              excela<span className={styles.brandDot}>.</span>
            </span>
          </Link>

          <button
            type="button"
            className={styles.menuToggle}
            aria-label={sidebarOpen ? "Close navigation sidebar" : "Open navigation sidebar"}
            aria-expanded={sidebarOpen}
            aria-controls="app-sidebar"
            onClick={toggleSidebar}
          >
            <span />
            <span />
            <span />
          </button>

          <div className={styles.pageTitleBadge} aria-current="page">
            <span className={styles.pageTitleDot} aria-hidden="true" />
            <span>{pageTitle}</span>
          </div>
        </div>

        <div className={styles.navRight}>
          {session.user && (
            <div className={styles.identity}>
              {session.user.picture && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.user.picture}
                  alt=""
                  width={36}
                  height={36}
                  referrerPolicy="no-referrer"
                  className={styles.userAvatar}
                />
              )}
              <div className={styles.identityText}>
                <p className={styles.userName}>{session.user.name}</p>
                <p className={styles.userEmail}>{session.user.email}</p>
              </div>
            </div>
          )}

          {session.sheet && (
            <a
              href="/api/sheet/open"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => {
                event.preventDefault();
                const now = new Date();
                window.open(
                  `/api/sheet/open?y=${now.getFullYear()}&m=${now.getMonth() + 1}`,
                  "_blank",
                  "noopener,noreferrer",
                );
              }}
              className={styles.sheetButton}
              aria-label="View your Google Sheet"
              title="Open your Google Sheets planner"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              <span>View your sheet</span>
            </a>
          )}

          {/* Account Settings Menu */}
          <div ref={menuRef} style={{ position: "relative" }}>
            <button
              type="button"
              aria-label="Settings and account menu"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuOpen((prev) => !prev);
                setConfirmingDelete(false);
              }}
              className={styles.settingsButton}
            >
              <svg
                aria-hidden="true"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.6}
                stroke="currentColor"
                width={20}
                height={20}
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
              <div role="menu" aria-label="Account settings" className={styles.dropdownMenu}>
                {confirmingDelete ? (
                  <div className={styles.deleteConfirmBox}>
                    <p style={{ margin: 0, fontSize: "13px", fontWeight: 600, color: "#f87171" }}>
                      Delete your account?
                    </p>
                    <p style={{ margin: 0, fontSize: "12px", color: "#a1a1aa", lineHeight: 1.5 }}>
                      This permanently removes your account, link to Google Sheets, and stored preferences.
                    </p>
                    <div style={{ display: "flex", gap: "8px", marginTop: "4px" }}>
                      <button
                        type="button"
                        onClick={handleDeleteAccount}
                        disabled={deleting}
                        style={{
                          padding: "6px 12px",
                          background: "#dc2626",
                          color: "#fff",
                          border: "none",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: 500,
                          cursor: "pointer",
                        }}
                      >
                        {deleting ? "Deleting…" : "Yes, delete"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingDelete(false)}
                        disabled={deleting}
                        style={{
                          padding: "6px 12px",
                          background: "#27272a",
                          color: "#e4e4e7",
                          border: "1px solid #3f3f46",
                          borderRadius: "6px",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
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
                      className={styles.dropdownItem}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      Sign out
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => setConfirmingDelete(true)}
                      className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18" />
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                      </svg>
                      Delete account
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Persistent App Sidebar */}
      <aside
        id="app-sidebar"
        aria-label="Application navigation"
        aria-hidden={!sidebarOpen}
        className={styles.sidebar}
      >
        <div className={styles.sidebarContent}>
          <div className={styles.sidebarSection}>
            <span className={styles.sidebarEyebrow}>WORKSPACE</span>
            <nav style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <Link
                href="/"
                className={`${styles.navLink} ${isHome ? styles.navLinkActive : ""}`}
                aria-current={isHome ? "page" : undefined}
              >
                <div className={styles.navLinkLeft}>
                  <svg
                    className={styles.navIcon}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect width="7" height="9" x="3" y="3" rx="1" />
                    <rect width="7" height="5" x="14" y="3" rx="1" />
                    <rect width="7" height="9" x="14" y="12" rx="1" />
                    <rect width="7" height="5" x="3" y="16" rx="1" />
                  </svg>
                  <span>Dashboard</span>
                </div>
              </Link>

              <Link
                href="/telegram"
                className={`${styles.navLink} ${isTelegram ? styles.navLinkActive : ""}`}
                aria-current={isTelegram ? "page" : undefined}
              >
                <div className={styles.navLinkLeft}>
                  <svg
                    className={styles.navIcon}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m22 2-7 20-4-9-9-4Z" />
                    <path d="M22 2 11 13" />
                  </svg>
                  <span>Telegram Bot</span>
                </div>
                {session.telegram?.connected && (
                  <span
                    className={styles.navStatusDot}
                    title="Telegram bot is connected"
                    aria-label="Connected"
                  />
                )}
              </Link>

              <Link
                href="/setup"
                className={`${styles.navLink} ${isSetup ? styles.navLinkActive : ""}`}
                aria-current={isSetup ? "page" : undefined}
              >
                <div className={styles.navLinkLeft}>
                  <svg
                    className={styles.navIcon}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                  <span>Planner &amp; API</span>
                </div>
              </Link>
            </nav>
          </div>
        </div>

        {/* Sidebar bottom */}
        <div className={styles.sidebarFooter}>
          {session.sheet && (
            <a
              href={session.sheet.url}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.sheetStatusCard}
              title="Open Google Sheet in new tab"
            >
              <span className={styles.sheetStatusLabel}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                Google Sheet ↗
              </span>
              <span className={styles.sheetStatusTitle}>{session.sheet.title}</span>
            </a>
          )}
          <span className={styles.versionTag}>Excela · Smart Planner</span>
        </div>
      </aside>

      {/* Backdrop overlay for mobile drawer */}
      {sidebarOpen && (
        <div
          className={styles.backdrop}
          aria-hidden="true"
          onClick={closeSidebar}
        />
      )}

      {/* Main Content Area */}
      <main id="main-content" className={styles.main}>
        <div className={styles.mainInner}>{children}</div>
      </main>
    </div>
  );
}
