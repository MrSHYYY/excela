import { randomUUID } from "node:crypto";
import type { Filter, ObjectId } from "mongodb";
import type { UserDoc } from "@/lib/models";
import { usersCollection } from "@/lib/mongodb";
import { parseSheetUrl } from "@/lib/sheet";

/** Every planner Excela creates has this exact name. Reset only works on a planner named like this. */
export const PLANNER_TITLE = "Excela";
const maxTemplateBytes = 5 * 1024 * 1024;

export class TemplateError extends Error {
  constructor(message: string, readonly status = 502, readonly code?: string) { super(message); }
}

// Exports the public master without user credentials, then imports it as a new Google Sheet created by
// Excela. drive.file authorizes that new planner without giving Excela access to the master or anything else.
// Returns the new file's id. Never retried automatically: a network failure may happen after Drive
// has already created the file, and a retry would leave a duplicate.
export async function createPlannerFromTemplate(token: string): Promise<string> {
  const templateId = parseSheetUrl(process.env.TEMPLATE_SHEET_URL);
  if (!templateId) throw new TemplateError("The template is not configured. Set TEMPLATE_SHEET_URL in .env.", 503);

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
    JSON.stringify({ name: PLANNER_TITLE, mimeType: "application/vnd.google-apps.spreadsheet" }),
    `\r\n--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`,
    new Uint8Array(workbook),
    `\r\n--${boundary}--\r\n`,
  ]);
  const imported = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body, cache: "no-store", signal: AbortSignal.timeout(25_000),
  });
  if (!imported.ok) {
    throw new TemplateError(`Could not import your planner (Google ${imported.status}). Check that Google Drive API is enabled and your account can create files.`);
  }
  const created = await imported.json() as { id?: string };
  if (!created.id) throw new TemplateError(`Google did not return the new planner's ID. Check your Drive for a file named “${PLANNER_TITLE}” before trying again.`);
  return created.id;
}

/** Moves a file to Google Drive's trash (recoverable for 30 days). Returns false if it couldn't. */
export async function trashDriveFile(token: string, fileId: string): Promise<boolean> {
  try {
    const result = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    return result.ok;
  } catch {
    return false;
  }
}

// A short database lock so two requests at once (double click, two tabs) can't both create a planner.
// It expires by itself, so a crashed request can't block the user for long.
const LOCK_MS = 2 * 60_000;

export async function acquirePlannerLock(userId: ObjectId, requirement: Filter<UserDoc> = {}) {
  const now = new Date();
  const result = await (await usersCollection()).updateOne(
    {
      $and: [
        { _id: userId },
        requirement,
        { $or: [{ plannerLockUntil: { $exists: false } }, { plannerLockUntil: { $lt: now } }] },
      ],
    },
    { $set: { plannerLockUntil: new Date(now.getTime() + LOCK_MS) } },
  );
  return result.matchedCount === 1;
}

export async function releasePlannerLock(userId: ObjectId) {
  await (await usersCollection()).updateOne({ _id: userId }, { $unset: { plannerLockUntil: "" } });
}
