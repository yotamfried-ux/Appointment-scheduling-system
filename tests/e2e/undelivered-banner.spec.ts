import { expect, test } from "@playwright/test";
import { firstDayWithSlots, loginAs, makeBusiness, publicBook, sql } from "./helpers/business";

// The dashboard banner for messages that did not reach a customer: it names the customer, the message, the time and the reason (NTF-04).
const log = (businessId: string, appointmentId: string, type: string, status: string, fields: { error?: string; skip?: string; bounced?: boolean }) =>
  sql(
    `insert into public.notification_log (business_id, appointment_id, type, recipient, status, attempts, error, skip_reason, bounced_at) values ('${businessId}', '${appointmentId}', '${type}', 'customer', '${status}', 1, ${fields.error ? `'${fields.error}'` : "null"}, ${fields.skip ? `'${fields.skip}'` : "null"}, ${fields.bounced ? "now()" : "null"})`,
  );

test("a rejected confirmation names the customer, the message, the time and the reason; no e-mail is a calm note, not a failure", async ({ page }) => {
  const b = await makeBusiness("clinic");
  const f = await firstDayWithSlots(page.request, b);
  const failed = await publicBook(page.request, b, f.date, f.times[0], 1);
  const noMail = await publicBook(page.request, b, f.date, f.times[3], 2);
  log(b.id, failed.id, "booking_confirmed", "dead", { error: "provider 400: invalid_from_address: Invalid from" });
  log(b.id, noMail.id, "reminder", "skipped", { skip: "no_email" });

  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");

  const banner = page.getByTestId("undelivered");
  await expect(banner).toContainText("הודעה אחת ללקוח לא נשלחה");
  const item = banner.getByTestId("undelivered-item");
  await expect(item).toHaveCount(1); // the no-email row is not counted as a failure
  await expect(item).toContainText("לקוח בדיקה 1");
  await expect(item).toContainText("אישור הזמנה");
  await expect(item).toContainText(f.times[0]);
  await expect(item).toContainText("שירות הדואר דחה את ההודעה");
  await expect(banner).not.toContainText("לקוח בדיקה 2");
  await expect(banner).not.toContainText("אין כתובת מייל");

  const note = page.getByTestId("no-email-note");
  await expect(note).toContainText("אין למי לשלוח");
  await expect(note).toContainText("לקוח בדיקה 2");
  await expect(note).toContainText("תזכורת");
  await expect(page.getByTestId("undelivered")).toBeVisible();

  // the way out: open that day
  await banner.getByRole("button", { name: "פתיחת היום" }).click();
  await expect(page.getByTestId("agenda-title")).toBeVisible();
});

test("many failures stay compact: the first three, then show all", async ({ page }) => {
  const b = await makeBusiness("clinic");
  const f = await firstDayWithSlots(page.request, b);
  const codes: [string, { error?: string; bounced?: boolean }][] = [
    ["provider 429", {}],
    ["provider 400: validation_error: Invalid", {}],
    ["network", {}],
    ["", { bounced: true }],
  ];
  for (const [i, [error, extra]] of codes.entries()) {
    const a = await publicBook(page.request, b, f.date, f.times[i * 2], i + 1);
    if (extra.bounced) log(b.id, a.id, "booking_confirmed", "sent", { bounced: true });
    else log(b.id, a.id, "booking_confirmed", "dead", { error });
  }
  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  const banner = page.getByTestId("undelivered");
  await expect(banner).toContainText("4 הודעות ללקוחות לא נשלחו");
  await expect(banner.getByTestId("undelivered-item")).toHaveCount(3);
  await banner.getByTestId("undelivered-toggle").click();
  await expect(banner.getByTestId("undelivered-item")).toHaveCount(4);
  await expect(banner).toContainText("שירות הדואר הגביל זמנית");
  await expect(banner).toContainText("סיבה לא ידועה");
  await expect(banner).toContainText("כתובת המייל לא קיימת או לא מקבלת הודעות");
});
