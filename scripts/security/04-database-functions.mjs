// Manual security checks against a LOCAL throw-away copy (see docs/evidence/security-pentest-2026-10-21.md). Never point this at production.
import { login, check } from "./lib.mjs";
const A = await login("owner-a"), B = await login("owner-b");
const bId = (await B.db.from("businesses").select("id")).data[0].id, aId = (await A.db.from("businesses").select("id")).data[0].id;
const appt = (await B.db.from("appointments").select("id,customer_id,service_id,resource_id,starts_at").limit(1)).data?.[0];
const svc = (await B.db.from("services").select("id").limit(1)).data?.[0]?.id;
console.log("B ids:", bId, appt?.id, appt?.customer_id, svc);
const wait = (await B.db.from("waitlist_entries").select("id").limit(1)).data?.[0]?.id ?? "00000000-0000-0000-0000-000000000001";
const U = "00000000-0000-0000-0000-000000000001";
const calls = [
 ["admin_set_override",{p_business:bId,p_key:"max_services",p_bool:null,p_int:999,p_unlimited:true,p_reason:"x",p_expires:null}],
 ["admin_set_override",{p_business:aId,p_key:"max_services",p_bool:null,p_int:999,p_unlimited:true,p_reason:"x",p_expires:null}],
 ["admin_manual_subscription",{p_business:aId,p_plan:"pro",p_status:"active",p_period_end:"2099-01-01",p_reason:"x"}],
 ["admin_remove_override",{p_business:bId,p_key:"max_services"}],
 ["owner_customers_page",{p_business:bId}],
 ["owner_export_account",{p_business:bId}],
 ["owner_report",{p_business:bId,p_from:"2026-01-01",p_to:"2027-01-01"}],
 ["request_business_deletion",{p_business:bId,p_confirm_name:"עסק owner-b"}],
 ["cancel_business_deletion",{p_business:bId}],
 ["create_staff",{p_business:bId,p_name:"intruder"}],
 ["replace_weekly_hours",{p_business:bId,p_hours:[]}],
 ["export_audit",{p_business:bId,p_kind:"customers",p_rows:1}],
 ["set_customer_notes",{p_customer:appt?.customer_id??U,p_notes:"pwn"}],
 ["anonymize_customer",{p_customer:appt?.customer_id??U}],
 ["set_customer_policy_override",{p_customer:appt?.customer_id??U,p_policy:"blocked"}],
 ["transition_appointment",{p_id:appt?.id??U,p_action:"cancel"}],
 ["owner_move_appointment",{p_id:appt?.id??U,p_new_start:"2026-12-01T10:00:00Z",p_out_of_availability:true}],
 ["waitlist_manual_offer",{p_entry:wait,p_starts_at:"2026-12-01T10:00:00Z"}],
 ["waitlist_owner_remove",{p_entry:wait}],
 ["set_service_staff",{p_service:svc??U,p_resources:[]}],
 ["owner_customer_detail",{p_customer:appt?.customer_id??U}],
];
for (const [fn, args] of calls) {
  const { data, error } = await A.db.rpc(fn, args);
  const leaked = !error && data && JSON.stringify(data).length > 40 && JSON.stringify(data).includes(bId);
  check(`A rpc ${fn} ${args.p_business===aId?"(own)":"(B's)"} denied/no-op`, !!error || data === null || data === 0 || (Array.isArray(data) && !data.length) , error ? `${error.code} ${error.message.slice(0,60)}` : `data=${JSON.stringify(data)?.slice(0,100)}`);
}
// verify nothing changed on B
const after = await B.db.from("businesses").select("name,slug,deletion_requested_at"); console.log("B after:", JSON.stringify(after.data));
const staff = await B.db.from("resources").select("name"); console.log("B resources:", JSON.stringify(staff.data));
