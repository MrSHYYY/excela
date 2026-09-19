import { OAuth2Client } from "google-auth-library";
import { decrypt } from "@/lib/crypto";
import type { UserDoc } from "@/lib/models";
import { usersCollection } from "@/lib/mongodb";

export const sheetsScope = "https://www.googleapis.com/auth/spreadsheets";
// openid/email/profile identify the user; the Sheets scope lets Excela write to their planner.
export const loginScopes = ["openid", "email", "profile", sheetsScope];

export function googleClient() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    throw new Error("Google OAuth configuration is missing.");
  }
  return new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
}

/** Thrown when the user's Google access is missing, revoked, or expired. They must sign in again. */
export class GoogleAccessError extends Error {}

/** Exchanges the user's stored refresh token for a fresh access token. */
export async function googleAccessToken(user: UserDoc): Promise<string> {
  const refreshToken = user.refreshToken ? decrypt(user.refreshToken) : null;
  if (!refreshToken) throw new GoogleAccessError("Google access is missing. Sign in with Google again.");
  const client = googleClient();
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const { token } = await client.getAccessToken();
    if (token) return token;
  } catch (error) {
    // Revoked or expired (e.g. 7-day limit for apps in Testing): forget it so the UI asks for consent again.
    if (String(error instanceof Error ? error.message : error).includes("invalid_grant")) {
      await (await usersCollection()).updateOne({ _id: user._id }, { $unset: { refreshToken: "" } });
    }
  }
  throw new GoogleAccessError("Google access expired. Sign in with Google again.");
}
