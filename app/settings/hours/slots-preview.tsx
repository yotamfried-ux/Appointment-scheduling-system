import { getTranslations } from "next-intl/server";
import { TimeRibbon } from "@/components/brand/time-ribbon";
import { formatDayLabel } from "@/lib/lab/booking-data";
import type { RibbonSegment } from "@/lib/ribbon";
import { addDaysIso, slotsForDay, windowsForDate, type DayException, type Slot, type WeeklyRule, type Window } from "@/modules/availability/slots";
import { zonedParts, type Clock } from "@/platform/clock";

const CELL = 30;

/** Non-overlapping ribbon cells: free where a bookable slot covers the cell, striped where nothing is offered. */
function previewSegments(windows: Window[], slots: Slot[], duration: number): RibbonSegment[] {
  const starts = slots.map((x) => Number(x.local.slice(0, 2)) * 60 + Number(x.local.slice(3)));
  const raw: RibbonSegment[] = [];
  windows.forEach((w, i) => {
    if (i > 0) raw.push({ start: windows[i - 1].to, end: w.from, state: "closed" });
    for (let c = w.from; c < w.to; c += CELL) {
      const end = Math.min(c + CELL, w.to);
      raw.push({ start: c, end, state: starts.some((st) => st <= c && c < st + duration) ? "free" : "closed" }); // not offered (past, notice, busy): striped, never a solid "booked" block
    }
  });
  const merged: RibbonSegment[] = [];
  for (const seg of raw) {
    const last = merged.at(-1);
    if (last && last.state === seg.state && last.end === seg.start) last.end = seg.end;
    else merged.push({ ...seg });
  }
  return merged;
}

/** What customers will be offered for the next 14 days, computed from the SAVED rules by the real slot engine. */
export async function SlotsPreview({ rules, exceptions, timeZone, clock, service }: { rules: WeeklyRule[]; exceptions: DayException[]; timeZone: string; clock: Clock; service: { durationMinutes: number; bufferMinutes: number } }) {
  const t = await getTranslations("settings.preview");
  const today = zonedParts(clock.now(), timeZone).date;
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = addDaysIso(today, i);
    const windows = windowsForDate(date, rules, exceptions);
    const slots = slotsForDay({ date, timeZone, rules, exceptions, durationMinutes: service.durationMinutes, bufferMinutes: service.bufferMinutes, stepMinutes: 30, now: clock.now() });
    return { date, windows, slots };
  });
  return (
    <ol className="divide-y overflow-hidden rounded-lg border bg-card" data-testid="preview-days">
      {days.map((d) => {
        const from = d.windows[0]?.from ?? 0;
        const to = d.windows.at(-1)?.to ?? 0;
        return (
          <li key={d.date} className="grid gap-2 px-4 py-3 sm:grid-cols-[11rem_minmax(0,1fr)_9rem] sm:items-center sm:gap-4" data-testid={`preview-${d.date}`} data-free={d.slots.length}>
            <span className="font-medium">{formatDayLabel(d.date, "short")}</span>
            {d.windows.length ? (
              <TimeRibbon
                from={from}
                to={to}
                segments={previewSegments(d.windows, d.slots, service.durationMinutes)}
                height="sm"
                ticks={false}
                label={t("ribbon", { day: formatDayLabel(d.date, "short") })}
              />
            ) : (
              <span className="text-sm text-muted-foreground">{t("closedDay")}</span>
            )}
            <span className="text-sm text-muted-foreground sm:text-end">{d.windows.length ? (d.slots.length ? t("free", { count: d.slots.length }) : t("none")) : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}
