import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { extractLink, waitForMail } from "./helpers/mail";
import { slotsForDay } from "../../modules/availability/slots";
import { rowsToExceptions, rowsToRules } from "../../modules/availability/schema";

// Stage 3 against a REAL local Supabase: the catalog and weekly hours persist in real tables, edits go through RLS,
// the preview is computed by the real slot engine from the saved rules, and tenants cannot touch each other's data.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");

const PW = "Correct-Horse-Battery-9";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const unique = (p: string) => `${p}+${Date.now()}${Math.floor(Math.random() * 1e4)}@example.com`;
const TZ = "Asia/Jerusalem";
const localDate = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

async function signUpAndOnboard(page: Page, email: string, kind = "trainer", name = "בדיקת קטלוג") {
  await page.goto("/auth/sign-up");
  await page.getByLabel("אימייל").fill(email);
  await page.getByLabel("סיסמה", { exact: true }).fill(PW);
  await page.getByLabel("אימות סיסמה").fill(PW);
  await page.getByRole("button", { name: "יצירת חשבון" }).click();
  await page.goto(extractLink((await waitForMail(email)).html, "/auth/confirm"));
  await page.getByLabel("שם העסק").fill(name);
  await page.getByLabel("טלפון ליצירת קשר").fill("050-1234567");
  await page.getByLabel("סוג העסק").selectOption(kind);
  for (let i = 0; i < 3; i++) await page.getByTestId("continue").click();
  await expect(page.getByTestId("done-title")).toBeVisible();
}

async function clientFor(email: string): Promise<SupabaseClient> {
  const c = createClient(URL_, KEY, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  expect(error).toBeNull();
  return c;
}

test.describe("catalog + weekly hours persist (CAT, AVL, ACC-01)", () => {
  test("onboarding writes real services, a default resource and the split-day windows", async ({ page }) => {
    const email = unique("cat1");
    await signUpAndOnboard(page, email, "trainer");
    const db = await clientFor(email);
    const services = (await db.from("services").select("name, duration_minutes, price_cents, active").order("position")).data!;
    expect(services.map((s) => s.name)).toEqual(["אימון אישי", "אימון זוגי", "אימון קבוצתי"]);
    expect(services[0]).toMatchObject({ duration_minutes: 60, price_cents: 20000, active: true });
    const resources = (await db.from("resources").select("kind, is_default")).data!;
    expect(resources).toEqual([{ kind: "business", is_default: true }]);
    const sunday = (await db.from("availability_rules").select("start_minute, end_minute").eq("weekday", 0).order("start_minute")).data!;
    expect(sunday).toEqual([{ start_minute: 360, end_minute: 600 }, { start_minute: 1020, end_minute: 1260 }]); // 06–10 and 17–21
    expect((await db.from("availability_rules").select("id").eq("weekday", 6)).data).toEqual([]); // Saturday closed
  });

  test("services page: add, validate, duplicate, edit, archive and restore — UI and DB agree", async ({ page }) => {
    const email = unique("cat2");
    await signUpAndOnboard(page, email, "barber");
    await page.goto("/settings/services");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("שירותים");
    const db = await clientFor(email);

    // client-side validation: nothing is sent
    await page.getByTestId("add-service").click();
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByText("יש להזין שם (לפחות 2 תווים).")).toBeVisible();
    await expect(page.getByText("יש להזין מחיר תקין.")).toBeVisible();

    // create
    await page.getByLabel("שם השירות").fill("טיפול שורש בדיקה");
    await page.getByLabel("מחיר (₪)").fill("175");
    await page.getByLabel("משך").selectOption("45");
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("status").filter({ hasText: "השירות נשמר." })).toBeVisible();
    const row = page.getByTestId("service-list").getByRole("listitem").filter({ hasText: "טיפול שורש בדיקה" });
    await expect(row).toContainText("45 דק׳");
    let saved = (await db.from("services").select("id, price_cents, duration_minutes").eq("name", "טיפול שורש בדיקה").single()).data!;
    expect(saved).toMatchObject({ price_cents: 17500, duration_minutes: 45 });

    // duplicate active name → friendly message, nothing created
    await page.getByTestId("add-service").click();
    await page.getByLabel("שם השירות").fill("טיפול שורש בדיקה");
    await page.getByLabel("מחיר (₪)").fill("10");
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByTestId("service-error")).toHaveText("כבר יש שירות פעיל בשם הזה.");
    expect((await db.from("services").select("id").eq("name", "טיפול שורש בדיקה")).data).toHaveLength(1);
    await page.getByRole("button", { name: "ביטול" }).click();

    // edit price
    await page.getByRole("button", { name: "עריכה · טיפול שורש בדיקה" }).click();
    await page.getByLabel("מחיר (₪)").fill("190");
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(row).toContainText("190");
    saved = (await db.from("services").select("id, price_cents, duration_minutes").eq("name", "טיפול שורש בדיקה").single()).data!;
    expect(saved.price_cents).toBe(19000);

    // archive → moves to the archive list and is inactive in the DB; restore brings it back
    await page.getByRole("button", { name: "העברה לארכיון · טיפול שורש בדיקה" }).click();
    await expect(page.getByTestId("archived-list")).toContainText("טיפול שורש בדיקה");
    await expect(page.getByTestId("service-list")).not.toContainText("טיפול שורש בדיקה");
    expect((await db.from("services").select("active").eq("id", saved.id).single()).data!.active).toBe(false);
    await page.getByRole("button", { name: "שחזור · טיפול שורש בדיקה" }).click();
    await expect(page.getByTestId("service-list")).toContainText("טיפול שורש בדיקה");
    expect((await db.from("services").select("active").eq("id", saved.id).single()).data!.active).toBe(true);
  });

  test("hours page: overlap is blocked before saving; saving rewrites the rules; exceptions drive the preview", async ({ page }) => {
    const email = unique("cat3");
    await signUpAndOnboard(page, email, "barber");
    const db = await clientFor(email);
    await page.goto("/settings/hours");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("שעות פעילות");
    await expect(page.getByTestId("save-hours")).toBeDisabled(); // nothing changed yet

    // overlap inside one day: inline message, Save disabled
    await page.getByTestId("hours-0").getByRole("button", { name: "הוספת טווח שעות" }).click();
    await page.getByLabel("משעה ראשון טווח 2").selectOption("10:00");
    await expect(page.getByTestId("hours-0").getByText("הטווחים חופפים.").first()).toBeVisible();
    await expect(page.getByTestId("save-hours")).toBeDisabled();

    // fix it: second window 14:00–17:00 (barber Sunday is 09–18, so first window must end before it)
    await page.getByLabel("עד שעה ראשון טווח 1").selectOption("12:00");
    await page.getByLabel("משעה ראשון טווח 2").selectOption("14:00");
    await page.getByLabel("עד שעה ראשון טווח 2").selectOption("17:00");
    await expect(page.getByTestId("save-hours")).toBeEnabled();
    // and close Thursday
    await page.getByRole("switch", { name: "פתוח ביום חמישי" }).click();
    await page.getByTestId("save-hours").click();
    await expect(page.getByRole("status").filter({ hasText: "השעות נשמרו." })).toBeVisible();

    const sunday = (await db.from("availability_rules").select("start_minute, end_minute").eq("weekday", 0).order("start_minute")).data!;
    expect(sunday).toEqual([{ start_minute: 540, end_minute: 720 }, { start_minute: 840, end_minute: 1020 }]);
    expect((await db.from("availability_rules").select("id").eq("weekday", 4)).data).toEqual([]);
    expect((await db.from("audit_log").select("action").eq("action", "availability.replaced")).data).toHaveLength(1);

    // exceptions: close a whole day and open a special Saturday
    const closedDay = localDate(3);
    await page.getByLabel("תאריך").fill(closedDay);
    await page.getByTestId("add-exception").click();
    await expect(page.getByTestId(`exception-${closedDay}`)).toContainText("סגור כל היום");

    // the preview is the real engine over the saved rules: every future day agrees with an independent computation
    const { data: rules } = await db.from("availability_rules").select("weekday, start_minute, end_minute");
    const { data: exc } = await db.from("availability_exceptions").select("id, on_date, kind, start_minute, end_minute, note");
    const svc = (await db.from("services").select("duration_minutes, buffer_minutes").eq("active", true).order("position").limit(1).single()).data!;
    await page.reload();
    for (let i = 1; i < 14; i++) {
      const date = localDate(i);
      const expected = slotsForDay({ date, timeZone: TZ, rules: rowsToRules(rules!), exceptions: rowsToExceptions(exc as never), durationMinutes: svc.duration_minutes, bufferMinutes: svc.buffer_minutes, stepMinutes: 30, now: new Date() }).length;
      await expect(page.getByTestId(`preview-${date}`), date).toHaveAttribute("data-free", String(expected));
    }
    await expect(page.getByTestId(`preview-${closedDay}`)).toContainText("סגור"); // the exception shows up as a closed day
    await expect(page.getByTestId(`preview-${closedDay}`)).toHaveAttribute("data-free", "0");

    // removing the exception reopens the day
    await page.getByRole("button", { name: `הסרה · ${closedDay}` }).click();
    await expect(page.getByTestId("exceptions-empty")).toBeVisible();
  });

  test("a special opening on a weekly-closed day creates slots only for that window", async ({ page }) => {
    const email = unique("cat4");
    await signUpAndOnboard(page, email, "teacher"); // teacher: Fri/Sat closed
    const db = await clientFor(email);
    // next Saturday (weekday 6) at least 2 days ahead
    let sat = 2;
    while (new Date(`${localDate(sat)}T12:00:00Z`).getUTCDay() !== 6) sat++;
    const date = localDate(sat);
    await page.goto("/settings/hours");
    await expect(page.getByTestId("preview-days")).toBeVisible();
    await page.getByLabel("תאריך").fill(date);
    await page.getByLabel("סוג").selectOption("open");
    await page.getByLabel("משעה", { exact: true }).selectOption("10:00");
    await page.getByLabel("עד שעה", { exact: true }).selectOption("12:00");
    await page.getByTestId("add-exception").click();
    await expect(page.getByTestId(`exception-${date}`)).toContainText("פתוח 10:00–12:00");
    const exc = (await db.from("availability_exceptions").select("kind, start_minute, end_minute").eq("on_date", date)).data!;
    expect(exc).toEqual([{ kind: "open", start_minute: 600, end_minute: 720 }]);
    await page.reload();
    if (sat < 14) {
      // the weekly-closed Saturday now has slots, all inside 10:00–12:00, and its ribbon exists
      await expect(page.getByTestId(`preview-${date}`)).not.toHaveAttribute("data-free", "0");
      await expect(page.getByTestId(`preview-${date}`).getByRole("img")).toContainText("");
    }
  });
});

test.describe("tenant isolation on the catalog tables (SEC-01/02)", () => {
  test("owner B with a valid JWT cannot read, change, create or delete anything of A", async ({ browser }) => {
    const emailA = unique("catA");
    const emailB = unique("catB");
    for (const [e, n] of [[emailA, "עסק א קטלוג"], [emailB, "עסק ב קטלוג"]] as const) {
      const ctx = await browser.newContext({ locale: "he-IL" });
      const page = await ctx.newPage();
      await signUpAndOnboard(page, e, "barber", n);
      await ctx.close();
    }
    const a = await clientFor(emailA);
    const b = await clientFor(emailB);
    const aBiz = (await a.from("businesses").select("id")).data![0].id as string;
    const aSvc = (await a.from("services").select("id").limit(1).single()).data!.id as string;
    const aRes = (await a.from("resources").select("id").single()).data!.id as string;
    const bBiz = (await b.from("businesses").select("id")).data![0].id as string;

    for (const table of ["services", "availability_rules", "availability_exceptions", "resources"] as const) {
      expect((await b.from(table).select("*").eq("business_id", aBiz)).data, `${table} read`).toEqual([]);
    }
    expect((await b.from("services").update({ price_cents: 1 }).eq("id", aSvc).select()).data ?? []).toEqual([]);
    expect((await b.from("services").delete().eq("id", aSvc).select()).data ?? []).toEqual([]);
    expect((await a.from("services").select("price_cents").eq("id", aSvc).single()).data!.price_cents).not.toBe(1);
    expect((await b.from("services").insert({ business_id: aBiz, name: "זדוני", duration_minutes: 30, price_cents: 100 })).error?.code).toBe("42501");
    expect((await b.from("availability_rules").insert({ business_id: aBiz, resource_id: aRes, weekday: 3, start_minute: 600, end_minute: 700 })).error).not.toBeNull();
    expect((await b.from("availability_exceptions").insert({ business_id: aBiz, resource_id: aRes, on_date: "2030-01-01", kind: "closed" })).error).not.toBeNull();
    expect((await b.rpc("replace_weekly_hours", { p_business: aBiz, p_hours: [] })).error?.code).toBe("42501");
    // privileged / immutable columns and the audit writer are closed even for one's own data
    expect((await b.from("services").update({ business_id: aBiz }).eq("business_id", bBiz)).error?.code).toBe("42501");
    expect((await b.from("resources").update({ is_default: false }).eq("business_id", bBiz)).error?.code).toBe("42501");
    expect((await b.rpc("audit_write", { p_business: aBiz, p_action: "forged" })).error).not.toBeNull();
    expect((await a.from("audit_log").select("action").eq("action", "forged")).data).toEqual([]);

    const anon = createClient(URL_, KEY, { auth: { persistSession: false } });
    for (const table of ["services", "availability_rules", "availability_exceptions", "resources"] as const) {
      expect((await anon.from(table).select("*")).error?.code, table).toBe("42501");
    }
    expect((await a.from("services").select("id")).data!.length).toBeGreaterThan(0); // A still sees their own catalog
  });
});
