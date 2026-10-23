import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import * as C from "../../lib/api/contracts";
import { BUSINESS_KINDS, KIND_IDS, type BusinessKindId } from "../../modules/tenancy/business-kind";

// UI ↔ API integration across business kinds: the UI is driven like a customer, the API is asserted as the source of truth.
// Fidelity note: the lab API uses an in-memory store (not Postgres); DB-level concurrency is proven in stages 2–4.

const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const sid = () => `e2e${Math.random().toString(36).slice(2, 10)}`;
const open = (page: Page, kind: BusinessKindId, session: string, extra = "") => page.goto(`/design/booking?kind=${kind}&session=${session}${extra}`);
const hdr = (session: string) => ({ "x-lab-session": session });
const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

async function apiSlots(page: Page, kind: BusinessKindId, session: string, service: string, date: string) {
  const r = await page.request.get(`/api/lab/${kind}/slots?service=${service}&date=${date}`, { headers: hdr(session) });
  expect(r.status()).toBe(200);
  return C.SlotsResponse.parse(await r.json());
}

/** Walk service → day → time and return what was chosen. */
async function chooseSlot(page: Page, serviceId: string, opts: { time?: string } = {}) {
  await page.getByTestId(`service-${serviceId}`).check({ force: true });
  await page.getByTestId("continue").click();
  await page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
  const date = await page.locator('input[name="day"]:checked').getAttribute("data-testid").then((x) => x!.replace("day-", ""));
  await page.getByTestId("continue").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("באיזו שעה?");
  const chip = opts.time ? page.getByTestId(`time-${opts.time}`) : page.locator('input[name="time"]').first();
  await chip.check({ force: true });
  const time = (await chip.getAttribute("value"))!;
  await page.getByTestId("continue").click();
  return { date, time };
}

async function fillDetails(page: Page, kind: BusinessKindId, over: { phone?: string; email?: string } = {}) {
  await page.getByLabel("שם מלא").fill("נועם לוי");
  await page.getByLabel("טלפון נייד").fill(over.phone ?? "050-1234567");
  await page.getByLabel("אימייל").fill(over.email ?? "noam@example.com");
  for (const f of BUSINESS_KINDS[kind].intake.filter((x) => x.required)) {
    const el = page.getByTestId(`intake-${f.id}`);
    if (f.type === "select") await el.selectOption(f.options![0]);
    else await el.fill("דוגמה");
  }
}

for (const kind of KIND_IDS) {
  const k = BUSINESS_KINDS[kind];
  test.describe(`kind · ${kind}`, () => {
    test("UI shows the kind's vocabulary/services from the API and completes a booking the API confirms", async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (m) => (m.type() === "error" ? errors.push(m.text()) : undefined));
      page.on("pageerror", (e) => errors.push(e.message));
      const session = sid();
      await open(page, kind, session);

      // Vocabulary + catalogue come from the API
      await expect(page.getByTestId("business-name")).toHaveText(k.sample.businessName);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(k.vocab.pickService);
      for (const p of k.presets) await expect(page.getByTestId(`service-${p.id}`)).toHaveCount(1);
      await expect(page.locator('input[name="service"]')).toHaveCount(k.presets.length);
      await noOverflow(page);
      expect((await axe(page)).violations).toEqual([]);

      const solo = k.presets.find((p) => !p.group)!;
      const booking = page.waitForResponse((r) => r.url().includes(`/api/lab/${kind}/bookings`) && r.request().method() === "POST");
      const picked = await (async () => {
        await page.getByTestId(`service-${solo.id}`).check({ force: true });
        await page.getByTestId("continue").click();
        await expect(page.getByRole("heading", { level: 1 })).toHaveText("באיזה יום?");
        await page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
        const date = (await page.locator('input[name="day"]:checked').getAttribute("data-testid"))!.replace("day-", "");
        await page.getByTestId("continue").click();

        // The times the UI offers are exactly the ones the API says are free (no UI-side invention).
        const api = await apiSlots(page, kind, session, solo.id, date);
        const shown = await page.locator('input[name="time"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
        expect(shown).toEqual(api.slots.map((s) => s.time));
        if (k.hours[1].length > 1) expect(api.windows.length).toBe(k.hours[1].length);
        await expect(page.getByRole("img", { name: /זמינות/ })).toBeVisible();
        expect((await axe(page)).violations).toEqual([]);

        const time = shown[0];
        await page.getByTestId(`time-${time}`).check({ force: true });
        await page.getByTestId("continue").click();
        return { date, time };
      })();

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("כמעט סיימנו");
      for (const f of k.intake) await expect(page.getByTestId(`intake-${f.id}`)).toHaveCount(1);
      if (k.locations.length > 1) await expect(page.locator('input[name="location"]')).toHaveCount(k.locations.length);
      await noOverflow(page);
      expect((await axe(page)).violations).toEqual([]);
      await fillDetails(page, kind);
      await page.getByTestId("continue").click();

      const res = await booking;
      expect(res.status()).toBe(201);
      const dto = C.CreateBookingResponse.parse(await res.json()).booking;
      expect(dto.date).toBe(picked.date);
      expect(dto.time).toBe(picked.time);
      expect(dto.status).toBe(k.defaults.requireApproval ? "pending" : "confirmed");

      await expect(page.getByTestId("done-title")).toHaveText(k.defaults.requireApproval ? "הבקשה התקבלה" : k.vocab.doneTitle);
      await expect(page.getByTestId("done-reference")).toHaveText(dto.reference);
      await expect(page.getByTestId("done-status")).toHaveText(k.defaults.requireApproval ? "ממתין לאישור" : "מאושר");
      await noOverflow(page);
      expect((await axe(page)).violations).toEqual([]);

      // Side effect is real: the slot is gone from the API, and the owner agenda (for that day) would see it.
      const after = await apiSlots(page, kind, session, solo.id, picked.date);
      expect(after.slots.map((s) => s.time)).not.toContain(picked.time);

      // Notification privacy (docs/05 §2): sensitive kinds never name the service in the email.
      await page.getByText("ההודעה שנשלחה אליכם").click();
      const body = await page.getByTestId("email-body").innerText();
      if (k.privacy.hideServiceNameInMessages) expect(body).not.toContain(solo.name);
      else expect(body).toContain(solo.name);
      for (const f of k.intake) for (const o of f.options ?? []) expect(body).not.toContain(o);

      expect(errors, errors.join("\n")).toEqual([]);
    });
  });
}

test.describe("group sessions (trainer)", () => {
  test("chips show seats left and the count drops after a booking", async ({ page }) => {
    const session = sid();
    await open(page, "trainer", session);
    await page.getByTestId("service-group").check({ force: true });
    await page.getByTestId("continue").click();
    await page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
    const date = (await page.locator('input[name="day"]:checked').getAttribute("data-testid"))!.replace("day-", "");
    await page.getByTestId("continue").click();
    const api = await apiSlots(page, "trainer", session, "group", date);
    expect(api.slots.length).toBeGreaterThan(0);
    const first = api.slots[0];
    await expect(page.getByTestId(`left-${first.time}`)).toContainText(String(first.spotsLeft));
    await page.getByTestId(`time-${first.time}`).check({ force: true });
    await page.getByTestId("continue").click();
    await fillDetails(page, "trainer");
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("done-title")).toBeVisible();
    const after = await apiSlots(page, "trainer", session, "group", date);
    expect(after.slots.find((s) => s.time === first.time)?.spotsLeft).toBe(first.spotsLeft! - 1);
  });
});

test.describe("concurrency", () => {
  async function arriveAtDetails(ctx: BrowserContext, kind: BusinessKindId, session: string, time?: string) {
    const page = await ctx.newPage();
    await open(page, kind, session);
    const solo = BUSINESS_KINDS[kind].presets.find((p) => !p.group)!;
    const chosen = await chooseSlot(page, solo.id, { time });
    await fillDetails(page, kind);
    return { page, chosen };
  }

  test("two customers pick the same slot: exactly one wins, the other is told and returned to the times without the slot", async ({ browser }) => {
    const session = sid();
    const a = await browser.newContext({ locale: "he-IL", timezoneId: "Asia/Jerusalem" });
    const b = await browser.newContext({ locale: "he-IL", timezoneId: "Asia/Jerusalem" });
    const A = await arriveAtDetails(a, "barber", session);
    const B = await arriveAtDetails(b, "barber", session, A.chosen.time);
    expect(B.chosen).toEqual(A.chosen);

    // Both submit "at the same time".
    await Promise.all([A.page.getByTestId("continue").click(), B.page.getByTestId("continue").click()]);
    const outcomes = await Promise.all(
      [A.page, B.page].map(async (p) => {
        await expect(p.getByTestId("done-title").or(p.getByRole("heading", { level: 1, name: "באיזו שעה?" }))).toBeVisible();
        return (await p.getByTestId("done-title").count()) ? "won" : "lost";
      }),
    );
    expect([...outcomes].sort()).toEqual(["lost", "won"]);

    const loser = outcomes[0] === "lost" ? A.page : B.page;
    await expect(loser.getByRole("status").filter({ hasText: "השעה נתפסה" })).toHaveCount(1);
    await expect(loser.getByTestId(`time-${A.chosen.time}`)).toHaveCount(0); // fresh data: the slot is gone
    await expect(loser.getByTestId("continue")).toBeDisabled(); // must choose again
    expect((await axe(loser)).violations).toEqual([]);

    // Only one appointment exists for that slot (API as the source of truth).
    const slots = await apiSlots(loser, "barber", session, "haircut", A.chosen.date);
    expect(slots.slots.map((s) => s.time)).not.toContain(A.chosen.time);
    await a.close();
    await b.close();
  });
});

test.describe("failure handling", () => {
  test("500 then success: error is shown, details are kept, the retry reuses the Idempotency-Key and books once", async ({ page }) => {
    const session = sid();
    await open(page, "barber", session);
    const keys: string[] = [];
    let n = 0;
    await page.route("**/api/lab/barber/bookings", async (route) => {
      keys.push(route.request().headers()["idempotency-key"]);
      if (++n === 1) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "x", requestId: "req_1" } }) });
      return route.continue();
    });
    const chosen = await chooseSlot(page, "haircut");
    await fillDetails(page, "barber");
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("submit-error")).toContainText("משהו השתבש");
    await expect(page.getByLabel("שם מלא")).toHaveValue("נועם לוי"); // nothing lost
    expect((await axe(page)).violations).toEqual([]);
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("done-title")).toBeVisible();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    const slots = await apiSlots(page, "barber", session, "haircut", chosen.date);
    expect(slots.slots.map((s) => s.time)).not.toContain(chosen.time);
  });

  test("lost response (network abort): retry with the same key creates no duplicate", async ({ page }) => {
    const session = sid();
    await open(page, "barber", session);
    let n = 0;
    await page.route("**/api/lab/barber/bookings", async (route) => {
      if (++n === 1) {
        await route.fetch(); // the server DID process the first request…
        return route.abort("connectionreset"); // …but the response never arrived
      }
      return route.continue();
    });
    await chooseSlot(page, "haircut");
    await fillDetails(page, "barber");
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("submit-error")).toContainText("אין חיבור");
    await page.getByTestId("continue").click();
    // The retry is an idempotent replay of the first booking, not a SLOT_TAKEN conflict with ourselves.
    await expect(page.getByTestId("done-title")).toBeVisible();
  });

  test("server validation (422) is shown next to the field", async ({ page }) => {
    await open(page, "barber", sid());
    await page.route("**/api/lab/barber/bookings", (route) =>
      route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "x", requestId: "req_2", details: [{ field: "customer.phone", message: "מספר הטלפון אינו תקין." }] } }) }),
    );
    await chooseSlot(page, "haircut");
    await fillDetails(page, "barber");
    await page.getByTestId("continue").click();
    await expect(page.getByLabel("טלפון נייד")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("מספר הטלפון אינו תקין.")).toBeVisible();
    await expect(page.getByTestId("submit-error")).toContainText("יש לתקן");
    await page.getByLabel("טלפון נייד").fill("050-7654321"); // editing clears the server error
    await expect(page.getByLabel("טלפון נייד")).not.toHaveAttribute("aria-invalid", "true");
  });

  test("real rate limit (429): friendly message with the wait time, nothing is booked", async ({ page }) => {
    const session = sid();
    await open(page, "barber", session, "&limit=1");
    // Consume the single allowed attempt with an invalid request straight to the API.
    const used = await page.request.post("/api/lab/barber/bookings", { headers: { ...hdr(session), "idempotency-key": "burn", "x-lab-limit": "1" }, data: {} });
    expect(used.status()).toBe(422);
    const chosen = await chooseSlot(page, "haircut");
    await fillDetails(page, "barber");
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("submit-error")).toContainText("יותר מדי ניסיונות");
    const slots = await apiSlots(page, "barber", session, "haircut", chosen.date);
    expect(slots.slots.map((s) => s.time)).toContain(chosen.time);
  });

  test("slots endpoint failing shows a retryable error, then recovers", async ({ page }) => {
    await open(page, "barber", sid());
    let n = 0;
    await page.route("**/api/lab/barber/slots**", (route) => (++n === 1 ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "x", requestId: "r" } }) }) : route.continue()));
    await page.getByTestId("service-haircut").check({ force: true });
    await page.getByTestId("continue").click();
    await page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
    await page.getByTestId("continue").click();
    await expect(page.getByTestId("inline-error")).toContainText("לא הצלחנו לטעון את הזמנים");
    await page.getByRole("button", { name: "ניסיון חוזר" }).click();
    await expect(page.locator('input[name="time"]').first()).toBeAttached();
  });

  test("catalogue failing shows a full-page retry, then recovers", async ({ page }) => {
    let n = 0;
    await page.route("**/api/lab/barber/services", (route) => (++n === 1 ? route.abort("failed") : route.continue()));
    await open(page, "barber", sid());
    await expect(page.getByTestId("load-error")).toBeVisible();
    expect((await axe(page)).violations).toEqual([]);
    await page.getByRole("button", { name: "ניסיון חוזר" }).click();
    await expect(page.getByTestId("service-haircut")).toBeAttached();
  });

  test("a response that violates the contract is treated as an error, not rendered", async ({ page }) => {
    await page.route("**/api/lab/barber/services", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ kind: "barber", services: "oops" }) }));
    await open(page, "barber", sid());
    await expect(page.getByTestId("load-error")).toBeVisible();
  });

  test("unknown kind in the URL falls back to the default kind (no crash)", async ({ page }) => {
    await page.goto("/design/booking?kind=__proto__");
    await expect(page.getByTestId("business-name")).toHaveText(BUSINESS_KINDS.barber.sample.businessName);
  });
});

test.describe("details validation uses kind rules", () => {
  test("required intake blocks submission with a field error and sends nothing", async ({ page }) => {
    const kind = KIND_IDS.find((x) => BUSINESS_KINDS[x].intake.some((f) => f.required));
    test.skip(!kind, "no kind has a required intake field yet");
    const k = BUSINESS_KINDS[kind!];
    let posts = 0;
    await page.route(`**/api/lab/${kind}/bookings`, (route) => (posts++, route.continue()));
    await open(page, kind!, sid());
    await chooseSlot(page, k.presets.find((p) => !p.group)!.id);
    await page.getByLabel("שם מלא").fill("נועם לוי");
    await page.getByLabel("טלפון נייד").fill("050-1234567");
    await page.getByTestId("continue").click();
    await expect(page.getByText("שדה חובה.")).toBeVisible();
    expect(posts).toBe(0);
  });
});

test.describe("lab index kind switcher", () => {
  test("choosing a kind carries it into the booking and dashboard screens", async ({ page }) => {
    await page.goto("/design");
    await page.getByTestId("kind-clinic").click();
    await expect(page).toHaveURL(/kind=clinic/);
    await expect(page.getByTestId("kind-clinic")).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("link", { name: /הזמנה \(נייד\)/ })).toHaveAttribute("href", "/design/booking?kind=clinic");
    await page.getByRole("link", { name: /הזמנה \(נייד\)/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(BUSINESS_KINDS.clinic.vocab.pickService);
    await expect(page.getByTestId("business-name")).toHaveText(BUSINESS_KINDS.clinic.sample.businessName);
  });
});
