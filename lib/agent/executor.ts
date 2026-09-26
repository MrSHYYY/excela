import type { UserDoc } from "@/lib/models";
import { PlannerError } from "@/lib/planner-service";
import { getTodayScheduleTool, runGetTodaySchedule } from "@/lib/agent/tools/getTodaySchedule";
import { getScheduleTool, runGetSchedule } from "@/lib/agent/tools/getSchedule";
import { getWeekScheduleTool, runGetWeekSchedule } from "@/lib/agent/tools/getWeekSchedule";
import { getDeadlinesTool, runGetDeadlines } from "@/lib/agent/tools/getDeadlines";
import { getUnfinishedEventsTool, runGetUnfinishedEvents } from "@/lib/agent/tools/getUnfinishedEvents";
import { findEventTool, runFindEvent } from "@/lib/agent/tools/findEvent";
import { createEventTool, runCreateEvent } from "@/lib/agent/tools/createEvent";
import { updateEventTool, runUpdateEvent } from "@/lib/agent/tools/updateEvent";
import { moveEventTool, runMoveEvent } from "@/lib/agent/tools/moveEvent";
import { markCompleteTool, runMarkComplete } from "@/lib/agent/tools/markComplete";
import { markIncompleteTool, runMarkIncomplete } from "@/lib/agent/tools/markIncomplete";
import { runRequestDeleteConfirmation } from "@/lib/agent/tools/requestDeleteConfirmation";
import { deleteEventTool, runDeleteEvent } from "@/lib/agent/tools/deleteEvent";

// The full set of tools the model may call. Registering a tool here is the ONLY way it becomes
// callable — the model can never execute anything outside this list, and never with different
// arguments than what each tool below explicitly accepts and validates.
export const agentTools = [
  // Read tools
  getTodayScheduleTool,
  getScheduleTool,
  getWeekScheduleTool,
  getDeadlinesTool,
  getUnfinishedEventsTool,
  findEventTool,
  // Write tools
  createEventTool,
  updateEventTool,
  moveEventTool,
  markCompleteTool,
  markIncompleteTool,
  deleteEventTool,
];

const MAX_TOOL_CALLS_PER_REQUEST = 10;

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
    // Read tools
    case "get_today_schedule": return runGetTodaySchedule(user, today);
    case "get_schedule": return runGetSchedule(user, today, args);
    case "get_week_schedule": return runGetWeekSchedule(user, today);
    case "get_deadlines": return runGetDeadlines(user, today);
    case "get_unfinished_events": return runGetUnfinishedEvents(user, today);
    case "find_event": return runFindEvent(user, today, args);
    // Write tools
    case "create_event": return runCreateEvent(user, today, args);
    case "update_event": return runUpdateEvent(user, today, args);
    case "move_event": return runMoveEvent(user, today, args);
    case "mark_complete": return runMarkComplete(user, today, args);
    case "mark_incomplete": return runMarkIncomplete(user, today, args);
    // Confirmation + destructive tools
    case "request_delete_confirmation": return runRequestDeleteConfirmation(user, today, args);
    case "delete_event": return runDeleteEvent(user, today, args);
    default: throw new PlannerError(`Unknown tool: ${name}.`, "unknown_tool");
  }
}

export { MAX_TOOL_CALLS_PER_REQUEST };
