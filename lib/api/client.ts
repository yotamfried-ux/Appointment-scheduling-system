// Typed browser client for the lab API. Response types come from the shared Zod contract (types only: zod itself is
// not shipped to the browser), and the server validates every body against that contract in its own tests. Error bodies are mapped to ApiClientError.
import type { z } from "zod";
import type * as C from "@/lib/api/contracts";
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

async function call<T>(path: string, o: ClientOptions, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}): Promise<{ data: T; status: number; replay: boolean }> {
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
    const err = (json as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error;
    if (!err || typeof err.code !== "string" || typeof err.message !== "string") throw new ApiClientError("BAD_RESPONSE", "unexpected error shape", res.status);
    const ra = Number(res.headers.get("retry-after"));
    throw new ApiClientError(err.code as C.ApiErrorCode, err.message, res.status, Array.isArray(err.details) ? (err.details as { field: string; message: string }[]) : [], Number.isFinite(ra) && ra > 0 ? ra : undefined);
  }
  if (json === null || typeof json !== "object") throw new ApiClientError("BAD_RESPONSE", "unexpected response", res.status);
  return { data: json as T, status: res.status, replay: res.headers.get("idempotent-replay") === "true" };
}

const qs = (q: Record<string, string | number | undefined>) =>
  new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])).toString();

export const labApi = {
  // Servers that predate a field omit it; the contract's defaults used to be applied by the zod parse that the browser no longer runs, so they are applied here.
  services: (o: ClientOptions) =>
    call<z.infer<typeof C.ServicesResponse>>("services", o).then(({ data }) => ({
      ...data,
      team: data.team ?? [],
      services: data.services.map((s) => ({ ...s, priceMode: s.priceMode ?? "fixed", personIds: s.personIds ?? null })),
    })),
  availability: (o: ClientOptions, q: { service: string; from: string; days: number; person?: string }) => call<z.infer<typeof C.AvailabilityResponse>>(`availability?${qs(q)}`, o).then((r) => r.data),
  slots: (o: ClientOptions, q: { service: string; date: string; selected?: string; person?: string }) => call<z.infer<typeof C.SlotsResponse>>(`slots?${qs(q)}`, o).then((r) => r.data),
  createBooking: (o: ClientOptions, body: z.input<typeof C.CreateBookingRequest>, idempotencyKey: string) =>
    call<z.infer<typeof C.CreateBookingResponse>>("bookings", o, { method: "POST", body, idempotencyKey }).then((r) => r.data.booking),
  joinWaitlist: (o: ClientOptions, body: z.input<typeof C.JoinWaitlistRequest>, idempotencyKey?: string) => call<z.infer<typeof C.JoinWaitlistResponse>>("waitlist", o, { method: "POST", body, idempotencyKey }).then((r) => ({ ...r.data, created: r.status === 201 })),
  notification: (o: ClientOptions, id: string) => call<z.infer<typeof C.NotificationPreview>>(`bookings/${encodeURIComponent(id)}/notification`, o).then((r) => r.data),
  appointments: (o: ClientOptions) => call<z.infer<typeof C.AppointmentsResponse>>("appointments", o).then((r) => r.data),
  transition: (o: ClientOptions, id: string, action: z.infer<typeof C.TransitionRequest>["action"]) =>
    call<z.infer<typeof C.TransitionResponse>>(`appointments/${encodeURIComponent(id)}/transition`, o, { method: "POST", body: { action } }).then((r) => r.data.appointment),
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
  agenda: (date?: string, signal?: AbortSignal, person?: string, range?: { from: string; to: string }) =>
    call<z.infer<typeof C.OwnerAgendaResponse>>(
      `appointments${date || person || range ? `?${qs({ date, person, from: range?.from, to: range?.to })}` : ""}`,
      { ...OWNER, signal },
    ).then((r) => r.data),
  transition: (id: string, action: z.infer<typeof C.OwnerAction>) =>
    call<z.infer<typeof C.OwnerTransitionResponse>>(`appointments/${encodeURIComponent(id)}/transition`, OWNER, { method: "POST", body: { action } }).then((r) => r.data),
  version: (signal?: AbortSignal) => call<z.infer<typeof C.OwnerVersionResponse>>("version", { ...OWNER, signal }).then((r) => r.data.version),
  waitlistRemove: (id: string) => call<z.infer<typeof C.OwnerOutcomeResponse>>(`waitlist/${encodeURIComponent(id)}/remove`, OWNER, { method: "POST", body: {} }).then((r) => r.data),
  waitlistOffer: (id: string, time: string) => call<z.infer<typeof C.OwnerOutcomeResponse>>(`waitlist/${encodeURIComponent(id)}/offer`, OWNER, { method: "POST", body: { time } }).then((r) => r.data),
  waitlistSettings: (body: { autoOffer?: boolean; enabled?: boolean }) => call<z.infer<typeof C.OwnerOutcomeResponse>>("waitlist/settings", OWNER, { method: "POST", body }).then((r) => r.data),
  move: (id: string, body: z.input<typeof C.OwnerMoveRequest>) => call<z.infer<typeof C.OwnerMoveResponse>>(`appointments/${encodeURIComponent(id)}/move`, OWNER, { method: "POST", body }).then((r) => r.data),
  createManual: (body: z.input<typeof C.CreateManualRequest>) => call<z.infer<typeof C.CreateManualResponse>>("appointments", OWNER, { method: "POST", body }).then((r) => r.data),
};
