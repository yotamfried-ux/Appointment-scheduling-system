// Manual security checks against a LOCAL throw-away copy (see docs/evidence/security-pentest-2026-10-21.md). Never point this at production.
// Strix finding VULN-0010: a logged-out session kept working until its access token expired.
import { login, req, check } from "./lib.mjs";
const A = await login("owner-a");
let r = await req("/api/owner/appointments", { cookie: A.cookie });
check("session works before logout", r.s === 200, `status ${r.s}`);
await A.db.auth.signOut();
r = await req("/api/owner/appointments", { cookie: A.cookie });
check("the same cookie is refused after logout (owner API)", r.s === 401, `status ${r.s}`);
r = await req("/dashboard", { cookie: A.cookie });
check("the same cookie is sent to login after logout (owner page)", [302, 303, 307, 308].includes(r.s) && /login/.test(r.h.get("location") ?? ""), `status ${r.s}`);
r = await req("/api/owner/waitlist/settings", { method: "POST", cookie: A.cookie, headers: { origin: "http://127.0.0.1:3100" }, body: { enabled: true } });
check("a write with the same cookie is refused after logout", r.s === 401, `status ${r.s}`);
