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
} from "@/lib/planner-template";
import { canonicalSheetUrl } from "@/lib/sheet";

export const runtime = "nodejs";
export const maxDuration = 60;

// Creates the user's Excela planner. This works only once per account: creating more would leave
// duplicate planners in the user's Drive. After that, the user chooses a planner from Drive or resets this one.
export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "The template must be generated from the Excela page." }, { status: 403 });
  }
  let locked: ObjectId | undefined;
  let createdUrl: string | undefined;
  try {
    const current = await getSessionUser();
    if (!current) throw new TemplateError("Sign in with Google first.", 401, "auth");
    const { user } = current;
    if (user.generatedSheetId) {
      throw new TemplateError(
        `You already have an Excela planner. Choose the file named “${PLANNER_TITLE}” from Google Drive, or reset it, instead of creating another.`,
        409,
        "already_generated",
      );
    }
    const token = await googleAccessToken(user);
    if (!(await acquirePlannerLock(user._id, { generatedSheetId: { $exists: false } }))) {
      throw new TemplateError("Your planner is already being created. Give it a moment.", 409, "busy");
    }
    locked = user._id;

    const sheetId = await createPlannerFromTemplate(token);
    createdUrl = canonicalSheetUrl(sheetId);
    await (await usersCollection()).updateOne(
      { _id: user._id },
      {
        $set: { sheetId, sheetUrl: createdUrl, sheetTitle: PLANNER_TITLE, generatedSheetId: sheetId, updatedAt: new Date() },
        $unset: { plannerLockUntil: "" },
      },
    );
    return Response.json(
      { sheet: { url: createdUrl, title: PLANNER_TITLE, generated: true } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (createdUrl) {
      return Response.json({ error: `Your planner was created in Drive, but its link couldn't be saved. Choose “${PLANNER_TITLE}” from Google Drive to connect it.` }, { status: 503 });
    }
    if (error instanceof GoogleAccessError) {
      return Response.json({ error: error.message, code: "reauth" }, { status: 401 });
    }
    if (error instanceof TemplateError) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return Response.json({ error: `Could not finish generating your planner. Check Drive for “${PLANNER_TITLE}” before trying again; if it exists, choose it from Google Drive.` }, { status: 502 });
  } finally {
    if (locked) await releasePlannerLock(locked).catch(() => undefined);
  }
}
