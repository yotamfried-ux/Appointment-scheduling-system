import { expect, test } from "@playwright/test";
import { loginAs, makeBusiness } from "./helpers/business";

// Legal library COOKIES-CONSENT (items 14-20): on a fresh profile, with no choice made, the product sets only essential cookies, stores only the theme locally,
// talks only to its own origin (and the database host the policy names), and shows no consent banner because there is no optional category.
// If an analytics/ads/embed ever appears, this fails until the category is registered in lib/consent.ts and gated.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase");

const ALLOWED_COOKIE = /^(sb-.*-auth-token(\.\d+)?|sb-.*-code-verifier|tori_consent)$/;
const ALLOWED_STORAGE = new Set(["theme"]);

test("fresh visitor: public pages and the booking flow set no optional cookie, store nothing beyond the theme, call only allowed origins", async ({ page, context, baseURL }) => {
  const origins = new Set<string>();
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith("http")) origins.add(u.origin);
  });
  const b = await makeBusiness("barber");
  for (const path of ["/", "/auth/login", "/auth/sign-up", "/privacy", "/terms", "/cookies", "/accessibility", `/book/${b.slug}`]) {
    await page.goto(path);
    await page.waitForTimeout(300);
  }
  await page.locator('input[name="service"]').first().check({ force: true });
  await page.getByTestId("continue").click();
  await page.waitForTimeout(300);

  const cookies = await context.cookies();
  expect(cookies.filter((c) => !ALLOWED_COOKIE.test(c.name)).map((c) => c.name), "only essential cookies").toEqual([]);
  expect(cookies.some((c) => c.name === "tori_consent"), "no consent cookie before a choice").toBe(false);
  const local = await page.evaluate(() => Object.keys(localStorage).concat(Object.keys(sessionStorage)));
  expect(local.filter((k) => !ALLOWED_STORAGE.has(k)), "browser storage beyond the theme").toEqual([]);
  const allowed = new Set([new URL(baseURL!).origin, new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin]);
  expect([...origins].filter((o) => !allowed.has(o)), "requests to other origins (a tracker, a font CDN, an embed)").toEqual([]);
  expect(await page.getByRole("dialog", { name: /עוגיות|העדפות/ }).count(), "no banner without an optional category").toBe(0);
});

test("signed-in owner: the only cookie added is the HttpOnly session cookie, and no other origin is contacted", async ({ page, context, baseURL }) => {
  const origins = new Set<string>();
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.protocol.startsWith("http")) origins.add(u.origin);
  });
  const b = await makeBusiness("barber");
  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  await page.getByTestId("agenda").waitFor();
  const cookies = await context.cookies();
  expect(cookies.filter((c) => !ALLOWED_COOKIE.test(c.name)).map((c) => c.name)).toEqual([]);
  const session = cookies.filter((c) => c.name.startsWith("sb-"));
  expect(session.length).toBeGreaterThan(0);
  for (const c of session) {
    expect(c.httpOnly, `${c.name} is HttpOnly`).toBe(true);
    expect(c.sameSite, `${c.name} SameSite`).not.toBe("None");
  }
  const allowed = new Set([new URL(baseURL!).origin, new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin]);
  expect([...origins].filter((o) => !allowed.has(o))).toEqual([]);
});
