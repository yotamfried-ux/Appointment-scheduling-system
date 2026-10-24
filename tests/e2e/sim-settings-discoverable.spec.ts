import { expect, test } from "@playwright/test";
import { loginAs, makeBusiness } from "./helpers/business";

// SIM 2 · An owner who looks for "settings" finds them: the main navigation has "הגדרות", the dashboard offers "שינוי כתובת הקישור",
// and the link settings are one click from the dashboard. Old behaviour: the main nav had calendar/customers/reports only.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");

test("the main navigation leads to the settings from every owner page", async ({ page }) => {
  const b = await makeBusiness("barber");
  await loginAs(page, b.ownerEmail);
  for (const path of ["/dashboard", "/customers", "/reports"]) {
    await page.goto(path);
    const nav = page.getByRole("navigation", { name: "ניווט ראשי" });
    const item = nav.getByRole("link", { name: "הגדרות", exact: true });
    await expect(item, `${path}: "הגדרות" in the main navigation`).toBeVisible();
    await item.click();
    await expect(page).toHaveURL(/\/settings\//);
    await expect(page.getByRole("navigation", { name: "הגדרות" })).toBeVisible(); // the settings pages have their own section tabs
  }
});

test("from the dashboard the link name is one click away", async ({ page }) => {
  const b = await makeBusiness("barber");
  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  const change = page.getByRole("link", { name: "שינוי כתובת הקישור" });
  await expect(change).toBeVisible();
  await change.click(); // the one click
  await expect(page).toHaveURL(/\/settings\/booking$/);
  await expect(page.getByTestId("link-input")).toBeVisible();
  await expect(page.getByTestId("link-current")).toContainText(`/book/${b.slug}`);
});
