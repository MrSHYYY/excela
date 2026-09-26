import type { UserDoc } from "@/lib/models";
import { getSchedule } from "@/lib/planner-service";

export const getTodayScheduleTool = {
  type: "function",
  function: {
    name: "get_today_schedule",
    description: "Get everything on the user's planner for today. Use this for \"what do I have today\" style questions.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
} as const;

/** `today` comes from server-trusted context, never from the model. */
export async function runGetTodaySchedule(user: UserDoc, today: string) {
  const [day] = await getSchedule(user, today, today);
  return { date: today, items: day?.slots.map(({ text, status }) => ({ text, status })) ?? [] };
}
