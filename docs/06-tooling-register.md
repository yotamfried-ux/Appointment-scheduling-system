# רישום כלים וסקילים

> נבדק מול: קטלוג Engineering-OS (`capability-registry/agent-tools.md`, `external-skills/*`, `application-testing`, `security`), קטלוג התוספים של הארגון (SearchPlugins), והסקילים/קונקטורים הזמינים בסשן.
> עיקרון (Engineering-OS): לא מתקינים הכול — בוחרים לפי צורך מוכח ומתעדים גם מה *לא* הותקן ולמה.

## מותקן ופעיל

| כלי | סוג | מה הוא נותן לנו | איפה מוגדר |
|---|---|---|---|
| **superpowers** 6.4.1 | Plugin (user) | brainstorming, כתיבת תוכניות, TDD, systematic-debugging, verification-before-completion, code review, worktrees | `.claude/settings.json` |
| **ui-ux-pro-max** 2.13.0 | Plugin | מערכות עיצוב לפי תחום, כללי נימוק UI, צ'קליסט נגישות לפני מסירה | `.claude/settings.json` |
| **supabase** (רשמי) 0.1.15 | Plugin | סקילי Supabase + `supabase-postgres-best-practices` (RLS, אינדקסים, ביצועים) | `.claude/settings.json` |
| **design** (Anthropic) 1.2.0 | Plugin | `accessibility-review`, `design-critique`, `design-system`, `design-handoff`, `ux-copy` | `.claude/settings.json` |
| **graphify** 0.9.66 | CLI + MCP | גרף קוד מקומי (`graphify-out/`, לא נשמר ב-git); שאילתות מבנה/השפעה במקום חיפוש עיוור כשהריפו גדל | `.mcp.json`, `npm run graph:build` |
| **Playwright MCP** 0.0.83 | MCP (מוצמד) | חקירה אינטראקטיבית של הדפדפן, צילומי מסך, שחזור באגים | `.mcp.json` |
| **Chrome DevTools MCP** 1.10.1 | MCP (מוצמד) | ביצועים, רשת, קונסולה | `.mcp.json` |
| **design-review** + **pragmatic-code-review** | Subagents + פקודות (מ-`OneRedOak/claude-code-workflows`, נבדקו לפני העתקה — פרומפטים בלבד, ללא hooks/סקריפטים) | `/design-review` מול Preview חי (Playwright), `/pragmatic-code-review` | `.claude/agents`, `.claude/commands` |
| **@playwright/test** 1.56.1 + **@axe-core/playwright** | Dev deps | E2E במובייל ובדסקטופ + WCAG 2.2 AA אוטומטי | `playwright.config.ts` |
| **Vitest** + Testing Library | Dev deps | בדיקות יחידה/רכיב | `vitest.config.mts` |
| **Supabase CLI** 2.120 + **pgTAP** | Dev dep | סטאק מקומי אמיתי (DB, Auth, REST, מייל), בדיקות DB | `supabase/`, `npm run db:*` |
| **Gitleaks** 8.30.1 · **Trivy** 0.75.0 · **OSV-Scanner** 2.2.2 | CLI מקומי + CI | סודות, תלויות, misconfig. הגרסאות אומתו כקיימות | `.github/workflows/security.yml` |
| **CodeQL** | CI | SAST ל-JS/TS | `.github/workflows/security.yml` |
| **Dependabot** | CI | עדכוני תלויות + פעולות | `.github/dependabot.yml` |
| **Claude PR review** | CI (לא פעיל עד הגדרה) | סקירת PR אוטומטית מול CLAUDE.md ומסמך האבטחה | `.github/workflows/claude-review.yml` |

### זמינים בסשן (ללא התקנה)
- **סקילים מובנים:** `security-review`, `code-review`, `simplify`, `dataviz` (לפני כל גרף/KPI), `artifact-design`, `loop`.
- **קונקטורים:** Supabase (כולל `get_advisors` אחרי כל DDL — יופעל מול פרויקט אמיתי), Vercel (פריסה, לוגים), GitHub, Context7 (תיעוד עדכני — חובה לפני API של ספרייה), Figma/Canva (אב-טיפוס), Postman/Swagger (חוזי API בהמשך).

## נשקל ולא הותקן (במכוון)

| כלי | סיבה |
|---|---|
| **rtk** | Hook שמיירט כל פקודת shell; חיסכון בטוקנים אינו הצורך הנוכחי, והוא משנה את זרם הפקודות. נבחן מחדש אם עלות ההקשר תהפוך לבעיה |
| **gstack** | 59 סקילים עם תלות ב-Bun; חפיפה מלאה עם superpowers + design-review + security-review. מנופח להקשר בלי ערך שולי ברור. ניתן להוסיף לפי בקשה |
| **claude-mem / agentmemory** | זיכרון חוצה-סשנים נשמר מקומית במכולה חולפת. הזיכרון האמין שלנו הוא `CLAUDE.md` + `docs/` + יומן החלטות |
| **codebase-memory-mcp / graft** | חפיפה עם graphify; "לא מריצים כמה אינדקסים של קוד" (Engineering-OS) |
| **browser-use / page-agent** | Playwright דטרמיניסטי עדיף כראיית regression. page-agent הוא לבניית copilot בתוך המוצר — לא בהיקף |
| **open-design / cli-anything / agency-agents / i-have-adhd / laya-coreml / voicebox / meetily / openmontage** | לא רלוונטיים למשימה; open-design כבד וחופף עם ui-ux-pro-max + Figma |
| **frontend-design** | הוצא משימוש ע"י Engineering-OS, מוחלף ב-ui-ux-pro-max |
| **Maestro / Appium / Mobile Next** | אין אפליקציית מובייל; הזמנה היא web מובייל (נבדק ב-Playwright ב-360px) |
| תוספי קהילה מהקטלוג (code-review של 16urls, tailwind-design-system, a11y-enforcer…) | כפילות עם מה שכבר מותקן, מקור קהילתי לא נבדק |

## יעד להתקנה בשלבים מאוחרים (לא נדרש כעת)
- **OWASP ZAP** (DAST) מול Preview עם הקשר מאומת — שלב 11. נדרש URL חי.
- **Lighthouse CI** — כשיהיה UI אמיתי (שלב 1+).
- **k6** — בדיקת עומס להזמנות מקבילות מעבר לבדיקת 50-מקבילי (שלב 4).
- **Storybook** — אם ה-design system יצדיק קטלוג רכיבים (שלב 1).
- **OpenSSF Scorecard** — לאחר שהריפו ציבורי/עם היסטוריה.

## הערות ביצוע
- תוספים מותקנים ברמת המשתמש בסשן הזה ומוצהרים ב-`.claude/settings.json`, כך שסשן חדש ייטען אותם. **סקילים נטענים בתחילת סשן** — אלה שהותקנו עכשיו יהיו זמינים לשימוש מהסשן הבא.
- שרתי MCP של הפרויקט (`playwright`, `chrome-devtools`) דורשים אישור חד-פעמי בהרצה אינטראקטיבית של Claude בריפו.
- OSV-Scanner **חסום** בסביבת הענן הזו (`api.osv.dev` מחזיר 403) — ראיית SCA מקומית נלקחה מ-Trivy; OSV ירוץ ב-CI.
