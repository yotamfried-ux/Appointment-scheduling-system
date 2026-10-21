import AxeBuilder from "@axe-core/playwright";
import { devices, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { extractLink, waitForMail } from "../helpers/mail";
import { fakeIp, PASSWORD } from "../helpers/business";

// The cast of the user-journey simulations. Nothing here knows how the app works inside: people use pages, mail and links, and the database is only read to check results.
export const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
export const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
export const unique = (p: string) => `${p}+${Date.now()}${Math.floor(Math.random() * 1e4)}@example.com`;

/** A customer on a small phone (their own browser, their own IP). */
export async function customerOnPhone(browser: Browser, baseURL: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...devices["Pixel 5"], viewport: { width: 360, height: 740 }, locale: "he-IL", timezoneId: "Asia/Jerusalem", baseURL, extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
  return { ctx, page: await ctx.newPage() };
}

/** The owner at a desktop browser. */
export async function ownerAtDesk(browser: Browser, baseURL: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 }, locale: "he-IL", timezoneId: "Asia/Jerusalem", baseURL, extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
  return { ctx, page: await ctx.newPage() };
}

/** Sign up with the real form, follow the verification mail, finish onboarding (default services and hours), publish. Returns the public link's slug. */
export async function ownerSignsUp(page: Page, email: string, businessName: string, kind = "barber"): Promise<{ slug: string }> {
  await page.goto("/auth/sign-up");
  await page.getByLabel("אימייל").fill(email);
  await page.getByLabel("סיסמה", { exact: true }).fill(PASSWORD);
  await page.getByLabel("אימות סיסמה").fill(PASSWORD);
  await page.getByRole("button", { name: "יצירת חשבון" }).click();
  await expect(page).toHaveURL(/\/auth\/sign-up-success/);
  await page.goto(extractLink((await waitForMail(email)).html, "/auth/confirm"));
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("שם העסק").fill(businessName);
  await page.getByLabel("טלפון ליצירת קשר").fill("050-1234567");
  await page.getByLabel("סוג העסק").selectOption(kind);
  for (let i = 0; i < 3; i++) await page.getByTestId("continue").click();
  await expect(page.getByTestId("done-title")).toBeVisible();
  const link = (await page.getByTestId("share-link").innerText()).trim();
  await page.getByRole("link", { name: "לדשבורד" }).click();
  await page.getByTestId("publish").click();
  await expect(page.getByTestId("biz-status")).toHaveText("פורסם");
  return { slug: link.split("/book/")[1] };
}

export async function ownerLogsIn(page: Page, email: string) {
  await page.goto("/auth/login");
  await page.getByLabel("אימייל").fill(email);
  await page.getByLabel("סיסמה", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "כניסה", exact: true }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/);
}

/** A customer books through the public page, step by step, and ends on the confirmation. */
export async function customerBooksViaPage(page: Page, slug: string, who: { name: string; phone: string; email?: string }, opts: { serviceIndex?: number; nthTime?: number } = {}) {
  await page.goto(`/book/${slug}`);
  await page.locator('input[name="service"]').nth(opts.serviceIndex ?? 0).check({ force: true });
  await page.getByTestId("continue").click();
  await page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
  const date = (await page.locator('input[name="day"]:checked').getAttribute("data-testid"))!.replace("day-", "");
  await page.getByTestId("continue").click();
  const chip = page.locator('input[name="time"]').nth(opts.nthTime ?? 0);
  await chip.check({ force: true });
  const time = (await chip.getAttribute("value"))!;
  await page.getByTestId("continue").click();
  await page.getByLabel("שם מלא").fill(who.name);
  await page.getByLabel("טלפון נייד").fill(who.phone);
  if (who.email) await page.getByLabel(/אימייל/).fill(who.email);
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("done-title")).toBeVisible();
  const manage = await page.getByTestId("manage-link").getAttribute("href");
  return { date, time, manageUrl: manage! };
}
