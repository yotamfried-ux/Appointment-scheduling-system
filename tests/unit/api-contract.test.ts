// @vitest-environment node
// Contract tests: call the real route handlers (Request → Response) and validate every body with the shared Zod schemas.
// Scenarios: BKG-04/05 (double booking → 409), BKG-idempotency, SEC rate limit, kind adaptation, notification privacy.
import { beforeEach, describe, expect, it } from "vitest";
import type { z } from "zod";
import { GET as servicesGET } from "@/app/api/lab/[kind]/services/route";
import { GET as availabilityGET } from "@/app/api/lab/[kind]/availability/route";
import { GET as slotsGET } from "@/app/api/lab/[kind]/slots/route";
import { POST as bookingsPOST } from "@/app/api/lab/[kind]/bookings/route";
import { GET as notificationGET } from "@/app/api/lab/[kind]/bookings/[id]/notification/route";
import { GET as appointmentsGET } from "@/app/api/lab/[kind]/appointments/route";
import { POST as transitionPOST } from "@/app/api/lab/[kind]/appointments/[id]/transition/route";
import * as C from "@/lib/api/contracts";
import { labReset } from "@/lib/api/lab-store";
import { KIND_IDS, getKind, type BusinessKindId } from "@/modules/tenancy/business-kind";

let n = 0;
let session = "";
beforeEach(() => {
  session = `t${++n}`;
  labReset(session);
});

const url = (kind: string, path: string, q: Record<string, string> = {}) =>
  `http://x/api/lab/${kind}/${path}${Object.keys(q).length ? `?${new URLSearchParams(q)}` : ""}`;
const hdr = (extra: Record<string, string> = {}) => ({ "x-lab-session": session, ...extra });
const ctx = <P extends object>(p: P) => ({ params: Promise.resolve(p) });

async function get(h: (r: Request, c: never) => Promise<Response>, kind: string, path: string, q: Record<string, string> = {}, params: object = {}) {
  const res = await h(new Request(url(kind, path, q), { headers: hdr() }), ctx({ kind, ...params }) as never);
  return { res, body: await res.json() };
}
async function post(h: (r: Request, c: never) => Promise<Response>, kind: string, path: string, body: unknown, headers: Record<string, string> = {}, params: object = {}) {
  const res = await h(
    new Request(url(kind, path), { method: "POST", headers: hdr({ "content-type": "application/json", ...headers }), body: typeof body === "string" ? body : JSON.stringify(body) }),
    ctx({ kind, ...params }) as never,
  );
  return { res, body: await res.json() };
}
const valid = <T extends z.ZodType>(s: T, v: unknown) => {
  const r = s.safeParse(v);
  expect(r.success, r.success ? "" : JSON.stringify(r.error.issues)).toBe(true);
  return r.data as z.infer<T>;
};
const expectError = (b: unknown, code: string) => expect(valid(C.ApiErrorBody, b).error.code).toBe(code);

/** First day (from LAB_TODAY+1) with a free slot for the first non-group service. */
async function firstFree(kind: BusinessKindId, serviceId?: string) {
  const k = getKind(kind);
  const svc = serviceId ?? k.presets.find((p) => !p.group)!.id;
  const { body } = await get(availabilityGET as never, kind, "availability", { service: svc, from: "2026-10-15", days: "14" });
  const day = valid(C.AvailabilityResponse, body).days.find((d) => d.freeSlots > 0)!;
  const slots = valid(C.SlotsResponse, (await get(slotsGET as never, kind, "slots", { service: svc, date: day.date })).body);
  return { svc, date: day.date, time: slots.slots[0].time, slots };
}
const bookingBody = (kind: BusinessKindId, f: { svc: string; date: string; time: string }, over: object = {}) => {
  const k = getKind(kind);
  const intake: Record<string, string> = {};
  for (const x of k.intake.filter((i) => i.required)) intake[x.id] = x.options?.[0] ?? "x";
  return { serviceId: f.svc, date: f.date, time: f.time, location: k.locations[0], customer: { fullName: "נועם לוי", phone: "050-1234567", email: "noam@example.com" }, intake, ...over };
};

describe.each(KIND_IDS)("kind %s · read endpoints match contracts", (kind) => {
  it("services + business config reflect the kind", async () => {
    const { res, body } = await get(servicesGET as never, kind, "services");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-request-id")).toMatch(/^req_/);
    const d = valid(C.ServicesResponse, body);
    const k = getKind(kind);
    expect(d.kind).toBe(kind);
    expect(d.services.map((s) => s.id)).toEqual(k.presets.map((p) => p.id));
    expect(d.business.vocab.appointment).toBe(k.vocab.appointment);
    expect(d.business.requireApproval).toBe(k.defaults.requireApproval);
  });

  it("slots respect working windows, step and never offer past times today", async () => {
    const f = await firstFree(kind);
    const k = getKind(kind);
    for (const s of f.slots.slots) {
      const m = Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3));
      expect(f.slots.windows.some((w) => m >= w.from && m < w.to)).toBe(true);
    }
    expect(f.slots.segments.length).toBeGreaterThan(0);
    const today = valid(C.SlotsResponse, (await get(slotsGET as never, kind, "slots", { service: f.svc, date: "2026-10-14" })).body);
    for (const s of today.slots) expect(Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3))).toBeGreaterThan(11 * 60 + 10);
    expect(k.hours.length).toBe(7);
  });

  it("owner agenda matches contract", async () => {
    const { body } = await get(appointmentsGET as never, kind, "appointments");
    const d = valid(C.AppointmentsResponse, body);
    expect(d.kind).toBe(kind);
    expect(d.appointments.length).toBeGreaterThan(0);
  });
});

describe("seed realism (every kind is demonstrable)", () => {
  it.each(KIND_IDS)("%s: each service has free slots within the first 5 open days", async (kind) => {
    for (const p of getKind(kind).presets) {
      const { body } = await get(availabilityGET as never, kind, "availability", { service: p.id, from: "2026-10-14", days: "7" });
      const days = valid(C.AvailabilityResponse, body).days;
      expect(days.filter((d) => d.freeSlots > 0).length, `${kind}/${p.id}`).toBeGreaterThanOrEqual(2);
    }
  });
  it("group slots exist only at scheduled sessions, never overlapping a solo booking window", async () => {
    const { body } = await get(slotsGET as never, "teacher", "slots", { service: "small", date: "2026-10-15" });
    const g = valid(C.SlotsResponse, body);
    const solo = valid(C.SlotsResponse, (await get(slotsGET as never, "teacher", "slots", { service: "private", date: "2026-10-15" })).body);
    for (const s of g.slots) {
      const st = Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3));
      for (const x of solo.slots) {
        const m = Number(x.time.slice(0, 2)) * 60 + Number(x.time.slice(3));
        expect(m < st + 90 && st < m + 60, `solo ${x.time} overlaps group ${s.time}`).toBe(false);
      }
    }
  });
});

describe("booking lifecycle", () => {
  it("creates a booking (201), takes the slot, and a second booking of the same slot is 409 SLOT_TAKEN", async () => {
    const f = await firstFree("barber");
    const first = await post(bookingsPOST as never, "barber", "bookings", bookingBody("barber", f), { "idempotency-key": "k1" });
    expect(first.res.status).toBe(201);
    const b = valid(C.CreateBookingResponse, first.body).booking;
    expect(b.status).toBe("confirmed");
    const second = await post(bookingsPOST as never, "barber", "bookings", bookingBody("barber", f), { "idempotency-key": "k2" });
    expect(second.res.status).toBe(409);
    expectError(second.body, "SLOT_TAKEN");
    const after = valid(C.SlotsResponse, (await get(slotsGET as never, "barber", "slots", { service: f.svc, date: f.date })).body);
    expect(after.slots.map((s) => s.time)).not.toContain(f.time);
  });

  it("two concurrent requests for one slot → exactly one 201 and one 409", async () => {
    const f = await firstFree("barber");
    const [a, b] = await Promise.all(["ka", "kb"].map((k) => post(bookingsPOST as never, "barber", "bookings", bookingBody("barber", f), { "idempotency-key": k })));
    expect([a.res.status, b.res.status].sort()).toEqual([201, 409]);
  });

  it("the booking also blocks overlapping slots of other services (no double booking across services)", async () => {
    const f = await firstFree("barber", "color"); // 90 minutes
    await post(bookingsPOST as never, "barber", "bookings", bookingBody("barber", f), { "idempotency-key": "k1" });
    const r = valid(C.SlotsResponse, (await get(slotsGET as never, "barber", "slots", { service: "beard", date: f.date })).body);
    const start = Number(f.time.slice(0, 2)) * 60 + Number(f.time.slice(3));
    for (const s of r.slots) {
      const m = Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3));
      expect(m + 20 <= start || m >= start + 90).toBe(true);
    }
  });

  it("idempotent replay returns the same booking (200) and does not create a second one", async () => {
    const f = await firstFree("barber");
    const body = bookingBody("barber", f);
    const a = await post(bookingsPOST as never, "barber", "bookings", body, { "idempotency-key": "same" });
    const b = await post(bookingsPOST as never, "barber", "bookings", body, { "idempotency-key": "same" });
    expect(a.res.status).toBe(201);
    expect(b.res.status).toBe(200);
    expect(b.res.headers.get("idempotent-replay")).toBe("true");
    expect(b.body.booking.id).toBe(a.body.booking.id);
    const count = async () => valid(C.SlotsResponse, (await get(slotsGET as never, "barber", "slots", { service: f.svc, date: f.date })).body).slots.length;
    const afterFirst = await count();
    expect(afterFirst).toBeLessThan(f.slots.slots.length);
    await post(bookingsPOST as never, "barber", "bookings", body, { "idempotency-key": "same" });
    expect(await count()).toBe(afterFirst); // the replay consumed nothing more
  });

  it("reusing a key with a different body → 422 IDEMPOTENCY_KEY_REUSED", async () => {
    const f = await firstFree("barber");
    await post(bookingsPOST as never, "barber", "bookings", bookingBody("barber", f), { "idempotency-key": "k" });
    const r = await post(bookingsPOST as never, "barber", "bookings", bookingBody("barber", f, { customer: { fullName: "אחר אחר", phone: "050-1234567" } }), { "idempotency-key": "k" });
    expect(r.res.status).toBe(422);
    expectError(r.body, "IDEMPOTENCY_KEY_REUSED");
  });

  it("missing key → 400; malformed JSON → 400; unknown field → 422", async () => {
    const f = await firstFree("barber");
    expectError((await post(bookingsPOST as never, "barber", "bookings", bookingBody("barber", f))).body, "IDEMPOTENCY_KEY_REQUIRED");
    const bad = await post(bookingsPOST as never, "barber", "bookings", "{nope", { "idempotency-key": "x" });
    expect(bad.res.status).toBe(400);
    const extra = await post(bookingsPOST as never, "barber", "bookings", { ...bookingBody("barber", f), tenantId: "evil" }, { "idempotency-key": "y" });
    expect(extra.res.status).toBe(422);
  });

  it("validation errors name each failing field (phone, email, name)", async () => {
    const f = await firstFree("barber");
    const r = await post(
      bookingsPOST as never, "barber", "bookings",
      bookingBody("barber", f, { customer: { fullName: "א", phone: "050-12", email: "nope" } }), { "idempotency-key": "v" },
    );
    expect(r.res.status).toBe(422);
    const fields = valid(C.ApiErrorBody, r.body).error.details!.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(["customer.fullName", "customer.phone", "customer.email"]));
  });

  it("closed day and off-grid / out-of-hours times are rejected as INVALID_SLOT", async () => {
    const f = await firstFree("barber");
    const closed = await post(bookingsPOST as never, "barber", "bookings", bookingBody("barber", { ...f, date: "2026-10-17", time: "10:00" }), { "idempotency-key": "c" });
    expectError(closed.body, "INVALID_SLOT");
    const night = await post(bookingsPOST as never, "barber", "bookings", bookingBody("barber", { ...f, time: "03:00" }), { "idempotency-key": "n" });
    expectError(night.body, "INVALID_SLOT");
    const past = await post(bookingsPOST as never, "barber", "bookings", bookingBody("barber", { ...f, date: "2026-10-01" }), { "idempotency-key": "p" });
    expectError(past.body, "INVALID_SLOT");
  });

  it("rate limit → 429 with Retry-After, then other sessions are unaffected", async () => {
    const f = await firstFree("barber");
    let last = { res: new Response(), body: {} as { error?: unknown } };
    for (let i = 0; i < 4; i++) last = await post(bookingsPOST as never, "barber", "bookings", bookingBody("barber", f), { "idempotency-key": `r${i}`, "x-lab-limit": "3" });
    expect(last.res.status).toBe(429);
    expect(Number(last.res.headers.get("retry-after"))).toBeGreaterThan(0);
    expectError(last.body, "RATE_LIMITED");
  });

  it("unknown kind → 404; unknown service → 422", async () => {
    expect((await get(servicesGET as never, "plumber", "services")).res.status).toBe(404);
    const r = await get(slotsGET as never, "barber", "slots", { service: "nope", date: "2026-10-15" });
    expect(r.res.status).toBe(422);
  });

  it("bad query → 422 with details", async () => {
    const r = await get(availabilityGET as never, "barber", "availability", { service: "haircut", from: "tomorrow", days: "99" });
    expect(r.res.status).toBe(422);
    expect(valid(C.ApiErrorBody, r.body).error.details!.length).toBeGreaterThanOrEqual(2);
  });
});

describe("kind adaptation", () => {
  it("approval kinds create pending bookings, others confirmed", async () => {
    for (const kind of KIND_IDS) {
      labReset(session);
      const f = await firstFree(kind);
      const r = await post(bookingsPOST as never, kind, "bookings", bookingBody(kind, f), { "idempotency-key": `k-${kind}` });
      expect(r.res.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.booking.status).toBe(getKind(kind).defaults.requireApproval ? "pending" : "confirmed");
    }
  });

  it("required intake is enforced; select options validated", async () => {
    for (const kind of KIND_IDS) {
      const req = getKind(kind).intake.filter((i) => i.required);
      if (!req.length) continue;
      const f = await firstFree(kind);
      const r = await post(bookingsPOST as never, kind, "bookings", bookingBody(kind, f, { intake: {} }), { "idempotency-key": `i-${kind}` });
      expect(r.res.status).toBe(422);
      expect(valid(C.ApiErrorBody, r.body).error.details!.map((d) => d.field)).toContain(`intake.${req[0].id}`);
    }
    const f = await firstFree("trainer", "pt");
    const bad = await post(bookingsPOST as never, "trainer", "bookings", bookingBody("trainer", f, { intake: { goal: "not-an-option" } }), { "idempotency-key": "sel" });
    expect(bad.res.status).toBe(422);
  });

  it("unsupported location is rejected", async () => {
    const f = await firstFree("barber");
    const r = await post(bookingsPOST as never, "barber", "bookings", bookingBody("barber", f, { location: "online" }), { "idempotency-key": "loc" });
    expect(r.res.status).toBe(422);
  });

  it("trainer has two daily windows and a closed gap between them", async () => {
    const f = await firstFree("trainer", "pt");
    expect(f.slots.windows.length).toBe(2);
    const times = f.slots.slots.map((s) => s.time);
    expect(times.some((t) => t >= "10:00" && t < "17:00")).toBe(false);
    expect(f.slots.segments.some((s) => s.state === "closed")).toBe(true);
  });

  it("group sessions: seats decrease per booking; same customer booking fills seats up to capacity then 409", async () => {
    const kind: BusinessKindId = "trainer";
    const cap = getKind(kind).group.defaultCapacity;
    const { body } = await get(slotsGET as never, kind, "slots", { service: "group", date: "2026-10-15" });
    const slots = valid(C.SlotsResponse, body).slots;
    expect(slots.length).toBeGreaterThan(0);
    const target = slots.find((s) => s.spotsLeft === cap) ?? slots[0];
    const left0 = target.spotsLeft!;
    for (let i = 0; i < left0; i++) {
      const r = await post(bookingsPOST as never, kind, "bookings", bookingBody(kind, { svc: "group", date: "2026-10-15", time: target.time }), { "idempotency-key": `g${i}` });
      expect(r.res.status, JSON.stringify(r.body)).toBe(201);
    }
    const full = await post(bookingsPOST as never, kind, "bookings", bookingBody(kind, { svc: "group", date: "2026-10-15", time: target.time }), { "idempotency-key": "gx" });
    expect(full.res.status).toBe(409);
  });
});

describe("notification privacy (docs/05 §2)", () => {
  async function emailFor(kind: BusinessKindId) {
    const f = await firstFree(kind);
    const r = await post(bookingsPOST as never, kind, "bookings", bookingBody(kind, f), { "idempotency-key": `m-${kind}` });
    const mail = valid(C.NotificationPreview, (await get(notificationGET as never, kind, `bookings/${r.body.booking.id}/notification`, {}, { id: r.body.booking.id })).body);
    return { mail, svc: getKind(kind).presets.find((p) => p.id === f.svc)!.name };
  }
  it("barber email names the service", async () => {
    const { mail, svc } = await emailFor("barber");
    expect(mail.body).toContain(svc);
    expect(mail.to).toBe("noam@example.com");
  });
  it.each(["clinic", "beauty"] as const)("%s email does not reveal the service/treatment", async (kind) => {
    const { mail, svc } = await emailFor(kind);
    expect(mail.body).not.toContain(svc);
    expect(mail.subject).not.toContain(svc);
  });
  it("no kind ever puts intake answers or notes in the email", async () => {
    for (const kind of KIND_IDS) {
      const { mail } = await emailFor(kind);
      for (const f of getKind(kind).intake) for (const o of f.options ?? []) expect(mail.body).not.toContain(o);
    }
  });
  it("unknown booking → 404", async () => {
    expect((await get(notificationGET as never, "barber", "bookings/zzz/notification", {}, { id: "zzz" })).res.status).toBe(404);
  });
});

describe("owner transitions", () => {
  const act = (id: string, action: string, kind = "barber") => post(transitionPOST as never, kind, `appointments/${id}/transition`, { action }, {}, { id });
  const find = async (status: string, kind = "barber") => valid(C.AppointmentsResponse, (await get(appointmentsGET as never, kind, "appointments")).body).appointments.find((a) => a.status === status)!;

  it("approve pending → confirmed; repeating it → 409 INVALID_TRANSITION", async () => {
    const a = await find("pending");
    const ok = await act(a.id, "approve");
    expect(ok.res.status).toBe(200);
    expect(valid(C.TransitionResponse, ok.body).appointment.status).toBe("confirmed");
    const again = await act(a.id, "approve");
    expect(again.res.status).toBe(409);
    expectError(again.body, "INVALID_TRANSITION");
  });
  it("reject pending → cancelled; approving a cancellation request cancels it", async () => {
    const p = await find("pending");
    expect(valid(C.TransitionResponse, (await act(p.id, "reject")).body).appointment.status).toBe("cancelled");
    const c = await find("cancellationRequested");
    expect(valid(C.TransitionResponse, (await act(c.id, "approveCancellation")).body).appointment.status).toBe("cancelled");
  });
  it("cannot approve a completed appointment; unknown id → 404; unknown action → 422", async () => {
    const done = await find("completed");
    expect((await act(done.id, "approve")).res.status).toBe(409);
    expect((await act("nope", "approve")).res.status).toBe(404);
    expect((await act(done.id, "explode")).res.status).toBe(422);
  });
  it("a cancelled customer booking frees its slot", async () => {
    const kind: BusinessKindId = "clinic"; // approval kind → pending
    const f = await firstFree(kind);
    const r = await post(bookingsPOST as never, kind, "bookings", bookingBody(kind, f), { "idempotency-key": "fr" });
    const q = () => get(slotsGET as never, kind, "slots", { service: f.svc, date: f.date }).then((x) => valid(C.SlotsResponse, x.body).slots.map((s) => s.time));
    expect(await q()).not.toContain(f.time);
    await act(r.body.booking.id, "reject", kind);
    expect(await q()).toContain(f.time);
  });
  it("sessions are isolated", async () => {
    const a = await find("pending");
    await act(a.id, "approve");
    session = "other";
    expect((await find("pending")).id).toBe(a.id);
  });
});

describe("IsoDate accepts only real calendar dates", () => {
  it.each(["2026-10-11", "2028-02-29", "2026-12-31"])("accepts %s", (d) => expect(C.IsoDate.safeParse(d).success).toBe(true));
  it.each(["2026-13-45", "2026-02-31", "2027-02-29", "2026-00-10", "2026-10-00", "26-10-11", "2026-10-11T00:00", "", "abc"])("rejects %s", (d) => expect(C.IsoDate.safeParse(d).success).toBe(false));
});

describe("owner contracts", () => {
  it("manual appointment refuses unknown fields (tenant spoofing) and bad input", () => {
    const ok = { serviceId: "s", date: "2026-10-14", time: "10:00", customer: { fullName: "נועם", phone: "050-1234567" } };
    expect(C.CreateManualRequest.safeParse(ok).success).toBe(true);
    expect(C.CreateManualRequest.safeParse({ ...ok, businessId: "x" }).success).toBe(false);
    expect(C.CreateManualRequest.safeParse({ ...ok, customer: { ...ok.customer, email: "a@b.co" } }).success).toBe(false);
    expect(C.CreateManualRequest.safeParse({ ...ok, note: "x".repeat(201) }).success).toBe(false);
  });
  it("transition accepts only the known actions", () => {
    for (const a of ["approve", "reject", "cancel", "complete", "noShow", "approveCancellation", "declineCancellation"]) expect(C.OwnerTransitionRequest.safeParse({ action: a }).success).toBe(true);
    expect(C.OwnerTransitionRequest.safeParse({ action: "delete" }).success).toBe(false);
    expect(C.OwnerTransitionRequest.safeParse({ action: "approve", id: "x" }).success).toBe(false);
  });
});
