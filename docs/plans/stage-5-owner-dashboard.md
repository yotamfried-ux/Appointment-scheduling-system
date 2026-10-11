# Route Plan — שלב 5: דשבורד בעלים, יומן, תיבת אישורים, תורים ידניים

Task type: feature · Class: security_sensitive (הרשאות בעלים, מעבר מצבים, PII לקוחות) · Branch: `claude/optimistic-hypatia-wh3zo3`

## תרחישים (docs/04)
BKG-09 (אישור ידני — צד הבעלים) · **AVL-09/AVL-10 (תור ידני מחוץ לזמינות / ברגע האחרון — מותר לבעלים, מסומן)** · CXL (אישור/דחיית בקשת ביטול; ביטול ע"י בעלים) · מכונת מצבים: approve/reject/cancel/complete/no_show · SEC-01 (בידוד דיירים) · SEC-05 (CSRF) · MFA (aal2) · סימולציית דנה (יום עבודה של בעלת עסק).

## החלטות עיצוב
- **הבעלים עובד דרך RLS, לא דרך מפתח המערכת.** קריאת יומן = `select` על `appointments`+`customers` עם ה-JWT של המשתמש (`is_member(...,'staff')`). הכתיבה = RPC-ים עם `security invoker` שעוטפים `private.*_impl` (definer) ובודקים חברות בעסק.
- העסק נגזר מהסשן (חברות ראשונה), **לעולם לא מהבקשה**.
- תור ידני: `source='manual'`, `out_of_availability` מחושב בשרת (TS מכיר את השעות), לא מהלקוח. החפיפה נחסמת תמיד ע"י EXCLUDE (גם לבעלים). ניתן עד 24 שעות אחורה (תיעוד אחר-כך).
- `complete`/`no_show` רק אחרי שהתור התחיל (DB). אין "לא הגיע" על תור עתידי.
- API: `/api/owner/appointments` (GET ?date, POST) ו-`/api/owner/appointments/[id]/transition`. Zod בכל גבול, `Origin` חייב להתאים ל-host (CSRF), aal2 נדרש, שגיאות עקביות (`UNAUTHENTICATED` 401, `FORBIDDEN` 403).
- UI: אותם רכיבי lab (StatStrip, TimeRibbon, DaySchedule, ApprovalsPanel) על נתונים אמיתיים; ניווט יום, חלון "תור חדש", פעולות שורה. עדכון אופטימי עם rollback.

## מחוץ להיקף
התראות/מיילים לבעלים (שלב 6) · פקיעת בקשות אישור (job, שלב 6) · רשימת המתנה (7) · עריכת/הזזת תור · צוות מרובה · דוחות (8).

## אימות
pgTAP (תור ידני: הרשאות/חפיפה/דגל, complete/no_show רק אחרי התחלה, בידוד) · unit (טווח יום ב-DST, reducer) · E2E API אמיתי (401, CSRF, בידוד, 409, מעברים כפולים) · E2E דפדפן "דנה": אישור/דחייה/ידני/סיום/לא הגיע + שחרור סלוט לציבור · ויזואלי 360/1280 + צילומי מסך · CI.
