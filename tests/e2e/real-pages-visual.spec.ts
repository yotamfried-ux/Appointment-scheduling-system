import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { extractLink, waitForMail } from "./helpers/mail";

// Visual-integrity checks on the REAL (authenticated) pages: no horizontal overflow, WCAG 2.2 AA via axe, and
// symmetry — a container that is meant to be centered has equal start/end margins inside its parent.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");

const PW = "Correct-Horse-Battery-9";
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

async function expectNoOverflow(page: Page, where: string) {
  const d = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(d, `${where}: horizontal overflow`).toBeLessThanOrEqual(0);
}

/** The element's start/end gaps to its parent differ by at most `tol` px (centered, not hugging one side). */
async function expectCentered(page: Page, selector: string, where: string, tol = 2) {
  const gaps = await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el?.parentElement) return null;
    const r = el.getBoundingClientRect();
    const p = el.parentElement.getBoundingClientRect();
    return { left: r.left - p.left, right: p.right - r.right };
  }, selector);
  expect(gaps, `${where}: ${selector} not found`).not.toBeNull();
  expect(Math.abs(gaps!.left - gaps!.right), `${where}: ${selector} off-center (left ${gaps!.left}, right ${gaps!.right})`).toBeLessThanOrEqual(tol);
}

/** No visible text is silently cut off (ellipsis/overflow:hidden with content wider than the box). The header e-mail is allowed to truncate. */
async function expectNoClippedText(page: Page, where: string) {
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("main *, header *")]
      .filter((e) => !e.closest("[data-testid=whoami]") && !e.closest(".sr-only") && e.scrollWidth > e.clientWidth + 1 && ["hidden", "clip"].includes(getComputedStyle(e).overflowX) && (e.textContent ?? "").trim().length > 0 && !e.querySelector("svg, [role=img]"))
      .slice(0, 5)
      .map((e) => `${e.tagName}.${(e.getAttribute("class") || "").slice(0, 50)}: "${(e.textContent ?? "").trim().slice(0, 40)}"`),
  );
  expect(clipped, `${where}: clipped text`).toEqual([]);
}

async function check(page: Page, where: string, centered: string[] = []) {
  await page.waitForTimeout(450); // let entrance animations settle before measuring
  await expectNoOverflow(page, where);
  await expectNoClippedText(page, where);
  for (const sel of centered) await expectCentered(page, sel, where);
  expect((await axe(page)).violations.map((v) => `${v.id} (${v.nodes.length})`), `${where}: axe`).toEqual([]);
}

test("real pages: no overflow, no axe violations, balanced layout (mobile + desktop)", async ({ page }) => {
  // public pages
  await page.goto("/");
  await check(page, "home", ["main#main"]);
  await page.goto("/auth/login");
  await check(page, "login", ["main#main"]);
  await page.goto("/auth/sign-up");
  await check(page, "sign-up", ["main#main"]);

  // owner journey
  const email = `visual+${Date.now()}${Math.floor(Math.random() * 1e4)}@example.com`;
  await page.getByLabel("אימייל").fill(email);
  await page.getByLabel("סיסמה", { exact: true }).fill(PW);
  await page.getByLabel("אימות סיסמה").fill(PW);
  await page.getByRole("button", { name: "יצירת חשבון" }).click();
  await page.waitForURL(/sign-up-success/);
  await check(page, "sign-up-success", ["main#main"]);
  await page.goto(extractLink((await waitForMail(email)).html, "/auth/confirm"));

  await page.getByLabel("שם העסק").fill("Same Name Studio With A Really Long Business Name kpxzaxqwe");
  await page.getByLabel("טלפון ליצירת קשר").fill("050-1234567");
  await check(page, "onboarding 1 (long name)", ["main#main"]);
  await page.getByLabel("סוג העסק").selectOption("trainer");
  await page.getByTestId("continue").click();
  await check(page, "onboarding 2 services", ["main#main"]);
  await page.getByTestId("continue").click();
  await check(page, "onboarding 3 hours (split day)", ["main#main"]);
  await page.getByTestId("continue").click();
  await page.getByTestId("done-title").waitFor();
  await check(page, "onboarding done", ["main#main"]);

  await page.getByRole("link", { name: "לדשבורד" }).click();
  await page.getByTestId("biz-link").waitFor();
  await check(page, "dashboard", ["main#main"]);

  await page.goto("/settings/services");
  await check(page, "settings / services", ["main#main"]);
  await page.getByTestId("add-service").click();
  await check(page, "settings / services (form open)", ["main#main"]);
  await page.goto("/settings/hours");
  await check(page, "settings / hours (+ exceptions + preview)", ["main#main"]);

  await page.goto("/settings/security");
  await check(page, "security", ["main#main"]);
  await page.getByTestId("mfa-start").click();
  await page.getByTestId("mfa-secret").waitFor();
  await check(page, "security / MFA enrol", ["main#main", 'form[class*="max-w-sm"]']);
});

test("auth split layout: the dark panel's content block is centered in its panel", async ({ page, isMobile }) => {
  test.skip(isMobile, "the split panel only exists from the lg breakpoint");
  await page.goto("/auth/login");
  await expectCentered(page, "aside > div", "auth aside content");
  // the logo and the form card share the same edge (both in a max-w-md column)
  const edges = await page.evaluate(() => {
    const logo = document.querySelector('a[aria-label]')!.getBoundingClientRect();
    const card = document.querySelector('main#main > *')!.getBoundingClientRect();
    return { logoEnd: logo.right, cardEnd: card.right };
  });
  expect(Math.abs(edges.logoEnd - edges.cardEnd)).toBeLessThanOrEqual(2);
});
