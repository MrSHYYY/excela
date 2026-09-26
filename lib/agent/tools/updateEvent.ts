import type { UserDoc } from "@/lib/models";
import { PlannerError, updateEvent } from "@/lib/planner-service";

export const updateEventTool = {
  type: "function",
  function: {
    name: "update_event",
    description: "Update an existing event's title or course. You MUST call find_event first to get the exact event details, then pass the cell and sheetId from that result. Never guess cell references.",
    parameters: {
      type: "object",
      properties: {
        cell: { type: "string", description: "The cell reference from find_event (e.g. 'E5')." },
        sheetId: { type: "number", description: "The sheetId from find_event result." },
        newTitle: { type: "string", description: "The new event title." },
        newCourse: { type: "string", description: "The new course code. Use empty string if none." },
      },
      required: ["cell", "sheetId", "newTitle"],
      additionalProperties: false,
    },
  },
} as const;

export async function runUpdateEvent(user: UserDoc, today: string, args: Record<string, unknown>) {
  const cell = typeof args.cell === "string" ? args.cell : "";
  const sheetId = typeof args.sheetId === "number" ? args.sheetId : NaN;
  const newTitle = typeof args.newTitle === "string" ? args.newTitle : "";
  const newCourse = typeof args.newCourse === "string" ? args.newCourse : "";
  if (!cell || !Number.isFinite(sheetId) || !newTitle.trim()) {
    throw new PlannerError("Cell, sheetId, and newTitle are required. Use find_event first.", "invalid_args");
  }
  return updateEvent(user, { cell, sheetId, newCourse, newTitle });
}
