import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const headers = { "Cache-Control": "no-store" };

  try {
    const current = await getSessionUser();
    if (!current) {
      return Response.json({ error: "Sign in with Google first.", code: "auth" }, { status: 401, headers });
    }

    const { user } = current;
    return Response.json(
      {
        connected: Boolean(user.telegram),
        username: user.telegram?.username,
        firstName: user.telegram?.firstName,
        linkedAt: user.telegram?.linkedAt ? new Date(user.telegram.linkedAt).toISOString() : undefined,
      },
      { headers },
    );
  } catch (error) {
    console.error("Failed to get Telegram status:", error);
    return Response.json({ error: "Could not retrieve Telegram status." }, { status: 500, headers });
  }
}
