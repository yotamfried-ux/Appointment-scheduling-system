import "server-only";
import { createHmac } from "node:crypto";
import { fakeAdapter } from "@/modules/notifications/adapters/fake";
import { resendAdapter } from "@/modules/notifications/adapters/resend";
import type { EmailPort } from "@/modules/notifications/ports";

const isProduction = () => process.env.VERCEL_ENV === "production";

/** Fails closed: production never falls back to the fake adapter, and the Resend adapter needs its key and sender. */
export function emailProvider(): EmailPort {
  const which = process.env.EMAIL_PROVIDER ?? (isProduction() ? "resend" : "fake");
  if (which === "fake") {
    if (isProduction()) throw new Error("the fake e-mail provider is not allowed in production");
    return fakeAdapter();
  }
  if (which === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!apiKey || !from) throw new Error("RESEND_API_KEY and EMAIL_FROM are required for the resend provider");
    return resendAdapter({ apiKey, from });
  }
  throw new Error("unknown EMAIL_PROVIDER");
}

export const appUrl = () => (process.env.APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");

/** Addresses are never stored in the log or the suppression list — only this keyed hash. */
export function addressHash(address: string): string {
  const pepper = process.env.NOTIFICATIONS_PEPPER ?? (isProduction() ? undefined : "dev-only-pepper");
  if (!pepper) throw new Error("NOTIFICATIONS_PEPPER is required in production");
  return createHmac("sha256", pepper).update(address.trim().toLowerCase()).digest("hex");
}

/** Preview bodies are stored only for the fake provider (dev/CI), never for real mail. */
export const storesPreview = (p: EmailPort) => p.name === "fake";
