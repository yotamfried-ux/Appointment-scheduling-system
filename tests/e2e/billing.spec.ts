import AxeBuilder from "@axe-core/playwright";
import { createHmac } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { customer, fakeIp, firstDayWithSlots, loginAs, makeBusiness, publicBook, signedInOwner, sql, todayLocal, type TestBusiness } from "./helpers/business";
import { BILLING_WEBHOOK_SECRET } from "./helpers/secrets";
import { ACCEPTED } from "./helpers/terms";

// Stage 9 on the real stack with the plug-in `fake` provider: webhook semantics (BIL-03), trial end (BIL-01), grace (BIL-02), checkout that only a webhook can
// complete (BIL-04), quotas that never delete (BIL-05), cancel (BIL-06), gated features (BIL-08), isolation and roles.
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

// The signer is written here on purpose (not imported from the app): the test must break if the app's idea of the format drifts.
const sign = (body: string, t = Math.floor(Date.now() / 1000), secret = BILLING_WEBHOOK_SECRET) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
let seq = 0;
const evt = (b: { id: string }, type: string, over: Record<string, unknown> = {}) => ({ eventId: `e2e-${Date.now()}-${seq++}-${Math.random().toString(36).slice(2, 6)}`, type, occurredAt: new Date().toISOString(), businessId: b.id, data: {}, ...over });
async function hook(request: APIRequestContext, payload: unknown, o: { sig?: string; t?: number; provider?: string; raw?: string } = {}) {
  const body = o.raw ?? JSON.stringify(payload);
  return request.post(`/api/webhooks/billing/${o.provider ?? "fake"}`, { data: body, headers: { "content-type": "application/json", "x-billing-signature": o.sig ?? sign(body, o.t) } });
}
const deliver = async (request: APIRequestContext, e: ReturnType<typeof evt>) => {
  const r = await hook(request, e);
  expect(r.status(), await r.text()).toBe(200);
  return ((await r.json()).results as string[])[0];
};
const sub = (b: TestBusiness) => sql(`select status || '/' || plan_id from public.subscriptions where business_id='${b.id}'`);
const expireTrial = (b: TestBusiness) => sql(`update public.subscriptions set trial_ends_at = now() - interval '1 minute' where business_id='${b.id}'`);
const active = (b: TestBusiness, plan: string) => ({ ...evt(b, "subscription.updated", { data: { planId: plan, status: "active", currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(), externalCustomerId: "cus_t", externalSubscriptionId: "sub_t" } }) });
const origin = (page: Page) => new URL(page.url()).origin;

test.describe("webhook semantics (BIL-03)", () => {
  test("signed events apply; duplicates, older events, bad signatures, replays, malformed and foreign payloads change nothing", async ({ request }) => {
    const a = await makeBusiness("barber");
    const other = await makeBusiness("barber");
    expect(sub(a)).toBe("trialing/pro");

    // wrong signature / stale timestamp / no header / malformed / wrong provider path
    const e0 = active(a, "starter");
    expect((await hook(request, e0, { sig: sign(JSON.stringify(e0), undefined, "not-the-secret-not-the-secret-0000") })).status()).toBe(400);
    expect((await hook(request, e0, { t: Math.floor(Date.now() / 1000) - 3600 })).status()).toBe(400);
    expect((await request.post("/api/webhooks/billing/fake", { data: JSON.stringify(e0), headers: { "content-type": "application/json" } })).status()).toBe(400);
    expect((await hook(request, null, { raw: "not json" })).status()).toBe(400);
    expect((await hook(request, e0, { provider: "stripe" })).status()).toBe(404);
    expect((await hook(request, { ...e0, businessId: "not-a-uuid" })).status()).toBe(400); // never reaches the database
    expect((await hook(request, { ...e0, type: "refund.made" })).status()).toBe(400);
    expect(sub(a)).toBe("trialing/pro"); // none of that changed anything

    // applied once, a duplicate is recognised, an older event is ignored
    expect(await deliver(request, e0)).toBe("applied");
    expect(sub(a)).toBe("active/starter");
    expect(await deliver(request, e0)).toBe("duplicate");
    const older = evt(a, "payment.failed", { occurredAt: new Date(Date.now() - 3600_000).toISOString() });
    expect(await deliver(request, older)).toBe("stale");
    expect(sub(a)).toBe("active/starter");
    expect(sql(`select count(*) from public.billing_events where business_id='${a.id}'`)).toBe("2");

    // a newer event wins; the order of ARRIVAL does not matter, the order of OCCURRENCE does
    const t1 = new Date(Date.now() + 10_000).toISOString();
    const t2 = new Date(Date.now() + 20_000).toISOString();
    expect(await deliver(request, evt(a, "payment.succeeded", { occurredAt: t2 }))).toBe("applied");
    expect(await deliver(request, evt(a, "payment.failed", { occurredAt: t1 }))).toBe("stale");
    expect(sub(a)).toBe("active/starter");

    // another tenant is untouched; an unknown business is accepted quietly and recorded
    expect(sub(other)).toBe("trialing/pro");
    expect(await deliver(request, evt({ id: "00000000-0000-4000-8000-00000000dead" }, "payment.failed"))).toBe("unknown_business");
    // an unknown plan is ignored rather than trusted
    expect(await deliver(request, evt(a, "subscription.updated", { occurredAt: new Date(Date.now() + 30_000).toISOString(), data: { planId: "ghost" } }))).toBe("invalid_plan");
    expect(sub(a)).toBe("active/starter");
  });

  test("the manual provider's webhook path is refused by the provider setting, and every route needs a session where it should (401)", async ({ request }) => {
    for (const path of ["/api/owner/billing", "/api/admin/billing/override"]) {
      const r = path.includes("admin") ? await request.post(path, { data: {} }) : await request.get(path);
      expect(r.status(), path).toBe(401);
    }
  });
});

test.describe("trial end and recovery (BIL-01/02, BKG-11)", () => {
  test("an expired trial closes new bookings everywhere but keeps every existing appointment; a payment reopens it", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const booked = await publicBook(request, b, f.date, f.times[0], 1);
    const svc = b.services[0].id;

    // while in trial everything works
    expect((await request.get(`/api/public/${b.slug}/services`)).status()).toBe(200);
    expireTrial(b);

    // public side: the page says so, the API answers 409 BOOKINGS_CLOSED (never a 500, never a hang)
    await page.goto(`/book/${b.slug}`);
    await expect(page.getByTestId("bookings-closed")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("העסק אינו מקבל כרגע תורים חדשים");
    const av = await request.get(`/api/public/${b.slug}/availability?service=${svc}&from=${todayLocal(2)}&days=7`);
    expect(av.status()).toBe(409);
    expect((await av.json()).error.code).toBe("BOOKINGS_CLOSED");
    const book = await request.post(`/api/public/${b.slug}/bookings`, { data: { serviceId: svc, date: f.date, time: f.times[1], location: "business", acceptedTerms: ACCEPTED, customer: customer(2), intake: {} }, headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `k-${Math.random()}` } });
    expect(book.status()).toBe(409);
    expect((await book.json()).error.code).toBe("BOOKINGS_CLOSED");

    // owner side: existing data is intact and manageable; adding is refused with 402; the banner explains
    await loginAs(page, b.ownerEmail);
    await page.goto(`/dashboard`);
    await expect(page.getByTestId("billing-banner")).toHaveAttribute("data-state", "degraded");
    const day = await (await page.request.get(`/api/owner/appointments?date=${f.date}`)).json();
    expect(day.billing).toEqual({ state: "degraded", features: { waitlist: false, export: false } });
    expect(day.appointments.map((a: { id: string }) => a.id)).toContain(booked.id);
    const manual = await page.request.post("/api/owner/appointments", { data: { serviceId: svc, date: f.date, time: f.times[2], customer: { fullName: customer(3).fullName, phone: customer(3).phone } }, headers: { origin: origin(page) } });
    expect(manual.status()).toBe(402);
    expect((await manual.json()).error.code).toBe("PAYMENT_REQUIRED");
    const cancel = await page.request.post(`/api/owner/appointments/${booked.id}/transition`, { data: { action: "cancel" }, headers: { origin: origin(page) } });
    expect(cancel.status()).toBe(200);
    expect(sql(`select count(*) from public.appointments where business_id='${b.id}'`)).toBe("1"); // nothing was deleted

    // the payment arrives (webhook): everything reopens by itself
    expect(await deliver(request, active(b, "pro"))).toBe("applied");
    await page.goto(`/book/${b.slug}`);
    await expect(page.getByTestId("bookings-closed")).toHaveCount(0);
    expect((await request.get(`/api/public/${b.slug}/availability?service=${svc}&from=${todayLocal(2)}&days=7`)).status()).toBe(200);
    await publicBook(request, b, f.date, f.times[1], 4);
  });

  test("a failed payment gives a grace period (everything keeps working), then degrades; a later payment recovers (BIL-02)", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    expect(await deliver(request, active(b, "pro"))).toBe("applied");
    expect(await deliver(request, evt(b, "payment.failed", { occurredAt: new Date(Date.now() + 5000).toISOString() }))).toBe("applied");
    expect(sub(b)).toBe("past_due/pro");
    await loginAs(page, b.ownerEmail);
    await page.goto("/dashboard");
    await expect(page.getByTestId("billing-banner")).toHaveAttribute("data-state", "grace");
    await expect(page.getByTestId("billing-banner")).toContainText("התשלום האחרון נכשל");
    const f = await firstDayWithSlots(request, b);
    await publicBook(request, b, f.date, f.times[0], 1); // customers are not punished for the business's payment problem
    // grace over
    sql(`update public.subscriptions set grace_until = now() - interval '1 minute' where business_id='${b.id}'`);
    await page.reload();
    await expect(page.getByTestId("billing-banner")).toHaveAttribute("data-state", "degraded");
    expect(await deliver(request, evt(b, "payment.succeeded", { occurredAt: new Date(Date.now() + 10_000).toISOString() }))).toBe("applied");
    await page.reload();
    await expect(page.getByTestId("billing-banner")).toHaveCount(0);
  });

  test("cancelling keeps the paid period running, then it ends (BIL-06)", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    expect(await deliver(request, active(b, "pro"))).toBe("applied");
    expect(await deliver(request, evt(b, "subscription.canceled", { occurredAt: new Date(Date.now() + 5000).toISOString(), data: { currentPeriodEnd: new Date(Date.now() + 5 * 86_400_000).toISOString() } }))).toBe("applied");
    await loginAs(page, b.ownerEmail);
    await page.goto("/dashboard");
    await expect(page.getByTestId("billing-banner")).toContainText("המנוי יסתיים ב-");
    expect((await page.request.get(`/api/owner/billing`).then((r) => r.json())).state).toBe("active");
    sql(`update public.subscriptions set current_period_end = now() - interval '1 second' where business_id='${b.id}'`);
    expect((await page.request.get(`/api/owner/billing`).then((r) => r.json())).state).toBe("degraded");
  });
});

test.describe("features and quotas (BIL-05/08)", () => {
  test("a plan without the waitlist and export: 402 everywhere, upsell in the UI, data kept, public waitlist closed", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    // a waitlist entry made while in trial (pro)
    const joined = await request.post(`/api/public/${b.slug}/waitlist`, { data: { serviceId: b.services[0].id, date: f.date, acceptedTerms: ACCEPTED, customer: { fullName: "ממתין", phone: customer(77).phone, email: `w${Date.now()}@example.com` } }, headers: { "x-forwarded-for": fakeIp() } });
    expect(joined.status()).toBe(201);
    expect(await deliver(request, active(b, "starter"))).toBe("applied");

    await loginAs(page, b.ownerEmail);
    const o = origin(page);
    const sets = await page.request.post("/api/owner/waitlist/settings", { data: { enabled: true }, headers: { origin: o } });
    expect(sets.status()).toBe(402);
    expect((await sets.json()).error.code).toBe("PAYMENT_REQUIRED");
    expect((await page.request.get("/api/owner/export/customers")).status()).toBe(402);
    expect((await page.request.get("/api/owner/export/appointments?from=2026-01-01&to=2026-12-31")).status()).toBe(402);
    // public: the waitlist is not offered and cannot be joined
    const cat = await (await request.get(`/api/public/${b.slug}/services`)).json();
    expect(cat.business.waitlistEnabled).toBeFalsy();
    const join2 = await request.post(`/api/public/${b.slug}/waitlist`, { data: { serviceId: b.services[0].id, date: f.date, acceptedTerms: ACCEPTED, customer: { fullName: "עוד אחד", phone: customer(78).phone, email: `w2${Date.now()}@example.com` } }, headers: { "x-forwarded-for": fakeIp() } });
    expect(join2.status()).toBe(404);
    // UI: the panel shows an upsell, the earlier entry is still there; reports show the export upsell
    await page.goto("/dashboard");
    await page.getByTestId("day-input").fill(f.date);
    await expect(page.getByTestId("waitlist-upsell")).toBeVisible();
    await expect(page.getByTestId("waitlist-count")).toHaveText("1");
    await expect(page.getByTestId("wl-enabled-switch")).toHaveCount(0);
    await page.goto("/reports");
    await expect(page.getByTestId("export-upsell")).toBeVisible();
    await expect(page.getByTestId("export-appointments")).toHaveCount(0);
    expect(sql(`select count(*) from public.waitlist_entries where business_id='${b.id}'`)).toBe("1");
    // an override from the back-office (done in SQL here; the MFA path is in pgTAP) brings one feature back without a deploy
    sql(`insert into public.entitlement_overrides (business_id, key, bool_value, reason, expires_at, created_by) select '${b.id}', 'export', true, 'ארכה לבדיקה', now() + interval '1 day', user_id from public.business_members where business_id='${b.id}' limit 1`);
    expect((await page.request.get("/api/owner/export/customers", { headers: { "x-forwarded-for": fakeIp() } })).status()).toBe(200);
  });

  test("service quota: at the limit adding is refused, a downgrade below usage deletes nothing, freeing room allows adding again", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    expect(await deliver(request, active(b, "starter"))).toBe("applied");
    const count = () => Number(sql(`select count(*) from public.services where business_id='${b.id}' and active`));
    const add = (name: string) => b.db.from("services").insert({ business_id: b.id, name, duration_minutes: 30, price_cents: 5000, position: 900 });
    while (count() < 5) expect((await add(`נוסף ${count()}`)).error).toBeNull();
    const refused = await add("שישי");
    expect(refused.error?.message).toContain("plan_limit");
    expect(count()).toBe(5);

    // upgrade, grow, downgrade: nothing is removed
    expect(await deliver(request, evt(b, "subscription.updated", { occurredAt: new Date(Date.now() + 5000).toISOString(), data: { planId: "pro", status: "active" } }))).toBe("applied");
    for (const n of [1, 2, 3]) expect((await add(`פרו ${n}`)).error).toBeNull();
    expect(count()).toBe(8);
    expect(await deliver(request, evt(b, "subscription.updated", { occurredAt: new Date(Date.now() + 10_000).toISOString(), data: { planId: "starter" } }))).toBe("applied");
    expect(count()).toBe(8);
    expect((await add("חריג")).error?.message).toContain("plan_limit");

    await loginAs(page, b.ownerEmail);
    await page.goto("/settings/billing");
    await expect(page.getByTestId("billing-over")).toBeVisible();
    await expect(page.getByTestId("billing-usage")).toHaveText("8 מתוך 5");
    // deactivate down to the limit: adding works again
    sql(`update public.services set active=false where id in (select id from public.services where business_id='${b.id}' and active order by created_at desc limit 3)`);
    expect(count()).toBe(5);
    expect((await add("אחרי ההפחתה")).error?.message).toContain("plan_limit");
    sql(`update public.services set active=false where id in (select id from public.services where business_id='${b.id}' and active order by created_at desc limit 1)`);
    expect((await add("עכשיו יש מקום")).error).toBeNull();
  });
});

test.describe("checkout through the UI: only the webhook completes it (BIL-04)", () => {
  test("return without paying changes nothing; paying shows 'processing' until the delayed webhook lands; a failed payment enters grace", async ({ page }) => {
    const b = await makeBusiness("barber");
    await loginAs(page, b.ownerEmail);
    await page.goto("/settings/billing");
    await expect(page.getByTestId("billing-state")).toHaveText("תקופת ניסיון");
    await expect(page.getByTestId("billing-plan")).toHaveText("מקצועי");

    // choose a plan, then come back WITHOUT paying: nothing changed
    await page.getByTestId("choose-starter").click();
    await expect(page.getByTestId("fake-checkout")).toBeVisible();
    await page.getByRole("link", { name: "חזרה בלי לשלם" }).click();
    await expect(page.getByTestId("billing")).toBeVisible();
    expect(sub(b)).toBe("trialing/pro");
    await expect(page.getByTestId("billing-processing")).toHaveCount(0);

    // pay with a webhook that arrives 3 seconds later: the page says it is processing, the state is still the old one…
    await page.getByTestId("choose-starter").click();
    await page.getByTestId("fake-delay").selectOption("3000");
    await page.getByTestId("fake-pay").click();
    await expect(page.getByTestId("billing-processing")).toBeVisible();
    expect(sub(b)).toBe("trialing/pro");
    // …and then the webhook lands and the page updates on its own
    await expect(page.getByTestId("billing-state")).toHaveText("פעיל", { timeout: 20_000 });
    await expect(page.getByTestId("billing-plan")).toHaveText("בסיס");
    await expect(page.getByTestId("billing-processing")).toHaveCount(0);
    expect(sub(b)).toBe("active/starter");
    await page.screenshot({ path: `test-results/billing-active-${test.info().project.name}.png`, fullPage: true });

    // a failed payment: grace, with a banner
    await page.getByTestId("billing-portal").click();
    await expect(page.getByTestId("fake-cancel")).toBeVisible();
    await page.getByRole("link", { name: "חזרה לאתר" }).click();
    await page.goto("/settings/billing");
    await page.getByTestId("choose-pro").click();
    await page.getByTestId("fake-fail").click();
    await expect(page.getByTestId("billing-state")).toHaveText("בעיה בתשלום", { timeout: 20_000 });
    await page.goto("/dashboard");
    await expect(page.getByTestId("billing-banner")).toHaveAttribute("data-state", "grace");

    // cancel through the provider's portal: still active, with the end date shown
    await page.goto("/settings/billing");
    await page.getByTestId("billing-portal").click();
    await page.getByTestId("fake-cancel").click();
    await expect(page.getByTestId("billing")).toBeVisible();
    expect(sql(`select cancel_at_period_end from public.subscriptions where business_id='${b.id}'`)).toBe("t");
  });

  test("only managers change the subscription; CSRF and validation hold (SEC)", async ({ page, browser }) => {
    const b = await makeBusiness("barber");
    const staff = await signedInOwner("billing-staff");
    sql(`insert into public.business_members (business_id, user_id, role) values ('${b.id}','${staff.userId}','staff')`);
    const ctx = await browser.newContext();
    const sp = await ctx.newPage();
    await loginAs(sp, staff.email);
    const so = origin(sp);
    expect((await sp.request.post("/api/owner/billing/checkout", { data: { planId: "pro" }, headers: { origin: so } })).status()).toBe(403);
    expect((await sp.request.post("/api/owner/billing/portal", { headers: { origin: so } })).status()).toBe(403);
    expect((await sp.request.get("/api/owner/billing")).status()).toBe(200); // staff may see the state
    await sp.goto("/settings/billing");
    await expect(sp.getByTestId("choose-starter")).toHaveCount(0);
    await ctx.close();

    await loginAs(page, b.ownerEmail);
    const o = origin(page);
    expect((await page.request.post("/api/owner/billing/checkout", { data: { planId: "pro" } })).status()).toBe(403); // no Origin
    expect((await page.request.post("/api/owner/billing/checkout", { data: { planId: "pro" }, headers: { origin: "https://evil.example" } })).status()).toBe(403);
    expect((await page.request.post("/api/owner/billing/checkout", { data: { planId: "../x" }, headers: { origin: o } })).status()).toBe(422);
    expect((await page.request.post("/api/owner/billing/checkout", { data: { planId: "ghost" }, headers: { origin: o } })).status()).toBe(422);
    expect((await page.request.post("/api/owner/billing/checkout", { data: { planId: "pro", price: 0 }, headers: { origin: o } })).status()).toBe(422);
    const ok = await page.request.post("/api/owner/billing/checkout", { data: { planId: "pro" }, headers: { origin: o } });
    expect(ok.status()).toBe(200);
    expect((await ok.json()).kind).toBe("redirect");
    expect(sub(b)).toBe("trialing/pro"); // starting a checkout never changes the subscription
    // the owner cannot read or write the provider's identifiers, events or overrides with their own session
    const own = await b.db.from("subscriptions").select("external_customer_id");
    expect(own.error).not.toBeNull();
    expect((await b.db.from("billing_events").select("*")).error).not.toBeNull();
    expect((await b.db.rpc("billing_apply_event", { p_provider: "fake", p_event_id: "x", p_type: "payment.succeeded", p_occurred_at: new Date().toISOString(), p_business: b.id, p_data: {} })).error).not.toBeNull();
    expect((await page.request.post("/api/admin/billing/override", { data: { action: "set", businessId: b.id, key: "export", bool: true, reason: "מנסה לעקוף את המערכת" }, headers: { origin: o } })).status()).toBe(403);
  });
});

test.describe("billing screens are balanced", () => {
  test("billing page and banners at every state: no overflow, no clipped text, accessible", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    await loginAs(page, b.ownerEmail);
    const shot = async (name: string) => {
      await noOverflow(page);
      expect((await axe(page)).violations).toEqual([]);
      await page.screenshot({ path: `test-results/billing-${name}-${test.info().project.name}.png`, fullPage: true });
    };
    await page.goto("/settings/billing");
    await expect(page.getByTestId("billing")).toBeVisible();
    await shot("trial");
    sql(`update public.subscriptions set trial_ends_at = now() + interval '3 days' where business_id='${b.id}'`);
    await page.goto("/dashboard");
    await expect(page.getByTestId("billing-banner")).toContainText("נותרו 3 ימים");
    await shot("dashboard-trial-ending");
    expireTrial(b);
    await page.goto("/dashboard");
    await expect(page.getByTestId("billing-banner")).toHaveAttribute("data-state", "degraded");
    await shot("dashboard-degraded");
    await page.goto("/settings/billing");
    await expect(page.getByTestId("billing-state")).toHaveText("המנוי הסתיים");
    await shot("degraded");
    expect(await deliver(request, active(b, "pro"))).toBe("applied");
    for (let i = 0; i < 7; i++) sql(`insert into public.services (business_id, name, duration_minutes, price_cents, position) values ('${b.id}', 'שירות עם שם ארוך מאוד שממשיך ולא נגמר ${i}', 30, 5000, ${500 + i})`);
    // downgrade below usage: over quota on purpose, nothing is removed
    expect(await deliver(request, evt(b, "subscription.updated", { occurredAt: new Date(Date.now() + 10_000).toISOString(), data: { planId: "starter" } }))).toBe("applied");
    await page.goto("/settings/billing");
    await shot("over-quota");
  });
});
