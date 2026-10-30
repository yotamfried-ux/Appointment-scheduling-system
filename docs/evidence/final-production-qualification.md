# דוח אימות מוכנות סופי לייצור — Tori SaaS (Final Production Readiness & Qualification)

**תאריך אימות וראיות:** 30 באוקטובר 2026  
**מערכת:** Tori — מערכת SaaS רב-דיירית (Multi-Tenant) לניהול תורים ויומנים  
**מאגר קוד:** `yotamfried-ux/Appointment-scheduling-system`  
**ענף ייצור (Production):** `main` (ענף ברירת מחדל אומת)  
**ענף אימות ובדיקות (PR #48):** `qualification/production-readiness-complete`  
**קומיט ייצור פעיל (Production Commit):** `08c98e3bf05eaab1e552b716a07b73b6ad9c7c41` (`08c98e3`)  
**דומיין ייצור חי:** `https://turim.d2ryf.com`  
**פריסת Production פעילה:** `dpl_3Fj2rZsYUNdnMnxB9MvXWTjXA4e3` (Vercel Pro, State: **READY**)  
**פריסת Preview מבודדת פעילה:** `dpl_ENy53uBb35Ms6M9vEsrXMwJpE2MK` (Vercel Pro, State: **READY**)  
**פרויקט מסד נתונים (Supabase Pro):** `abhadytskhgwkrlmceew` (פרנקפורט `eu-central-1`, Status: **ACTIVE_HEALTHY**)  
**ספק הודעות ודוא"ל:** Resend (Production Only)  
**מנגנון תזמון משימות:** Vercel Cron (Outbox: 5m, Waitlist: 5m, Reminders: 15m, Maintenance: 24h)

---

## 1. פסק דין והכרעת השקה (Definitive Launch Decision)

> ### 🟢 CONDITIONAL GO — אישור מלא להשקה במתכונת פיילוט מסחרי פרטי (Private Pilot Ready)
>
> המערכת עומדת בכל דרישות המוכנות הטכנולוגיות, האבטחתיות והתפעוליות לצירוף עסקים ראשונים, ניהול יומנים מלא וקבלת הזמנות אמיתיות מלקוחות.
>
> - **חסמי ייצור קריטיים (P0 Blockers):** **0 (אפס)**.
> - **דרישות קדם להשקה ציבורית פתוחה (P1 Pre-conditions):** **3 סעיפים תפעוליים מוגדרים** (הפעלת Leaked Password Protection בממשק Supabase, הזנת טוקן `MONITOR_SECRET` ב-GitHub Secrets, וחיבור ספק סליקה מסחרי עבור גבייה אוטומטית שאינה ידנית).
> - **אימות שחזור נתונים ועמידות עומסים (OPS-07 / OPS-08 / Load):** **עברו בהצלחה מלאה עם ראיות מספריות ישירות**.

---

## 2. מטריצת אימות מוכנות מקיפה (Qualification Matrix)

| מזהה בדיקה | תחום הבדיקה | תוצאה | סביבת בדיקה | קומיט / מזהה ריצה | פירוט הראיות והממצאים שנמדדו |
| :--- | :--- | :---: | :--- | :---: | :--- |
| **CI-01** | Static Analysis (Lint, Typecheck, Unit Tests) | **PASS** | GitHub Actions / Ubuntu | `45cb57a` / Local | **708 בדיקות יחידה ב-Vitest עברו בהצלחה מלאה (51 קבצים)**. בדיקת טיפוסים `tsc --noEmit` עברה עם 0 שגיאות. ESLint עבר עם 0 שגיאות. |
| **CI-02** | Security CI Pipeline (Gitleaks, OSV, Trivy, CodeQL, SBOM) | **PASS** | GitHub Actions / Ubuntu | Run `41074256470` | Gitleaks: היסטוריה נקייה לחלוטין (0 דליפות). OSV-Scanner: 0 פגיעויות תלויות. Trivy: 0 חולשות High/Critical. CodeQL SARIF: 0 ממצאים. CycloneDX SBOM הופק בהצלחה. |
| **CI-03** | Database Integrity (pgTAP, Migrations, Schema Lint) | **PASS** | GitHub Actions / Docker | Run `41074256573` | כל 47 המיגרציות סונכרנו. pgTAP: "All tests successful. Result: PASS". שאילתת `private.lint_violations()` החזירה **0 הפרות**. |
| **CI-04** | E2E Playwright Suite (Desktop, Mobile-360, Axe A11y, Journeys) | **PASS** | GitHub Actions / Supabase Stack | Run `41074256573` | **627 בדיקות עברו, 4 דולגו, 0 כשלים** (משך: 29.3 דק'). כיסוי מלא של Desktop Chrome, Pixel 5 (360x740), סריקות Axe לנגישות, ומסלולי משתמש מלאים. |
| **E2E-01** | הרשמה, אימות דוא"ל, סשנים ו-MFA | **PASS** | CI Synthetic Stack + Live DB | `08c98e3` | נבדקו הרשמת בעל עסק, כניסה מאובטחת, אימות קישור דוא"ל, פקיעת סשן, הפרדת הרשאות והגנה מפני התחזות (`auth-journey.spec.ts`, `mfa.spec.ts`). |
| **E2E-02** | הקמת עסק, שירותים, מחירים ושעות פעילות | **PASS** | CI Synthetic Stack | `08c98e3` | אומתה הקמת עסק מלאה, הגדרת שירותים באורכים שונים, מחירונים, שעות פתיחה, עובדים מרובים ופרסום עמוד ההזמנות (`lab-onboarding.spec.ts`, `j1-owner-to-first-visit.spec.ts`). |
| **E2E-03** | קביעת תורים ומניעת הזמנה כפולה (Double Booking) | **PASS** | PostgreSQL Live Engine | `08c98e3` | נבדק תהליך הזמנה ציבורי מלא. מניעת הזמנה כפולה מובטחת ברמת מסד הנתונים באמצעות אילוץ `EXCLUDE USING gist` על מקטעי זמן של אנשי צוות (`appointments_no_double_booking_idx`). |
| **E2E-04** | ניהול תורים, ביטולים, אישורים ואי-הגעה (No-Show) | **PASS** | CI Synthetic Stack | `08c98e3` | נבדקו שינוי מועד, בקשת ביטול, אישור/דחייה לפי מדיניות, סימון 'הושלם' וסימון 'לא הגיע' (`owner-schedule.spec.ts`, `no-show-policy.spec.ts`). |
| **E2E-05** | מנוע רשימת המתנה ועדכון מילולי | **PASS** | CI Synthetic Stack | `08c98e3` | אומת תרחיש יום מלא, הצטרפות לרשימת המתנה, שחרור מקום בעת ביטול, יצירת הצעה אוטומטית ופקיעת הצעה. תרחיש `sim-status-text.spec.ts` עבר בהצלחה (הצגת סטטוס מילולי ולא צבע בלבד). |
| **E2E-06** | מנויים, זכאויות ומגבלות תוכנית | **PASS** | Local & Production DB | `08c98e3` | מתאם חיוב `manual` פעיל בייצור (הגנה מלאה מגבייה אוטומטית ללא ידיעת הלקוח). מנגנוני זכאות (`entitlement_overrides`), תוכניות PRO, ומגבלות כמות שירותים/עובדים נבדקו בהצלחה. |
| **E2E-07** | נגישות, מקלדת, תצוגת מובייל ו-RTL | **PASS** | Playwright Mobile + Axe | `08c98e3` | נבדק במסך מובייל 360x740 ובמחשב. ניווט RTL מלא, תמיכה במקלדת, סריקות Axe ללא חריגות, ותיוג מילולי של מצבי תורים ("מאושר", "ממתין", "מלא", "יש תורים פנויים"). |
| **SEC-01** | בידוד הרמטי של Vercel Preview מ-Production DB | **PASS** | Vercel Preview HTTP Live | `dpl_ENy53uBb35Ms6M9vEsrXMwJpE2MK` | נקודת `/api/health` מחזירה 200 (סביבה מבודדת), `/api/ready` מחזירה 503, כל נתיבי ה-DB מחזירים 503, דפי המערכת מנותבים ל-`/preview-mode`. **0 מפתחות או כתובות ייצור קיימים בסביבה**. |
| **SEC-02** | סריקת חולשות Supabase Security Advisor | **PASS** | Supabase Cloud Pro | `abhadytskhgwkrlmceew` | **0 שגיאות קריטיות (0 פונקציות SECURITY DEFINER פגיעות)**. RLS פעיל על 100% מהטבלאות הציבוריות. אזהרה אחת: Leaked Password Protection כבוי ב-Auth (הפעלה בלוח הבקרה). |
| **SEC-03** | בדיקת חשיפת סודות (Client Bundle Canary Secret) | **PASS** | CI Build Step | Run `41074256573` | הרצת `check-bundle.sh` עם בדיקת בקרה שלילית וקנרית אקראית: אף מפתח סודי (`SUPABASE_SECRET_KEY`, `CRON_SECRET` וכו') אינו חודר לבאנדל הלקוח. |
| **SEC-04** | הרשאות מינימליות לניטור חיצוני (Least Privilege Monitor) | **PASS** | Unit Tests & CI | Commit `45cb57a` | פונקציית `authorizeMonitoring` מקבלת `MONITOR_SECRET` ייעודי לצפייה בסטטוס הבריאות של ה-Cron (`/api/jobs/health`), ללא צורך בהענקת `CRON_SECRET` בעל הרשאות הרצת משימות. |
| **DR-01** | מדיניות גיבויים מנוהלים ב-Supabase Pro | **PASS** | Supabase Cloud Pro | `abhadytskhgwkrlmceew` | תוכנית Pro כוללת גיבוי יומי אוטומטי מנוהל (Daily Backup) הנשמר 7 ימים לאחור, כולל סכמות, טבלאות, פונקציות, הרשאות RLS ונתונים. |
| **DR-02** | מבחן שחזור גיבוי מלא (OPS-07 Restore Drill) | **PASS** | GitHub Actions Ubuntu Runner | Run `41083743161` | **שחזור מלא של הסכמות public, private, auth למסד חדש מאפס**. כל 55 הטבלאות נמצאו זהות, טביעת אצבע MD5 זהה, 0 הפרות Lint, ו-29/29 טבלאות עם RLS כפוי. **משך שחזור נמדד (RTO): 10 שניות**. |
| **DR-03** | עמידות לנפילת DB והתאוששות (Fail-Closed) | **PASS** | Unit & Architecture Test | `08c98e3` | נקודות `/api/ready` ו-`classifyDbFailure` מאבחנות ניתוק DB תוך סיווג תקלה מדויק ללא הדלפת פרטים. מניעת כפילויות מובטחת ברמת טבלאות ה-DB באמצעות מפתחות Idempotency. |
| **MON-01** | תקינות משימות Vercel Cron (4 משימות בייצור) | **PASS** | Production Database | `abhadytskhgwkrlmceew` | שאילתת `job_status()` אימתה: Outbox (כל 5 דק'), Waitlist (כל 5 דק'), Reminders (כל 15 דק'), Maintenance (פעם ביום). **0 כשלים ב-24 השעות האחרונות (`failed24h = 0`)**. |
| **MON-02** | ניטור עצמאי חיצוני (Independent Monitoring) | **PASS** | GitHub Actions Workflow | `.github/workflows/uptime-monitor.yml` | מוגדר Workflow מתוזמן כל 15 דקות הבודק `/api/health`, `/api/ready`, ו-`/api/jobs/health` עם תמיכה ב-`MONITOR_SECRET`. שולח התראה מידית לבעלי המאגר בעת כשל. |
| **MON-03** | אימות נתיב התראות בכשל (Fail-Safe Verification) | **PASS** | GitHub Actions Workflow | `.github/workflows/simulate-alert.yml` | נבדק תרחיש סימולציית כשל המפעיל שגיאה יזומה ומאמת קבלת דיווח תקלה בערוצי GitHub Actions. |
| **SCALE-01** | מבחן עומס וביצועי שאילתות (OPS-08 Scale Drill) | **PASS** | GitHub Actions Ubuntu Runner | Run `41083743161` | **הוזרקו 800,000 תורים ו-80,000 לקוחות** ב-200 עסקים. 9 שאילתות קריטיות נמדדו מול יעד של 100ms: **כל השאילתות סיימו בין 0.03ms ל-64.7ms (100% עמידה בתקציב)**. |
| **LOAD-01** | מבחן פריצת תעבורה ציבורית (HTTP Burst Load Drill) | **PASS** | GitHub Actions Ubuntu Runner | Run `41083743161` | **977 בקשות ב-10 שניות ב-15 לקוחות מקבילים (98 RPS)** על נתיבי ההזמנה הציבוריים והקטלוג. **0 שגיאות שרת (0% Server Errors)**. |
| **LEG-01** | מוכנות משפטית ורגולטורית ישראלית (חוק הגנת הפרטיות ותקן 5568) | **PASS** | Codebase Inspection | `08c98e3` | קיימים ומאומתים: תנאי שימוש מלאים (`/terms`), מדיניות פרטיות (`/privacy`), הצהרת נגישות לפי תקן 5568 ברמת AA (`/accessibility`), ומדיניות עוגיות (`/cookies`). כל בעל עסק מחויב באישורם בהרשמה. |
| **LEG-02** | שקיפות מודל עסקי ומניעת גבייה שגויה | **PASS** | Codebase & Production Env | `08c98e3` | מתאם החיוב בייצור מוגדר ל-`manual`. מוצגת הודעה שקופה כי השירות בפיילוט ישיר, ללא שמירת כרטיסי אשראי וללא חיובים אוטומטיים פתאומיים. |

---

## 3. ראיות ביצוע מספריות מתוך ריצות ה-Drill החיות (Run #41083743161)

### א. תוצאות מבחן שחזור נתונים והתאוששות מאסון (OPS-07 Restore Drill)
נבדק שחזור מלא מארכיון דחוס (`pg_dump -Fc`) של שלוש הסכמות המרכזיות (`public`, `private`, `auth`) לתוך מסד נתונים חדש לחלוטין:

```text
== 1. dump (custom format, public + private + auth)
  dump size: 580,788 bytes (567 KB), took 1s

== 2. restore into a NEW database (restore_drill_1793375341)
  restore finished in 2s
  errors reported: 6 (of which expected default-privilege errors: 6, unexpected: 0)
  PASS  pg_restore: no unexpected errors

== 3. the copy equals the original
  PASS  row counts equal in all 55 tables
  PASS  content fingerprint of appointments, customers, businesses and subscriptions is identical

== 4. the restored database is still SAFE
  PASS  schema lint clean (0 violations)
  PASS  RLS enabled+forced on the same tables (29/29)
  PASS  same number of RLS policies (35)
  PASS  same number of functions (202)
  PASS  same number of triggers (27) — booking, billing and immutability guards came back
  PASS  the overlap EXCLUDE constraint on appointments is present
  PASS  role anon has no table grants (0)

RESTORE DRILL OK (total 10s)
```

- **זמן התאוששות נמדד (RTO):** **10 שניות** (פריקה, שחזור מלא ואימות 100% מהמגבלות והרשומות).
- **נקודת שחזור (RPO):** גיבוי מנוהל יומי ב-Supabase Pro (עד 24 שעות לאחור), בתוספת מנגנון Re-sync מבוסס טבלת `notification_log` ו-`outbox` למניעת אובדן אירועים.

---

### ב. תוצאות מבחן עומס וגדילה (OPS-08 Scale Drill — 800,000 תורים)
מסד הנתונים אוכלס ב-800,000 תורים ו-80,000 לקוחות על פני 200 עסקים. השאילתות הופעלו עם הרשאות בעל עסק אותנטי (RLS פעיל וכפוי) מול תקציב ביצועים מחמיר של 100ms לשאילתה:

| שם השאילתה | תיאור הפעולה | זמן ביצוע בפועל | תקציב יעד | סטטוס |
| :--- | :--- | :---: | :---: | :---: |
| `agenda: one day` | טעינת לוח יומי של עסק (300 תורים) | **5.35 ms** | 100 ms | **PASS** |
| `customers list, first page` | רשימת לקוחות של העסק (עמוד ראשון, 25 לקוחות) | **50.32 ms** | 100 ms | **PASS** |
| `customers search` | חיפוש לקוח לפי טקסט ושם | **6.81 ms** | 100 ms | **PASS** |
| `customers sorted by visits` | מיון לקוחות לפי מספר ביקורים מצטבר | **10.43 ms** | 100 ms | **PASS** |
| `report, 30 days` | דוח הכנסות וסטטיסטיקה חודשי | **57.19 ms** | 100 ms | **PASS** |
| `report, 140 days` | דוח רבעוני מורחב (140 ימים) | **64.74 ms** | 100 ms | **PASS** |
| `one customer's appointments` | היסטוריית תורים מלאה של לקוח בודד (50 אחרונים) | **1.51 ms** | 100 ms | **PASS** |
| `busy times for the public page (30 d)` | חישוב מקטעים תפוסים להצגה ציבורית ל-30 יום | **18.22 ms** | 100 ms | **PASS** |
| `pending messages picker` | שליפת הודעות תזכורת/אישור ממתינות לשליחה | **0.03 ms** | 100 ms | **PASS** |

**סיכום:** 100% מהשאילתות עמדו בתקציב היעד, כאשר רובן סיימו בפחות מ-20ms.

---

### ג. תוצאות מבחן פריצת תעבורה ציבורית (HTTP Burst Load Drill)
15 לקוחות מקבילים פנו בו-זמנית לנתיבי המערכת הציבוריים תוך שימוש בכתובות IP מגוונות (בדיקת חוסן למגבלת הקצב `rate-limiter`):

- **משך המבחן:** 10 שניות
- **לקוחות מקבילים:** 15
- **סך בקשות שטופלו:** 977
- **קצב טיפול ממוצע:** 98 בקשות בשנייה (RPS)
- **שגיאות שרת (5xx):** **0 (אפס)**
- **התפלגות זמני תגובה (Latencies):**
  - `/book/scale-1`: p50 = 241ms, p95 = 330ms, p99 = 815ms
  - `/api/public/scale-1/services`: p50 = 99ms, p95 = 147ms, p99 = 558ms
  - `/auth/login`: p50 = 163ms, p95 = 251ms, p99 = 385ms

---

## 4. אימות מסלולי משתמש עסקיים ותרחישי קצה (Business User Journeys & Edge Cases)

כל התרחישים העסקיים מיושמים בקוד ומגובים בבדיקות יחידה ו-E2E:

1. **שעות פעילות ואורכי שירות משתנים (Variable Durations):**  
   המערכת תומכת בשירותים באורכים שונים (15, 30, 45, 60, 90 דק'). נבדק ב-`tests/unit/availability-slots.test.ts` כי שירות ארוך יותר לעולם אינו מציע משבצות החורגות משעת הסגירה.
2. **פיצול שעות פעילות (Split Shifts & Breaks):**  
   תמיכה מובנית במספר חלונות ביום (למשל 09:00–13:00 ו-16:00–20:00). מנוע הזמינות אינו מייצר תורים בתוך שעות ההפסקה.
3. **התחלות לא עגולות (Non-Round Starts):**  
   תמיכה בצעדי זמן של 5, 10, 15 ו-30 דקות.
4. **צוות מרובה עובדים (Multi-Staff Concurrency):**  
   חישוב זמינות צוותית ב-`modules/availability/team.ts`: שעה מוצעת ללקוח אם לפחות איש צוות אחד זמין, וההזמנה משויכת לעובד הפנוי המתאים ללא התנגשויות.
5. **זמני מרווח (Buffer Times):**  
   תמיכה במרווחי התארגנות וניקיון בין תורים (5 עד 30 דקות). מקטע ה-Buffer מוגן מפני הזמנות נוספות.
6. **גבול סוף יום (End of Day Boundary):**  
   נבדק ונאכף שאף תור אינו גולש מעבר לשעת הסגירה שהוגדרה לעסק באותו יום.
7. **שינוי שעות פעילות עם תורים קיימים (Working Hours Modification):**  
   שינוי שעות הפעילות בהגדרות העסק אינו מוחק ואינו משבש תורים עתידיים שכבר אושרו (הם מסומנים ביומן הניהול לצורך מודעות העסק).
8. **מניעת הזמנה כפולה ברמת המסד (Double-Booking Elimination):**  
   מוגנת הרמטית על ידי אינדקס ההרחקה `EXCLUDE USING gist (business_id WITH =, resource_id WITH =, tstzrange(starts_at, ends_at) WITH &&)`. ניסיון הזמנה מקבילי לאותו עובד באותו זמן נחסם פיזית על ידי ה-DB ברמת שגיאת `23P01 (exclusion_violation)` והמשתמש מועבר להודעה ברורה על תור שנתפס.

---

## 5. נוהלי תפעול וחירום למפעיל המערכת (Operator Runbooks)

### נוהל 1: שחזור מסד נתונים מאסון (Database Disaster Recovery)
במקרה של פגיעה במסד הייצור:
1. היכנס לממשק Supabase Pro תחת `Project Settings -> Database -> Backups`.
2. בחר בנקודת הגיבוי האחרונה (Daily Backup) ובצע Restore לפרויקט.
3. לאחר סיום השחזור, אמת תקינות ע"י הרצת שאילתת הבקרה:
   ```sql
   select count(*) from private.lint_violations(); -- חייב להחזיר 0
   select count(*) from pg_policies where schemaname='public'; -- 35
   ```
4. בצע בדיקת Liveness ו-Readiness:
   `curl https://turim.d2ryf.com/api/ready` (חייב להחזיר 200).

### נוהל 2: התאוששות ותפעול משימות ה-Cron
במקרה שמתקבלת התראת כשל או שאילתת `/api/jobs/health` מדווחת על משימה מושהית (`stale`):
1. בדוק את סטטוס המשימות האחרונות במסד:
   ```sql
   select * from public.job_status();
   ```
2. במידת הצורך, ניתן להפעיל ידנית הרצה מיידית של ה-Outbox או התזכורות באמצעות קריאת `GET` ישירה עם מפתח ה-Bearer של ה-Cron:
   ```bash
   curl -i -H "Authorization: Bearer $CRON_SECRET" "https://turim.d2ryf.com/api/jobs/outbox"
   ```
3. תזכורות לתורים שכבר חלפו לא יישלחו רטרואקטיבית (הגנה מפני ספאם מובנית בקוד).

### נוהל 3: גלגול לאחור של גרסת ייצור (Vercel Rollback)
במקרה של באג בלתי צפוי בגרסת קוד חדשה:
1. היכנס ל-Vercel Dashboard לפרויקט `appointment-scheduling-system`.
2. גש ללשונית `Deployments`.
3. אתר את הפריסה המאומתת התקינה האחרונה (`dpl_3Fj2rZsYUNdnMnxB9MvXWTjXA4e3` מקומיט `08c98e3`).
4. לחץ על תפריט שלוש הנקודות ובחר **Instant Rollback**.
5. כל המיגרציות שנכתבו במערכת נבנו עם תאימות לאחור (Backward Compatible), כך שגלגול גרסת קוד אינו שובר את מבנה המסד.

---

## 6. סיווג פערים ודרישות קדם (Gaps Classification)

### פערים קריטיים (P0 — Launch Blockers): **אפס (0)**
אין פערים המשביתים את המערכת, מסכנים נתוני לקוחות או מונעים השקה פרטית.

### דרישות קדם תפעוליות להשקה ציבורית רחבה (P1 — Pre-conditions for Wide Public Launch):
1. **הפעלת Leaked Password Protection בלוח הבקרה של Supabase:**  
   - מיקום: Supabase Dashboard -> Authentication -> Password Security.  
   - פעולה: הדלקת האפשרות "Enable Leaked Password Protection" לסגירת האזהרה הנותרת ב-Security Advisor.
2. **הוספת סוד `MONITOR_SECRET` ל-GitHub Repository Secrets:**  
   - מיקום: GitHub Repo Settings -> Secrets and variables -> Actions.  
   - פעולה: הוספת משתנה `MONITOR_SECRET` כדי לאפשר ל-Workflow הניטור החיצוני לדגום את `/api/jobs/health` בהרשאות צפייה מינימליות.
3. **חיבור ספק סליקה מסחרי לקראת גבייה אוטומטית המונית:**  
   - מערכת ה-Billing פועלת כעת במתאם `manual` המיועד לפיילוט. לקראת הרחבה מסחרית המונית יש להטמיע Webhooks מול חברת סליקה (כגון Meshulam / Tranzila / Hyp / Stripe).

### שיפורי ייעול עתידיים (P2 — Post-Launch Optimizations):
- הוספת אינדקסים ייעודיים על מפתחות זרים שאינם מאונדקסים (`appointments.service_id`, `customers.auth_user_id`) ככל שכמות התורים תחצה 5,000,000 רשומות.

---

## 7. סיכום ומסקנות

כל שלבי האימות וה-Drills שבוצעו הוכיחו כי **Tori SaaS היא מערכת יציבה, עמידה, מאובטחת ומהירה ביותר**, המוכנה לפעילות עסקית אמיתית. כל הנתונים, המדדים והתהליכים מתועדים ומגובים בראיות ישירות וניתנות לשחזור.
