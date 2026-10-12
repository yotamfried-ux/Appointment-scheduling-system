import "server-only";
import { createHash } from "node:crypto";
import { fail } from "@/lib/api/http";
import { systemDb } from "@/platform/system-db";
import { isProductionLike } from "@/lib/env";

// Rate limiting for the public booking surface (BKG-12/13): Postgres counters, keys are hashed so no PII (IP, phone) is stored (BKG-14).
// Layered on top of Vercel Firewall rules in production (docs/05 §5.4).
const h = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

export const clientIp = (req: Request) => (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();

export interface Limit {
  scope: string;
  value: string;
  windowSeconds: number;
  max: number;
}

/** Throws RATE_LIMITED (429 + Retry-After) when ANY limit is exceeded. Fails closed if the counter store is unavailable. */
export async function enforce(limits: Limit[]): Promise<void> {
  const db = systemDb();
  let worst = 0;
  for (const l of limits) {
    const { data, error } = await db.rpc("public_rate_limit", { p_key: `${l.scope}:${h(l.value)}`, p_window_seconds: l.windowSeconds, p_max: l.max });
    if (error) throw new Error("rate limiter unavailable");
    const row = (data as { allowed: boolean; retry_after: number }[] | null)?.[0];
    if (!row?.allowed) worst = Math.max(worst, row?.retry_after ?? l.windowSeconds);
  }
  if (worst > 0) throw fail("RATE_LIMITED", "יותר מדי ניסיונות. נסו שוב בעוד רגע.", undefined, { "Retry-After": String(worst) });
}

/** Test hook: lowers limits for the request only when explicitly enabled outside production. */
export const limitFromHeader = (req: Request, fallback: number) => {
  if (isProductionLike() || process.env.ALLOW_TEST_LIMIT_HEADER !== "1") return fallback;
  const n = Number(req.headers.get("x-test-limit"));
  return Number.isInteger(n) && n > 0 && n < fallback ? n : fallback;
};

/**
 * Per-address mail limit (a third party's inbox cannot be flooded through us). Outside production, with the E2E switch on, tests reuse a few fixture
 * addresses, so each request gets its own budget unless it names a scope: `x-test-email-scope` shares one budget across requests and
 * `x-test-email-limit` lowers it.
 */
export const emailLimit = (req: Request, email: string) => {
  const test = !isProductionLike() && process.env.ALLOW_TEST_LIMIT_HEADER === "1";
  const scope = test ? (req.headers.get("x-test-email-scope") ?? crypto.randomUUID()) : "";
  const lowered = test ? Number(req.headers.get("x-test-email-limit")) : 0;
  return { scope: "mail-addr", value: `${email.trim().toLowerCase()}|${scope}`, windowSeconds: 3600, max: Number.isInteger(lowered) && lowered > 0 && lowered < 8 ? lowered : 8 };
};
