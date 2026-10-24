import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import * as C from "../../lib/api/contracts";
import { admin, customer, fakeIp, firstDayWithSlots, loginAs, makeBusiness, publicBook, type TestBusiness } from "./helpers/business";
import { mail } from "./helpers/outbox";
import { ACCEPTED } from "./helpers/terms";

// The owner's side of the waitlist on the real stack: live view (WLT-07), automatic/manual offers (WLT-06), removal, isolation (SEC-01), CSRF.
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

const joinApi = (page: Page, b: TestBusiness, date: string, n: number, name = `ממתין ${n}`) =>
  page.request.post(`/api/public/${b.slug}/waitlist`, { data: { serviceId: b.services[0].id, date, acceptedTerms: ACCEPTED, customer: { fullName: name, phone: customer(500 + n).phone, email: mail() } }, headers: { "x-forwarded-for": fakeIp() } });
const agendaOf = async (page: Page, date: string) => C.OwnerAgendaResponse.parse(await (await page.request.get(`/api/owner/appointments?date=${date}`)).json());
const origin = (page: Page) => new URL(page.url()).origin;
const offersOf = async (b: TestBusiness) => (await admin().from("waitlist_offers").select("entry_id, status").eq("business_id", b.id).order("created_at")).data!;

test.describe("owner waitlist (real stack)", () => {
  test("live view: new entries appear without reload; auto-offer switch; manual offer; conflicts explained; removal in two steps", async ({ page, request }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const a = await publicBook(request, b, f.date, f.times[0], 1, 0, mail());
    await loginAs(page, b.ownerEmail);
    await page.goto("/dashboard?poll=500"); // a short polling interval for the test
    await page.getByTestId("day-input").fill(f.date);
    await expect(page.getByTestId("waitlist-empty")).toBeVisible();

    // WLT-07: an entry created by a customer shows up on its own
    const w1 = C.JoinWaitlistResponse.parse(await (await joinApi(page, b, f.date, 1)).json());
    await expect(page.getByTestId("waitlist-count")).toHaveText("1", { timeout: 10_000 });
    const w2 = C.JoinWaitlistResponse.parse(await (await joinApi(page, b, f.date, 2, "שם-ארוך-מאוד-של-ממתין-שלא-נגמר-אף-פעם-ולא-נשבר-בשום-מקום-כלל")).json());
    await expect(page.getByTestId("waitlist-count")).toHaveText("2", { timeout: 10_000 });
    await expect(page.getByTestId(`wl-${w1.id}`)).toContainText("ממתין 1");
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);

    // WLT-06: turn automatic offers off from the dashboard
    await page.getByTestId("wl-auto-switch").click();
    await expect.poll(async () => (await b.db.from("businesses").select("waitlist_auto_offer").eq("id", b.id).single()).data!.waitlist_auto_offer).toBe(false);
    await expect(page.getByText("כבוי: הצעות רק ידנית, מכאן.")).toBeVisible();
    expect((await b.db.rpc("transition_appointment", { p_id: a.id, p_action: "cancel" })).error).toBeNull(); // the slot frees up
    await page.waitForTimeout(1500);
    expect(await offersOf(b)).toEqual([]); // nothing happened by itself

    // the offer dialog asks for a time
    await page.getByTestId(`wl-offer-${w1.id}`).click();
    await page.getByTestId("offer-submit").click();
    await expect(page.getByTestId("offer-error")).toHaveText("יש לבחור שעה.");
    await page.getByRole("button", { name: "ביטול" }).click(); // nothing was sent
    await expect(page.getByTestId("offer-form")).toHaveCount(0);
    expect(await offersOf(b)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("manual offer for the freed slot, then removal in two steps passes the slot on", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const a = await publicBook(request, b, f.date, f.times[0], 1, 0, mail());
    expect((await b.db.from("businesses").update({ waitlist_auto_offer: false }).eq("id", b.id)).error).toBeNull();
    await loginAs(page, b.ownerEmail);
    const w1 = C.JoinWaitlistResponse.parse(await (await joinApi(page, b, f.date, 1)).json());
    const w2 = C.JoinWaitlistResponse.parse(await (await joinApi(page, b, f.date, 2)).json());
    expect((await b.db.rpc("transition_appointment", { p_id: a.id, p_action: "cancel" })).error).toBeNull();
    await page.goto("/dashboard?poll=500");
    await page.getByTestId("day-input").fill(f.date);
    await expect(page.getByTestId("waitlist-count")).toHaveText("2");

    await page.getByTestId(`wl-offer-${w1.id}`).click();
    await page.getByTestId("offer-time").fill(f.times[0]);
    expect((await axe(page)).violations).toEqual([]);
    await page.getByTestId("offer-submit").click();
    await expect(page.getByTestId("offer-form")).toHaveCount(0);
    await expect(page.getByTestId(`wl-${w1.id}`)).toHaveAttribute("data-status", "offered");
    await expect(page.getByTestId(`wl-${w1.id}`)).toContainText("הצעה עד");
    expect(await offersOf(b)).toEqual([{ entry_id: w1.id, status: "pending" }]);
    await expect(page.getByTestId(`wl-offer-${w1.id}`)).toBeDisabled(); // one live offer per entry

    // the same slot cannot be offered to a second person while the first offer is live
    await page.getByTestId(`wl-offer-${w2.id}`).click();
    await page.getByTestId("offer-time").fill(f.times[0]);
    await page.getByTestId("offer-submit").click();
    await expect(page.getByTestId("offer-error")).toContainText("אי אפשר להציע את השעה הזו");
    await page.getByRole("button", { name: "ביטול" }).click();

    // removing W1 withdraws the offer (the slot goes back to nobody because automatic offers are off) — asking is not removing
    await page.getByTestId(`wl-remove-${w1.id}`).click();
    expect((await admin().from("waitlist_entries").select("status").eq("id", w1.id).single()).data!.status).toBe("offered");
    await page.getByTestId(`wl-remove-yes-${w1.id}`).click();
    await expect(page.getByTestId(`wl-${w1.id}`)).toHaveCount(0);
    await expect(page.getByTestId("waitlist-count")).toHaveText("1");
    expect((await admin().from("waitlist_entries").select("status").eq("id", w1.id).single()).data!.status).toBe("cancelled");
    expect((await offersOf(b))[0].status).toBe("declined");

    // switching automatic offers back on and off again is a plain setting, persisted per business
    await page.getByTestId("wl-auto-switch").click();
    await expect.poll(async () => (await b.db.from("businesses").select("waitlist_auto_offer").eq("id", b.id).single()).data!.waitlist_auto_offer).toBe(true);
    await page.getByTestId("wl-enabled-switch").click();
    await expect.poll(async () => (await b.db.from("businesses").select("waitlist_enabled").eq("id", b.id).single()).data!.waitlist_enabled).toBe(false);
    expect((await page.request.post(`/api/public/${b.slug}/waitlist`, { data: { serviceId: b.services[0].id, date: f.date, acceptedTerms: ACCEPTED, customer: { fullName: "נועם לוי", phone: "050-1112233", email: mail() } }, headers: { "x-forwarded-for": fakeIp() } })).status()).toBe(404);
  });

  test("API: agenda carries waitlist, settings and a change version; tenant isolation; CSRF; validation", async ({ page, request, browser }) => {
    const mine = await makeBusiness("barber");
    const other = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, mine);
    await loginAs(page, mine.ownerEmail);
    const before = await agendaOf(page, f.date);
    expect(before.settings).toEqual({ waitlistEnabled: true, waitlistAutoOffer: true });
    expect(before.waitlist).toEqual([]);
    const w = C.JoinWaitlistResponse.parse(await (await joinApi(page, mine, f.date, 1)).json());
    const after = await agendaOf(page, f.date);
    expect(after.waitlist).toMatchObject([{ id: w.id, customer: "ממתין 1", status: "waiting", date: f.date, offer: null }]);
    expect(after.version).not.toBe(before.version); // the poller notices
    expect(C.OwnerVersionResponse.parse(await (await page.request.get("/api/owner/version")).json()).version).toBe(after.version);

    // CSRF: no Origin / a foreign Origin ⇒ 403, nothing changes
    for (const [path, body] of [[`/api/owner/waitlist/${w.id}/remove`, {}], [`/api/owner/waitlist/${w.id}/offer`, { time: "10:00" }], ["/api/owner/waitlist/settings", { autoOffer: false }]] as const) {
      for (const o of [undefined, "https://evil.example"]) {
        const r = await page.request.post(path, { data: body, headers: o ? { origin: o } : {} });
        expect(r.status(), `${path} ${o}`).toBe(403);
      }
    }
    expect((await agendaOf(page, f.date)).settings.waitlistAutoOffer).toBe(true);
    expect((await agendaOf(page, f.date)).waitlist).toHaveLength(1);

    // validation
    const post = (path: string, data: unknown) => page.request.post(path, { data, headers: { origin: origin(page) } });
    expect((await post("/api/owner/waitlist/settings", {})).status()).toBe(422);
    expect((await post("/api/owner/waitlist/settings", { autoOffer: "yes" })).status()).toBe(422);
    expect((await post("/api/owner/waitlist/settings", { autoOffer: false, businessId: other.id })).status()).toBe(422); // unknown field
    expect((await post(`/api/owner/waitlist/${w.id}/offer`, { time: "25:61" })).status()).toBe(422);
    expect((await post("/api/owner/waitlist/not-a-uuid/remove", {})).status()).toBe(404);

    // tenant isolation: another business's owner sees nothing of mine and cannot touch it
    const ctx = await browser.newContext();
    const intruder = await ctx.newPage();
    await loginAs(intruder, other.ownerEmail);
    await intruder.goto("/dashboard");
    expect((await agendaOf(intruder, f.date)).waitlist).toEqual([]);
    const o = { origin: origin(intruder) };
    expect((await intruder.request.post(`/api/owner/waitlist/${w.id}/remove`, { data: {}, headers: o })).status()).toBe(404);
    expect((await intruder.request.post(`/api/owner/waitlist/${w.id}/offer`, { data: { time: "10:00" }, headers: o })).status()).toBe(404);
    expect((await intruder.request.post("/api/owner/waitlist/settings", { data: { autoOffer: false }, headers: o })).status()).toBe(200); // their own setting only
    await ctx.close();
    expect((await admin().from("businesses").select("waitlist_auto_offer").eq("id", mine.id).single()).data!.waitlist_auto_offer).toBe(true);
    expect((await admin().from("businesses").select("waitlist_auto_offer").eq("id", other.id).single()).data!.waitlist_auto_offer).toBe(false);
    expect((await admin().from("waitlist_entries").select("status").eq("id", w.id).single()).data!.status).toBe("waiting");
    // without a session
    expect((await request.get("/api/owner/version")).status()).toBe(401);
    expect((await request.post("/api/owner/waitlist/settings", { data: { autoOffer: false }, headers: { origin: "http://127.0.0.1:3100" } })).status()).toBe(401);
  });
});
