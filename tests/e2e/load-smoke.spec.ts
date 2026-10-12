import { expect, test, type APIRequestContext } from "@playwright/test";
import { customer, fakeIp, firstDayWithSlots, loginAs, makeBusiness, sql } from "./helpers/business";

// OPS-01 / OPS-05, a SMOKE, not a benchmark: a local machine with one database says nothing about production capacity. What it can prove is that concurrency
// never breaks correctness (no double booking, no 5xx) and that nothing is wildly slow (a regression such as an N+1 query would show here first).
// Latency is PRINTED, not asserted: on a shared 4-core machine that also runs the app, the database and the test runner, a bound would only measure the machine and
// make CI flaky. Serial baselines (one request at a time) are recorded in docs/evidence/security/qualification.md instead.
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];
const timed = async <T>(fn: () => Promise<T>) => {
  const t = performance.now();
  const r = await fn();
  return { r, ms: performance.now() - t };
};
async function pool<T>(n: number, concurrency: number, task: (i: number) => Promise<T>) {
  const out: T[] = new Array(n);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => { for (let i = next++; i < n; i = next++) out[i] = await task(i); }));
  return out;
}

test.describe("load smoke (local, one database)", () => {
  test.describe.configure({ mode: "serial" }); // one at a time within this file: they would otherwise compete for the same CPU and distort each other
  test.setTimeout(180_000);

  test("300 public reads at concurrency 30: all succeed, no 5xx, sane latency", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const urls = [`/api/public/${b.slug}/services`, `/api/public/${b.slug}/slots?service=${b.services[0].id}&date=${f.date}`, `/api/public/${b.slug}/availability?service=${b.services[0].id}&from=${f.date}&days=30`];
    const res = await pool(300, 30, (i) => timed(() => request.get(urls[i % 3], { headers: { "x-forwarded-for": fakeIp() } })));
    const statuses = res.map((x) => x.r.status());
    const lat = res.map((x) => x.ms);
    console.log(`public reads: n=300 c=30 p50=${pct(lat, 50).toFixed(0)}ms p95=${pct(lat, 95).toFixed(0)}ms max=${Math.max(...lat).toFixed(0)}ms statuses=${JSON.stringify(Object.fromEntries([...new Set(statuses)].map((s) => [s, statuses.filter((x) => x === s).length])))}`);
    expect(statuses.filter((s) => s >= 500), "no 5xx").toEqual([]);
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  test("60 customers fight for 12 slots: exactly 12 win, 48 are told 409, the database holds exactly 12 and no two overlap", async ({ request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const slots = f.times.slice(0, 12);
    const attempt = (i: number) => timed(() =>
      request.post(`/api/public/${b.slug}/bookings`, {
        data: { serviceId: b.services[0].id, date: f.date, time: slots[i % 12], location: "business", customer: customer(1000 + i), intake: {} },
        headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `load-${i}-${Math.random()}` },
      }),
    );
    const res = await pool(60, 60, attempt);
    const st = res.map((x) => x.r.status());
    const lat = res.map((x) => x.ms);
    console.log(`booking race: n=60 c=60 p50=${pct(lat, 50).toFixed(0)}ms p95=${pct(lat, 95).toFixed(0)}ms max=${Math.max(...lat).toFixed(0)}ms 201=${st.filter((s) => s === 201).length} 409=${st.filter((s) => s === 409).length} other=${st.filter((s) => s !== 201 && s !== 409).length}`);
    expect(st.filter((s) => s !== 201 && s !== 409), "only success or a clean conflict").toEqual([]);
    expect(st.filter((s) => s === 201)).toHaveLength(12);
    expect(sql(`select count(*) from public.appointments where business_id='${b.id}'`)).toBe("12");
    expect(sql(`select count(*) from public.appointments a join public.appointments c on a.business_id=c.business_id and a.id<c.id and tstzrange(a.starts_at,a.blocked_until) && tstzrange(c.starts_at,c.blocked_until) where a.business_id='${b.id}'`), "no overlaps").toBe("0");
  });

  test("owners keep reading their agenda while bookings arrive: no 5xx, every booking shows up", async ({ browser, request }) => {
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, b);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginAs(page, b.ownerEmail);
    const readers = pool(60, 10, () => timed(() => page.request.get(`/api/owner/appointments?date=${f.date}`)));
    const n = Math.min(20, f.times.length);
    const writers = pool(n, 5, (i) => request.post(`/api/public/${b.slug}/bookings`, {
      data: { serviceId: b.services[0].id, date: f.date, time: f.times[i], location: "business", customer: customer(2000 + i), intake: {} },
      headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `mix-${i}-${Math.random()}` },
    }));
    const [reads, writes] = await Promise.all([readers, writers]);
    const lat = reads.map((x) => x.ms);
    console.log(`owner reads during writes: n=60 c=10 p50=${pct(lat, 50).toFixed(0)}ms p95=${pct(lat, 95).toFixed(0)}ms max=${Math.max(...lat).toFixed(0)}ms`);
    expect(reads.map((x) => x.r.status()).filter((s) => s >= 500)).toEqual([]);
    expect(writes.map((w) => w.status())).toEqual(Array(n).fill(201));
    const agenda = await (await page.request.get(`/api/owner/appointments?date=${f.date}`)).json();
    expect(agenda.appointments).toHaveLength(n);
    await ctx.close();
  });

  test("5 overlapping runs of every job finish cleanly and change nothing twice", async ({ request }: { request: APIRequestContext }) => {
    const auth = { authorization: `Bearer ${process.env.CRON_SECRET ?? "e2e-cron-secret-0123456789abcdef"}` };
    for (const job of ["outbox", "waitlist", "maintenance"]) {
      const rs = await Promise.all(Array.from({ length: 5 }, () => request.post(`/api/jobs/${job}`, { headers: auth })));
      expect(rs.map((r) => r.status()), job).toEqual(Array(5).fill(200));
    }
    const h = await request.get("/api/jobs/health", { headers: auth });
    const body = await h.json();
    expect(body.jobs.find((j: { job: string }) => j.job === "outbox").stale).toBe(false);
    expect(body.jobs.find((j: { job: string }) => j.job === "maintenance").stale).toBe(false);
  });
});
