#!/usr/bin/env node
// Seeds the LOCAL stack for a security scan: two separate businesses with their own owners (needed for cross-tenant tests), each published, plus a few bookings.
// Writes strix-credentials.txt (local test accounts only; the stack and the data are thrown away after the run). Needs the env from scripts/local-env.sh.
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, SECRET = process.env.SUPABASE_SECRET_KEY;
if (!URL_ || !KEY || !SECRET) throw new Error("run `source scripts/local-env.sh` first");
const PASSWORD = "Scan-Account-Pass-2026-xK9";
const hours = [0, 1, 2, 3, 4].map((weekday) => ({ weekday, open: true, windows: [{ from: "09:00", to: "18:00" }] })).concat([{ weekday: 5, open: false, windows: [{ from: "09:00", to: "13:00" }] }, { weekday: 6, open: false, windows: [{ from: "09:00", to: "17:00" }] }]);
const services = [{ name: "תספורת", durationMinutes: 30, priceNis: 80 }, { name: "צבע", durationMinutes: 60, priceNis: 200 }];
const admin = createClient(URL_, SECRET, { auth: { persistSession: false } });
const lines = ["Local test accounts for the security scan (password for all: " + PASSWORD + ")"];

for (const label of ["owner-a", "owner-b"]) {
  const email = `${label}@scan.example.com`;
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (created.error) throw created.error;
  const db = createClient(URL_, KEY, { auth: { persistSession: false } });
  const login = await db.auth.signInWithPassword({ email, password: PASSWORD });
  if (login.error) throw login.error;
  const slug = `scan-${label}`;
  const biz = await db.rpc("create_business", { p_name: `עסק ${label}`, p_kind: "barber", p_phone: "+972501234567", p_slug: slug, p_services: services, p_hours: hours });
  if (biz.error) throw biz.error;
  const pub = await db.rpc("publish_business", { p_business: biz.data.id });
  if (pub.error) throw pub.error;
  lines.push(`${label}: ${email}  business id ${biz.data.id}  public page /book/${slug}`);
}
lines.push("Both owners are normal business owners (no platform admin). Sign in at /auth/login. Owner A must not be able to reach owner B's data, and the other way round.");
writeFileSync("strix-credentials.txt", lines.join("\n") + "\n");
console.log(lines.join("\n"));
