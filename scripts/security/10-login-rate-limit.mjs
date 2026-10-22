// Manual security checks against a LOCAL throw-away copy (see docs/evidence/security-pentest-2026-10-21.md). Never point this at production.
// Strix VULN-0006: unlimited password guesses. Needs the seeded owner (scripts/strix/seed.mjs) and `playwright-core`.
import { chromium } from "playwright-core";
import { check, BASE } from "./lib.mjs";

const b = await chromium.launch({ executablePath: process.env.E2E_CHROMIUM_PATH || "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
const ctx = await b.newContext(); const p = await ctx.newPage();
await p.goto(BASE + "/auth/login");
const texts = [];
for (let i = 0; i < 14; i++) {
  await p.locator("input[type=email]").fill("owner-b@scan.example.com");
  await p.locator("input[type=password]").fill(`wrong-guess-${i}-xxxxxx`);
  await p.locator("button[type=submit]").first().click();
  await p.waitForTimeout(700);
  texts.push((await p.locator("main").innerText()).replace(/\s+/g, " "));
}
const firstLimited = texts.findIndex((t) => t.includes("יותר מדי ניסיונות"));
check("after about 10 wrong guesses the e-mail is asked to wait", firstLimited >= 9 && firstLimited <= 11, `first "too many attempts" at attempt ${firstLimited + 1}`);
check("earlier attempts only said the details are wrong", texts.slice(0, 9).every((t) => t.includes("האימייל או הסיסמה שגויים")));
// even the right password is refused during the wait (the limit is on the account, not on the answer)
await p.locator("input[type=email]").fill("owner-b@scan.example.com");
await p.locator("input[type=password]").fill("Scan-Account-Pass-2026-xK9");
await p.locator("button[type=submit]").first().click();
await p.waitForTimeout(1200);
check("the right password is also held during the wait", p.url().includes("/auth/login"), p.url());
await b.close();
