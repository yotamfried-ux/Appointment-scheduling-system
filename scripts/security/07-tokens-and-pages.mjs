// Manual security checks against a LOCAL throw-away copy (see docs/evidence/security-pentest-2026-10-21.md). Never point this at production.
import { login, req, check, URL_, KEY } from "./lib.mjs";
import { randomUUID } from "node:crypto";
const ip = () => ({ "x-forwarded-for": `10.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)}` });
// token page forgery
const forged = [ "x.y", "", "a".repeat(600), Buffer.from(JSON.stringify({a:randomUUID(),s:"view",e:9999999999,j:"x"})).toString("base64url")+".AAAA", "%00" ];
for (const t of forged) { const r = await req(`/booking/${encodeURIComponent(t) || "x"}`, { headers: ip() }); check(`forged token page shows not-found, no 500 (${t.slice(0,12)})`, r.s < 500 && (r.t.includes("manage-invalid") || r.s === 404), `status ${r.s}`); }
for (const p of ["/waitlist/forged","/booking/forged/calendar","/booking/forged/reschedule"]) { const r = await req(p, { headers: ip() }); check(`${p} no 500, no data`, r.s < 500 && !/הזמנה|תור של/.test(r.t.replace(/<[^>]+>/g," ")) || r.s===404 || r.t.includes("invalid"), `status ${r.s}`); }
// graphql introspection as anon
const g = await fetch(`${URL_}/graphql/v1`, { method: "POST", headers: { apikey: KEY, "content-type": "application/json" }, body: JSON.stringify({ query: "{__schema{types{name}}}" }) });
const gt = await g.text(); check("anon GraphQL does not expose schema/tables", g.status >= 400 || !/appointments|subscriptions|customers/.test(gt), `status ${g.status} ${gt.slice(0,100)}`);
// protected pages without session redirect to login
for (const p of ["/dashboard","/settings","/settings/booking","/customers","/reports","/onboarding"]) { const r = await req(p); check(`${p} without session redirects to login`, [302,303,307,308].includes(r.s) && /auth\/login|login/.test(r.h.get("location")||""), `status ${r.s} ${r.h.get("location")}`); }
// A visiting B's public settings pages by id guess
const A = await login("owner-a");
const r = await req("/settings/booking", { cookie: A.cookie }); check("owner A settings page shows own link only", r.s === 200 && !r.t.includes("scan-owner-b"), `status ${r.s}`);
// deletion endpoint needs confirm name
const d = await req("/api/owner/account/deletion", { method: "POST", cookie: A.cookie, body: { confirmName: "wrong" } }); check("account deletion with wrong confirmation does not delete", d.s >= 400, `status ${d.s} ${d.t.slice(0,100)}`);
const still = await req("/api/owner/appointments", { cookie: A.cookie }); check("owner A still has access after wrong deletion confirm", still.s === 200, `status ${still.s}`);
