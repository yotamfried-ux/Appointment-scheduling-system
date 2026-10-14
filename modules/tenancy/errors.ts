// Maps database/RPC errors (SQLSTATE + message from supabase/migrations/*_tenancy_core.sql) to stable app codes.
// Pure, so the mapping is unit-tested without a database. Messages never leak SQL details to the browser.
export type TenancyErrorCode =
  | "NOT_AUTHENTICATED"
  | "FORBIDDEN"
  | "SLUG_TAKEN"
  | "SLUG_INVALID"
  | "BUSINESS_LIMIT"
  | "RATE_LIMITED"
  | "EMAIL_NOT_VERIFIED"
  | "VALIDATION"
  | "INTERNAL";

export function mapRpcError(err: { code?: string | null; message?: string | null } | null | undefined): TenancyErrorCode {
  const code = err?.code ?? "";
  const msg = err?.message ?? "";
  if (code === "28000" || msg.includes("not_authenticated")) return "NOT_AUTHENTICATED";
  if (code === "42501") return "FORBIDDEN";
  if (msg.includes("slug_taken") || code === "23505") return "SLUG_TAKEN";
  if (msg.includes("business_limit")) return "BUSINESS_LIMIT";
  if (msg.includes("rate_limited")) return "RATE_LIMITED";
  if (msg.includes("email_not_verified")) return "EMAIL_NOT_VERIFIED";
  if (code === "23514") return msg.includes("slug") ? "SLUG_INVALID" : "VALIDATION";
  return "INTERNAL";
}
