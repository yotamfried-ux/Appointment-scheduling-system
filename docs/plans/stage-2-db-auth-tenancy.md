# Route Plan — שלב 2: DB core + Auth + Tenancy + תשתיות ליבה

Task type: feature · Class: security_sensitive (multi-tenant, RLS, Auth) · Branch: `claude/optimistic-hypatia-wh3zo3`

## תרחישים (docs/04 §7)
ACC-01 (create_business אטומי) · ACC-02 (אין enumeration) · ACC-03 (טלפון E.164) · ACC-04 (`published_at` רק אחרי אימייל מאומת) · ACC-05 (שחזור — קיים משלב 0) · ACC-06 (slug reserved/ASCII/unique) · ACC-07 (שינוי slug + redirects בלי שרשראות/מעגלים) · SEC-01 (עסק A לא רואה עסק B) · SEC-02 (tenant תמיד מהסשן) · SEC-05 (Origin/CSRF) · SEC-07 (rate limit) · SEC-08/09 (קלט) · outbox · job_runs · Clock · OPS-02.

## החלטות עיצוב
- שני נתיבים לנתונים (docs/05 §5.1): טבלאות עם RLS+force; כתיבה רגישה רק דרך RPC. עטיפות `public.*` הן `security invoker` דקות; הלוגיקה ב-`private.*_impl` (`security definer`, `search_path=''`). `authenticated` מקבל `usage` על `private` + `execute` על פונקציות ספציפיות בלבד (הסכמה לא חשופה ב-Data API).
- תפקיד נבדק מול `business_members` בכל בקשה (לא ב-JWT).
- `businesses.kind` לא ניתן לשינוי; הגדרות/שעות מה-onboarding נשמרות ב-`settings` (jsonb, תקרת גודל) עד שלב 3 (טבלאות catalog/availability).
- `audit_log` append-only (טריגר חוסם update/delete). `domain_events` (outbox, dedupe_key), `job_runs` (idempotency), `rate_counters` — system-only (ללא grants).
- Services/שעות אמיתיים בטבלאות: שלב 3. MFA TOTP: הפעלה בקונפיג + ממשק הרשמה בשלב זה אם יישאר זמן, אחרת מתועד כ-NOT TESTED.

## שכבות אימות
pgTAP (RLS: חבר/לא חבר/הוסר/anon/עסק אחר + בקרה שלילית) · unit (Zod, Clock) · E2E מול Supabase אמיתי (הרשמה→אימות→onboarding→dashboard, בידוד בין שני משתמשים דרך ה-REST API עם JWT אמיתי) · schema-lint נקי · CI.

## מחוץ להיקף
Catalog/Availability (3) · Booking ציבורי + `system-db` (4) · Billing (9) · פרויקט Supabase ענן (ממתין לאישור עלות).
