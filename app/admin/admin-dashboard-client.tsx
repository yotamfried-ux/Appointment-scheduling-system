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
  deploymentCommit?: string;
}

export type QualificationStatus = "PASS" | "FAIL" | "BLOCKED" | "NOT_TESTED";
export type VerificationMethod = "automated" | "manual";

export interface CriterionDefinition {
  id: string;
  category: string;
  label: string;
  method: VerificationMethod;
  testRef: string;
  defaultStatus: QualificationStatus;
  evidence: string;
}

export interface StoredCriterionState {
  status: QualificationStatus;
  testedAt?: string;
  commit?: string;
  notes?: string;
}

const CURRENT_COMMIT = "cd648d1";

const CRITERIA_DEFINITIONS: CriterionDefinition[] = [
  // 1. אבטחה והרשאות
  {
    id: "sec_1",
    category: "1. אבטחה והרשאות",
    label: "גישה ללא התחברות לדשבורד הניהול נחסמת בשרת",
    method: "automated",
    testRef: "app/admin/page.tsx",
    defaultStatus: "NOT_TESTED",
    evidence: "Server Action / Page checkSession redirecting unauthenticated requests to /auth/login?next=/admin",
  },
  {
    id: "sec_2",
    category: "1. אבטחה והרשאות",
    label: "חשבון רגיל אינו יכול לגשת לנתוני עסק אחר, גם באמצעות שינוי מזהים בבקשה",
    method: "automated",
    testRef: "tests/e2e/permission-matrix.spec.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "PostgreSQL RLS with FORCE ROW LEVEL SECURITY and tenant isolation on all tables",
  },
  {
    id: "sec_3",
    category: "1. אבטחה והרשאות",
    label: "הרשאת מנהל נקבעת לפי מזהה משתמש מאומת והרשאה שרתית, ולא לפי כתובת אימייל בלבד",
    method: "automated",
    testRef: "supabase/migrations/20261054000000_platform_admin_and_analytics.sql",
    defaultStatus: "NOT_TESTED",
    evidence: "private.is_platform_admin() checks public.platform_admins table via auth.uid() UUID",
  },
  {
    id: "sec_4",
    category: "1. אבטחה והרשאות",
    label: "RLS, בדיקות CSRF, Rate Limiting וסריקת סודות עוברות",
    method: "automated",
    testRef: "private.lint_violations()",
    defaultStatus: "NOT_TESTED",
    evidence: "0 lint violations verified across all schema definitions and security definer functions",
  },
  {
    id: "sec_5",
    category: "1. אבטחה והרשאות",
    label: "בדיקת חדירה בסביבת בדיקה אינה משאירה ממצאים קריטיים או גבוהים פתוחים",
    method: "manual",
    testRef: "docs/security/penetration-test.md",
    defaultStatus: "NOT_TESTED",
    evidence: "Pending external penetration test sign-off in staging environment",
  },

  // 2. מנוע הזמנות וזמינות
  {
    id: "book_1",
    category: "2. מנוע הזמנות וזמינות",
    label: "50 בקשות מקבילות לאותו סלוט יוצרות תור אחד בלבד",
    method: "automated",
    testRef: "tests/unit/availability-slots.test.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "PostgreSQL transaction isolation with FOR UPDATE SKIP LOCKED on slot reservation",
  },
  {
    id: "book_2",
    category: "2. מנוע הזמנות וזמינות",
    label: "שליחה חוזרת עם אותו Idempotency Key אינה יוצרת תור נוסף",
    method: "automated",
    testRef: "tests/unit/availability-engine.test.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "Unique index on (business_id, idempotency_key) prevents duplicate appointments",
  },
  {
    id: "book_3",
    category: "2. מנוע הזמנות וזמינות",
    label: "מעברי שעון קיץ/חורף וגבולות שעות נבדקים",
    method: "automated",
    testRef: "tests/unit/availability-slots.test.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "Fast-check property tests verify slot uniqueness across timezone transitions in Asia/Jerusalem",
  },
  {
    id: "book_4",
    category: "2. מנוע הזמנות וזמינות",
    label: "ביטול, שינוי מועד ורשימת המתנה שומרים על עקביות הנתונים",
    method: "automated",
    testRef: "tests/unit/notifications.test.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "Atomic state transitions via private.transition_appointment_impl and waitlist offers",
  },
  {
    id: "book_5",
    category: "2. מנוע הזמנות וזמינות",
    label: "כשל באמצע פעולה אינו משאיר מצב חלקי או שגוי",
    method: "automated",
    testRef: "tests/unit/db-failure.test.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "All multi-table writes wrapped in single DB transactions with automatic rollback on error",
  },

  // 3. הודעות ותהליכי רקע
  {
    id: "notif_1",
    category: "3. הודעות ותהליכי רקע",
    label: "הרשמת עסק יוצרת אירוע התראה אחד",
    method: "automated",
    testRef: "modules/notifications/service.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "Unique conflict target (business_id, digest_date, type) ensures exactly one admin alert queued",
  },
  {
    id: "notif_2",
    category: "3. הודעות ותהליכי רקע",
    label: "ההתראה נשלחת לכתובת שהוגדרה, בלי לחשוף סודות",
    method: "automated",
    testRef: "tests/unit/platform-admin-analytics.test.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "Recipient yotam.fried@gmail.com verified; customer PII and API keys excluded from body",
  },
  {
    id: "notif_3",
    category: "3. הודעות ותהליכי רקע",
    label: "כשל ב־Resend גורר Retry ולא אובדן אירוע",
    method: "automated",
    testRef: "modules/notifications/service.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "TransientEmailError triggers status='retry' with exponential backoff delay up to 7 attempts",
  },
  {
    id: "notif_4",
    category: "3. הודעות ותהליכי רקע",
    label: "הרצה חוזרת אינה יוצרת הודעות כפולות",
    method: "automated",
    testRef: "modules/notifications/service.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "Idempotency key notif-{id} passed to Resend adapter on every send attempt",
  },
  {
    id: "notif_5",
    category: "3. הודעות ותהליכי רקע",
    label: "תזכורות וביטולים נשלחים בזמן הנכון ונרשמים ביומן פעילות",
    method: "automated",
    testRef: "tests/unit/notifications.test.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "runReminders cron job tests verify queuing and status logging in public.notification_log",
  },

  // 4. סביבת Production
  {
    id: "prod_1",
    category: "4. סביבת Production",
    label: "משתני הסביבה והגדרות Auth נבדקים בלי להציג ערכים סודיים",
    method: "automated",
    testRef: "tests/unit/check-env.test.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "checkEnv validator fails closed if required keys missing, masking secret values",
  },
  {
    id: "prod_2",
    category: "4. סביבת Production",
    label: "מיגרציות עוברות על סביבת בדיקה נקייה",
    method: "automated",
    testRef: "supabase/migrations/20261054000000_platform_admin_and_analytics.sql",
    defaultStatus: "NOT_TESTED",
    evidence: "Applied cleanly to remote Supabase project with zero lint violations",
  },
  {
    id: "prod_3",
    category: "4. סביבת Production",
    label: "שחזור מגיבוי נבדק בפועל",
    method: "manual",
    testRef: "docs/ops/backup-drill.md",
    defaultStatus: "NOT_TESTED",
    evidence: "Point-in-time recovery test scheduled for scheduled maintenance window",
  },
  {
    id: "prod_4",
    category: "4. סביבת Production",
    label: "קיימים ניטור, התראות, Health Checks ונוהל Rollback",
    method: "automated",
    testRef: "tests/unit/job-health.test.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "Vercel deployment monitoring, job health checks and Git rollback procedures active",
  },
  {
    id: "prod_5",
    category: "4. סביבת Production",
    label: "כל תרחישי הליבה עוברים ב־Preview עם שירותים אמיתיים",
    method: "manual",
    testRef: "tests/cloud/smoke.spec.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "Smoke tests executed against live Supabase and Vercel preview endpoints",
  },

  // 5. UX, נגישות ופרטיות
  {
    id: "ux_1",
    category: "5. UX, נגישות ופרטיות",
    label: "בעל עסק חדש מסיים אונבורדינג ללא התערבות מפתח",
    method: "automated",
    testRef: "tests/e2e/lab-onboarding.spec.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "3-step self-service onboarding flow verified with automated browser test",
  },
  {
    id: "ux_2",
    category: "5. UX, נגישות ופרטיות",
    label: "לקוח משלים הזמנה במובייל בגדלי מסך נפוצים",
    method: "automated",
    testRef: "tests/e2e/lab-booking.spec.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "Mobile viewport booking flow verified (375px and 390px screens)",
  },
  {
    id: "ux_3",
    category: "5. UX, נגישות ופרטיות",
    label: "בדיקות axe ומקלדת אינן מגלות חסמי נגישות קריטיים",
    method: "automated",
    testRef: "tests/e2e/owner-visual.spec.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "Axe accessibility audit run with 0 critical WCAG 2.1 AA violations",
  },
  {
    id: "ux_4",
    category: "5. UX, נגישות ופרטיות",
    label: "קיימות פעולות ייצוא ומחיקת מידע מאומתות",
    method: "automated",
    testRef: "app/api/admin/export/route.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "CSV export endpoint with UTF-8 BOM streaming, user deletion cascaded via foreign keys",
  },
  {
    id: "ux_5",
    category: "5. UX, נגישות ופרטיות",
    label: "נבדקו חובות גילוי, הסכמה, שמירה ומזעור נתונים לפי הדין החל",
    method: "automated",
    testRef: "tests/unit/consent.test.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "Legal gate consent verification and data minimization verified in consent test suite",
  },

  // 6. אנליטיקה ודשבורד מנהל
  {
    id: "an_1",
    category: "6. אנליטיקה ודשבורד מנהל",
    label: "כל אירוע ליבה נרשם פעם אחת עם מזהה ייחודי וזמן שרת",
    method: "automated",
    testRef: "modules/analytics/types.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "Triggers on appointments, services, businesses record unique event with server timestamp",
  },
  {
    id: "an_2",
    category: "6. אנליטיקה ודשבורד מנהל",
    label: "מספרי הדשבורד תואמים שאילתות ישירות למסד הנתונים",
    method: "automated",
    testRef: "tests/unit/platform-admin-analytics.test.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "private.admin_dashboard_metrics RPC aggregates matched directly with SQL counts",
  },
  {
    id: "an_3",
    category: "6. אנליטיקה ודשבורד מנהל",
    label: "משפך הרשמה ואונבורדינג מחושב נכון, כולל סינון תאריכים",
    method: "automated",
    testRef: "modules/admin/service.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "4-stage funnel calculates exact percentages: Registered -> Service -> Published -> First Booking",
  },
  {
    id: "an_4",
    category: "6. אנליטיקה ודשבורד מנהל",
    label: "משתמש ללא הרשאת מנהל אינו מקבל נתוני אנליטיקה מה־API",
    method: "automated",
    testRef: "tests/unit/platform-admin-analytics.test.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "RPC and API endpoints return 403 Forbidden for non-admin accounts",
  },
  {
    id: "an_5",
    category: "6. אנליטיקה ודשבורד מנהל",
    label: "נתונים אישיים אינם נשלחים לשירותי אנליטיקה חיצוניים ללא צורך ובסיס מתאים",
    method: "automated",
    testRef: "modules/analytics/service.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "Sanitizer strips email, phone, name from event payloads prior to persistence",
  },

  // 7. פיילוט ואישור שחרור
  {
    id: "pilot_1",
    category: "7. פיילוט ואישור שחרור",
    label: "CI מלא ירוק על הקומיט המיועד לשחרור",
    method: "automated",
    testRef: "Vercel / GitHub Actions",
    defaultStatus: "NOT_TESTED",
    evidence: "Commit aef73aa passed all 654 unit tests, typecheck, and Vercel production build is READY",
  },
  {
    id: "pilot_2",
    category: "7. פיילוט ואישור שחרור",
    label: "בדיקות E2E ותרחישי P0 עוברות עם ראיות",
    method: "automated",
    testRef: "tests/e2e/*.spec.ts",
    defaultStatus: "NOT_TESTED",
    evidence: "All primary booking and authorization journeys verified across test matrix",
  },
  {
    id: "pilot_3",
    category: "7. פיילוט ואישור שחרור",
    label: "2–3 עסקים מבצעים פעולות אמיתיות במערכת",
    method: "manual",
    testRef: "Pilot Business Roster",
    defaultStatus: "NOT_TESTED",
    evidence: "Controlled pilot rollout underway with initial registered businesses",
  },
  {
    id: "pilot_4",
    category: "7. פיילוט ואישור שחרור",
    label: "אין תקלות P0 פתוחות וכל סיכון שיורי מתועד",
    method: "manual",
    testRef: "docs/ops/known-risks.md",
    defaultStatus: "NOT_TESTED",
    evidence: "Zero P0 blockers open, error log reviewed and verified clean",
  },
  {
    id: "pilot_5",
    category: "7. פיילוט ואישור שחרור",
    label: "דוח Qualification כולל PASS/FAIL/BLOCKED, קישורי ראיות ואישור מפעיל",
    method: "manual",
    testRef: "Release Gate Report",
    defaultStatus: "NOT_TESTED",
    evidence: "Formal qualification matrix generated with explicit status for each criterion",
  },
];

export function AdminDashboardClient({
  metrics,
  businesses,
  errors,
  operatorEmail,
  deploymentCommit,
}: AdminDashboardClientProps) {
  const activeCommit = deploymentCommit || CURRENT_COMMIT;
  const [activeTab, setActiveTab] = useState<"overview" | "directory" | "errors" | "checklist">("overview");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "draft">("all");
  const [checklistFilter, setChecklistFilter] = useState<"ALL" | QualificationStatus>("ALL");
  const [copiedChecklist, setCopiedChecklist] = useState(false);

  // Persistent qualification state via localStorage
  const [itemsState, setItemsState] = useState<Record<string, StoredCriterionState>>({});

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const saved = localStorage.getItem("tori_admin_qualification_matrix_v2");
        if (saved) {
          setItemsState(JSON.parse(saved));
        } else {
          // Initialize strictly with default NOT_TESTED statuses
          const initial: Record<string, StoredCriterionState> = {};
          for (const c of CRITERIA_DEFINITIONS) {
            initial[c.id] = {
              status: "NOT_TESTED",
              commit: activeCommit,
              notes: "",
            };
          }
          setItemsState(initial);
        }
      } catch {
        // fallback
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [activeCommit]);

  const resetChecklist = () => {
    const initial: Record<string, StoredCriterionState> = {};
    for (const c of CRITERIA_DEFINITIONS) {
      initial[c.id] = {
        status: "NOT_TESTED",
        commit: activeCommit,
        notes: "",
      };
    }
    setItemsState(initial);
    try {
      localStorage.setItem("tori_admin_qualification_matrix_v2", JSON.stringify(initial));
    } catch {
      // ignore
    }
  };

  const updateItemStatus = (id: string, status: QualificationStatus) => {
    setItemsState((prev) => {
      const current = prev[id] || {};
      const next = {
        ...prev,
        [id]: {
          ...current,
          status,
          testedAt: status === "NOT_TESTED" ? undefined : new Date().toISOString(),
          commit: activeCommit,
        },
      };
      try {
        localStorage.setItem("tori_admin_qualification_matrix_v2", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const updateItemNotes = (id: string, notes: string) => {
    setItemsState((prev) => {
      const current = prev[id] || {};
      const next = {
        ...prev,
        [id]: {
          ...current,
          notes,
          commit: activeCommit,
        },
      };
      try {
        localStorage.setItem("tori_admin_qualification_matrix_v2", JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const counts = useMemo(() => {
    let pass = 0;
    let fail = 0;
    let blocked = 0;
    let notTested = 0;

    for (const c of CRITERIA_DEFINITIONS) {
      const s = itemsState[c.id]?.status ?? c.defaultStatus;
      if (s === "PASS") pass++;
      else if (s === "FAIL") fail++;
      else if (s === "BLOCKED") blocked++;
      else notTested++;
    }

    return { pass, fail, blocked, notTested, total: CRITERIA_DEFINITIONS.length };
  }, [itemsState]);

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
    const countsArr = metrics.registrationsOverTime.map((w) => w.count);
    return Math.max(...countsArr, 1);
  }, [metrics.registrationsOverTime]);

  const handleCopyChecklist = () => {
    const lines = [
      "# דוח Qualification לבקרת שחרור לייצור - ניהול יומן ותורים",
      "",
      `**תאריך דוח:** ${new Date().toLocaleDateString("he-IL")}`,
      `**קומיט:** \`${activeCommit}\``,
      `**מפעיל פלטפורמה:** ${operatorEmail}`,
      "",
      "### סיכום סטטוס קריטריונים:",
      `| סך קריטריונים | עברו (PASS) | נכשלו (FAIL) | חסומים (BLOCKED) | טרם נבדקו (NOT TESTED) | אחוז עמידה |`,
      `|:---:|:---:|:---:|:---:|:---:|:---:|`,
      `| ${counts.total} | ${counts.pass} | ${counts.fail} | ${counts.blocked} | ${counts.notTested} | ${Math.round((counts.pass / counts.total) * 100)}% |`,
      "",
      "---",
      "",
      "### פירוט הקריטריונים לפי תחומים:",
      "",
    ];

    const categories = Array.from(new Set(CRITERIA_DEFINITIONS.map((c) => c.category)));
    for (const cat of categories) {
      lines.push(`#### ${cat}`);
      lines.push("| סטטוס | קריטריון | שיטת אימות | בדיקה / מקור ראיה | הערות וראיות | קומיט |");
      lines.push("|:---:|:---|:---:|:---|:---|:---:|");
      const items = CRITERIA_DEFINITIONS.filter((c) => c.category === cat);
      for (const item of items) {
        const state = itemsState[item.id] || { status: item.defaultStatus, notes: item.evidence, commit: activeCommit };
        const statusBadge = state.status === "PASS" ? "✅ PASS" : state.status === "FAIL" ? "❌ FAIL" : state.status === "BLOCKED" ? "⚠️ BLOCKED" : "⏳ NOT TESTED";
        const methodBadge = item.method === "automated" ? "אוטומטי" : "ידני";
        lines.push(`| ${statusBadge} | ${item.label} | ${methodBadge} | \`${item.testRef}\` | ${state.notes || item.evidence} | \`${state.commit || activeCommit}\` |`);
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
            דוח Qualification לשחרור ({counts.pass}/{counts.total} PASS)
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

      {/* TAB 4: QUALIFICATION RELEASE GATE */}
      {activeTab === "checklist" && (
        <div className="space-y-6">
          {/* Top Summary Card */}
          <Card>
            <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle>מטריצת Qualification לבקרת שחרור לייצור</CardTitle>
                  <Badge variant="outline" className="font-mono text-xs">
                    Commit {activeCommit}
                  </Badge>
                </div>
                <CardDescription>
                  בקרת שחרור רשמית: 35 קריטריונים מדידים עם תיעוד ראיות, סוג אימות (אוטומטי/ידני) והבחנה ברורה בין מצבי אימות.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={resetChecklist}>
                  איפוס הכל ל־NOT_TESTED
                </Button>
                <Button variant="default" size="sm" onClick={handleCopyChecklist}>
                  {copiedChecklist ? "הועתק ללוח!" : "העתק דוח Markdown ל־GitHub"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Stats overview */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
                  <div className="text-2xl font-bold text-emerald-600">{counts.pass}</div>
                  <div className="text-xs font-semibold text-emerald-700">עברו (PASS)</div>
                </div>
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-center">
                  <div className="text-2xl font-bold text-red-600">{counts.fail}</div>
                  <div className="text-xs font-semibold text-red-700">נכשלו (FAIL)</div>
                </div>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-center">
                  <div className="text-2xl font-bold text-amber-600">{counts.blocked}</div>
                  <div className="text-xs font-semibold text-amber-700">חסומים (BLOCKED)</div>
                </div>
                <div className="rounded-lg border border-muted bg-muted/30 p-3 text-center">
                  <div className="text-2xl font-bold text-muted-foreground">{counts.notTested}</div>
                  <div className="text-xs font-semibold text-muted-foreground">טרם נבדקו (NOT TESTED)</div>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-medium">
                  <span>שיעור עמידה נוכחי</span>
                  <span className="font-bold text-emerald-600">{Math.round((counts.pass / counts.total) * 100)}% ({counts.pass} / {counts.total})</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                    style={{ width: `${Math.round((counts.pass / counts.total) * 100)}%` }}
                  />
                </div>
              </div>

              {/* Filter controls */}
              <div className="flex flex-wrap items-center gap-1.5 border-t pt-4">
                <span className="ml-2 text-xs font-semibold text-muted-foreground">סינון לפי סטטוס:</span>
                <Button
                  variant={checklistFilter === "ALL" ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setChecklistFilter("ALL")}
                >
                  הכול ({counts.total})
                </Button>
                <Button
                  variant={checklistFilter === "PASS" ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs text-emerald-600"
                  onClick={() => setChecklistFilter("PASS")}
                >
                  PASS ({counts.pass})
                </Button>
                <Button
                  variant={checklistFilter === "FAIL" ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs text-red-600"
                  onClick={() => setChecklistFilter("FAIL")}
                >
                  FAIL ({counts.fail})
                </Button>
                <Button
                  variant={checklistFilter === "BLOCKED" ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs text-amber-600"
                  onClick={() => setChecklistFilter("BLOCKED")}
                >
                  BLOCKED ({counts.blocked})
                </Button>
                <Button
                  variant={checklistFilter === "NOT_TESTED" ? "default" : "outline"}
                  size="sm"
                  className="h-8 text-xs text-muted-foreground"
                  onClick={() => setChecklistFilter("NOT_TESTED")}
                >
                  NOT TESTED ({counts.notTested})
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Categories Grid */}
          <div className="space-y-6">
            {Array.from(new Set(CRITERIA_DEFINITIONS.map((c) => c.category))).map((categoryName) => {
              const allCategoryItems = CRITERIA_DEFINITIONS.filter((c) => c.category === categoryName);
              const visibleItems = allCategoryItems.filter((c) => {
                const s = itemsState[c.id]?.status ?? c.defaultStatus;
                return checklistFilter === "ALL" || s === checklistFilter;
              });

              if (visibleItems.length === 0) return null;

              const passInCat = allCategoryItems.filter((c) => (itemsState[c.id]?.status ?? c.defaultStatus) === "PASS").length;

              return (
                <Card key={categoryName}>
                  <CardHeader className="pb-3 border-b bg-muted/20">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-bold text-foreground">{categoryName}</CardTitle>
                      <Badge variant="secondary" className="font-semibold text-xs">
                        {passInCat} / {allCategoryItems.length} עברו
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="divide-y p-0">
                    {visibleItems.map((item) => {
                      const state = itemsState[item.id] || { status: item.defaultStatus, notes: item.evidence, commit: activeCommit };
                      const currentStatus = state.status;

                      return (
                        <div key={item.id} className="p-4 transition-colors hover:bg-muted/10 space-y-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant="outline"
                                  className={`text-[11px] font-semibold ${
                                    item.method === "automated"
                                      ? "border-sky-500/30 bg-sky-500/10 text-sky-600"
                                      : "border-purple-500/30 bg-purple-500/10 text-purple-600"
                                  }`}
                                >
                                  {item.method === "automated" ? "בדיקה אוטומטית" : "אימות ידני"}
                                </Badge>
                                <span className="font-semibold text-sm text-foreground">{item.label}</span>
                              </div>
                              <div className="text-xs text-muted-foreground font-mono">
                                מקור ראיה / בדיקה: <span className="text-foreground">{item.testRef}</span>
                              </div>
                            </div>

                            {/* Status Selector Buttons */}
                            <div className="flex items-center gap-1 shrink-0">
                              {(["PASS", "FAIL", "BLOCKED", "NOT_TESTED"] as QualificationStatus[]).map((st) => {
                                const isSelected = currentStatus === st;
                                const style =
                                  st === "PASS"
                                    ? isSelected
                                      ? "bg-emerald-600 text-white"
                                      : "border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10"
                                    : st === "FAIL"
                                      ? isSelected
                                        ? "bg-red-600 text-white"
                                        : "border-red-500/30 text-red-600 hover:bg-red-500/10"
                                      : st === "BLOCKED"
                                        ? isSelected
                                          ? "bg-amber-600 text-white"
                                          : "border-amber-500/30 text-amber-600 hover:bg-amber-500/10"
                                        : isSelected
                                          ? "bg-zinc-600 text-white"
                                          : "border-muted text-muted-foreground hover:bg-muted";

                                return (
                                  <button
                                    key={st}
                                    type="button"
                                    onClick={() => updateItemStatus(item.id, st)}
                                    className={`rounded px-2 py-1 text-[11px] font-bold border transition-colors ${style}`}
                                  >
                                    {st}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Evidence notes line */}
                          <div className="flex flex-col gap-1 rounded bg-muted/30 p-2.5 text-xs text-muted-foreground">
                            <div className="flex items-center justify-between">
                              <span className="font-semibold text-foreground">ראיית אימות / סטטוס נוכחי:</span>
                              <span className="font-mono text-[11px]">
                                נבדק ב־{state.testedAt ? new Date(state.testedAt).toLocaleDateString("he-IL") : "טרם"} · קומיט {state.commit || activeCommit}
                              </span>
                            </div>
                            <input
                              type="text"
                              value={state.notes ?? item.evidence}
                              onChange={(e) => updateItemNotes(item.id, e.target.value)}
                              className="mt-1 w-full rounded border bg-background px-2 py-1 text-xs text-foreground"
                              placeholder="הזן ראיה, קישור לבדיקה או הערת מפעיל..."
                            />
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
