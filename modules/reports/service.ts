import "server-only";
import { fail } from "@/lib/api/http";
import { requireFeature } from "@/modules/billing/entitlements";
import { mapError, type OwnerCtx } from "@/modules/booking/owner/service";
import { addDaysIso } from "@/modules/availability/slots";
import { zonedParts, zonedTimeToUtc } from "@/platform/clock";
import { BOM, csvRow } from "./csv";
import { STATUS_LABEL_HE, summarize, type ReportRow, type StatusKey, type Summary } from "./metrics";
import { buildXlsx } from "./xlsx";

export const MAX_RANGE_DAYS = 400;

export const SOURCE_LABEL_HE: Record<string, string> = {
  online: "הזמנה באתר",
  manual: "יומן העסק",
  waitlist: "רשימת המתנה",
};

/** Report numbers: SQL groups raw counts by local day × service × status, `summarize` (the one metric module) turns them into figures. */
export async function report(ctx: OwnerCtx, from: string, to: string): Promise<Summary & { range: { from: string; to: string }; timezone: string }> {
  const { data, error } = await ctx.supabase.rpc("owner_report", { p_business: ctx.business.id, p_from: from, p_to: to });
  if (error) {
    if (error.code === "23514") throw fail("VALIDATION_FAILED", "טווח התאריכים אינו תקין (עד 400 יום).");
    throw mapError(error);
  }
  if (!data) throw fail("NOT_FOUND", "לא נמצא.");
  const r = data as { timezone: string; rows: ReportRow[]; newCustomers: number; returningCustomers: number };
  return { ...summarize(r.rows, { from, to }, r), range: { from, to }, timezone: r.timezone };
}

// ---------------------------------------------------------------- exports (admin only, streamed)
const PAGE = 1000;

export function requireAdmin(ctx: OwnerCtx) {
  if (ctx.role !== "admin" && ctx.role !== "owner") throw fail("FORBIDDEN", "רק מנהל העסק יכול לייצא נתונים.");
}

async function audit(ctx: OwnerCtx, kind: "customers" | "appointments", rows: number) {
  const { error } = await ctx.supabase.rpc("export_audit", { p_business: ctx.business.id, p_kind: kind, p_rows: rows });
  if (error) throw mapError(error);
}

/** Wraps a page-by-page generator into a CSV byte stream; memory stays flat however many rows there are. */
function stream(header: string[], pages: AsyncGenerator<unknown[][]>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let started = false;
  return new ReadableStream({
    async pull(controller) {
      try {
        if (!started) {
          started = true;
          controller.enqueue(enc.encode(BOM + csvRow(header)));
        }
        const next = await pages.next();
        if (next.done) return controller.close();
        controller.enqueue(enc.encode(next.value.map(csvRow).join("")));
      } catch (e) {
        controller.error(e);
      }
    },
    async cancel() {
      await pages.return(undefined);
    },
  });
}

const dateTime = (iso: string, tz: string) => {
  const p = zonedParts(new Date(iso), tz);
  return [p.date, `${String(Math.floor(p.minutes / 60)).padStart(2, "0")}:${String(p.minutes % 60).padStart(2, "0")}`] as const;
};

const CUSTOMER_HEADERS = ["שם", "טלפון", "אימייל", "נוצר", "ביקורים", "לא הגיע/ה", "ביטולים", "ביקור אחרון", "סה״כ שולם (₪)"];
const APPOINTMENT_HEADERS = ["אסמכתא", "תאריך", "שעה", "שירות", "סטטוס", "מחיר (₪)", "לקוח", "טלפון", "מקור"];

export async function exportCustomers(ctx: OwnerCtx): Promise<{ filename: string; body: ReadableStream<Uint8Array> }> {
  requireAdmin(ctx);
  await requireFeature(ctx, "export");
  const { count, error } = await ctx.supabase.from("customers").select("id", { count: "exact", head: true }).eq("business_id", ctx.business.id);
  if (error) throw mapError(error);
  await audit(ctx, "customers", count ?? 0); // recorded before any data leaves
  async function* pages() {
    let after: string | null = null;
    for (;;) {
      const { data, error: e } = await ctx.supabase.rpc("owner_customers_page", { p_business: ctx.business.id, p_after: after, p_limit: PAGE });
      if (e) throw new Error("export failed");
      const rows = (data ?? []) as { id: string; full_name: string; phone: string; email: string | null; created_at: string; visits: number; no_shows: number; cancellations: number; last_visit: string | null; spent_cents: number | string }[];
      if (!rows.length) return;
      yield rows.map((r) => [r.full_name, r.phone, r.email ?? "", r.created_at.slice(0, 10), r.visits, r.no_shows, r.cancellations, r.last_visit ? dateTime(r.last_visit, ctx.business.timezone)[0] : "", Number(r.spent_cents) / 100]);
      after = rows[rows.length - 1].id;
      if (rows.length < PAGE) return;
    }
  }
  return { filename: "customers.csv", body: stream(CUSTOMER_HEADERS, pages()) };
}

export async function exportCustomersXlsx(ctx: OwnerCtx): Promise<{ filename: string; body: Uint8Array }> {
  requireAdmin(ctx);
  await requireFeature(ctx, "export");
  const { count, error } = await ctx.supabase.from("customers").select("id", { count: "exact", head: true }).eq("business_id", ctx.business.id);
  if (error) throw mapError(error);
  await audit(ctx, "customers", count ?? 0);
  const allRows: (string | number)[][] = [];
  let after: string | null = null;
  for (;;) {
    const { data, error: e } = await ctx.supabase.rpc("owner_customers_page", { p_business: ctx.business.id, p_after: after, p_limit: PAGE });
    if (e) throw new Error("export failed");
    const rows = (data ?? []) as { id: string; full_name: string; phone: string; email: string | null; created_at: string; visits: number; no_shows: number; cancellations: number; last_visit: string | null; spent_cents: number | string }[];
    if (!rows.length) break;
    for (const r of rows) {
      allRows.push([
        r.full_name,
        r.phone,
        r.email ?? "",
        r.created_at.slice(0, 10),
        r.visits,
        r.no_shows,
        r.cancellations,
        r.last_visit ? dateTime(r.last_visit, ctx.business.timezone)[0] : "",
        Number(r.spent_cents) / 100,
      ]);
    }
    after = rows[rows.length - 1].id;
    if (rows.length < PAGE) break;
  }
  return {
    filename: "customers.xlsx",
    body: buildXlsx([{ name: "לקוחות", headers: CUSTOMER_HEADERS, rows: allRows }]),
  };
}

export async function exportAppointments(ctx: OwnerCtx, from: string, to: string): Promise<{ filename: string; body: ReadableStream<Uint8Array> }> {
  requireAdmin(ctx);
  await requireFeature(ctx, "export");
  const tz = ctx.business.timezone;
  const lo = zonedTimeToUtc(from, 0, tz).toISOString();
  const hi = zonedTimeToUtc(addDaysIso(to, 1), 0, tz).toISOString();
  const { count, error } = await ctx.supabase.from("appointments").select("id", { count: "exact", head: true }).eq("business_id", ctx.business.id).gte("starts_at", lo).lt("starts_at", hi);
  if (error) throw mapError(error);
  await audit(ctx, "appointments", count ?? 0);
  async function* pages() {
    let cursor: { t: string; id: string } | null = null;
    for (;;) {
      let q = ctx.supabase
        .from("appointments")
        .select("id, reference, status, starts_at, price_cents, source, service_snapshot, customers(full_name, phone)")
        .eq("business_id", ctx.business.id)
        .gte("starts_at", lo)
        .lt("starts_at", hi)
        .order("starts_at")
        .order("id")
        .limit(PAGE);
      if (cursor) q = q.or(`starts_at.gt.${cursor.t},and(starts_at.eq.${cursor.t},id.gt.${cursor.id})`);
      const { data, error: e } = await q;
      if (e) throw new Error("export failed");
      const rows = (data ?? []) as unknown as { id: string; reference: string; status: string; starts_at: string; price_cents: number; source: string; service_snapshot: { name: string }; customers: { full_name: string; phone: string } | null }[];
      if (!rows.length) return;
      yield rows.map((r) => {
        const [d, t] = dateTime(r.starts_at, tz);
        return [r.reference, d, t, r.service_snapshot.name, STATUS_LABEL_HE[r.status as StatusKey] ?? r.status, r.price_cents / 100, r.customers?.full_name ?? "", r.customers?.phone ?? "", SOURCE_LABEL_HE[r.source] ?? r.source];
      });
      const last = rows[rows.length - 1];
      cursor = { t: new Date(last.starts_at).toISOString(), id: last.id };
      if (rows.length < PAGE) return;
    }
  }
  return { filename: `appointments-${from}_${to}.csv`, body: stream(APPOINTMENT_HEADERS, pages()) };
}

export async function exportAppointmentsXlsx(ctx: OwnerCtx, from: string, to: string): Promise<{ filename: string; body: Uint8Array }> {
  requireAdmin(ctx);
  await requireFeature(ctx, "export");
  const tz = ctx.business.timezone;
  const lo = zonedTimeToUtc(from, 0, tz).toISOString();
  const hi = zonedTimeToUtc(addDaysIso(to, 1), 0, tz).toISOString();
  const { count, error } = await ctx.supabase.from("appointments").select("id", { count: "exact", head: true }).eq("business_id", ctx.business.id).gte("starts_at", lo).lt("starts_at", hi);
  if (error) throw mapError(error);
  await audit(ctx, "appointments", count ?? 0);
  const allRows: (string | number)[][] = [];
  let cursor: { t: string; id: string } | null = null;
  for (;;) {
    let q = ctx.supabase
      .from("appointments")
      .select("id, reference, status, starts_at, price_cents, source, service_snapshot, customers(full_name, phone)")
      .eq("business_id", ctx.business.id)
      .gte("starts_at", lo)
      .lt("starts_at", hi)
      .order("starts_at")
      .order("id")
      .limit(PAGE);
    if (cursor) q = q.or(`starts_at.gt.${cursor.t},and(starts_at.eq.${cursor.t},id.gt.${cursor.id})`);
    const { data, error: e } = await q;
    if (e) throw new Error("export failed");
    const rows = (data ?? []) as unknown as { id: string; reference: string; status: string; starts_at: string; price_cents: number; source: string; service_snapshot: { name: string }; customers: { full_name: string; phone: string } | null }[];
    if (!rows.length) break;
    for (const r of rows) {
      const [d, t] = dateTime(r.starts_at, tz);
      allRows.push([
        r.reference,
        d,
        t,
        r.service_snapshot.name,
        STATUS_LABEL_HE[r.status as StatusKey] ?? r.status,
        r.price_cents / 100,
        r.customers?.full_name ?? "",
        r.customers?.phone ?? "",
        SOURCE_LABEL_HE[r.source] ?? r.source,
      ]);
    }
    const last = rows[rows.length - 1];
    cursor = { t: new Date(last.starts_at).toISOString(), id: last.id };
    if (rows.length < PAGE) break;
  }
  return {
    filename: `appointments-${from}_${to}.xlsx`,
    body: buildXlsx([{ name: "תורים", headers: APPOINTMENT_HEADERS, rows: allRows }]),
  };
}
