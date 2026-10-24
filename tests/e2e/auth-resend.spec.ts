import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { fakeIp } from "./helpers/business";

// An expired verification link no longer ends in a dead end: the page asks for the address and sends a new link, and answers the same whether or not the address has an account.
test.beforeEach(async ({ context }) => { await context.setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() }); });

test("an expired link offers a new one; the answer never reveals whether the address has an account", async ({ page }) => {
  await page.goto("/auth/confirm?token_hash=garbage&type=email&next=/dashboard"); // what an expired or used-up link does
  await expect(page).toHaveURL(/\/auth\/error\?reason=expired/);
  await expect(page.getByTestId("resend-form")).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);

  await page.getByTestId("resend-email").fill("not-an-address");
  await page.getByTestId("resend-submit").click();
  await expect(page.getByText("כתובת האימייל אינה תקינה.")).toBeVisible();

  await page.getByTestId("resend-email").fill(`nobody-${Math.random().toString(36).slice(2, 9)}@example.com`);
  await page.getByTestId("resend-submit").click();
  await expect(page.getByTestId("resend-sent")).toBeVisible(); // same message for an address that has no account

  await page.goto("/auth/error"); // any other error page has no resend form
  await expect(page.getByTestId("resend-form")).toHaveCount(0);
});

// The sign-up mail of a project that still uses Supabase's default template: Supabase verifies the address itself and returns the browser with ?code=.
// A browser that cannot exchange that code (another phone) used to be told "expired" although the address was verified; it is now sent to sign in.
test("a verification return with a code the browser cannot use sends the person to sign in, not to an 'expired' page", async ({ page }) => {
  await page.goto("/auth/confirm?code=00000000-0000-0000-0000-000000000000&next=/dashboard");
  await expect(page).toHaveURL(/\/auth\/login\?verified=1/);
  await expect(page.getByText("כתובת האימייל אומתה. אפשר להיכנס עכשיו.")).toBeVisible();
  await page.goto("/auth/login");
  await expect(page.getByText("כתובת האימייל אומתה. אפשר להיכנס עכשיו.")).toHaveCount(0);
});
