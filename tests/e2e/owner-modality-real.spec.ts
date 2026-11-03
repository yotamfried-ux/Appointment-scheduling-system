import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ACCEPTED } from "./helpers/terms";
import { fakeIp, loginAs, makeBusiness, todayLocal } from "./helpers/business";

// These assertions exercise actual Postgres, auth, public booking API, and owner calendar.
// Never runs against production or mock /design routes.
test.skip(!process.env.E2E_REAL_SUPABASE, "Requires isolated local Supabase");

test("real online/frontal bookings are labelled correctly in the owner's day, week, month, and detail views", async ({ page, request }) => {
  const b = await makeBusiness("teacher");
  const serviceId = b.services[0].id;
  const url = "/api/public/" + b.slug;
  const from = todayLocal(2);
  const av = await request.get(url + "/availability?service=" + serviceId + "&from=" + from + "&days=14");
  expect(av.status()).toBe(200);
  const day = (await av.json()).days.find((d: { freeSlots: number }) => d.freeSlots >= 2);
  expect(day).toBeDefined();
  const available = await request.get(url + "/slots?service=" + serviceId + "&date=" + day.date);
  expect(available.status()).toBe(200);
  const times = (await available.json()).slots as { time: string }[];
  expect(times.length).toBeGreaterThanOrEqual(2);

  const ids: Record<string, string> = {};
  for (const [index, location] of (["online", "business"] as const).entries()) {
    const response = await request.post(url + "/bookings", {
      headers: { "idempotency-key": "verify-modality-" + location + "-" + Date.now(),
                 "x-forwarded-for": fakeIp() },
      data: { serviceId, date: day.date, time: times[index].time, location,
              customer: { fullName: location === "online" ? "בדיקת אונליין" : "בדיקת פרונטלי",
                          phone: "+97250123420" + (index + 1),
                          email: "modality-" + location + "-" + Date.now() + "@example.com" },
              intake: { level: "י״א" }, acceptedTerms: ACCEPTED },
    });
    expect(response.status(), await response.text()).toBe(201);
    const booking = (await response.json()).booking;
    expect(booking.location).toBe(location);
    ids[location] = booking.id;
  }
  const stored = await b.db.from("appointments").select("id, location, service_snapshot")
    .eq("business_id", b.id).in("id", Object.values(ids));
  expect(stored.error).toBeNull();
  expect(stored.data).toHaveLength(2);
  for (const loc of ["online", "business"] as const) {
    const a = stored.data!.find((x) => x.id === ids[loc])!;
    expect(a.location).toBe(loc);
    expect((a.service_snapshot as { location: string }).location).toBe(loc);
  }

  await loginAs(page, b.ownerEmail);
  const owner = await page.request.get("/api/owner/appointments?date=" + day.date);
  expect(owner.status()).toBe(200);
  const data = await owner.json();
  for (const loc of ["online", "business"] as const)
    expect(data.appointments.find((a: { id: string }) => a.id === ids[loc])?.location).toBe(loc);

  await page.goto("/dashboard");
  await expect(page.getByTestId("agenda")).toBeVisible();
  await page.getByTestId("day-input").fill(day.date);
  for (const loc of ["online", "business"] as const) {
    const row = page.getByTestId("row-" + ids[loc]);
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute("data-modality", loc);
    await expect(row.getByTestId("modality-badge")).toHaveAttribute("data-modality", loc);
    await expect(row.getByTestId("modality-badge")).toContainText(loc === "online" ? "אונליין" : "פרונטלי");
  }
  await page.getByTestId("open-detail-" + ids.online).click();
  await expect(page.getByTestId("appointment-detail-dialog").getByTestId("modality-badge"))
    .toHaveAttribute("data-modality", "online");
  await page.getByTestId("detail-dialog-close").click();

  await page.getByTestId("view-week").click();
  for (const loc of ["online", "business"] as const) {
    const card = page.getByTestId("week-appt-" + ids[loc]);
    await expect(card).toBeVisible();
    await expect(card.getByTestId("modality-badge")).toHaveAttribute("data-modality", loc);
  }

  await page.getByTestId("view-month").click();
  for (const loc of ["online", "business"] as const) {
    const card = page.getByTestId("inspector-appt-" + ids[loc]);
    await expect(card).toBeVisible();
    await expect(card.getByTestId("modality-badge")).toHaveAttribute("data-modality", loc);
  }
  await page.getByTestId("inspector-detail-" + ids.business).click();
  await expect(page.getByTestId("appointment-detail-dialog").getByTestId("modality-badge"))
    .toHaveAttribute("data-modality", "business");
  await page.getByTestId("detail-dialog-close").click();

  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByTestId("view-day").click();
  await expect(page.getByTestId("row-" + ids.online).getByTestId("modality-badge")).toBeVisible();
  await expect(page.getByTestId("row-" + ids.business).getByTestId("modality-badge")).toBeVisible();
  const violations = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(violations.violations).toEqual([]);
});
