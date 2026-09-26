import { NextResponse } from "next/server";
import { googleClient } from "@/ai/google-auth";
import { SESSION_COOKIE, getSessionUser, isSameOrigin } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { sessionsCollection, telegramTokensCollection, usersCollection } from "@/lib/mongodb";

export const runtime = "nodejs";

// Permanently deletes the signed-in user's account and everything Excela stores about them.
export async function DELETE(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Account deletion must be requested from the Excela page." }, { status: 403 });
  }
  try {
    const current = await getSessionUser();
    if (!current) return Response.json({ error: "Sign in with Google first.", code: "auth" }, { status: 401 });
    const { user } = current;
    const refreshToken = user.refreshToken ? decrypt(user.refreshToken) : null;

    // Every collection that holds this user's data: sessions, pending linking tokens, then the user record itself
    // (profile, saved planner link, encrypted Google token, telegram connection).
    await (await sessionsCollection()).deleteMany({ userId: user._id });
    await (await telegramTokensCollection()).deleteMany({ userId: user._id });
    await (await usersCollection()).deleteOne({ _id: user._id });

    // Best effort: also cancel Excela's access on Google's side. The token is no longer stored anywhere.
    if (refreshToken) {
      try { await googleClient().revokeToken(refreshToken); }
      catch { /* Already revoked or expired; nothing else to clean up. */ }
    }

    const response = NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.delete(SESSION_COOKIE);
    return response;
  } catch {
    return Response.json(
      { error: "Could not delete your account right now. Please try again." },
      { status: 503 },
    );
  }
}
