// Ribbon segments for a day, derived from the windows and the offered slots (shared by the public API and the owner preview).
import type { RibbonSegment } from "@/lib/ribbon";
import type { Slot, Window } from "@/modules/availability/slots";

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** free = covered by an offered slot; "booked" = inside hours but not offered (busy/past/notice); "closed" = between windows; selected overlays free. */
export function segmentsFromSlots(windows: Window[], slots: Slot[], durationMinutes: number, opts: { cell?: number; selected?: string } = {}): RibbonSegment[] {
  const cell = opts.cell ?? 30;
  const starts = slots.map((s) => toMin(s.local));
  const sel = opts.selected ? toMin(opts.selected) : null;
  const raw: RibbonSegment[] = [];
  windows.forEach((w, i) => {
    if (i > 0 && w.from > windows[i - 1].to) raw.push({ start: windows[i - 1].to, end: w.from, state: "closed" });
    for (let c = w.from; c < w.to; c += cell) {
      const end = Math.min(c + cell, w.to);
      const free = starts.some((st) => st <= c && c < st + durationMinutes);
      const selected = sel !== null && c >= sel && c < sel + durationMinutes;
      raw.push({ start: c, end, state: selected ? "selected" : free ? "free" : "booked" });
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
