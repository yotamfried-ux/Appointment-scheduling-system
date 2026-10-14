# ראיות — שלב 1 (design system, lab, התאמה לסוגי עסקים, חיבור UI↔API)

בסיס: `fa0555e` + שינויים שלא נעשו להם commit בזמן הכתיבה. סטטוס: PASS / PARTIAL / NOT TESTED.

## מה הוכח
| נושא | ראיה | סטטוס |
|---|---|---|
| התאמה ל-6 סוגי עסק (מונחים, שירותים, שעות מפוצלות, שדות intake, מיקומים, קבוצות, פרטיות) | unit `business-kind` (44), `availability-engine`, E2E לכל סוג (`lab-booking-api`, `lab-dashboard`, `lab-onboarding`) | PASS (על store בזיכרון) |
| חוזי API (Zod משותף, שגיאות אחידות, requestId, no-store) | `api-contract.test.ts` (51) קורא ל-route handlers אמיתיים | PASS |
| 409 על כפל הזמנה, Idempotency (replay / reuse), 422 עם שדות, 429 + Retry-After, INVALID_TRANSITION | contract + E2E בשני הקשרי דפדפן במקביל; **negative control**: הסרת בדיקת SLOT_TAKEN הפילה 3 בדיקות | PASS |
| פרטיות הודעות (clinic/beauty לא חושפים שירות; intake אף פעם לא במייל) | contract + E2E | PASS |
| כשלים: 500, ניתוק אחרי עיבוד שרת (retry עם אותו מפתח, בלי כפילות), תגובה שמפרה חוזה, טעינה כושלת, rollback אופטימי, פעולה מיושנת | E2E עם `route.fulfill/abort` | PASS |
| באגים אמיתיים שנתפסו ותוקנו | seed של קבוצה חסם כל סלוט מאמן; לחיצה כפולה אישרה את הלקוח הבא ברשימה (נעילה גלובלית); מרוץ בבדיקה עצמה | FIXED |
| נגישות/גלישה/מגע | axe WCAG2.2 AA בכל שלב ולכל סוג, mobile-360 + desktop | PASS |
| ריצה מלאה | unit 235 · E2E 174 passed / 2 skipped (`fixme` cookie HttpOnly) עם Supabase מקומי · pgTAP PASS | PASS |

## מגבלות (חשוב)
- ה-API של ה-lab עובד על **store בזיכרון** (נעילה אטומית בתהליך אחד). זו **לא** ראיה ל-DB: כפל הזמנה מול Postgres (exclusion constraint), RLS, ו-serverless מרובה instances יוכחו בשלבים 2–4. ב-production ה-lab כבוי (404).
- hold של 5 דקות הוא טיימר בצד לקוח בלבד; hold בשרת — שלב 3.
- OSV-scanner לא רץ מקומית (חסימת רשת); רץ ב-CI.

## האם מימשנו את מסמכי התרחישים והסייבר במלואם? לא.
- `docs/04`: ~110 מזהי תרחיש. מופיעים כרגע בבדיקות ~20. השאר ממופים לשלבים 2–9 (DB, אימות, ביטולים, תזכורות, יומן, חיוב).
- `docs/05`: מומש בפועל — CSP עם nonce, כותרות אבטחה, סריקות (gitleaks/trivy/osv/CodeQL) ב-CI, `lint_violations`, אימות Supabase מוקשח, שערי lab, Zod בגבולות ה-API, בלי PII בלוגים. **לא מומש**: RLS על טבלאות עסקיות, capability tokens ללקוח, Turnstile ו-rate limit מבוסס DB, Resend/DKIM, webhooks, OAuth ליומן, Admin/תמיכה, ריטנשן, pentest. מטריצת ASVS נשארת NOT TESTED.
