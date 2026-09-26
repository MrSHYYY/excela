import type { UserDoc } from "@/lib/models";
import { PlannerError } from "@/lib/planner-service";
import { createConfirmation } from "@/lib/agent/confirmations";

export const requestDeleteConfirmationTool = {
  type: "function",
  function: {
    name: "request_delete_confirmation",
    description: "Request server-side confirmation before deleting an event. You MUST call this before delete_event. Pass the event details from find_event. The tool returns a confirmation token and a description to show the user. Ask the user to confirm, then pass the token to delete_event only after they say yes.",
    parameters: {
      type: "object",
      properties: {
        cell: { type: "string", description: "Cell reference from find_event (e.g. 'E5')." },
        sheetId: { type: "number", description: "sheetId from find_event." },
        eventText: { type: "string", description: "The event text, so the user knows exactly what will be deleted." },
        eventDate: { type: "string", description: "The event date (YYYY-MM-DD)." },
      },
      required: ["cell", "sheetId", "eventText", "eventDate"],
      additionalProperties: false,
    },
  },
} as const;

export async function runRequestDeleteConfirmation(user: UserDoc, _today: string, args: Record<string, unknown>) {
  const cell = typeof args.cell === "string" ? args.cell : "";
  const sheetId = typeof args.sheetId === "number" ? args.sheetId : NaN;
  const eventText = typeof args.eventText === "string" ? args.eventText : "";
  const eventDate = typeof args.eventDate === "string" ? args.eventDate : "";
  if (!cell || !Number.isFinite(sheetId) || !eventText || !eventDate) {
    throw new PlannerError("Cell, sheetId, eventText, and eventDate are required.", "invalid_args");
  }
  const description = `Delete "${eventText}" on ${eventDate}`;
  const token = await createConfirmation(user._id, "delete", cell, sheetId, description);
  return { status: "pending_delete", confirmationToken: token, description, cell, sheetId };
}
