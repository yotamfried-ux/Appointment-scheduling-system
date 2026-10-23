import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The first thing a business owner sees. It must say what the product does for them, show the real prices, offer the next step and be accessible.
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

test("the landing page explains the product, shows what the customer sees, no prices, and leads to sign-up", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("home-title")).toHaveText("הלקוחות קובעים לבד. אתם חוזרים לעבוד.");
  await expect(page.locator("main")).not.toContainText("בבנייה"); // no development placeholder
  await expect(page.getByTestId("home-kinds").locator("li")).toHaveCount(6);
  await expect(page.getByTestId("home-kinds")).toContainText("מניקוריסט/ית");
  await expect(page.getByTestId("home-kinds")).toContainText("מורה פרטי/ת");
  await expect(page.locator("main")).not.toContainText("₪"); // prices are shown only inside the product, when someone picks a plan
  await expect(page.getByTestId("customer-mock")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.waitForTimeout(500);
  expect((await axe(page)).violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
  await page.screenshot({ path: `test-results/shots/landing-${page.viewportSize()!.width}.png`, fullPage: true });
  // FAQ answers are reachable without a mouse (native details/summary)
  const first = page.locator("details").first();
  await first.locator("summary").click();
  await expect(first).toHaveAttribute("open", "");
  await page.getByTestId("home-cta").click();
  await expect(page).toHaveURL(/\/auth\/sign-up/);
});

// A client-side navigation keeps the messages the first page loaded; the sign-up form must still show real Hebrew, never a key like "auth.signUp.title".
test("clicking 'start' on the landing page opens sign-up with real text, not message keys", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("home-cta").click();
  await expect(page).toHaveURL(/\/auth\/sign-up/);
  await expect(page.getByRole("button", { name: "יצירת חשבון" })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/\bauth\.[a-zA-Z]+/);
});
