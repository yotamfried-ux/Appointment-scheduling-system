import { notFound } from "next/navigation";

/** The design lab exists in dev/preview only. Production (VERCEL_ENV=production) returns 404. */
export function LabGate({ children }: { children: React.ReactNode }) {
  if (process.env.VERCEL_ENV === "production") notFound();
  return children;
}
