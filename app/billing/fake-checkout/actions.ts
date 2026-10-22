"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { billingProvider } from "@/modules/billing/config";
import type { NormalizedEvent } from "@/modules/billing/ports";
import { myBilling } from "@/modules/billing/entitlements";
import { applyBillingEvent } from "@/modules/billing/system";
import { ownerContext } from "@/modules/booking/owner/service";

// Stands in for "the provider charged the card and later calls our webhook". Development/CI only: the page and this action refuse any other provider.
async function guard() {
  if (billingProvider().name !== "fake") throw new Error("not available");
  const ctx = await ownerContext();
  if (ctx.role !== "owner" && ctx.role !== "admin") throw new Error("forbidden");
  return ctx;
}

const deliver = (event: NormalizedEvent, delayMs: number) => {
  const run = () => applyBillingEvent("fake", event);
  if (delayMs <= 0) return run();
  after(async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    await run();
  });
};

export async function fakePayAction(form: FormData) {
  const ctx = await guard();
  const plan = String(form.get("plan") ?? "");
  const delay = Math.min(Math.max(Number(form.get("delay") ?? 0) || 0, 0), 10_000);
  const outcome = form.get("outcome") === "fail" ? "fail" : "pay";
  const now = new Date();
  const event: NormalizedEvent =
    outcome === "pay"
      ? { eventId: `evt_${randomUUID()}`, type: "subscription.updated", occurredAt: now.toISOString(), businessId: ctx.business.id,
          data: { planId: plan, status: "active", currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000).toISOString(), cancelAtPeriodEnd: false,
                  externalCustomerId: `cus_fake_${ctx.business.id.slice(0, 8)}`, externalSubscriptionId: `sub_fake_${ctx.business.id.slice(0, 8)}` } }
      : { eventId: `evt_${randomUUID()}`, type: "payment.failed", occurredAt: now.toISOString(), businessId: ctx.business.id, data: {} };
  await deliver(event, delay);
  redirect("/settings/billing?checkout=return");
}

export async function fakeCancelAction() {
  const ctx = await guard();
  const mine = await myBilling(ctx);
  await applyBillingEvent("fake", {
    eventId: `evt_${randomUUID()}`, type: "subscription.canceled", occurredAt: new Date().toISOString(), businessId: ctx.business.id,
    data: { currentPeriodEnd: mine.currentPeriodEnd ?? new Date(Date.now() + 30 * 86_400_000).toISOString() },
  });
  redirect("/settings/billing");
}
