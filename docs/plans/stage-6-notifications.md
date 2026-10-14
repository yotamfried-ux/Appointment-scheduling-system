# Route Plan — שלב 6: התראות (אימייל בלבד) + Jobs

Task type: feature · Class: security_sensitive (PII, ספק חיצוני, webhook חתום, cron) · Branch: `claude/optimistic-hypatia-wh3zo3`

## תרחישים (docs/04)
**NTF-01** (פעם אחת בדיוק, גם בהרצה כפולה/מקבילה) · NTF-02 (הוזמן בתוך חלון התזכורת — דילוג מוגדר) · **NTF-03** (check-before-send: בוטל/נדחה ⇒ לא נשלח) · **NTF-04** (ספק נופל: retry+backoff → DLQ → התראה לבעלים, ההזמנה לא מושפעת) · NTF-05 (bounce/complaint ⇒ suppression, webhook חתום) · NTF-06 (אין אימייל ⇒ דילוג מתועד) · NTF-08 (עברית/RTL, escape) · NTF-12 (`provider_message_id`) · OPS-05 (job פעמיים/חופף) · OPS-06 (cron: לא מובטח בתכנית — מתועד) · docs/05 §2 (פרטיות: אין שם שירות בנושא; אין טוקן בנושא).

## החלטות עיצוב
- **Outbox → `notification_log` → שליחה.** האירוע (`domain_events`) נכתב בטרנזקציה של השינוי; ה-runner מפרק אותו לשורות `notification_log` עם `unique(appointment_id, type)` (אידמפוטנטי), ואז שולח. כשל באמצע = ניסיון חוזר בלי כפילות.
- **Port + adapters:** `EmailPort` ← `ResendAdapter` (REST ישיר, `Idempotency-Key` = מזהה השורה, 429/5xx/409-concurrent ⇒ transient, שאר 4xx ⇒ permanent) ו-`FakeAdapter` (dev/CI בלבד; כתובות `+fail5xx` / `+failonce` / `+bounce` לצורך הזרקת כשלים). Production בלי מפתח ⇒ נכשל סגור.
- **Claim עם `FOR UPDATE SKIP LOCKED` + lease** (worker שקרס — השורה חוזרת אחרי 5 דק'); backoff מעריכי; אחרי 6 ניסיונות ⇒ `dead` והבעלים רואה באנר ביומן.
- **בדיקה לפני שליחה:** תזכורת רק לתור `confirmed` עתידי; "אושר" רק אם עדיין מאושר; ביטול/דחייה רק אם התור באמת בוטל.
- **תזכורות:** job כל 15 דק' (`run_key` לפי דלי זמן), חלון 24h→2h; תור שהוזמן בתוך החלון — `skipped:late_booking` (אישור ההזמנה כבר מכיל את השעה); אין אימייל — `skipped:no_email`.
- **כתובות לא נשמרות ביומן:** רק `to_hash` (HMAC); suppression לפי hash. `preview` (גוף ההודעה) נשמר **רק** ע"י ה-Fake adapter.
- **Webhook (Resend/Svix):** אימות חתימה ידני (HMAC-SHA256 על `id.timestamp.body`, סובלנות 5 דק', השוואה בזמן קבוע), גוף גולמי; רק `email.bounced` (Permanent) ו-`email.complained` יוצרים suppression.
- **Cron:** `Authorization: Bearer $CRON_SECRET`, השוואה בזמן קבוע, בלי סוד ⇒ 503 (נכשל סגור).
- בקשת הזמנה/ביטול מפעילה "בעיטה" (`after()`) כדי שהאימייל לא יחכה ל-cron; ה-cron הוא רשת הביטחון.

## מחוץ להיקף
React Email (תבניות פונקציונליות עם escape — מתועד) · re-engagement/סיכומים לבעלים (NTF-09/10/11) · WhatsApp/SMS (D1) · שדה אימייל בטופס תור ידני · דומיין שולח/SPF/DKIM/DMARC (דורש דומיין) · פקיעת בקשות אישור.

## אימות
pgTAP (חד-פעמיות, claim/lease/backoff, הרשאות, תזכורות, suppression, RLS) · unit (תבניות/פרטיות/escape, Svix מול ספריית svix, מיפוי שגיאות Resend, מתכנן אירועים) · E2E אמיתי: הזמנה→אימייל, 5 runners מקבילים = הודעה אחת, הזרקת כשלים (5xx→retry→dead→באנר), bounce→suppression→דילוג, webhook מזויף/ישן נדחה, בדיקת cron auth, ביטול אחרי תזמון · CI.
