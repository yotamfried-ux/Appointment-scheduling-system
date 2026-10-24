import { expect, test } from "@playwright/test";
import { fakeIp } from "./helpers/business";

// SIM 7 (page) · The expired-link page on a phone: the card sits right under the logo (no big empty gap), the main action is to ask for a new link,
// going to the login page is the quiet second choice. Old behaviour: the card was vertically centred (a screen of white above it) and "login" was the loud button.
test.beforeEach(async ({ context }) => { await context.setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() }); });

test("on a phone the card is under the logo; resend is primary, login is secondary", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/auth/error?reason=expired");
  const logo = page.getByRole("link", { name: "תורים", exact: true }).first();
  const card = page.locator('[data-slot="card"]').first();
  await expect(card).toBeVisible();
  const l = (await logo.boundingBox())!;
  const c = (await card.boundingBox())!;
  const gap = c.y - (l.y + l.height);
  expect(gap, `gap between logo and card: ${gap}px`).toBeGreaterThanOrEqual(0);
  expect(gap, `gap between logo and card: ${gap}px`).toBeLessThanOrEqual(200);

  const resend = page.getByTestId("resend-submit");
  const login = page.getByRole("link", { name: "לדף הכניסה" });
  await expect(resend).toBeVisible();
  await expect(login).toBeVisible();
  const style = (l: typeof resend) => l.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, border: getComputedStyle(el).borderTopWidth, cls: el.className }));
  const rs = await style(resend);
  const ls = await style(login);
  expect(rs.cls, "resend is the filled primary button").toContain("bg-primary");
  expect(ls.cls, "login is the outline button").not.toContain("bg-primary");
  expect(ls.cls).toMatch(/border/);
  expect(ls.bg, "the two look different").not.toBe(rs.bg);
  const r = (await resend.boundingBox())!;
  const lg = (await login.boundingBox())!;
  expect(r.y, "resend comes before login").toBeLessThan(lg.y);
});
