import { normalizePhone } from "@/lib/phone";
import { PermanentEmailError, TransientEmailError, type WhatsAppMessage, type WhatsAppPort } from "@/modules/notifications/ports";

/**
 * Normalizes an Israeli or international phone number to the digits-only format
 * expected by Meta's WhatsApp Cloud API (`9725...` without a leading `+`).
 */
export function toWhatsAppRecipient(phone: string): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return normalized.replace(/^\+/, "");
}

/**
 * Extracts a safe, PII-scrubbed diagnostic string from a Meta Graph API error body.
 * Never logs or returns recipient phone numbers, email addresses, or tokens.
 */
export function whatsappProviderReason(status: number, body: unknown): string {
  const root = (body && typeof body === "object" ? body : {}) as { error?: unknown };
  const err = (root.error && typeof root.error === "object" ? root.error : root) as {
    type?: unknown;
    code?: unknown;
    error_subcode?: unknown;
    message?: unknown;
  };
  const type = typeof err.type === "string" ? err.type.replace(/[^A-Za-z0-9_ -]/g, "").slice(0, 40) : "";
  const code = typeof err.code === "number" || typeof err.code === "string" ? String(err.code).replace(/[^0-9]/g, "").slice(0, 12) : "";
  const message =
    typeof err.message === "string"
      ? err.message
          .replace(/\S+@\S+/g, "[address]")
          .replace(/\+?\d[\d\s-]{6,16}\d/g, "[phone]")
          .replace(/EAA[A-Za-z0-9]+/g, "[token]")
          .replace(/[\r\n]+/g, " ")
          .trim()
      : "";
  const tag = [type, code ? `#${code}` : ""].filter(Boolean).join(" ");
  const detail = [tag, message].filter(Boolean).join(": ").slice(0, 120);
  return detail ? `whatsapp ${status}: ${detail}` : `whatsapp ${status}`;
}

export interface MetaWhatsAppVerifyResult {
  ok: boolean;
  appId?: string;
  application?: string;
  userId?: string;
  userName?: string;
  type?: string;
  scopes: string[];
  isValid: boolean;
}

/**
 * Verifies a Meta WhatsApp Business System User / Access Token against Meta Graph API.
 */
export async function verifyWhatsAppConnection(opts: {
  accessToken: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): Promise<MetaWhatsAppVerifyResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const version = opts.apiVersion ?? "v21.0";
  const baseUrl = `https://graph.facebook.com/${version}`;
  const headers = { Authorization: `Bearer ${opts.accessToken}` };

  const [meRes, debugRes] = await Promise.all([
    doFetch(`${baseUrl}/me?fields=id,name`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    }),
    doFetch(`${baseUrl}/debug_token?input_token=${encodeURIComponent(opts.accessToken)}`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
    }),
  ]);

  if (!meRes.ok || !debugRes.ok) {
    return { ok: false, scopes: [], isValid: false };
  }

  const meBody = (await meRes.json().catch(() => null)) as { id?: string; name?: string } | null;
  const debugBody = (await debugRes.json().catch(() => null)) as {
    data?: {
      app_id?: string;
      application?: string;
      type?: string;
      is_valid?: boolean;
      scopes?: string[];
      user_id?: string;
    };
  } | null;

  const data = debugBody?.data;
  const isValid = Boolean(data?.is_valid);
  const scopes = Array.isArray(data?.scopes) ? data.scopes : [];
  const hasMessagingScope = scopes.includes("whatsapp_business_messaging");

  return {
    ok: isValid && hasMessagingScope,
    appId: data?.app_id,
    application: data?.application,
    userId: meBody?.id ?? data?.user_id,
    userName: meBody?.name,
    type: data?.type,
    scopes,
    isValid,
  };
}

/**
 * Meta WhatsApp Cloud API REST adapter (`https://graph.facebook.com/{version}/{phoneNumberId}/messages`).
 * Status mapping:
 * - 2xx = sent (returns Meta `wamid.*` message id)
 * - 429 / 5xx / 401 / 403 / network = transient (worth retrying)
 * - other 4xx = permanent refusal
 */
export function metaWhatsAppAdapter(opts: {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): WhatsAppPort {
  const doFetch = opts.fetchImpl ?? fetch;
  const version = opts.apiVersion ?? "v21.0";
  const endpoint = `https://graph.facebook.com/${version}/${encodeURIComponent(opts.phoneNumberId)}/messages`;

  return {
    name: "meta",
    async send(m: WhatsAppMessage) {
      const to = toWhatsAppRecipient(m.to);
      if (!to) {
        throw new PermanentEmailError("whatsapp 400: invalid recipient phone number");
      }

      const payload = m.template
        ? {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "template",
            template: {
              name: m.template.name,
              language: { code: m.template.languageCode ?? "he" },
              ...(m.template.bodyParams?.length
                ? {
                    components: [
                      {
                        type: "body",
                        parameters: m.template.bodyParams.map((text) => ({ type: "text", text })),
                      },
                    ],
                  }
                : {}),
            },
          }
        : {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to,
            type: "text",
            text: { preview_url: false, body: m.body },
          };

      let res: Response;
      try {
        res = await doFetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
        });
      } catch {
        throw new TransientEmailError("network");
      }

      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { messages?: { id?: unknown }[] } | null;
        const msgId = body?.messages?.[0]?.id;
        if (typeof msgId !== "string" || !msgId) {
          throw new TransientEmailError("whatsapp provider answered without a message id");
        }
        return { id: msgId };
      }

      const reason = whatsappProviderReason(res.status, await res.json().catch(() => null));
      const retryAfter = Number(res.headers.get("retry-after"));
      if (res.status === 429 || res.status >= 500 || res.status === 401 || res.status === 403) {
        throw new TransientEmailError(reason, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined);
      }
      throw new PermanentEmailError(reason);
    },
  };
}
