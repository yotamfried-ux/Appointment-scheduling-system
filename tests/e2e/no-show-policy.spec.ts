import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { admin, fakeIp, firstDayWithSlots, loginAs, makeBusiness, sql, type TestBusiness } from "./helpers/business";
import { mail } from "./helpers/outbox";

// BKG-08: the owner sets a no-show policy in the settings; a customer with too many recent no-shows is held for approval or turned away politely;
// the owner can clear it for one customer. Real browser, real stack.
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const PHONE = "+972504447788";
const EMAIL = "nsd.fixture@example.com"; // the customer is identified by e-mail, so the fixture and the bookings share one address

/** A customer with `n` no-shows in the last weeks (fixtures bypass the guard triggers, as the database tests do). */
function withNoShows(b: TestBusiness, n: number) {
  const id = sql(`insert into public.customers (business_id, full_name, phone, email) values ('${b.id}', 'חסר אחריות', '${PHONE}', '${EMAIL}') returning id`).split("\n")[0].trim();
  for (let i = 0; i < n; i++) {
    sql(`set session_replication_role = replica;
      insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, location, intake, starts_at, ends_at, blocked_until, service_snapshot, price_cents, currency)
      select '${b.id}', (select id from public.resources where business_id = '${b.id}' and is_default), '${b.services[0].id}', '${id}', 'TR-' || upper(substr(md5(random()::text), 1, 6)), 'no_show', 'business', '{}'::jsonb,
        now() - interval '${5 + i * 3} days', now() - interval '${5 + i * 3} days' + interval '30 minutes', now() - interval '${5 + i * 3} days' + interval '30 minutes', '{"name":"x","durationMinutes":30,"bufferMinutes":0,"priceCents":8000}'::jsonb, 8000, 'ILS';
      set session_replication_role = origin;`);
  }
  return id;
}

const book = async (request: APIRequestContext, b: TestBusiness, date: string, time: string, key: string) =>
  request.post(`/api/public/${b.slug}/bookings`, {
    data: { serviceId: b.services[0].id, date, time, location: "business", customer: { fullName: "חסר אחריות", phone: PHONE.replace("+972", "0"), email: EMAIL }, intake: {} },
    headers: { "x-forwarded-for": fakeIp(), "idempotency-key": key },
  });

test.describe("no-show policy (BKG-08)", () => {
  test("settings page: save the rules, accessible, balanced; the values reach the database", async ({ page }) => {
    const b = await makeBusiness("barber");
    await loginAs(page, b.ownerEmail);
    await page.goto("/settings/booking");
    await expect(page.getByTestId("booking-rules-form")).toBeVisible();
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
    await page.getByTestId("rules-cancel-hours").fill("6");
    await page.getByTestId("rules-policy").selectOption("block");
    await page.getByTestId("rules-threshold").fill("2");
    await page.getByTestId("rules-block-message").fill("נא להתקשר אלינו");
    await expect(page.getByTestId("rules-save")).toBeEnabled();
    await page.getByTestId("rules-save").click();
    await expect(page.getByTestId("rules-status")).toHaveText("נשמר.");
    expect((await admin().from("businesses").select("cancel_until_hours, no_show_policy, no_show_threshold, block_message").eq("id", b.id).single()).data).toEqual({ cancel_until_hours: 6, no_show_policy: "block", no_show_threshold: 2, block_message: "נא להתקשר אלינו" });
    await page.reload();
    await expect(page.getByTestId("rules-policy")).toHaveValue("block");
    await page.getByTestId("rules-cancel-hours").fill("9999");
    await page.getByTestId("rules-save").click();
    await expect(page.getByTestId("rules-status")).toContainText("לא הצלחנו");
    expect((await admin().from("businesses").select("cancel_until_hours").eq("id", b.id).single()).data!.cancel_until_hours).toBe(6); // nothing half-saved
  });

  test("require_approval then block: the customer is held, then turned away with the business' text; the owner clears it and the customer can book again", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const cust = withNoShows(b, 3);
    // off by default: confirmed
    const first = await book(request, b, f.date, f.times[0], "np-key-0001");
    expect(first.status()).toBe(201);
    expect((await first.json()).booking.status).toBe("confirmed");

    sql(`update public.businesses set no_show_policy = 'require_approval', no_show_threshold = 3 where id = '${b.id}'`);
    const held = await book(request, b, f.date, f.times[1], "np-key-0002");
    expect(held.status()).toBe(201);
    expect((await held.json()).booking.status).toBe("pending");

    sql(`update public.businesses set no_show_policy = 'block', block_message = 'נא להתקשר אלינו' where id = '${b.id}'`);
    const blocked = await book(request, b, f.date, f.times[2], "np-key-0003");
    expect(blocked.status()).toBe(403);
    const body = await blocked.json();
    expect(body.error.code).toBe("BLOCKED");
    expect(body.error.message).toBe("נא להתקשר אלינו");
    expect(body.error.message).not.toMatch(/no_show|no-show|שלוש|\d/); // nothing about counts (the request id is random hex, so only the message is checked)
    expect(sql(`select count(*) from public.appointments where business_id='${b.id}' and status in ('pending','confirmed')`)).toBe("2");

    // another customer is unaffected
    const other = await request.post(`/api/public/${b.slug}/bookings`, { data: { serviceId: b.services[0].id, date: f.date, time: f.times[3], location: "business", customer: { fullName: "לקוח תקין", phone: "0505550000", email: mail() }, intake: {} }, headers: { "x-forwarded-for": fakeIp(), "idempotency-key": "np-key-0004" } });
    expect(other.status()).toBe(201);

    // the owner sees the state on the customer page and clears it
    await loginAs(page, b.ownerEmail);
    await page.goto(`/customers/${cust}`);
    await expect(page.getByTestId("customer-policy-state")).toContainText("לא יכול לקבוע תור אונליין");
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
    await page.getByTestId("customer-policy-toggle").click();
    await expect(page.getByTestId("customer-policy-state")).toContainText("לא חל על הלקוח הזה");
    const again = await book(request, b, f.date, f.times[2], "np-key-0005");
    expect(again.status()).toBe(201);
    expect(sql(`select count(*) from public.audit_log where business_id='${b.id}' and action='customer.policy_override'`)).toBe("1");
  });

  test("no-shows older than 60 days do not count", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const cust = withNoShows(b, 2); // 5 and 8 days ago
    sql(`set session_replication_role = replica; update public.appointments set starts_at = starts_at - interval '100 days', ends_at = ends_at - interval '100 days', blocked_until = blocked_until - interval '100 days' where customer_id = '${cust}'; set session_replication_role = origin;`);
    sql(`update public.businesses set no_show_policy = 'block', no_show_threshold = 2 where id = '${b.id}'`);
    expect((await book(request, b, f.date, f.times[0], "np-key-0006")).status()).toBe(201);
  });
});
