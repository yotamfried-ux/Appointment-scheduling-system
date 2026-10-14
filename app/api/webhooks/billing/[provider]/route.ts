import { NextResponse } from "next/server";
import { billingProvider } from "@/modules/billing/config";
import { WebhookVerificationError } from "@/modules/billing/ports";
import { NormalizedEventSchema } from "@/modules/billing/schema";
import { applyBillingEvent } from "@/modules/billing/system";

// The single source of truth for subscription state (docs/05 §6): the RAW body is verified by the provider adapter, every event is validated,
// then the database orders and de-duplicates it. Redirects from a payment page never reach here and never change anything (BIL-04).
export async function POST(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const headers = { "Cache-Control": "no-store" };
  let adapter;
  try {
    adapter = billingProvider();
  } catch {
    return NextResponse.json({ error: { code: "UNAVAILABLE" } }, { status: 503, headers });
  }
  if (provider !== adapter.name) return NextResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404, headers });
  const raw = await req.text();
  let events;
  try {
    events = adapter.parseWebhook(raw, req.headers).map((e) => NormalizedEventSchema.parse(e));
  } catch (e) {
    // security event (docs/05 §8): no body, no signature, no PII in the log
    console.warn(JSON.stringify({ level: "warn", msg: "billing webhook rejected", provider, reason: e instanceof WebhookVerificationError ? "signature" : "invalid" }));
    return NextResponse.json({ error: { code: "BAD_REQUEST" } }, { status: 400, headers });
  }
  const results: string[] = [];
  for (const e of events) results.push(await applyBillingEvent(adapter.name, e));
  return NextResponse.json({ results }, { headers });
}
