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

/** A YYYY-MM-DD string that is a real calendar date, or null. */
export function parseToday(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

// Dates are plain calendar days, so UTC arithmetic on YYYY-MM-DD is exact (no time zones or DST involved).
const shift = (date: string, days: number) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const weekday = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

// The instruction for one request: the pipeline's rules plus today's date and a ready-made table of
// relative days. The model looks dates up instead of doing calendar arithmetic, which it can get wrong
// (month ends, leap years, year boundaries).
export function buildInstruction(pipeline: PipelineId, today: string) {
  const at = (days: number) => shift(today, days);
  const line = (label: string, days: number) => `- ${label}: ${weekday(at(days))}, ${at(days)}`;
  const table = [
    line("3 days ago", -3),
    line("the day before yesterday, 2 days ago", -2),
    line("yesterday, 1 day ago", -1),
    line("today, tonight", 0),
    line("tomorrow, in 1 day", 1),
    line("the day after tomorrow, in 2 days", 2),
    ...[3, 4, 5, 6, 7].map((days) => line(`in ${days} days`, days)),
  ].join("\n");
  const example = pipeline === "academic"
    ? `Example input: the day after tomorrow i have quiz 5 on cse223\nExample output: {"accepted":true,"events":[{"course":"CSE223","title":"QUIZ 5","date":"${at(2)}"}]}`
    : `Example input: tomorrow i need to play soccer\nExample output: {"accepted":true,"events":[{"course":"","title":"Play soccer","date":"${at(1)}"}]}`;

  return `${pipelines[pipeline].instruction}
Relative dates:
Today is ${weekday(today)}, ${today} (YYYY-MM-DD). This is the only source of the current date.
The message may give a date as a relative day instead of a month and day. Resolve these using ONLY the table below:
${table}
Use the table's date exactly and do not calculate dates yourself.
Treat misspelled or shortened versions of these words (for example "tomorow", "todayy", "tday", "yestarday", "tmrw") as the intended word.
For a relative date, always output the full YYYY-MM-DD from the table, including the year.
An explicit month and day in the message always takes precedence over relative words.
Do not resolve weekday names ("Friday", "next Monday"), "next week", "soon", "later", or any relative expression that is not in the table: an item that only has such a date has no date, so do not extract it.
${example}

Return only JSON matching the provided schema.
`;
}
