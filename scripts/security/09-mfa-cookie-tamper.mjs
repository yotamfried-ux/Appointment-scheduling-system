// Manual security checks against a LOCAL throw-away copy (see docs/evidence/security-pentest-2026-10-21.md). Never point this at production.
// Strix VULN-0004: the second-factor gate read the factor list from the unsigned session cookie, so deleting `user.factors` from it skipped the gate.
import { createHmac } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { cookieFor, req, check, URL_, KEY, PASS } from "./lib.mjs";

const b32 = (s) => { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = ""; for (const c of s.replace(/=+$/, "")) bits += A.indexOf(c).toString(2).padStart(5, "0"); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
const code = (secret, t = Date.now()) => { const c = Buffer.alloc(8); c.writeBigUInt64BE(BigInt(Math.floor(t / 30000))); const h = createHmac("sha1", b32(secret)).update(c).digest(); const o = h[19] & 15; return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0"); };
const fresh = () => createClient(URL_, KEY, { auth: { persistSession: false } });

const email = "owner-a@scan.example.com";
let a = fresh();
let { error } = await a.auth.signInWithPassword({ email, password: PASS }); if (error) throw error;
const enr = await a.auth.mfa.enroll({ factorType: "totp" }); if (enr.error) throw enr.error;
const secret = enr.data.totp.secret, factorId = enr.data.id;
let ver = await a.auth.mfa.challengeAndVerify({ factorId, code: code(secret) });
if (ver.error) ver = await a.auth.mfa.challengeAndVerify({ factorId, code: code(secret, Date.now() + 30000) });
if (ver.error) throw ver.error;
const aal2 = (await a.auth.getSession()).data.session;
try {
  // a password-only session of an account that now has a verified factor
  const b = fresh();
  const login = await b.auth.signInWithPassword({ email, password: PASS }); if (login.error) throw login.error;
  const aal1 = login.data.session;
  check("the aal1 session carries the account's factor list (what the tamper edits)", (aal1.user.factors ?? []).some((f) => f.status === "verified"));
  let r = await req("/api/owner/appointments", { cookie: cookieFor(aal1) });
  check("password-only session is refused by the second-factor gate (API)", r.s === 401, `status ${r.s}`);
  r = await req("/dashboard", { cookie: cookieFor(aal1) });
  check("password-only session is sent to the code page (page)", r.s === 307 && /mfa/.test(r.h.get("location") ?? ""), `status ${r.s} ${r.h.get("location")}`);
  // the attack: delete user.factors from the cookie
  const tampered = structuredClone(aal1); delete tampered.user.factors;
  r = await req("/api/owner/appointments", { cookie: cookieFor(tampered) });
  check("cookie with user.factors removed is still refused (API)", r.s === 401, `status ${r.s}`);
  r = await req("/dashboard", { cookie: cookieFor(tampered) });
  check("cookie with user.factors removed is still sent to the code page", r.s === 307 && /mfa/.test(r.h.get("location") ?? ""), `status ${r.s} ${r.h.get("location")}`);
  r = await req("/api/owner/customers", { cookie: cookieFor(tampered) });
  check("...and cannot read customers", r.s === 401, `status ${r.s}`);
  // the real second-factor session still works
  r = await req("/api/owner/appointments", { cookie: cookieFor(aal2) });
  check("a session that passed the second factor works", r.s === 200, `status ${r.s}`);
} finally {
  const un = await a.auth.mfa.unenroll({ factorId }); // back to a plain account for the other scripts
  console.log("cleanup: factor removed:", !un.error);
}
