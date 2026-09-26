import type { UserDoc } from "@/lib/models";
import { PlannerError, deleteEvent } from "@/lib/planner-service";
import { consumeConfirmation } from "@/lib/agent/confirmations";

export const deleteEventTool = {
  type: "function",
  function: {
    name: "delete_event",
    description: "Delete an event from the planner. This is DESTRUCTIVE. You MUST first call request_delete_confirmation to get a confirmation token, then ask the user to confirm. Only call this after the user explicitly says yes. Pass the confirmationToken from request_delete_confirmation.",
    parameters: {
      type: "object",
      properties: {
        cell: { type: "string", description: "Cell reference from find_event (e.g. 'E5')." },
        sheetId: { type: "number", description: "sheetId from find_event." },
        confirmationToken: { type: "string", description: "The confirmation token from request_delete_confirmation. Required." },
      },
      required: ["cell", "sheetId", "confirmationToken"],
      additionalProperties: false,
    },
  },
} as const;

export async function runDeleteEvent(user: UserDoc, _today: string, args: Record<string, unknown>) {
  const cell = typeof args.cell === "string" ? args.cell : "";
  const sheetId = typeof args.sheetId === "number" ? args.sheetId : NaN;
  const confirmationToken = typeof args.confirmationToken === "string" ? args.confirmationToken : "";
  if (!cell || !Number.isFinite(sheetId)) {
    throw new PlannerError("Cell and sheetId are required. Use find_event first.", "invalid_args");
  }
  if (!confirmationToken) {
    throw new PlannerError("A confirmation token is required. Call request_delete_confirmation first, then ask the user to confirm.", "needs_confirmation");
  }
  // Server-side validation: consume the confirmation token atomically.
  // This ensures the token is valid, belongs to this user, matches the cell/sheet, and hasn't expired.
  const confirmation = await consumeConfirmation(confirmationToken, user._id);
  if (!confirmation) {
    throw new PlannerError("The confirmation has expired or was already used. Please start the delete process again.", "invalid_confirmation");
  }
  if (confirmation.cell !== cell || confirmation.sheetId !== sheetId) {
    throw new PlannerError("The confirmation does not match this event. Please start the delete process again.", "confirmation_mismatch");
  }
  return deleteEvent(user, { cell, sheetId, confirmationToken });
}
