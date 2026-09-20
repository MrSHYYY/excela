import { getSessionUser, isSameOrigin } from "@/lib/auth";
import { encrypt } from "@/lib/crypto";
import { usersCollection } from "@/lib/mongodb";
import { normalizeOllamaKey } from "@/lib/ollama-key";

export const runtime = "nodejs";

export async function PUT(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!isSameOrigin(request)) return Response.json({ error: "Save your key from Excela." }, { status: 403, headers });
  try {
    const current = await getSessionUser();
    if (!current) return Response.json({ error: "Sign in with Google first.", code: "auth" }, { status: 401, headers });
    let body: unknown;
    try { body = await request.json(); }
    catch { return Response.json({ error: "Invalid JSON body." }, { status: 400, headers }); }
    const key = body && typeof body === "object" && "apiKey" in body && typeof body.apiKey === "string" ? normalizeOllamaKey(body.apiKey) : "";
    if (!key || key.length > 4096 || /\s|[^\x21-\x7E]/.test(key)) {
      return Response.json({ error: "Paste your Ollama API key without spaces." }, { status: 400, headers });
    }
    const result = await (await usersCollection()).updateOne(
      { _id: current.user._id },
      { $set: { ollamaApiKey: encrypt(key), updatedAt: new Date() } },
    );
    if (!result.matchedCount) return Response.json({ error: "Sign in again.", code: "auth" }, { status: 401, headers });
    // Saving never spends credits or echoes the secret. Provider validation happens on use.
    return Response.json({ hasApiKey: true }, { headers });
  } catch {
    return Response.json({ error: "Could not save your API key. Please try again." }, { status: 503, headers });
  }
}
