// Manual security checks against a LOCAL throw-away copy (see docs/evidence/security-pentest-2026-10-21.md). Never point this at production.
import { login, req, check, BASE } from "./lib.mjs";
const A = await login("owner-a");
// headers
for (const p of ["/", "/book/scan-owner-b", "/auth/login", "/api/health"]) {
  const r = await req(p);
  const h = (n) => r.h.get(n);
  console.log(`--- ${p} ${r.s}`);
  check(`${p} CSP present`, !!h("content-security-policy") || p.startsWith("/api"), (h("content-security-policy")||"").slice(0,140));
  check(`${p} nosniff`, h("x-content-type-options") === "nosniff");
  check(`${p} frame protection`, /frame-ancestors/.test(h("content-security-policy")||"") || !!h("x-frame-options") || p.startsWith("/api"));
  check(`${p} no x-powered-by`, !h("x-powered-by"));
  check(`${p} referrer-policy`, !!h("referrer-policy"));
}
const ph = await req("/"); console.log("INFO HSTS:", ph.h.get("strict-transport-security"), " permissions-policy:", ph.h.get("permissions-policy"));
const csp = ph.h.get("content-security-policy") ?? ""; check("CSP has no unsafe-eval", !/unsafe-eval/.test(csp), csp.slice(0,200)); check("CSP script-src uses nonce, no unsafe-inline", /script-src[^;]*'nonce-/.test(csp) && !/script-src[^;]*'unsafe-inline'/.test(csp));
// robots/sitemap/dotfiles/source maps
for (const p of ["/.env","/.git/config","/package.json","/_next/static/../../.env","/next.config.ts","/supabase/config.toml","/strix-credentials.txt"]) { const r = await req(p); check(`${p} not served`, r.s === 404 || r.s === 308 || r.s === 307, `status ${r.s}`); }
const home = await req("/"); const chunks = [...home.t.matchAll(/\/_next\/static\/[^"']+\.js/g)].map(m=>m[0]).slice(0,40);
let leak = []; for (const c of chunks) { const r = await req(c); if (/sb_secret_|service_role|SUPABASE_SECRET|BOOKING_TOKEN_SECRET|CRON_SECRET|RESEND_WEBHOOK_SECRET/.test(r.t)) leak.push(c); const m = await req(c + ".map"); if (m.s === 200 && m.t.startsWith("{")) leak.push("sourcemap:" + c); }
check("no secrets/sourcemaps in public JS chunks", leak.length === 0, leak.join(","));
// open redirect / next param
for (const n of ["//evil.example","https://evil.example","/\\evil.example","javascript:alert(1)","/%09/evil.example"]) { const r = await req(`/auth/confirm?token_hash=x&type=email&next=${encodeURIComponent(n)}`); const loc = r.h.get("location") ?? ""; check(`/auth/confirm next=${n} not redirecting offsite`, !/evil\.example/.test(loc) && !loc.startsWith("javascript"), `status ${r.s} loc ${loc}`); }
for (const n of ["//evil.example","https://evil.example"]) { const r = await req(`/auth/login?next=${encodeURIComponent(n)}`); check(`/auth/login?next=${n} page does not 3xx offsite`, !(r.h.get("location")||"").includes("evil.example"), `status ${r.s}`); }
// Host header poisoning
const hp = await fetch(BASE + "/auth/login", { headers: { "x-forwarded-host": "evil.example", host: "127.0.0.1:3100" } }); const body = await hp.text(); check("x-forwarded-host not reflected into page", !body.includes("evil.example"));
// reflected XSS
const xs = `"><svg onload=alert(1)>`;
for (const p of [`/book/${encodeURIComponent(xs)}`, `/auth/login?next=${encodeURIComponent(xs)}&error=${encodeURIComponent(xs)}`, `/?q=${encodeURIComponent(xs)}`]) { const r = await req(p); check(`reflected XSS payload not echoed raw: ${p.slice(0,40)}`, !r.t.includes(xs) && !r.t.includes("<svg onload"), `status ${r.s}`); }
// dir traversal/_next
for (const p of ["/_next/../package.json","/%2e%2e/package.json","/_next/static/%2e%2e/%2e%2e/package.json"]) { const r = await req(p); check(`traversal ${p}`, !r.t.includes('"dependencies"'), `status ${r.s}`); }
// HTTP methods
for (const m of ["PUT","DELETE","PATCH"]) { const r = await req("/api/public/scan-owner-b/services", { method: m }); check(`public services ${m} not allowed`, [404,405,501].includes(r.s) || r.s === 400, `status ${r.s}`); }
// rate limit: X-Forwarded-For spoofing must not reset limit
const key = (i) => `rl-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`;
let codes = []; for (let i = 0; i < 25; i++) { const r = await req("/api/public/scan-owner-b/bookings", { method: "POST", headers: { "idempotency-key": key(i), "x-forwarded-for": `203.0.113.${i+1}` }, body: { serviceId: "x", date: "2026-10-22", time: "09:00", customer: { fullName: "ספאם", phone: "0501110000" } } }); codes.push(r.s); }
console.log("INFO 25 bookings with rotating X-Forwarded-For:", [...new Set(codes)].join(","), "429s:", codes.filter(c=>c===429).length);
codes = []; for (let i = 0; i < 25; i++) { const r = await req("/api/public/scan-owner-b/bookings", { method: "POST", headers: { "idempotency-key": key(i) }, body: { serviceId: "x", date: "2026-10-22", time: "09:00", customer: { fullName: "ספאם", phone: "050111" + String(1000+i) } } }); codes.push(r.s); }
check("same client without spoofing gets rate limited (429 appears)", codes.includes(429), [...new Set(codes)].join(","));
