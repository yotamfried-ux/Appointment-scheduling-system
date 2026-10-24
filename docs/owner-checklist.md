# מה בעל המערכת צריך לעשות בעצמו (24.10.2026)

כל מה שכאן דורש כניסה של בעל החשבון ללוחות הבקרה של השירותים. אני לא יכול לעשות אותם בשמך, כי אין לי הרשאה לשנות הגדרות Auth ב-Supabase, DNS אצל הרשם או סודות ב-GitHub. לכל סעיף: למה, איפה, איך, ואיך בודקים שהצליח.

## 1. מיילי הרשמה ואימות (Supabase + Resend)
**למה:** בלי זה המיילים נשלחים בשם "Supabase Auth" באנגלית והקישור פג מהר.
**איפה:** [supabase.com/dashboard](https://supabase.com/dashboard) → הפרויקט `abhadytskhgwkrlmceew`.

1. **תוקף הקישור לשעה:** Authentication → Sign In / Providers → Email → שדה "Email OTP expiration" → `3600` → Save.
2. **שולח מייל מותאם (Resend):**
   - ב-[resend.com](https://resend.com): Domains → הדומיין `mail.d2ryf.com` צריך להיות במצב Verified (אם לא, מוסיפים אותו ומעתיקים את רשומות ה-DNS שמוצגות לשם אצל הרשם של `d2ryf.com`).
   - API Keys → Create API Key → הרשאה "Sending access" → מעתיקים את המפתח (מוצג פעם אחת).
   - בחזרה ב-Supabase: Authentication → Emails → SMTP Settings → מפעילים Custom SMTP: Host `smtp.resend.com`, Port `465`, Username `resend`, Password = מפתח ה-API, Sender email `noreply@mail.d2ryf.com`, Sender name `תורים`. שומרים.
3. **תבניות בעברית:** Authentication → Emails → Templates. לכל אחת מ-6 התבניות (Confirm sign up, Magic link, Change email address, Invite user, Reset password, Reauthentication): מדביקים את קובץ ה-HTML המתאים מהתיקייה `supabase/templates` במאגר (`confirmation`, `magic_link`, `email_change`, `invite`, `recovery`, `reauthentication`), ואת הנושא מהקובץ `supabase/config.toml` (השורות `subject`).
4. **כתובת האתר:** Authentication → URL Configuration → Site URL = `https://turim.d2ryf.com`. ב-Redirect URLs רק הדומיין הזה.
5. **בדיקה:** נרשמים עם כתובת חדשה. המייל צריך להגיע בעברית מ-"תורים", הכפתור "אימות והמשך" עובד, ואחרי שעה הקישור מציג "הקישור כבר לא תקף" עם טופס לבקשת קישור חדש.

## 2. הגנה מסיסמאות שדלפו (דקה)
**איפה:** Supabase → Authentication → Sign In / Providers → Password security (בחלק מהתצוגות: Attack Protection) → מפעילים "Prevent use of leaked passwords". דורש תוכנית Pro, והארגון כבר ב-Pro.

## 3. משימות מתוזמנות (תזכורות, תור המתנה, שליחת מיילים)
**למה:** בלעדיהן תזכורות ומיילי אישור תור לא יישלחו בזמן.
1. ב-Vercel: Project → Settings → Environment Variables → מוודאים שקיים משתנה `CRON_SECRET` בסביבת Production. אם אין, יוצרים ערך אקראי ארוך.
2. ב-GitHub: המאגר → Settings → Secrets and variables → Actions → New repository secret → שם `CRON_SECRET` → **אותו ערך** כמו ב-Vercel.
3. Actions → "jobs" → Run workflow לבדיקה. הצלחה: כל השלבים ירוקים. הערה: ב-Vercel Hobby אי אפשר להריץ cron בתדירות גבוהה, ולכן ה-workflow של GitHub הוא זה שמריץ אותן כל 5 דקות.

## 4. מיגרציה 46 בפרודקשן
**למה:** זהות הלקוח לפי אימייל (במקום טלפון) קיימת בקוד אבל לא במסד הנתונים של הפרודקשן. עד שתרוץ, הזמנה חדשה עם אימייל לא תעבוד נכון בפרודקשן. כתוב לי "תריץ מיגרציה 46" ואני מריץ, אחרי גיבוי.

## 5. הדומיין: DMARC (מניעת התחזות למיילים שלך)
**איפה:** אצל הרשם של `d2ryf.com` (או ב-Vercel → Domains אם ה-DNS שם). מוסיפים רשומת TXT: שם `_dmarc`, ערך `v=DMARC1; p=none; rua=mailto:<תיבת הדוא"ל של D2R>`. אחרי כמה שבועות בלי בעיות אפשר להקשיח ל-`p=quarantine`.

## 6. פרסום העסק שלך לבדיקה
בדשבורד של העסק לוחצים "פרסום הקישור". עסקים שייווצרו אחרי שאמזג את PR 31 יתפרסמו לבד.

## 7. הגדרות Vercel
1. ב-Vercel → Settings → Environment Variables: `NEXT_PUBLIC_LEGAL_CONTACT` ו-`NEXT_PUBLIC_A11Y_CONTACT` = כתובת הדוא"ל של D2R (Production ו-Preview). כרגע הן placeholder.
2. לוודא ש-Preview לא מחובר למסד הנתונים של הפרודקשן: באותה רשימה, `NEXT_PUBLIC_SUPABASE_URL` בסביבת Preview צריך להצביע על פרויקט הבדיקה ולא על `abhadytskhgwkrlmceew`.

## 8. חשבון מנהל פלטפורמה (אופציונלי)
נותן גישה לממשק המפעיל (השהיית עסק). ההוראות ב-`docs/runbooks/abuse.md`. אפשר לדלג לפיילוט.

## 9. מסלול לעסק של אמא
אחרי שתיצור את חשבון העסק שלה: ב-Supabase → SQL Editor, לפי `docs/runbooks/billing.md` (סעיף הענקת מסלול). כל עסק חדש מתחיל בניסיון חינם של 14 יום במסלול המלא, ואחריו העסק מפסיק לקבל תורים עד שמוענק מסלול.

## 10. משפטי
1. ב-`docs/legal/legal-owner-approval.md` להוסיף את שמך המלא ואת משפט האישור (מתווסף לטקסט שכבר שם).
2. לקרוא את `docs/legal/breach-and-liability-brief.md` ולקבוע שיחה עם עורך דין או יועץ פרטיות.
3. אישור תנאי עיבוד המידע של Supabase, Vercel ו-Resend בלוחות הבקרה שלהם ורישום התאריך ב-`docs/legal/processors-and-transfers.md`.
4. לפתוח עוסק (פטור או מורשה) ולתת לי את הפרטים להוספה לבלוק המפעיל בתנאים ובמדיניות.
