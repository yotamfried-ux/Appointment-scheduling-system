import { expect, test } from "@playwright/test";
import { admin, firstDayWithSlots, loginAs, makeBusiness } from "./helpers/business";
import { ACCEPTED } from "./helpers/terms";

// CAT-05: free / "from" / fixed / hidden prices, from the owner's settings to the customer's page.
test("the owner chooses how each price is shown; customers see exactly that; a free service really costs nothing", async ({ page, request }) => {
  const b = await makeBusiness("barber");
  await loginAs(page, b.ownerEmail);
  const set = async (name: string, mode: string, price?: string) => {
    await page.goto("/settings/services");
    await page.getByRole("button", { name: `עריכה · ${name}` }).click();
    await page.getByTestId("service-price-mode").selectOption(mode);
    if (price !== undefined) await page.getByLabel("מחיר (₪)").fill(price);
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("status").filter({ hasText: "השירות נשמר." })).toBeVisible();
  };
  const [s0, s1, s2] = b.services;
  await set(s0.name, "free");
  await set(s1.name, "from", "150");
  await set(s2.name, "hidden", "99");
  const rows = (await admin().from("services").select("id, price_mode, price_cents").eq("business_id", b.id).in("id", [s0.id, s1.id, s2.id])).data!;
  expect(rows.find((r) => r.id === s0.id)).toMatchObject({ price_mode: "free", price_cents: 0 });
  expect(rows.find((r) => r.id === s1.id)).toMatchObject({ price_mode: "from", price_cents: 15000 });

  const api = await (await request.get(`/api/public/${b.slug}/services`)).json();
  expect(api.services.find((s: { id: string }) => s.id === s0.id)).toMatchObject({ priceNis: 0, priceMode: "free" });
  await page.context().clearCookies();
  await page.goto(`/book/${b.slug}`);
  const card = (id: string) => page.locator("label").filter({ has: page.getByTestId(`service-${id}`) });
  await expect(card(s0.id)).toContainText("ללא עלות");
  await expect(card(s1.id)).toContainText("החל מ");
  await expect(card(s2.id)).not.toContainText("99");
  // a free service can be booked end to end and the private page does not invent a price
  const f = await firstDayWithSlots(request, b);
  const res = await request.post(`/api/public/${b.slug}/bookings`, { data: { serviceId: s0.id, date: f.date, time: f.times[0], location: "business", acceptedTerms: ACCEPTED, customer: { fullName: "חינם", phone: "0501119999", email: `free${Date.now()}@example.com` }, intake: {} }, headers: { "x-forwarded-for": "10.9.9.9", "idempotency-key": `free-${Date.now()}-1234` } });
  expect(res.status()).toBe(201);
  await page.goto((await res.json()).booking.manageUrl);
  await expect(page.getByTestId("manage-panel").getByText("ללא עלות")).toBeVisible();
});

test("the database refuses a 'free' service with a price (a bypassed UI cannot store nonsense)", async () => {
  const b = await makeBusiness("barber");
  const r = await b.db.from("services").update({ price_mode: "free", price_cents: 500 }).eq("id", b.services[0].id);
  expect(r.error?.code).toBe("23514");
});
