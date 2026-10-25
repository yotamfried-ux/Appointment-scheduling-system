---
name: multi-tenant-onboarding-integrity
description: >-
  Standardized protocol for multi-tenant onboarding, tenant-scoped entity uniqueness,
  explicit URL slug generation without silent mutative fallbacks, and atomic provisioning.
  Use whenever designing, modifying, or auditing onboarding flows, business creation, or slug logic.
---

# Multi-Tenant Onboarding & Entity Integrity Protocol

פרוטוקול הנדסי למערכות SaaS מרובות דיירים (Multi-Tenant) המבטיח שלמות נתונים, מניעת כפילויות, ושקיפות מלאה בבחירת מזהי URL וסלאגים.

## 1. ייחודיות ישויות ברמת הבעלים (Tenant-Scoped Entity Uniqueness)
- **האיסור**: אסור לאפשר לאותו משתמש/בעלים ליצור שתי ישויות (כגון עסקים, סניפים, צוותים) בעלות שם זהה (`lower(btrim(name))`). כפילות כזו יוצרת בלבול חמור בתפריטי הבחירה, בחשבוניות ובהודעות.
- **אכיפה דו-שכבתית חובה**:
  1. **ברמת מסד הנתונים**: אינדקס ייחודי מפורש:
     ```sql
     create unique index businesses_owner_name_key on public.businesses (created_by, lower(btrim(name)));
     ```
  2. **ברמת ה-RPC**: בדיקה מקדימה ב-PL/pgSQL שזורקת שגיאה סמנטית:
     ```sql
     if exists (
       select 1 from public.business_members bm
       join public.businesses b on b.id = bm.business_id
       where bm.user_id = v_uid and lower(btrim(b.name)) = lower(btrim(p_name))
     ) then
       raise exception 'business_name_taken' using errcode = 'P0001';
     end if;
     ```

## 2. איסור על שינוי סלאג שקט (No Silent Slug Mutation)
- **העיקרון**: אם המשתמש הזין סלאג מותאם אישית (Custom Slug), או שהסלאג הוצג למשתמש במסך העריכה והמשתמש המשיך איתו – **אסור למערכת לשרשר אוטומטית `-2`, `-3` ברקע**.
- **דוגמה לתקלה שנמנעת**: משתמש ביצע אונבורדינג מחדש עם שם קיים, והמערכת יצרה לו סלאג `kvsmtykh-2` במקום להודיע לו שהשם/סלאג תפוס.
- **מימוש נכון ב-Service Layer**:
  ```ts
  // אם סופק סלאג מפורש, מנסים אך ורק אותו! אין fallback שקט למספרים.
  const candidates = input.slug ? [input.slug] : slugCandidates(input.name, Math.random);
  for (const slug of candidates) {
    const { data, error } = await supabase.rpc("create_business", { ... });
    if (!error) return { ok: true, value: data };
    const code = mapRpcError(error);
    // אם זו שגיאה של שם עסק תפוס או שנגמרו המועמדים - עוצרים מיד!
    if (code !== "SLUG_TAKEN") return { ok: false, code };
  }
  return { ok: false, code: "SLUG_TAKEN" };
  ```
- **חוויית משתמש (UX)**: כאשר סלאג תפוס, מחזירים `SLUG_TAKEN` ומציגים הודעה ברורה: *"לא מצאנו כתובת פנויה לשם הזה. נסו שם מעט שונה."*

## 3. טרנזקציונליות מלאה של האונבורדינג (Atomic Provisioning)
- כל תהליך ההקמה הראשוני:
  1. יצירת רשומת העסק (`businesses`)
  2. רישום הבעלים בטבלת החברים (`business_members` עם תפקיד `owner`)
  3. יצירת משאב ברירת מחדל (`resources`)
  4. כתיבת קטלוג שירותים ראשוני (`services`)
  5. כתיבת חלונות זמינות שבועיים (`availability_rules`)
  6. רישום אירועי ביקורת ואאוטבוקס (`audit_log`, `domain_events`)
- **חייב להתבצע בטרנזקציה אטומית אחת בלבד במסד הנתונים**. אם חלק כלשהו נכשל, כל הפעולה מתגלגלת לאחור (Rollback) באופן מלא – אין להשאיר רשומות יתומות או חלקיות.

## 4. נוהל מחיקה וניקוי ישויות כפולות
- בעת צורך בניקוי ישות כפולה או מחיקת חשבון:
  - יש לוודא שמופעל `ON DELETE CASCADE` על כל הטבלאות הבנות, או להשתמש בפונקציית מחיקה מורשית (`purge_deleted_businesses_impl`).
  - לעולם אין להשאיר רשומות תלויות יתומות שעלולות לחסום אינדקסים ייחודיים בעתיד.
