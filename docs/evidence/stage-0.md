# ראיות — שלב 0

Repository: `yotamfried-ux/appointment-scheduling-system` · Code revision: `e9753bf` (דוח זה נוסף בקומיט docs-בלבד שאחריו)
Environment: ענן Claude Code (Linux, Node 22.22, Docker 29), Supabase CLI 2.120 (Postgres 17, Auth, REST, Mailpit מקומיים), Chromium 1194 / Playwright 1.56.1
Date: 2026-10-11 · חשבונות בדיקה: סינתטיים בלבד

| שכבה | בדיקה | תוצאה | הערות |
|---|---|---|---|
| סטטי | ESLint (כולל כללי ארכיטקטורה: `system-db`, `react/no-danger`) | **PASS** | |
| סטטי | `tsc --noEmit` | **PASS** | |
| Unit | Vitest — CSP builder (7) | **PASS** 7/7 | |
| Build | `next build` (Turbopack) | **PASS** | כל המסלולים דינמיים (נדרש ל-nonce) |
| E2E | Playwright mobile-360 + desktop: headers, CSP/hydration, RTL, אין שגיאות קונסולה, axe WCAG 2.2 AA ב-4 עמודים, הפניית דשבורד | **PASS** 36 | 18 בדיקות × 2 פרויקטים |
| E2E | מסע בעלת עסק מול Supabase אמיתי (הרשמה → מייל בעברית → אישור → דשבורד; סיסמה חלשה; אין enumeration; ניתוק) | **PASS** | המייל נקרא ממשיכת Mailpit, לא מה-UI |
| E2E | עוגיית סשן HttpOnly | **NOT MET (מתועד, `test.fixme`)** | ברירת מחדל של התבנית; תיקון בשלב 2 (auth בצד שרת). מדווח כ-2 skipped |
| DB | pgTAP — 14 בדיקות כולל בקרות שליליות לכל כלל lint | **PASS** | `supabase test db` |
| DB | `private.lint_violations()` על ה-DB לאחר המיגרציה | **PASS** (0 שורות) | |
| DB | מיגרציה הוחלה ע"י `supabase start` (נרשמה ב-`schema_migrations`) | **PASS** | |
| סודות | Gitleaks — עץ עבודה + היסטוריית git | **PASS** | הממצאים ב-`.next/` (קבצי build שאינם ב-git) מוחרגים ב-`.gitleaks.toml` |
| תלויות | Trivy — HIGH/CRITICAL (vuln+misconfig+secret) | **PASS** | 0 ממצאים ב-`package-lock.json` |
| תלויות | OSV-Scanner | **BLOCKED** | `api.osv.dev` → 403 בסביבה זו; ירוץ ב-CI |
| SAST | CodeQL | **NOT TESTED** | ירוץ ב-CI של ה-PR |
| CI | GitHub Actions על ה-PR | **PENDING** | ראו סטטוס ה-PR |
| DAST | ZAP | **NOT TESTED** | דורש Preview חי (שלב 11) |
| ביצועים | Lighthouse | **NOT TESTED** | אין UI אמיתי עדיין |

## בקרות שליליות (האם הבדיקה נכשלת מהסיבה הנכונה?)
- **CSP/nonce:** לפני התיקון, בדיקות ה-E2E נכשלו בדיוק על `Refused to load the script… violates CSP` (עמודי Auth הוגשו סטטית ללא nonce) — **ממצא אמיתי** שתוקן ע"י `connection()` + העברת nonce ל-`ThemeProvider`. אחרי התיקון: 0 הפרות.
- **נגישות:** axe נכשל על `button-name` (כפתור ערכת נושא ללא שם נגיש) ← תוקן ב-`aria-label`.
- **schema-lint:** כל כלל נבדק מול אובייקט פגום מכוון (טבלה בלי RLS, בלי force, grant ל-anon, `SECURITY DEFINER` בלי `search_path`, view רגיל…).
- **לא הורצה בקרה שלילית:** בדיקת "סיסמה חלשה נדחית" (הייתה נכשלת אם `minimum_password_length` היה 6). מסומן כפער קטן; ייבדק בשלב 2.

## ממצאים שנוספו לגיבוי
1. עמודי Auth נשברים בשקט תחת CSP עם nonce אם הם נבנים סטטית (תוקן; הבדיקה נשארת כרשת ביטחון).
2. קישור אימות האימייל (`GET /auth/confirm`) צורך את ה-OTP בעת ביקור — סורקי אימייל עלולים לצרוך אותו. להוסיף דף ביניים עם POST (קשור ל-SEC-11) בשלב 2.
3. `app/auth/confirm/route.ts` משבץ הודעת שגיאה לא מקודדת ב-URL; לקודד.
4. טפסי ה-Auth באנגלית (שלב 1).
