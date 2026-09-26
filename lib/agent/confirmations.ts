// Server-side confirmation system for destructive Smart agent operations.
// Pending confirmations are stored in MongoDB (collection `pending_confirmations`) so they survive
// serverless cold starts. Each confirmation is bound to a specific user, operation, cell, and sheet,
// has a short TTL, is single-use, and cannot be manufactured or replayed by the model.
import { randomBytes } from "crypto";
import { getDb } from "@/lib/mongodb";
import type { ObjectId } from "mongodb";

export type PendingConfirmation = {
  /** Random token the model must echo back — not a proof of user consent, but a server-generated
   *  reference that ties a specific pending operation to the user's follow-up "yes". */
  _id: string;
  userId: ObjectId;
  operation: "delete";
  /** The exact cell and sheet the operation would act on, so we can revalidate before executing. */
  cell: string;
  sheetId: number;
  /** Human-readable description shown to the user when asking for confirmation. */
  description: string;
  createdAt: Date;
  /** Short TTL; stale confirmations are worthless. */
  expiresAt: Date;
};

function confirmations() {
  return getDb().then((db) => db.collection<PendingConfirmation>("pending_confirmations"));
}

/** Create a pending confirmation and return its token. Expires in 5 minutes. */
export async function createConfirmation(
  userId: ObjectId,
  operation: PendingConfirmation["operation"],
  cell: string,
  sheetId: number,
  description: string,
): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  const now = new Date();
  const col = await confirmations();
  await col.insertOne({
    _id: token,
    userId,
    operation,
    cell,
    sheetId,
    description,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 5 * 60_000),
  });
  return token;
}

/**
 * Consume a pending confirmation: find and delete it atomically.
 * Returns the confirmation if valid (correct user, not expired), or null.
 * Single-use: once consumed it cannot be used again.
 */
export async function consumeConfirmation(
  token: string,
  userId: ObjectId,
): Promise<PendingConfirmation | null> {
  if (!token) return null;
  const col = await confirmations();
  const result = await col.findOneAndDelete({
    _id: token,
    userId,
    expiresAt: { $gt: new Date() },
  });
  return result ?? null;
}

/**
 * Find any pending (unconsumed, unexpired) confirmations for this user.
 * Used when the user says "yes" / "confirm" / "do it" without repeating the full request.
 */
export async function findPendingConfirmation(
  userId: ObjectId,
): Promise<PendingConfirmation | null> {
  const col = await confirmations();
  return col.findOne({
    userId,
    expiresAt: { $gt: new Date() },
  }, { sort: { createdAt: -1 } });
}
