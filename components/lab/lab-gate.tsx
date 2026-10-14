import { notFound } from "next/navigation";
import { isProductionLike } from "@/lib/env";

/** The design lab exists in dev/preview only. Production (VERCEL_ENV=production) returns 404. */
export function LabGate({ children }: { children: React.ReactNode }) {
  if (isProductionLike()) notFound();
  return children;
}
