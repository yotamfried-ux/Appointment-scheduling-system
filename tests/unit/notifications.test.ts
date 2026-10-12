// @vitest-environment node
import { Webhook } from "svix";
import { describe, expect, it, vi } from "vitest";
import { fakeAdapter } from "@/modules/notifications/adapters/fake";
import { resendAdapter } from "@/modules/notifications/adapters/resend";
import { plan, staleReason } from "@/modules/notifications/plan";
import { PermanentEmailError, TransientEmailError } from "@/modules/notifications/ports";
import { verifySvix } from "@/modules/notifications/svix";
import { render, type NotifContext } from "@/modules/notifications/templates";
import { BUSINESS_KINDS } from "@/modules/tenancy/business-kind";

const ctx = (over: Partial<NotifContext> = {}, kind: NotifContext["business"]["kind"] = "barber"): NotifContext => ({
  type: "booking_confirmed",
  recipient: "customer",
  appointment: { id: "a1", status: "confirmed", startsAt: "2026-10-14T07:00:00Z", endsAt: "2026-10-14T07:30:00Z", reference: "TR-ABC123", serviceName: "תספורת גברים" },
  offer: null,
  business: { name: "מספרת הדר", slug: "hadar", kind, timezone: "Asia/Jerusalem", phone: "+972501234567" },
  customer: { name: "נועם לוי", email: "noam@example.com" },
  owner: { email: "owner@example.com" },
  ...over,
});

describe("plan: which messages does an event call for", () => {
  it("a pending booking tells the customer it was received and asks the owner to decide", () => {
    expect(plan({ type: "AppointmentCreated", payload: {} }, "pending")).toEqual([
      { type: "booking_received", recipient: "customer" },
      { type: "owner_new_request", recipient: "owner" },
    ]);
  });
  it("an auto-confirmed booking sends one confirmation and bothers nobody else", () => {
    expect(plan({ type: "AppointmentCreated", payload: {} }, "confirmed")).toEqual([{ type: "booking_confirmed", recipient: "customer" }]);
  });
  it("a booking that is already cancelled or unknown plans nothing", () => {
    expect(plan({ type: "AppointmentCreated", payload: {} }, "cancelled_by_customer")).toEqual([]);
    expect(plan({ type: "AppointmentCreated", payload: {} }, null)).toEqual([]);
  });
  it.each([
    ["approve", "booking_confirmed"],
    ["reject", "booking_declined"],
    ["cancel", "booking_cancelled_by_business"],
    ["approve_cancellation", "booking_cancelled_by_customer"],
    ["decline_cancellation", "booking_confirmed"],
  ])("owner action %s ⇒ %s", (action, type) => {
    expect(plan({ type: "AppointmentStatusChanged", payload: { action } }, null)).toEqual([{ type, recipient: "customer" }]);
  });
  it("silent actions and unknown events plan nothing", () => {
    expect(plan({ type: "AppointmentStatusChanged", payload: { action: "complete" } }, null)).toEqual([]);
    expect(plan({ type: "BusinessCreated", payload: {} }, null)).toEqual([]);
  });
  it("a customer cancellation informs both sides", () => {
    expect(plan({ type: "AppointmentCancelled", payload: {} }, null).map((n) => n.type)).toEqual(["booking_cancelled_by_customer", "owner_customer_cancelled"]);
  });
});

describe("staleReason (NTF-03): check before send", () => {
  const now = new Date("2026-10-13T08:00:00Z");
  const future = "2026-10-14T07:00:00Z";
  it("a reminder needs a confirmed appointment that has not started", () => {
    expect(staleReason("reminder", "confirmed", future, now)).toBeNull();
    expect(staleReason("reminder", "cancelled_by_customer", future, now)).toBe("appointment_inactive");
    expect(staleReason("reminder", "pending", future, now)).toBe("appointment_inactive");
    expect(staleReason("reminder", "confirmed", "2026-10-13T07:00:00Z", now)).toBe("appointment_inactive");
  });
  it("'received' is superseded once the owner has decided", () => {
    expect(staleReason("booking_received", "pending", future, now)).toBeNull();
    expect(staleReason("booking_received", "confirmed", future, now)).toBe("appointment_inactive");
    expect(staleReason("owner_new_request", "cancelled_by_customer", future, now)).toBe("appointment_inactive");
  });
  it("a confirmation is not sent for something that has since been cancelled", () => {
    expect(staleReason("booking_confirmed", "confirmed", future, now)).toBeNull();
    expect(staleReason("booking_confirmed", "cancelled_by_business", future, now)).toBe("appointment_inactive");
  });
  it("a cancellation notice requires the appointment to really be cancelled that way", () => {
    expect(staleReason("booking_cancelled_by_business", "cancelled_by_business", future, now)).toBeNull();
    expect(staleReason("booking_cancelled_by_business", "confirmed", future, now)).toBe("appointment_inactive");
    expect(staleReason("booking_cancelled_by_customer", "cancelled_by_customer", future, now)).toBeNull();
    expect(staleReason("booking_declined", "confirmed", future, now)).toBe("appointment_inactive");
  });
});

describe("templates (NTF-08, docs/05 §2)", () => {
  const opts = { appUrl: "https://tori.example", manageToken: "TOKEN.SIG" };
  it("is right-to-left Hebrew with the appointment facts", () => {
    const r = render(ctx(), opts);
    expect(r.html).toContain('lang="he" dir="rtl"');
    expect(r.html).toContain("מספרת הדר");
    expect(r.html).toContain("TR-ABC123");
    expect(r.text).toContain("מועד:");
    expect(r.html).toContain("https://tori.example/booking/TOKEN.SIG");
  });
  it("RSC: a move plans one message for the customer and one for the owner, and goes stale if the appointment was cancelled meanwhile", () => {
    expect(plan({ type: "AppointmentRescheduled", payload: {} }, "confirmed").map((n) => `${n.recipient}:${n.type}`)).toEqual(["customer:booking_rescheduled", "owner:owner_customer_rescheduled"]);
    const now = new Date("2026-10-14T10:00:00Z");
    expect(staleReason("booking_rescheduled", "confirmed", "2026-10-20T10:00:00Z", now)).toBeNull();
    expect(staleReason("owner_customer_rescheduled", "pending", "2026-10-20T10:00:00Z", now)).toBeNull();
    expect(staleReason("booking_rescheduled", "cancelled_by_customer", "2026-10-20T10:00:00Z", now)).toBe("appointment_inactive");
  });
  it("the subject never names the service or the customer, and never carries a link or token", () => {
    for (const type of ["booking_received", "booking_confirmed", "booking_declined", "booking_cancelled_by_business", "booking_cancelled_by_customer", "reminder", "owner_new_request", "owner_customer_cancelled", "booking_rescheduled", "owner_customer_rescheduled"] as const) {
      const r = render(ctx({ type, recipient: type.startsWith("owner") ? "owner" : "customer" }), opts);
      expect(r.subject).not.toContain("תספורת");
      expect(r.subject).not.toContain("נועם");
      expect(r.subject).not.toMatch(/https?:|TOKEN/);
    }
  });
  it("sensitive kinds leave the service name out of the body as well", () => {
    for (const kind of Object.keys(BUSINESS_KINDS) as (keyof typeof BUSINESS_KINDS)[]) {
      const r = render(ctx({}, kind), opts);
      expect(r.html.includes("תספורת גברים"), kind).toBe(!BUSINESS_KINDS[kind].privacy.hideServiceNameInMessages);
      expect(r.text.includes("תספורת גברים"), kind).toBe(!BUSINESS_KINDS[kind].privacy.hideServiceNameInMessages);
    }
    expect(BUSINESS_KINDS.clinic.privacy.hideServiceNameInMessages).toBe(true);
  });
  it("escapes everything a customer can type (no HTML or header injection)", () => {
    const r = render(ctx({ customer: { name: '<script>alert(1)</script>\r\nBcc: evil@x.com', email: "a@b.co" }, business: { ...ctx().business, name: 'Evil "Salon" <b>' } }, "barber"), opts);
    expect(r.html).not.toContain("<script>");
    expect(r.html).not.toContain("<b>");
    expect(r.html).toContain("&lt;b&gt;");
    expect(r.subject).not.toMatch(/[\r\n]/);
    const owner = render(ctx({ type: "owner_new_request", recipient: "owner", customer: { name: '<img src=x onerror=1>', email: null } }), opts);
    expect(owner.html).not.toContain("<img");
    expect(owner.html).toContain("&lt;img");
  });
  it("owner messages link to the dashboard, never to a customer token", () => {
    const r = render(ctx({ type: "owner_new_request", recipient: "owner" }), opts);
    expect(r.html).toContain("https://tori.example/dashboard");
    expect(r.html).not.toContain("TOKEN.SIG");
  });
  it("times are rendered in the business time zone", () => {
    const r = render(ctx(), opts); // 07:00Z in October (Israel summer time, UTC+3) = 10:00
    expect(r.text).toMatch(/10:00/);
  });
});

describe("waitlist messages (WLT-01/03)", () => {
  const offerCtx = (type: "waitlist_offer" | "waitlist_offer_expired", kind: NotifContext["business"]["kind"] = "barber"): NotifContext =>
    ctx({ type, appointment: null, offer: { id: "o1", status: type === "waitlist_offer" ? "pending" : "expired", slotStartsAt: "2026-10-14T07:00:00Z", expiresAt: "2026-10-13T08:30:00Z", serviceName: "תספורת גברים", entryId: "e1" } }, kind);
  const opts = { appUrl: "https://tori.example", manageToken: "WLTOKEN.SIG" };
  it("an offer links to the waitlist page (not the booking page) and shows when it expires", () => {
    const r = render(offerCtx("waitlist_offer"), opts);
    expect(r.html).toContain("https://tori.example/waitlist/WLTOKEN.SIG");
    expect(r.html).not.toContain("/booking/");
    expect(r.text).toContain("תקף עד");
    expect(r.text).toMatch(/10:00/); // the slot, in the business time zone
    expect(r.text).not.toContain("מספר אישור"); // there is no booking yet
  });
  it("the subject never names the service; sensitive kinds also keep it out of the body", () => {
    expect(render(offerCtx("waitlist_offer"), opts).subject).not.toContain("תספורת");
    expect(render(offerCtx("waitlist_offer", "clinic"), opts).text).not.toContain("תספורת גברים");
    expect(render(offerCtx("waitlist_offer", "barber"), opts).text).toContain("תספורת גברים");
  });
  it("the expiry notice tells the customer they are still on the list", () => {
    const r = render(offerCtx("waitlist_offer_expired"), opts);
    expect(r.subject).toContain("פגה");
    expect(r.text).toContain("נשארת ברשימת ההמתנה");
    expect(r.text).not.toContain("תקף עד");
  });
  it("check-before-send: an offer is announced only while it is live; the expiry notice only after it expired", () => {
    const now = new Date("2026-10-13T08:00:00Z");
    expect(staleReason("waitlist_offer", "pending", "2026-10-14T07:00:00Z", now)).toBeNull();
    for (const status of ["accepted", "declined", "expired", "lost"]) expect(staleReason("waitlist_offer", status, "2026-10-14T07:00:00Z", now)).toBe("appointment_inactive");
    expect(staleReason("waitlist_offer", "pending", "2026-10-13T07:00:00Z", now)).toBe("appointment_inactive");
    expect(staleReason("waitlist_offer_expired", "expired", "2026-10-14T07:00:00Z", now)).toBeNull();
    expect(staleReason("waitlist_offer_expired", "accepted", "2026-10-14T07:00:00Z", now)).toBe("appointment_inactive");
  });
});

describe("svix signature verification (NTF-05) — cross-checked against the real library", () => {
  const secret = `whsec_${Buffer.from("unit-test-secret-0123456789abcdef").toString("base64")}`;
  const wh = new Webhook(secret);
  const body = JSON.stringify({ type: "email.bounced", data: { to: ["a@b.co"] } });
  const now = new Date("2026-10-13T08:00:00Z");
  const sign = (id: string, at: Date, payload = body) => ({ id, timestamp: String(Math.floor(at.getTime() / 1000)), signature: wh.sign(id, at, payload), body: payload });

  it("accepts what the Svix library signed", () => {
    const s = sign("msg_1", now);
    expect(verifySvix({ secret, ...s, now })).toEqual({ ok: true });
  });
  it("rejects a tampered body, a wrong secret, and missing headers", () => {
    const s = sign("msg_1", now);
    expect(verifySvix({ secret, ...s, body: body.replace("a@b.co", "c@d.co"), now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySvix({ secret: `whsec_${Buffer.from("another-secret-0123456789abcdef!!").toString("base64")}`, ...s, now })).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifySvix({ secret, id: null, timestamp: s.timestamp, signature: s.signature, body, now })).toEqual({ ok: false, reason: "missing_headers" });
  });
  it("rejects replays: old and future timestamps", () => {
    const old = sign("msg_2", new Date(now.getTime() - 10 * 60_000));
    expect(verifySvix({ secret, ...old, now })).toEqual({ ok: false, reason: "expired" });
    const future = sign("msg_3", new Date(now.getTime() + 10 * 60_000));
    expect(verifySvix({ secret, ...future, now })).toEqual({ ok: false, reason: "expired" });
    expect(verifySvix({ secret, id: "m", timestamp: "abc", signature: "v1,xx", body, now })).toEqual({ ok: false, reason: "bad_timestamp" });
  });
  it("accepts any matching signature among several (secret rotation) and ignores unknown versions", () => {
    const s = sign("msg_4", now);
    const rotated = `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${s.signature} v2,whatever`;
    expect(verifySvix({ secret, ...s, signature: rotated, now })).toEqual({ ok: true });
    expect(verifySvix({ secret, ...s, signature: "v2,whatever", now })).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("a signature for another message id does not transfer", () => {
    const s = sign("msg_5", now);
    expect(verifySvix({ secret, ...s, id: "msg_6", now })).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("resend adapter: status mapping and the idempotency header", () => {
  const msg = { to: "a@b.co", subject: "s", html: "<p>h</p>", text: "t", idempotencyKey: "notif-1", attempt: 1 };
  const mk = (res: () => Response | Promise<Response>) => {
    const f = vi.fn(async () => res());
    return { f, adapter: resendAdapter({ apiKey: "re_test", from: "Tori <noreply@tori.example>", fetchImpl: f as unknown as typeof fetch }) };
  };
  it("sends the documented request and returns the provider id", async () => {
    const { f, adapter } = mk(() => Response.json({ id: "abc-123" }));
    await expect(adapter.send(msg)).resolves.toEqual({ id: "abc-123" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const h = init.headers as Record<string, string>;
    expect(h.Authorization).toBe("Bearer re_test");
    expect(h["Idempotency-Key"]).toBe("notif-1");
    expect(JSON.parse(init.body as string)).toEqual({ from: "Tori <noreply@tori.example>", to: ["a@b.co"], subject: "s", html: "<p>h</p>", text: "t" });
  });
  it.each([429, 500, 502, 503, 409, 401, 403])("%i is transient (retry later)", async (status) => {
    const { adapter } = mk(() => new Response("{}", { status, headers: status === 429 ? { "retry-after": "17" } : {} }));
    const err = await adapter.send(msg).catch((e) => e);
    expect(err).toBeInstanceOf(TransientEmailError);
    if (status === 429) expect((err as TransientEmailError).retryAfterSeconds).toBe(17);
  });
  it.each([400, 422])("%i is permanent (retrying cannot help)", async (status) => {
    const { adapter } = mk(() => new Response("{}", { status }));
    await expect(adapter.send(msg)).rejects.toBeInstanceOf(PermanentEmailError);
  });
  it("a network failure or a 200 without an id is transient: the idempotency key makes the retry safe", async () => {
    const down = resendAdapter({ apiKey: "k", from: "f", fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch });
    await expect(down.send(msg)).rejects.toBeInstanceOf(TransientEmailError);
    const { adapter } = mk(() => Response.json({}));
    await expect(adapter.send(msg)).rejects.toBeInstanceOf(TransientEmailError);
  });
});

describe("fake adapter: deterministic failure injection", () => {
  const send = (to: string, attempt = 1) => fakeAdapter().send({ to, subject: "s", html: "", text: "", idempotencyKey: "k", attempt });
  it("succeeds by default, with a stable id", async () => {
    await expect(send("a@b.co")).resolves.toEqual({ id: "fake_k" });
  });
  it("+fail5xx always fails, +failonce fails only the first attempt, +reject is permanent", async () => {
    await expect(send("a+fail5xx@b.co", 5)).rejects.toBeInstanceOf(TransientEmailError);
    await expect(send("a+failonce@b.co", 1)).rejects.toBeInstanceOf(TransientEmailError);
    await expect(send("a+failonce@b.co", 2)).resolves.toBeTruthy();
    await expect(send("a+reject@b.co")).rejects.toBeInstanceOf(PermanentEmailError);
  });
});
