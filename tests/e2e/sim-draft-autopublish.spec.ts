import { expect, test } from "@playwright/test";
import { loginAs, makeBusiness } from "./helpers/business";

// SIM 4 · A business that is still a draft (publishing failed or was never pressed) goes live by itself when its owner opens the dashboard.
// Old behaviour: the owner had to find and press "פרסום הקישור"; until then customers got a 404.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");

test("opening the dashboard publishes a draft business; the booking page answers 200 and the status says published", async ({ page, request }) => {
  const b = await makeBusiness("barber", { publish: false });
  expect((await request.get(`/book/${b.slug}`)).status(), "before: a draft is invisible to customers").toBe(404);
  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  // nobody presses anything
  await expect(page.getByTestId("biz-status")).toHaveText("פורסם");
  await expect(page.getByTestId("publish")).toHaveCount(0);
  expect((await request.get(`/book/${b.slug}`)).status(), "after: the booking page is live").toBe(200);
  await page.reload();
  await expect(page.getByTestId("biz-status")).toHaveText("פורסם");
});
