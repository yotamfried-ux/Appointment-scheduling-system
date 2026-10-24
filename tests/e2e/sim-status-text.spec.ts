import { expect, test } from "@playwright/test";
import * as C from "../../lib/api/contracts";
import { fakeIp, firstDayWithSlots, loginAs, makeBusiness, publicBook, sql, todayLocal } from "./helpers/business";
import { fillDay } from "./helpers/sim";

// SIM 8 · Status never rests on colour alone: every state on the owner's day schedule, in the booking time picker and on the waitlist day chips has a visible word.
// Old behaviour guarded against: a coloured badge / segment / chip with the word missing (or only in a screen-reader-only span).
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");

const LABEL: Record<string, string> = {
  confirmed: "מאושר",
  pending: "ממתין לאישור",
  completed: "הושלם",
  noShow: "לא הגיע/ה",
  cancellationRequested: "בקשת ביטול",
};
const DB: Record<string, string> = { confirmed: "confirmed", pending: "pending", completed: "completed", noShow: "no_show", cancellationRequested: "cancellation_requested" };

test("owner day schedule: every appointment status and every free gap carries a visible word", async ({ page, request }) => {
  const b = await makeBusiness("barber");
  const f = await firstDayWithSlots(request, b);
  const ids: Record<string, string> = {};
  const order = Object.keys(LABEL);
  for (const [i, st] of order.entries()) ids[st] = (await publicBook(request, b, f.date, f.times[i * 3], 20 + i)).id;
  for (const st of order) sql(`set session_replication_role = replica; update public.appointments set status = '${DB[st]}' where id = '${ids[st]}'; set session_replication_role = origin;`);

  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  await page.getByTestId("day-input").fill(f.date);
  await expect(page.getByTestId("schedule")).toBeVisible();
  for (const st of order) {
    const row = page.getByTestId(`row-${ids[st]}`);
    await expect(row, st).toHaveAttribute("data-status", st);
    const badge = row.locator(`[data-status="${st}"]`).filter({ hasText: LABEL[st] });
    await expect(badge, `${st} shows "${LABEL[st]}"`).toBeVisible();
    // visible text, not a screen-reader-only span
    expect(await badge.evaluate((el) => { const r = el.getBoundingClientRect(); return r.width > 8 && r.height > 8 && getComputedStyle(el).fontSize !== "0px"; }), st).toBe(true);
  }
  // free gaps say "פנוי" in words
  const gaps = page.locator('[data-testid^="gap-"]');
  expect(await gaps.count()).toBeGreaterThan(0);
  for (const g of await gaps.all()) await expect(g).toContainText("פנוי");
  // generic: no schedule row without a status word
  for (const row of await page.locator('[data-testid^="row-"][data-status]').all()) {
    const st = (await row.getAttribute("data-status"))!;
    await expect(row.locator(`[data-status="${st}"]`)).not.toHaveText("");
  }
});

test("booking time picker: the free / taken parts of the day are named in words, not just coloured", async ({ page, request }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() });
  const b = await makeBusiness("barber");
  const f = await firstDayWithSlots(request, b);
  await publicBook(request, b, f.date, f.times[2], 30); // something taken, so both states exist
  await page.goto(`/book/${b.slug}`);
  await page.getByTestId(`service-${b.services[0].id}`).check({ force: true });
  await page.getByTestId("continue").click();
  await expect(page.getByTestId(`day-${f.date}`)).toBeEnabled(); // the days are enabled once their availability has loaded
  await page.getByTestId(`day-${f.date}`).check({ force: true });
  await page.getByTestId("continue").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("באיזו שעה?");
  const figure = page.locator("figure").first();
  await expect(figure.getByText("פנוי", { exact: true })).toBeVisible();
  await expect(figure.getByText("תפוס", { exact: true })).toBeVisible();
  const label = (await figure.getByRole("img").getAttribute("aria-label")) ?? "";
  expect(label).toContain("פנוי");
  expect(label).toContain("תפוס");
  // every time chip is a real word-and-number, never an unlabeled swatch
  for (const chip of await page.locator('input[name="time"]').all()) expect((await chip.getAttribute("value")) ?? "").toMatch(/^\d{2}:\d{2}$/);
});

test("waitlist day chips: a full day says מלא, a day with room says יש תורים פנויים", async ({ page, request }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() });
  const b = await makeBusiness("barber");
  const av = C.AvailabilityResponse.parse(await (await request.get(`/api/public/${b.slug}/availability?service=${b.services[0].id}&from=${todayLocal(1)}&days=30`)).json());
  const open = av.days.filter((d) => !d.closed && d.freeSlots > 0).map((d) => d.date);
  await fillDay(request, b, open[0], 2000);
  await page.goto(`/book/${b.slug}/waitlist?service=${b.services[0].id}`);
  await expect(page.getByTestId("wl-days")).toBeVisible();
  const chips = page.locator('label:has(input[data-testid^="wl-day-"])');
  await expect(chips.first()).toBeAttached(); // the list loads after the fieldset appears
  expect(await chips.count()).toBeGreaterThan(3);
  for (const chip of await chips.all()) {
    const date = (await chip.locator("input").getAttribute("data-testid"))!.replace("wl-day-", "");
    await expect(chip, date).toContainText(date === open[0] ? "מלא" : "יש תורים פנויים");
  }
});
