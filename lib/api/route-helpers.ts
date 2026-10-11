import { fail, parse } from "@/lib/api/http";
import { KindSchema } from "@/lib/api/contracts";
import type { z } from "zod";

export const kindOf = (raw: string) => {
  const r = KindSchema.safeParse(raw);
  if (!r.success) throw fail("NOT_FOUND", "סוג העסק לא נמצא.");
  return r.data;
};

export const queryOf = <T>(schema: z.ZodType<T>, req: Request): T =>
  parse(schema, Object.fromEntries(new URL(req.url).searchParams));
