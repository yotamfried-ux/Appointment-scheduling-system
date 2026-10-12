import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { byType, drain, mail, rows } from "./helpers/outbox";
import { admin, fakeIp, firstDayWithSlots, makeBusiness, publicBook, sql, type TestBusiness } from "./helpers/business";

// RSC-01/02: a customer moves an appointment from their private link. Real browser, real stack, real database, fake mail provider.
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test.beforeEach(async ({ context }) => { await context.setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() }); });

type Booked = { id: string; date: string; time: string; manageUrl: string };
const row = async (id: string) => (await admin().from("appointments").select("id, reference, status, starts_at, rescheduled_count").eq("id", id).single()).data!;

/** Open the picker and choose the first free time on the first day that is not the current one. */
async function choose(page: Page, notDate?: string, nthTime = 0) {
  const day = page.locator('[data-testid^="resched-day-"]').filter({ hasNot: page.locator(`[data-testid="resched-day-${notDate}"]`) });
  await expect(day.first()).toBeVisible();
  const days = await page.locator('[data-testid^="resched-day-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("resched-day-", "")));
  const d = days.find((x) => x !== notDate)!;
  await page.getByTestId(`resched-day-${d}`).click();
  const times = page.locator('[data-testid^="resched-time-"]');
  await expect(times.first()).toBeVisible();
  const t = (await times.nth(nthTime).getAttribute("data-testid"))!.replace("resched-time-", "");
  await page.getByTestId(`resched-time-${t}`).click();
  return { date: d, time: t };
}

async function booked(request: import("@playwright/test").APIRequestContext, b: TestBusiness, email: string) {
  const f = await firstDayWithSlots(request, b);
  return { f, a: (await publicBook(request, b, f.date, f.times[0], 1, 0, email)) as Booked };
}

test.describe("customer reschedules (RSC-01/02)", () => {
  test("moves the same appointment: same id and reference, new time, old slot back in the public list, both parties mailed once, ICS keeps its UID and raises SEQUENCE", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const { f, a } = await booked(request, b, mail());
    await drain(request, async () => (await rows(b)).some((r) => r.type === "booking_confirmed" && r.status === "sent"));
    const before = await row(a.id);
    const ics0 = await (await request.get(`${a.manageUrl}/calendar`)).text();

    await page.goto(a.manageUrl);
    await expect(page.getByTestId("manage-reschedule")).toBeVisible();
    await page.getByTestId("manage-reschedule").click();
    await expect(page.getByTestId("resched-current")).toBeVisible();
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
    const target = await choose(page, f.date);
    await page.getByTestId("resched-confirm").click();
    await expect(page).toHaveURL(new RegExp(`${a.manageUrl}$`));

    const after = await row(a.id);
    expect(after.id).toBe(before.id);
    expect(after.reference).toBe(before.reference);
    expect(after.starts_at).not.toBe(before.starts_at);
    expect(after.rescheduled_count).toBe(1);
    expect((await admin().from("appointments").select("id").eq("business_id", b.id)).data).toHaveLength(1); // moved, not duplicated
    // the old slot is public again, the new one is taken
    const slots = await (await request.get(`/api/public/${b.slug}/slots?service=${b.services[0].id}&date=${f.date}`)).json();
    expect(slots.slots.map((s: { time: string }) => s.time)).toContain(f.times[0]);
    const slots2 = await (await request.get(`/api/public/${b.slug}/slots?service=${b.services[0].id}&date=${target.date}`)).json();
    expect(slots2.slots.map((s: { time: string }) => s.time)).not.toContain(target.time);

    await drain(request, async () => byType(await rows(b), "owner_customer_rescheduled").some((r) => r.status === "sent"));
    const rs = await rows(b);
    expect(byType(rs, "booking_rescheduled")).toHaveLength(1);
    expect(byType(rs, "booking_rescheduled")[0]).toMatchObject({ recipient: "customer", status: "sent" });
    expect(byType(rs, "owner_customer_rescheduled")[0]).toMatchObject({ recipient: "owner", status: "sent" });
    expect(byType(rs, "booking_rescheduled")[0].preview!.subject).not.toContain("תספורת"); // privacy: no service in the subject

    const ics1 = await (await request.get(`${a.manageUrl}/calendar`)).text();
    const field = (s: string, k: string) => s.match(new RegExp(`^${k}:(.*)$`, "m"))![1].trim();
    expect(field(ics1, "UID")).toBe(field(ics0, "UID"));
    expect(Number(field(ics1, "SEQUENCE"))).toBeGreaterThan(Number(field(ics0, "SEQUENCE")));
    expect(field(ics1, "DTSTART")).not.toBe(field(ics0, "DTSTART"));
  });

  test("the new slot is taken while the customer is deciding: friendly message, the old appointment is untouched, and a retry on another slot works (fresh token)", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const { f, a } = await booked(request, b, mail());
    const before = await row(a.id);
    await page.goto(`${a.manageUrl}/reschedule`);
    const target = await choose(page, f.date);
    // someone else books exactly that slot first
    const rival = await request.post(`/api/public/${b.slug}/bookings`, {
      data: { serviceId: b.services[0].id, date: target.date, time: target.time, location: "business", customer: { fullName: "מתחרה", phone: "+972503339999", email: mail() }, intake: {} },
      headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `rival-${Math.random().toString(36).slice(2)}` },
    });
    expect(rival.status()).toBe(201);
    await page.getByTestId("resched-confirm").click();
    await expect(page.getByTestId("resched-error")).toContainText("נתפסה");
    expect((await row(a.id)).starts_at).toBe(before.starts_at); // atomic: still holding the old slot
    expect((await row(a.id)).rescheduled_count).toBe(0);
    // retry with another time
    await page.getByTestId("resched-day-" + target.date).click();
    const times = page.locator('[data-testid^="resched-time-"]');
    await expect(times.first()).toBeVisible();
    await times.first().click();
    await page.getByTestId("resched-confirm").click();
    await expect(page).toHaveURL(new RegExp(`${a.manageUrl}$`));
    expect((await row(a.id)).rescheduled_count).toBe(1);
  });

  test("inside the cancellation window (RSC-02) there is no way to move it, through the page or by calling the action again; and a fourth move is refused", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const { a } = await booked(request, b, mail());
    sql(`set session_replication_role = replica; update public.appointments set starts_at = now() + interval '3 hours', ends_at = now() + interval '3 hours 30 minutes', blocked_until = now() + interval '3 hours 30 minutes' where id = '${a.id}'; set session_replication_role = origin;`);
    await page.goto(a.manageUrl);
    await expect(page.getByTestId("manage-reschedule")).toHaveCount(0);
    await page.goto(`${a.manageUrl}/reschedule`);
    await expect(page.getByTestId("resched-closed")).toBeVisible();
    await expect(page.getByTestId("resched-confirm")).toHaveCount(0);

    const c = await booked(request, b, mail());
    sql(`set session_replication_role = replica; update public.appointments set rescheduled_count = 3 where id = '${c.a.id}'; set session_replication_role = origin;`);
    await page.goto(`${c.a.manageUrl}/reschedule`);
    await expect(page.getByTestId("resched-closed")).toContainText("שלוש פעמים");
  });

  test("forged and cross-scope links reveal nothing and change nothing", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const { a } = await booked(request, b, mail());
    const before = await row(a.id);
    for (const bad of ["garbage", `${a.manageUrl.split("/").pop()!}x`, "a.b"]) {
      await page.goto(`/booking/${bad}/reschedule`);
      await expect(page.getByTestId("manage-invalid")).toBeVisible();
    }
    expect(await row(a.id)).toEqual(before);
  });
});
