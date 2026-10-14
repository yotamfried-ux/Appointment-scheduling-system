import "server-only";
import { fail } from "@/lib/api/http";
import { mapError, type OwnerCtx } from "@/modules/booking/owner/service";

// ACC-09. Owner only (the database checks it too). The export is one JSON document; deletion has a 14-day grace period.
export function requireOwner(ctx: OwnerCtx) {
  if (ctx.role !== "owner") throw fail("FORBIDDEN", "רק בעל העסק יכול לייצא או למחוק את החשבון.");
}

export async function exportAccount(ctx: OwnerCtx): Promise<{ filename: string; body: string }> {
  requireOwner(ctx);
  const { data, error } = await ctx.supabase.rpc("owner_export_account", { p_business: ctx.business.id });
  if (error) throw mapError(error);
  const day = new Date().toISOString().slice(0, 10);
  return { filename: `account-export-${day}.json`, body: JSON.stringify(data, null, 2) };
}

export type DeletionOutcome = { outcome: "requested" | "already"; scheduledFor: string; appointmentsCancelled?: number } | { outcome: "cancelled" | "not_pending" };

export async function requestDeletion(ctx: OwnerCtx, confirmName: string): Promise<DeletionOutcome> {
  requireOwner(ctx);
  const { data, error } = await ctx.supabase.rpc("request_business_deletion", { p_business: ctx.business.id, p_confirm_name: confirmName });
  if (error) {
    if (error.message.includes("confirmation_mismatch")) throw fail("VALIDATION_FAILED", "שם העסק שהוקלד אינו תואם.", [{ field: "confirmName", message: "הקלידו את שם העסק בדיוק כפי שהוא מופיע." }]);
    throw mapError(error);
  }
  return data as DeletionOutcome;
}

export async function cancelDeletion(ctx: OwnerCtx): Promise<DeletionOutcome> {
  requireOwner(ctx);
  const { data, error } = await ctx.supabase.rpc("cancel_business_deletion", { p_business: ctx.business.id });
  if (error) throw mapError(error);
  return data as DeletionOutcome;
}

export async function deletionStatus(ctx: OwnerCtx): Promise<{ scheduledFor: string } | null> {
  const { data } = await ctx.supabase.from("businesses").select("deletion_scheduled_for").eq("id", ctx.business.id).single();
  return data?.deletion_scheduled_for ? { scheduledFor: data.deletion_scheduled_for as string } : null;
}
