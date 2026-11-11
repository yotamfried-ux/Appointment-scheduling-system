# Tori / D2R — מפרט הקשחה משפטית, פרטיות, אבטחה ונגישות (MASTER SPEC)
**גרסה:** 1.0 · **תאריך:** 2026-11-11 · **סטטוס:** תוכנית ביצוע מחייבת לאימות; אינה אישור משפטי  
**תחולה:** אפליקציית Next.js, מסד Supabase, פריסות Vercel, דוא"ל Resend, אינטגרציות עתידיות, מסכי בעלי עסקים ולקוחות, נתוני Production, ספקים, תפעול ותיעוד.  
**מקור:** דוח LR-01–LR-18, `docs/legal/open-decisions.md`, סקירת קוד ומסמכי מדיניות, מסמכי הבירור ב-PR זה, והחלטת בעלים שרישום כעוסק פטור מתוכנן לתחילת ינואר 2027.  
**מטרה:** להפחית חשיפה משפטית ולבסס ראיות עמידה בדין. אין אפשרות להבטיח חסינות מתביעה או להעביר אחריות לעורך דין, לספק או לתנאי שימוש.

## 0. כללי ביצוע ואי-הצהרת שווא
1. **אין לסגור ממצא על בסיס תיעוד בלבד.** סגירה דורשת שינוי קוד/נוהל אם נדרש, בדיקה חוזרת, ראיית Production או סביבה מבודדת, אישור בעלים/עו"ד כשנדרש, ורישום סיכון שיורי.
2. כל משימה מקבלת: `owner`, `priority`, `dependency`, `evidence URL`, `commit SHA`, `test run`, `environment`, `verified_at`, `reviewer`, `status` ו-`residual risk`. מצבי סטטוס: NOT_STARTED / IMPLEMENTED / VERIFIED / LEGAL_REVIEW / OWNER_ACTION / BLOCKED / CLOSED.
3. **איסור על פעולות מסוכנות ללא אישור מפורש:** מחיקת נתוני Production, שחזור על Production, חשיפת מידע אישי לצורכי בדיקה, פתיחת הרשאות, קבלת תנאים בשם הבעלים, חיוב אמיתי, שיווק, שינוי DNS או שינוי בעלות עסקית.
4. **אין לפתוח שיווק/סליקה/שירות רגיש לפני שערי ההשקה** המפורטים בהמשך. אין להציג D2R כחברה בע"מ או כעוסק רשום לפני רישום ואימות.
5. אין להכניס נתוני לקוחות אמיתיים ל-GitHub issues, PR, CI, screenshots, observability או כלי AI. ראיות אנונימיות/מושחרות בלבד.
6. כל קביעה משפטית תסומן אחת מאלה: VERIFIED FACT, LEGAL INTERPRETATION — COUNSEL REVIEW, OWNER DECISION, UNVERIFIED. חוות דעת משפטית תידרש למסקנות תחולה.

## 1. נתוני בסיס מאומתים והנחות
- מפעיל מתוכנן: D2R; **עדיין לא נרשם כעוסק פטור**, יעד תחילת ינואר 2027. פרטי זהות/מען/מספר עוסק רשמיים יוזנו רק לאחר אימות.
- יעד שוק: ישראל; מוצר SaaS רב-דיירי לניהול תורים.
- Supabase Production `appointment-system-frankfurt`, ref `abhadytskhgwkrlmceew`, region `eu-central-1`, נצפה פעיל ב-2026-11-11. לא מאמת גיבויים/לוגים/תתי-מעבדים.
- חיבור Vercel הזמין בשיחת הבדיקה לא הציג את פרויקט Tori. **אין הוכחת חשבון/תוכנית/הסכם Vercel עבור Tori**.
- Resend מוגדר בקוד כספק SMTP, אך לא אומת חוזה ברמת החשבון.
- ייתכן מידע אישי רגיש בטקסט חופשי או בשם השירות, אף ששדות intake רגישים הוסרו בעבר.
- סקירת Supabase Security Advisor החזירה 7 הערות INFO לטבלאות פנימיות עם RLS וללא policies; אין להסיק פרצה או להוסיף policies לפני בדיקת grants ומודל הרשאות.
- מסמך `docs/legal/processors-and-transfers.md` היסטורי ומכיל מידע לא מעודכן על סביבת Singapore. יש לתקנו לאחר אימות.

## 2. מפת כיסוי מלאה — 18 ממצאי דוח
כל פריט הוא דרישת עבודה עם **מימוש + בדיקות + ראיות + שער סגירה**.

### LR-01 — זהות מפעיל, רישום ומסמכי מס [P0 / OWNER_ACTION]
**מימוש:** הפרדת שם מותג משם משפטי, כתובת עסק, כתובת למסירת הודעות, איש קשר ומספר עוסק; placeholders ברורים בלי מספר מומצא; טקסטים אחידים באתר, חוזים, דוא"ל, אישור הזמנה ומסמכי חיוב. לפני תחילת חיוב: מסלול קבלות/חשבוניות כחוק והתאמה לעוסק פטור ולתקרות/תנאים הרלוונטיים.
**בדיקות:** snapshot לכל עמוד ומייל, השוואת נתונים לרישום בפועל, תרחיש ללא מספר עוסק; בדיקת checkout לפני פתיחה.
**סגירה:** רישום מאומת והצהרת בעלים, ולא רק קוד מוכן. עד אז סטטוס OWNER_ACTION.

### LR-02 — תפקידי מידע והסכם עיבוד מול עסקים [P0]
**מימוש:** מטריצת controller/processor/holder לפי dataset ו-purpose (לקוחות, בעלי עסקים, תמיכה, anti-abuse, billing, logs). נספח עיבוד נתונים לעסקים: הוראות מתועדות, מטרות, משך, קטגוריות, אבטחה, סודיות, ספקי משנה, העברות, זכויות, אירועים, מחיקה/החזרה, audit, שיפוי ואחריות מידתית. ממשק הסכמה גרסאי עם timestamp, actor, document hash ויכולת שליפה; reacceptance בעת שינוי מהותי.
**בדיקות:** בעל עסק חדש/קיים/מסרב, audit evidence, tenant isolation, בקשת ייצוא/מחיקה, מקרה שינוי ספק.
**סגירה:** עו"ד מאשר חלוקת תפקידים והסכם, וחתימה/קבלה תקפה נשמרת.

### LR-03 — יידוע בנקודת איסוף וזכויות [P0]
**מימוש:** מיפוי כל נקודת איסוף: הרשמה, login, booking, waitlist, יצירת עסק, הודעות, תמיכה, תשלומים עתידיים. טקסט קצר סמוך לשדה עם זהות בעל שליטה, מטרה, האם מסירה חובה/רשות, תוצאה של אי-מסירה, נמענים וזכויות, בהתאם לדין; קישור למדיניות; נגישות/RTL; הבחנה בין יידוע, הסכמה חוזית והסכמה לשיווק.
**בדיקות:** E2E דסקטופ/מובייל/קורא מסך, טופס ללא checkbox, refusal, קבלה גרסאית, מדיניות לא זמינה.
**סגירה:** צילומי ראיה וסקירת עו"ד לנוסח סעיף 11.

### LR-04 — סיווג מאגר, רישום/הודעה, DPO ורמת אבטחה [P0]
**מימוש:** inventory של טבלאות, בעלי שליטה, מטרות, נושאי מידע, קטגוריות רגישות, מספר רשומות, מספר מורשי גישה, העברות ותהליכי עיבוד. מזכר החלטה לפי חוק הגנת הפרטיות תיקון 13 ותקנות אבטחת מידע 2017; בדיקת חובת רישום, חובת הודעה, מינוי ממונה, רמת אבטחה, מסמך הגדרות מאגר, נוהל אבטחה, ביקורות תקופתיות, הדרכה, ניהול הרשאות ותיעוד.
**בדיקות:** SQL metadata בלבד, בלי להוציא PII; ספירות לפי קטגוריה; evidence של הרשאות ו-RLS; reclassification בעת צמיחה/מוצר רפואי.
**סגירה:** החלטה משפטית מתועדת, דיווח/רישום אם נדרש, ובקרות תואמות לרמת האבטחה.

### LR-05 — ספקים, DPA, העברות מחוץ לישראל [P0 / OWNER_ACTION]
**מימוש:** Vendor Register עבור Supabase, Vercel, Resend, GitHub, DNS וכל אינטגרציה; סוגי מידע, מדינות עיבוד, גיבויים/לוגים, subprocessors, retention, incident notice, audit, termination/deletion, legal transfer basis. להוריד/לשמור גרסאות הסכמים ותאריך תחולה ולתעד מי אישר. לבדוק תנאי העברת מידע לחו"ל לפי הדין הישראלי, לא להסתפק ב-region DB.
**בדיקות:** ראיית חשבון לכל ספק, plan/contract party, audit תצורה, DPA version, רשימת subprocessors ונתיבי נתונים; השוואה לטקסט הציבורי.
**סגירה:** כל הסכם חל ומאומת ברמת החשבון, פערים נסגרו בכתב, עו"ד אישר העברות. אין ללחוץ accept בשם הבעלים.

### LR-06 — מידע רגיש וטקסט חופשי [P0]
**מימוש:** בדיקת DB/API/UI/templates/logs לשדות note, service, customer, waitlist, medical/therapy, free text. Data minimization, הגבלת אורך, מניעת echo בלוגים/מיילים, אזהרה לא להזין מידע רפואי, מחיקת שדות שאינם נחוצים, מדיניות שימוש למקצועות טיפוליים; לא להבטיח סינון מושלם באמצעות regex.
**בדיקות:** fixture רגיש סינתטי, tracing של כל המסלולים, logs ללא PII, owner export/delete, התראות, E2E עם business kinds.
**סגירה:** ראיות טכניות ומדיניות עסקית; ייעוץ נוסף אם מאפשרים טיפול רפואי.

### LR-07 — חוזים, תנאים, אחריות, ביטול והסכמות [P0]
**מימוש:** להכין טיוטות סופיות בעברית: תנאי שימוש לעסק, תנאי לקוח קצה, מדיניות פרטיות, נספח עיבוד מידע, מדיניות cookies, מדיניות מחיקה, הצהרת נגישות, תנאי מנוי עתידיים. לבדוק תקרת אחריות, חריגי רשלנות/זדון, שיפוי, forum, זמינות, force majeure, תלונות, הודעות, ביטול, חידוש, החזר, שימוש לרעה, קניין רוחני והסכמים אחידים. לא לכתוב הבטחות אבטחה/מיקום/מחיקה שאין להן ראיה. `legal/config` הוא מקור יחיד לגרסאות ותאריכי תחולה; diff ו-reacceptance.
**בדיקות:** link integrity, תוכן RTL, acceptance DB, גרסה ישנה, שינוי מהותי, מבחני שפה/מובייל, counsel redline.
**סגירה:** עו"ד מאשר טקסטים ופרטי מפעיל, אישור בעלים מתועד וגרסה שפורסמה.

### LR-08 — retention, deletion, backups, restore [P0]
**מימוש:** data retention matrix לכל טבלה/לוג/queue/vendor/backup; 3 שנים לפרטי לקוח לפי החלטה קיימת ו-14 ימי grace למחיקת עסק — לאמת בקוד וב-Production; מחיקת tokens וקישורים, backup expiry, restore replay של מחיקות, legal hold וחריגים; RPO/RTO מוגדרים. לבצע restore רק בסביבה מבודדת מאובטחת.
**בדיקות:** DB integration + clock simulation, סינתטי end-to-end, backup restore drill, re-deletion לאחר restore, הרשאות ומחיקת snapshots; ראיות עם זמנים.
**סגירה:** תרגיל שחזור מוכח ונתוני ספקים מאומתים; לא להסתפק ב-RPC קיים.

### LR-09 — בקשות עיון, תיקון, מחיקה וייצוא [P1]
**מימוש:** DSAR workflow עם intake, אימות זהות, ניתוב לבעל העסק, case ID, תיעוד החלטות, מניעת חשיפה לצד שלישי, סגירה, SLA לפי דין ותפקיד, מחיקה גם ברשימות waitlist ותיעוד audit מינימלי.
**בדיקות:** בקשה אמיתית/מזויפת/כפולה, לקוח אצל כמה עסקים, עסק שנמחק, ייצוא של דייר אחד בלבד, no-leak.
**סגירה:** סימולציות וראיות, נוסח תגובה מאושר.

### LR-10 — אירועי אבטחה, חובות דיווח וראיות [P0]
**מימוש:** Incident runbook; severity, on-call/deputy, זיהוי/containment, evidence chain-of-custody, incident log, תבניות הודעה לרשות/עסקים/נושאי מידע, legal escalation, supplier escalation, credential rotation, recovery, postmortem, insurance consideration. להבחין בין אירוע אבטחה לבין אירוע חמור המחייב דיווח; לא להמציא חובת דיווח אוניברסלית.
**בדיקות:** tabletop על גישה בין עסקים, פריצת מפתח service_role, כשל Resend, מחיקת נתונים, ספק מושבת; בדיקת alert delivery והחלפת סודות ללא חשיפה.
**סגירה:** תרגיל חתום, איש קשר חלופי, חוות דעת משפטית על דיווחים ומנגנון התרעה מוכח.

### LR-11 — אבטחת מידע, הרשאות ושרשרת אספקה [P1; P0 לפגיעות קריטיות]
**מימוש:** least privilege, MFA, secret scanning, CI SAST/DAST/OSV/SBOM/license, dependency pinning, branch protection, security headers/CSP, rate limits, CSRF, auth, tenant RLS, audit, backups, session invalidation, SQL SECURITY DEFINER, storage access, webhook signatures, cron auth, email template injection, SSRF, IDOR/BOLA, error sanitization. לא להוסיף policy ל-7 טבלאות RLS ללא בדיקת grants.
**בדיקות:** test matrix של anon/auth/owner/staff/other tenant/service-role, CI logs, regression, pentest מורשה, חיפוש secrets ו-PII.
**סגירה:** אפס ממצאי critical/high לא מטופלים או החרגה מנומקת ומאושרת; scan evidence עדכני.

### LR-12 — פרסום ודיוור שיווקי [P0 לפני הפעלה]
**מימוש:** marketing OFF by default; לפני הפעלה opt-in נפרד ולא מסומן, timestamp/source/version, double-check suppression לפני enqueue וב-send, unsubscribe פשוט, טיפול בביטול, audit, הפרדה מהודעות תפעוליות; לבחון חוק התקשורת סעיף 30א וכל חריג חוקי עם עו"ד.
**בדיקות:** opt-out, replay, resend, tenant switching, template classification, suppression race.
**סגירה:** בדיקות + סקירת נוסח משפטי; עד אז gated.

### LR-13 — סליקה, מנויים, חשבוניות וביטולים [P0 לפני הפעלה]
**מימוש:** billing OFF עד רישום עסק והסכם Grow; הצגת מחיר כולל מס כחוק, renewal, cancellation, refund, receipts/invoices, PCI boundaries, webhook idempotency, chargebacks, consumer-law applicability, security and audit.
**בדיקות:** sandbox purchase/renewal/cancel/refund/failure, chargeback, missing webhook, duplicate event, invoice reconciliation.
**סגירה:** רישום, חוזה, סקירת עו"ד/רו"ח, בדיקות sandbox ו-Production safe rollout.

### LR-14 — נגישות [P0 לפני פתיחה ציבורית אם חלה חובה]
**מימוש:** להכריע תחולת תקנות נגישות שירות אינטרנט, פטור אפשרי לעוסק פטור/מחזור נמוך לפי הדין והנחיות הנציבות; **אין להניח פטור לפני אימות**. לתקן מול ת"י 5568/תקן רלוונטי: סמנטיקה, labels, keyboard, focus, dialogs, errors, screen readers, contrast, zoom/reflow, RTL, touch targets, status announcements, alt text, booking/waitlist/cancellation/onboarding, mobile. הצהרה אמיתית ודרכי פנייה.
**בדיקות:** axe/Playwright + בדיקה ידנית במקלדת וקורא מסך, 200%/400% zoom, mobile, no mouse, RTL; defect register עם severity ו-retest.
**סגירה:** בדיקה ידנית מוכחת, תיקון ליקויים, סקירת תחולה/פטור והצהרה תואמת מצב אמת; לא להצהיר 'עומד בתקן' על סמך axe בלבד.

### LR-15 — קטינים ומקצועות טיפוליים [P1]
**מימוש:** קביעת גיל/אפוטרופוס, חובת הסכמת הורה כאשר רלוונטי, צמצום פרטי קטין, הגבלת טיפול רפואי/מידע רגיש, איסור שמירת אנמנזה, תנאים לסוגי עסקים חדשים, מנגנון abuse report.
**בדיקות:** minor fixture, therapy kind, text field, no sensitive email/log.
**סגירה:** מוצר/משפט אישרו אילו שימושים מותרים, ותסריטים נבדקו.

### LR-16 — התחזות עסקית, תוכן וקניין רוחני [P1]
**מימוש:** report impersonation, takedown, owner verification risk-based, appeal, evidence preservation, abusive account suspension, licensing register for icons/fonts/images/code, trademark/name screening before branding claims.
**בדיקות:** report->triage->action->appeal, false report, tenant-safe suspension, OSS license scan.
**סגירה:** תהליך פועל ורישיונות מתועדים.

### LR-17 — אחידות מסמכים, הצהרות ציבוריות וראיות [P1]
**מימוש:** לעדכן `data-map`, `processors-and-transfers`, `open-decisions`, `retention-deletion-matrix`, `legal-qualification` לפי עובדות Production; לסמן מסמכים ישנים כ-HISTORICAL; evidence index עם source, date, environment, owner, hash; לתעד אי-ודאות במקום הצהרות שווא; public claims diff מול config ו-DB.
**בדיקות:** CI links, assertions של גרסאות, QA טקסט ציבורי מול תצורת ספקים, חיפוש סתירות.
**סגירה:** אין סתירות מהותיות, כל טענה משמעותית מגובה ראיה עדכנית.

### LR-18 — נתוני דמו ב-Production [P1]
**מימוש:** לזהות synthetic seed (תיעוד היסטורי: 60 לקוחות ו-481 תורים) מול נתונים אמיתיים; dry-run של cleanup, snapshot/rollback, אישור מפורש למחיקה, הפרדת חשבונות בדיקה, מניעת seed ב-Production.
**בדיקות:** before/after counts, referential integrity, no real-data impact, seed guard CI.
**סגירה:** מחיקה מאומתת **רק לאחר אישור בעלים** או הצדקה מתועדת להשארה.

## 3. בקרות חוצות-מערכת שלא יישכחו
- **חוזי ספקים:** זיהוי הצד המתקשר, תחולת DPA ברמת החשבון, תנאי תתי-מעבדים, מיקומי לוגים, retention, מחיקה, דיווח והעברה חוצת גבולות.
- **אבטחה תפעולית:** הרשאות מנהל, break-glass, MFA, רוטציה, גיבויים, alert routing, ניטור ושמירת audit ללא מידע עודף.
- **תוכן משפטי:** אין הבטחת זמינות 100%, חסינות, מחיקה מיידית מכל גיבוי, אחסון EU לכל מידע או 'אין מידע רגיש' ללא ראיה.
- **סיכוני לקוחות:** לקוחות עסקיים ולקוחות קצה הם אוכלוסיות נפרדות; תנאים ומסכי הסכמה נבדקים בנפרד.
- **תשלומים/שיווק:** feature flags סגורים ומבחן שמוכיח שאינם פעילים; אין לשחרר דרך שינוי UI בלבד.
- **שינוי מוצר:** כל שירות חדש, שדה חדש, vendor חדש או כניסה למדינה חדשה מחייב privacy/security/legal impact review לפני merge.
- **אבטחת AI:** אין להעביר מידע אישי ל-AI או telemetry חיצוני ללא בסיס חוקי, מיפוי ספקים והסכמים.
- **המשכיות:** owner יחיד הוא נקודת כשל; ממלא מקום ופרטי חירום מוגנים.
- **ביטוח:** לבדוק כדאיות cyber/professional liability; ביטוח אינו תחליף לבקרות.
- **מעקב:** review רבעוני למסמכים, שינויי ספקים, חוק, נתונים וממצאים פתוחים; evidence expiration.

## 4. סדר עבודה תלוי-סיכונים
**Wave 0 — read-only baseline:** Git SHA, סריקת repo, inventory, סריקת ספקים וחשבונות, data flow, בדיקת legal claims, בדיקת הפעלת marketing/billing. ללא שינוי Production.
**Wave 1 — P0 engineering:** privacy notices, sensitive fields, RLS/auth/PII, logging, retention, incident alerts, restore plan, DPA acceptance instrumentation, accessibility critical flows.
**Wave 2 — legal drafting:** redline של תנאים/פרטיות/DPA, ספקים והעברות, סיווג מאגר, נגישות, חוזים, אישורי בעלים ועו"ד.
**Wave 3 — evidence:** unit/integration/E2E, manual accessibility, tabletop, restore drill, data subject request drill, security scan, supplier evidence, deployment validation.
**Wave 4 — gated launch:** רישום עסק בינואר 2027; בדיקת מסמכי מס/חיוב; אישור בעלים ועו"ד; החלטת GO/NO-GO מתועדת.

## 5. מטריצת בדיקות מחייבת
| תחום | חיובי | שלילי/תקיפה | ראיה |
|---|---|---|---|
| הרשאות | עסק קורא רק נתוניו | cross-tenant IDOR/RLS/role spoof | test run + SQL grants |
| פרטיות | booking notice וגרסה | refusal, missing notice, stale version | screenshots + DB event |
| מידע רגיש | הזמנה תקינה | free-text רפואי סינתטי ו-log/email leak | sanitized trace |
| מחיקה | retention ו-delete | restore resurrects deleted records | isolated restore log |
| אירוע | alert מגיע לאחראי | contact unavailable, compromised token | tabletop + timestamps |
| נגישות | booking keyboard/screen reader | focus trap, error not announced | manual checklist + axe |
| DPA | בעל עסק מאשר גרסה | decline/old version | acceptance evidence |
| ספקים | DPA effective + plan | missing subprocessor/region | contract snapshot |
| שיווק | operational mail בלבד | unsolicited campaign | suppression tests |
| חיוב | disabled state | unauthorized live charge | config + sandbox |
| דמו | synthetic identified | real record misclassified | dry-run + approval |

## 6. שערי שחרור וקריטריון DONE
**GATE-A — לפני לקוחות אמיתיים:** LR-02/03/04/05/06/07/08/10/11/14, ובקרות LR-09/15/16/17 לפי תחולה; לא להכניס מידע אמיתי לפני מיפוי חוזי/פרטיות/אבטחה.
**GATE-B — לפני לקוח משלם:** GATE-A + LR-01, מסמכי מס/חוזים תקפים, תנאי שירות/ביטול ותמיכה, accessibility applicability, incident deputy.
**GATE-C — לפני שיווק:** LR-12 מאומת במלואו.
**GATE-D — לפני חיוב אוטומטי:** LR-13 מאומת במלואו.
**GATE-E — לפני עסקים טיפוליים/קטינים:** LR-06/15 וסקירה משפטית מחודשת.
**CLOSED** רק אם כל acceptance criteria, בדיקות, ראיות, אישורי בעלים/עו"ד ו-risk register הושלמו. פריט חסום נשאר OPEN/BLOCKED גם אם הקוד הושלם.

## 7. תיק ראיות והעברה לעורך דין
תוצרים: (1) מפת נתונים ומאגרים, (2) טבלת roles/controller/processor, (3) חוזה SaaS + תנאי לקוח + פרטיות + DPA + cookies + נגישות, (4) מרשם ספקים עם הסכמים בפועל, (5) דו"ח סיווג/הודעה/רישום/DPO/העברה, (6) דוח אבטחה ותוצאות בדיקות, (7) תרגיל שחזור, (8) תרגיל אירוע, (9) נגישות ידנית, (10) log החלטות והצהרת סיכון שיורי, (11) הוכחת רישום עסק ומיסוי בעת השלמה.
לכל מסמך: version, date, legal reviewer, approved-by, approval date, scope, unresolved clauses, public release hash.

## 8. מקורות ראשיים ומסמכי ליווי
- חוק הגנת הפרטיות ותיקון 13: https://www.gov.il/he/pages/tikun13_qa
- חובת הודעה: https://www.gov.il/he/service/notice-obligation
- אירועי אבטחה: https://www.gov.il/he/pages/reporting_security_breach
- נגישות שירותי אינטרנט: https://www.gov.il/he/pages/website_accessibility
- Vercel DPA: https://vercel.com/legal/dpa
- מסמכי PR זה: `docs/legal/2026-11-regulatory-assessment.md`, `docs/legal/2026-11-vendor-contract-review.md`, `docs/runbooks/legal-security-incident-2026-11.md`.
- מקור ממצאים: LR-01–LR-18 בדוח הבדיקה מ-2026-11-11; GitHub issues #61–#79.

## 9. Known unknowns — אסור להסתיר
1. חשבון Vercel האמיתי של Tori, מסלול, DPA ו-logs.
2. Resend DPA ברמת החשבון ו-retention.
3. Supabase DPA לפי הארגון, backup/log regions והסכמי משנה.
4. מספר נושאי מידע, מורשי גישה, מידע רגיש ותפקידים בפועל.
5. זכאות לפטור נגישות, בדיקה ידנית של האתר החי.
6. תוצאות restore drill ויכולת re-delete.
7. אישור עו"ד ישראלי לנוסח חוזים ולסיווג רגולטורי.
8. פרטי עוסק פטור — צפויים בינואר 2027.
9. סטטוס שיווק/חיוב בזמן אמת, מחזור עסקי ותכולת לקוחות.
10. תוצאות סריקות אבטחה/בדיקות E2E עדכניות לפריסה הפעילה.

**הצהרת סיום:** מסמך זה הוא מפרט ביצוע, לא תעודת ציות. אין לסגור אף סיכון רק משום שמסמך זה הועלה ל-GitHub.
