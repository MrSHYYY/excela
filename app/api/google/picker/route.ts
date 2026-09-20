import { GoogleAccessError, googleAccessToken } from "@/ai/google-auth";
import { getSessionUser, isSameOrigin } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOrigin(request)) return Response.json({ error: "Open Picker from Excela." }, { status: 403, headers });
  try {
    const current = await getSessionUser();
    if (!current) return Response.json({ error: "Sign in with Google first.", code: "auth" }, { status: 401, headers });
    const apiKey = process.env.GOOGLE_PICKER_API_KEY;
    const appId = process.env.GOOGLE_PROJECT_NUMBER || process.env.GOOGLE_CLIENT_ID?.split("-")[0];
    if (!apiKey || !appId || !/^\d+$/.test(appId)) {
      return Response.json({ error: "Configure GOOGLE_PICKER_API_KEY and GOOGLE_PROJECT_NUMBER for Google Picker." }, { status: 503, headers });
    }
    // Picker needs a short-lived token in browser memory. Refresh tokens, OAuth
    // client secrets and AI keys never leave the server.
    return Response.json({ accessToken: await googleAccessToken(current.user), apiKey, appId }, { headers });
  } catch (error) {
    if (error instanceof GoogleAccessError) return Response.json({ error: error.message, code: "reauth" }, { status: 401, headers });
    return Response.json({ error: "Could not open Google Drive. Please try again." }, { status: 503, headers });
  }
}
