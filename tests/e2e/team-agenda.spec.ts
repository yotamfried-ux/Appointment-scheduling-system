import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { kindHours } from "../../lib/lab/onboarding";
import { admin, firstDayWithSlots, loginAs, makeBusiness, publicBook } from "./helpers/business";

// Stage 16 / TEAM-08, 09, 11 in the owner's agenda: everyone on one day, a filter per person, the person on each row, move to another person, orphaned appointments flagged.
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const personOf = async (id: string) => (await admin().from("appointments").select("resource_id").eq("id", id).single()).data!.resource_id as string;

async function teamBusiness() {
  const b = await makeBusiness("barber");
  const first = (await admin().from("resources").select("id").eq("business_id", b.id).single()).data!.id as string;
  expect((await b.db.rpc("update_staff", { p_resource: first, p_name: "דנה", p_active: null })).error).toBeNull();
  const noam = (await b.db.rpc("create_staff", { p_business: b.id, p_name: "נועם" })).data as string;
  expect((await b.db.rpc("set_staff_hours", { p_resource: noam, p_hours: kindHours("barber") })).error).toBeNull();
  return { b, dana: first, noam };
}

test("one day, two people: everyone by default, the person on each row, a filter per person, no overflow", async ({ page, request }) => {
  const { b, dana, noam } = await teamBusiness();
  const f = await firstDayWithSlots(request, b);
  const a1 = await publicBook(request, b, f.date, f.times[0], 1); // whoever: the first position (Dana)
  const a2 = await publicBook(request, b, f.date, f.times[0], 2); // same time: Noam
  expect([await personOf(a1.id), await personOf(a2.id)].sort()).toEqual([dana, noam].sort());
  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  await page.getByTestId("day-input").fill(f.date);
  await expect(page.getByTestId("person-filter")).toBeVisible();
  await expect(page.getByTestId(`row-${a1.id}`)).toBeVisible();
  await expect(page.getByTestId(`row-${a2.id}`)).toBeVisible();
  await expect(page.getByTestId(`person-of-${a1.id}`)).toHaveText(/דנה|נועם/);
  await noOverflow(page);
  await page.waitForTimeout(500);
  expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
  await page.screenshot({ path: `test-results/shots/team-agenda-${page.viewportSize()!.width}.png`, fullPage: true });

  // filter: only that person's appointments
  await page.getByTestId(`filter-${noam}`).click();
  await expect(page.getByTestId("filter-" + noam)).toHaveAttribute("aria-pressed", "true");
  const noamAppt = (await personOf(a1.id)) === noam ? a1 : a2;
  const danaAppt = noamAppt === a1 ? a2 : a1;
  await expect(page.getByTestId(`row-${noamAppt.id}`)).toBeVisible();
  await expect(page.getByTestId(`row-${danaAppt.id}`)).toHaveCount(0);
  await page.getByTestId("filter-all").click();
  await expect(page.getByTestId(`row-${danaAppt.id}`)).toBeVisible();
});

test("the owner moves an appointment to another person: a busy person is refused, a free one works", async ({ page, request }) => {
  const { b, dana, noam } = await teamBusiness();
  const f = await firstDayWithSlots(request, b);
  const a1 = await publicBook(request, b, f.date, f.times[0], 1);
  const a2 = await publicBook(request, b, f.date, f.times[0], 2); // both people busy at times[0]
  const mine = (await personOf(a1.id)) === dana ? a1 : a2;
  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  await page.getByTestId("day-input").fill(f.date);
  await page.getByTestId(`move-${mine.id}`).click();
  await expect(page.getByTestId("move-person")).toBeVisible();
  await page.getByTestId("move-person").selectOption(noam); // Noam is busy at that time with the other customer
  await page.getByTestId("move-submit").click();
  await expect(page.getByTestId("move-error")).toBeVisible();
  expect(await personOf(mine.id)).toBe(dana); // refused: nothing changed
  await page.getByTestId("move-time").fill(f.times[3]); // Noam is free then
  await page.getByTestId("move-submit").click();
  await expect(page.getByTestId("move-form")).toHaveCount(0);
  expect(await personOf(mine.id)).toBe(noam);
  expect((await admin().from("appointments").select("resource_chosen").eq("id", mine.id).single()).data!.resource_chosen).toBe(true);
});

test("a person who is switched off keeps their future appointments and the agenda says so; a manual booking can name the person", async ({ page, request }) => {
  const { b, noam } = await teamBusiness();
  const f = await firstDayWithSlots(request, b);
  const named = await request.post(`/api/public/${b.slug}/bookings`, {
    data: { serviceId: b.services[0].id, date: f.date, time: f.times[0], location: "business", personId: noam, customer: { fullName: "יעל", phone: "+972501234571" }, intake: {} },
    headers: { "x-forwarded-for": "10.7.7.7", "idempotency-key": `idem-${Math.random().toString(36).slice(2)}-orph` },
  });
  expect(named.status()).toBe(201);
  const id = (await named.json()).booking.id as string;
  expect((await b.db.rpc("update_staff", { p_resource: noam, p_name: null, p_active: false })).error).toBeNull();
  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  await expect(page.getByTestId("orphans")).toBeVisible();
  await expect(page.getByTestId(`orphan-open-${id}`)).toBeVisible();
  expect(await personOf(id)).toBe(noam); // nothing moved silently
  await noOverflow(page);
  expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
  await page.getByTestId(`orphan-open-${id}`).click();
  await expect(page.getByTestId(`row-${id}`)).toBeVisible();
  // with one active person left the agenda is the plain single calendar again (no filter), and the manual dialog has no person field
  await expect(page.getByTestId("person-filter")).toHaveCount(0);
  await page.getByTestId("new-appointment").click();
  await expect(page.getByTestId("manual-person")).toHaveCount(0);
});

test("a manual booking can name the person", async ({ page, request }) => {
  const { b, noam } = await teamBusiness();
  const f = await firstDayWithSlots(request, b);
  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  await page.getByTestId("day-input").fill(f.date);
  await page.getByTestId("new-appointment").click();
  await page.getByTestId("manual-service").selectOption(b.services[0].id);
  await page.getByTestId("manual-person").selectOption(noam);
  await page.getByTestId("manual-time").fill(f.times[1]);
  await page.getByTestId("manual-name").fill("דני");
  await page.getByTestId("manual-phone").fill("050-7654321");
  await page.getByTestId("manual-submit").click();
  await expect(page.getByTestId("manual-form")).toHaveCount(0);
  const row = (await admin().from("appointments").select("resource_id, resource_chosen, source").eq("business_id", b.id).single()).data!;
  expect(row).toEqual({ resource_id: noam, resource_chosen: true, source: "manual" });
});
