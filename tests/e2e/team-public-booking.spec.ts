import { expect, test } from "@playwright/test";
import * as C from "../../lib/api/contracts";
import { kindHours } from "../../lib/lab/onboarding";
import { admin, customer, fakeIp, firstDayWithSlots, makeBusiness } from "./helpers/business";

// Stage 16 / TEAM-04, 05, 06 through the real public API: two people share one booking page.
const post = (request: import("@playwright/test").APIRequestContext, slug: string, body: unknown) =>
  request.post(`/api/public/${slug}/bookings`, { data: body, headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `idem-${Math.random().toString(36).slice(2)}` } });
const book = (request: import("@playwright/test").APIRequestContext, b: Awaited<ReturnType<typeof makeBusiness>>, date: string, time: string, n: number, personId?: string) =>
  post(request, b.slug, { serviceId: b.services[0].id, date, time, location: "business", customer: customer(n), intake: {}, ...(personId ? { personId } : {}) });

test("two people: the page offers the union, 'whoever is free' spreads over both, a named person is never swapped, a third booking is refused", async ({ request }) => {
  const b = await makeBusiness("barber");
  const noam = (await b.db.rpc("create_staff", { p_business: b.id, p_name: "נועם" })).data as string;
  expect((await b.db.rpc("set_staff_hours", { p_resource: noam, p_hours: kindHours("barber") })).error).toBeNull();

  const services = C.ServicesResponse.parse(await (await request.get(`/api/public/${b.slug}/services`)).json());
  expect(services.team.map((p) => p.name)).toContain("נועם");
  expect(services.team).toHaveLength(2);

  const { date, times } = await firstDayWithSlots(request, b);
  const t = times[0];
  const r1 = await book(request, b, date, t, 1);
  const r2 = await book(request, b, date, t, 2);
  expect([r1.status(), r2.status()]).toEqual([201, 201]);
  const names = [(await r1.json()).booking.personName, (await r2.json()).booking.personName];
  expect(new Set(names).size, "the two customers got different people").toBe(2);
  const r3 = await book(request, b, date, t, 3);
  expect(r3.status()).toBe(409);
  expect((await r3.json()).error?.code ?? (await r3.json()).code).toMatch(/SLOT_TAKEN/);
  const rows = (await admin().from("appointments").select("resource_id, resource_chosen").eq("business_id", b.id)).data!;
  expect(rows).toHaveLength(2);
  expect(new Set(rows.map((r) => r.resource_id)).size).toBe(2);
  expect(rows.every((r) => r.resource_chosen === false)).toBe(true);

  // the time is gone for everybody now
  const after = C.SlotsResponse.parse(await (await request.get(`/api/public/${b.slug}/slots?service=${b.services[0].id}&date=${date}`)).json());
  expect(after.slots.map((s) => s.time)).not.toContain(t);

  // a named person: only that person, remembered as chosen, and never swapped for the other one
  const t2 = times[Math.min(4, times.length - 1)];
  const named = await book(request, b, date, t2, 4, noam);
  expect(named.status()).toBe(201);
  expect((await named.json()).booking.personName).toBe("נועם");
  const again = await book(request, b, date, t2, 5, noam);
  expect(again.status(), "the same person at the same time is taken even though the other person is free").toBe(409);
  const noamSlots = C.SlotsResponse.parse(await (await request.get(`/api/public/${b.slug}/slots?service=${b.services[0].id}&date=${date}&person=${noam}`)).json());
  expect(noamSlots.slots.map((s) => s.time)).not.toContain(t2);
  const anyoneSlots = C.SlotsResponse.parse(await (await request.get(`/api/public/${b.slug}/slots?service=${b.services[0].id}&date=${date}`)).json());
  expect(anyoneSlots.slots.map((s) => s.time), "someone else is still free then").toContain(t2);
  const chosen = (await admin().from("appointments").select("resource_chosen").eq("business_id", b.id).eq("resource_id", noam).eq("resource_chosen", true)).data!;
  expect(chosen).toHaveLength(1);

  // a made-up person is refused, not turned into 'anyone'
  const bogus = await book(request, b, date, times[2] ?? t, 6, "00000000-0000-0000-0000-000000000000");
  expect(bogus.status()).toBeGreaterThanOrEqual(400);
  expect(bogus.status()).toBeLessThan(500);
});

test("a one-person business shows no team and books exactly as before", async ({ request }) => {
  const b = await makeBusiness("barber");
  const services = C.ServicesResponse.parse(await (await request.get(`/api/public/${b.slug}/services`)).json());
  expect(services.team).toEqual([]);
  const { date, times } = await firstDayWithSlots(request, b);
  const r = await book(request, b, date, times[0], 7);
  expect(r.status()).toBe(201);
  expect((await r.json()).booking.personName).toBeUndefined();
});
