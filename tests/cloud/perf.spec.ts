import { expect, test, type APIRequestContext } from "@playwright/test";

// Speed of the deployed system as a visitor's browser sees it: time until the full response arrived, median of several requests per address.
// /api/health does no database work, so it is the floor (distance from this machine + the platform); the other rows minus that floor is what the application and the database add.
// Budgets are deliberately generous (this runs from a GitHub runner in another continent); a row over budget fails, and the table is always printed.
const SLUG = process.env.CLOUD_SLUG ?? "demo-barber";
const OWNER = process.env.CLOUD_OWNER_EMAIL;
const PASSWORD = process.env.CLOUD_OWNER_PASSWORD;
const N = 7;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function time(request: APIRequestContext, path: string): Promise<{ ms: number; status: number; timing: string }[]> {
  const out: { ms: number; status: number; timing: string }[] = [];
  await request.get(path); // warm-up: a cold function start is a different question
  for (let i = 0; i < N; i++) {
    const t = performance.now();
    const r = await request.get(path);
    await r.body();
    out.push({ ms: performance.now() - t, status: r.status(), timing: r.headers()["server-timing"] ?? "" });
  }
  return out;
}

test("how fast are the main pages and calls", async ({ request, page }, info) => {
  const rows: { name: string; ms: number; max: number; budget: number; status: number; server: string }[] = [];
  const measure = async (r: APIRequestContext, name: string, path: string, budgetOverFloor: number, floor: number) => {
    const xs = await time(r, path);
    rows.push({ name, ms: Math.round(median(xs.map((x) => x.ms))), max: Math.round(Math.max(...xs.map((x) => x.ms))), budget: floor + budgetOverFloor, status: xs[0].status, server: xs[xs.length - 1].timing });
  };

  const floorMs = median((await time(request, "/api/health")).map((x) => x.ms));
  rows.push({ name: "floor: /api/health (no database)", ms: Math.round(floorMs), max: Math.round(floorMs), budget: 0, status: 200, server: "" });

  const services = (await (await request.get(`/api/public/${SLUG}/services`)).json()) as { services: { id: string }[] };
  const svc = services.services[0].id;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(new Date());

  await measure(request, "landing page", "/", 500, floorMs);
  await measure(request, "booking page (server-rendered)", `/book/${SLUG}`, 600, floorMs);
  await measure(request, "services", `/api/public/${SLUG}/services`, 500, floorMs);
  await measure(request, "availability, 28 days", `/api/public/${SLUG}/availability?service=${svc}&from=${today}&days=28`, 600, floorMs);

  if (OWNER && PASSWORD) {
    await page.goto("/auth/login");
    await page.getByLabel("אימייל").fill(OWNER);
    await page.getByLabel("סיסמה", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "כניסה", exact: true }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
    const r = page.request;
    await measure(r, "owner: dashboard page", "/dashboard", 900, floorMs);
    await measure(r, "owner: agenda data (api)", `/api/owner/appointments?date=${today}`, 600, floorMs);
    for (const p of ["customers", "reports", "settings/services", "settings/team", "settings/billing"]) await measure(r, `owner: /${p}`, `/${p}`, 900, floorMs);
  }

  const table = ["| address | median ms | slowest ms | status | server time (API calls only: app / waiting for the database) |", "|---|---|---|---|---|", ...rows.map((r) => `| ${r.name} | ${r.ms} | ${r.max} | ${r.status} | ${r.server} |`)].join("\n");
  console.log(`\nSPEED (${info.project.name}, median of ${N}, from the test machine)\n${table}\n`);
  info.annotations.push({ type: "speed", description: table });
  const over = rows.filter((r) => r.budget > 0 && r.ms > r.budget).map((r) => `${r.name}: ${r.ms} ms > ${r.budget} ms`);
  expect(over, "rows over their budget (floor + allowance)").toEqual([]);
});
