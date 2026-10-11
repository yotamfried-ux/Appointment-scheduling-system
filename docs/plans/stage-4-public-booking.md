# Route Plan — שלב 4: הזמנה ציבורית (Booking)

Task type: feature · Class: security_sensitive (נתיב ציבורי, PII, מרוץ, טוקנים) · Branch: `claude/optimistic-hypatia-wh3zo3`

## תרחישים (docs/04)
BKG-01 (מובייל, 4 צעדים) · **BKG-02 (מרוץ — EXCLUDE ב-DB)** · BKG-04 (Idempotency) · BKG-05 (לקוח חוזר לפי טלפון) · BKG-06 (בלי אימייל — קישור ניהול על המסך) · BKG-07 (מגבלת תורים עתידיים) · BKG-09 (אישור ידני) · BKG-10 (שירות הושבת) · BKG-11 (slug לא קיים/לא מפורסם/הפניה) · BKG-12 (rate limit לפי IP+טלפון+עסק) · BKG-13 (אין חשיפת לקוחות; סלוטים פנויים בלבד) · BKG-14 (אין PII בלוגים/מונים) · BKG-15 (חלון מכיל משך+חיץ) · SEC-05/06 (טוקן חתום: זיוף/פג/scope/חד-פעמי) · CXL (ביטול לקוח לפי מדיניות).

## החלטות עיצוב
- **DB קובע התנגשויות:** `appointments` עם `EXCLUDE USING gist (resource_id =, tstzrange(starts_at, blocked_until) &&) WHERE status פעיל`; 23P01 ⇒ 409. TS קובע שעות פעילות (מנוע הסלוטים), ומאמת שהסלוט המבוקש נמצא ברשימה לפני הכתיבה.
- מכונת מצבים של תור נאכפת בטריגר; שדות הליבה של התור בלתי ניתנים לשינוי.
- **נתיב מערכת:** `platform/system-db` (מפתח סודי) רק מ-`app/api/public/**` ו-`modules/booking/public/**`. RPCs ציבוריים הם wrappers (`security invoker`) שמורשים ל-`service_role` בלבד; הלוגיקה ב-`private` (definer).
- טוקן ניהול ללקוח: HMAC-SHA256 `{appointment, scope, exp, jti, kid}`, סבב מפתחות, השוואה בזמן קבוע, ביטול חד-פעמי (`jti` ב-DB). GET מציג בלבד; ביטול = POST (Server Action).
- Rate limit: מונים ב-Postgres (`private.rate_limit_hit`), מפתחות מגובבים (אין PII); IP+עסק, טלפון+עסק, עסק.
- ה-UI של ההזמנה הוא אותו קומפוננט שנבדק ב-lab; מקור הנתונים מוחלף ל-API ציבורי עם אותם חוזים (`lib/api/contracts`).
- אישור ידני: ברירת מחדל לפי סוג העסק (קליניקה = כן), נשמר בעסק.

## מחוץ להיקף (במפורש)
שירותים קבוצתיים (capacity>1 לא מוצעים עדיין) · Turnstile (ממתין למפתחות) · מיילים/ICS (שלב 6 — האירוע ב-outbox כבר נכתב) · החזקת סלוט בשרת `slot_holds` (נשאר טיימר לקוח; EXCLUDE מגן ממילא) · דשבורד בעלים (5) · שינוי מועד · חסימת לקוחות.

## אימות
pgTAP (EXCLUDE, מכונת מצבים, idempotency, RLS, wrappers שמורשים רק ל-service_role) · unit (טוקן, מקטעים, מיפוי שגיאות) · E2E אמיתי: מסע לקוח במובייל, **50 בקשות מקבילות לאותו סלוט ⇒ בדיוק 201 אחד**, רענון/לחיצה כפולה, rate limit, ביטול בטוקן חד-פעמי, בידוד, בדיקות ויזואליות · CI.
