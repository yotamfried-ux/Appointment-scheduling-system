import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import * as C from "../../lib/api/contracts";
import { firstDayWithSlots, loginAs, makeBusiness, publicBook, todayLocal } from "./helpers/business";

// "Dana's day": a business owner on the real dashboard — decide on requests, add a walk-in, cancel, close out visits.
// Real stack end to end (browser → /api/owner → RLS → Postgres), checked against the database and the public API.
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const publicTimes = async (page: Page, slug: string, serviceId: string, date: string) =>
  C.SlotsResponse.parse(await (await page.request.get(`/api/public/${slug}/slots?service=${serviceId}&date=${date}`)).json()).slots.map((s) => s.time);

test.describe("owner dashboard (real stack)", () => {
  test("approvals inbox: requests from any day, approve / reject, double click acts once, rejected slot returns to the public", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const b = await makeBusiness("clinic");
    const f = await firstDayWithSlots(page.request, b);
    const a1 = await publicBook(page.request, b, f.date, f.times[0], 1);
    const a2 = await publicBook(page.request, b, f.date, f.times[2], 2);
    const a3 = await publicBook(page.request, b, f.date, f.times[4], 3);
    await loginAs(page, b.ownerEmail);
    await page.goto(`/dashboard`);
    await page.getByTestId("day-input").fill(f.date);
    await expect(page.getByTestId("approvals-count")).toHaveText("3");
    await expect(page.getByTestId(`approval-${a1.id}`)).toContainText("לקוח בדיקה 1");
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);

    await page.getByRole("button", { name: "אישור · לקוח בדיקה 1" }).click();
    await expect(page.getByTestId(`approval-${a1.id}`)).toHaveCount(0);
    await expect(page.getByTestId(`row-${a1.id}`)).toHaveAttribute("data-status", "confirmed");
    await expect.poll(async () => (await b.db.from("appointments").select("status").eq("id", a1.id)).data![0].status).toBe("confirmed"); // the UI moves first; the database is the truth

    await page.getByRole("button", { name: "דחייה · לקוח בדיקה 2" }).click();
    await expect(page.getByTestId(`approval-${a2.id}`)).toHaveCount(0);
    await expect.poll(async () => (await b.db.from("appointments").select("status").eq("id", a2.id)).data![0].status).toBe("cancelled_by_business");
    expect(await publicTimes(page, b.slug, b.services[0].id, f.date)).toContain(f.times[2]); // the slot is public again

    await page.getByRole("button", { name: "אישור · לקוח בדיקה 3" }).dblclick(); // a nervous double click
    await expect(page.getByTestId(`row-${a3.id}`)).toHaveAttribute("data-status", "confirmed");
    await expect(page.getByTestId("approvals-empty")).toBeVisible();
    await expect(page.getByTestId("approvals-count")).toHaveText("0");
    expect(errors).toEqual([]);
  });

  test("a walk-in: add from a free gap, flagged outside opening hours, conflicts explained, then cancel frees the slot", async ({ page }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(page.request, b);
    await loginAs(page, b.ownerEmail);
    await page.goto("/dashboard");
    await page.getByTestId("day-input").fill(f.date);
    // the input shows the agenda's own date, so this waits for the NEW day to be loaded (the title of today's agenda is visible all along; clicking "add" on it would book today)
    await expect(page.getByTestId("day-input")).toHaveValue(f.date);
    await expect(page.getByTestId("agenda-title")).toBeVisible();

    // from a free gap: the time is prefilled
    await page.getByRole("button", { name: "הוספת תור" }).first().click();
    await expect(page.getByTestId("manual-time")).not.toHaveValue("");
    const time = await page.getByTestId("manual-time").inputValue();
    await page.getByTestId("manual-service").selectOption({ index: 1 });
    await page.getByTestId("manual-name").fill("יעל בר");
    await page.getByTestId("manual-phone").fill("052-1234567");
    await page.getByTestId("manual-note").fill("הגיעה בלי תור");
    expect((await axe(page)).violations).toEqual([]);
    await page.getByTestId("manual-submit").click();
    await expect(page.getByTestId("manual-form")).toHaveCount(0);
    const row = page.locator('[data-testid^="row-"]').filter({ hasText: "יעל בר" });
    await expect(row).toContainText("ידני");
    await expect(row).toContainText("הגיעה בלי תור");
    await expect(row).toHaveAttribute("data-status", "confirmed");
    expect(await publicTimes(page, b.slug, b.services[0].id, f.date)).not.toContain(time);

    // the same time again: the server refuses, the dialog says why and nothing is created
    await page.getByTestId("new-appointment").click();
    await page.getByTestId("manual-service").selectOption({ index: 1 });
    await page.getByTestId("manual-time").fill(time);
    await page.getByTestId("manual-name").fill("עוד אחד");
    await page.getByTestId("manual-phone").fill("052-7654321");
    await page.getByTestId("manual-submit").click();
    await expect(page.getByTestId("manual-error")).toHaveText("בשעה הזו כבר יש תור.");
    await expect(page.getByLabel("שם הלקוח")).toHaveValue("עוד אחד"); // nothing lost
    // invalid phone is reported on the field itself
    await page.getByTestId("manual-time").fill("23:00");
    await page.getByTestId("manual-phone").fill("12");
    await page.getByTestId("manual-submit").click();
    await expect(page.getByText("מספר הטלפון אינו תקין.")).toBeVisible();
    await page.getByTestId("manual-phone").fill("052-7654321");
    await page.getByTestId("manual-submit").click();
    await expect(page.getByTestId("manual-form")).toHaveCount(0);
    await expect(page.locator('[data-testid^="row-"]').filter({ hasText: "עוד אחד" })).toContainText("מחוץ לשעות הפעילות");
    const rows = (await b.db.from("appointments").select("source, out_of_availability").eq("business_id", b.id)).data!;
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.out_of_availability)).toHaveLength(1);

    // cancel needs a second, explicit step
    const id = (await row.getAttribute("data-testid"))!.replace("row-", "");
    await page.getByTestId(`cancel-${id}`).click();
    expect((await b.db.from("appointments").select("status").eq("id", id)).data![0].status).toBe("confirmed"); // asking is not cancelling
    await page.getByTestId(`cancel-yes-${id}`).click();
    await expect(page.getByTestId(`row-${id}`)).toHaveCount(0);
    await expect.poll(async () => (await b.db.from("appointments").select("status").eq("id", id)).data![0].status).toBe("cancelled_by_business");
    expect(await publicTimes(page, b.slug, b.services[0].id, f.date)).toContain(time);
  });

  test("closing out the visits: a started appointment is marked no-show; the status is saved and cannot be repeated", async ({ page }) => {
    const b = await makeBusiness("barber");
    await loginAs(page, b.ownerEmail);
    await page.goto("/dashboard");
    const tz = "Asia/Jerusalem";
    const earlier = new Date(Date.now() - 3 * 3600_000);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(earlier);
    const get = (t: string) => parts.find((p) => p.type === t)!.value;
    // 3 hours ago (may be yesterday just after midnight): the owner records a visit that already happened
    await page.getByTestId("new-appointment").click();
    await page.getByTestId("manual-service").selectOption({ index: 1 });
    await page.getByTestId("manual-date").fill(`${get("year")}-${get("month")}-${get("day")}`);
    await page.getByTestId("manual-time").fill(`${get("hour")}:${get("minute")}`);
    await page.getByTestId("manual-name").fill("דוד מזרחי");
    await page.getByTestId("manual-phone").fill("050-9990000");
    await page.getByTestId("manual-submit").click();
    await expect(page.getByTestId("manual-form")).toHaveCount(0);
    if (`${get("year")}-${get("month")}-${get("day")}` !== todayLocal(0)) await page.getByTestId("day-prev").click();
    const row = page.locator('[data-testid^="row-"]').filter({ hasText: "דוד מזרחי" });
    await expect(row).toBeVisible();
    const id = (await row.getAttribute("data-testid"))!.replace("row-", "");
    await expect(page.getByTestId(`cancel-${id}`)).toHaveCount(0); // it started: cancelling makes no sense
    await page.getByTestId(`noshow-${id}`).click();
    await expect(page.getByTestId(`row-${id}`)).toHaveAttribute("data-status", "noShow");
    await expect(page.getByTestId(`noshow-${id}`)).toHaveCount(0);
    await expect.poll(async () => (await b.db.from("appointments").select("status").eq("id", id)).data![0].status).toBe("no_show");
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
  });

  test("day navigation: previous / next / today / date picker, and a failed load can be retried", async ({ page }) => {
    const b = await makeBusiness("barber");
    await loginAs(page, b.ownerEmail);
    await page.goto("/dashboard");
    const title = page.getByTestId("agenda-title");
    await expect(page.getByTestId("day-today")).toBeDisabled();
    const first = await title.innerText();
    await page.getByTestId("day-next").click();
    await expect(title).not.toHaveText(first);
    await expect(page.getByTestId("day-today")).toBeEnabled();
    await page.getByTestId("day-prev").click();
    await expect(title).toHaveText(first);
    await page.getByTestId("day-input").fill(todayLocal(9));
    await expect(page.getByTestId("day-today")).toBeEnabled();
    await page.getByTestId("day-today").click();
    await expect(title).toHaveText(first);
    // a failing API shows an error with retry, not a blank page
    await page.route("**/api/owner/appointments*", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "x", requestId: "req_1" } }) }));
    await page.reload();
    await expect(page.getByTestId("agenda-load-error")).toBeVisible();
    await page.unroute("**/api/owner/appointments*");
    await page.getByRole("button", { name: "ניסיון חוזר" }).click();
    await expect(page.getByTestId("agenda-title")).toBeVisible();
  });

  test("a rejected decision rolls back to the server truth (stale tab)", async ({ page, browser }) => {
    const b = await makeBusiness("clinic");
    const f = await firstDayWithSlots(page.request, b);
    const a = await publicBook(page.request, b, f.date, f.times[0], 1);
    await loginAs(page, b.ownerEmail);
    await page.goto("/dashboard");
    await page.getByTestId("day-input").fill(f.date);
    await expect(page.getByTestId(`approval-${a.id}`)).toBeVisible();
    // the same owner decides in another tab first
    const other = await (await browser.newContext({ storageState: await page.context().storageState() })).newPage();
    await other.goto("/dashboard");
    expect((await other.request.post(`/api/owner/appointments/${a.id}/transition`, { data: { action: "reject" }, headers: { origin: new URL(page.url()).origin } })).status()).toBe(200);
    await page.getByRole("button", { name: "אישור · לקוח בדיקה 1" }).click();
    await expect(page.getByText("התור כבר השתנה. היומן רוענן.", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`approval-${a.id}`)).toHaveCount(0);
    expect((await b.db.from("appointments").select("status").eq("id", a.id)).data![0].status).toBe("cancelled_by_business"); // the stale click changed nothing
  });
});
