// Manual security checks against a LOCAL throw-away copy (see docs/evidence/security-pentest-2026-10-21.md). Never point this at production.
import { login, req, check, BASE } from "./lib.mjs";
import { randomUUID } from "node:crypto";
const A = await login("owner-a"), B = await login("owner-b");
const rnd = () => randomUUID();
const ip = () => ({ "x-forwarded-for": `10.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)}.${Math.floor(Math.random()*250)}` });
// find a bookable slot at B
const svc = await req("/api/public/scan-owner-b/services", { headers: ip() });
const svcB = svc.j.services[0].id;
const today = new Date().toISOString().slice(0,10);
const av = await req(`/api/public/scan-owner-b/availability?service=${svcB}&from=${today}&days=14`, { headers: ip() });
const day = (av.j.days ?? av.j.availability ?? []).find(d => (d.free ?? d.available ?? d.count ?? 1) );
let date, time;
for (let i = 1; i < 14 && !time; i++) { const d = new Date(Date.now()+i*864e5).toISOString().slice(0,10); const s = await req(`/api/public/scan-owner-b/slots?service=${svcB}&date=${d}`, { headers: ip() }); const t = s.j?.slots?.[0]?.time ?? s.j?.times?.[0] ?? s.j?.slots?.[0]; if (t) { date = d; time = typeof t === "string" ? t : t.time; } }
console.log("slot for B:", date, time);
const book = (slug, o = {}) => req(`/api/public/${slug}/bookings`, { method: "POST", headers: { "idempotency-key": o.key ?? rnd(), ...ip(), ...(o.h ?? {}) }, body: o.body ?? { serviceId: svcB, date, time, customer: { fullName: "לקוח בדיקה", phone: "050" + String(Math.floor(Math.random()*9000000+1000000)) } } });
const r1 = await book("scan-owner-b");
check("public booking at B works", r1.s === 201, `status ${r1.s} ${r1.t.slice(0,150)}`);
const apptId = r1.j?.booking?.id;
// owner B sees it, owner A must not
const bAgenda = await req(`/api/owner/appointments?date=${date}`, { cookie: B.cookie });
const bList = JSON.stringify(bAgenda.j);
const row = (bAgenda.j.appointments ?? bAgenda.j.items ?? []).find(a => a.id === apptId) ?? null;
check("owner B sees the booking", bList.includes(apptId), `status ${bAgenda.s}`);
const aAgenda = await req(`/api/owner/appointments?date=${date}`, { cookie: A.cookie });
check("owner A agenda does not contain B's booking", !JSON.stringify(aAgenda.j).includes(apptId));
check("owner A agenda does not contain B's customer name", !JSON.stringify(aAgenda.j).includes("לקוח בדיקה"));
// cross-tenant actions by A on B's appointment
for (const act of ["approve","reject","cancel","complete","noShow"]) {
  const r = await req(`/api/owner/appointments/${apptId}/transition`, { method: "POST", cookie: A.cookie, body: { action: act } });
  check(`A transition(${act}) on B's appointment denied`, [403,404].includes(r.s), `status ${r.s} ${r.t.slice(0,80)}`);
}
let r = await req(`/api/owner/appointments/${apptId}/move`, { method: "POST", cookie: A.cookie, body: { date, time } });
check("A move on B's appointment denied", [403,404].includes(r.s), `status ${r.s}`);
// B's customers; get id via B
const cust = await req("/api/owner/customers", { cookie: B.cookie });
const custId = (cust.j.customers ?? cust.j.items ?? [])[0]?.id;
check("B has a customer id", !!custId, JSON.stringify(cust.j).slice(0,120));
for (const [m, p, body] of [["GET",`/api/owner/customers/${custId}`],["POST",`/api/owner/customers/${custId}/notes`,{note:"pwned"}],["POST",`/api/owner/customers/${custId}/policy`,{policy:"blocked"}],["POST",`/api/owner/customers/${custId}/anonymize`,{}]]) {
  const x = await req(p, { method: m, cookie: A.cookie, body });
  check(`A ${m} ${p.replace(custId,":id")} on B's customer denied`, [403,404,400,405].includes(x.s) && !JSON.stringify(x.j).includes("לקוח בדיקה"), `status ${x.s} ${x.t.slice(0,80)}`);
}
const aCust = await req("/api/owner/customers", { cookie: A.cookie });
check("A customers list has no B customers", !JSON.stringify(aCust.j).includes(custId));
// B still intact
const bCust = await req(`/api/owner/customers/${custId}`, { cookie: B.cookie });
check("B's customer untouched by A's attempts", bCust.s === 200 && !JSON.stringify(bCust.j).includes("pwned"), `status ${bCust.s}`);
// exports: A's export must not contain B data
for (const k of ["customers","appointments"]) { const e = await req(`/api/owner/export/${k}`, { cookie: A.cookie }); check(`A export ${k} has no B data`, !e.t.includes("לקוח בדיקה") && !e.t.includes(apptId), `status ${e.s}`); }
const acc = await req("/api/owner/account/export", { cookie: A.cookie }); check("A account export has no B data", !acc.t.includes("לקוח בדיקה") && !acc.t.includes(apptId), `status ${acc.s}`);
// reports
const rep = await req("/api/owner/reports", { cookie: A.cookie }); check("A reports have no B data", !rep.t.includes(apptId));
// owner CSRF: cross-origin POST
r = await req(`/api/owner/appointments/${apptId}/transition`, { method: "POST", cookie: B.cookie, headers: { origin: "https://evil.example" }, body: { action: "approve" } });
check("cross-origin POST with valid cookie rejected (CSRF)", [403,400].includes(r.s), `status ${r.s}`);
r = await req(`/api/owner/appointments/${apptId}/transition`, { method: "POST", cookie: B.cookie, headers: { origin: "null" }, body: { action: "approve" } });
check("Origin: null POST rejected", [403,400].includes(r.s), `status ${r.s}`);
r = await req(`/api/owner/waitlist/settings`, { method: "POST", cookie: B.cookie, headers: { "content-type": "text/plain", origin: "https://evil.example" }, body: JSON.stringify({ enabled: false }), raw: true });
check("text/plain cross-origin POST rejected", [403,400,415].includes(r.s), `status ${r.s}`);
// forged cookie / tampered JWT
const tampered = B.cookie.replace(/(sb-127-auth-token=base64-)(.{10})/, "$1AAAAAAAAAA");
r = await req("/api/owner/appointments", { cookie: tampered }); check("tampered session cookie rejected", r.s === 401, `status ${r.s}`);
const hdr = Buffer.from(JSON.stringify({alg:"none",typ:"JWT"})).toString("base64url"), pl = Buffer.from(JSON.stringify({sub:B.user.id,role:"authenticated",exp:9999999999,aud:"authenticated"})).toString("base64url");
const none = `${hdr}.${pl}.`; const val = "base64-" + Buffer.from(JSON.stringify({access_token:none,refresh_token:"x",token_type:"bearer",expires_in:3600,expires_at:9999999999,user:{id:B.user.id}})).toString("base64url");
r = await req("/api/owner/appointments", { cookie: `sb-127-auth-token=${val}` }); check("alg=none JWT rejected", r.s === 401, `status ${r.s}`);
r = await req("/api/owner/appointments", { headers: { authorization: `Bearer ${B.token}` } }); console.log("INFO bearer-token on owner route:", r.s);
// public booking abuse
r = await book("scan-owner-b", { body: { serviceId: svcB, date, time, customer: { fullName: "x", phone: "0501234567" }, businessId: "00000000-0000-0000-0000-000000000000" } }); check("booking with extra field (businessId) rejected (strict)", r.s === 400 || r.s === 422, `status ${r.s}`);
r = await book("scan-owner-a", { body: { serviceId: svcB, date, time, customer: { fullName: "זר", phone: "0501239999" } } }); check("A's page cannot book B's service id", [400,404,409,422].includes(r.s), `status ${r.s} ${r.t.slice(0,100)}`);
r = await book("scan-owner-b", { body: { serviceId: svcB, date: "2020-01-01", time, customer: { fullName: "עבר", phone: "0501238888" } } }); check("booking in the past rejected", [400,409,422].includes(r.s), `status ${r.s}`);
r = await book("scan-owner-b", { body: { serviceId: svcB, date, time: "03:00", customer: { fullName: "לילה", phone: "0501237777" } } }); check("booking outside hours rejected", [400,409,422].includes(r.s), `status ${r.s}`);
const k = rnd(); const a1 = await book("scan-owner-b", { key: k, body: { serviceId: svcB, date, time, customer: { fullName: "כפול", phone: "0501236666" } } });
const a2 = await book("scan-owner-b", { key: k, body: { serviceId: svcB, date, time, customer: { fullName: "כפול", phone: "0501236666" } } });
check("same idempotency key replays, no double booking", a2.s === 200 || a2.s === 409, `first ${a1.s} second ${a2.s}`);
r = await book("scan-owner-a", { key: k, body: { serviceId: svc.j.services[0].id, date, time, customer: { fullName: "כפול", phone: "0501236666" } } });
console.log("INFO same idempotency key on a different tenant:", r.s, r.t.slice(0,120));
r = await book("scan-owner-b", { body: { serviceId: svcB, date, time, customer: { fullName: "<img src=x onerror=alert(1)>", phone: "0501235555" }, intake: { a: "<script>alert(1)</script>" } } });
console.log("INFO xss payload accepted as data:", r.s);
for (const slug of ["../etc/passwd","a'; drop table businesses;--","%00","A".repeat(500),"scan-owner-b%2f..%2fx"]) { const x = await req(`/api/public/${encodeURIComponent(slug)}/services`, { headers: ip() }); check(`junk slug ${slug.slice(0,20)} → 404 not 500`, x.s === 404 || x.s === 400, `status ${x.s}`); }
r = await req("/api/public/scan-owner-b/bookings", { method: "POST", headers: { "idempotency-key": rnd(), ...ip() }, body: "{not json", raw: true }); check("malformed JSON → 4xx", r.s >= 400 && r.s < 500, `status ${r.s}`);
r = await req("/api/public/scan-owner-b/bookings", { method: "POST", headers: { "idempotency-key": rnd(), ...ip() }, body: JSON.stringify({ x: "A".repeat(2_000_000) }), raw: true }); check("2MB body rejected 4xx (not 500)", r.s >= 400 && r.s < 500, `status ${r.s}`);
r = await req(`/api/public/scan-owner-b/slots?service=${encodeURIComponent("' OR 1=1--")}&date=${date}`, { headers: ip() }); check("SQLi in service param → 4xx", r.s >= 400 && r.s < 500, `status ${r.s}`);
r = await req(`/api/public/scan-owner-b/slots?service=${svcB}&date=${encodeURIComponent("2026-13-45")}`, { headers: ip() }); check("bad date → 4xx", r.s >= 400 && r.s < 500, `status ${r.s}`);
// notification preview (booking token) — A's page / no token
const n = await req(`/api/lab/barber/bookings/${apptId}/notification`, { headers: ip() }); console.log("INFO lab notification endpoint:", n.s, n.t.slice(0,100));
// lab API exposed in prod build?
const lab = await req(`/api/lab/barber/appointments`, { headers: { "x-lab-session": "x", ...ip() } }); console.log("INFO lab appointments:", lab.s, lab.t.slice(0,100));
