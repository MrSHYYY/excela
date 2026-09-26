// Smart's system prompt tells the model to always pass strict YYYY-MM-DD dates to tools (using the
// date table baked into that prompt, the same technique app/api/ai uses). This resolver is a small
// safety net for the few plain-English words a model might still send instead.
const shift = (date: string, days: number) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

const WORDS: Record<string, number> = {
  today: 0, tonight: 0, tomorrow: 1, "day after tomorrow": 2,
  yesterday: -1, "day before yesterday": -2,
};

/** Resolves a tool argument to YYYY-MM-DD, or null if it isn't a real date and isn't a known word. */
export function resolveRelativeDate(value: unknown, today: string): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}T00:00:00Z`);
    return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== trimmed ? null : trimmed;
  }
  const word = trimmed.toLowerCase();
  if (word in WORDS) return shift(today, WORDS[word]);
  return null;
}
