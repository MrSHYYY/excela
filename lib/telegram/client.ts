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
