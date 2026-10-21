// Manual security checks against a LOCAL throw-away copy (see docs/evidence/security-pentest-2026-10-21.md). Never point this at production.
import { login, req, check, URL_, KEY, BASE } from "./lib.mjs";
import { createClient } from "@supabase/supabase-js";
const A = await login("owner-a"), B = await login("owner-b");
const anon = createClient(URL_, KEY, { auth: { persistSession: false } });
const { data: bizB } = await B.db.from("businesses").select("id,slug,name");
const bId = bizB?.[0]?.id; check("B can read own business via REST (control)", !!bId, JSON.stringify(bizB).slice(0,80));
const rest = async (client, path, init = {}) => { const tok = (await client.auth.getSession()).data.session?.access_token ?? KEY; const r = await fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { apikey: KEY, authorization: `Bearer ${tok}`, "content-type": "application/json", prefer: "return=representation", ...(init.headers ?? {}) } }); const t = await r.text(); return { s: r.status, t }; };
// discover exposed tables from OpenAPI
const oa = await rest(anon, ""); let defs = []; try { defs = Object.keys(JSON.parse(oa.t).definitions ?? JSON.parse(oa.t).paths ?? {}); } catch {}
console.log("INFO anon-visible REST surface:", oa.s, defs.slice(0,60).join(" "));
const tables = ["businesses","appointments","customers","services","subscriptions","audit_log","notification_outbox","notif_suppressions","booking_rate_limits","idempotency_keys","business_members","people","waitlist_entries","customer_notes","platform_admins","profiles","consents"];
for (const t of tables) {
  const an = await rest(anon, `${t}?select=*&limit=5`);
  const rowsAnon = (() => { try { const j = JSON.parse(an.t); return Array.isArray(j) ? j.length : -1; } catch { return -1; } })();
  check(`anon cannot read ${t}`, an.s >= 400 || rowsAnon === 0, `status ${an.s} rows ${rowsAnon} ${an.s<400?an.t.slice(0,80):""}`);
  const ax = await rest(A.db, `${t}?select=*&business_id=eq.${bId}&limit=5`);
  let rowsA = 0; try { const j = JSON.parse(ax.t); rowsA = Array.isArray(j) ? j.length : 0; } catch {}
  check(`owner A cannot read B's rows in ${t}`, rowsA === 0, `status ${ax.s} rows ${rowsA}`);
}
// A reading businesses table filtered to B's id
const ab = await rest(A.db, `businesses?id=eq.${bId}&select=*`); check("owner A cannot read B's business row", ab.s>=400 || ab.t === "[]", ab.t.slice(0,100));
// writes
for (const [m, p, body] of [["PATCH",`businesses?id=eq.${bId}`,{name:"pwned"}],["DELETE",`businesses?id=eq.${bId}`],["POST","businesses",{name:"x",slug:"x-evil"}],["PATCH",`appointments?business_id=eq.${bId}`,{status:"cancelled"}],["POST","subscriptions",{business_id:bId,plan_id:"pro",status:"active"}],["PATCH",`subscriptions?business_id=eq.${bId}`,{plan_id:"pro",status:"active"}],["POST","audit_log",{business_id:bId,action:"x"}]]) {
  const x = await rest(A.db, p, { method: m, body: body ? JSON.stringify(body) : undefined });
  let n = 0; try { const j = JSON.parse(x.t); n = Array.isArray(j) ? j.length : 0; } catch {}
  check(`A ${m} ${p.split("?")[0]} (B's) no effect`, n === 0, `status ${x.s} ${x.t.slice(0,90)}`);
}
// own-subscription escalation: A tries to upgrade own plan
const own = await rest(A.db, "subscriptions?select=*"); console.log("INFO A sees own subscription rows:", own.s, own.t.slice(0,160));
const up = await rest(A.db, "subscriptions", { method: "PATCH", body: JSON.stringify({ plan_id: "pro", status: "active", trial_ends_at: null, current_period_end: "2099-01-01" }) });
check("owner cannot self-upgrade subscription via REST", up.s >= 400 || up.t === "[]", `status ${up.s} ${up.t.slice(0,100)}`);
const up2 = await rest(A.db, "businesses", { method: "PATCH", body: JSON.stringify({ published: true, slug: "hijack" }) }); console.log("INFO A PATCH own business via REST:", up2.s, up2.t.slice(0,140));
// RPC surface
const rp = await rest(anon, ""); 
const rpcs = (JSON.parse(rp.t).paths ? Object.keys(JSON.parse(rp.t).paths).filter(p=>p.startsWith("/rpc/")) : []);
console.log("INFO RPCs visible to anon:", rpcs.join(" ") || "(none listed)");
const rpA = await rest(A.db, ""); const rpcsA = (JSON.parse(rpA.t).paths ? Object.keys(JSON.parse(rpA.t).paths).filter(p=>p.startsWith("/rpc/")) : []);
console.log("INFO RPCs visible to authenticated:", rpcsA.join(" "));
for (const name of ["purge_deleted_businesses","subscription_state","change_business_slug","slug_available","notif_suppress","create_business","publish_business"]) {
  const ar = await rest(anon, `rpc/${name}`, { method: "POST", body: "{}" });
  check(`anon rpc/${name} not executable`, ar.s >= 400, `status ${ar.s} ${ar.t.slice(0,90)}`);
}
// cross-tenant via RPCs with B's id as A
for (const [name, body] of [["publish_business",{p_business:bId}],["change_business_slug",{p_business:bId,p_slug:"hijacked-b"}],["subscription_state",{p_business:bId}]]) {
  const x = await rest(A.db, `rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
  console.log(`INFO A rpc/${name}(B):`, x.s, x.t.slice(0,120));
}
const still = await rest(B.db, `businesses?id=eq.${bId}&select=slug,name`); check("B's business unchanged after A's attempts", still.t.includes("scan-owner-b") && !still.t.includes("pwned"), still.t.slice(0,100));
// private schema
for (const sch of ["private","auth","storage"]) { const x = await fetch(`${URL_}/rest/v1/`, { headers: { apikey: KEY, "accept-profile": sch, authorization: `Bearer ${A.token}` } }); check(`schema ${sch} not exposed via PostgREST`, x.status >= 400, `status ${x.status}`); }
// secret key from browser? publishable key must not carry service role
const jwtLike = KEY.startsWith("sb_publishable_"); check("browser key is the publishable key", jwtLike);
// auth endpoints: admin API with publishable key
const adm = await fetch(`${URL_}/auth/v1/admin/users`, { headers: { apikey: KEY, authorization: `Bearer ${A.token}` } }); check("auth admin API denied to normal owner", adm.status >= 400, `status ${adm.status}`);
// signup abuse: self-assigning role via metadata
const sx = createClient(URL_, KEY, { auth: { persistSession: false } });
const { data: su, error: se } = await sx.auth.signUp({ email: `esc-${Date.now()}@scan.example.com`, password: "Scan-Account-Pass-2026-xK9", options: { data: { role: "service_role", is_platform_admin: true } } });
console.log("INFO signup with privileged metadata:", se?.message ?? "accepted", JSON.stringify(su?.user?.app_metadata));
