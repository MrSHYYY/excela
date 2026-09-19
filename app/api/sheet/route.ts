import { GoogleAccessError, googleAccessToken } from "@/ai/google-auth";
import { getSessionUser, isSameOrigin } from "@/lib/auth";
import { usersCollection } from "@/lib/mongodb";
import { canonicalSheetUrl, monthTabPattern, parseSheetUrl } from "@/lib/sheet";

export const runtime = "nodejs";

type SheetInfo = { properties?: { title?: string }; sheets?: { properties?: { title?: string } }[] };

// Saves (or replaces) the signed-in user's planner link in MongoDB after checking they can open it.
export async function PUT(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "The link must be saved from the Excela page." }, { status: 403 });
  }
  let body: { url?: unknown } | null;
  try { body = await request.json(); }
  catch { return Response.json({ error: "Invalid JSON body." }, { status: 400 }); }
  const sheetId = parseSheetUrl(body?.url);
  if (!sheetId) {
    return Response.json(
      { error: "Paste a Google Sheets link, like https://docs.google.com/spreadsheets/d/…/edit" },
      { status: 400 },
    );
  }

  try {
    const current = await getSessionUser();
    if (!current) return Response.json({ error: "Sign in with Google first.", code: "auth" }, { status: 401 });

    let token: string;
    try { token = await googleAccessToken(current.user); }
    catch (error) {
      if (!(error instanceof GoogleAccessError)) throw error;
      return Response.json({ error: error.message, code: "reauth" }, { status: 401 });
    }

    const result = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=properties.title,sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) },
    );
    if (!result.ok) {
      const reason =
        result.status === 404 ? "That sheet was not found. Check the link."
        : result.status === 403 ? "Your Google account can't open that sheet. Ask the owner to share it with you, then try again."
        : result.status === 400 ? "That file isn't a native Google Sheet. If it's an uploaded Excel file, use File → Save as Google Sheets first."
        : `Google Sheets request failed (${result.status}). Please try again.`;
      return Response.json({ error: reason }, { status: result.status === 404 || result.status === 403 || result.status === 400 ? 422 : 502 });
    }
    const info = (await result.json()) as SheetInfo;
    const tabs = (info.sheets ?? []).map((sheet) => sheet.properties?.title ?? "");
    if (!tabs.some((title) => monthTabPattern.test(title))) {
      return Response.json(
        { error: "This sheet has no month tabs like “Sept 2026”, so Excela can't place events in it." },
        { status: 422 },
      );
    }

    const sheetUrl = canonicalSheetUrl(sheetId);
    const sheetTitle = info.properties?.title || "Planner";
    await (await usersCollection()).updateOne(
      { _id: current.user._id },
      { $set: { sheetId, sheetUrl, sheetTitle, updatedAt: new Date() } },
    );
    return Response.json({ sheet: { url: sheetUrl, title: sheetTitle } }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { error: "Could not save your link. Check the database connection and try again." },
      { status: 503 },
    );
  }
}
