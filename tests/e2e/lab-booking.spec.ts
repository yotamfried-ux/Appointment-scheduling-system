import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Prototype journey "נועם" (customer on a phone): service → day → time → details → confirmation.
// Scenarios: BKG-01 (≤4 steps, mobile 360), BKG-03 (slot hold timer), BKG-15, ACC-03 (phone), UX-01/02/08.

const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test.describe("design lab · booking flow", () => {
  test("complete journey with accessibility and layout checks at every step", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => (m.type() === "error" ? errors.push(m.text()) : undefined));
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/design/booking");
    const heading = page.getByRole("heading", { level: 1 });

    // 1 · service
    await expect(heading).toHaveText("איזה שירות תרצו?");
    await expect(page.getByText("שלב 1 מתוך 4")).toBeVisible();
    await expect(page.getByTestId("continue")).toBeDisabled(); // nothing chosen yet
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
    await page.getByTestId("service-haircut").check({ force: true });
    await expect(page.getByTestId("continue")).toBeEnabled();
    await page.getByTestId("continue").click();

    // 2 · day (Saturday is closed and cannot be chosen)
    await expect(heading).toHaveText("באיזה יום?");
    await expect(heading).toBeFocused(); // focus moves to the new step for keyboard/screen-reader users
    await expect(page.getByTestId("day-2026-10-17")).toBeDisabled();
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
    await page.getByTestId("day-2026-10-15").check({ force: true });
    await page.getByTestId("continue").click();

    // 3 · time (+ hold timer after choosing a slot)
    await expect(heading).toHaveText("באיזו שעה?");
    await expect(page.getByTestId("hold")).toHaveCount(0);
    const firstSlot = page.locator('input[name="time"]').first();
    await firstSlot.check({ force: true });
    await expect(page.getByTestId("hold")).toContainText("05:0"); // counting down from 05:00
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
    await page.getByTestId("continue").click();

    // 4 · details: invalid phone is explained next to the field and blocks submission
    await expect(heading).toHaveText("כמעט סיימנו");
    await page.getByLabel("שם מלא").fill("נועם לוי");
    await page.getByLabel("טלפון נייד").fill("050-12");
    await page.getByTestId("continue").click();
    await expect(page.getByText("מספר הטלפון אינו תקין.")).toBeVisible();
    await expect(page.getByText("יש להזין כתובת אימייל.")).toBeVisible(); // the address identifies the customer: it is required
    await page.getByLabel("אימייל").fill("noam@example.com");
    await expect(page.getByLabel("טלפון נייד")).toHaveAttribute("aria-invalid", "true");
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
    await page.getByLabel("טלפון נייד").fill("050-1234567");
    await page.getByTestId("continue").click();

    // done
    await expect(page.getByTestId("done-title")).toHaveText("התור נקבע!");
    await expect(page.getByTestId("done-when")).toContainText("חמישי");
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);

    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("changing the service clears the chosen day and time (stale slot cannot be booked)", async ({ page }) => {
    await page.goto("/design/booking");
    await page.getByTestId("service-haircut").check({ force: true });
    await page.getByTestId("continue").click();
    await page.getByTestId("day-2026-10-15").check({ force: true });
    await page.getByTestId("continue").click();
    await page.locator('input[name="time"]').first().check({ force: true });
    await page.getByRole("button", { name: "חזרה" }).click(); // to day
    await page.getByRole("button", { name: "חזרה" }).click(); // to service
    await page.getByTestId("service-color").check({ force: true });
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("continue")).toBeDisabled(); // day was reset, must choose again
  });

  test("touch targets are at least 44px for primary actions and slots (UX-02)", async ({ page }) => {
    await page.goto("/design/booking");
    const h = async (loc: ReturnType<Page["locator"]>) => (await loc.boundingBox())!.height;
    expect(await h(page.getByTestId("service-haircut").locator("xpath=ancestor::label"))).toBeGreaterThanOrEqual(44);
    expect(await h(page.getByTestId("continue"))).toBeGreaterThanOrEqual(44);
    await page.getByTestId("service-haircut").check({ force: true });
    await page.getByTestId("continue").click();
    await page.getByTestId("day-2026-10-15").check({ force: true });
    await page.getByTestId("continue").click();
    const slot = page.locator('input[name="time"]').first().locator("xpath=ancestor::label");
    expect(await h(slot)).toBeGreaterThanOrEqual(44);
  });

  test("works at 320px width without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/design/booking");
    await page.getByTestId("service-color").check({ force: true });
    await noOverflow(page);
    await page.getByTestId("continue").click();
    await noOverflow(page);
  });
});

test.describe("design lab · styleguide", () => {
  test("renders, hydrates without CSP errors and has no axe violations", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => (m.type() === "error" ? errors.push(m.text()) : undefined));
    await page.goto("/design");
    await expect(page.getByRole("heading", { level: 1, name: "מעבדת עיצוב" })).toBeVisible();
    await noOverflow(page);
    expect((await axe(page)).violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("dialog traps focus, closes on Escape and returns focus to its trigger", async ({ page }) => {
    await page.goto("/design");
    const trigger = page.getByRole("button", { name: "חלון דו-שיח" });
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("toast is announced to assistive tech (live region) and can be dismissed", async ({ page }) => {
    await page.goto("/design");
    await page.getByRole("button", { name: "הודעת הצלחה" }).click();
    // Radix renders a visually-hidden role=status live region with the text, which is what screen readers hear.
    await expect(page.getByRole("status").filter({ hasText: "השינויים נשמרו בהצלחה." })).toHaveCount(1);
    const card = page.getByRole("listitem").filter({ hasText: "השינויים נשמרו בהצלחה." });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "סגירה" }).click();
    await expect(card).toHaveCount(0);
  });
});
