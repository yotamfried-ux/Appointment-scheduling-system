import { z } from "zod";
import { windowsValid, type DayHours } from "@/lib/lab/onboarding";
import type { DayException, WeeklyRule } from "@/modules/availability/slots";

const HHmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const WeeklyHoursInput = z
  .array(z.object({ weekday: z.number().int().min(0).max(6), open: z.boolean(), windows: z.array(z.object({ from: HHmm, to: HHmm })).min(1).max(3) }))
  .length(7)
  .refine((days) => days.some((d) => d.open) && days.filter((d) => d.open).every((d) => windowsValid(d.windows)), "invalid hours");

export const ExceptionInput = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(["closed", "open"]),
    from: HHmm.optional(),
    to: HHmm.optional(),
    note: z.string().trim().max(120).optional().default(""),
  })
  .strict()
  .refine((e) => (e.from === undefined) === (e.to === undefined), "range needs both ends")
  .refine((e) => e.from === undefined || e.to === undefined || e.from < e.to, "range must end after it starts")
  .refine((e) => e.kind === "closed" || e.from !== undefined, "special opening needs hours");
export type ExceptionInput = z.infer<typeof ExceptionInput>;

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export interface RuleRow {
  weekday: number;
  start_minute: number;
  end_minute: number;
}
export interface ExceptionRow {
  id: string;
  on_date: string;
  kind: "closed" | "open";
  start_minute: number | null;
  end_minute: number | null;
  note: string | null;
}

/** DB rows → the editor's shape (closed days keep a sensible default window so toggling them on is one click). */
export function rulesToDayHours(rows: RuleRow[]): DayHours[] {
  return Array.from({ length: 7 }, (_, weekday) => {
    const ws = rows.filter((r) => r.weekday === weekday).sort((a, b) => a.start_minute - b.start_minute);
    return { weekday, open: ws.length > 0, windows: (ws.length ? ws : [{ start_minute: 9 * 60, end_minute: 17 * 60 }]).map((r) => ({ from: hhmm(r.start_minute), to: hhmm(r.end_minute) })) };
  });
}
export const rowsToRules = (rows: RuleRow[]): WeeklyRule[] => rows.map((r) => ({ weekday: r.weekday, startMinute: r.start_minute, endMinute: r.end_minute }));
export const rowsToExceptions = (rows: ExceptionRow[]): DayException[] => rows.map((r) => ({ date: r.on_date, kind: r.kind, startMinute: r.start_minute, endMinute: r.end_minute }));
export const exceptionToRow = (e: ExceptionInput) => ({
  on_date: e.date,
  kind: e.kind,
  start_minute: e.from ? toMin(e.from) : null,
  end_minute: e.to ? toMin(e.to) : null,
  note: e.note || null,
});
