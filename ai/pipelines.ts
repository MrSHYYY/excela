import { academicInstruction } from "@/ai/academic-instruction";
import { generalInstruction } from "@/ai/general-instruction";

// The two ways Excela can read a message. Both return the same JSON shape, so everything after
// extraction (validation, planner sync) is shared.
export const pipelines = {
  academic: { label: "Academic", instruction: academicInstruction },
  general: { label: "General", instruction: generalInstruction },
} as const;

export type PipelineId = keyof typeof pipelines;

export function isPipelineId(value: unknown): value is PipelineId {
  return typeof value === "string" && (Object.keys(pipelines) as string[]).includes(value);
}
