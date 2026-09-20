import { GoogleAccessError, googleAccessToken } from "@/ai/google-auth";
import { getSessionUser, isSameOrigin } from "@/lib/auth";
import { usersCollection } from "@/lib/mongodb";
import { canonicalSheetUrl, monthTabPattern, parseSheetUrl } from "@/lib/sheet";

export const runtime = "nodejs";

type SheetInfo = { properties?: { title?: string }; sheets?: { properties?: { title?: string } }[] };

// Verify Picker's selection on the server before saving it as the user's planner.
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
      { error: "Choose a Google Sheet from Google Drive." },
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

    const fileResult = await fetch(
      `https://www.googleapis.com/drive/v3/files/${sheetId}?fields=mimeType,capabilities(canEdit)&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) },
    );
    if (!fileResult.ok) {
      return Response.json({ error: "Excela couldn't access this file. Choose it through Google Drive again and make sure your account can edit it. Also check that Google Drive API is enabled." }, { status: 422 });
    }
    const file = await fileResult.json() as { mimeType?: string; capabilities?: { canEdit?: boolean } };
    if (file.mimeType !== "application/vnd.google-apps.spreadsheet" || !file.capabilities?.canEdit) {
      return Response.json({ error: "Choose a native Google Sheet that your account can edit." }, { status: 422 });
    }
    const result = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=properties.title,sheets.properties.title`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20_000) },
    );
    if (!result.ok) {
      const reason =
        result.status === 404 ? "That sheet wasn't found. Choose it through Google Drive again."
        : result.status === 403 ? "Choose the sheet through Google Drive again and make sure your account can edit it and Google Sheets API is enabled."
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
