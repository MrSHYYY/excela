// Local pre-filters that run in the browser BEFORE any AI request, so obviously irrelevant messages cost
// zero tokens. They are deliberately forgiving: small typos ("tomorow", "assignmnt", "todayy") still pass,
// because the AI reads the message properly afterwards and corrects the spelling itself.

const ACADEMIC_KEYWORDS = [
  // Academic events
  "quiz", "quizzes", "quizz", "test", "tests", "exam", "exams", "midterm", "midterms", "final", "finals",
  "assessment", "assessments",
  // Coursework
  "assignment", "assignments", "homework", "project", "projects", "lab", "labs", "laboratory", "practical",
  "practicals", "presentation", "presentations", "viva",
  // Academic schedule
  "class", "classes", "lecture", "lectures", "tutorial", "tutorials", "deadline", "deadlines", "submission",
  "submissions", "submit", "due",
  // Schedule changes
  "rescheduled", "reschedule", "postponed", "postpone", "cancelled", "canceled", "cancel", "moved", "extended",
  "extension",
];

// Relative days, including common short forms.
const RELATIVE_DAY_WORDS = [
  "today", "tonight", "tomorrow", "yesterday", "tmrw", "tmr", "tomo", "tdy", "yday", "2day", "2moro", "2morrow",
];

const MONTH_WORDS = [
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november",
  "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
];

// Edit distance where swapping two neighbouring letters ("quzi" for "quiz") counts as a single edit.
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

// How many mistakes a word may contain and still count as the keyword. Short keywords must match exactly
// (or with two letters swapped) so "test" doesn't match "best" or "text"; longer ones tolerate one or two.
function looksLike(word: string, keyword: string): boolean {
  if (word === keyword) return true;
  if (keyword.length <= 3 || Math.abs(word.length - keyword.length) > 2) return false;
  if (keyword.length === 4) {
    return word.length === 4 && [...word].sort().join("") === [...keyword].sort().join("") && editDistance(word, keyword) === 1;
  }
  return editDistance(word, keyword) <= (keyword.length >= 9 ? 2 : 1);
}

// Lower-case words; trailing digits are dropped so "quiz4" and "cse340" are read as "quiz" and "cse".
function wordsOf(message: string): string[] {
  return message
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((word) => word.replace(/\d+$/, "") || word)
    .filter((word) => word.length >= 3);
}

function mentionsAny(message: string, keywords: readonly string[]): boolean {
  const words = wordsOf(message);
  return keywords.some((keyword) => words.some((word) => looksLike(word, keyword)));
}

// Does the message contain something that looks like a date: a month, a relative day (tomorrow, tday...),
// a numeric date (9/27, 2026-09-27), or "in 3 days" / "2 days ago"?
function hasDateSignal(message: string): boolean {
  return (
    mentionsAny(message, MONTH_WORDS) ||
    mentionsAny(message, RELATIVE_DAY_WORDS) ||
    /\b\d{1,4}[/-]\d{1,2}\b/.test(message) ||
    /\b(in \d+ days?|\d+ days? (ago|from now))\b/i.test(message)
  );
}

/** General pipeline: a task needs a date to be useful. */
export function passesGeneralFilter(message: string): boolean {
  return hasDateSignal(message);
}

/** Academic pipeline: an academic keyword, or a course code (CSE340, MAT 110) together with a date. */
export function passesAcademicFilter(message: string): boolean {
  if (mentionsAny(message, ACADEMIC_KEYWORDS)) return true;
  return /\b[a-z]{2,4}[\s-]?\d{3,4}\b/i.test(message) && hasDateSignal(message);
}
