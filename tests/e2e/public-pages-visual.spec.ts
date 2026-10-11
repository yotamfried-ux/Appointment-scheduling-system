import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { makeBusiness } from "./helpers/business";

// Visual integrity of the public customer pages at every step: no overflow, no clipped text, WCAG 2.2 AA, centered main column.
// Screenshots go to test-results/shots for a human look (automated checks never replace looking).
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

async function check(page: Page, where: string, shot: string) {
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${where}: overflow`).toBeLessThanOrEqual(0);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main *, header *")]
      .filter((e) => !e.closest(".sr-only") && e.scrollWidth > e.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(e).overflowX) && (e.textContent ?? "").trim().length > 0 && !e.querySelector("svg, [role=img]"))
      .slice(0, 5)
      .map((e) => `${e.tagName}: "${(e.textContent ?? "").trim().slice(0, 40)}"`),
  );
  expect(clipped, `${where}: clipped text`).toEqual([]);
  const gaps = await page.evaluate(() => {
    const el = document.querySelector("main#main") as HTMLElement | null;
    if (!el?.parentElement) return null;
    const r = el.getBoundingClientRect();
    const p = el.parentElement.getBoundingClientRect();
    return { l: r.left - p.left, r: p.right - r.right };
  });
  expect(gaps, `${where}: main#main missing`).not.toBeNull();
  expect(Math.abs(gaps!.l - gaps!.r), `${where}: main off-center`).toBeLessThanOrEqual(2);
  expect((await axe(page)).violations.map((v) => `${v.id} (${v.nodes.length})`), `${where}: axe`).toEqual([]);
  await page.screenshot({ path: `test-results/shots/${shot}-${page.viewportSize()!.width}.png`, fullPage: true });
}

test("public booking pages are balanced at every step", async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` });
  const b = await makeBusiness("clinic");
  await page.goto(`/book/${b.slug}`);
  await check(page, "step 1 service", "book-1-service");
  await page.getByTestId(`service-${b.services[0].id}`).check({ force: true });
  await page.getByTestId("continue").click();
  await check(page, "step 2 day", "book-2-day");
  await page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
  await page.getByTestId("continue").click();
  await page.locator('input[name="time"]').first().check({ force: true });
  await check(page, "step 3 time", "book-3-time");
  await page.getByTestId("continue").click();
  await page.getByLabel("שם מלא").fill("נועם לוי");
  await page.getByLabel("טלפון נייד").fill("050-12");
  await page.getByTestId("continue").click(); // invalid phone → inline error
  await check(page, "step 4 details (error)", "book-4-details");
  await page.getByLabel("טלפון נייד").fill("050-1234567");
  await page.getByTestId("continue").click();
  await page.getByTestId("done-title").waitFor();
  await check(page, "done", "book-5-done");
  const link = (await page.getByTestId("manage-link").getAttribute("href"))!;
  await page.goto(link);
  await check(page, "manage", "manage-1-active");
  await page.getByTestId("cancel-start").click();
  await check(page, "manage confirm", "manage-2-confirm");
  await page.getByTestId("cancel-confirm").click();
  await page.getByTestId("manage-cancelled").waitFor();
  await check(page, "manage cancelled", "manage-3-cancelled");
  await page.goto("/booking/garbage");
  await check(page, "manage invalid", "manage-4-invalid");
  await page.goto("/book/no-such-business");
  await check(page, "closed", "book-6-closed");
});
