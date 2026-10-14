import { NextResponse } from "next/server";
import { z } from "zod";
import { api, assertSameOrigin, parse } from "@/lib/api/http";
import { ownerContext } from "@/modules/booking/owner/service";
import { anonymize } from "@/modules/customers/service";
import { requireAdmin } from "@/modules/reports/service";

export const POST = api<{ id: string }>(async (req, { id }) => {
  assertSameOrigin(req);
  const ctx = await ownerContext();
  requireAdmin(ctx);
  return NextResponse.json({ outcome: await anonymize(ctx, parse(z.string().uuid(), id)) });
}, { lab: false });
