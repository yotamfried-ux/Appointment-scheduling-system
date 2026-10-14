// Maps Supabase Auth error codes to message keys under `auth.errors.*` (never show raw vendor text).
const KNOWN = new Set([
  "invalid_credentials",
  "email_not_confirmed",
  "weak_password",
  "over_request_rate_limit",
  "over_email_send_rate_limit",
  "same_password",
  "otp_expired",
]);

export function authErrorKey(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { code?: unknown; message?: unknown; name?: unknown };
    if (typeof e.code === "string" && KNOWN.has(e.code)) return e.code;
    if (e.name === "AuthRetryableFetchError" || (typeof e.message === "string" && /fetch failed|network/i.test(e.message))) {
      return "network";
    }
  }
  return "generic";
}
