// Manual security checks against a LOCAL throw-away copy (see docs/evidence/security-pentest-2026-10-21.md). Never point this at production.
import { login, req, check } from "./lib.mjs";
const A = await login("owner-a"), B = await login("owner-b");
// sanity: own session works
const me = await req("/api/owner/appointments", { cookie: A.cookie });
check("owner A cookie session works", me.s === 200, `status ${me.s} ${me.t.slice(0,100)}`);
// unauthenticated access to every owner/admin route
const ownerGets = ["/api/owner/appointments","/api/owner/customers","/api/owner/reports","/api/owner/version","/api/owner/billing","/api/owner/account/export","/api/owner/export/customers","/api/owner/export/appointments"];
for (const p of ownerGets) { const r = await req(p); check(`unauth GET ${p} rejected`, r.s === 401 || r.s === 403, `status ${r.s}`); }
for (const p of ["/api/owner/billing/checkout","/api/owner/billing/portal","/api/owner/account/deletion","/api/owner/waitlist/settings","/api/admin/billing/override","/api/admin/billing/subscription"]) {
  const r = await req(p, { method: "POST", body: {} }); check(`unauth POST ${p} rejected`, [401,403].includes(r.s), `status ${r.s}`);
}
// owner (not platform admin) on admin routes
for (const p of ["/api/admin/billing/override","/api/admin/billing/subscription"]) {
  const r = await req(p, { method: "POST", cookie: A.cookie, body: { business: "x", plan: "pro" } }); check(`non-admin owner POST ${p} rejected`, [401,403].includes(r.s), `status ${r.s} ${r.t.slice(0,80)}`);
}
// jobs
for (const p of ["outbox","reminders","waitlist","maintenance","health"]) {
  for (const [lbl, hd] of [["no secret",{}],["wrong bearer",{authorization:"Bearer wrong"}],["empty bearer",{authorization:"Bearer "}],["owner cookie",{}]]) {
    for (const m of ["GET","POST"]) { const r = await req(`/api/jobs/${p}`, { method: m, headers: hd, cookie: lbl==="owner cookie"?A.cookie:undefined }); check(`jobs/${p} ${m} (${lbl}) rejected`, [401,403,405].includes(r.s), `status ${r.s}`); }
  }
}
// webhooks
let r = await req("/api/webhooks/resend", { method: "POST", body: { type: "email.bounced", data: {} } }); check("resend webhook unsigned rejected", [400,401,403].includes(r.s), `status ${r.s}`);
r = await req("/api/webhooks/resend", { method: "POST", headers: { "svix-id": "msg_1", "svix-timestamp": String(Math.floor(Date.now()/1000)), "svix-signature": "v1,AAAA" }, body: { type: "email.bounced", data: {} } }); check("resend webhook bad signature rejected", [400,401,403].includes(r.s), `status ${r.s}`);
r = await req("/api/webhooks/billing/fake", { method: "POST", body: { type: "x" } }); check("billing webhook unsigned rejected", [400,401,403,404].includes(r.s), `status ${r.s} ${r.t.slice(0,100)}`);
r = await req("/api/webhooks/billing/nonexistent", { method: "POST", body: {} }); check("billing webhook unknown provider rejected", [400,401,403,404].includes(r.s), `status ${r.s}`);
