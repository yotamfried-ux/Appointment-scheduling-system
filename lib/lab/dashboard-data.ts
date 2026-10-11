import type { RibbonSegment } from "@/lib/ribbon";

// Prototype data + pure logic for the owner dashboard (stage 1 design lab).
// Real data arrives with the booking module (stage 5); the helpers below are reusable as-is.

export type LabStatus = "confirmed" | "pending" | "cancelled" | "completed" | "cancellationRequested";

export interface LabAppointment {
  id: string;
  start: number; // minutes from midnight
  end: number;
  customer: string;
  service: string;
  status: LabStatus;
  note?: string;
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
  | { type: "approve"; id: string }
  | { type: "reject"; id: string }
  | { type: "approveCancellation"; id: string }
  | { type: "declineCancellation"; id: string };

function transition(s: DashboardState, id: string, from: LabStatus, to: LabStatus): DashboardState {
  const target = s.appointments.find((a) => a.id === id);
  // State-machine guard (docs/04 §2): only legal transitions are applied; anything else is a no-op.
  if (!target || target.status !== from) return s;
  return { appointments: s.appointments.map((a) => (a.id === id ? { ...a, status: to } : a)) };
}

export function dashboardReducer(s: DashboardState, a: DashboardAction): DashboardState {
  switch (a.type) {
    case "approve":
      return transition(s, a.id, "pending", "confirmed");
    case "reject":
      return transition(s, a.id, "pending", "cancelled");
    case "approveCancellation":
      return transition(s, a.id, "cancellationRequested", "cancelled");
    case "declineCancellation":
      return transition(s, a.id, "cancellationRequested", "confirmed");
  }
}

const isBusy = (a: LabAppointment) => a.status !== "cancelled";

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

export function todayStats(appts: LabAppointment[], from: number, to: number) {
  const active = appts.filter(isBusy);
  const booked = active.reduce((sum, a) => sum + (Math.min(a.end, to) - Math.max(a.start, from)), 0);
  return {
    total: active.length,
    pending: active.filter((a) => a.status === "pending").length,
    cancellationRequests: active.filter((a) => a.status === "cancellationRequested").length,
    occupancyPct: Math.round((booked / (to - from)) * 100),
  };
}

export function toRibbon(appts: LabAppointment[], from: number, to: number): RibbonSegment[] {
  const segs: RibbonSegment[] = appts
    .filter(isBusy)
    .map((a) => ({ start: a.start, end: a.end, state: a.status === "pending" || a.status === "cancellationRequested" ? ("pending" as const) : ("booked" as const) }));
  for (const g of computeGaps(appts, from, to, 1)) segs.push({ start: g.start, end: g.end, state: "free" });
  return segs.sort((x, y) => x.start - y.start);
}

export const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = h === 0 ? "" : h === 1 ? "שעה" : h === 2 ? "שעתיים" : `${h} שעות`;
  const mins = m === 0 ? "" : `${m} דק׳`;
  return hours && mins ? `${hours} ו-${mins}` : hours || mins;
}
