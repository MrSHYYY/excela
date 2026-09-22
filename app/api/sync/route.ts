import { GoogleAccessError, googleAccessToken } from "@/ai/google-auth";
import { getSessionUser, isSameOrigin } from "@/lib/auth";
import { monthTabPattern } from "@/lib/sheet";

export const runtime = "nodejs";
export const maxDuration = 60;

type Event = { course: string; title: string; date: string };
type Values = { values?: (string | number | boolean)[][] };
type Sheet = { properties: { title: string; sheetId: number } };
type Color = { red?: number; green?: number; blue?: number };
type GridCell = {
  formattedValue?: string;
  effectiveFormat?: {
    backgroundColor?: Color;
    textFormat?: { foregroundColor?: Color };
  };
};
type GridSheet = {
  properties: { sheetId: number };
  data?: { startRow?: number; startColumn?: number; rowData?: { values?: GridCell[] }[] }[];
};

function isWhite(color: Color | undefined): boolean {
  return Boolean(color && (color.red ?? 0) >= 0.999 && (color.green ?? 0) >= 0.999 && (color.blue ?? 0) >= 0.999);
}

const months = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

class SyncError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code?: string
  ) {
    super(message);
  }
}

function parseEvent(value: unknown): Event {
  if (!value || typeof value !== "object") {
    throw new SyncError("Invalid event data.");
  }

  const event = value as Record<string, unknown>;

  if (
    typeof event.course !== "string" ||
    typeof event.title !== "string" ||
    typeof event.date !== "string"
  ) {
    throw new SyncError("Each event needs course, title, and date text.");
  }

  if (
    !event.title.trim() ||
    event.title.length > 200 ||
    event.course.length > 80 ||
    !/^(?:\d{4}-)?\d{2}-\d{2}$/.test(event.date)
  ) {
    throw new SyncError("An event has an invalid title, course, or date.");
  }

  return {
    course: event.course.trim(),
    title: event.title.trim(),
    date: event.date,
  };
}

export async function POST(request: Request) {
  try {
    if (!isSameOrigin(request)) {
      throw new SyncError(
        "Sync must be requested from the Excela page.",
        403
      );
    }

    let current;

    try {
      current = await getSessionUser();
    } catch {
      throw new SyncError(
        "Could not reach the database. Please retry.",
        503
      );
    }

    if (!current) {
      throw new SyncError("Sign in with Google to sync.", 401, "auth");
    }

    const { user } = current;

    if (!user.sheetId) {
      throw new SyncError(
        "Choose or generate your planner before syncing.",
        409,
        "no_sheet"
      );
    }

    const spreadsheetId = user.sheetId;

    let body;

    try {
      body = await request.json();
    } catch {
      throw new SyncError("Invalid JSON body.");
    }

    if (
      !Array.isArray(body?.events) ||
      !body.events.length ||
      body.events.length > 50
    ) {
      throw new SyncError("Provide between 1 and 50 extracted events.");
    }

    const events = body.events.map(parseEvent) as Event[];

    let token: string;

    try {
      token = await googleAccessToken(user);
    } catch (error) {
      if (error instanceof GoogleAccessError) {
        throw new SyncError(error.message, 401, "reauth");
      }

      throw new SyncError(
        "Could not reach the database. Please retry.",
        503
      );
    }

    const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;

    async function google(path: string, init: RequestInit = {}) {
      const result = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });

      if (!result.ok) {
        const reason =
          result.status === 403
            ? "Choose your planner through Google Drive again, check that your account can edit it, and make sure Google Sheets API is enabled."
            : result.status === 404
              ? "Choose your planner through Google Drive again to grant Excela access. If it was deleted, select another planner."
              : "Please retry; existing entries will be checked for duplicates.";

        throw new SyncError(
          `Google Sheets request failed (${result.status}). ${reason}`,
          502
        );
      }

      return result.json();
    }

    const metadata = (await google(
      "?fields=sheets(properties(title,sheetId))"
    )) as { sheets: Sheet[] };

    const targets = events.map((event) => {
      const parts = event.date.split("-").map(Number);
      const year = parts.length === 3 ? parts[0] : undefined;
      const month = parts[parts.length - 2];
      const day = parts[parts.length - 1];

      const candidates = metadata.sheets.filter(({ properties }) => {
        const match = properties.title.match(monthTabPattern);

        return (
          match &&
          months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1 ===
            month &&
          (year === undefined || Number(match[2]) === year)
        );
      });

      if (candidates.length !== 1) {
        throw new SyncError(
          `Cannot uniquely match ${event.date} to a month tab. Include a year if multiple tabs match.`
        );
      }

      const title = candidates[0].properties.title;
      const sheetYear = Number(
        title.match(/\b(\d{4})\b/)?.[1]
      );

      if (
        day < 1 ||
        day > new Date(Date.UTC(sheetYear, month, 0)).getUTCDate()
      ) {
        throw new SyncError(
          `Invalid calendar date: ${event.date}.`
        );
      }

      return {
        event,
        day,
        sheet: title,
        sheetId: candidates[0].properties.sheetId,
        range: `'${title.replaceAll("'", "''")}'!D3:H45`,
      };
    });

    const ranges = [
      ...new Set(targets.map((target) => target.range)),
    ];

    const query = ranges
      .map((range) => `ranges=${encodeURIComponent(range)}`)
      .join("&");

    // Read values and visible formatting together. Resetting the fill leaves
    // Excela's white text invisible; the user treats those event slots as cleared.
    const grid = (await google(
      `?${query}&fields=sheets(properties(sheetId),data(startRow,startColumn,rowData(values(formattedValue,effectiveFormat(backgroundColor,textFormat(foregroundColor))))))`
    )) as { sheets: GridSheet[] };
    const displayed: { valueRanges: Values[] } = {
      valueRanges: ranges.map((range) => {
        const target = targets.find((item) => item.range === range)!;
        const sheet = grid.sheets.find((item) => item.properties.sheetId === target.sheetId);
        const rows: NonNullable<Values["values"]> = [];
        for (const block of sheet?.data ?? []) {
          for (const [offset, row] of (block.rowData ?? []).entries()) {
            const rowIndex = (block.startRow ?? 0) + offset - 2;
            if (rowIndex < 0 || rowIndex >= 43) continue;
            rows[rowIndex] ??= [];
            for (const [columnOffset, cell] of (row.values ?? []).entries()) {
              const column = (block.startColumn ?? 0) + columnOffset - 3;
              if (column < 0 || column > 4) continue;
              const format = cell.effectiveFormat;
              const resetFill = column > 0 &&
                isWhite(format?.textFormat?.foregroundColor) &&
                (!format?.backgroundColor || isWhite(format.backgroundColor));
              rows[rowIndex][column] = resetFill ? "" : (cell.formattedValue ?? "");
            }
          }
        }
        return { values: rows };
      }),
    };

    const updates: {
      range: string;
      label: string;
      sheet: string;
      cell: string;
      sheetId: number;
      rowIndex: number;
      columnIndex: number;
    }[] = [];

    let skipped = 0;

    for (const target of targets) {
      const rangeIndex = ranges.indexOf(target.range);
      const rows = displayed.valueRanges[rangeIndex].values ?? [];
      const matches = rows.flatMap((row, index) =>
        String(row[0] ?? "").trim() === String(target.day)
          ? [index]
          : []
      );

      if (matches.length !== 1) {
        throw new SyncError(
          `Cannot locate day ${target.day} in column D of ${target.sheet}. Nothing was written.`
        );
      }

      const rowIndex = matches[0];
      const row = rows[rowIndex];

      const label = [target.event.course, target.event.title]
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ")
        .toUpperCase();

      const slots = [1, 2, 3, 4];

      if (
        slots.some(
          (slot) =>
            String(row[slot] ?? "")
              .trim()
              .toLowerCase() === label.toLowerCase()
        )
      ) {
        skipped++;
        continue;
      }

      // Fill E → F → G → H using what the user sees. Hidden raw values and
      // empty-result formulas must not push an event past a visually empty slot.
      // Only event cells are eligible; date cells are never overwritten.
      const slot = slots.find(
        (index) =>
          String(row[index] ?? "").replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, "") === ""
      );

      if (slot === undefined) {
        throw new SyncError(
          `All four event slots on ${target.event.date} are occupied. Nothing was written.`
        );
      }

      updates.push({
        range: `'${target.sheet.replaceAll("'", "''")}'!${
          "DEFGH"[slot]
        }${rowIndex + 3}`,
        label,
        sheet: target.sheet,
        cell: `${"DEFGH"[slot]}${rowIndex + 3}`,
        sheetId: target.sheetId,
        rowIndex: rowIndex + 2,
        columnIndex: slot + 3,
      });

      // Reserve the selected slot so another event on this date uses the next
      // empty cell, even before this batch has been written to Google Sheets.
      row[slot] = label;
    }

    if (updates.length) {
      await google(":batchUpdate", {
        method: "POST",
        body: JSON.stringify({
          requests: updates.map((update) => ({
            repeatCell: {
              range: {
                sheetId: update.sheetId,
                startRowIndex: update.rowIndex,
                endRowIndex: update.rowIndex + 1,
                startColumnIndex: update.columnIndex,
                endColumnIndex: update.columnIndex + 1,
              },
              cell: {
                userEnteredValue: {
                  stringValue: update.label,
                },
                userEnteredFormat: {
                  backgroundColorStyle: {
                    rgbColor: {
                      red: 153 / 255,
                      green: 27 / 255,
                      blue: 27 / 255,
                    },
                  },
                  textFormat: {
                    foregroundColorStyle: {
                      rgbColor: {
                        red: 1,
                        green: 1,
                        blue: 1,
                      },
                    },
                  },
                },
              },
              fields:
                "userEnteredValue,userEnteredFormat.backgroundColorStyle,userEnteredFormat.textFormat.foregroundColorStyle",
            },
          })),
        }),
      });
    }

    const sheetBase = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;

    const links: {
      sheet: string;
      url: string;
      base: string;
      gid: number;
      row: number;
    }[] = [];

    for (const update of updates) {
      if (
        links.some(
          (link) => link.sheet === update.sheet
        )
      ) {
        continue;
      }

      const row = Number(
        update.cell.replace(/^[A-Z]+/, "")
      );

      links.push({
        sheet: update.sheet,
        url: `${sheetBase}#gid=${update.sheetId}&range=A${Math.max(
          1,
          row - 12
        )}`,
        base: sheetBase,
        gid: update.sheetId,
        row,
      });
    }

    return Response.json({
      written: updates.length,
      skipped,
      cells: updates.map(({ range }) => range),
      links,
    });
  } catch (error) {
    if (error instanceof SyncError) {
      return Response.json(
        {
          error: error.message,
          code: error.code,
        },
        {
          status: error.status,
        }
      );
    }

    return Response.json(
      {
        error:
          "Sync could not finish. Check your connection and retry; duplicates will be skipped.",
      },
      {
        status: 502,
      }
    );
  }
}
