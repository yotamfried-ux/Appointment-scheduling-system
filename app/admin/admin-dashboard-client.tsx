"use client";

import React, { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { AdminBusiness, AdminSystemError, DashboardMetrics } from "@/modules/admin/types";

export interface AdminDashboardClientProps {
  metrics: DashboardMetrics;
  businesses: AdminBusiness[];
  errors: AdminSystemError[];
  operatorEmail: string;
}

interface ChecklistItem {
  id: string;
  category: string;
  label: string;
}

const CHECKLIST_CRITERIA: ChecklistItem[] = [
  // 1. Security & Permissions
  { id: "sec_1", category: "אבטחה והרשאות", label: "גישה ללא התחברות לדשבורד הניהול נחסמת בשרת" },
  { id: "sec_2", category: "אבטחה והרשאות", label: "חשבון רגיל אינו יכול לגשת לנתוני עסק אחר, גם באמצעות שינוי מזהים בבקשה" },
  { id: "sec_3", category: "אבטחה והרשאות", label: "הרשאת מנהל נקבעת לפי מזהה משתמש מאומת והרשאה שרתית, ולא לפי כתובת אימייל בלבד" },
  { id: "sec_4", category: "אבטחה והרשאות", label: "RLS, בדיקות CSRF, Rate Limiting וסריקת סודות עוברות" },
  { id: "sec_5", category: "אבטחה והרשאות", label: "בדיקת חדירה בסביבת בדיקה אינה משאירה ממצאים קריטיים או גבוהים פתוחים" },

  // 2. Booking Engine & Availability
  { id: "book_1", category: "מנוע הזמנות וזמינות", label: "50 בקשות מקבילות לאותו סלוט יוצרות תור אחד בלבד" },
  { id: "book_2", category: "מנוע הזמנות וזמינות", label: "שליחה חוזרת עם אותו Idempotency Key אינה יוצרת תור נוסף" },
  { id: "book_3", category: "מנוע הזמנות וזמינות", label: "מעברי שעון קיץ/חורף וגבולות שעות נבדקים" },
  { id: "book_4", category: "מנוע הזמנות וזמינות", label: "ביטול, שינוי מועד ורשימת המתנה שומרים על עקביות הנתונים" },
  { id: "book_5", category: "מנוע הזמנות וזמינות", label: "כשל באמצע פעולה אינו משאיר מצב חלקי או שגוי" },

  // 3. Notifications & Background Processes
  { id: "notif_1", category: "הודעות ותהליכי רקע", label: "הרשמת עסק יוצרת אירוע התראה אחד" },
  { id: "notif_2", category: "הודעות ותהליכי רקע", label: "ההתראה נשלחת לכתובת שהוגדרה, בלי לחשוף סודות" },
  { id: "notif_3", category: "הודעות ותהליכי רקע", label: "כשל ב־Resend גורר Retry ולא אובדן אירוע" },
  { id: "notif_4", category: "הודעות ותהליכי רקע", label: "הרצה חוזרת אינה יוצרת הודעות כפולות" },
  { id: "notif_5", category: "הודעות ותהליכי רקע", label: "תזכורות וביטולים נשלחים בזמן הנכון ונרשמים ביומן פעילות" },

  // 4. Production Environment
  { id: "prod_1", category: "סביבת Production", label: "משתני הסביבה והגדרות Auth נבדקים בלי להציג ערכים סודיים" },
  { id: "prod_2", category: "סביבת Production", label: "מיגרציות עוברות על סביבת בדיקה נקייה" },
  { id: "prod_3", category: "סביבת Production", label: "שחזור מגיבוי נבדק בפועל" },
  { id: "prod_4", category: "סביבת Production", label: "קיימים ניטור, התראות, Health Checks ונוהל Rollback" },
  { id: "prod_5", category: "סביבת Production", label: "כל תרחישי הליבה עוברים ב־Preview עם שירותים אמיתיים" },

  // 5. UX, Accessibility & Privacy
  { id: "ux_1", category: "UX, נגישות ופרטיות", label: "בעל עסק חדש מסיים אונבורדינג ללא התערבות מפתח" },
  { id: "ux_2", category: "UX, נגישות ופרטיות", label: "לקוח משלים הזמנה במובייל בגדלי מסך נפוצים" },
  { id: "ux_3", category: "UX, נגישות ופרטיות", label: "בדיקות axe ומקלדת אינן מגלות חסמי נגישות קריטיים" },
  { id: "ux_4", category: "UX, נגישות ופרטיות", label: "קיימות פעולות ייצוא ומחיקת מידע מאומתות" },
  { id: "ux_5", category: "UX, נגישות ופרטיות", label: "נבדקו חובות גילוי, הסכמה, שמירה ומזעור נתונים לפי הדין החל" },

  // 6. Analytics & Admin Dashboard
  { id: "an_1", category: "אנליטיקה ודשבורד מנהל", label: "כל אירוע ליבה נרשם פעם אחת עם מזהה ייחודי וזמן שרת" },
  { id: "an_2", category: "אנליטיקה ודשבורד מנהל", label: "מספרי הדשבורד תואמים שאילתות ישירות למסד הנתונים" },
  { id: "an_3", category: "אנליטיקה ודשבורד מנהל", label: "משפך הרשמה ואונבורדינג מחושב נכון, כולל סינון תאריכים" },
  { id: "an_4", category: "אנליטיקה ודשבורד מנהל", label: "משתמש ללא הרשאת מנהל אינו מקבל נתוני אנליטיקה מה־API" },
  { id: "an_5", category: "אנליטיקה ודשבורד מנהל", label: "נתונים אישיים אינם נשלחים לשירותי אנליטיקה חיצוניים ללא צורך ובסיס מתאים" },

  // 7. Pilot & Release Gate
  { id: "pilot_1", category: "פיילוט ואישור שחרור", label: "CI מלא ירוק על הקומיט המיועד לשחרור" },
  { id: "pilot_2", category: "פיילוט ואישור שחרור", label: "בדיקות E2E ותרחישי P0 עוברות עם ראיות" },
  { id: "pilot_3", category: "פיילוט ואישור שחרור", label: "2–3 עסקים מבצעים פעולות אמיתיות במערכת" },
  { id: "pilot_4", category: "פיילוט ואישור שחרור", label: "אין תקלות P0 פתוחות וכל סיכון שיורי מתועד" },
  { id: "pilot_5", category: "פיילוט ואישור שחרור", label: "דוח Qualification כולל PASS/FAIL/BLOCKED, קישורי ראיות ואישור מפעיל" },
];

export function AdminDashboardClient({
  metrics,
  businesses,
  errors,
  operatorEmail,
}: AdminDashboardClientProps) {
  const [activeTab, setActiveTab] = useState<"overview" | "directory" | "errors" | "checklist">("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "draft">("all");
  const [copiedChecklist, setCopiedChecklist] = useState(false);

  // Persistent checklist state via localStorage
  const [checkedItems, setCheckedItems] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const saved = localStorage.getItem("tori_admin_checklist");
      if (saved) {
        setCheckedItems(JSON.parse(saved));
      }
    } catch {
      // ignore storage failure
    }
  }, []);

  const toggleChecklistItem = (id: string) => {
    setCheckedItems((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem("tori_admin_checklist", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const completedCount = useMemo(() => {
    return CHECKLIST_CRITERIA.filter((c) => checkedItems[c.id]).length;
  }, [checkedItems]);

  const filteredBusinesses = useMemo(() => {
    return businesses.filter((b) => {
      const matchSearch =
        !searchTerm.trim() ||
        b.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        b.slug.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (b.owner_email && b.owner_email.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && b.published_at !== null) ||
        (statusFilter === "draft" && b.published_at === null);

      return matchSearch && matchStatus;
    });
  }, [businesses, searchTerm, statusFilter]);

  const maxWeeklyCount = useMemo(() => {
    const counts = metrics.registrationsOverTime.map((w) => w.count);
    return Math.max(...counts, 1);
  }, [metrics.registrationsOverTime]);

  const handleCopyChecklist = () => {
    const lines = ["# דוח אימות מוכנות לשחרור - ניהול יומן ותורים", "", `סטטוס כללי: ${completedCount}/35 קריטריונים הושלמו`, ""];
    const categories = Array.from(new Set(CHECKLIST_CRITERIA.map((c) => c.category)));
    for (const cat of categories) {
      lines.push(`## ${cat}`);
      const items = CHECKLIST_CRITERIA.filter((c) => c.category === cat);
      for (const item of items) {
        const isChecked = checkedItems[item.id] ? "[x]" : "[ ]";
        lines.push(`- ${isChecked} ${item.label}`);
      }
      lines.push("");
    }
    navigator.clipboard.writeText(lines.join("\n"));
    setCopiedChecklist(true);
    setTimeout(() => setCopiedChecklist(false), 2500);
  };

  return (
    <div className="space-y-8" dir="rtl">
      {/* Top Header Card */}
      <div className="flex flex-col gap-4 rounded-xl border bg-card p-6 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">ניהול יומן ותורים - לוח מנהל פלטפורמה</h1>
            <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
              סביבת ניהול מאובטחת
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            גישה מורשית בלבד עבור: <span className="font-semibold text-foreground">{operatorEmail}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" asChild>
            <a href="/api/admin/export" download>
              <svg className="ml-2 h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              ייצוא נתונים (CSV)
            </a>
          </Button>
          <Button variant="default" size="sm" onClick={() => window.location.reload()}>
            רענן נתונים
          </Button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b">
        <nav className="flex space-x-2 space-x-reverse" aria-label="Tabs">
          <button
            onClick={() => setActiveTab("overview")}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "overview" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            סקירת פעילות ומדדים
          </button>
          <button
            onClick={() => setActiveTab("directory")}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "directory" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            ספריית עסקים ({businesses.length})
          </button>
          <button
            onClick={() => setActiveTab("errors")}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "errors" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            שגיאות ותקלות מערכת ({errors.length})
          </button>
          <button
            onClick={() => setActiveTab("checklist")}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === "checklist" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            צ'קליסט אימות שחרור ({completedCount}/35)
          </button>
        </nav>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* 4 KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>עסקים רשומים</CardDescription>
                <CardTitle className="text-3xl font-bold">{metrics.totalBusinesses}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-primary">+{metrics.newBusinesses}</span> ב-30 הימים האחרונים
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>עסקים פעילים</CardDescription>
                <CardTitle className="text-3xl font-bold">{metrics.activeBusinesses}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-primary">{metrics.activePercentage}%</span> מכלל העסקים
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>תורים החודש</CardDescription>
                <CardTitle className="text-3xl font-bold">{metrics.bookingsInPeriod}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  <span className="font-semibold text-primary">
                    {metrics.bookingsGrowth >= 0 ? `+${metrics.bookingsGrowth}%` : `${metrics.bookingsGrowth}%`}
                  </span>{" "}
                  בהשוואה לתקופה קודמת
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>הזמנות שהושלמו</CardDescription>
                <CardTitle className="text-3xl font-bold">{metrics.completedPercentage}%</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">ללא ביטולי לקוח או עסק</p>
              </CardContent>
            </Card>
          </div>

          {/* Registrations Chart + Funnel */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Timeline */}
            <Card>
              <CardHeader>
                <CardTitle>הרשמות עסקים לאורך זמן</CardTitle>
                <CardDescription>כמות עסקים חדשים שהצטרפו ב-6 השבועות האחרונים</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex h-56 items-end gap-3 pt-6">
                  {metrics.registrationsOverTime.map((week, idx) => {
                    const heightPct = Math.round((week.count / maxWeeklyCount) * 100);
                    return (
                      <div key={idx} className="flex flex-1 flex-col items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">{week.count}</span>
                        <div className="w-full rounded-t-md bg-primary/20 transition-all hover:bg-primary/40" style={{ height: `${Math.max(heightPct, 8)}%` }}>
                          <div className="h-full w-full rounded-t-md bg-primary" style={{ opacity: heightPct > 0 ? 0.9 : 0.2 }} />
                        </div>
                        <span className="text-[11px] text-muted-foreground">{week.period}</span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Funnel */}
            <Card>
              <CardHeader>
                <CardTitle>משפך הפעלת עסקים</CardTitle>
                <CardDescription>אחוז המעבר של עסקים משלב ההרשמה ועד לקבלת תור ראשון</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Step 1 */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-medium">
                    <span>1. הרשמה למערכת</span>
                    <span>{metrics.funnel.registered} (100%)</span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: "100%" }} />
                  </div>
                </div>

                {/* Step 2 */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-medium">
                    <span>2. הגדרת שירות ראשון</span>
                    <span>
                      {metrics.funnel.serviceCreated} ({metrics.funnel.servicePercentage}%)
                    </span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary/80" style={{ width: `${metrics.funnel.servicePercentage}%` }} />
                  </div>
                </div>

                {/* Step 3 */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-medium">
                    <span>3. פרסום דף הזמנות</span>
                    <span>
                      {metrics.funnel.pagePublished} ({metrics.funnel.publishedPercentage}%)
                    </span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary/65" style={{ width: `${metrics.funnel.publishedPercentage}%` }} />
                  </div>
                </div>

                {/* Step 4 */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-medium">
                    <span>4. קבלת תור ראשון ביומן</span>
                    <span>
                      {metrics.funnel.firstBooking} ({metrics.funnel.firstBookingPercentage}%)
                    </span>
                  </div>
                  <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary/50" style={{ width: `${metrics.funnel.firstBookingPercentage}%` }} />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* TAB 2: DIRECTORY */}
      {activeTab === "directory" && (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>ספריית העסקים בפלטפורמה</CardTitle>
                <CardDescription>נתוני פעילות, אחוזי ביטולים ומצב הגדרות לכל עסק (ללא חשיפת פרטי לקוחות)</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" asChild>
                  <a href="/api/admin/export" download>
                    ייצוא CSV
                  </a>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filter controls */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                placeholder="חיפוש לפי שם עסק, כתובת slug או אימייל..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-xs"
              />
              <div className="flex items-center gap-1">
                <Button
                  variant={statusFilter === "all" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter("all")}
                >
                  הכול ({businesses.length})
                </Button>
                <Button
                  variant={statusFilter === "active" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter("active")}
                >
                  פורסמו ({businesses.filter((b) => b.published_at).length})
                </Button>
                <Button
                  variant={statusFilter === "draft" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setStatusFilter("draft")}
                >
                  טיוטות ({businesses.filter((b) => !b.published_at).length})
                </Button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-right text-sm">
                <thead className="border-b bg-muted/40 font-semibold text-muted-foreground">
                  <tr>
                    <th className="p-3">עסק</th>
                    <th className="p-3">תחום</th>
                    <th className="p-3">אימייל בעלים</th>
                    <th className="p-3">סטטוס</th>
                    <th className="p-3">תאריך הקמה</th>
                    <th className="p-3">סה״כ תורים</th>
                    <th className="p-3">שיעור ביטולים</th>
                    <th className="p-3">שירותים / צוות</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredBusinesses.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-6 text-center text-muted-foreground">
                        לא נמצאו עסקים התואמים את החיפוש.
                      </td>
                    </tr>
                  ) : (
                    filteredBusinesses.map((b) => (
                      <tr key={b.id} className="transition-colors hover:bg-muted/20">
                        <td className="p-3">
                          <div className="font-semibold text-foreground">{b.name}</div>
                          <Link href={`/book/${b.slug}`} target="_blank" className="text-xs text-primary underline">
                            /book/{b.slug}
                          </Link>
                        </td>
                        <td className="p-3 text-muted-foreground">{b.kind}</td>
                        <td className="p-3 text-muted-foreground">{b.owner_email ?? "—"}</td>
                        <td className="p-3">
                          {b.published_at ? (
                            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600">
                              פורסם
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-600">
                              טיוטה
                            </Badge>
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">{new Date(b.created_at).toLocaleDateString("he-IL")}</td>
                        <td className="p-3 font-semibold text-foreground">{b.total_appointments}</td>
                        <td className="p-3">
                          <span className={b.cancellation_rate > 20 ? "font-semibold text-amber-600" : "text-muted-foreground"}>
                            {b.cancellation_rate}%
                          </span>
                        </td>
                        <td className="p-3 text-xs text-muted-foreground">
                          {b.services_count} שירותים · {b.staff_count} צוות
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* TAB 3: SYSTEM ERRORS */}
      {activeTab === "errors" && (
        <Card>
          <CardHeader>
            <CardTitle>יומן שגיאות ותקלות מערכת</CardTitle>
            <CardDescription>תקלות הודעות, אירועי outbox ושגיאות job (ללא חשיפת פרטי לקוחות)</CardDescription>
          </CardHeader>
          <CardContent>
            {errors.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">אין שגיאות מערכת שנרשמו לאחרונה. הכול תקין!</div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-right text-sm">
                  <thead className="border-b bg-muted/40 font-semibold text-muted-foreground">
                    <tr>
                      <th className="p-3">קטגוריה</th>
                      <th className="p-3">סוג אירוע</th>
                      <th className="p-3">עסק קשור</th>
                      <th className="p-3">פירוט שגיאה</th>
                      <th className="p-3">תאריך</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {errors.map((err) => (
                      <tr key={err.id} className="transition-colors hover:bg-muted/20">
                        <td className="p-3">
                          <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-600">
                            {err.category}
                          </Badge>
                        </td>
                        <td className="p-3 font-medium text-foreground">{err.type}</td>
                        <td className="p-3 text-muted-foreground">{err.business_name}</td>
                        <td className="p-3 font-mono text-xs text-red-500">{err.error_message}</td>
                        <td className="p-3 text-xs text-muted-foreground">{new Date(err.created_at).toLocaleString("he-IL")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* TAB 4: 35-CRITERIA CHECKLIST */}
      {activeTab === "checklist" && (
        <div className="space-y-6">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>צ'קליסט אימות שחרור (35 קריטריונים ב-7 תחומים)</CardTitle>
                <CardDescription>אימות טכני ומדיד של כל רכיב במערכת לפני אישור שחרור</CardDescription>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="px-3 py-1 text-sm font-bold">
                  {completedCount} / 35 הושלמו
                </Badge>
                <Button variant="default" size="sm" onClick={handleCopyChecklist}>
                  {copiedChecklist ? "הועתק ללוח!" : "העתק דוח Markdown"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${Math.round((completedCount / 35) * 100)}%` }}
                />
              </div>
            </CardContent>
          </Card>

          {/* 7 Categories */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {Array.from(new Set(CHECKLIST_CRITERIA.map((c) => c.category))).map((categoryName) => {
              const categoryItems = CHECKLIST_CRITERIA.filter((c) => c.category === categoryName);
              const catCompleted = categoryItems.filter((c) => checkedItems[c.id]).length;

              return (
                <Card key={categoryName} className="flex flex-col justify-between">
                  <div>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base font-bold text-foreground">{categoryName}</CardTitle>
                        <Badge variant="secondary" className="text-xs">
                          {catCompleted} / {categoryItems.length}
                        </Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {categoryItems.map((item) => (
                        <label
                          key={item.id}
                          className="flex cursor-pointer items-start gap-3 rounded-md p-2 transition-colors hover:bg-muted/40"
                        >
                          <input
                            type="checkbox"
                            checked={Boolean(checkedItems[item.id])}
                            onChange={() => toggleChecklistItem(item.id)}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                          />
                          <span
                            className={`text-sm ${
                              checkedItems[item.id] ? "text-muted-foreground line-through" : "text-foreground"
                            }`}
                          >
                            {item.label}
                          </span>
                        </label>
                      ))}
                    </CardContent>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
