import type { UserDoc } from "@/lib/models";
import { PlannerError, getSchedule } from "@/lib/planner-service";
import { resolveRelativeDate } from "@/lib/agent/dates";

export const getScheduleTool = {
  type: "function",
  function: {
    name: "get_schedule",
    description: "Get the user's planner items for a specific date or a date range (inclusive). Use for \"what's on Monday\", \"this week\", \"Sept 5 to 9\", etc.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Start date. YYYY-MM-DD, or a relative word like 'today', 'tomorrow', 'monday'." },
        to: { type: "string", description: "End date, inclusive. Same format as from. Omit for a single day." },
      },
      required: ["from"],
      additionalProperties: false,
    },
  },
} as const;

export async function runGetSchedule(user: UserDoc, today: string, args: Record<string, unknown>) {
  const from = resolveRelativeDate(args.from, today);
  const to = args.to !== undefined ? resolveRelativeDate(args.to, today) : from;
  if (!from) throw new PlannerError("Could not understand the 'from' date. Ask the user for a specific date.", "invalid_date");
  if (!to) throw new PlannerError("Could not understand the 'to' date. Ask the user for a specific date.", "invalid_date");
  const spanDays = (Date.parse(to) - Date.parse(from)) / 86_400_000;
  if (spanDays < 0 || spanDays > 45) throw new PlannerError("Date range is too large or invalid; keep requests to 45 days or fewer.", "invalid_range");
  const days = await getSchedule(user, from, to);
  return { from, to, days: days.map((day) => ({ date: day.date, items: day.slots.map(({ text, status }) => ({ text, status })) })) };
}
