// The e-mail channel as a port (docs/00 D1: e-mail only in v1; WhatsApp/SMS would be another adapter, not a refactor).
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Provider-side duplicate protection: the same key never produces a second e-mail (Resend keeps it for 24h). */
  idempotencyKey: string;
  /** 1-based attempt number (lets the fake adapter simulate "fails once"). */
  attempt: number;
}

export interface EmailPort {
  readonly name: "resend" | "fake";
  send(message: EmailMessage): Promise<{ id: string }>;
}

/** Worth retrying: provider down, rate limited, network, or a duplicate request still in flight. */
export class TransientEmailError extends Error {
  constructor(message: string, public retryAfterSeconds?: number) {
    super(message);
    this.name = "TransientEmailError";
  }
}

/** Retrying cannot help: the provider refused this message. */
export class PermanentEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentEmailError";
  }
}
