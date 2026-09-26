import type { UserDoc } from "@/lib/models";
import { PlannerError } from "@/lib/planner-service";
import { getTodayScheduleTool, runGetTodaySchedule } from "@/lib/agent/tools/getTodaySchedule";
import { getScheduleTool, runGetSchedule } from "@/lib/agent/tools/getSchedule";
import { findEventTool, runFindEvent } from "@/lib/agent/tools/findEvent";
import { createEventTool, runCreateEvent } from "@/lib/agent/tools/createEvent";

// The full set of tools the model may call. Registering a tool here is the ONLY way it becomes
// callable — the model can never execute anything outside this list, and never with different
// arguments than what each tool below explicitly accepts and validates.
export const agentTools = [getTodayScheduleTool, getScheduleTool, findEventTool, createEventTool];

const MAX_TOOL_CALLS_PER_REQUEST = 8;

export type ToolCallLog = { name: string; args: Record<string, unknown>; ok: boolean; result: unknown };

/**
 * Runs one validated tool call. `user` and `today` are server-resolved context — never taken from the
 * model — so a tool can never act outside the authenticated user's own planner, and "today" can never
 * be spoofed by a prompt. Unknown tool names and malformed arguments are rejected before anything
 * reaches Google Sheets.
 */
export async function executeTool(name: string, rawArgs: unknown, user: UserDoc, today: string): Promise<unknown> {
  const args = rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs) ? rawArgs as Record<string, unknown> : {};
  switch (name) {
    case "get_today_schedule": return runGetTodaySchedule(user, today);
    case "get_schedule": return runGetSchedule(user, today, args);
    case "find_event": return runFindEvent(user, today, args);
    case "create_event": return runCreateEvent(user, today, args);
    default: throw new PlannerError(`Unknown tool: ${name}.`, "unknown_tool");
  }
}

export { MAX_TOOL_CALLS_PER_REQUEST };
