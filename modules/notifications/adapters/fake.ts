import { PermanentEmailError, TransientEmailError, type EmailMessage, type EmailPort } from "@/modules/notifications/ports";

// Dev/CI adapter: nothing leaves the machine. Failure injection is driven by the recipient's local part so tests stay deterministic:
//   name+fail5xx@…  always fails transiently     name+failonce@…  fails on the first attempt only     name+reject@…  refused permanently
export function fakeAdapter(): EmailPort {
  return {
    name: "fake",
    async send(m: EmailMessage) {
      const local = m.to.split("@")[0].toLowerCase();
      if (local.includes("+fail5xx")) throw new TransientEmailError("injected 5xx");
      if (local.includes("+failonce") && m.attempt === 1) throw new TransientEmailError("injected once");
      if (local.includes("+reject")) throw new PermanentEmailError("injected refusal");
      return { id: `fake_${m.idempotencyKey}` };
    },
  };
}
