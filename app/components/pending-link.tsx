"use client";

import Link, { useLinkStatus } from "next/link";
import type { ReactNode } from "react";
import styles from "./loading.module.css";

function Label({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return <span className={styles.pendingLabel} aria-live="polite">{pending && <span className={styles.spinner} aria-hidden="true" />}{pending ? "Loading…" : children}</span>;
}

export default function PendingLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return <Link href={href} className={className}><Label>{children}</Label></Link>;
}
