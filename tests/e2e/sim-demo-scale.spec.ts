import { expect, test } from "@playwright/test";
import { admin, firstDayWithSlots, loginAs, makeBusiness, sql } from "./helpers/business";
import { noOverflow } from "./helpers/sim";

// SIM 9 · Demo-scale realism: a business with ~60 customers and ~400 appointments. A busy day (24 appointments, 8 of them waiting for approval) still
// renders within 3 seconds, the approvals panel shows at most 4 requests plus a "show all" control, and nothing scrolls sideways.
// Old behaviour: every waiting request was listed, pushing the day's schedule off the screen.
test.skip(!process.env.E2E_REAL_SUPABASE, "needs local Supabase: `npm run db:start && source scripts/local-env.sh`");
test.setTimeout(120_000);

const BUSY = 24;
const PENDING = 8;
const CUSTOMERS = 60;
const HISTORY = 376; // + BUSY = 400

test("a busy day of a business with 60 customers and 400 appointments", async ({ page, request }) => {
  const b = await makeBusiness("barber");
  const f = await firstDayWithSlots(request, b);
  const svc = b.services[2]; // 20-minute service: 24 fit into one working day
  const resource = (await admin().from("resources").select("id").eq("business_id", b.id).limit(1).single()).data!.id as string;
  expect(svc.duration_minutes).toBe(20);

  // seed through SQL (same container the app uses): customers, then the busy day, then months of history
  sql(`
    set session_replication_role = replica;
    insert into public.customers (business_id, full_name, phone, email, email_key)
      select '${b.id}', 'לקוח דמו ' || n, '+9725010' || lpad(n::text, 5, '0'), 'demo' || n || '.${b.slug.slice(-6)}@example.com', lower('demo' || n || '.${b.slug.slice(-6)}@example.com') from generate_series(1, ${CUSTOMERS}) n;
    create temp table cust as select id, row_number() over (order by phone) as n from public.customers where business_id = '${b.id}';
    insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, starts_at, ends_at, blocked_until, service_snapshot, price_cents, source)
      select '${b.id}', '${resource}', '${svc.id}', c.id, 'SB' || substr(md5(random()::text || g::text), 1, 10),
             case when g <= ${PENDING} then 'pending' else 'confirmed' end,
             (('${f.date}'::date + time '09:00' + (g - 1) * interval '25 minutes') at time zone 'Asia/Jerusalem'),
             (('${f.date}'::date + time '09:00' + (g - 1) * interval '25 minutes' + interval '20 minutes') at time zone 'Asia/Jerusalem'),
             (('${f.date}'::date + time '09:00' + (g - 1) * interval '25 minutes' + interval '25 minutes') at time zone 'Asia/Jerusalem'),
             '{"name":"x"}'::jsonb, 4000, 'online'
      from generate_series(1, ${BUSY}) g join cust c on c.n = ((g - 1) % ${CUSTOMERS}) + 1;
    insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, starts_at, ends_at, blocked_until, service_snapshot, price_cents, source)
      select '${b.id}', '${resource}', '${svc.id}', c.id, 'SH' || substr(md5(random()::text || g::text), 1, 10), 'completed',
             (((current_date - 1 - (g / 8))::date + time '09:00' + (g % 8) * interval '30 minutes') at time zone 'Asia/Jerusalem'),
             (((current_date - 1 - (g / 8))::date + time '09:00' + (g % 8) * interval '30 minutes' + interval '20 minutes') at time zone 'Asia/Jerusalem'),
             (((current_date - 1 - (g / 8))::date + time '09:00' + (g % 8) * interval '30 minutes' + interval '25 minutes') at time zone 'Asia/Jerusalem'),
             '{"name":"x"}'::jsonb, 4000, 'online'
      from generate_series(1, ${HISTORY}) g join cust c on c.n = ((g - 1) % ${CUSTOMERS}) + 1;
    set session_replication_role = origin;
  `);
  expect(sql(`select count(*) from public.appointments where business_id = '${b.id}'`)).toBe(String(BUSY + HISTORY));
  expect(sql(`select count(*) from public.customers where business_id = '${b.id}'`)).toBe(String(CUSTOMERS));

  await loginAs(page, b.ownerEmail);
  await page.goto("/dashboard");
  await expect(page.getByTestId("day-input")).toBeVisible();

  // the busy day renders within 3 seconds
  const t0 = Date.now();
  await page.getByTestId("day-input").fill(f.date);
  await expect(page.locator('[data-testid^="row-"][data-status]')).toHaveCount(BUSY);
  const took = Date.now() - t0;
  expect(took, `the day with ${BUSY} appointments took ${took} ms`).toBeLessThan(3000);

  // approvals: all 8 are counted, at most 4 are listed, the rest is one "show all" away
  await expect(page.getByTestId("approvals-count")).toHaveText(String(PENDING));
  const listed = () => page.locator("[data-testid^='approval-']").evaluateAll((els) => els.filter((e) => /^approval-[0-9a-f-]{36}$/.test(e.getAttribute("data-testid")!)).length);
  expect(await listed()).toBeLessThanOrEqual(4);
  const more = page.getByTestId("approvals-more");
  await expect(more).toBeVisible();
  await expect(more).toHaveText(`הצגת כל ${PENDING} הבקשות`);
  await noOverflow(page, "busy day");

  await more.click();
  expect(await listed()).toBe(PENDING);
  await expect(more).toHaveText("הצגת פחות");
  await noOverflow(page, "busy day, all requests shown");

  // the same at phone width
  await page.setViewportSize({ width: 360, height: 740 });
  await page.reload();
  await page.getByTestId("day-input").fill(f.date);
  await expect(page.locator('[data-testid^="row-"][data-status]')).toHaveCount(BUSY);
  await noOverflow(page, "busy day at 360px");

  // customers page with 60 customers
  await page.goto("/customers");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await noOverflow(page, "customers at 360px");
});
