import type { UserDoc } from "@/lib/models";
import { PlannerError, createEvent } from "@/lib/planner-service";
import { resolveRelativeDate } from "@/lib/agent/dates";

export const createEventTool = {
  type: "function",
  function: {
    name: "create_event",
    description: "Add a new event to the user's planner on a specific date. Only call this once you have a title and a real date; never invent a date.",
    parameters: {
      type: "object",
      properties: {
        course: { type: "string", description: "Course code, e.g. 'CSE340'. Use an empty string if there isn't one." },
        title: { type: "string", description: "Short event title, e.g. 'Quiz 4'." },
        date: { type: "string", description: "YYYY-MM-DD. Resolve relative words using the date table you were given before calling this." },
      },
      required: ["title", "date"],
      additionalProperties: false,
    },
  },
} as const;

export async function runCreateEvent(user: UserDoc, today: string, args: Record<string, unknown>) {
  const title = typeof args.title === "string" ? args.title : "";
  const course = typeof args.course === "string" ? args.course : "";
  const date = resolveRelativeDate(args.date, today);
  if (!date) throw new PlannerError("The date must be YYYY-MM-DD. Resolve any relative date first, then call create_event again.", "invalid_date");
  const result = await createEvent(user, { course, title, date });
  return result;
}
