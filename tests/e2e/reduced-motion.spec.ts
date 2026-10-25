import { expect, test, type Page } from "@playwright/test";
import { formatDayLabel } from "../../lib/lab/booking-data";
import { firstDayWithSlots, loginAs, makeBusiness, todayLocal } from "./helpers/business";

// Motion library (MOTION-AND-INTERACTIONS): with the visitor's "reduce motion" setting nothing may animate for longer than an instant (no auto-playing movement),
// and the same pages still work. Without the setting, the page may animate (the control proves the check can see animations).
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase");
test.use({ reducedMotion: "reduce" });

const running = (page: Page) =>
  page.evaluate(() =>
    document.getAnimations().filter((a) => {
      const t = a.effect?.getComputedTiming();
      return a.playState === "running" && t && Number(t.activeDuration) > 100;
    }).map((a) => String((a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? "?")),
  );

async function openWorkingAgenda(page: Page, date: string) {
  await page.goto("/dashboard");
  const agenda = page.getByTestId("agenda");
  await agenda.waitFor();
  await page.getByTestId("day-input").fill(date);
  // The heading is rendered from loaded agenda.date, unlike the input's immediate DOM value.
  await expect(agenda.getByTestId("agenda-title")).toHaveText(formatDayLabel(date));
  await expect(page.getByTestId("day-input")).toHaveValue(date);
  await expect(agenda.getByRole("img").filter({ has: page.locator(".ribbon-free") })).toBeVisible();
}

test("reduce motion: public pages, booking flow and the owner agenda run no animation longer than an instant", async ({ page, request }) => {
  for (const path of ["/", "/auth/login", "/auth/sign-up", "/privacy"]) {
    await page.goto(path);
    await page.waitForTimeout(700);
    expect(await running(page), path).toEqual([]);
  }
  const b = await makeBusiness("barber");
  const { date } = await firstDayWithSlots(request, b);
  await page.goto(`/book/${b.slug}`);
  await page.locator('input[name="service"]').first().check({ force: true });
  await page.getByTestId("continue").click();
  await page.waitForTimeout(700);
  expect(await running(page), "booking: day step").toEqual([]);
  await loginAs(page, b.ownerEmail);
  await openWorkingAgenda(page, date);
  await page.waitForTimeout(900);
  expect(await running(page), "owner agenda").toEqual([]);
});

test("a closed Saturday has no ribbon; an explicitly open date renders it", async ({ page, request }) => {
  const b = await makeBusiness("barber");
  const { date: openDate } = await firstDayWithSlots(request, b);
  const saturday = new Date(`${todayLocal(2)}T12:00:00Z`);
  saturday.setUTCDate(saturday.getUTCDate() + (6 - saturday.getUTCDay() + 7) % 7);
  const closedDate = saturday.toISOString().slice(0, 10);
  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  const agenda = page.getByTestId("agenda");
  await agenda.waitFor();
  await page.getByTestId("day-input").fill(closedDate);
  await expect(agenda.getByTestId("agenda-title")).toHaveText(formatDayLabel(closedDate));
  await expect(page.getByTestId("day-input")).toHaveValue(closedDate);
  await expect(agenda.getByTestId("closed-today")).toBeVisible();
  await expect(agenda.getByRole("img")).toHaveCount(0);
  await openWorkingAgenda(page, openDate);
  expect(await running(page), "open agenda with reduced motion").toEqual([]);
});

test.describe("control (negative)", () => {
  test.use({ reducedMotion: "no-preference" });
  test("without the setting the owner agenda does animate (so the reduce-motion check above can fail)", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const { date } = await firstDayWithSlots(request, b);
    await loginAs(page, b.ownerEmail);
    await page.addInitScript((targetLabel: string) => {
      (window as unknown as { __seen: number }).__seen = 0;
      const tick = () => {
        const loadedDay = document.querySelector('[data-testid="agenda-title"]')?.textContent?.trim();
        const n = loadedDay === targetLabel
          ? document.getAnimations().filter((a) => Number(a.effect?.getComputedTiming().activeDuration) > 100).length
          : 0;
        (window as unknown as { __seen: number }).__seen = Math.max((window as unknown as { __seen: number }).__seen, n);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, formatDayLabel(date));
    await openWorkingAgenda(page, date);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __seen: number }).__seen), {
      message: "the selected open day's real ribbon must animate without reduced motion",
    }).toBeGreaterThan(0);
  });
});
