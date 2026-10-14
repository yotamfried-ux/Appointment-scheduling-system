// The ONE place where business metrics are defined (RPT-06). The database only groups raw counts by local day × service × status
// (so the time zone is applied once, in SQL); every ratio, sum and label below is defined here and nowhere else.
//
//   appointments   = confirmed + cancellation_requested + completed + no_show      (pending and cancelled are not "booked")
//   revenue        = sum of price of COMPLETED visits only                          (no-shows and cancellations earn nothing)
//   expected       = sum of price of confirmed + cancellation_requested             (booked, not yet closed out)
//   no-show rate   = no_show / (completed + no_show)                                (only visits whose outcome is known)
//   cancel rate    = cancelled / (cancelled + appointments)                         (pending requests are undecided, so excluded)
//   average ticket = revenue / completed
export type StatusKey = "pending" | "confirmed" | "cancellation_requested" | "completed" | "no_show" | "cancelled_by_customer" | "cancelled_by_business";

export interface ReportRow {
  date: string; // local day (business time zone), YYYY-MM-DD
  service: string;
  status: string;
  n: number;
  cents: number;
}

export const STATUS_LABEL_HE: Record<StatusKey, string> = {
  pending: "ממתין לאישור",
  confirmed: "מאושר",
  cancellation_requested: "בקשת ביטול",
  completed: "הושלם",
  no_show: "לא הגיע/ה",
  cancelled_by_customer: "בוטל ע״י הלקוח",
  cancelled_by_business: "בוטל ע״י העסק",
};

const BOOKED = new Set<string>(["confirmed", "cancellation_requested", "completed", "no_show"]);
const EXPECTED = new Set<string>(["confirmed", "cancellation_requested"]);
const CANCELLED = new Set<string>(["cancelled_by_customer", "cancelled_by_business"]);

export interface Kpis {
  appointments: number;
  pending: number;
  completed: number;
  noShows: number;
  cancelled: number;
  revenueCents: number;
  expectedCents: number;
  noShowRate: number | null;
  cancellationRate: number | null;
  avgTicketCents: number | null;
  newCustomers: number;
  returningCustomers: number;
}

export interface DayPoint {
  date: string;
  appointments: number;
  revenueCents: number;
  cancelled: number;
  noShows: number;
}
export interface ServicePoint {
  service: string;
  appointments: number;
  completed: number;
  noShows: number;
  cancelled: number;
  revenueCents: number;
}
export interface Summary {
  kpis: Kpis;
  byDay: DayPoint[];
  byService: ServicePoint[];
  /** Booked appointments per weekday, Sunday = 0. */
  byWeekday: number[];
}

const ratio = (num: number, den: number) => (den > 0 ? num / den : null);

/** Calendar days from..to inclusive, as strings (no time zone arithmetic, so DST cannot skip or repeat a day). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(`${to}T12:00:00Z`);
  for (let t = Date.parse(`${from}T12:00:00Z`); t <= end; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function summarize(rows: ReportRow[], range: { from: string; to: string }, customers: { newCustomers: number; returningCustomers: number }): Summary {
  const days = new Map<string, DayPoint>(daysBetween(range.from, range.to).map((d) => [d, { date: d, appointments: 0, revenueCents: 0, cancelled: 0, noShows: 0 }]));
  const services = new Map<string, ServicePoint>();
  const byWeekday = [0, 0, 0, 0, 0, 0, 0];
  const k = { appointments: 0, pending: 0, completed: 0, noShows: 0, cancelled: 0, revenueCents: 0, expectedCents: 0 };
  for (const r of rows) {
    const day = days.get(r.date);
    if (!day) continue; // outside the requested range: never counted
    const s = services.get(r.service) ?? { service: r.service, appointments: 0, completed: 0, noShows: 0, cancelled: 0, revenueCents: 0 };
    services.set(r.service, s);
    if (BOOKED.has(r.status)) {
      k.appointments += r.n;
      day.appointments += r.n;
      s.appointments += r.n;
      byWeekday[new Date(`${r.date}T12:00:00Z`).getUTCDay()] += r.n;
    }
    if (r.status === "pending") k.pending += r.n;
    if (r.status === "completed") {
      k.completed += r.n;
      k.revenueCents += r.cents;
      day.revenueCents += r.cents;
      s.completed += r.n;
      s.revenueCents += r.cents;
    }
    if (EXPECTED.has(r.status)) k.expectedCents += r.cents;
    if (r.status === "no_show") {
      k.noShows += r.n;
      day.noShows += r.n;
      s.noShows += r.n;
    }
    if (CANCELLED.has(r.status)) {
      k.cancelled += r.n;
      day.cancelled += r.n;
      s.cancelled += r.n;
    }
  }
  return {
    kpis: {
      ...k,
      noShowRate: ratio(k.noShows, k.completed + k.noShows),
      cancellationRate: ratio(k.cancelled, k.cancelled + k.appointments),
      avgTicketCents: k.completed > 0 ? Math.round(k.revenueCents / k.completed) : null,
      newCustomers: customers.newCustomers,
      returningCustomers: customers.returningCustomers,
    },
    byDay: [...days.values()],
    byService: [...services.values()].sort((a, b) => b.revenueCents - a.revenueCents || b.appointments - a.appointments || a.service.localeCompare(b.service, "he")),
    byWeekday,
  };
}

/** Shekels with agorot only when there are any: ₪1,234 / ₪80.50. */
export const formatMoney = (cents: number) =>
  new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);

/** 0.1234 → "12.3%", 0.5 → "50%", null → "—". */
export const formatPercent = (r: number | null) => (r === null ? "—" : `${Math.round(r * 1000) / 10}%`);

// ---------------------------------------------------------------- periods
export type Preset = "7d" | "30d" | "90d" | "month" | "lastMonth";

/** Resolve a period to local calendar days, given today's local date. */
export function resolvePeriod(today: string, preset: Preset): { from: string; to: string } {
  const [y, m] = today.split("-").map(Number);
  const iso = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const shift = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  switch (preset) {
    case "7d": return { from: shift(today, -6), to: today };
    case "30d": return { from: shift(today, -29), to: today };
    case "90d": return { from: shift(today, -89), to: today };
    case "month": return { from: iso(y, m, 1), to: today };
    case "lastMonth": {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
      return { from: iso(py, pm, 1), to: iso(py, pm, last) };
    }
  }
}
