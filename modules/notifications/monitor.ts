import "server-only";
import { databaseReady } from "@/platform/db-ready";
import { jobHealth, type JobHealth } from "@/modules/notifications/job-health";
import { systemDb } from "@/platform/system-db";
import { emailProvider, platformAdminEmail } from "@/modules/notifications/config";
import type { EmailMessage } from "@/modules/notifications/ports";
import { PermanentEmailError } from "@/modules/notifications/ports";

export interface MonitorReport {
  healthy: boolean;
  timestamp: string;
  isSimulation?: boolean;
  checks: {
    app: { status: "ok" | "degraded"; uptimeSeconds: number; memoryUsageMb: number; details?: string };
    database: { status: "ready" | "unavailable"; latencyMs?: number };
    cron: { status: "healthy" | "unhealthy" | "unknown"; jobs?: JobHealth[] };
    storage: { status: "persisted" | "transient_db_down" | "persistence_failed" | "cas_conflict"; error?: string };
  };
  incident: {
    status: "healthy" | "triggered" | "ongoing" | "recovered";
    failingComponents: string[];
    notificationStatus: "idle" | "pending_alert" | "alert_sent" | "pending_recovery" | "permanent_failure";
    alertSent: boolean;
    alertRetrying?: boolean;
    alertError?: string;
    reason?: string;
    isSimulation?: boolean;
    eventId?: string;
  };
}

export interface MonitorOptions {
  simulate?: "database" | "cron" | "none";
  ignoreBackoff?: boolean;
}

export interface StoredIncidentState {
  isIncident: boolean;
  components: string[];
  firstDetectedAt?: string;
  notificationStatus: "idle" | "pending_alert" | "alert_sent" | "pending_recovery" | "permanent_failure";
  lastAttemptAt?: string;
  lastAlertSentAt?: string;
  nextRetryAt?: string;
  attemptCount: number;
  lastError?: string;
  stableIdempotencyKey?: string;
  eventId?: string;
  version: number;
  reason?: string;
  fromDb: boolean;
  rawFinishedAt: string | null;
}

const MAX_ALERT_RETRIES = 5;

// In-memory fallback for warm serverless instances when Supabase DB is down
let warmInstanceFallback: Record<string, StoredIncidentState> = {};
let lastSimulationDispatchAt: number = 0;

export function resetMonitorStateForTesting(): void {
  warmInstanceFallback = {};
  lastSimulationDispatchAt = 0;
}

/** Check Application Liveness: Next.js worker memory & system sanity */
function checkAppLiveness(): { status: "ok" | "degraded"; uptimeSeconds: number; memoryUsageMb: number; details?: string } {
  const memory = process.memoryUsage();
  const heapUsedMb = Math.round(memory.heapUsed / 1024 / 1024);
  const uptime = Math.round(process.uptime());

  if (heapUsedMb > 950) {
    return {
      status: "degraded",
      uptimeSeconds: uptime,
      memoryUsageMb: heapUsedMb,
      details: `Excessive heap memory usage: ${heapUsedMb}MB`,
    };
  }

  return {
    status: "ok",
    uptimeSeconds: uptime,
    memoryUsageMb: heapUsedMb,
  };
}

/** Retrieve durable incident state from job_runs. Completely isolates simulation states from real production states. */
async function getStoredIncidentState(dbAvailable: boolean, runKey: string): Promise<StoredIncidentState> {
  const defaultIdleState: StoredIncidentState = {
    isIncident: false,
    components: [],
    notificationStatus: "idle",
    attemptCount: 0,
    version: 0,
    fromDb: dbAvailable,
    rawFinishedAt: null,
  };

  if (!dbAvailable) {
    return warmInstanceFallback[runKey] ?? { ...defaultIdleState, fromDb: false };
  }

  try {
    const { data, error } = await systemDb()
      .from("job_runs")
      .select("status, error, started_at, finished_at")
      .eq("job_name", "monitor")
      .eq("run_key", runKey)
      .maybeSingle();

    if (error || !data) {
      return warmInstanceFallback[runKey] ?? defaultIdleState;
    }

    if (data.error) {
      try {
        const parsed = JSON.parse(data.error);
        const state: StoredIncidentState = {
          isIncident: Boolean(parsed.isIncident),
          components: Array.isArray(parsed.components) ? parsed.components : [],
          firstDetectedAt: parsed.firstDetectedAt ?? data.started_at,
          notificationStatus: parsed.notificationStatus ?? (parsed.isIncident ? "alert_sent" : "idle"),
          lastAttemptAt: parsed.lastAttemptAt,
          lastAlertSentAt: parsed.lastAlertSentAt ?? data.finished_at,
          nextRetryAt: parsed.nextRetryAt,
          attemptCount: typeof parsed.attemptCount === "number" ? parsed.attemptCount : 0,
          lastError: parsed.lastError,
          stableIdempotencyKey: parsed.stableIdempotencyKey,
          eventId: parsed.eventId,
          version: typeof parsed.version === "number" ? parsed.version : 1,
          reason: parsed.reason,
          fromDb: true,
          rawFinishedAt: data.finished_at ?? null,
        };
        warmInstanceFallback[runKey] = { ...state };
        return state;
      } catch {
        return { ...defaultIdleState, rawFinishedAt: data.finished_at ?? null };
      }
    }

    return { ...defaultIdleState, rawFinishedAt: data.finished_at ?? null };
  } catch {
    return warmInstanceFallback[runKey] ?? { ...defaultIdleState, fromDb: false };
  }
}

/** Persist incident state atomically using Compare-and-Swap (CAS) on job_runs to prevent race conditions. */
async function persistIncidentStateCAS(
  runKey: string,
  state: StoredIncidentState,
  prevFinishedAt: string | null
): Promise<{ success: boolean; conflict?: boolean; error?: string }> {
  warmInstanceFallback[runKey] = { ...state };

  try {
    const errorPayload = JSON.stringify({
      isIncident: state.isIncident,
      components: state.components,
      firstDetectedAt: state.firstDetectedAt,
      notificationStatus: state.notificationStatus,
      lastAttemptAt: state.lastAttemptAt,
      lastAlertSentAt: state.lastAlertSentAt,
      nextRetryAt: state.nextRetryAt,
      attemptCount: state.attemptCount,
      lastError: state.lastError,
      stableIdempotencyKey: state.stableIdempotencyKey,
      eventId: state.eventId,
      version: (state.version || 0) + 1,
      reason: state.reason,
    });

    const newFinishedAt = new Date().toISOString();

    if (prevFinishedAt === null) {
      // Row does not exist yet: atomic INSERT
      const { data, error } = await systemDb()
        .from("job_runs")
        .insert({
          job_name: "monitor",
          run_key: runKey,
          status: "succeeded",
          started_at: state.firstDetectedAt ?? newFinishedAt,
          finished_at: newFinishedAt,
          error: errorPayload,
        })
        .select("finished_at");

      if (error) {
        // Unique violation 23505 means another concurrent worker created the record first
        if (error.code === "23505" || error.message?.includes("duplicate") || error.message?.includes("unique")) {
          return { success: false, conflict: true, error: "Concurrent worker inserted incident state first" };
        }
        return { success: false, error: error.message };
      }

      state.rawFinishedAt = data?.[0]?.finished_at ?? newFinishedAt;
      return { success: true };
    } else {
      // Row exists: atomic UPDATE with Compare-and-Swap on finished_at
      const { data, error } = await systemDb()
        .from("job_runs")
        .update({
          status: "succeeded",
          finished_at: newFinishedAt,
          error: errorPayload,
        })
        .eq("job_name", "monitor")
        .eq("run_key", runKey)
        .eq("finished_at", prevFinishedAt)
        .select("finished_at");

      if (error) {
        return { success: false, error: error.message };
      }

      if (!data || data.length === 0) {
        // 0 rows updated: another worker modified the state in the meantime (CAS conflict)
        return { success: false, conflict: true, error: "CAS conflict: state was modified by a concurrent worker" };
      }

      state.rawFinishedAt = data[0].finished_at;
      return { success: true };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: msg };
  }
}

interface AlertEmailParams {
  components: string[];
  reason: string;
  stableTimestamp: string;
  stableIdempotencyKey: string;
  isSimulation?: boolean;
}

/** Send Alert Email with stable idempotency key and deterministic payload across retries (no changing attempt counters). */
async function sendAlertEmail(params: AlertEmailParams): Promise<{ id: string }> {
  const { components, reason, stableTimestamp, stableIdempotencyKey, isSimulation } = params;
  const provider = emailProvider();
  const recipient = platformAdminEmail();
  const componentList = components.join(", ");
  const prefix = isSimulation ? "[TEST SIMULATION] " : "";
  const subject = `${prefix}[ALERT] Tori Production Monitor Incident — ${componentList}`;
  const logsUrl = "https://vercel.com/yotamfried-ux/appointment-scheduling-system/logs";

  const simulationNotice = isSimulation
    ? "\n*** THIS IS A SAFE OPERATOR DRILL / SIMULATION. NO REAL PRODUCTION SERVICE IS IMPAIRED. ***\n"
    : "";

  const text = [
    `${isSimulation ? "TEST DRILL" : "CRITICAL ALERT"}: Production Health & SLA Violation`,
    simulationNotice,
    `System: Tori`,
    `Environment: Production (turim.d2ryf.com)`,
    `Failing Component(s): ${componentList}`,
    `Detected At: ${stableTimestamp} UTC`,
    `Reason: ${reason}`,
    `Severity: ${isSimulation ? "Test / Low" : "High"}`,
    `Vercel Logs: ${logsUrl}`,
  ].filter(Boolean).join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ef4444; border-radius: 8px;">
      <h2 style="color: #dc2626; margin-top: 0;">${isSimulation ? "🧪 [TEST SIMULATION] " : "⚠️ "}Tori Production Monitor Alert</h2>
      ${isSimulation ? '<div style="background-color: #fef2f2; border: 1px solid #f87171; color: #b91c1c; padding: 8px 12px; border-radius: 4px; font-weight: bold; margin-bottom: 12px;">Notice: Safe Operator Simulation Drill. Production is unaffected.</div>' : ""}
      <p>A production health check or cron SLA violation has been detected.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">System</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Tori</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Environment</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Production (turim.d2ryf.com)</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Failing Component(s)</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #dc2626; font-weight: bold;">${componentList}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Detected At (UTC)</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${stableTimestamp}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Severity</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #dc2626;">${isSimulation ? "Test / Drill" : "High"}</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Details</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${reason}</td></tr>
      </table>
      <p><a href="${logsUrl}" style="background-color: #dc2626; color: white; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">View Vercel Runtime Logs</a></p>
    </div>
  `;

  const message: EmailMessage = {
    to: recipient,
    subject,
    text,
    html,
    idempotencyKey: stableIdempotencyKey,
    attempt: 1,
  };

  return await provider.send(message);
}

interface RecoveryEmailParams {
  stableTimestamp: string;
  stableIdempotencyKey: string;
  isSimulation?: boolean;
}

/** Send Recovery Email with stable idempotency key and deterministic payload across retries. */
async function sendRecoveryEmail(params: RecoveryEmailParams): Promise<{ id: string }> {
  const { stableTimestamp, stableIdempotencyKey, isSimulation } = params;
  const provider = emailProvider();
  const recipient = platformAdminEmail();
  const prefix = isSimulation ? "[TEST SIMULATION - RESOLVED] " : "[RESOLVED] ";
  const subject = `${prefix}Tori Production Monitor — All systems operational`;
  const logsUrl = "https://vercel.com/yotamfried-ux/appointment-scheduling-system/logs";

  const text = [
    `${isSimulation ? "TEST DRILL RECOVERY" : "RECOVERY NOTICE"}: Production Systems Operational`,
    `System: Tori`,
    `Environment: Production (turim.d2ryf.com)`,
    `Status: RECOVERED`,
    `All probes passing: Next.js Liveness, Supabase Database Readiness, 4/4 Vercel Cron Jobs SLA.`,
    `Recovered At: ${stableTimestamp} UTC`,
    `Vercel Logs: ${logsUrl}`,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #10b981; border-radius: 8px;">
      <h2 style="color: #059669; margin-top: 0;">${isSimulation ? "🧪 " : "✅ "}Tori Production Systems Recovered</h2>
      <p>All automated production health probes and cron SLA checks have returned to normal operating status.</p>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">System</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Tori</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Environment</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">Production (turim.d2ryf.com)</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Status</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #059669; font-weight: bold;">Operational (100% Green)</td></tr>
        <tr><td style="padding: 8px; border-bottom: 1px solid #e5e7eb; font-weight: bold;">Recovered At (UTC)</td><td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${stableTimestamp}</td></tr>
      </table>
      <p><a href="${logsUrl}" style="background-color: #059669; color: white; padding: 10px 16px; text-decoration: none; border-radius: 6px; display: inline-block;">View Vercel Runtime Logs</a></p>
    </div>
  `;

  const message: EmailMessage = {
    to: recipient,
    subject,
    text,
    html,
    idempotencyKey: stableIdempotencyKey,
    attempt: 1,
  };

  return await provider.send(message);
}

/** Calculate exponential backoff interval in minutes based on attempt count. */
export function calculateBackoffMinutes(attempt: number): number {
  if (attempt <= 1) return 15;
  if (attempt === 2) return 30;
  if (attempt >= 3) return 60;
  return 60; // capped at 60 minutes for recurring persistent reminder
}

export async function runProductionMonitor(options: MonitorOptions = {}): Promise<MonitorReport> {
  const currentTimestamp = new Date().toISOString();
  const isSimulation = Boolean(options.simulate && options.simulate !== "none");
  const stateRunKey = isSimulation ? "simulation_state" : "incident_state";

  const failingComponents: string[] = [];
  const failureReasons: string[] = [];

  // 1. Application Liveness (Node process memory, uptime, environment sanity)
  const appStatus = checkAppLiveness();

  // 2. Database Readiness Check
  const dbStart = Date.now();
  let realDbAvailable = false;
  try {
    realDbAvailable = await databaseReady(2500);
  } catch {
    realDbAvailable = false;
  }
  const dbLatencyMs = Date.now() - dbStart;
  const dbOk = options.simulate === "database" ? false : realDbAvailable;

  if (!dbOk) {
    failingComponents.push("database");
    failureReasons.push(
      options.simulate === "database"
        ? "Simulated database probe failure"
        : "Supabase database unreachable or query timed out"
    );
  }

  // 3. Cron Jobs SLA Health
  let cronStatus: "healthy" | "unhealthy" | "unknown" = "unknown";
  let cronJobs: JobHealth[] | undefined;

  if (options.simulate === "cron") {
    cronStatus = "unhealthy";
    cronJobs = [
      { job: "outbox", lastOk: new Date(Date.now() - 3600_000).toISOString(), ageMinutes: 60, failed24h: 3, stale: true },
      { job: "reminders", lastOk: new Date().toISOString(), ageMinutes: 5, failed24h: 0, stale: false },
      { job: "waitlist", lastOk: new Date().toISOString(), ageMinutes: 2, failed24h: 0, stale: false },
      { job: "maintenance", lastOk: new Date().toISOString(), ageMinutes: 120, failed24h: 0, stale: false },
    ];
    failingComponents.push("cron:outbox");
    failureReasons.push("Simulated stale cron job: outbox (age: 60m)");
  } else if (dbOk) {
    try {
      const health = await jobHealth();
      cronJobs = health.jobs;
      if (health.ok) {
        cronStatus = "healthy";
      } else {
        cronStatus = "unhealthy";
        const staleJobs = health.jobs.filter((j) => j.stale);
        for (const sj of staleJobs) {
          failingComponents.push(`cron:${sj.job}`);
          failureReasons.push(
            `Stale job: ${sj.job} (last success: ${sj.lastOk ?? "never"}, age: ${sj.ageMinutes ?? "unknown"}m, failed24h: ${sj.failed24h})`
          );
        }
      }
    } catch (e) {
      cronStatus = "unhealthy";
      failingComponents.push("cron:job_status");
      failureReasons.push(`Unable to query job_status RPC: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  const isHealthy = failingComponents.length === 0;

  // 4. Incident State, Deduplication & Atomic Notification Flow
  let incidentStatus: "healthy" | "triggered" | "ongoing" | "recovered" = "healthy";
  let alertSent = false;
  let alertRetrying = false;
  let alertError: string | undefined;
  let nextNotificationStatus: "idle" | "pending_alert" | "alert_sent" | "pending_recovery" | "permanent_failure" = "idle";
  let storageStatus: "persisted" | "transient_db_down" | "persistence_failed" | "cas_conflict" = realDbAvailable ? "persisted" : "transient_db_down";
  let storageError: string | undefined;

  const prevState = await getStoredIncidentState(realDbAvailable, stateRunKey);
  const eventId = prevState.eventId ?? `evt_${currentTimestamp.replace(/[^0-9]/g, "").slice(0, 14)}`;

  if (!isHealthy) {
    // Current run is in a failing state
    const sortedCurrent = [...failingComponents].sort();
    const sortedPrev = [...prevState.components].sort();
    const isSameComponents = prevState.isIncident && sortedCurrent.join(",") === sortedPrev.join(",");

    if (!prevState.isIncident || !isSameComponents) {
      // NEW INCIDENT OR MATERIAL CHANGE (New failing component)
      incidentStatus = "triggered";

      // Deduplication strategy when DB is down: 1-hour deterministic bucket
      const hourBucket = currentTimestamp.slice(0, 13);
      const stableTimestamp = realDbAvailable
        ? currentTimestamp
        : `${hourBucket}:00:00.000Z`;

      const componentsKey = sortedCurrent.join("-").replace(/[^a-zA-Z0-9_-]/g, "_");
      const stableIdempotencyKey = realDbAvailable
        ? `tori-alert-${componentsKey}-${stableTimestamp.slice(0, 16)}`
        : `tori-alert-db-outage-${hourBucket}`;

      // Simulation rate limiting: at most 1 simulation email every 60 seconds
      let shouldSendEmail = true;
      if (isSimulation) {
        const nowMs = Date.now();
        if (nowMs - lastSimulationDispatchAt < 60_000) {
          shouldSendEmail = false;
          alertSent = false;
          alertError = "Simulation dispatch rate limited (max 1 test email per minute)";
        } else {
          lastSimulationDispatchAt = nowMs;
        }
      }

      let sendSucceeded = false;
      if (shouldSendEmail) {
        try {
          await sendAlertEmail({
            components: failingComponents,
            reason: failureReasons.join("; "),
            stableTimestamp,
            stableIdempotencyKey,
            isSimulation,
          });
          sendSucceeded = true;
          alertSent = true;
        } catch (err: any) {
          sendSucceeded = false;
          alertSent = false;
          alertError = err instanceof Error ? err.message : String(err);
          console.error("Monitor alert email delivery failed:", err);

          if (err instanceof PermanentEmailError) {
            nextNotificationStatus = "permanent_failure";
          }
        }
      }

      if (nextNotificationStatus !== "permanent_failure") {
        nextNotificationStatus = sendSucceeded ? "alert_sent" : "pending_alert";
      }

      const backoffMin = calculateBackoffMinutes(1);
      const nextRetryAt = !sendSucceeded && backoffMin > 0
        ? new Date(Date.now() + backoffMin * 60_000).toISOString()
        : undefined;

      const nextState: StoredIncidentState = {
        isIncident: true,
        components: failingComponents,
        firstDetectedAt: stableTimestamp,
        notificationStatus: nextNotificationStatus,
        lastAttemptAt: currentTimestamp,
        lastAlertSentAt: sendSucceeded ? currentTimestamp : undefined,
        nextRetryAt,
        attemptCount: 1,
        lastError: sendSucceeded ? undefined : alertError,
        stableIdempotencyKey,
        eventId,
        version: (prevState.version || 0) + 1,
        reason: failureReasons.join("; "),
        fromDb: realDbAvailable,
        rawFinishedAt: prevState.rawFinishedAt,
      };

      if (realDbAvailable) {
        const persistResult = await persistIncidentStateCAS(stateRunKey, nextState, prevState.rawFinishedAt);
        if (!persistResult.success) {
          if (persistResult.conflict) {
            storageStatus = "cas_conflict";
          } else {
            storageStatus = "persistence_failed";
          }
          storageError = persistResult.error;
        }
      }
    } else {
      // ONGOING INCIDENT (Components identical to previous run)
      incidentStatus = "ongoing";

      if (prevState.notificationStatus === "pending_alert") {
        if (prevState.attemptCount >= MAX_ALERT_RETRIES) {
          nextNotificationStatus = "permanent_failure";
          alertSent = false;
          alertRetrying = false;
          alertError = `Max alert retries (${MAX_ALERT_RETRIES}) reached without provider confirmation`;

          const nextState: StoredIncidentState = {
            ...prevState,
            notificationStatus: "permanent_failure",
            lastAttemptAt: currentTimestamp,
            lastError: alertError,
            version: (prevState.version || 0) + 1,
            fromDb: realDbAvailable,
          };

          if (realDbAvailable) {
            const persistResult = await persistIncidentStateCAS(stateRunKey, nextState, prevState.rawFinishedAt);
            if (!persistResult.success) {
              storageStatus = persistResult.conflict ? "cas_conflict" : "persistence_failed";
              storageError = persistResult.error;
            }
          }
        } else {
          // PREVIOUS ALERT DELIVERY FAILED -> RETRY!
          const canRetryNow = Boolean(options.ignoreBackoff) || !prevState.nextRetryAt || new Date(currentTimestamp) >= new Date(prevState.nextRetryAt);

          if (canRetryNow) {
            alertRetrying = true;

            const hourBucket = currentTimestamp.slice(0, 13);
            const stableTimestamp = realDbAvailable
              ? (prevState.firstDetectedAt ?? currentTimestamp)
              : `${hourBucket}:00:00.000Z`;

            const stableIdempotencyKey = realDbAvailable
              ? (prevState.stableIdempotencyKey ?? `tori-alert-${sortedCurrent.join("-").replace(/[^a-zA-Z0-9_-]/g, "_")}-${stableTimestamp.slice(0, 16)}`)
              : `tori-alert-db-outage-${hourBucket}`;

            let sendSucceeded = false;
            try {
              await sendAlertEmail({
                components: failingComponents,
                reason: failureReasons.join("; "),
                stableTimestamp,
                stableIdempotencyKey,
                isSimulation,
              });
              sendSucceeded = true;
              alertSent = true;
            } catch (err: any) {
              sendSucceeded = false;
              alertSent = false;
              alertError = err instanceof Error ? err.message : String(err);
              console.error("Monitor retry alert email delivery failed:", err);

              if (err instanceof PermanentEmailError) {
                nextNotificationStatus = "permanent_failure";
              }
            }

            const nextAttempts = prevState.attemptCount + 1;
            if (!sendSucceeded && nextAttempts >= MAX_ALERT_RETRIES) {
              nextNotificationStatus = "permanent_failure";
              alertError = `Max alert retries (${MAX_ALERT_RETRIES}) reached without provider confirmation`;
            } else if (nextNotificationStatus !== "permanent_failure") {
              nextNotificationStatus = sendSucceeded ? "alert_sent" : "pending_alert";
            }

            const backoffMin = calculateBackoffMinutes(nextAttempts);
            const nextRetryAt = !sendSucceeded && nextNotificationStatus !== "permanent_failure" && backoffMin > 0
              ? new Date(Date.now() + backoffMin * 60_000).toISOString()
              : undefined;

            const nextState: StoredIncidentState = {
              ...prevState,
              notificationStatus: nextNotificationStatus,
              lastAttemptAt: currentTimestamp,
              lastAlertSentAt: sendSucceeded ? currentTimestamp : prevState.lastAlertSentAt,
              nextRetryAt,
              attemptCount: nextAttempts,
              lastError: sendSucceeded ? undefined : alertError,
              version: (prevState.version || 0) + 1,
              fromDb: realDbAvailable,
            };

            if (realDbAvailable) {
              const persistResult = await persistIncidentStateCAS(stateRunKey, nextState, prevState.rawFinishedAt);
              if (!persistResult.success) {
                storageStatus = persistResult.conflict ? "cas_conflict" : "persistence_failed";
                storageError = persistResult.error;
              }
            }
          } else {
            // Waiting for backoff window
            nextNotificationStatus = "pending_alert";
            alertSent = false;
            alertRetrying = true;
            alertError = `Retry backoff active until ${prevState.nextRetryAt}`;
          }
        }
      } else if (prevState.notificationStatus === "permanent_failure") {
        nextNotificationStatus = "permanent_failure";
        alertSent = false;
        alertRetrying = false;
        alertError = prevState.lastError ?? `Max alert retries (${MAX_ALERT_RETRIES}) reached without provider confirmation`;
      } else {
        // Alert was already confirmed sent to operator -> DEDUPLICATE (Zero duplicate emails)
        nextNotificationStatus = prevState.notificationStatus;
        alertSent = false;
      }
    }
  } else {
    // Current run is healthy
    if (prevState.isIncident || prevState.notificationStatus === "pending_recovery") {
      // RECOVERY DETECTED
      incidentStatus = "recovered";

      const alertWasDispatched =
        prevState.notificationStatus === "alert_sent" || prevState.notificationStatus === "pending_recovery";

      if (alertWasDispatched) {
        const stableTimestamp = prevState.lastAlertSentAt
          ? currentTimestamp
          : (prevState.firstDetectedAt ?? currentTimestamp);
        const stableIdempotencyKey = `tori-recovery-${(prevState.firstDetectedAt ?? currentTimestamp).slice(0, 16)}`;

        let recoverySent = false;
        try {
          await sendRecoveryEmail({
            stableTimestamp,
            stableIdempotencyKey,
            isSimulation,
          });
          recoverySent = true;
          alertSent = true;
        } catch (err: any) {
          recoverySent = false;
          alertSent = false;
          alertError = err instanceof Error ? err.message : String(err);
          console.error("Monitor recovery email delivery failed:", err);

          if (err instanceof PermanentEmailError) {
            nextNotificationStatus = "permanent_failure";
          }
        }

        if (nextNotificationStatus !== "permanent_failure") {
          nextNotificationStatus = recoverySent ? "idle" : "pending_recovery";
        }

        const nextState: StoredIncidentState = {
          isIncident: false,
          components: [],
          notificationStatus: nextNotificationStatus,
          lastAttemptAt: currentTimestamp,
          lastAlertSentAt: undefined,
          nextRetryAt: undefined,
          attemptCount: recoverySent ? 0 : (prevState.attemptCount || 0) + 1,
          lastError: recoverySent ? undefined : alertError,
          stableIdempotencyKey: recoverySent ? undefined : stableIdempotencyKey,
          eventId: recoverySent ? undefined : eventId,
          version: (prevState.version || 0) + 1,
          fromDb: realDbAvailable,
          rawFinishedAt: prevState.rawFinishedAt,
        };

        if (realDbAvailable) {
          const persistResult = await persistIncidentStateCAS(stateRunKey, nextState, prevState.rawFinishedAt);
          if (!persistResult.success) {
            storageStatus = persistResult.conflict ? "cas_conflict" : "persistence_failed";
            storageError = persistResult.error;
          }
        }
      } else {
        // Incident resolved before initial alert was ever confirmed sent -> return directly to idle
        nextNotificationStatus = "idle";
        const nextState: StoredIncidentState = {
          isIncident: false,
          components: [],
          notificationStatus: "idle",
          attemptCount: 0,
          version: (prevState.version || 0) + 1,
          fromDb: realDbAvailable,
          rawFinishedAt: prevState.rawFinishedAt,
        };
        if (realDbAvailable) {
          await persistIncidentStateCAS(stateRunKey, nextState, prevState.rawFinishedAt);
        }
      }
    } else {
      incidentStatus = "healthy";
      nextNotificationStatus = "idle";
      alertSent = false;
    }

    // 5. Heartbeat recording (only for real production runs when DB is available)
    if (realDbAvailable && !isSimulation) {
      const bucketKey = `m:${currentTimestamp.slice(0, 16)}`;
      try {
        await systemDb().rpc("job_begin", { p_job: "monitor", p_key: bucketKey });
        await systemDb().rpc("job_finish", { p_job: "monitor", p_key: bucketKey, p_error: null });
      } catch (e) {
        console.error("Monitor heartbeat recording error:", e);
      }
    }
  }

  return {
    healthy: isHealthy,
    timestamp: currentTimestamp,
    isSimulation: isSimulation ? true : undefined,
    checks: {
      app: appStatus,
      database: { status: dbOk ? "ready" : "unavailable", latencyMs: dbLatencyMs },
      cron: { status: cronStatus, jobs: cronJobs },
      storage: { status: storageStatus, error: storageError },
    },
    incident: {
      status: incidentStatus,
      failingComponents,
      notificationStatus: nextNotificationStatus,
      alertSent,
      alertRetrying: alertRetrying ? true : undefined,
      alertError,
      reason: failureReasons.length > 0 ? failureReasons.join("; ") : undefined,
      isSimulation: isSimulation ? true : undefined,
      eventId: isHealthy ? undefined : eventId,
    },
  };
}
