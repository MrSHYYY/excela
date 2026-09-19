/** Matches month tabs such as "Sept 2026". Capture 1 = month name, capture 2 = year. */
export const monthTabPattern =
  /\b(Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\s+(\d{4})\b/i;

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
