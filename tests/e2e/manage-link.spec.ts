import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { mail } from "./helpers/outbox";
import { admin, customer, fakeIp, firstDayWithSlots, makeBusiness, publicBook } from "./helpers/business";

// Owner decisions of 2026-10-23: the customer is identified by e-mail; the customer's link opens the business' booking page with the customer's OWN appointment
// above the form (nobody else sees it); the page carries no cancel / reschedule / attend tokens.
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test.beforeEach(async ({ context }) => { await context.setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() }); });

const tokenOf = (manageUrl: string) => manageUrl.split("/").pop()!;
const rawBook = (request: import("@playwright/test").APIRequestContext, slug: string, serviceId: string, date: string, time: string, c: Record<string, unknown>) =>
  request.post(`/api/public/${slug}/bookings`, { data: { serviceId, date, time, location: "business", customer: c, intake: {} }, headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `id-${Math.random().toString(36).slice(2)}` } });

test.describe("the customer's link opens the booking page with the customer's own appointment", () => {
  test("only the holder of the link sees the appointment; other businesses, no link and a wrong link show the plain form", async ({ page, request }) => {
    const a = await makeBusiness("barber");
    const other = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, a);
    const booked = (await publicBook(request, a, f.date, f.times[0], 1, 0, mail())) as unknown as { manageUrl: string };
    const token = tokenOf(booked.manageUrl);

    await page.goto(booked.manageUrl); // the link people receive
    await expect(page).toHaveURL(new RegExp(`/book/${a.slug}\\?m=`));
    await expect(page.getByTestId("manage-panel")).toBeVisible();
    await expect(page.getByTestId("manage-reference")).toBeVisible();
    await expect(page.getByTestId("business-name")).toBeVisible(); // the booking form is right there
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);

    // the page carries no token other than the link itself (no cancel / reschedule / attend tokens to lift)
    const html = await (await request.get(`/book/${a.slug}?m=${encodeURIComponent(token)}`)).text();
    const found = (html.match(/[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/g) ?? []).filter((x) => !x.endsWith(".js") && !x.endsWith(".css"));
    expect(found.filter((x) => x !== token), "tokens in the page").toEqual([]);

    // someone else's business, no link, a damaged link: the plain form, nothing revealed
    for (const url of [`/book/${other.slug}?m=${encodeURIComponent(token)}`, `/book/${a.slug}`, `/book/${a.slug}?m=${encodeURIComponent(token)}x`, `/book/${a.slug}?m=garbage`]) {
      await page.goto(url);
      await expect(page.getByTestId("business-name")).toBeVisible();
      await expect(page.getByTestId("manage-panel")).toHaveCount(0);
      await expect(page.getByTestId("manage-reference")).toHaveCount(0);
    }
    await page.goto(`/booking/garbage`);
    await expect(page.getByTestId("manage-invalid")).toBeVisible();
  });

  test("cancelling works from that page with the link's own token, and the appointment is shown as cancelled", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const booked = (await publicBook(request, b, f.date, f.times[0], 2, 0, mail())) as unknown as { id: string; manageUrl: string };
    await page.goto(booked.manageUrl);
    await page.getByTestId("cancel-start").click();
    await page.getByTestId("cancel-confirm").click();
    await expect(page.getByTestId("manage-cancelled")).toBeVisible();
    expect((await admin().from("appointments").select("status").eq("id", booked.id).single()).data!.status).toBe("cancelled_by_customer");
    await page.goto(booked.manageUrl);
    await expect(page.getByTestId("manage-status")).toContainText("בוטל");
  });
});

test.describe("a customer is identified by e-mail (BKG-05)", () => {
  test("an e-mail is required to book", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const c = customer(3);
    for (const bad of [{ fullName: c.fullName, phone: c.phone }, { ...c, email: "" }, { ...c, email: "not-an-address" }]) {
      const r = await rawBook(request, b.slug, b.services[0].id, f.date, f.times[0], bad);
      expect(r.status(), JSON.stringify(bad)).toBe(422);
      expect(JSON.stringify(await r.json())).toContain("customer.email");
    }
    expect(((await admin().from("appointments").select("id").eq("business_id", b.id)).data ?? []).length).toBe(0);
  });

  test("the same mailbox is one customer; the same phone with another e-mail is a different customer who uses none of the first one's limit", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const tag = mail().split("@")[0];
    const victim = { fullName: "דנה לוי", phone: "+972501110077", email: `${tag}@gmail.com` };
    expect((await rawBook(request, b.slug, b.services[0].id, f.date, f.times[0], victim)).status()).toBe(201);
    // the same mailbox spelled another way, other name and phone → the same customer, the record is not rewritten
    expect((await rawBook(request, b.slug, b.services[0].id, f.date, f.times[2], { fullName: "אחרת", phone: "+972501110078", email: `${tag}+promo@googlemail.com` })).status()).toBe(201);
    // a stranger who only knows the victim's phone number
    expect((await rawBook(request, b.slug, b.services[0].id, f.date, f.times[4], { fullName: "תוקף", phone: victim.phone, email: mail() })).status()).toBe(201);

    const cs = (await admin().from("customers").select("id, full_name, phone, email").eq("business_id", b.id)).data!;
    expect(cs).toHaveLength(2);
    const mine = cs.find((x) => x.full_name === "דנה לוי")!;
    expect(mine.phone).toBe(victim.phone);
    const count = async (id: string) => ((await admin().from("appointments").select("id").eq("customer_id", id)).data ?? []).length;
    expect(await count(mine.id)).toBe(2);
    expect(await count(cs.find((x) => x.id !== mine.id)!.id)).toBe(1);
  });
});
