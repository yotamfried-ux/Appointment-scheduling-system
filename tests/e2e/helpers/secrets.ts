// Test-only secrets shared by the Playwright config (server side) and the specs (client side). Never used outside local/CI.
export const CRON_SECRET = process.env.CRON_SECRET ?? "e2e-cron-secret-0123456789abcdef";
export const RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET ?? `whsec_${Buffer.from("e2e-resend-webhook-secret-0123456789").toString("base64")}`;
