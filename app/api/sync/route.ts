import { googleAccessToken } from "@/ai/google-auth";

export const runtime = "nodejs";

type Event = { course: string; title: string; date: string };
type Values = { values?: string[][] };
type Sheet = { properties: { title: string } };
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

class SyncError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

function parseEvent(value: unknown): Event {
  if (!value || typeof value !== "object") throw new SyncError("Invalid event data.");
  const event = value as Record<string, unknown>;
  if (typeof event.course !== "string" || typeof event.title !== "string" || typeof event.date !== "string") {
    throw new SyncError("Each event needs course, title, and date text.");
  }
  if (!event.title.trim() || event.title.length > 200 || event.course.length > 80 ||
      !/^(?:\d{4}-)?\d{2}-\d{2}$/.test(event.date)) {
    throw new SyncError("An event has an invalid title, course, or date.");
  }
  return { course: event.course.trim(), title: event.title.trim(), date: event.date };
}

export async function POST(request: Request) {
  try {
    // Prevent other websites from submitting writes through a user's browser.
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin) {
      throw new SyncError("Sync must be requested from the Excela page.", 403);
    }
    let body;
    try { body = await request.json(); }
    catch { throw new SyncError("Invalid JSON body."); }
    if (!Array.isArray(body?.events) || !body.events.length || body.events.length > 50) {
      throw new SyncError("Provide between 1 and 50 extracted events.");
    }
    const events = body.events.map(parseEvent) as Event[];
    const doc = process.env.DOC?.trim();
    const spreadsheetId = doc?.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)(?:\/|$)/)?.[1];
    if (!spreadsheetId) throw new SyncError("Set DOC to your Google Sheets link in .env.", 503);
    let token: string;
    try { token = await googleAccessToken(); }
    catch { throw new SyncError("Connect Google before syncing. If already connected, reconnect to renew access.", 401); }
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
    async function google(path: string, init: RequestInit = {}) {
      const result = await fetch(`${base}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!result.ok) {
        const reason = result.status === 403
          ? "Enable the Google Sheets API and make sure your connected Google account can edit this sheet."
          : result.status === 404 ? "Check DOC and the sheet's sharing permissions."
          : "Please retry; existing entries will be checked for duplicates.";
        throw new SyncError(`Google Sheets request failed (${result.status}). ${reason}`, 502);
      }
      return result.json();
    }

    const metadata = await google("?fields=sheets(properties(title))") as { sheets: Sheet[] };
    const targets = events.map((event) => {
      const parts = event.date.split("-").map(Number);
      const year = parts.length === 3 ? parts[0] : undefined;
      const month = parts[parts.length - 2];
      const day = parts[parts.length - 1];
      const candidates = metadata.sheets.filter(({ properties }) => {
        const match = properties.title.match(/\b(Jan\w*|Feb\w*|Mar\w*|Apr\w*|May|Jun\w*|Jul\w*|Aug\w*|Sep\w*|Oct\w*|Nov\w*|Dec\w*)\s+(\d{4})\b/i);
        return match && months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1 === month &&
          (year === undefined || Number(match[2]) === year);
      });
      if (candidates.length !== 1) {
        throw new SyncError(`Cannot uniquely match ${event.date} to a month tab. Include a year if multiple tabs match.`);
      }
      const title = candidates[0].properties.title;
      const sheetYear = Number(title.match(/\b(\d{4})\b/)?.[1]);
      if (day < 1 || day > new Date(Date.UTC(sheetYear, month, 0)).getUTCDate()) {
        throw new SyncError(`Invalid calendar date: ${event.date}.`);
      }
      return { event, day, sheet: title, range: `'${title.replaceAll("'", "''")}'!D3:H45` };
    });
    const ranges = [...new Set(targets.map((target) => target.range))];
    const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
    // Displayed day numbers locate the date; formulas protect seemingly blank cells.
    const displayed = await google(`/values:batchGet?${query}&valueRenderOption=FORMATTED_VALUE`) as { valueRanges: Values[] };
    const formulas = await google(`/values:batchGet?${query}&valueRenderOption=FORMULA`) as { valueRanges: Values[] };
    const updates: { range: string; values: string[][] }[] = [];
    let skipped = 0;
    for (const target of targets) {
      const rangeIndex = ranges.indexOf(target.range);
      const rows = displayed.valueRanges[rangeIndex].values ?? [];
      const protectedRows = formulas.valueRanges[rangeIndex].values ?? [];
      const matches = rows.flatMap((row, index) => String(row[0] ?? "").trim() === String(target.day) ? [index] : []);
      if (matches.length !== 1) throw new SyncError(`Cannot locate day ${target.day} in column D of ${target.sheet}. Nothing was written.`);
      const rowIndex = matches[0];
      const row = rows[rowIndex];
      const label = [target.event.course, target.event.title].filter(Boolean).join(" ").replace(/\s+/g, " ");
      const slots = [1, 2, 3, 4];
      if (slots.some((slot) => String(row[slot] ?? "").trim().toLowerCase() === label.toLowerCase())) {
        skipped++;
        continue;
      }
      const slot = slots.find((index) => !String(row[index] ?? "").trim() && !String(protectedRows[rowIndex]?.[index] ?? "").trim());
      if (slot === undefined) throw new SyncError(`All four event slots on ${target.event.date} are occupied. Nothing was written.`);
      updates.push({ range: `'${target.sheet.replaceAll("'", "''")}'!${"DEFGH"[slot]}${rowIndex + 3}`, values: [[label]] });
      row[slot] = label; // Reserve this slot for subsequent events in the same request.
    }
    if (updates.length) {
      await google("/values:batchUpdate", {
        method: "POST",
        body: JSON.stringify({ valueInputOption: "RAW", data: updates }),
      });
    }
    return Response.json({ written: updates.length, skipped, cells: updates.map(({ range }) => range) });
  } catch (error) {
    if (error instanceof SyncError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Sync could not finish. Check your connection and retry; duplicates will be skipped." }, { status: 502 });
  }
}
