# ארכיטקטורת סייבר ואבטחת מידע

> סטטוס: טיוטת תכנון. מסמך זה אינו ייעוץ משפטי. סעיף 10 (ציות בישראל) דורש אימות מול עו"ד פרטיות לפני השקה.
> **עיקרון מנחה (Engineering-OS `patterns/security`):** אין מערכת "מאובטחת" באופן מוחלט. מדווחים על *כיסוי אימות ופערים שנותרו*, בפורמט: "לא נצפו ממצאים קריטיים/גבוהים בהיקף ASVS/WSTG/CodeQL/SCA/סודות שהורץ ב-revision X; N דרישות לא נבדקו".

## 1. מקורות שנקראו ולמה הם משפיעים על התכנון

| מקור | מה לקחתי |
|---|---|
| Engineering-OS: `patterns/security`, `capability-registry/security/*`, `templates/security/security-qualification.md`, `security-evidence-matrix.md` | סטאק אימות: **ASVS 5.0.0**, **WSTG 4.2**, **NIST SSDF 1.1**; כלים: CodeQL, OSV-Scanner, Trivy, Gitleaks, ZAP, OpenSSF Scorecard; דוח qualification; מטריצת הרשאות; "בדיקת תפקיד מול tenant אחר" |
| Engineering-OS: `templates/saas-platform`, `templates/booking-system`, `docs/architecture-guides/web/multi-tenant-saas.md` | צ'קליסטים: tenant מהסשן בלבד, RLS נבדק, webhook עם חתימה, PII לא בלוגים, rate-limit על זמינות, CSRF, MFA למנהלים |
| Engineering-OS: `docs/troubleshooting/{database,payments,auth}.md` | RLS בלי policy = חסימה מלאה; anon key בשרת = RLS חל; service_role = עוקף; webhook: raw body + idempotency לפי `event.id` |
| Engineering-OS: `lessons-learned` (`negative-test-passing-for-the-wrong-reason`, `guard-precondition-weaker-than-the-operation`, `unit-level-contract-passing-while-wiring-violates-it`) | בדיקות אבטחה שלילית חייבות להיכשל מהסיבה הנכונה; שער חלש מהפעולה שהוא שומר = חור; עובר ביחידה ≠ מחובר נכון |
| Supabase docs (Context7, `/supabase/supabase`) | פונקציות `SECURITY DEFINER` רק ב-schema לא חשוף + `set search_path = ''` + `revoke execute` מ-`anon/authenticated`; `(select auth.uid())` ב-policy; views עם `security_invoker`; policy מגבילה לפי `aal2`; מפתחות publishable/secret; rate-limits ל-Auth |
| Next.js 16 docs (Context7, `/vercel/next.js`) | Data Access Layer עם `server-only`; בדיקת הרשאה בכל Server Action/Route Handler (IDOR); CSP עם nonce ב-`proxy`; משתני סביבה צד שרת בלבד |
| Resend docs (Context7) | אימות webhook (Svix) על ה-raw body; `idempotencyKey` (תקף 24 שעות); SPF/DKIM אוטומטי, DMARC דורש הגדרה |
| OWASP ASVS 5.0.0 (מבנה פרקים V1–V17) | מטריצת תחולה בסעיף 9 |
| חיפוש ציות ישראלי (סעיף 10) | תיקון 13 לחוק הגנת הפרטיות — נכנס לתוקף 14.8.2025 |

> **ביקורת עצמית על התיעוד:** ספריית הידע דקה בנושא אבטחה (דירוג קודם 2/5 ב-`patterns/security`, והפרויקט הקודם רשם זאת). לכן הושלם מתיעוד רשמי עדכני. פרטי API (שמות מפתחות Supabase, פקודות Next 16) **יאומתו מחדש בזמן הכתיבה** — לקח `@supabase/ssr`.

## 2. נכסים ורגישות מידע

| נכס | סיווג | הערות |
|---|---|---|
| פרטי לקוחות קצה (שם, טלפון, אימייל, היסטוריית תורים) | **PII** | חשיפה = נזק פרטיות + שימוש לפישינג |
| סוג העסק / שם שירות / הערות | **עלול להיות רגיש** | סוג עסק "רפואה" (קיים ברשימה של Project 8): שם שירות או הערה יכולים לחשוף מצב בריאותי ⇒ **מזעור**: לא לכלול שם שירות בנושא אימייל ובהתראות; הערות חופשיות מוצגות רק לבעלים |
| פרטי הזדהות של בעלי עסק, סשנים, MFA | **סודי** | באחריות Supabase Auth |
| טוקני Google Calendar (refresh token) | **סודי מאוד** | הצפנה ברמת עמודה / Supabase Vault (לאמת זמינות בזמן המימוש), לא נחשפים בשום endpoint |
| מפתחות: Supabase secret/service_role, Resend, סוד חתימת טוקנים, `CRON_SECRET`, webhook secrets | **סודי מאוד** | סעיף 5.7 |
| מצב מנוי והרשאות (entitlements) | **שלמות קריטית** | זיוף = שימוש חינם; נקבע רק מ-webhook מאומת |
| מדיניות וטקסטי עסק | רגיל | נתון ל-XSS אם מוצג לא נכון |
| `audit_log`, `appointment_transitions` | **שלמות** | append-only |
| קוד מקור, CI, סביבת Vercel | תשתית | שרשרת אספקה |

## 3. תרשים אמון ופני התקפה

```
[גולש/בוט]──(1)──► דפי הזמנה ציבוריים + Route Handlers  ──► DB דרך מודול ציבורי צר (RPC/service)
[בעל עסק]──(2)──► Dashboard (Supabase Auth cookie) ──► DAL (user-scoped client + RLS) ──► Postgres
[Resend / ספק חיוב]──(3)──► Webhooks (חתימה + idempotency)
[Vercel Cron / pg_cron]──(4)──► /api/jobs/* (CRON_SECRET)
[Google]◄─(5)─► OAuth + Calendar API
[מפתחים/CI]──(6)──► GitHub ► Actions ► Vercel ► Supabase (migrations)
[תמיכה/Admin]──(7)──► Back-office (MFA + audit)
```

### מודל איומים (STRIDE מצומצם) לפי גבול אמון

| # | גבול | איום עיקרי | הגנה (סעיף) |
|---|---|---|---|
| 1 | הזמנה ציבורית | זיוף/ספאם הזמנות, אכלוס סלוטים (hoarding), הצפת אימייל לכתובת קורבן, enumeration של לקוחות/slugs, scraping זמינות | 5.4, 5.5 |
| 1 | קישורי טוקן (ביטול/אישור/המתנה) | שימוש חוזר, זיוף, **ביצוע פעולה ע"י סורק קישורים/תצוגה מקדימה של אימייל** (GET) | 5.3 |
| 2 | דשבורד | IDOR בין עסקים, הסלמת הרשאות, XSS שמור משדה לקוח, CSRF | 5.1, 5.2, 5.6 |
| 3 | Webhooks | זיוף אירוע חיוב ("שדרוג חינם"), replay, סדר הפוך | 5.8 |
| 4 | Jobs | קריאה חיצונית ל-endpoint, ריצה כפולה | 5.8 |
| 5 | Google | גניבת טוקן, CSRF ב-OAuth (state), היקף הרשאות רחב | 5.9 |
| 6 | שרשרת אספקה | תלות זדונית, סוד שדלף ל-git/לוג CI, פעולת CI מזויפת, מיגרציה זדונית | 7 |
| 7 | Admin | שימוש לרעה בגישת תמיכה | 5.10 |
| — | DB | RLS חסר בטבלה חדשה, פונקציה חשופה, view שעוקף RLS | 5.1 |
| — | זהות עסק | רישום עסק ששמו מחקה מותג/בנק לצורכי פישינג דרך דף ההזמנה שלנו | 5.11 |

## 4. עקרונות ארכיטקטוניים (Secure by Design)

1. **ברירת מחדל = דחייה** (default deny): RLS בכל טבלה, אפס הרשאות ל-`anon` על טבלאות, אפס `execute` ציבורי על פונקציות.
2. **הרשאה אכיפה בכמה שכבות (defense in depth):** DB (RLS) → DAL/service (בדיקת הרשאה מפורשת) → Route/Action (אימות סכמה + סשן) → UI (הסתרה בלבד, לא בקרה).
3. **tenant תמיד נגזר מהסשן/membership** — לעולם לא מבקשה (SEC-02).
4. **מינימום הרשאות למפתחות וליכולות:** שני נתיבי גישה נפרדים, ראו 5.1.
5. **שלמות עסקית ב-DB** (אילוץ חפיפה, מכונת מצבים, unique) — לא רק בקוד.
6. **תופעות לוואי אחרי commit** דרך outbox עם idempotency; כשל ספק לא משנה מצב.
7. **פעולות הרסניות = POST אחרי אישור מכוון**, לא GET.
8. **ראיות, לא הצהרות:** כל בקרה P0 בעלת בדיקה אוטומטית ב-CI + ראיה על Preview.

## 5. בקרות מפורטות

### 5.1 מודל גישה לנתונים ו-RLS (Supabase)
- **שני נתיבים בלבד:**
  1. *נתיב בעלים/צוות:* קוד שרת (DAL, `import 'server-only'`) יוצר Supabase client **בהקשר המשתמש** (publishable key + JWT מה-cookie) ⇒ RLS חל תמיד.
  2. *נתיב ציבורי/מערכת:* מודול אחד `platform/system-db` (המפתח הסודי/service role) המשמש רק להזמנה ציבורית, jobs, webhooks. נאכף ב-lint (`no-restricted-imports`) וב-CI: אסור לייבא אותו מ-`app/(dashboard)` או מרכיבי client. ה-bundle נסרק שאין בו מפתח סודי (SEC-04).
- `anon`: **`revoke all` על כל הטבלאות** בסכמה `public` (גם אם יש RLS); `alter default privileges … revoke` על טבלאות ופונקציות חדשות כך שטעות של "שכחתי" לא פותחת דבר.
- RLS: `enable` **ו-`force`** בכל טבלה; policy `to authenticated`; שימוש ב-`(select auth.uid())` (ביצועים); בדיקת חברות (membership) דרך פונקציית עזר `private.is_member(business_id, min_role)` — `security definer`, `set search_path = ''`, בסכמה `private` שאינה חשופה ב-Data API, עם `revoke execute … from public, anon, authenticated` ומתן הרשאה רק היכן שנדרש.
- **התפקיד אינו נשמר ב-JWT claims** אלא נבדק מול `business_members` — כך הסרת איש צוות נכנסת לתוקף מיד ולא בפקיעת הטוקן.
- Views: `with (security_invoker = true)`. אסור `security definer` views.
- Realtime: ערוצים פרטיים בלבד, עם אישור; `postgres_changes` מכבד RLS (לדרוש policy select).
- Storage (לוגו וכו', עתידי): bucket פרטי כברירת מחדל, policy לפי `business_id`, הגבלת סוג/גודל, סריקה.
- פעולות רגישות (שינוי חיוב, מחיקת חשבון, ייצוא): policy `restrictive` / בדיקה שרתית ל-`aal2` כשהמשתמש רשם MFA; אחרת re-authentication טרי.
- **schema-lint ב-CI (חוסם merge):** כל טבלה ב-`public` עם RLS+force; אין grant ל-anon; כל פונקציה `security definer` עם `search_path` נעול ו-execute מוגבל ובסכמה לא חשופה; אין view בלי `security_invoker`; לכל טבלה עם `business_id` יש אינדקס מוביל. בנוסף: `Supabase get_advisors (security)` אחרי כל DDL.
- בדיקות pgTAP לכל policy: חבר / לא-חבר / חבר שהוסר / anon / עסק אחר; **בקרה שלילית**: policy הושבת זמנית ⇒ הבדיקה נכשלת על "דליפת שורות" ולא על שגיאה אחרת.

### 5.2 אימות וסשנים (בעלי עסק)
- Supabase Auth; אימייל מאומת לפני פרסום קישור הזמנה; סיסמה: אורך מינימלי 12, בדיקת סיסמאות שדלפו (אם זמין בתכנית — לאמת), אין חוקי הרכב מגבילים.
- **MFA (TOTP)** לבעלים: זמין מהיום הראשון; נדרש לפעולות רגישות; חובה לאדמינים.
- הגדרות Auth להקשחה: תוקף OTP/קישור קצר, rate-limits מוגדרים במפורש (`rate_limit_*`), **רשימת redirect URLs מדויקת** (ללא wildcards), נעילה/השהיה אחרי כשלונות, הודעות אחידות (אין enumeration — ACC-02).
- Cookies בלבד (`@supabase/ssr`, בדיקת גרסה מול תיעוד עדכני לפני התקנה), `HttpOnly; Secure; SameSite=Lax`; **אין טוקנים ב-localStorage**; התנתקות מבטלת סשן; שינוי סיסמה/אימייל מבטל סשנים אחרים והודעה לכתובת הישנה.
- רישום כניסות (`login_audit`), התראה על כניסה ממכשיר חדש (P2).

### 5.3 קישורי לקוח (capability tokens) — **שינוי חשוב מ-Project 8**
ב-Project 8 אישור הגעה וקבלת הצעת המתנה היו `GET` שמבצע פעולה. סורקי אימייל (Defender, Gmail, Apple Mail Privacy) ותצוגות מקדימות מבקרים בקישורים ו"מאשרים" בשם הלקוח.
- קישור במייל ⇒ `GET` מציג דף אישור (ללא שינוי מצב) ⇒ לחיצה על כפתור ⇒ `POST` עם CSRF/nonce.
- טוקן: HMAC-SHA256 על `{appointment_id, scope, exp, jti}`; `kid` לסבב מפתחות; השוואה בזמן קבוע; scope מצומצם (`view|cancel|confirm|accept_offer`); פעולות הרסניות חד-פעמיות (`jti` נשמר ב-DB, מתבטל בשימוש); תוקף קצר ביחס לפעולה (הצעת המתנה = לפי הפקיעה שלה).
- `Referrer-Policy: no-referrer` ו-`Cache-Control: no-store` בדפי הטוקן; הטוקן לא נרשם בלוגים (מסנן ב-Vercel Log Drains/pino).
- אין חשיפת מידע על תורים אחרים; תגובות שגיאה אחידות (403 כללי).

### 5.4 הגנת ממשק הזמנה ציבורי מפני ניצול
- **Rate limiting** שכבתי: Vercel Firewall (rate rule לנתיבי `/api/public/*`) + מגביל אפליקטיבי לפי IP + טלפון + אימייל + עסק (ספרייה כ-`@upstash/ratelimit` או טבלת מונים ב-DB — להחלטה). הגבלות שונות לקריאה (זמינות) לעומת כתיבה (הזמנה, המתנה).
- **Turnstile / CAPTCHA אדפטיבי** בהזמנה והמתנה רק כשיש סיגנל חשד (מהירות, IP נדיר, כשלונות).
- **Email bombing:** ההזמנה שולחת מייל לכתובת שהוזנה ע"י אלמוני. הגנה: מגבלת מיילים לכתובת ליום; מייל האישור ניטרלי (ללא תוכן שיווקי/קישורי חיצוני); קישור "זו לא אני" שמבטל וסופר לחסימה; אימות אימייל אופציונלי לעסקים רגישים.
- **Slot hoarding:** החזקות (`slot_holds`) מוגבלות לכמות ל-IP/טלפון ובתוקף קצר.
- Enumeration: אין endpoint שמחזיר "קיים/לא קיים" לטלפון/אימייל; slugs נבדקים ב-rate limit; אין רשימת עסקים ציבורית.
- Endpoint זמינות מחזיר סלוטים פנויים בלבד (BKG-13), עם cache קצר.

### 5.5 קלט, פלט וצד לקוח (ASVS V1–V3)
- **Zod בגבול כל endpoint** (params, query, headers, body), `strict` ל-mass-assignment; סכמות משותפות client/server.
- שאילתות: Supabase client/RPC עם פרמטרים בלבד; אין חיבור מחרוזות SQL; RPC מקבלים טיפוסים מוגדרים.
- **XSS:** React escape כברירת מחדל; אין `dangerouslySetInnerHTML` (ESLint חוסם) למעט עטיפה מבוקרת; טקסטי מדיניות הם טקסט, לא HTML; תוכן משתמש באימייל מוצג דרך React Email (escape).
- **CSP עם nonce** דרך `proxy` (Next 16) — `default-src 'self'`, `script-src 'self' 'nonce-…' 'strict-dynamic'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'` (דף הטמעה עתידי = נתיב נפרד עם allowlist), `upgrade-insecure-requests`. בנוסף: HSTS (כולל preload אחרי בדיקה), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` מצומצם.
- **CSRF:** Server Actions מגינים לפי Origin; Route Handlers שמשנים מצב — בדיקת `Origin`/`Sec-Fetch-Site` + SameSite; CORS סגור כברירת מחדל.
- **Open redirect:** פרמטרי `next`/`redirect_to` נבדקים מול allowlist של נתיבים פנימיים.
- **CSV/Excel injection** בייצוא: נטרול תחיליות `= + - @` (RPT-03).
- שגיאות: פורמט אחד `{code,message,requestId}`; ללא stack/SQL ללקוח.

### 5.6 הרשאות באפליקציה (ASVS V8) — Next.js
- כל Server Action ו-Route Handler הם **נקודות קצה ציבוריות**: בכל אחד — `verifySession()` → בדיקת חברות/תפקיד מול ה-DB → בדיקת בעלות על המשאב (`business_id` של המשאב = העסק של המשתמש) → רק אז פעולה. הלוגיקה בתוך DAL, לא בקומפוננטות.
- `can(business, feature)` / `limit(business, key)` (entitlements) נאכפים בשרת; תגובה אחידה 402/403 (BIL-08).
- תפקידים: `owner > admin > staff`; staff רואה רק יומן אישי; מטריצת הרשאות אחת בקוד ובתיעוד, נבדקת אוטומטית.

### 5.7 סודות, מפתחות וסביבות
- מפתחות Supabase: להעדיף **publishable/secret** (אם הפרויקט תומך; אחרת anon/service_role הישנים) — לאמת בתיעוד בזמן ההקמה. המפתח הסודי **רק** ב-env צד שרת של Vercel (מסומן Sensitive), לעולם לא `NEXT_PUBLIC_*`.
- הפרדת סביבות: Production / Preview / Development, **כל אחת עם פרויקט/branch Supabase נפרד, דומיין שולח נפרד ומפתחות Resend נפרדים**. Preview לעולם לא מדבר עם DB ייצור (OPS-08). נתוני בדיקה סינתטיים בלבד (אין נתוני ייצור ב-QA).
- סודות אפליקציה: `TOKEN_SIGNING_KEYS` (עם `kid`), `CRON_SECRET`, `RESEND_WEBHOOK_SECRET`, סוד webhook חיוב. סבב מתוכנן (פעמיים בשנה) ו**מיידי** לאחר חשד; runbook בסעיף 11.
- Gitleaks: pre-commit + CI על כל ההיסטוריה (סריקת working-tree בלבד אינה מוכיחה היסטוריה נקייה). סוד שזוהה = **ביטול וסבב**, לא מחיקה מהקובץ.
- `.env*` ב-.gitignore; `.env.example` ללא ערכים; Vercel Environment Variables בלבד.

### 5.8 Webhooks ו-Jobs
- **Resend:** `POST /api/webhooks/resend` קורא `await req.text()` (raw body), מאמת חתימה (Svix: `svix-id/timestamp/signature`) עם `RESEND_WEBHOOK_SECRET` **לפני** כל פירסור; חלון timestamp (דחיית replay); idempotency לפי `svix-id`; מחזיר 2xx מהר ומעבד אסינכרונית; מעדכן `notification_log` ו-`suppressions` (bounce/complaint).
- **ספק חיוב:** אותו דפוס; מצב מנוי נקבע **רק** מ-webhook מאומת ב-`billing_events(event_id unique)`; סדר לפי `occurred_at`.
- **Jobs:** `/api/jobs/*` דורשים `Authorization: Bearer $CRON_SECRET` (Vercel Cron) או סוד ייעודי ל-pg_cron/pg_net; השוואה בזמן קבוע; ללא הרשאה ⇒ 404 (לא חושפים קיום); נעילה (`job_runs` + advisory lock); לוג ריצה.
- כל קריאה יוצאת (Google, Resend, חיוב) עם timeout, retry מוגבל, ללא רישום גוף בקשה עם PII.

### 5.9 Google Calendar (OAuth)
- היקף מינימלי (`calendar.events`), `state` ו-PKCE, אימות `redirect_uri` מדויק, ניתוק ע"י המשתמש מוחק טוקנים ומבטל אצל Google.
- Refresh token מוצפן ברמת עמודה/Vault; אף API לא מחזירו; גישה לטבלה רק מ-`platform/system-db`.
- אירועי יומן לא כוללים PII מיותר (שם פרטי + שירות כללי; ללא הערות/טלפון כברירת מחדל).

### 5.10 Admin / תמיכה
- Back-office נפרד (route group ו-middleware משלו), רשימת מורשים, **MFA חובה**, כל גישה ללקוח דורשת סיבה, מוגבלת בזמן, נרשמת ב-`audit_log` ונראית לבעל העסק (SEC-10). ללא תצוגת PII כברירת מחדל; override של entitlement עם `reason` ו-`expires_at`.
- בגרסה 1: גישת קריאה בלבד לתמיכה; אין "התחזות" (impersonation).

### 5.11 ניצול הפלטפורמה לפישינג והתחזות
- דף ההזמנה חי תחת הדומיין שלנו ⇒ שם עסק/תיאור זדוניים עלולים לנצל את האמון בדומיין. בקרות: סינון שמות מותגים/מילות מפתח רגישות (בנקים, רשויות) בעת הרישום ⇒ סקירה ידנית; כפתור "דווח על עסק"; יכולת השעיית עסק (kill switch) ע"י תמיכה; ללא קישורים חיצוניים/HTML בתיאור; אזהרת ויזואלית לפני מעבר ליעד חיצוני.

### 5.12 הגנת מידע ופרטיות בתכנון
- **מזעור:** אוספים שם + טלפון (אימייל אופציונלי); אין ת.ז./תאריך לידה; הערות חופשיות מסומנות ככאלה שעלולות להיות רגישות.
- **הצפנה:** TLS בכל מקום (HSTS); במנוחה — הצפנת Supabase; טוקנים חיצוניים בהצפנת עמודה.
- **שמירה ומחיקה:** מדיניות retention מוגדרת (להחלטה): למשל PII של לקוח קצה X חודשים אחרי פעילות אחרונה ⇒ אנונימיזציה אוטומטית; `login_audit` 12 חודשים; `audit_log` לפי חובה; ייצוא ומחיקה לבעל עסק (ACC-09) ומחיקת לקוח קצה (CMP-02).
- **לוגים:** מסננים ל-PII (טלפון/אימייל/שם/טוקנים); `request_id` ו-`business_id` בלבד.
- **גיבויים:** PITR + תרגיל שחזור לפני השקה (OPS-07); גיבויים נחשבים גם הם מחזיקי PII — נכללים במדיניות שמירה.
- **אימייל:** נושא ללא שם שירות/פרטים רגישים; React Email עם escape; `List-Unsubscribe` להודעות שאינן שירות; הפרדת הודעות שירות/שיווק.

### 5.13 אימייל מול Resend — אבטחה ודליברביליות (v1: אימייל בלבד)
- דומיין שולח ייעודי (תת-דומיין, למשל `mail.<domain>`) עם **SPF + DKIM (אוטומטי) + DMARC** — מתחילים ב-`p=none` עם דיווח, מעלים ל-`quarantine`/`reject` אחרי אימות; מפתח API ייעודי לשליחה בלבד (לא מפתח מלא); מפתח נפרד לכל סביבה.
- `idempotencyKey = sha256(appointment_id:type:scheduled_for)` על כל שליחה (תקף 24 שעות — מעבר לכך הגנה ב-`notification_log` unique).
- Bounce/Complaint ⇒ `suppressions` (הפסקת שליחה לכתובת); הודעות אישור-תור הן "שירות", re-engagement דורש הסכמה ו-unsubscribe.
- WhatsApp/SMS **מחוץ ל-v1** (החלטה). ה-`NotificationChannel` port נשאר בקוד כדי שלא נצטרך ריפקטור — בלי מימוש ובלי ספק.

## 6. תרחישי תקיפה נוספים (מתווספים לקטלוג, מסמך 04)

| ID | תרחיש | בקרה / בדיקה | P |
|---|---|---|---|
| SEC-11 | סורק אימייל "לוחץ" על קישור אישור/ביטול/קבלת המתנה | GET לא משנה מצב; בדיקת E2E ש-GET בלבד אינו מבצע פעולה | P0 |
| SEC-12 | הצפת מיילים לכתובת קורבן דרך טופס ההזמנה | מגבלות לכתובת/IP, קישור "זו לא אני" | P0 |
| SEC-13 | הסרת איש צוות — האם הגישה נפסקת מיד? | תפקיד נבדק ב-DB לא ב-JWT; בדיקה | P0 |
| SEC-14 | פונקציית `security definer` חשופה דרך Data API | schema-lint + advisors | P0 |
| SEC-15 | שימוש ב-service key בנתיב בעלים (עוקף RLS בטעות) | lint + בדיקת ארכיטקטורה + בדיקת dependency graph | P0 |
| SEC-16 | tenant A קורא RPC עם `business_id` של B | RPC בודק חברות; בדיקת pgTAP | P0 |
| SEC-17 | Webhook מזויף "מנוי פעיל" / replay | חתימה + idempotency + חלון זמן | P0 |
| SEC-18 | Endpoint של job נקרא מבחוץ | 404 ללא סוד; בדיקה | P0 |
| SEC-19 | Open redirect בהתחברות/OAuth | allowlist נתיבים | P1 |
| SEC-20 | OAuth של Google: state חסר/מזויף | דחייה | P1 |
| SEC-21 | Timing/enumeration בהתחברות ובחיפוש לקוח | תגובות וזמנים אחידים | P1 |
| SEC-22 | Clickjacking על דף הזמנה/אישור | `frame-ancestors 'none'` | P1 |
| SEC-23 | XSS שמור בשם לקוח המוצג בדשבורד וביומן | escape; בדיקה עם payloads | P0 |
| SEC-24 | CSV injection בייצוא | נטרול תחיליות | P1 |
| SEC-25 | הרשמת עסק שמתחזה למותג/בנק | סינון + סקירה + דיווח | P1 |
| SEC-26 | Preview מפנה ל-DB/ספק ייצור | env scoping; בדיקת CI על ערכי env | P0 |
| SEC-27 | שימוש בספרייה/פעולת CI פגיעה או זדונית | OSV/Trivy, פעולות מוצמדות ל-SHA, Dependabot | P0 |
| SEC-28 | Slot hoarding (DoS לוגי) | תקרת החזקות | P1 |
| SEC-29 | הזנת נתוני "בריאות" בהערות ושליפתם במייל/יומן חיצוני | הערות לא נשלחות החוצה | P0 |
| SEC-30 | Replay של טוקן ביטול אחרי שימוש | `jti` חד-פעמי | P0 |

## 7. שרשרת אספקה ו-CI/CD (NIST SSDF 1.1)

- **Dependencies:** `package-lock` מחייב; `npm ci`; **OSV-Scanner** + `npm audit` ב-CI; Dependabot/Renovate עם סקירה; גרסאות מוצמדות; בדיקת תיעוד עדכני + `tsc --noEmit` אחרי כל התקנה (לקח `@supabase/ssr`).
- **סריקות:** CodeQL (SAST, JS/TS), Trivy (`fs` + config/IaC), Gitleaks (היסטוריה מלאה), OpenSSF Scorecard (רבעוני). תוצאות מנותחות; ממצא Critical/High חוסם merge.
- **GitHub Actions:** `permissions:` מינימליים (read-only כברירת מחדל), פעולות צד שלישי מוצמדות ל-commit SHA, אין סודות ל-PR מ-forks, `pull_request_target` אסור ללא סקירה, Environments עם אישור ידני לייצור.
- **Branch protection:** PR חובה, CI ירוק חובה, **CODEOWNERS** על `supabase/migrations/**`, `**/policies/**`, `.github/workflows/**`, `proxy.ts`/headers — כל שינוי אבטחתי נסקר.
- **מיגרציות:** forward-only, נבדקות על Supabase branch לפני merge, מריצות schema-lint + advisors.
- **Vercel:** Deployment Protection ל-Preview, סודות Sensitive, Firewall/WAF ו-Attack Challenge Mode זמינים כ-kill switch, Log Drain עם redaction.
- **כלי AI/סקילים:** לפי Engineering-OS — לבדוק סקריפטים של skills/MCP צד שלישי לפני הרצה; הרשאות קונקטורים מינימליות; **הפרויקט לא ישלח נתוני לקוחות אמיתיים לשום מודל/כלי**; פלט Claude Security (בטא) הוא קלט ראיה בלבד.

## 8. תצפית, זיהוי ותגובה

- **אירועי אבטחה שנרשמים:** כשלי התחברות, MFA, החלפת סיסמה/אימייל, ניסיונות טוקן שגויים/חוזרים, חריגות rate-limit, כשלי חתימת webhook, פעולות admin, שינוי entitlements, מחיקות/ייצוא נתונים.
- `audit_log` append-only (`revoke update, delete`), עם `actor`, `action`, `target`, `request_id`.
- התראות: קפיצה בכשלי חתימה/התחברות, 5xx, jobs שלא רצו, שגיאות RLS חריגות (Supabase logs), עלייה חדה בשליחת מיילים.
- **Kill switches (feature flags):** השבתת הזמנה ציבורית, השבתת שליחת מיילים, השעיית עסק, מצב תחזוקה.

## 9. מטריצת תחולה ASVS 5.0.0 (תכנון; סטטוס = NOT TESTED עד הוכחה)

| פרק | נושא | תחולה | בקרות מרכזיות | ראיה מתוכננת |
|---|---|---|---|---|
| V1 | Encoding & Sanitization | כן | 5.5 | בדיקות XSS/inj, ZAP |
| V2 | Validation & Business Logic | **כן (גבוה)** | Zod, אילוצי DB, מכונת מצבים, מדיניות | קטלוג תרחישים, WSTG-BUSL |
| V3 | Web Frontend Security | כן | CSP, headers, cookies | בדיקת headers אוטומטית, ZAP |
| V4 | API & Web Service | כן | 5.4, 5.5, 5.8 | contract tests, ZAP API |
| V5 | File Handling | חלקי (עתידי: לוגו) | Storage policies | יבדק כשיתווסף |
| V6 | Authentication | כן | 5.2 (Supabase Auth, MFA) | WSTG-ATHN, בדיקות ידניות |
| V7 | Session Management | כן | cookies, ביטול סשן | WSTG-SESS |
| V8 | Authorization | **כן (קריטי)** | 5.1, 5.6, מטריצת הרשאות | pgTAP + E2E אנונימי/A/B/הוסר/admin |
| V9 | Self-contained Tokens | כן | טוקני לקוח (5.3) | unit + fuzz + replay |
| V10 | OAuth & OIDC | כן (Google, Supabase) | 5.9 | WSTG + ידני |
| V11 | Cryptography | כן | HMAC, הצפנת עמודה, סבב מפתחות | סקירת קוד + unit |
| V12 | Secure Communication | כן | TLS/HSTS | בדיקת SSL Labs/headers |
| V13 | Configuration | כן | 5.7, env scoping | Trivy config, סקירה |
| V14 | Data Protection | כן | 5.12 | בדיקת לוגים, retention job |
| V15 | Secure Coding & Architecture | כן | סעיף 4, lint ארכיטקטוני | CodeQL + סקירה |
| V16 | Logging & Error Handling | כן | סעיף 8, 5.5 | בדיקת הזרקת תקלה |
| V17 | WebRTC | לא חל | — | NOT APPLICABLE |

## 10. ציות ופרטיות בישראל (לאימות משפטי)

- **תיקון 13 לחוק הגנת הפרטיות** נכנס לתוקף ב-14.8.2025 (לפי סיכומים משפטיים שנמצאו; לא נקרא נוסח החוק עצמו): הגבלה משמעותית של חובת רישום מאגרים, הרחבת חובת מינוי ממונה אבטחת מידע, חובת ממונה הגנת פרטיות במקרים מסוימים, והרחבת סמכויות אכיפה ועיצומים כספיים. **מעבדי מידע (טכנולוגיה) הוגדרו כ"מחזיקים" עם חובות ישירות.**
- **תקנות אבטחת מידע (2017)** — מחייבות רמת אבטחה לפי רגישות המאגר ומספר נושאי המידע. *לא נבדקו בסשן זה — לבדוק מול עו"ד.*
- מה נדרש ממנו כמפעיל פלטפורמה (חשד ל"בעל מאגר" ביחס לבעלי עסקים, "מחזיק" ביחס ללקוחות הקצה): הסכם עיבוד מידע (DPA) ללקוחות העסקיים; מדיניות פרטיות ותנאים (קיימים ב-Project 8, יעודכנו); נוהל אירוע אבטחה והודעה לרשות; מיפוי מעבדי משנה — **Supabase, Vercel, Resend, ספק חיוב, Google** — והסכמי עיבוד מולם.
- **מיקום נתונים והעברה בינלאומית:** Supabase `eu-central-1` (פרנקפורט); Vercel — לקבע region של פונקציות לאירופה; להעריך העברת נתונים מחוץ לישראל מול הדרישות (האיחוד האירופי מוכר כמספק הגנה הולמת — **לאמת**).
- **סוג עסק "רפואה":** ייתכן מידע רגיש במיוחד; ייעוץ משפטי לפני שמאפשרים קטגוריה זו, או הגבלה (ללא הערות חופשיות, ללא שם שירות במייל).
- **נגישות** (תקנות שוויון זכויות לאנשים עם מוגבלות — נגישות שירות): הצהרת נגישות, WCAG AA (CMP-04).
- **דיוור:** הודעות שירות מול דיוור שיווקי (חוק התקשורת, "חוק הספאם") — הסכמה מתועדת ל-re-engagement.

## 11. תגובה לאירועים (Runbook מצומצם)

1. **זיהוי וריסון:** kill switch רלוונטי; Vercel Attack Challenge Mode אם התקפה.
2. **סבב סודות:** רשימה מרוכזת (Supabase secret key, Resend, `TOKEN_SIGNING_KEYS` — הוספת `kid` חדש ושמירת הישן לאימות בלבד, `CRON_SECRET`, webhooks, Google OAuth client); סדר פעולות מתועד.
3. **ביטול סשנים וטוקנים:** `signOut` גלובלי; ביטול `jti`.
4. **הערכת היקף:** `audit_log`, Supabase/Vercel logs (ללא העתקת PII לכלים חיצוניים).
5. **הודעה:** לבעלי עסקים מושפעים ולרשות לפי דין (לאימות משפטי).
6. **Post-mortem + בדיקת regression** ברמה הנמוכה ביותר שמשחזרת את הבאג (Engineering-OS), ועדכון קטלוג התרחישים.

## 12. תוכנית אימות אבטחה (תבנית Engineering-OS)

1. **סטטי:** CodeQL, ESLint-security + כללי ארכיטקטורה, Trivy, OSV, Gitleaks (היסטוריה).
2. **DB:** pgTAP לכל policy, schema-lint, Supabase advisors (security+performance).
3. **דינמי:** ZAP baseline/API scan על **Preview** עם הקשר מאומת (בעלים A, בעלים B); תרחישי WSTG: IDNT, ATHN, ATHZ, SESS, INPV, ERRH, CRYP, BUSL, CLNT, APIT, CONF.
4. **מטריצת הרשאות ידנית/אוטומטית:** אנונימי · לקוח עם טוקן · בעלים A · בעלים B · staff · חבר שהוסר · טוקן פג · admin.
5. **הזרקת תקלה:** חתימת webhook שגויה, replay, ספק נופל, DB לא זמין.
6. **סקירת אבטחה** (`security-review` + Claude Security אם זמין) — כקלט, לא כהוכחה.
7. **Pentest חיצוני לפני השקה ציבורית** (המלצה, בעיקר סביב tenant isolation, טוקנים ו-billing) — להחלטה.
8. **דוח qualification** ב-`docs/evidence/security/` לפי `templates/security/security-qualification.md`: SHA מדויק, סביבה, גרסאות כלים, PASS/FAIL/PARTIAL/BLOCKED/NOT TESTED לכל דרישה, פערים שנותרו.

## 13. מיפוי לשלבי הבנייה

| שלב | בקרות שנכנסות |
|---|---|
| 0 הקמה | Gitleaks+pre-commit, CodeQL, OSV, Trivy, Dependabot, branch protection+CODEOWNERS, Actions מוצמדות, env scoping, headers+CSP בסיס, lint ארכיטקטוני, Vercel Deployment Protection |
| 1 Design System | מנגנון escape/רכיבי טקסט בטוחים, אזהרות מעבר לקישור חיצוני |
| 2 DB+Auth+Tenancy | שני נתיבי גישה, RLS+force, default privileges, schema-lint, pgTAP, Auth hardening, MFA, DAL, audit_log, redaction בלוגים |
| 3–4 זמינות + הזמנה | Zod, rate-limit, Turnstile, טוקני לקוח (GET→POST), email bombing, holds מוגבלים, Idempotency-Key |
| 5 דשבורד | אכיפת הרשאות בכל Action, XSS בנתוני לקוח, CSRF |
| 6 הודעות | Resend: דומיין+SPF/DKIM/DMARC, webhook verify, suppressions, idempotency |
| 7 המתנה | הצעות חתומות חד-פעמיות, Realtime פרטי |
| 8 דוחות | CSV injection, ייצוא אסינכרוני בקישור חתום |
| 9 חיוב + Admin | webhook מאומת, entitlements שרתי, back-office מאובטח |
| 10 Google | OAuth state/PKCE, הצפנת טוקן |
| 11 הקשחה | ZAP על Preview, מטריצת הרשאות, pentest, DMARC enforcement, תרגיל שחזור, דוח qualification |

## 14. החלטות פתוחות (אבטחה)

1. **Rate limiting:** Upstash Redis (חיצוני, ספק נוסף) או מונים ב-Postgres (פשוט יותר, פחות מהיר)? המלצה: להתחיל ב-Vercel Firewall + טבלת מונים, ולעבור ל-Redis רק אם יידרש.
2. **CAPTCHA:** Cloudflare Turnstile (המלצה, ללא חיכוך) — אישור?
3. **MFA:** חובה לבעלים מיום ראשון או רק לפעולות רגישות? (המלצה: מומלץ + נדרש לפעולות רגישות; חובה לאדמינים.)
4. **Retention:** תקופות שמירה ל-PII של לקוחות קצה ולרשומות (הצעה: 24 חודשים מפעילות אחרונה לפני אנונימיזציה).
5. **סוג עסק "רפואה":** להשאיר, להגביל, או להשמיט מ-v1?
6. **Pentest חיצוני** לפני השקה — כן/לא ובאיזה תקציב.
7. **ייעוץ משפטי:** עו"ד פרטיות לבדיקת DPA, תנאים, ותקנות האבטחה.
8. **שפת וכתובת דומיין:** דומיין ראשי וכתובת שולחת (נדרש להקמת SPF/DKIM/DMARC).

## מקורות

- OWASP ASVS 5.0.0 — https://github.com/OWASP/ASVS/tree/v5.0.0/5.0/en
- OWASP WSTG 4.2, NIST SSDF 1.1 — כפי שמפורט ב-`Engineering-OS/patterns/security/README.md`
- Supabase — Row Level Security, Database Functions, Auth Rate Limits (דרך Context7 `/supabase/supabase`)
- Next.js 16 — Data Security, Authentication, Content Security Policy (דרך Context7 `/vercel/next.js`)
- Resend — Webhooks (Svix), Idempotency Keys, Domains/DMARC (דרך Context7 `/websites/resend`)
- סיכומי תיקון 13 לחוק הגנת הפרטיות — [Pearl Cohen](https://www.pearlcohen.com/the-knesset-enacted-a-key-amendment-to-the-israeli-protection-of-privacy-law-summery-version/), [DLA Piper – Data Protection in Israel](https://www.dlapiperdataprotection.com/?c=IL), [Goldfarb](https://goldfarb.com/amendment-13-to-the-israeli-privacy-protection-law)
