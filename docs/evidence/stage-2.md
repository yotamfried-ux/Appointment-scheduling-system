# ראיות — שלב 2 (DB core + Auth + Tenancy + תשתיות ליבה)

בסיס: `625099e` + שינויים שנכנסים ב-commit של שלב 2. הסביבה: Supabase מקומי אמיתי (Postgres + GoTrue + PostgREST + Mailpit). סטטוס: PASS / PARTIAL / NOT TESTED.

## מה נבנה
- מיגרציה `20261012000000_tenancy_core.sql`: `profiles`, `businesses` (slug ייחודי case-insensitive + CHECK לפורמט ו-reserved), `business_members`, `slug_redirects`, `audit_log` (append-only), `domain_events` (outbox), `job_runs`, `rate_counters`. RLS פעיל **ומאולץ** בכולן; grants מינימליים (עמודות `slug/kind/published_at/created_by` לא ניתנות לעדכון ישיר).
- RPC: `create_business` (אטומי), `change_business_slug`, `slug_available`, `publish_business`. עטיפות `security invoker` דקות ב-`public`; הלוגיקה ב-`private.*_impl` (`security definer`, `search_path=''`).
- אפליקציה: onboarding אמיתי (Server Action → RPC), דשבורד עם העסק השמור + פרסום, התחברות/הרשמה/שכחתי סיסמה/יציאה כ-Server Actions עם **cookie HttpOnly**, MFA (TOTP) הרשמה + אימות בכניסה, `platform/clock.ts` (Clock port + DST), `check:bundle` (אין מפתח סודי ב-bundle).

## ראיות לפי תרחיש
| תרחיש | ראיה | סטטוס |
|---|---|---|
| ACC-01 יצירה אטומית | pgTAP: עסק+חבר owner+audit+event נוצרים יחד; כשל (שם קצר, kind/טלפון/slug לא תקינים) לא משאיר שורות | PASS |
| ACC-03 טלפון E.164 | pgTAP (CHECK) + unit (Zod, libphonenumber) | PASS |
| ACC-04 פרסום רק עם אימייל מאומת | pgTAP (שגיאה `email_not_verified`, אח"כ הצלחה) + E2E פרסום | PASS |
| ACC-06 slug | pgTAP: reserved, לא-ASCII, פורמט, case-insensitive; unit: מועמדים (base, -2…-5, ואז סיומת אקראית), חיתוך במילה שלמה; E2E: שני בעלים עם אותו שם מקבלים slugs שונים. **באג אמיתי שנתפס:** 5 מועמדים בלבד ננעלו אחרי הרצות חוזרות → נוספו fallback אקראיים | PASS |
| ACC-07 שינוי slug | pgTAP: redirects תמיד מצביעים לעסק (אין שרשראות), מעגל (חזרה ל-slug ישן) מסיר redirect, slug ישן של עסק אחר חסום | PASS |
| SEC-01 בידוד | pgTAP: חבר/staff/admin/לא-חבר/חבר שהוסר (אותו JWT)/anon/עסק אחר. E2E: משתמש B עם JWT אמיתי לא קורא/משנה/מצטרף ל-A דרך REST+RPC | PASS |
| SEC-01 בקרה שלילית | pgTAP: כיבוי RLS ⇒ דליפה מתגלה (ואז הבדיקה חוזרת ירוקה). E2E: כיבוי RLS הפיל את בדיקת הבידוד (באופן עקיף, לא על ה-assert המדויק) | PASS |
| SEC-02 tenant מהסשן | אין `business_id`/`slug` בגוף בקשה (Zod strict + slug נגזר בשרת); עדכון slug/kind/published_at ישיר ⇒ 42501 | PASS |
| SEC-04 מפתח סודי בקליינט | `scripts/check-bundle.sh` + בקרה שלילית (מפתח מושתל נתפס), רץ ב-CI | PASS |
| SEC-05 CSRF | Server Actions (בדיקת Origin מובנית ב-Next) | NOT TESTED בנפרד |
| SEC-07 brute force / enumeration | slug probing: rate limit לפי משתמש (pgTAP); כניסה: הגבלות GoTrue בקונפיג + בדיקת הודעה אחידה (משלב 0) | PARTIAL (rate limit של GoTrue לא נבדק) |
| SEC-08/09 | קלט כטקסט (React escape), RPC עם פרמטרים בלבד, Zod בכל גבול; אין HTML של משתמש במיילים עדיין | PARTIAL |
| MFA TOTP | E2E: הרשמה, כניסה דורשת קוד (סיסמה לבד מוחזרת ל-/auth/mfa מכל עמוד מוגן), קוד שגוי נדחה, factor שלא אושר לא נועל משתמש | PASS (אכיפה בשכבת האפליקציה בלבד) |
| Cookie HttpOnly (פער משלב 0) | E2E: כל cookie auth-token הוא HttpOnly+SameSite=Lax; `document.cookie`/localStorage ריקים מטוקנים; גם אחרי כניסה | PASS (סגור) |
| Outbox / job_runs / rate counters | pgTAP: dedupe, claim עם backoff (אין עיבוד כפול), complete, ניסיון חוזר לכישלון, אי-חזרה על הצלחה, חלון rate limit | PASS (לא נבדק skip-locked בין חיבורים מקבילים) |
| Clock + DST | unit: `Asia/Jerusalem` — יום של 25/23 שעות, שעה חסרה (02:30→03:30), שעה כפולה (המוקדמת) | PASS |
| schema-lint | נקי אחרי המיגרציה (נבדק גם בתוך pgTAP) | PASS |

## בדיקה ויזואלית (צילומי מסך, מובייל 360 @2.75)
נבדקו 6 מסכים אמיתיים (onboarding ×3 שלבים, done, דשבורד, MFA). ממצאים שתוקנו:
1. **גלישה אופקית אמיתית:** שם עסק ארוך הרחיב את העמוד ל-442px (כרטיס הקישור); הטיה של כל הפריסה והכפתור התחתון לא לחיץ. תוקן (`min-w-0`, `overflow-wrap:anywhere`); נוספו בדיקות גלישה ב-320px.
2. הקישור נשבר באמצע מילה, כפתור "העתקה" נדחס — כעת נשבר במקפים והכפתור ברוחב מלא במובייל.
3. כותרת/שורות הדשבורד: תווית נשברה לשלוש שורות — שורות מוערמות במובייל; בידוד כיווניות לשם לטיני בכותרת עברית.
4. הנחיית MFA כפולה ("ידנית" פעמיים) — נוסחה מחדש. כפתור "הוספת טווח" חוזר 7 פעמים — הפך ל-ghost. slug נחתך באמצע מילה — נחתך במקף.
5. **באגי בדיקה** שנחשבו בטעות כ"flaky" והיו תוצאה של (1) והודעת סטטוס MFA שהשתנתה אחרי רענון שרת — תוקנו בשורש.

## מגבלות
- אין פרויקט Supabase בענן (ממתין לאישור עלות): OPS-02 (pooler) ו-`get_advisors` לא נבדקו.
- MFA נאכף ב-Server Components/Actions, **לא** ב-RLS (אין policy restrictive על aal2); אין קודי שחזור ואין ביטול factor — שלב 11/ממשק הגדרות.
- services/שעות נשמרים כ-JSON ב-`businesses.settings.onboarding` עד לטבלאות Catalog/Availability (שלב 3).
- skip-locked מול עובדים מקבילים לא הוכח (pgTAP רץ בחיבור אחד); יוכח עם runner בשלב 6.
