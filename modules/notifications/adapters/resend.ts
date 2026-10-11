import { PermanentEmailError, TransientEmailError, type EmailMessage, type EmailPort } from "@/modules/notifications/ports";

// Resend REST adapter (https://resend.com/docs/api-reference/emails/send-email). No SDK: one endpoint, one header, fewer dependencies.
// Status mapping: 2xx = sent · 429/5xx/409/401/403/network = transient (a rate limit, an outage or a fixable configuration) · other 4xx = permanent.
export function resendAdapter(opts: { apiKey: string; from: string; fetchImpl?: typeof fetch; timeoutMs?: number }): EmailPort {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    name: "resend",
    async send(m: EmailMessage) {
      let res: Response;
      try {
        res = await doFetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": m.idempotencyKey },
          body: JSON.stringify({ from: opts.from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        });
      } catch {
        throw new TransientEmailError("network"); // timeout, DNS, reset: the provider may or may not have seen it — the idempotency key makes a retry safe
      }
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { id?: unknown } | null;
        if (typeof body?.id !== "string" || !body.id) throw new TransientEmailError("provider answered without an id");
        return { id: body.id };
      }
      const retryAfter = Number(res.headers.get("retry-after"));
      if (res.status === 429 || res.status >= 500 || res.status === 409 || res.status === 401 || res.status === 403)
        throw new TransientEmailError(`provider ${res.status}`, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
      throw new PermanentEmailError(`provider ${res.status}`);
    },
  };
}
