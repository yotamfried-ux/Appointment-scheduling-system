import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { ownerContext } from "@/modules/booking/owner/service";

/** Server-component entry for owner pages: session + MFA gate, then the same owner context the API uses (RLS as the signed-in user). */
export const ownerPage = cache(async function ownerPage() {
  const { claims } = await requireUser();
  let ctx;
  try {
    ctx = await ownerContext();
  } catch {
    redirect("/onboarding"); // signed in but no business yet
  }
  return { ctx, email: ctx.business.name || String(claims.email ?? "") };
});
