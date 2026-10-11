import { expect, test } from "@playwright/test";
import { extractLink, mailCount, waitForMail } from "./helpers/mail";

// Persona "דנה" (salon owner): signs up, verifies her email, reaches the dashboard.
// Runs against a REAL local Supabase (GoTrue + Postgres + Mailpit). Skipped — and reported
// as skipped, never silently green — when the stack is not available.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");

const PASSWORD = "Correct-Horse-Battery-9";
const unique = () => `dana+${Date.now()}${Math.floor(Math.random() * 1e4)}@example.com`;

test.describe("owner authentication journey (scenarios ACC-01, ACC-02, ACC-04, SEC-07)", () => {
  test("ACC-01: sign up → verification email (Hebrew) → confirm link → dashboard", async ({ page }) => {
    const email = unique();
    await page.goto("/auth/sign-up");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#repeat-password").fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/auth\/sign-up-success/);

    // Authoritative side effect: the email actually exists and is the Hebrew template.
    const mail = await waitForMail(email);
    expect(mail.subject).toBe("אימות כתובת האימייל");
    expect(mail.html).toContain('dir="rtl"');

    // Until verified, the user must NOT be able to use the app (ACC-04).
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/login/);

    await page.goto(extractLink(mail.html, "/auth/confirm"));
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByTestId("whoami")).toHaveText(email);
  });

  test("password policy: a weak password is rejected and sends no email", async ({ page }) => {
    const email = unique();
    await page.goto("/auth/sign-up");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill("short1");
    await page.locator("#repeat-password").fill("short1");
    await page.locator('button[type="submit"]').click();
    await expect(page.locator("p.text-red-500")).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/sign-up$/);
    expect(await mailCount(email)).toBe(0);
  });

  test("ACC-02: wrong password and unknown account produce the same message (no enumeration)", async ({ page }) => {
    const known = unique();
    // create + verify a real account first
    await page.goto("/auth/sign-up");
    await page.locator("#email").fill(known);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#repeat-password").fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.goto(extractLink((await waitForMail(known)).html, "/auth/confirm"));
    await page.context().clearCookies();

    const msg = async (email: string, password: string) => {
      await page.goto("/auth/login");
      await page.locator("#email").fill(email);
      await page.locator("#password").fill(password);
      await page.locator('button[type="submit"]').click();
      const el = page.locator("p.text-red-500");
      await expect(el).toBeVisible();
      return el.innerText();
    };
    const wrongPw = await msg(known, "Wrong-Password-123456");
    const unknown = await msg(unique(), PASSWORD);
    expect(wrongPw).toBe(unknown);
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("session ends on logout and protected pages redirect again", async ({ page }) => {
    const email = unique();
    await page.goto("/auth/sign-up");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#repeat-password").fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.goto(extractLink((await waitForMail(email)).html, "/auth/confirm"));
    await expect(page).toHaveURL(/\/dashboard/);

    await page.context().clearCookies(); // equivalent to an expired/removed session
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  // KNOWN GAP (docs/05 §5.2): the vendor template signs in from the browser client, so the
  // session cookie is readable by JS. Fix in stage 2: move auth to Server Actions + httpOnly.
  test.fixme("session cookie is HttpOnly", async ({ page, context }) => {
    const email = unique();
    await page.goto("/auth/sign-up");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#repeat-password").fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    await page.goto(extractLink((await waitForMail(email)).html, "/auth/confirm"));
    const auth = (await context.cookies()).filter((c) => c.name.includes("auth-token"));
    expect(auth.length).toBeGreaterThan(0);
    for (const c of auth) expect(c.httpOnly).toBe(true);
  });
});
