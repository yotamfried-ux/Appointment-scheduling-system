import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { expect, test, type APIRequestContext, type Browser } from "@playwright/test";
import { fakeIp, firstDayWithSlots, loginAs, makeBusiness, publicBook, signedInOwner, sql, type TestBusiness } from "./helpers/business";

// docs/05 §12.4 — the authorization matrix, run against every owner/admin route on the real stack: anonymous · owner A · staff of A · owner B (another tenant) ·
// a member who was removed (valid session, no business). A route that is not in this table fails the build, so a new endpoint cannot ship without being classified.
type Actor = "anonymous" | "owner" | "staff" | "foreign" | "removed";
const ORIGIN = "http://127.0.0.1:3100";

interface Ctx {
  a: TestBusiness;
  b: TestBusiness;
  date: string;
  times: string[];
  serviceId: string;
  appt: { owner: string; staff: string; target: string };
  cust: { target: string; owner: string };
  wl: { target: string; owner: string; staff: string };
}

interface Route {
  /** path of the route file under app/api, as Next names it */
  file: string;
  method: "GET" | "POST";
  url: (c: Ctx, who: Actor) => string;
  body?: (c: Ctx, who: Actor) => unknown;
  /** needs the owner/admin role (staff get 403) */
  admin?: boolean;
  /** acts on an object by id ⇒ another tenant gets 404, never data and never "forbidden" */
  byId?: boolean;
  /** what the owner gets on success */
  ok: number[];
  /** the `foreign` actor owns another business: for self-scoped routes this is a legitimate call on THEIR data */
  foreignSelf?: number[];
  /** staff are refused with this status instead of the default (the database answers 404 for a role that is too low, same as for an object that is not yours) */
  staffStatus?: number;
  /** after the call, the target must be unchanged */
  targetKey?: "appt" | "cust" | "wl";
}

const idOf = (c: Ctx, who: Actor, k: "appt" | "cust" | "wl") => {
  const g = c[k] as Record<string, string>;
  return who === "owner" ? g.owner : who === "staff" && g.staff ? g.staff : g.target; // outsiders always go after the target
};

const ROUTES: Route[] = [
  { file: "owner/appointments/route.ts", method: "GET", url: (c) => `/api/owner/appointments?date=${c.date}`, ok: [200] },
  {
    file: "owner/appointments/route.ts", method: "POST", url: () => "/api/owner/appointments",
    body: (c, who) => ({ serviceId: c.serviceId, date: c.date, time: c.times[who === "owner" ? 3 : 4], customer: { fullName: `ידני ${who}`, phone: who === "owner" ? "0501234501" : "0501234502" } }),
    ok: [201],
  },
  { file: "owner/appointments/[id]/transition/route.ts", method: "POST", url: (c, w) => `/api/owner/appointments/${idOf(c, w, "appt")}/transition`, body: () => ({ action: "cancel" }), byId: true, ok: [200], staffStatus: 404, targetKey: "appt" },
  { file: "owner/customers/route.ts", method: "GET", url: () => "/api/owner/customers", ok: [200] },
  { file: "owner/customers/[id]/route.ts", method: "GET", url: (c) => `/api/owner/customers/${c.cust.target}`, byId: true, ok: [200] },
  { file: "owner/customers/[id]/notes/route.ts", method: "POST", url: (c) => `/api/owner/customers/${c.cust.target}/notes`, body: () => ({ notes: "בדיקת הרשאות" }), byId: true, ok: [200], targetKey: "cust" },
  { file: "owner/customers/[id]/policy/route.ts", method: "POST", url: (c, w) => `/api/owner/customers/${idOf(c, w, "cust")}/policy`, body: () => ({ override: true }), admin: true, byId: true, ok: [200], targetKey: "cust" },
  { file: "owner/customers/[id]/anonymize/route.ts", method: "POST", url: (c, w) => `/api/owner/customers/${idOf(c, w, "cust")}/anonymize`, admin: true, byId: true, ok: [200], targetKey: "cust" },
  { file: "owner/reports/route.ts", method: "GET", url: () => "/api/owner/reports?from=2026-01-01&to=2026-01-31", ok: [200] },
  { file: "owner/export/[kind]/route.ts", method: "GET", url: () => "/api/owner/export/customers", admin: true, ok: [200], foreignSelf: [200] },
  { file: "owner/version/route.ts", method: "GET", url: () => "/api/owner/version", ok: [200] },
  { file: "owner/billing/route.ts", method: "GET", url: () => "/api/owner/billing", ok: [200] },
  { file: "owner/billing/checkout/route.ts", method: "POST", url: () => "/api/owner/billing/checkout", body: () => ({ planId: "pro" }), admin: true, ok: [200], foreignSelf: [200] },
  { file: "owner/billing/portal/route.ts", method: "POST", url: () => "/api/owner/billing/portal", admin: true, ok: [200], foreignSelf: [200] },
  { file: "owner/waitlist/[id]/remove/route.ts", method: "POST", url: (c, w) => `/api/owner/waitlist/${idOf(c, w, "wl")}/remove`, byId: true, ok: [200], targetKey: "wl" },
  { file: "owner/waitlist/[id]/offer/route.ts", method: "POST", url: (c) => `/api/owner/waitlist/${c.wl.target}/offer`, body: (c) => ({ time: c.times[1] }), byId: true, ok: [200, 409], targetKey: "wl" },
  { file: "owner/waitlist/settings/route.ts", method: "POST", url: () => "/api/owner/waitlist/settings", body: () => ({ autoOffer: true }), admin: true, ok: [200], foreignSelf: [200] },
  { file: "admin/billing/override/route.ts", method: "POST", url: () => "/api/admin/billing/override", body: (c) => ({ action: "set", businessId: c.a.id, key: "export", bool: true, reason: "בדיקת מטריצת הרשאות" }), admin: true, ok: [403], foreignSelf: [403] },
  { file: "admin/billing/subscription/route.ts", method: "POST", url: () => "/api/admin/billing/subscription", body: (c) => ({ businessId: c.a.id, planId: "pro", status: "active", reason: "בדיקת מטריצת הרשאות" }), admin: true, ok: [403], foreignSelf: [403] },
];

/** Routes that are intentionally not session-authenticated, each with its own mechanism and its own test below. */
const OTHER: Record<string, string> = {
  "health/route.ts": "public liveness",
  "ready/route.ts": "public readiness",
  "jobs/health/route.ts": "cron secret",
  "jobs/maintenance/route.ts": "cron secret",
  "jobs/outbox/route.ts": "cron secret",
  "jobs/reminders/route.ts": "cron secret",
  "jobs/waitlist/route.ts": "cron secret",
  "webhooks/billing/[provider]/route.ts": "signed payload",
  "webhooks/resend/route.ts": "signed payload",
  "public/[slug]/availability/route.ts": "capability: published business",
  "public/[slug]/bookings/route.ts": "capability: published business",
  "public/[slug]/services/route.ts": "capability: published business",
  "public/[slug]/slots/route.ts": "capability: published business",
  "public/[slug]/waitlist/route.ts": "capability: published business",
};

function walk(dir: string, out: string[] = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (n === "route.ts") out.push(p);
  }
  return out;
}

test("coverage: every API route is classified here (a new endpoint without a row fails)", () => {
  const all = walk(join(process.cwd(), "app", "api")).map((p) => relative(join(process.cwd(), "app", "api"), p).split(sep).join("/"));
  const known = new Set([...ROUTES.map((r) => r.file), ...Object.keys(OTHER)]);
  const lab = all.filter((f) => f.startsWith("lab/")); // the design-lab API exists only outside production (labEnabled) and is covered by its own specs
  const unclassified = all.filter((f) => !known.has(f) && !f.startsWith("lab/"));
  expect(unclassified, "unclassified routes").toEqual([]);
  const stale = [...known].filter((f) => !all.includes(f));
  expect(stale, "classified routes that no longer exist").toEqual([]);
  expect(lab.length).toBeGreaterThan(0);
});

async function actor(browser: Browser, email: string) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, email);
  return { request: ctx.request, close: () => ctx.close() };
}

async function call(req: APIRequestContext, r: Route, c: Ctx, who: Actor, opts: { origin?: boolean } = {}) {
  const headers: Record<string, string> = { "x-forwarded-for": fakeIp() };
  if (r.method === "POST" && opts.origin !== false) headers.origin = ORIGIN;
  return r.method === "GET" ? req.get(r.url(c, who), { headers }) : req.post(r.url(c, who), { data: r.body?.(c, who) ?? {}, headers });
}

test.describe("permission matrix (SEC-01, SEC-02, SEC-05, docs/05 §12.4)", () => {
  test.setTimeout(240_000);

  test("every owner and admin route, for every kind of caller", async ({ browser, request }) => {
    const a = await makeBusiness("barber");
    const b = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, a);
    const book = async (n: number, t: number) => (await publicBook(request, a, f.date, f.times[t], n)).id;
    const appt = { owner: await book(1, 0), staff: await book(2, 1), target: await book(3, 2) };
    // customers: the one every caller attacks, and one the owner may erase (no appointments)
    const custOf = (id: string) => sql(`select customer_id from public.appointments where id='${id}'`);
    const cust = { target: custOf(appt.target), owner: sql(`insert into public.customers (business_id, full_name, phone) values ('${a.id}','למחיקה','+972509990001') returning id`).split("\n")[0] };
    const join = async (n: number) => {
      const r = await request.post(`/api/public/${a.slug}/waitlist`, { data: { serviceId: a.services[0].id, date: f.date, customer: { fullName: `ממתין ${n}`, phone: `+9725088800${n}0`, email: `m${n}${Date.now()}@example.com` } }, headers: { "x-forwarded-for": fakeIp() } });
      expect(r.status(), await r.text()).toBe(201);
      return (await r.json()).id as string;
    };
    const wl = { target: await join(1), owner: await join(2), staff: await join(3) };
    const c: Ctx = { a, b, date: f.date, times: f.times, serviceId: a.services[0].id, appt, cust, wl };

    // the callers
    const staffUser = await signedInOwner("matrix-staff");
    sql(`insert into public.business_members (business_id, user_id, role) values ('${a.id}','${staffUser.userId}','staff')`);
    const removedUser = await signedInOwner("matrix-removed");
    sql(`insert into public.business_members (business_id, user_id, role) values ('${a.id}','${removedUser.userId}','staff')`);
    const who = {
      owner: await actor(browser, a.ownerEmail),
      staff: await actor(browser, staffUser.email),
      foreign: await actor(browser, b.ownerEmail),
      removed: await actor(browser, removedUser.email),
    };
    sql(`delete from public.business_members where user_id='${removedUser.userId}'`); // session still valid, membership gone

    const failures: string[] = [];
    const check = (label: string, got: number, want: number | number[]) => {
      const ok = Array.isArray(want) ? want.includes(got) : got === want;
      if (!ok) failures.push(`${label}: got ${got}, wanted ${Array.isArray(want) ? want.join("|") : want}`);
    };

    for (const r of ROUTES) {
      const name = `${r.method} ${r.file}`;
      // anonymous: 401 and nothing else
      check(`${name} · anonymous`, (await call(request, r, c, "anonymous")).status(), 401);
      // a member who was removed has a valid session but no business: refused, and told nothing
      const removed = await call(who.removed.request, r, c, "removed");
      check(`${name} · removed member`, removed.status(), 403);
      // another tenant
      const fr = await call(who.foreign.request, r, c, "foreign");
      if (r.byId) check(`${name} · other tenant`, fr.status(), 404);
      else if (r.admin) check(`${name} · other tenant (own data)`, fr.status(), r.foreignSelf ?? 200);
      else check(`${name} · other tenant (own data)`, fr.status(), r.method === "POST" ? [409, 422, 403, 404] : 200);
      // staff
      const st = await call(who.staff.request, r, c, "staff");
      if (r.staffStatus) check(`${name} · staff (approving/cancelling needs the admin role)`, st.status(), r.staffStatus);
      else if (r.admin) check(`${name} · staff`, st.status(), 403);
      else if (r.file === "owner/appointments/route.ts" && r.method === "POST") check(`${name} · staff`, st.status(), 201);
      else check(`${name} · staff`, st.status(), r.ok);
      // owner
      const ow = await call(who.owner.request, r, c, "owner");
      check(`${name} · owner`, ow.status(), r.ok);
      // CSRF: any state change without a same-site Origin is refused
      if (r.method === "POST") {
        const noOrigin = await call(who.owner.request, r, c, "owner", { origin: false });
        check(`${name} · owner without Origin`, noOrigin.status(), 403);
        const evil = r.method === "POST" ? await who.owner.request.post(r.url(c, "owner"), { data: r.body?.(c, "owner") ?? {}, headers: { origin: "https://evil.example" } }) : null;
        if (evil) check(`${name} · owner with a foreign Origin`, evil.status(), 403);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);

    // what other tenants and strangers attacked must be exactly as it was
    expect(sql(`select status from public.appointments where id='${appt.target}'`), "target appointment untouched").toBe("confirmed");
    expect(sql(`select coalesce(notes,'') || '|' || (anonymized_at is null)::text from public.customers where id='${cust.target}'`)).toBe("בדיקת הרשאות|true"); // only the owner/staff notes call wrote; the erase never reached it
    expect(sql(`select status from public.waitlist_entries where id='${wl.target}'`), "target waitlist entry not removed by outsiders").toMatch(/waiting|offered/);
    expect(sql(`select count(*) from public.audit_log where business_id='${b.id}' and action in ('customer.anonymize','waitlist.remove')`), "no action was recorded against the other tenant").toBe("0");
    // the owner's successful calls really happened
    expect(sql(`select status from public.appointments where id='${appt.owner}'`)).toBe("cancelled_by_business");
    expect(sql(`select anonymized_at is not null from public.customers where id='${cust.owner}'`)).toBe("t");
    // the other tenant's own data never contained ours
    const exp = await who.foreign.request.get("/api/owner/export/customers", { headers: { "x-forwarded-for": fakeIp() } });
    expect(await exp.text()).not.toContain("לקוח בדיקה");
    expect(JSON.stringify(await (await who.foreign.request.get("/api/owner/customers")).json())).not.toContain("לקוח בדיקה");
    expect(JSON.stringify(await (await who.foreign.request.get(`/api/owner/appointments?date=${f.date}`)).json())).not.toContain(appt.target);
    for (const k of Object.values(who)) await k.close();
  });
});

test.describe("routes that are not session-authenticated", () => {
  test("cron endpoints refuse everyone without the secret, including a wrong one", async ({ request }) => {
    for (const name of Object.keys(OTHER).filter((k) => k.startsWith("jobs/"))) {
      const url = `/api/${name.replace("/route.ts", "")}`;
      expect((await request.get(url)).status(), `${url} no secret`).toBe(401);
      expect((await request.get(url, { headers: { authorization: "Bearer wrong-secret-wrong-secret" } })).status(), `${url} wrong secret`).toBe(401);
      expect((await request.get(url, { headers: { authorization: "Basic abc" } })).status(), `${url} wrong scheme`).toBe(401);
      expect((await request.get(url, { headers: { authorization: "Bearer" } })).status(), `${url} empty bearer`).toBe(401);
    }
  });

  test("webhooks reject unsigned or wrongly signed payloads", async ({ request }) => {
    for (const url of ["/api/webhooks/billing/fake", "/api/webhooks/resend"]) {
      const r = await request.post(url, { data: JSON.stringify({ hello: "world" }), headers: { "content-type": "application/json" } });
      expect([400, 401], url).toContain(r.status());
      const r2 = await request.post(url, { data: "{}", headers: { "content-type": "application/json", "x-billing-signature": "t=1,v1=" + "0".repeat(64), "svix-id": "x", "svix-timestamp": "1", "svix-signature": "v1,AAAA" } });
      expect([400, 401], `${url} bad signature`).toContain(r2.status());
    }
  });

  test("the public API reveals nothing about unknown or unpublished businesses (same 404 for both) and public routes never accept a tenant id", async ({ request }) => {
    const draft = await makeBusiness("barber", { publish: false });
    for (const slug of ["no-such-business-xyz", draft.slug]) {
      for (const p of ["services", "availability?service=x&from=2026-01-01&days=1", "slots?service=x&date=2026-01-01"]) {
        const r = await request.get(`/api/public/${slug}/${p}`);
        expect(r.status(), `${slug} ${p}`).toBe(404);
        expect(await r.text(), "identical body for unknown and unpublished").not.toContain(draft.id);
      }
    }
    const live = await makeBusiness("barber");
    const f = await firstDayWithSlots(request, live);
    const other = await makeBusiness("barber");
    // a business id smuggled into the body is rejected or ignored, never obeyed (SEC-02)
    const r = await request.post(`/api/public/${live.slug}/bookings`, {
      data: { serviceId: live.services[0].id, date: f.date, time: f.times[0], location: "business", customer: { fullName: "תוקף", phone: "0501110001" }, intake: {}, businessId: other.id, business_id: other.id },
      headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `k-${Math.random()}` },
    });
    expect([201, 422]).toContain(r.status());
    expect(sql(`select count(*) from public.appointments where business_id='${other.id}'`), "nothing landed in the other business").toBe("0");
  });

  test("robots.txt exists, welcomes the public pages and keeps crawlers out of every private surface", async ({ request }) => {
    const r = await request.get("/robots.txt");
    expect(r.status()).toBe(200);
    expect(r.headers()["content-type"]).toContain("text/plain");
    const body = await r.text();
    for (const p of ["/api/", "/dashboard", "/customers", "/reports", "/settings", "/booking/", "/waitlist/", "/legal/"]) expect(body, p).toContain(`Disallow: ${p}`);
    expect(body).toContain("Allow: /privacy");
  });

  test("health and readiness are public, tiny and say nothing about the system; readiness actually checks the database", async ({ request }) => {
    const h = await request.get("/api/health");
    expect(h.status()).toBe(200);
    expect(await h.json()).toEqual({ status: "ok" });
    const r = await request.get("/api/ready");
    expect(r.status()).toBe(200);
    expect(await r.json()).toEqual({ status: "ready" });
    expect(r.headers()["cache-control"]).toContain("no-store");
  });
});
