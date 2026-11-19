import { devices, expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { admin, firstDayWithSlots, loginAs, makeBusiness, todayLocal, type TestBusiness } from "../e2e/helpers/business";
import { acceptedStorageState } from "../e2e/helpers/terms";

const origin = "http://127.0.0.1:3175";
const outputDirectory = process.env.TORI_CAPTURE_DIR;
const localDatabase = new Set(["http://127.0.0.1:54321", "http://localhost:54321"]);
const customer = "נועה לביא";

test.beforeAll(() => {
  if (
    !outputDirectory || !process.env.E2E_REAL_SUPABASE || process.env.VERCEL_ENV === "production" ||
    !localDatabase.has(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "") ||
    process.env.EMAIL_PROVIDER !== "fake" || process.env.BILLING_PROVIDER !== "fake" ||
    process.env.OUTBOX_KICK !== "0"
  ) throw new Error("Use scripts/recording/capture.sh with a local Supabase stack.");
});

function hold(milliseconds = 900) {
  // Editorial dwell time. Assertions and locator waits handle application readiness.
  return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

async function click(locator: Locator) {
  await hold(550);
  await locator.click();
}

async function choose(page: Page, testId: string) {
  await click(page.locator("label").filter({ has: page.getByTestId(testId) }));
}

async function newContext(browser: Browser, sequence: number, name?: string, mobile = false) {
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1920, height: 1080 };
  const context = await browser.newContext({
    ...(mobile ? devices["Pixel 7"] : {}),
    viewport,
    deviceScaleFactor: 1,
    baseURL: origin,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    storageState: acceptedStorageState(origin),
    extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${sequence}` },
    ...(name ? { recordVideo: { dir: join(outputDirectory!, "playwright-video"), size: viewport } } : {}),
  });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === origin || localDatabase.has(url.origin) ? route.continue() : route.abort("blockedbyclient");
  });
  return context;
}

async function scene(browser: Browser, sequence: number, name: string, run: (page: Page, context: BrowserContext) => Promise<void>, mobile = false) {
  const context = await newContext(browser, sequence, name, mobile);
  const page = await context.newPage();
  const video = page.video()!;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await run(page, context);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await hold(2400);
  } finally {
    await context.close();
  }
  await mkdir(join(outputDirectory!, "webm"), { recursive: true });
  await video.saveAs(join(outputDirectory!, "webm", name + ".webm"));
}

async function pickTime(page: Page, business: TestBusiness, date: string) {
  await page.goto(`/book/${business.slug}`);
  await expect(page.getByTestId("business-name")).toBeVisible();
  await choose(page, `service-${business.services[0].id}`);
  await click(page.getByTestId("continue"));
  await choose(page, `day-${date}`);
  await click(page.getByTestId("continue"));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("באיזו שעה?");
}

async function book(page: Page, business: TestBusiness, date: string, time: string, mobile: boolean) {
  await pickTime(page, business, date);
  await choose(page, `time-${time}`);
  await click(page.getByTestId("continue"));
  await page.getByLabel("שם מלא").fill(mobile ? "אורי רז" : customer);
  await hold(420);
  await page.getByLabel("טלפון נייד").fill(mobile ? "050-5550102" : "050-5550101");
  await hold(420);
  await page.getByLabel("אימייל").fill(mobile ? "mobile@example.com" : "booking@example.com");
  const response = page.waitForResponse(r => r.request().method() === "POST" &&
    new URL(r.url()).pathname === `/api/public/${business.slug}/bookings`);
  await click(page.getByTestId("continue"));
  const created = await response;
  expect(created.status()).toBe(201);
  const { booking } = await created.json();
  await expect(page.getByTestId("done-status")).toHaveText("מאושר");
  const saved = await business.db.from("appointments").select("id,status,reference").eq("id", booking.id).single();
  expect(saved.error).toBeNull();
  expect(saved.data).toEqual({ id: booking.id, status: "confirmed", reference: booking.reference });
  return { id: booking.id as string, reference: booking.reference as string, path: (await page.getByTestId("manage-link").getAttribute("href"))! };
}

test.use({
  launchOptions: process.env.TORI_CHROMIUM_PATH ? { executablePath: process.env.TORI_CHROMIUM_PATH } : {},
});

test("record five isolated Tori scenes using the real booking, calendar and hours screens", async ({ browser, request }) => {
  const business = await makeBusiness("barber");
  expect((await business.db.from("businesses").update({ name: "סטודיו אלון · עסק לדוגמה" }).eq("id", business.id)).error).toBeNull();
  const { date, times } = await firstDayWithSlots(request, business);
  expect(times.length).toBeGreaterThan(1);
  let appointment!: Awaited<ReturnType<typeof book>>;

  await test.step("desktop booking", async () => {
    await scene(browser, 41, "booking-desktop", async page => {
      appointment = await book(page, business, date, times[0], false);
    });
  });

  // Sign the demo owner in before creating any recording contexts.
  const owner = await newContext(browser, 42);
  let ownerCookies: Awaited<ReturnType<BrowserContext["cookies"]>>;
  try {
    await loginAs(await owner.newPage(), business.ownerEmail);
    ownerCookies = await owner.cookies();
  } finally {
    await owner.close();
  }

  await test.step("the same appointment appears in the owner's calendar", async () => {
    await scene(browser, 43, "calendar-owner", async (page, context) => {
      await context.addCookies(ownerCookies);
      await page.goto("/dashboard");
      await expect(page.getByTestId("agenda-title")).toBeVisible();
      await hold();
      await page.getByTestId("day-input").fill(date);
      const row = page.getByTestId(`row-${appointment.id}`);
      await expect(row).toContainText(customer);
      await expect(row).toContainText(times[0]);
      await expect(row).toHaveAttribute("data-status", "confirmed");
      await row.scrollIntoViewIfNeeded();
    });
  });

  await test.step("a working-hours change affects public slots", async () => {
    const hoursBusiness = await makeBusiness("barber");
    expect((await hoursBusiness.db.from("businesses").update({ name: "סטודיו אלון · עסק לדוגמה" }).eq("id", hoursBusiness.id)).error).toBeNull();
    const sunday = Array.from({ length: 8 }, (_, i) => todayLocal(i + 1))
      .find(day => new Date(day + "T12:00:00Z").getUTCDay() === 0)!;
    const slots = async () => {
      const reply = await request.get(`/api/public/${hoursBusiness.slug}/slots?service=${hoursBusiness.services[0].id}&date=${sunday}`);
      expect(reply.ok()).toBeTruthy();
      return (await reply.json()).slots as { time: string }[];
    };
    const before = await slots();
    expect(before.some(slot => slot.time >= "12:00")).toBe(true);
    const desk = await newContext(browser, 44);
    let cookies: Awaited<ReturnType<BrowserContext["cookies"]>>;
    try {
      await loginAs(await desk.newPage(), hoursBusiness.ownerEmail);
      cookies = await desk.cookies();
    } finally {
      await desk.close();
    }
    await scene(browser, 45, "availability-settings", async (page, context) => {
      await context.addCookies(cookies);
      await page.goto("/settings/hours");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("שעות פעילות");
      await hold(1200);
      const closing = page.getByTestId("manual-to-0-0");
      await closing.scrollIntoViewIfNeeded();
      await closing.fill("12:00");
      await click(page.getByTestId("save-hours"));
      await expect(page.getByRole("status").filter({ hasText: "השעות נשמרו." })).toBeVisible();
      await expect.poll(async () => (await slots()).length).toBeLessThan(before.length);
      expect((await slots()).every(slot => slot.time < "12:00")).toBe(true);
      await hold(1300);
      await pickTime(page, hoursBusiness, sunday);
      await expect(page.getByTestId("time-12:00")).toHaveCount(0);
      await expect(page.getByTestId("time-09:00")).toBeAttached();
    });
  });

  await test.step("real customer confirmation and manage page", async () => {
    await scene(browser, 46, "confirmation-preview", async page => {
      // This route is the customer confirmation record. No worker or transport is invoked.
      await page.goto(appointment.path);
      await expect(page.getByTestId("manage-status")).toHaveText("מאושר");
      await expect(page.getByTestId("manage-reference")).toContainText(appointment.reference);
      await expect(page.getByTestId("manage-panel")).toContainText("סטודיו אלון");
    });
  });

  await test.step("mobile booking", async () => {
    await scene(browser, 47, "booking-mobile", async page => {
      await book(page, business, date, times[1], true);
    }, true);
  });
  const delivered = await admin().from("notification_log").select("id", { count: "exact", head: true }).eq("status", "sent");
  expect(delivered.error).toBeNull();
  expect(delivered.count).toBe(0);
});
