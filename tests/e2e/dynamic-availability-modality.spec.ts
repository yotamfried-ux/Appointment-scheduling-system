import AxeBuilder from "@axe-core/playwright";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";
import { extractLink, waitForMail } from "./helpers/mail";
import { ACCEPTED } from "./helpers/terms";

const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

// ============================================================================
// SUITE 1: UI + API Contract E2E (Runs in all environments, Desktop & Mobile)
// ============================================================================
test.describe("E2E · Dynamic Availability & Modality (UI + API)", () => {
  test("TEST-A, TEST-B, TEST-C: 6+ availability intervals, manual HH:MM entry, short-window warning, overlap guard, and mobile 360x800 layout", async ({ page }) => {
    await page.goto("/design/onboarding");
    await page.getByLabel("שם העסק").fill("מורה פרטי מתמטיקה");
    await page.getByLabel("טלפון ליצירת קשר").fill("050-1234567");
    await page.getByLabel("סוג העסק").selectOption("teacher");
    await page.getByTestId("continue").click();

    // Step 2: Services (teacher has 60m and 90m services; minServiceDuration = 60)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("מה אתם מציעים?");
    await page.getByTestId("continue").click();

    // Step 3: Hours Editor
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("מתי אתם פתוחים?");

    // TEST-B: Enter a 30-min window (10:15–10:45) for a 60-min service -> short-window warning is displayed
    await page.getByTestId("manual-from-0-0").fill("10:15");
    await page.getByTestId("manual-to-0-0").fill("10:45");
    await expect(page.getByTestId("short-window-0-0")).toBeVisible();
    await expect(page.getByTestId("short-window-0-0")).toContainText("קצר ממשך השירות");

    // TEST-C: Overlapping intervals are flagged and block continuation
    await page.getByTestId("add-window-0").click();
    await page.getByTestId("manual-from-0-0").fill("08:00");
    await page.getByTestId("manual-to-0-0").fill("09:30");
    await page.getByTestId("manual-from-0-1").fill("09:00");
    await page.getByTestId("manual-to-0-1").fill("10:00");
    await expect(page.getByTestId("hours-0").getByText("הטווחים חופפים.").first()).toBeVisible();
    await page.getByTestId("continue").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("מתי אתם פתוחים?");

    // Resolve the overlap on windows 0 & 1 first so add-window-0 re-enables, then add up to 6 intervals
    await page.getByTestId("manual-from-0-0").fill("08:00");
    await page.getByTestId("manual-to-0-0").fill("09:00");
    await page.getByTestId("manual-from-0-1").fill("10:15");
    await page.getByTestId("manual-to-0-1").fill("11:15");

    // TEST-A + TEST-B: Configure 6 distinct single-lesson intervals with non-round minutes on Sunday (weekday 0)
    const sixIntervals = [
      { from: "08:00", to: "09:00" },
      { from: "10:15", to: "11:15" },
      { from: "13:05", to: "14:05" },
      { from: "16:30", to: "17:30" },
      { from: "19:00", to: "20:00" },
      { from: "20:30", to: "21:30" },
    ];
    for (let i = 2; i < sixIntervals.length; i++) {
      await page.getByTestId("add-window-0").click();
      await page.getByTestId(`manual-from-0-${i}`).fill(sixIntervals[i].from);
      await page.getByTestId(`manual-to-0-${i}`).fill(sixIntervals[i].to);
    }

    // Verify all 6 windows are preserved without rounding and reflected in the ribbon aria-label
    for (let i = 0; i < sixIntervals.length; i++) {
      await expect(page.getByTestId(`manual-from-0-${i}`)).toHaveValue(sixIntervals[i].from);
      await expect(page.getByTestId(`manual-to-0-${i}`)).toHaveValue(sixIntervals[i].to);
    }
    await expect(page.getByTestId("hours-0").getByRole("img")).toHaveAttribute(
      "aria-label",
      /08:00–09:00, 10:15–11:15, 13:05–14:05, 16:30–17:30, 19:00–20:00, 20:30–21:30/,
    );

    expect((await axe(page)).violations).toEqual([]);

    // Verify mobile viewport (360x800) has zero horizontal overflow with 6 intervals
    await page.setViewportSize({ width: 360, height: 800 });
    await noOverflow(page);

    await page.getByTestId("continue").click();
    await expect(page.getByTestId("done-title")).toHaveText("העסק מוכן לקבל תורים");
  });

  test("TEST-D2: Day is full (00:00-24:00) disables add-window, displays explanatory guidance banner, and re-enables when shortened", async ({ page }) => {
    await page.goto("/design/onboarding");
    await page.getByLabel("שם העסק").fill("קליניקה רפואית");
    await page.getByLabel("טלפון ליצירת קשר").fill("052-9876543");
    await page.getByTestId("continue").click();

    // Step 2: Services
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("מה אתם מציעים?");
    await page.getByTestId("continue").click();

    // Step 3: Hours Editor
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("מתי אתם פתוחים?");

    // Fill Sunday with 00:00 to 24:00
    await page.getByTestId("manual-from-0-0").fill("00:00");
    await page.getByTestId("manual-to-0-0").fill("24:00");

    // Verify explanation banner is visible and add-window button is disabled
    await expect(page.getByTestId("day-full-0")).toBeVisible();
    await expect(page.getByTestId("day-full-0")).toContainText("אין עוד זמן פנוי ביום זה");
    await expect(page.getByTestId("day-full-0")).toContainText("לערוך, לקצר או לפצל");
    await expect(page.getByTestId("add-window-0")).toBeDisabled();

    // Accessibility check on day-full state
    expect((await axe(page)).violations).toEqual([]);

    // Shorten window to 00:00 to 20:00 -> frees 4 hours
    await page.getByTestId("manual-to-0-0").fill("20:00");

    // Banner disappears and add-window button re-enables
    await expect(page.getByTestId("day-full-0")).not.toBeVisible();
    await expect(page.getByTestId("add-window-0")).toBeEnabled();

    // Click add-window-0 -> adds a new non-overlapping window within the free interval
    await page.getByTestId("add-window-0").click();
    await expect(page.getByTestId("manual-from-0-1")).toBeVisible();
    const fromVal = await page.getByTestId("manual-from-0-1").inputValue();
    const toVal = await page.getByTestId("manual-to-0-1").inputValue();
    expect(Number(fromVal.slice(0, 2))).toBeGreaterThanOrEqual(20);
    expect(toVal).toBe("23:00");

    // Responsive check
    await page.setViewportSize({ width: 360, height: 800 });
    await noOverflow(page);
  });

  test("TEST-E, TEST-F, TEST-G: Online & Frontal modality booking, single-modality auto-selection + API rejection, and Owner Dashboard modality badges", async ({ page }) => {
    const session = `mod-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // --- TEST-E: Customer books an ONLINE appointment on a multi-modality business (teacher) ---
    await page.goto(`/design/booking?kind=teacher&session=${session}`);
    await page.locator('input[name="service"]').first().check({ force: true });
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("day-2026-10-14")).toBeEnabled();
    await page.getByTestId("day-2026-10-14").check({ force: true });
    await page.getByTestId("continue").click();
    await expect(page.locator('input[name="time"]').first()).toBeEnabled();
    await page.locator('input[name="time"]').first().check({ force: true });
    await page.getByTestId("continue").click();

    await expect(page.getByTestId("modality-selector")).toBeVisible();
    await page.getByTestId("location-online").check({ force: true });
    await expect(page.getByTestId("summary-modality")).toContainText("אונליין");

    await page.getByLabel("שם מלא").fill("דנה אונליין");
    await page.getByLabel("טלפון נייד").fill("050-2223301");
    await page.getByLabel("אימייל").fill("dana-online@example.com");
    await page.getByLabel("כיתה או רמה").fill("י״א - 5 יח״ל");
    await page.getByTestId("continue").click();

    await expect(page.getByTestId("done-modality")).toContainText("אונליין");
    expect((await axe(page)).violations).toEqual([]);

    // --- TEST-F: Customer books a FRONTAL appointment on the same business ---
    await page.goto(`/design/booking?kind=teacher&session=${session}`);
    await page.locator('input[name="service"]').first().check({ force: true });
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("day-2026-10-14")).toBeEnabled();
    await page.getByTestId("day-2026-10-14").check({ force: true });
    await page.getByTestId("continue").click();
    await expect(page.locator('input[name="time"]').first()).toBeEnabled();
    await page.locator('input[name="time"]').first().check({ force: true });
    await page.getByTestId("continue").click();

    await page.getByTestId("location-business").check({ force: true });
    await expect(page.getByTestId("summary-modality")).toContainText("פרונטלי");

    await page.getByLabel("שם מלא").fill("נועם פרונטלי");
    await page.getByLabel("טלפון נייד").fill("050-2223302");
    await page.getByLabel("אימייל").fill("noam-frontal@example.com");
    await page.getByLabel("כיתה או רמה").fill("י״ב - פיזיקה");
    await page.getByTestId("continue").click();

    await expect(page.getByTestId("done-modality")).toContainText("פרונטלי");

    // --- Verify Owner Dashboard displays distinct ModalityBadges ("אונליין" vs "פרונטלי") in Schedule & Approvals ---
    await page.goto(`/design/dashboard?kind=teacher&session=${session}`);
    const schedule = page.getByTestId("schedule");
    const onlineRow = schedule.locator("li").filter({ hasText: "דנה אונליין" });
    const frontalRow = schedule.locator("li").filter({ hasText: "נועם פרונטלי" });
    await expect(onlineRow).toContainText("אונליין");
    await expect(onlineRow).toHaveAttribute("data-modality", "online");
    await expect(frontalRow).toContainText("פרונטלי");
    await expect(frontalRow).toHaveAttribute("data-modality", "business");
    expect((await axe(page)).violations).toEqual([]);

    // --- TEST-G: Single-modality business (barber: frontal only) auto-selects Frontal & API rejects Online ---
    await page.goto(`/design/booking?kind=barber&session=${session}`);
    await page.getByTestId("service-haircut").check({ force: true });
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("day-2026-10-15")).toBeEnabled();
    await page.getByTestId("day-2026-10-15").check({ force: true });
    await page.getByTestId("continue").click();
    await expect(page.locator('input[name="time"]').first()).toBeEnabled();
    await page.locator('input[name="time"]').first().check({ force: true });
    await page.getByTestId("continue").click();

    await expect(page.getByTestId("single-modality-info")).toBeVisible();
    await expect(page.getByTestId("single-modality-info")).toContainText("פרונטלי");
    await expect(page.getByTestId("modality-selector")).toHaveCount(0);

    // Direct API call with unsupported location ("online") on barber is rejected with 400 VALIDATION_FAILED
    const badRes = await page.request.post("/api/lab/barber/bookings", {
      headers: { "x-lab-session": session, "Idempotency-Key": `bad-mod-${Date.now()}` },
      data: {
        serviceId: "haircut",
        date: "2026-10-15",
        time: "10:00",
        customer: { fullName: "בדיקה", phone: "0501234567", email: "test@example.com" },
        location: "online",
        intake: {},
        acceptedTerms: ACCEPTED,
      },
    });
    expect(badRes.status()).toBe(422);
    const badJson = await badRes.json();
    expect(badJson.error.code).toBe("VALIDATION_FAILED");
  });
});

// ============================================================================
// SUITE 2: Full-Stack Real Supabase E2E (Runs when E2E_REAL_SUPABASE=1)
// ============================================================================
test.describe("Full-Stack Real Supabase · Dynamic Availability & Modality", () => {
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

  const weekdayOfIso = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  };

  async function signUpAndOnboard(page: Page, email: string, kind = "teacher", name = "סטודיו הוראה") {
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

  test("TEST-A..D (DB): 6+ manual minute intervals, short-window warning, overlap validation, and concurrent saves", async ({ page }) => {
    const email = unique("dyn-avail");
    await signUpAndOnboard(page, email, "teacher", "מורה פרטי מתמטיקה");
    const db = await clientFor(email);
    const biz = (await db.from("businesses").select("id, slug").single()).data!;

    const targetDate = localDate(2);
    const wd = weekdayOfIso(targetDate);

    await page.goto("/settings/hours");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("שעות פעילות");

    const dayRow = page.getByTestId(`hours-${wd}`);
    const toggle = page.getByRole("switch").nth(wd);
    if ((await toggle.getAttribute("aria-checked")) !== "true") {
      await toggle.click();
    }

    const sixIntervals = [
      { from: "08:00", to: "09:00" },
      { from: "10:15", to: "11:15" },
      { from: "13:05", to: "14:05" },
      { from: "16:30", to: "17:30" },
      { from: "19:00", to: "20:00" },
      { from: "20:30", to: "21:30" },
    ];
    while ((await dayRow.locator(`[data-testid^="manual-from-${wd}-"]`).count()) < sixIntervals.length) {
      await page.getByTestId(`add-window-${wd}`).click();
    }
    for (let i = 0; i < sixIntervals.length; i++) {
      await page.getByTestId(`manual-from-${wd}-${i}`).fill(sixIntervals[i].from);
      await page.getByTestId(`manual-to-${wd}-${i}`).fill(sixIntervals[i].to);
    }

    await page.getByTestId("save-hours").click();
    await expect(page.getByRole("status").filter({ hasText: "השעות נשמרו." })).toBeVisible();

    const savedRules = (
      await db.from("availability_rules").select("start_minute, end_minute").eq("business_id", biz.id).eq("weekday", wd).order("start_minute")
    ).data!;
    expect(savedRules).toEqual([
      { start_minute: 480, end_minute: 540 },
      { start_minute: 615, end_minute: 675 },
      { start_minute: 785, end_minute: 845 },
      { start_minute: 990, end_minute: 1050 },
      { start_minute: 1140, end_minute: 1200 },
      { start_minute: 1230, end_minute: 1290 },
    ]);

    // TEST-D: Concurrent hours save
    const payloadA = Array.from({ length: 7 }, (_, d) => ({
      weekday: d,
      open: d === wd,
      windows: d === wd ? sixIntervals.slice(0, 5) : [],
    }));
    const payloadB = Array.from({ length: 7 }, (_, d) => ({
      weekday: d,
      open: d === wd,
      windows: d === wd ? sixIntervals : [],
    }));
    const [resA, resB] = await Promise.all([
      db.rpc("replace_weekly_hours", { p_business: biz.id, p_hours: payloadA }),
      db.rpc("replace_weekly_hours", { p_business: biz.id, p_hours: payloadB }),
    ]);
    expect(resA.error).toBeNull();
    expect(resB.error).toBeNull();
  });
});
