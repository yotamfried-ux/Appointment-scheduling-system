import { expect, test, type Page } from "@playwright/test";
import { loginAs, makeBusiness } from "./helpers/business";

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

test("reduce motion: public pages, booking flow and the owner agenda run no animation longer than an instant", async ({ page }) => {
  for (const path of ["/", "/auth/login", "/auth/sign-up", "/privacy"]) {
    await page.goto(path);
    await page.waitForTimeout(700);
    expect(await running(page), path).toEqual([]);
  }
  const b = await makeBusiness("barber");
  await page.goto(`/book/${b.slug}`);
  await page.locator('input[name="service"]').first().check({ force: true });
  await page.getByTestId("continue").click();
  await page.waitForTimeout(700);
  expect(await running(page), "booking: day step").toEqual([]);
  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  await page.getByTestId("agenda").waitFor();
  await page.waitForTimeout(900);
  expect(await running(page), "owner agenda").toEqual([]);
});

test.describe("control (negative)", () => {
  test.use({ reducedMotion: "no-preference" });
  test("without the setting the owner agenda does animate (so the reduce-motion check above can fail)", async ({ page }) => {
    const b = await makeBusiness("barber");
    await loginAs(page, b.ownerEmail);
    await page.addInitScript(() => {
      (window as unknown as { __seen: number }).__seen = 0;
      const tick = () => {
        const n = document.getAnimations().filter((a) => Number(a.effect?.getComputedTiming().activeDuration) > 100).length;
        (window as unknown as { __seen: number }).__seen = Math.max((window as unknown as { __seen: number }).__seen, n);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.goto("/dashboard");
    await page.getByTestId("agenda").waitFor();
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => (window as unknown as { __seen: number }).__seen)).toBeGreaterThan(0);
  });
});
