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
  googleScopes?: string[];
  /** Personal Ollama key, encrypted with GOOGLE_SESSION_SECRET. Never sent back to the browser. */
  ollamaApiKey?: string;
  /** The user's monthly planner. Set after sign-in. */
  sheetUrl?: string;
  sheetId?: string;
  sheetTitle?: string;
  /** Id of the planner Excela created for this user (named "Excela"). Set once; it blocks creating a second one and marks the only planner that Reset may replace. */
  generatedSheetId?: string;
  /** Short lock while a planner is being created or reset, so two requests can't both create one. */
  plannerLockUntil?: Date;
  /** Telegram account connection information. Present when linked. */
  telegram?: UserTelegramConnection;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date;
};

export type UserTelegramConnection = {
  /** Telegram user id */
  id: number;
  /** Telegram chat id (usually identical to id for private chats) */
  chatId: number;
  username?: string;
  firstName?: string;
  linkedAt: Date;
};

/** Collection `telegram_linking_tokens`. Ephemeral one-time linking codes. */
export type TelegramLinkingTokenDoc = {
  /** The linking code (e.g. 8-char alphanumeric). */
  _id: string;
  userId: ObjectId;
  createdAt: Date;
  expiresAt: Date;
};

/** Collection `telegram_conversations`. Holds bounded multi-turn conversation context. */
export type TelegramConversationDoc = {
  /** The Telegram chatId */
  _id: number;
  userId: ObjectId;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    timestamp: Date;
  }>;
  updatedAt: Date;
};

/** Collection `telegram_processed_updates`. For webhook idempotency. */
export type TelegramProcessedUpdateDoc = {
  /** The Telegram update_id */
  _id: number;
  createdAt: Date;
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
