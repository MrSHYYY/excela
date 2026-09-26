import type { UserDoc } from "@/lib/models";
import { buildSmartInstruction } from "@/ai/smart-instruction";
import { PlannerError } from "@/lib/planner-service";
import { agentTools, executeTool, MAX_TOOL_CALLS_PER_REQUEST, type ToolCallLog } from "@/lib/agent/executor";

export class AgentError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

type Message = { role: "system" | "user" | "assistant" | "tool"; content: string; tool_calls?: unknown; name?: string };
type ToolCall = { function: { name: string; arguments: unknown } };

function parseToolCalls(raw: unknown): ToolCall[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is ToolCall =>
    Boolean(item && typeof item === "object" && "function" in item &&
      item.function && typeof item.function === "object" && typeof (item.function as { name?: unknown }).name === "string"));
}

/**
 * The controlled Smart agent loop: send the conversation + registered tools to Ollama, execute any
 * tool the model asks for through the validated executor, feed the real result back, and repeat until
 * the model gives a final answer or the call-count budget runs out. The model can never run anything
 * beyond what lib/agent/executor.ts exposes, and every tool call is scoped to `user` server-side.
 */
export async function runSmartAgent(apiKey: string, user: UserDoc, today: string, userMessage: string): Promise<{ reply: string; log: ToolCallLog[] }> {
  const messages: Message[] = [
    { role: "system", content: buildSmartInstruction(today) },
    { role: "user", content: userMessage },
  ];
  const log: ToolCallLog[] = [];

  for (let iteration = 0; iteration < MAX_TOOL_CALLS_PER_REQUEST; iteration++) {
    const result = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gemma4:31b", stream: false, messages, tools: agentTools }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!result.ok) {
      const errors: Record<number, string> = {
        401: "Ollama returned an authentication error (401) for your saved key. Save the full secret from ollama.com/settings/keys in Setup.",
        402: "Ollama requires paid usage for this request (402). Check model access in your Ollama account.",
        403: "Ollama denied access. Check your API key and model access.",
        404: "Ollama could not find gemma4:31b.",
        429: "Ollama quota or rate limit reached. Please try again later.",
      };
      throw new AgentError(errors[result.status] ?? `Ollama request failed (${result.status}). Please try again later.`, result.status === 429 ? 429 : 502);
    }
    const data = await result.json();
    const assistantMessage = data?.message;
    if (!assistantMessage || typeof assistantMessage !== "object") {
      throw new AgentError("Ollama returned an unexpected response. Please try again.");
    }
    const toolCalls = parseToolCalls(assistantMessage.tool_calls);

    if (!toolCalls.length) {
      const text = typeof assistantMessage.content === "string" ? assistantMessage.content.trim() : "";
      if (!text) throw new AgentError("Ollama returned no text. Please try again.");
      return { reply: text, log };
    }

    messages.push({ role: "assistant", content: typeof assistantMessage.content === "string" ? assistantMessage.content : "", tool_calls: assistantMessage.tool_calls });

    // Every requested tool call is validated and executed here — this is the only place planner
    // mutations happen, and it is never influenced by anything the model claims about the user.
    for (const call of toolCalls) {
      const name = call.function.name;
      let args = call.function.arguments;
      if (typeof args === "string") {
        try { args = JSON.parse(args); } catch { args = {}; }
      }
      let toolResult: unknown;
      let ok = true;
      try {
        toolResult = await executeTool(name, args, user, today);
      } catch (error) {
        ok = false;
        toolResult = { error: error instanceof PlannerError ? error.message : "That action could not be completed. Please try again." };
      }
      log.push({ name, args: (args && typeof args === "object" ? args as Record<string, unknown> : {}), ok, result: toolResult });
      messages.push({ role: "tool", name, content: JSON.stringify(toolResult) });
    }
  }

  throw new AgentError("This request needed too many steps to complete safely. Try breaking it into smaller requests.");
}
