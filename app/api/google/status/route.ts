import { readGoogleSession, saveGoogleSession } from "@/ai/google-auth";

export async function GET() {
  const tokens = await readGoogleSession();
  const connected = Boolean(tokens && (tokens.refresh_token || (tokens.access_token && (tokens.expiry_date ?? 0) > Date.now())));
  // Extend an existing browser session on visits, without making a Google request.
  if (connected && tokens) await saveGoogleSession(tokens);
  return Response.json({ connected }, {
    headers: { "Cache-Control": "no-store" },
  });
}
