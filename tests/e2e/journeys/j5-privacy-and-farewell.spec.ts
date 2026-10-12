import { expect, test } from "@playwright/test";
import { admin, loginAs, makeBusiness, PASSWORD, sql } from "../helpers/business";
import { auth, byType, drain, mail, rows } from "../helpers/outbox";
import { axe, customerBooksViaPage, customerOnPhone, noOverflow, ownerAtDesk } from "./world";

// JOURNEY 5 — privacy, from first visit to goodbye. A visitor browses without being tracked; the owner accepts the terms; a customer asks to be forgotten and is;
// the owner downloads all her data, closes the business with a grace period, customers are told, and the system really deletes everything afterwards.
// Crosses: legal pages and gate · cookies · erasure · mail · export · deletion job · health endpoints.
test.use({ actionTimeout: 20_000 });

test("no tracking → terms accepted → a customer is erased → everything exported → the business closes and is purged", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const b = await makeBusiness("barber");
  const desk = await ownerAtDesk(browser, baseURL!);
  const visitor = await customerOnPhone(browser, baseURL!);
  const cm1 = mail(), cm2 = mail();

  await test.step("a visitor browses the public pages: no cookies, no third parties, the legal pages are there and accessible", async () => {
    const hosts = new Set<string>();
    visitor.page.on("request", (r) => hosts.add(new URL(r.url()).host));
    for (const path of [`/book/${b.slug}`, "/privacy", "/terms", "/cookies", "/accessibility"]) {
      await visitor.page.goto(path);
      await expect(visitor.page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    expect([...hosts]).toEqual([new URL(baseURL!).host]);
    expect(await visitor.ctx.cookies()).toEqual([]);
    await noOverflow(visitor.page);
    expect((await axe(visitor.page)).violations).toEqual([]);
  });

  await test.step("the owner signs in and must accept the current terms before she can use the app", async () => {
    await desk.ctx.setExtraHTTPHeaders({ "x-test-legal-gate": "on" });
    await loginAs(desk.page, b.ownerEmail);
    await desk.page.goto("/dashboard");
    await expect(desk.page).toHaveURL(/\/legal\/accept$/);
    await desk.page.getByTestId("legal-agree").check();
    await desk.page.getByTestId("legal-submit").click();
    await expect(desk.page).toHaveURL(/\/dashboard$/);
  });

  const first = await test.step("two customers book; one of them later asks to be forgotten", async () => {
    const r1 = await customerBooksViaPage(visitor.page, b.slug, { name: "שירה ש׳", phone: "050-5550001", email: cm1 });
    const phone2 = await customerOnPhone(browser, baseURL!);
    await customerBooksViaPage(phone2.page, b.slug, { name: "תום ת׳", phone: "050-5550002", email: cm2 }, { nthTime: 3 });
    await phone2.ctx.close();
    return r1;
  });
  const shira = (await admin().from("customers").select("id").eq("business_id", b.id).eq("full_name", "שירה ש׳").single()).data!;

  await test.step("erasure is refused while she has a future appointment; after it is over the owner erases her and no trace of her remains", async () => {
    await desk.page.goto(`/customers/${shira.id}`);
    await desk.page.getByTestId("anonymize").click();
    await desk.page.getByTestId("anonymize-yes").click();
    await expect(desk.page.getByText(/תורים עתידיים/).first()).toBeVisible();
    expect(sql(`select anonymized_at is null from public.customers where id='${shira.id}'`)).toBe("t");
    sql(`set session_replication_role = replica; update public.appointments set starts_at = now() - interval '3 days', ends_at = now() - interval '3 days' + interval '30 minutes', blocked_until = now() - interval '3 days' + interval '30 minutes', status = 'completed' where customer_id = '${shira.id}'; set session_replication_role = origin;`);
    await desk.page.reload();
    await desk.page.getByTestId("anonymize").click();
    await desk.page.getByTestId("anonymize-yes").click();
    await expect.poll(() => sql(`select full_name || '|' || (email is null) || '|' || (phone <> '+972505550001') from public.customers where id='${shira.id}'`)).toBe("לקוח שנמחק|true|true");
    expect(sql(`select count(*) from public.appointments where customer_id='${shira.id}' and contact_email is not null`)).toBe("0");
    const csv = await (await desk.page.request.get("/api/owner/export/customers")).text();
    expect(csv).not.toContain("שירה");
    expect(csv).not.toContain("5550001");
    await desk.page.goto(first.manageUrl);   // her private link no longer exposes her details either
    await expect(desk.page.getByText("שירה")).toHaveCount(0);
  });

  await test.step("the owner downloads every byte the business holds", async () => {
    await desk.page.goto("/settings/account");
    const doc = await (await desk.page.request.get("/api/owner/account/export")).json();
    expect(doc.customers.map((c: { fullName: string }) => c.fullName)).toEqual(expect.arrayContaining(["תום ת׳", "לקוח שנמחק"]));
    expect(JSON.stringify(doc)).not.toContain("שירה");
    expect(doc.appointments).toHaveLength(2);
  });

  await test.step("she closes the business: customers with future appointments are told by mail, the page closes, she can see the countdown", async () => {
    const name = (await admin().from("businesses").select("name").eq("id", b.id).single()).data!.name as string;
    await desk.page.getByTestId("account-confirm-name").fill(name);
    await desk.page.getByTestId("account-delete").click();
    await expect(desk.page.getByTestId("account-deletion-pending")).toBeVisible();
    await drain(desk.page.request, async () => byType(await rows(b), "booking_cancelled_by_business").some((r) => r.status === "sent"));
    expect(byType(await rows(b), "booking_cancelled_by_business")).toHaveLength(1); // Tom had the only future appointment
    expect((await visitor.page.goto(`/book/${b.slug}`))!.status()).toBe(404);
    await desk.page.goto("/dashboard");
    await expect(desk.page.getByTestId("deletion-banner")).toBeVisible();
  });

  await test.step("two weeks later the nightly job deletes everything, the monitoring endpoints stay healthy, and an old link shows nothing", async () => {
    expect((await desk.page.request.get("/api/ready")).status()).toBe(200);
    sql(`update public.businesses set deletion_scheduled_for = now() - interval '1 minute', deletion_requested_at = now() - interval '14 days' where id='${b.id}'`);
    const run = await desk.page.request.post("/api/jobs/maintenance", { headers: auth });
    expect(run.status()).toBe(200);
    expect((await run.json()).businessesPurged).toBeGreaterThanOrEqual(1);
    expect(sql(`select (select count(*) from public.businesses where id='${b.id}') + (select count(*) from public.customers where business_id='${b.id}') + (select count(*) from public.appointments where business_id='${b.id}')`)).toBe("0");
    const health = await (await desk.page.request.get("/api/jobs/health", { headers: auth })).json();
    expect(health.jobs.find((j: { job: string }) => j.job === "maintenance").stale).toBe(false);
    await visitor.page.goto(first.manageUrl);
    await expect(visitor.page.getByTestId("manage-invalid")).toBeVisible();
    expect(sql(`select count(*) from auth.users where email = '${b.ownerEmail}'`)).toBe("0"); // even the sign-in identity is gone
    const again = await desk.page.request.post(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, "content-type": "application/json" }, data: { email: b.ownerEmail, password: PASSWORD } });
    expect(again.status()).toBe(400);
  });

  await desk.ctx.close();
  await visitor.ctx.close();
});
