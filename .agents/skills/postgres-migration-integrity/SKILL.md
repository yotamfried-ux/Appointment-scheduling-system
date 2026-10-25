---
name: postgres-migration-integrity
description: >-
  Pre-flight validation protocol for PostgreSQL and Supabase PL/pgSQL migrations,
  stored procedure dependencies, atomic schema changes, and error code mapping.
  Use whenever creating, editing, or applying database migrations and RPC functions.
---

# PostgreSQL Migration Integrity & Dependency Guard

פרוטוקול הנדסי קפדני למניעת שגיאות זמן-ריצה במיגרציות מסד נתונים, פונקציות `security definer`, ותלויות בין פרוצדורות ב-PostgreSQL ו-Supabase.

## עקרונות ברזל (Core Invariants)

### 1. אימות תלויות מוקדם (Dependency Audit Before Authoring)
- **האיסור**: לעולם אין לקרוא לפונקציה פנימית (`private.*`) או פונקציית עזר על סמך הזיכרון.
- **הנוהל**:
  1. יש לסרוק את קובצי המיגרציה הקודמים ב-`supabase/migrations/` או לתשאל ישירות את קטלוג מסד הנתונים (`pg_proc`, `information_schema.routines`) כדי לאמת את השם המדויק, ה-schema, וסוגי הפרמטרים של הפונקציה הנקראת.
  2. יש לוודא שטבלאות, עמודות ואינדקסים שהפונקציה מסתמכת עליהם כבר קיימים או מוגדרים מוקדם יותר באותה מיגרציה.
  3. **דוגמה לתקלה שנמנעת**: קריאה ל-`private.second_factor_satisfied()` כאשר הפונקציה הוגדרה בשם `private.second_factor_ok()` – שגרמה לקריסת שלב שמירת השעות באונבורדינג.

### 2. תאימות לאחור וכינויים בטוחים (Safe Aliasing & Evolution)
- כאשר משנים שם של פונקציה פנימית, מיישרים קו עם קונבנציה חדשה, או מרחיבים חתימת פרמטרים:
  - **פונקציית כינוי (Alias)**: יש ליצור פונקציית עטיפה בעלת השם הישן המפנה לשם החדש עם אותן הרשאות (`security definer` / `search_path = ''`), למשל:
    ```sql
    create or replace function private.second_factor_satisfied()
    returns boolean language sql security definer set search_path = '' as $$
      select private.second_factor_ok();
    $$;
    ```
  - **הרשאות אחידות**: יש לוודא שההרשאות (`grant execute`, `revoke all`) של פונקציית הכינוי זהות לחלוטין לפונקציה המקורית.

### 3. הרצה מבודדת וסימולציית Dry-Run לפני מיזוג
- לפני דחיפת מיגרציה ל-Git או פריסתה בייצור, חובה להריץ סימולציה מקיפה:
  - **בלוק אנונימי (DO block with Rollback)**:
    ```sql
    do $$
    declare
      v_test record;
    begin
      -- הדמיית קריאה עם ערכי דמה ובדיקת חריגות
      perform private.my_function(...);
    end $$;
    ```
  - **בדיקות pgTAP או בדיקות שילוב**: אימות שכל נתיב קוד (הצלחה, שגיאת אימות, שגיאת הרשאה) נבדק בפועל.

### 4. זריקת שגיאות ומיפוי אפליקטיבי אטום (Error Encapsulation)
- **במסד הנתונים**: שגיאות לוגיות יש לזרוק עם SQLSTATE `P0001` תקני ומחרוזת שגיאה תמציתית באותיות קטנות:
  ```sql
  if exists (...) then
    raise exception 'business_name_taken' using errcode = 'P0001';
  end if;
  ```
- **יירוט Unique Violations**: בלוק `exception when unique_violation then` יבדוק את שם האינדקס (`sqlerrm`) כדי לזרוק שגיאה סמנטית ברורה במקום שגיאה גנרית:
  ```sql
  exception when unique_violation then
    if sqlerrm like '%businesses_owner_name_key%' then
      raise exception 'business_name_taken' using errcode = 'P0001';
    end if;
    raise exception 'slug_taken' using errcode = 'P0001';
  end;
  ```
- **בשכבת ה-Service**: פונקציית `mapRpcError` ממפה את השגיאה לקוד אפליקטיבי יציב (`BUSINESS_NAME_TAKEN`) המציג הודעה בעברית בממשק, ולעולם אינה מדליפה למשתמש שמות טבלאות או שגיאות SQL פנימיות.
