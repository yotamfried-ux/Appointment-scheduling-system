import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { firstDayWithSlots, loginAs, makeBusiness, publicBook, sql } from "./helpers/business";

// Visual integrity of the real owner dashboard with realistic data (long names, pending requests, manual + out-of-hours rows).
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

async function check(page: Page, where: string, shot: string) {
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${where}: overflow`).toBeLessThanOrEqual(0);
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main *, header *")]
      .filter((e) => !e.closest("[data-testid=whoami]") && !e.closest(".sr-only") && !e.matches("[class*=truncate], [class*=truncate] *") && e.scrollWidth > e.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(e).overflowX) && (e.textContent ?? "").trim().length > 0 && !e.querySelector("svg, [role=img]"))
      .slice(0, 5)
      .map((e) => `${e.tagName}: "${(e.textContent ?? "").trim().slice(0, 40)}"`),
  );
  expect(clipped, `${where}: clipped text`).toEqual([]);
  expect((await axe(page)).violations.map((v) => `${v.id} (${v.nodes.length})`), `${where}: axe`).toEqual([]);
  await page.screenshot({ path: `test-results/shots/owner-${shot}-${page.viewportSize()!.width}.png`, fullPage: true });
}

test("owner dashboard is balanced with real data", async ({ page }) => {
  const b = await makeBusiness("clinic");
  const f = await firstDayWithSlots(page.request, b);
  await publicBook(page.request, b, f.date, f.times[0], 1);
  await publicBook(page.request, b, f.date, f.times[2], 2);
  const long = await page.request.post(`/api/public/${b.slug}/bookings`, {
    data: { serviceId: b.services[0].id, date: f.date, time: f.times[4], location: "business", customer: { fullName: "שם-ארוך-מאוד-של-לקוח-שלא-נגמר-אף-פעם-ולא-נשבר-בשום-מקום-כלל", phone: "050-1112233" }, intake: {} },
    headers: { "x-forwarded-for": "10.7.7.7", "idempotency-key": `long-${Math.random().toString(36).slice(2)}` },
  });
  expect(long.status()).toBe(201);
  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  await page.getByTestId("day-input").fill(f.date);
  await expect(page.getByTestId("approvals-count")).toHaveText("3");
  await check(page, "dashboard with requests", "1-requests");
  // confirm one and add manual rows so every row type is on screen
  await page.getByRole("button", { name: "אישור · לקוח בדיקה 1" }).click();
  await expect(page.getByTestId("approvals-count")).toHaveText("2");
  await page.getByTestId("new-appointment").click();
  await page.getByTestId("manual-service").selectOption({ index: 1 });
  await page.getByTestId("manual-time").fill("23:00");
  await page.getByTestId("manual-name").fill("לקוח מחוץ לשעות");
  await page.getByTestId("manual-phone").fill("050-5550000");
  await page.getByTestId("manual-note").fill("הערה ארוכה מאוד שנועדה לבדוק שהשורה לא נשברת ולא גולשת מחוץ למסך לאף כיוון");
  await check(page, "manual dialog", "2-dialog");
  await page.getByTestId("manual-submit").click();
  await expect(page.getByTestId("manual-form")).toHaveCount(0);
  await check(page, "dashboard with manual rows", "3-day");
  await page.getByTestId("day-next").click();
  await check(page, "empty next day", "4-empty");
});

test("the manual-appointment form stays reachable on a short phone (dialog scrolls, submit visible after scrolling)", async ({ page }) => {
  const b = await makeBusiness("barber");
  await loginAs(page, b.ownerEmail);
  await page.setViewportSize({ width: 360, height: 520 });
  await page.goto("/dashboard");
  await page.getByTestId("new-appointment").click();
  const dialog = page.getByRole("dialog");
  const box = (await dialog.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(520); // never taller than the screen
  await page.getByTestId("manual-submit").scrollIntoViewIfNeeded();
  await expect(page.getByTestId("manual-submit")).toBeInViewport();
});

test("the undelivered-messages banner is balanced (NTF-04)", async ({ page }) => {
  const b = await makeBusiness("clinic");
  const f = await firstDayWithSlots(page.request, b);
  const a = await publicBook(page.request, b, f.date, f.times[0], 1);
  sql(`insert into public.notification_log (business_id, appointment_id, type, recipient, status, attempts, error) values ('${b.id}', '${a.id}', 'booking_received', 'customer', 'dead', 7, 'injected')`);
  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  await expect(page.getByTestId("undelivered")).toContainText("הודעה אחת ללקוח לא נשלחה");
  await check(page, "dashboard with banner", "5-banner");
});
