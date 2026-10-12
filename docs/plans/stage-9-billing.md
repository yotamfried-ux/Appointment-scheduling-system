# Route Plan — שלב 9: מנויי SaaS (Billing) + Entitlements — עם ספק חיוב "פלאג-אין"

Task type: feature · Class: security_sensitive (מצב מנוי = שלמות קריטית) · Branch: `claude/optimistic-hypatia-wh3zo3`

## הנחיית הבעלים
הספק עדיין לא נבחר ⇒ החיבור נבנה כ-**plug-in**: ליבה ניטרלית-לספק + `BillingPort`. בחירת ספק בעתיד = adapter אחד (תרגום checkout / portal / webhook ל-`NormalizedEvent`), בלי נגיעה בסכמה, ב-entitlements או ב-UI. נשלחים עכשיו שני adapters: **`fake`** (בדיקות ופיתוח: דף checkout מדומה + webhook חתום) ו-**`manual`** (אין ספק: חיוב מחוץ למערכת, מצב המנוי מוגדר ע"י מנהל פלטפורמה).

## תרחישים (docs/04)
**BIL-01** ניסיון → סיום ⇒ מצב **degraded** (קריאה/ניהול של מה שקיים; אין הזמנות חדשות; לא מוחקים) · **BIL-02** `past_due` + grace · **BIL-03** webhook כפול / הפוך / חתימה שגויה · **BIL-04** המצב נקבע רק מ-webhook, "מעבד את התשלום…" · **BIL-05** שדרוג/הורדה, "מעל המכסה" ≠ מחיקה · **BIL-06** ביטול = פעיל עד סוף התקופה · **BIL-08** פיצ'ר נעלם ⇒ נתונים נשמרים, 402 אחיד, upsell · **BIL-09** override עם reason/expires_at/audit · BIL-11 (טבלאות לא קשורות לספק) · BKG-11 (`acceptingBookings` נגזר מ-entitlements) · SEC-10 (עקרון: override נרשם, דורש מנהל פלטפורמה + MFA).

## מודל נתונים (ניטרלי לספק)
`plans` (id, name, מחיר/מחזור — **placeholder** לעריכה, `version`) · `plan_features` (plan, key, bool/int) · `subscriptions` (business UNIQUE, `plan_id`, `status` trialing|active|past_due|canceled, `trial_ends_at`, `current_period_end`, `cancel_at_period_end`, `grace_until`, `provider`, `external_customer_id`, `external_subscription_id`, `last_event_at`) · `billing_events` (UNIQUE `(provider, event_id)`, `occurred_at`, `outcome`) · `entitlement_overrides` (business, key, ערך, `reason` חובה, `expires_at`, actor) · `platform_admins`.
מפתחות: `waitlist` (bool) · `export` (bool) · `max_services` (int, NULL = ללא הגבלה).

## מצב אפקטיבי (פונקציה אחת ב-SQL, מקור אמת יחיד)
`trial` (trialing ∧ לפני `trial_ends_at`) · `active` · `grace` (past_due ∧ לפני `grace_until`, 7 ימים) · `degraded` (ניסיון שפג / grace שפג / בוטל אחרי סוף התקופה). `can()` / `limit()` קוראים רק מכאן; override תקף גובר.
**מדיניות degraded (המלצת docs/04 §342, החלטה D22):** הזמנות חדשות מכל מקור נחסמות (טריגר על INSERT לתורים), ההזמנה הציבורית מציגה "העסק אינו מקבל כרגע תורים" + פרטי קשר, **תורים קיימים ממשיכים כרגיל** (תזכורות, אישור/ביטול/השלמה) — לא מענישים לקוחות קצה על חוב של העסק.

## אכיפה (בבסיס הנתונים, לא רק ב-UI)
טריגרים: INSERT לתורים (`billing_inactive`) · INSERT לרשימת המתנה (`plan_required`) · INSERT לשירותים מעל המכסה (`plan_limit`). הצעת המתנה אוטומטית ו-`waitlistEnabled` הציבורי נגזרים מ-`can('waitlist')`. ייצוא דורש `can('export')`. ה-API ממפה ל-**402 `PAYMENT_REQUIRED`** אחיד; ציבורי ⇒ 409 `BOOKINGS_CLOSED`.

## Webhook (מקור אמת)
`POST /api/webhooks/billing/[provider]`: גוף גולמי ⇒ `adapter.parseWebhook` מאמת חתימה (HMAC, קבוע-זמן, חלון זמן) ומחזיר `NormalizedEvent[]` ⇒ RPC `billing_apply_event` (service role בלבד): idempotent לפי `(provider,event_id)`, **סדר לפי `occurred_at`** (ישן מ-`last_event_at` נרשם כ-`stale` ולא משנה), עסק לא מוכר ⇒ `unknown_business` (200, לא נחשף), audit. `/checkout` ו-`/redirect` **לא** משנים מצב.

## UI
`/settings/billing`: מצב, ימי ניסיון, חבילות (עם upgrade/downgrade), שימוש מול מכסות, "מעבד את התשלום…" (BIL-04), ביטול/פורטל דרך ה-port. באנר בדשבורד (ניסיון ≤7 ימים / `past_due` / degraded). Upsell במקום פיצ'ר חסום. דף ציבורי סגור כשאין קבלת הזמנות. דף fake-checkout (לא בפרודקשן).

## מחוץ להיקף / פתוח
בחירת ספק חיוב, חשבוניות/מע"מ (`InvoicePort`, BIL-10), קופונים בספק, **אימייל T-7/T-1 ו-dunning** (כרגע באנר בלבד), UI ל-back-office (קיימים: טבלת מנהלי פלטפורמה + API/RPC ל-override עם MFA), תשלום לקוחות קצה (BIL-12), grandfathering מלא (BIL-07: `version` נשמר בלבד), פרו-ראטה (בספק).

## אימות
pgTAP (מצבים, can/limit, override פג תוקף, אירועים: כפול/הפוך/לא-מוכר, טריגרי אכיפה, RLS והרשאות) · unit (adapter fake: חתימה, חלון זמן, נרמול; contracts) · E2E (webhook חתום: כפול/הפוך/שגוי; פקיעת ניסיון ⇒ הזמנה ציבורית נסגרת, תורים קיימים נשארים; 402; downgrade מעל מכסה; זרימת checkout דרך ה-UI; ויזואלי 360/1280) · CI.
