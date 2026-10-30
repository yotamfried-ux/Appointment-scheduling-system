# Tori / Appointment System — אימות מוכנות לייצור ממקורות חיים (ללא סליקה)

**תאריך:** 2026-10-30 (Israel)  
**הכרעה:** **NO-GO להשקה ציבורית מלאה; ניתן להמשיך פיילוט מוגבל ומפוקח בלבד**.  
**היקף שאינו נבדק:** ספק סליקה, גבייה אוטומטית, חשבוניות/מע"מ, פורטל תשלומים והחזרי כסף. כל יתר דרישות הייצור עדיין חלות.  
**אופן הבדיקה:** קריאת קוד `main` ב-GitHub, GitHub Actions כולל לוגי כישלון, פריסות והגדרות Vercel, שאילתות `SELECT` בלבד ב-Supabase החי, Advisers, Resend Domains/Webhooks/Emails. **לא השתמשתי במסמכי הפערים/המוכנות הישנים כדי לקבוע מה פתוח**. לא בוצעו שינויים ב-Production, במסד, בסודות או בגרסת האפליקציה.

## A. מקור האמת, גרסה והגבלות

- **GitHub:** `yotamfried-ux/Appointment-scheduling-system`, ענף הייצור `main` ב-`584188cd3ba29abfb02b58314f69ca5572b180c3`. ברירת המחדל של המאגר היא דווקא `claude/optimistic-hypatia-wh3zo3`; `main` אינו protected.
- **Vercel:** פרויקט `appointment-scheduling-system`, פריסה Production `dpl_2SnAMjdauRC6oS56cKzXAEtA1Bz3` במצב `READY` מאותו commit, עם alias `turim.d2ryf.com`; הדומיין מסומן `verified`.
- **GitHub Actions:** [CI כושל #40528809596](https://github.com/yotamfried-ux/Appointment-scheduling-system/actions/runs/40528809596) מול [Security ירוק #40528809270](https://github.com/yotamfried-ux/Appointment-scheduling-system/actions/runs/40528809270). שני אלה על אותה גרסה.
- **Supabase Production:** `abhadytskhgwkrlmceew` באזור `eu-central-1`. קריאות SQL לא שינו נתונים.
- **Resend:** `mail.d2ryf.com` verified / sending enabled; webhook enabled ל-`https://turim.d2ryf.com/api/webhooks/resend` עם `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`. נמצאו הודעות אימות, איפוס סיסמה ואישור תור בסטטוס `delivered` (וכן הודעת אימות אחת `bounced`). ראיה למסירת דואר בפועל, לא להצלחת כל מסלול E2E בגרסה הנוכחית.
- **מגבלות:** נסיונות למשוך Vercel runtime logs/runtime errors וקריאת האתר באמצעות החיבור החזירו `403`; גם גישה חיצונית לכלי הבדיקה של `/api/health` ו-`/api/ready` לא הצליחה. זו **מגבלת בדיקה/הרשאה**, לא ראיה שהאתר נפל. לא נמסרו ראיות מגובות להפעלת PITR, בדיקת restore בענן, בדיקת מסך ידנית או חוות דעת משפטית. משתני Vercel נבדקו בשמות/טווחי סביבה בלבד, **ללא פענוח ערכי secrets**.

`PASS` = אומת ישירות; `FAIL` = נצפה כישלון; `RISK` = הגדרה מסוכנת/פער מוכח, ללא הוכחת ניצול; `BLOCKED` = לא ניתן לאמת; `PARTIAL` = ראיות חלקיות; `NOT_TESTED` = לא בוצעה בדיקה עצמאית.

## B. מטריצת מוכנות — ללא ממשק תשלום

| רכיב | תוצאה | ראיה ישירה / משמעות |
|---|---|---|
| פריסת הקוד והשוואה ל-main | **PASS** | Vercel READY, אותו SHA כמו main |
| דומיין Production | **PASS** | alias קיים ומאומת; HTTP חי לא נבדק בהצלחה |
| CI: Lint / Typecheck / Unit / Build / Bundle | **PASS** | job `Lint · Types · Unit · Build` ירוק בריצת #40528809596 |
| CI: E2E Desktop + Mobile | **FAIL** | **625 passed; 2 failed** באותו מבחן waitlist-day-status ב-Desktop וב-Mobile; `tests/e2e/sim-status-text.spec.ts`, ציפייה `יש תורים פנויים` מול `מלא` |
| CI: DB pgTAP / schema lint | **FAIL** | כ-1066 assertions נסרקו; בדיקות schema lint נכשלו חוזר בגלל **שתי** פונקציות `SECURITY DEFINER` ב-public. לא לפרש כ-17 באגים נפרדים |
| SAST/SCA/Secrets/License/SBOM | **PASS** | חמש עבודות: CodeQL, OSV, Trivy, Gitleaks, Licences+SBOM עברו ב-Security #40528809270 |
| RLS בבסיס החי | **PASS (הגדרה בלבד)** | 29 טבלאות public; **0** ללא RLS ו-**0** ללא FORCE RLS. לא מהווה בדיקת חדירה עצמאית לייצור |
| Supabase Security Advisors | **PARTIAL** | 2 WARN על RPC definer ציבוריים, WARN על leaked-password protection כבוי; 7 INFO על טבלאות עם RLS וללא policy (לרוב deny-by-default, לא לחשוף אוטומטית) |
| Cron / jobs | **FAIL** | `vercel.json` מתזמן outbox, reminders, waitlist **פעם ביום**. DB חי: לכל אחד **ריצה מוצלחת אחת** ב-24 שעות. הקוד מצפה 5/15 דקות |
| Job health | **FAIL (נגזר מקוד ו-DB)** | `job-health.ts` מגדיר ספי stale: outbox 15 דק', reminders 45 דק', waitlist 15 דק'; בדגימת SQL של 08:49 UTC הגילאים היו ~202/~203/~153 דקות. לכן `assess()` היה מחזיר `ok=false`. HTTP עצמו לא נבדק |
| Resend / Webhook | **PASS (תשתית)** | דומיין וה-webhook מאומתים; קיימות הודעות delivered במערכת הספק |
| פרטי env ב-Vercel | **PARTIAL / RISK** | שמות secrets מוגדרים, אך חיבור Supabase ו-`SUPABASE_SECRET_KEY` משויכים **גם ל-Production וגם ל-Preview**; ראו P0-01 |
| גיבויים ושחזור Production | **BLOCKED** | PITR, retention, גיבוי ושחזור בענן לא אומתו; קובץ `scripts/drills/restore.sh` הוא בדיקת dump מקומית, לא הוכחת שחזור Supabase Production |
| ניטור והתראות תפעוליות | **BLOCKED** | endpoints קיימים, אך קריאת Vercel runtime errors/logs נדחתה 403; אין ראיית alert-to-human חיצונית |
| תרחיש משתמש על הדומיין החי | **NOT_TESTED בגרסה הזאת** | DB: שני עסקים, שני memberships, **אפס תורים כרגע**. Resend הראה אישור תור היסטורי; אין אימות חדש מלא של שרשרת לקוח בגרסה 584188c |
| Auth/MFA | **PARTIAL** | קוד מסלולי כניסה, MFA וטוקנים קיים; settings של Supabase Auth לא נבדקו במלואם. Advisor מאשר leaked-password protection כבוי |
| Privacy/legal/accessibility | **PARTIAL / BLOCKED** | קיים טקסט מוצג ב-`lib/legal/content.ts` ובדיקות נגישות אוטומטיות ב-CI; אישור הדין הישראלי ובדיקת קורא מסך בידי אדם לא אומתו |
| מעקב dependency/branch protection | **RISK** | `main` לא protected; ברירת מחדל על ענף פיתוח, PRs אוטומטיים של Dependabot פונים אליו |
| עומס/תפוקה מסחרית | **NOT TESTED** | דוחות בדיקות מקומיות אינם מוכיחים capacity ב-Production. אין נתוני field ברמת עומס מסחרי |

## C. חסמי P0 — יש לסגור לפני השקה פתוחה

### P0-01 — בידוד מוחלט בין Preview ל-Production (אבטחה/נתונים)
**ראיה:** Vercel `filter_project_envs(decrypt=false)` החזיר רשומת `SUPABASE_SECRET_KEY` אחת עם `target: ["production","preview"]`; כך גם `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_URL` ו-`CRON_SECRET`. משתנה `ALLOW_NON_PRODUCTION_DEFAULTS` מוקצה ל-Preview. קוד `platform/system-db/index.ts` משתמש ב-`SUPABASE_SECRET_KEY` לביצוע פעולות עם הרשאות גבוהות, וקוד `lib/env.ts` מקל על סביבת Preview עם המתג האמור.

**סיכון:** build, preview, בדיקה או קוד פיתוח יכולים לבצע פעולה נגד מסד Production אם אותן רשומות אכן מוזרקות ללא override. השיוך המשותף מאומת; **לא נחשפו ערכי הסודות ולא נבדק runtime של Preview**, ולכן אין להסיק שנוצלה גישה בפועל.

**סגירה:** לפרוס פרויקט/DB Supabase נפרד לחלוטין ל-Preview (URL, publishable/secret key שונים); להסיר שיוך Production secrets מ-Preview; להחליף APP_URL/CRON_SECRET לפי סביבה, למנוע email אמיתי ללקוחות מתוך Preview, לוודא isolation בבדיקת קריאה/כתיבה מול fixtures לא רגישים ושהגדרות הגנת Preview תקינות. אם הופעלו keys ב-builds לא מהימנים, להעריך סיבוב סודות. **אין להעתיק נתוני לקוחות אמיתיים לסביבת Preview.**

### P0-02 — לתקן תזמון משימות אמיתי ולוודא alert
**ראיה:** [vercel.json](../../vercel.json) מכיל `0 5 * * *` (outbox), `10 5 * * *` (reminders), `20 5 * * *` (waitlist). SQL על `public.job_runs`: לכל אחד אחת ב-24 שעות ו-0 כישלונות ב-24 שעות, עם גילאי הצלחה 153–203 דקות בדגימת 2026-10-30 08:49 UTC. `modules/notifications/job-health.ts` דורש ~15/45/15 דקות. [PR #25](https://github.com/yotamfried-ux/Appointment-scheduling-system/pull/25) מציע GitHub Actions Scheduler אך Draft ולא מוזג; אין קובץ `.github/workflows/jobs.yml` ב-main.

**סיכון:** reminders והצעות waitlist באיחור, outbox retry איטי ו-health stale; `kickOutbox` יכול לקצר חלק מדואר מיידי אך אינו מתקן תזכורות/תורים שפג תוקפם.

**סגירה:** לבחור scheduler אמין עם `outbox=5m`, `reminders=15m`, `waitlist=5m`, `maintenance=daily`; לשמור Bearer `CRON_SECRET` (בלי לחשוף ערך); לקנפג alarm כש-job לא הצליח בזמן; להוכיח 24–48 שעות ריצות מחזוריות ו`/api/jobs/health` 200. אם משתמשים ב-GitHub Actions יש להביא בחשבון ש-`schedule` best-effort, לוודא branch, secret, workflows והתרעות על דילוגים, ולבדוק התאמה לדרישות דיוק התזכורות.

### P0-03 — CI ירוק על **אותה** גרסת Production (E2E ו-DB)
**ראיה:** [CI #40528809596](https://github.com/yotamfried-ux/Appointment-scheduling-system/actions/runs/40528809596), commit 584188c:
1. E2E: **625 passed / 2 failed**. הלוג: `tests/e2e/sim-status-text.spec.ts:74–87`; עבור יום שהבדיקה ציפתה שיסומן פנוי, ה-UI מציג `מלא`. קרה ב-Desktop וב-Mobile 360 וב-retry. **לא הוכרע** אם זו סטייה בלוגיקת הזמינות או setup/test assumption.
2. pgTAP: שתי הפרות של `private.lint_violations()` מסוג `definer_in_exposed_schema`: `public.admin_dashboard_metrics`, `public.admin_list_businesses`. ב-Production יש להן `prosecdef=true` ו-`authenticated EXECUTE=true`. התוכן מפנה לפונקציות `private` שבהן `private.is_platform_admin()` בודקת הרשאת מנהל עם second factor; **אזהרה אינה הוכחה לדליפה**, אך זו חריגה מגדר החשיפה וכלל lint קיים.

**סגירה:** שחזור ופענוח התנהגות waitlist; תיקון המוצר **או** תיקון ציפיית הבדיקה רק עם הוכחת נתונים. העברת wrappers הציבוריים ל-`SECURITY INVOKER` ככל שה-privileges מאפשרים, תוך שמירת בדיקת מנהל ב-private; בדיקות פוזיטיביות ואנטי-cross-tenant, בדיקת SQL ב-preview ואז migration מאומת. הרצת CI DB/E2E + Security מחדש; **all green** על commit חדש לפני deploy.

### P0-04 — reconciliation של היסטוריית המיגרציות לפני `db push`/שחזור
**ראיה:** בענף `main` נמצאו **46 קובצי migrations**; טבלת `supabase_migrations.schema_migrations` החיה מכילה **41 רשומות**. **15 גרסאות שבקוד אינן מופיעות בהיסטוריה**, כולל `20261054000000`, `20261055000000`, `20261056000000` ו-`20261057000000`; מנגד יש **10 גרסאות DB** עם timestamps אחרים של שינויים ששמם חופף לשמות בקוד. חלק מהאובייקטים של migrations מאוחרים קיימים ב-Production, לכן **אין להסיק שהם לא יושמו**; יש אי-התאמה בהיסטוריה ובגרסאות, גם אם הסכמה תפקודית.

**סיכון:** `supabase db push`/מנגנון CI של migrations יכול להפעיל SQL שוב, להיכשל, לדרוס functions או ליצור מצב שאי אפשר לשחזר אוטומטית. **אין לבצע `db push` ישירות על Production כדי לנסות לסדר את המצב.**

**סגירה:** להשוות גרסאות לפי שם, תוכן/SQL והגדרות אובייקטים מול DB חיה; להכין מפת equivalence ושרשרת migrations קנונית חדשה; לבצע `supabase migration repair` **רק לאחר אימות** ובאישור מפורש; להקים Supabase scratch חדש מאפס ולהריץ את כל migrations ואת pgTAP, להשוות schema fingerprints, grants, RLS, triggers ו-functions, ואז להוכיח dry-run נגד מסד דומה לייצור.

### P0-05 — E2E חי על דומיין Production, כולל כשלי דואר והתאוששות
**ראיה:** יש שני עסקים ב-DB ואפס רשומות `appointments` כרגע; Resend מכיל מייל `booking confirmed` שנמסר בתאריך קודם אך אין מבחן end-to-end אקטואלי של גרסת 584188c. קריאת live endpoints נחסמה בכלי הבדיקה ולא נחשבת PASS.

**סגירה:** בדיקות עם חשבון/עסק בדיקה ייעודי ב-Production **לאחר** תיקון P0-01/03 ובחלון מורשה: הרשמה/אימות, MFA, Onboarding, שירות/צוות/שעות, הזמנת תור, idempotency + double-booking, אישור מייל/קישור ניהול, שינוי/ביטול/רשימת המתנה, תזכורת, זכאויות Free/Pro ללא גבייה, מחיקת נתוני בדיקה, מובייל/RTL, כשל ספק מייל ואי-חציית טננטים. לתעד מזהי ריצה ותוצאה, לא מידע אישי.

### P0-06 — יכולת שחזור נתונים מוכחת, לא רק runbook
**ראיה:** קיימים `scripts/drills/restore.sh` ונהלי restore, אך אין אימות ישיר של הגדרות Supabase Backups/PITR או שחזור מענן Production. אין RPO/RTO מדוד.

**סגירה:** לבחור יעד RPO/RTO ומסלול גיבוי בהתאם לגודל הסיכון; לאמת plan, retention, היתכנות PITR, הגבלת גישה לגיבויים; לבצע תרגיל שחזור **לסביבה מבודדת** מגיבוי שמדמה Production, כולל עמידות סכמה/תורים/הרשאות/שדות; לשמור ראיית תאריך, זמן ושגיאות. אין לבצע rollback או restore על DB חיה כחלק מהבדיקה.

### P0-07 — ניטור תפעולי עם התראות נבדקות
**ראיה:** `/api/health`, `/api/ready` ו-`/api/jobs/health` מוגדרים בקוד; אך Vercel Runtime Logs ו-Runtime Errors החזירו `403` לחיבור, ולא אומתו ניטור חיצוני, alert routing או טיפול באירוע. `job-health` צפוי להיות stale בגלל P0-02.

**סגירה:** להפעיל monitor חיצוני ל-ready, job-health מורשה ודומיין TLS; error tracking עם request IDs וללא PII; לנתב התראות לבעלים, לדמות job שנעצר/HTTP 503/מייל שנכשל ולוודא שהתקבלה התראה ושאפשר לחקור לוגים. לתקן הרשאות קריאה של חיבור Vercel או לספק ראיות ממסוף הניהול.

### P0-08 — בדיקות תנאי השקה משפטיים ותפעול משתמשים
**ראיה:** `lib/legal/content.ts` מכיל Terms, Privacy, Cookies, Accessibility, נתוני צרכנים ותיאור העיבוד; משתני `NEXT_PUBLIC_LEGAL_CONTACT` ו-`NEXT_PUBLIC_A11Y_CONTACT` קיימים. **לא הוצגה/אומתה בביקורת זו חוות דעת משפטית** על התאמה בפועל לחקיקה בישראל, הסכמי עיבוד, עוסק/מפעיל, הודעות פרטיות ומנגנון פניות; וגם לא ביקורת נגישות ידנית. זהו **BLOCKED על אישור חיצוני**, לא טענה שקיים בהכרח אי-ציות.

**סגירה:** אישור אחראי ההפעלה ומומחה משפטי לפי השירות והדין החל בישראל (לרבות הגנת פרטיות ונגישות), פרטי גורם מפעיל אמיתיים, תהליך טיפול בבקשות לקוחות/אירועי אבטחה, מדיניות שמירת מידע והתקשרויות ספקים. מבחן נגישות ידני במסלולים קריטיים לפי תחולה. החלטת release מתועדת.

## D. פערי P1/Hardening (אינם מתעלמים מהם)

1. **Auth – הגנה על סיסמאות שדלפו:** Supabase security adviser מציג `Leaked Password Protection Disabled`. להפעיל, ולבדוק הגדרות Auth redirect/site URL, MFA, rate limiting, email sender ותבניות בפועל. [Supabase guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
2. **Repo/release governance:** `main` אינו protected ו-default branch הוא ענף פיתוח; Dependabot PRs #43–#46 מבוססים על הענף הלא-ייצורי. לקבוע default `main` בהתאם להליך עבודה, required checks, הגבלת force-push, review ו-deploy controls. שינוי default branch מחייב בחינת workflows לפני ביצוע.
3. **Security deeper validation:** [Security CI](https://github.com/yotamfried-ux/Appointment-scheduling-system/actions/runs/40528809270) ירוק, אך אין בביקורת זו ראיה לסריקת DAST/Strix מוצלחת ומאושרת על סביבת מבחן או penetration test אנושי. הפעלת Strix/DAST על fixtures בלבד, לא על Production ללא אישור מפורש.
4. **DB advisor performance:** 8 foreign keys ללא covering index (כולל `appointments.customer_id`/`service_id` ו-`waitlist_entries`), 2 unused indexes והערת Auth DB connections קבועים. לבצע `EXPLAIN ANALYZE` על queries בעלי נפח, ולשנות אינדקסים רק לפי תוכנית/מדדים. [Supabase Advisor](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).
5. **7 טבלאות RLS ללא policies:** `billing_events`, `booking_idempotency`, `domain_events`, `email_suppressions`, `job_runs`, `rate_counters`, `token_uses`. זו **INFO**, והדפוס עשוי להיות intentional deny-by-default. לוודא שאכן נדרשת גישה שרתית בלבד; לא ליצור policies פתוחות כדי "להעלים" את ההתראה. [Advisor](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
6. **Preview UX/system emails:** לוודא שקישורי Preview אינם שולחים ל-`APP_URL` של Production, שמפתחות Resend אמיתיים לא נחשפים ל-Preview, ושאין הודעות אמיתיות ללקוחות מתוך fixtures.
7. **עומס, SLA, UX ונגישות:** למדוד זמני תגובה/תקלות ב-Production בתנאי עומס מותרים, Web Vitals/RTL ב-mobile אמיתי, קורא מסך ומצב Low-bandwidth; להגדיר ספי capacity לפי לקוחות מתוכננים.
8. **מסלולי Trial ללא סליקה:** שתי רשומות `subscriptions` הן `active/pro/manual`. לוודא מסלול משתמש חדש ו-14-day trial/Free/Manual grants, expiration and reminders ללא תלות בספק תשלום, לפי מודל ההשקה שנבחר.

## E. מה כן אומת כבר וחשוב לשמר

- Vercel READY על `main` בדיוק; דומיין production verified.
- קוד Lint/Types/Unit/Build/Bundle scan ירוק ב-commit 584188c.
- CodeQL / OSV / Trivy / Gitleaks / Licence+SBOM ירוקים באותו SHA.
- RLS + FORCE RLS על כל 29 הטבלאות הציבוריות; אין בשאילתת המבנה חריגה.
- Resend verified, webhook פעיל, מיילים delivered כולל הודעת אישור תור ואימות חשבון בעבר; קיימת גם הקפצה (bounce) לדוגמה ולכן יש לוודא טיפול באירועים.
- Job runs מתחילים ומסתיימים ב-success, ללא failed ב-24h; **התדירות בלבד אינה מתאימה**.
- אתר ומסלולי signup/booking/admin/owner קיימים בקוד; עצם קיומם **אינו** PASS למסלול live.

## F. סדר ביצוע מומלץ לפי ROI וסיכון

1. **קודם אבטחת נתונים:** לנתק Preview מסודות/DB של Production ולבנות סביבת DB מבודדת (P0-01).
2. **לתקן scheduler ותצפית:** P0-02 + P0-07; הוכחת `job-health=200` ומוניטור שמתריע.
3. **לתקן CI:** לפרק את כשלי E2E/DB, להוריד definer wrappers מאזור החשיפה ולדרוש CI ירוק (P0-03).
4. **להסדיר migrations לפני כל שינוי סכמה:** מפת גרסאות והרצה בסביבת scratch בלבד (P0-04).
5. **אימות שרידות ומסלול אמיתי:** PITR/restore, הרצת E2E לקוח–עסק–דואר (P0-05/06).
6. **סיום release-gate ציבורי:** Auth, branch protections, בדיקה משפטית ונגישות, בדיקת חדירה ו-load מותאמים (P0-08 + P1).

**תנאי GO להגדרה "מוכן לייצור ללא סליקה":** כל P0 סגור בראיות מתוארכות, Production מבודד מ-Preview, אותה גרסת Release עוברת CI ו-Security במלואם, `job-health` ירוק ברציפות, בדיקת משתמש אמיתי עם נתוני מבחן עוברת, יכולת שחזור מוכחת, מנגנון alerts נבדק, וממונה ההשקה מאשר תנאים משפטיים ותפעוליים. עד אז **NO-GO להשקה ציבורית**; פיילוט קיים יכול להימשך בהגבלות ומודעות לסיכון.

## G. ראיות ראשיות — לא מסמכי פערים

- [Commit main — 584188c](https://github.com/yotamfried-ux/Appointment-scheduling-system/commit/584188cd3ba29abfb02b58314f69ca5572b180c3)
- [CI #40528809596 — failure](https://github.com/yotamfried-ux/Appointment-scheduling-system/actions/runs/40528809596) — DB job ו-E2E job; job של Lint/Unit/Build ירוק.
- [Security #40528809270 — success](https://github.com/yotamfried-ux/Appointment-scheduling-system/actions/runs/40528809270)
- [Vercel Production deployment](https://vercel.com/yotamfried-7101s-projects/appointment-scheduling-system/2SnAMjdauRC6oS56cKzXAEtA1Bz3)
- [Source vercel.json](https://github.com/yotamfried-ux/Appointment-scheduling-system/blob/main/vercel.json)
- [Source job-health.ts](https://github.com/yotamfried-ux/Appointment-scheduling-system/blob/main/modules/notifications/job-health.ts)
- [Source environment mode](https://github.com/yotamfried-ux/Appointment-scheduling-system/blob/main/lib/env.ts) ו-[system DB](https://github.com/yotamfried-ux/Appointment-scheduling-system/blob/main/platform/system-db/index.ts).
- [Source migration 20261057000000](https://github.com/yotamfried-ux/Appointment-scheduling-system/blob/main/supabase/migrations/20261057000000_differentiate_paying_vs_complimentary_pro.sql)
- [Source E2E failed spec](https://github.com/yotamfried-ux/Appointment-scheduling-system/blob/main/tests/e2e/sim-status-text.spec.ts)
- ישירות מ-Supabase: `pg_class`, `private.lint_violations()`, `pg_proc`, `public.job_runs`, `public.job_status()`, `supabase_migrations.schema_migrations`; נכון ל-2026-10-30 בסביבות 08:49 UTC.
- ישירות מ-Resend: domains/webhooks/list-emails; נתוני סטטוס בלבד, ללא פרטי נמען במסמך זה.

**מדיניות שינוי:** דוח זה שומר על Production כפי שהיה. כל שינוי סכמה, מפתח, פריסת Production, שינוי scheduler חי, איפוס/שחזור או תרגיל לא-סינתטי דורש החלטה ואישור נפרדים.
