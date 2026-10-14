import { NextResponse } from "next/server";
import { z } from "zod";
import { api, assertSameOrigin, parse, readJson } from "@/lib/api/http";
import { ownerContext } from "@/modules/booking/owner/service";
import { cancelDeletion, requestDeletion } from "@/modules/account/service";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), confirmName: z.string().max(200) }).strict(),
  z.object({ action: z.literal("cancel") }).strict(),
]);

// ACC-09: request deletion (the owner types the business name) or cancel the request during the grace period. Owner only; CSRF-checked.
export const POST = api(async (req) => {
  assertSameOrigin(req);
  const ctx = await ownerContext();
  const body = parse(Body, await readJson(req));
  const r = body.action === "request" ? await requestDeletion(ctx, body.confirmName) : await cancelDeletion(ctx);
  return NextResponse.json(r);
}, { lab: false });
