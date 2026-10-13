import { expect, test } from "@playwright/test";
import { admin, sql } from "../helpers/business";
import { auth, byType, drain, rows } from "../helpers/outbox";
import { axe, customerBooksViaPage, customerOnPhone, noOverflow, ownerAtDesk, ownerSignsUp, unique } from "./world";

// JOURNEY 1 — a salon owner joins, opens for business, gets her first customer, and the whole chain works together:
// sign-up mail → onboarding → publish → customer books on a phone → owner sees it → confirmation mail → reminder job → customer's private link
// (calendar file, reschedule) → the visit happens → owner closes it out → customers page, report and CSV all tell the same story.
test.use({ actionTimeout: 20_000 });

test("owner joins → first customer books on a phone → mail, reminder, reschedule → visit → reports and exports agree", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const owner = await ownerAtDesk(browser, baseURL!);
  const phone = await customerOnPhone(browser, baseURL!);
  const ownerEmail = unique("dana");
  const customerEmail = unique("yael");
  const NAME = "יעל כהן", PHONE = "052-3456789";

  const { slug } = await test.step("the owner signs up, verifies by mail, onboards and publishes", async () => {
    const r = await ownerSignsUp(owner.page, ownerEmail, "סלון דנה — ג׳ורני");
    await noOverflow(owner.page);
    return r;
  });
  const biz = (await admin().from("businesses").select("id, timezone").eq("slug", slug).single()).data!;
  sql(`update public.businesses set cancel_until_hours = 0 where id='${biz.id}'`); // evening runs: the first free time is tomorrow morning, inside the default 24h cancel/reschedule window, so the customer-side buttons would be missing

  const booking = await test.step("a customer finds the link on her phone and books", async () => {
    const b = await customerBooksViaPage(phone.page, slug, { name: NAME, phone: PHONE, email: customerEmail });
    await expect(phone.page.getByTestId("done-status")).toHaveText("מאושר");
    await noOverflow(phone.page);
    expect((await axe(phone.page)).violations).toEqual([]);
    return b;
  });
  const appt = (await admin().from("appointments").select("id, reference, status, starts_at").eq("business_id", biz.id).single()).data!;
  expect(appt.status).toBe("confirmed");

  await test.step("the owner sees the booking in her calendar on that day", async () => {
    await owner.page.goto("/dashboard");
    await owner.page.getByTestId("day-input").fill(booking.date);
    await expect(owner.page.getByTestId(`row-${appt.id}`)).toContainText(NAME);
    await expect(owner.page.getByTestId(`row-${appt.id}`)).toHaveAttribute("data-status", "confirmed");
  });

  const manageUrl = await test.step("the customer gets a confirmation mail with her private link", async () => {
    await drain(phone.page.request, async () => (await rows({ id: biz.id } as never)).some((r) => r.type === "booking_confirmed" && r.status === "sent"));
    const sent = (await rows({ id: biz.id } as never)).find((r) => r.type === "booking_confirmed")!;
    expect(sent.status).toBe("sent");
    expect(sent.preview!.subject).not.toContain("תספורת"); // privacy: no service name in the subject
    const link = sent.preview!.text.match(/\/booking\/[\w.-]+/)![0];
    const idOf = (l: string) => JSON.parse(Buffer.from(l.split("/").pop()!.split(".")[0], "base64url").toString()).a; // each mail mints its own token for the same appointment
    expect(idOf(link)).toBe(appt.id);
    expect(idOf(booking.manageUrl)).toBe(appt.id);
    return link;
  });

  await test.step("a day before, the reminder job mails her once (and only once)", async () => {
    const now = new Date(Date.parse(appt.starts_at) - 20 * 3_600_000);
    // The first free slot can be less than 24 h away (later in the day, or tomorrow morning): a booking made that late is skipped on purpose (NTF-02, "late_booking"). This step is about the reminder itself, so the booking is dated three days before the visit.
    sql(`set session_replication_role = replica; update public.appointments set created_at = starts_at - interval '3 days' where id = '${appt.id}'; set session_replication_role = origin;`);
    sql(`delete from public.job_runs where job_name = 'reminders'`);
    for (let i = 0; i < 2; i++) expect((await owner.page.request.post(`/api/jobs/reminders?now=${encodeURIComponent(now.toISOString())}`, { headers: auth })).status()).toBe(200);
    await drain(owner.page.request, async () => (await rows({ id: biz.id } as never)).some((r) => r.type === "reminder" && r.status === "sent"));
    expect((await rows({ id: biz.id } as never)).filter((r) => r.type === "reminder")).toHaveLength(1);
  });

  await test.step("on her phone she opens the link, adds it to her calendar, then moves the appointment", async () => {
    await phone.page.goto(manageUrl);
    await expect(phone.page.getByTestId("manage-status")).toHaveText("מאושר");
    const ics = await phone.page.request.get(`${manageUrl}/calendar`);
    expect(ics.headers()["content-type"]).toContain("text/calendar");
    await phone.page.getByTestId("manage-reschedule").click();
    await expect(phone.page.locator('[data-testid^="resched-day-"]').first()).toBeVisible();
    const days = await phone.page.locator('[data-testid^="resched-day-"]').evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("resched-day-", "")));
    await phone.page.getByTestId(`resched-day-${days.find((d) => d !== booking.date)}`).click();
    await phone.page.locator('[data-testid^="resched-time-"]').first().click();
    await phone.page.getByTestId("resched-confirm").click();
    await expect(phone.page.getByTestId("manage-status")).toHaveText("מאושר");
    const after = (await admin().from("appointments").select("starts_at").eq("id", appt.id).single()).data!;
    expect(after.starts_at).not.toBe(appt.starts_at);
    await drain(owner.page.request, async () => (await rows({ id: biz.id } as never)).some((r) => r.type === "owner_customer_rescheduled" && r.status === "sent"));
  });

  await test.step("the owner's calendar follows the move; she closes the visit as completed", async () => {
    // time passes: the visit is in the past now (fixture, as the clock cannot be moved for the app)
    sql(`set session_replication_role = replica; update public.appointments set starts_at = now() - interval '2 days', ends_at = now() - interval '2 days' + interval '30 minutes', blocked_until = now() - interval '2 days' + interval '30 minutes' where id = '${appt.id}'; set session_replication_role = origin;`);
    const day = new Date(Date.now() - 2 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "Asia/Jerusalem" });
    await owner.page.goto("/dashboard");
    await owner.page.getByTestId("day-input").fill(day);
    await expect(owner.page.getByTestId(`row-${appt.id}`)).toContainText(NAME);
    const done = await owner.page.request.post(`/api/owner/appointments/${appt.id}/transition`, { data: { action: "complete" }, headers: { origin: new URL(owner.page.url()).origin } });
    expect(done.status()).toBe(200);
  });

  await test.step("customers page, report and CSV all show the same single visit", async () => {
    await owner.page.goto("/customers");
    await expect(owner.page.getByText(NAME)).toBeVisible();
    const cust = (await admin().from("customers").select("id").eq("business_id", biz.id).single()).data!;
    await owner.page.goto(`/customers/${cust.id}`);
    await expect(owner.page.getByTestId("customer-history")).toContainText("הושלם");
    await noOverflow(owner.page);
    const from = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10), to = new Date().toISOString().slice(0, 10);
    const rep = await (await owner.page.request.get(`/api/owner/reports?from=${from}&to=${to}`)).json();
    expect(rep.kpis.completed).toBe(1);
    expect(rep.kpis.revenueCents).toBe(8000);
    const csv = await (await owner.page.request.get(`/api/owner/export/appointments?from=${from}&to=${to}`)).text();
    expect(csv).toContain(appt.reference);
    expect(csv).toContain(NAME);
    expect(byType(await rows({ id: biz.id } as never), "booking_rescheduled")[0].status).toBe("sent");
  });

  await owner.ctx.close();
  await phone.ctx.close();
});
