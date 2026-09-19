import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { googleClient, saveGoogleSession, sheetsScope } from "@/ai/google-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const expected = jar.get("excela_google_state")?.value;
  jar.delete("excela_google_state");
  const home = new URL("/", process.env.GOOGLE_REDIRECT_URI || request.url);
  function finish(status: string) {
    home.searchParams.set("google", status);
    const response = NextResponse.redirect(home);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  if (!expected || url.searchParams.get("state") !== expected) return finish("invalid_state");
  if (url.searchParams.has("error")) return finish("denied");
  const code = url.searchParams.get("code");
  if (!code) return finish("failed");
  try {
    const { tokens } = await googleClient().getToken(code);
    if (!tokens.access_token || !tokens.scope?.split(" ").includes(sheetsScope)) return finish("denied");
    await saveGoogleSession(tokens);
    return finish("connected");
  } catch { return finish("failed"); }
}
