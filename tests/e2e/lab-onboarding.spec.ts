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

    // 2 · services: a suggestion fills the empty row; a price is required
    await expect(h1).toHaveText("מה אתם מציעים?");
    await expect(h1).toBeFocused();
    await page.getByRole("button", { name: "תספורת גברים" }).click();
    await expect(page.getByTestId("service-row-0").getByLabel("שם השירות")).toHaveValue("תספורת גברים");
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
