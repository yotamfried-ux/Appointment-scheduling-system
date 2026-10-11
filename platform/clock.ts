// Clock port (docs/04 §6.5): all time-dependent logic receives a Clock so tests control "now" and DST edges.
// One time-zone helper only (Intl, no extra dependency): business-local wall time <-> UTC instants.
export interface Clock {
  now(): Date;
}
export const systemClock: Clock = { now: () => new Date() };

export class FixedClock implements Clock {
  constructor(private current: Date) {}
  now() {
    return new Date(this.current);
  }
  set(d: Date) {
    this.current = new Date(d);
  }
  advance(ms: number) {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export interface ZonedParts {
  date: string; // YYYY-MM-DD in the zone
  minutes: number; // minutes since local midnight
  weekday: number; // 0 = Sunday
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(instant).map((x) => [x.type, x.value]));
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday };
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const z = zonedParts(instant, timeZone);
  const [y, m, d] = z.date.split("-").map(Number);
  const asUtc = Date.UTC(y, m - 1, d, 0, z.minutes);
  return Math.round((asUtc - Math.floor(instant.getTime() / 60_000) * 60_000) / 60_000);
}

/**
 * Local wall time -> UTC instant. For a time skipped by DST (spring forward) it shifts forward by the gap length; for a repeated hour (fall back) it returns the earlier occurrence. Both are deterministic.
 */
export function zonedTimeToUtc(date: string, minutes: number, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  // Candidate offsets around the day (before / after any transition); keep the earliest instant that round-trips.
  const offsets = [...new Set([offsetMinutes(new Date(naive - 86_400_000), timeZone), offsetMinutes(new Date(naive + 86_400_000), timeZone)])];
  const valid = offsets
    .map((o) => naive - o * 60_000)
    .filter((t) => {
      const back = zonedParts(new Date(t), timeZone);
      return back.date === date && back.minutes === minutes;
    })
    .sort((a, b) => a - b);
  if (valid.length) return new Date(valid[0]);
  // Nonexistent local time (spring-forward gap): shift forward by the gap, like Temporal's "compatible" mode.
  return new Date(naive - offsets[0] * 60_000);
}

/** Length of the local calendar day in minutes (1380 / 1440 / 1500 around DST changes). */
export function dayLengthMinutes(date: string, timeZone: string): number {
  const next = new Date(Date.UTC(...(date.split("-").map(Number) as [number, number, number]).map((v, i) => (i === 1 ? v - 1 : i === 2 ? v + 1 : v)) as [number, number, number])).toISOString().slice(0, 10);
  return Math.round((zonedTimeToUtc(next, 0, timeZone).getTime() - zonedTimeToUtc(date, 0, timeZone).getTime()) / 60_000);
}
