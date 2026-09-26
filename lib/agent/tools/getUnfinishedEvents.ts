import type { UserDoc } from "@/lib/models";
import { getSchedule } from "@/lib/planner-service";

export const getUnfinishedEventsTool = {
  type: "function",
  function: {
    name: "get_unfinished_events",
    description: "Get all pending (incomplete) events from the past 30 days up to today. Use for 'what haven't I finished', 'overdue tasks', 'unfinished events'.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
} as const;

export async function runGetUnfinishedEvents(user: UserDoc, today: string) {
  const from = new Date(Date.parse(today) - 30 * 86_400_000).toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
  const days = await getSchedule(user, from, yesterday);
  const unfinished = days.flatMap((day) =>
    day.slots.filter((s) => s.status === "pending").map((s) => ({ date: day.date, text: s.text }))
  );
  return { from, to: yesterday, unfinished };
}
