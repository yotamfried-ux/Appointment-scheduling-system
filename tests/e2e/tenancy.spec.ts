import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { extractLink, waitForMail } from "./helpers/mail";

// Stage 2 against a REAL local Supabase: onboarding persists a tenant, and tenants cannot reach each other.
// Scenarios: ACC-01, ACC-04, ACC-06, SEC-01, SEC-02. Skipped (and reported) when the stack is not running.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");

const PASSWORD = "Correct-Horse-Battery-9";
const unique = (p: string) => `${p}+${Date.now()}${Math.floor(Math.random() * 1e4)}@example.com`;
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;

async function signUpVerified(page: Page, email: string) {
  await page.goto("/auth/sign-up");
  await page.getByLabel("אימייל").fill(email);
  await page.getByLabel("סיסמה", { exact: true }).fill(PASSWORD);
  await page.getByLabel("אימות סיסמה").fill(PASSWORD);
  await page.getByRole("button", { name: "יצירת חשבון" }).click();
  await expect(page).toHaveURL(/\/auth\/sign-up-success/);
  await page.goto(extractLink((await waitForMail(email)).html, "/auth/confirm"));
  await expect(page).toHaveURL(/\/onboarding/);
}

async function completeOnboarding(page: Page, name: string, kind = "barber") {
  await page.getByLabel("שם העסק").fill(name);
  await page.getByLabel("טלפון ליצירת קשר").fill("050-1234567");
  await page.getByLabel("סוג העסק").selectOption(kind);
  await page.getByTestId("continue").click();
  await page.getByTestId("continue").click();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("done-title")).toBeVisible();
}

/** A browser-less client signed in as the user: this is exactly what an attacker holding that user's JWT can do. */
async function clientFor(email: string) {
  const c = createClient(URL_, KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  expect(error).toBeNull();
  return c;
}

test.describe("onboarding persists a tenant (ACC-01, ACC-04, ACC-06)", () => {
  test("verified owner completes onboarding, lands on a dashboard that shows the saved business, can publish", async ({ page }) => {
    const email = unique("tenant");
    await signUpVerified(page, email);
    await expect(page.getByTestId("whoami")).toHaveText(email);
    await completeOnboarding(page, "מספרת הדר בדיקה");

    const link = (await page.getByTestId("share-link").innerText()).trim();
    await page.getByRole("link", { name: "לדשבורד" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("מספרת הדר בדיקה");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await expect(page.getByTestId("biz-link")).toHaveText(link); // the slug the server really assigned
    await expect(page.getByTestId("biz-kind")).toHaveText("מספרה");
    await expect(page.getByTestId("biz-status")).toContainText("טיוטה");

    // visiting onboarding again does not create a second business
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/dashboard/);

    await page.getByTestId("publish").click();
    await expect(page.getByTestId("biz-status")).toHaveText("פורסם");
    await page.reload();
    await expect(page.getByTestId("biz-status")).toHaveText("פורסם");
    await expect(page.getByTestId("publish")).toHaveCount(0);
  });

  test("two owners with the same business name get different, safe slugs (ACC-06)", async ({ page, context }) => {
    const slugs: string[] = [];
    const runId = Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, "x"); // unique per run so reruns start clean
    for (const p of ["same1", "same2"]) {
      await context.clearCookies(); // second owner is a different browser session on the same emulated device
      const tab = await context.newPage(); // fresh page: no scroll/layout state carried over from the first owner
      await signUpVerified(tab, unique(p));
      await completeOnboarding(tab, `Same Name Studio ${runId}`);
      slugs.push((await tab.getByTestId("share-link").innerText()).trim().split("/book/")[1]);
      await tab.close();
    }
    void page;
    expect(slugs[0]).not.toBe(slugs[1]);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  test("unauthenticated visitors cannot open onboarding", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});

test.describe("tenant isolation with real JWTs (SEC-01, SEC-02)", () => {
  test("owner B, holding a valid session, cannot read, change or join business A through the API", async ({ browser }) => {
    const emailA = unique("isoA");
    const emailB = unique("isoB");
    for (const [e, name] of [[emailA, "עסק א בדיקה"], [emailB, "עסק ב בדיקה"]] as const) {
      const ctx = await browser.newContext({ locale: "he-IL" });
      const page = await ctx.newPage();
      await signUpVerified(page, e);
      await completeOnboarding(page, name);
      await ctx.close();
    }
    const a = await clientFor(emailA);
    const b = await clientFor(emailB);
    const aBiz = (await a.from("businesses").select("id, slug, name")).data!;
    expect(aBiz).toHaveLength(1);
    const aId = aBiz[0].id as string;

    // reads
    expect((await b.from("businesses").select("id")).data!.map((r) => r.id)).not.toContain(aId);
    expect((await b.from("businesses").select("*").eq("id", aId)).data).toEqual([]);
    expect((await b.from("business_members").select("*").eq("business_id", aId)).data).toEqual([]);
    expect((await b.from("audit_log").select("*").eq("business_id", aId)).data).toEqual([]);

    // writes: RLS filters the row, nothing changes
    const upd = await b.from("businesses").update({ name: "pwned" }).eq("id", aId).select();
    expect(upd.data ?? []).toEqual([]);
    expect((await a.from("businesses").select("name").eq("id", aId)).data![0].name).toBe("עסק א בדיקה");

    // privileged columns and tables are closed even for one's own business
    const own = (await b.from("businesses").select("id").single()).data!.id as string;
    expect((await b.from("businesses").update({ slug: "sneaky-slug" }).eq("id", own)).error?.code).toBe("42501");
    expect((await b.from("businesses").update({ kind: "clinic" }).eq("id", own)).error?.code).toBe("42501");

    // joining another tenant, tenant_id spoofing, outbox/jobs access
    expect((await b.from("business_members").insert({ business_id: aId, user_id: (await b.auth.getUser()).data.user!.id, role: "owner" })).error?.code).toBe("42501");
    expect((await b.from("domain_events").select("*")).error?.code).toBe("42501");
    expect((await b.from("job_runs").select("*")).error?.code).toBe("42501");
    expect((await b.rpc("change_business_slug", { p_business: aId, p_new_slug: "stolen-slug" })).error?.code).toBe("42501");
    expect((await b.rpc("publish_business", { p_business: aId })).error?.code).toBe("42501");
    expect((await b.schema("private" as never).rpc("is_member" as never, {} as never)).error).not.toBeNull(); // schema is not exposed

    // anonymous callers get nothing
    const anon = createClient(URL_, KEY, { auth: { persistSession: false } });
    expect((await anon.from("businesses").select("*")).error?.code).toBe("42501");
    expect((await anon.rpc("create_business", { p_name: "אנונימי", p_kind: "other", p_phone: null, p_slug: "anon-biz", p_services: [{ name: "שירות", durationMinutes: 30, priceNis: 80 }], p_hours: [] })).error?.code).toBe("42501");

    // A still owns and sees exactly their own data
    expect((await a.from("businesses").select("id")).data).toEqual([{ id: aId }]);
  });
});
