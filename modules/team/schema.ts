import { z } from "zod";

// Team settings (stage 16, T13): names 1–80 characters, writes only through the audited RPCs. Pure: no server-only imports, so unit tests and client code can use it.
export const StaffNameInput = z.string().trim().min(1).max(80);

export const StaffUpdateInput = z
  .object({ id: z.uuid(), name: StaffNameInput.optional(), active: z.boolean().optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.active !== undefined, "nothing to change");
export type StaffUpdateInput = z.infer<typeof StaffUpdateInput>;

/** An empty list lifts the restriction (everybody can do the service). */
export const ServiceStaffInput = z
  .object({ serviceId: z.uuid(), resourceIds: z.array(z.uuid()).max(30).transform((ids) => [...new Set(ids)]) })
  .strict();
export type ServiceStaffInput = z.infer<typeof ServiceStaffInput>;

export type TeamErrorCode = "NOT_AUTHENTICATED" | "FORBIDDEN" | "VALIDATION" | "LIMIT" | "NAME_TAKEN" | "LAST_ACTIVE" | "INTERNAL";

export interface TeamPersonRow {
  id: string;
  name: string;
  active: boolean;
  isDefault: boolean;
  position: number;
  /** Upcoming appointments still on this person (shown before and after switching them off: nothing moves silently, T8). */
  futureAppointments: number;
}

export function mapTeamError(e: { code?: string | null; message?: string | null } | null): TeamErrorCode {
  const m = e?.message ?? "";
  if (m.includes("team_limit")) return "LIMIT";
  if (m.includes("name_taken")) return "NAME_TAKEN";
  if (m.includes("last_active_person")) return "LAST_ACTIVE";
  if (m.includes("resource_mismatch") || m.includes("forbidden") || e?.code === "42501") return "FORBIDDEN";
  if (m.includes("invalid_name") || m.includes("invalid_hours") || e?.code === "23514") return "VALIDATION";
  return "INTERNAL";
}
