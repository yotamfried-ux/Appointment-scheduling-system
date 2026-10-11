# Route Plan — שלב 0: הקמה (Foundation)

Task type: greenfield scaffold + guardrails · Class: security_sensitive (תשתית multi-tenant, Auth, CSP)
Plan scope: PR אחד · Planning mode: single-stage · Branch: `claude/optimistic-hypatia-wh3zo3`

## מקורות ותבניות (עדיפות לאמין על פני כתיבה מאפס)
| צורך | מקור | מה אומץ / מה שונה |
|---|---|---|
| שלד אפליקציה + Auth | **`vercel/next.js` → `examples/with-supabase`** (canary נבדק ב-2026-10-10; Next 16, `proxy.ts`, `getClaims()`, מפתח publishable, shadcn/ui, Tailwind 3) | הועתק: Supabase clients (`lib/supabase/*`), זרימות auth, רכיבי UI. הוסרו: tutorial, מיתוג, כפתור deploy. שונה: layout עברית/RTL (Heebo), מסלולים ציבוריים, `/dashboard`, תיקוני lint (React Compiler rules), aria-label |
| CSP | תיעוד Next.js 16 (Context7) | בנאי CSP כפונקציה טהורה + nonce ב-`proxy.ts`; `connection()` כדי שכל עמוד יעבור SSR (ראו ממצא 1) |
| תבניות סקירה | `OneRedOak/claude-code-workflows` (נבדק, פרומפטים בלבד) | `.claude/agents` + `.claude/commands` |
| ארכיטקטורת DB ו-RLS | תיעוד Supabase (Context7) + `docs/05` | `private` schema, default privileges, `lint_violations()` |
| Auth config | מסמך 05 §5.2 | סיסמה ≥12, אימות מייל חובה, OTP 15 דק', redirect URLs מדויקים, תבניות עברית |

## תרחישים שנסגרים / נוגעים
ACC-01 (הרשמה+אימות מייל) · ACC-02 (אין enumeration) · ACC-04 (לא ניתן להשתמש לפני אימות) · UX-01 (RTL בסיס) · UX-08 (נגישות בסיס) · SEC-03/SEC-14 (schema-lint) · SEC-04 (הפרדת מפתח סודי — כלל lint) · OPS-04 (מיגרציה נבדקת על Postgres אמיתי) · OPS-08 (מפתחות/סביבות — בסיס)

## שערי אימות
lint · typecheck · unit · build · E2E (מובייל 360 + דסקטופ, axe WCAG 2.2 AA) · Auth journey מול Supabase מקומי אמיתי + מייל אמיתי · pgTAP · schema-lint נקי · gitleaks (עץ + היסטוריה) · trivy · CI ירוק ב-PR

## מחוץ להיקף (נדחה במכוון)
Design system מלא (שלב 1) · סכמת עסק/תורים (שלב 2) · תרגום טפסי ה-Auth לעברית (שלב 1; ה-E2E משתמש ב-id ולא בטקסט) · פרויקט Supabase בענן ופרויקט Vercel (דורשים אישור עלות/חיבור — ראו PR) · ZAP/Lighthouse (דורשים UI/Preview)

## סיכונים ו-rollback
שינוי חד-כיווני רק בריפו חדש; מיגרציה אחת idempotent; חזרה = revert של ה-PR.
