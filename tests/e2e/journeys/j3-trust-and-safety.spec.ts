import { expect, test } from "@playwright/test";
import { admin, fakeIp, firstDayWithSlots, loginAs, makeBusiness, publicBook, signedInOwner, sql } from "../helpers/business";
import { byType, drain, mail, rows } from "../helpers/outbox";
import { customerBooksViaPage, customerOnPhone, noOverflow, ownerAtDesk } from "./world";

// JOURNEY 3 — a customer who keeps not showing up, an impostor, a stampede for one slot, and a team member with fewer rights.
// Crosses: owner settings · customer history · booking policy · approvals inbox · mail · RLS roles · concurrency.
test.use({ actionTimeout: 20_000 });
const PHONE = "050-3330001";
const E164 = "+972503330001";

test("repeat no-shows are held, then turned away politely; the owner can forgive; an impostor changes nothing; a stampede books once; staff cannot touch owner-only things", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const b = await makeBusiness("barber");
  const desk = await ownerAtDesk(browser, baseURL!);
  const d = await customerOnPhone(browser, baseURL!);
  const f = await firstDayWithSlots(desk.page.request, b);
  const dMail = mail();
  await loginAs(desk.page, b.ownerEmail);
  const origin = new URL(desk.page.url()).origin;

  await test.step("D has already missed one appointment, and misses a second one (the owner marks it)", async () => {
    const old = await publicBook(desk.page.request, b, f.date, f.times[0], 50, 0, dMail);
    sql(`update public.customers set phone = '${E164}', full_name = 'דני ד׳' where id = (select customer_id from public.appointments where id = '${old.id}')`);
    const past = (days: number) => `set session_replication_role = replica; update public.appointments set starts_at = now() - interval '${days} days', ends_at = now() - interval '${days} days' + interval '30 minutes', blocked_until = now() - interval '${days} days' + interval '30 minutes' where id = '`;
    sql(`${past(9)}${old.id}'; set session_replication_role = origin;`);
    expect((await desk.page.request.post(`/api/owner/appointments/${old.id}/transition`, { data: { action: "noShow" }, headers: { origin } })).status()).toBe(200);
    // the second miss (history inserted directly: the app cannot create appointments in the past)
    const cust = (await admin().from("customers").select("id").eq("business_id", b.id).eq("phone", E164).single()).data!;
    sql(`set session_replication_role = replica;
      insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, location, intake, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
      select '${b.id}', (select id from public.resources where business_id='${b.id}' and is_default), '${b.services[0].id}', '${cust.id}', 'TR-' || upper(substr(md5(random()::text), 1, 6)), 'no_show', 'business', '{}'::jsonb, now() - interval '20 days', now() - interval '20 days' + interval '30 minutes', now() - interval '20 days' + interval '30 minutes', '{"name":"x","durationMinutes":30,"bufferMinutes":0,"priceCents":8000}'::jsonb, 8000, 'ILS';
      set session_replication_role = origin;`);
  });

  await test.step("the owner sets the rule in her settings: from 2 no-shows, bookings need her approval", async () => {
    await desk.page.goto("/settings/booking");
    await desk.page.getByTestId("rules-policy").selectOption("require_approval");
    await desk.page.getByTestId("rules-threshold").fill("2");
    await desk.page.getByTestId("rules-save").click();
    await expect(desk.page.getByTestId("rules-status")).toHaveText("נשמר.");
  });

  const held = await test.step("D books again: the page says the request waits for approval", async () => {
    const r = await customerBooksViaPage(d.page, b.slug, { name: "דני ד׳", phone: PHONE, email: dMail }, { nthTime: 1 });
    await expect(d.page.getByTestId("done-status")).toContainText("ממתין");
    await noOverflow(d.page);
    return r;
  });

  await test.step("the owner finds it in her approvals inbox and approves; D is told by mail", async () => {
    await desk.page.goto("/dashboard");
    await desk.page.getByTestId("day-input").fill(held.date);
    await expect(desk.page.getByTestId("approvals-count")).not.toHaveText("0");
    await desk.page.getByRole("button", { name: /אישור · דני ד׳/ }).click();
    await expect.poll(() => sql(`select count(*) from public.appointments where business_id='${b.id}' and status='confirmed' and starts_at > now()`)).toBe("1");
    await drain(desk.page.request, async () => byType(await rows(b), "booking_confirmed").some((r) => r.status === "sent"));
  });

  await test.step("the owner tightens the rule to 'no online booking': D sees the owner's own words and nothing about counts", async () => {
    await desk.page.goto("/settings/booking");
    await desk.page.getByTestId("rules-policy").selectOption("block");
    await desk.page.getByTestId("rules-block-message").fill("נשמח לקבוע לך תור בטלפון");
    await desk.page.getByTestId("rules-save").click();
    await expect(desk.page.getByTestId("rules-status")).toHaveText("נשמר.");
    await d.page.goto(`/book/${b.slug}`);
    await d.page.locator('input[name="service"]').first().check({ force: true });
    await d.page.getByTestId("continue").click();
    await d.page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
    await d.page.getByTestId("continue").click();
    await d.page.locator('input[name="time"]').nth(3).check({ force: true });
    await d.page.getByTestId("continue").click();
    await d.page.getByLabel("שם מלא").fill("דני ד׳");
    await d.page.getByLabel("טלפון נייד").fill(PHONE);
    await d.page.getByTestId("continue").click();
    await expect(d.page.getByText("נשמח לקבוע לך תור בטלפון")).toBeVisible();
    await expect(d.page.getByText(/אי-הגעות|no.?show/i)).toHaveCount(0);
    await noOverflow(d.page);
  });

  await test.step("the owner forgives: after she clears the restriction on D's page, D can book", async () => {
    const cust = (await admin().from("customers").select("id").eq("business_id", b.id).eq("phone", E164).single()).data!;
    await desk.page.goto(`/customers/${cust.id}`);
    await expect(desk.page.getByTestId("customer-policy-state")).toContainText("לא יכול לקבוע תור אונליין");
    await desk.page.getByTestId("customer-policy-toggle").click();
    await expect(desk.page.getByTestId("customer-policy-state")).toContainText("לא חל על הלקוח הזה");
    await d.page.getByTestId("continue").click();
    await expect(d.page.getByTestId("done-title")).toBeVisible();
  });

  await test.step("an impostor books with D's phone and his own e-mail: D's record and mail address are untouched", async () => {
    sql(`update public.businesses set no_show_policy = 'off' where id = '${b.id}'`);
    const before = (await admin().from("customers").select("full_name, email").eq("business_id", b.id).eq("phone", E164).single()).data!;
    const bad = await desk.page.request.post(`/api/public/${b.slug}/bookings`, {
      data: { serviceId: b.services[0].id, date: f.date, time: f.times[6], location: "business", customer: { fullName: "מתחזה", phone: PHONE, email: mail() }, intake: {} },
      headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `imp-${Math.random().toString(36).slice(2)}` },
    });
    expect(bad.status()).toBe(201);
    expect((await admin().from("customers").select("full_name, email").eq("business_id", b.id).eq("phone", E164).single()).data).toEqual(before);
  });

  await test.step("a stampede: 10 people press 'book' for the same slot at the same instant — exactly one gets it, the rest a clean conflict", async () => {
    const t = f.times[8];
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => desk.page.request.post(`/api/public/${b.slug}/bookings`, {
      data: { serviceId: b.services[0].id, date: f.date, time: t, location: "business", customer: { fullName: `ממהר ${i}`, phone: `05055500${String(10 + i)}`, email: mail() }, intake: {} },
      headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `race-${i}-${Math.random().toString(36).slice(2)}` },
    })));
    const codes = res.map((r) => r.status()).sort();
    const why = `statuses ${codes.join(",")}; first body ${(await res[0].text()).slice(0, 300)}`;
    expect(codes.filter((c) => c === 201), why).toHaveLength(1);
    expect(codes.filter((c) => c === 409), why).toHaveLength(9);
  });

  await test.step("a staff member sees the calendar but cannot export, delete the account or change the rules", async () => {
    const staff = await signedInOwner("staff");
    sql(`insert into public.business_members (business_id, user_id, role) values ('${b.id}', '${staff.userId}', 'staff')`);
    const s = await ownerAtDesk(browser, baseURL!);
    await loginAs(s.page, staff.email);
    await s.page.goto("/dashboard");
    await expect(s.page.getByTestId("agenda")).toBeVisible();
    const so = new URL(s.page.url()).origin;
    expect((await s.page.request.get("/api/owner/account/export")).status()).toBe(403);
    expect((await s.page.request.get("/api/owner/export/customers")).status()).toBe(403);
    expect((await s.page.request.post("/api/owner/account/deletion", { data: { action: "request", confirmName: "x" }, headers: { origin: so } })).status()).toBe(403);
    await s.page.goto("/settings/account");
    await expect(s.page.getByTestId("account-owner-only")).toBeVisible();
    await s.page.goto("/settings/booking");
    await s.page.getByTestId("rules-cancel-hours").fill("1");
    await s.page.getByTestId("rules-save").click();
    await expect(s.page.getByTestId("rules-status")).toContainText("רק מנהל או בעלים");
    expect((await admin().from("businesses").select("cancel_until_hours").eq("id", b.id).single()).data!.cancel_until_hours).toBe(12);
    await s.ctx.close();
  });

  await desk.ctx.close();
  await d.ctx.close();
});
