import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { admin, customer, fakeIp, firstDayWithSlots, loginAs, makeBusiness, publicBook } from "./helpers/business";
import { byType, drain, idle, mail, rows } from "./helpers/outbox";
import { ACCEPTED } from "./helpers/terms";

// Visual integrity of every waitlist screen (customer and owner) at phone and desktop width, with screenshots for a human look.
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

async function check(page: Page, where: string, shot: string) {
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${where}: overflow`).toBeLessThanOrEqual(0);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main *, header *")]
      .filter((e) => !e.closest("[data-testid=whoami]") && !e.closest(".sr-only") && !e.matches("[class*=truncate], [class*=truncate] *") && e.scrollWidth > e.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(e).overflowX) && (e.textContent ?? "").trim().length > 0 && !e.querySelector("svg, [role=img]"))
      .slice(0, 5)
      .map((e) => `${e.tagName}: "${(e.textContent ?? "").trim().slice(0, 40)}"`),
  );
  expect(clipped, `${where}: clipped text`).toEqual([]);
  expect((await axe(page)).violations.map((v) => `${v.id} (${v.nodes.length})`), `${where}: axe`).toEqual([]);
  await page.screenshot({ path: `test-results/shots/wl-${shot}-${page.viewportSize()!.width}.png`, fullPage: true });
}

test("customer waitlist screens are balanced at every state", async ({ page, request }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() });
  const b = await makeBusiness("barber");
  const f = await firstDayWithSlots(request, b);
  const a = await publicBook(request, b, f.date, f.times[0], 1, 0, mail());

  // from the booking page: the hint appears once a service is chosen
  await page.goto(`/book/${b.slug}`);
  await page.getByTestId(`service-${b.services[0].id}`).check({ force: true });
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("waitlist-hint")).toBeVisible();
  await check(page, "booking day step with waitlist hint", "0-day-hint");
  await page.getByTestId("waitlist-link").click();
  await expect(page).toHaveURL(new RegExp(`/book/${b.slug}/waitlist\\?service=`));
  await expect(page.getByTestId("wl-service")).toHaveValue(b.services[0].id); // preselected

  await check(page, "join form", "1-join");
  await page.getByTestId("wl-submit").click(); // empty submit: every problem next to its field
  await expect(page.getByText("שדה חובה.").first()).toBeVisible();
  await page.getByTestId("wl-phone").fill("12");
  await page.getByTestId("wl-email").fill("nope");
  await page.getByTestId(`wl-day-${f.date}`).check({ force: true });
  await page.getByTestId("wl-name").fill("שם-ארוך-מאוד-של-ממתין-שלא-נגמר-אף-פעם-ולא-נשבר-בשום-מקום-כלל");
  await page.getByTestId("wl-submit").click();
  await expect(page.getByText("מספר הטלפון אינו תקין.")).toBeVisible();
  await check(page, "join form with errors", "2-join-errors");
  await page.getByTestId("wl-phone").fill("050-7776655");
  await page.getByTestId("wl-email").fill(mail());
  await page.getByTestId("wl-from").fill("09:00");
  await page.getByTestId("wl-to").fill("12:00");
  await page.getByTestId("wl-submit").click();
  await expect(page.getByTestId("waitlist-done")).toBeVisible();
  await check(page, "joined", "3-joined");

  // status page: waiting → offer → booked
  await page.getByTestId("waitlist-manage-link").click();
  await expect(page.getByTestId("wl-headline")).toHaveText("אתם ברשימת ההמתנה");
  await check(page, "status: waiting", "4-waiting");
  expect((await b.db.rpc("transition_appointment", { p_id: a.id, p_action: "cancel" })).error).toBeNull();
  await page.reload();
  await expect(page.getByTestId("wl-headline")).toHaveText("התפנה תור בשבילכם!");
  await check(page, "status: offer", "5-offer");
  await page.getByTestId("wl-accept").click();
  await expect(page.getByTestId("wl-headline")).toHaveText("התור נקבע");
  await check(page, "status: booked", "6-booked");
  await page.goto("/waitlist/garbage");
  await check(page, "invalid link", "7-invalid");
  await page.goto(`/book/no-such-${Date.now()}/waitlist`);
  expect(await page.getByTestId("booking-closed").count() + (await page.getByRole("heading").count())).toBeGreaterThan(0);
  await drain(request, async () => idle(await rows(b)) && byType(await rows(b), "booking_confirmed").length >= 1);
});

test("the removed-from-list state and the leave confirmation are balanced", async ({ page, request }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() });
  const b = await makeBusiness("barber");
  const f = await firstDayWithSlots(request, b);
  await publicBook(request, b, f.date, f.times[0], 1, 0, mail());
  const joined = await request.post(`/api/public/${b.slug}/waitlist`, { data: { serviceId: b.services[0].id, date: f.date, acceptedTerms: ACCEPTED, customer: { fullName: "נועם לוי", phone: customer(600).phone, email: mail() } }, headers: { "x-forwarded-for": fakeIp() } });
  await page.goto((await joined.json()).manageUrl);
  await page.getByTestId("wl-leave").click();
  await check(page, "leave confirmation", "8-leave-confirm");
  await page.getByTestId("wl-leave-confirm").click();
  await expect(page.getByTestId("wl-headline")).toHaveText("הוסרתם מהרשימה");
  await check(page, "status: removed", "9-removed");
});

test("the owner's waitlist panel is balanced with long names, windows and a live offer", async ({ page, request }) => {
  const b = await makeBusiness("barber");
  const f = await firstDayWithSlots(request, b);
  const a = await publicBook(request, b, f.date, f.times[0], 1, 0, mail());
  const mk = (n: number, name: string, win?: { from: string; to: string }) =>
    request.post(`/api/public/${b.slug}/waitlist`, { data: { serviceId: b.services[0].id, date: f.date, ...(win ? { window: win } : {}), acceptedTerms: ACCEPTED, customer: { fullName: name, phone: customer(700 + n).phone, email: mail() } }, headers: { "x-forwarded-for": fakeIp() } });
  expect((await mk(1, "שם-ארוך-מאוד-של-ממתין-שלא-נגמר-אף-פעם-ולא-נשבר-בשום-מקום-כלל")).status()).toBe(201);
  expect((await mk(2, "דנה כהן", { from: "10:00", to: "13:00" })).status()).toBe(201);
  expect((await mk(3, "יוסי ביטון")).status()).toBe(201);
  expect((await b.db.rpc("transition_appointment", { p_id: a.id, p_action: "cancel" })).error).toBeNull(); // the first in line holds a live offer now
  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  await page.getByTestId("day-input").fill(f.date);
  await expect(page.getByTestId("waitlist-count")).toHaveText("3");
  await expect(page.locator('[data-status="offered"]')).toHaveCount(1);
  await check(page, "owner dashboard with waitlist", "10-owner");
  await page.getByTestId(`wl-offer-${(await admin().from("waitlist_entries").select("id").eq("business_id", b.id).eq("status", "waiting").limit(1).single()).data!.id}`).click();
  await check(page, "owner offer dialog", "11-owner-dialog");
});
