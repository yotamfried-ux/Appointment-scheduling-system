import { expect, test } from "@playwright/test";
import { loginAs, makeBusiness } from "./helpers/business";
import { noOverflow } from "./helpers/sim";

// SIM 1 · The owner's working pages use the width of a big screen (no wide empty gutters) and never scroll sideways on a phone.
// Old behaviour: the pages were a narrow column (max-w-2xl .. 5xl) in the middle of a 1600px screen.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");

const PAGES = ["/dashboard", "/customers", "/reports"];

test("on a 1600px screen the owner pages use the width", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "a wide-screen simulation");
  const b = await makeBusiness("barber");
  await page.setViewportSize({ width: 1600, height: 900 });
  await loginAs(page, b.ownerEmail);
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator("main#main")).toBeVisible();
    const m = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>("main#main")!;
      const cs = getComputedStyle(main);
      const box = main.getBoundingClientRect();
      const inner = box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const kids = [...main.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
      const span = Math.max(...kids.map((r) => r.right)) - Math.min(...kids.map((r) => r.left));
      return { vw: document.documentElement.clientWidth, gutters: parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), inner, span, left: box.left, right: document.documentElement.clientWidth - box.right };
    });
    const usable = m.vw - m.gutters;
    expect(m.inner, `${path}: main content ${m.inner}px of ${usable}px`).toBeGreaterThanOrEqual(0.85 * usable);
    expect(m.span, `${path}: the content blocks span ${m.span}px of ${usable}px`).toBeGreaterThanOrEqual(0.85 * usable);
    expect(Math.abs(m.left - m.right), `${path}: centred`).toBeLessThanOrEqual(2);
    await noOverflow(page, path);
  }
});

test("at 360px the owner pages never overflow and the navigation fits", async ({ page }) => {
  const b = await makeBusiness("barber");
  await page.setViewportSize({ width: 360, height: 740 });
  await loginAs(page, b.ownerEmail);
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator("main#main")).toBeVisible();
    await noOverflow(page, path);
    const items = await page.getByRole("navigation", { name: "ניווט ראשי" }).getByRole("link").all(); // every nav entry stays on the screen
    for (const it of items) {
      const r = (await it.boundingBox())!;
      expect(r.x, `${path}: nav entry left edge`).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width, `${path}: nav entry right edge`).toBeLessThanOrEqual(360);
    }
  }
});
