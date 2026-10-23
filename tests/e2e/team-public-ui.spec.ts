import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { kindHours } from "../../lib/lab/onboarding";
import { admin, fakeIp, makeBusiness } from "./helpers/business";

// Stage 16 / TEAM-04 in the browser: the "with whom?" choice, the narrowed offer and the person on the confirmation. Mobile 360 and desktop (both projects run this file).
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

async function twoPeople() {
  const b = await makeBusiness("barber");
  const noam = (await b.db.rpc("create_staff", { p_business: b.id, p_name: "נועם" })).data as string;
  expect((await b.db.rpc("set_staff_hours", { p_resource: noam, p_hours: kindHours("barber") })).error).toBeNull();
  return { b, noam };
}

test("the page asks 'with whom?' only when there are two or more people; a named person is booked and shown", async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() });
  const { b, noam } = await twoPeople();
  await page.goto(`/book/${b.slug}`);
  await expect(page.getByTestId("person-choice")).toHaveCount(0); // nothing chosen yet
  await page.getByTestId(`service-${b.services[0].id}`).check({ force: true });
  await expect(page.getByTestId("person-choice")).toBeVisible();
  await expect(page.getByTestId("person-any")).toBeChecked();
  await noOverflow(page);
  await page.waitForTimeout(400);
  expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
  await page.screenshot({ path: `test-results/shots/team-1-person-${page.viewportSize()!.width}.png`, fullPage: true });
  await page.getByTestId("person-choice").getByText("נועם", { exact: true }).click(); // a real click on the visible label: Playwright scrolls it clear of the sticky bar
  await page.getByTestId("continue").click();
  await page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
  await page.getByTestId("continue").click();
  await page.locator('input[name="time"]').first().check({ force: true });
  await page.getByTestId("continue").click();
  await page.getByLabel("שם מלא").fill("יעל כהן");
  await page.getByLabel("טלפון נייד").fill("050-1234567");
  await page.getByLabel("אימייל").fill(`yael.${Math.random().toString(36).slice(2, 8)}@example.com`);
  await page.getByTestId("continue").click();
  await page.getByTestId("done-title").waitFor();
  await expect(page.getByTestId("done-person")).toHaveText("נועם");
  await noOverflow(page);
  await page.waitForTimeout(400);
  expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
  await page.screenshot({ path: `test-results/shots/team-2-done-${page.viewportSize()!.width}.png`, fullPage: true });
  const row = (await admin().from("appointments").select("resource_id, resource_chosen").eq("business_id", b.id).single()).data!;
  expect(row).toEqual({ resource_id: noam, resource_chosen: true });
});

test("a service restricted to one person asks nothing; a one-person business never shows the choice", async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() });
  const { b, noam } = await twoPeople();
  expect((await b.db.rpc("set_service_staff", { p_service: b.services[0].id, p_resources: [noam] })).error).toBeNull();
  await page.goto(`/book/${b.slug}`);
  await page.getByTestId(`service-${b.services[0].id}`).check({ force: true });
  await expect(page.getByTestId("person-choice")).toHaveCount(0); // only one person can do it: nothing to choose
  const solo = await makeBusiness("barber");
  await page.goto(`/book/${solo.slug}`);
  await page.getByTestId(`service-${solo.services[0].id}`).check({ force: true });
  await expect(page.getByTestId("person-choice")).toHaveCount(0);
});
