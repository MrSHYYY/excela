/** Matches month tabs such as "Sept 2026". Capture 1 = month name, capture 2 = year. */
export const monthTabPattern =
  /\b(Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\s+(\d{4})\b/i;

const monthPrefixes = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Reads "Sept 2026" as { month: 9, year: 2026 }, or null if the tab isn't a month tab. */
export function tabMonthYear(title: string): { month: number; year: number } | null {
  const match = title.match(monthTabPattern);
  if (!match) return null;
  return { month: monthPrefixes.indexOf(match[1].slice(0, 3).toLowerCase()) + 1, year: Number(match[2]) };
}

/** Extracts the spreadsheet id from a Google Sheets link, or returns null. */
export function parseSheetUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value
    .trim()
    .match(/^https:\/\/docs\.google\.com\/spreadsheets\/(?:u\/\d+\/)?d\/([\w-]+)(?:[/?#]|$)/);
  return match ? match[1] : null;
}

export const canonicalSheetUrl = (sheetId: string) =>
  `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;
