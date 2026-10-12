import { z } from "zod";

// The owner's booking rules (one row of `businesses`). Validated here AND by CHECK constraints in the database.
export const BookingRulesInput = z.object({
  requiresApproval: z.boolean(),
  cancelUntilHours: z.number().int().min(0).max(720),
  minNoticeMinutes: z.number().int().min(0).max(10080),
  horizonDays: z.number().int().min(1).max(365),
  address: z.string().trim().max(200),
  noShowPolicy: z.enum(["off", "warn", "require_approval", "block"]),
  noShowThreshold: z.number().int().min(1).max(20),
  blockMessage: z.string().trim().max(300),
  attendanceAlertMinutes: z.number().int().min(0).max(1440),
  autoCompleteHours: z.number().int().min(1).max(168).nullable(),
  digestFrequency: z.enum(["off", "daily"]),
});
export type BookingRules = z.infer<typeof BookingRulesInput>;
