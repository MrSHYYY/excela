import type { UserDoc } from "@/lib/models";
import { getSchedule } from "@/lib/planner-service";

export const getWeekScheduleTool = {
  type: "function",
  function: {
    name: "get_week_schedule",
    description: "Get the user's full schedule for the current week (Monday through Sunday). Use for 'what's my week look like' or 'this week's schedule'.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
} as const;

export async function runGetWeekSchedule(user: UserDoc, today: string) {
  const d = new Date(`${today}T00:00:00Z`);
  const dayOfWeek = d.getUTCDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  const monday = new Date(d.getTime() + mondayOffset * 86_400_000).toISOString().slice(0, 10);
  const sunday = new Date(d.getTime() + (mondayOffset + 6) * 86_400_000).toISOString().slice(0, 10);
  const days = await getSchedule(user, monday, sunday);
  return { from: monday, to: sunday, days: days.map((day) => ({ date: day.date, items: day.slots.map(({ text, status }) => ({ text, status })) })) };
}
