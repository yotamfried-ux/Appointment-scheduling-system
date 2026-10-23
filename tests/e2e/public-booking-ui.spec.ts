import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { BUSINESS_KINDS, type BusinessKindId } from "../../modules/tenancy/business-kind";
import { makeBusiness, rand, sql, type TestBusiness } from "./helpers/business";

// Real browser, real stack: /book/[slug] → public API → Postgres, then the customer's private link /booking/[token].
// Scenarios: BKG-01/02/03/04/09/11/13, SEC-05/06, ACC-07, UX-01/02.

const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ "x-forwarded-for": ip() }); // every test is its own "visitor" for the per-IP limits
});

async function pickSlot(page: Page, b: TestBusiness, serviceIndex = 0) {
  await page.getByTestId(`service-${b.services[serviceIndex].id}`).check({ force: true });
  await page.getByTestId("continue").click();
  await page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
  const date = (await page.locator('input[name="day"]:checked').getAttribute("data-testid"))!.replace("day-", "");
  await page.getByTestId("continue").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("באיזו שעה?");
  const chip = page.locator('input[name="time"]').first();
  await chip.check({ force: true });
  const time = (await chip.getAttribute("value"))!;
  await page.getByTestId("continue").click();
  return { date, time };
}

async function details(page: Page, kind: BusinessKindId, phone = "050-1234567") {
  await page.getByLabel("שם מלא").fill("נועם לוי");
  await page.getByLabel("טלפון נייד").fill(phone);
  await page.getByLabel("אימייל").fill(`ui${Math.random().toString(36).slice(2, 9)}@example.com`);
  for (const f of BUSINESS_KINDS[kind].intake.filter((x) => x.required)) {
    const el = page.getByTestId(`intake-${f.id}`);
    if (f.type === "select") await el.selectOption(f.options![0]);
    else await el.fill("דוגמה");
  }
}

async function book(page: Page, b: TestBusiness) {
  await page.goto(`/book/${b.slug}`);
  const slot = await pickSlot(page, b);
  await details(page, b.kind);
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("done-title")).toBeVisible();
  return slot;
}

test.describe("public booking page (/book/[slug])", () => {
  test("customer books end to end; the appointment exists in the DB, the slot is gone, the page is clean", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => (m.type() === "error" ? errors.push(m.text()) : undefined));
    page.on("pageerror", (e) => errors.push(e.message));
    const b = await makeBusiness("barber");
    await page.goto(`/book/${b.slug}`);
    await expect(page.getByTestId("business-name")).toBeVisible();
    await expect(page.getByTestId(`service-${b.services[0].id}`)).toBeAttached();
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);

    const slot = await pickSlot(page, b);
    await details(page, "barber");
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
    await page.getByTestId("continue").click();

    await expect(page.getByTestId("done-title")).toBeVisible();
    await expect(page.getByTestId("done-status")).toHaveText("מאושר");
    await expect(page.getByTestId("email-preview")).toHaveCount(0); // no fake e-mail preview on the real page
    // honesty: the real page promises only what exists today (no e-mail yet, no calendar file, no rescheduling)
    await expect(page.getByRole("button", { name: "הוספה ליומן" })).toHaveCount(0);
    await expect(page.getByText(/שלחנו|נעדכן במייל|לשנות את התור/)).toHaveCount(0);
    await expect(page.getByText("אפשר לבטל עד 12 שעות לפני המועד.")).toBeVisible();
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);

    const rows = (await b.db.from("appointments").select("status, intake").eq("business_id", b.id)).data!;
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("confirmed");
    await page.goto(`/book/${b.slug}`);
    await page.getByTestId(`service-${b.services[0].id}`).check({ force: true });
    await page.getByTestId("continue").click();
    const d = page.getByTestId(`day-${slot.date}`);
    await expect(d).toBeEnabled();
    await d.check({ force: true });
    await page.getByTestId("continue").click();
    await expect(page.getByTestId(`time-${slot.time}`)).toHaveCount(0); // booked slot is no longer offered
    expect(errors, errors.join("\n")).toEqual([]);
  });

  for (const kind of ["clinic", "teacher"] as const) {
    test(`${kind}: kind-specific intake and approval wording`, async ({ page }) => {
      const b = await makeBusiness(kind);
      await page.goto(`/book/${b.slug}`);
      await pickSlot(page, b);
      await details(page, kind);
      await page.getByTestId("continue").click();
      await expect(page.getByTestId("done-title")).toBeVisible();
      await expect(page.getByTestId("done-status")).toHaveText(BUSINESS_KINDS[kind].defaults.requireApproval ? "ממתין לאישור" : "מאושר");
      const row = (await b.db.from("appointments").select("status").eq("business_id", b.id)).data![0];
      expect(row.status).toBe(BUSINESS_KINDS[kind].defaults.requireApproval ? "pending" : "confirmed");
      await noOverflow(page);
      expect((await axe(page)).violations).toEqual([]);
    });
  }

  test("two customers race for the last slot: one wins, the other is told and can choose another time", async ({ browser }) => {
    const b = await makeBusiness("barber");
    const mk = async () => {
      const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": ip() } });
      return { ctx, page: await ctx.newPage() };
    };
    const [x, y] = [await mk(), await mk()];
    for (const c of [x, y]) {
      await c.page.goto(`/book/${b.slug}`);
      await c.page.getByTestId(`service-${b.services[0].id}`).check({ force: true });
      await c.page.getByTestId("continue").click();
      await c.page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
      await c.page.getByTestId("continue").click();
      await c.page.getByTestId("time-" + (await c.page.locator('input[name="time"]').first().getAttribute("value"))).check({ force: true });
      await c.page.getByTestId("continue").click();
      await details(c.page, "barber", c === x ? "050-1111111" : "050-2222222");
    }
    await x.page.getByTestId("continue").click();
    await expect(x.page.getByTestId("done-title")).toBeVisible();
    await y.page.getByTestId("continue").click();
    await expect(y.page.getByRole("heading", { level: 1 })).toHaveText("באיזו שעה?"); // sent back to choose another time
    await expect(y.page.getByTestId("done-title")).toHaveCount(0);
    await expect(y.page.getByTestId("hold")).toHaveCount(0);
    expect((await axe(y.page)).violations).toEqual([]);
    expect((await b.db.from("appointments").select("id").eq("business_id", b.id)).data).toHaveLength(1);
    await x.ctx.close();
    await y.ctx.close();
  });

  test("a failed response keeps the details and the retry reuses the Idempotency-Key and books once", async ({ page }) => {
    const b = await makeBusiness("barber");
    await page.goto(`/book/${b.slug}`);
    const keys: string[] = [];
    let n = 0;
    await page.route(`**/api/public/${b.slug}/bookings`, async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      if (++n === 1) {
        await route.fetch(); // the server DID book…
        return route.abort("connectionreset"); // …but the answer never arrived
      }
      return route.continue();
    });
    await pickSlot(page, b);
    await details(page, "barber");
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("submit-error")).toBeVisible();
    await expect(page.getByLabel("שם מלא")).toHaveValue("נועם לוי");
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("done-title")).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect((await b.db.from("appointments").select("id").eq("business_id", b.id)).data).toHaveLength(1);
  });

  test("unknown and unpublished businesses show the same friendly closed page; an old slug redirects to the new one", async ({ page }) => {
    const hidden = await makeBusiness("barber", { publish: false });
    for (const slug of ["no-such-" + rand(), hidden.slug]) {
      const res = await page.goto(`/book/${slug}`);
      expect(res?.status()).toBe(404);
      await expect(page.getByTestId("booking-closed")).toBeVisible();
      await noOverflow(page);
      expect((await axe(page)).violations).toEqual([]);
    }
    const b = await makeBusiness("barber");
    const next = `e2e-new-${rand()}`;
    expect((await b.db.rpc("change_business_slug", { p_business: b.id, p_new_slug: next })).error).toBeNull();
    await page.goto(`/book/${b.slug}`);
    await expect(page).toHaveURL(new RegExp(`/book/${next}$`));
    await expect(page.getByTestId("business-name")).toBeVisible();
  });

  test("a very long business name wraps without breaking the layout", async ({ page }) => {
    const b = await makeBusiness("barber");
    const longName = "מספרת " + "הדרךהארוכהביותרשאפשרלהמציאבלירווחים".repeat(2);
    expect((await b.db.from("businesses").update({ name: longName }).eq("id", b.id)).error).toBeNull();
    await page.goto(`/book/${b.slug}`);
    await expect(page.getByTestId("business-name")).toBeVisible();
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
  });

  test("touch targets on the real page are at least 44px", async ({ page }) => {
    const b = await makeBusiness("barber");
    await page.goto(`/book/${b.slug}`);
    const h = async (l: ReturnType<Page["locator"]>) => (await l.boundingBox())!.height;
    expect(await h(page.getByTestId(`service-${b.services[0].id}`).locator("xpath=ancestor::label"))).toBeGreaterThanOrEqual(44);
    expect(await h(page.getByTestId("continue"))).toBeGreaterThanOrEqual(44);
  });
});

test.describe("customer's private link (/booking/[token])", () => {
  async function bookedWithLink(page: Page, b?: TestBusiness) {
    const biz = b ?? (await makeBusiness("barber"));
    if (!b) sql(`update public.businesses set cancel_until_hours = 0 where id='${biz.id}'`); // evening runs: the first free time is tomorrow morning, inside the default 24h cancel/reschedule window, so the customer-side buttons would be missing
    const slot = await book(page, biz);
    const link = await page.getByTestId("manage-link").getAttribute("href");
    return { biz, slot, link: link! };
  }

  test("link shows the appointment; a GET changes nothing; cancel is a confirmed POST that frees the slot", async ({ page }) => {
    const { biz, slot, link } = await bookedWithLink(page);
    expect(link).toMatch(/^\/booking\/[\w.-]+$/);
    const before = (await biz.db.from("appointments").select("status").eq("business_id", biz.id)).data![0].status;
    const res = await page.goto(link);
    await page.reload();
    await page.reload();
    expect(res?.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByTestId("manage-status")).toHaveText("מאושר");
    await expect(page.getByTestId("manage-reference")).toBeVisible();
    expect((await biz.db.from("appointments").select("status").eq("business_id", biz.id)).data![0].status).toBe(before); // GET ×3: still the same
    await noOverflow(page);
    await expect(page).toHaveTitle(/.+/); // the title is streamed with the page: axe must not run before it has arrived
    expect((await axe(page)).violations).toEqual([]);

    await page.getByTestId("cancel-start").click();
    expect((await biz.db.from("appointments").select("status").eq("business_id", biz.id)).data![0].status).toBe(before); // asking is not cancelling
    await page.getByTestId("cancel-confirm").click();
    await expect(page.getByTestId("manage-cancelled")).toBeVisible();
    expect((await biz.db.from("appointments").select("status").eq("business_id", biz.id)).data![0].status).toBe("cancelled_by_customer");
    await noOverflow(page);
    await expect(page).toHaveTitle(/.+/); // the title is streamed with the page: axe must not run before it has arrived
    expect((await axe(page)).violations).toEqual([]);

    // the slot is free again for someone else
    await page.goto(`/book/${biz.slug}`);
    await page.getByTestId(`service-${biz.services[0].id}`).check({ force: true });
    await page.getByTestId("continue").click();
    const d = page.getByTestId(`day-${slot.date}`);
    await expect(d).toBeEnabled();
    await d.check({ force: true });
    await page.getByTestId("continue").click();
    await expect(page.getByTestId(`time-${slot.time}`)).toBeAttached();

    // opening the link again later shows the cancelled state, with no way to cancel twice
    await page.goto(link);
    await expect(page.getByTestId("manage-cancelled")).toBeVisible();
    await expect(page.getByTestId("cancel-start")).toHaveCount(0);
  });

  test("forged, tampered, truncated and garbage tokens all show the same generic page and reveal nothing", async ({ page }) => {
    const { link } = await bookedWithLink(page);
    const token = link.split("/").pop()!;
    const bad = [token.slice(0, -3) + "AAA", token.slice(0, 20), "x", "a.b.c", encodeURIComponent("<script>alert(1)</script>"), token.split(".")[0] + ".AAAA"];
    const texts: string[] = [];
    for (const t of bad) {
      await page.goto(`/booking/${t}`);
      await expect(page.getByTestId("manage-invalid")).toBeVisible();
      texts.push((await page.getByTestId("manage-invalid").innerText()).trim());
      await expect(page.getByTestId("manage-reference")).toHaveCount(0);
    }
    expect(new Set(texts).size).toBe(1);
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
  });

  test("cancelling twice is harmless: replaying the server action after cancelling changes nothing", async ({ page }) => {
    const { biz, link } = await bookedWithLink(page);
    await page.goto(link);
    const posts: { url: string; headers: Record<string, string>; body: string }[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST") posts.push({ url: r.url(), headers: r.headers(), body: r.postData() ?? "" });
    });
    await page.getByTestId("cancel-start").click();
    await page.getByTestId("cancel-confirm").click();
    await expect(page.getByTestId("manage-cancelled")).toBeVisible();
    expect(posts.length).toBeGreaterThan(0);
    const events = async () => (await biz.db.from("appointments").select("status, updated_at").eq("business_id", biz.id)).data![0];
    const before = await events();
    const r = await page.request.post(posts[0].url, { headers: { ...posts[0].headers, "content-length": undefined as never }, data: posts[0].body });
    expect(r.status()).toBeLessThan(500);
    const after = await events();
    expect(after).toEqual(before); // nothing changed by the replay
  });

  test("a request from a foreign Origin cannot cancel (Server Action CSRF check)", async ({ page }) => {
    const { biz, link } = await bookedWithLink(page);
    await page.goto(link);
    const posts: { url: string; headers: Record<string, string>; body: string }[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST") posts.push({ url: r.url(), headers: r.headers(), body: r.postData() ?? "" });
    });
    // capture the action request, but stop it before it reaches the server
    await page.route("**/book/**", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
    await page.getByTestId("cancel-start").click();
    await page.getByTestId("cancel-confirm").click();
    await expect.poll(() => posts.length).toBeGreaterThan(0);
    await page.unroute("**/book/**");
    const p = posts[0];
    const forged = await page.request.post(p.url, { headers: { ...p.headers, origin: "https://evil.example", "content-length": undefined as never }, data: p.body });
    expect(forged.status()).toBeGreaterThanOrEqual(400);
    expect((await biz.db.from("appointments").select("status").eq("business_id", biz.id)).data![0].status).toBe("confirmed");
  });

  test("inside the cancellation window the page explains that cancelling is no longer possible", async ({ page }) => {
    const b = await makeBusiness("barber");
    expect((await b.db.from("businesses").update({ cancel_until_hours: 720 }).eq("id", b.id)).error).toBeNull();
    const { link } = await bookedWithLink(page, b);
    await page.goto(link);
    await expect(page.getByTestId("manage-too-late")).toBeVisible();
    await expect(page.getByTestId("cancel-start")).toHaveCount(0);
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
  });

  test("the page does not leak the token through Referer and is not indexable", async ({ page }) => {
    const { link } = await bookedWithLink(page);
    await page.goto(link);
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute("content", "no-referrer");
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  });
});
