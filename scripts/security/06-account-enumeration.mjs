// Manual security checks against a LOCAL throw-away copy (see docs/evidence/security-pentest-2026-10-21.md). Never point this at production.
import { chromium } from "playwright-core";
import { check } from "./lib.mjs";
const b = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM_PATH || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const run = async (path, fill) => { const ctx = await b.newContext({ extraHTTPHeaders: { "x-forwarded-for": `10.9.${Math.floor(Math.random()*200)}.${Math.floor(Math.random()*200)}` } }); const p = await ctx.newPage(); await p.goto("http://127.0.0.1:3100" + path); await fill(p); await p.locator('button[type=submit]').first().click(); await p.waitForTimeout(2500); const txt = (await p.locator("main").innerText()).replace(/\s+/g, " ").slice(0, 400); const url = p.url().replace("http://127.0.0.1:3100",""); await ctx.close(); return { txt, url }; };
const pw = "Scan-Account-Pass-2026-xK9";
// forgot password
const f1 = await run("/auth/forgot-password", async p => p.locator('input[type=email]').fill("owner-a@scan.example.com"));
const f2 = await run("/auth/forgot-password", async p => p.locator('input[type=email]').fill("nobody-" + Date.now() + "@scan.example.com"));
check("forgot-password: same response for existing and unknown e-mail (no enumeration)", f1.txt === f2.txt && f1.url === f2.url, `\n  existing: ${f1.url} ${f1.txt.slice(0,120)}\n  unknown : ${f2.url} ${f2.txt.slice(0,120)}`);
// login
const l1 = await run("/auth/login", async p => { await p.locator('input[type=email]').fill("owner-a@scan.example.com"); await p.locator('input[type=password]').fill("wrong-pass-123456"); });
const l2 = await run("/auth/login", async p => { await p.locator('input[type=email]').fill("nobody-" + Date.now() + "@scan.example.com"); await p.locator('input[type=password]').fill("wrong-pass-123456"); });
check("login: same error for wrong password and unknown e-mail", l1.txt === l2.txt, `\n  wrong pw: ${l1.txt.slice(0,140)}\n  unknown : ${l2.txt.slice(0,140)}`);
// sign-up existing
const s1 = await run("/auth/sign-up", async p => { await p.locator('input[type=email]').fill("owner-a@scan.example.com"); const pws = p.locator('input[type=password]'); await pws.nth(0).fill(pw); if (await pws.count() > 1) await pws.nth(1).fill(pw); const cb = p.locator('input[type=checkbox], [role=checkbox]'); for (let i=0;i<await cb.count();i++) await cb.nth(i).check().catch(()=>{}); });
const s2 = await run("/auth/sign-up", async p => { await p.locator('input[type=email]').fill("brandnew-" + Date.now() + "@scan.example.com"); const pws = p.locator('input[type=password]'); await pws.nth(0).fill(pw); if (await pws.count() > 1) await pws.nth(1).fill(pw); const cb = p.locator('input[type=checkbox], [role=checkbox]'); for (let i=0;i<await cb.count();i++) await cb.nth(i).check().catch(()=>{}); });
console.log("sign-up existing:", s1.url, s1.txt.slice(0,160)); console.log("sign-up new     :", s2.url, s2.txt.slice(0,160));
check("sign-up: existing e-mail indistinguishable from new", s1.url === s2.url && s1.txt === s2.txt);
await b.close();
