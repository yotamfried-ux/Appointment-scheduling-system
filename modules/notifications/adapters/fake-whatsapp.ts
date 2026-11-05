import { PermanentEmailError, TransientEmailError, type WhatsAppMessage, type WhatsAppPort } from "@/modules/notifications/ports";

export interface FakeWhatsAppPort extends WhatsAppPort {
  readonly name: "fake";
  readonly sent: WhatsAppMessage[];
  clear(): void;
}

/**
 * Dev/CI/Simulation WhatsApp adapter: nothing leaves the machine.
 * Deterministic failure injection via recipient phone or idempotencyKey markers:
 * - `+fail5xx` or `0000500` -> always fails transiently
 * - `+failonce` or `0000501` -> fails transiently on attempt 1 only
 * - `+reject` or `0000400` -> fails permanently
 */
export function fakeWhatsAppAdapter(): FakeWhatsAppPort {
  const sent: WhatsAppMessage[] = [];
  return {
    name: "fake",
    sent,
    clear() {
      sent.length = 0;
    },
    async send(m: WhatsAppMessage) {
      const marker = `${m.to}|${m.idempotencyKey}`.toLowerCase();
      if (marker.includes("+fail5xx") || marker.includes("0000500")) {
        throw new TransientEmailError("injected whatsapp 5xx");
      }
      if ((marker.includes("+failonce") || marker.includes("0000501")) && m.attempt === 1) {
        throw new TransientEmailError("injected whatsapp once");
      }
      if (marker.includes("+reject") || marker.includes("0000400")) {
        throw new PermanentEmailError("injected whatsapp refusal");
      }
      sent.push(m);
      return { id: `wamid.fake_${m.idempotencyKey}` };
    },
  };
}
