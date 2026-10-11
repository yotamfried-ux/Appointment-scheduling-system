import { expect, test, type Page } from "@playwright/test";
import { extractLink, waitForMail } from "./helpers/mail";
import { totp } from "./helpers/totp";

// TOTP MFA against the real local auth server (docs/05 §5.2). Acts as the authenticator app with an RFC 6238 helper.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");

const PASSWORD = "Correct-Horse-Battery-9";
const unique = () => `mfa+${Date.now()}${Math.floor(Math.random() * 1e4)}@example.com`;

async function signUpVerified(page: Page, email: string) {
  await page.goto("/auth/sign-up");
  await page.getByLabel("אימייל").fill(email);
  await page.getByLabel("סיסמה", { exact: true }).fill(PASSWORD);
  await page.getByLabel("אימות סיסמה").fill(PASSWORD);
  await page.getByRole("button", { name: "יצירת חשבון" }).click();
  await page.goto(extractLink((await waitForMail(email)).html, "/auth/confirm"));
  await expect(page).toHaveURL(/\/onboarding/);
}

async function login(page: Page, email: string) {
  await page.goto("/auth/login");
  await page.getByLabel("אימייל").fill(email);
  await page.getByLabel("סיסמה", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "כניסה", exact: true }).click();
}

/** Submits a code from the current TOTP window; if the server says "invalid", retries with the neighbouring windows. */
async function submitCode(page: Page, secret: string, button: string, success: () => Promise<void>) {
  const invalid = page.getByText("הקוד שגוי או שפג תוקפו.");
  for (const skew of [0, -30_000, 30_000]) {
    await page.getByLabel("קוד אימות").fill(totp(secret, Date.now() + skew));
    await page.getByRole("button", { name: button, exact: true }).click();
    const outcome = await Promise.race([success().then(() => "ok" as const), invalid.waitFor({ timeout: 15_000 }).then(() => "invalid" as const)]);
    if (outcome === "ok") return;
  }
  await success();
}

async function enroll(page: Page): Promise<string> {
  await page.goto("/settings/security");
  await page.getByTestId("mfa-start").click();
  const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
  await expect(page.getByRole("img", { name: "קוד QR להגדרת אפליקציית האימות" })).toBeVisible();
  await submitCode(page, secret, "אישור והפעלה", () => expect(page.getByTestId("mfa-status")).toHaveText("האימות הדו-שלבי הופעל.", { timeout: 15_000 }));
  return secret;
}

test.describe("TOTP MFA", () => {
  test("enroll, then login requires the code: password alone does not reach the app", async ({ page, context }) => {
    const errors: string[] = [];
    page.on("console", (m) => (m.type() === "error" ? errors.push(m.text()) : undefined));
    const email = unique();
    await signUpVerified(page, email);
    const secret = await enroll(page);

    await context.clearCookies();
    await login(page, email);
    await expect(page).toHaveURL(/\/auth\/mfa/);

    // With only the password (aal1) every protected page bounces back to the code prompt.
    for (const path of ["/dashboard", "/onboarding", "/settings/security"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/auth\/mfa/);
    }

    // A wrong code is refused with a generic message; the right one opens the app.
    await page.getByLabel("קוד אימות").fill("000000");
    await page.getByRole("button", { name: "אימות", exact: true }).click();
    await expect(page.getByText("הקוד שגוי או שפג תוקפו.")).toBeVisible();
    await expect(page).toHaveURL(/\/auth\/mfa/);
    await submitCode(page, secret, "אימות", () => expect(page).toHaveURL(/\/onboarding/, { timeout: 15_000 }));
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("a user without MFA is never sent to the code prompt", async ({ page }) => {
    await signUpVerified(page, unique());
    await page.goto("/auth/mfa");
    await expect(page).not.toHaveURL(/\/auth\/mfa/);
  });

  test("a factor that was never confirmed does not lock the user out", async ({ page, context }) => {
    const email = unique();
    await signUpVerified(page, email);
    await page.goto("/settings/security");
    await page.getByTestId("mfa-start").click(); // started, abandoned
    await context.clearCookies();
    await login(page, email);
    await expect(page).toHaveURL(/\/onboarding/);
  });
});
