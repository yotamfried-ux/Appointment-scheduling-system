import { describe, expect, it } from "vitest";
import { checkEnv } from "../../scripts/check-env.mjs";

type R = { ok: boolean; errors: { name: string; why: string }[]; warnings: { name: string; why: string }[] };
const good = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefgh.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_realkeyvalue",
  SUPABASE_SECRET_KEY: "sb_secret_anotherrealvalue",
  BOOKING_TOKEN_SECRET: "k9Jd83hF0aQw2LmZx7Ct5VbN1sRyU4eT",
  CRON_SECRET: "Xr8Tq2LpW5nB7cHv",
  RESEND_API_KEY: "re_9fKx2LmPq",
  EMAIL_FROM: "Tori <noreply@mail.tori-app.co.il>",
  RESEND_WEBHOOK_SECRET: "whsec_Zm9vYmFyYmF6",
  NOTIFICATIONS_PEPPER: "Hq7Vn3Zb9Kd2Wm5R",
  APP_URL: "https://tori-app.co.il",
  NEXT_PUBLIC_SITE_URL: "https://tori-app.co.il",
  BILLING_PROVIDER: "manual",
  NEXT_PUBLIC_LEGAL_CONTACT: "legal@tori-app.co.il",
  NEXT_PUBLIC_A11Y_CONTACT: "a11y@tori-app.co.il",
} as Record<string, string>;
const run = (over: Record<string, string | undefined> = {}) => checkEnv({ ...good, ...over }) as R;
const names = (r: R) => r.errors.map((e) => e.name);

describe("production environment gate (OPS-08)", () => {
  it("a complete production environment passes with no errors and no warnings", () => {
    const r = run({ BILLING_PROVIDER: "stripe" });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.ok).toBe(true);
  });
  it("the manual billing provider passes but is called out", () => {
    const r = run();
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.name)).toContain("BILLING_PROVIDER");
  });
  it("every required variable, when missing, is an error naming that variable", () => {
    for (const n of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "BOOKING_TOKEN_SECRET", "CRON_SECRET", "RESEND_API_KEY", "EMAIL_FROM", "RESEND_WEBHOOK_SECRET", "NOTIFICATIONS_PEPPER", "APP_URL", "NEXT_PUBLIC_SITE_URL"]) {
      expect(names(run({ [n]: undefined })), n).toContain(n);
      expect(names(run({ [n]: "  " })), `${n} blank`).toContain(n);
    }
  });
  it("placeholder and test-looking secrets are refused", () => {
    expect(names(run({ BOOKING_TOKEN_SECRET: "e2e-booking-token-secret-0123456789abcdef" }))).toContain("BOOKING_TOKEN_SECRET");
    expect(names(run({ CRON_SECRET: "e2e-cron-secret-0123456789abcdef" }))).toContain("CRON_SECRET");
    expect(names(run({ NOTIFICATIONS_PEPPER: "dev-only-pepper-dev-only" }))).toContain("NOTIFICATIONS_PEPPER");
    expect(names(run({ BOOKING_TOKEN_SECRET: "short" }))).toContain("BOOKING_TOKEN_SECRET");
  });
  it("local or insecure URLs are refused", () => {
    for (const bad of ["http://127.0.0.1:54321", "http://localhost:3000", "https://localhost", "http://tori-app.co.il"]) {
      expect(names(run({ NEXT_PUBLIC_SUPABASE_URL: bad })), bad).toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(names(run({ APP_URL: bad })), bad).toContain("APP_URL");
    }
  });
  it("the secret key may not be the publishable key", () => {
    expect(names(run({ SUPABASE_SECRET_KEY: good.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY }))).toContain("SUPABASE_SECRET_KEY");
  });
  it("fake providers, test switches and a disabled terms gate are refused", () => {
    expect(names(run({ EMAIL_PROVIDER: "fake" }))).toContain("EMAIL_PROVIDER");
    expect(names(run({ BILLING_PROVIDER: "fake" }))).toContain("BILLING_PROVIDER");
    for (const n of ["ALLOW_TEST_LIMIT_HEADER", "ALLOW_TEST_CLOCK", "ALLOW_TEST_LEGAL_GATE"]) expect(names(run({ [n]: "1" })), n).toContain(n);
    expect(names(run({ LEGAL_GATE: "off" }))).toContain("LEGAL_GATE");
    expect(names(run({ OUTBOX_KICK: "0" }))).toContain("OUTBOX_KICK");
  });
  it("missing legal contacts are warnings (a content task), not errors", () => {
    const r = run({ NEXT_PUBLIC_LEGAL_CONTACT: undefined, NEXT_PUBLIC_A11Y_CONTACT: undefined });
    expect(r.ok).toBe(true);
    expect(r.warnings.map((w) => w.name)).toEqual(expect.arrayContaining(["NEXT_PUBLIC_LEGAL_CONTACT", "NEXT_PUBLIC_A11Y_CONTACT"]));
  });
  it("never echoes a secret value in its findings", () => {
    const r = run({ BOOKING_TOKEN_SECRET: "e2e-VERYSECRETVALUE-0123456789abcdef", RESEND_API_KEY: "oops-NOTAKEY-VALUE" });
    const text = JSON.stringify(r);
    expect(text).not.toContain("VERYSECRETVALUE");
    expect(text).not.toContain("NOTAKEY");
  });
});
