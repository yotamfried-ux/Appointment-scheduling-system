#!/usr/bin/env node
// Creates (or reuses) a demo owner and a published demo business on ANY Supabase project, so a fresh deployment can be tried straight away.
//   NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... SUPABASE_SECRET_KEY=... \
//   DEMO_EMAIL=demo@example.com node scripts/seed-demo.mjs --confirm-project=<ref>
// Safety: it refuses to run unless you repeat the project ref (so it can never be pointed at the wrong project by accident), never prints keys,
// prints the generated password ONCE, and is idempotent (a second run reuses the user and the business; --reset-password sets a new password).
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;
const email = (process.env.DEMO_EMAIL || "demo@example.com").trim().toLowerCase();
const siteUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
const args = process.argv.slice(2);
const confirm = args.find((a) => a.startsWith("--confirm-project="))?.split("=")[1];
const resetPassword = args.includes("--reset-password");

const fail = (m) => { console.error(`seed-demo: ${m}`); process.exit(1); };
if (!url || !publishable || !secret) fail("NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY and SUPABASE_SECRET_KEY are required");
const local = /(^|\/\/)(127\.0\.0\.1|localhost)(:|\/|$)/.test(url);
const ref = local ? "local" : new URL(url).hostname.split(".")[0];
if (confirm !== ref) fail(`refusing to run: pass --confirm-project=${ref} to confirm this is the project you mean (${local ? "local stack" : url})`);

const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
const password = `${randomBytes(9).toString("base64url")}-Aa1`;

// 1. the user (confirmed, so no mail is needed)
// The Auth admin API is called with the key in the `apikey` header ONLY. New-format secret keys (sb_secret_...) are not JWTs: the client library would also
// send them as `Authorization: Bearer`, which the Auth server refuses on admin routes. The gateway turns `apikey` into the service identity.
const adminApi = async (path, init = {}) => {
  const res = await fetch(`${url}/auth/v1/admin${path}`, { ...init, headers: { apikey: secret, "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body, message: body?.msg || body?.message || body?.error_description || `HTTP ${res.status}` };
};
let userId;
const created = await adminApi("/users", { method: "POST", body: JSON.stringify({ email, password, email_confirm: true }) });
let printedPassword = created.ok ? password : null;
if (!created.ok) {
  const listed = await adminApi("/users?page=1&per_page=1000");
  const existing = listed.body?.users?.find((u) => u.email?.toLowerCase() === email);
  if (!existing) fail(`could not create the user (HTTP ${created.status}, code ${created.body?.error_code ?? created.body?.code ?? "none"}). HTTP 401 usually means the secret key is wrong: it must be the one that starts with sb_secret_, not the publishable key`);
  userId = existing.id;
  if (resetPassword) {
    const r = await adminApi(`/users/${userId}`, { method: "PUT", body: JSON.stringify({ password, email_confirm: true }) });
    if (!r.ok) fail(`could not reset the password: ${r.message}`);
    printedPassword = password;
  }
} else {
  userId = created.body.id;
}

// 2. the business, created the way the app does it: as that user, through the same RPCs (RLS applies)
const user = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
const login = printedPassword ? await user.auth.signInWithPassword({ email, password: printedPassword }) : null;
let slug;
const { data: have } = await admin.from("business_members").select("business_id, businesses(slug)").eq("user_id", userId).limit(1);
if (have?.length) {
  slug = have[0].businesses.slug;
} else {
  if (!login || login.error) fail("the user exists but has no business and no new password was set: run again with --reset-password");
  const services = [
    { name: "תספורת גברים", durationMinutes: 30, priceNis: 80 },
    { name: "צבע", durationMinutes: 60, priceNis: 200 },
    { name: "עיצוב זקן", durationMinutes: 20, priceNis: 40 },
  ];
  const day = (weekday) => ({ weekday, open: weekday <= 4, windows: weekday <= 4 ? [{ from: "09:00", to: "18:00" }] : [] });
  const made = await user.rpc("create_business", { p_name: "מספרת הדגמה", p_kind: "barber", p_phone: "+972501234567", p_slug: "demo-barber", p_services: services, p_hours: [0, 1, 2, 3, 4, 5, 6].map(day) });
  if (made.error) fail(`could not create the business: ${made.error.message}`);
  const biz = made.data;
  const pub = await user.rpc("publish_business", { p_business: biz.id });
  if (pub.error) fail(`could not publish the business: ${pub.error.message}`);
  slug = biz.slug;
}

console.log("\nDemo ready.");
console.log(`  Sign in:   ${siteUrl || "<your site>"}/auth/login`);
console.log(`  E-mail:    ${email}`);
process.stdout.write(printedPassword ? `  Password:  ${printedPassword}   (shown once: store it now)\n` : "  Password:  unchanged (use --reset-password to set a new one)\n");
console.log(`  Booking page for customers:  ${siteUrl || "<your site>"}/book/${slug}`);
