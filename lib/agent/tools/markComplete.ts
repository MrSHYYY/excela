import type { UserDoc } from "@/lib/models";
import { PlannerError, markEventComplete } from "@/lib/planner-service";

export const markCompleteTool = {
  type: "function",
  function: {
    name: "mark_complete",
    description: "Mark a specific event as completed (changes it from red/pending to blue/completed). Pass the cell and sheetId (from find_event or a previous tool result in the conversation).",
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

export async function runMarkComplete(user: UserDoc, today: string, args: Record<string, unknown>) {
  const cell = typeof args.cell === "string" ? args.cell : "";
  const sheetId = typeof args.sheetId === "number" ? args.sheetId : NaN;
  if (!cell || !Number.isFinite(sheetId)) {
    throw new PlannerError("Cell and sheetId are required. Use find_event first.", "invalid_args");
  }
  return markEventComplete(user, { cell, sheetId });
}
