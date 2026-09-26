/**
 * Telegram Bot API client.
 * Server-only module: never import in client components or expose token to browser.
 */

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  options?: { parseMode?: "Markdown" | "HTML" },
): Promise<{ ok: boolean; description?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error("TELEGRAM_BOT_TOKEN is not configured.");
    return { ok: false, description: "Bot token not configured" };
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(options?.parseMode ? { parse_mode: options.parseMode } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = await response.json();
    return { ok: Boolean(data.ok), description: data.description };
  } catch (error) {
    console.error("Failed to send Telegram message:", error instanceof Error ? error.message : error);
    return { ok: false, description: error instanceof Error ? error.message : "Network error" };
  }
}

const TELEGRAM_MAX_LENGTH = 4000;

/**
 * Split text into chunks respecting newlines and words when possible.
 */
export function splitTelegramMessage(text: string, maxLength = TELEGRAM_MAX_LENGTH): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    // Try finding a line break near the boundary
    let splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex < maxLength * 0.4) {
      // If no good newline, try finding a space
      splitIndex = remaining.lastIndexOf(" ", maxLength);
    }
    if (splitIndex <= 0) {
      // Hard split if no suitable whitespace
      splitIndex = maxLength;
    }

    const chunk = remaining.slice(0, splitIndex).trimEnd();
    if (chunk) chunks.push(chunk);
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}

export async function sendTelegramChatAction(
  chatId: number,
  action: "typing" = "typing",
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Non-critical, ignore typing indicator errors
  }
}

/**
 * Send a reply to Telegram, automatically splitting into safe chunks if needed.
 */
export async function sendTelegramReply(
  chatId: number,
  text: string,
  options?: { parseMode?: "Markdown" | "HTML" },
): Promise<boolean> {
  const chunks = splitTelegramMessage(text);
  let allOk = true;

  for (const chunk of chunks) {
    const res = await sendTelegramMessage(chatId, chunk, options);
    if (!res.ok) allOk = false;
  }

  return allOk;
}
