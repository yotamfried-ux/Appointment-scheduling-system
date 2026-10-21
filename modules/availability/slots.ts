// Slot generation on real instants (pure). Weekly rules + dated exceptions + busy intervals + Clock → bookable starts.
// Works in the business's local wall time and converts through platform/clock (one tz helper), so DST days are correct:
// a local time skipped by DST yields no slot, a repeated hour yields the earlier occurrence once (never twice).
// Tested with example + property tests (tests/unit/availability-slots.test.ts). The booking module (stage 4) supplies `busy`.
import { zonedParts, zonedTimeToUtc } from "@/platform/clock";

export interface WeeklyRule {
  weekday: number; // 0 = Sunday
  startMinute: number;
  endMinute: number;
}
export interface DayException {
  date: string; // YYYY-MM-DD, business-local
  kind: "closed" | "open";
  /** Both set = partial; both null/undefined on "closed" = the whole day. "open" always has a range. */
  startMinute?: number | null;
  endMinute?: number | null;
}
export interface Window {
  from: number;
  to: number;
}
export interface BusyInterval {
  start: Date;
  end: Date;
}
export interface Slot {
  startUtc: string;
  endUtc: string;
  /** Local wall time, HH:mm (what the customer sees). */
  local: string;
}

export interface DaySlotsInput {
  date: string;
  timeZone: string;
  rules: WeeklyRule[];
  exceptions: DayException[];
  durationMinutes: number;
  bufferMinutes?: number;
  stepMinutes?: number;
  busy?: BusyInterval[];
  now: Date;
  minNoticeMinutes?: number;
}

export const weekdayOfDate = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};

function merge(ws: Window[]): Window[] {
  const sorted = ws.filter((w) => w.to > w.from).sort((a, b) => a.from - b.from);
  const out: Window[] = [];
  for (const w of sorted) {
    const last = out.at(-1);
    if (last && w.from <= last.to) last.to = Math.max(last.to, w.to);
    else out.push({ ...w });
  }
  return out;
}

function subtract(ws: Window[], cut: Window): Window[] {
  return ws.flatMap((w) => {
    if (cut.to <= w.from || cut.from >= w.to) return [w];
    const parts: Window[] = [];
    if (cut.from > w.from) parts.push({ from: w.from, to: cut.from });
    if (cut.to < w.to) parts.push({ from: cut.to, to: w.to });
    return parts;
  });
}

/** The open windows of one local date: weekly rules, then closures (cut) and special openings (added). */
export function windowsForDate(date: string, rules: WeeklyRule[], exceptions: DayException[]): Window[] {
  const todays = exceptions.filter((e) => e.date === date);
  if (todays.some((e) => e.kind === "closed" && (e.startMinute == null || e.endMinute == null))) return []; // whole day closed wins
  let ws = merge(rules.filter((r) => r.weekday === weekdayOfDate(date)).map((r) => ({ from: r.startMinute, to: r.endMinute })));
  for (const e of todays) {
    if (e.kind === "closed" && e.startMinute != null && e.endMinute != null) ws = subtract(ws, { from: e.startMinute, to: e.endMinute });
  }
  for (const e of todays) {
    if (e.kind === "open" && e.startMinute != null && e.endMinute != null) ws = [...ws, { from: e.startMinute, to: e.endMinute }];
  }
  return merge(ws);
}

const overlaps = (aStart: number, aEnd: number, b: BusyInterval) => aStart < b.end.getTime() && b.start.getTime() < aEnd;

export function slotsForDay(input: DaySlotsInput): Slot[] {
  const { date, timeZone, durationMinutes, now } = input;
  const step = input.stepMinutes ?? 15;
  const buffer = input.bufferMinutes ?? 0;
  const earliest = now.getTime() + (input.minNoticeMinutes ?? 0) * 60_000;
  const busy = input.busy ?? [];
  const out: Slot[] = [];
  const seen = new Set<number>();

  for (const w of windowsForDate(date, input.rules, input.exceptions)) {
    for (let m = w.from; m + durationMinutes <= w.to; m += step) {
      const start = zonedTimeToUtc(date, m, timeZone);
      const back = zonedParts(start, timeZone);
      if (back.date !== date || back.minutes !== m) continue; // wall time skipped by DST: no such slot
      const t = start.getTime();
      if (seen.has(t)) continue; // repeated hour: one slot per instant
      if (t < earliest) continue;
      const end = t + durationMinutes * 60_000;
      if (busy.some((b) => overlaps(t, end + buffer * 60_000, b))) continue;
      seen.add(t);
      out.push({ startUtc: start.toISOString(), endUtc: new Date(end).toISOString(), local: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` });
    }
  }
  return out.sort((a, b) => a.startUtc.localeCompare(b.startUtc));
}

export function addDaysIso(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Per-day free-slot counts for a date range (day picker / owner preview). */
export function availabilityForRange(input: Omit<DaySlotsInput, "date"> & { from: string; days: number }) {
  return Array.from({ length: input.days }, (_, i) => {
    const date = addDaysIso(input.from, i);
    const slots = slotsForDay({ ...input, date });
    return { date, closed: windowsForDate(date, input.rules, input.exceptions).length === 0, freeSlots: slots.length };
  });
}
