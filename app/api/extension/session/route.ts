import { getSessionUser } from "@/lib/auth";
import { sessionPayload } from "@/lib/session-payload";

export const runtime = "nodejs";

// Firefox host permissions allow background requests without relaxing website CORS.
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!request.headers.has("authorization")) {
    return Response.json({ authenticated: false }, { status: 401, headers });
  }
  try {
    const current = await getSessionUser(request);
    return Response.json(current ? sessionPayload(current.user) : { authenticated: false }, { headers });
  } catch {
    return Response.json({ error: "Could not check your Excela account. Please try again." }, { status: 503, headers });
  }
}
