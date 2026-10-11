# Project 8 ("EasyLife") — סיכום מערכת ופיצ'רים

> מקור: `yotamfried-ux/project-8` (main + ענף `claude/project-8-supabase-migration-ql0uvx`, שם נמצאים מסמכי ה-audit וה-migration).
> מטרת המסמך: מפת אמת של מה שקיים היום, כבסיס לבנייה מחדש בריפו הזה.

## 1. מהי המערכת

אפליקציית SaaS **רב-דיירית (multi-tenant)** לקביעת תורים לעסקים קטנים (מספרה, קוסמטיקה, מאמן אישי, הוראה, רפואה, אחר).

- **בעל העסק** מנהל הכול מדשבורד דסקטופ: שירותים, זמינות, תורים, לקוחות, דוחות, מדיניות.
- **הלקוח** קובע תור בקישור ציבורי ידידותי למובייל (`/booking/:slug`), בלי חשבון.
- ממשק בעברית, RTL. אזור זמן ברירת מחדל `Asia/Jerusalem`.

## 2. מצב טכנולוגי נוכחי

| שכבה | היום |
|---|---|
| Client | React 18, Vite, React Router, FullCalendar, Recharts, Vitest; CSS גלובלי (ללא design system) |
| Server | Node.js + Express (CommonJS), Prisma (בפועל רוב השאילתות `$queryRaw`), pino, Jest + Supertest |
| DB | SQL Server / Azure SQL (`main`). בסיס Postgres/Supabase מקביל קיים בענף migration (22 טבלאות + RLS), לא מחובר |
| Auth | JWT בעוגיית HttpOnly + CSRF; bcrypt. ללקוחות: "customer session" קל (שם/טלפון/מייל) |
| אימייל | Brevo (API) |
| Jobs | נקודות `/internal/jobs/*` עם סוד, מופעלות מתזמן חיצוני (`RUN_JOBS=false` כברירת מחדל) |
| מטמון | in-memory + Redis אופציונלי לנתיבים ציבוריים (TTL 60s, ETag) |
| פריסה | Azure Static Web Apps + Azure App Service; Docker |
| CI | GitHub Actions: baseline, שערי Engineering OS, בדיקות UTF-8 |

## 3. מפת פיצ'רים

### 3.1 הרשמה והתחברות (בעל עסק)
- הרשמה: שם מלא, טלפון, אימייל, סוג עסק (רשימה: מספרה / קוסמטיקה / מאמן אישי / הוראה / רפואה / אחר), שם עסק, סיסמה + אימות.
- התחברות / התנתקות / `me`; rate-limit על auth; `login_audit`.
- יצירת `slug` ייחודי לעסק; **רענון slug** עם טבלת הפניות (`business_slug_redirects`) כך שקישורים ישנים ממשיכים לעבוד.
- נתיבים: `/auth`, `/login`, `/register`; שגיאות: `EMAIL_TAKEN`, `PHONE_TAKEN`, `INVALID_PHONE`, `INVALID_CREDENTIALS`.

### 3.2 הגדרות עסק
- **פרופיל עסק:** שם, סוג, טלפון, קישור הזמנה ציבורי.
- **שירותים (CRUD):** שם, תיאור, משך בדקות, מחיר (ש"ח), פעיל/לא פעיל.
- **זמינות שבועית:** חלונות שעות לכל יום בשבוע.
- **חריגי זמינות:** תאריך סגור או שעות מיוחדות + הערה.
- **מדיניות הזמנה** (JSON עם גרסאות ו-revisions + שחזור):
  - ביטול עצמי: מותר/אסור, עד כמה שעות לפני; אחרי החלון — חסימה או "דורש אישור".
  - הזמנה ברגע האחרון: מותר/אסור; זמן מינימום מראש (ברירת מחדל 120 דק'); אופק הזמנה (60 יום).
  - שינוי מועד עצמי: מותר/אסור, עד כמה שעות; האם נחשב כביטול.
  - כללי לקוח: מקסימום תורים עתידיים (1), מעקב **אי-הגעה** (סף 2, חלון 60 יום, פעולה: חסימה / דורש אישור / אזהרה).
  - טקסטים מוצגים: מדיניות, ביטול מאוחר, לקוח חסום, זמן מראש; כפתור יצירת קשר/WhatsApp עם עקיפת מספר.
  - מדיניות ביטול ישנה (`app_cancellation_policy`: חלון, עמלה, חסימה אחרי N) — **כפילות** עם ה-JSON, לאחד.
- **התראות והודעות:**
  - תזכורות ללקוח: יום לפני (שעה מוגדרת, ברירת מחדל 9:00) + X שעות לפני (ברירת מחדל 2), קישור "אישור הגעה".
  - Re-engagement: חזרה ללקוח שלא הגיע X ימים (ברירת מחדל 30).
  - התראות לבעל העסק: סיכום ביטולים (יומי 20:00), הצעות ליום ריק (פעמיים בשבוע), "לקוח לא אישר הגעה" (120 דק' לפני).
  - תבניות הודעה ניתנות לעריכה + תצוגה מקדימה.
- חלון Undo של 15 שניות לאחר שמירה; דיאלוג יציאה עם שינויים לא שמורים.

### 3.3 דשבורד ויומן
- **יומן** (FullCalendar): תצוגות, סינון לפי סטטוס/שירות, KPI, שינוי סטטוס מהיר, חלון יום, מצב ריק; חסימת גלילה במובייל.
- **תיבת אישורים:** תורים `PENDING_APPROVAL` ובקשות `CANCELLATION_REQUESTED` — אישור/דחייה.
- **תורים ידניים** (`POST /appointments/manual`) כולל סימון "מחוץ לזמינות".
- **הזזת תור** על ידי העסק.
- **פעמון התראות** (פולינג): "לקוח לא אישר", mark-read, dismiss.
- כרטיס "מספר תורים היום", קישור הזמנה להעתקה.
- **Google Calendar:** OAuth (scope `calendar.events`), סנכרון, סטטוס, הצגת אירועים בתוך היומן.
- סטטוסי תור: `PENDING`, `PENDING_APPROVAL`, `CONFIRMED`, `NO_SHOW`, `CANCELLED` (+ `_BY_CUSTOMER` / `_BY_BUSINESS`), `CANCELLATION_REQUESTED`; פעולות על תור עבר מוגבלות.

### 3.4 לקוחות
- רשימת לקוחות (נבנית מתורים + `app_customers`), סיכום (ביקור ראשון/אחרון, כמות, `no_show_count`), Top customers.

### 3.5 סטטיסטיקות
- כרטיסי מדדים, מגמה לאורך זמן, התפלגות לפי יום בשבוע ולפי שעה, Top customers.
- תובנות ("יום חזק", "שעה חלשה", שינוי באחוזים) והשוואה ל-30 ימים קודמים; סינון לפי טווח ושירות.

### 3.6 דוחות וייצוא
- ייצוא תורים (CSV/אקסל) עם **בחירת שדות** (מזהה, שירות, לקוח, תאריכים, סטטוס, ביקור ראשון/אחרון…).
- **תבניות דוח** שמורות (CRUD). יש גם `accounting/report` (provider מקומי ל-CSV).

### 3.7 הזמנה ציבורית (לקוח, מובייל)
- זרימה בארבעה שלבים: פרטים ← יום ← שעה ← אישור; סיכום דביק (sticky), שמירת טופס ב-localStorage.
- Session לקוח, `my appointments`, **שינוי מועד / ביטול** בכפוף למדיניות, חסימת לקוח אחרי אי-הגעות, `REQUIRES_APPROVAL`.
- חישוב סלוטים לפי זמינות, חריגים, משך שירות, תורים קיימים, lead time, אופק; טיפול באזורי זמן.
- **אישור הגעה** בקישור חתום מהאימייל.
- הצטרפות לרשימת המתנה מהטופס.

### 3.8 רשימת המתנה חכמה
- מחזור חיים: `OPEN → OFFERED → ACCEPTED`; `OFFERED → EXPIRED → OFFERED`; `OPEN → CLOSED`.
- בעל העסק מציע סלוט ספציפי; הלקוח מקבל קישור חתום; קבלה יוצרת תור אמיתי ומקשרת אותו.
- פקיעת הצעות בג'וב; ביטול תור מציע אוטומטית לבא בתור; עדכון חי ל-UI (SSE).

### 3.9 משפטי ופרטיות
- הסכמת עוגיות (consent/revoke/status + גרסאות), הגדרות עוגיות, מדיניות פרטיות, תנאי שימוש, מדיניות עוגיות.
- Analytics loader מותנה בהסכמה; `app_events` (אירועי מוצר: צפייה בהתראות וכו').

### 3.10 תשתיות "שלד" (ללא מימוש אמיתי)
- `PaymentProvider` (checkout/webhook/refund), `InvoiceProvider`, `AccountingProvider` — מחלקות בסיס + `fakePaymentProvider`/`fakeInvoiceProvider`. נתיבים: `/api/payments/checkout|webhook`, `/api/invoices/issue`.
- **זה בדיוק התקן שנרצה לשמר ולהרחיב** (ראו מסמך הארכיטקטורה).

## 4. מודל נתונים (22 טבלאות בגרסת Postgres)

`app_business_owners`, `app_business_services`, `business_availability`, `business_availability_exceptions`, `app_appointments`, `app_customers`, `app_customers_session`, `app_waitlist`, `app_owner_settings`, `business_settings` (+`_revisions`), `app_cancellation_policy`, `app_notification_log`, `app_notification_dismissals`, `app_report_templates` (+`business_report_templates` ישנה), `app_events`, `app_external_accounts` (Google), `business_slug_redirects`, `login_audit`, `user_credentials`, `users`, `cookie_consents`.

## 5. חוב טכני ובעיות שנמצאו

1. **תלות ב-SQL Server** (T-SQL: `TOP`, `OUTPUT inserted`, `CROSS APPLY`, `OFFSET FETCH`) — נדרש port מלא.
2. **דופליקציות:** 3 טבלאות מתות; שני מקורות למדיניות ביטול; טבלת תבניות דוחות כפולה; `users` מול `app_business_owners` מול `user_credentials`.
3. **תקינות כפולה:** חפיפת תורים נבדקת בקוד אפליקציה בלבד — אין אילוץ DB (סיכון ל-double booking בעומס).
4. **RLS** קיים רק כ-scaffolding; הבידוד בפועל הוא פילטרים ידניים ב-service.
5. **קידוד עברית:** היסטוריה של באגי mojibake (סקריפטי `check-utf8`, מחרוזות כ-`\u05..`); `client/node_modules_old` מוזמן ל-git (661 קבצים).
6. **UI:** inline styles ו-CSS גלובלי, אין design system/tokens, אין בדיקות נגישות; `NotFound`/מצבי ריק/שגיאה לא אחידים.
7. **Jobs** תלויים בתזמן חיצוני ובסוד; אין retry/dead-letter.
8. **אין** חיוב מנויים לבעלי עסקים, אין תכניות/הרשאות לפי חבילה.
9. PR #1 (MongoDB + Playwright E2E) — **לא מתאים**; ניתן לשאוב ממנו רק תיקוני עברית/E2E עצמאיים.
10. כיסוי בדיקות: 28 קבצי בדיקות שרת (tenant isolation, public booking, waitlist, reports…) — **שימושי כמפרט התנהגות** לבדיקות החדשות; בדיקות client מעטות.

## 6. מה לשמר, מה לשפר

| לשמר (ערך מוצרי) | לשפר/להחליף |
|---|---|
| מנוע מדיניות ההזמנה והביטול, אי-הגעה, אישור ידני | אילוץ DB נגד חפיפה, RLS אמיתי |
| רשימת המתנה חכמה והצעות חתומות | UI/UX, מערכת עיצוב, נגישות, RTL מלא |
| תזכורות + אישור הגעה | Jobs אמינים (retry, idempotency) |
| דוחות עם בחירת שדות ותבניות | מודל הרשאות וחבילות מנוי |
| slug redirects, revisions להגדרות | ממשק ספקים (תשלום/חשבונית/אימייל/יומן) אחיד |
