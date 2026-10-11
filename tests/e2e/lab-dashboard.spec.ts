import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import * as C from "../../lib/api/contracts";
import { BUSINESS_KINDS, KIND_IDS, type BusinessKindId } from "../../modules/tenancy/business-kind";

// Owner persona on the dashboard, wired to the lab API. The API is the source of truth: every UI action is checked
// against what the API reports afterwards. Scenarios: BKG-09 (approval), CXL-03, AVL (gaps), UX, state-machine guards.

const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
const sid = () => `d${Math.random().toString(36).slice(2, 10)}`;
const hdr = (session: string) => ({ "x-lab-session": session });
const open = (page: Page, kind: BusinessKindId, session: string) => page.goto(`/design/dashboard?kind=${kind}&session=${session}`);

async function agenda(page: Page, kind: BusinessKindId, session: string) {
  const r = await page.request.get(`/api/lab/${kind}/appointments`, { headers: hdr(session) });
  expect(r.status()).toBe(200);
  return C.AppointmentsResponse.parse(await r.json());
}
const byStatus = (a: Awaited<ReturnType<typeof agenda>>, status: string) => a.appointments.find((x) => x.status === status)!;

for (const kind of KIND_IDS) {
  const k = BUSINESS_KINDS[kind];
  test.describe(`dashboard · ${kind}`, () => {
    test("renders the API agenda: accessible, no overflow, stats and ribbon consistent with the data", async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (m) => (m.type() === "error" ? errors.push(m.text()) : undefined));
      page.on("pageerror", (e) => errors.push(e.message));
      const session = sid();
      await open(page, kind, session);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("יום רביעי, 14 באוקטובר");
      await expect(page.getByTestId("dash-business")).toHaveText(k.sample.businessName);
      const a = await agenda(page, kind, session);

      // Every appointment the API returned is a row; nothing invented.
      for (const x of a.appointments.filter((x) => x.status !== "cancelled")) await expect(page.getByTestId(`row-${x.id}`)).toHaveAttribute("data-status", x.status);
      const active = a.appointments.filter((x) => x.status !== "cancelled").length;
      await expect(page.getByText("תורים היום").locator("xpath=following-sibling::dd")).toContainText(String(active));
      const needs = a.appointments.filter((x) => x.status === "pending" || x.status === "cancellationRequested").length;
      await expect(page.getByTestId("approvals-count")).toHaveText(String(needs));
      expect(needs, "seed must demonstrate approvals for every kind").toBeGreaterThan(0);

      // Working windows: split-day kinds show a closed segment in the ribbon's text alternative.
      const label = await page.locator('[role="img"][aria-label*="פנוי"]').first().getAttribute("aria-label");
      if (a.windows.length > 1) expect(label).toContain("סגור");
      await noOverflow(page);
      expect((await axe(page)).violations.map((v) => `${v.id} (${v.nodes.length})`)).toEqual([]);
      expect(errors, errors.join("\n")).toEqual([]);
    });

    test("approving a pending request: UI and API agree on the new state", async ({ page }) => {
      const session = sid();
      await open(page, kind, session);
      const p = byStatus(await agenda(page, kind, session), "pending");
      await page.getByRole("button", { name: `אישור · ${p.customer}` }).click();
      await expect(page.getByRole("status").filter({ hasText: "התור אושר" })).toBeVisible();
      await expect(page.getByTestId(`row-${p.id}`)).toHaveAttribute("data-status", "confirmed");
      await expect(page.getByTestId(`approval-${p.id}`)).toHaveCount(0);
      expect((await agenda(page, kind, session)).appointments.find((x) => x.id === p.id)!.status).toBe("confirmed");
    });

    test("rejecting frees the time (a gap with an action) and the API agrees", async ({ page }) => {
      const session = sid();
      await open(page, kind, session);
      const p = byStatus(await agenda(page, kind, session), "pending");
      const freeStat = page.getByText("שעות פנויות").locator("xpath=following-sibling::dd");
      const minutes = async () => {
        const [h, m] = (await freeStat.innerText()).match(/\d+:\d+/)![0].split(":").map(Number);
        return h * 60 + m;
      };
      const before = await minutes();
      await page.getByRole("button", { name: `דחייה · ${p.customer}` }).click();
      await expect(page.getByTestId(`row-${p.id}`)).toHaveCount(0);
      await expect(page.locator('[data-testid^="gap-"]').first().getByRole("button", { name: "הוספת תור" })).toBeVisible();
      // The freed time is counted as free (a pocket under 30 minutes is not a bookable gap, so only assert growth when it fits).
      await expect.poll(minutes).toBeGreaterThanOrEqual(before);
      if (p.end - p.start >= 30) await expect.poll(minutes).toBeGreaterThan(before);
      expect((await agenda(page, kind, session)).appointments.find((x) => x.id === p.id)!.status).toBe("cancelled");
    });

    test("handling every request shows the calm empty state", async ({ page }) => {
      const session = sid();
      await open(page, kind, session);
      const a = await agenda(page, kind, session);
      for (const x of a.appointments.filter((x) => x.status === "pending")) await page.getByRole("button", { name: `אישור · ${x.customer}` }).click();
      for (const x of a.appointments.filter((x) => x.status === "cancellationRequested")) await page.getByRole("button", { name: `להשאיר את התור · ${x.customer}` }).click();
      await expect(page.getByTestId("approvals-empty")).toBeVisible();
      await expect(page.getByTestId("approvals-count")).toHaveText("0");
      const after = await agenda(page, kind, session);
      expect(after.appointments.some((x) => x.status === "pending" || x.status === "cancellationRequested")).toBe(false);
    });
  });
}

test.describe("dashboard · failures and races", () => {
  test("server error on approve rolls the row back and tells the owner", async ({ page }) => {
    const session = sid();
    await open(page, "barber", session);
    const p = byStatus(await agenda(page, "barber", session), "pending");
    await page.route("**/appointments/*/transition", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "INTERNAL", message: "x", requestId: "r" } }) }));
    await page.getByRole("button", { name: `אישור · ${p.customer}` }).click();
    await expect(page.getByRole("status").filter({ hasText: "הפעולה לא הושלמה" })).toBeVisible();
    await expect(page.getByTestId(`row-${p.id}`)).toHaveAttribute("data-status", "pending"); // rolled back to server truth
    await expect(page.getByTestId(`approval-${p.id}`)).toBeVisible();
    expect((await agenda(page, "barber", session)).appointments.find((x) => x.id === p.id)!.status).toBe("pending");
  });

  test("double click sends one request", async ({ page }) => {
    const session = sid();
    await open(page, "barber", session);
    const before = await agenda(page, "barber", session);
    const p = byStatus(before, "pending");
    const others = before.appointments.filter((x) => x.status === "pending" && x.id !== p.id);
    expect(others.length, "needs a second pending request to prove the next person is not affected").toBeGreaterThan(0);
    let posts = 0;
    await page.route("**/appointments/*/transition", async (route) => {
      posts++;
      await new Promise((r) => setTimeout(r, 300));
      return route.continue();
    });
    const btn = page.getByRole("button", { name: `אישור · ${p.customer}` });
    await btn.dblclick();
    await expect(page.getByTestId(`row-${p.id}`)).toHaveAttribute("data-status", "confirmed");
    expect(posts).toBe(1);
    const after = await agenda(page, "barber", session);
    for (const o of others) expect(after.appointments.find((x) => x.id === o.id)!.status).toBe("pending"); // nobody else was approved by accident
  });

  test("another device already handled it: stale action shows a message and the UI refreshes to the truth", async ({ page }) => {
    const session = sid();
    await open(page, "barber", session);
    const p = byStatus(await agenda(page, "barber", session), "pending");
    await expect(page.getByRole("button", { name: `אישור · ${p.customer}` })).toBeVisible(); // the UI has loaded this state
    // Meanwhile (other tab/device) the same request is rejected.
    const r = await page.request.post(`/api/lab/barber/appointments/${p.id}/transition`, { headers: hdr(session), data: { action: "reject" } });
    expect(r.status()).toBe(200);
    await page.getByRole("button", { name: `אישור · ${p.customer}` }).click();
    await expect(page.getByRole("status").filter({ hasText: "התור כבר השתנה" })).toBeVisible();
    await expect(page.getByTestId(`row-${p.id}`)).toHaveCount(0); // refreshed: it is cancelled
    expect((await agenda(page, "barber", session)).appointments.find((x) => x.id === p.id)!.status).toBe("cancelled");
  });

  test("agenda failing shows a retry that recovers", async ({ page }) => {
    let n = 0;
    await page.route("**/api/lab/barber/appointments", (route) => (++n === 1 ? route.abort("failed") : route.continue()));
    await open(page, "barber", sid());
    await expect(page.getByTestId("dash-load-error")).toBeVisible();
    expect((await axe(page)).violations).toEqual([]);
    await page.getByRole("button", { name: "ניסיון חוזר" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("יום רביעי, 14 באוקטובר");
  });
});

test.describe("booking ↔ dashboard integration", () => {
  test("a customer booking on an approval kind appears as a pending request; approving it confirms it for the customer", async ({ page }) => {
    const kind: BusinessKindId = "clinic";
    const session = sid();
    // Customer books today (after "now") through the API.
    const slots = C.SlotsResponse.parse(await (await page.request.get(`/api/lab/${kind}/slots?service=short&date=2026-10-14`, { headers: hdr(session) })).json());
    expect(slots.slots.length).toBeGreaterThan(0);
    const time = slots.slots[0].time;
    const created = await page.request.post(`/api/lab/${kind}/bookings`, {
      headers: { ...hdr(session), "idempotency-key": "int-1" },
      data: { serviceId: "short", date: "2026-10-14", time, location: "business", customer: { fullName: "מאיה אלון", phone: "050-1234567" }, intake: {} },
    });
    expect(created.status()).toBe(201);
    const booking = C.CreateBookingResponse.parse(await created.json()).booking;
    expect(booking.status).toBe("pending");

    // Owner sees it, with the customer's name and the requested time.
    await open(page, kind, session);
    await expect(page.getByTestId(`approval-${booking.id}`)).toContainText("מאיה אלון");
    await expect(page.getByTestId(`approval-${booking.id}`)).toContainText(time);
    await page.getByRole("button", { name: "אישור · מאיה אלון" }).click();
    await expect(page.getByTestId(`row-${booking.id}`)).toHaveAttribute("data-status", "confirmed");
    expect((await agenda(page, kind, session)).appointments.find((x) => x.id === booking.id)!.status).toBe("confirmed");
  });
});
