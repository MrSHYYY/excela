import PublicShell from "./public-shell";
import styles from "./public.module.css";

export default function Landing({ pending, error, notice }: { pending: boolean; error: string; notice: string }) {
  return <PublicShell>
    <main id="main-content" className={styles.landing}>
      <div className={styles.hero}>
        <div className={styles.copy}>
          <p className={styles.eyebrow}><span className={styles.statusDot} /> FROM CLASS CHAT TO CALENDAR</p>
          <h1>Less keeping track.<br /><span>More keeping up.</span></h1>
          <p className={styles.description}>Quizzes, assignments, deadlines. Turn the announcements you paste into a monthly planner in Google Sheets.</p>
          {pending ? <button className={styles.cta} disabled>Getting ready…</button> : <a href="/api/google/connect" className={styles.cta}>
            <svg viewBox="0 0 48 48" aria-hidden="true" width="19" height="19">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z" />
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
            </svg>Continue with Google<span aria-hidden="true">↗</span>
          </a>}
          <p className={styles.consent}>Your Google account. Your planner.<br />You’ll be asked to allow Google Sheets access.</p>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          {notice && <p role="status" className={styles.notice}>{notice}</p>}
        </div>
        <figure className={styles.preview} aria-label="Example of an announcement becoming a planner entry">
          <div className={styles.previewTop}><span>ONE LESS THING ON YOUR MIND</span><span aria-hidden="true">↗</span></div>
          <div className={styles.message}><span className={styles.tinyLabel}>THE ANNOUNCEMENT</span><p>CSE340 Quiz 4 is on Sept 27.<br />Don’t forget!</p></div>
          <div className={styles.connector}><span />↓<span /></div>
          <div className={styles.calendar}>
            <div className={styles.calendarHeader}><span>September <span className={styles.muted}>2026</span></span><span className={styles.tinyLabel}>YOUR PLANNER</span></div>
            {[{ day: "26", name: "SAT", event: false }, { day: "27", name: "SUN", event: true }, { day: "28", name: "MON", event: false }].map(({ day, name, event }) => <div className={styles.calendarRow} key={day}><span className={styles.date}>{day}<small>{name}</small></span><div className={event ? styles.event : styles.empty}>{event ? <><span>CSE340</span><strong>Quiz 4</strong><span aria-hidden="true">↗</span></> : <span>—</span>}</div></div>)}
          </div>
          <figcaption>Illustrative preview · Made for the way classes happen.</figcaption>
        </figure>
      </div>
    </main>
  </PublicShell>;
}
