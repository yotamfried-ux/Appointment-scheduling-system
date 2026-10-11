// Typed browser client for the lab API. Every response is validated with the shared Zod contract, so a server/UI
// drift fails loudly in tests instead of silently rendering wrong data. Error bodies are mapped to ApiClientError.
import type { z } from "zod";
import * as C from "@/lib/api/contracts";
import type { BusinessKindId } from "@/modules/tenancy/business-kind";

export class ApiClientError extends Error {
  constructor(
    public code: C.ApiErrorCode | "NETWORK" | "BAD_RESPONSE",
    message: string,
    public status = 0,
    public details: { field: string; message: string }[] = [],
    public retryAfter?: number,
  ) {
    super(message);
  }
}

export interface ClientOptions {
  kind: BusinessKindId;
  session: string;
  /** Test hook: lowers the server-side rate limit for this request. */
  limit?: number;
  /** API root. Default: the lab API for `kind`. Public booking passes `/api/public/<slug>`. */
  base?: string;
  signal?: AbortSignal;
}

async function call<T>(schema: z.ZodType<T>, path: string, o: ClientOptions, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<{ data: T; status: number; replay: boolean }> {
  let res: Response;
  try {
    res = await fetch(`${o.base ?? `/api/lab/${o.kind}`}/${path}`, {
      method: init.method ?? "GET",
      signal: o.signal,
      headers: {
        "x-lab-session": o.session,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
        ...(init.idempotencyKey ? { "idempotency-key": init.idempotencyKey } : {}),
        ...(o.limit ? { "x-lab-limit": String(o.limit), "x-test-limit": String(o.limit) } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiClientError("NETWORK", "network");
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiClientError("BAD_RESPONSE", "invalid json", res.status);
  }
  if (!res.ok) {
    const e = C.ApiErrorBody.safeParse(json);
    if (!e.success) throw new ApiClientError("BAD_RESPONSE", "unexpected error shape", res.status);
    const ra = Number(res.headers.get("retry-after"));
    throw new ApiClientError(e.data.error.code, e.data.error.message, res.status, e.data.error.details ?? [], Number.isFinite(ra) && ra > 0 ? ra : undefined);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiClientError("BAD_RESPONSE", "response violates contract", res.status);
  return { data: parsed.data, status: res.status, replay: res.headers.get("idempotent-replay") === "true" };
}

const qs = (q: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();

export const labApi = {
  services: (o: ClientOptions) => call(C.ServicesResponse, "services", o).then((r) => r.data),
  availability: (o: ClientOptions, q: { service: string; from: string; days: number }) => call(C.AvailabilityResponse, `availability?${qs(q)}`, o).then((r) => r.data),
  slots: (o: ClientOptions, q: { service: string; date: string; selected?: string }) => call(C.SlotsResponse, `slots?${qs(q)}`, o).then((r) => r.data),
  createBooking: (o: ClientOptions, body: z.input<typeof C.CreateBookingRequest>, idempotencyKey: string) =>
    call(C.CreateBookingResponse, "bookings", o, { method: "POST", body, idempotencyKey }).then((r) => r.data.booking),
  joinWaitlist: (o: ClientOptions, body: z.input<typeof C.JoinWaitlistRequest>) => call(C.JoinWaitlistResponse, "waitlist", o, { method: "POST", body }).then((r) => ({ ...r.data, created: r.status === 201 })),
  notification: (o: ClientOptions, id: string) => call(C.NotificationPreview, `bookings/${encodeURIComponent(id)}/notification`, o).then((r) => r.data),
  appointments: (o: ClientOptions) => call(C.AppointmentsResponse, "appointments", o).then((r) => r.data),
  transition: (o: ClientOptions, id: string, action: z.infer<typeof C.TransitionRequest>["action"]) =>
    call(C.TransitionResponse, `appointments/${encodeURIComponent(id)}/transition`, o, { method: "POST", body: { action } }).then((r) => r.data.appointment),
};

/** Stable per-tab lab session, overridable with ?session= so tests can share or isolate state explicitly. */
export function resolveSession(fromQuery?: string | null): string {
  if (fromQuery) return fromQuery.replace(/[^\w-]/g, "").slice(0, 64) || "default";
  try {
    const k = "lab-session";
    let s = sessionStorage.getItem(k);
    if (!s) sessionStorage.setItem(k, (s = crypto.randomUUID().replace(/-/g, "").slice(0, 16)));
    return s;
  } catch {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  }
}

/** Owner API (cookie session, same-origin). The business is derived from the session on the server — it is never sent. */
const OWNER: ClientOptions = { kind: "other", session: "owner", base: "/api/owner" };
export const ownerApi = {
  agenda: (date?: string, signal?: AbortSignal) => call(C.OwnerAgendaResponse, `appointments${date ? `?${qs({ date })}` : ""}`, { ...OWNER, signal }).then((r) => r.data),
  transition: (id: string, action: z.infer<typeof C.OwnerAction>) =>
    call(C.OwnerTransitionResponse, `appointments/${encodeURIComponent(id)}/transition`, OWNER, { method: "POST", body: { action } }).then((r) => r.data),
  version: (signal?: AbortSignal) => call(C.OwnerVersionResponse, "version", { ...OWNER, signal }).then((r) => r.data.version),
  waitlistRemove: (id: string) => call(C.OwnerOutcomeResponse, `waitlist/${encodeURIComponent(id)}/remove`, OWNER, { method: "POST", body: {} }).then((r) => r.data),
  waitlistOffer: (id: string, time: string) => call(C.OwnerOutcomeResponse, `waitlist/${encodeURIComponent(id)}/offer`, OWNER, { method: "POST", body: { time } }).then((r) => r.data),
  waitlistSettings: (body: { autoOffer?: boolean; enabled?: boolean }) => call(C.OwnerOutcomeResponse, "waitlist/settings", OWNER, { method: "POST", body }).then((r) => r.data),
  createManual: (body: z.input<typeof C.CreateManualRequest>) => call(C.CreateManualResponse, "appointments", OWNER, { method: "POST", body }).then((r) => r.data),
};
