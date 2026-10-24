import { expect, test } from "@playwright/test";
import * as C from "../../lib/api/contracts";
import { admin, customer, fakeIp, makeBusiness, todayLocal } from "./helpers/business";
import { fillDay, noOverflow } from "./helpers/sim";
import { mail } from "./helpers/outbox";
import { ACCEPTED } from "./helpers/terms";

// SIM 5 · The waitlist suggests the days. After choosing a service the customer sees the open days (full ones first, then days with room),
// picks up to three, never has to remember a date; a closed day is not offered and the API refuses it. Two days joined = two entries.
// Old behaviour: a bare date field.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");

test("the days are listed by themselves; full first; three at most; closed days never; two days make two entries", async ({ page, request }) => {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": fakeIp() });
  const b = await makeBusiness("barber"); // Saturday is closed
  const av = C.AvailabilityResponse.parse(await (await request.get(`/api/public/${b.slug}/availability?service=${b.services[0].id}&from=${todayLocal(1)}&days=30`)).json());
  const closed = av.days.find((d) => d.closed)!;
  expect(closed, "the next 30 days contain a closed day").toBeTruthy();
  const open = av.days.filter((d) => !d.closed && d.freeSlots > 0);
  const [fullDay, r1, r2, r3] = [open[0].date, open[1].date, open[2].date, open[3].date];
  await fillDay(request, b, fullDay);

  await page.goto(`/book/${b.slug}/waitlist?service=${b.services[0].id}`);
  // no date to remember: the days are there without typing anything
  await expect(page.getByTestId("wl-days")).toBeVisible();
  await expect(page.getByTestId("wl-date")).toHaveCount(0);
  await expect(page.getByTestId(`wl-day-${fullDay}`)).toBeAttached();

  // grouping and order: "ימים מלאים" first, the days with room second; the closed day is nowhere
  const groups = page.locator('[data-testid^="wl-group-"]');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toHaveAttribute("data-testid", "wl-group-full");
  await expect(page.getByTestId("wl-group-full").getByTestId(`wl-day-${fullDay}`)).toBeAttached();
  await expect(page.getByTestId("wl-group-room").getByTestId(`wl-day-${r1}`)).toBeAttached();
  await expect(page.getByTestId("wl-group-room").getByTestId(`wl-day-${fullDay}`)).toHaveCount(0);
  await expect(page.getByText("ימים מלאים", { exact: true })).toBeVisible();
  await expect(page.getByText(/^ימים עם מקום פנוי/)).toBeVisible();
  await expect(page.getByTestId(`wl-day-${closed.date}`), "a closed day is not offered").toHaveCount(0);
  expect(await page.getByTestId("wl-group-full").boundingBox().then((x) => x!.y)).toBeLessThan(await page.getByTestId("wl-group-room").boundingBox().then((x) => x!.y));

  // the meaning of each chip is in words
  await expect(page.getByTestId("wl-group-full").getByText("מלא", { exact: true }).first()).toBeVisible();
  await expect(page.getByTestId("wl-group-room").getByText("יש תורים פנויים").first()).toBeVisible();

  // up to three, never a fourth
  for (const d of [fullDay, r1, r2]) await page.getByTestId(`wl-day-${d}`).check({ force: true });
  await expect(page.getByTestId(`wl-day-${r3}`)).toBeDisabled();
  await expect(page.getByTestId(`wl-day-${r3}`)).not.toBeChecked();
  await page.getByTestId(`wl-day-${r2}`).uncheck({ force: true }); // changing her mind frees a place
  await expect(page.getByTestId(`wl-day-${r3}`)).toBeEnabled();
  await noOverflow(page, "waitlist join");

  // two days → two entries
  const email = mail();
  await page.getByTestId("wl-name").fill("נועם לוי");
  await page.getByTestId("wl-phone").fill("050-7776655");
  await page.getByTestId("wl-email").fill(email);
  await page.getByTestId("wl-submit").click();
  await expect(page.getByTestId("waitlist-done")).toBeVisible();
  await expect(page.getByTestId(`waitlist-joined-${fullDay}`)).toBeVisible();
  await expect(page.getByTestId(`waitlist-joined-${r1}`)).toBeVisible();
  const entries = (await admin().from("waitlist_entries").select("on_date, status").eq("business_id", b.id)).data!;
  expect(entries.map((e) => e.on_date).sort()).toEqual([fullDay, r1].sort());
});

// The product answers every refused input with 422 VALIDATION_FAILED (see waitlist.spec.ts); the owner's "400" = a client-error refusal.
test("a direct API call for a closed day is refused (4xx VALIDATION_FAILED, 422 like every refused input) with a Hebrew message", async ({ request }) => {
  const b = await makeBusiness("barber");
  const av = C.AvailabilityResponse.parse(await (await request.get(`/api/public/${b.slug}/availability?service=${b.services[0].id}&from=${todayLocal(1)}&days=30`)).json());
  const closed = av.days.find((d) => d.closed)!;
  const r = await request.post(`/api/public/${b.slug}/waitlist`, { data: { serviceId: b.services[0].id, date: closed.date, acceptedTerms: ACCEPTED, customer: { fullName: "נועם לוי", phone: customer(1).phone, email: mail() } }, headers: { "x-forwarded-for": fakeIp() } });
  expect(r.status(), await r.text()).toBe(422);
  const body = (await r.json()).error as { code: string; details: { field: string; message: string }[] };
  expect(body.code).toBe("VALIDATION_FAILED");
  expect(body.details).toEqual([{ field: "date", message: "העסק סגור ביום הזה. בחרו יום אחר." }]);
  expect((await admin().from("waitlist_entries").select("id").eq("business_id", b.id)).data).toEqual([]);
});
