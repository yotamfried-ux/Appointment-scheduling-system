# Route Plan — שלב 3: Catalog + Availability + מנוע סלוטים

Task type: feature · Class: security_sensitive (multi-tenant data, RLS) · Branch: `claude/optimistic-hypatia-wh3zo3`

## תרחישים (docs/04 §7)
CAT-01..04 (שירותים: יצירה/עריכה/ארכוב, משך/מחיר/חיץ, ולידציה) · AVL-01..03, 05, 07..12 (חלונות שבועיים, פיצול יום, חריגים — סגירה/פתיחה מיוחדת, אזור זמן ו-DST, התחשבות ב-"עכשיו" והתראה מינימלית) · SEC-01 (בידוד גם בטבלאות החדשות) · ACC-01 (אטומיות — onboarding כותב שירותים+שעות באותה טרנזקציה).

## החלטות עיצוב
- טבלאות: `services`, `resources` (ברירת מחדל = "העסק עצמו", schema-ready לצוות/חדרים), `availability_rules` (שבועי, דקות מחצות, **אילוץ אי-חפיפה ב-DB** עם `btree_gist`), `availability_exceptions` (סגירה מלאה/חלקית או פתיחה מיוחדת בתאריך).
- RLS: קריאה לכל חבר, כתיבה ל-admin+owner. אין גישה ציבורית (הזמנה ציבורית = שלב 4 דרך נתיב מערכת).
- `create_business` מורחב: כותב עסק+חבר+resource+services+rules בטרנזקציה אחת (במקום JSON ב-`settings`).
- `replace_weekly_hours` (SECURITY INVOKER): החלפה אטומית; חפיפה → שגיאה.
- מנוע הסלוטים (`modules/availability/slots.ts`) טהור, עובד על **רגעים ב-UTC** עם `Clock` ו-`zonedTimeToUtc` (שעה חסרה/כפולה בשעון קיץ). `busy` ייכנס מטבלת התורים בשלב 4.
- UI בעלים: `/settings/services`, `/settings/hours` (+ חריגים + תצוגה מקדימה של סלוטים מחושבים מה-DB).

## שכבות אימות
pgTAP (RLS ×5 תפקידים, אילוצים, אטומיות, בקרה שלילית) · unit + **property tests** (fast-check) + DST · E2E מול Supabase אמיתי (שמירה אמיתית, בידוד JWT, תצוגה מקדימה תואמת כללים) · בדיקות ויזואליות (גלישה/axe/סימטריה) לדפים החדשים · CI.

## מחוץ להיקף
תורים/חסימת סלוטים בפועל (4) · צוות/חדרים כמשאבים נוספים (סכמה בלבד) · קיבוצי עם הרשמות (4+).
