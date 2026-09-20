import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { ObjectId } from "mongodb";
import type { SessionDoc, UserDoc } from "@/lib/models";
import { sessionsCollection } from "@/lib/mongodb";

export const SESSION_COOKIE = "excela_session";
export const OAUTH_COOKIE = "excela_oauth";
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
const DAY_MS = 24 * 60 * 60 * 1000;

export function cookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.GOOGLE_REDIRECT_URI?.startsWith("https://") ?? true,
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

// Only a hash of the session token is stored, so a database leak cannot be used to hijack sessions.
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates a server-side session and returns the token to place in the cookie. */
export async function createSession(userId: ObjectId, userAgent: string | null) {
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const sessions = await sessionsCollection();
  await sessions.insertOne({
    _id: hashToken(token),
    userId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + SESSION_SECONDS * 1000),
    ...(userAgent ? { userAgent: userAgent.slice(0, 200) } : {}),
  });
  return token;
}

export async function deleteSession(token: string | undefined) {
  if (!token) return;
  try {
    await (await sessionsCollection()).deleteOne({ _id: hashToken(token) });
  } catch {
    // Best effort: the TTL index removes the document when it expires.
  }
}

/** The signed-in user for this request, or null. Throws if the database is unreachable. */
export async function getSessionUser(): Promise<{ user: UserDoc; session: SessionDoc } | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  // One round trip: find the session and join its user, instead of two sequential queries.
  const [found] = await (await sessionsCollection())
    .aggregate<SessionDoc & { user: UserDoc }>([
      { $match: { _id: hashToken(token), expiresAt: { $gt: new Date() } } },
      { $lookup: { from: "users", localField: "userId", foreignField: "_id", as: "user" } },
      { $unwind: "$user" },
    ])
    .toArray();
  if (!found) return null;
  const { user, ...session } = found;
  return { user, session };
}

/** Sliding expiry: pushes the session out to a full lifetime if more than a day has passed. */
export async function renewSession(session: SessionDoc) {
  if (session.expiresAt.getTime() - Date.now() > SESSION_SECONDS * 1000 - DAY_MS) return null;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  await (await sessionsCollection()).updateOne(
    { _id: session._id },
    { $set: { expiresAt: new Date(Date.now() + SESSION_SECONDS * 1000) } },
  );
  return token;
}

/** Blocks other websites from submitting requests through a signed-in user's browser. */
export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
}
