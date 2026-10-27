import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin, listBusinesses } from "@/modules/admin/service";
import { BOM, csvRow } from "@/modules/reports/csv";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const isAdmin = await isPlatformAdmin(supabase);
  if (!isAdmin) {
    return new NextResponse("Forbidden: Platform administrator privilege required", { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") ?? undefined;
  const status = searchParams.get("status") ?? undefined;
  const from = searchParams.get("from") ?? undefined;
  const to = searchParams.get("to") ?? undefined;

  const businesses = await listBusinesses(supabase, {
    search,
    status,
    from,
    to,
    limit: 5000,
  });

  const headers = [
    "מזהה עסק",
    "שם עסק",
    "כתובת קישור (slug)",
    "תחום פעילות",
    "טלפון",
    "אימייל בעלים",
    "סטטוס",
    "תאריך הרשמה",
    "תאריך פרסום",
    "סה״כ תורים",
    "תורים שבוטלו",
    "אחוז ביטולים",
    "מספר שירותים",
    "אנשי צוות",
    "רשימת המתנה פעילה",
  ];

  const rows = businesses.map((b) => [
    b.id,
    b.name,
    b.slug,
    b.kind,
    b.phone,
    b.owner_email,
    b.published_at ? "פורסם" : "טיוטה",
    b.created_at,
    b.published_at,
    b.total_appointments,
    b.cancelled_appointments,
    `${b.cancellation_rate}%`,
    b.services_count,
    b.staff_count,
    b.waitlist_enabled ? "כן" : "לא",
  ]);

  const csvContent = BOM + csvRow(headers) + rows.map(csvRow).join("");

  const nowStr = new Date().toISOString().slice(0, 10);
  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tori-businesses-${nowStr}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
