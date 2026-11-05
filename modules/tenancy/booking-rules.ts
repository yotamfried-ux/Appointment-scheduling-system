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
  rescheduleServiceChange: z.boolean(),
  /** Uniform daily limit on waitlist registrations across all working days (null = unlimited). */
  waitlistDailyLimit: z.number().int().min(1).max(500).nullable().optional().default(null),
  /** Opt-in WhatsApp notifications (never enabled by default; gated by subscription plan in the future). */
  whatsappEnabled: z.boolean().optional().default(false),
});
export type BookingRules = z.infer<typeof BookingRulesInput>;
