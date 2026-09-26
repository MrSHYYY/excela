import type { TelegramUpdate } from "@/lib/telegram/types";
import { sendTelegramMessage } from "@/lib/telegram/client";
import { findUserByTelegramId, verifyAndConsumeLinkingCode } from "@/lib/telegram/linking";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    let update: TelegramUpdate;
    try {
      update = (await request.json()) as TelegramUpdate;
    } catch {
      return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    const message = update.message || update.edited_message;
    if (!message || !message.text || !message.from) {
      return Response.json({ ok: true });
    }

    const chatId = message.chat.id;
    const sender = message.from;
    const text = message.text.trim();

    if (text.startsWith("/start")) {
      const parts = text.split(/\s+/);
      const code = parts[1]?.trim();

      if (code) {
        const result = await verifyAndConsumeLinkingCode(code, sender, chatId);

        if (result.success) {
          await sendTelegramMessage(
            chatId,
            "✅ Your Telegram account is now connected to Excela!\n\nSmart planner messaging will be available here soon.",
          );
        } else if (result.reason === "already_linked") {
          await sendTelegramMessage(
            chatId,
            "⚠️ This Telegram account is already connected to an Excela account.\n\nTo link a different account, disconnect it from your Excela web settings first.",
          );
        } else {
          await sendTelegramMessage(
            chatId,
            "⚠️ This linking code is invalid or has expired.\n\nPlease generate a fresh linking code from your Excela web settings.",
          );
        }
      } else {
        const existing = await findUserByTelegramId(sender.id);
        if (existing) {
          await sendTelegramMessage(
            chatId,
            "You're connected to Excela. Smart planner messaging will be available here soon.",
          );
        } else {
          await sendTelegramMessage(
            chatId,
            "Welcome to Excela!\n\nTo connect your Telegram account to your Excela planner, generate a linking code from the Telegram settings page in the Excela web app.",
          );
        }
      }

      return Response.json({ ok: true });
    }

    // Default handling for other messages in this phase (infrastructure only, no Smart AI yet)
    const existing = await findUserByTelegramId(sender.id);
    if (existing) {
      await sendTelegramMessage(
        chatId,
        "You're connected to Excela. Smart planner messaging will be available here soon.",
      );
    } else {
      await sendTelegramMessage(
        chatId,
        "Your Telegram account is not connected to Excela.\n\nPlease connect it from the Excela web settings first.",
      );
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    // Always return 200 to prevent Telegram from continually retrying on unhandled exceptions
    return Response.json({ ok: true });
  }
}
