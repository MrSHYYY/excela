import { readGoogleSession } from "@/ai/google-auth";

export async function GET() {
  const tokens = await readGoogleSession();
  return Response.json({ connected: Boolean(tokens && (tokens.refresh_token || (tokens.access_token && (tokens.expiry_date ?? 0) > Date.now()))) }, {
    headers: { "Cache-Control": "no-store" },
  });
}
