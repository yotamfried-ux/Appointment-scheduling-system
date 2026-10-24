import { expect, test } from "@playwright/test";
import { admin, fakeIp, firstDayWithSlots, loginAs, makeBusiness, sql } from "../helpers/business";
import { mail } from "../helpers/outbox";
import { customerBooksViaPage, customerOnPhone, noOverflow, ownerAtDesk } from "./world";
import { ACCEPTED } from "../helpers/terms";

// JOURNEY 4 — the trial ends and the owner has not paid yet, then she pays. What customers, the owner's data and every other module do at each stage.
// Crosses: billing state · public booking page · customers' private links · owner calendar and exports · checkout (fake provider) · webhook.
test.use({ actionTimeout: 20_000 });
const state = (id: string) => sql(`select status || '/' || plan_id from public.subscriptions where business_id='${id}'`);

test("trial ends → bookings close but nothing is lost → the owner pays through checkout → everything reopens → a failed card gives a grace period", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const b = await makeBusiness("barber");
  const desk = await ownerAtDesk(browser, baseURL!);
  const phone = await customerOnPhone(browser, baseURL!);
  const newcomer = await customerOnPhone(browser, baseURL!);

  const booked = await test.step("during the trial a customer books normally", async () => {
    const r = await customerBooksViaPage(phone.page, b.slug, { name: "רות ר׳", phone: "050-4440001", email: mail() });
    await expect(phone.page.getByTestId("done-status")).toHaveText("מאושר");
    return r;
  });
  await loginAs(desk.page, b.ownerEmail);
  const origin = new URL(desk.page.url()).origin;
  const f = await firstDayWithSlots(desk.page.request, b);

  await test.step("the trial ends without payment", async () => {
    sql(`update public.subscriptions set trial_ends_at = now() - interval '1 minute' where business_id='${b.id}'`);
  });

  await test.step("a newcomer opens the booking page and is told, kindly, that the business is not taking new bookings right now", async () => {
    await newcomer.page.goto(`/book/${b.slug}`);
    await expect(newcomer.page.getByTestId("bookings-closed")).toBeVisible();
    await noOverflow(newcomer.page);
    const r = await newcomer.page.request.post(`/api/public/${b.slug}/bookings`, { data: { serviceId: b.services[0].id, date: f.date, time: f.times[5], location: "business", acceptedTerms: ACCEPTED, customer: { fullName: "חדש", phone: "0504440002", email: mail() }, intake: {} }, headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `j4-${Math.random().toString(36).slice(2)}` } });
    expect(r.status()).toBe(409);
    expect((await r.json()).error.code).toBe("BOOKINGS_CLOSED");
  });

  await test.step("the existing customer's appointment is untouched and her link still works", async () => {
    await phone.page.goto(booked.manageUrl);
    await expect(phone.page.getByTestId("manage-status")).toHaveText("מאושר");
    expect((await phone.page.request.get(`${booked.manageUrl}/calendar`)).status()).toBe(200);
  });

  await test.step("the owner sees a clear banner; her data is all there; adding and exporting are blocked with 'payment required', not hidden or deleted", async () => {
    await desk.page.goto("/dashboard");
    await expect(desk.page.getByTestId("billing-banner")).toHaveAttribute("data-state", "degraded");
    await noOverflow(desk.page);
    await desk.page.goto("/customers");
    await expect(desk.page.getByText("רות ר׳")).toBeVisible();
    const add = await desk.page.request.post("/api/owner/appointments", { data: { serviceId: b.services[0].id, date: f.date, time: f.times[2], customer: { fullName: "ידני", phone: "0504440003" } }, headers: { origin } });
    expect(add.status()).toBe(402);
    expect((await desk.page.request.get("/api/owner/export/customers")).status()).toBe(402);
    expect(sql(`select count(*) from public.appointments where business_id='${b.id}'`)).toBe("1");
  });

  await test.step("the owner picks a plan and pays in the (fake) checkout; the page shows 'processing' and then 'active' on its own", async () => {
    await desk.page.goto("/settings/billing");
    await desk.page.getByTestId("choose-pro").click();
    await desk.page.getByTestId("fake-delay").selectOption("3000");
    await desk.page.getByTestId("fake-pay").click();
    await expect(desk.page.getByTestId("billing-processing")).toBeVisible();
    expect(state(b.id)).not.toBe("active/pro"); // the page alone does not make her active; only the provider's message does
    await expect(desk.page.getByTestId("billing-state")).toHaveText("פעיל", { timeout: 20_000 });
    expect(state(b.id)).toBe("active/pro");
  });

  await test.step("everything reopens by itself: the newcomer books, the owner exports and adds appointments", async () => {
    await newcomer.page.goto(`/book/${b.slug}`);
    await expect(newcomer.page.getByTestId("bookings-closed")).toHaveCount(0);
    await customerBooksViaPage(newcomer.page, b.slug, { name: "נועה נ׳", phone: "050-4440004", email: mail() }, { nthTime: 2 });
    expect((await desk.page.request.get("/api/owner/export/customers")).status()).toBe(200);
    const add = await desk.page.request.post("/api/owner/appointments", { data: { serviceId: b.services[0].id, date: f.date, time: f.times[7], customer: { fullName: "ידני", phone: "0504440005" } }, headers: { origin } });
    expect(add.status()).toBe(201);
    await desk.page.goto("/dashboard");
    await expect(desk.page.getByTestId("billing-banner")).toHaveCount(0);
  });

  await test.step("later a card fails: a grace period with a banner, and customers can still book (the owner is not punished at once)", async () => {
    await desk.page.goto("/settings/billing");
    await desk.page.getByTestId("choose-starter").click();
    await desk.page.getByTestId("fake-fail").click();
    await expect(desk.page.getByTestId("billing-state")).toHaveText("בעיה בתשלום", { timeout: 20_000 });
    await desk.page.goto("/dashboard");
    await expect(desk.page.getByTestId("billing-banner")).toHaveAttribute("data-state", "grace");
    await newcomer.page.goto(`/book/${b.slug}`);
    await expect(newcomer.page.getByTestId("bookings-closed")).toHaveCount(0);
    expect((await admin().from("appointments").select("id").eq("business_id", b.id)).data).toHaveLength(3); // nothing was lost along the way
  });

  for (const x of [desk, phone, newcomer]) await x.ctx.close();
});
