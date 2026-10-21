import { expect, test, type Page } from "@playwright/test";
import * as C from "../../lib/api/contracts";
import { firstDayWithSlots, loginAs, makeBusiness, customer, publicBook } from "./helpers/business";

// Owner API against the real stack: session auth, CSRF, tenant isolation (SEC-01), state machine, manual appointments (AVL-09/10).
const person = (n: number) => { const { fullName, phone } = customer(n); return { fullName, phone }; }; // the owner form has no e-mail field
const post = (page: Page, url: string, data: unknown, headers: Record<string, string> = {}) => page.request.post(url, { data, headers: { origin: new URL(page.url()).origin, ...headers } });
const agendaOf = async (page: Page, date: string) => C.OwnerAgendaResponse.parse(await (await page.request.get(`/api/owner/appointments?date=${date}`)).json());

test.describe("owner API", () => {
  test("without a session every owner endpoint answers 401 and reveals nothing", async ({ request }) => {
    const get = await request.get("/api/owner/appointments");
    expect(get.status()).toBe(401);
    expect(C.ApiErrorBody.parse(await get.json()).error.code).toBe("UNAUTHENTICATED");
    const origin = "http://127.0.0.1:3100";
    const mk = await request.post("/api/owner/appointments", { data: {}, headers: { origin } });
    expect(mk.status()).toBe(401);
    const tr = await request.post("/api/owner/appointments/00000000-0000-0000-0000-000000000000/transition", { data: { action: "approve" }, headers: { origin } });
    expect(tr.status()).toBe(401);
  });

  test("the agenda lists the day's appointments with the customer, service and status; approve/reject move them and free the slot for the public", async ({ page, request }) => {
    const c = await makeBusiness("clinic");
    await loginAs(page, c.ownerEmail);
    const f = await firstDayWithSlots(request, c);
    const a = await publicBook(request, c, f.date, f.times[0], 1);
    const b = await publicBook(request, c, f.date, f.times[2], 2);

    const ag = await agendaOf(page, f.date);
    expect(ag.business.kind).toBe("clinic");
    expect(ag.appointments.map((x) => x.status)).toEqual(["pending", "pending"]);
    expect(ag.appointments[0]).toMatchObject({ customer: "לקוח בדיקה 1", phone: "+972501000001", manual: false, outOfHours: false });
    expect(ag.windows.length).toBeGreaterThan(0);
    expect(ag.services.length).toBeGreaterThan(0);

    const ok = await post(page, `/api/owner/appointments/${a.id}/transition`, { action: "approve" });
    expect(ok.status()).toBe(200);
    expect(C.OwnerTransitionResponse.parse(await ok.json())).toEqual({ id: a.id, status: "confirmed" });
    const again = await post(page, `/api/owner/appointments/${a.id}/transition`, { action: "approve" });
    expect(again.status()).toBe(409);
    expect(C.ApiErrorBody.parse(await again.json()).error.code).toBe("INVALID_TRANSITION"); // double click ≠ second effect

    const times = async () => C.SlotsResponse.parse(await (await request.get(`/api/public/${c.slug}/slots?service=${c.services[0].id}&date=${f.date}`)).json()).slots.map((s) => s.time);
    expect(await times()).not.toContain(f.times[2]);
    expect((await post(page, `/api/owner/appointments/${b.id}/transition`, { action: "reject" })).status()).toBe(200);
    expect(await times()).toContain(f.times[2]); // rejected request releases the slot
    expect((await agendaOf(page, f.date)).appointments.map((x) => x.status)).toEqual(["confirmed", "cancelled"]);
  });

  test("CSRF: a state change without a same-site Origin is refused and nothing changes", async ({ page, request }) => {
    const b = await makeBusiness("clinic");
    await loginAs(page, b.ownerEmail);
    const f = await firstDayWithSlots(request, b);
    const a = await publicBook(request, b, f.date, f.times[0], 1);
    for (const origin of [undefined, "https://evil.example"]) {
      const r = await page.request.post(`/api/owner/appointments/${a.id}/transition`, { data: { action: "approve" }, headers: origin ? { origin } : {} });
      expect(r.status()).toBe(403);
      expect(C.ApiErrorBody.parse(await r.json()).error.code).toBe("FORBIDDEN");
    }
    expect((await b.db.from("appointments").select("status").eq("id", a.id)).data![0].status).toBe("pending");
  });

  test("tenant isolation: another business's owner can neither read nor change my appointments, and the request cannot name a business", async ({ page, request, browser }) => {
    const mine = await makeBusiness("clinic");
    const other = await makeBusiness("clinic");
    const f = await firstDayWithSlots(request, mine);
    const a = await publicBook(request, mine, f.date, f.times[0], 1);
    const ctx = await browser.newContext();
    const intruder = await ctx.newPage();
    await loginAs(intruder, other.ownerEmail);
    await intruder.goto("/dashboard");
    const seen = await agendaOf(intruder, f.date);
    expect(seen.appointments).toEqual([]); // not mine
    const r = await post(intruder, `/api/owner/appointments/${a.id}/transition`, { action: "approve" });
    expect(r.status()).toBe(404); // "not yours" and "doesn't exist" are the same answer
    const spoof = await post(intruder, "/api/owner/appointments", { serviceId: mine.services[0].id, date: f.date, time: "12:00", customer: person(5), businessId: mine.id });
    expect(spoof.status()).toBe(422); // unknown field refused
    const foreignService = await post(intruder, "/api/owner/appointments", { serviceId: mine.services[0].id, date: f.date, time: "12:00", customer: person(5) });
    expect(foreignService.status()).toBe(409); // SERVICE_UNAVAILABLE: a service of another business is not usable
    expect((await mine.db.from("appointments").select("status").eq("id", a.id)).data![0].status).toBe("pending");
    await ctx.close();
    await loginAs(page, mine.ownerEmail); // sanity: the real owner does see it
    expect((await agendaOf(page, f.date)).appointments).toHaveLength(1);
  });

  test("manual appointments: confirmed at once, flagged when outside opening hours, never overlapping; validation names the field", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    await loginAs(page, b.ownerEmail);
    const f = await firstDayWithSlots(request, b);
    const svc = b.services[0].id;
    const inside = await post(page, "/api/owner/appointments", { serviceId: svc, date: f.date, time: f.times[0], customer: person(7), note: "מגיע עם ילד" });
    expect(inside.status()).toBe(201);
    expect(C.CreateManualResponse.parse(await inside.json()).outOfHours).toBe(false);
    const outside = await post(page, "/api/owner/appointments", { serviceId: svc, date: f.date, time: "23:00", customer: person(8) });
    expect(outside.status()).toBe(201);
    expect(C.CreateManualResponse.parse(await outside.json()).outOfHours).toBe(true); // AVL-10: allowed, but marked
    const clash = await post(page, "/api/owner/appointments", { serviceId: svc, date: f.date, time: f.times[0], customer: person(9) });
    expect(clash.status()).toBe(409);
    expect(C.ApiErrorBody.parse(await clash.json()).error.code).toBe("SLOT_TAKEN");

    const ag = await agendaOf(page, f.date);
    const manual = ag.appointments.filter((x) => x.manual);
    expect(manual.map((x) => x.status)).toEqual(["confirmed", "confirmed"]);
    expect(ag.appointments.find((x) => x.note === "מגיע עם ילד")).toBeTruthy();
    expect(ag.appointments.filter((x) => x.outOfHours)).toHaveLength(1);
    // the public slot list reflects the manual appointment too
    const sl = C.SlotsResponse.parse(await (await request.get(`/api/public/${b.slug}/slots?service=${svc}&date=${f.date}`)).json());
    expect(sl.slots.map((s) => s.time)).not.toContain(f.times[0]);

    const bad = await post(page, "/api/owner/appointments", { serviceId: svc, date: "2026-13-45", time: "25:00", customer: { fullName: "א", phone: "12" } });
    expect(bad.status()).toBe(422);
    const fields = C.ApiErrorBody.parse(await bad.json()).error.details!.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(["date", "time", "customer.fullName", "customer.phone"]));
    expect((await b.db.from("appointments").select("id").eq("business_id", b.id)).data).toHaveLength(2);
  });

  test("complete / no-show only after the appointment began; owner cancel frees the slot; an impossible date is rejected", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    await loginAs(page, b.ownerEmail);
    const f = await firstDayWithSlots(request, b);
    const future = await post(page, "/api/owner/appointments", { serviceId: b.services[0].id, date: f.date, time: f.times[1], customer: person(1) });
    const futureId = C.CreateManualResponse.parse(await future.json()).id;
    for (const action of ["complete", "noShow"]) {
      const r = await post(page, `/api/owner/appointments/${futureId}/transition`, { action });
      expect(r.status()).toBe(409);
      expect(C.ApiErrorBody.parse(await r.json()).error.code).toBe("TOO_EARLY");
    }
    expect((await post(page, `/api/owner/appointments/${futureId}/transition`, { action: "cancel" })).status()).toBe(200);
    const sl = C.SlotsResponse.parse(await (await request.get(`/api/public/${b.slug}/slots?service=${b.services[0].id}&date=${f.date}`)).json());
    expect(sl.slots.map((s) => s.time)).toContain(f.times[1]);
    expect((await post(page, `/api/owner/appointments/${futureId}/transition`, { action: "nonsense" })).status()).toBe(422);
    expect((await post(page, "/api/owner/appointments/not-a-uuid/transition", { action: "cancel" })).status()).toBe(404);
    expect((await page.request.get("/api/owner/appointments?date=2026-02-31")).status()).toBe(422);
  });
});
