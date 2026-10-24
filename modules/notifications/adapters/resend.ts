import { PermanentEmailError, TransientEmailError, type EmailMessage, type EmailPort } from "@/modules/notifications/ports";

/** RFC 2047 encoded words ("=?UTF-8?B?...?="), each at most 75 characters, split on character boundaries. Used for any display name that is not plain ASCII. */
export function encodeDisplayName(name: string): string {
  const words: string[] = [];
  let chunk = "";
  for (const ch of name) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 42) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join(" ");
}

function senderAddress(configured: string): string {
  const m = /^(.*)<([^<>]+)>\s*$/.exec(configured.trim());
  return (m ? m[2] : configured).trim();
}

/** The configured sender ("Name <address>" or a bare address) with a different display name. The name comes from a business owner, so it is cleaned: no angle brackets, quotes, "@" or ":" (it must never look like another address), no control characters, at most 60 characters.
 * A name with non-ASCII letters (Hebrew) is sent as RFC 2047 encoded words: a raw UTF-8 display name is what the provider's address validator may refuse with a 400. */
export function composeFrom(configured: string, name?: string): string {
  const address = senderAddress(configured);
  const clean = (name ?? "").replace(/[\u0000-\u001f\u007f<>"\\@:;,]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60).trim();
  if (clean.length < 2) return configured; // nothing usable: the configured sender as is
  return /^[\x20-\x7e]+$/.test(clean) ? `"${clean}" <${address}>` : `${encodeDisplayName(clean)} <${address}>`;
}

/** A short, safe reason from a provider error body: its machine name and message, with anything that looks like an address removed, at most 120 characters. Never the request, never the recipient. */
export function providerReason(status: number, body: unknown): string {
  const b = (body && typeof body === "object" ? body : {}) as { name?: unknown; message?: unknown };
  const name = typeof b.name === "string" ? b.name.replace(/[^A-Za-z0-9_ -]/g, "").slice(0, 40) : "";
  const message = typeof b.message === "string" ? b.message.replace(/\S+@\S+/g, "[address]").replace(/[\r\n]+/g, " ").trim() : "";
  const detail = [name, message].filter(Boolean).join(": ").slice(0, 120);
  return detail ? `provider ${status}: ${detail}` : `provider ${status}`;
}

// Resend REST adapter (https://resend.com/docs/api-reference/emails/send-email). No SDK: one endpoint, one header, fewer dependencies.
// Status mapping: 2xx = sent · 429/5xx/409/401/403/network = transient (a rate limit, an outage or a fixable configuration) · other 4xx = permanent.
export function resendAdapter(opts: { apiKey: string; from: string; fetchImpl?: typeof fetch; timeoutMs?: number }): EmailPort {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    name: "resend",
    async send(m: EmailMessage) {
      const attemptSend = async (from: string, keySuffix: string) => {
        try {
          return await doFetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": m.idempotencyKey + keySuffix },
            body: JSON.stringify({ from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
            signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
          });
        } catch {
          throw new TransientEmailError("network"); // timeout, DNS, reset: the provider may or may not have seen it — the idempotency key makes a retry safe
        }
      };
      const from = composeFrom(opts.from, m.fromName);
      let res = await attemptSend(from, "");
      // A request refused as invalid while it carried a custom display name is tried once more with the configured sender (a different key: the provider refuses the same key with a different body).
      if ((res.status === 400 || res.status === 422) && from !== opts.from) res = await attemptSend(opts.from, "-plain");
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
        if (typeof body?.id !== "string" || !body.id) throw new TransientEmailError("provider answered without an id");
        return { id: body.id };
      }
      const reason = providerReason(res.status, await res.json().catch(() => null));
      const retryAfter = Number(res.headers.get("retry-after"));
      if (res.status === 429 || res.status >= 500 || res.status === 409 || res.status === 401 || res.status === 403)
        throw new TransientEmailError(reason, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
      throw new PermanentEmailError(reason);
    },
  };
}
