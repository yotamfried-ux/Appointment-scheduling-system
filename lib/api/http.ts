// HTTP plumbing for route handlers: consistent error shape, request ids, validation and lab-only gating.
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import type { ApiErrorCode } from "@/lib/api/contracts";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ApiErrorCode,
    message: string,
    public details?: { field: string; message: string }[],
    public headers?: Record<string, string>,
  ) {
    super(message);
  }
}

export const STATUS: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  VALIDATION_FAILED: 422,
  NOT_FOUND: 404,
  SLOT_TAKEN: 409,
  INVALID_SLOT: 422,
  INVALID_TRANSITION: 409,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_REUSED: 422,
  RATE_LIMITED: 429,
  BOOKING_LIMIT: 409,
  SERVICE_UNAVAILABLE: 409,
  TOO_LATE: 409,
  TOO_EARLY: 409,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};

export const fail = (code: ApiErrorCode, message: string, details?: { field: string; message: string }[], headers?: Record<string, string>) =>
  new ApiError(STATUS[code], code, message, details, headers);

export function zodDetails(e: ZodError) {
  return e.issues.map((i) => ({ field: i.path.join(".") || "_", message: i.message }));
}

export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value);
  if (!r.success) throw fail("VALIDATION_FAILED", "הבקשה אינה תקינה.", zodDetails(r.error));
  return r.data;
}

/** The lab API exists in dev/preview/test only. */
export const labEnabled = () => process.env.VERCEL_ENV !== "production";

type Ctx<P> = { params: Promise<P> };

export function api<P = Record<string, never>>(handler: (req: Request, params: P, ctx: { requestId: string }) => Promise<Response | object>, opts: { lab?: boolean } = {}) {
  const lab = opts.lab ?? true;
  return async (req: Request, ctx: Ctx<P>) => {
    const requestId = `req_${crypto.randomUUID().slice(0, 8)}`;
    const base = { "Cache-Control": "no-store", "x-request-id": requestId };
    try {
      if (lab && !labEnabled()) throw fail("NOT_FOUND", "לא נמצא."); // lab routes only; public routes are always on
      const out = await handler(req, await ctx.params, { requestId });
      if (out instanceof Response) {
        Object.entries(base).forEach(([k, v]) => out.headers.set(k, v));
        return out;
      }
      return NextResponse.json(out, { headers: base });
    } catch (e) {
      if (e instanceof ApiError) {
        return NextResponse.json({ error: { code: e.code, message: e.message, requestId, ...(e.details ? { details: e.details } : {}) } }, { status: e.status, headers: { ...base, ...(e.headers ?? {}) } });
      }
      // Never leak internals (docs/05 §5.5); the id lets support find the log line.
      console.error(JSON.stringify({ level: "error", requestId, msg: e instanceof Error ? e.message : "unknown" }));
      return NextResponse.json({ error: { code: "INTERNAL", message: "משהו השתבש. נסו שוב.", requestId } }, { status: 500, headers: base });
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw fail("BAD_REQUEST", "גוף הבקשה אינו JSON תקין.");
  }
}

export const sessionOf = (req: Request) => (req.headers.get("x-lab-session") ?? "default").replace(/[^\w-]/g, "").slice(0, 64) || "default";

/** CSRF for cookie-authenticated JSON endpoints: a state-changing request must come from this very site (browsers always send Origin on fetch POST). */
export function assertSameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  let ok = false;
  try {
    ok = Boolean(origin && host && new URL(origin).host === host);
  } catch {
    ok = false;
  }
  if (!ok) throw fail("FORBIDDEN", "הבקשה נדחתה.");
}
