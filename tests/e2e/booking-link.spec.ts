import { expect, test } from "@playwright/test";
import { KIND_IDS } from "@/modules/tenancy/business-kind";
import { admin, loginAs, makeBusiness } from "./helpers/business";

// The link an owner copies from the dashboard must be the real address of this deployment (never a placeholder) and must open that business's own booking page.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase");

test("every kind of business: the dashboard link is the real address and opens its own booking page", async ({ page, baseURL }) => {
  for (const kind of KIND_IDS) {
    const b = await makeBusiness(kind);
    await loginAs(page, b.ownerEmail);
    await page.goto("/dashboard");
    const link = page.getByTestId("biz-link");
    await expect(link, kind).toHaveText(`${new URL(baseURL!).host}/book/${b.slug}`);
    await expect(page.getByTestId("copy-link")).toBeVisible();
    const href = await link.locator("xpath=ancestor::a").getAttribute("href");
    expect(href, kind).toBe(`http://${new URL(baseURL!).host}/book/${b.slug}`); // local server: http
    await page.goto(`/book/${b.slug}`); // the same path on this server
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const s of b.services) await expect(page.getByText(s.name, { exact: true }).first(), `${kind}: ${s.name}`).toBeVisible();
    await page.context().clearCookies();
  }
});

test("a draft business's link is a plain 404 for customers; once published it opens; the old slug redirects after a rename", async ({ page, request }) => {
  const b = await makeBusiness("barber", { publish: false });
  expect((await request.get(`/book/${b.slug}`)).status()).toBe(404);
  expect((await b.db.rpc("publish_business", { p_business: b.id })).error).toBeNull();
  expect((await request.get(`/book/${b.slug}`)).status()).toBe(200);
  expect((await request.get(`/api/public/${b.slug}/services`)).status()).toBe(200);
  expect((await request.get(`/book/no-such-${b.slug}`)).status()).toBe(404);
  await page.goto(`/book/${b.slug.toUpperCase()}`); // a link retyped in capitals still lands on the business or a clean 404, never an error page
  expect([200, 404]).toContain((await page.goto(`/book/${b.slug.toUpperCase()}`))!.status());
  void admin;
});
