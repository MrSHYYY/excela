import { buildInstruction, isPipelineId, parseToday } from "@/ai/pipelines";
import { getSessionUser, isSameOrigin } from "@/lib/auth";
import { decrypt } from "@/lib/crypto";
import { normalizeOllamaKey } from "@/lib/ollama-key";
import { IMAGE_TYPES, MAX_IMAGE_BYTES, type ImageInput } from "@/lib/image-input";

// The AI call can take a while (Ollama has a 60s timeout); this lets Vercel run the function that long.
export const maxDuration = 60;

const fields = ["course", "title", "date"] as const;
type PlannerEvent = Record<(typeof fields)[number], string>;

function isPlannerEvent(value: unknown): value is PlannerEvent {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    fields.every((field) => typeof (value as Record<string, unknown>)[field] === "string");
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ error: "Submit requests from Excela." }, { status: 403 });
  }
  let apiKey: string | null;
  // Only the signed-in user's encrypted key can authorize a model request.
  try {
    const current = await getSessionUser();
    if (!current) {
      return Response.json({ error: "Sign in with Google to use Excela.", code: "auth" }, { status: 401 });
    }
    apiKey = current.user.ollamaApiKey ? decrypt(current.user.ollamaApiKey) : null;
    // Also support keys saved before paste normalization was introduced.
    apiKey = apiKey ? normalizeOllamaKey(apiKey) : null;
    if (!apiKey || !current.user.sheetId) {
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

  if (
    typeof body !== "object" ||
    body === null ||
    !("message" in body) ||
    typeof body.message !== "string" ||
    body.message.length > 20_000
  ) {
    return Response.json(
      { error: "Provide message text of at most 20,000 characters." },
      { status: 400 },
    );
  }

  let image: ImageInput | undefined;
  if ("image" in body && body.image != null) {
    const candidate = body.image;
    if (typeof candidate !== "object" || !("mimeType" in candidate) || !("data" in candidate) ||
        typeof candidate.mimeType !== "string" || !IMAGE_TYPES.includes(candidate.mimeType) ||
        typeof candidate.data !== "string" || !candidate.data.length ||
        candidate.data.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3) ||
        candidate.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(candidate.data)) {
      return Response.json({ error: "Attach one PNG, JPEG or WebP image, up to 3 MB." }, { status: 400 });
    }
    const bytes = Buffer.from(candidate.data, "base64");
    const png = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const webp = bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    const matchesType = candidate.mimeType === "image/png" ? png : candidate.mimeType === "image/jpeg" ? jpeg : webp;
    if (bytes.length > MAX_IMAGE_BYTES || !matchesType) {
      return Response.json({ error: "The attachment is not a supported image. Use PNG, JPEG or WebP up to 3 MB." }, { status: 400 });
    }
    image = { mimeType: candidate.mimeType, data: candidate.data };
  }
  if (!body.message.trim() && !image) {
    return Response.json({ error: "Enter a message or attach an image." }, { status: 400 });
  }

  // Which instruction set reads the message: "academic" (default) or "general".
  const pipeline = "pipeline" in body ? body.pipeline : "academic";
  if (!isPipelineId(pipeline)) {
    return Response.json({ error: "Choose the academic or general pipeline." }, { status: 400 });
  }

  // The browser's local date lets the model resolve "today", "tomorrow", and so on. If it is missing, invalid,
  // or more than two days away from the server's clock (a wrong device clock), use the server's date instead.
  const serverToday = new Date().toISOString().slice(0, 10);
  const clientToday = parseToday("today" in body ? body.today : undefined);
  const today = clientToday && Math.abs(Date.parse(clientToday) - Date.parse(serverToday)) <= 2 * 86_400_000
    ? clientToday
    : serverToday;

  try {
    const schema = {
      type: "object",
      properties: {
        accepted: { type: "boolean" },
        events: {
          type: "array",
          items: {
            type: "object",
            properties: Object.fromEntries(fields.map((field) => [field, { type: "string" }])),
            required: [...fields],
            additionalProperties: false,
          },
        },
      },
      required: ["accepted", "events"],
      additionalProperties: false,
    };

    const result = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        // Direct cloud API uses the model name without the CLI's -cloud suffix.
        model: "gemma4:31b",
        stream: false,
        messages: [
          {
            role: "system",
            content: `${buildInstruction(pipeline, today)}\nReturn only a JSON object, without Markdown or commentary, matching this schema: ${JSON.stringify(schema)}`,
          },
          { role: "user", content: body.message.trim() || "Extract dated events from the attached image.", ...(image ? { images: [image.data] } : {}) },
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!result.ok) {
      const errors: Record<number, string> = {
        401: "Ollama returned an authentication error (401) for your saved key. In Setup, save the full secret from ollama.com/settings/keys, not its name or masked preview. If the full key still fails, it needs an authentication check with Ollama.",
        402: "Ollama requires paid usage for this request (402). Unused free usage does not guarantee access to this model. Check model access in your Ollama account.",
        403: "Ollama denied access. Check your API key and model access.",
        404: "Ollama could not find gemma4:31b.",
        429: "Ollama quota or rate limit reached. Please try again later.",
      };
      return Response.json(
        { error: errors[result.status] || `Ollama request failed (${result.status}). Please try again later.` },
        { status: result.status === 429 ? 429 : 502 },
      );
    }
    const data = await result.json();
    const text: string | undefined = typeof data.message?.content === "string" ? data.message.content : undefined;

    if (!text) {
      return Response.json(
        { error: "Ollama returned no text." },
        { status: 502 },
      );
    }

    let extracted: unknown;
    try {
      extracted = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1"));
    } catch {
      return Response.json(
        { error: "Ollama returned invalid JSON. Please try again." },
        { status: 502 },
      );
    }
    if (
      !extracted ||
      typeof extracted !== "object" ||
      !("accepted" in extracted) ||
      typeof extracted.accepted !== "boolean" ||
      !("events" in extracted) ||
      !Array.isArray(extracted.events)
    ) {
      return Response.json(
        { error: "Ollama returned an unexpected JSON format. Please try again." },
        { status: 502 },
      );
    }

    if (!extracted.accepted && extracted.events.length === 0) {
      return Response.json({ response: "Declined" });
    }

    if (
      !extracted.accepted ||
      extracted.events.length === 0 ||
      !extracted.events.every(isPlannerEvent)
    ) {
      return Response.json(
        { error: "Ollama returned an unexpected event format. Please try again." },
        { status: 502 },
      );
    }

    const events = extracted.events;
    for (const event of events) {
      // A leap year validates month/day dates without assigning a year to the event.
      const fullDate = /^\d{2}-\d{2}$/.test(event.date) ? `2000-${event.date}` : event.date;
      const parsedDate = new Date(`${fullDate}T00:00:00Z`);
      if (
        !event.title.trim() ||
        !/^(?:\d{4}-)?\d{2}-\d{2}$/.test(event.date) ||
        Number.isNaN(parsedDate.getTime()) ||
        parsedDate.toISOString().slice(0, 10) !== fullDate
      ) {
        return Response.json(
          { error: "Ollama returned an invalid event date or title. Please try again." },
          { status: 502 },
        );
      }
    }

    return Response.json({
      response: { events: events.map((event) => Object.fromEntries(fields.map((field) => [field, event[field]]))) },
    });
  } catch {
    return Response.json(
      { error: "Could not connect to Ollama or process its response. The request may have timed out. Please try again." },
      { status: 502 },
    );
  }
}
