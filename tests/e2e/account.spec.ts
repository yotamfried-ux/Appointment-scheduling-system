import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { auth, byType, drain, mail, rows } from "./helpers/outbox";
import { admin, firstDayWithSlots, loginAs, makeBusiness, publicBook, sql } from "./helpers/business";

// ACC-09: export everything; delete the account with a grace period. Real browser, real stack, real mail outbox, the maintenance job over HTTP.
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test.describe("account export and deletion (ACC-09)", () => {
  test("the owner downloads everything the business holds; the export is audited; the page is accessible", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const email = mail();
    const a = await publicBook(request, b, f.date, f.times[0], 1, 0, email);
    await loginAs(page, b.ownerEmail);
    await page.goto("/settings/account");
    await expect(page.getByTestId("account-export")).toBeVisible();
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);

    const res = await page.request.get("/api/owner/account/export");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toMatch(/attachment; filename="account-export-\d{4}-\d{2}-\d{2}\.json"/);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const doc = await res.json();
    expect(doc.format).toBe("easylife-account-export/1");
    expect(doc.appointments.map((x: { id: string }) => x.id)).toContain(a.id);
    expect(doc.customers.some((c: { email: string }) => c.email === email)).toBe(true);
    expect(doc.services.length).toBeGreaterThan(0);
    expect(JSON.stringify(doc)).not.toMatch(/deletion_requested_at|created_by/);
    expect(sql(`select count(*) from public.audit_log where business_id='${b.id}' and action='account.export'`)).toBe("1");
    // a cross-site navigation is refused and leaves no audit row
    const evil = await page.request.get("/api/owner/account/export", { headers: { "sec-fetch-site": "cross-site" } });
    expect(evil.status()).toBe(403);
    expect(sql(`select count(*) from public.audit_log where business_id='${b.id}' and action='account.export'`)).toBe("1");
  });

  test("deletion: confirmation by name, bookings closed, future appointments cancelled with mail to the customers, cancel restores, and after the grace period everything is purged", async ({ page, request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const e1 = mail(), e2 = mail();
    const a1 = await publicBook(request, b, f.date, f.times[0], 1, 0, e1);
    const a2 = await publicBook(request, b, f.date, f.times[1], 2, 0, e2);
    await loginAs(page, b.ownerEmail);
    await page.goto("/settings/account");
    const del = page.getByTestId("account-delete");
    await expect(del).toBeDisabled(); // nothing happens before the name is typed
    await page.getByTestId("account-confirm-name").fill("שם אחר");
    await expect(del).toBeDisabled();
    const name = (await admin().from("businesses").select("name").eq("id", b.id).single()).data!.name as string;
    await page.getByTestId("account-confirm-name").fill(name);
    await del.click();
    await expect(page.getByTestId("account-deletion-pending")).toBeVisible();
    expect((await admin().from("appointments").select("status").in("id", [a1.id, a2.id])).data!.map((r) => r.status)).toEqual(["cancelled_by_business", "cancelled_by_business"]);
    expect((await request.get(`/api/public/${b.slug}/services`)).status()).toBe(404); // closed to the public
    await page.goto("/dashboard");
    await expect(page.getByTestId("deletion-banner")).toBeVisible();
    await noOverflow(page);

    await drain(request, async () => byType(await rows(b), "booking_cancelled_by_business").filter((r) => r.status === "sent").length >= 2);
    const sent = byType(await rows(b), "booking_cancelled_by_business").filter((r) => r.status === "sent");
    expect(sent.map((r) => r.appointment_id).sort()).toEqual([a1.id, a2.id].sort()); // each customer is told, once
    expect(sent.every((r) => r.recipient === "customer")).toBe(true);

    // change of heart: the page is back, the cancelled appointments stay cancelled
    await page.goto("/settings/account");
    await page.getByTestId("account-deletion-cancel").click();
    await expect(page.getByTestId("account-delete")).toBeVisible();
    expect((await request.get(`/api/public/${b.slug}/services`)).status()).toBe(200);
    expect((await admin().from("appointments").select("status").eq("id", a1.id).single()).data!.status).toBe("cancelled_by_business");

    // request again; before the grace period ends the job purges nothing
    await page.getByTestId("account-confirm-name").fill(name);
    await page.getByTestId("account-delete").click();
    await expect(page.getByTestId("account-deletion-pending")).toBeVisible();
    const early = await request.post("/api/jobs/maintenance", { headers: auth });
    expect(early.status()).toBe(200);
    expect(sql(`select count(*) from public.businesses where id='${b.id}'`)).toBe("1");

    // the grace period passes
    sql(`update public.businesses set deletion_scheduled_for = now() - interval '1 minute', deletion_requested_at = now() - interval '14 days' where id='${b.id}'`);
    const late = await request.post("/api/jobs/maintenance", { headers: auth });
    expect(late.status()).toBe(200);
    expect((await late.json()).businessesPurged).toBeGreaterThanOrEqual(1);
    expect(sql(`select count(*) from public.businesses where id='${b.id}'`)).toBe("0");
    expect(sql(`select (select count(*) from public.customers where business_id='${b.id}') + (select count(*) from public.appointments where business_id='${b.id}') + (select count(*) from public.services where business_id='${b.id}')`)).toBe("0");
    expect(sql(`select count(*) from public.audit_log where business_id='${b.id}' and action='account.purged'`)).toBe("1");
    expect((await request.get(`/api/public/${b.slug}/services`)).status()).toBe(404);
    await request.get(`/book/${b.slug}`).then((r) => expect(r.status()).toBe(404));
  });
});
