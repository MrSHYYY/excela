import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import styles from "./public.module.css";

export default function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <a href="#main-content" className={styles.skip}>Skip to content</a>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Excela home">
          <Image src="/excela-r.png" alt="" width={34} height={34} priority /> excela<span className={styles.brandDot}>.</span>
        </Link>
        <a href="/api/google/connect" className={styles.signIn}>Sign In <span aria-hidden="true">↗</span></a>
      </header>
      {children}
      <footer className={styles.footer}>
        <span>Excela · Your sheet, powered by AI.</span>
        <nav aria-label="Legal"><Link href="/privacy">Privacy policy</Link><Link href="/terms">Terms of service</Link></nav>
      </footer>
    </div>
  );
}

export function LegalPage({ title, intro, children }: { title: string; intro: string; children: ReactNode }) {
  return <PublicShell><main id="main-content" className={styles.legal}>
    <Link href="/" className={styles.back}>← Back to Excela</Link>
    <p className={styles.eyebrow}>THE SMALL PRINT, IN PLAIN WORDS</p>
    <h1>{title}</h1><p className={styles.legalIntro}>{intro}</p>
    <p className={styles.updated}>Last updated September 20, 2026</p>
    <div className={styles.legalBody}>{children}</div>
  </main></PublicShell>;
}
