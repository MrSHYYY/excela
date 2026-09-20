import { NextResponse } from "next/server";
import { googleAccessToken } from "@/ai/google-auth";
import { getSessionUser } from "@/lib/auth";
import { canonicalSheetUrl, tabMonthYear } from "@/lib/sheet";

export const runtime = "nodejs";

function inRange(value: string | null, min: number, max: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

// Opens the signed-in user's planner on the tab for the current month.
// The page passes the browser's local year and month (?y=2026&m=9) so the month matches the user's time zone.
export async function GET(request: Request) {
  const home = new URL("/", request.url);
  const go = (to: string | URL) => {
    const response = NextResponse.redirect(to);
    response.headers.set("Cache-Control", "no-store");
    return response;
  };

  let plainUrl = home.toString();
  try {
    const current = await getSessionUser();
    const sheetId = current?.user.sheetId;
    if (!current || !sheetId) return go(home);
    const { user } = current;
    plainUrl = canonicalSheetUrl(sheetId);

    const now = new Date();
    const url = new URL(request.url);
    const year = inRange(url.searchParams.get("y"), 2000, 2100) ?? now.getUTCFullYear();
    const month = inRange(url.searchParams.get("m"), 1, 12) ?? now.getUTCMonth() + 1;

    const token = await googleAccessToken(user);
    const result = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties(sheetId,title)`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) },
    );
    if (!result.ok) return go(plainUrl);
    const data = (await result.json()) as { sheets?: { properties: { sheetId: number; title: string } }[] };
    const tab = (data.sheets ?? []).find(({ properties }) => {
      const parsed = tabMonthYear(properties.title);
      return parsed?.month === month && parsed.year === year;
    });
    return go(tab ? `${plainUrl}#gid=${tab.properties.sheetId}` : plainUrl);
  } catch {
    // Any problem (expired Google access, network): still open the sheet, just not on a specific tab.
    return go(plainUrl);
  }
}
