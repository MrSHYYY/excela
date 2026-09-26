import type { ObjectId } from "mongodb";
import type { AgentMessage } from "@/lib/agent/agent";
import {
  telegramConversationsCollection,
  telegramProcessedUpdatesCollection,
} from "@/lib/mongodb";

const MAX_HISTORY_MESSAGES = 20;

/**
 * Retrieve recent conversation context for a Telegram chat (up to 20 messages).
 */
export async function getTelegramConversation(chatId: number): Promise<AgentMessage[]> {
  const collection = await telegramConversationsCollection();
  const doc = await collection.findOne({ _id: chatId });
  if (!doc || !Array.isArray(doc.messages)) return [];

  return doc.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
}

/**
 * Append a user message and assistant reply to the Telegram chat context,
 * atomically capping history to the latest 20 messages.
 */
export async function appendTelegramConversation(
  chatId: number,
  userId: ObjectId,
  userMessage: string,
  assistantReply: string,
): Promise<void> {
  const collection = await telegramConversationsCollection();
  const now = new Date();

  await collection.updateOne(
    { _id: chatId },
    {
      $set: { userId, updatedAt: now },
      $push: {
        messages: {
          $each: [
            { role: "user", content: userMessage, timestamp: now },
            { role: "assistant", content: assistantReply, timestamp: now },
          ],
          $slice: -MAX_HISTORY_MESSAGES,
        },
      },
    },
    { upsert: true },
  );
}

/**
 * Clear/reset the Telegram conversation history for this chat.
 */
export async function clearTelegramConversation(chatId: number): Promise<void> {
  const collection = await telegramConversationsCollection();
  await collection.deleteOne({ _id: chatId });
}

/**
 * Webhook idempotency check using Telegram's update_id.
 * Returns true if this update was already seen and processed.
 */
export async function isUpdateAlreadyProcessed(updateId: number): Promise<boolean> {
  try {
    const collection = await telegramProcessedUpdatesCollection();
    await collection.insertOne({
      _id: updateId,
      createdAt: new Date(),
    });
    return false;
  } catch (err: unknown) {
    // MongoDB duplicate key error (code 11000)
    if (err && typeof err === "object" && "code" in err && err.code === 11000) {
      return true;
    }
    // For other errors, let the update proceed
    return false;
  }
}
