import "server-only";
import { systemDb } from "@/platform/system-db";
import { signToken } from "@/modules/booking/token";
import { addressHash, appUrl, emailProvider, storesPreview } from "@/modules/notifications/config";
import { plan, staleReason, type OutboxEvent } from "@/modules/notifications/plan";
import { PermanentEmailError, TransientEmailError, type EmailPort } from "@/modules/notifications/ports";
import { render, type NotifContext } from "@/modules/notifications/templates";

export const MAX_ATTEMPTS = 7;
const backoffSeconds = (attempts: number, hint?: number) => Math.max(hint ?? 0, Math.min(60 * 2 ** (attempts - 1), 3600));

export interface RunSummary {
  events: number;
  enqueued: number;
  sent: number;
  skipped: number;
  retried: number;
  dead: number;
}

interface Claimed {
  id: string;
  attempts: number;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await systemDb().rpc(fn, args);
  if (error) throw new Error(`${fn} failed`);
  return data as T;
}

/** Phase 1: turn domain events into notification rows. Idempotent per (appointment, type), so a crash between steps only repeats work. */
async function fanOut(limit: number, s: RunSummary) {
  const events = await rpc<{ id: string; type: string; payload: Record<string, unknown> }[]>("outbox_claim", { p_limit: limit });
  for (const e of events) {
    try {
      const appointmentId = typeof e.payload.appointmentId === "string" ? e.payload.appointmentId : null;
      if (appointmentId) {
        const status = e.type === "AppointmentCreated" ? await rpc<string | null>("appointment_status", { p_id: appointmentId }) : null;
        for (const n of plan(e as OutboxEvent, status)) {
          const id = await rpc<string | null>("notif_enqueue", { p_appointment: appointmentId, p_type: n.type, p_recipient: n.recipient });
          if (id) s.enqueued++;
        }
      }
      await rpc("outbox_complete", { p_id: e.id });
      s.events++;
    } catch (err) {
      await rpc("outbox_fail", { p_id: e.id, p_error: err instanceof Error ? err.message : "fan-out failed" }).catch(() => undefined);
    }
  }
}

async function finish(id: string, outcome: "sent" | "retry" | "dead" | "skipped", f: { provider?: string; messageId?: string; error?: string; skip?: string; hash?: string; preview?: unknown; delay?: number } = {}) {
  await rpc("notif_finish", {
    p_id: id,
    p_outcome: outcome,
    p_provider: f.provider ?? null,
    p_message_id: f.messageId ?? null,
    p_error: f.error ?? null,
    p_skip_reason: f.skip ?? null,
    p_to_hash: f.hash ?? null,
    p_preview: f.preview ?? null,
    p_delay_seconds: f.delay ?? 60,
  });
}

async function sendOne(row: Claimed, provider: EmailPort, s: RunSummary, now: Date) {
  const ctx = await rpc<(NotifContext & { id: string }) | null>("notif_context", { p_id: row.id });
  if (!ctx) {
    s.skipped++;
    return finish(row.id, "skipped", { skip: "missing" });
  }
  // NTF-03: the world may have changed since this was queued.
  const subject = ctx.digest ? { status: "digest", startsAt: now.toISOString() } : ctx.offer ? { status: ctx.offer.status, startsAt: ctx.offer.slotStartsAt } : { status: ctx.appointment!.status, startsAt: ctx.appointment!.startsAt };
  const stale = staleReason(ctx.type, subject.status, subject.startsAt, now);
  if (stale) {
    s.skipped++;
    return finish(row.id, "skipped", { skip: stale });
  }
  const to = ctx.recipient === "owner" ? ctx.owner.email : ctx.customer.email;
  if (!to) {
    s.skipped++;
    return finish(row.id, "skipped", { skip: "no_email" }); // NTF-06
  }
  const hash = addressHash(to);
  if (await rpc<boolean>("notif_is_suppressed", { p_hash: hash })) {
    s.skipped++;
    return finish(row.id, "skipped", { skip: "suppressed", hash }); // NTF-05
  }
  const ttl = Math.max(3600, Math.floor((new Date(subject.startsAt).getTime() - now.getTime()) / 1000) + 7 * 86_400);
  const manageToken =
    ctx.recipient !== "customer" || ctx.digest
      ? undefined
      : ctx.offer
        ? signToken({ appointmentId: ctx.offer.entryId, scope: "wl_view", ttlSeconds: ttl })
        : signToken({ appointmentId: ctx.appointment!.id, scope: "view", ttlSeconds: ttl });
  const message = render(ctx, { appUrl: appUrl(), manageToken });
  try {
    const sent = await provider.send({ to, subject: message.subject, html: message.html, text: message.text, idempotencyKey: `notif-${row.id}`, attempt: row.attempts });
    s.sent++;
    await finish(row.id, "sent", { provider: provider.name, messageId: sent.id, hash, preview: storesPreview(provider) ? { to: ctx.recipient, subject: message.subject, text: message.text } : undefined });
  } catch (err) {
    if (err instanceof PermanentEmailError) {
      s.dead++;
      return finish(row.id, "dead", { provider: provider.name, error: err.message, hash });
    }
    const transient = err instanceof TransientEmailError;
    const msg = err instanceof Error ? err.message : "send failed";
    if (row.attempts >= MAX_ATTEMPTS) {
      s.dead++; // NTF-04: out of attempts ⇒ dead letter; the owner sees it on the dashboard. The appointment itself was never affected.
      return finish(row.id, "dead", { provider: provider.name, error: msg, hash });
    }
    s.retried++;
    await finish(row.id, "retry", { provider: provider.name, error: msg, hash, delay: backoffSeconds(row.attempts, transient ? err.retryAfterSeconds : undefined) });
  }
}

/** Phase 2: send what is due. Several runners may call this at once: rows are claimed with SKIP LOCKED, and the provider de-duplicates by key. */
async function sendDue(limit: number, deadlineMs: number, s: RunSummary) {
  const provider = emailProvider();
  const started = Date.now();
  for (let batch = 0; batch < 10 && Date.now() - started < deadlineMs; batch++) {
    const rows = await rpc<Claimed[]>("notif_claim", { p_limit: limit });
    if (rows.length === 0) return;
    for (const row of rows) {
      if (Date.now() - started >= deadlineMs) return; // unfinished rows keep their lease and come back
      try {
        await sendOne(row, provider, s, new Date());
      } catch {
        s.retried++;
        await finish(row.id, "retry", { error: "unexpected failure", delay: backoffSeconds(row.attempts) }).catch(() => undefined);
      }
    }
  }
}

export async function processOutbox(opts: { maxEvents?: number; maxSends?: number; deadlineMs?: number } = {}): Promise<RunSummary> {
  const s: RunSummary = { events: 0, enqueued: 0, sent: 0, skipped: 0, retried: 0, dead: 0 };
  await fanOut(opts.maxEvents ?? 25, s);
  await sendDue(opts.maxSends ?? 10, opts.deadlineMs ?? 20_000, s);
  return s;
}

/** Reminder job body: queue what is due for `now`, then send. */
export async function runReminders(now: Date): Promise<RunSummary & { queued: number; owner: { alerts: number; autoCompleted: number; digests: number } }> {
  const queued = await rpc<number>("enqueue_reminders", { p_now: now.toISOString() });
  const owner = await rpc<{ alerts: number; autoCompleted: number; digests: number }>("owner_housekeeping", { p_now: now.toISOString() }); // NSH-02/06, NTF-09/11
  return { ...(await processOutbox()), queued, owner };
}

/** Best-effort "kick" after a booking or a decision, so the e-mail does not wait for the next cron tick. Never throws, never blocks the response. */
export async function kickOutbox() {
  if (process.env.OUTBOX_KICK === "0") return;
  try {
    await processOutbox({ maxEvents: 5, maxSends: 5, deadlineMs: 8000 });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", msg: "outbox kick failed", reason: e instanceof Error ? e.message : "unknown" })); // no PII
  }
}
