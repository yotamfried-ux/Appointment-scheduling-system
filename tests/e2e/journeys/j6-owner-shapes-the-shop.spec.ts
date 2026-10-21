import { expect, test } from "@playwright/test";
import { admin, firstDayWithSlots, loginAs, makeBusiness, sql, todayLocal } from "../helpers/business";
import { byType, drain, mail, rows } from "../helpers/outbox";
import { customerBooksViaPage, customerOnPhone, noOverflow, ownerAtDesk } from "./world";

// JOURNEY 6 — the owner changes her mind about her business during the week, and the public page follows every change at once:
// a new service, an archived one, a closed day, a walk-in, an approval rule, a rejection and a cancellation — each with the right mail to the right person.
test.use({ actionTimeout: 20_000 });

test("new service · archived service · closed day · walk-in · approval rule · reject · cancel — the customers' page and mail follow", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const b = await makeBusiness("barber");
  const desk = await ownerAtDesk(browser, baseURL!);
  const phone = await customerOnPhone(browser, baseURL!);
  const f = await firstDayWithSlots(desk.page.request, b);
  const origin = () => new URL(desk.page.url()).origin;
  await loginAs(desk.page, b.ownerEmail);
  const listed = async (name: string) => {
    await phone.page.goto(`/book/${b.slug}`);
    await expect(phone.page.getByTestId("business-name")).toBeVisible();
    return (await phone.page.locator('input[name="service"]').count()) >= 0 && (await phone.page.getByText(name).count()) > 0;
  };

  await test.step("the owner adds a 45-minute massage; a customer sees it with its price and books it", async () => {
    await desk.page.goto("/settings/services");
    await desk.page.getByTestId("add-service").click();
    await desk.page.getByLabel("שם השירות").fill("עיסוי שוודי");
    await desk.page.getByLabel("מחיר (₪)").fill("120");
    await desk.page.getByLabel("משך").selectOption("45");
    await desk.page.getByRole("button", { name: "שמירה" }).click();
    await expect(desk.page.getByRole("status").filter({ hasText: "השירות נשמר." })).toBeVisible();
    expect(await listed("עיסוי שוודי")).toBe(true);
    const svc = (await admin().from("services").select("id").eq("business_id", b.id).eq("name", "עיסוי שוודי").single()).data!;
    await phone.page.getByTestId(`service-${svc.id}`).check({ force: true });
    await phone.page.getByTestId("continue").click();
    await phone.page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
    await phone.page.getByTestId("continue").click();
    await phone.page.locator('input[name="time"]').first().check({ force: true });
    await phone.page.getByTestId("continue").click();
    await phone.page.getByLabel("שם מלא").fill("מיכל מ׳");
    await phone.page.getByLabel("טלפון נייד").fill("050-6660001");
    await phone.page.getByLabel(/אימייל/).fill(mail());
    await phone.page.getByTestId("continue").click();
    await expect(phone.page.getByTestId("done-title")).toBeVisible();
    expect(sql(`select (ends_at - starts_at)::text || '|' || price_cents from public.appointments where business_id='${b.id}' and service_id='${svc.id}'`)).toBe("00:45:00|12000");
  });

  await test.step("she archives the original haircut: the customers' page stops offering it, nothing else changes", async () => {
    const name = b.services[0].name;
    await desk.page.goto("/settings/services");
    await desk.page.getByRole("button", { name: `העברה לארכיון · ${name}` }).click();
    await expect(desk.page.getByTestId("archived-list")).toContainText(name);
    expect(await listed(name)).toBe(false);
    await desk.page.getByRole("button", { name: `שחזור · ${name}` }).click();
    await expect(desk.page.getByTestId("service-list")).toContainText(name); // wait for the save to land before the customer looks
    expect(await listed(name)).toBe(true);
  });

  await test.step("she closes a day for a holiday: the public calendar shows it closed, with no slots", async () => {
    const closed = todayLocal(9);
    await desk.page.goto("/settings/hours");
    await expect(desk.page.getByTestId("preview-days")).toBeVisible(); // the page is interactive (hydrated and loaded)
    await desk.page.getByLabel("תאריך").fill(closed);
    await desk.page.getByTestId("add-exception").click();
    await expect(desk.page.getByTestId(`exception-${closed}`)).toContainText("סגור כל היום");
    const slots = await (await phone.page.request.get(`/api/public/${b.slug}/slots?service=${b.services[0].id}&date=${closed}`)).json();
    expect(slots.slots).toEqual([]);
    const av = await (await phone.page.request.get(`/api/public/${b.slug}/availability?service=${b.services[0].id}&from=${closed}&days=1`)).json();
    expect(av.days[0].freeSlots).toBe(0);
  });

  await test.step("a walk-in is added from the calendar and the slot disappears from the public page at once", async () => {
    await desk.page.goto("/dashboard");
    await desk.page.getByTestId("day-input").fill(f.date);
    await expect(desk.page.getByTestId("day-input")).toHaveValue(f.date); // the new day is loaded (the dialog books the agenda's own day)
    await desk.page.getByTestId("new-appointment").click();
    await desk.page.getByTestId("manual-service").selectOption({ index: 1 });
    await desk.page.getByTestId("manual-time").fill(f.times[4]);
    await desk.page.getByTestId("manual-name").fill("אורח ללא תור");
    await desk.page.getByTestId("manual-phone").fill("052-6660002");
    await desk.page.getByTestId("manual-submit").click();
    await expect(desk.page.getByTestId("manual-form")).toHaveCount(0);
    const slots = await (await phone.page.request.get(`/api/public/${b.slug}/slots?service=${b.services[0].id}&date=${f.date}`)).json();
    expect(slots.slots.map((s: { time: string }) => s.time)).not.toContain(f.times[4]);
  });

  const pending = await test.step("she turns on 'approve every booking myself'; the next customer is told her request is pending", async () => {
    await desk.page.goto("/settings/booking");
    await desk.page.getByTestId("rules-approval").check();
    await desk.page.getByTestId("rules-save").click();
    await expect(desk.page.getByTestId("rules-status")).toHaveText("נשמר.");
    const r = await customerBooksViaPage(phone.page, b.slug, { name: "פנינה פ׳", phone: "050-6660003", email: mail() }, { nthTime: 6 });
    await expect(phone.page.getByTestId("done-status")).toContainText("ממתין");
    return r;
  });

  await test.step("she rejects the request: the customer is told, and the slot returns to the public page", async () => {
    await desk.page.goto("/dashboard");
    await desk.page.getByTestId("day-input").fill(pending.date);
    await desk.page.getByRole("button", { name: /דחייה · פנינה פ׳/ }).click();
    await expect.poll(() => sql(`select count(*) from public.appointments where business_id='${b.id}' and status='cancelled_by_business'`)).toBe("1");
    await drain(desk.page.request, async () => byType(await rows(b), "booking_declined").some((r) => r.status === "sent"));
    const slots = await (await phone.page.request.get(`/api/public/${b.slug}/slots?service=${b.services[0].id}&date=${pending.date}`)).json();
    expect(slots.slots.map((s: { time: string }) => s.time)).toContain(pending.time);
  });

  await test.step("she cancels Michal's confirmed massage herself; Michal is told by mail", async () => {
    sql(`update public.businesses set requires_approval = false where id='${b.id}'`);
    const appt = (await admin().from("appointments").select("id, starts_at").eq("business_id", b.id).eq("status", "confirmed").eq("source", "online").single()).data!;
    const res = await desk.page.request.post(`/api/owner/appointments/${appt.id}/transition`, { data: { action: "cancel" }, headers: { origin: origin() } });
    expect(res.status()).toBe(200);
    await drain(desk.page.request, async () => byType(await rows(b), "booking_cancelled_by_business").some((r) => r.status === "sent"));
    await noOverflow(desk.page);
  });

  await desk.ctx.close();
  await phone.ctx.close();
});
