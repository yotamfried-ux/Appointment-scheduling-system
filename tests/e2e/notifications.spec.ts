import { expect, test, type APIRequestContext } from "@playwright/test";
import { Webhook } from "svix";
import { admin, firstDayWithSlots, loginAs, makeBusiness, publicBook, rand, sql, type TestBusiness } from "./helpers/business";
import { CRON_SECRET, RESEND_WEBHOOK_SECRET } from "./helpers/secrets";

// E-mail notifications on the real stack (fake provider: nothing leaves the machine; failures are injected through the address).
// Scenarios: NTF-01 (exactly once, concurrent runners), NTF-02, NTF-03 (check before send), NTF-04 (retry → dead → owner banner),
// NTF-05 (bounce webhook → suppression), NTF-06, NTF-12, OPS-05, docs/05 §2 (privacy).
const auth = { authorization: `Bearer ${CRON_SECRET}` };
const mail = (tag = "") => `n-${rand()}${tag}@example.com`;

interface Row {
  appointment_id: string;
  type: string;
  recipient: string;
  status: string;
  attempts: number;
  skip_reason: string | null;
  error: string | null;
  provider_message_id: string | null;
  preview: { to: string; subject: string; text: string } | null;
}
const rows = async (b: TestBusiness) => (await admin().from("notification_log").select("appointment_id, type, recipient, status, attempts, skip_reason, error, provider_message_id, preview").eq("business_id", b.id).order("created_at")).data as Row[];
const byType = (rs: Row[], type: string) => rs.filter((r) => r.type === type);
const runOutbox = (request: APIRequestContext) => request.post("/api/jobs/outbox", { headers: auth });

/** Run the outbox until `done` holds (other specs leave events behind, and a run handles a bounded batch). */
async function drain(request: APIRequestContext, done: () => Promise<boolean>, releaseFor?: string) {
  for (let i = 0; i < 60; i++) {
    if (releaseFor) release(releaseFor); // the backoff of any retrying message of this appointment has "elapsed"
    expect((await runOutbox(request)).status()).toBe(200);
    if (await done()) return;
  }
  throw new Error("outbox did not settle");
}
const idle = (rs: Row[]) => rs.every((r) => !["queued", "sending"].includes(r.status)); // nobody (including a parallel spec's runner) is mid-send
const settled = (b: TestBusiness, n: number) => async () => {
  const rs = await rows(b);
  return rs.length >= n && idle(rs);
};
const release = (appointmentId: string, type?: string) =>
  sql(`update public.notification_log set next_attempt_at = now() - interval '1 second' where appointment_id = '${appointmentId}'${type ? ` and type = '${type}'` : ""} and status in ('queued','failed')`);
/** Each test starts from a clean reminder bucket: desktop and mobile runs book the same slot, and a used bucket is (rightly) skipped. */
const freshBucket = (t: Date) => sql(`delete from public.job_runs where job_name = 'reminders' and run_key = 'r:${new Date(Math.floor(t.getTime() / 900_000) * 900_000).toISOString().slice(0, 16)}'`);

test.describe("job endpoints are authenticated", () => {
  test("cron endpoints refuse everyone without the secret and answer with a summary to the scheduler", async ({ request }) => {
    for (const path of ["/api/jobs/outbox", "/api/jobs/reminders"]) {
      expect((await request.post(path)).status()).toBe(401);
      expect((await request.get(path, { headers: { authorization: "Bearer wrong-secret-value-0123456789" } })).status()).toBe(401);
      expect((await request.post(path, { headers: { authorization: CRON_SECRET } })).status()).toBe(401); // no "Bearer"
    }
    const ok = await runOutbox(request);
    expect(ok.status()).toBe(200);
    expect(Object.keys(await ok.json()).sort()).toEqual(["dead", "enqueued", "events", "retried", "sent", "skipped"]);
    expect((await request.get("/api/jobs/outbox", { headers: auth })).status()).toBe(200); // Vercel Cron uses GET
  });
});

test.describe("sending (NTF-01/03/12, privacy)", () => {
  test("a confirmed booking produces exactly one confirmation with the booking facts, and no service name in the subject", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const to = mail();
    const appt = await publicBook(request, b, f.date, f.times[0], 1, 0, to);
    await drain(request, settled(b, 1));
    const rs = await rows(b);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ type: "booking_confirmed", recipient: "customer", status: "sent", attempts: 1, appointment_id: appt.id });
    expect(rs[0].provider_message_id).toMatch(/^fake_notif-/); // NTF-12: correlation id stored
    expect(rs[0].preview!.subject).toContain("התור שלך אושר");
    expect(rs[0].preview!.subject).not.toContain(b.services[0].name);
    expect(rs[0].preview!.text).toContain("TR-");
    expect(rs[0].preview!.text).toMatch(/\/booking\/[\w.-]+/); // the customer's private link, in the body only
    expect(rs[0].preview!.subject).not.toMatch(/\/booking|https?:/);
    // running everything again changes nothing
    await runOutbox(request);
    await runOutbox(request);
    expect((await rows(b)).map((r) => [r.type, r.status, r.attempts])).toEqual([["booking_confirmed", "sent", 1]]);
  });

  test("a clinic request: the customer hears 'received', the owner is asked to decide, and neither message names the treatment", async ({ request }) => {
    const b = await makeBusiness("clinic");
    const f = await firstDayWithSlots(request, b);
    await publicBook(request, b, f.date, f.times[0], 1, 0, mail());
    await drain(request, settled(b, 2));
    const rs = await rows(b);
    expect(rs.map((r) => `${r.type}:${r.recipient}:${r.status}`).sort()).toEqual(["booking_received:customer:sent", "owner_new_request:owner:sent"]);
    for (const r of rs) expect(r.preview!.text).not.toContain(b.services[0].name); // sensitive kind: no treatment name in any message
    expect(byType(rs, "owner_new_request")[0].preview!.text).toContain("/dashboard");
    expect(byType(rs, "owner_new_request")[0].preview!.text).not.toMatch(/\/booking\//); // owners never get a customer token

    // approval → confirmation (once), with the earlier 'received' left as it was
    const id = rs[0].appointment_id;
    expect((await b.db.rpc("transition_appointment", { p_id: id, p_action: "approve" })).error).toBeNull();
    await drain(request, settled(b, 3));
    expect(byType(await rows(b), "booking_confirmed").map((r) => r.status)).toEqual(["sent"]);
  });

  test("NTF-03: approved before any runner looked ⇒ no stale 'received' or 'new request' is even created, only the decision is sent", async ({ request }) => {
    const b = await makeBusiness("clinic");
    const f = await firstDayWithSlots(request, b);
    const appt = await publicBook(request, b, f.date, f.times[0], 1, 0, mail());
    expect((await b.db.rpc("transition_appointment", { p_id: appt.id, p_action: "approve" })).error).toBeNull(); // before any runner looked
    await drain(request, settled(b, 1));
    expect((await rows(b)).map((r) => `${r.type}:${r.status}`)).toEqual(["booking_confirmed:sent"]);
  });

  test("NTF-03: waiting for a retry while the owner decides ⇒ the stale 'received' is skipped at send time, the decision is sent", async ({ request }) => {
    const b = await makeBusiness("clinic");
    const f = await firstDayWithSlots(request, b);
    const appt = await publicBook(request, b, f.date, f.times[0], 1, 0, mail("+failonce")); // the first attempt of every message to this address fails: deterministic, whoever runs it
    const mine = async () => (await rows(b)).filter((r) => r.appointment_id === appt.id);
    await drain(request, async () => byType(await mine(), "booking_received").some((r) => r.status === "failed") && idle(await rows(b)));
    expect((await b.db.rpc("transition_appointment", { p_id: appt.id, p_action: "approve" })).error).toBeNull(); // decided while the 'received' mail waits for its retry
    await drain(request, async () => byType(await mine(), "booking_received")[0]?.status === "skipped" && byType(await mine(), "booking_confirmed")[0]?.status === "sent", appt.id);
    expect(byType(await mine(), "booking_received")[0]).toMatchObject({ status: "skipped", skip_reason: "appointment_inactive", attempts: 2 });
    expect(byType(await mine(), "booking_confirmed")[0]).toMatchObject({ status: "sent" });
  });

  test("a rejected request tells the customer; a customer without e-mail is a recorded skip, not a silent gap (NTF-06)", async ({ request }) => {
    const b = await makeBusiness("clinic");
    const f = await firstDayWithSlots(request, b);
    const a1 = await publicBook(request, b, f.date, f.times[0], 1, 0, mail());
    const a2 = await publicBook(request, b, f.date, f.times[2], 2, 0, null); // no e-mail address
    await drain(request, settled(b, 3));
    expect((await b.db.rpc("transition_appointment", { p_id: a1.id, p_action: "reject" })).error).toBeNull();
    expect((await b.db.rpc("transition_appointment", { p_id: a2.id, p_action: "approve" })).error).toBeNull();
    await drain(request, settled(b, 5));
    const rs = await rows(b);
    expect(byType(rs, "booking_declined")[0].status).toBe("sent");
    expect(rs.find((r) => r.appointment_id === a2.id && r.type === "booking_received")).toMatchObject({ status: "skipped", skip_reason: "no_email" });
    expect(rs.find((r) => r.appointment_id === a2.id && r.type === "booking_confirmed")).toMatchObject({ status: "skipped", skip_reason: "no_email" });
  });

  test("owner cancellation informs the customer", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const a = await publicBook(request, b, f.date, f.times[0], 1, 0, mail());
    await drain(request, settled(b, 1));
    expect((await b.db.rpc("transition_appointment", { p_id: a.id, p_action: "cancel" })).error).toBeNull();
    await drain(request, settled(b, 2));
    expect(byType(await rows(b), "booking_cancelled_by_business")[0].status).toBe("sent");
  });
});

test.describe("exactly once under concurrency (NTF-01, OPS-05)", () => {
  test("eight runners at the same moment send each message once: one row per message, one claim per row", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const N = 6;
    for (let i = 0; i < N; i++) await publicBook(request, b, f.date, f.times[i], 100 + i, 0, mail());
    await Promise.all(Array.from({ length: 8 }, () => runOutbox(request)));
    await drain(request, settled(b, N));
    const rs = await rows(b);
    expect(rs).toHaveLength(N);
    expect(rs.every((r) => r.status === "sent" && r.attempts === 1)).toBe(true); // attempts === 1: no two runners ever claimed the same row
    expect(new Set(rs.map((r) => r.provider_message_id)).size).toBe(N);
    expect(new Set(rs.map((r) => r.appointment_id)).size).toBe(N);
  });
});

test.describe("provider failures (NTF-04)", () => {
  test("5xx forever: retries with backoff, never double-sends, ends dead after 7 attempts — the booking itself is untouched and the owner is told", async ({ request, page }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const a = await publicBook(request, b, f.date, f.times[0], 1, 0, mail("+fail5xx"));
    await drain(request, async () => (await rows(b)).some((r) => r.attempts >= 1) && idle(await rows(b)));
    let r = (await rows(b))[0];
    expect(r).toMatchObject({ status: "failed", attempts: 1, error: "injected 5xx" });
    await runOutbox(request); // still backing off: not claimed again
    expect((await rows(b))[0].attempts).toBe(1);

    for (let attempt = 2; attempt <= 7; attempt++) {
      release(a.id); // the backoff has elapsed
      await drain(request, async () => (await rows(b))[0].attempts >= attempt && idle(await rows(b)));
    }
    r = (await rows(b))[0];
    expect(r).toMatchObject({ status: "dead", attempts: 7 });
    sql(`update public.notification_log set next_attempt_at = now() - interval '1 second' where appointment_id = '${a.id}'`);
    await runOutbox(request);
    await runOutbox(request);
    expect((await rows(b))[0].attempts).toBe(7); // dead letters are not retried again
    expect((await b.db.from("appointments").select("status").eq("id", a.id)).data![0].status).toBe("confirmed"); // the booking never depended on the mail

    // the owner sees it, as a count (no addresses): API + dashboard banner
    await loginAs(page, b.ownerEmail);
    await page.goto("/dashboard");
    await expect(page.getByTestId("undelivered")).toContainText("הודעה אחת ללקוח לא נשלחה");
    const dead = await b.db.from("notification_log").select("status, type, skip_reason");
    expect(dead.data).toEqual([{ status: "dead", type: "booking_confirmed", skip_reason: null }]);
    expect((await b.db.from("notification_log").select("to_hash")).error).not.toBeNull(); // owners never read the address hash
  });

  test("fails once, then succeeds on the retry — one e-mail in the end; a refused address is dead at once", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const once = await publicBook(request, b, f.date, f.times[0], 1, 0, mail("+failonce"));
    const refused = await publicBook(request, b, f.date, f.times[1], 2, 0, mail("+reject"));
    await drain(request, async () => (await rows(b)).length === 2 && (await rows(b)).every((r) => r.attempts >= 1) && idle(await rows(b)));
    const first = await rows(b);
    expect(first.find((r) => r.appointment_id === once.id)).toMatchObject({ status: "failed", attempts: 1 });
    expect(first.find((r) => r.appointment_id === refused.id)).toMatchObject({ status: "dead", attempts: 1 }); // retrying a refusal cannot help
    release(once.id);
    await drain(request, async () => (await rows(b)).find((r) => r.appointment_id === once.id)!.status === "sent");
    expect((await rows(b)).find((r) => r.appointment_id === once.id)).toMatchObject({ status: "sent", attempts: 2 });
  });

  test("a runner that dies mid-send does not lose the message: the lease expires and it is retried", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const a = await publicBook(request, b, f.date, f.times[0], 1, 0, mail());
    // simulate the crash: the row is claimed ('sending', leased) and the worker disappears
    await drain(request, async () => (await rows(b)).length === 1);
    sql(`update public.notification_log set status = 'sending', attempts = 1, next_attempt_at = now() + interval '5 minutes', sent_at = null, provider_message_id = null, preview = null where appointment_id = '${a.id}'`);
    await runOutbox(request);
    expect((await rows(b))[0].status).toBe("sending"); // still leased: nobody else touches it
    sql(`update public.notification_log set next_attempt_at = now() - interval '1 second' where appointment_id = '${a.id}'`); // lease over
    await drain(request, async () => (await rows(b))[0].status === "sent");
    expect((await rows(b))[0]).toMatchObject({ status: "sent", attempts: 2 });
  });
});

test.describe("bounces and complaints (NTF-05)", () => {
  const wh = new Webhook(RESEND_WEBHOOK_SECRET);
  const post = (request: APIRequestContext, payload: unknown, over: { id?: string; at?: Date; signature?: string } = {}) => {
    const body = JSON.stringify(payload);
    const id = over.id ?? `msg_${rand()}`;
    const at = over.at ?? new Date();
    return request.post("/api/webhooks/resend", {
      data: body,
      headers: { "content-type": "application/json", "svix-id": id, "svix-timestamp": String(Math.floor(at.getTime() / 1000)), "svix-signature": over.signature ?? wh.sign(id, at, body) },
    });
  };

  test("a permanent bounce stops all further mail to that address; a transient one does not", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const bad = mail("-bounce");
    const soft = mail("-soft");
    expect((await post(request, { type: "email.bounced", data: { email_id: "x1", to: [bad], bounce: { type: "Permanent" } } })).status()).toBe(200);
    expect((await post(request, { type: "email.bounced", data: { email_id: "x2", to: [soft], bounce: { type: "Transient" } } })).status()).toBe(200);
    const a1 = await publicBook(request, b, f.date, f.times[0], 1, 0, bad);
    const a2 = await publicBook(request, b, f.date, f.times[1], 2, 0, soft);
    await drain(request, settled(b, 2));
    const rs = await rows(b);
    expect(rs.find((r) => r.appointment_id === a1.id)).toMatchObject({ status: "skipped", skip_reason: "suppressed" });
    expect(rs.find((r) => r.appointment_id === a2.id)!.status).toBe("sent");
  });

  test("a spam complaint suppresses too, and the bounce is correlated with the original send (NTF-12)", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const addr = mail("-c");
    const a = await publicBook(request, b, f.date, f.times[0], 1, 0, addr);
    await drain(request, settled(b, 1));
    const messageId = (await rows(b))[0].provider_message_id!;
    expect((await post(request, { type: "email.complained", data: { email_id: messageId, to: [addr] } })).status()).toBe(200);
    expect(sql(`select bounced_at is not null from public.notification_log where appointment_id = '${a.id}'`)).toBe("t");
    const a2 = await publicBook(request, b, f.date, f.times[1], 2, 0, addr);
    await drain(request, settled(b, 2));
    expect((await rows(b)).find((r) => r.appointment_id === a2.id)).toMatchObject({ status: "skipped", skip_reason: "suppressed" });
  });

  test("forged, tampered, stale and unsigned webhooks are refused with one answer and change nothing", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const victim = mail("-v");
    const payload = { type: "email.bounced", data: { email_id: "x", to: [victim], bounce: { type: "Permanent" } } };
    const body = JSON.stringify(payload);
    const good = await post(request, payload, { id: "msg_fixed", at: new Date() });
    expect(good.status()).toBe(200);
    // the same signature on a different recipient
    const tamperedBody = JSON.stringify({ ...payload, data: { ...payload.data, to: [mail("-other")] } });
    const r1 = await request.post("/api/webhooks/resend", { data: tamperedBody, headers: { "content-type": "application/json", "svix-id": "msg_fixed", "svix-timestamp": String(Math.floor(Date.now() / 1000)), "svix-signature": wh.sign("msg_fixed", new Date(), body) } });
    const r2 = await post(request, payload, { at: new Date(Date.now() - 20 * 60_000) }); // replay of an old delivery
    const r3 = await post(request, payload, { signature: "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" });
    const r4 = await request.post("/api/webhooks/resend", { data: body, headers: { "content-type": "application/json" } });
    const answers = await Promise.all([r1, r2, r3, r4].map(async (r) => [r.status(), (await r.json()).error.code]));
    expect(answers).toEqual([[401, "UNAUTHENTICATED"], [401, "UNAUTHENTICATED"], [401, "UNAUTHENTICATED"], [401, "UNAUTHENTICATED"]]);
    // the address in the refused (tampered) request was NOT suppressed
    const other = JSON.parse(tamperedBody).data.to[0] as string;
    const a = await publicBook(request, b, f.date, f.times[0], 1, 0, other);
    await drain(request, settled(b, 1));
    expect((await rows(b)).find((r) => r.appointment_id === a.id)!.status).toBe("sent");
    // a signed but meaningless body is a clean 400; an unrelated event type is accepted and ignored
    expect((await post(request, { nonsense: true })).status()).toBe(400);
    expect((await post(request, { type: "email.delivered", data: { email_id: "x", to: [mail()] } })).status()).toBe(200);
  });
});

test.describe("reminders (NTF-01/02/03/06, OPS-05)", () => {
  /** Distinct, well-separated calendar days per test and per project (positions 0,2,4 / 6,8,10 in the list of bookable days). */
  const dayOf = (testInfo: { project: { name: string } }, k: number) => (testInfo.project.name === "desktop" ? 0 : 6) + k * 2;
  const runReminders = (request: APIRequestContext, now: Date) => request.post(`/api/jobs/reminders?now=${encodeURIComponent(now.toISOString())}`, { headers: auth });
  const startOf = async (b: TestBusiness, id: string) => new Date((await b.db.from("appointments").select("starts_at").eq("id", id)).data![0].starts_at as string);
  const hours = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);

  test("one reminder per appointment, whatever the job does: a duplicate bucket is skipped and later ticks add nothing", async ({ request }, testInfo) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b, dayOf(testInfo, 0)); // its own calendar day: the reminder job is global
    const a = await publicBook(request, b, f.date, f.times[0], 1, 0, mail());
    const start = await startOf(b, a.id);
    await drain(request, settled(b, 1)); // the confirmation first
    const t0 = hours(start, testInfo.project.name === "desktop" ? -20 : -17); // each project has its own clock, so their job buckets never collide
    freshBucket(t0);
    freshBucket(new Date(t0.getTime() + 20 * 60_000));
    const first = await (await runReminders(request, t0)).json();
    expect(first.skipped).toBe(false);
    expect(first.queued).toBeGreaterThanOrEqual(1);
    const dup = await (await runReminders(request, new Date(t0.getTime() + 60_000))).json(); // same 15-minute bucket
    expect(dup).toMatchObject({ skipped: true });
    const later = await (await runReminders(request, new Date(t0.getTime() + 20 * 60_000))).json(); // next bucket: runs, adds nothing for this appointment
    expect(later.skipped).toBe(false);
    await drain(request, async () => byType(await rows(b), "reminder").every((r) => r.status === "sent") && byType(await rows(b), "reminder").length === 1);
    const reminder = byType(await rows(b), "reminder");
    expect(reminder).toHaveLength(1);
    expect(reminder[0]).toMatchObject({ status: "sent", attempts: 1 });
    expect(reminder[0].preview!.subject).toContain("תזכורת");
    const bucket = new Date(Math.floor(t0.getTime() / 900_000) * 900_000).toISOString().slice(0, 16);
    expect(sql(`select status from public.job_runs where job_name = 'reminders' and run_key = 'r:${bucket}'`)).toBe("succeeded");
  });

  test("NTF-03: cancelled after the reminder was queued ⇒ skipped at send time; cancelled before the job ⇒ never queued", async ({ request }, testInfo) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b, dayOf(testInfo, 1));
    const cancelledEarly = await publicBook(request, b, f.date, f.times[0], 2, 0, mail());
    expect((await b.db.rpc("transition_appointment", { p_id: cancelledEarly.id, p_action: "cancel" })).error).toBeNull(); // cancelled before the reminder job
    const queued = await publicBook(request, b, f.date, f.times[3], 3, 0, mail("+failonce")); // its first send attempt fails, so the queued reminder is guaranteed to wait
    const mine = async () => (await rows(b)).filter((r) => r.appointment_id === queued.id);
    await drain(request, async () => idle(await rows(b)) && byType(await mine(), "booking_confirmed").length === 1);
    await drain(request, async () => idle(await rows(b)) && byType(await mine(), "booking_confirmed")[0]?.status === "sent", queued.id);
    const tc = hours(await startOf(b, queued.id), testInfo.project.name === "desktop" ? -12 : -9);
    freshBucket(tc);
    await runReminders(request, tc); // queues the reminder and tries once: fails (injected), now it waits for its retry
    await drain(request, async () => byType(await mine(), "reminder").some((r) => r.status === "failed") && idle(await rows(b)));
    expect((await b.db.rpc("transition_appointment", { p_id: queued.id, p_action: "cancel" })).error).toBeNull(); // cancelled after it was queued
    await drain(request, async () => byType(await mine(), "reminder")[0]?.status === "skipped", queued.id);
    expect(byType(await mine(), "reminder")[0]).toMatchObject({ status: "skipped", skip_reason: "appointment_inactive" });
    expect((await rows(b)).some((r) => r.appointment_id === cancelledEarly.id && r.type === "reminder")).toBe(false);
  });

  test("no e-mail ⇒ the reminder is a recorded skip (NTF-06); a booking made inside the window gets none (NTF-02, see pgTAP for the clock-exact case)", async ({ request }, testInfo) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b, dayOf(testInfo, 2));
    const a = await publicBook(request, b, f.date, f.times[0], 1, 0, null);
    const start = await startOf(b, a.id);
    const tn = hours(start, testInfo.project.name === "desktop" ? -22 : -6);
    freshBucket(tn);
    expect((await (await runReminders(request, tn)).json()).queued).toBeGreaterThanOrEqual(1);
    await drain(request, async () => byType(await rows(b), "reminder").length === 1);
    expect(byType(await rows(b), "reminder")[0]).toMatchObject({ status: "skipped", skip_reason: "no_email" });
  });
});

test.describe("customer cancellation through the private link", () => {
  test("both sides are told once the customer cancels", async ({ request, page }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `10.5.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
    const booked = await request.post(`/api/public/${b.slug}/bookings`, {
      data: { serviceId: b.services[0].id, date: f.date, time: f.times[0], location: "business", customer: { fullName: "נועם לוי", phone: "050-3334455", email: mail() }, intake: {} },
      headers: { "x-forwarded-for": `10.6.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, "idempotency-key": `idem-${rand()}-cancel` },
    });
    const link = (await booked.json()).booking.manageUrl as string;
    await drain(request, settled(b, 1));
    await page.goto(link);
    await page.getByTestId("cancel-start").click();
    await page.getByTestId("cancel-confirm").click();
    await expect(page.getByTestId("manage-cancelled")).toBeVisible();
    await drain(request, settled(b, 3));
    const rs = await rows(b);
    expect(byType(rs, "booking_cancelled_by_customer")[0]).toMatchObject({ recipient: "customer", status: "sent" });
    expect(byType(rs, "owner_customer_cancelled")[0]).toMatchObject({ recipient: "owner", status: "sent" });
    expect(byType(rs, "booking_confirmed")[0].status).toBe("sent");
  });
});
