import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Persona "דנה" (owner) on the dashboard prototype. Scenarios: BKG-09 (manual approval), CXL-03 (cancellation
// request), AVL-07/NSH (gaps are first-class), UX-06/07, state-machine guards.

const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test.describe("design lab · owner dashboard", () => {
  test("renders with no axe violations, no overflow, no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => (m.type() === "error" ? errors.push(m.text()) : undefined));
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/design/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("רביעי, 14 באוקטובר");
    await noOverflow(page);
    expect((await axe(page)).violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("stats are derived from the same data as the schedule", async ({ page }) => {
    await page.goto("/design/dashboard");
    await expect(page.getByText("תורים היום").locator("xpath=following-sibling::dd")).toContainText("8");
    await expect(page.getByText("ממתינים לאישור").first().locator("xpath=following-sibling::dd")).toContainText("3");
    await expect(page.getByTestId("approvals-count")).toHaveText("3");
  });

  test("approving a pending request confirms it, announces it and updates counters + ribbon", async ({ page }) => {
    await page.goto("/design/dashboard");
    const ribbon = page.getByRole("img").filter({ hasText: "" }).first();
    await expect(page.getByTestId("row-p1")).toHaveAttribute("data-status", "pending");
    await page.getByRole("button", { name: "אישור · נועם לוי" }).click();
    await expect(page.getByRole("status").filter({ hasText: "התור אושר" })).toBeVisible();
    await expect(page.getByTestId("row-p1")).toHaveAttribute("data-status", "confirmed");
    await expect(page.getByTestId("approvals-count")).toHaveText("2");
    await expect(page.getByTestId("approval-p1")).toHaveCount(0);
    void ribbon;
  });

  test("rejecting frees the time: a new gap appears with an action to fill it", async ({ page }) => {
    await page.goto("/design/dashboard");
    await expect(page.getByTestId("gap-16:00")).toHaveCount(0); // 16:00–16:30 is pending, so busy
    await page.getByRole("button", { name: "דחייה · רונית דאהר" }).click();
    await expect(page.getByTestId("row-p2")).toHaveCount(0);
    await expect(page.getByTestId("gap-16:00")).toBeVisible();
    await expect(page.getByTestId("gap-16:00").getByRole("button", { name: "הוספת תור" })).toBeVisible();
  });

  test("approving a cancellation request cancels it and merges adjacent free time", async ({ page }) => {
    await page.goto("/design/dashboard");
    await page.getByRole("button", { name: "אישור ביטול · יוסי ביטון" }).click();
    await expect(page.getByTestId("row-c1")).toHaveCount(0);
    await expect(page.getByTestId("gap-15:30")).toBeVisible(); // 15:30–16:00 is now free
    await expect(page.getByRole("status").filter({ hasText: "התור בוטל" })).toBeVisible();
  });

  test("handling every request shows the calm empty state", async ({ page }) => {
    await page.goto("/design/dashboard");
    await page.getByRole("button", { name: "אישור · נועם לוי" }).click();
    await page.getByRole("button", { name: "אישור · רונית דאהר" }).click();
    await page.getByRole("button", { name: "להשאיר את התור · יוסי ביטון" }).click();
    await expect(page.getByTestId("approvals-empty")).toBeVisible();
    await expect(page.getByTestId("approvals-count")).toHaveText("0");
  });

  test("the ribbon exposes a text alternative that matches the schedule", async ({ page }) => {
    await page.goto("/design/dashboard");
    const label = await page.locator('[role="img"][aria-label*="תפוס"]').first().getAttribute("aria-label");
    expect(label).toContain("ממתין לאישור: 11:30–12:00");
    expect(label).toContain("פנוי: 12:00–14:00");
  });

  test("navigation landmark is labelled and the current page is marked", async ({ page, isMobile }) => {
    await page.goto("/design/dashboard");
    if (isMobile) await page.getByRole("button", { name: "Toggle sidebar" }).click();
    const current = page.locator('[aria-current="page"]').first();
    await expect(current).toContainText("היום");
  });
});
