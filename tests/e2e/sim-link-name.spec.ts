import { expect, test } from "@playwright/test";
import { admin, loginAs, makeBusiness, rand, signedInOwner } from "./helpers/business";

// SIM 3 · The link name, start to finish, as the owner lives it: she chooses it while setting up, the booking page works at once (nobody presses "publish"),
// later she renames it (new address works, old address leads to it), and a name that is taken or malformed is refused with a Hebrew sentence.
// Old behaviour: the name was generated and the page answered 404 until the owner found and pressed the publish button.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");

test("choose the name in onboarding, live at once, rename in settings, old address redirects, refused names explain themselves", async ({ page, request }) => {
  const other = await makeBusiness("barber"); // somebody else already owns this name
  const owner = await signedInOwner("sim-link");
  const chosen = `mine-${rand()}`.slice(0, 24);

  await loginAs(page, owner.email);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("שם העסק").fill("מספרת סימולציה");
  await page.getByLabel("טלפון ליצירת קשר").fill("050-1234567");

  // a malformed name is explained next to the field and cannot be submitted; a taken one is explained when the business is saved
  await page.getByTestId("link-input").fill("a b!");
  await expect(page.getByText("אותיות לועזיות קטנות, ספרות ומקף בלבד, 3 עד 40 תווים.")).toBeVisible();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("link-input")).toBeVisible(); // still on the first step

  await page.getByTestId("link-input").fill(chosen);
  await page.getByTestId("continue").click();
  await page.getByTestId("continue").click();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("done-title")).toBeVisible();
  await expect(page.getByTestId("share-link")).toContainText(`/book/${chosen}`);
  expect((await request.get(`/book/${chosen}`)).status(), "the booking page answers at once, nobody published it").toBe(200);
  expect((await request.get(`/api/public/${chosen}/services`)).status()).toBe(200);

  // settings: refused names
  await page.goto("/settings/booking");
  await page.getByTestId("link-input").fill(other.slug);
  await expect(page.getByText("השם הזה לא זמין. נסו שם אחר.")).toBeVisible();
  await expect(page.getByTestId("link-save")).toBeDisabled();
  await page.getByTestId("link-input").fill("ab");
  await expect(page.getByText("רק אותיות באנגלית, מספרים ומקף באמצע (3 עד 40 תווים).")).toBeVisible();
  await expect(page.getByTestId("link-save")).toBeDisabled();
  await page.getByTestId("link-input").fill("-bad-");
  await expect(page.getByText("רק אותיות באנגלית, מספרים ומקף באמצע (3 עד 40 תווים).")).toBeVisible();

  // settings: a free name
  const renamed = `new-${rand()}`.slice(0, 24);
  await page.getByTestId("link-input").fill(renamed);
  await expect(page.getByText("השם פנוי.")).toBeVisible();
  await page.getByTestId("link-save").click();
  await expect(page.getByTestId("link-status")).toContainText("הקישור עודכן");
  expect((await admin().from("businesses").select("slug").eq("name", "מספרת סימולציה").eq("slug", renamed)).data).toHaveLength(1);

  expect((await request.get(`/book/${renamed}`)).status(), "the new address works").toBe(200);
  const old = await request.get(`/book/${chosen}`, { maxRedirects: 0 });
  expect([301, 302, 307, 308], "the old address redirects").toContain(old.status());
  expect(old.headers()["location"]).toContain(`/book/${renamed}`);
  await page.goto(`/book/${chosen}`);
  await expect(page).toHaveURL(new RegExp(`/book/${renamed}$`));
  await expect(page.getByTestId("business-name")).toBeVisible();
});

// At onboarding a taken name is not an error: the server assigns the nearest free one ("-2") and the done screen shows the address it really chose (refusal with a message is the settings page, above).
test("a name another business already owns never takes over its page at onboarding; the owner is shown the address she really got", async ({ page, request }) => {
  const other = await makeBusiness("barber");
  const owner = await signedInOwner("sim-link-taken");
  await loginAs(page, owner.email);
  await page.getByLabel("שם העסק").fill("עסק עם שם תפוס");
  await page.getByLabel("טלפון ליצירת קשר").fill("050-1234567");
  await page.getByTestId("link-input").fill(other.slug);
  await page.getByTestId("continue").click();
  await page.getByTestId("continue").click();
  await page.getByTestId("continue").click();
  await expect(page.getByTestId("done-title")).toBeVisible();
  const shown = (await page.getByTestId("share-link").innerText()).trim().split("/book/")[1];
  expect(shown).not.toBe(other.slug);
  expect(shown).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  expect((await request.get(`/book/${shown}`)).status()).toBe(200);
  expect((await admin().from("businesses").select("slug").eq("slug", other.slug)).data).toHaveLength(1); // the other business keeps its address
});
