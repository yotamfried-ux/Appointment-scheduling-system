import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// A full simulation of people using the deployed system. Like the browser dev tools it watches the console and the network on every page:
// a page that "works" but logs an error or fails a request is a failure here.
const SLUG = process.env.CLOUD_SLUG ?? "demo-barber";
const OWNER = process.env.CLOUD_OWNER_EMAIL;
const PASSWORD = process.env.CLOUD_OWNER_PASSWORD;
const RUN = `${Date.now()}`.slice(-7);
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

type Watch = { errors: string[]; failed: string[] };
function watch(page: Page): Watch {
  const w: Watch = { errors: [], failed: [] };
  page.on("console", (m) => m.type() === "error" && w.errors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => w.errors.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("response", (r) => r.status() >= 500 && w.failed.push(`${r.status()} ${new URL(r.url()).pathname}`));
  // a request the browser itself cancelled (a navigation replacing a prefetch) is not a failure of the system
  page.on("requestfailed", (r) => !/ERR_ABORTED/.test(r.failure()?.errorText ?? "") && w.failed.push(`failed ${new URL(r.url()).pathname}`));
  return w;
}
const clean = (w: Watch, where: string) => {
  expect(w.failed, `${where}: failed requests`).toEqual([]);
  expect(w.errors, `${where}: console errors`).toEqual([]);
};
async function looksRight(page: Page, where: string) {
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${where}: horizontal overflow`).toBeLessThanOrEqual(0);
  expect((await axe(page)).violations.map((v) => `${v.id} (${v.nodes.length})`), `${where}: accessibility`).toEqual([]);
}

test.describe("the deployment is alive and configured", () => {
  test("health, readiness and the pages that need the browser configuration", async ({ request }) => {
    expect((await request.get("/api/health")).status(), "liveness").toBe(200);
    const ready = await request.get("/api/ready");
    expect(ready.status(), "readiness (503 = a variable is missing or the database is unreachable: see the Vercel runtime log)").toBe(200);
  });
});

test.describe("a visitor", () => {
  test("the landing page tells what the product does, with no console errors and no prices", async ({ page }, info) => {
    const w = watch(page);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("הלקוחות קובעים תור בעצמם");
    await expect(page.locator("main")).not.toContainText("₪");
    await expect(page.getByRole("link", { name: /כניסה/ }).first()).toBeVisible();
    await looksRight(page, "landing");
    await page.screenshot({ path: `test-results/shots/cloud-landing-${info.project.name}.png`, fullPage: true });
    clean(w, "landing");
  });

  test("sign-up and login pages render; a wrong password is explained, not an internal error", async ({ page }, info) => {
    const w = watch(page);
    await page.goto("/auth/sign-up");
    await expect(page.getByRole("button", { name: "יצירת חשבון" })).toBeVisible();
    await looksRight(page, "sign-up");
    await page.goto("/auth/login");
    await page.getByLabel("אימייל").fill(`nobody-${RUN}@example.com`);
    await page.getByLabel("סיסמה", { exact: true }).fill("Wrong-Password-12345");
    await page.getByRole("button", { name: "כניסה", exact: true }).click();
    await expect(page.getByTestId("form-error")).toBeVisible();
    await expect(page.getByTestId("form-error")).not.toContainText("משהו השתבש"); // that text is the internal-error message
    await looksRight(page, "login with error");
    await page.screenshot({ path: `test-results/shots/cloud-login-${info.project.name}.png`, fullPage: true });
    // the 401-style answer is expected for a wrong password, so only 5xx counts as failure here
    expect(w.failed, "login: failed requests").toEqual([]);
  });
});

test.describe("a customer books, manages and cancels", () => {
  test("the whole journey on the public booking page", async ({ page }, info) => {
    const w = watch(page);
    await page.goto(`/book/${SLUG}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await looksRight(page, "booking: service");
    const firstService = page.locator('input[name="service"]').first();
    await firstService.check({ force: true });
    // with a team the page asks "with whom?": keep the default (whoever is free)
    await page.getByTestId("continue").click();
    await page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
    await page.getByTestId("continue").click();
    await page.locator('input[name="time"]').first().check({ force: true });
    await looksRight(page, "booking: time");
    await page.getByTestId("continue").click();
    await page.getByLabel("שם מלא").fill(`בדיקת סימולציה ${RUN}`);
    await page.getByLabel("טלפון נייד").fill(`050${RUN}`);
    await page.getByTestId("continue").click();
    await page.getByTestId("done-title").waitFor();
    await expect(page.getByTestId("done-status")).toBeVisible();
    await looksRight(page, "booking: done");
    await page.screenshot({ path: `test-results/shots/cloud-booked-${info.project.name}.png`, fullPage: true });
    const link = (await page.getByTestId("manage-link").getAttribute("href"))!;
    await page.goto(link);
    await expect(page.getByTestId("manage-status")).toBeVisible();
    await looksRight(page, "manage page");
    if (await page.getByTestId("cancel-start").count()) {
      await page.getByTestId("cancel-start").click();
      await page.getByTestId("cancel-confirm").click();
      await expect(page.getByTestId("manage-cancelled")).toBeVisible();
    } else {
      // inside the cancellation window the page must say so (never a missing button without a reason)
      await expect(page.getByTestId("manage-too-late")).toBeVisible();
    }
    clean(w, "customer journey");
  });
});

test.describe("the owner", () => {
  test.skip(!OWNER || !PASSWORD, "set CLOUD_OWNER_EMAIL and CLOUD_OWNER_PASSWORD to simulate the owner");

  test("signs in, sees the agenda and every settings page; manages the team", async ({ page }, info) => {
    const w = watch(page);
    await page.goto("/auth/login");
    await page.getByLabel("אימייל").fill(OWNER!);
    await page.getByLabel("סיסמה", { exact: true }).fill(PASSWORD!);
    await page.getByRole("button", { name: "כניסה", exact: true }).click();
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 });
    await expect(page).toHaveURL(/dashboard/);
    await expect(page.getByTestId("agenda")).toBeVisible();
    await looksRight(page, "agenda");
    await page.screenshot({ path: `test-results/shots/cloud-agenda-${info.project.name}.png`, fullPage: true });

    for (const [path, name] of [["/settings/services", "services"], ["/settings/hours", "hours"], ["/settings/team", "team"], ["/settings/booking", "booking rules"], ["/settings/billing", "billing"], ["/settings/security", "security"], ["/settings/account", "account"]] as const) {
      const res = await page.goto(path);
      expect(res?.status(), `${name}: status`).toBeLessThan(400);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await looksRight(page, name);
    }

    // team: add a person, see them, switch them off again
    await page.goto("/settings/team");
    const name = `בדיקה ${RUN}`;
    await page.getByTestId("new-person-name").fill(name);
    await page.getByTestId("add-person").click();
    await expect(page.getByTestId(`person-${name}`)).toBeVisible();
    await page.getByTestId(`person-${name}`).getByRole("button", { name: /השבתה/ }).click();
    await page.getByRole("button", { name: "כן, להשבית" }).click();
    // the name sits in an input (disabled once the person is inactive), so read the field values
    await expect.poll(async () => page.getByTestId("team-inactive").locator("input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).toContain(name);
    await page.screenshot({ path: `test-results/shots/cloud-team-${info.project.name}.png`, fullPage: true });
    clean(w, "owner journey");
  });
});
