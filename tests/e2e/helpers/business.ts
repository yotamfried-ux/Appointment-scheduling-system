import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, type APIRequestContext } from "@playwright/test";
import * as C from "../../../lib/api/contracts";
import { kindHours } from "../../../lib/lab/onboarding";
import { BUSINESS_KINDS, type BusinessKindId } from "../../../modules/tenancy/business-kind";

// Fast, UI-independent fixtures for the public-booking specs: the owner is created through the auth admin API (service role) and
// the business through the REAL create_business RPC as that owner. The browser-driven onboarding is covered by tenancy/catalog specs.
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SECRET = process.env.SUPABASE_SECRET_KEY!;
export const PASSWORD = "Correct-Horse-Battery-9";
export const rand = () => Math.random().toString(36).slice(2, 10).replace(/[0-9]/g, "x") + Math.random().toString(36).slice(2, 5).replace(/[0-9]/g, "y"); // ~11 letters: slugs must not collide across the many businesses a long-lived local database accumulates

export const admin = () => createClient(URL_, SECRET, { auth: { persistSession: false } });
export const anonClient = () => createClient(URL_, KEY, { auth: { persistSession: false } });

export async function signedInOwner(label: string): Promise<{ db: SupabaseClient; email: string; userId: string }> {
  const email = `${label}+${Date.now()}${Math.floor(Math.random() * 1e4)}@example.com`;
  const { data, error } = await admin().auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  expect(error).toBeNull();
  const db = anonClient();
  const r = await db.auth.signInWithPassword({ email, password: PASSWORD });
  expect(r.error).toBeNull();
  return { db, email, userId: data.user!.id };
}

export interface TestBusiness {
  slug: string;
  id: string;
  kind: BusinessKindId;
  db: SupabaseClient;
  ownerEmail: string;
  services: { id: string; name: string; duration_minutes: number; buffer_minutes: number }[];
}

export async function makeBusiness(kind: BusinessKindId = "barber", opts: { publish?: boolean; owner?: Awaited<ReturnType<typeof signedInOwner>> } = {}): Promise<TestBusiness> {
  const owner = opts.owner ?? (await signedInOwner(`own-${kind}`));
  const k = BUSINESS_KINDS[kind];
  const slug = `e2e-${kind}-${rand()}`;
  const services = k.presets.filter((p) => !p.group).map((p) => ({ name: p.name, durationMinutes: p.durationMinutes, priceNis: p.priceNis }));
  const created = await owner.db.rpc("create_business", { p_name: `${k.sample.businessName} ${slug.slice(-4)}`, p_kind: kind, p_phone: "+972501234567", p_slug: slug, p_services: services, p_hours: kindHours(kind) });
  expect(created.error, JSON.stringify(created.error)).toBeNull();
  const id = (created.data as { id: string }).id;
  if (opts.publish !== false) expect((await owner.db.rpc("publish_business", { p_business: id })).error).toBeNull();
  const svc = (await owner.db.from("services").select("id, name, duration_minutes, buffer_minutes").eq("business_id", id).order("position")).data!;
  return { slug, id, kind, db: owner.db, ownerEmail: owner.email, services: svc };
}

export const todayLocal = (offsetDays = 0, tz = "Asia/Jerusalem") =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + offsetDays * 86_400_000));

const RUN = Math.random().toString(36).slice(2, 8); // per-process, so the per-address mail limit (8/hour) is not shared between runs
export const customer = (n = 1, over: Record<string, unknown> = {}) => ({ fullName: `לקוח בדיקה ${n}`, phone: `+97250${String(1000000 + n).slice(-7)}`, email: `c${n}.${RUN}@example.com`, ...over });

/** Sign the owner in through the real login form (cookies are set by the app, exactly as for a person). */
export async function loginAs(page: import("@playwright/test").Page, email: string) {
  await page.goto("/auth/login");
  await page.getByLabel("אימייל").fill(email);
  await page.getByLabel("סיסמה", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "כניסה", exact: true }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/);
}

export const fakeIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

/** A customer books through the real public API (own IP so the per-IP limits never interfere). */
export async function publicBook(request: APIRequestContext, b: TestBusiness, date: string, time: string, n: number, serviceIndex = 0, email?: string | null) {
  const r = await request.post(`/api/public/${b.slug}/bookings`, {
    data: { serviceId: b.services[serviceIndex].id, date, time, location: "business", customer: email === null ? { fullName: customer(n).fullName, phone: customer(n).phone } : { ...customer(n), ...(email ? { email } : {}) }, intake: {} },
    headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `idem-${Math.random().toString(36).slice(2)}-${n}` },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).booking as { id: string; date: string; time: string };
}

/** The `nth` bookable day (0 = first). Specs that depend on global jobs pick distinct days, two or more apart, so their time windows never overlap. */
/** GET with a few retries on connection resets only: a keep-alive socket the server closed a moment earlier is a test-infrastructure race, not an app answer. */
async function getRetrying(request: APIRequestContext, url: string) {
  for (let i = 0; ; i++) {
    try {
      return await request.get(url);
    } catch (e) {
      if (i >= 3 || !/ECONNRESET|socket hang up/i.test(String(e))) throw e;
    }
  }
}

export async function firstDayWithSlots(request: APIRequestContext, b: TestBusiness, nth = 0, minSlots = 12) {
  const av = C.AvailabilityResponse.parse(await (await getRetrying(request, `/api/public/${b.slug}/availability?service=${b.services[0].id}&from=${todayLocal(2)}&days=30`)).json());
  const slotsOf = async (date: string) => C.SlotsResponse.parse(await (await getRetrying(request, `/api/public/${b.slug}/slots?service=${b.services[0].id}&date=${date}`)).json()).slots.map((s) => s.time);
  // Tests index into the day's times (times[8], times[9]...). The first bookable day can be a short day (Friday, a holiday-like window), so take the nth day that has
  // at least `minSlots` times (a weekday-dependent failure the first weekday it fell on a Friday). If no day is long enough, the longest one wins.
  let seen = 0;
  let longest: { date: string; times: string[] } | null = null;
  for (const d of av.days.filter((x) => x.freeSlots > 0)) {
    const times = await slotsOf(d.date);
    if (!longest || times.length > longest.times.length) longest = { date: d.date, times };
    if (times.length >= minSlots) {
      if (seen === nth) return { date: d.date, times };
      seen++;
    }
  }
  if (!longest) throw new Error("no bookable day in the next 30 days");
  return longest;
}

import { execFileSync } from "node:child_process";
/** Time-travel and inspection against the local database (the same container the app uses). Test-only. */
export function sql(query: string): string {
  return execFileSync("docker", ["exec", "supabase_db_appointment-scheduling-system", "psql", "-U", "postgres", "-At", "-c", query], { encoding: "utf8" }).trim();
}
