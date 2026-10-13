import type { RibbonSegment } from "@/lib/ribbon";

// Prototype data + pure logic for the owner dashboard (stage 1 design lab).
// Real data arrives with the booking module (stage 5); the helpers below are reusable as-is.

export type LabStatus = "confirmed" | "pending" | "cancelled" | "completed" | "noShow" | "cancellationRequested";

export interface LabAppointment {
  id: string;
  start: number; // minutes from midnight
  end: number;
  customer: string;
  service: string;
  status: LabStatus;
  note?: string;
  /** Real owner agenda only. */
  date?: string;
  phone?: string;
  manual?: boolean;
  outOfHours?: boolean;
  /** Real owner agenda, businesses with a team. */
  personId?: string;
  personName?: string;
}

const H = (h: number, m = 0) => h * 60 + m;

export const LAB_DAY = { from: H(9), to: H(18), now: H(11, 10), iso: "2026-10-14" } as const;

export const LAB_APPOINTMENTS: LabAppointment[] = [
  { id: "a1", start: H(9), end: H(9, 30), customer: "אורי שמעוני", service: "תספורת גברים", status: "completed" },
  { id: "a2", start: H(9, 30), end: H(10, 30), customer: "מיכל אברהם", service: "טיפול פנים", status: "completed" },
  { id: "a3", start: H(10, 30), end: H(11, 30), customer: "דנה כהן", service: "טיפול פנים", status: "confirmed" },
  { id: "p1", start: H(11, 30), end: H(12), customer: "נועם לוי", service: "תספורת גברים", status: "pending", note: "לקוח חדש" },
  { id: "a4", start: H(14), end: H(15, 30), customer: "שירה מזרחי", service: "צבע שיער", status: "confirmed" },
  { id: "c1", start: H(15, 30), end: H(16), customer: "יוסי ביטון", service: "עיצוב זקן", status: "cancellationRequested", note: "מבקש לבטל, יש לו אירוע" },
  { id: "p2", start: H(16), end: H(16, 30), customer: "רונית דאהר", service: "תספורת גברים", status: "pending" },
  { id: "a5", start: H(16, 30), end: H(17, 30), customer: "עמית פרידמן", service: "טיפול פנים", status: "confirmed" },
];

export interface DashboardState {
  appointments: LabAppointment[];
}
export const initialDashboard: DashboardState = { appointments: LAB_APPOINTMENTS };

export type DashboardAction =
  | { type: "replace"; appointments: LabAppointment[] }
  | { type: "approve"; id: string }
  | { type: "reject"; id: string }
  | { type: "approveCancellation"; id: string }
  | { type: "declineCancellation"; id: string }
  | { type: "cancel"; id: string }
  | { type: "complete"; id: string }
  | { type: "noShow"; id: string };

function transition(s: DashboardState, id: string, from: LabStatus, to: LabStatus): DashboardState {
  const target = s.appointments.find((a) => a.id === id);
  // State-machine guard (docs/04 §2): only legal transitions are applied; anything else is a no-op.
  if (!target || target.status !== from) return s;
  return { appointments: s.appointments.map((a) => (a.id === id ? { ...a, status: to } : a)) };
}

export function dashboardReducer(s: DashboardState, a: DashboardAction): DashboardState {
  switch (a.type) {
    case "replace":
      return { appointments: a.appointments };
    case "approve":
      return transition(s, a.id, "pending", "confirmed");
    case "reject":
      return transition(s, a.id, "pending", "cancelled");
    case "approveCancellation":
      return transition(s, a.id, "cancellationRequested", "cancelled");
    case "declineCancellation":
      return transition(s, a.id, "cancellationRequested", "confirmed");
    case "cancel": {
      const t = s.appointments.find((x) => x.id === a.id);
      return t && (t.status === "confirmed" || t.status === "pending") ? transition(s, a.id, t.status, "cancelled") : s;
    }
    // NSH-04: a wrong mark can be corrected in either direction (completed <-> noShow), never into or out of anything else.
    case "complete": {
      const t = s.appointments.find((x) => x.id === a.id);
      return t && (t.status === "confirmed" || t.status === "noShow") ? transition(s, a.id, t.status, "completed") : s;
    }
    case "noShow": {
      const t = s.appointments.find((x) => x.id === a.id);
      return t && (t.status === "confirmed" || t.status === "completed") ? transition(s, a.id, t.status, "noShow") : s;
    }
  }
}

const isBusy = (a: LabAppointment) => a.status !== "cancelled";

export interface Window {
  from: number;
  to: number;
}

/** Free time inside each working window (a split day never reports its closed middle as free). */
export function gapsIn(appts: LabAppointment[], windows: Window[], minLength: number): { start: number; end: number }[] {
  return windows.flatMap((w) => computeGaps(appts, w.from, w.to, minLength));
}

export function computeGaps(appts: LabAppointment[], from: number, to: number, minLength: number): { start: number; end: number }[] {
  const busy = appts
    .filter(isBusy)
    .map((a) => ({ start: Math.max(a.start, from), end: Math.min(a.end, to) }))
    .filter((b) => b.end > b.start)
    .sort((x, y) => x.start - y.start);
  const gaps: { start: number; end: number }[] = [];
  let cursor = from;
  for (const b of busy) {
    if (b.start - cursor >= minLength) gaps.push({ start: cursor, end: b.start });
    cursor = Math.max(cursor, b.end);
  }
  if (to - cursor >= minLength) gaps.push({ start: cursor, end: to });
  return gaps;
}

export function statsIn(appts: LabAppointment[], windows: Window[]) {
  const active = appts.filter(isBusy);
  const capacity = windows.reduce((sum, w) => sum + (w.to - w.from), 0);
  const booked = windows.reduce((sum, w) => sum + active.reduce((acc, a) => acc + Math.max(0, Math.min(a.end, w.to) - Math.max(a.start, w.from)), 0), 0);
  return {
    total: active.length,
    pending: active.filter((a) => a.status === "pending").length,
    cancellationRequests: active.filter((a) => a.status === "cancellationRequested").length,
    occupancyPct: capacity === 0 ? 0 : Math.round((booked / capacity) * 100),
  };
}

/** Occupancy of a team: every person's booked minutes inside their own hours over everybody's open minutes (never above 100% because two people work at once). */
export function teamOccupancyPct(people: { appts: LabAppointment[]; windows: Window[] }[]): number {
  let capacity = 0;
  let booked = 0;
  for (const p of people) {
    const active = p.appts.filter(isBusy);
    capacity += p.windows.reduce((sum, w) => sum + (w.to - w.from), 0);
    booked += p.windows.reduce((sum, w) => sum + active.reduce((acc, a) => acc + Math.max(0, Math.min(a.end, w.to) - Math.max(a.start, w.from)), 0), 0);
  }
  return capacity === 0 ? 0 : Math.round((booked / capacity) * 100);
}

export const todayStats = (appts: LabAppointment[], from: number, to: number) => statsIn(appts, [{ from, to }]);

export function ribbonIn(appts: LabAppointment[], windows: Window[]): RibbonSegment[] {
  const segs: RibbonSegment[] = appts
    .filter(isBusy)
    .map((a) => ({ start: a.start, end: a.end, state: a.status === "pending" || a.status === "cancellationRequested" ? ("pending" as const) : ("booked" as const) }));
  for (const g of gapsIn(appts, windows, 1)) segs.push({ start: g.start, end: g.end, state: "free" });
  windows.forEach((w, i) => {
    if (i > 0 && w.from > windows[i - 1].to) segs.push({ start: windows[i - 1].to, end: w.from, state: "closed" });
  });
  return segs.sort((x, y) => x.start - y.start);
}

export const toRibbon = (appts: LabAppointment[], from: number, to: number) => ribbonIn(appts, [{ from, to }]);

export const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 0 ? "" : h === 1 ? "שעה" : h === 2 ? "שעתיים" : `${h} שעות`;
  const mins = m === 0 ? "" : `${m} דק׳`;
  return hours && mins ? `${hours} ו-${mins}` : hours || mins;
}

/** Free time as a person says it: "25 ש׳", "45 דק׳", "2 ש׳ 30 דק׳" (never "25:00", which reads as a clock time). */
export function freeLabel(minutes: number, t: (key: "stats.freeH" | "stats.freeM" | "stats.freeHM", values: { h: number; m: number }) => string): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return t(h === 0 ? "stats.freeM" : m === 0 ? "stats.freeH" : "stats.freeHM", { h, m });
}
