import { NextResponse } from "next/server";
import { OwnerWaitlistSettingsRequest } from "@/lib/api/contracts";
import { api, assertSameOrigin, parse, readJson } from "@/lib/api/http";
import { ownerContext, waitlistSettings } from "@/modules/booking/owner/service";

export const POST = api(async (req) => {
  assertSameOrigin(req);
  const ctx = await ownerContext();
  await waitlistSettings(ctx, parse(OwnerWaitlistSettingsRequest, await readJson(req)));
  return NextResponse.json({ ok: true });
}, { lab: false });
