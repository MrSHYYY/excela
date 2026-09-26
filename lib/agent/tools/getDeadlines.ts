import type { UserDoc } from "@/lib/models";
import { getSchedule } from "@/lib/planner-service";

export const getDeadlinesTool = {
  type: "function",
  function: {
    name: "get_deadlines",
    description: "Get all pending (incomplete) events from today through the next 14 days. Use for 'what's due', 'upcoming deadlines', 'what do I need to finish'.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
} as const;

export async function runGetDeadlines(user: UserDoc, today: string) {
  const to = new Date(Date.parse(today) + 14 * 86_400_000).toISOString().slice(0, 10);
  const days = await getSchedule(user, today, to);
  const pending = days.flatMap((day) =>
    day.slots.filter((s) => s.status === "pending").map((s) => ({ date: day.date, text: s.text }))
  );
  return { from: today, to, deadlines: pending };
}
