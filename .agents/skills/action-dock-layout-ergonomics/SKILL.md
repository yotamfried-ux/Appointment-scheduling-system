---
name: action-dock-layout-ergonomics
description: >-
  Frontend layout and accessibility engineering protocol for sticky bottom action bars,
  error banner container isolation, button height parity (h-11), and guidance checklist styling.
  Use whenever creating or modifying bottom action bars, multi-step navigation controls, or post-action done screens.
---

# Action Dock & Bottom Bar Ergonomics

פרוטוקול הנדסי ו-UX לבניית שורות פעולה צפות (Sticky Bottom Bars / Action Docks), יישור כפתורים, ומניעת עיוותי פריסה כתוצאה מהודעות שגיאה אסינכרוניות.

## 1. ארכיטקטורת המכולה ובידוד באנרים (Banner Isolation)
- **האיסור**: לעולם אין להטמיע הודעת שגיאה אסינכרונית (`saveError`) בתוך עטיפת ה-flex/grid של כפתור יחיד (למשל wrapper משותף שמחזיק את השגיאה מעל כפתור ה"המשך"). הדבר גורם ל-`items-center` ליישר את כפתור ה"חזרה" כנגד הגובה הכולל של כפתור ההמשך + הודעת השגיאה יחד, וכתוצאה מכך כפתור ה"חזרה" מרחף באמצע ואינו מיושר לתחתית או לקו הבסיס.
- **הארכיטקטורה התקנית**:
  הודעת השגיאה חייבת לשבת בשורה עצמאית מלאה **מעל** שורת הכפתורים:
  ```tsx
  <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur">
    <div className="mx-auto max-w-xl px-4 py-3">
      {/* 1. שורת שגיאה עצמאית וממורכזת */}
      {saveError ? (
        <p role="alert" data-testid="save-error" className="mb-2 text-center text-sm font-medium text-destructive">
          {saveError}
        </p>
      ) : null}

      {/* 2. שורת כפתורים נקייה שבה כל הכפתורים הם direct flex children */}
      <div className="flex items-center gap-3">
        {hasBack ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-11 shrink-0"
            onClick={onBack}
            aria-label={t("actions.back")}
          >
            <ArrowRight aria-hidden />
            <span className="hidden sm:inline">{t("actions.back")}</span>
          </Button>
        ) : null}

        <Button
          type="button"
          size="lg"
          className="h-11 min-w-0 flex-1"
          disabled={saving}
          onClick={next}
        >
          {saving ? t("actions.saving") : t("actions.continue")}
        </Button>
      </div>
    </div>
  </div>
  ```

## 2. שוויון גובה ויישור פיזי (Height & Baseline Parity)
- **גובה אחיד מפורש**: כל הכפתורים באותה שורת פעולה חייבים להגדיר גובה מפורש תואם (`h-11` = 44px, אזור מגע תקני לנגישות מובייל WCAG 2.5.5). אין להסתמך על ריפוד טקסט שמשתנה כשיש אייקון בלבד.
- **יישור מרכז משותף**: השתמש ב-`items-center` על מכולת הכפתורים הראשית כדי להבטיח שקו הבסיס והגובה זהים לחלוטין.
- **קריסה רספונסיבית של טקסט (Responsive Label Collapsing)**: כאשר טקסט הכפתור מוסתר במסכי מובייל (`<span className="hidden sm:inline">חזרה</span>`):
  1. הכפתור חייב להישאר בגובה `h-11`.
  2. יש לשמור על ריפוד מגע מתאים (`px-4` או `has-[>svg]:px-4`).
  3. חובה להגדיר `aria-label` מפורש (למשל `aria-label={t("actions.back")}`) לקוראי מסך.

## 3. הבחנה בין סטיפר שלבים (Stepper) לבין טיפים לאחר סיום (Recommendations)
- **סטיפר תהליך (Wizard Stepper)**: מציג שלב נוכחי מול שלבים עתידיים, ולכן שלב פעיל מקבל הדגשה (`bg-primary`) ושלבים עתידיים מעומעמים (`text-muted-foreground`).
- **כרטיס טיפים והמלצות (Done / Next Steps)**:
  - **האיסור**: לעולם אין לסמן את סעיף 1 בלבד בירוק/בולט כאילו מדובר בשלב שלא הושלם או בשלב שמוביל לדשבורד. הדבר יוצר בלבול אצל המשתמש שחושב שלחיצה על הדשבורד תוביל לשלבים 2 ו-3.
  - **הפתרון**: כל הסעיפים הם המלצות בעלות משקל שווה, ויקבלו עיצוב תגית אחיד, קריא ורך:
    ```tsx
    <ul className="divide-y rounded-lg border bg-card">
      {["n1", "n2", "n3"].map((k, i) => (
        <li key={k} className="flex items-center gap-3 px-4 py-3.5">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-xs font-bold text-primary">
            {i + 1}
          </span>
          <span className="text-sm font-medium text-foreground">{t(`done.${k}`)}</span>
        </li>
      ))}
    </ul>
    ```
