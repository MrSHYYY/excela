import { GoogleAccessError, googleAccessToken } from "@/ai/google-auth";
import { getSessionUser, isSameOrigin } from "@/lib/auth";
import { monthTabPattern } from "@/lib/sheet";

export const runtime = "nodejs";
export const maxDuration = 60;

type Event = { course: string; title: string; date: string };
type Values = { values?: string[][] };
type Sheet = { properties: { title: string; sheetId: number } };
const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

class SyncError extends Error {
  constructor(message: string, readonly status = 400, readonly code?: string) { super(message); }
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
    if (!isSameOrigin(request)) {
      throw new SyncError("Sync must be requested from the Excela page.", 403);
    }
    let current;
    try { current = await getSessionUser(); }
    catch { throw new SyncError("Could not reach the database. Please retry.", 503); }
    if (!current) throw new SyncError("Sign in with Google to sync.", 401, "auth");
    const { user } = current;
    // The planner link is saved per user in MongoDB (see /api/sheet), not in .env.
    if (!user.sheetId) throw new SyncError("Choose or generate your planner before syncing.", 409, "no_sheet");
    const spreadsheetId = user.sheetId;

    let body;
    try { body = await request.json(); }
    catch { throw new SyncError("Invalid JSON body."); }
    if (!Array.isArray(body?.events) || !body.events.length || body.events.length > 50) {
      throw new SyncError("Provide between 1 and 50 extracted events.");
    }
    const events = body.events.map(parseEvent) as Event[];

    let token: string;
    try { token = await googleAccessToken(user); }
    catch (error) {
      if (error instanceof GoogleAccessError) throw new SyncError(error.message, 401, "reauth");
      throw new SyncError("Could not reach the database. Please retry.", 503);
    }
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
          ? "Choose your planner through Google Drive again, check that your account can edit it, and make sure Google Sheets API is enabled."
          : result.status === 404 ? "Choose your planner through Google Drive again to grant Excela access. If it was deleted, select another planner."
          : "Please retry; existing entries will be checked for duplicates.";
        throw new SyncError(`Google Sheets request failed (${result.status}). ${reason}`, 502);
      }
      return result.json();
    }

    const metadata = await google("?fields=sheets(properties(title,sheetId))") as { sheets: Sheet[] };
    const targets = events.map((event) => {
      const parts = event.date.split("-").map(Number);
      const year = parts.length === 3 ? parts[0] : undefined;
      const month = parts[parts.length - 2];
      const day = parts[parts.length - 1];
      const candidates = metadata.sheets.filter(({ properties }) => {
        const match = properties.title.match(monthTabPattern);
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
      return { event, day, sheet: title, sheetId: candidates[0].properties.sheetId, range: `'${title.replaceAll("'", "''")}'!D3:H45` };
    });
    const ranges = [...new Set(targets.map((target) => target.range))];
    const query = ranges.map((range) => `ranges=${encodeURIComponent(range)}`).join("&");
    // Displayed day numbers locate the date; formulas protect seemingly blank cells.
    const displayed = await google(`/values:batchGet?${query}&valueRenderOption=FORMATTED_VALUE`) as { valueRanges: Values[] };
    const formulas = await google(`/values:batchGet?${query}&valueRenderOption=FORMULA`) as { valueRanges: Values[] };
    const updates: { range: string; label: string; sheet: string; cell: string; sheetId: number; rowIndex: number; columnIndex: number }[] = [];
    let skipped = 0;
    for (const target of targets) {
      const rangeIndex = ranges.indexOf(target.range);
      const rows = displayed.valueRanges[rangeIndex].values ?? [];
      const protectedRows = formulas.valueRanges[rangeIndex].values ?? [];
      const matches = rows.flatMap((row, index) => String(row[0] ?? "").trim() === String(target.day) ? [index] : []);
      if (matches.length !== 1) throw new SyncError(`Cannot locate day ${target.day} in column D of ${target.sheet}. Nothing was written.`);
      const rowIndex = matches[0];
      const row = rows[rowIndex];
      // Everything written to the sheet is uppercase; duplicates are compared case-insensitively below.
      const label = [target.event.course, target.event.title].filter(Boolean).join(" ").replace(/\s+/g, " ").toUpperCase();
      const slots = [1, 2, 3, 4];
      if (slots.some((slot) => String(row[slot] ?? "").trim().toLowerCase() === label.toLowerCase())) {
        skipped++;
        continue;
      }
      const slot = slots.find((index) => !String(row[index] ?? "").trim() && !String(protectedRows[rowIndex]?.[index] ?? "").trim());
      if (slot === undefined) throw new SyncError(`All four event slots on ${target.event.date} are occupied. Nothing was written.`);
      updates.push({
        range: `'${target.sheet.replaceAll("'", "''")}'!${"DEFGH"[slot]}${rowIndex + 3}`,
        label, sheet: target.sheet, cell: `${"DEFGH"[slot]}${rowIndex + 3}`, sheetId: target.sheetId, rowIndex: rowIndex + 2, columnIndex: slot + 3,
      });
      row[slot] = label; // Reserve this slot for subsequent events in the same request.
    }
    if (updates.length) {
      // Write text and colors together; preserve all other cell formatting.
      await google(":batchUpdate", {
        method: "POST",
        body: JSON.stringify({ requests: updates.map((update) => ({
          repeatCell: {
            range: {
              sheetId: update.sheetId,
              startRowIndex: update.rowIndex,
              endRowIndex: update.rowIndex + 1,
              startColumnIndex: update.columnIndex,
              endColumnIndex: update.columnIndex + 1,
            },
            cell: {
              userEnteredValue: { stringValue: update.label },
              userEnteredFormat: {
                backgroundColorStyle: { rgbColor: { red: 153 / 255, green: 27 / 255, blue: 27 / 255 } },
                textFormat: { foregroundColorStyle: { rgbColor: { red: 1, green: 1, blue: 1 } } },
              },
            },
            fields: "userEnteredValue,userEnteredFormat.backgroundColorStyle,userEnteredFormat.textFormat.foregroundColorStyle",
          },
        })) }),
      });
    }
    // One link per month tab that received events, opening that tab at the first new cell.
    const links: { sheet: string; url: string }[] = [];
    for (const update of updates) {
      if (links.some((link) => link.sheet === update.sheet)) continue;
      links.push({
        sheet: update.sheet,
        url: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${update.sheetId}&range=${update.cell}`,
      });
    }
    return Response.json({ written: updates.length, skipped, cells: updates.map(({ range }) => range), links });
  } catch (error) {
    if (error instanceof SyncError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
    return Response.json({ error: "Sync could not finish. Check your connection and retry; duplicates will be skipped." }, { status: 502 });
  }
}
