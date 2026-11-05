import "server-only";
import { createHmac } from "node:crypto";
import { fakeAdapter } from "@/modules/notifications/adapters/fake";
import { fakeWhatsAppAdapter } from "@/modules/notifications/adapters/fake-whatsapp";
import { resendAdapter } from "@/modules/notifications/adapters/resend";
import { metaWhatsAppAdapter } from "@/modules/notifications/adapters/whatsapp";
import type { EmailPort, WhatsAppPort } from "@/modules/notifications/ports";
import { isProductionLike } from "@/lib/env";

const isProduction = isProductionLike;

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

/** The public address used in every e-mail link. Configured value first; on Vercel with nothing configured (a Preview) the deployment's own stable address, so links never point at localhost. */
export function appUrl(): string {
  const vercel = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
  const v = process.env.APP_URL || process.env.NEXT_PUBLIC_SITE_URL || (vercel ? `https://${vercel}` : "http://127.0.0.1:3100");
  return v.replace(/\/$/, "");
}

/** Addresses are never stored in the log or the suppression list — only this keyed hash. */
export function addressHash(address: string): string {
  const pepper = process.env.NOTIFICATIONS_PEPPER ?? (isProduction() ? undefined : "dev-only-pepper");
  if (!pepper) throw new Error("NOTIFICATIONS_PEPPER is required in production");
  return createHmac("sha256", pepper).update(address.trim().toLowerCase()).digest("hex");
}

/** Preview bodies are stored only for the fake provider (dev/CI), never for real mail. */
export const storesPreview = (p: EmailPort) => p.name === "fake";

/** Designated recipient for platform administrator alerts (e.g. new business registration). */
export function platformAdminEmail(): string {
  return process.env.PLATFORM_ADMIN_EMAIL ?? "yotam.fried@gmail.com";
}

const disabledWhatsAppPort: WhatsAppPort = {
  name: "disabled",
  async send() {
    return { id: "disabled" };
  },
};

/**
 * WhatsApp channel provider.
 * CRITICAL: Disabled by default (`WHATSAPP_PROVIDER` defaults to `"disabled"`).
 * Even when configured, a business only sends WhatsApp notifications if `business.whatsappEnabled === true`.
 */
export function whatsappProvider(): WhatsAppPort {
  const which = process.env.WHATSAPP_PROVIDER ?? "disabled";
  if (which === "disabled" || which === "off" || which === "") {
    return disabledWhatsAppPort;
  }
  if (which === "fake") {
    if (isProduction()) throw new Error("the fake WhatsApp provider is not allowed in production");
    return fakeWhatsAppAdapter();
  }
  if (which === "meta") {
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!accessToken || !phoneNumberId) {
      throw new Error("WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID are required for the meta WhatsApp provider");
    }
    return metaWhatsAppAdapter({
      accessToken,
      phoneNumberId,
      apiVersion: process.env.WHATSAPP_API_VERSION ?? "v21.0",
    });
  }
  throw new Error("unknown WHATSAPP_PROVIDER");
}
