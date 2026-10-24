import { expect, test, type Locator } from "@playwright/test";
import { fakeIp, makeBusiness } from "./helpers/business";

// SIM 6 · The details step of booking says honestly what each field is for. The phone is only for the business to reach the customer (no messages are sent to it);
// the e-mail receives the confirmation, the reminder and the manage link. Old behaviour: the phone hint promised "a confirmation and a reminder" to a number that never gets one.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");

const hintOf = (field: Locator) =>
  field.evaluate((el) => (el.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim());

test("the phone and e-mail hints at the details step", async ({ page }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() });
  const b = await makeBusiness("barber");
  await page.goto(`/book/${b.slug}`);
  await page.getByTestId(`service-${b.services[0].id}`).check({ force: true });
  await page.getByTestId("continue").click();
  await page.getByRole("button", { name: /הזמן הפנוי הראשון/ }).click();
  await page.getByTestId("continue").click();
  await page.locator('input[name="time"]').first().check({ force: true });
  await page.getByTestId("continue").click();
  await expect(page.getByLabel("טלפון נייד")).toBeVisible();

  const phone = await hintOf(page.getByLabel("טלפון נייד"));
  expect(phone).toContain("רק למקרה שהעסק צריך ליצור איתכם קשר");
  expect(phone).toContain("לא שולחים הודעות לטלפון");
  expect(phone, "the phone hint must not promise confirmations").not.toMatch(/אישור|תזכורת|קישור/);

  const email = await hintOf(page.getByLabel("אימייל"));
  expect(email).toContain("האישור");
  expect(email).toContain("התזכורת");
  expect(email).toContain("הקישור לניהול התור");
  await expect(page.getByText(phone)).toBeVisible(); // visible, not only announced
  await expect(page.getByText(email)).toBeVisible();
});
