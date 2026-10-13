import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Persona "דנה" setting up her salon in under five minutes. Scenarios: ACC-03, ACC-06, ACC-08, CAT-01, AVL-01/05.
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test.describe("design lab · onboarding wizard", () => {
  test("complete setup with validation, accessibility and layout checks at every step", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => (m.type() === "error" ? errors.push(m.text()) : undefined));
    await page.goto("/design/onboarding");
    const h1 = page.getByRole("heading", { level: 1 });

    // 1 · business: validation blocks, then the link preview is a safe ASCII slug
    await expect(h1).toHaveText("ספרו לנו על העסק");
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
    await page.getByTestId("continue").click();
    await expect(page.getByText("יש להזין שם (לפחות 2 תווים).")).toBeVisible();
    await expect(page.getByLabel("שם העסק")).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("שם העסק").fill("מספרת הדר");
    await page.getByLabel("טלפון ליצירת קשר").fill("050-12");
    await page.getByTestId("continue").click();
    await expect(page.getByText("מספר הטלפון אינו תקין.")).toBeVisible();
    await page.getByLabel("טלפון ליצירת קשר").fill("050-1234567");
    await expect(page.getByTestId("link-preview")).toHaveText(/^tori\.example\/book\/[a-z0-9-]+$/);
    await page.getByTestId("continue").click();

    // 2 · services: pre-filled from the business kind; a removed one comes back as a suggestion; a price is required
    await expect(h1).toHaveText("מה אתם מציעים?");
    await expect(h1).toBeFocused();
    await expect(page.getByTestId("service-row-0").getByLabel("שם השירות")).toHaveValue("תספורת גברים");
    await page.getByRole("button", { name: "הסרת השירות 2" }).click();
    await page.getByRole("button", { name: "צבע שיער" }).click();
    await expect(page.getByLabel("שם השירות").last()).toHaveValue("צבע שיער");
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
    await page.getByTestId("service-row-0").getByLabel("מחיר (₪)").fill("0");
    await page.getByTestId("continue").click();
    await expect(page.getByText("יש להזין מחיר גדול מאפס.")).toBeVisible();
    await page.getByTestId("service-row-0").getByLabel("מחיר (₪)").fill("85");
    await page.getByTestId("continue").click();

    // 3 · hours: an inverted range is explained and blocks; the ribbon previews the open window
    await expect(h1).toHaveText("מתי אתם פתוחים?");
    await expect(page.getByTestId("hours-0").getByRole("img")).toHaveAttribute("aria-label", /09:00–18:00/);
    await page.getByLabel("משעה ראשון").selectOption("19:00");
    await expect(page.getByTestId("hours-0").getByText("שעת הסיום חייבת להיות אחרי שעת ההתחלה.")).toBeVisible();
    await page.getByTestId("continue").click();
    await expect(h1).toHaveText("מתי אתם פתוחים?"); // did not advance
    await page.getByLabel("משעה ראשון").selectOption("09:00");
    await page.getByRole("switch", { name: "פתוח ביום שבת" }).click();
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
    await page.getByTestId("continue").click();

    // done
    await expect(page.getByTestId("done-title")).toHaveText("העסק מוכן לקבל תורים");
    await expect(page.getByTestId("share-link")).toHaveText(/^tori\.example\/book\//);
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("back keeps what was typed (ACC-08)", async ({ page }) => {
    await page.goto("/design/onboarding");
    await page.getByLabel("שם העסק").fill("סטודיו נוי");
    await page.getByLabel("טלפון ליצירת קשר").fill("0501234567");
    await page.getByTestId("continue").click();
    await page.getByRole("button", { name: "חזרה" }).click();
    await expect(page.getByLabel("שם העסק")).toHaveValue("סטודיו נוי");
  });

  test("works at 320px", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/design/onboarding");
    await noOverflow(page);
    await page.getByLabel("שם העסק").fill("מספרת הדר");
    await page.getByLabel("טלפון ליצירת קשר").fill("0501234567");
    await page.getByTestId("continue").click();
    await noOverflow(page);
  });
});

test.describe("design lab · onboarding adapts to the business kind", () => {
  test("choosing a trainer seeds trainer services and a split day; windows can be edited, overlap is rejected", async ({ page }) => {
    await page.goto("/design/onboarding");
    await page.getByLabel("שם העסק").fill("בלנס");
    await page.getByLabel("טלפון ליצירת קשר").fill("050-1234567");
    await page.getByLabel("סוג העסק").selectOption("trainer");
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("service-row-0").getByLabel("שם השירות")).toHaveValue("אימון אישי");
    await expect(page.getByTestId("service-row-2").getByLabel("שם השירות")).toHaveValue("אימון קבוצתי");
    await page.getByTestId("continue").click();

    // Sunday is a split day: two windows, each editable, with a ribbon text alternative listing both.
    await expect(page.getByTestId("window-0-0")).toBeVisible();
    await expect(page.getByTestId("window-0-1")).toBeVisible();
    await expect(page.getByTestId("hours-0").getByRole("img")).toHaveAttribute("aria-label", /06:00–10:00, 17:00–21:00/);
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);

    // Make the evening window overlap the morning one → explained, blocks.
    await page.getByLabel("משעה ראשון טווח 2").selectOption("09:00");
    await expect(page.getByTestId("hours-0").getByText("הטווחים חופפים.").first()).toBeVisible();
    await page.getByTestId("continue").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("מתי אתם פתוחים?");
    await page.getByRole("button", { name: "הסרת טווח ראשון טווח 2" }).click();
    await expect(page.getByTestId("window-0-1")).toHaveCount(0);
    await page.getByTestId("hours-0").getByRole("button", { name: "הוספת טווח שעות" }).click();
    await expect(page.getByTestId("window-0-1")).toBeVisible();
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("done-title")).toBeVisible();
  });

  test("every kind's setup is completable with the defaults it seeds", async ({ page }) => {
    for (const kind of ["barber", "beauty", "nails", "trainer", "teacher", "clinic", "other"]) {
      await page.goto("/design/onboarding");
      await page.getByLabel("שם העסק").fill("עסק לדוגמה");
      await page.getByLabel("טלפון ליצירת קשר").fill("050-1234567");
      await page.getByLabel("סוג העסק").selectOption(kind);
      await page.getByTestId("continue").click();
      await page.getByTestId("continue").click();
      await page.getByTestId("continue").click();
      await expect(page.getByTestId("done-title"), kind).toBeVisible();
    }
  });
});

test.describe("design lab · onboarding layout with long values", () => {
  test("a very long business name never widens the page at 320px (link card wraps)", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/design/onboarding");
    await page.getByLabel("שם העסק").fill("Same Name Studio With A Really Long Business Name kpxzaxqwe");
    await page.getByLabel("טלפון ליצירת קשר").fill("050-1234567");
    await expect(page.getByTestId("link-preview")).toContainText("same-name-studio");
    await noOverflow(page);
    const box = await page.getByTestId("continue").boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    await page.getByTestId("continue").click();
    await page.getByTestId("continue").click();
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("share-link")).toBeVisible();
    await noOverflow(page);
  });
});

