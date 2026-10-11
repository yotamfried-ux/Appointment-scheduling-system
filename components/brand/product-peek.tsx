import { TimeRibbon } from "@/components/brand/time-ribbon";
import { StatusBadge } from "@/components/patterns/status-badge";
import type { RibbonSegment } from "@/lib/ribbon";

const H = (h: number, m = 0) => h * 60 + m;

// Realistic sample day (not decoration: it shows what the product actually is).
const SEGMENTS: RibbonSegment[] = [
  { start: H(9), end: H(10), state: "booked" },
  { start: H(10), end: H(10, 30), state: "free" },
  { start: H(10, 30), end: H(11, 30), state: "booked" },
  { start: H(11, 30), end: H(12), state: "pending" },
  { start: H(12), end: H(14), state: "free" },
  { start: H(14), end: H(15, 30), state: "booked" },
  { start: H(15, 30), end: H(18), state: "free" },
];

const ROWS = [
  { time: "09:00", who: "אורי שמעוני", what: "תספורת גברים", status: "confirmed" as const, label: "מאושר" },
  { time: "10:30", who: "מיכל אברהם", what: "צבע שיער", status: "confirmed" as const, label: "מאושר" },
  { time: "11:30", who: "נועם לוי", what: "עיצוב זקן", status: "pending" as const, label: "ממתין לאישור" },
];

/** A live-looking slice of the product, rendered with the real components. Decorative for AT. */
export function ProductPeek({ title, dayLabel }: { title: string; dayLabel: string }) {
  return (
    <div className="dark rounded-lg border bg-card p-5 text-card-foreground shadow-pop" aria-hidden>
      <div className="mb-4 flex items-baseline justify-between">
        <p className="text-base font-semibold">{title}</p>
        <p className="text-sm text-muted-foreground">{dayLabel}</p>
      </div>
      <TimeRibbon from={H(9)} to={H(18)} segments={SEGMENTS} now={H(11, 10)} tickEvery={3} height="lg" />
      <ul className="mt-5 divide-y divide-border">
        {ROWS.map((r) => (
          <li key={r.time} className="flex items-center gap-4 py-3">
            <span className="w-12 shrink-0 text-sm font-semibold tabular-nums"><bdi>{r.time}</bdi></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{r.who}</span>
              <span className="block truncate text-xs text-muted-foreground">{r.what}</span>
            </span>
            <StatusBadge status={r.status} label={r.label} />
          </li>
        ))}
      </ul>
    </div>
  );
}
