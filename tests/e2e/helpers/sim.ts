import { expect, type APIRequestContext, type Page } from "@playwright/test";
import * as C from "../../../lib/api/contracts";
import { customer, fakeIp, type TestBusiness } from "./business";
import { ACCEPTED } from "./terms";

// Shared pieces of the sim-* simulations (a person using the product, not a unit under test).

/** The page never scrolls sideways. */
export const noOverflow = async (page: Page, where = "") =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${where} horizontal overflow`).toBeLessThanOrEqual(0);

/** Book every free time of a day through the public API until the day has none left. Returns how many appointments were made. */
export async function fillDay(request: APIRequestContext, b: TestBusiness, date: string, firstCustomer = 1000): Promise<number> {
  let made = 0;
  for (;;) {
    const slots = C.SlotsResponse.parse(await (await request.get(`/api/public/${b.slug}/slots?service=${b.services[0].id}&date=${date}`)).json()).slots;
    if (slots.length === 0) return made;
    const r = await request.post(`/api/public/${b.slug}/bookings`, {
      data: { serviceId: b.services[0].id, date, time: slots[0].time, location: "business", acceptedTerms: ACCEPTED, customer: { ...customer(firstCustomer + made), email: `fill${firstCustomer + made}.${Math.random().toString(36).slice(2, 8)}@example.com` }, intake: {} },
      headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `fill-${Math.random().toString(36).slice(2)}` },
    });
    expect(r.status(), await r.text()).toBe(201);
    made++;
    expect(made).toBeLessThan(60);
  }
}
