import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// A mistyped address is a plain 404 with a way out, signed out too; pages that exist behind the login still ask for it.
test("unknown address: 404 page with exits (no login redirect); owner pages and the API still need a session", async ({ page, request }) => {
  const r = await page.goto("/no-such-page-here");
  expect(r!.status()).toBe(404);
  await expect(page.getByTestId("not-found")).toBeVisible();
  await expect(page.getByRole("link", { name: "חזרה לדף הבית" })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze()).violations.map((v) => v.id)).toEqual([]);
  for (const path of ["/dashboard", "/settings/team", "/customers", "/reports"]) {
    await page.goto(path);
    await expect(page, path).toHaveURL(/\/auth\/login/);
  }
  expect((await request.get("/api/owner/appointments")).status()).toBe(401);
});
