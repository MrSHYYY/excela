import { randomBytes } from "node:crypto";
import { CodeChallengeMethod } from "google-auth-library";
import { NextResponse } from "next/server";
import { googleClient, loginScopes } from "@/ai/google-auth";
import { OAUTH_COOKIE, cookieOptions } from "@/lib/auth";

export const runtime = "nodejs";

// Starts "Continue with Google". Google is the only way to sign in to Excela.
// `?consent=1` forces the consent screen so Google issues a refresh token.
export async function GET(request: Request) {
  try {
    const client = googleClient();
    const consent = new URL(request.url).searchParams.get("consent") === "1";
    const state = randomBytes(32).toString("hex");
    const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      scope: loginScopes,
      state,
      prompt: consent ? "consent select_account" : "select_account",
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    });
    const response = NextResponse.redirect(authUrl);
    // State and PKCE verifier live in a short-lived HttpOnly cookie until Google redirects back.
    response.cookies.set(
      OAUTH_COOKIE,
      Buffer.from(JSON.stringify({ state, codeVerifier, consent })).toString("base64url"),
      cookieOptions(600),
    );
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return Response.json({ error: "Set Google OAuth credentials, redirect URI, and session secret in .env." }, { status: 503 });
  }
}
