import "server-only";
import { databaseReady } from "@/platform/db-ready";
import { jobHealth, type JobHealth } from "@/modules/notifications/job-health";
import { systemDb } from "@/platform/system-db";
import { emailProvider, platformAdminEmail } from "@/modules/notifications/config";
import type { EmailMessage } from "@/modules/notifications/ports";

export interface MonitorReport {
  healthy: boolean;
  timestamp: string;
  isSimulation?: boolean;
  checks: {
    app: { status: "ok" | "degraded"; uptimeSeconds: number; memoryUsageMb: number; details?: string };
    database: { status: "ready" | "unavailable"; latencyMs?: number };
    cron: { status: "healthy" | "unhealthy" | "unknown"; jobs?: JobHealth[] };
    storage: { status: "persisted" | "transient_db_down" | "persistence_failed"; error?: string };
  };
  incident: {
    status: "healthy" | "triggered" | "ongoing" | "recovered";
    failingComponents: string[];
    notificationStatus: "idle" | "pending_alert" | "alert_sent" | "pending_recovery";
    alertSent: boolean;
    alertRetrying?: boolean;
    alertError?: string;
    reason?: string;
    isSimulation?: boolean;
  };
}

export interface MonitorOptions {
  simulate?: "database" | "cron" | "none";
}

export interface StoredIncidentState {
  isIncident: boolean;
  components: string[];
  firstDetectedAt?: string;
  notificationStatus: "idle" | "pending_alert" | "alert_sent" | "pending_recovery";
  lastAttemptAt?: string;
  lastAlertSentAt?: string;
  attemptCount: number;
  lastError?: string;
  stableIdempotencyKey?: string;
  version: number;
  reason?: string;
  fromDb: boolean;
}

const MAX_ALERT_RETRIES = 5;

// In-memory fallback for warm serverless instances when Supabase DB is down
let warmInstanceFallback: Record<string, StoredIncidentState> = {};

export function resetMonitorStateForTesting(): void {
  warmInstanceFallback = {};
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
          attemptCount: typeof parsed.attemptCount === "number" ? parsed.attemptCount : 0,
          lastError: parsed.lastError,
          stableIdempotencyKey: parsed.stableIdempotencyKey,
          version: typeof parsed.version === "number" ? parsed.version : 1,
          reason: parsed.reason,
          fromDb: true,
        };
        warmInstanceFallback[runKey] = { ...state };
        return state;
      } catch {
        return defaultIdleState;
      }
    }

    warmInstanceFallback[runKey] = { ...defaultIdleState };
    return defaultIdleState;
  } catch {
    return warmInstanceFallback[runKey] ?? { ...defaultIdleState, fromDb: false };
  }
}

/** Persist incident state safely into job_runs without marking status as failed (so it doesn't pollute admin_system_errors). */
async function persistIncidentState(
  runKey: string,
  state: StoredIncidentState
): Promise<{ success: boolean; error?: string }> {
  warmInstanceFallback[runKey] = { ...state };

  try {
    const errorPayload = JSON.stringify({
      isIncident: state.isIncident,
      components: state.components,
      firstDetectedAt: state.firstDetectedAt,
      notificationStatus: state.notificationStatus,
      lastAttemptAt: state.lastAttemptAt,
      lastAlertSentAt: state.lastAlertSentAt,
      attemptCount: state.attemptCount,
      lastError: state.lastError,
      stableIdempotencyKey: state.stableIdempotencyKey,
      version: (state.version || 0) + 1,
      reason: state.reason,
    });

    const { error } = await systemDb()
      .from("job_runs")
      .upsert(
        {
          job_name: "monitor",
          run_key: runKey,
          status: "succeeded",
          started_at: state.firstDetectedAt ?? new Date().toISOString(),
          finished_at: new Date().toISOString(),
          error: errorPayload,
        },
        { onConflict: "job_name,run_key" }
      );

    if (error) {
      console.error("Failed to persist monitor incident state:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("Exception while persisting monitor incident state:", msg);
    return { success: false, error: msg };
  }
}

interface AlertEmailParams {
  components: string[];
  reason: string;
  stableTimestamp: string;
  stableIdempotencyKey: string;
  attemptNumber: number;
  isSimulation?: boolean;
}

/** Send Alert Email with stable idempotency key and deterministic payload across retries. */
async function sendAlertEmail(params: AlertEmailParams): Promise<void> {
  const { components, reason, stableTimestamp, stableIdempotencyKey, attemptNumber, isSimulation } = params;
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
    `Attempt: ${attemptNumber}`,
    `Vercel Logs: ${logsUrl}`,
  ].join("\n");

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
    attempt: attemptNumber,
  };

  try {
    await provider.send(message);
  } catch (err: any) {
    if (err?.status === 409 || err?.message?.includes("409") || err?.message?.includes("idempotency")) {
      return;
    }
    throw err;
  }
}

interface RecoveryEmailParams {
  stableTimestamp: string;
  stableIdempotencyKey: string;
  attemptNumber: number;
  isSimulation?: boolean;
}

/** Send Recovery Email with stable idempotency key and deterministic payload across retries. */
async function sendRecoveryEmail(params: RecoveryEmailParams): Promise<void> {
  const { stableTimestamp, stableIdempotencyKey, attemptNumber, isSimulation } = params;
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
    `Attempt: ${attemptNumber}`,
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
    attempt: attemptNumber,
  };

  try {
    await provider.send(message);
  } catch (err: any) {
    if (err?.status === 409 || err?.message?.includes("409") || err?.message?.includes("idempotency")) {
      return;
    }
    throw err;
  }
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
  let nextNotificationStatus: "idle" | "pending_alert" | "alert_sent" | "pending_recovery" = "idle";
  let storageStatus: "persisted" | "transient_db_down" | "persistence_failed" = realDbAvailable ? "persisted" : "transient_db_down";
  let storageError: string | undefined;

  const prevState = await getStoredIncidentState(realDbAvailable, stateRunKey);

  if (!isHealthy) {
    // Current run is failing
    const sortedCurrent = [...failingComponents].sort();
    const sortedPrev = [...prevState.components].sort();
    const isSameComponents = prevState.isIncident && sortedCurrent.join(",") === sortedPrev.join(",");

    if (!prevState.isIncident || !isSameComponents) {
      // NEW INCIDENT OR MATERIAL CHANGE (New failing component)
      incidentStatus = "triggered";

      // Stable incident timestamp and stable idempotency key
      const stableTimestamp = realDbAvailable
        ? currentTimestamp
        : `${currentTimestamp.slice(0, 16)}:00.000Z`;
      const componentsKey = sortedCurrent.join("-").replace(/[^a-zA-Z0-9_-]/g, "_");
      const stableIdempotencyKey = `tori-alert-${componentsKey}-${stableTimestamp.slice(0, 16)}`;

      let sendSucceeded = false;
      try {
        await sendAlertEmail({
          components: failingComponents,
          reason: failureReasons.join("; "),
          stableTimestamp,
          stableIdempotencyKey,
          attemptNumber: 1,
          isSimulation,
        });
        sendSucceeded = true;
        alertSent = true;
      } catch (err) {
        sendSucceeded = false;
        alertSent = false;
        alertError = err instanceof Error ? err.message : String(err);
        console.error("Monitor alert email delivery failed:", err);
      }

      nextNotificationStatus = sendSucceeded ? "alert_sent" : "pending_alert";

      const nextState: StoredIncidentState = {
        isIncident: true,
        components: failingComponents,
        firstDetectedAt: stableTimestamp,
        notificationStatus: nextNotificationStatus,
        lastAttemptAt: currentTimestamp,
        lastAlertSentAt: sendSucceeded ? currentTimestamp : undefined,
        attemptCount: 1,
        lastError: sendSucceeded ? undefined : alertError,
        stableIdempotencyKey,
        version: (prevState.version || 0) + 1,
        reason: failureReasons.join("; "),
        fromDb: realDbAvailable,
      };

      if (realDbAvailable) {
        const persistResult = await persistIncidentState(stateRunKey, nextState);
        if (!persistResult.success) {
          storageStatus = "persistence_failed";
          storageError = persistResult.error;
        }
      }
    } else {
      // ONGOING INCIDENT (Components identical to previous run)
      incidentStatus = "ongoing";

      if (prevState.notificationStatus === "pending_alert") {
        // PREVIOUS ALERT FAILED OR IS PENDING -> RETRY!
        alertRetrying = true;

        if (prevState.attemptCount < MAX_ALERT_RETRIES) {
          const stableTimestamp = prevState.firstDetectedAt ?? currentTimestamp;
          const stableIdempotencyKey =
            prevState.stableIdempotencyKey ??
            `tori-alert-${sortedCurrent.join("-").replace(/[^a-zA-Z0-9_-]/g, "_")}-${stableTimestamp.slice(0, 16)}`;

          let sendSucceeded = false;
          try {
            await sendAlertEmail({
              components: failingComponents,
              reason: failureReasons.join("; "),
              stableTimestamp,
              stableIdempotencyKey,
              attemptNumber: prevState.attemptCount + 1,
              isSimulation,
            });
            sendSucceeded = true;
            alertSent = true;
          } catch (err) {
            sendSucceeded = false;
            alertSent = false;
            alertError = err instanceof Error ? err.message : String(err);
            console.error("Monitor retry alert email delivery failed:", err);
          }

          nextNotificationStatus = sendSucceeded ? "alert_sent" : "pending_alert";

          const nextState: StoredIncidentState = {
            ...prevState,
            notificationStatus: nextNotificationStatus,
            lastAttemptAt: currentTimestamp,
            lastAlertSentAt: sendSucceeded ? currentTimestamp : prevState.lastAlertSentAt,
            attemptCount: prevState.attemptCount + 1,
            lastError: sendSucceeded ? undefined : alertError,
            version: (prevState.version || 0) + 1,
          };

          if (realDbAvailable) {
            const persistResult = await persistIncidentState(stateRunKey, nextState);
            if (!persistResult.success) {
              storageStatus = "persistence_failed";
              storageError = persistResult.error;
            }
          }
        } else {
          nextNotificationStatus = "pending_alert";
          alertSent = false;
          alertError = `Max alert retries (${MAX_ALERT_RETRIES}) reached without provider confirmation`;
        }
      } else {
        // Alert was already confirmed sent to operator -> DEDUPLICATE (Zero duplicate emails)
        nextNotificationStatus = "alert_sent";
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
            attemptNumber: (prevState.attemptCount || 0) + 1,
            isSimulation,
          });
          recoverySent = true;
          alertSent = true;
        } catch (err) {
          recoverySent = false;
          alertSent = false;
          alertError = err instanceof Error ? err.message : String(err);
          console.error("Monitor recovery email delivery failed:", err);
        }

        nextNotificationStatus = recoverySent ? "idle" : "pending_recovery";

        const nextState: StoredIncidentState = {
          isIncident: false,
          components: [],
          notificationStatus: nextNotificationStatus,
          lastAttemptAt: currentTimestamp,
          lastAlertSentAt: undefined,
          attemptCount: recoverySent ? 0 : (prevState.attemptCount || 0) + 1,
          lastError: recoverySent ? undefined : alertError,
          stableIdempotencyKey: recoverySent ? undefined : stableIdempotencyKey,
          version: (prevState.version || 0) + 1,
          fromDb: realDbAvailable,
        };

        if (realDbAvailable) {
          const persistResult = await persistIncidentState(stateRunKey, nextState);
          if (!persistResult.success) {
            storageStatus = "persistence_failed";
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
        };
        if (realDbAvailable) {
          await persistIncidentState(stateRunKey, nextState);
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
    },
  };
}
