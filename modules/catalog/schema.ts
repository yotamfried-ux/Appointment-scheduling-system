// Zod at the boundary for services (CAT-01..04). Prices are entered in shekels and stored in agorot (integer cents);
// the database enforces the same ranges, so a bypassed UI still cannot store nonsense.
import { z } from "zod";

export const ServiceInput = z
  .object({
    id: z.uuid().optional(),
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(300).optional().default(""),
    durationMinutes: z.number().int().min(5).max(480),
    bufferMinutes: z.number().int().min(0).max(120).default(0),
    priceNis: z.number().min(0).max(100_000),
    capacity: z.number().int().min(1).max(100).default(1),
  })
  .strict();
export type ServiceInput = z.infer<typeof ServiceInput>;

export const toCents = (nis: number) => Math.round(nis * 100);
export const fromCents = (cents: number) => cents / 100;

export interface ServiceRow {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  price_cents: number;
  capacity: number;
  active: boolean;
  position: number;
}

export const DURATION_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240];
export const BUFFER_OPTIONS = [0, 5, 10, 15, 20, 30];

export type CatalogErrorCode = "NOT_AUTHENTICATED" | "FORBIDDEN" | "VALIDATION" | "DUPLICATE" | "INTERNAL";

export function mapCatalogError(err: { code?: string | null; message?: string | null } | null | undefined): CatalogErrorCode {
  const c = err?.code ?? "";
  if (c === "42501") return "FORBIDDEN";
  if (c === "23505") return "DUPLICATE";
  if (c === "23514") return "VALIDATION";
  return "INTERNAL";
}
