import { NextResponse } from "next/server";
import { z } from "zod";
import { api, assertSameOrigin, parse, readJson } from "@/lib/api/http";
import { ownerContext } from "@/modules/booking/owner/service";
import { requireAdmin } from "@/modules/reports/service";
import { setPolicyOverride } from "@/modules/customers/service";

const Body = z.object({ override: z.boolean() }).strict();

// BKG-08: an admin clears (or restores) the no-show policy for one customer. Audited in the database.
export const POST = api<{ id: string }>(async (req, { id }) => {
  assertSameOrigin(req);
  const ctx = await ownerContext();
  requireAdmin(ctx);
  const body = parse(Body, await readJson(req));
  await setPolicyOverride(ctx, parse(z.string().uuid(), id), body.override);
  return NextResponse.json({ ok: true });
}, { lab: false });
