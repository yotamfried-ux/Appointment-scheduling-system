// Availability engine (pure). Used by the lab API now; the real booking module (stage 3/4) reuses it
// unchanged and adds the database as the source of `busy`. Tested in tests/unit/availability-engine.test.ts.
import type { RibbonSegment } from "@/lib/ribbon";

export interface TimeWindow {
  from: number; // minutes from midnight
  to: number;
}
export interface Interval {
  start: number;
  end: number; // exclusive; callers include any buffer after the booking
}
export type SlotStatus = "free" | "taken" | "unavailable";

export interface EngineInput {
  windows: TimeWindow[];
  durationMinutes: number;
  step: number;
  buffer: number;
  busy: Interval[];
  /** Times at or before this minute are unavailable (today only). */
  nowMinutes?: number;
  /** Lets a caller exempt a busy interval for a candidate (group sessions that still have capacity). */
  ignore?: (busy: Interval, candidateStart: number) => boolean;
  /** Restricts which start times may be offered at all (e.g. group sessions the owner scheduled). */
  allow?: (start: number) => boolean;
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;

export function classifySlots(input: EngineInput): { start: number; status: SlotStatus }[] {
  const { windows, durationMinutes, step, buffer, busy, nowMinutes, ignore, allow } = input;
  const out: { start: number; status: SlotStatus }[] = [];
  for (const w of windows) {
    for (let start = w.from; start + durationMinutes <= w.to; start += step) {
      if (nowMinutes !== undefined && start <= nowMinutes) {
        out.push({ start, status: "unavailable" });
        continue;
      }
      if (allow && !allow(start)) {
        out.push({ start, status: "unavailable" });
        continue;
      }
      const candidate: Interval = { start, end: start + durationMinutes + buffer };
      const clash = busy.some((b) => overlaps(candidate, b) && !(ignore && ignore(b, start)));
      out.push({ start, status: clash ? "taken" : "free" });
    }
  }
  return out;
}

export function daySegments(input: EngineInput & { selectedStart?: number }): RibbonSegment[] {
  const { windows, step, durationMinutes, selectedStart } = input;
  // A cell is "free" when some bookable start for THIS service covers it, so a 90-minute service never
  // shows 30-minute pockets it cannot actually use as free.
  const starts = classifySlots(input).filter((s) => s.status === "free").map((s) => s.start);
  const isCovered = (cell: number) => starts.some((st) => st <= cell && cell < st + durationMinutes);
  const raw: RibbonSegment[] = [];
  windows.forEach((w, i) => {
    if (i > 0 && w.from > windows[i - 1].to) raw.push({ start: windows[i - 1].to, end: w.from, state: "closed" });
    for (let c = w.from; c < w.to; c += step) {
      const end = Math.min(c + step, w.to);
      const past = input.nowMinutes !== undefined && c <= input.nowMinutes;
      raw.push({ start: c, end, state: past ? "closed" : isCovered(c) ? "free" : "booked" });
    }
  });
  if (selectedStart !== undefined) {
    const selEnd = selectedStart + durationMinutes;
    for (const seg of raw) if (seg.start >= selectedStart && seg.start < selEnd && seg.state !== "closed") seg.state = "selected";
  }
  const merged: RibbonSegment[] = [];
  for (const seg of raw) {
    const last = merged.at(-1);
    if (last && last.state === seg.state && last.end === seg.start) last.end = seg.end;
    else merged.push({ ...seg });
  }
  return merged;
}
