import type { UserDoc } from "@/lib/models";
import { PlannerError, findEvents } from "@/lib/planner-service";
import { resolveRelativeDate } from "@/lib/agent/dates";

export const findEventTool = {
  type: "function",
  function: {
    name: "find_event",
    description: "Search the user's planner for events whose text matches a query (case-insensitive, partial match). Use this before updating, moving, completing, or deleting anything, so you act on the real event text, not a guess.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to search for, e.g. 'CSE340 quiz'." },
        from: { type: "string", description: "Start of the search window, YYYY-MM-DD. Defaults to 30 days before today." },
        to: { type: "string", description: "End of the search window, YYYY-MM-DD, inclusive. Defaults to 60 days after today." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
} as const;

export async function runFindEvent(user: UserDoc, today: string, args: Record<string, unknown>) {
  const query = typeof args.query === "string" ? args.query : "";
  const from = (args.from !== undefined ? resolveRelativeDate(args.from, today) : null)
    ?? new Date(Date.parse(today) - 30 * 86_400_000).toISOString().slice(0, 10);
  const to = (args.to !== undefined ? resolveRelativeDate(args.to, today) : null)
    ?? new Date(Date.parse(today) + 60 * 86_400_000).toISOString().slice(0, 10);
  if (!query.trim()) throw new PlannerError("Provide search text.", "invalid_query");
  const matches = await findEvents(user, query, from, to);
  return { query, from, to, matches: matches.slice(0, 25) };
}
