import { describe, expect, it } from "vitest";
import { classifyDbFailure } from "@/platform/db-failure";

// The readiness endpoint says only "unavailable" to the outside. These reasons go to the server log, so an operator can tell a missing
// key from a refused key from an unreachable database. They are fixed words: never a message, a host or any part of a key.
describe("classifyDbFailure (readiness diagnostics)", () => {
  it("names a missing configuration", () => {
    expect(classifyDbFailure(new Error("system-db is not configured"))).toBe("not_configured");
  });
  it("names an unreachable or slow database", () => {
    const e = Object.assign(new Error("database unavailable"), { name: "DbUnavailableError", code: "DB_UNAVAILABLE" });
    expect(classifyDbFailure(e)).toBe("unreachable_or_timeout");
    expect(classifyDbFailure(Object.assign(new Error("x"), { name: "TimeoutError" }))).toBe("unreachable_or_timeout");
  });
  it("names a key that cannot even be sent (for example a stray line break pasted with it)", () => {
    expect(classifyDbFailure(new TypeError("Headers.set: \"abc\n\" is an invalid header value."))).toBe("invalid_key_format");
  });
  it("names the answer of the database service by its status only", () => {
    expect(classifyDbFailure({ status: 401, message: "Invalid API key sb_secret_abcdef" })).toBe("http_401");
    expect(classifyDbFailure({ status: 404, message: "relation does not exist" })).toBe("http_404");
    expect(classifyDbFailure({ code: "42501", message: "permission denied for table plans" })).toBe("db_42501");
  });
  it("never repeats any text of the error (it may contain a key or a host)", () => {
    const reasons = [
      classifyDbFailure({ status: 401, message: "Invalid API key sb_secret_abcdef" }),
      classifyDbFailure(new Error("connect ECONNREFUSED db.example.supabase.co:5432")),
      classifyDbFailure("anything sb_secret_zzz"),
    ];
    for (const r of reasons) expect(r).toMatch(/^[a-z0-9_]+$/);
    expect(reasons.join(" ")).not.toMatch(/sb_secret|supabase|example/);
  });
  it("falls back to a neutral word", () => {
    expect(classifyDbFailure(new Error("weird"))).toBe("unknown");
    expect(classifyDbFailure(undefined)).toBe("unknown");
  });
});
