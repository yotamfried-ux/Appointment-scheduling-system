import "server-only";
import { fail } from "@/lib/api/http";
import { mapError, type OwnerCtx } from "@/modules/booking/owner/service";

// Customers are read and changed as the signed-in user: Row Level Security scopes every row to the owner's business,
// the SQL functions do the aggregation, so the numbers shown here and the numbers exported are the same ones.
export const SORTS = ["last_visit", "name", "visits", "spent", "no_shows", "created"] as const;
export type CustomerSort = (typeof SORTS)[number];
export const PAGE_SIZE = 25;

export interface CustomerRow {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  notes: string | null;
  createdAt: string;
  anonymized: boolean;
  visits: number;
  noShows: number;
  noShows60d: number;
  cancellations: number;
  upcoming: number;
  lastVisit: string | null;
  spentCents: number;
}

interface DbRow {
  id: string; full_name: string; phone: string; email: string | null; notes: string | null; created_at: string; anonymized_at: string | null;
  visits: number; no_shows: number; no_shows_60d: number; cancellations: number; upcoming: number; last_visit: string | null; spent_cents: number | string; total: number | string;
}

export async function listCustomers(ctx: OwnerCtx, o: { q?: string; sort?: CustomerSort; page?: number }) {
  const page = Math.max(1, o.page ?? 1);
  const { data, error } = await ctx.supabase.rpc("owner_customers", {
    p_business: ctx.business.id,
    p_search: o.q?.trim() || null,
    p_sort: o.sort ?? "last_visit",
    p_limit: PAGE_SIZE,
    p_offset: (page - 1) * PAGE_SIZE,
  });
  if (error) throw mapError(error);
  const rows = (data ?? []) as DbRow[];
  const items: CustomerRow[] = rows.map((r) => ({
    id: r.id, fullName: r.full_name, phone: r.phone, email: r.email, notes: r.notes, createdAt: r.created_at, anonymized: r.anonymized_at !== null,
    visits: r.visits, noShows: r.no_shows, noShows60d: r.no_shows_60d, cancellations: r.cancellations, upcoming: r.upcoming,
    lastVisit: r.last_visit, spentCents: Number(r.spent_cents),
  }));
  const total = rows.length ? Number(rows[0].total) : 0;
  return { items, total, page, pageSize: PAGE_SIZE, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export interface CustomerDetail {
  customer: { id: string; fullName: string; phone: string; email: string | null; notes: string | null; createdAt: string; anonymizedAt: string | null };
  stats: { visits: number; noShows: number; noShows60d: number; cancellations: number; upcoming: number; spentCents: number };
  appointments: { id: string; reference: string; status: string; startsAt: string; service: string; priceCents: number; source: string }[];
}

export async function customerDetail(ctx: OwnerCtx, id: string): Promise<CustomerDetail> {
  const { data, error } = await ctx.supabase.rpc("owner_customer_detail", { p_customer: id });
  if (error) throw mapError(error);
  if (!data) throw fail("NOT_FOUND", "לא נמצא.");
  return data as CustomerDetail;
}

export async function setNotes(ctx: OwnerCtx, id: string, notes: string): Promise<void> {
  const { error } = await ctx.supabase.rpc("set_customer_notes", { p_customer: id, p_notes: notes });
  if (error) {
    if (error.message.includes("anonymized")) throw fail("INVALID_TRANSITION", "הלקוח הזה כבר נמחק, אי אפשר לערוך הערות.");
    throw mapError(error);
  }
}

export async function anonymize(ctx: OwnerCtx, id: string): Promise<"anonymized" | "already"> {
  const { data, error } = await ctx.supabase.rpc("anonymize_customer", { p_customer: id });
  if (error) throw mapError(error);
  const outcome = (data as { outcome: string } | null)?.outcome;
  if (outcome === "has_upcoming") throw fail("INVALID_TRANSITION", "ללקוח יש תורים עתידיים. בטלו אותם או סיימו אותם ואז נסו שוב.");
  if (outcome === "anonymized" || outcome === "already") return outcome;
  throw new Error("anonymize failed");
}
