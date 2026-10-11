# ארכיטקטורה ותוכנית עבודה — בנייה מחדש

> סטטוס: **טיוטת תכנון להחלטה.** לא נכתב קוד מוצר. סעיף 9 מרכז את ההחלטות שנדרשות ממך.

> עדכון: קטלוג התרחישים ([מסמך 04](04-scenarios-catalog.md)) הוסיף דרישות לארכיטקטורה — ראו שם סעיף 6 (outbox, מכונת מצבים עם audit, snapshot לשירות, slot holds, Clock port, Idempotency-Key, schema-lint ל-RLS).

## 1. יעדים ועקרונות

1. שימור כל הערך המוצרי של Project 8 (מסמך 01) עם **UI/UX ברמה גבוהה**: עברית RTL כאזרח ראשון, מובייל-ראשון להזמנה, דסקטופ לדשבורד.
2. תשתית: **Supabase** (Postgres, Auth, Realtime, Storage, Cron) + **Vercel** (אירוח, Cron, Preview).
3. **גמישות ארכיטקטונית:** כל תלות חיצונית ושינוי עתידי (תשלומים, חשבוניות, SMS/WhatsApp, יומנים) מאחורי **Port/Adapter**; הוספת ספק = adapter חדש, לא שינוי ליבה.
4. **אין תשלום לקוחות כרגע.** יש רק **מנויים של בעלי עסקים אלינו** — ולכן שכבת Billing + Entitlements קיימת מההתחלה, ושכבת Payments ללקוחות קצה קיימת כ-port בלבד (ללא מימוש חי).
5. הוכחה ולא הצהרה: כל פיצ'ר נסגר בראיות (בדיקות, סימולציות משתמש, E2E) לפי סולם הנאמנות של Engineering-OS.

## 2. מצב תשתית (נבדק חי בסשן זה)

| רכיב | מצב |
|---|---|
| Supabase connector | ✅ פעיל. ארגון `yotamfried-ux's Org`; קיימים 2 פרויקטים (`improved-engineering-os`, `sportreel`) — **לא שלנו, לא נוגעים**. |
| Vercel connector | ✅ פעיל. צוות `yotamfried-7101s-projects`. |
| פרויקט Supabase ייעודי | ❌ טרם קיים. יצירה כרוכה בעלות → **דורש אישור שלך** (סעיף 9). עד אז פיתוח על Supabase CLI מקומי/branch. |
| ריפו חדש | ריק; הענף `claude/optimistic-hypatia-wh3zo3` נפתח. |
| דפדפן לסימולציות | ✅ Chromium + Playwright זמינים בסביבה. |

## 3. סטאק מוצע

| שכבה | בחירה | נימוק |
|---|---|---|
| Framework | **Next.js (App Router) + TypeScript strict** | SSR לדפי הזמנה ציבוריים (SEO/מהירות במובייל), Route Handlers ל-API/Jobs, פריסה טבעית ב-Vercel |
| DB | **Supabase Postgres** + migrations ב-`supabase/migrations` | RLS, אילוצי חפיפה, pg_cron, Realtime |
| גישה לנתונים | `@supabase/supabase-js` + טיפוסים מ-`generate_typescript_types`; שאילתות מורכבות כ-SQL functions (RPC) | שומר על חוזים מוכחים בצד DB; בלי ORM כבד. *(חלופה: Drizzle — ראו סעיף 9)* |
| Auth בעלי עסק | **Supabase Auth** (אימייל+סיסמה, magic link, Google) | RLS מבוסס `auth.uid()`; מחליף JWT עצמי. החלפת ספק אפשרית דרך `AuthPort` דק |
| לקוחות קצה | **ללא חשבון**: טוקן חתום (HMAC) לניהול/ביטול/אישור הגעה; טלפון/מייל כזיהוי רך | כמו היום, בלי חיכוך; כל הגישה דרך שרת בלבד |
| UI | Tailwind + **shadcn/ui (Radix)**, tokens סמנטיים (CSS variables), פונט Heebo/Assistant, logical properties (RTL) | נגישות מובנית, שליטה מלאה בעיצוב |
| i18n | `next-intl`, `he` ברירת מחדל, `en` מוכן | מחליף `he.json` הדל של היום |
| טפסים/ולידציה | React Hook Form + Zod (סכמות משותפות client/server) | Engineering-OS pattern |
| יומן | רכיב יומן מותאם (או FullCalendar עטוף) — **נבחר אחרי prototype עיצובי** | יומן הוא לב המוצר; דורש RTL+מובייל מושלמים |
| גרפים | Recharts/visx עם סקין tokens | |
| אימייל | **Resend** + React Email מאחורי `EmailPort` (adapter ל-Brevo אפשרי) | |
| Jobs | **Vercel Cron / Supabase pg_cron+pg_net** ← Route Handlers `/api/jobs/*` עם סוד; jobs idempotentיים עם טבלת `job_runs` | ממשיך את המודל הקיים, עם retry |
| Realtime | Supabase Realtime (במקום SSE) להמתנה/התראות | |
| Observability | pino/`@vercel/otel`, health+ready endpoints, Sentry (להחלטה) | |
| בדיקות | Vitest, pgTAP/SQL tests ל-RLS, Playwright, axe, Lighthouse | סעיף 7 |

## 4. מבנה: Modular Monolith

```
src/
  app/                 # Next.js routes: (marketing) (auth) (dashboard) (booking)/[slug] api/
  modules/             # דומיינים — כל אחד: domain/ service/ repo/ schema(zod)/ ports/
    tenancy/           # עסקים, slug+redirects, חברי צוות (owner/admin/staff בעתיד)
    catalog/           # שירותים (+קטגוריות, חבילות בעתיד)
    availability/      # כללים שבועיים, חריגים, מנוע סלוטים
    booking/           # תורים, מכונת מצבים, מדיניות, אי-הגעה
    waitlist/          # הצעות, פקיעה, auto-offer
    customers/         # CRM קל, ביקורים, אי-הגעות
    notifications/     # תבניות, תזכורות, התראות בעלים, re-engagement
    reports/           # שדות, תבניות, ייצוא, סטטיסטיקות
    integrations/      # calendar (Google…), email, sms/whatsapp
    billing/           # מנויי SaaS: plans, subscriptions, entitlements, BillingPort
    payments/          # תשלום לקוחות קצה: PaymentPort (ללא מימוש חי)
    invoicing/         # InvoicePort / AccountingPort
    compliance/        # הסכמות, מדיניות, מחיקת/ייצוא נתונים
  platform/            # config, logger, errors, auth context, tenant context, job runner, events
  ui/                  # design system: tokens, primitives, patterns
supabase/ migrations/ seed/ tests/
tests/ e2e/ simulations/
```

כללים: מודול חושף רק `service` ו-types; אין import חוצה-דומיינים לתוך `repo`; תקשורת בין מודולים דרך **domain events** פנימיים (`AppointmentCancelled` ← waitlist, notifications, calendar sync). זה מאפשר פיצול עתידי לשירות נפרד בלי כתיבה מחדש.

## 5. מודל נתונים — שיפורים עיקריים

- כל טבלת דייר: `business_id uuid not null` (אחד לכל המערכת במקום `owner_id`/`business_owner_id` המעורבבים), אינדקס מוביל `(business_id, …)`.
- **RLS אמיתי על כל טבלה**: בעלי עסק/צוות לפי `membership` (`business_members(user_id, business_id, role)`) ב-policy עם `auth.uid()`. כל גישה ציבורית ללקוחות — רק דרך Route Handlers שרתיים (service role בצד שרת בלבד) או RPC `security definer` מצומצמים.
- **מניעת double-booking ברמת DB:** `EXCLUDE USING gist (business_id WITH =, staff/resource_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE status IN (active)` (דורש `btree_gist`). שחרור שגיאת 23P01 → HTTP 409. מחליף בדיקה אפליקטיבית בלבד.
- זמנים: `timestamptz` ב-UTC; `businesses.timezone`; כללי זמינות כ-`time` + weekday; בדיקות DST.
- **`resource_id`/`staff_id` כבר עכשיו** (מסלול ברירת מחדל: "העסק עצמו") — מאפשר צוות/חדרים בלי שינוי סכמה.
- הגדרות מדיניות: `jsonb` עם סכמת Zod, גרסאות + `settings_revisions` (נשמר מהמערכת הקיימת). מדיניות הביטול הישנה המאוחדת → מקור אמת אחד.
- מכונת מצבים של תור נאכפת ב-DB (טריגר/CHECK על מעברים) ובשירות: `pending → pending_approval → confirmed → completed | no_show | cancelled_by_customer | cancelled_by_business`, `cancellation_requested`.
- `audit_log` כללי, `domain_events` (outbox) ל-jobs אמינים, `job_runs`.
- ויתור על 3 הטבלאות המתות וה-`users`/`user_credentials` (מוחלפים ב-`auth.users` + `profiles`).

## 6. גמישות: Ports & Adapters, Entitlements, תשלומים עתידיים

```
core module ──▶ Port (interface, Zod-typed)  ◀── Adapter (ספק)  ◀── config ב-DB/ENV
PaymentPort   : createCheckout, handleWebhook, refund            adapters: none (ברירת מחדל) | stripe | israeli-gateway | fake(test)
BillingPort   : createSubscription, portalSession, webhook       adapters: manual | stripe | paddle | lemonsqueezy | fake
InvoicePort   : issue, send, cancel                              adapters: none | provider-X | fake
EmailPort / SmsPort / WhatsAppPort / CalendarPort (Google, Outlook, ICS)
```

- **Entitlements:** טבלאות `plans`, `plan_features`, `subscriptions`, `business_entitlements`. הקוד שואל `can(business, 'waitlist')` / `limit(business, 'staff')` — לעולם לא "אם plan == pro". מאפשר לשנות חבילות, ניסיון חינם, grandfathering, ו-override ידני ללא deploy.
- **מנויים לבעלי עסק (בהיקף עכשיו):** מצב מנוי (`trialing → active → past_due → canceled`) מתעדכן **רק מ-webhook** (מקור אמת יחיד), עם idempotency לפי `event_id`. ספק ראשוני נבחר בהחלטה (סעיף 9); עד אז adapter `manual` + `fake`.
- **תשלום לקוחות קצה (עתידי):** `appointments` כבר נושאים `price_cents`, `currency`, `payment_status` (ברירת מחדל `not_required`); `payments` ו-`invoices` כטבלאות עם `provider`, `external_id`, `raw jsonb`. הוספת תשלום = adapter + הפעלת feature flag `payments`, ללא מיגרציה שוברת. מדיניות עמלת ביטול (קיימת היום כשדה) תתחבר אליו.
- **Feature flags** פר-עסק ופר-סביבה (טבלה פשוטה בהתחלה; ניתן לעבור ל-Unleash/GrowthBook).
- ארכיטקטורה חלופית עתידית: ה-Route Handlers דקים ← שירותים בלי תלות ב-Next ← ניתן להוציא ל-API נפרד/Edge Functions.

## 7. UI/UX ובדיקות

### עיצוב
- שלב 0: **Design System** לפי `ui-ux-pro-max` + `patterns/ui`: tokens (primitive→semantic→component), בהיר/כהה, מרווחים 4px, טיפוגרפיה עברית, מצבי: ריק / טעינה (skeleton) / שגיאה / הצלחה, תנועה מינימלית עם `prefers-reduced-motion`.
- נגישות WCAG 2.2 AA, מקלדת מלאה, RTL עם logical properties.
- אב-טיפוס מסכים ב-Figma/קוד לפני בנייה: יומן, flow הזמנה (4 שלבים), אונבורדינג עסק (הגדרה ב-5 דקות), סטטיסטיקות, רשימת המתנה.
- מסך חדש שלא היה: **Onboarding wizard** (שירות ראשון ← שעות ← קישור שיתוף), ו-**דף מנוי/חיוב** לבעל העסק.

### אסטרטגיית אימות (מדרגות נאמנות)
1. Unit (Vitest): מנוע סלוטים, מדיניות, מכונת מצבים, DST, תבניות.
2. DB (pgTAP/SQL): RLS בידוד בין דיירים, אילוץ חפיפה, מעברי מצב.
3. אינטגרציה על Postgres אמיתי (Supabase local/branch): **50 בקשות מקבילות לסלוט אחד → בדיוק הצלחה אחת** (בדיקה מהצ'קליסט של התבנית).
4. E2E (Playwright) על Preview אמיתי ב-Vercel + Supabase branch.
5. **סימולציות משתמש (personas)** — תסריטים אוטומטיים עם צילומי מסך לכל צעד ובדיקת נגישות:
   - *דנה* (בעלת מספרה): הרשמה → אונבורדינג → שירותים/שעות → משתפת קישור → מאשרת תור → מסמנת אי-הגעה → מוציאה דוח.
   - *נועם* (לקוח במובייל, 360px): הזמנה → תזכורת → שינוי מועד → ביטול מאוחר (נחסם לפי מדיניות).
   - *לקוח חוסם* (2 אי-הגעות) → חסימה/אישור ידני.
   - *רשימת המתנה*: ביטול משחרר סלוט → הצעה → קבלה → תור נוצר.
   - *תקלות*: טוקן פג, סלוט נתפס בין בחירה לאישור, ספק אימייל נופל, DST, מעבר חצות.
6. ביצועים/נגישות: Lighthouse (מובייל), axe, בדיקת ויזואלית RTL.
7. אבטחה: סקירת `security-review`, בדיקות CSRF/rate-limit/אכיפת tenant מהסשן, סריקת סודות.

כל ממצא יסומן PASS/FAIL/PARTIAL/BLOCKED לפי מילון Engineering-OS, ויאסף ל-`docs/evidence/`.

## 8. שלבים (כל שלב = PR עצמאי עם ראיות)

| # | שלב | תוצר מרכזי | שער יציאה |
|---|---|---|---|
| 0 | **הקמה** | Next.js+TS, lint/format, CI, `.engineering-os-tools.json`, Supabase local, Vercel project + Preview, CLAUDE.md | build+CI ירוקים, Preview חי |
| 1 | **Design System + Shell** | tokens, רכיבי בסיס, layout RTL, i18n, אב-טיפוס מסכים | Storybook/עמוד רכיבים, axe נקי |
| 2 | **DB core + Auth + Tenancy** | סכמה, RLS, הרשמה/התחברות, עסק+slug, onboarding | בדיקות RLS, E2E הרשמה |
| 3 | **Catalog + Availability + מנוע סלוטים** | שירותים, זמינות, חריגים, סלוטים | unit+DST+property tests |
| 4 | **Booking ציבורי** | flow 4 שלבים, סשן/טוקנים, אילוץ חפיפה, אישור הגעה | בדיקת 50-מקבילי, סימולציית נועם |
| 5 | **דשבורד + יומן + תיבת אישורים** | יומן, KPI, תורים ידניים, מדיניות, התראות | סימולציית דנה |
| 6 | **Notifications + Jobs** | תזכורות, re-engagement, התראות בעלים, job_runs | idempotency + failure injection |
| 7 | **Waitlist + Realtime** | הצעות, פקיעה, auto-offer | סימולציית המתנה |
| 8 | **לקוחות, סטטיסטיקות, דוחות** | CRM קל, גרפים, ייצוא | השוואת תוצאות מול הנתונים |
| 9 | **Billing (מנויים) + Entitlements** | plans, gating, webhook, דף חיוב | webhook מדומה+sandbox של הספק |
| 10 | **Google Calendar + ICS + משפטי/עוגיות** | סנכרון דו-צדדי בסיסי, הסכמות | E2E |
| 11 | **הקשחה ושחרור** | ביצועים, אבטחה, Lighthouse, נגישות, runbook, ניטור | דוח qualification מלא |
| ∞ | הגירת נתונים מ-Project 8 (אם קיימים משתמשים אמיתיים) | סקריפט ETL SQL Server→Postgres | **להחלטה** |

## 9. החלטות

> **עודכן:** נענו לפי ההמלצות ב-[יומן ההחלטות](00-decisions.md). בגרסה 1 ההודעות הן **אימייל בלבד (Resend)**; ממשקי SMS/WhatsApp נשארים כ-port בלי מימוש. דרישות האבטחה מפורטות ב-[מסמך 05](05-security-architecture.md).

(הרשימה המקורית נשמרה לתיעוד:)

1. **פרויקט Supabase חדש** (לאשר יצירה — כרוכה בעלות; אזור מוצע `eu-central-1` כמו הקיימים). האם לבנות תחילה על local/branch?
2. **ספק לחיוב המנויים:** Stripe (זמינות/התאמה לעסק ישראלי **טרם נבדקה**), Paddle/Lemon Squeezy (Merchant of Record — מפשט מע"מ), או שער ישראלי (Cardcom/PayPlus/Tranzila…). ההמלצה: להתחיל ב-`manual`+`fake`, ולבחור ספק אחרי בדיקת התאמה משפטית/מיסויית. הארכיטקטורה לא תלויה בבחירה.
3. **מודל החבילות:** מחירים, מגבלות (שירותים/תורים/צוות), תקופת ניסיון — או שנגדיר placeholder ונבנה גמיש.
4. **Next.js מלא-סטאק** (המלצה) לעומת פרונט Vite + API נפרד?
5. **Supabase Auth** (המלצה) לעומת שמירת JWT עצמי.
6. **צוות/מספר נותני שירות** — בהיקף v1 (UI מלא) או רק מוכנות בסכמה (המלצה)?
7. **ערוצי הודעות:** אימייל בלבד (כמו היום) או גם SMS/WhatsApp בגרסה הראשונה? (בפועל WhatsApp הוא הערוץ המרכזי בישראל — תכנון כ-port מראש.)
8. **נתונים קיימים** ב-Project 8 לשימור? דומיין מותאם ל-Vercel?
9. **שפות:** עברית בלבד ב-v1 עם מוכנות ל-i18n (המלצה) או גם אנגלית?
10. **מותג:** שם מוצר, לוגו, כיוון ויזואלי/מוצרים שאוהבים (Fresha, Calendly, Cal.com?) — יישמש לבחירת ה-design system.

## 10. סיכונים

- **יומן RTL איכותי** — מורכב; מקטינים סיכון באב-טיפוס בשלב 1 לפני ההתחייבות לספרייה.
- **אילוץ חפיפה + צוות עתידי** — מתוכנן עם `resource_id` כבר עכשיו.
- **שליחת הודעות בישראל (דליברביליות, WhatsApp Business)** — port + sandbox, אימות בשלב 6.
- **קונקטורים:** ב-Project 8 ה-connector של Supabase נחסם בעבר; בסשן זה הוא פעיל, אך כל טענת "אומת ב-Supabase/Vercel" תגובה בקריאה חיה.
- **גרסאות ספריות** (לקח `@supabase/ssr`): בדיקת Context7/תיעוד לפני כל התקנה + `tsc --noEmit`.
- **Rollback:** שלבים כ-PR קטנים, migrations קדימה בלבד עם down-scripts מתועדים, Preview לפני merge.

## 11. Route Plan (תמצית בפורמט Engineering-OS)

- **Task type:** greenfield rebuild / planning · **Class:** security_sensitive (multi-tenant, auth, billing)
- **Templates:** `booking-system`, `saas-platform` · **Guides:** `multi-tenant-saas`, `modular-monolith` · **Patterns:** auth, authorization, background-jobs, billing, calendar, email, ui, testing
- **Connectors:** GitHub, Supabase, Vercel, Context7, Playwright (+Figma לאב-טיפוס) · **Skills:** ui-ux-pro-max, security-review
- **Validation gates:** CI (lint/types/tests), RLS tests, E2E על Preview, axe/Lighthouse, סקירת אבטחה
- **Evidence:** לפי סעיף 7, מתועד ב-`docs/evidence/`.
