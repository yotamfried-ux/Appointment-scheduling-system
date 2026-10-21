import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { admin, loginAs, makeBusiness, rand } from "./helpers/business";

// The owner picks a short booking link in her settings: a free name works and the old link keeps leading to the business; a taken name, a reserved one and a malformed one are refused.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

test("the owner shortens the booking link; the old link still works; taken, reserved and malformed names are refused", async ({ page }) => {
  const b = await makeBusiness("barber");
  const other = await makeBusiness("barber");
  await loginAs(page, b.ownerEmail);
  await page.goto("/settings/booking");
  await expect(page.getByTestId("link-current")).toContainText(`/book/${b.slug}`);
  await expect(page.getByTestId("link-save")).toBeDisabled(); // nothing changed yet
  expect((await axe(page)).violations.map((v) => v.id)).toEqual([]);

  // refused: someone else's name, a reserved word, a malformed one
  await page.getByTestId("link-input").fill(other.slug);
  await expect(page.getByText("השם הזה לא זמין. נסו שם אחר.")).toBeVisible();
  await expect(page.getByTestId("link-save")).toBeDisabled();
  await page.getByTestId("link-input").fill("admin");
  await expect(page.getByText("השם הזה לא זמין. נסו שם אחר.")).toBeVisible();
  await page.getByTestId("link-input").fill("a b!");
  await expect(page.getByText(/רק אותיות באנגלית/)).toBeVisible();
  await expect(page.getByTestId("link-save")).toBeDisabled();

  // accepted
  const next = `short-${rand()}`.slice(0, 24);
  await page.getByTestId("link-input").fill(next);
  await expect(page.getByText("השם פנוי.")).toBeVisible();
  await page.getByTestId("link-save").click();
  await expect(page.getByTestId("link-status")).toContainText("הקישור עודכן");
  await expect(page.getByTestId("link-current")).toContainText(`/book/${next}`);
  expect((await admin().from("businesses").select("slug").eq("id", b.id).single()).data!.slug).toBe(next);

  // the new link shows the business; the old one leads there
  await page.goto(`/book/${next}`);
  await expect(page.getByTestId("business-name")).toBeVisible();
  await page.goto(`/book/${b.slug}`);
  await expect(page).toHaveURL(new RegExp(`/book/${next}$`));
});
