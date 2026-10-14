import { expect, test } from "@playwright/test";

// Web launch (library WEB §2): the sitemap lists absolute canonical public pages only, robots points to it, the public pages carry a canonical address,
// a title, a description and Open Graph data; private surfaces are never listed.
test("sitemap and robots: absolute, public pages only, robots points at the sitemap", async ({ request, baseURL }) => {
  const sm = await request.get("/sitemap.xml");
  expect(sm.status()).toBe(200);
  expect(sm.headers()["content-type"]).toContain("xml");
  const xml = await sm.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  expect(locs.map((l) => new URL(l).pathname).sort()).toEqual(["/", "/accessibility", "/cookies", "/privacy", "/terms"]);
  for (const l of locs) expect(new URL(l).origin, "an absolute address of this site").toBe(new URL(locs[0]).origin);
  for (const secret of ["/dashboard", "/settings", "/booking", "/waitlist", "/api", "/auth", "/book/"]) expect(xml, secret).not.toContain(secret);
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain(`Sitemap: ${new URL(locs[0]).origin}/sitemap.xml`);
  void baseURL;
});

test("public pages: one canonical address, a title, a description and Open Graph data", async ({ page }) => {
  for (const path of ["/", "/privacy", "/terms", "/cookies", "/accessibility"]) {
    await page.goto(path);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    expect(new URL(canonical!).pathname, path).toBe(path);
    expect((await page.title()).length, `${path} title`).toBeGreaterThan(3);
    expect(await page.locator('meta[name="description"]').getAttribute("content"), `${path} description`).toBeTruthy();
    expect(await page.locator('meta[property="og:site_name"]').getAttribute("content"), `${path} og:site_name`).toBe("תורים");
    expect(await page.locator('meta[name="robots"][content*="noindex"]').count(), `${path} must be indexable`).toBe(0);
  }
  await page.goto("/");
  expect(await page.locator('meta[property="og:title"]').getAttribute("content")).toContain("הלקוחות קובעים תור בעצמם");
  expect(await page.locator("h1").count(), "exactly one h1").toBe(1);
  expect(await page.locator("html").getAttribute("lang")).toBe("he");
});

test("customer pages stay out of search: booking and private links are noindex", async ({ page, request }) => {
  const r = await request.get("/book/no-such-business-here");
  expect(r.status()).toBe(404);
  await page.goto("/booking/garbage");
  expect(await page.locator('meta[name="robots"][content*="noindex"]').count()).toBeGreaterThan(0);
});
