// API contracts (docs/03 §6). One Zod schema per request/response, shared by route handlers, the typed client
// and the contract tests. When the lab store is replaced by Supabase (stages 2–4) these stay unchanged.
import { z } from "zod";
import { KIND_IDS } from "@/modules/tenancy/business-kind";
import { normalizePhone } from "@/lib/phone";
import { LEGAL } from "@/lib/legal/config";

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
  priceNis: z.number().min(0),
  priceMode: z.enum(["fixed", "from", "free", "hidden"]).default("fixed"),
  group: z.boolean(),
  /** Who can do it (null = everybody). Only meaningful when the business has two or more people. */
  personIds: z.array(z.string()).nullable().default(null),
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
  /** Public pages only: customers may join the waitlist for a full day. */
  waitlistEnabled: z.boolean().optional(),
  /** False when the business's subscription has lapsed (BKG-11/BIL-01): the page says so instead of offering times. */
  acceptingBookings: z.boolean().optional(),
});

/** Empty for a one-person business: the page shows no "with whom?" step. */
export const TeamMemberDto = z.object({ id: z.string(), name: z.string() });
export const ServicesResponse = z.object({ kind: KindSchema, business: BusinessDto, services: z.array(ServiceDto), team: z.array(TeamMemberDto).default([]) });

export const AvailabilityQuery = z.object({
  service: z.string().min(1),
  from: IsoDate,
  days: z.coerce.number().int().min(1).max(31),
  person: z.string().min(1).optional(),
});
export const DayAvailabilityDto = z.object({ date: IsoDate, closed: z.boolean(), freeSlots: z.number().int().nonnegative() });
export const AvailabilityResponse = z.object({ days: z.array(DayAvailabilityDto) });

export const SlotsQuery = z.object({ service: z.string().min(1), date: IsoDate, selected: HHmm.optional(), person: z.string().min(1).optional() });
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

/** What the customer accepted: the versions of the terms and the privacy policy that were shown. Only the CURRENT versions are valid; the server stores what it receives and never looks up whether this customer accepted before. */
const AcceptedTermsMessage = "יש לאשר את תנאי השימוש ואת מדיניות הפרטיות (בגרסתם הנוכחית) כדי להמשיך.";
export const AcceptedTerms = z
  .object(
    {
      terms: z.literal(LEGAL.terms.version, { error: AcceptedTermsMessage }),
      privacy: z.literal(LEGAL.privacy.version, { error: AcceptedTermsMessage }),
    },
    { error: AcceptedTermsMessage },
  )
  .strict();

export const CreateBookingRequest = z
  .object({
    serviceId: z.string().min(1),
    date: IsoDate,
    time: HHmm,
    /** The person the customer named; absent = "whoever is free". */
    personId: z.string().min(1).optional(),
    location: LocationSchema.default("business"),
    customer: z
      .object({
        fullName: z.string().trim().min(2, "יש להזין שם (לפחות 2 תווים).").max(80, "השם ארוך מדי."),
        phone: z.string().min(1, "יש להזין מספר טלפון.").refine((v) => normalizePhone(v) !== null, "מספר הטלפון אינו תקין."),
        /** The customer is identified by this address (owner decision 2026-10-23); the confirmation and the link to manage the appointment go to it. */
        email: z.string().trim().min(1, "יש להזין כתובת אימייל — אליה נשלח האישור והקישור לניהול התור.").refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "כתובת האימייל אינה תקינה."),
      })
      .strict(),
    intake: z.record(z.string(), z.string()).default({}),
    acceptedTerms: AcceptedTerms,
  })
  .strict();
export type CreateBookingInput = z.infer<typeof CreateBookingRequest>;

const EmailRequired = z.string().trim().min(1, "יש להזין כתובת אימייל — ההצעות נשלחות אליה.").refine((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "כתובת האימייל אינה תקינה.");
export const JoinWaitlistRequest = z
  .object({
    serviceId: z.string().min(1),
    date: IsoDate,
    window: z.object({ from: HHmm, to: HHmm }).strict().refine((w) => w.from < w.to, "שעת ההתחלה חייבת להיות לפני הסיום.").optional(),
    customer: z
      .object({
        fullName: z.string().trim().min(2, "יש להזין שם (לפחות 2 תווים).").max(80, "השם ארוך מדי."),
        phone: z.string().min(1, "יש להזין מספר טלפון.").refine((v) => normalizePhone(v) !== null, "מספר הטלפון אינו תקין."),
        email: EmailRequired,
      })
      .strict(),
    acceptedTerms: AcceptedTerms,
  })
  .strict();
export type JoinWaitlistInput = z.infer<typeof JoinWaitlistRequest>;
/** `id` and `manageUrl` are only returned to the browser that created the entry; a second submitter with the same phone number learns nothing about it. */
export const JoinWaitlistResponse = z.object({ id: z.string().optional(), replay: z.boolean(), manageUrl: z.string().optional() });

export const BookingDto = z.object({
  id: z.string(),
  reference: z.string(),
  status: z.enum(["confirmed", "pending"]),
  serviceId: z.string(),
  date: IsoDate,
  time: HHmm,
  endTime: HHmm,
  requiresApproval: z.boolean(),
  /** Only in a business with two or more people. */
  personName: z.string().optional(),
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
  /** Whose calendar the appointment is in (stage 16). */
  personId: z.string(),
  personName: z.string(),
});
export const OwnerWaitlistEntryDto = z.object({
  id: z.string(),
  date: IsoDate,
  customer: z.string(),
  phone: z.string(),
  service: z.string(),
  fromMinute: z.number().int().nullable(),
  toMinute: z.number().int().nullable(),
  status: z.enum(["waiting", "offered"]),
  /** Only for a live offer: until when the customer may accept, and which slot (local minutes). */
  offer: z.object({ expiresAt: z.string(), expiresMinute: z.number().int(), slotStartMinute: z.number().int() }).nullable(),
});
export const FailureCode = z.enum(["rate_limited", "provider_rejected", "unknown", "bounced", "no_email"]);
export type FailureCode = z.infer<typeof FailureCode>;
export const OwnerAgendaResponse = z.object({
  date: IsoDate,
  today: IsoDate,
  windows: z.array(z.object({ from: z.number().int(), to: z.number().int() })),
  now: z.number().int().nullable(),
  appointments: z.array(OwnerAppointmentDto),
  /** Everything awaiting a decision from today onwards (any day) — the approvals inbox. */
  inbox: z.array(OwnerAppointmentDto),
  /** Messages that could not be delivered after all retries in the last 7 days (NTF-04): the owner should reach those customers another way. */
  undelivered: z.number().int().nonnegative(),
  /** Which message, to whom, for which time and why (last 7 days, newest first). `no_email` rows are not failures: there was nobody to send to. */
  undeliveredItems: z.array(z.object({ id: z.string(), kind: z.string(), code: FailureCode, customer: z.string(), date: IsoDate, start: z.number().int() })),
  waitlist: z.array(OwnerWaitlistEntryDto),
  settings: z.object({ waitlistEnabled: z.boolean(), waitlistAutoOffer: z.boolean() }),
  /** What the subscription allows (BIL-08): the panel shows an upsell instead of a feature the plan does not include. */
  billing: z.object({ state: z.enum(["trial", "active", "grace", "degraded"]), features: z.object({ waitlist: z.boolean(), export: z.boolean() }) }).optional(),
  /** Cheap change marker: the client polls `/api/owner/version` and reloads only when it differs. */
  version: z.string(),
  services: z.array(z.object({ id: z.string(), name: z.string(), durationMinutes: z.number().int().positive() })),
  business: z.object({ name: z.string(), kind: KindSchema }),
  /** Stage 16. The active people and that day's hours of each; `person` is the filter in effect (null = everyone). One entry for a one-person business. */
  person: z.string().nullable(),
  people: z.array(z.object({ id: z.string(), name: z.string(), windows: z.array(z.object({ from: z.number().int(), to: z.number().int() })) })),
  /** Upcoming appointments that sit with a person who is no longer active (T8): nothing moves silently, the owner moves or cancels them. */
  orphans: z.object({ total: z.number().int().nonnegative(), items: z.array(z.object({ id: z.string(), date: IsoDate, start: z.number().int(), customer: z.string(), personName: z.string() })) }),
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
    /** Absent = whoever is free. */
    personId: z.string().min(1).optional(),
  })
  .strict();
export type CreateManualInput = z.infer<typeof CreateManualRequest>;
export const CreateManualResponse = z.object({ id: z.string(), reference: z.string(), outOfHours: z.boolean() });

export const OwnerOfferRequest = z.object({ time: HHmm }).strict();
export const OwnerWaitlistSettingsRequest = z
  .object({ autoOffer: z.boolean().optional(), enabled: z.boolean().optional() })
  .strict()
  .refine((v) => v.autoOffer !== undefined || v.enabled !== undefined, "יש לציין הגדרה לשינוי.");
export const OwnerOutcomeResponse = z.object({ ok: z.literal(true) });
export const OwnerVersionResponse = z.object({ version: z.string() });

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
  "BLOCKED",
  "SERVICE_UNAVAILABLE",
  "TOO_LATE",
  "TOO_EARLY",
  "WAITLIST_LIMIT",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "PAYMENT_REQUIRED",
  "BOOKINGS_CLOSED",
  "UNAVAILABLE",
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

// RSC-04: the owner moves a booking to another time (same service, same length).
export const OwnerMoveRequest = z.object({ date: IsoDate, time: HHmm, /** Move to another person (T7). */ personId: z.string().min(1).optional() }).strict();
export const OwnerMoveResponse = z.object({ id: z.string(), status: z.string(), outOfHours: z.boolean() });
