import { GoogleAccessError, googleAccessToken } from "@/ai/google-auth";
import { getSessionUser, isSameOrigin } from "@/lib/auth";
import { usersCollection } from "@/lib/mongodb";
import { canonicalSheetUrl, parseSheetUrl } from "@/lib/sheet";

export const runtime = "nodejs";
export const maxDuration = 60;

const API = "https://sheets.googleapis.com/v4/spreadsheets";
const plannerTitle = "Excela Planner";

class TemplateError extends Error {
  constructor(message: string, readonly status = 502, readonly code?: string) { super(message); }
}

type TabProperties = { sheetId: number; title: string; index: number };

// Creates a copy of Excela's template in the signed-in user's own Google account and saves it as their planner.
// Uses only the Sheets scope the user already granted: a new spreadsheet is created, then each template tab is copied in.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "The template must be generated from the Excela page." }, { status: 403 });
  }
  try {
    const templateId = parseSheetUrl(process.env.TEMPLATE_SHEET_URL);
    if (!templateId) throw new TemplateError("The template is not configured. Set TEMPLATE_SHEET_URL in .env.", 503);

    let current;
    try { current = await getSessionUser(); }
    catch { throw new TemplateError("Could not reach the database. Please retry.", 503); }
    if (!current) throw new TemplateError("Sign in with Google first.", 401, "auth");

    let token: string;
    try { token = await googleAccessToken(current.user); }
    catch (error) {
      if (error instanceof GoogleAccessError) throw new TemplateError(error.message, 401, "reauth");
      throw new TemplateError("Could not reach the database. Please retry.", 503);
    }

    async function google(url: string, init: RequestInit | undefined, failure: string) {
      const result = await fetch(url, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      if (!result.ok) throw new TemplateError(`${failure} (Google ${result.status}).`, 502);
      return result.json();
    }

    // 1. Read the template's tabs (the template must be viewable by anyone with the link).
    const template = await google(
      `${API}/${templateId}?fields=sheets.properties(sheetId,title,index)`,
      undefined,
      "Excela couldn't read its template. Its sharing must allow anyone with the link to view it",
    ) as { sheets?: { properties: TabProperties }[] };
    const tabs = (template.sheets ?? []).map((sheet) => sheet.properties).sort((a, b) => a.index - b.index);
    if (!tabs.length) throw new TemplateError("The template has no tabs.", 503);

    // 2. Create an empty spreadsheet in the user's Drive.
    const created = await google(
      API,
      { method: "POST", body: JSON.stringify({ properties: { title: plannerTitle } }) },
      "Could not create a spreadsheet in your Google account",
    ) as { spreadsheetId: string; sheets: { properties: { sheetId: number } }[] };
    const newId = created.spreadsheetId;

    // 3. Copy every template tab into it, then restore tab names and order and drop the blank default tab.
    const requests: unknown[] = [{ deleteSheet: { sheetId: created.sheets[0].properties.sheetId } }];
    for (const tab of tabs) {
      const copy = await google(
        `${API}/${templateId}/sheets/${tab.sheetId}:copyTo`,
        { method: "POST", body: JSON.stringify({ destinationSpreadsheetId: newId }) },
        `Could not copy the “${tab.title}” tab`,
      ) as { sheetId: number };
      requests.push({
        updateSheetProperties: {
          properties: { sheetId: copy.sheetId, title: tab.title, index: tab.index },
          fields: "title,index",
        },
      });
    }
    await google(
      `${API}/${newId}:batchUpdate`,
      { method: "POST", body: JSON.stringify({ requests }) },
      "Could not finish setting up your planner",
    );

    // 4. Save it as this user's planner, used for all future syncs.
    const url = canonicalSheetUrl(newId);
    await (await usersCollection()).updateOne(
      { _id: current.user._id },
      { $set: { sheetId: newId, sheetUrl: url, sheetTitle: plannerTitle, updatedAt: new Date() } },
    );
    return Response.json({ sheet: { url, title: plannerTitle } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TemplateError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return Response.json({ error: "Could not generate your template. Please try again." }, { status: 502 });
  }
}
