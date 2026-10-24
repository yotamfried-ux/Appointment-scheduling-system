import { expect, test, type APIRequestContext } from "@playwright/test";
import * as C from "../../lib/api/contracts";
import { rowsToExceptions, rowsToRules } from "../../modules/availability/schema";
import { slotsForDay } from "../../modules/availability/slots";
import { BUSINESS_KINDS } from "../../modules/tenancy/business-kind";
import { admin, anonClient, customer, makeBusiness, rand, signedInOwner, todayLocal } from "./helpers/business";
import { ACCEPTED } from "./helpers/terms";

// Public booking against the REAL local stack (docs/04 BKG-*). The API is exercised like an anonymous customer; the database
// and the owner's JWT (RLS) are the source of truth for what really happened. No mocks.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");

let ipCounter = 0;
const freshIp = () => `10.${(Date.now() >> 8) % 250}.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;
const idem = () => `idem-${rand()}-${Math.random().toString(36).slice(2, 10)}`;

const get = (r: APIRequestContext, slug: string, path: string, headers: Record<string, string> = {}) => r.get(`/api/public/${slug}/${path}`, { headers: { "x-forwarded-for": freshIp(), ...headers } });
const post = (r: APIRequestContext, slug: string, body: unknown, key = idem(), headers: Record<string, string> = {}) =>
  r.post(`/api/public/${slug}/bookings`, { data: body, headers: { "x-forwarded-for": freshIp(), "idempotency-key": key, ...headers } });

async function firstFreeSlot(r: APIRequestContext, slug: string, serviceId: string, fromOffset = 2) {
  const av = C.AvailabilityResponse.parse(await (await get(r, slug, `availability?service=${serviceId}&from=${todayLocal(fromOffset)}&days=14`)).json());
  const day = av.days.find((d) => d.freeSlots > 0)!;
  const sl = C.SlotsResponse.parse(await (await get(r, slug, `slots?service=${serviceId}&date=${day.date}`)).json());
  return { date: day.date, times: sl.slots.map((s) => s.time), slots: sl };
}
const body = (serviceId: string, date: string, time: string, n = 1, over: Record<string, unknown> = {}) => ({ serviceId, date, time, location: "business", acceptedTerms: ACCEPTED, customer: customer(n), intake: {}, ...over });

test.describe("catalogue and availability are customer-safe (BKG-11/13)", () => {
  test("services endpoint follows the contract; unknown and unpublished businesses are indistinguishable 404s", async ({ request }) => {
    const b = await makeBusiness("barber");
    const hidden = await makeBusiness("barber", { publish: false });
    const res = await get(request, b.slug, "services");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const d = C.ServicesResponse.parse(await res.json());
    expect(d.kind).toBe("barber");
    expect(d.services.map((s) => s.name)).toEqual(b.services.map((s) => s.name));
    expect(d.business.vocab.appointment).toBe("תור");
    const a = await get(request, "no-such-business", "services");
    const u = await get(request, hidden.slug, "services");
    expect(a.status()).toBe(404);
    expect(u.status()).toBe(404);
    const strip = (j: { error: { code: string; message: string } }) => ({ code: j.error.code, message: j.error.message });
    expect(strip(await a.json())).toEqual(strip(await u.json())); // no enumeration
    expect((await get(request, "BAD SLUG!!", "services")).status()).toBe(404);
  });

  test("slots equal an independent computation from the saved rules; closed days and past times are never offered", async ({ request }) => {
    const b = await makeBusiness("trainer"); // split day
    const svc = b.services[0];
    const rules = (await b.db.from("availability_rules").select("weekday, start_minute, end_minute")).data!;
    const exc = (await b.db.from("availability_exceptions").select("id, on_date, kind, start_minute, end_minute, note")).data!;
    for (let i = 1; i <= 8; i++) {
      const date = todayLocal(i);
      const api = C.SlotsResponse.parse(await (await get(request, b.slug, `slots?service=${svc.id}&date=${date}`)).json());
      const expected = slotsForDay({ date, timeZone: "Asia/Jerusalem", rules: rowsToRules(rules), exceptions: rowsToExceptions(exc as never), durationMinutes: svc.duration_minutes, bufferMinutes: svc.buffer_minutes, stepMinutes: 30, now: new Date(), minNoticeMinutes: 60 });
      expect(api.slots.map((s) => s.time), date).toEqual(expected.map((s) => s.local));
      expect(api.closed).toBe(api.windows.length === 0);
    }
    const closed = C.SlotsResponse.parse(await (await get(request, b.slug, `slots?service=${svc.id}&date=${todayLocal(((7 - new Date(`${todayLocal(0)}T12:00:00Z`).getUTCDay()) % 7 || 7) + 6 - 0)}`)).json());
    expect(closed.slots.every((s) => s.time >= "06:00")).toBe(true);
    const far = C.SlotsResponse.parse(await (await get(request, b.slug, `slots?service=${svc.id}&date=${todayLocal(400)}`)).json());
    expect(far.slots).toEqual([]); // beyond the booking horizon
  });

  test("responses never contain other customers' data", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstFreeSlot(request, b.slug, b.services[0].id);
    const c = customer(77, { fullName: "שם סודי של לקוח" });
    expect((await post(request, b.slug, body(b.services[0].id, f.date, f.times[0], 77, { customer: c }))).status()).toBe(201);
    for (const p of [`services`, `availability?service=${b.services[0].id}&from=${f.date}&days=7`, `slots?service=${b.services[0].id}&date=${f.date}`]) {
      const txt = await (await get(request, b.slug, p)).text();
      expect(txt).not.toContain("שם סודי");
      expect(txt).not.toContain(c.phone);
      expect(txt).not.toContain(c.email);
    }
  });
});

test.describe("booking (BKG-02/04/05/07/09/10/15)", () => {
  test("a booking creates exactly the right rows; the slot disappears; a returning e-mail keeps one customer", async ({ request }) => {
    const b = await makeBusiness("barber");
    const svc = b.services[0];
    const f = await firstFreeSlot(request, b.slug, svc.id);
    const res = await post(request, b.slug, body(svc.id, f.date, f.times[0], 1, { acceptedTerms: ACCEPTED, customer: { fullName: "נועם לוי", phone: "050-1234567", email: "noam@example.com" } }));
    expect(res.status()).toBe(201);
    const bk = C.CreateBookingResponse.parse(await res.json()).booking;
    expect(bk).toMatchObject({ status: "confirmed", date: f.date, time: f.times[0], requiresApproval: false });
    expect(bk.manageUrl).toMatch(/^\/booking\/[\w-]+\.[\w-]+$/);

    const rows = (await b.db.from("appointments").select("id, reference, status, starts_at, price_cents, service_snapshot, customers(phone, full_name, email)").eq("business_id", b.id)).data!;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reference: bk.reference, status: "confirmed" });
    expect((rows[0].customers as unknown as { phone: string }).phone).toBe("+972501234567"); // normalised E.164
    const after = C.SlotsResponse.parse(await (await get(request, b.slug, `slots?service=${svc.id}&date=${f.date}`)).json());
    expect(after.slots.map((s) => s.time)).not.toContain(f.times[0]);

    // BKG-05: same e-mail (written another way), another name and phone → still one customer; the stored identity is NOT rewritten by an unauthenticated booking (takeover control)
    const f2 = f.times.find((t) => t !== f.times[0] && !after.slots.every((s) => s.time !== t))!;
    const r2 = await post(request, b.slug, body(svc.id, f.date, f2, 1, { acceptedTerms: ACCEPTED, customer: { fullName: "נועם לוי המעודכן", phone: "0509999999", email: "Noam@Example.com" } }));
    expect(r2.status()).toBe(201);
    const custs = (await b.db.from("customers").select("full_name, phone").eq("business_id", b.id)).data!;
    expect(custs).toEqual([{ full_name: "נועם לוי", phone: "+972501234567" }]);
    expect((await b.db.from("domain_events").select("id").eq("type", "AppointmentCreated")).data).toBeNull(); // outbox is system-only (RLS): the owner cannot read it
  });

  test("SEC: one e-mail address cannot be used to flood a third party's inbox; other addresses are unaffected", async ({ request }) => {
    const b = await makeBusiness("barber");
    const svc = b.services[0];
    const f = await firstFreeSlot(request, b.slug, svc.id);
    const victim = `victim${rand()}@example.com`;
    const ip = { "x-test-email-scope": rand(), "x-test-email-limit": "2" };
    const as = (i: number, email: string) => post(request, b.slug, body(svc.id, f.date, f.times[i], 10 + i, { acceptedTerms: ACCEPTED, customer: { ...customer(10 + i), email } }), idem(), ip);
    expect((await as(0, victim)).status()).toBe(201);
    expect((await as(1, victim)).status()).toBe(201);
    const third = await as(2, victim);
    expect(third.status()).toBe(429);
    expect(third.headers()["retry-after"]).toBeTruthy();
    expect((await as(2, "someone-else@example.com")).status()).toBe(201);
  });

  test("idempotency: replay returns the same booking (200), a different body with the same key is refused, a missing key is 400", async ({ request }) => {
    const b = await makeBusiness("barber");
    const svc = b.services[0];
    const f = await firstFreeSlot(request, b.slug, svc.id);
    const key = idem();
    const first = await post(request, b.slug, body(svc.id, f.date, f.times[0]), key);
    const again = await post(request, b.slug, body(svc.id, f.date, f.times[0]), key);
    expect(first.status()).toBe(201);
    expect(again.status()).toBe(200);
    expect(again.headers()["idempotent-replay"]).toBe("true");
    expect((await again.json()).booking.id).toBe((await first.json()).booking.id);
    expect((await b.db.from("appointments").select("id").eq("business_id", b.id)).data).toHaveLength(1);
    const reuse = await post(request, b.slug, body(svc.id, f.date, f.times[1], 2), key);
    expect(reuse.status()).toBe(422);
    expect((await reuse.json()).error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    const nokey = await request.post(`/api/public/${b.slug}/bookings`, { data: body(svc.id, f.date, f.times[2]), headers: { "x-forwarded-for": freshIp() } });
    expect(nokey.status()).toBe(400);
  });

  test("validation: each problem is reported with its field; unknown fields (tenant spoofing) are refused", async ({ request }) => {
    const b = await makeBusiness("teacher"); // has a REQUIRED intake field
    const svc = b.services[0];
    const f = await firstFreeSlot(request, b.slug, svc.id);
    const post422 = async (over: Record<string, unknown>, intake: Record<string, string> = { level: "י׳" }) => {
      const r = await post(request, b.slug, body(svc.id, f.date, f.times[0], 3, { intake, ...over }));
      expect(r.status(), JSON.stringify(over)).toBe(422);
      return C.ApiErrorBody.parse(await r.json()).error;
    };
    expect((await post422({ customer: customer(3, { phone: "050-12" }) })).details!.map((d) => d.field)).toContain("customer.phone");
    expect((await post422({ customer: customer(3, { fullName: "א" }) })).details!.map((d) => d.field)).toContain("customer.fullName");
    expect((await post422({}, {})).details!.map((d) => d.field)).toContain("intake.level"); // required by the kind
    expect((await post422({ businessId: "00000000-0000-0000-0000-000000000000" })).code).toBe("VALIDATION_FAILED");
    expect((await post422({}, { level: "י׳", hacker: "x" })).details!.map((d) => d.field)).toContain("intake.hacker");
    expect((await b.db.from("appointments").select("id").eq("business_id", b.id)).data).toEqual([]); // nothing was created

    // a barber serves at the business only: other modes are refused with the field named
    const barber = await makeBusiness("barber");
    const bf = await firstFreeSlot(request, barber.slug, barber.services[0].id);
    const r = await post(request, barber.slug, body(barber.services[0].id, bf.date, bf.times[0], 4, { location: "online" }));
    expect(r.status()).toBe(422);
    expect(C.ApiErrorBody.parse(await r.json()).error.details!.map((d) => d.field)).toContain("location");
  });

  test("closed days, off-grid times, past times and the far future are INVALID_SLOT; a switched-off service is SERVICE_UNAVAILABLE", async ({ request }) => {
    const b = await makeBusiness("barber");
    const svc = b.services[0];
    const f = await firstFreeSlot(request, b.slug, svc.id);
    let n = 0;
    const code = async (date: string, time: string) => {
      const r = await post(request, b.slug, body(svc.id, date, time, 100 + ++n)); // a fresh phone each time: this test is not about the per-phone limit
      return [r.status(), (await r.json()).error?.code] as const;
    };
    const sat = [3, 4, 5, 6, 7, 8, 9].map((i) => todayLocal(i)).find((d) => new Date(`${d}T12:00:00Z`).getUTCDay() === 6)!;
    expect(await code(sat, "10:00")).toEqual([422, "INVALID_SLOT"]);
    expect(await code(f.date, "03:00")).toEqual([422, "INVALID_SLOT"]);
    expect(await code(f.date, "10:07")).toEqual([422, "INVALID_SLOT"]); // not on the 30-minute grid
    expect(await code(todayLocal(-2), "10:00")).toEqual([422, "INVALID_SLOT"]);
    expect(await code(todayLocal(300), "10:00")).toEqual([422, "INVALID_SLOT"]);
    // BKG-15: the last start must leave room for the whole service inside opening hours
    const day = C.SlotsResponse.parse(await (await get(request, b.slug, `slots?service=${svc.id}&date=${f.date}`)).json());
    const close = day.windows.at(-1)!.to;
    const late = `${String(Math.floor((close - 15) / 60)).padStart(2, "0")}:${String((close - 15) % 60).padStart(2, "0")}`;
    expect(await code(f.date, late)).toEqual([422, "INVALID_SLOT"]);
    // BKG-10
    expect((await b.db.from("services").update({ active: false }).eq("id", svc.id)).error).toBeNull();
    expect(await code(f.date, f.times[0])).toEqual([409, "SERVICE_UNAVAILABLE"]);
    expect(await code(f.date, f.times[0])).toEqual([409, "SERVICE_UNAVAILABLE"]);
  });

  test("approval kinds create pending bookings (BKG-09); the 6th future booking of one phone is refused (BKG-07)", async ({ request }) => {
    const c = await makeBusiness("clinic");
    const f = await firstFreeSlot(request, c.slug, c.services[0].id);
    const r = await post(request, c.slug, body(c.services[0].id, f.date, f.times[0], 5, { intake: {} }));
    expect(r.status()).toBe(201);
    expect((await r.json()).booking).toMatchObject({ status: "pending", requiresApproval: true });

    const b = await makeBusiness("barber");
    const svc = b.services.find((s) => s.duration_minutes <= 30)!;
    const days: string[] = [];
    for (let i = 2; days.length < 6 && i < 20; i++) {
      const sl = C.SlotsResponse.parse(await (await get(request, b.slug, `slots?service=${svc.id}&date=${todayLocal(i)}`)).json());
      if (sl.slots.length) days.push(`${todayLocal(i)}|${sl.slots[0].time}`);
    }
    const out: number[] = [];
    let lastCode = "";
    for (const [i, d] of days.entries()) {
      const [date, time] = d.split("|");
      const res = await post(request, b.slug, body(svc.id, date, time, 9, { customer: customer(9) }));
      out.push(res.status());
      if (i === 5) lastCode = (await res.json()).error?.code;
      if (i === 4) expect(out).toEqual([201, 201, 201, 201, 201]);
    }
    expect(out[5]).toBe(409);
    expect(lastCode).toBe("BOOKING_LIMIT");
  });
});

test.describe("races and abuse (BKG-02, BKG-12)", () => {
  test("50 customers book the SAME slot at the same moment: exactly one wins, 49 get 409, the database holds one appointment", async ({ request }) => {
    const b = await makeBusiness("barber");
    const svc = b.services[0];
    const f = await firstFreeSlot(request, b.slug, svc.id);
    const time = f.times[0];
    const results = await Promise.all(Array.from({ length: 50 }, (_, i) => post(request, b.slug, body(svc.id, f.date, time, 100 + i, { customer: customer(100 + i) }))));
    const statuses = results.map((r) => r.status());
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(49);
    for (const r of results.filter((x) => x.status() === 409)) expect((await r.json()).error.code).toBe("SLOT_TAKEN");
    expect((await b.db.from("appointments").select("id").eq("business_id", b.id)).data).toHaveLength(1);
    expect((await b.db.from("customers").select("id").eq("business_id", b.id)).data!.length).toBeLessThanOrEqual(50);
  });

  test("100 mixed concurrent requests over overlapping starts never produce two overlapping appointments", async ({ request }) => {
    const b = await makeBusiness("barber");
    const svc = b.services.find((s) => s.duration_minutes >= 60) ?? b.services[0];
    const f = await firstFreeSlot(request, b.slug, svc.id);
    const times = f.times.slice(0, 6); // 30-minute grid ⇒ neighbours overlap a 60+ minute service
    const reqs = Array.from({ length: 100 }, (_, i) => post(request, b.slug, body(svc.id, f.date, times[i % times.length], 200 + i, { customer: customer(200 + i) })));
    const statuses = (await Promise.all(reqs)).map((r) => r.status());
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    const rows = (await b.db.from("appointments").select("starts_at, blocked_until").eq("business_id", b.id).order("starts_at")).data!;
    expect(rows.length).toBe(statuses.filter((s) => s === 201).length);
    for (let i = 1; i < rows.length; i++) expect(Date.parse(rows[i].starts_at), `overlap between #${i - 1} and #${i}`).toBeGreaterThanOrEqual(Date.parse(rows[i - 1].blocked_until));
  });

  test("a double-submit with the same key books once", async ({ request }) => {
    const b = await makeBusiness("barber");
    const svc = b.services[0];
    const f = await firstFreeSlot(request, b.slug, svc.id);
    const key = idem();
    const [x, y] = await Promise.all([post(request, b.slug, body(svc.id, f.date, f.times[0]), key), post(request, b.slug, body(svc.id, f.date, f.times[0]), key)]);
    expect([x.status(), y.status()].every((st) => [200, 201, 409].includes(st))).toBe(true);
    const created = (await b.db.from("appointments").select("id").eq("business_id", b.id)).data!;
    expect(created).toHaveLength(1); // never two, whatever the interleaving
  });

  test("rate limiting: per-IP limit answers 429 with Retry-After; another IP is unaffected; the limiter stores no raw IP or phone", async ({ request }) => {
    const b = await makeBusiness("barber");
    const svc = b.services[0];
    const f = await firstFreeSlot(request, b.slug, svc.id);
    const ip = freshIp();
    const mk = (n: number) => request.post(`/api/public/${b.slug}/bookings`, { data: body(svc.id, f.date, "03:00", n), headers: { "x-forwarded-for": ip, "idempotency-key": idem(), "x-test-limit": "2" } });
    expect((await mk(1)).status()).toBe(422);
    expect((await mk(2)).status()).toBe(422);
    const third = await mk(3);
    expect(third.status()).toBe(429);
    expect(Number(third.headers()["retry-after"])).toBeGreaterThan(0);
    expect((await third.json()).error.code).toBe("RATE_LIMITED");
    const other = await request.post(`/api/public/${b.slug}/bookings`, { data: body(svc.id, f.date, "03:00", 4), headers: { "x-forwarded-for": freshIp(), "idempotency-key": idem(), "x-test-limit": "2" } });
    expect(other.status()).toBe(422);
    const keys = (await admin().from("rate_counters").select("key").like("key", "book-ip:%")).data!.map((r) => r.key as string);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) {
      expect(k).toMatch(/^book-ip:[0-9a-f]{32}$/);
      expect(k).not.toContain(ip);
    }
  });

  test("one phone cannot flood a business: the 7th attempt within the hour is 429 (BKG-12)", async ({ request }) => {
    const b = await makeBusiness("barber");
    const svc = b.services[0];
    const f = await firstFreeSlot(request, b.slug, svc.id);
    const phone = `+9725${Math.floor(10000000 + Math.random() * 8999999)}`;
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await post(request, b.slug, body(svc.id, f.date, "03:00", i, { customer: customer(i, { phone }) }))).status());
    expect(codes.slice(0, 6).every((c) => c === 422)).toBe(true);
    expect(codes[6]).toBe(429);
  });

  test("anonymous callers cannot reach the system functions or the tables directly", async ({ request }) => {
    const b = await makeBusiness("barber");
    const anon = anonClient();
    expect((await anon.rpc("public_catalog", { p_slug: b.slug })).error?.code).toBe("42501");
    expect((await anon.rpc("public_book", { p_business: b.id, p_service: b.services[0].id, p_starts_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), p_full_name: "x y", p_phone: "+972501234567", p_email: null, p_location: "business", p_intake: {}, p_idem_key: idem(), p_request_hash: "h" })).error?.code).toBe("42501");
    expect((await anon.rpc("public_rate_limit", { p_key: "x", p_window_seconds: 60, p_max: 1 })).error?.code).toBe("42501");
    for (const t of ["appointments", "customers", "booking_idempotency", "token_uses", "domain_events"]) expect((await anon.from(t).select("*")).error?.code, t).toBe("42501");
    const owner = await signedInOwner("other-owner"); // an authenticated owner of ANOTHER business is not special either
    expect((await owner.db.rpc("public_catalog", { p_slug: b.slug })).error?.code).toBe("42501");
    void request;
  });
});

test.describe("tenant isolation of bookings (SEC-01)", () => {
  test("an owner with a valid JWT cannot read or change another business's appointments, customers or statuses", async ({ request }) => {
    const a = await makeBusiness("barber");
    const other = await makeBusiness("barber");
    const f = await firstFreeSlot(request, a.slug, a.services[0].id);
    const res = await post(request, a.slug, body(a.services[0].id, f.date, f.times[0], 31));
    const id = (await res.json()).booking.id as string;
    expect((await other.db.from("appointments").select("*").eq("business_id", a.id)).data).toEqual([]);
    expect((await other.db.from("customers").select("*").eq("business_id", a.id)).data).toEqual([]);
    expect((await other.db.rpc("transition_appointment", { p_id: id, p_action: "complete" })).error?.code).toBe("42501");
    expect((await other.db.from("appointments").update({ status: "no_show" }).eq("id", id).select()).error?.code).toBe("42501");
    expect((await a.db.from("appointments").select("status").eq("id", id).single()).data!.status).toBe("confirmed");
    // the real owner can transition (the dashboard uses this), and the state machine guards it.
    // (A future appointment cannot be marked completed — that rule is tested in 040_owner_ops; cancelling is valid.)
    expect((await a.db.rpc("transition_appointment", { p_id: id, p_action: "complete" })).error?.message).toContain("too_early");
    expect((await a.db.rpc("transition_appointment", { p_id: id, p_action: "cancel" })).data).toMatchObject({ status: "cancelled_by_business" });
    expect((await a.db.rpc("transition_appointment", { p_id: id, p_action: "approve" })).error?.message).toContain("invalid_transition");
  });
});

test.describe("slug changes keep old links working (ACC-07)", () => {
  test("the old slug still serves the API and redirects the page; the new slug is canonical", async ({ request, page }) => {
    const b = await makeBusiness("barber");
    const next = `${b.slug}-new`;
    expect((await b.db.rpc("change_business_slug", { p_business: b.id, p_new_slug: next })).error).toBeNull();
    expect((await get(request, b.slug, "services")).status()).toBe(200);
    expect((await get(request, next, "services")).status()).toBe(200);
    await page.goto(`/book/${b.slug}`);
    await expect(page).toHaveURL(new RegExp(`/book/${next}$`));
    await expect(page.getByTestId("business-name")).toBeVisible();
  });
});

void BUSINESS_KINDS;
