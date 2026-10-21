// Geometry + accessible summary for the "Time Ribbon" (docs/07 §4). Pure, unit-tested.
export type RibbonState = "booked" | "free" | "pending" | "closed" | "selected";

export interface RibbonSegment {
  start: number; // minutes from midnight
  end: number;
  state: RibbonState;
}

export interface RibbonBox {
  start: number; // % from the inline-start edge (right edge in RTL)
  size: number; // % of the range
  state: RibbonState;
}

export function ribbonGeometry(segments: RibbonSegment[], from: number, to: number): RibbonBox[] {
  if (!(to > from)) throw new Error("ribbon range must be positive");
  const total = to - from;
  return segments
    .map((s) => ({ s, start: Math.max(s.start, from), end: Math.min(s.end, to) }))
    .filter(({ start, end }) => end > start)
    .sort((a, b) => a.start - b.start)
    .map(({ s, start, end }) => ({ start: ((start - from) / total) * 100, size: ((end - start) / total) * 100, state: s.state }));
}

export const fmtMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function ribbonSummary(segments: RibbonSegment[], labels: Record<RibbonState, string>): string {
  const sorted = [...segments].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start);
  const order: RibbonState[] = [];
  const byState = new Map<RibbonState, string[]>();
  for (const s of sorted) {
    if (!byState.has(s.state)) {
      byState.set(s.state, []);
      order.push(s.state);
    }
    byState.get(s.state)!.push(`${fmtMinutes(s.start)}–${fmtMinutes(s.end)}`);
  }
  return order.map((st) => `${labels[st]}: ${byState.get(st)!.join(", ")}.`).join(" ");
}
