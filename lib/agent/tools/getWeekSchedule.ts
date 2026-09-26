import type { UserDoc } from "@/lib/models";
import { getSchedule } from "@/lib/planner-service";

export const getWeekScheduleTool = {
  type: "function",
  function: {
    name: "get_week_schedule",
    description: "Get the user's schedule for 7 consecutive days starting today (today through the next 6 days).",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
} as const;

export async function runGetWeekSchedule(user: UserDoc, today: string) {
  const start = new Date(`${today}T00:00:00Z`);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const to = end.toISOString().slice(0, 10);
  const days = await getSchedule(user, today, to);
  return {
    from: today,
    to,
    days: days.map((day) => ({
      date: day.date,
      items: day.slots.map(({ text, status }) => ({ text, status })),
    })),
  };
}

