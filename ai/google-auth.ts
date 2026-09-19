import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { OAuth2Client, type Credentials } from "google-auth-library";
import { cookies } from "next/headers";

const sessionCookie = "excela_google";
export const sheetsScope = "https://www.googleapis.com/auth/spreadsheets";

export function googleClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error("Google OAuth configuration is missing.");
  }
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.GOOGLE_REDIRECT_URI?.startsWith("https://") ?? true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

function sessionKey() {
  const secret = process.env.GOOGLE_SESSION_SECRET;
  if (!secret) throw new Error("GOOGLE_SESSION_SECRET is missing.");
  return createHash("sha256").update(secret).digest();
}

export async function saveGoogleSession(tokens: Credentials) {
  const maxAge = 180 * 24 * 60 * 60;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sessionKey(), iv);
  // Omit ID tokens and unrelated fields to stay within browser cookie limits.
  const payload = JSON.stringify({
    tokens: { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expiry_date: tokens.expiry_date },
    expires: Date.now() + maxAge * 1000,
  });
  const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
  const value = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
  if (value.length > 3800) throw new Error("Google session is too large.");
  (await cookies()).set(sessionCookie, value, cookieOptions(maxAge));
}

export async function readGoogleSession(): Promise<Credentials | null> {
  const value = (await cookies()).get(sessionCookie)?.value;
  if (!value) return null;
  try {
    const data = Buffer.from(value, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", sessionKey(), data.subarray(0, 12));
    decipher.setAuthTag(data.subarray(12, 28));
    const payload = JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString("utf8"));
    if (typeof payload.expires !== "number" || payload.expires < Date.now()) return null;
    return payload.tokens;
  } catch { return null; }
}

export async function googleAccessToken() {
  const tokens = await readGoogleSession();
  if (!tokens) throw new Error("Connect Google before syncing.");
  const client = googleClient();
  client.setCredentials(tokens);
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("Google sign-in expired.");
  await saveGoogleSession({
    ...tokens,
    ...client.credentials,
    refresh_token: client.credentials.refresh_token ?? tokens.refresh_token,
  });
  return token;
}
