import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isPlatformAdmin, listBusinesses } from "@/modules/admin/service";

function escapeCsvField(val: string | number | boolean | null | undefined): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

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
    escapeCsvField(b.id),
    escapeCsvField(b.name),
    escapeCsvField(b.slug),
    escapeCsvField(b.kind),
    escapeCsvField(b.phone),
    escapeCsvField(b.owner_email),
    escapeCsvField(b.published_at ? "פורסם" : "טיוטה"),
    escapeCsvField(b.created_at),
    escapeCsvField(b.published_at),
    escapeCsvField(b.total_appointments),
    escapeCsvField(b.cancelled_appointments),
    escapeCsvField(`${b.cancellation_rate}%`),
    escapeCsvField(b.services_count),
    escapeCsvField(b.staff_count),
    escapeCsvField(b.waitlist_enabled ? "כן" : "לא"),
  ]);

  const csvContent = "\uFEFF" + [headers.map((h) => `"${h}"`).join(","), ...rows.map((r) => r.join(","))].join("\r\n");

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
