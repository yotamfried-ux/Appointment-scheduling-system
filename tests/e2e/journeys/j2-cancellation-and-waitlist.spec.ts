import { expect, test } from "@playwright/test";
import { admin, fakeIp, loginAs, makeBusiness, sql } from "../helpers/business";
import { byType, drain, mail, rows } from "../helpers/outbox";
import { axe, customerBooksViaPage, customerOnPhone, noOverflow, ownerAtDesk } from "./world";
import { ACCEPTED } from "../helpers/terms";

// JOURNEY 2 — three customers and one popular slot. A books, B joins the waitlist for that day, A cancels, B is offered the slot by mail and accepts, C cannot take it.
// Crosses: booking page · waitlist form · cancellation link · transactional offer · mail outbox · single-use links · the owner's calendar and notifications.
test.use({ actionTimeout: 20_000 });
const linkIn = (text: string) => text.match(/https?:\/\/\S+\/waitlist\/[\w.-]+/)![0];

test("A books · B waits · A cancels · B is offered and accepts · C is refused · the owner sees it all", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const b = await makeBusiness("barber");
  sql(`update public.businesses set cancel_until_hours = 0 where id='${b.id}'`); // evening runs: the first free time is tomorrow morning, inside the default 24h cancel/reschedule window, so the customer-side buttons would be missing
  const A = await customerOnPhone(browser, baseURL!), B = await customerOnPhone(browser, baseURL!), C = await customerOnPhone(browser, baseURL!);
  const desk = await ownerAtDesk(browser, baseURL!);
  const aMail = mail(), bMail = mail();

  const a = await test.step("A books the first slot on her phone", () => customerBooksViaPage(A.page, b.slug, { name: "אור א׳", phone: "050-7770001", email: aMail }));
  const apptA = (await admin().from("appointments").select("id").eq("business_id", b.id).single()).data!;

  await test.step("B finds nothing she likes that day and joins the waitlist from her phone", async () => {
    await B.page.goto(`/book/${b.slug}/waitlist`);
    await B.page.getByTestId("wl-service").selectOption({ index: 1 });
    await B.page.getByTestId(`wl-day-${a.date}`).check({ force: true }); // the day is suggested; nothing to remember
    await B.page.getByTestId("wl-name").fill("בר ב׳");
    await B.page.getByTestId("wl-phone").fill("050-7770002");
    await B.page.getByTestId("wl-email").fill(bMail);
    await noOverflow(B.page);
    expect((await axe(B.page)).violations).toEqual([]);
    await B.page.getByTestId("wl-submit").click();
    await expect(B.page.getByTestId("waitlist-done")).toBeVisible();
    await expect(B.page.getByTestId("waitlist-manage-link")).toBeVisible();
  });
  expect((await admin().from("waitlist_entries").select("status").eq("business_id", b.id).single()).data!.status).toBe("waiting");

  await test.step("A changes her mind and cancels with her private link", async () => {
    await A.page.goto(a.manageUrl);
    await A.page.getByTestId("cancel-start").click();
    await A.page.getByTestId("cancel-confirm").click();
    await expect(A.page.getByTestId("manage-cancelled")).toBeVisible();
    expect((await admin().from("appointments").select("status").eq("id", apptA.id).single()).data!.status).toBe("cancelled_by_customer");
  });

  const offerText = await test.step("the slot goes to B (the only one waiting) and she is told by mail, with a link that is not a booking link", async () => {
    await drain(desk.page.request, async () => byType(await rows(b), "waitlist_offer").some((r) => r.status === "sent") && byType(await rows(b), "owner_customer_cancelled").some((r) => r.status === "sent") && byType(await rows(b), "booking_cancelled_by_customer").some((r) => r.status === "sent"));
    const rs = await rows(b);
    const offer = byType(rs, "waitlist_offer")[0];
    expect(offer.preview!.subject).not.toContain(b.services[0].name);
    expect(offer.preview!.text).not.toContain("/booking/");
    expect(byType(rs, "owner_customer_cancelled")[0].recipient).toBe("owner");
    return offer.preview!.text;
  });

  await test.step("while the offer is open nobody else can grab the slot (C gets a clean conflict, not an error)", async () => {
    const res = await C.page.request.post(`/api/public/${b.slug}/bookings`, {
      data: { serviceId: b.services[0].id, date: a.date, time: a.time, location: "business", acceptedTerms: ACCEPTED, customer: { fullName: "גל ג׳", phone: "0507770003", email: mail() }, intake: {} },
      headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `j2-c-${Math.random().toString(36).slice(2)}` },
    });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.code).toBe("SLOT_TAKEN");
  });

  await test.step("B opens the link from her mail and accepts; she now holds the appointment", async () => {
    await B.page.goto(linkIn(offerText));
    await expect(B.page.getByTestId("wl-headline")).toHaveText("התפנה תור בשבילכם!");
    await noOverflow(B.page);
    await B.page.getByTestId("wl-accept").click();
    await expect(B.page.getByTestId("wl-headline")).toHaveText("התור נקבע");
    const held = (await admin().from("appointments").select("status, starts_at, customers(full_name)").eq("business_id", b.id).in("status", ["confirmed", "pending"])).data!;
    expect(held).toHaveLength(1);
    expect((held[0].customers as unknown as { full_name: string }).full_name).toBe("בר ב׳");
    expect(new Date(held[0].starts_at).toISOString()).toBe(sql(`select to_char((select starts_at from public.appointments where id='${apptA.id}') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"')`)); // the very slot A released
    expect((await admin().from("waitlist_entries").select("status").eq("business_id", b.id).single()).data!.status).toBe("booked");
  });

  await test.step("A's old link shows the cancelled state and cannot do anything more; the owner's calendar shows B", async () => {
    await A.page.goto(a.manageUrl);
    await expect(A.page.getByTestId("manage-cancelled")).toBeVisible();
    await expect(A.page.getByTestId("cancel-start")).toHaveCount(0);
    await expect(A.page.getByTestId("manage-reschedule")).toHaveCount(0);
    await loginAs(desk.page, b.ownerEmail);
    await desk.page.getByTestId("day-input").fill(a.date);
    await expect(desk.page.getByText("בר ב׳")).toBeVisible();
    await drain(desk.page.request, async () => byType(await rows(b), "booking_confirmed").some((r) => r.status === "sent"));
  });
  for (const x of [A, B, C, desk]) await x.ctx.close();
});
