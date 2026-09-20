import { NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_SECONDS, cookieOptions, getSessionUser, renewSession } from "@/lib/auth";
import { sessionPayload } from "@/lib/session-payload";

export const runtime = "nodejs";

// Tells the page who is signed in, which sheet is saved, and whether Google access is still valid.
export async function GET() {
  try {
    const current = await getSessionUser();
    if (!current) return Response.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
    const { user, session } = current;
    const response = NextResponse.json(sessionPayload(user), { headers: { "Cache-Control": "no-store" } });
    const renewedToken = await renewSession(session);
    if (renewedToken) response.cookies.set(SESSION_COOKIE, renewedToken, cookieOptions(SESSION_SECONDS));
    return response;
  } catch {
    return Response.json(
      { error: "Could not reach the database. Check MONGODB_URI and your Atlas network access." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
