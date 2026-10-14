import { test, type Page } from "@playwright/test";
import { kindHours } from "../../lib/lab/onboarding";
import { admin, firstDayWithSlots, loginAs, makeBusiness, publicBook } from "./helpers/business";

// UX audit capture (not a regression test): writes full-page screenshots of every main screen to $UX_SHOTS/<label>/.
// Run:  UX_SHOTS=/path/dir UX_LABEL=before npx playwright test ux-capture
test.skip(!process.env.UX_SHOTS || !process.env.E2E_REAL_SUPABASE, "set UX_SHOTS and start the local stack");
test.setTimeout(180_000);

async function shot(page: Page, name: string) {
  await page.waitForTimeout(600);
  const w = page.viewportSize()!.width;
  await page.screenshot({ path: `${process.env.UX_SHOTS}/${process.env.UX_LABEL ?? "run"}/${name}-${w}.png`, fullPage: true });
}

test("capture all screens", async ({ page, request }) => {
  // public, signed out
  await page.goto("/");
  await shot(page, "01-home");
  await page.goto("/auth/login");
  await shot(page, "02-login");
  await page.goto("/auth/sign-up");
  await shot(page, "03-signup");
  await page.goto("/auth/forgot-password");
  await shot(page, "04-forgot");
  await page.goto("/no-such-page-here");
  await shot(page, "05-404");

  // a three-person barber with bookings
  const b = await makeBusiness("barber");
  const first = (await admin().from("resources").select("id").eq("business_id", b.id).single()).data!.id as string;
  await b.db.rpc("update_staff", { p_resource: first, p_name: "דנה", p_active: null });
  for (const n of ["נועם", "רון"]) {
    const id = (await b.db.rpc("create_staff", { p_business: b.id, p_name: n })).data as string;
    await b.db.rpc("set_staff_hours", { p_resource: id, p_hours: kindHours("barber") });
  }
  const f = await firstDayWithSlots(request, b);
  for (let i = 0; i < 4; i++) await publicBook(request, b, f.date, f.times[i % 3], i + 1);

  await page.goto(`/book/${b.slug}`);
  await shot(page, "10-book-step1");
  await page.goto(`/book/${b.slug}/waitlist`).catch(() => {});
  await shot(page, "11-book-waitlist");

  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  await page.getByTestId("day-input").fill(f.date);
  await shot(page, "20-dashboard-day");
  await page.goto("/customers");
  await shot(page, "21-customers");
  await page.goto("/reports");
  await shot(page, "22-reports");
  for (const s of ["services", "hours", "team", "booking", "billing", "security", "account"]) {
    await page.goto(`/settings/${s}`);
    await shot(page, `30-settings-${s}`);
  }

  // a brand-new owner whose page is not published yet
  const fresh = await makeBusiness("barber", { publish: false });
  await loginAs(page, fresh.ownerEmail);
  await page.goto("/dashboard");
  await shot(page, "40-dashboard-new-unpublished");
});
