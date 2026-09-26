import type { UserDoc } from "@/lib/models";
import { PlannerError, createEvent, checkConflicts } from "@/lib/planner-service";
import { resolveRelativeDate } from "@/lib/agent/dates";

export const createEventTool = {
  type: "function",
  function: {
    name: "create_event",
    description: "Add a new event to the user's planner on a specific date. Only call this once you have a title and a real date; never invent a date. The tool automatically checks for duplicates and reports existing events on the same date so you can warn about potential conflicts.",
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

  // Check for existing events on the target date (for conflict awareness)
  const conflicts = await checkConflicts(user, date);
  const result = await createEvent(user, { course, title, date });

  // Enrich the result with conflict information
  return {
    ...result,
    existingEventsOnDate: conflicts.existingEvents.map(({ text, status }) => ({ text, status })),
    slotsUsed: conflicts.slotsUsed + (result.status === "created" ? 1 : 0),
    slotsFree: conflicts.slotsFree - (result.status === "created" ? 1 : 0),
  };
}
