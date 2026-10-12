import { NextResponse } from "next/server";
import { z } from "zod";
import { api, assertSameOrigin, parse, readJson } from "@/lib/api/http";
import { ownerContext } from "@/modules/booking/owner/service";
import { setNotes } from "@/modules/customers/service";

const Body = z.object({ notes: z.string().max(500, "עד 500 תווים.") }).strict();

export const POST = api<{ id: string }>(async (req, { id }) => {
  assertSameOrigin(req);
  const ctx = await ownerContext();
  const body = parse(Body, await readJson(req));
  await setNotes(ctx, parse(z.string().uuid(), id), body.notes);
  return NextResponse.json({ ok: true });
}, { lab: false });
