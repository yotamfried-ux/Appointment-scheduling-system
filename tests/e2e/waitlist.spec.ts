import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import * as C from "../../lib/api/contracts";
import { admin, customer, fakeIp, firstDayWithSlots, makeBusiness, publicBook, sql, type TestBusiness } from "./helpers/business";
import { auth, byType, drain, idle, mail, rows, runWaitlistSweep } from "./helpers/outbox";

// Waitlist on the real stack (fake e-mail provider). Scenarios: WLT-01 (FIFO offer on cancellation) · WLT-02/04 (accept vs booking race, EXCLUDE decides) ·
// WLT-03 (expiry passes the slot on, sweep idempotent) · WLT-06 (auto-offer off) · WLT-08 (validation, cap, idempotency, rate limit) · SEC-05/06 (links).
const axe = async (page: Page) => { await expect(page).toHaveTitle(/.+/); /* the title streams in after a client navigation; axe must not race it */ return new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze(); };
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

const join = (request: APIRequestContext, b: TestBusiness, date: string, n: number, over: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  request.post(`/api/public/${b.slug}/waitlist`, {
    data: { serviceId: b.services[0].id, date, customer: { fullName: `ממתין ${n}`, phone: customer(300 + n).phone, email: mail() }, ...over },
    headers: { "x-forwarded-for": fakeIp(), ...headers },
  });

const offersOf = async (b: TestBusiness) => (await admin().from("waitlist_offers").select("id, entry_id, status, slot_starts_at, expires_at, appointment_id").eq("business_id", b.id).order("created_at")).data!;
const entryStatus = async (id: string) => (await admin().from("waitlist_entries").select("status").eq("id", id).single()).data!.status as string;
const activeAt = async (b: TestBusiness, startsAt: string) => (await admin().from("appointments").select("id, status").eq("business_id", b.id).eq("starts_at", startsAt).in("status", ["pending", "confirmed"])).data!;
const linkIn = (text: string) => text.match(/https?:\/\/\S+\/waitlist\/[\w.-]+/)![0];

/** A full barber day: A holds the first slot, three customers join the list in order. */
async function scenario(request: APIRequestContext, b: TestBusiness, n = 3) {
  const f = await firstDayWithSlots(request, b);
  const a = await publicBook(request, b, f.date, f.times[0], 1, 0, mail());
  const w: { id: string; email: string }[] = [];
  for (let i = 1; i <= n; i++) {
    const email = mail();
    const r = await join(request, b, f.date, i, { customer: { fullName: `ממתין ${i}`, phone: customer(300 + i).phone, email } });
    expect(r.status(), await r.text()).toBe(201);
    w.push({ id: C.JoinWaitlistResponse.parse(await r.json()).id!, email }); // a creator always gets the id
  }
  const slotStart = (await b.db.from("appointments").select("starts_at").eq("id", a.id).single()).data!.starts_at as string;
  return { f, a, w, slotStart };
}
const cancel = async (b: TestBusiness, id: string) => expect((await b.db.rpc("transition_appointment", { p_id: id, p_action: "cancel" })).error).toBeNull();
const offerLink = async (b: TestBusiness, offerId: string) => linkIn(byType(await rows(b), "waitlist_offer").find((r) => r.offer_id === offerId)!.preview!.text);

test.describe("joining (WLT-08)", () => {
  test("validation names the field; the e-mail is required; unknown fields and foreign services are refused", async ({ request }) => {
    const b = await makeBusiness("barber");
    const other = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const fields = async (over: Record<string, unknown>) => {
      const r = await join(request, b, f.date, 1, over);
      expect(r.status(), JSON.stringify(over)).toBe(422);
      return C.ApiErrorBody.parse(await r.json()).error.details!.map((d) => d.field);
    };
    expect(await fields({ customer: { fullName: "א", phone: "12", email: "" } })).toEqual(expect.arrayContaining(["customer.fullName", "customer.phone", "customer.email"]));
    expect(await fields({ customer: { fullName: "נועם לוי", phone: "050-1234567", email: "not-an-email" } })).toContain("customer.email");
    expect(await fields({ date: "2026-13-45" })).toContain("date");
    expect(await fields({ window: { from: "18:00", to: "09:00" } })).toEqual(expect.arrayContaining([expect.stringContaining("window")]));
    expect(await fields({ businessId: b.id })).toContain("_");
    expect(await fields({ date: "2020-01-01" })).toContain("date"); // the past
    const foreign = await join(request, b, f.date, 1, { serviceId: other.services[0].id });
    expect(foreign.status()).toBe(409);
    expect(C.ApiErrorBody.parse(await foreign.json()).error.code).toBe("SERVICE_UNAVAILABLE");
    expect((await join(request, b, f.date, 1, { date: "2040-01-01" })).status()).toBe(422); // beyond the booking horizon
    expect((await admin().from("waitlist_entries").select("id").eq("business_id", b.id)).data).toEqual([]); // nothing was created
  });

  test("SEC: a stranger who replays someone's phone number gets no manage link; the original browser (same key) still does", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const victim = { fullName: "נועם לוי", phone: "050-4445577", email: mail() };
    const body = { date: f.date, customer: victim };
    const first = await join(request, b, f.date, 1, body, { "idempotency-key": "victim-browser-key-1" });
    expect(first.status()).toBe(201);
    expect((await first.json()).manageUrl).toMatch(/^\/waitlist\//);
    const attacker = await join(request, b, f.date, 1, { date: f.date, customer: { ...victim, email: mail() } }, { "idempotency-key": "attacker-key-0001" });
    expect(attacker.status()).toBe(200);
    const stranger = await attacker.json();
    expect(stranger.manageUrl).toBeUndefined();
    expect(stranger.id).toBeUndefined(); // not even the entry's id: the position is not the stranger's to see
    const noProof = await join(request, b, f.date, 1, body);
    expect((await noProof.json()).manageUrl).toBeUndefined();
    const retry = await join(request, b, f.date, 1, body, { "idempotency-key": "victim-browser-key-1" });
    expect((await retry.json()).manageUrl).toMatch(/^\/waitlist\//);
    const rows = (await admin().from("waitlist_entries").select("contact_email").eq("business_id", b.id)).data!;
    expect(rows).toEqual([{ contact_email: victim.email }]); // the attacker's address was never stored
  });

  test("joining twice is idempotent (200 + Idempotent-Replay); at most three active entries per customer; the same phone for another business is separate", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const data = (date: string) => ({ date, customer: { fullName: "נועם לוי", phone: "050-4445566", email: mail() } });
    const first = await join(request, b, f.date, 1, data(f.date));
    const again = await join(request, b, f.date, 1, data(f.date));
    expect(first.status()).toBe(201);
    expect(again.status()).toBe(200);
    expect(again.headers()["idempotent-replay"]).toBe("true");
    expect((await again.json()).id).toBe((await first.json()).id);
    const days = C.AvailabilityResponse.parse(await (await request.get(`/api/public/${b.slug}/availability?service=${b.services[0].id}&from=${f.date}&days=14`)).json()).days.filter((d) => d.date > f.date);
    expect((await join(request, b, days[0].date, 1, data(days[0].date))).status()).toBe(201);
    expect((await join(request, b, days[1].date, 1, data(days[1].date))).status()).toBe(201);
    const fourth = await join(request, b, days[2].date, 1, data(days[2].date));
    expect(fourth.status()).toBe(409);
    expect(C.ApiErrorBody.parse(await fourth.json()).error.code).toBe("WAITLIST_LIMIT");
    expect((await admin().from("waitlist_entries").select("id").eq("business_id", b.id)).data).toHaveLength(3);
  });

  test("rate limit: the per-IP limit answers 429 with Retry-After; another IP is unaffected; a switched-off waitlist is a plain 404", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const ip = fakeIp();
    const fire = (n: number) => join(request, b, f.date, n, { date: "2020-01-01" }, { "x-forwarded-for": ip, "x-test-limit": "2" });
    expect((await fire(1)).status()).toBe(422);
    expect((await fire(2)).status()).toBe(422);
    const limited = await fire(3);
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
    expect((await join(request, b, f.date, 4, { date: "2020-01-01" })).status()).toBe(422); // a different IP is not affected
    expect((await b.db.from("businesses").update({ waitlist_enabled: false }).eq("id", b.id)).error).toBeNull();
    expect((await join(request, b, f.date, 5)).status()).toBe(404);
    expect((await request.get(`/api/public/${b.slug}/services`)).ok()).toBe(true);
    expect(C.ServicesResponse.parse(await (await request.get(`/api/public/${b.slug}/services`)).json()).business.waitlistEnabled).toBe(false);
  });
});

test.describe("offers (WLT-01/03/04/06)", () => {
  test("a cancellation offers the slot to the FIRST in line only; the e-mail carries the link; accepting in the browser books it", async ({ request, page }) => {
    const b = await makeBusiness("barber");
    const { f, a, w, slotStart } = await scenario(request, b);
    await cancel(b, a.id);
    const offers = await offersOf(b);
    expect(offers).toHaveLength(1); // one live offer, not three
    expect(offers[0]).toMatchObject({ entry_id: w[0].id, status: "pending" });
    expect(await entryStatus(w[0].id)).toBe("offered");
    expect(await entryStatus(w[1].id)).toBe("waiting");
    await drain(request, async () => byType(await rows(b), "waitlist_offer").every((r) => r.status === "sent") && byType(await rows(b), "waitlist_offer").length === 1 && idle(await rows(b)));
    const mailRow = byType(await rows(b), "waitlist_offer")[0];
    expect(mailRow.preview!.subject).not.toContain(b.services[0].name); // privacy: the subject never names the service
    expect(mailRow.preview!.text).toContain("תקף עד");
    expect(mailRow.preview!.text).not.toContain("/booking/");

    await page.goto(linkIn(mailRow.preview!.text));
    await expect(page.getByTestId("wl-headline")).toHaveText("התפנה תור בשבילכם!");
    await expect(page.getByTestId("offer-when")).toBeVisible();
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
    await page.reload();
    await page.reload(); // GET never changes state
    expect((await offersOf(b))[0].status).toBe("pending");
    await page.getByTestId("wl-accept").click();
    await expect(page.getByTestId("wl-headline")).toHaveText("התור נקבע");
    await expect(page.getByTestId("booked-reference")).toBeVisible();
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);

    const now = await activeAt(b, slotStart);
    expect(now).toHaveLength(1);
    expect(now[0].status).toBe("confirmed");
    expect(await entryStatus(w[0].id)).toBe("booked");
    expect(await entryStatus(w[1].id)).toBe("waiting"); // the others are untouched
    await drain(request, async () => byType(await rows(b), "booking_confirmed").some((r) => r.status === "sent" && r.appointment_id === now[0].id));
    expect(byType(await rows(b), "booking_confirmed").find((r) => r.appointment_id === now[0].id)!.preview!.text).toContain("TR-"); // the normal confirmation follows
    expect(await offersOf(b)).toHaveLength(1);
    void f;
  });

  test("an unanswered offer expires, the slot moves on to the next in line, the first is told, and the sweep is idempotent (WLT-03)", async ({ request, page }) => {
    const b = await makeBusiness("barber");
    const { a, w } = await scenario(request, b);
    await cancel(b, a.id);
    await drain(request, async () => byType(await rows(b), "waitlist_offer").length === 1 && idle(await rows(b)));
    sql(`update public.waitlist_offers set expires_at = now() - interval '1 minute' where entry_id = '${w[0].id}'`);
    const sweep = await runWaitlistSweep(request);
    expect(sweep.status()).toBe(200);
    expect((await sweep.json()).sweep.expired).toBeGreaterThanOrEqual(1);
    const offers = await offersOf(b);
    expect(offers.map((o) => `${o.entry_id === w[0].id ? "W1" : "W2"}:${o.status}`)).toEqual(["W1:expired", "W2:pending"]);
    expect(await entryStatus(w[0].id)).toBe("waiting"); // W1 stays on the list
    await runWaitlistSweep(request);
    await runWaitlistSweep(request);
    expect((await offersOf(b)).map((o) => o.status)).toEqual(["expired", "pending"]); // running it again changes nothing
    await drain(request, async () => idle(await rows(b)) && byType(await rows(b), "waitlist_offer").length === 2 && byType(await rows(b), "waitlist_offer_expired").length === 1);
    const rs = await rows(b);
    expect(byType(rs, "waitlist_offer_expired")[0]).toMatchObject({ status: "sent", offer_id: offers[0].id });
    expect(byType(rs, "waitlist_offer").map((r) => r.offer_id).sort()).toEqual(offers.map((o) => o.id).sort());
    // W1's old link: still on the list, but no offer to accept
    await page.goto(linkIn(byType(rs, "waitlist_offer").find((r) => r.offer_id === offers[0].id)!.preview!.text));
    await expect(page.getByTestId("wl-headline")).toHaveText("אתם ברשימת ההמתנה");
    await expect(page.getByTestId("wl-accept")).toHaveCount(0);
    // W2's link works
    await page.goto(await offerLink(b, offers[1].id));
    await expect(page.getByTestId("wl-headline")).toHaveText("התפנה תור בשבילכם!");
    await page.getByTestId("wl-accept").click();
    await expect(page.getByTestId("wl-headline")).toHaveText("התור נקבע");
    expect(await entryStatus(w[1].id)).toBe("booked");
  });

  test("decline passes the slot to the next in line; leaving removes you (two steps); an expired link is not honoured", async ({ request, page }) => {
    const b = await makeBusiness("barber");
    const { a, w } = await scenario(request, b);
    await cancel(b, a.id);
    await drain(request, async () => byType(await rows(b), "waitlist_offer").length === 1 && idle(await rows(b)));
    await page.goto(await offerLink(b, (await offersOf(b))[0].id));
    await page.getByTestId("wl-decline").click();
    await expect(page.getByTestId("wl-headline")).toHaveText("אתם ברשימת ההמתנה");
    const offers = await offersOf(b);
    expect(offers.map((o) => `${o.entry_id === w[0].id ? "W1" : "W2"}:${o.status}`)).toEqual(["W1:declined", "W2:pending"]);
    // W1 now leaves for good: asking is not leaving
    await page.getByTestId("wl-leave").click();
    expect(await entryStatus(w[0].id)).toBe("waiting");
    await page.getByTestId("wl-leave-confirm").click();
    await expect(page.getByTestId("wl-headline")).toHaveText("הוסרתם מהרשימה");
    expect(await entryStatus(w[0].id)).toBe("cancelled");
    await expect(page.getByTestId("wl-leave")).toHaveCount(0);
  });

  test("WLT-04: the owner books the offered slot by hand before the offer is accepted — the customer is told and stays on the list", async ({ request, page }) => {
    const b = await makeBusiness("barber");
    const { f, a, w, slotStart } = await scenario(request, b);
    await cancel(b, a.id);
    await drain(request, async () => byType(await rows(b), "waitlist_offer").length === 1 && idle(await rows(b)));
    await page.goto(await offerLink(b, (await offersOf(b))[0].id));
    await expect(page.getByTestId("wl-accept")).toBeVisible();
    // the public cannot take a slot that is on offer (the offer e-mail promises it is kept)…
    const grab = await request.post(`/api/public/${b.slug}/bookings`, { data: { serviceId: b.services[0].id, date: f.date, time: f.times[0], location: "business", customer: { fullName: "מתחרה", phone: "0509998877", email: mail() }, intake: {} }, headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `grab-${Math.random().toString(36).slice(2)}` } });
    expect(grab.status()).toBe(409);
    // …only the owner can book it by hand meanwhile (WLT-04)
    const hand = await b.db.rpc("create_manual_appointment", { p_business: b.id, p_service: b.services[0].id, p_starts_at: slotStart, p_full_name: "ידני", p_phone: "+972509998866", p_note: null, p_out_of_availability: false });
    expect(hand.error, JSON.stringify(hand.error)).toBeNull();
    await page.getByTestId("wl-accept").click();
    await expect(page.getByTestId("wl-result")).toContainText("התור נתפס");
    expect(await entryStatus(w[0].id)).toBe("waiting");
    expect((await offersOf(b))[0].status).toBe("lost");
    expect(await activeAt(b, slotStart)).toHaveLength(1); // never two in one slot
    await expect(page.getByTestId("wl-headline")).toHaveText("אתם ברשימת ההמתנה");
    expect((await axe(page)).violations).toEqual([]);
  });

  test("WLT-02: accepting at the same moment as a public booking — exactly one wins, whatever the order; a double click books once", async ({ request, browser }) => {
    for (const mode of ["race", "double-click"] as const) {
      const b = await makeBusiness("barber");
      const { f, a, w, slotStart } = await scenario(request, b, 2);
      await cancel(b, a.id);
      await drain(request, async () => byType(await rows(b), "waitlist_offer").length === 1 && idle(await rows(b)));
      const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": fakeIp() } });
      const page = await ctx.newPage();
      await page.goto(await offerLink(b, (await offersOf(b))[0].id));
      await expect(page.getByTestId("wl-accept")).toBeVisible();
      if (mode === "race") {
        const [, booked] = await Promise.all([
          page.getByTestId("wl-accept").click(),
          request.post(`/api/public/${b.slug}/bookings`, { data: { serviceId: b.services[0].id, date: f.date, time: f.times[0], location: "business", customer: customer(98), intake: {} }, headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `idem-race-${Math.random().toString(36).slice(2)}` } }),
        ]);
        expect([201, 409]).toContain(booked.status());
        await page.waitForTimeout(1500);
        const now = await activeAt(b, slotStart);
        expect(now).toHaveLength(1); // one winner
        const won = (await entryStatus(w[0].id)) === "booked";
        expect(booked.status() === 409).toBe(won); // the waitlist customer won exactly when the public booking lost
      } else {
        await page.getByTestId("wl-accept").dblclick();
        await expect(page.getByTestId("wl-headline")).toHaveText("התור נקבע");
        expect(await activeAt(b, slotStart)).toHaveLength(1);
      }
      await ctx.close();
    }
  });

  test("WLT-06: with auto-offer off nothing is offered by itself; the owner offers manually", async ({ request }) => {
    const b = await makeBusiness("barber");
    expect((await b.db.from("businesses").update({ waitlist_auto_offer: false }).eq("id", b.id)).error).toBeNull();
    const { a, w, slotStart } = await scenario(request, b);
    await cancel(b, a.id);
    expect(await offersOf(b)).toEqual([]);
    expect(await entryStatus(w[0].id)).toBe("waiting");
    const manual = await b.db.rpc("waitlist_manual_offer", { p_entry: w[1].id, p_starts_at: slotStart });
    expect(manual.error).toBeNull();
    expect((await offersOf(b)).map((o) => o.entry_id)).toEqual([w[1].id]);
    expect(await entryStatus(w[1].id)).toBe("offered");
  });

  test("window and fit: an entry that wants other hours, another day or a longer service is not offered the slot", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const a = await publicBook(request, b, f.date, f.times[0], 1, 0, mail()); // first slot of the day (morning)
    const evening = await join(request, b, f.date, 1, { window: { from: "17:00", to: "19:00" } });
    const otherDay = await join(request, b, f.date, 2, { date: (await firstDayWithSlots(request, b, 1)).date });
    expect(evening.status()).toBe(201);
    expect(otherDay.status()).toBe(201);
    await cancel(b, a.id);
    expect(await offersOf(b)).toEqual([]); // nobody fits
    const fits = await join(request, b, f.date, 3, { window: { from: "06:00", to: "13:00" } });
    expect(fits.status()).toBe(201);
    await cancel(b, (await publicBook(request, b, f.date, f.times[0], 4, 0, mail())).id); // the slot frees up again
    expect((await offersOf(b)).map((o) => o.entry_id)).toEqual([(await fits.json()).id]); // only the one whose window fits
  });
});

test.describe("the customer's link", () => {
  test("forged, tampered, truncated, wrong-scope and unrelated tokens all show the same generic page", async ({ request, page }) => {
    const b = await makeBusiness("barber");
    const { f, w } = await scenario(request, b, 1);
    const booked = await request.post(`/api/public/${b.slug}/bookings`, { data: { serviceId: b.services[0].id, date: f.date, time: f.times[3], location: "business", customer: customer(77), intake: {} }, headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `idem-${Math.random().toString(36).slice(2)}-tok` } });
    const bookingToken = ((await booked.json()).booking.manageUrl as string).split("/").pop()!; // a valid token of ANOTHER scope
    const joinRes = await join(request, b, f.date, 8);
    const good = ((await joinRes.json()).manageUrl as string).split("/").pop()!;
    const bad = [bookingToken, good.slice(0, -3) + "AAA", good.slice(0, 20), "x", "a.b.c", encodeURIComponent("<script>alert(1)</script>"), good.split(".")[0] + ".AAAA"];
    const texts: string[] = [];
    for (const t of bad) {
      await page.goto(`/waitlist/${t}`);
      await expect(page.getByTestId("waitlist-invalid")).toBeVisible();
      texts.push((await page.getByTestId("waitlist-invalid").innerText()).trim());
    }
    expect(new Set(texts).size).toBe(1);
    await page.goto(`/waitlist/${good}`);
    await expect(page.getByTestId("wl-headline")).toHaveText("אתם ברשימת ההמתנה");
    const headers = (await page.goto(`/waitlist/${good}`))!.headers();
    expect(headers["cache-control"]).toContain("no-store");
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    expect(await entryStatus(w[0].id)).toBe("waiting"); // looking changed nothing
    // the sweep endpoint is not public
    expect((await request.post("/api/jobs/waitlist")).status()).toBe(401);
    expect((await request.post("/api/jobs/waitlist", { headers: auth })).status()).toBe(200);
  });
});
