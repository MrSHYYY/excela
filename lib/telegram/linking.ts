import { randomBytes } from "node:crypto";
import type { ObjectId } from "mongodb";
import {
  telegramConversationsCollection,
  telegramTokensCollection,
  usersCollection,
} from "@/lib/mongodb";
import type { UserDoc } from "@/lib/models";

const TOKEN_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

export function getBotBaseUrl(): string {
  const raw = process.env.TELEGRAM_BOT_LINK || "t.me/ExcelaPlannerBot";
  const clean = raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `https://${clean}`;
}

/**
 * Generate a short-lived, one-time linking code for an Excela user.
 */
export async function generateLinkingCode(userId: ObjectId): Promise<{
  code: string;
  botUrl: string;
  expiresAt: Date;
}> {
  const tokens = await telegramTokensCollection();

  // Clear previous pending tokens for this user
  await tokens.deleteMany({ userId });

  // Generate 8-character uppercase hex code
  const code = randomBytes(4).toString("hex").toUpperCase();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + TOKEN_EXPIRY_MS);

  await tokens.insertOne({
    _id: code,
    userId,
    createdAt: now,
    expiresAt,
  });

  const botUrl = `${getBotBaseUrl()}?start=${code}`;

  return { code, botUrl, expiresAt };
}

export type ConsumeResult =
  | { success: true; userId: ObjectId }
  | { success: false; reason: "already_linked" | "invalid_or_expired" };

/**
 * Atomically verify and consume a linking code, associating the Telegram account with the Excela user.
 */
export async function verifyAndConsumeLinkingCode(
  rawCode: string,
  telegramUser: { id: number; username?: string; first_name?: string },
  chatId: number,
): Promise<ConsumeResult> {
  const code = rawCode.trim().toUpperCase();
  const users = await usersCollection();
  const tokens = await telegramTokensCollection();

  // Enforce 1:1 mapping: check if this Telegram account is already linked to ANY Excela user
  const existingOwner = await users.findOne({ "telegram.id": telegramUser.id });
  if (existingOwner) {
    return { success: false, reason: "already_linked" };
  }

  // Atomically find and delete the token
  const tokenDoc = await tokens.findOneAndDelete({
    _id: code,
    expiresAt: { $gt: new Date() },
  });

  if (!tokenDoc) {
    return { success: false, reason: "invalid_or_expired" };
  }

  // Associate Telegram info with the user
  const updateResult = await users.updateOne(
    { _id: tokenDoc.userId },
    {
      $set: {
        telegram: {
          id: telegramUser.id,
          chatId,
          username: telegramUser.username,
          firstName: telegramUser.first_name,
          linkedAt: new Date(),
        },
        updatedAt: new Date(),
      },
    },
  );

  if (!updateResult.matchedCount) {
    return { success: false, reason: "invalid_or_expired" };
  }

  return { success: true, userId: tokenDoc.userId };
}

/**
 * Unlink Telegram from an Excela user account.
 */
export async function disconnectTelegram(userId: ObjectId): Promise<boolean> {
  const users = await usersCollection();
  const tokens = await telegramTokensCollection();
  const conversations = await telegramConversationsCollection();

  await Promise.all([
    users.updateOne(
      { _id: userId },
      { $unset: { telegram: "" }, $set: { updatedAt: new Date() } },
    ),
    tokens.deleteMany({ userId }),
    conversations.deleteMany({ userId }),
  ]);

  return true;
}

/**
 * Find an Excela user linked to a specific Telegram ID.
 */
export async function findUserByTelegramId(telegramId: number): Promise<UserDoc | null> {
  const users = await usersCollection();
  return users.findOne({ "telegram.id": telegramId });
}
