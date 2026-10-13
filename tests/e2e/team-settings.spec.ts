import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { admin, loginAs, makeBusiness } from "./helpers/business";

// Stage 16 / TEAM-01..03, 09 in the owner's browser: add, rename, set hours, restrict a service, deactivate (nothing moves silently), public names notice.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test("the owner builds a team: add, refuse a duplicate, rename, hours, who does what, deactivate", async ({ page }) => {
  const b = await makeBusiness("barber");
  await loginAs(page, b.ownerEmail);
  await page.goto("/settings/team");
  await expect(page.getByTestId("public-names-notice")).toBeVisible();
  await expect(page.getByTestId("team-list").locator("li")).toHaveCount(1);
  const onlyId = (await admin().from("resources").select("id").eq("business_id", b.id).single()).data!.id as string;
  await expect(page.getByTestId(`deactivate-${onlyId}`)).toBeDisabled(); // the last active person cannot be switched off
  await noOverflow(page);
  expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);

  // add + duplicate
  await page.getByTestId("new-person-name").fill("נועם");
  await page.getByTestId("add-person").click();
  await expect(page.getByTestId("team-list").locator("li")).toHaveCount(2);
  await page.getByTestId("new-person-name").fill("נועם");
  await page.getByTestId("add-person").click();
  await expect(page.getByText("כבר יש אדם פעיל בשם הזה.")).toBeVisible();
  await expect(page.getByTestId("team-list").locator("li")).toHaveCount(2);
  const noam = (await admin().from("resources").select("id").eq("business_id", b.id).eq("name", "נועם").single()).data!.id as string;

  // rename the first person
  await page.getByTestId(`name-${onlyId}`).fill("דנה");
  await page.getByTestId(`rename-${onlyId}`).click();
  await expect.poll(async () => (await admin().from("resources").select("name").eq("id", onlyId).single()).data!.name).toBe("דנה");

  // hours for Noam: open Sunday 09:00–17:00 (the editor's default window) and save
  await page.getByTestId(`hours-toggle-${noam}`).click();
  const editor = page.getByTestId(`hours-${noam}`);
  await editor.getByRole("switch", { name: /ראשון/ }).click();
  await page.getByTestId(`save-hours-${noam}`).click();
  await expect.poll(async () => (await admin().from("availability_rules").select("weekday, start_minute, end_minute").eq("resource_id", noam)).data!).toEqual([{ weekday: 0, start_minute: 540, end_minute: 1020 }]);

  // who does what: restrict the first service to Noam
  const svc = b.services[0].id;
  await page.getByTestId(`only-${svc}`).check({ force: true });
  await expect(page.getByTestId(`save-restrict-${svc}`)).toBeDisabled(); // nobody picked yet: refused client-side
  await page.getByTestId(`pick-${svc}-${noam}`).check({ force: true });
  await page.getByTestId(`save-restrict-${svc}`).click();
  await expect.poll(async () => (await admin().from("service_staff").select("resource_id").eq("service_id", svc)).data!.map((r) => r.resource_id)).toEqual([noam]);
  await noOverflow(page);
  await page.waitForTimeout(400);
  expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
  await page.screenshot({ path: `test-results/shots/team-settings-${page.viewportSize()!.width}.png`, fullPage: true });

  // deactivate Noam while he has a future appointment: the owner is told, nothing moves
  const ap = await b.db.rpc("create_manual_appointment_team", { p_business: b.id, p_service: svc, p_starts_at: new Date(Date.now() + 5 * 86_400_000).toISOString(), p_full_name: "לקוח בדיקה", p_phone: "+972501234599", p_note: null, p_out_of_availability: true, p_resource: noam });
  expect(ap.error).toBeNull();
  const future = (await admin().from("appointments").select("id").eq("resource_id", noam)).data!.length;
  expect(future).toBe(1);
  await page.reload();
  await page.getByTestId(`deactivate-${noam}`).click();
  await expect(page.getByTestId(`confirm-${noam}`)).toBeVisible();
  await page.getByTestId(`confirm-deactivate-${noam}`).click();
  await expect.poll(async () => (await admin().from("resources").select("active").eq("id", noam).single()).data!.active).toBe(false);
  expect((await admin().from("appointments").select("id").eq("resource_id", noam)).data!.length).toBe(future); // nothing moved silently
  await expect(page.getByTestId("team-inactive")).toBeVisible();
  await page.getByTestId(`reactivate-${noam}`).click();
  await expect.poll(async () => (await admin().from("resources").select("active").eq("id", noam).single()).data!.active).toBe(true);
});

test("the hours page tells which person it edits once there is a team", async ({ page }) => {
  const b = await makeBusiness("barber");
  await b.db.rpc("create_staff", { p_business: b.id, p_name: "נועם" });
  await loginAs(page, b.ownerEmail);
  await page.goto("/settings/hours");
  await expect(page.getByTestId("hours-team-note")).toBeVisible();
  await noOverflow(page);
  expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);
  const solo = await makeBusiness("barber");
  await page.context().clearCookies();
  await loginAs(page, solo.ownerEmail);
  await page.goto("/settings/hours");
  await expect(page.getByTestId("hours-team-note")).toHaveCount(0);
});
