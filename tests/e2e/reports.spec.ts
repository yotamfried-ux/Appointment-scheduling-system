import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { fakeIp, loginAs, makeBusiness, signedInOwner, sql, type TestBusiness } from "./helpers/business";

// Stage 8 on the real stack: reports (RPT-01..06), customers (NSH-05, SEC-09), anonymization (CMP-02), exports (RPT-02/03, SEC-08).
// The expected numbers are NOT read from the application: they are worked out here from the raw rows, bucketed by the LOCAL date text we wrote
// (so time-zone arithmetic cannot hide in the oracle), across midnight and the Israel DST change of 2026-03-27.
const axe = (page: Page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

type Row = [local: string, status: string, customer: number, service: 0 | 1, cents: number];
const DATASET: Row[] = [
  ["2026-03-20 10:00", "completed", 1, 0, 8000], // before the period: makes customer 1 a returning one
  ["2026-03-24 23:59", "completed", 5, 0, 8000], // last minute before the period
  ["2026-03-25 10:00", "completed", 1, 0, 8000],
  ["2026-03-25 11:00", "completed", 2, 1, 20000],
  ["2026-03-26 23:30", "completed", 1, 0, 8000],
  ["2026-03-27 00:30", "no_show", 3, 0, 8000], // just after midnight, on the DST day
  ["2026-03-27 10:00", "cancelled_by_customer", 2, 0, 8000],
  ["2026-03-27 11:00", "cancelled_by_business", 1, 0, 8000],
  ["2026-03-28 00:30", "completed", 3, 0, 8000], // after the clock change
  ["2026-03-28 12:00", "confirmed", 2, 1, 20000],
  ["2026-03-29 09:00", "pending", 4, 0, 8000],
  ["2026-03-31 23:59", "completed", 4, 0, 8000], // last minute inside
  ["2026-04-01 00:00", "completed", 4, 0, 8000], // first minute after
];
const FROM = "2026-03-25";
const TO = "2026-03-31";
const BOOKED = new Set(["confirmed", "cancellation_requested", "completed", "no_show"]);

/** The oracle: everything the report must show, computed from the rows alone. */
function expected() {
  const inRange = DATASET.filter((r) => r[0].slice(0, 10) >= FROM && r[0].slice(0, 10) <= TO);
  const booked = inRange.filter((r) => BOOKED.has(r[1]));
  const completed = inRange.filter((r) => r[1] === "completed");
  const noShows = inRange.filter((r) => r[1] === "no_show");
  const cancelled = inRange.filter((r) => r[1].startsWith("cancelled"));
  const byDay: Record<string, number> = {};
  for (const r of booked) byDay[r[0].slice(0, 10)] = (byDay[r[0].slice(0, 10)] ?? 0) + 1;
  const sum = (rs: Row[]) => rs.reduce((a, r) => a + r[4], 0);
  // customers with a booked visit in the period; "new" = no booked visit before the period began
  const seen = new Set(booked.map((r) => r[2]));
  const returning = [...seen].filter((c) => DATASET.some((r) => r[2] === c && BOOKED.has(r[1]) && r[0].slice(0, 10) < FROM)).length;
  return {
    appointments: booked.length,
    completed: completed.length,
    revenue: sum(completed),
    expected: sum(inRange.filter((r) => r[1] === "confirmed")),
    noShowRate: noShows.length / (completed.length + noShows.length),
    cancelRate: cancelled.length / (cancelled.length + booked.length),
    avgTicket: sum(completed) / completed.length,
    byDay,
    newCustomers: seen.size - returning,
    returning,
  };
}

const cust = (n: number) => ({ name: `לקוח דוח ${n}`, phone: `+97250100${String(n).padStart(4, "0")}` });

function seedCustomers(b: TestBusiness, extra: string[] = []) {
  const values = [1, 2, 3, 4, 5, 6].map((n) => `('${b.id}','${cust(n).name}','${cust(n).phone}')`).concat(extra);
  sql(`insert into public.customers (business_id, full_name, phone) values ${values.join(",")}`);
}

function seedDataset(b: TestBusiness) {
  const s = [b.services[0], b.services[1]];
  const stmts = DATASET.map(([local, status, c, svc, cents]) => {
    const start = `('${local}'::timestamp at time zone 'Asia/Jerusalem')`;
    return `insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, starts_at, ends_at, blocked_until, service_snapshot, price_cents)
      select '${b.id}', (select id from public.resources where business_id='${b.id}' and is_default), '${s[svc].id}', (select id from public.customers where business_id='${b.id}' and phone='${cust(c).phone}'),
      'TX-' || upper(substr(md5(random()::text),1,8)), '${status}', ${start}, ${start} + interval '30 minutes', ${start} + interval '30 minutes',
      jsonb_build_object('name','${s[svc].name}','durationMinutes',30,'bufferMinutes',0,'priceCents',${cents}), ${cents}`;
  });
  sql(stmts.join(";\n"));
}

const money = (cents: number) => String(cents / 100); // digits are enough: the symbol and grouping are the formatter's business
const pct = (r: number) => `${Math.round(r * 1000) / 10}%`;
const kpi = (page: Page, label: string) => page.locator(`dt:text-is("${label}") + dd`).first();

test.describe("reports: the numbers equal an independent computation", () => {
  test("API and page agree with the oracle, including midnight and the DST day (RPT-04/06)", async ({ page }) => {
    const b = await makeBusiness("barber");
    seedCustomers(b);
    seedDataset(b);
    const want = expected();
    await loginAs(page, b.ownerEmail);

    // API
    const res = await page.request.get(`/api/owner/reports?from=${FROM}&to=${TO}`);
    expect(res.status()).toBe(200);
    const j = await res.json();
    expect(j.kpis.appointments).toBe(want.appointments);
    expect(j.kpis.completed).toBe(want.completed);
    expect(j.kpis.revenueCents).toBe(want.revenue);
    expect(j.kpis.expectedCents).toBe(want.expected);
    expect(j.kpis.noShowRate).toBeCloseTo(want.noShowRate, 10);
    expect(j.kpis.cancellationRate).toBeCloseTo(want.cancelRate, 10);
    expect(j.kpis.avgTicketCents).toBeCloseTo(want.avgTicket, 6);
    expect(j.kpis.newCustomers).toBe(want.newCustomers);
    expect(j.kpis.returningCustomers).toBe(want.returning);
    // per day, including zero days: every calendar day of the range is present, nothing is dropped or duplicated by DST
    expect(j.byDay.map((d: { date: string }) => d.date)).toEqual(["2026-03-25", "2026-03-26", "2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"]);
    for (const d of j.byDay as { date: string; appointments: number }[]) expect(d.appointments, d.date).toBe(want.byDay[d.date] ?? 0);

    // page
    await page.goto(`/reports?from=${FROM}&to=${TO}`);
    await expect(page.getByTestId("range-shown")).toContainText(FROM);
    await expect(kpi(page, "תורים")).toContainText(String(want.appointments));
    await expect(kpi(page, "הכנסות")).toContainText(money(want.revenue));
    await expect(kpi(page, "צפוי")).toContainText(money(want.expected));
    await expect(kpi(page, "סכום ממוצע")).toContainText(money(want.avgTicket));
    await expect(kpi(page, "אי-הגעות")).toContainText(pct(want.noShowRate));
    await expect(kpi(page, "ביטולים")).toContainText(pct(want.cancelRate));
    await expect(kpi(page, "לקוחות חדשים")).toContainText(String(want.newCustomers));
    await expect(kpi(page, "לקוחות חוזרים")).toContainText(String(want.returning));
    // the chart carries the same numbers for assistive technology
    const bars = await page.getByTestId("chart-appointments").locator("rect").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-value"))));
    expect(bars.reduce((a, c) => a + c, 0)).toBe(want.appointments);
    expect(bars).toHaveLength(7);
    // per-service rows add up to the headline
    const rows = await page.getByTestId("service-row").allInnerTexts();
    expect(rows.length).toBe(2);
    const total = (await page.getByTestId("service-row").evaluateAll((trs) => trs.map((tr) => Number(tr.querySelectorAll("td")[0].textContent)))).reduce((a, c) => a + c, 0);
    expect(total).toBe(want.appointments);
  });

  test("an empty period says so (RPT-05); a bad range is explained; one tenant never sees another's numbers (SEC-01)", async ({ page }) => {
    const b = await makeBusiness("barber");
    const other = await makeBusiness("barber");
    seedCustomers(other);
    seedDataset(other);
    await loginAs(page, b.ownerEmail);
    await page.goto(`/reports?from=${FROM}&to=${TO}`);
    await expect(page.getByText("אין נתונים בתקופה הזו")).toBeVisible();
    await expect(page.getByTestId("kpis")).toHaveCount(0);
    expect((await (await page.request.get(`/api/owner/reports?from=${FROM}&to=${TO}`)).json()).kpis.appointments).toBe(0);

    await page.goto("/reports?from=2026-03-31&to=2026-03-25");
    await expect(page.getByTestId("range-error")).toBeVisible();
    expect((await page.request.get("/api/owner/reports?from=2026-03-31&to=2026-03-25")).status()).toBe(422);
    expect((await page.request.get("/api/owner/reports?from=2024-01-01&to=2026-03-25")).status()).toBe(422); // more than 400 days
    expect((await page.request.get("/api/owner/reports?from=nope&to=2026-03-25")).status()).toBe(422);
  });

  test("anonymous callers are refused (401) on every new endpoint", async ({ request }) => {
    for (const path of ["/api/owner/reports", "/api/owner/customers", "/api/owner/customers/00000000-0000-0000-0000-000000000000", "/api/owner/export/customers"]) {
      const r = await request.get(path);
      expect(r.status(), path).toBe(401);
      expect((await r.json()).error.code).toBe("UNAUTHENTICATED");
    }
  });

  test("the reports page is accessible and does not overflow", async ({ page }) => {
    const b = await makeBusiness("barber");
    seedCustomers(b);
    seedDataset(b);
    await loginAs(page, b.ownerEmail);
    await page.goto(`/reports?from=${FROM}&to=${TO}`);
    await expect(page.getByTestId("chart-appointments")).toBeVisible();
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
    await page.screenshot({ path: `test-results/reports-${test.info().project.name}.png`, fullPage: true });
  });
});

test.describe("customers", () => {
  test("search by name and phone (local form too), wildcards are data, sorting and paging (SEC-09)", async ({ page }) => {
    const b = await makeBusiness("barber");
    const filler = Array.from({ length: 30 }, (_, i) => `('${b.id}','פג ${String(i + 1).padStart(2, "0")}','+97252200${String(i).padStart(4, "0")}')`);
    seedCustomers(b, [...filler, `('${b.id}','ד%ר _נקודה','+972501009999')`]);
    seedDataset(b);
    await loginAs(page, b.ownerEmail);

    const api = async (qs: string) => (await page.request.get(`/api/owner/customers?${qs}`)).json();
    expect((await api("")).total).toBe(37);
    expect((await api("")).items).toHaveLength(25);
    expect((await api("page=2")).items).toHaveLength(12);

    // name, partial name, phone in international and local form
    expect((await api(`q=${encodeURIComponent("דוח 3")}`)).items.map((c: { fullName: string }) => c.fullName)).toEqual([cust(3).name]);
    expect((await api("q=0501000004")).items.map((c: { fullName: string }) => c.fullName)).toEqual([cust(4).name]);
    expect((await api("q=%2B972501000004")).items.map((c: { fullName: string }) => c.fullName)).toEqual([cust(4).name]);
    // a lone % or _ matches only names that really contain it (not "everything")
    expect((await api("q=%25")).items.map((c: { fullName: string }) => c.fullName)).toEqual(["ד%ר _נקודה"]);
    expect((await api("q=_")).items.map((c: { fullName: string }) => c.fullName)).toEqual(["ד%ר _נקודה"]);
    expect((await api(`q=${encodeURIComponent("' or 1=1 --")}`)).total).toBe(0);
    // sort by visits: customer 1 (three completed visits) first; an unknown sort is refused
    expect((await api("sort=visits")).items[0].fullName).toBe(cust(1).name);
    expect((await api("sort=visits")).items[0].visits).toBe(3);
    expect((await page.request.get("/api/owner/customers?sort=password")).status()).toBe(422);
    expect((await page.request.get("/api/owner/customers?page=0")).status()).toBe(422);

    // the page
    await page.goto("/customers?sort=visits");
    await expect(page.getByTestId("customer-count")).toHaveText("37 לקוחות");
    await expect(page.getByTestId("customer-row").first()).toContainText(cust(1).name);
    await expect(page.getByTestId("customer-page")).toHaveText("עמוד 1 מתוך 2");
    await page.getByTestId("customer-search").fill("0501000004");
    await page.getByTestId("customer-search-go").click();
    await expect(page.getByTestId("customer-row")).toHaveCount(1);
    await expect(page.getByTestId("customer-row")).toContainText(cust(4).name);
    await page.goto("/customers?q=zzzz-nothing");
    await expect(page.getByText("לא נמצאו לקוחות")).toBeVisible();
    await page.goto("/customers");
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);
    await page.screenshot({ path: `test-results/customers-${test.info().project.name}.png`, fullPage: true });
  });

  test("recent no-shows are flagged (NSH-05) and a mistaken mark can be corrected (NSH-04)", async ({ page }) => {
    const b = await makeBusiness("barber");
    seedCustomers(b);
    seedDataset(b);
    const c2 = cust(2);
    // a no-show five days ago, outside the 60-day window for the March one
    sql(`insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, starts_at, ends_at, blocked_until, service_snapshot, price_cents)
      select '${b.id}', (select id from public.resources where business_id='${b.id}' and is_default), '${b.services[0].id}', (select id from public.customers where business_id='${b.id}' and phone='${c2.phone}'),
      'TX-' || upper(substr(md5(random()::text),1,8)), 'no_show', now() - interval '5 days', now() - interval '5 days' + interval '30 minutes', now() - interval '5 days' + interval '30 minutes',
      jsonb_build_object('name','x','durationMinutes',30,'bufferMinutes',0,'priceCents',8000), 8000`);
    await loginAs(page, b.ownerEmail);
    const list = (await (await page.request.get("/api/owner/customers?q=" + encodeURIComponent(c2.name))).json()).items[0];
    expect(list.noShows60d).toBe(1);
    expect(list.noShows).toBe(1);
    await page.goto("/customers");
    await expect(page.getByTestId("customer-row").filter({ hasText: c2.name })).toContainText("לא הגיע/ה ב-60 הימים האחרונים");
    // owner flips the mark through the same API the agenda uses
    const id = sql(`select id from public.appointments where business_id='${b.id}' and status='no_show' and starts_at > now() - interval '10 days'`);
    const origin = new URL(page.url()).origin;
    const t = await page.request.post(`/api/owner/appointments/${id}/transition`, { data: { action: "complete" }, headers: { origin } });
    expect(t.status()).toBe(200);
    const after = (await (await page.request.get("/api/owner/customers?q=" + encodeURIComponent(c2.name))).json()).items[0];
    expect(after.noShows60d).toBe(0);
    expect(after.visits).toBe(2); // the March completed visit and the corrected one
  });

  test("detail, private notes, and the two-step erase that keeps the numbers (CMP-02)", async ({ page }) => {
    const b = await makeBusiness("barber");
    seedCustomers(b);
    seedDataset(b);
    const c4 = cust(4);
    const id = sql(`select id from public.customers where business_id='${b.id}' and phone='${c4.phone}'`);
    // customer 4 has a future confirmed appointment: erasing must wait
    sql(`insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, starts_at, ends_at, blocked_until, service_snapshot, price_cents)
      select '${b.id}', (select id from public.resources where business_id='${b.id}' and is_default), '${b.services[0].id}', '${id}',
      'TX-' || upper(substr(md5(random()::text),1,8)), 'confirmed', now() + interval '3 days', now() + interval '3 days' + interval '30 minutes', now() + interval '3 days' + interval '30 minutes',
      jsonb_build_object('name','x','durationMinutes',30,'bufferMinutes',0,'priceCents',8000), 8000`);
    await loginAs(page, b.ownerEmail);
    await page.goto(`/customers/${id}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(c4.name);
    await expect(page.getByTestId("customer-history").getByRole("listitem")).toHaveCount(4); // 03-29 pending, 03-31, 04-01, future
    await noOverflow(page);
    expect((await axe(page)).violations).toEqual([]);

    // notes: saved, limited to 500 characters, and refused for strangers
    await page.getByTestId("customer-notes").fill("מעדיף בוקר");
    await page.getByTestId("customer-notes-save").click();
    await expect.poll(() => sql(`select notes from public.customers where id='${id}'`)).toBe("מעדיף בוקר");
    const origin = new URL(page.url()).origin;
    const tooLong = await page.request.post(`/api/owner/customers/${id}/notes`, { data: { notes: "א".repeat(501) }, headers: { origin } });
    expect(tooLong.status()).toBe(422);
    const noOrigin = await page.request.post(`/api/owner/customers/${id}/notes`, { data: { notes: "x" } });
    expect(noOrigin.status()).toBe(403); // CSRF: a state change must come from this site

    // erase is blocked while a future appointment exists, and says why
    await page.getByTestId("anonymize").click();
    await page.getByTestId("anonymize-yes").click();
    await expect(page.getByText("ללקוח יש תורים עתידיים. בטלו אותם").first()).toBeVisible();
    expect(sql(`select full_name from public.customers where id='${id}'`)).toBe(c4.name);

    // cancel the future appointment, then erase
    sql(`update public.appointments set status='cancelled_by_business' where business_id='${b.id}' and starts_at > now()`);
    const before = await (await page.request.get(`/api/owner/reports?from=${FROM}&to=${TO}`)).json();
    await page.reload();
    await page.getByTestId("anonymize").click();
    await page.getByTestId("anonymize-yes").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("לקוח שנמחק");
    expect(sql(`select full_name, email is null, notes is null, anonymized_at is not null from public.customers where id='${id}'`)).toBe("לקוח שנמחק|t|t|t");
    expect(sql(`select count(*) from public.audit_log where business_id='${b.id}' and action='customer.anonymize'`)).toBe("1");
    // the personal details are gone from every surface, the numbers stay
    const detail = await (await page.request.get(`/api/owner/customers/${id}`)).json();
    expect(JSON.stringify(detail)).not.toContain(c4.name);
    expect(JSON.stringify(detail)).not.toContain(c4.phone);
    const afterReport = await (await page.request.get(`/api/owner/reports?from=${FROM}&to=${TO}`)).json();
    expect(afterReport.kpis).toEqual(before.kpis);
    // the second erase is a harmless no-op
    const again = await page.request.post(`/api/owner/customers/${id}/anonymize`, { headers: { origin } });
    expect(again.status()).toBe(200);
    expect((await again.json()).outcome).toBe("already");
  });

  test("another tenant's customer is invisible (SEC-01)", async ({ page }) => {
    const a = await makeBusiness("barber");
    const b = await makeBusiness("barber");
    seedCustomers(b);
    const foreign = sql(`select id from public.customers where business_id='${b.id}' limit 1`);
    await loginAs(page, a.ownerEmail);
    const origin = (u: string) => new URL(u).origin;
    await page.goto("/customers");
    expect((await page.request.get(`/api/owner/customers/${foreign}`)).status()).toBe(404);
    expect((await page.request.post(`/api/owner/customers/${foreign}/notes`, { data: { notes: "x" }, headers: { origin: origin(page.url()) } })).status()).toBe(404);
    expect((await page.request.post(`/api/owner/customers/${foreign}/anonymize`, { headers: { origin: origin(page.url()) } })).status()).toBe(404);
    expect(sql(`select notes is null from public.customers where id='${foreign}'`)).toBe("t");
    expect((await (await page.request.get("/api/owner/customers")).json()).total).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------- export
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"', i++);
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") (row.push(cell), (cell = ""));
    else if (ch === "\r" && text[i + 1] === "\n") (row.push(cell), rows.push(row), (row = []), (cell = ""), i++);
    else cell += ch;
  }
  if (cell || row.length) (row.push(cell), rows.push(row));
  return rows;
}

test.describe("export", () => {
  test.setTimeout(180_000);

  test("25,000 appointments stream out intact: BOM, header, one row per appointment, totals equal the database, formulas neutralised, audited (RPT-02/03)", async ({ page }) => {
    const b = await makeBusiness("barber");
    const tag = Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z]/g, "X").padEnd(3, "X");
    const evil = `=HYPERLINK("http://evil.example","x")`;
    seedCustomers(b, [`('${b.id}','${evil.replace(/'/g, "''")}','+972501008888')`, `('${b.id}','@SUM(1+1)','+972501008889')`]);
    sql(`insert into public.appointments (business_id, resource_id, service_id, customer_id, reference, status, starts_at, ends_at, blocked_until, service_snapshot, price_cents)
      select '${b.id}', (select id from public.resources where business_id='${b.id}' and is_default), '${b.services[0].id}',
             (select id from public.customers where business_id='${b.id}' order by phone offset (n % 8) limit 1),
             'TR-${tag}' || lpad(n::text, 5, '0'), case when n % 5 = 0 then 'no_show' when n % 7 = 0 then 'cancelled_by_customer' else 'completed' end,
             ('2019-01-01 08:00'::timestamp at time zone 'Asia/Jerusalem') + n * interval '30 minutes',
             ('2019-01-01 08:00'::timestamp at time zone 'Asia/Jerusalem') + n * interval '30 minutes' + interval '30 minutes',
             ('2019-01-01 08:00'::timestamp at time zone 'Asia/Jerusalem') + n * interval '30 minutes' + interval '30 minutes',
             jsonb_build_object('name','${b.services[0].name}','durationMinutes',30,'bufferMinutes',0,'priceCents',8000 + (n % 3) * 500), 8000 + (n % 3) * 500
      from generate_series(0, 24999) n`);
    const dbCount = Number(sql(`select count(*) from public.appointments where business_id='${b.id}'`));
    const dbCents = Number(sql(`select sum(price_cents) from public.appointments where business_id='${b.id}'`));
    expect(dbCount).toBe(25_000);
    await loginAs(page, b.ownerEmail);

    const res = await page.request.get("/api/owner/export/appointments?from=2019-01-01&to=2021-12-31", { headers: { "x-forwarded-for": fakeIp() } });
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("attachment");
    expect(res.headers()["cache-control"]).toContain("no-store");
    const text = await res.text();
    expect(text.charCodeAt(0)).toBe(0xfeff); // BOM so Excel reads Hebrew
    const rows = parseCsv(text.slice(1));
    expect(rows[0]).toEqual(["אסמכתא", "תאריך", "שעה", "שירות", "סטטוס", "מחיר (₪)", "לקוח", "טלפון", "מקור"]);
    expect(rows.length - 1).toBe(dbCount); // one row per appointment, none lost or repeated across page boundaries
    expect(new Set(rows.slice(1).map((r) => r[0])).size).toBe(dbCount);
    expect(rows.slice(1).every((r) => r.length === 9)).toBe(true);
    const cents = rows.slice(1).reduce((a, r) => a + Math.round(Number(r[5]) * 100), 0);
    expect(cents).toBe(dbCents);
    // chronological, and the first row is the first slot in LOCAL time
    const refs = rows.slice(1).map((r) => r[0]);
    expect([...refs].sort()).toEqual(refs); // references were numbered in time order
    const keys = rows.slice(1).map((r) => `${r[1]} ${r[2]}`);
    // local clock time repeats once a year when clocks go back (2019-10-27 01:00-02:00): both occurrences are exported, nothing is merged or dropped
    expect(keys.filter((k) => k === "2019-10-27 01:30")).toHaveLength(2);
    expect(rows[1][1]).toBe("2019-01-01");
    expect(rows[1][2]).toBe("08:00");
    // formulas are text, quotes are doubled, phone numbers keep their digits
    const names = new Set(rows.slice(1).map((r) => r[6]));
    expect(names.has(`'${evil}`)).toBe(true);
    expect(names.has("'@SUM(1+1)")).toBe(true);
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"",""x"")"`);
    expect(rows.slice(1).every((r) => !/^[=+\-@]/.test(r[6]) && !/^[=+\-@]/.test(r[3]))).toBe(true);
    // the export is on the record, with the row count
    expect(sql(`select meta->>'rows' from public.audit_log where business_id='${b.id}' and action='export.appointments'`)).toBe("25000");

    const cres = await page.request.get("/api/owner/export/customers", { headers: { "x-forwarded-for": fakeIp() } });
    expect(cres.status()).toBe(200);
    const crows = parseCsv((await cres.text()).slice(1));
    expect(crows.length - 1).toBe(Number(sql(`select count(*) from public.customers where business_id='${b.id}'`)));
    expect(sql(`select meta->>'rows' from public.audit_log where business_id='${b.id}' and action='export.customers'`)).toBe(String(crows.length - 1));
  });

  test("only managers export; strangers and other tenants get nothing; the rate limit holds; bad input is refused (SEC-01/08)", async ({ page, browser }) => {
    const b = await makeBusiness("barber");
    seedCustomers(b);
    // a staff member of the same business
    const staff = await signedInOwner("staff");
    sql(`insert into public.business_members (business_id, user_id, role) values ('${b.id}','${staff.userId}','staff')`);
    const ctx = await browser.newContext();
    const sp = await ctx.newPage();
    await loginAs(sp, staff.email);
    expect((await sp.request.get("/api/owner/export/customers")).status()).toBe(403);
    expect((await sp.request.get("/api/owner/export/appointments?from=2026-01-01&to=2026-01-31")).status()).toBe(403);
    const sOrigin = new URL(sp.url()).origin;
    expect((await sp.request.post(`/api/owner/customers/${sql(`select id from public.customers where business_id='${b.id}' limit 1`)}/anonymize`, { headers: { origin: sOrigin } })).status()).toBe(403);
    // …but staff do see the customers page and can use the notes (their job), without export links
    await sp.goto("/customers");
    await expect(sp.getByTestId("customer-row").first()).toBeVisible();
    await expect(sp.getByTestId("export-customers")).toHaveCount(0);
    await ctx.close();
    expect(sql(`select count(*) from public.audit_log where business_id='${b.id}' and action like 'export.%'`)).toBe("0");

    await loginAs(page, b.ownerEmail);
    expect((await page.request.get("/api/owner/export/payroll")).status()).toBe(404);
    expect((await page.request.get("/api/owner/export/appointments")).status()).toBe(422);
    expect((await page.request.get("/api/owner/export/appointments?from=2026-02-01&to=2026-01-01")).status()).toBe(422);
    // rate limit (lowered for the test): the third download in the window is refused with Retry-After
    const h = { "x-test-limit": "2", "x-forwarded-for": fakeIp() };
    expect((await page.request.get("/api/owner/export/customers", { headers: h })).status()).toBe(200);
    expect((await page.request.get("/api/owner/export/customers", { headers: h })).status()).toBe(200);
    const limited = await page.request.get("/api/owner/export/customers", { headers: h });
    expect(limited.status()).toBe(429);
    expect(Number(limited.headers()["retry-after"])).toBeGreaterThan(0);
    // refused downloads leave no audit rows: exactly the two that were served
    expect(sql(`select count(*) from public.audit_log where business_id='${b.id}' and action='export.customers'`)).toBe("2");
  });
});
