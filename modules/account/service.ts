import "server-only";
import { fail } from "@/lib/api/http";
import { mapError, type OwnerCtx } from "@/modules/booking/owner/service";
import { STATUS_LABEL_HE, type StatusKey } from "@/modules/reports/metrics";
import { SOURCE_LABEL_HE } from "@/modules/reports/service";
import { buildXlsx } from "@/modules/reports/xlsx";
import { BUSINESS_KINDS, type BusinessKindId } from "@/modules/tenancy/business-kind";
import { zonedParts } from "@/platform/clock";

const WEEKDAYS_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
const fmtMin = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// ACC-09. Owner only (the database checks it too).
export function requireOwner(ctx: OwnerCtx) {
  if (ctx.role !== "owner") throw fail("FORBIDDEN", "רק בעל העסק יכול לייצא או למחוק את החשבון.");
}

export async function exportAccount(ctx: OwnerCtx): Promise<{ filename: string; body: string }> {
  requireOwner(ctx);
  const { data, error } = await ctx.supabase.rpc("owner_export_account", { p_business: ctx.business.id });
  if (error) throw mapError(error);
  const day = new Date().toISOString().slice(0, 10);
  return { filename: `account-export-${day}.json`, body: JSON.stringify(data, null, 2) };
}

export async function exportAccountXlsx(ctx: OwnerCtx): Promise<{ filename: string; body: Uint8Array }> {
  requireOwner(ctx);
  const { data, error } = await ctx.supabase.rpc("owner_export_account", { p_business: ctx.business.id });
  if (error) throw mapError(error);
  const doc = (data ?? {}) as {
    exportedAt?: string;
    business?: Record<string, unknown>;
    services?: Record<string, unknown>[];
    availabilityRules?: Record<string, unknown>[];
    availabilityExceptions?: Record<string, unknown>[];
    customers?: Record<string, unknown>[];
    appointments?: Record<string, unknown>[];
    waitlist?: Record<string, unknown>[];
  };

  const tz = String(doc.business?.timezone ?? ctx.business.timezone ?? "Asia/Jerusalem");
  const dateTime = (iso: unknown) => {
    if (!iso || typeof iso !== "string") return ["", ""] as const;
    const p = zonedParts(new Date(iso), tz);
    return [p.date, fmtMin(p.minutes)] as const;
  };

  const b = doc.business ?? {};
  const kindLabel = BUSINESS_KINDS[String(b.kind ?? "") as BusinessKindId]?.label ?? String(b.kind ?? "");
  const businessRows: (string | number)[][] = [
    ["שם העסק", String(b.name ?? "")],
    ["סוג העסק", kindLabel],
    ["כתובת קישור (Slug)", String(b.slug ?? "")],
    ["טלפון", String(b.phone ?? "")],
    ["כתובת", String(b.address ?? "")],
    ["אזור זמן", tz],
    ["נדרש אישור ידני לתורים", b.requires_approval ? "כן" : "לא"],
    ["ביטול/שינוי עד (שעות לפני)", Number(b.cancel_until_hours ?? 12)],
    ["הודעה מראש מינימלית (דקות)", Number(b.min_notice_minutes ?? 60)],
    ["טווח הזמנה קדימה (ימים)", Number(b.booking_horizon_days ?? 60)],
    ["תאריך ייצוא", doc.exportedAt ? dateTime(doc.exportedAt).join(" ") : new Date().toISOString().slice(0, 10)],
  ];

  const servicesRows = (doc.services ?? []).map((s) => [
    String(s.name ?? ""),
    Number(s.duration_minutes ?? 0),
    Number(s.buffer_minutes ?? 0),
    Number(s.price_cents ?? 0) / 100,
    s.active ? "פעיל" : "בארכיון",
  ]);

  const rulesRows = (doc.availabilityRules ?? []).map((r) => [
    WEEKDAYS_HE[Number(r.weekday ?? 0)] ?? String(r.weekday ?? ""),
    fmtMin(Number(r.start_minute ?? 0)),
    fmtMin(Number(r.end_minute ?? 0)),
  ]);

  const customerMap = new Map<string, { name: string; phone: string }>();
  const customersRows = (doc.customers ?? []).map((c) => {
    const id = String(c.id ?? "");
    const name = String(c.fullName ?? "");
    const phone = String(c.phone ?? "");
    customerMap.set(id, { name, phone });
    return [
      name,
      phone,
      String(c.email ?? ""),
      String(c.notes ?? ""),
      c.createdAt ? dateTime(c.createdAt)[0] : "",
    ];
  });

  const appointmentsRows = (doc.appointments ?? []).map((a) => {
    const [d, t] = dateTime(a.startsAt);
    const svc = (a.service as { name?: string } | null)?.name ?? "";
    const status = String(a.status ?? "");
    const cust = customerMap.get(String(a.customerId ?? ""));
    const source = String(a.source ?? "");
    return [
      String(a.reference ?? ""),
      d,
      t,
      svc,
      STATUS_LABEL_HE[status as StatusKey] ?? status,
      Number(a.priceCents ?? 0) / 100,
      cust?.name ?? "",
      cust?.phone ?? "",
       String(a.contactEmail ?? ""),
      SOURCE_LABEL_HE[source] ?? source,
      String(a.ownerNote ?? ""),
    ];
  });

  const waitlistStatusHe: Record<string, string> = {
    waiting: "ממתין/ה",
    offered: "הוצע תור",
    booked: "נקבע תור",
    cancelled: "בוטל",
  };
  const waitlistRows = (doc.waitlist ?? []).map((w) => {
    const cust = customerMap.get(String(w.customerId ?? ""));
    const st = String(w.status ?? "");
    return [
      String(w.onDate ?? ""),
      waitlistStatusHe[st] ?? st,
      cust?.name ?? "",
      cust?.phone ?? "",
      w.createdAt ? dateTime(w.createdAt)[0] : "",
    ];
  });

  const day = new Date().toISOString().slice(0, 10);
  const workbook = buildXlsx([
    { name: "פרטי העסק", headers: ["שדה", "ערך"], rows: businessRows },
    { name: "שירותים", headers: ["שם השירות", "משך (דק׳)", "הפסקה אחרי (דק׳)", "מחיר (₪)", "סטטוס"], rows: servicesRows },
    { name: "שעות פעילות", headers: ["יום בשבוע", "משעה", "עד שעה"], rows: rulesRows },
    { name: "לקוחות", headers: ["שם מלא", "טלפון", "אימייל", "הערות", "תאריך הצטרפות"], rows: customersRows },
    { name: "תורים", headers: ["אסמכתא", "תאריך", "שעה", "שירות", "סטטוס", "מחיר (₪)", "לקוח", "טלפון", "אימייל", "מקור", "הערת עסק"], rows: appointmentsRows },
    { name: "רשימת המתנה", headers: ["תאריך מבוקש", "סטטוס", "לקוח", "טלפון", "תאריך רישום"], rows: waitlistRows },
  ]);

  return { filename: `account-export-${day}.xlsx`, body: workbook };
}

export type DeletionOutcome = { outcome: "requested" | "already"; scheduledFor: string; appointmentsCancelled?: number } | { outcome: "cancelled" | "not_pending" };

export async function requestDeletion(ctx: OwnerCtx, confirmName: string): Promise<DeletionOutcome> {
  requireOwner(ctx);
  const { data, error } = await ctx.supabase.rpc("request_business_deletion", { p_business: ctx.business.id, p_confirm_name: confirmName });
  if (error) {
    if (error.message.includes("confirmation_mismatch")) throw fail("VALIDATION_FAILED", "שם העסק שהוקלד אינו תואם.", [{ field: "confirmName", message: "הקלידו את שם העסק בדיוק כפי שהוא מופיע." }]);
    throw mapError(error);
  }
  return data as DeletionOutcome;
}

export async function cancelDeletion(ctx: OwnerCtx): Promise<DeletionOutcome> {
  requireOwner(ctx);
  const { data, error } = await ctx.supabase.rpc("cancel_business_deletion", { p_business: ctx.business.id });
  if (error) throw mapError(error);
  return data as DeletionOutcome;
}

export async function deletionStatus(ctx: OwnerCtx): Promise<{ scheduledFor: string } | null> {
  const { data } = await ctx.supabase.from("businesses").select("deletion_scheduled_for").eq("id", ctx.business.id).single();
  return data?.deletion_scheduled_for ? { scheduledFor: data.deletion_scheduled_for as string } : null;
}
