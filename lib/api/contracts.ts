// API contracts (docs/03 §6). One Zod schema per request/response, shared by route handlers, the typed client
// and the contract tests. When the lab store is replaced by Supabase (stages 2–4) these stay unchanged.
import { z } from "zod";
import { KIND_IDS } from "@/modules/tenancy/business-kind";
import { normalizePhone } from "@/lib/phone";

export const KindSchema = z.enum(KIND_IDS);
const isRealDate = (v: string) => new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v; // rejects 2026-13-45 and 2026-02-31
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invalid date").refine((v) => !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && isRealDate(v), "invalid date");
export const HHmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "invalid time");

export const LocationSchema = z.enum(["business", "customer", "online"]);

export const ServiceDto = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  durationMinutes: z.number().int().positive(),
  priceNis: z.number().positive(),
  group: z.boolean(),
});

export const IntakeFieldDto = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(["text", "select"]),
  options: z.array(z.string()).optional(),
  required: z.boolean(),
});

export const BusinessDto = z.object({
  name: z.string(),
  address: z.string(),
  locations: z.array(LocationSchema).min(1),
  intake: z.array(IntakeFieldDto),
  vocab: z.record(z.string(), z.string()),
  requireApproval: z.boolean(),
  cancelUntilHours: z.number(),
});

export const ServicesResponse = z.object({ kind: KindSchema, business: BusinessDto, services: z.array(ServiceDto) });

export const AvailabilityQuery = z.object({
  service: z.string().min(1),
  from: IsoDate,
  days: z.coerce.number().int().min(1).max(31),
});
export const DayAvailabilityDto = z.object({ date: IsoDate, closed: z.boolean(), freeSlots: z.number().int().nonnegative() });
export const AvailabilityResponse = z.object({ days: z.array(DayAvailabilityDto) });

export const SlotsQuery = z.object({ service: z.string().min(1), date: IsoDate, selected: HHmm.optional() });
export const SegmentDto = z.object({
  start: z.number().int(),
  end: z.number().int(),
  state: z.enum(["booked", "free", "pending", "closed", "selected"]),
});
export const SlotsResponse = z.object({
  date: IsoDate,
  closed: z.boolean(),
  windows: z.array(z.object({ from: z.number().int(), to: z.number().int() })),
  slots: z.array(z.object({ time: HHmm, spotsLeft: z.number().int().positive().optional() })),
  segments: z.array(SegmentDto),
});

export const CreateBookingRequest = z
  .object({
    serviceId: z.string().min(1),
    date: IsoDate,
    time: HHmm,
    location: LocationSchema.default("business"),
    customer: z
      .object({
        fullName: z.string().trim().min(2, "יש להזין שם (לפחות 2 תווים)."),
        phone: z.string().min(1, "יש להזין מספר טלפון.").refine((v) => normalizePhone(v) !== null, "מספר הטלפון אינו תקין."),
        email: z.string().trim().refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "כתובת האימייל אינה תקינה.").optional(),
      })
      .strict(),
    intake: z.record(z.string(), z.string()).default({}),
  })
  .strict();
export type CreateBookingInput = z.infer<typeof CreateBookingRequest>;

export const BookingDto = z.object({
  id: z.string(),
  reference: z.string(),
  status: z.enum(["confirmed", "pending"]),
  serviceId: z.string(),
  date: IsoDate,
  time: HHmm,
  endTime: HHmm,
  requiresApproval: z.boolean(),
  /** Public bookings only: the customer's private management link (shown on screen; e-mail comes with notifications). */
  manageUrl: z.string().optional(),
});
export const CreateBookingResponse = z.object({ booking: BookingDto });

export const NotificationPreview = z.object({ to: z.string(), subject: z.string(), body: z.string() });

export const AppointmentDto = z.object({
  id: z.string(),
  date: IsoDate,
  start: z.number().int(),
  end: z.number().int(),
  customer: z.string(),
  service: z.string(),
  status: z.enum(["confirmed", "pending", "cancelled", "completed", "cancellationRequested"]),
  note: z.string().optional(),
});
export const AppointmentsResponse = z.object({
  kind: KindSchema,
  date: IsoDate,
  windows: z.array(z.object({ from: z.number().int(), to: z.number().int() })),
  now: z.number().int(),
  appointments: z.array(AppointmentDto),
});

export const TransitionRequest = z.object({ action: z.enum(["approve", "reject", "approveCancellation", "declineCancellation"]) }).strict();
export const TransitionResponse = z.object({ appointment: AppointmentDto });

// ---- owner API (session-authenticated; tenant always comes from the session, never from the request) ----
export const OwnerStatus = z.enum(["confirmed", "pending", "cancelled", "completed", "noShow", "cancellationRequested"]);
export const OwnerAppointmentDto = z.object({
  id: z.string(),
  date: IsoDate,
  start: z.number().int(),
  end: z.number().int(),
  customer: z.string(),
  phone: z.string(),
  service: z.string(),
  status: OwnerStatus,
  manual: z.boolean(),
  outOfHours: z.boolean(),
  note: z.string().optional(),
});
export const OwnerAgendaResponse = z.object({
  date: IsoDate,
  today: IsoDate,
  windows: z.array(z.object({ from: z.number().int(), to: z.number().int() })),
  now: z.number().int().nullable(),
  appointments: z.array(OwnerAppointmentDto),
  /** Everything awaiting a decision from today onwards (any day) — the approvals inbox. */
  inbox: z.array(OwnerAppointmentDto),
  services: z.array(z.object({ id: z.string(), name: z.string(), durationMinutes: z.number().int().positive() })),
  business: z.object({ name: z.string(), kind: KindSchema }),
});
export const OwnerAction = z.enum(["approve", "reject", "cancel", "complete", "noShow", "approveCancellation", "declineCancellation"]);
export const OwnerTransitionRequest = z.object({ action: OwnerAction }).strict();
export const OwnerTransitionResponse = z.object({ id: z.string(), status: OwnerStatus });
export const CreateManualRequest = z
  .object({
    serviceId: z.string().min(1),
    date: IsoDate,
    time: HHmm,
    customer: z.object({
      fullName: z.string().trim().min(2, "יש להזין שם (לפחות 2 תווים).").max(80, "השם ארוך מדי."),
      phone: z.string().min(1, "יש להזין מספר טלפון.").refine((v) => normalizePhone(v) !== null, "מספר הטלפון אינו תקין."),
    }).strict(),
    note: z.string().trim().max(200, "ההערה ארוכה מדי.").optional(),
  })
  .strict();
export type CreateManualInput = z.infer<typeof CreateManualRequest>;
export const CreateManualResponse = z.object({ id: z.string(), reference: z.string(), outOfHours: z.boolean() });

export const ERROR_CODES = [
  "BAD_REQUEST",
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "SLOT_TAKEN",
  "INVALID_SLOT",
  "INVALID_TRANSITION",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_KEY_REUSED",
  "RATE_LIMITED",
  "BOOKING_LIMIT",
  "SERVICE_UNAVAILABLE",
  "TOO_LATE",
  "TOO_EARLY",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INTERNAL",
] as const;
export const ApiErrorBody = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    requestId: z.string(),
    details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiErrorCode = (typeof ERROR_CODES)[number];
