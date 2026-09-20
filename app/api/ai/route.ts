import { ApiError, GoogleGenAI } from "@google/genai";
import { academicExtractionInstruction } from "@/ai/instructions";
import { getSessionUser } from "@/lib/auth";

// The AI call can take a while (Ollama has a 60s timeout); this lets Vercel run the function that long.
export const maxDuration = 60;

const fields = ["course", "title", "date"] as const;
type AcademicEvent = Record<(typeof fields)[number], string>;

function isAcademicEvent(value: unknown): value is AcademicEvent {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    fields.every((field) => typeof (value as Record<string, unknown>)[field] === "string");
}

export async function POST(request: Request) {
  // Only signed-in users can spend AI credits.
  try {
    if (!(await getSessionUser())) {
      return Response.json({ error: "Sign in with Google to use Excela.", code: "auth" }, { status: 401 });
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
    !body.message.trim()
  ) {
    return Response.json(
      { error: "message must be a non-empty string." },
      { status: 400 },
    );
  }

  const provider = "provider" in body ? body.provider : "gemini";
  if (provider !== "gemini" && provider !== "ollama") {
    return Response.json({ error: "Choose gemini or ollama." }, { status: 400 });
  }
  const providerName = provider === "ollama" ? "Ollama" : "Gemini";
  const keyName = provider === "ollama" ? "OLLAMA_API" : "GEMINI_API";
  const apiKey = provider === "ollama" ? process.env.OLLAMA_API : process.env.GEMINI_API;
  if (!apiKey) {
    return Response.json(
      { error: `${keyName} is not configured.` },
      { status: 500 },
    );
  }

  try {
    const config = {
        systemInstruction: academicExtractionInstruction,
        responseMimeType: "application/json",
        responseJsonSchema: {
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
        },
    };

    let text: string | undefined;
    if (provider === "ollama") {
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
              content: `${config.systemInstruction}\nReturn only a JSON object, without Markdown or commentary, matching this schema: ${JSON.stringify(config.responseJsonSchema)}`,
            },
            { role: "user", content: body.message },
          ],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!result.ok) {
        const errors: Record<number, string> = {
          401: "Ollama authentication failed. Check OLLAMA_API on the server.",
          402: "Ollama requires paid usage for this request (402). Unused free usage does not guarantee access to this model. Check model access in your Ollama account or select Gemini.",
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
      text = typeof data.message?.content === "string" ? data.message.content : undefined;
    } else {
      const ai = new GoogleGenAI({ apiKey });
      const result = await ai.models.generateContent({
        model: "gemini-flash-latest",
        contents: body.message,
        config,
      });
      text = result.text;
    }

    if (!text) {
      return Response.json(
        { error: `${providerName} returned no text.` },
        { status: 502 },
      );
    }

    let extracted: unknown;
    try {
      extracted = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1"));
    } catch {
      return Response.json(
        { error: `${providerName} returned invalid JSON. Please try again.` },
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
        { error: `${providerName} returned an unexpected JSON format. Please try again.` },
        { status: 502 },
      );
    }

    if (!extracted.accepted && extracted.events.length === 0) {
      return Response.json({ response: "Declined" });
    }

    if (
      !extracted.accepted ||
      extracted.events.length === 0 ||
      !extracted.events.every(isAcademicEvent)
    ) {
      return Response.json(
        { error: `${providerName} returned an unexpected event format. Please try again.` },
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
          { error: `${providerName} returned an invalid event date or title. Please try again.` },
          { status: 502 },
        );
      }
    }

    return Response.json({
      response: { events: events.map((event) => Object.fromEntries(fields.map((field) => [field, event[field]]))) },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      // Keep provider details on the server and redact the API key.
      console.error("Gemini API error", {
        status: error.status,
        message: error.message.replaceAll(apiKey, "[REDACTED]"),
      });

      const messages: Record<number, string> = {
        400: "Gemini rejected the request (400). Check the server terminal for details.",
        401: "Gemini authentication failed (401). Check GEMINI_API on the server.",
        403: "Gemini denied access (403). Check the API key and project permissions.",
        404: "The configured Gemini model was not found (404).",
        429: "Gemini quota or rate limit reached (429). Check your quota or try again later.",
        500: "Gemini encountered a server error (500). Please try again later.",
        503: "Gemini is temporarily unavailable (503). Please try again later.",
      };
      return Response.json(
        { error: messages[error.status] || `Gemini request failed (${error.status}). Check the server terminal for details.` },
        { status: error.status === 429 ? 429 : 502 },
      );
    }

    return Response.json(
      { error: `Could not connect to ${providerName} or process its response. The request may have timed out. Please try again.` },
      { status: 502 },
    );
  }
}
