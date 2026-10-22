// Manual security checks against a LOCAL throw-away copy (see docs/evidence/security-pentest-2026-10-21.md). Never point this at production.
import { createClient } from "@supabase/supabase-js";
export const BASE = process.env.SEC_BASE ?? "http://127.0.0.1:3100";
export const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL, KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
export const PASS = "Scan-Account-Pass-2026-xK9";
export function cookieFor(session) {
  const val = "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
  const name = "sb-127-auth-token"; const parts = [];
  for (let i = 0; i < val.length; i += 3000) parts.push(val.slice(i, i + 3000));
  return parts.length === 1 ? `${name}=${parts[0]}` : parts.map((p, i) => `${name}.${i}=${p}`).join("; ");
}
export async function login(label) {
  const db = createClient(URL_, KEY, { auth: { persistSession: false } });
  const { data, error } = await db.auth.signInWithPassword({ email: `${label}@scan.example.com`, password: PASS });
  if (error) throw error;
  const val = "base64-" + Buffer.from(JSON.stringify(data.session)).toString("base64url");
  const name = "sb-127-auth-token"; const parts = [];
  for (let i = 0; i < val.length; i += 3000) parts.push(val.slice(i, i + 3000));
  const cookie = parts.length === 1 ? `${name}=${parts[0]}` : parts.map((p, i) => `${name}.${i}=${p}`).join("; ");
  return { db, cookie, token: data.session.access_token, user: data.user };
}
export async function req(path, { method = "GET", cookie, headers = {}, body, raw } = {}) {
  const h = { ...(cookie ? { cookie } : {}), ...headers };
  if (body !== undefined && !raw) h["content-type"] ??= "application/json";
  const r = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : raw ? body : JSON.stringify(body), redirect: "manual" });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch {}
  return { s: r.status, h: r.headers, t, j };
}
export const results = [];
export function check(name, ok, detail = "") { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); }
