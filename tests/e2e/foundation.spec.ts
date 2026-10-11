import AxeBuilder from "@axe-core/playwright";
import { expect, test, type ConsoleMessage } from "@playwright/test";

const PAGES = ["/", "/auth/login", "/auth/sign-up", "/auth/forgot-password", "/auth/sign-up-success", "/auth/error"];

test.describe("security headers (docs/05 §5.5)", () => {
  test("health endpoint is live, uncached, and not leaking the framework", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers()["cache-control"]).toBe("no-store");
    expect(res.headers()["x-powered-by"]).toBeUndefined();
  });

  test("pages carry CSP with a fresh nonce on every request + hardening headers", async ({ request }) => {
    const a = await request.get("/");
    const b = await request.get("/");
    const cspA = a.headers()["content-security-policy"];
    const cspB = b.headers()["content-security-policy"];
    expect(cspA).toContain("default-src 'self'");
    expect(cspA).toContain("frame-ancestors 'none'");
    expect(cspA).not.toContain("'unsafe-eval'");
    expect(cspA).not.toBe(cspB); // nonce differs per request
    const h = a.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["strict-transport-security"]).toContain("max-age=");
    expect(h["permissions-policy"]).toContain("camera=()");
  });
});

test.describe("hebrew / RTL foundation", () => {
  for (const path of PAGES) {
    test(`${path} is lang=he dir=rtl, hydrates under CSP, has no console errors`, async ({ page }) => {
      const problems: string[] = [];
      page.on("console", (m: ConsoleMessage) => {
        if (m.type() === "error" || /content security policy/i.test(m.text())) problems.push(m.text());
      });
      page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

      await page.goto(path);
      await expect(page.locator("html")).toHaveAttribute("lang", "he");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await page.waitForLoadState("networkidle");
      expect(problems, problems.join("\n")).toEqual([]);
    });
  }

  test("client JavaScript actually runs (nonce works): theme switcher hydrates", async ({ page }) => {
    await page.goto("/");
    // The switcher renders only after hydration (useSyncExternalStore). If CSP blocked scripts it never appears.
    await expect(page.getByRole("button", { name: "החלפת ערכת נושא" })).toBeVisible();
  });

  test("no horizontal scroll on small screens", async ({ page }) => {
    await page.goto("/");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("access control", () => {
  test("unauthenticated users are redirected away from the dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("health stays public", async ({ request }) => {
    expect((await request.get("/api/health", { maxRedirects: 0 })).status()).toBe(200);
  });
});

test.describe("accessibility (WCAG 2.2 AA via axe)", () => {
  for (const path of PAGES) {
    test(`${path} has no axe violations`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
    });
  }
});
