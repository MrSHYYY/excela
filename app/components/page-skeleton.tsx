import Image from "next/image";
import styles from "./loading.module.css";

export default function PageSkeleton({ setup = false }: { setup?: boolean }) {
  return <div className={styles.screen} role="status" aria-label={setup ? "Loading setup" : "Loading your workspace"}>
    <header className={styles.header}><Image src="/excela-r.png" alt="" width={34} height={34} priority /><span>excela.</span><span className={styles.spinner} aria-hidden="true" /></header>
    <div className={styles.body} aria-hidden="true">
      {setup && <div className={`${styles.skeleton} ${styles.heading}`} />}
      <div className={styles.panels}>{[0, 1].map((panel) => <div className={styles.panel} key={panel}>
        <div className={`${styles.skeleton} ${styles.label}`} /><div className={`${styles.skeleton} ${styles.field}`} /><div className={`${styles.skeleton} ${styles.button}`} />
      </div>)}</div>
    </div>
    <span className={styles.srOnly}>{setup ? "Loading setup…" : "Loading your workspace…"}</span>
  </div>;
}
