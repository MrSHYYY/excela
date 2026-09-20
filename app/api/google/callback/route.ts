import type { Credentials, TokenPayload } from "google-auth-library";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { googleClient, driveFileScope } from "@/ai/google-auth";
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  SESSION_SECONDS,
  cookieOptions,
  createSession,
  deleteSession,
} from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { ensureIndexes, usersCollection } from "@/lib/mongodb";

export const runtime = "nodejs";

type Flow = { state: string; codeVerifier: string; consent: boolean; popup: boolean };

// Shown in the sign-in popup. It tells the main tab how sign-in went (same-origin BroadcastChannel,
// which keeps working even though Google's pages sit between the two windows) and then closes itself.
function popupPage(status: string) {
  const message = status === "connected"
    ? "You're signed in. You can close this window."
    : "Sign-in did not finish. You can close this window and try again.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="color-scheme" content="light dark"><title>Excela</title></head>` +
    `<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:1rem;text-align:center">` +
    `<p>${message}</p><script>` +
    `try{var c=new BroadcastChannel("excela-google");c.postMessage({status:${JSON.stringify(status)}});c.close();}catch(e){}` +
    `setTimeout(function(){window.close();},300);` +
    `</script></body></html>`;
}

function readFlow(raw: string | undefined): Flow | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof value.state === "string" && typeof value.codeVerifier === "string") {
      return { state: value.state, codeVerifier: value.codeVerifier, consent: value.consent === true, popup: value.popup === true };
    }
  } catch {
    // Fall through: treated as an invalid flow.
  }
  return null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const flow = readFlow(jar.get(OAUTH_COOKIE)?.value);
  const previousSession = jar.get(SESSION_COOKIE)?.value;
  const home = new URL("/", process.env.GOOGLE_REDIRECT_URI || request.url);

  function redirect(to: URL) {
    const response = NextResponse.redirect(to);
    response.cookies.delete(OAUTH_COOKIE);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  function finish(status: string) {
    if (flow?.popup) {
      const response = new NextResponse(popupPage(status), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
        },
      });
      response.cookies.delete(OAUTH_COOKIE);
      return response;
    }
    const target = new URL(home);
    target.searchParams.set("google", status);
    return redirect(target);
  }

  if (!flow || url.searchParams.get("state") !== flow.state) return finish("invalid_state");
  if (url.searchParams.has("error")) return finish("denied");
  const code = url.searchParams.get("code");
  if (!code) return finish("failed");

  // 1. Exchange the code (with the PKCE verifier) and verify who signed in.
  let tokens: Credentials;
  let profile: TokenPayload | undefined;
  try {
    const client = googleClient();
    ({ tokens } = await client.getToken({ code, codeVerifier: flow.codeVerifier }));
    if (!tokens.id_token || !tokens.scope?.split(" ").includes(driveFileScope)) return finish("denied");
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    profile = ticket.getPayload();
  } catch (error) {
    console.error("Google sign-in failed:", error instanceof Error ? error.message : error);
    return finish("failed");
  }
  if (!profile?.sub || !profile.email || !profile.email_verified) return finish("unverified");
  const { sub, email, name, picture } = profile;

  // 2. Create or update the user, then start a session.
  try {
    await ensureIndexes();
    const users = await usersCollection();
    const existing = await users.findOne({ googleId: sub });
    const refreshToken = tokens.refresh_token ? encrypt(tokens.refresh_token)
      : existing?.googleScopes?.includes(driveFileScope) ? existing.refreshToken : undefined;
    if (!refreshToken) {
      // Google only returns a refresh token on consent. Ask once more with the consent screen.
      if (flow.consent) return finish("failed");
      return redirect(new URL(`/api/google/connect?consent=1${flow.popup ? "&popup=1" : ""}`, home));
    }
    const now = new Date();
    // Return the updated user in this write instead of making another database read.
    const user = await users.findOneAndUpdate(
      { googleId: sub },
      {
        $set: {
          email: email.toLowerCase(),
          name: name || email,
          picture: picture ?? null,
          refreshToken,
          googleScopes: tokens.scope?.split(" ") ?? [],
          updatedAt: now,
          lastLoginAt: now,
        },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true, returnDocument: "after" },
    );
    if (!user) return finish("database");
    await deleteSession(previousSession);
    const token = await createSession(user._id, request.headers.get("user-agent"));
    const response = finish("connected");
    response.cookies.set(SESSION_COOKIE, token, cookieOptions(SESSION_SECONDS));
    return response;
  } catch (error) {
    console.error("Saving the signed-in user failed:", error instanceof Error ? error.message : error);
    return finish("database");
  }
}
