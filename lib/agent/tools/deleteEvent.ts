import type { UserDoc } from "@/lib/models";
import { PlannerError, deleteEvent } from "@/lib/planner-service";

export const deleteEventTool = {
  type: "function",
  function: {
    name: "delete_event",
    description: "Delete an event from the planner. You MUST call find_event first to get the cell and sheetId of the event to delete. Never guess cell references.",
    parameters: {
      type: "object",
      properties: {
        cell: { type: "string", description: "Cell reference from find_event (e.g. 'E5')." },
        sheetId: { type: "number", description: "sheetId from find_event." },
      },
      required: ["cell", "sheetId"],
      additionalProperties: false,
    },
  },
} as const;

export async function runDeleteEvent(user: UserDoc, _today: string, args: Record<string, unknown>) {
  const cell = typeof args.cell === "string" ? args.cell : "";
  const sheetId = typeof args.sheetId === "number" ? args.sheetId : NaN;
  if (!cell || !Number.isFinite(sheetId)) {
    throw new PlannerError("Cell and sheetId are required. Use find_event first.", "invalid_args");
  }
  return deleteEvent(user, { cell, sheetId });
}
