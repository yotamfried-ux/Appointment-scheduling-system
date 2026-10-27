# Tori — Comprehensive Scenario, Identity & Negative Testing Qualification

> **תאריך הפקה:** 27 באוקטובר 2026  
> **צוות ביקורת:** Principal QA Engineer, Application Security Engineer, IAM Specialist, SaaS Multi-Tenant Architect, Reliability Engineer, Product Quality Engineer  
> **ענף ביקורת ובדיקות:** `test/comprehensive-scenario-qualification` (Commit: `f62b785`)  
> **גרסת בסיס:** `origin/main` (`a3e9d59`)  
> **מקורות ידע:** `Engineering-OS` (ריפוזיטורי מקורי בנתיב `C:\Users\Yotam\.engineering-os`), OWASP ASVS 5.0, WSTG 4.2, PostgreSQL & Supabase Security Architecture.

---

## A. מקורות הידע המחייבים (Engineering-OS)

בהתאם להוראות הביקורת, נסרקה ספריית הידע המקורית `Engineering-OS` (`https://github.com/yotamfried-ux/Engineering-OS.git`). להלן המסמכים שנקראו בפועל וההנחיות שנלקחו מהם:

| מסמך ב-Engineering-OS | נתיב מלא | הנחיות בדיקה ויישום שנגזרו מהמסמך |
|---|---|---|
| **Testing Patterns** | `patterns/testing/README.md` | פירמידת בדיקות (70% יחידה, 20% אינטגרציה, 10% E2E), תבנית Arrange-Act-Assert (AAA), שימוש ב-Test Factories, מניעת שיתוף State בין בדיקות, דרישת אובייקטיביות של Assertions. |
| **Negative Tests Passing for Wrong Reason** | `lessons-learned/bugs/negative-test-passing-for-the-wrong-reason.md` | **הנחיית ליבה לבדיקות שליליות:** בדיקה שלילית הבודקת רק "נכשל" עלולה לעבור מהסיבה הלא נכונה. חובה לדרוש את קוד השגיאה המדויק, הודעת השגיאה והסטטוס (כגון `409 SLOT_TAKEN`, `403 FORBIDDEN`, `422 VALIDATION_FAILED`) ולא להסתפק ב-`catch` כללי. |
| **Precondition Weaker than Operation** | `lessons-learned/bugs/guard-precondition-weaker-than-the-operation.md` | שער ההגנה (Zod / middleware) חייב להיות שווה או מחמיר יותר מהאילוץ בבסיס הנתונים; אין לאפשר לשאילתה להגיע ל-DB אם היא נפסלת ברמת ה-contract (הוחל בבדיקת reserved slugs). |
| **Authorization Patterns** | `patterns/authorization/README.md` | הפרדת תפקידים מבוססת הרשאות (RBAC), שלילת גישה כברירת מחדל (Default Deny), איסור שמירת תפקיד ב-JWT Claims (אימות בזמן אמת מול ה-DB), אכיפה רב-שכבתית בשרת. |
| **Security Patterns** | `patterns/security/README.md` | אימות קלט מוקפד (`zod.strict()`), מניעת CSRF באמצעות אימות Origin/SameSite, הגנה מפני הזרקת נוסחאות ב-CSV (`FORMULA_START = /^[=+\-@\t\r]/`), מניעת XSS, ומזעור חשיפת PII. |
| **Multi-Tenant SaaS Guide** | `docs/architecture-guides/web/multi-tenant-saas.md` | בידוד דיירים מוחלט (RLS + Force RLS), גזירת מזהה העסק אך ורק מסשן המשתמש ולא מגוף הבקשה, אבטחת תהליכי רקע ואנליטיקה ברמת דייר בודד. |
| **Quality Gates Policy** | `core/quality-gates.md` | שלילת קומיטים ללא הרצת בדיקות מלאה, ניקוי שאריות דיבאג (`console.log`, `debugger`), והפקת ראיות אובייקטיביות מבוססות כלים לפני אישור שלב. |
| **Auth Troubleshooting** | `docs/troubleshooting/auth.md` | ביטול סשן מלא בהתנתקות, בדיקת תוקף טוקנים בשרת, חסימת גישה ל-API למשתמשים שהוסרו, והגנה מפני Session Fixation וזיוף פקטורי MFA. |

---

## B. מטריצת משתמשים והרשאות מלאה (Actors U1..U12)

### הגדרת 12 סוגי המשתמשים:
1. **U1 — אורח אנונימי (Anonymous Guest):** גולש לא מזוהה באינטרנט, סורק כתובות, בוט.
2. **U2 — לקוח קצה (End Customer):** לקוח המזמין תור דרך הדף הציבורי ללא חשבון, מנוהל באמצעות Capability Tokens חתומים.
3. **U3 — בעל עסק A (Business A Owner):** משתמש רשום בעל תפקיד `owner` ב-`business_members` של עסק A.
4. **U4 — מנהל עסק A (Business A Admin):** איש צוות בעל תפקיד `admin` בעסק A.
5. **U5 — עובד עסק A (Business A Staff):** נותן שירות בעל תפקיד `staff` בעסק A (רואה יומן, יוצר תורים ידניים).
6. **U6 — בעל עסק B (Business B Owner):** בעל עסק מתחרה / נפרד (בידוד רב-דיירי מלא מול עסק A).
7. **U7 — עובד עסק B (Business B Staff):** עובד בעסק B.
8. **U8 — מנהל הפלטפורמה (Platform Operator):** חשבון מורשה ברשימת `platform_admins` (`yotam.fried@gmail.com`).
9. **U9 — משתמש עם אימייל שלא אומת (Unverified Email):** משתמש שנרשם אך טרם אימת כתובת אימייל ב-Supabase Auth.
10. **U10 — משתמש שהוסר מהעסק (Removed Member):** איש צוות שנמחק מטבלת `business_members` בעוד הסשן בדפדפן עדיין פתוח.
11. **U11 — משתמש עם Session שפג / נותק (Revoked/Expired Session):** משתמש שביצע Logout או שתוקף הסשן שלו פג.
12. **U12 — משתמש בתהליך הרשמה חלקי (Incomplete Onboarding):** משתמש מאומת אך ללא עסק מקושר.

### מטריצת הרשאות לפעולות המערכת:

| פעולה במערכת | U1 | U2 | U3 | U4 | U5 | U6 | U7 | U8 | U9 | U10 | U11 | U12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| צפייה בעמוד ציבורי / סלוטים | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| ביצוע הזמנה ציבורית | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| צפייה בתור קיים (עם טוקן חתום) | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| ביטול תור כלקוח (בחלון המותר) | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| צפייה ביומן עסק A | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| יצירת תור ידני בעסק A | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| אישור / דחיית תור בעסק A | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| יצירה / עריכת שירותים בעסק A | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| שינוי שעות פעילות / הגדרות עסק A | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| פרסום עסק A (`publish_business`) | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ (נחסם) | ❌ | ❌ | ❌ |
| ניהול צוות / הזמנת עובדים בעסק A | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| ייצוא נתוני עסק A (CSV/XLSX) | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| צפייה וניהול מנוי / חיוב עסק A | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| מחיקת חשבון עסק A | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| גישה לדשבורד מנהל הפלטפורמה | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| הרצת RPC מנהל (`admin_dashboard_metrics` וכו') | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| השעיית עסק / אישור מותג כמפעיל | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| ייצוא נתוני פלטפורמה אדמין | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |

---

## C. מטריצת בדיקות שליליות (Negative Testing Matrix)

להלן פירוט הבדיקות השליליות שבוצעו, המשתמש התוקף/הבודק, הפעולה, התוצאה הצפויה והראיה בפועל:

| ID | תרחיש שלילי | משתמש | פעולה | תוצאה צפויה | בדיקה קיימת | תוצאה בפועל | ראיה / אימות |
|---|---|---|---|---|---|---|---|
| **NEG-01** | עובד עסק A מנסה לבצע פעולת בעלים (ניהול עובדים/מנוי) | U5 | קריאה ל-RPC או נתיב ניהול עובדים | חסימה מלאה (403 / 42501) | כן | `FORBIDDEN` | `010_tenancy.test.sql` + RLS |
| **NEG-02** | בעל עסק A מנסה לקרוא/לשנות נתוני עסק B דרך שינוי ID | U3 | `GET /api/owner/appointments` עם מזהה עסק B | 0 שורות / 404 | כן | העסק נגזר מהסשן בלבד, RLS מונע זליגה | `modules/booking/owner/service.ts:18` |
| **NEG-03** | בעל עסק מנסה לגשת לדשבורד ונתוני מנהל הפלטפורמה | U3 | `GET /admin` או `admin_dashboard_metrics` | חסימה קשיחה (403 / 42501) | כן | נחסם (42501) בבסיס הנתונים | `platform_admin_and_analytics.sql:41` |
| **NEG-04** | משתמש אנונימי מנסה לקרוא מטבלאות בסיס הנתונים ישירות | U1 | `select * from public.businesses` ב-anon key | 0 שורות (אין `grant select` ל-anon) | כן | נחסם (Permission Denied) | `000_schema_lint.test.sql:21` |
| **NEG-05** | שימוש בטוקן ניהול לקוח שפג תוקפו | U2 | ביטול תור עם טוקן ישן | דחייה חד-משמעית (`{ ok: false }` / 403) | כן | נדחה | `booking-token.test.ts:23` |
| **NEG-06** | זיוף חתימת HMAC בטוקן ניהול לקוח | U1 / U2 | שינוי גוף הטוקן והשארת החתימה | דחייה חד-משמעית | כן | נדחה | `comprehensive-scenario-qualification.test.ts:143` |
| **NEG-07** | שימוש בטוקן צפייה (`view`) לצורך ביטול תור (`cancel`) | U2 | שליחת טוקן בעל scope לא מתאים | דחייה מלאה (scope mismatch) | כן | נדחה | `comprehensive-scenario-qualification.test.ts:151` |
| **NEG-08** | הזרקת שדות מוגנים בטופס הזמנה (Mass Assignment) | U1 / U2 | שליחת `status`, `role`, `price`, `business_id` | דחייה מוחלטת ב-boundary (`Zod.strict`) | נוספה עכשיו | נדחה (`unrecognized_keys`) | `comprehensive-scenario-qualification.test.ts:112` |
| **NEG-09** | הזרקת נוסחאות זדוניות בייצוא CSV (`=cmd\|...`, `@SUM`) | U3 / U8 | יצירת עסק עם שם זדוני וייצוא ל-CSV | נטרול באמצעות גרש מוביל (`"'=..."`) | נוספה עכשיו ותוקנה | מנוטרל במלואו | `comprehensive-scenario-qualification.test.ts:211` + תיקון `app/api/admin/export/route.ts` |
| **NEG-10** | הרשמה עם slug שמור (`admin`, `api`, `auth`) | U3 | `createBusinessAction` עם slug שמור | נדחה הן ב-Zod והן באילוץ DB | נוספה עכשיו ותוקנה | נדחה | `modules/tenancy/schema.ts:38` + `010_tenancy.test.sql:60` |
| **NEG-11** | פרסום עסק לפני אימות כתובת האימייל ב-Auth | U9 | `publish_business` כשהאימייל לא מאומת | נדחה עם `email_not_verified` | כן | נדחה (P0001) | `20261042000000_abuse_controls.sql:35` |
| **NEG-12** | ניסיון לביצוע פעולות ע"י עובד שהוסר בזמן סשן פעיל | U10 | קריאה ל-API של העסק לאחר הסרה | נחסם מיד (התפקיד נבדק ב-DB בכל בקשה) | כן | נחסם (`UNAUTHENTICATED`/`FORBIDDEN`) | `modules/booking/owner/service.ts:48` |
| **NEG-13** | התקפת Brute-force על התחברות (ניחוש סיסמאות) | U1 | שליחת מעל 10 ניסיונות התחברות ב-10 דקות | חסימה ברמת rate-limit (`over_request_rate_limit`) | כן | נחסם (429) | `app/auth/actions.ts:42` |
| **NEG-14** | הזמנה כפולה של אותו סלוט (Concurrency / Race) | U2 | 2 בקשות מקבילות לאותו סלוט בדיוק | בדיוק אחת מצליחה (201), השנייה 409 | כן | אילוץ `EXCLUDE gist` מונע כפילות | `030_booking.test.sql` + PostgreSQL GIST |
| **NEG-15** | הזמנת תור בעבר או ביום סגור | U2 | שליחת תאריך שחלף או יום שאינו פעיל | נדחה כ-`INVALID_SLOT` / `TOO_LATE` (409/422) | כן | נדחה | `api-contract.test.ts:80` |
| **NEG-16** | הזרקת קוד XSS בשם עסק בהתראת רישום מנהל | U3 | שם עסק המכיל `<script>` / `<img onerror>` | קידוד HTML מלא (HTML Escape) | כן | מנוקה ומקודד ל-`&lt;script&gt;` | `platform-admin-analytics.test.ts:50` |

---

## D. תרחישים חדשים שזוהו וסווגו לפי חומרה

1. **[P1 — טופל בקומיט `f62b785`] חולשת הזרקת נוסחאות (CSV Formula Injection) בייצוא אדמין:**
   - *הממצא:* נתיב `app/api/admin/export/route.ts` ביצע escaping של גרשיים בלבד, ללא נטרול תחיליות נוסחה (`=`, `+`, `-`, `@`, `\t`, `\r`). עסק שנרשם עם שם כגון `=CMD|' /C calc'!A0` היה עלול להפעיל פקודות בגיליון אקסל של מנהל הפלטפורמה בעת פתיחת קובץ ה-CSV.
   - *הפתרון:* הנתיב אוחד לשימוש במנוע ה-CSV המאובטח של המערכת (`modules/reports/csv.ts`), המנטרל תחיליות אלו באמצעות הוספת אפוסטרוף ומקפיד על UTF-8 BOM ו-CRLF.
2. **[P1 — טופל בקומיט `f62b785`] אי-התאמה בשם עמודת אירועי אנליטיקה בקוד השירות:**
   - *הממצא:* בקובץ `modules/analytics/service.ts`, הפונקציה `recordAnalyticsEvent` ביצעה כתיבה לשדה `payload` במקום לעמודה האמיתית בבסיס הנתונים (`meta`), מה שהיה גורם לשגיאת DB בשליחה ידנית של אירוע.
   - *הפתרון:* תוקן שם השדה ל-`meta` והפונקציה `sanitizePayload` יוצאה ונבדקה בבדיקות היחידה.
3. **[P1 — טופל בקומיט `f62b785`] שער Zod של יצירת עסק לא חסם Reserved Slugs מראש:**
   - *הממצא:* סכמת `CreateBusinessInput` בדקה פורמט בלבד ואפשרה לסלגים כגון `admin` ו-`api` להגיע עד לשכבת ה-DB לפני שנזרקה שגיאה.
   - *הפתרון:* נוספה רשימת `RESERVED_SLUGS` ובדיקת `.refine()` ברמת ה-Zod Schema (Defense in depth).
4. **[P2 — מתוכנן להמשך] סנכרון Offline לעובדים בחיבור מקוטע במובייל:**
   - *הממצא:* כאשר עובד מסמן תור כ-`completed` או `no-show` בתנאי רשת חלשים, אין כרגע מנגנון סנכרון מקומי מובנה ב-Service Worker.

---

## E. בדיקות ושיפורי קוד שנוספו בענף הביקורת

| קובץ | מהות השינוי / התרחיש שנבדק | סביבה | תוצאה | קומיט |
|---|---|---|---|---|
| [`comprehensive-scenario-qualification.test.ts`](file:///C:/Users/Yotam/.gemini/antigravity/scratch/Appointment-scheduling-system/tests/unit/comprehensive-scenario-qualification.test.ts) | 19 בדיקות שליליות מקיפות: בידוד סשנים U1..U12, הגנת Mass Assignment, עמידות לטוקנים מזויפים/פגי תוקף, יוניקוד, נטרול הזרקות CSV, וניקוי PII מאנליטיקה | Vitest | **19/19 עברו בהצלחה** | `f62b785` |
| [`app/api/admin/export/route.ts`](file:///C:/Users/Yotam/.gemini/antigravity/scratch/Appointment-scheduling-system/app/api/admin/export/route.ts) | נטרול הזרקות נוסחה בייצוא אדמין באמצעות `BOM` ו-`csvRow` | Node / Next.js | **תוקן ונבדק** | `f62b785` |
| [`modules/analytics/service.ts`](file:///C:/Users/Yotam/.gemini/antigravity/scratch/Appointment-scheduling-system/modules/analytics/service.ts) | ייצוא `sanitizePayload` ותיקון עמודת הכתיבה ל-`meta` | Node / DAL | **תוקן ונבדק** | `f62b785` |
| [`modules/tenancy/schema.ts`](file:///C:/Users/Yotam/.gemini/antigravity/scratch/Appointment-scheduling-system/modules/tenancy/schema.ts) | הוספת `RESERVED_SLUGS` לסכמת ה-Zod לבלימת סלגים שמורים מראש | Zod Contract | **תוקן ונבדק** | `f62b785` |

---

## F. ממצאי אבטחה ואמינות (סיווג סיכונים)

* **P0 (חוסמי Production):** **0 ממצאים פתוחים.**  
  הבדיקות הוכיחו: אין אפשרות ל-Double Booking (מוגן באילוץ GIST DB), אין דליפת מידע בין עסקים (מוגן ברמת RLS ו-FORCE RLS), תפקידים אינם ניתנים להסלמה (Role אינו ב-JWT), גישת אדמין חסומה לחלוטין ברמת מסד הנתונים (`42501`).
* **P1 (מחייב טיפול לפני השקה ציבורית רחבה):** **3 ממצאים טופלו וננעלו בענף הביקורת** (CSV Formula Injection באדמין, שגיאת עמודת אנליטיקה, ובדיקת Zod לסלגים שמורים).
* **P2 (לטיפול ושיפור שוטף):**  
  הוספת סנכרון תורים אופליין במובייל וניהול חכם של הודעות בעת חריגה מחבילה.

---

## G. החלטת מוכנות (Readiness Decision)

### החלטה: `PILOT_READY`

**נימוק מבוסס ראיות:**
1. כל 678 בדיקות היחידה (`npm test`) עוברות בהצלחה מלאה (100%).
2. בדיקות הטיפוסים (`npm run typecheck`) תקינות לחלוטין ללא שגיאות.
3. בדיקות ה-Lint עוברות ללא שגיאות (0 errors).
4. כל שערי האבטחה, ה-RLS וה-Schema Lint בבסיס הנתונים נבדקו ב-pgTAP.
5. כל החולשות שזוהו במהלך הביקורת תוקנו ונבדקו בענף הייעודי `test/comprehensive-scenario-qualification`.
6. המערכת מסווגת כ-`PILOT_READY` ומאושרת להרצת פיילוט מבוקר; החלטת `PRODUCTION_VERIFIED` מלאה תוכרז לאחר אימות E2E מלא בסביבת Staging / Preview לפני מיזוג ל-`main`.

---

## H. פערים ותלויות הדורשים אימות חיצוני / ידני

1. **עבירות אימייל בפועל (Resend Deliverability):** אימות רשומות DNS (SPF, DKIM, DMARC) בכתובת דומיין רשמית למניעת הגעה לספאם.
2. **אימות דפדפני מובייל חיצוניים (In-App Browsers):** בדיקה ידנית של פתיחת קישורי הזמנה מתוך אפליקציית אינסטגרם ו-WhatsApp (WebViews).
3. **חיבור סליקה עתידי:** מערכת הסליקה והתשלומים סווגה מחוץ להיקף הבדיקה הנוכחי ותדרוש בדיקת Webhooks עם חתימות ספק ייעודיות בעת שילובה.
4. **אימות משפטי ישראלי:** אישור סופי של נוסח תנאי השימוש ומדיניות הפרטיות (תיקון 13 לחוק הגנת הפרטיות).
