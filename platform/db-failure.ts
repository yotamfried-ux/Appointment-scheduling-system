// Why is the database "not ready"? The readiness endpoint tells the outside only "unavailable" (docs/05: nothing an outsider could learn). The server log gets one of
// these fixed words, so an operator can tell a missing key from a refused key from an unreachable database. Never a message, a host or any part of a key.
export function classifyDbFailure(e: unknown): string {
  if (!e || typeof e !== "object") return "unknown";
  const err = e as { name?: unknown; message?: unknown; status?: unknown; code?: unknown };
  const message = typeof err.message === "string" ? err.message : "";
  if (message.includes("is not configured")) return "not_configured";
  if (err.name === "DbUnavailableError" || err.name === "TimeoutError" || err.name === "AbortError") return "unreachable_or_timeout";
  if (e instanceof TypeError && /invalid header value|invalid character|is not a legal HTTP header value/i.test(message)) return "invalid_key_format";
  if (typeof err.status === "number" && Number.isInteger(err.status)) return `http_${err.status}`;
  if (typeof err.code === "string" && /^[0-9A-Z]{5}$/.test(err.code)) return `db_${err.code}`;
  return "unknown";
}
