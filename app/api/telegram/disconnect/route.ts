import { getSessionUser, isSameOrigin } from "@/lib/auth";
import { disconnectTelegram } from "@/lib/telegram/linking";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Unauthorized origin." }, { status: 403, headers });
  }

  try {
    const current = await getSessionUser();
    if (!current) {
      return Response.json({ error: "Sign in with Google first.", code: "auth" }, { status: 401, headers });
    }

    await disconnectTelegram(current.user._id);

    return Response.json({ ok: true, connected: false }, { headers });
  } catch (error) {
    console.error("Failed to disconnect Telegram:", error);
    return Response.json({ error: "Could not disconnect Telegram. Please try again." }, { status: 500, headers });
  }
}
