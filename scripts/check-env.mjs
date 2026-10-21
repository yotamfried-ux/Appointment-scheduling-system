#!/usr/bin/env node
// Production environment gate (OPS-08, docs/05 §5.5): run before a production deploy. It fails closed on anything that would run live with a
// placeholder, a test switch or a missing secret. It prints variable NAMES and reasons only, never a value.
//   node scripts/check-env.mjs            (reads process.env)
//   VERCEL_ENV=production npm run check:env
import { pathToFileURL } from "node:url";

const WEAK = /(e2e|dev-only|changeme|change-me|example|placeholder|password|secret123|0123456789abcdef)/i;
const LOCAL_HOST = /(^|\/\/)(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i;

/** @param {Record<string, string | undefined>} env */
export function checkEnv(env) {
  /** @type {{ name: string; why: string }[]} */
  const errors = [];
  /** @type {{ name: string; why: string }[]} */
  const warnings = [];
  const err = (name, why) => errors.push({ name, why });
  const warn = (name, why) => warnings.push({ name, why });
  const has = (n) => typeof env[n] === "string" && env[n].trim() !== "";
  const need = (n, test, why) => (!has(n) ? err(n, "missing") : test && !test(env[n]) ? err(n, why) : undefined);
  const strong = (n, min) => need(n, (v) => v.length >= min && !WEAK.test(v), `at least ${min} characters and not a placeholder or test value`);

  // Supabase
  need("NEXT_PUBLIC_SUPABASE_URL", (v) => v.startsWith("https://") && !LOCAL_HOST.test(v), "must be the https URL of the production project, not a local one");
  need("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  need("SUPABASE_SECRET_KEY", (v) => v !== env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, "must differ from the publishable key");
  // signing / cron
  strong("BOOKING_TOKEN_SECRET", 32);
  strong("CRON_SECRET", 16);
  // e-mail
  const emailProvider = env.EMAIL_PROVIDER || "resend";
  if (emailProvider !== "resend") err("EMAIL_PROVIDER", "production must use the resend provider (the fake provider sends nothing)");
  need("RESEND_API_KEY", (v) => v.startsWith("re_"), "does not look like a Resend API key");
  need("EMAIL_FROM", (v) => /@/.test(v), "must contain a sender address on a verified domain");
  need("RESEND_WEBHOOK_SECRET", (v) => v.startsWith("whsec_"), "must be the whsec_ signing secret of the Resend webhook");
  strong("NOTIFICATIONS_PEPPER", 16);
  // site
  need("APP_URL", (v) => v.startsWith("https://") && !LOCAL_HOST.test(v), "must be the public https URL (used in e-mail links)");
  need("NEXT_PUBLIC_SITE_URL", (v) => v.startsWith("https://") && !LOCAL_HOST.test(v), "must be the public https URL");
  // billing: a provider has to be a conscious choice; the fake one never ships
  const billing = env.BILLING_PROVIDER || "manual";
  if (billing === "fake") err("BILLING_PROVIDER", "the fake billing provider is refused in production");
  if (billing === "manual") warn("BILLING_PROVIDER", "manual: no payment provider is connected, subscriptions are recorded by a platform admin");
  // test switches must not exist in production at all
  for (const n of ["ALLOW_TEST_LIMIT_HEADER", "ALLOW_TEST_CLOCK", "ALLOW_TEST_LEGAL_GATE", "ALLOW_NON_PRODUCTION_DEFAULTS"]) if (has(n)) err(n, "a test switch must not be set in production");
  if (env.LEGAL_GATE === "off") err("LEGAL_GATE", "the terms gate must not be switched off in production");
  if (env.OUTBOX_KICK === "0") err("OUTBOX_KICK", "disables the immediate outbox kick; only the 5-minute cron would send mail");
  if (env.EMAIL_PROVIDER === "fake") err("EMAIL_PROVIDER", "the fake e-mail provider is refused in production");
  // launch blockers that are content, not code
  if (!has("NEXT_PUBLIC_LEGAL_CONTACT")) warn("NEXT_PUBLIC_LEGAL_CONTACT", "the legal pages show a visible placeholder instead of a contact");
  if (!has("NEXT_PUBLIC_A11Y_CONTACT")) warn("NEXT_PUBLIC_A11Y_CONTACT", "the accessibility statement shows a visible placeholder instead of a coordinator");
  return { ok: errors.length === 0, errors, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--if-production") && process.env.VERCEL_ENV !== "production") process.exit(0); // wired into `npm run build`: only a production deploy is gated
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production" && !process.argv.includes("--force")) {
    console.log(`check-env: skipped (VERCEL_ENV=${process.env.VERCEL_ENV}); run with VERCEL_ENV=production or --force`);
    process.exit(0);
  }
  const r = checkEnv(process.env);
  for (const e of r.errors) console.error(`ERROR   ${e.name}: ${e.why}`);
  for (const w of r.warnings) console.warn(`WARNING ${w.name}: ${w.why}`);
  console.log(r.ok ? `check-env: OK (${r.warnings.length} warning(s))` : `check-env: FAILED (${r.errors.length} error(s))`);
  process.exit(r.ok ? 0 : 1);
}
