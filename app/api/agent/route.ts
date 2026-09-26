import { getSessionUser, isPlannerRequest } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { normalizeOllamaKey } from "@/lib/ollama-key";
import { parseToday } from "@/ai/pipelines";
import { AgentError, runSmartAgent } from "@/lib/agent/agent";

// Phase 5 of the Smart roadmap: a dedicated agent endpoint, separate from /api/ai (single-shot
// extraction) and /api/sync (direct planner writes). The client sends only a message; the
// authenticated user, their planner, and their Ollama key are all resolved server-side.
export const maxDuration = 60;

export async function POST(request: Request) {
  if (!isPlannerRequest(request)) {
    return Response.json({ error: "Submit requests from Excela." }, { status: 403 });
  }

  let apiKey: string | null;
  let userDoc;
  try {
    const current = await getSessionUser(request);
    if (!current) {
      return Response.json({ error: "Sign in with Google to use Excela.", code: "auth" }, { status: 401 });
    }
    userDoc = current.user;
    apiKey = userDoc.ollamaApiKey ? decrypt(userDoc.ollamaApiKey) : null;
    apiKey = apiKey ? normalizeOllamaKey(apiKey) : null;
    if (!apiKey || !userDoc.sheetId) {
      return Response.json({ error: "Complete setup with a planner and your Ollama API key first.", code: "setup_required" }, { status: 409 });
    }
  } catch {
    return Response.json({ error: "Could not reach the database. Please try again." }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null || !("message" in body) ||
      typeof body.message !== "string" || !body.message.trim() || body.message.length > 4_000) {
    return Response.json({ error: "Provide message text, up to 4,000 characters." }, { status: 400 });
  }

  const serverToday = new Date().toISOString().slice(0, 10);
  const clientToday = parseToday("today" in body ? body.today : undefined);
  const today = clientToday && Math.abs(Date.parse(clientToday) - Date.parse(serverToday)) <= 2 * 86_400_000
    ? clientToday
    : serverToday;

  try {
    const { reply, log } = await runSmartAgent(apiKey, userDoc, today, body.message.trim());
    return Response.json({ reply, toolCalls: log.map(({ name, ok }) => ({ name, ok })) });
  } catch (error) {
    if (error instanceof AgentError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    return Response.json(
      { error: "Could not connect to Ollama or process its response. The request may have timed out. Please try again." },
      { status: 502 },
    );
  }
}
