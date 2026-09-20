import type { ObjectId } from "mongodb";
import { GoogleAccessError, googleAccessToken } from "@/ai/google-auth";
import { getSessionUser, isSameOrigin } from "@/lib/auth";
import { usersCollection } from "@/lib/mongodb";
import {
  PLANNER_TITLE,
  TemplateError,
  acquirePlannerLock,
  createPlannerFromTemplate,
  releasePlannerLock,
  trashDriveFile,
} from "@/lib/planner-template";
import { canonicalSheetUrl } from "@/lib/sheet";

export const runtime = "nodejs";
export const maxDuration = 60;

// Replaces the user's Excela planner with a fresh copy of the template. It only works on the planner
// Excela created for this user, and only while that file is still named exactly "Excela". Anything else
// (a planner picked from Drive, a renamed file) is refused so a user's own sheets are never replaced.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "The reset must be requested from the Excela page." }, { status: 403 });
  }
  let locked: ObjectId | undefined;
  let createdNew = false;
  try {
    const current = await getSessionUser();
    if (!current) throw new TemplateError("Sign in with Google first.", 401, "auth");
    const { user } = current;
    const oldId = user.generatedSheetId;
    if (!oldId || user.sheetId !== oldId) {
      throw new TemplateError(
        `Reset only works on the planner Excela created for you, named “${PLANNER_TITLE}”.`,
        409,
        "not_generated",
      );
    }
    const token = await googleAccessToken(user);

    // Check the file as it is in Drive right now, not as we last saw it.
    let oldGone = false;
    const check = await fetch(
      `https://www.googleapis.com/drive/v3/files/${oldId}?fields=name,trashed&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(15_000) },
    );
    if (check.status === 404) {
      oldGone = true; // Deleted in Drive: nothing to protect or trash, so a reset can simply recreate it.
    } else if (!check.ok) {
      throw new TemplateError(`Could not check your current planner (Google ${check.status}). Please try again.`, 502);
    } else {
      const file = await check.json() as { name?: string; trashed?: boolean };
      if (file.trashed) oldGone = true;
      else if (file.name !== PLANNER_TITLE) {
        throw new TemplateError(
          `Reset only works on a planner named “${PLANNER_TITLE}”. This one is now named “${file.name ?? "unknown"}”. Rename it back to “${PLANNER_TITLE}” to reset it.`,
          409,
          "renamed",
        );
      }
    }

    if (!(await acquirePlannerLock(user._id, { generatedSheetId: oldId }))) {
      throw new TemplateError("A reset is already in progress. Give it a moment.", 409, "busy");
    }
    locked = user._id;

    // Create the fresh planner first, so the old one is never removed before the new one exists.
    const newId = await createPlannerFromTemplate(token);
    createdNew = true;
    const url = canonicalSheetUrl(newId);
    await (await usersCollection()).updateOne(
      { _id: user._id },
      {
        $set: { sheetId: newId, sheetUrl: url, sheetTitle: PLANNER_TITLE, generatedSheetId: newId, updatedAt: new Date() },
        $unset: { plannerLockUntil: "" },
      },
    );
    // Move the old file to Drive's trash (recoverable for 30 days) so there is only one Excela planner.
    const oldTrashed = oldGone ? true : await trashDriveFile(token, oldId);
    return Response.json(
      { sheet: { url, title: PLANNER_TITLE, generated: true }, oldTrashed },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof GoogleAccessError) {
      return Response.json({ error: error.message, code: "reauth" }, { status: 401 });
    }
    if (error instanceof TemplateError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return Response.json(
      {
        error: createdNew
          ? `The reset could not be saved, so your current planner is unchanged. Check Google Drive for an extra “${PLANNER_TITLE}” file and delete it.`
          : "Could not reset your planner. Your current planner is unchanged. Please try again.",
      },
      { status: 502 },
    );
  } finally {
    if (locked) await releasePlannerLock(locked).catch(() => undefined);
  }
}
