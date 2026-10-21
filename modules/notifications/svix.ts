import { createHmac, timingSafeEqual } from "node:crypto";

// Webhook signature verification (Svix scheme used by Resend): HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}`
// with the base64 secret after the "whsec_" prefix. Raw body only: re-serialised JSON breaks the signature.
export type VerifyResult = { ok: true } | { ok: false; reason: "missing_headers" | "bad_timestamp" | "expired" | "bad_signature" };

export function verifySvix(opts: { secret: string; id: string | null; timestamp: string | null; signature: string | null; body: string; now?: Date; toleranceSeconds?: number }): VerifyResult {
  const { id, timestamp, signature, body } = opts;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing_headers" };
  const ts = Number(timestamp);
  if (!Number.isInteger(ts)) return { ok: false, reason: "bad_timestamp" };
  const nowS = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowS - ts) > (opts.toleranceSeconds ?? 300)) return { ok: false, reason: "expired" }; // replay protection
  const key = Buffer.from(opts.secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  // The header may carry several space-separated versions/signatures ("v1,<b64> v1,<b64>") during secret rotation.
  for (const part of signature.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    const given = Buffer.from(sig, "base64");
    if (given.length === expected.length && timingSafeEqual(given, expected)) return { ok: true };
  }
  return { ok: false, reason: "bad_signature" };
}
