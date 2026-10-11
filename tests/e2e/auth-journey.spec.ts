import { expect, test, type Page } from "@playwright/test";
import { extractLink, mailCount, waitForMail } from "./helpers/mail";

// Persona "דנה" (salon owner): signs up, verifies her email, reaches the dashboard.
// Runs against a REAL local Supabase (GoTrue + Postgres + Mailpit). Skipped — and reported
// as skipped, never silently green — when the stack is not available.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");

const PASSWORD = "Correct-Horse-Battery-9";
const unique = () => `dana+${Date.now()}${Math.floor(Math.random() * 1e4)}@example.com`;

async function signUp(page: Page, email: string, password = PASSWORD) {
  await page.goto("/auth/sign-up");
  await page.getByLabel("אימייל").fill(email);
  await page.getByLabel("סיסמה", { exact: true }).fill(password);
  await page.getByLabel("אימות סיסמה").fill(password);
  await page.getByRole("button", { name: "יצירת חשבון" }).click();
}

async function signUpAndVerify(page: Page, email: string) {
  await signUp(page, email);
  await expect(page).toHaveURL(/\/auth\/sign-up-success/);
  const mail = await waitForMail(email);
  await page.goto(extractLink(mail.html, "/auth/confirm"));
  await expect(page).toHaveURL(/\/dashboard/);
  return mail;
}

test.describe("owner authentication journey (scenarios ACC-01, ACC-02, ACC-04, SEC-07)", () => {
  test("ACC-01: sign up → verification email (Hebrew) → confirm link → dashboard", async ({ page }) => {
    const email = unique();
    await signUp(page, email);
    await expect(page).toHaveURL(/\/auth\/sign-up-success/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("כמעט סיימנו");

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

  test("client validation: short password and mismatch are explained next to the field, no email sent", async ({ page }) => {
    const email = unique();
    await page.goto("/auth/sign-up");
    await page.getByLabel("אימייל").fill(email);
    await page.getByLabel("סיסמה", { exact: true }).fill("short1");
    await page.getByLabel("אימות סיסמה").fill("different");
    await page.getByRole("button", { name: "יצירת חשבון" }).click();
    await expect(page.getByText("הסיסמה חייבת להכיל לפחות 12 תווים.")).toBeVisible();
    await expect(page.getByText("הסיסמאות אינן זהות.")).toBeVisible();
    await expect(page.getByLabel("סיסמה", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(page).toHaveURL(/\/auth\/sign-up$/);
    expect(await mailCount(email)).toBe(0);
  });

  // Negative control for the client check above: the SERVER enforces the same policy on its own
  // (would fail if supabase/config.toml minimum_password_length were lowered back to 6).
  test("server enforces the password policy independently of the UI (weak_password)", async ({ request }) => {
    const res = await request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/signup`, {
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, "content-type": "application/json" },
      data: { email: unique(), password: "short1" },
    });
    expect(res.status()).toBe(422);
    expect((await res.json()).error_code).toBe("weak_password");
  });

  test("ACC-02: wrong password and unknown account produce the same message (no enumeration)", async ({ page }) => {
    const known = unique();
    await signUpAndVerify(page, known);
    await page.context().clearCookies();

    const msg = async (email: string, password: string) => {
      await page.goto("/auth/login");
      await page.getByLabel("אימייל").fill(email);
      await page.getByLabel("סיסמה", { exact: true }).fill(password);
      await page.getByRole("button", { name: "כניסה", exact: true }).click();
      const el = page.getByTestId("form-error");
      await expect(el).toBeVisible();
      return el.innerText();
    };
    const wrongPw = await msg(known, "Wrong-Password-123456");
    const unknown = await msg(unique(), PASSWORD);
    expect(wrongPw).toBe("האימייל או הסיסמה שגויים.");
    expect(wrongPw).toBe(unknown);
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("login with correct credentials reaches the dashboard; logout ends the session", async ({ page }) => {
    const email = unique();
    await signUpAndVerify(page, email);
    await page.goto("/");
    await page.getByRole("button", { name: "יציאה" }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/login/);

    await page.getByLabel("אימייל").fill(email);
    await page.getByLabel("סיסמה", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "כניסה", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test("an invalid/expired confirmation link lands on a safe error page (no reflected text)", async ({ page }) => {
    await page.goto("/auth/confirm?token_hash=bogus&type=email&next=//evil.example");
    await expect(page).toHaveURL(/\/auth\/error\?reason=expired/);
    await expect(page.getByText("הקישור פג תוקף")).toBeVisible();
    await page.goto("/auth/error?reason=<script>alert(1)</script>");
    await expect(page.getByText("אירעה שגיאה לא צפויה.")).toBeVisible();
    expect(await page.content()).not.toContain("<script>alert(1)</script>");
  });

  // KNOWN GAP (docs/05 §5.2): the vendor template signs in from the browser client, so the
  // session cookie is readable by JS. Fix in stage 2: move auth to Server Actions + httpOnly.
  test.fixme("session cookie is HttpOnly", async ({ page, context }) => {
    await signUpAndVerify(page, unique());
    const auth = (await context.cookies()).filter((c) => c.name.includes("auth-token"));
    expect(auth.length).toBeGreaterThan(0);
    for (const c of auth) expect(c.httpOnly).toBe(true);
  });
});
