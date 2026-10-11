# Engineering-OS — מה רלוונטי לנו ואיך נשתמש בו

> `Engineering-OS` הוא **ספריית ידע, לא runtime** (323 נכסים). לא מתקינים אותו כתלות; קוראים ממנו רק את הענף הרלוונטי למשימה.
> נקודת כניסה: `AGENTS.md` ← `capability-registry/ROUTING-MAP.md`. מילון סטטוסים לראיות: PASS / FAIL / PARTIAL / BLOCKED / NOT TESTED / FLAKY.

## 1. נכסים שמתאימים ישירות

| צורך | נכס | מה ניקח ממנו |
|---|---|---|
| ארכיטקטורת מערכת | `templates/booking-system`, `templates/saas-platform` | רכיבים נדרשים, צ'קליסטים לאבטחה/בדיקות/פריסה; **אילוץ ייחודיות חלקי על סלוט**, מכונת מצבים `pending→confirmed→completed/cancelled/no-show`, ICS export, רשימת המתנה עם auto-promote |
| Multi-tenancy | `docs/architecture-guides/web/multi-tenant-saas.md` | shared schema + RLS, `tenant_id` כעמודה מובילה באינדקסים, tenant מגיע תמיד מה-session |
| מבנה קוד | `docs/architecture-guides/web/modular-monolith.md`, `patterns/database` | Repository, Optimistic Locking, Soft Delete, Migrations |
| Supabase | `external-systems/supabase`, `docs/official-docs/supabase.md`, `lessons-learned/bugs/supabase-ssr-breaking-change.md` | RLS על כל טבלה ציבורית; `service_role` רק בצד שרת; **לבדוק תיעוד עדכני לפני `@supabase/ssr`** ולהריץ `tsc --noEmit` אחרי כל התקנה |
| הרשאות/אימות | `patterns/auth`, `patterns/authorization` | Session-based auth, RBAC (owner/admin/member לעתיד) |
| Jobs | `patterns/background-jobs` | Idempotent workers, retry+backoff, DLQ, scheduled jobs |
| אימייל / הודעות | `patterns/integrations/email`, `notifications`, `messaging`; `external-systems/resend` | ממשק `Mailer` אגנוסטי לספק, תבניות בגרסה, שליחה אסינכרונית, `messageId` לקורלציה |
| יומנים | `patterns/integrations/calendar` | Google Calendar OAuth+sync, **Unified Calendar Abstraction**, Booking State Machine |
| חיוב מנויים | `patterns/billing`, `external-systems/{stripe,paddle,lemonsqueezy}` | webhooks כמקור אמת יחיד, idempotency, state machine של מנוי (trial→active→past_due→canceled) |
| API | `patterns/api` | Cursor pagination, Rate limiting, Request validation (Zod), Error format אחיד, Versioning |
| תצפית | `patterns/observability` | Structured logging, health checks, tracing |
| UI/UX | `patterns/ui` (Design Tokens 3 שכבות, נגישות), `external-skills/ui-ux-pro-max`, `patterns/frontend` | tokens סמנטיים, Server/Client Components, Optimistic Updates, Forms (RHF+Zod) |
| בדיקות | `patterns/testing/FAST-PATH`, `evidence-and-simulation.md`, `project-qualification.md`, `capability-registry/application-testing/playwright-mcp.md` | סולם נאמנות (unit→DB אמיתי→preview), failure injection, "אסור לבחור ריצה ירוקה", Playwright ל-user journeys |
| אבטחה | `patterns/security`, skill `security-review` | OWASP, secrets, RLS tests |
| צמצום עלויות הקשר | `capability-registry/token-context-efficiency.md` | חיפוש נכס קיים לפני מחקר מחדש |

## 2. כלים וסקילים

- **`tools/eos_capabilities.py`** — מניפסט `.engineering-os-tools.json` לכל פרויקט (`init-project`, `setup`, `status --json`). נריץ `init-project --profile core` בריפו הזה בשלב ההקמה.
- **UI UX Pro Max** (מחליף `frontend-design` שהוצא משימוש): יצירת design system לפי תחום, כללי נימוק לפי סקטור, צ'קליסט לפני מסירה (נגישות, רספונסיביות, anti-patterns).
- **Superpowers / gstack**: זרימות עבודה (תכנון, TDD, ביקורת) — לבחון בשלב ההקמה.
- **Playwright MCP / Chrome DevTools MCP**: אוטומציית דפדפן לסימולציות משתמש, צילומי מסך, ביצועים.
- **Graphify / RTK**: חיסכון בהקשר בריפו גדול — רק אם נצטרך.
- **תבנית Route Plan** (מ-`core/task-router.md` שמופיע ב-project-8): תוכנית כתובה לפני קוד לכל משימה לא-טריוויאלית, עם Validation gates וראיות. נאמץ גרסה רזה (ראו מסמך 03).

## 3. מה **אין** שם (פערים)

- אין תבנית ספציפית ל-Next.js + Supabase + Vercel מקצה לקצה; נשלים מ-Context7 + תיעוד רשמי.
- `patterns/database` ו-`patterns/security` דורגו בעבר כדלילים — נשתמש ב-Supabase docs ו-OWASP כמקור סמכותי.
- חיוב בישראל (מע"מ, חשבוניות): אין כיסוי. **להחלטה** (ראו מסמך 03, סעיף 9).

## 4. לקחים מ-project-8 שחשוב לא לחזור עליהם

1. בדיקת תיעוד עדכני לפני שימוש ב-API של ספרייה (`@supabase/ssr`).
2. לא להכריז "אומת מול Supabase/Vercel" בלי שימוש חי בקונקטור — ראיה ממשית בלבד.
3. מוקים מוכיחים מודל ולא אינטגרציה: לסמן ראיות מבוססות מוק במפורש.
4. טסט שלילי שעובר מהסיבה הלא נכונה — כל בדיקת regression חייבת להיכשל קודם על הקוד השבור.
