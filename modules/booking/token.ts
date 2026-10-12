// Customer capability tokens (docs/05 §5.3): HMAC-SHA256 over {appointment, scope, expiry, jti, key id}.
// Stateless verification here; single use of destructive scopes is enforced by the database (public_consume_token).
// Rotation: BOOKING_TOKEN_SECRET (current) signs and verifies; BOOKING_TOKEN_SECRET_PREVIOUS also verifies. To rotate, move the
// current value to PREVIOUS and set a new current: tokens already sent keep working until PREVIOUS is removed.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type TokenScope = "view" | "cancel" | "reschedule" | "wl_view" | "wl_accept" | "wl_decline" | "wl_leave"; // wl_* : waitlist (a = entry id for wl_view/wl_leave, offer id for wl_accept/wl_decline)
export interface TokenPayload {
  a: string; // appointment id (or waitlist entry / offer id, see TokenScope)
  s: TokenScope;
  e: number; // expiry, unix seconds
  j: string; // unique token id
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const secrets = (env: NodeJS.ProcessEnv) => [env.BOOKING_TOKEN_SECRET, env.BOOKING_TOKEN_SECRET_PREVIOUS].filter((x): x is string => !!x && x.length >= 32);
const mac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest();

export function signToken(input: { appointmentId: string; scope: TokenScope; ttlSeconds: number; now?: number }, env: NodeJS.ProcessEnv = process.env): string {
  const secret = env.BOOKING_TOKEN_SECRET;
  if (!secret || secret.length < 32) throw new Error("BOOKING_TOKEN_SECRET must be set (≥ 32 chars)"); // fail closed
  const payload: TokenPayload = { a: input.appointmentId, s: input.scope, e: Math.floor((input.now ?? Date.now()) / 1000) + input.ttlSeconds, j: randomBytes(12).toString("base64url") };
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(mac(secret, body))}`;
}

export type VerifyResult = { ok: true; payload: TokenPayload } | { ok: false };

/** Every failure is the same `{ ok: false }`: callers cannot (and must not) tell forged from expired from wrong scope. */
export function verifyToken(token: unknown, scope: TokenScope, env: NodeJS.ProcessEnv = process.env, now = Date.now()): VerifyResult {
  if (typeof token !== "string" || token.length > 512) return { ok: false };
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return { ok: false };
  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenPayload;
  } catch {
    return { ok: false };
  }
  if (!payload || typeof payload !== "object") return { ok: false };
  const given = Buffer.from(sig, "base64url");
  const valid = secrets(env).some((secret) => {
    const expected = mac(secret, body);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!valid) return { ok: false };
  if (payload.s !== scope || typeof payload.a !== "string" || typeof payload.j !== "string" || typeof payload.e !== "number") return { ok: false };
  if (payload.e * 1000 < now) return { ok: false };
  return { ok: true, payload };
}
