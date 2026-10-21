import { expect, test, type Page } from "@playwright/test";
import { byType, drain, mail, rows } from "./helpers/outbox";
import { admin, firstDayWithSlots, loginAs, makeBusiness, publicBook, sql } from "./helpers/business";

// RSC-04 (the owner moves a booking) and RSC-03 (a customer changes the service while moving, only if the business allows it).
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
type Booked = { id: string; manageUrl: string };
const row = async (id: string) => (await admin().from("appointments").select("status, starts_at, ends_at, price_cents, service_id, service_snapshot, moved_by_business_at, rescheduled_count").eq("id", id).single()).data!;

test.describe("the owner moves a booking (RSC-04)", () => {
  test("from the calendar: same booking, customer mailed, the customer may decline even though the cancellation window has passed; a taken time is refused", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const other = (await publicBook(request, b, f.date, f.times[5], 2, 0, mail())) as unknown as Booked;
    const a = (await publicBook(request, b, f.date, f.times[0], 1, 0, mail())) as unknown as Booked;
    sql(`update public.businesses set cancel_until_hours = 720 where id='${b.id}'`); // 30 days: an ordinary customer could no longer cancel
    const before = await row(a.id);
    await loginAs(page, b.ownerEmail);
    await page.goto("/dashboard");
    await page.getByTestId("day-input").fill(f.date);

    // a taken time is refused with a clear message and nothing changes
    await page.getByTestId(`move-${a.id}`).click();
    await expect(page.getByTestId("move-form")).toBeVisible();
    await page.getByTestId("move-time").fill(f.times[5]);
    await page.getByTestId("move-submit").click();
    await expect(page.getByTestId("move-error")).toBeVisible();
    expect((await row(a.id)).starts_at).toBe(before.starts_at);

    // a free time on another day
    const target = await firstDayWithSlots(request, b, 1);
    await page.getByTestId("move-date").fill(target.date);
    await page.getByTestId("move-time").fill(target.times[2]);
    await page.getByTestId("move-submit").click();
    await expect(page.getByTestId("move-form")).toHaveCount(0);
    const after = await row(a.id);
    expect(after.starts_at).not.toBe(before.starts_at);
    expect(after.moved_by_business_at).not.toBeNull();
    expect(after.status).toBe("confirmed");
    expect((await admin().from("appointments").select("id").eq("business_id", b.id)).data).toHaveLength(2); // moved, not duplicated
    expect(sql(`select count(*) from public.audit_log where business_id='${b.id}' and action='appointment.moved'`)).toBe("1");

    await drain(request, async () => byType(await rows(b), "booking_moved_by_business").some((r) => r.status === "sent"));
    const sent = byType(await rows(b), "booking_moved_by_business");
    expect(sent).toHaveLength(1);
    expect(sent[0].preview!.text).toContain("בלי שום תנאי");

    // the customer sees why, and can decline although the window has passed
    await page.context().clearCookies();
    await page.goto(a.manageUrl);
    await expect(page.getByTestId("manage-moved")).toBeVisible();
    await noOverflow(page);
    await page.getByTestId("cancel-start").click();
    await page.getByTestId("cancel-confirm").click();
    await expect(page.getByTestId("manage-cancelled")).toBeVisible();
    // control: a booking nobody moved is still bound by the window
    await page.goto(other.manageUrl);
    await expect(page.getByTestId("manage-too-late")).toBeVisible();
    await expect(page.getByTestId("cancel-start")).toHaveCount(0);
  });
});

test.describe("the customer changes the service while moving (RSC-03)", () => {
  test("only when the business switched it on; the length, price and snapshot follow the new service", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const a = (await publicBook(request, b, f.date, f.times[0], 1, 0, mail())) as unknown as Booked;
    const [s0, s1] = b.services;
    const len = (id: string) => Number(sql(`select duration_minutes from public.services where id='${id}'`));
    expect(len(s1.id)).not.toBe(len(s0.id)); // the fixture has services of different lengths, otherwise this test proves nothing

    // off by default: no choice is offered, and the API refuses a forged request
    await page.goto(`${a.manageUrl}/reschedule`);
    await expect(page.getByTestId("resched-service")).toHaveCount(0);
    await loginAs(page, b.ownerEmail);
    await page.goto("/settings/booking");
    await page.getByTestId("rules-service-change").check();
    await page.getByTestId("rules-save").click();
    await expect(page.getByTestId("rules-status")).toHaveText("נשמר.");

    await page.context().clearCookies();
    await page.goto(`${a.manageUrl}/reschedule`);
    await expect(page.getByTestId("resched-service")).toBeVisible();
    await noOverflow(page);
    await page.getByTestId("resched-service").selectOption(s1.id);
    const days = page.locator('[data-testid^="resched-day-"]');
    await expect(days.first()).toBeVisible();
    await days.nth(1).click();
    await page.locator('[data-testid^="resched-time-"]').first().click();
    await page.getByTestId("resched-confirm").click();
    await expect(page).toHaveURL(new RegExp(`${a.manageUrl}$`));
    const after = await row(a.id);
    expect(after.service_id).toBe(s1.id);
    expect((Date.parse(after.ends_at) - Date.parse(after.starts_at)) / 60000).toBe(len(s1.id));
    expect(after.service_snapshot).toMatchObject({ name: s1.name, durationMinutes: len(s1.id) });
    expect(after.price_cents).toBe(Number(sql(`select price_cents from public.services where id='${s1.id}'`)));
    await expect(page.getByTestId("manage-status")).toBeVisible();
    await expect(page.getByText(s1.name)).toBeVisible();
  });

});
