import { randomUUID } from "node:crypto";
import { GoogleAccessError, googleAccessToken } from "@/ai/google-auth";
import { getSessionUser, isSameOrigin } from "@/lib/auth";
import { usersCollection } from "@/lib/mongodb";
import { canonicalSheetUrl, parseSheetUrl } from "@/lib/sheet";

export const runtime = "nodejs";
export const maxDuration = 60;
const plannerTitle = "Excela Planner";
const maxTemplateBytes = 5 * 1024 * 1024;

class TemplateError extends Error {
  constructor(message: string, readonly status = 502, readonly code?: string) { super(message); }
}

// Export the public master without user credentials, then import an app-created
// Google Sheet. drive.file authorizes the new planner without access to the master.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "The template must be generated from the Excela page." }, { status: 403 });
  }
  let createdUrl: string | undefined;
  try {
    const templateId = parseSheetUrl(process.env.TEMPLATE_SHEET_URL);
    if (!templateId) throw new TemplateError("The template is not configured. Set TEMPLATE_SHEET_URL in .env.", 503);
    const current = await getSessionUser();
    if (!current) throw new TemplateError("Sign in with Google first.", 401, "auth");
    const token = await googleAccessToken(current.user);

    const exported = await fetch(`https://docs.google.com/spreadsheets/d/${templateId}/export?format=xlsx`, {
      cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    if (!exported.ok || !exported.body) {
      throw new TemplateError("Excela couldn't download its template. The master must allow anyone with the link to view and download it.", 503);
    }
    const reader = exported.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxTemplateBytes) {
        await reader.cancel();
        throw new TemplateError("The planner template exceeds the 5 MB import limit.", 503);
      }
      chunks.push(value);
    }
    const workbook = Buffer.concat(chunks);
    if (workbook.length < 4 || workbook.readUInt32LE(0) !== 0x04034b50) {
      throw new TemplateError("The template wasn't exported as Excel. Check that the master allows public viewing and downloads.", 503);
    }

    const boundary = `excela_${randomUUID()}`;
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify({ name: plannerTitle, mimeType: "application/vnd.google-apps.spreadsheet" }),
      `\r\n--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
      new Uint8Array(workbook),
      `\r\n--${boundary}--\r\n`,
    ]);
    // Never automatically retry creation: a network failure may occur after Drive creates the file.
    const imported = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body, cache: "no-store", signal: AbortSignal.timeout(25_000),
    });
    if (!imported.ok) {
      throw new TemplateError(`Could not import your planner (Google ${imported.status}). Check that Google Drive API is enabled and your account can create files.`);
    }
    const created = await imported.json() as { id?: string };
    if (!created.id) throw new TemplateError("Google did not return the new planner's ID. Check your Drive before retrying.");
    createdUrl = canonicalSheetUrl(created.id);
    await (await usersCollection()).updateOne(
      { _id: current.user._id },
      { $set: { sheetId: created.id, sheetUrl: createdUrl, sheetTitle: plannerTitle, updatedAt: new Date() } },
    );
    return Response.json({ sheet: { url: createdUrl, title: plannerTitle } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (createdUrl) {
      return Response.json({ error: "Your planner was created in Drive, but its link couldn't be saved. Choose ‘Excela Planner’ from Google Drive to connect it." }, { status: 503 });
    }
    if (error instanceof GoogleAccessError) {
      return Response.json({ error: error.message, code: "reauth" }, { status: 401 });
    }
    if (error instanceof TemplateError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return Response.json({ error: "Could not finish generating your planner. Check Drive for ‘Excela Planner’ before trying again; if it exists, choose it from Google Drive." }, { status: 502 });
  }
}
