import { api } from "@/lib/api/http";
import { kindOf } from "@/lib/api/route-helpers";
import { businessOf, servicesOf } from "@/lib/api/lab-store";

export const GET = api<{ kind: string }>(async (_req, { kind }) => {
  const k = kindOf(kind);
  return { kind: k, business: businessOf(k), services: servicesOf(k) };
});
