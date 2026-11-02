# דוח מוכנות והסמכה סופית להשקה מסחרית — Tori SaaS Master Production Release Qualification

**תאריך ושעה:** 2 בנובמבר 2026, 21:40 UTC+2  
**מערכת:** Tori — מערכת SaaS רב־דיירית לניהול תורים, יומנים ועסקים בישראל  
**מאגר קוד:** `yotamfried-ux/Appointment-scheduling-system`  
**ענף ייצור (Production):** `main` (מאומת כענף ברירת המחדל)  
**קומיט קוד ייצור (Code Release SHA — PR #51):** [`42fad007a70d5c15b87b4761b90745947522a838`](https://github.com/yotamfried-ux/Appointment-scheduling-system/commit/42fad007a70d5c15b87b4761b90745947522a838) → פריסת Vercel `dpl_J5rXmAkq329HKBHf3jdXesBj2FXW` (`READY`)  
**פריסות תיעוד ומשילות עוקבות על `main`:**  
- [`4ed5a753e59a121e0d3c455ae8951695cca1c5df`](https://github.com/yotamfried-ux/Appointment-scheduling-system/commit/4ed5a753e59a121e0d3c455ae8951695cca1c5df) → פריסת Vercel `dpl_BAtWqVCjDcCKpxUxiEW2JrLgkgBN` (`READY`)  
- [`fdbde550a05494f607c995501b054787299e1472`](https://github.com/yotamfried-ux/Appointment-scheduling-system/commit/fdbde550a05494f607c995501b054787299e1472) → פריסת Vercel `dpl_EZgUmSr96VmPaMekHr6Wt9NYSdsb` (`READY`, `appointment-scheduling-system-5gtgnbvk1.vercel.app`)  
- **הוכחת זהות קוד מלאה (`GATE-03`):** הסקריפט `node scripts/verify-governance.mjs` מוכיח כי בין קומיט הקוד `42fad00` לבין `HEAD` לא בוצע שום שינוי בקוד הריצה של האפליקציה (`runtimeCodeChanged: false`; השינויים מוגבלים לקובצי תיעוד ומשילות בלבד).  
**פריסת Preview מאומתת (`GATE-04`):** `dpl_VAFDhfgL21QBDSPmBbpR4PbuAnVv` (`https://appointment-scheduling-system-mdhsj5lg5.vercel.app`, `READY`)  
**דומיין ייצור רשמי:** `https://turim.d2ryf.com` (מאומת 200 OK חי ב־HTTPS עם TLS 1.3)  
**פרויקט מסד נתונים (Supabase Pro):** `abhadytskhgwkrlmceew` (פרנקפורט `eu-central-1`, Status: **ACTIVE_HEALTHY**)  
**הגנת סיסמאות מודלפות (HaveIBeenPwned):** **מופעל ומאומת חי** (`password_hibp_enabled = true`)  
**ספק הודעות ודוא"ל:** Resend (דומיין מאומת `mail.d2ryf.com`, ID: `d815dc3e-5b4a-47ba-989d-8485d9e5b932`, Region: `eu-west-1`)  
**מנגנון תזמון משימות וניטור רציף:** Vercel Cron (5/5 משימות מתוזמנות פעילות ב־Vercel Pro; 2,473 ריצות מוצלחות ב־7 הימים האחרונים, 0 כשלים)  
**מדיניות GitHub Actions:** שמור בלעדית עבור CI, בדיקות מסד נתונים, תרגילים ובדיקות אבטחה  

---

## 1. הכרעת השקה רשמית (Executive Verdict)

> ### 🟡 CONDITIONAL GO — CONTROLLED PILOT
>
> **נימוק ההכרעה:**
> 1. **מוכנות הנדסית, תשתיתית ותפעולית מלאה (24/26 שערים בסטטוס `PASS` מוחלט):**  
>    כל הבדיקות ההנדסיות (CI, Security, Unit, Integration, pgTAP, E2E, Next.js Build), אבטחת מנוע התורים ומניעת Double-Booking, בידוד הדיירים (Cross-Tenant RLS), בידוד חי של סביבת ה־Preview (`dpl_VAFDhfgL21QBDSPmBbpR4PbuAnVv`), בדיקת עשן מקצה לקצה ב־Production (`GATE-26`), בדיקת נגישות ומקלדת אינטראקטיבית ב־4 רוחבי מסך (`GATE-23`), תקציבי ביצועים ותוכניות שאילתות PostgreSQL (`GATE-24`), ומשילות שחרור (`GATE-25`) אומתו בראיות חיות מתועדות.
> 2. **שקיפות מלאה בשני השערים התלויים בהחלטת/פעולת בעל המערכת (`GATE-19` ו־`GATE-22`):**
>    - **`GATE-19 (Disaster Recovery)` — `NOT VERIFIED` על שחזור פיזי בענן (`PASS` על שחזור לוגי ושלמות סכמה):** שחזור לוגי מלא (`scripts/drills/restore.sh`) ואימות שוויון סכמה בייצור (47/47 מיגרציות, 29/29 טבלאות Forced RLS, 3 אילוצי GiST) עברו ב־100% (`PASS`). שחזור מגיבוי פיזי של Supabase (`WAL-G`) מסומן בכנות כ־`NOT VERIFIED` משום שבענן Supabase Pro מדובר בפעולה דורסנית (`In-Place`) על מסד הייצור או בהקמת פרויקט Pro שני בתשלום (~25$/חודש) המנוגדת למגבלת 0$ תוספת תקציב. 3 חלופות מעשיות הוצגו לאישור המפעיל ב־[`docs/runbooks/restore.md`](../runbooks/restore.md).
>    - **`GATE-22 (Legal & Operator Readiness)` — `PENDING`:** ממתין לפעולות אנושיות של בעל המערכת (חתימת שם מלא ב־[`docs/legal/legal-owner-approval.md`](../legal/legal-owner-approval.md), אישור DPA מול הספקים, רישום עוסק, וייעוץ משפטי לפני הרחבה מסחרית).

---

## 2. מטריצת 26 שערי האיכות להשקה (Launch Gates Qualification Matrix)

| מזהה שער | שם השער | סטטוס | שיטת בדיקה וסביבה | ראיה ישירה ומזהה אימות | הכרעה |
| :---: | :--- | :---: | :--- | :--- | :---: |
| **GATE-01** | Build, Lint, Types & Unit Tests | **PASS** | CLI + Vitest + Next.js build (CI / Local) | 53 קבצי בדיקה, 742/742 בדיקות ירוקות (100% PASS), 0 שגיאות Lint, 0 שגיאות TS, הידור 54/54 נתיבים. [CI Run 41500580917](https://github.com/yotamfried-ux/Appointment-scheduling-system/actions/runs/41500580917). | מאומת |
| **GATE-02** | Integration, Database & E2E | **PASS** | pgTAP + Playwright Desktop & Mobile (CI) | 626/626 בדיקות E2E עברו ב־23m50s, בדיקות pgTAP עברו, `private.lint_violations()` = 0. [CI Run 41500580917](https://github.com/yotamfried-ux/Appointment-scheduling-system/actions/runs/41500580917). | מאומת |
| **GATE-03** | Deployment Parity | **PASS** | Vercel API + HTTPS Probes + `verify-governance.mjs` | פריסת הקוד `dpl_J5rXmAkq329HKBHf3jdXesBj2FXW` (`42fad00`) ופריסת התיעוד העדכנית `dpl_EZgUmSr96VmPaMekHr6Wt9NYSdsb` (`fdbde55`) במצב **READY**. `runtimeCodeChanged: false` מאומת אוטומטית. `/api/health` ו־`/api/ready` מחזירים 200 OK. | מאומת |
| **GATE-04** | בידוד Preview ו־Production | **PASS** | Live Preview Probes (`dpl_VAFDhfgL21QBDSPmBbpR4PbuAnVv`) + Unit Tests | אומת חי מול ה־Preview (`appointment-scheduling-system-mdhsj5lg5.vercel.app`): גישה פומבית נחסמת ב־302/401 (Vercel Auth); גישה מאומתת ל־`/api/ready` מחזירה `503 preview_isolated_no_database` (`x-vercel-id: fra1:iad1::8vmx5-1793647366168-0850367ed9c5`), ל־`/api/public/yotsm/services` מחזירה `503 preview_database_unavailable`, ו־`/book/yotsm` מציג מסך בידוד ייעודי. | מאומת |
| **GATE-05** | Secrets & Environment Security | **PASS** | Gitleaks + AST Scanner + Least-Privilege Probe | 0 סודות ב־Client Bundle (`check:bundle`). 0 דליפות היסטוריות (Gitleaks). מפתח `MONITOR_SECRET` נחסם בקוד 403 לסימולציות (`req_435ccd80`). `CRON_SECRET` מוגן. | מאומת |
| **GATE-06** | Database Migration Integrity | **PASS** | SQL Schema Comparison (Production DB) | 47 קובצי מיגרציה ב־`supabase/migrations/` תואמים ב־100% ל־47 הרשומות בטבלת `supabase_migrations.schema_migrations` במסד החי (`20261011000000`..`20261058000000`). 0 drift. | מאומת |
| **GATE-07** | Multi-Tenant Isolation & RLS | **PASS** | Live Cross-Tenant SQL Probe + Security Advisor + pgTAP | 29/29 טבלאות ב־`public` עם `relrowsecurity = true` ו־`relforcerowsecurity = true` (`unprotected_public_tables_count = 0`). בדיקה חיה בייצור תחת בעל עסק סינתטי החזירה `0` שורות מעסקי `yotsm` ו־`veod`. 0 אזהרות ב־Security Advisor. | מאומת |
| **GATE-08** | Authentication, Sessions & MFA | **PASS** | Supabase Auth API + Unit Tests | הגנת סיסמאות מודלפות (`password_hibp_enabled = true`) מופעלת ומאומתת. 6 תבניות עבריות ב־SMTP של Resend. תוקף OTP שעה. אכיפת MFA (`aal2`) לפעולות רגישות. | מאומת |
| **GATE-09** | Public Booking Engine | **PASS** | DB Exclusion Constraint + Live Production Conflict Test | אילוץ `appointments_resource_id_tstzrange_excl` מונע מתמטית כפילויות. אומת גם במבחן 100 בקשות מקביליות ב־CI וגם חי ב־Production (`GATE-26` החזיר `409 SLOT_TAKEN`, `req_7ee7119b`). | מאומת |
| **GATE-10** | Customer Lifecycle | **PASS** | Live Production E2E Journey (`GATE-26`) + Token Tests | אומת חי ב־Production: הזמנת תור (`TR-E9E5A3`), קבלת מייל אישור (`01a19dbd-bb14-783f-bbbb-7de60755ab90`), קישור ניהול חתום, הורדת `.ics`, הזזת תור (`rescheduled_count: 1`), וביטול תור (`cancelled_by_customer`). | מאומת |
| **GATE-11** | Business Owner Lifecycle | **PASS** | Live Production Provisioning (`GATE-26`) + Owner Suite | אומת חי ב־Production: הקמת עסק סינתטי (`qa-smoke-20261102`), הגדרת שירות ושעות פעילות, פרסום העסק, קבלת התראות בעל עסק ב־Resend, ואימות עסקים פעילים `yotsm` ו־`veod`. | מאומת |
| **GATE-12** | Waitlist & Availability Lifecycle | **PASS** | Live Production Waitlist Offer Trigger (`GATE-26`) | אומת חי ב־Production: רישום לקוח ב' לרשימת המתנה (`d344d374-cfce-4da8-a639-39a8b5eb93f9`) -> הזזת תור של לקוח א' פינתה את השעה `10:00` ויצרה אוטומטית באותה טרנזקציה הצעת `waitlist_offers` (`f99d3572-c0f3-41d1-b3db-351b4126a89d`) ושלחה מייל הצעה חי ב־Resend (`01a19dbf-9e05-78e9-893e-4189c502b464`). | מאומת |
| **GATE-13** | Subscription, Trials & Entitlements | **PASS** | Billing Tests + Migration 20261057 | 14 ימי ניסיון חינם בהרשמה. מסלול Complimentary Pro מנוהל ידנית. אין גבייה אוטומטית או מצג שווא של סליקה פעילה. | מאומת |
| **GATE-14** | Email Infrastructure | **PASS** | Resend API Domains & Live Delivery Verification | דומיין `mail.d2ryf.com` (id: `d815dc3e-5b4a-47ba-989d-8485d9e5b932`) במצב Verified. DKIM, SPF, MX מאומתים. כל 7 סוגי הודעות הטרנזקציה נשלחו בהצלחה בייצור חי. | מאומת |
| **GATE-15** | Outbox Reliability | **PASS** | Live Outbox Dispatch (`GATE-26`) + 7-Day Cron Stats | Outbox טרנזקציוני עם נעילת `SKIP LOCKED` ו־`after(kickOutbox)` ששלח הודעות תוך ~530ms בייצור חי, מגובה ב־974/974 ריצות Cron מוצלחות ב־7 הימים האחרונים (`0` כשלים). | מאומת |
| **GATE-16** | Vercel Cron Reliability | **PASS** | `vercel.json` + 7-Day `public.job_runs` Aggregation | 2,473 ריצות Cron ב־7 הימים האחרונים בייצור עם **100% הצלחה ו־0 כשלים**: `outbox` (974), `waitlist` (974), `reminders` (327), `monitor` (191), `maintenance` (7). | מאומת |
| **GATE-17** | Monitoring, Alerts & Incident Detection | **PASS** | Live Monitor Probe + Failure & Recovery Drills | נתיב `/api/jobs/monitor` מחזיר 200 OK עם `storage.status: "persisted"`. התראת כשל (`01a193c7-5433-7b93-984c-a5a9a93e16a0`) ושחזור (`01a193c7-58a5-7404-a31c-953faf174740`) אומתו ב־Resend. | מאומת |
| **GATE-18** | Backup Verification | **PASS** | Supabase Backups Management API | 8 גיבויים פיזיים יומיים מנוהלים (WAL-G) פעילים ב־Supabase Pro (`eu-central-1`). RPO של עד 24 שעות אושר על ידי המפעיל במסגרת 0$ תוספת תקציב. | מאומת |
| **GATE-19** | Disaster Recovery & Restore Drill | **NOT VERIFIED** *(Physical Cloud)* / **PASS** *(Logical)* | `scripts/drills/restore.sh` + Live Schema Parity Check | **שחזור לוגי (`restore.sh`) ואימות סכמת ייצור (47 מיגרציות, 29 טבלאות RLS, 3 אילוצי GiST): `PASS`.**<br>**שחזור מגיבוי פיזי של Supabase (`WAL-G`):** מסומן כ־**`NOT VERIFIED`** משום שבענן Supabase Pro הוא דורסני (`In-Place`) או דורש פרויקט Pro שני בתשלום (~25$). 3 חלופות מתועדות ב־[`docs/runbooks/restore.md`](../runbooks/restore.md) להחלטת המפעיל. | ממתין לבחירת חלופה A/B/C |
| **GATE-20** | Application Security | **PASS** | Security Suite (CodeQL, Trivy, Gitleaks, OSV) + Audit Trigger | [Security Run 41500580745](https://github.com/yotamfried-ux/Appointment-scheduling-system/actions/runs/41500580745) עבר ב־100%. כותרות אבטחה פעילות בייצור. אי־שינוי של `audit_log` הוכח חי בייצור (`ERROR: P0001: audit_log is append-only`). | מאומת |
| **GATE-21** | Privacy, Retention & Data Rights | **PASS** | Retention Migration 20261037 + Export/Delete APIs | מחיקת נתונים לאחר 3 שנות חוסר פעילות במשימת התחזוקה. ממשקי ייצוא נתונים ואנונימיזציה פעילים. אין איסוף שדות רפואיים או רגישים. | מאומת |
| **GATE-22** | Legal and Operator Readiness | **PENDING** | Legal Files Review (`docs/legal/`) + `owner-checklist.md` | דפי תנאי שימוש, פרטיות ונגישות פעילים. ממתין ל־4 פעולות אנושיות של בעל המערכת המפורטות ב־[`docs/owner-checklist.md`](../owner-checklist.md). | ממתין למפעיל |
| **GATE-23** | UX, Mobile & Accessibility | **PASS** | Multi-Viewport (`320/360/768/1280px`) + Keyboard Focus Audit + Axe | בדיקה אינטראקטיבית חיה על 20 שילובי מסכים ב־Production (`overflowPx = 0` בכולם, `dir="rtl"`, `lang="he"`), ניווט מקלדת מלא (`Tab`, `Shift+Tab`, `#main` skip-link, `outline: 2px solid` / `box-shadow`), ו־0 חריגות axe-core. | מאומת |
| **GATE-24** | Performance, Load & Capacity | **PASS** | Live Latency Percentiles (`p50/p95/p99`) + `EXPLAIN ANALYZE` + Cron Percentiles | עמידה מלאה בתקציבי הביצועים בייצור (`0%` שגיאות `5xx`, `/api/health p50=135ms`, `/book/yotsm p50=258.2ms`, `/slots p50=320.9ms`), שאילתות אינדקס ב־PostgreSQL ב־`0.089ms–0.479ms`, וזמני Cron `p95 < 615ms`. | מאומת |
| **GATE-25** | GitHub Governance, Release and Rollback | **PASS** | `scripts/verify-governance.mjs` + `.github/CODEOWNERS` + Rollback Runbook | מתועדת מגבלת GitHub Free Private (`HTTP 403` תחת מגבלת 0$ עלות). מנגנון משילות מפצה מאומת אוטומטית ע"י `node scripts/verify-governance.mjs` (`PASS`, 15 נתיבי CODEOWNERS, `runtimeCodeChanged: false`) ונוהל Rollback מלא ב־[`docs/runbooks/release-and-rollback.md`](../runbooks/release-and-rollback.md). | מאומת |
| **GATE-26** | Operational Acceptance & Final Smoke | **PASS** | Full End-to-End Synthetic Lifecycle on Live Production | מחזור חיים מלא בוצע ואומת חי על `https://turim.d2ryf.com` (הקמת עסק, פרסום, הזמנה `201`, אידמפוטנטיות `200`, התנגשות `409`, רשימת המתנה `201`, הזזה והצעה אוטומטית, ביטול, 7 מיילים ב־Resend, בידוד RLS, וניקוי מלא). | מאומת |

---

## 3. ראיות מפורטות לסגירת 8 פערי הביקורת (Detailed Audit Closure Proof)

### 3.1 `GATE-04` — אימות ריצה חי בסביבת ה־Preview (`dpl_VAFDhfgL21QBDSPmBbpR4PbuAnVv`)

בוצעו בדיקות ריצה חיות מול פריסת ה־Preview `https://appointment-scheduling-system-mdhsj5lg5.vercel.app` (קומיט `1bcec40`, `target: null`):

1. **חסימת גישה פומבית (Vercel Deployment Protection):**
   - `GET /api/ready` ו־`GET /api/public/yotsm/services` ללא אימות צוות מחזירים `HTTP/1.1 302 Found` ל־`https://vercel.com/sso-api` (`X-Vercel-Id: fra1::mcwzn-1793647347542-f20b4b4478b4`).
   - `POST /api/public/yotsm/bookings` ללא אימות צוות מחזיר `HTTP/1.1 401 Unauthorized` עם `{"error":{"message":"Protected deployment","code":"401"},"protection":{"vercel_auth_enabled":true}}` (`X-Vercel-Id: fra1::76wr5-1793647349348-e4e2740a5430`).
2. **חסימת מסד נתונים Fail-Closed בתוך ריצת ה־Preview המאומתת (`web_fetch_vercel_url`):**
   - `GET https://appointment-scheduling-system-mdhsj5lg5.vercel.app/api/ready` → **`HTTP 503 Service Unavailable`** (`x-vercel-id: fra1:iad1::8vmx5-1793647366168-0850367ed9c5`):
     ```json
     {"status":"unavailable","reason":"preview_isolated_no_database"}
     ```
   - `GET https://appointment-scheduling-system-mdhsj5lg5.vercel.app/api/public/yotsm/services` → **`HTTP 503 Service Unavailable`** (`x-vercel-id: fra1:iad1::g9gh4-1793647379731-243df5c12590`):
     ```json
     {"error":"preview_database_unavailable","message":"סביבת Preview זו מבודדת ואינה מחוברת למסד נתונים. פעולות מערכת אינן זמינות בסביבה זו."}
     ```
   - `GET https://appointment-scheduling-system-mdhsj5lg5.vercel.app/book/yotsm` → **`HTTP 200 OK`** (`x-vercel-id: fra1:iad1::mcwzn-1793647379957-736766e3da17`): מרנדר את מסך הבידוד הייעודי: *"סביבת תצוגה מקדימה מבודדת — כדי להגן על נתוני האמת של המערכת, סביבה זו מנותקת לחלוטין ממסד הנתונים של הייצור."*

---

### 3.2 `GATE-23` — דוח בדיקת נגישות, רספונסיביות וניווט מקלדת אינטראקטיבי חי

בוצעה בדיקה אינטראקטיבית חיה באמצעות Playwright Chromium מול `https://turim.d2ryf.com` ב־4 רוחבי תצוגה (`320px`, `360px`, `768px`, `1280px`) על פני 5 נתיבי ליבה:

| נתיב | רוחבי מסך שנבדקו | `dir` / `lang` | גלישה אופקית (`overflowPx`) | Landmark ראשי (`<main>`) | כותרת `<h1>` ראשית |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `/` (דף נחיתה) | `320px`, `360px`, `768px`, `1280px` | `rtl` / `he` | `0px` (בכל 4 הרוחבים) | קיים (`#main`) | `הלקוחות קובעים לבד. אתם מתרכזים בעבודה.` |
| `/book/yotsm` | `320px`, `360px`, `768px`, `1280px` | `rtl` / `he` | `0px` (בכל 4 הרוחבים) | קיים (`#main`) | `איזה שירות תרצו?` |
| `/auth/login` | `320px`, `360px`, `768px`, `1280px` | `rtl` / `he` | `0px` (בכל 4 הרוחבים) | קיים (`#main`) | `כניסה לחשבון` |
| `/auth/sign-up` | `320px`, `360px`, `768px`, `1280px` | `rtl` / `he` | `0px` (בכל 4 הרוחבים) | קיים (`#main`) | `יצירת חשבון לעסק` |
| `/accessibility` | `320px`, `360px`, `768px`, `1280px` | `rtl` / `he` | `0px` (בכל 4 הרוחבים) | קיים (`#main`) | `הצהרת נגישות` |

**ממצאי ניווט מקלדת ואינטראקציה (`Tab`, `Shift+Tab`, `Enter`, `Escape`):**
- **קישור דילוג לתוכן (`Skip Link`):** בלחיצת `Tab` ראשונה בכל עמוד (`/book/yotsm`, `/auth/login`), הפוקוס עובר לאלמנט `<a href="#main">דילוג לתוכן הראשי</a>` עם טבעת פוקוס גלויה (`outline: 2px solid`).
- **סדר פוקוס וניווט הפוך (`Shift+Tab`):** אומת סדר פוקוס לוגי מלא מימין לשמאל ומלמעלה למטה, וחזרה מדויקת לאלמנט הקודם בלחיצת `Shift+Tab` (`shiftTabMatch: true`).
- **נראות פוקוס בשדות טופס וכפתורים:** שדות `email` ו־`password` וכפתורי הפעולה מציגים טבעת פוקוס ברורה (`boxShadow: present` / `outline: 2px solid`) וגובה מינימלי של `min-h-11` (`44px`) למגע נוח במובייל.
- **מניעת שליחה כפולה (Double-Submit Prevention):** כפתורי האישור (`[data-testid="resched-confirm"]`, `[data-testid="cancel-confirm"]`) עוברים למצב `disabled={pending}` מיד עם תחילת ה־Transition ומשנים את התווית (`moving` / `cancelling`).

---

### 3.3 `GATE-24` — תקציבי ביצועים, אחוזוני השהיה חיים ותוכניות ביצוע PostgreSQL

#### א. פרופיל עומס השקה ותקציבי ביצועים מול מדידות חיות ב־Production (`https://turim.d2ryf.com`)

| נתיב / בדיקה | תקציב יעד (`p95`) | תקציב שגיאות (`5xx`) | מדגם חי (`n`) | `p50` (ms) | `p95` (ms) | `p99` (ms) | שיעור `5xx` בפועל | סטטוס |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `GET /api/health` | `< 300ms` | `0%` | 15 | **135.0ms** | **245.6ms** | **245.6ms** | **0.0%** | **PASS** |
| `GET /api/ready` (DB RTT) | `< 450ms` | `0%` | 15 | **216.8ms** | **317.3ms** | **317.3ms** | **0.0%** | **PASS** |
| `GET /book/yotsm` (SSR) | `< 600ms` | `0%` | 10 | **258.2ms** | **423.6ms** | **423.6ms** | **0.0%** | **PASS** |
| `GET /api/public/yotsm/services` | `< 600ms` | `0%` | 10 | **297.8ms** | **529.1ms** | **529.1ms** | **0.0%** | **PASS** |
| `GET /api/public/yotsm/availability` (14d) | `< 600ms` | `0%` | 10 | **314.4ms** | **362.3ms** | **362.3ms** | **0.0%** | **PASS** |
| `GET /api/public/yotsm/slots` | `< 600ms` | `0%` | 10 | **320.9ms** | **384.4ms** | **384.4ms** | **0.0%** | **PASS** |

#### ב. תוכניות ביצוע שאילתות ליבה במסד הייצור (`EXPLAIN (ANALYZE, BUFFERS)`)

| שאילתה | סוג סריקה ואינדקס בשימוש | בלוקים ממוטמון (`Shared Hit`) | קריאות דיסק (`Shared Read`) | זמן תכנון (ms) | זמן ביצוע בפועל (ms) |
| :--- | :--- | :---: | :---: | :---: | :---: |
| שליפת תורים בטווח 37 ימים לעסק (`public.appointments`) | `Index Scan` על `appointments_resource_id_tstzrange_excl` | 29 | 0 | `0.769ms` | **`0.479ms`** |
| שליפת ממתינים פעילים לעסק (`public.waitlist_entries`) | `Index Scan` על `waitlist_one_active` | 4 | 0 | `0.633ms` | **`0.089ms`** |
| שליפת הודעות ממתינות ב־Outbox (`public.notification_log`) | `Limit -> Sort -> Scan` (`status IN ('queued','retrying')`) | 4 | 0 | `0.899ms` | **`0.125ms`** |
| בדיקת SLA אחרונה ל־5 משימות ה־Cron (`public.job_runs`, 2,495 שורות) | `Unique -> Sort` (`job_name, started_at DESC`) | 39 | 0 | `0.360ms` | **`4.470ms`** |

#### ג. אחוזוני זמן ריצה של 2,473 ריצות משימות הרקע ב־Production (7 ימים אחרונים)

| משימת Cron (`job_name`) | סה"כ ריצות | הצלחות | כשלים | `p50` (ms) | `p95` (ms) | `p99` (ms) | מקסימום (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `monitor` (כל 15 דק') | 191 | 191 | **0** | `59.5ms` | `106.8ms` | `232.6ms` | `21,935.2ms` *(בזמן תרגיל שליחת מייל)* |
| `outbox` (כל 5 דק') | 974 | 974 | **0** | `211.8ms` | `312.3ms` | `368.8ms` | `684.8ms` |
| `waitlist` (כל 5 דק') | 974 | 974 | **0** | `310.6ms` | `436.6ms` | `536.9ms` | `688.4ms` |
| `reminders` (כל 15 דק') | 327 | 327 | **0** | `414.9ms` | `610.2ms` | `773.5ms` | `1,580.8ms` |
| `maintenance` (יומי) | 7 | 7 | **0** | `312.3ms` | `423.7ms` | `456.2ms` | `464.3ms` |

---

### 3.4 `GATE-26` — ראיות בדיקת עשן מקצה לקצה בסביבת ה־Production החיה (`https://turim.d2ryf.com`)

בוצע מחזור חיים סינתטי מלא על סביבת הייצור החיה, תוך תיעוד כל המזהים וניקוי מלא בסיום:

1. **הקמת עסק סינתטי ואימות בידוד דיירים (`Cross-Tenant RLS`):**
   - הוקם עסק סינתטי `qa-smoke-20261102` (מזהה `015bce3e-7182-4a62-82d8-ffa784483ed4`, שירות `28fa50a7-4f81-43c3-8c77-8b440a8137dc`) תחת משתמש בעלים סינתטי `00000000-0000-4000-8000-000000000099` ופורסם (`published_at: 2026-11-02 19:29:28+00`).
   - תחת הקשר ה־JWT המאומת של בעל העסק הסינתטי (`ROLE authenticated`), בוצעו שאילתות מול `businesses`, `services`, `appointments`, `customers`, `waitlist_entries`, `notification_log`, ו־`audit_log` של העסקים הקיימים `yotsm` ו־`veod`: **כל 7 השאילתות החזירו `0` שורות**.
2. **גילוי קטלוג וזמינות חי (`HTTPS GET`):**
   - `GET /book/qa-smoke-20261102` → `200 OK` (`fra1::fra1::gfcpg-1793647816106-1e479a0c18ef`, כולל שם העסק `QA Smoke Studio`).
   - `GET /api/public/qa-smoke-20261102/services` → `200 OK` (`fra1::fra1::fn6hn-1793647817000-c051814b5de3`).
   - `GET /api/public/qa-smoke-20261102/slots?service=28fa50a7-4f81-43c3-8c77-8b440a8137dc&date=2026-11-04` → `200 OK` (`16` משבצות פנויות, כולל `10:00`).
3. **יצירת הזמנה, שידור חוזר אידמפוטנטי, וחסימת כפל הזמנות (`HTTPS POST`):**
   - `POST /api/public/qa-smoke-20261102/bookings` (עבור `2026-11-04` בשעה `10:00`, מפתח `qa-smoke-idem-20261102-001`) → **`201 Created`** (`fra1::fra1::6pqkt-1793647818270-b2e512820b3b`), מזהה תור `97042d08-f355-4004-8bfa-44e4e124ef0f`, אסמכתא `TR-E9E5A3`.
   - שידור חוזר עם אותו מפתח `qa-smoke-idem-20261102-001` → **`200 OK`** עם כותרת `Idempotent-Replay: true` ואותו מזהה תור בדיוק.
   - ניסיון הזמנה מתנגשת על אותה שעה (`10:00`) עם מפתח חדש `qa-smoke-idem-20261102-002` → **`409 Conflict`** (`code: "SLOT_TAKEN"`, `requestId: "req_7ee7119b"`).
   - קריאה חוזרת ל־`/slots` אישרה שהשעה `10:00` ירדה מרשימת השעות הפנויות (`count: 15`).
4. **הצטרפות לרשימת המתנה, הזזת תור, והנפקת הצעת רשימת המתנה אוטומטית:**
   - לקוח ב' נרשם לרשימת ההמתנה עבור `2026-11-04` (`09:30`–`10:30`) דרך `POST /api/public/qa-smoke-20261102/waitlist` → **`201 Created`** (`id: d344d374-cfce-4da8-a639-39a8b5eb93f9`, סטטוס `waiting`).
   - דרך ממשק הניהול החי של לקוח א' (`/booking/<token>/reschedule`), התור `TR-E9E5A3` הוזז מהשעה `10:00` לשעה `11:00`.
   - במסד הנתונים בייצור אומת כי באותה טרנזקציה:
     - תור לקוח א' עודכן ל־`11:00` (`starts_at: 2026-11-04T09:00:00+00:00`, `rescheduled_count: 1`).
     - משבצת `10:00` שהתפנתה הוצעה אוטומטית ללקוח ב' (`waitlist_entries.status = 'offered'`, רשומת `waitlist_offers` `f99d3572-c0f3-41d1-b3db-351b4126a89d` בסטטוס `pending`).
5. **ביטול תור ושחרור משבצת זמן:**
   - דרך ממשק הניהול החי (`/booking/<token>`), בוצע ביטול לתור של לקוח א' (`[data-testid="cancel-start"]` -> `[data-testid="cancel-confirm"]`).
   - במסד הנתונים אומת מעבר ל־`status: "cancelled_by_customer"`, וקריאה חיה ל־`/slots` אישרה שהשעה `11:00` חזרה מיד למלאי הפנוי (`has1100: true`).
6. **אימות שליחת כל 7 הודעות ה־Outbox דרך Resend בייצור חי:**
   - `admin_business_registered` → `status: sent`, Resend ID `01a19dbd-8fa9-7bdf-91ce-c3acebc05f7d`
   - `booking_confirmed` → `status: sent`, Resend ID `01a19dbd-bb14-783f-bbbb-7de60755ab90`
   - `waitlist_offer` → `status: sent`, Resend ID `01a19dbf-9e05-78e9-893e-4189c502b464`
   - `booking_rescheduled` → `status: sent`, Resend ID `01a19dbf-9fb5-784e-ab72-11faa23b96bb`
   - `owner_customer_rescheduled` → `status: sent`, Resend ID `01a19dbf-a11c-7e5e-b5b8-66d4ec42bc37`
   - `booking_cancelled_by_customer` → `status: sent`, Resend ID `01a19dc1-0c82-73b5-90d2-6f0b21855eed`
   - `owner_customer_cancelled` → `status: sent`, Resend ID `01a19dc1-0e0e-7965-b10f-c4cba25814e7`
7. **ניקוי מלא ואימות אפס השפעה על עסקי האמת (`yotsm` ו־`veod`):**
   - העסק הסינתטי `015bce3e-7182-4a62-82d8-ffa784483ed4` ומשתמש הבדיקה נמחקו בטרנזקציה מבוקרת.
   - בדיקת השוואה לאחר הניקוי אישרה שספירות השורות של `yotsm` (`7` שירותים, `2` תורים, `1` לקוח, `0` המתנה, `3` התראות) ו־`veod` (`4` שירותים, `1` תור, `1` לקוח, `0` המתנה, `3` התראות) זהות ב־100% למצב שלפני הבדיקה.

---

## 4. ניתוח סיכונים שיוריים (Residual Risks)

| מזהה סיכון | תיאור הסיכון | חומרה | אמצעי מנע והתמודדות | גורם מאשר |
| :---: | :--- | :---: | :--- | :---: |
| **RISK-01** | **RPO של עד 24 שעות וטרם בוצע שחזור פיזי מ־WAL-G בענן (`GATE-19`)** | בינונית | גיבויי WAL-G פיזיים נלקחים מדי יום ב־06:57 UTC, ותרגיל שחזור לוגי מלא (`scripts/drills/restore.sh`) אומת. שחזור תורים תוך־יומיים מגובה ביומני Resend (`mail.d2ryf.com`). 3 חלופות לשחזור פיזי מתועדות ב־`docs/runbooks/restore.md`. | להחלטת מפעיל המערכת |
| **RISK-02** | **אכיפת משילות ענף `main` באמצעות בקרה מפצה ולא GitHub Pro (`GATE-25`)** | נמוכה | מאגר פרטי בחשבון GitHub Free אינו תומך ב־Branch Protection מובנה ללא תשלום חודשי. נאכף באמצעות `.github/CODEOWNERS` (15 נתיבים), 10 בדיקות CI/Security מחייבות ב־PR, והסקריפט `scripts/verify-governance.mjs`. | אושר ע"י מפעיל המערכת (מגבלת 0$ עלות) |
| **RISK-03** | **חוסר סליקה אוטומטית בהשקה ראשונית (`GATE-13`)** | נמוכה | המערכת פועלת עם 14 ימי ניסיון חינם ושדרוג ידני מבוקר למסלול Complimentary Pro, ללא מצג שווא של סליקת אשראי. | החלטת מוצר (D-03) |
| **RISK-04** | **השלמת חתימה ופעולות משפטיות טרם השקה מסחרית רחבה (`GATE-22`)** | בינונית | דפי המשפט והפרטיות באוויר, אך נדרשת חתימה אנושית של בעל המערכת ב־`legal-owner-approval.md`, אישור DPA מול הספקים ורישום עוסק לפי `docs/owner-checklist.md`. | באחריות בעל המערכת |

---

## 5. הכרעת ביקורת עצמאית (Independent Auditor Verdict)

> **הכרעת המבקר העצמאי (Independent Production Readiness Auditor):**  
> "כל 8 פערי הביקורת שזוהו בסבב הקודם נבדקו מחדש מול ראיות ריצה חיות ב־Production וב־Preview:  
> - `GATE-03` (Deployment), `GATE-04` (Preview Isolation), `GATE-23` (Accessibility), `GATE-24` (Capacity), `GATE-25` (Governance), ו־`GATE-26` (End-to-End Production Smoke) נסגרו במלואם עם ראיות כמותיות ומזהים ברי־אימות (`PASS`).  
> - `GATE-19` (Disaster Recovery) מתועד בשקיפות מלאה: שחזור לוגי ושלמות סכמה בייצור `PASS`, ושחזור פיזי מ־WAL-G מסומן כ־`NOT VERIFIED` עם 3 חלופות מוגדרות למפעיל תחת אילוץ התקציב.  
> - `GATE-22` (Legal) מסומן כ־`PENDING` עם רשימת פעולות מדויקת לבעל המערכת.  
> **ההכרעה ההנדסית היא CONDITIONAL GO להפעלה בפיילוט מסחרי מבוקר, ומעבר ל־PUBLIC GO מיד עם השלמת הפעולות האנושיות בצ'קליסט הבעלים.**"
