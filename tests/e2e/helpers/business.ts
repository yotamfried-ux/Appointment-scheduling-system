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
export const rand = () => Math.random().toString(36).slice(2, 8).replace(/[0-9]/g, "x");

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

export const customer = (n = 1, over: Record<string, unknown> = {}) => ({ fullName: `לקוח בדיקה ${n}`, phone: `+97250${String(1000000 + n).slice(-7)}`, email: `c${n}@example.com`, ...over });

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
export async function publicBook(request: APIRequestContext, b: TestBusiness, date: string, time: string, n: number, serviceIndex = 0) {
  const r = await request.post(`/api/public/${b.slug}/bookings`, {
    data: { serviceId: b.services[serviceIndex].id, date, time, location: "business", customer: customer(n), intake: {} },
    headers: { "x-forwarded-for": fakeIp(), "idempotency-key": `idem-${Math.random().toString(36).slice(2)}-${n}` },
  });
  expect(r.status(), await r.text()).toBe(201);
  return (await r.json()).booking as { id: string; date: string; time: string };
}

export async function firstDayWithSlots(request: APIRequestContext, b: TestBusiness) {
  const av = C.AvailabilityResponse.parse(await (await request.get(`/api/public/${b.slug}/availability?service=${b.services[0].id}&from=${todayLocal(2)}&days=14`)).json());
  const date = av.days.find((d) => d.freeSlots > 0)!.date;
  const sl = C.SlotsResponse.parse(await (await request.get(`/api/public/${b.slug}/slots?service=${b.services[0].id}&date=${date}`)).json());
  return { date, times: sl.slots.map((s) => s.time) };
}
