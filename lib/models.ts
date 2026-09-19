import type { ObjectId } from "mongodb";

/** Collection `users` in the Excela database. One document per Google account. */
export type UserDoc = {
  _id: ObjectId;
  /** Google's stable account id (the `sub` claim). Unique. */
  googleId: string;
  email: string;
  name: string;
  picture: string | null;
  /** Google refresh token, AES-256-GCM encrypted with GOOGLE_SESSION_SECRET. */
  refreshToken?: string;
  /** The user's monthly planner. Set after sign-in. */
  sheetUrl?: string;
  sheetId?: string;
  sheetTitle?: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date;
};

/** Collection `sessions`. Expired documents are removed by a MongoDB TTL index. */
export type SessionDoc = {
  /** SHA-256 of the random session token kept in the browser cookie. */
  _id: string;
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
  userAgent?: string;
};
