import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { LEGAL } from "../../lib/legal/config";
import { BUSINESS_KINDS } from "../../modules/tenancy/business-kind";
import { customer, makeBusiness, sql, type TestBusiness } from "./helpers/business";
import { ACCEPTANCE_KEY, ACCEPTED } from "./helpers/terms";

// The customer accepts the terms of use and the privacy policy ONCE per browser and version; the acceptance is stored with the booking / waitlist entry.
// A fresh browser (no remembered acceptance) sees the box; the server refuses a request whose versions are not the current ones.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase");
test.use({ storageState: { cookies: [], origins: [] } });

let n = 0;
const ip = () => `10.${200 + (n % 50)}.${Math.floor(Math.random() * 250)}.${++n % 250}`;
test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": ip() });
});

async function toDetails(page: Page, b: TestBusiness) {
  await page.goto(`/book/${b.slug}`);
  await page.getByTestId(`service-${b.services[0].id}`).check({ force: true });
  await page.getByTestId("continue").click();
  await page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
  await page.getByTestId("continue").click();
  await page.locator('input[name="time"]').first().check({ force: true });
  await page.getByTestId("continue").click();
  await expect(page.getByLabel("שם מלא")).toBeVisible();
}

async function fill(page: Page, b: TestBusiness, email: string) {
  await page.getByLabel("שם מלא").fill("נועם לוי");
  await page.getByLabel("טלפון נייד").fill("050-1234567");
  await page.getByLabel("אימייל").fill(email);
  for (const f of BUSINESS_KINDS[b.kind].intake.filter((x) => x.required)) {
    const el = page.getByTestId(`intake-${f.id}`);
    if (f.type === "select") await el.selectOption(f.options![0]);
    else await el.fill("דוגמה");
  }
}

const mail = () => `terms${Math.random().toString(36).slice(2, 9)}@example.com`;

test("first booking in a browser shows the box and is refused without it; ticking it books and stores the versions and the time", async ({ page }) => {
  const b = await makeBusiness("barber");
  await toDetails(page, b);
  const email = mail();
  await fill(page, b, email);
  const box = page.getByTestId("terms-accept");
  await expect(box).toBeVisible();
  await expect(page.getByTestId("terms-accept-box").getByRole("link", { name: "תנאי השימוש" })).toHaveAttribute("href", "/terms");
  await expect(page.getByTestId("terms-accept-box").getByRole("link", { name: "מדיניות הפרטיות" })).toHaveAttribute("href", "/privacy");

  let posts = 0;
  page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/bookings")) posts++; });
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("terms-accept-error")).toBeVisible();
  await expect(page.getByTestId("done-title")).toHaveCount(0);
  expect(posts, "nothing is sent without the acceptance").toBe(0);

  await box.click();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("done-title")).toBeVisible();

  const row = JSON.parse(await sql(`select row_to_json(t) from (select terms_version, privacy_version, terms_accepted_at is not null and terms_accepted_at > now() - interval '5 minutes' as fresh from public.appointments where contact_email = '${email}') t`));
  expect(row).toEqual({ terms_version: LEGAL.terms.version, privacy_version: LEGAL.privacy.version, fresh: true });
  expect(await page.evaluate((k) => localStorage.getItem(k), ACCEPTANCE_KEY)).toBe(JSON.stringify(ACCEPTED));
});

test("a second booking in the same browser does not show the box, and still stores the acceptance", async ({ page }) => {
  const b = await makeBusiness("barber");
  await toDetails(page, b);
  await fill(page, b, mail());
  await page.getByTestId("terms-accept").click();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("done-title")).toBeVisible();

  await toDetails(page, b);
  const email = mail();
  await fill(page, b, email);
  await expect(page.getByTestId("terms-accept")).toHaveCount(0);
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("done-title")).toBeVisible();
  const v = (await sql(`select terms_version from public.appointments where contact_email = '${email}'`)).trim();
  expect(v).toBe(LEGAL.terms.version);
});

test("a remembered older version shows the box again", async ({ page }) => {
  const b = await makeBusiness("barber");
  await page.addInitScript(([k, v]) => localStorage.setItem(k, v), [ACCEPTANCE_KEY, JSON.stringify({ terms: "2020-01-01", privacy: LEGAL.privacy.version })] as const);
  await toDetails(page, b);
  await expect(page.getByTestId("terms-accept")).toBeVisible();
});

test("the page works when the browser blocks storage: the box is shown and booking succeeds", async ({ page }) => {
  const b = await makeBusiness("barber");
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });
  });
  await toDetails(page, b);
  await fill(page, b, mail());
  await page.getByTestId("terms-accept").click();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("done-title")).toBeVisible();
});

test.describe("API: only the current versions are accepted", () => {
  const post = (request: APIRequestContext, b: TestBusiness, acceptedTerms: unknown, key: string) =>
    request.post(`/api/public/${b.slug}/bookings`, {
      headers: { "idempotency-key": key },
      data: { serviceId: b.services[0].id, date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10), time: "10:00", location: "business", customer: { ...customer(900), email: mail() }, ...(acceptedTerms === undefined ? {} : { acceptedTerms }) },
    });

  test("missing, old or extra versions give VALIDATION_FAILED (422, like every validation error here) with a Hebrew message on the consent field", async ({ request }) => {
    const b = await makeBusiness("barber");
    let i = 0;
    for (const bad of [undefined, {}, { terms: "2020-01-01", privacy: LEGAL.privacy.version }, { terms: LEGAL.terms.version, privacy: "x" }, { ...ACCEPTED, extra: 1 }]) {
      const r = await post(request, b, bad, `terms-bad-key-${Date.now()}-${i++}`);
      expect(r.status(), JSON.stringify(bad)).toBe(422);
      const body = await r.json();
      expect(body.error.code).toBe("VALIDATION_FAILED");
      const d = body.error.details.find((x: { field: string }) => x.field.startsWith("acceptedTerms"));
      expect(d?.message).toMatch(/[א-ת]/);
    }
    expect((await sql(`select count(*) from public.appointments where business_id = '${b.id}'`)).trim()).toBe("0");
  });

  test("the waitlist is the same", async ({ request }) => {
    const b = await makeBusiness("barber");
    await sql(`update public.businesses set waitlist_enabled = true where id = '${b.id}'`);
    const date = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const send = (acceptedTerms?: unknown) => request.post(`/api/public/${b.slug}/waitlist`, { data: { serviceId: b.services[0].id, date, customer: { ...customer(901), email: mail() }, ...(acceptedTerms === undefined ? {} : { acceptedTerms }) } });
    const bad = await send();
    expect(bad.status()).toBe(422);
    expect((await bad.json()).error.details[0].field).toBe("acceptedTerms");
    const ok = await send(ACCEPTED);
    expect(ok.status()).toBe(201);
    expect((await sql(`select terms_version || '|' || privacy_version from public.waitlist_entries where business_id = '${b.id}'`)).trim()).toBe(`${LEGAL.terms.version}|${LEGAL.privacy.version}`);
  });
});

test("waitlist form: first join shows the box and is refused without it; the next join in this browser does not show it", async ({ page }) => {
  const b = await makeBusiness("barber");
  await sql(`update public.businesses set waitlist_enabled = true where id = '${b.id}'`);
  const date = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const join = async (email: string, tick: boolean) => {
    await page.goto(`/book/${b.slug}/waitlist`);
    await page.getByTestId("wl-service").selectOption(b.services[0].id);
    await page.getByTestId("wl-date").fill(date);
    await page.getByTestId("wl-name").fill("נועם לוי");
    await page.getByTestId("wl-phone").fill("050-1234567");
    await page.getByTestId("wl-email").fill(email);
    if (tick) await page.getByTestId("wl-terms").click();
    await page.getByTestId("wl-submit").click();
  };
  const first = mail();
  await join(first, false);
  await expect(page.getByTestId("wl-terms-error")).toBeVisible();
  await expect(page.getByTestId("waitlist-done")).toHaveCount(0);
  await page.getByTestId("wl-terms").click();
  await page.getByTestId("wl-submit").click();
  await expect(page.getByTestId("waitlist-done")).toBeVisible();
  expect((await sql(`select terms_version from public.waitlist_entries where contact_email = '${first}'`)).trim()).toBe(LEGAL.terms.version);

  await page.goto(`/book/${b.slug}/waitlist`);
  await expect(page.getByTestId("wl-terms")).toHaveCount(0);
});
