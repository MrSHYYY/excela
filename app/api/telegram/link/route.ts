import { getSessionUser, isSameOrigin } from "@/lib/auth";
import { generateLinkingCode } from "@/lib/telegram/linking";

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

    const { code, botUrl, expiresAt } = await generateLinkingCode(current.user._id);

    return Response.json(
      {
        code,
        botUrl,
        expiresAt: expiresAt.toISOString(),
      },
      { headers },
    );
  } catch (error) {
    console.error("Failed to generate Telegram linking code:", error);
    return Response.json({ error: "Could not generate linking code. Please try again." }, { status: 500, headers });
  }
}
