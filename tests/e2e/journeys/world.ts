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
  await expect(page.getByTestId("publish-hint")).toBeVisible(); // no link before the business is published
  await page.getByRole("link", { name: "לדשבורד" }).click();
  await page.getByTestId("publish").click();
  await expect(page.getByTestId("biz-status")).toHaveText("פורסם");
  const link = (await page.getByTestId("biz-link").innerText()).trim();
  return { slug: link.split("/book/")[1] };
}

export async function ownerLogsIn(page: Page, email: string) {
  await page.goto("/auth/login");
  await page.getByLabel("אימייל").fill(email);
  await page.getByLabel("סיסמה", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "כניסה", exact: true }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/);
}

/** From the "first available" click on: continue to the times and return the `wanted`-th time. Late in the day "today" has only a few times left, so a journey that needs the 4th or 7th time of a day takes the next open day instead of depending on the time of day it runs. */
export async function chooseTime(page: Page, wanted: number) {
  const dayOf = async () => (await page.locator('input[name="day"]:checked').getAttribute("data-testid"))!.replace("day-", "");
  let date = await dayOf();
  await page.getByTestId("continue").click();
  await expect(page.locator('input[name="time"]').first()).toBeVisible();
  if ((await page.locator('input[name="time"]').count()) <= wanted) {
    await page.getByRole("button", { name: "חזרה" }).first().click();
    const open = page.locator('input[name="day"]:not([disabled])');
    const at = await open.evaluateAll((els) => els.findIndex((e) => (e as HTMLInputElement).checked));
    await open.nth(at + 1).check({ force: true });
    date = await dayOf();
    await page.getByTestId("continue").click();
    await expect(page.locator('input[name="time"]').nth(wanted)).toBeAttached();
  }
  return { date, chip: page.locator('input[name="time"]').nth(wanted) };
}

/** A customer books through the public page, step by step, and ends on the confirmation. */
export async function customerBooksViaPage(page: Page, slug: string, who: { name: string; phone: string; email: string }, opts: { serviceIndex?: number; nthTime?: number } = {}) {
  await page.goto(`/book/${slug}`);
  await page.locator('input[name="service"]').nth(opts.serviceIndex ?? 0).check({ force: true });
  await page.getByTestId("continue").click();
  await page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
  const { date, chip } = await chooseTime(page, opts.nthTime ?? 0);
  await chip.check({ force: true });
  const time = (await chip.getAttribute("value"))!;
  await page.getByTestId("continue").click();
  await page.getByLabel("שם מלא").fill(who.name);
  await page.getByLabel("טלפון נייד").fill(who.phone);
  await page.getByLabel(/אימייל/).fill(who.email);
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("done-title")).toBeVisible();
  const manage = await page.getByTestId("manage-link").getAttribute("href");
  return { date, time, manageUrl: manage! };
}
